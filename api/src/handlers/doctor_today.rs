//! "Today" for a clinician: everything waiting on *them*, each item carrying
//! the patient it is about (UX plan WP 3.1).
//!
//! The doctor dashboard listed the first 20 patients in the database — whoever
//! registered first, not whoever this doctor treats — and fetched pending
//! consults that no screen ever showed. Here every list is caller-scoped:
//!
//!  * patients: the caller's own active care relationships (encounters,
//!    referrals, receipts from an ambulance), never the whole roster;
//!  * appointments: the caller's, on the facility's calendar day;
//!  * consults: pending, addressed to the caller;
//!  * refills: open requests on the caller's prescriptions;
//!  * results to review and critical values: for the caller's patients (or a
//!    critical value notified to the caller by name).
//!
//! Every item names its patient by name and date of birth — two identifiers —
//! so the list can be acted on without opening each one.
//!
//! A source that fails to load is reported in `unavailable`, not silently
//! dropped: "no results to review" must mean there are none.

use super::*;
use crate::repositories::traits::Pagination;
use chrono::{DateTime, Duration, NaiveDate};
use std::collections::{HashMap, HashSet};

/// How many of the caller's patients are listed and named.
const MAX_PATIENTS: u32 = 100;
/// How many pending consults are scanned for ones addressed to the caller.
const CONSULT_SCAN: u32 = 200;

#[derive(Debug, Clone, Serialize)]
pub struct TodayPatient {
    pub patient_id: String,
    pub full_name: String,
    pub date_of_birth: String,
    /// False when the record exists but could not be decrypted.
    pub content_available: bool,
}

#[derive(Debug, Serialize)]
pub struct TodayItem {
    pub id: String,
    pub patient_id: String,
    pub title: String,
    pub detail: Option<String>,
    pub at: DateTime<Utc>,
    /// `critical`, `urgent` or `routine`.
    pub urgency: &'static str,
}

#[derive(Debug, Serialize)]
pub struct DoctorToday {
    pub date: NaiveDate,
    pub patients: Vec<TodayPatient>,
    pub appointments: Vec<TodayItem>,
    pub consults: Vec<TodayItem>,
    pub refills: Vec<TodayItem>,
    pub results_to_review: Vec<TodayItem>,
    pub critical_values: Vec<TodayItem>,
    /// Names of sources that could not be read, so an empty list is not
    /// mistaken for "nothing waiting".
    pub unavailable: Vec<&'static str>,
}

/// The facility's calendar day containing `now`.
pub(super) fn clinic_today(now: DateTime<Utc>, offset_minutes: i64) -> NaiveDate {
    (now + Duration::minutes(offset_minutes)).date_naive()
}

fn urgency_of(text: Option<&str>) -> &'static str {
    match text.map(|t| t.trim().to_ascii_lowercase()).as_deref() {
        Some("stat" | "emergent" | "emergency" | "critical") => "critical",
        Some("urgent" | "high" | "asap") => "urgent",
        _ => "routine",
    }
}

/// Who a consult is addressed to: the caller by account id or by login name.
fn addressed_to(consulting_provider: &str, caller: &crate::User) -> bool {
    let to = consulting_provider.trim();
    !to.is_empty()
        && (to == caller.id
            || caller
                .username
                .as_deref()
                .is_some_and(|login| to.eq_ignore_ascii_case(login)))
}

async fn name_patients(data: &AppState, ids: &[String]) -> Vec<TodayPatient> {
    let mut named = Vec::with_capacity(ids.len());
    for id in ids.iter().take(MAX_PATIENTS as usize) {
        let Ok(entity) = data.repositories.patients.get_by_id(id).await else {
            continue;
        };
        named.push(
            match patient_entity_to_profile(&entity, &data.encryption_keyring) {
                Some(profile) => TodayPatient {
                    patient_id: profile.patient_id,
                    full_name: profile.full_name,
                    date_of_birth: profile.date_of_birth,
                    content_available: true,
                },
                None => TodayPatient {
                    patient_id: entity.id.clone(),
                    full_name: String::new(),
                    date_of_birth: String::new(),
                    content_available: false,
                },
            },
        );
    }
    named
}

pub(super) async fn appointments(
    data: &AppState,
    caller: &crate::User,
    day: NaiveDate,
) -> Option<Vec<TodayItem>> {
    let rows = data
        .repositories
        .appointments
        .get_by_provider(&caller.id, day)
        .await
        .ok()?;
    let mut items: Vec<TodayItem> = rows
        .into_iter()
        .filter(|a| {
            !matches!(
                a.status.to_ascii_lowercase().as_str(),
                "cancelled" | "no_show" | "completed"
            )
        })
        .map(|a| TodayItem {
            id: a.id,
            patient_id: a.patient_id,
            title: a.appointment_type,
            detail: a.reason_for_visit,
            at: a.scheduled_datetime,
            urgency: urgency_of(a.priority.as_deref()),
        })
        .collect();
    items.sort_by_key(|i| i.at);
    Some(items)
}

async fn consults(data: &AppState, caller: &crate::User) -> Option<Vec<TodayItem>> {
    let page = data
        .repositories
        .consultation_notes
        .get_by_status("pending", Pagination::new(0, CONSULT_SCAN))
        .await
        .ok()?;
    Some(
        page.items
            .into_iter()
            .filter(|c| addressed_to(&c.consulting_provider, caller))
            .map(|c| TodayItem {
                id: c.id,
                patient_id: c.patient_id,
                title: c.consultation_type,
                detail: Some(c.reason_for_consultation),
                at: c.requested_at,
                urgency: urgency_of(c.urgency.as_deref()),
            })
            .collect(),
    )
}

async fn refills(data: &AppState, caller: &crate::User) -> Option<Vec<TodayItem>> {
    let rows = data
        .repositories
        .refill_requests
        .list_open_by_prescriber(&caller.id)
        .await
        .ok()?;
    Some(
        rows.into_iter()
            .map(|r| TodayItem {
                id: r.id,
                patient_id: r.patient_id,
                title: r.medication_name,
                detail: r.patient_note,
                at: r.created_at,
                urgency: "routine",
            })
            .collect(),
    )
}

async fn results_to_review(data: &AppState, mine: &HashSet<String>) -> Option<Vec<TodayItem>> {
    let rows = data
        .repositories
        .lab_result_submissions
        .list_all()
        .await
        .ok()?;
    Some(
        rows.into_iter()
            .filter_map(|r| serde_json::from_value::<crate::LabResultSubmission>(r.data).ok())
            .filter(|s| s.status == crate::LabResultStatus::Pending && mine.contains(&s.patient_id))
            .map(|s| TodayItem {
                id: s.id,
                patient_id: s.patient_id,
                title: s.test_name,
                detail: Some(s.test_category),
                at: s.submitted_at,
                urgency: "routine",
            })
            .collect(),
    )
}

async fn critical_values(
    data: &AppState,
    caller: &crate::User,
    mine: &HashSet<String>,
) -> Option<Vec<TodayItem>> {
    let rows = data
        .repositories
        .critical_values
        .get_unacknowledged()
        .await
        .ok()?;
    Some(
        rows.into_iter()
            .filter(|c| {
                mine.contains(&c.patient_id)
                    || c.notified_provider_id.as_deref() == Some(caller.id.as_str())
            })
            .map(|c| TodayItem {
                id: c.id,
                patient_id: c.patient_id,
                title: c.test_name,
                detail: Some(format!("{} {}", c.value, c.unit)),
                at: c.created_at,
                urgency: "critical",
            })
            .collect(),
    )
}

/// Keep what loaded; name what did not.
fn loaded(
    result: Option<Vec<TodayItem>>,
    source: &'static str,
    unavailable: &mut Vec<&'static str>,
) -> Vec<TodayItem> {
    result.unwrap_or_else(|| {
        log::error!("today: {source} could not be read");
        unavailable.push(source);
        Vec::new()
    })
}

/// GET /api/dashboard/doctor/today
#[get("/api/dashboard/doctor/today")]
pub async fn doctor_today(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let caller = match require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(resp) => return resp,
    };
    let now = Utc::now();
    let mut unavailable = Vec::new();

    let relationships = match data
        .repositories
        .care_relationships
        .active_of_clinician(&caller.id, now, MAX_PATIENTS)
        .await
    {
        Ok(rows) => rows,
        Err(error) => {
            log::error!("today: care relationships could not be read: {error}");
            unavailable.push("patients");
            Vec::new()
        }
    };
    let mine: HashSet<String> = relationships.iter().map(|r| r.patient_id.clone()).collect();
    let day = clinic_today(now, crate::types::clinic_utc_offset_minutes());

    let appointments = loaded(
        appointments(&data, &caller, day).await,
        "appointments",
        &mut unavailable,
    );
    let consults = loaded(consults(&data, &caller).await, "consults", &mut unavailable);
    let refills = loaded(refills(&data, &caller).await, "refills", &mut unavailable);
    let results = loaded(
        results_to_review(&data, &mine).await,
        "results_to_review",
        &mut unavailable,
    );
    let critical = loaded(
        critical_values(&data, &caller, &mine).await,
        "critical_values",
        &mut unavailable,
    );

    // Every patient any item names, in the caller's own order first.
    let mut order: Vec<String> = relationships.iter().map(|r| r.patient_id.clone()).collect();
    let mut seen: HashSet<String> = order.iter().cloned().collect();
    for item in appointments
        .iter()
        .chain(&consults)
        .chain(&refills)
        .chain(&results)
        .chain(&critical)
    {
        if seen.insert(item.patient_id.clone()) {
            order.push(item.patient_id.clone());
        }
    }
    let named = name_patients(&data, &order).await;
    let by_id: HashMap<&str, &TodayPatient> =
        named.iter().map(|p| (p.patient_id.as_str(), p)).collect();
    let patients = relationships
        .iter()
        .filter_map(|r| by_id.get(r.patient_id.as_str()).map(|p| (*p).clone()))
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "today": DoctorToday {
            date: day,
            patients,
            appointments,
            consults,
            refills,
            results_to_review: results,
            critical_values: critical,
            unavailable,
        },
        // The names of every patient an item mentions, so the screen never
        // shows a bare id.
        "names": named,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_day_is_the_facilitys_not_utcs() {
        let late = DateTime::parse_from_rfc3339("2026-10-31T23:30:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(clinic_today(late, 120).to_string(), "2026-11-01");
        assert_eq!(clinic_today(late, 0).to_string(), "2026-10-31");
    }

    #[test]
    fn urgency_words_map_to_three_bands() {
        assert_eq!(urgency_of(Some("STAT")), "critical");
        assert_eq!(urgency_of(Some("urgent")), "urgent");
        assert_eq!(urgency_of(None), "routine");
        assert_eq!(urgency_of(Some("whenever")), "routine");
    }
}

#[cfg(test)]
mod api_tests {
    //! Today lists only the caller's own patients and work.
    use crate::repositories::care_relationships::CareRelationshipEntity;
    use crate::{test_fixtures, AppState, Role};
    use actix_web::{test, web, App};
    use chrono::{Duration, Utc};
    use serde_json::Value;

    const DOCTOR: &str = "doc-today-1";
    const OTHER: &str = "doc-today-2";
    const MINE: &str = "PAT-TODAY-MINE";
    const THEIRS: &str = "PAT-TODAY-THEIRS";

    async fn relate(state: &AppState, patient: &str, clinician: &str) {
        let now = Utc::now();
        state
            .repositories
            .care_relationships
            .record(CareRelationshipEntity {
                id: format!("CR-{patient}-{clinician}"),
                patient_id: patient.to_string(),
                clinician_id: Some(clinician.to_string()),
                facility_id: None,
                source: "encounter".to_string(),
                source_id: format!("APT-{patient}"),
                starts_at: now - Duration::hours(1),
                ends_at: Some(now + Duration::days(30)),
                created_at: now,
            })
            .await
            .expect("relationship recorded");
    }

    #[actix_web::test]
    async fn another_doctors_patient_is_never_listed() {
        let state = AppState::new();
        test_fixtures::register(&state, DOCTOR, Role::Doctor);
        test_fixtures::register(&state, OTHER, Role::Doctor);
        test_fixtures::seed_patient(&state, MINE).await;
        test_fixtures::seed_patient(&state, THEIRS).await;
        relate(&state, MINE, DOCTOR).await;
        relate(&state, THEIRS, OTHER).await;
        let data = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(data.clone())
                .service(super::doctor_today),
        )
        .await;

        let req = test::TestRequest::get()
            .uri("/api/dashboard/doctor/today")
            .insert_header(test_fixtures::as_user(DOCTOR))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let body: Value = test::read_body_json(resp).await;
        let ids: Vec<&str> = body["today"]["patients"]
            .as_array()
            .expect("patients")
            .iter()
            .filter_map(|p| p["patient_id"].as_str())
            .collect();
        assert_eq!(ids, vec![MINE]);
        assert!(!body.to_string().contains(THEIRS));
        assert_eq!(body["today"]["unavailable"], serde_json::json!([]));
    }

    #[actix_web::test]
    async fn a_patient_cannot_open_today() {
        let state = AppState::new();
        test_fixtures::register(&state, "pat-today", Role::Patient);
        let data = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(data.clone())
                .service(super::doctor_today),
        )
        .await;
        let req = test::TestRequest::get()
            .uri("/api/dashboard/doctor/today")
            .insert_header(test_fixtures::as_user("pat-today"))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 403);
    }
}
