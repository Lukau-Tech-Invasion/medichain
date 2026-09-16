//! A provider's working hours, and the slots that follow from them.
//!
//! `GET /api/appointments/slots/{provider}/{date}` offered the same ten times
//! for every provider because nothing stored when anyone works. Real bookings
//! were excluded, so it could not double-book — but it could offer 09:00 with a
//! surgeon whose list starts at 14:00, and the patient app rendered that as
//! availability. The response admitted it in `slots_source`, which was the
//! honest half of a feature that did not exist.
//!
//! A schedule is a weekly pattern plus dated exceptions. That shape is chosen
//! because it is how clinicians describe their own time — "Tuesdays and
//! Thursdays, 14:00 to 18:00, except the 24th" — and a model that cannot say
//! that ends up storing generated instances, which then have to be regenerated
//! forever.
//!
//! **A provider with no schedule keeps the default grid**, and the endpoint
//! keeps saying so. Absent is not "works no hours": inventing an empty diary
//! for every provider who has not filled one in would take a booking system
//! that over-offers and make it one that refuses everybody.

use super::*;
use crate::repositories::traits::JsonRecordEntity;

/// One weekday the provider works.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WorkingDay {
    /// ISO-8601 weekday: 1 = Monday … 7 = Sunday.
    pub weekday: u8,
    /// `HH:MM`, facility wall-clock — the same clock the appointment carries.
    pub start: String,
    pub end: String,
    /// An unavailable span inside the working day, typically a clinic list
    /// break or a theatre slot. Both ends or neither.
    #[serde(default)]
    pub break_start: Option<String>,
    #[serde(default)]
    pub break_end: Option<String>,
}

/// A dated exception: leave, a conference, an operating list.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BlockedTime {
    /// `YYYY-MM-DD`.
    pub date: String,
    /// Absent start and end mean the whole day is blocked.
    #[serde(default)]
    pub start: Option<String>,
    #[serde(default)]
    pub end: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

/// A provider's bookable time.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProviderSchedule {
    pub provider_id: String,
    #[serde(default)]
    pub working_days: Vec<WorkingDay>,
    #[serde(default)]
    pub blocked: Vec<BlockedTime>,
    /// Appointment length. 30 minutes unless the provider says otherwise.
    #[serde(default = "default_slot_minutes")]
    pub slot_minutes: u32,
    #[serde(default)]
    pub updated_by: Option<String>,
    #[serde(default)]
    pub updated_at: Option<i64>,
}

fn default_slot_minutes() -> u32 {
    30
}

/// `HH:MM` as minutes past midnight. `None` for anything that is not a time.
///
/// Strict on purpose: a schedule that silently reads `"9am"` as midnight would
/// publish a provider as available from 00:00.
pub fn parse_hhmm(text: &str) -> Option<u32> {
    let (hours, minutes) = text.trim().split_once(':')?;
    let hours: u32 = hours.parse().ok()?;
    let minutes: u32 = minutes.parse().ok()?;
    if hours > 23 || minutes > 59 {
        return None;
    }
    Some(hours * 60 + minutes)
}

fn format_hhmm(total: u32) -> String {
    format!("{:02}:{:02}", total / 60, total % 60)
}

/// Every start time this schedule offers on a given date.
///
/// Returns `None` when the provider does not work that weekday or the day is
/// blocked outright — which is different from an empty list, and the caller
/// says so differently.
pub fn slots_for_date(schedule: &ProviderSchedule, date: chrono::NaiveDate) -> Option<Vec<String>> {
    use chrono::Datelike;
    let weekday = date.weekday().number_from_monday() as u8;
    let day = schedule
        .working_days
        .iter()
        .find(|working| working.weekday == weekday)?;

    let start = parse_hhmm(&day.start)?;
    let end = parse_hhmm(&day.end)?;
    if end <= start {
        return None;
    }
    let step = schedule.slot_minutes.max(5);
    let iso = date.format("%Y-%m-%d").to_string();

    // A whole-day block removes the day, rather than leaving an empty list that
    // reads as "fully booked".
    if schedule
        .blocked
        .iter()
        .any(|block| block.date == iso && block.start.is_none() && block.end.is_none())
    {
        return None;
    }

    let mut slots = Vec::new();
    let mut at = start;
    while at + step <= end {
        if !is_unavailable(schedule, day, &iso, at, step) {
            slots.push(format_hhmm(at));
        }
        at += step;
    }
    Some(slots)
}

/// Whether a slot beginning at `at` collides with a break or a dated block.
///
/// Overlap, not containment: an appointment that *starts* before a break and
/// runs into it is still unavailable, and a model that only checked the start
/// time would book a patient into the first half of a theatre list.
fn is_unavailable(
    schedule: &ProviderSchedule,
    day: &WorkingDay,
    iso_date: &str,
    at: u32,
    step: u32,
) -> bool {
    let slot_end = at + step;

    if let (Some(break_start), Some(break_end)) = (
        day.break_start.as_deref().and_then(parse_hhmm),
        day.break_end.as_deref().and_then(parse_hhmm),
    ) {
        if at < break_end && slot_end > break_start {
            return true;
        }
    }

    schedule.blocked.iter().any(|block| {
        if block.date != iso_date {
            return false;
        }
        match (
            block.start.as_deref().and_then(parse_hhmm),
            block.end.as_deref().and_then(parse_hhmm),
        ) {
            (Some(from), Some(to)) => at < to && slot_end > from,
            // A partial block with only one end is not a span this can reason
            // about; treated as the whole day, because refusing a bookable slot
            // is recoverable and booking into leave is not.
            _ => true,
        }
    })
}

/// Read a provider's stored schedule, if they have one.
pub async fn load_schedule(
    data: &web::Data<crate::AppState>,
    provider_id: &str,
) -> Option<ProviderSchedule> {
    let record = data
        .repositories
        .provider_schedules
        .get_by_id(provider_id)
        .await
        .ok()??;
    serde_json::from_value(record.data).ok()
}

#[derive(Debug, serde::Deserialize)]
pub struct SetProviderScheduleRequest {
    #[serde(default)]
    pub working_days: Vec<WorkingDay>,
    #[serde(default)]
    pub blocked: Vec<BlockedTime>,
    #[serde(default)]
    pub slot_minutes: Option<u32>,
}

/// Publish a provider's working hours.
///
/// A provider sets their own; an administrator may set anyone's. A clinician
/// cannot set a colleague's, because a diary that somebody else can quietly
/// rewrite is one nobody can rely on.
#[put("/api/providers/{provider_id}/schedule")]
pub async fn set_provider_schedule(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<SetProviderScheduleRequest>,
) -> impl Responder {
    let provider_id = path.into_inner();
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(resp) => return resp,
    };

    if caller.wallet_address != provider_id && !caller.role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "A schedule can be set by the provider it belongs to, or by an administrator."
                .to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let body = req.into_inner();
    for day in &body.working_days {
        if !(1..=7).contains(&day.weekday) {
            return reject(format!(
                "weekday {} is not an ISO weekday (1 = Monday .. 7 = Sunday)",
                day.weekday
            ));
        }
        let (Some(start), Some(end)) = (parse_hhmm(&day.start), parse_hhmm(&day.end)) else {
            return reject(format!(
                "working day {} has times that are not HH:MM ({} to {})",
                day.weekday, day.start, day.end
            ));
        };
        if end <= start {
            return reject(format!(
                "working day {} ends at or before it starts ({} to {})",
                day.weekday, day.start, day.end
            ));
        }
        // One end of a break is not a break. Storing it would silently block
        // either nothing or the whole day, and neither is what was meant.
        if day.break_start.is_some() != day.break_end.is_some() {
            return reject(format!(
                "working day {} has only one end of a break; give both or neither",
                day.weekday
            ));
        }
    }

    let schedule = ProviderSchedule {
        provider_id: provider_id.clone(),
        working_days: body.working_days,
        blocked: body.blocked,
        slot_minutes: body.slot_minutes.unwrap_or_else(default_slot_minutes),
        updated_by: Some(caller.wallet_address.clone()),
        updated_at: Some(chrono::Utc::now().timestamp()),
    };

    let now = chrono::Utc::now();
    let entity = JsonRecordEntity {
        id: provider_id.clone(),
        owner_id: provider_id.clone(),
        data: serde_json::to_value(&schedule).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };

    // `JsonRecordRepository::create` is documented as "insert or replace a
    // record by `id`", which is the semantics wanted here: a schedule is the
    // provider's current hours, not an accumulating history.
    if let Err(error) = data.repositories.provider_schedules.create(entity).await {
        log::error!("provider schedule persistence failed: {error}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "The schedule could not be saved; please retry.".to_string(),
            code: "SCHEDULE_PERSISTENCE_FAILED".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "provider_id": provider_id,
        "working_days": schedule.working_days.len(),
        "message": "Schedule saved"
    }))
}

fn reject(message: String) -> HttpResponse {
    HttpResponse::BadRequest().json(ErrorResponse {
        success: false,
        error: message,
        code: "SCHEDULE_INVALID".to_string(),
    })
}

/// Read a provider's working hours.
///
/// Answers 200 with `has_schedule: false` rather than 404 when none is set:
/// "this provider has not published hours" is a real answer, and a booking
/// screen needs to tell it apart from "no such provider".
#[get("/api/providers/{provider_id}/schedule")]
pub async fn get_provider_schedule(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_registered_caller(&data, &http_req) {
        return resp;
    }
    let provider_id = path.into_inner();
    match load_schedule(&data, &provider_id).await {
        Some(schedule) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "has_schedule": true,
            "schedule": schedule,
        })),
        None => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "has_schedule": false,
            "provider_id": provider_id,
            "message": "This provider has not published working hours; the default clinic grid applies.",
        })),
    }
}

#[cfg(test)]
mod schedule_tests {
    use super::*;

    fn tuesday_schedule() -> ProviderSchedule {
        ProviderSchedule {
            provider_id: "5Provider".to_string(),
            working_days: vec![WorkingDay {
                weekday: 2, // Tuesday
                start: "14:00".to_string(),
                end: "16:00".to_string(),
                break_start: None,
                break_end: None,
            }],
            blocked: Vec::new(),
            slot_minutes: 30,
            updated_by: None,
            updated_at: None,
        }
    }

    fn date(text: &str) -> chrono::NaiveDate {
        chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn slots_follow_the_providers_own_hours() {
        // 2026-09-15 is a Tuesday.
        let slots = slots_for_date(&tuesday_schedule(), date("2026-09-15")).unwrap();
        assert_eq!(slots, vec!["14:00", "14:30", "15:00", "15:30"]);
        // The defect this replaces: 09:00 was offered to a provider who starts
        // at 14:00.
        assert!(!slots.contains(&"09:00".to_string()));
    }

    #[test]
    fn a_day_the_provider_does_not_work_has_no_slots_at_all() {
        // 2026-09-16 is a Wednesday, which this provider does not work. `None`,
        // not an empty list: "does not work today" and "fully booked" are
        // different answers.
        assert!(slots_for_date(&tuesday_schedule(), date("2026-09-16")).is_none());
    }

    #[test]
    fn a_break_removes_every_slot_that_overlaps_it() {
        let mut schedule = tuesday_schedule();
        schedule.working_days[0].break_start = Some("14:45".to_string());
        schedule.working_days[0].break_end = Some("15:15".to_string());

        let slots = slots_for_date(&schedule, date("2026-09-15")).unwrap();
        // 14:30-15:00 starts before the break and runs into it, and 15:00-15:30
        // starts inside it. Checking only the start time would have booked the
        // first.
        assert_eq!(slots, vec!["14:00", "15:30"]);
    }

    #[test]
    fn a_whole_day_block_removes_the_day() {
        let mut schedule = tuesday_schedule();
        schedule.blocked.push(BlockedTime {
            date: "2026-09-15".to_string(),
            start: None,
            end: None,
            reason: Some("Annual leave".to_string()),
        });
        assert!(slots_for_date(&schedule, date("2026-09-15")).is_none());
    }

    #[test]
    fn a_partial_block_removes_only_what_it_covers() {
        let mut schedule = tuesday_schedule();
        schedule.blocked.push(BlockedTime {
            date: "2026-09-15".to_string(),
            start: Some("15:00".to_string()),
            end: Some("16:00".to_string()),
            reason: Some("Theatre list".to_string()),
        });
        let slots = slots_for_date(&schedule, date("2026-09-15")).unwrap();
        assert_eq!(slots, vec!["14:00", "14:30"]);
    }

    #[test]
    fn a_block_on_another_date_changes_nothing() {
        let mut schedule = tuesday_schedule();
        schedule.blocked.push(BlockedTime {
            date: "2026-09-22".to_string(),
            start: None,
            end: None,
            reason: None,
        });
        assert_eq!(
            slots_for_date(&schedule, date("2026-09-15")).unwrap().len(),
            4
        );
    }

    #[test]
    fn a_time_that_is_not_a_time_is_refused_rather_than_read_as_midnight() {
        assert_eq!(parse_hhmm("9am"), None);
        assert_eq!(parse_hhmm("24:00"), None);
        assert_eq!(parse_hhmm("14:60"), None);
        assert_eq!(parse_hhmm("14:00"), Some(840));
        assert_eq!(parse_hhmm(" 08:30 "), Some(510));
    }

    #[test]
    fn a_slot_longer_than_the_working_day_yields_nothing_rather_than_overrunning() {
        let mut schedule = tuesday_schedule();
        schedule.slot_minutes = 180; // three hours inside a two-hour clinic
        assert!(slots_for_date(&schedule, date("2026-09-15"))
            .unwrap()
            .is_empty());
    }
}
