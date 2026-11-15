//! What one person has done with their notifications: read, or removed.
//!
//! The notification list is derived from live clinical state (critical values,
//! code blues, lab results, emergency accesses), so its entries are not rows
//! anyone can delete, and must not be: they are the record. What a person can
//! change is their own view of them. Reading one moves it from "New" to
//! "History"; removing one takes it off their screen. Neither touches the
//! record underneath or its audit trail, and neither changes what anybody else
//! sees.
//!
//! Each mark carries the time it was made. An entry whose timestamp is newer
//! than the mark is new again, so an aggregate like "6 lab results awaiting
//! approval", whose key never changes, comes back when a seventh arrives.

use super::*;
use std::collections::HashMap;

/// Marks remembered per kind, per person. The oldest are forgotten first; an
/// entry that old is long out of the derived list anyway.
const MARKS_KEPT: usize = 1000;
/// Longest notification key accepted on the path.
const KEY_MAX_LEN: usize = 200;

/// One person's marks: everything up to `read_at` is read, plus individual
/// reads and removals, each with the time it was made.
#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct NotificationState {
    pub read_at: i64,
    pub read: HashMap<String, i64>,
    pub removed: HashMap<String, i64>,
}

/// The stable key of a notification entry: its type and id.
pub(crate) fn notification_key(entry: &serde_json::Value) -> Option<String> {
    let kind = entry.get("type")?.as_str()?;
    let id = match entry.get("id")? {
        serde_json::Value::String(id) => id.clone(),
        serde_json::Value::Number(id) => id.to_string(),
        _ => return None,
    };
    Some(format!("{kind}:{id}"))
}

fn timestamp_of(entry: &serde_json::Value) -> Option<i64> {
    entry.get("timestamp").and_then(serde_json::Value::as_i64)
}

/// Whether a mark made at `marked_at` still covers an entry stamped `stamp`.
/// An entry with no timestamp is covered by any mark on its key.
fn covered(marked_at: Option<i64>, stamp: Option<i64>) -> bool {
    match (marked_at, stamp) {
        (Some(at), Some(stamp)) => stamp <= at,
        (Some(_), None) => true,
        (None, _) => false,
    }
}

impl NotificationState {
    pub(crate) fn from_record(data: &serde_json::Value) -> Self {
        let marks = |field: &str| -> HashMap<String, i64> {
            data.get(field)
                .and_then(serde_json::Value::as_object)
                .map(|object| {
                    object
                        .iter()
                        .filter_map(|(key, at)| at.as_i64().map(|at| (key.clone(), at)))
                        .collect()
                })
                .unwrap_or_default()
        };
        Self {
            read_at: data
                .get("read_at")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(0),
            read: marks("read"),
            removed: marks("removed"),
        }
    }

    pub(crate) fn to_record(&self) -> serde_json::Value {
        serde_json::json!({
            "read_at": self.read_at,
            "read": self.read,
            "removed": self.removed,
        })
    }

    /// Whether this person removed the entry from their screen.
    pub(crate) fn is_removed(&self, entry: &serde_json::Value) -> bool {
        let Some(key) = notification_key(entry) else {
            return false;
        };
        covered(self.removed.get(&key).copied(), timestamp_of(entry))
    }

    /// Whether this person has read the entry. An entry with no timestamp is
    /// unread until read by key: hiding something because its time could not
    /// be established is the worse error.
    pub(crate) fn is_read(&self, entry: &serde_json::Value) -> bool {
        if timestamp_of(entry).is_some_and(|stamp| stamp <= self.read_at) {
            return true;
        }
        notification_key(entry)
            .is_some_and(|key| covered(self.read.get(&key).copied(), timestamp_of(entry)))
    }

    fn mark(marks: &mut HashMap<String, i64>, key: &str, at: i64) {
        marks.insert(key.to_string(), at);
        if marks.len() > MARKS_KEPT {
            let mut by_age: Vec<(String, i64)> = marks.drain().collect();
            by_age.sort_by_key(|(_, at)| std::cmp::Reverse(*at));
            by_age.truncate(MARKS_KEPT);
            marks.extend(by_age);
        }
    }

    pub(crate) fn mark_read(&mut self, key: &str, at: i64) {
        Self::mark(&mut self.read, key, at);
    }

    pub(crate) fn mark_removed(&mut self, key: &str, at: i64) {
        Self::mark(&mut self.removed, key, at);
    }
}

/// This person's notification state. A store failure is a 503, never "nothing
/// has been read", which would put every notification back on the screen.
pub(crate) async fn load_state(
    data: &web::Data<AppState>,
    user_id: &str,
) -> Result<NotificationState, HttpResponse> {
    match data
        .repositories
        .notification_reads
        .get_by_id(user_id)
        .await
    {
        Ok(Some(record)) => Ok(NotificationState::from_record(&record.data)),
        Ok(None) => Ok(NotificationState::default()),
        Err(error) => {
            log::error!("notification state load failed: {error}");
            Err(state_unavailable())
        }
    }
}

pub(crate) async fn save_state(
    data: &web::Data<AppState>,
    user_id: &str,
    state: &NotificationState,
) -> Result<(), HttpResponse> {
    let now = chrono::Utc::now();
    let record = crate::repositories::traits::JsonRecordEntity {
        id: user_id.to_string(),
        owner_id: user_id.to_string(),
        data: state.to_record(),
        created_at: now,
        updated_at: now,
    };
    data.repositories
        .notification_reads
        .create(record)
        .await
        .map(|_| ())
        .map_err(|error| {
            log::error!("notification state write failed: {error}");
            state_unavailable()
        })
}

fn state_unavailable() -> HttpResponse {
    HttpResponse::ServiceUnavailable().json(ErrorResponse {
        error: "Notifications are temporarily unavailable".to_string(),
        code: "NOTIFICATION_READ_STATE_UNAVAILABLE".to_string(),
    })
}

/// Apply one mark to the caller's own state.
async fn mark_one(
    data: web::Data<AppState>,
    user_id: String,
    key: String,
    apply: fn(&mut NotificationState, &str, i64),
) -> HttpResponse {
    if key.is_empty() || key.len() > KEY_MAX_LEN || !key.contains(':') {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "Not a notification key".to_string(),
            code: "INVALID_NOTIFICATION_KEY".to_string(),
        });
    }
    let mut state = match load_state(&data, &user_id).await {
        Ok(state) => state,
        Err(response) => return response,
    };
    apply(&mut state, &key, chrono::Utc::now().timestamp());
    match save_state(&data, &user_id, &state).await {
        Ok(()) => HttpResponse::Ok().json(serde_json::json!({ "success": true, "key": key })),
        Err(response) => response,
    }
}

/// Mark one notification read: it moves from New to History.
#[post("/api/notifications/{key}/read")]
pub async fn mark_notification_read(
    data: web::Data<AppState>,
    caller: crate::middleware::AuthorizedUser,
    path: web::Path<String>,
) -> impl Responder {
    mark_one(
        data,
        caller.user_id,
        path.into_inner(),
        NotificationState::mark_read,
    )
    .await
}

/// Remove one notification from the caller's screen. The record it describes,
/// and its audit trail, are untouched; other people still see theirs.
#[post("/api/notifications/{key}/remove")]
pub async fn remove_notification(
    data: web::Data<AppState>,
    caller: crate::middleware::AuthorizedUser,
    path: web::Path<String>,
) -> impl Responder {
    mark_one(
        data,
        caller.user_id,
        path.into_inner(),
        NotificationState::mark_removed,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(kind: &str, id: &str, stamp: i64) -> serde_json::Value {
        serde_json::json!({ "type": kind, "id": id, "timestamp": stamp })
    }

    #[test]
    fn reading_one_leaves_the_others_new() {
        let mut state = NotificationState::default();
        let first = entry("critical_value", "CV-1", 100);
        let second = entry("critical_value", "CV-2", 100);
        state.mark_read("critical_value:CV-1", 150);
        assert!(state.is_read(&first));
        assert!(!state.is_read(&second));
        assert!(!state.is_removed(&first), "read is not removed");
    }

    #[test]
    fn an_aggregate_is_new_again_when_it_changes() {
        let mut state = NotificationState::default();
        state.mark_read("pending_approval:pending-labs", 200);
        assert!(state.is_read(&entry("pending_approval", "pending-labs", 180)));
        assert!(!state.is_read(&entry("pending_approval", "pending-labs", 260)));
        state.mark_removed("pending_approval:pending-labs", 300);
        assert!(state.is_removed(&entry("pending_approval", "pending-labs", 260)));
        assert!(!state.is_removed(&entry("pending_approval", "pending-labs", 400)));
    }

    #[test]
    fn mark_all_read_still_applies() {
        let state = NotificationState {
            read_at: 500,
            ..Default::default()
        };
        assert!(state.is_read(&entry("code_blue", "CB-1", 499)));
        assert!(!state.is_read(&entry("code_blue", "CB-1", 501)));
    }

    #[test]
    fn the_state_survives_storage_and_old_records_still_load() {
        let mut state = NotificationState {
            read_at: 10,
            ..Default::default()
        };
        state.mark_read("lab_result:L-1", 20);
        state.mark_removed("code_blue:CB-1", 30);
        assert_eq!(NotificationState::from_record(&state.to_record()), state);
        // A marker written before per-entry marks existed.
        let old = NotificationState::from_record(&serde_json::json!({ "read_at": 42 }));
        assert_eq!(old.read_at, 42);
        assert!(old.read.is_empty() && old.removed.is_empty());
    }

    #[test]
    fn marks_are_bounded_and_keep_the_newest() {
        let mut state = NotificationState::default();
        for i in 0..(MARKS_KEPT as i64 + 5) {
            state.mark_read(&format!("lab_result:{i}"), i);
        }
        assert_eq!(state.read.len(), MARKS_KEPT);
        assert!(!state.read.contains_key("lab_result:0"));
        assert!(state
            .read
            .contains_key(&format!("lab_result:{}", MARKS_KEPT + 4)));
    }
}
