//! The clinician's day, downloaded to their device for use without a connection.
//!
//! A doctor or nurse on a ward or in a rural clinic loses signal. What they
//! still need is the people they are looking after today: who they are and what
//! could hurt them (allergies, medicines, conditions, blood group, DNR). This
//! endpoint is the one place that list leaves the server for a device.
//!
//! # Which patients
//!
//! Only the caller's day, never the roster (owner decision, 2026-11-04): their
//! active care relationships, today's appointments, and admissions on a ward
//! they are rostered on now. A lost phone then carries the patients one person
//! was treating that day, not the hospital.
//!
//! # The same gate as opening a chart
//!
//! Each patient passes `resolve_chart_access`, exactly as a chart read does.
//! Break-glass and administrator oversight are not carried offline: an
//! emergency grant lasts an hour and an administrator does not treat anyone.
//!
//! # The patient can see it
//!
//! Every patient included gets a durable access-log row (`Export`, "Downloaded
//! to a device for offline use") before their data is released. A patient
//! whose row cannot be written is withheld, not sent unrecorded — the same
//! contract as `support::require_durable_audit`.
//!
//! # Minimised
//!
//! Identity and the emergency summary only. No address, insurance or national
//! ID number, which a clinician does not need offline and a thief would want.

use super::*;
use crate::care_access::ChartAuthority;
use crate::repositories::traits::AccessLogEntity;
use chrono::Duration;
use std::collections::HashSet;

/// Most patients put on one device.
const MAX_OFFLINE_PATIENTS: usize = 100;
/// How long the device keeps the download: one shift.
const OFFLINE_HOURS: i64 = 12;
/// What the patient reads on their access history.
const OFFLINE_REASON: &str = "Downloaded to a device for offline use";

/// Why a patient is on the caller's list, for the offline screen to show.
#[derive(Debug, Clone, Serialize)]
pub struct ListedFor {
    /// `care`, `appointment` or `ward`.
    pub kind: &'static str,
    pub at: Option<chrono::DateTime<Utc>>,
    pub detail: Option<String>,
}

/// The caller's patients in order, each with every reason they are listed.
///
/// Also the nurse dashboard's "My Patients": the same day, on screen instead of
/// on the device.
pub(crate) async fn day_list(
    data: &AppState,
    caller: &crate::User,
) -> Vec<(String, Vec<ListedFor>)> {
    let now = Utc::now();
    let mut order: Vec<(String, Vec<ListedFor>)> = Vec::new();
    let mut add = |id: String, why: ListedFor| match order.iter_mut().find(|(p, _)| *p == id) {
        Some((_, reasons)) => reasons.push(why),
        None => order.push((id, vec![why])),
    };

    let day = super::doctor_today::clinic_today(now, crate::types::clinic_utc_offset_minutes());
    for item in super::doctor_today::appointments(data, caller, day)
        .await
        .unwrap_or_default()
    {
        add(
            item.patient_id,
            ListedFor {
                kind: "appointment",
                at: Some(item.at),
                detail: Some(item.title),
            },
        );
    }
    for admission in ward_admissions(data, &caller.id).await {
        add(
            admission.patient_id,
            ListedFor {
                kind: "ward",
                at: Some(admission.admitted_at),
                detail: admission.bed_label,
            },
        );
    }
    let relationships = data
        .repositories
        .care_relationships
        .active_of_clinician(&caller.id, now, MAX_OFFLINE_PATIENTS as u32)
        .await
        .unwrap_or_default();
    for relationship in relationships {
        add(
            relationship.patient_id,
            ListedFor {
                kind: "care",
                at: None,
                detail: Some(relationship.source),
            },
        );
    }
    order.truncate(MAX_OFFLINE_PATIENTS);
    order
}

/// Open admissions on the wards the caller is rostered on now.
async fn ward_admissions(
    data: &AppState,
    clinician_id: &str,
) -> Vec<crate::repositories::wards::AdmissionEntity> {
    let wards = &data.repositories.wards;
    let Ok(shifts) = wards.current_shifts_of(clinician_id, Utc::now()).await else {
        return Vec::new();
    };
    let ids: Vec<String> = shifts
        .into_iter()
        .map(|s| s.ward_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if ids.is_empty() {
        return Vec::new();
    }
    wards.open_admissions_on(&ids).await.unwrap_or_default()
}

/// Whether this authority is someone treating the patient: the patient's own
/// grant, a care relationship or a ward assignment. Break-glass and an
/// administrator's oversight are not — they may open a chart, but the patient
/// is not on their day, so it neither leaves on a device nor fills a ward list.
pub(crate) fn is_treating_authority(authority: &ChartAuthority) -> bool {
    matches!(
        authority,
        ChartAuthority::PatientGrant(_)
            | ChartAuthority::CareRelationship { .. }
            | ChartAuthority::WardAssignment { .. }
    )
}

fn offline_access_log(
    caller: &crate::User,
    patient_id: &str,
    authority: &ChartAuthority,
    http_req: &HttpRequest,
) -> AccessLogEntity {
    AccessLogEntity {
        id: uuid::Uuid::new_v4().to_string(),
        accessor_id: caller.id.clone(),
        accessor_role: caller.role.to_string(),
        patient_id: Some(patient_id.to_string()),
        resource_type: "offline_summary".to_string(),
        resource_id: Some("/api/clinician/offline-bundle".to_string()),
        action: "Export".to_string(),
        access_reason: Some(OFFLINE_REASON.to_string()),
        is_emergency_access: false,
        ip_address: http_req.peer_addr().map(|addr| addr.ip().to_string()),
        user_agent: http_req
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

/// The minimised summary a device keeps for one patient.
fn offline_summary(profile: &PatientProfile, listed_for: Vec<ListedFor>) -> serde_json::Value {
    let e = &profile.emergency_info;
    serde_json::json!({
        "patient_id": profile.patient_id,
        "full_name": profile.full_name,
        "date_of_birth": profile.date_of_birth,
        "gender": profile.gender,
        "blood_type": e.blood_type,
        "allergies": e.allergies,
        "current_medications": e.current_medications,
        "chronic_conditions": e.chronic_conditions,
        "emergency_contacts": e.emergency_contacts,
        "dnr_status": e.dnr_status,
        "languages": e.languages,
        "last_updated": profile.last_updated,
        "listed_for": listed_for,
    })
}

/// What happened to one patient on the caller's list.
enum Included {
    Yes(serde_json::Value),
    /// No authority to carry this chart offline (or the check was unavailable).
    NotPermitted,
    /// The record could not be read or the download could not be recorded.
    Withheld,
}

async fn include_patient(
    data: &web::Data<AppState>,
    caller: &crate::User,
    http_req: &HttpRequest,
    patient_id: &str,
    listed_for: Vec<ListedFor>,
) -> Included {
    let authority = match crate::care_access::resolve_chart_access(data, caller, patient_id).await {
        Ok(authority) if is_treating_authority(&authority) => authority,
        _ => return Included::NotPermitted,
    };
    let Some(profile) = data
        .repositories
        .patients
        .get_by_id(patient_id)
        .await
        .ok()
        .filter(|entity| entity.is_active)
        .and_then(|entity| patient_entity_to_profile(&entity, &data.encryption_keyring))
    else {
        return Included::Withheld;
    };
    let entry = offline_access_log(caller, patient_id, &authority, http_req);
    if require_durable_audit(data, entry).await.is_err() {
        return Included::Withheld;
    }
    Included::Yes(offline_summary(&profile, listed_for))
}

/// GET /api/clinician/offline-bundle — the caller's day, for offline use.
#[get("/api/clinician/offline-bundle")]
pub async fn clinician_offline_bundle(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let caller = match require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(resp) => return resp,
    };
    let generated_at = Utc::now();
    let mut patients = Vec::new();
    let mut withheld = 0usize;
    let mut not_permitted = 0usize;
    for (patient_id, listed_for) in day_list(&data, &caller).await {
        match include_patient(&data, &caller, &http_req, &patient_id, listed_for).await {
            Included::Yes(summary) => patients.push(summary),
            Included::NotPermitted => not_permitted += 1,
            Included::Withheld => withheld += 1,
        }
    }
    HttpResponse::Ok().json(serde_json::json!({
        "generated_at": generated_at,
        "expires_at": generated_at + Duration::hours(OFFLINE_HOURS),
        "patients": patients,
        "withheld": withheld,
        "not_permitted": not_permitted,
    }))
}

#[cfg(test)]
mod api_tests {
    //! The day leaves the server only for its clinician, only the patients
    //! that clinician treats, and never without a row the patient can see.
    use crate::repositories::traits::Pagination;
    use crate::{test_fixtures, AppState, Role};
    use actix_web::{test, web, App};
    use chrono::Utc;
    use serde_json::Value;

    const DOCTOR: &str = "offline-doctor";
    const STRANGER: &str = "offline-stranger";
    const PATIENT_USER: &str = "offline-patient-user";
    const PATIENT: &str = "PAT-OFFLINE-1";
    const OTHER: &str = "PAT-OFFLINE-2";

    macro_rules! bundle_for {
        ($app:expr, $user:expr) => {{
            let req = test::TestRequest::get()
                .uri("/api/clinician/offline-bundle")
                .insert_header(test_fixtures::as_user($user))
                .to_request();
            let resp = test::call_service(&$app, req).await;
            let status = resp.status().as_u16();
            let body: Value = test::read_body_json(resp).await;
            (status, body)
        }};
    }

    #[actix_web::test]
    async fn the_day_holds_only_treated_patients_and_each_download_is_logged() {
        let state = AppState::new();
        test_fixtures::register(&state, DOCTOR, Role::Doctor);
        test_fixtures::register(&state, STRANGER, Role::Doctor);
        test_fixtures::register(&state, PATIENT_USER, Role::Patient);
        test_fixtures::seed_patient(&state, PATIENT).await;
        test_fixtures::seed_patient(&state, OTHER).await;
        crate::care_access::record_encounter(&state, PATIENT, DOCTOR, "APT-OFF-1", Utc::now())
            .await;
        let data = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(data.clone())
                .service(super::clinician_offline_bundle),
        )
        .await;

        let (status, body) = bundle_for!(app, DOCTOR);
        assert_eq!(status, 200, "{body}");
        let patients = body["patients"].as_array().expect("patients");
        assert_eq!(patients.len(), 1, "only the treated patient: {body}");
        assert_eq!(patients[0]["patient_id"], PATIENT);
        assert_eq!(patients[0]["listed_for"][0]["kind"], "care");
        assert!(body["expires_at"].is_string());
        // Minimised: nothing a clinician does not need offline.
        assert!(patients[0].get("national_id").is_none());
        assert!(patients[0].get("address").is_none());

        let logs = data
            .repositories
            .access_logs
            .get_by_patient(PATIENT, Pagination::new(0, 50))
            .await
            .expect("logs");
        let download = logs
            .items
            .iter()
            .find(|row| row.resource_type == "offline_summary")
            .expect("the download is on the patient's access history");
        assert_eq!(download.accessor_id, DOCTOR);
        assert_eq!(download.action, "Export");
        assert_eq!(
            download.authority_type.as_deref(),
            Some("care_relationship")
        );

        let (_, empty) = bundle_for!(app, STRANGER);
        assert_eq!(
            empty["patients"].as_array().map(Vec::len),
            Some(0),
            "{empty}"
        );

        let (status, _) = bundle_for!(app, PATIENT_USER);
        assert_eq!(
            status, 403,
            "a patient account cannot download a clinician's day"
        );
    }
}
