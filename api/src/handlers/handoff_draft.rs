//! A shift handoff drafted from the shift itself (UX plan WP 5.6, mockup c2).
//!
//! The SBAR handoff form started blank for every patient, so the end of a shift
//! meant retyping, from memory, what had been charted hours earlier. The draft
//! is built from what the caller actually recorded since `since`: every write
//! is already an audit row naming its author, patient, record type and time.
//! It lists, per patient, which records the caller wrote and when, and -- for a
//! patient the caller is treating -- an SBAR draft of what those records say
//! (`handoff_content`, owner decision 2026-11-08). The content passes the same
//! chart gate as opening the chart, and each patient whose content is released
//! gets an access-log row first, so the patient can see the read; a row that
//! cannot be written withholds the content rather than sending it unrecorded.
//! Patients on the caller's ward roster are included even when nothing was
//! recorded, so "Nothing recorded this shift" is said rather than the patient
//! going missing.

use super::handoff_content::{patient_sbar, Sbar};
use super::*;
use crate::care_access::ChartAuthority;
use crate::repositories::traits::{AccessLogEntity, Pagination};
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
    /// `included`, `not_permitted` (no treating link to this patient) or
    /// `unavailable` (a record or the audit row could not be written or read).
    pub content: &'static str,
    pub sbar: Option<Sbar>,
}

/// Why the draft read the chart, as the patient sees it in their access history.
const DRAFT_REASON: &str = "Shift handoff drafted from this shift's records";

/// A clinician treating the patient. Administrator oversight drafts no handoff.
fn is_treating(authority: &ChartAuthority) -> bool {
    matches!(
        authority,
        ChartAuthority::PatientGrant(_)
            | ChartAuthority::CareRelationship { .. }
            | ChartAuthority::WardAssignment { .. }
            | ChartAuthority::BreakGlass(_)
    )
}

fn draft_access_log(
    caller: &crate::User,
    patient_id: &str,
    authority: &ChartAuthority,
    req: &HttpRequest,
) -> AccessLogEntity {
    AccessLogEntity {
        id: uuid::Uuid::new_v4().to_string(),
        accessor_id: caller.id.clone(),
        accessor_role: caller.role.to_string(),
        patient_id: Some(patient_id.to_string()),
        resource_type: "handoff_draft".to_string(),
        resource_id: Some("/api/shift-handoff/draft".to_string()),
        action: "View".to_string(),
        access_reason: Some(DRAFT_REASON.to_string()),
        is_emergency_access: matches!(authority, ChartAuthority::BreakGlass(_)),
        ip_address: req.peer_addr().map(|addr| addr.ip().to_string()),
        user_agent: req
            .headers()
            .get(actix_web::http::header::USER_AGENT)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string),
        accessed_at: Utc::now(),
        facility_id: None,
        authority_type: authority.authority_type().map(str::to_string),
        authority_id: authority.authority_id(),
    }
}

/// The SBAR draft for one patient, or why there is none.
async fn draft_content(
    data: &web::Data<AppState>,
    caller: &crate::User,
    req: &HttpRequest,
    profile: Option<&PatientProfile>,
    since: DateTime<Utc>,
) -> (&'static str, Option<Sbar>) {
    let Some(profile) = profile else {
        return ("unavailable", None);
    };
    let authority =
        match crate::care_access::resolve_chart_access(data, caller, &profile.patient_id).await {
            Ok(authority) if is_treating(&authority) => authority,
            Ok(_) => return ("not_permitted", None),
            Err(_) => return ("unavailable", None),
        };
    let sbar = match patient_sbar(data, profile, since).await {
        Ok(sbar) => sbar,
        Err(error) => {
            log::error!(
                "handoff draft: records of {} could not be read: {error}",
                profile.patient_id
            );
            return ("unavailable", None);
        }
    };
    let entry = draft_access_log(caller, &profile.patient_id, &authority, req);
    if require_durable_audit(data, entry).await.is_err() {
        return ("unavailable", None);
    }
    ("included", Some(sbar))
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
        let (content, sbar) = draft_content(&data, &caller, &req, profile.as_ref(), since).await;
        patients.push(DraftPatient {
            content,
            sbar,
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

    #[actix_web::test]
    async fn a_treated_patient_gets_drafted_content_and_the_read_is_on_their_history() {
        let state = AppState::new();
        test_fixtures::register(&state, "nurse-c2", Role::Nurse);
        test_fixtures::seed_patient(&state, "PAT-C2-MINE").await;
        test_fixtures::seed_patient(&state, "PAT-C2-NOT").await;
        crate::care_access::record_encounter(
            &state,
            "PAT-C2-MINE",
            "nurse-c2",
            "APT-C2",
            Utc::now(),
        )
        .await;
        let logs = &state.repositories.access_logs;
        for patient in ["PAT-C2-MINE", "PAT-C2-NOT"] {
            logs.create(log("nurse-c2", patient, "create", "wound_care", 15))
                .await
                .unwrap();
        }
        let data = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(data.clone())
                .service(super::shift_handoff_draft),
        )
        .await;
        let req = test::TestRequest::get()
            .uri("/api/shift-handoff/draft")
            .insert_header(test_fixtures::as_user("nurse-c2"))
            .to_request();
        let body: Value = test::read_body_json(test::call_service(&app, req).await).await;
        let find = |id: &str| {
            body["patients"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["patient_id"] == id)
                .cloned()
                .unwrap()
        };

        let mine = find("PAT-C2-MINE");
        assert_eq!(mine["content"], "included", "{body}");
        assert_eq!(mine["sbar"]["background"][0]["source"], "chart");
        let not_mine = find("PAT-C2-NOT");
        assert_eq!(
            not_mine["content"], "not_permitted",
            "no treating link, no content: {body}"
        );
        assert!(not_mine["sbar"].is_null());

        let page = crate::repositories::traits::Pagination::new(0, 50);
        let history = data
            .repositories
            .access_logs
            .get_by_patient("PAT-C2-MINE", page)
            .await
            .unwrap();
        assert!(history
            .items
            .iter()
            .any(|row| row.resource_type == "handoff_draft" && row.accessor_id == "nurse-c2"));
        let other = data
            .repositories
            .access_logs
            .get_by_patient("PAT-C2-NOT", page)
            .await
            .unwrap();
        assert!(!other
            .items
            .iter()
            .any(|row| row.resource_type == "handoff_draft"));
    }
}
