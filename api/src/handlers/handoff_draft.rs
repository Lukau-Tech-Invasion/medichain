//! A shift handoff drafted from the shift itself (UX plan WP 5.6, mockup c2).
//!
//! The SBAR handoff form started blank for every patient, so the end of a shift
//! meant retyping, from memory, what had been charted hours earlier. The draft
//! is built from what the caller actually recorded since `since`: every write
//! is already an audit row naming its author, patient, record type and time.
//! It lists, per patient, which records the caller wrote and when — never the
//! clinical content, which stays behind each record's own read. Patients on
//! the caller's ward roster are included even when nothing was recorded, so
//! "Nothing recorded this shift" is said rather than the patient going missing.

use super::*;
use crate::repositories::traits::Pagination;
use chrono::{DateTime, Duration};
use std::collections::BTreeMap;

/// Audit rows read to build the draft (newest first).
const LOG_SCAN: u32 = 1_000;
/// Longest window a draft may cover.
const MAX_WINDOW_HOURS: i64 = 24;

#[derive(Debug, Deserialize)]
pub struct DraftQuery {
    pub since: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Default)]
pub struct RecordedKind {
    pub resource_type: String,
    pub count: u32,
    pub last_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct DraftPatient {
    pub patient_id: String,
    pub full_name: Option<String>,
    pub date_of_birth: Option<String>,
    pub bed_label: Option<String>,
    pub recorded: Vec<RecordedKind>,
}

/// Whether an audit action records a write rather than a read.
fn is_write(action: &str) -> bool {
    let a = action.to_ascii_lowercase();
    !(a.contains("view")
        || a.contains("read")
        || a.contains("list")
        || a.contains("search")
        || a.contains("export"))
}

/// GET /api/shift-handoff/draft?since=
#[get("/api/shift-handoff/draft")]
pub async fn shift_handoff_draft(
    data: web::Data<AppState>,
    req: HttpRequest,
    query: web::Query<DraftQuery>,
) -> impl Responder {
    let caller = match require_clinical_staff(&data, &req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let now = Utc::now();
    let since = query
        .since
        .unwrap_or(now - Duration::hours(12))
        .max(now - Duration::hours(MAX_WINDOW_HOURS));

    let logs = match data
        .repositories
        .access_logs
        .get_by_accessor(
            std::slice::from_ref(&caller.id),
            Pagination::new(0, LOG_SCAN),
        )
        .await
    {
        Ok(page) => page.items,
        Err(error) => {
            log::error!("handoff draft: audit rows could not be read: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "What you recorded this shift could not be read".to_string(),
                code: "DATABASE_ERROR".to_string(),
            });
        }
    };

    // patient -> resource type -> (count, latest)
    let mut by_patient: BTreeMap<String, BTreeMap<String, RecordedKind>> = BTreeMap::new();
    for log in logs
        .iter()
        .filter(|l| l.accessed_at >= since && is_write(&l.action))
    {
        let Some(patient) = log.patient_id.clone() else {
            continue;
        };
        let kind = by_patient
            .entry(patient)
            .or_default()
            .entry(log.resource_type.clone())
            .or_default();
        kind.resource_type = log.resource_type.clone();
        kind.count += 1;
        kind.last_at = kind.last_at.max(Some(log.accessed_at));
    }

    // Ward patients the caller is rostered for now, with their beds.
    let mut beds: BTreeMap<String, Option<String>> = BTreeMap::new();
    if let Ok(shifts) = data
        .repositories
        .wards
        .current_shifts_of(&caller.id, now)
        .await
    {
        let ward_ids: Vec<String> = shifts.into_iter().map(|s| s.ward_id).collect();
        if !ward_ids.is_empty() {
            if let Ok(admissions) = data.repositories.wards.open_admissions_on(&ward_ids).await {
                for a in admissions {
                    beds.insert(a.patient_id, a.bed_label);
                }
            }
        }
    }
    for patient in beds.keys() {
        by_patient.entry(patient.clone()).or_default();
    }

    let mut patients = Vec::with_capacity(by_patient.len());
    for (patient_id, kinds) in by_patient {
        let profile = data
            .repositories
            .patients
            .get_by_id(&patient_id)
            .await
            .ok()
            .and_then(|e| patient_entity_to_profile(&e, &data.encryption_keyring));
        let mut recorded: Vec<RecordedKind> = kinds.into_values().collect();
        recorded.sort_by_key(|r| std::cmp::Reverse(r.last_at));
        patients.push(DraftPatient {
            bed_label: beds.get(&patient_id).cloned().flatten(),
            full_name: profile.as_ref().map(|p| p.full_name.clone()),
            date_of_birth: profile.as_ref().map(|p| p.date_of_birth.clone()),
            patient_id,
            recorded,
        });
    }
    // Ward patients by bed first, then everyone else by most recent work.
    patients.sort_by(|a, b| {
        (
            a.bed_label.is_none(),
            a.bed_label.clone(),
            std::cmp::Reverse(a.recorded.first().and_then(|r| r.last_at)),
        )
            .cmp(&(
                b.bed_label.is_none(),
                b.bed_label.clone(),
                std::cmp::Reverse(b.recorded.first().and_then(|r| r.last_at)),
            ))
    });

    HttpResponse::Ok().json(serde_json::json!({ "since": since, "patients": patients }))
}

#[cfg(test)]
mod tests {
    use super::is_write;

    #[test]
    fn reads_are_not_counted_as_work_done() {
        assert!(is_write("create"));
        assert!(is_write("Update"));
        assert!(is_write("add_vital_signs"));
        assert!(!is_write("view"));
        assert!(!is_write("View"));
        assert!(!is_write("directory_search"));
    }
}

#[cfg(test)]
mod api_tests {
    use crate::repositories::traits::AccessLogEntity;
    use crate::{test_fixtures, AppState, Role};
    use actix_web::{test, web, App};
    use chrono::{Duration, Utc};
    use serde_json::Value;

    fn log(
        who: &str,
        patient: &str,
        action: &str,
        kind: &str,
        minutes_ago: i64,
    ) -> AccessLogEntity {
        AccessLogEntity {
            id: uuid::Uuid::new_v4().to_string(),
            accessor_id: who.into(),
            accessor_role: "Nurse".into(),
            patient_id: Some(patient.into()),
            resource_type: kind.into(),
            resource_id: None,
            action: action.into(),
            access_reason: None,
            is_emergency_access: false,
            ip_address: None,
            user_agent: None,
            accessed_at: Utc::now() - Duration::minutes(minutes_ago),
            facility_id: None,
            authority_type: None,
            authority_id: None,
        }
    }

    #[actix_web::test]
    async fn the_draft_lists_only_what_this_nurse_wrote_this_shift() {
        let state = AppState::new();
        test_fixtures::register(&state, "nurse-draft", Role::Nurse);
        test_fixtures::seed_patient(&state, "PAT-D1").await;
        let logs = &state.repositories.access_logs;
        logs.create(log(
            "nurse-draft",
            "PAT-D1",
            "add_vital_signs",
            "vital_signs",
            30,
        ))
        .await
        .unwrap();
        logs.create(log(
            "nurse-draft",
            "PAT-D1",
            "add_vital_signs",
            "vital_signs",
            90,
        ))
        .await
        .unwrap();
        logs.create(log("nurse-draft", "PAT-D1", "view", "chart", 10))
            .await
            .unwrap();
        logs.create(log(
            "nurse-draft",
            "PAT-OLD",
            "create",
            "wound_care",
            60 * 20,
        ))
        .await
        .unwrap();
        logs.create(log("someone-else", "PAT-OTHER", "create", "wound_care", 5))
            .await
            .unwrap();
        let data = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(data.clone())
                .service(super::shift_handoff_draft),
        )
        .await;

        let req = test::TestRequest::get()
            .uri("/api/shift-handoff/draft")
            .insert_header(test_fixtures::as_user("nurse-draft"))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let body: Value = test::read_body_json(resp).await;
        let patients = body["patients"].as_array().unwrap();
        assert_eq!(patients.len(), 1, "{body}");
        assert_eq!(patients[0]["patient_id"], "PAT-D1");
        assert_eq!(patients[0]["recorded"][0]["resource_type"], "vital_signs");
        assert_eq!(
            patients[0]["recorded"][0]["count"], 2,
            "the chart view is not work done"
        );
    }
}
