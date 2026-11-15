//! Wards, the shift roster, and admissions (UX plan Phase 5, owner decision D1).
//!
//! * An administrator creates wards and rosters clinicians on them, one shift
//!   at a time. Rostering is what grants a nurse the charts on a ward, so it is
//!   ADR-0008 Class C: an exact, single-use confirmation of that change.
//! * A doctor or nurse who may already open a patient's chart admits them to a
//!   ward and discharges them. Discharge ends ward-based access at once.
//! * "My ward" is the nurse's list: patients admitted to the wards they are
//!   rostered on right now. An unassigned nurse sees an empty, explained list,
//!   never the first rows of the patients table.
//! * The patient reads their own admissions through the patient-scoped route
//!   in `patient_documents.rs` (rule 10).

use super::*;
use crate::repositories::traits::{AccessLogEntity, RepositoryError};
use crate::repositories::wards::{
    AdmissionEntity, ShiftAssignmentEntity, WardEntity, MAX_SHIFT_HOURS, WARD_KINDS,
};
use chrono::{DateTime, Duration};

const MAX_NAME: usize = 120;
const MAX_BED: usize = 40;

fn refuse(status: actix_web::http::StatusCode, message: &str, code: &str) -> HttpResponse {
    HttpResponse::build(status).json(ErrorResponse {
        error: message.to_string(),
        code: code.to_string(),
    })
}

fn bad(message: &str) -> HttpResponse {
    refuse(
        actix_web::http::StatusCode::BAD_REQUEST,
        message,
        "VALIDATION_ERROR",
    )
}

fn unavailable(what: &str, error: impl std::fmt::Display) -> HttpResponse {
    log::error!("wards: {what}: {error}");
    refuse(
        actix_web::http::StatusCode::SERVICE_UNAVAILABLE,
        "The ward record could not be reached; nothing was changed",
        "DATABASE_ERROR",
    )
}

fn audit(
    caller: &crate::User,
    action: &str,
    patient_id: &str,
    resource: &str,
    id: &str,
) -> AccessLogEntity {
    AccessLogEntity {
        id: uuid::Uuid::new_v4().to_string(),
        accessor_id: caller.id.clone(),
        accessor_role: caller.role.to_string(),
        patient_id: Some(patient_id.to_string()),
        resource_type: resource.to_string(),
        resource_id: Some(id.to_string()),
        action: action.to_string(),
        access_reason: Some("ward care".to_string()),
        is_emergency_access: false,
        ip_address: None,
        user_agent: None,
        accessed_at: Utc::now(),
        facility_id: None,
        authority_type: None,
        authority_id: None,
    }
}

/// An active account (the auth cache holds active accounts only, which is the
/// point: a deactivated nurse cannot be rostered).
fn active_user(data: &AppState, id: &str) -> Option<crate::User> {
    data.users.read().ok()?.get(id).cloned()
}

fn is_ward_clinician(role: &crate::Role) -> bool {
    matches!(role, crate::Role::Doctor | crate::Role::Nurse)
}

// ---------------------------------------------------------------- wards ----

#[derive(Debug, Deserialize)]
pub struct CreateWardRequest {
    pub name: String,
    pub kind: String,
    /// Defaults to the administrator's own facility.
    pub facility_id: Option<String>,
}

/// POST /api/wards — Admin, Class C.
#[post("/api/wards")]
pub async fn create_ward(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<CreateWardRequest>,
) -> impl Responder {
    let caller = match require_administrator(&data, &req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return bad("A ward needs a name of at most 120 characters");
    }
    if !WARD_KINDS.contains(&body.kind.as_str()) {
        return bad("Unknown ward kind");
    }
    let Some(facility_id) = body
        .facility_id
        .clone()
        .or_else(|| data.identity_contexts.facility_id_for_user(&caller.id))
    else {
        return bad("Name the facility this ward belongs to");
    };
    let id = format!("WARD-{}", uuid::Uuid::new_v4());
    if let Err(response) = crate::handlers::transaction_auth::require_exact_authorization(
        &data,
        &req,
        "ward.create",
        &facility_id,
        "absent",
    )
    .await
    {
        return response;
    }
    let ward = WardEntity {
        id,
        facility_id,
        name: name.to_string(),
        kind: body.kind.clone(),
        created_by: caller.id.clone(),
        created_at: Utc::now(),
        retired_at: None,
    };
    match data.repositories.wards.create_ward(ward).await {
        Ok(ward) => HttpResponse::Created().json(serde_json::json!({ "ward": ward })),
        Err(RepositoryError::Duplicate(_)) => refuse(
            actix_web::http::StatusCode::CONFLICT,
            "This facility already has a ward of that name",
            "WARD_EXISTS",
        ),
        Err(error) => unavailable("create ward", error),
    }
}

#[derive(Debug, Deserialize)]
pub struct ListWardsQuery {
    pub facility_id: Option<String>,
}

/// GET /api/wards — staff; defaults to the caller's facility.
#[get("/api/wards")]
pub async fn list_wards(
    data: web::Data<AppState>,
    req: HttpRequest,
    query: web::Query<ListWardsQuery>,
) -> impl Responder {
    let caller = match require_clinical_staff_or_admin(&data, &req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let facility = query
        .facility_id
        .clone()
        .or_else(|| data.identity_contexts.facility_id_for_user(&caller.id));
    match data
        .repositories
        .wards
        .list_wards(facility.as_deref())
        .await
    {
        Ok(wards) => {
            HttpResponse::Ok().json(serde_json::json!({ "facility_id": facility, "wards": wards }))
        }
        Err(error) => unavailable("list wards", error),
    }
}

fn require_clinical_staff_or_admin(
    data: &web::Data<AppState>,
    req: &HttpRequest,
) -> Result<crate::User, HttpResponse> {
    match require_administrator(data, req) {
        Ok(user) => Ok(user),
        Err(_) => require_clinical_staff(data, req),
    }
}

// --------------------------------------------------------------- roster ----

#[derive(Debug, Deserialize)]
pub struct AssignShiftRequest {
    pub clinician_id: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
}

/// POST /api/wards/{ward_id}/shifts — Admin, Class C: rostering grants charts.
#[post("/api/wards/{ward_id}/shifts")]
pub async fn assign_ward_shift(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<AssignShiftRequest>,
) -> impl Responder {
    let caller = match require_administrator(&data, &req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let ward_id = path.into_inner();
    if body.ends_at <= body.starts_at
        || body.ends_at - body.starts_at > Duration::hours(MAX_SHIFT_HOURS)
    {
        return bad("A shift ends after it starts and lasts at most 24 hours");
    }
    match data.repositories.wards.get_ward(&ward_id).await {
        Ok(Some(ward)) if ward.retired_at.is_none() => {}
        Ok(_) => {
            return refuse(
                actix_web::http::StatusCode::NOT_FOUND,
                "Ward not found",
                "WARD_NOT_FOUND",
            )
        }
        Err(error) => return unavailable("load ward", error),
    }
    let clinician = active_user(&data, &body.clinician_id);
    if !clinician
        .as_ref()
        .is_some_and(|u| is_ward_clinician(&u.role))
    {
        return bad("Only a doctor or nurse can be rostered on a ward");
    }
    if let Err(response) = crate::handlers::transaction_auth::require_exact_authorization(
        &data,
        &req,
        "ward_shift.assign",
        &ward_id,
        &body.clinician_id,
    )
    .await
    {
        return response;
    }
    let shift = ShiftAssignmentEntity {
        id: format!("SHIFT-{}", uuid::Uuid::new_v4()),
        ward_id,
        clinician_id: body.clinician_id.clone(),
        starts_at: body.starts_at,
        ends_at: body.ends_at,
        assigned_by: caller.id.clone(),
        created_at: Utc::now(),
        cancelled_at: None,
        cancelled_by: None,
    };
    match data.repositories.wards.assign_shift(shift).await {
        Ok(shift) => HttpResponse::Created().json(serde_json::json!({ "shift": shift })),
        Err(RepositoryError::Validation(message)) => bad(&message),
        Err(error) => unavailable("assign shift", error),
    }
}

/// POST /api/wards/shifts/{shift_id}/cancel — Admin, Class C.
#[post("/api/wards/shifts/{shift_id}/cancel")]
pub async fn cancel_ward_shift(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let caller = match require_administrator(&data, &req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let shift_id = path.into_inner();
    match data.repositories.wards.get_shift(&shift_id).await {
        Ok(Some(shift)) if shift.cancelled_at.is_none() => {}
        Ok(Some(_)) => {
            return refuse(
                actix_web::http::StatusCode::CONFLICT,
                "This shift is already cancelled",
                "ALREADY_CANCELLED",
            )
        }
        Ok(None) => {
            return refuse(
                actix_web::http::StatusCode::NOT_FOUND,
                "Shift not found",
                "SHIFT_NOT_FOUND",
            )
        }
        Err(error) => return unavailable("load shift", error),
    }
    if let Err(response) = crate::handlers::transaction_auth::require_exact_authorization(
        &data,
        &req,
        "ward_shift.cancel",
        &shift_id,
        "active",
    )
    .await
    {
        return response;
    }
    match data
        .repositories
        .wards
        .cancel_shift(&shift_id, &caller.id, Utc::now())
        .await
    {
        Ok(Some(shift)) => HttpResponse::Ok().json(serde_json::json!({ "shift": shift })),
        Ok(None) => refuse(
            actix_web::http::StatusCode::CONFLICT,
            "This shift is already cancelled",
            "ALREADY_CANCELLED",
        ),
        Err(error) => unavailable("cancel shift", error),
    }
}

#[derive(Debug, Deserialize)]
pub struct ShiftWindowQuery {
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
}

/// GET /api/wards/{ward_id}/shifts — the roster, default the next 7 days.
#[get("/api/wards/{ward_id}/shifts")]
pub async fn list_ward_shifts(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<ShiftWindowQuery>,
) -> impl Responder {
    if let Err(response) = require_clinical_staff_or_admin(&data, &req) {
        return response;
    }
    let from = query
        .from
        .unwrap_or_else(|| Utc::now() - Duration::hours(MAX_SHIFT_HOURS));
    let to = query
        .to
        .unwrap_or_else(|| from + Duration::days(8))
        .min(from + Duration::days(31));
    match data
        .repositories
        .wards
        .shifts_on_ward(&path.into_inner(), from, to)
        .await
    {
        Ok(shifts) => {
            let named: Vec<serde_json::Value> = shifts
                .into_iter()
                .map(|s| {
                    let name = active_user(&data, &s.clinician_id).map(|u| u.name);
                    serde_json::json!({ "shift": s, "clinician_name": name })
                })
                .collect();
            HttpResponse::Ok().json(serde_json::json!({ "shifts": named }))
        }
        Err(error) => unavailable("list shifts", error),
    }
}

// ----------------------------------------------------------- admissions ----

#[derive(Debug, Deserialize)]
pub struct AdmitRequest {
    pub patient_id: String,
    pub ward_id: String,
    pub bed_label: Option<String>,
}

/// POST /api/admissions — a doctor or nurse who may already open this chart.
#[post("/api/admissions")]
pub async fn admit_patient(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<AdmitRequest>,
) -> impl Responder {
    let caller = match require_clinical_staff(&data, &req) {
        Ok(user) if is_ward_clinician(&user.role) => user,
        Ok(_) => {
            return refuse(
                actix_web::http::StatusCode::FORBIDDEN,
                "Only a doctor or nurse can admit a patient",
                "INSUFFICIENT_ROLE",
            )
        }
        Err(response) => return response,
    };
    let bed = body
        .bed_label
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty());
    if bed.is_some_and(|b| b.chars().count() > MAX_BED) {
        return bad("A bed label is at most 40 characters");
    }
    match crate::care_access::treats_patient(&data, &caller, &body.patient_id).await {
        Ok(true) => {}
        Ok(false) => {
            return refuse(
                actix_web::http::StatusCode::FORBIDDEN,
                "You do not have access to this patient's chart",
                "NO_CHART_ACCESS",
            )
        }
        Err(error) => return unavailable("check chart access", error.0),
    }
    let admission = AdmissionEntity {
        id: format!("ADM-{}", uuid::Uuid::new_v4()),
        patient_id: body.patient_id.clone(),
        ward_id: body.ward_id.clone(),
        bed_label: bed.map(str::to_string),
        admitted_at: Utc::now(),
        admitted_by: caller.id.clone(),
        discharged_at: None,
        discharged_by: None,
    };
    if let Err(response) = require_durable_audit(
        &data,
        audit(
            &caller,
            "create",
            &admission.patient_id,
            "admission",
            &admission.id,
        ),
    )
    .await
    {
        return response;
    }
    match data.repositories.wards.admit(admission).await {
        Ok(admission) => {
            HttpResponse::Created().json(serde_json::json!({ "admission": admission }))
        }
        Err(RepositoryError::Duplicate(_)) => refuse(
            actix_web::http::StatusCode::CONFLICT,
            "The patient is already admitted; discharge or transfer them first",
            "ALREADY_ADMITTED",
        ),
        Err(RepositoryError::NotFound(_)) => refuse(
            actix_web::http::StatusCode::NOT_FOUND,
            "Ward not found",
            "WARD_NOT_FOUND",
        ),
        Err(error) => unavailable("admit", error),
    }
}

/// POST /api/admissions/{admission_id}/discharge
#[post("/api/admissions/{admission_id}/discharge")]
pub async fn discharge_admission(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let caller = match require_clinical_staff(&data, &req) {
        Ok(user) if is_ward_clinician(&user.role) => user,
        Ok(_) => {
            return refuse(
                actix_web::http::StatusCode::FORBIDDEN,
                "Only a doctor or nurse can discharge a patient",
                "INSUFFICIENT_ROLE",
            )
        }
        Err(response) => return response,
    };
    let id = path.into_inner();
    let admission = match data.repositories.wards.get_admission(&id).await {
        Ok(Some(a)) => a,
        Ok(None) => {
            return refuse(
                actix_web::http::StatusCode::NOT_FOUND,
                "Admission not found",
                "ADMISSION_NOT_FOUND",
            )
        }
        Err(error) => return unavailable("load admission", error),
    };
    match crate::care_access::treats_patient(&data, &caller, &admission.patient_id).await {
        Ok(true) => {}
        Ok(false) => {
            return refuse(
                actix_web::http::StatusCode::FORBIDDEN,
                "You do not have access to this patient's chart",
                "NO_CHART_ACCESS",
            )
        }
        Err(error) => return unavailable("check chart access", error.0),
    }
    if let Err(response) = require_durable_audit(
        &data,
        audit(&caller, "Update", &admission.patient_id, "admission", &id),
    )
    .await
    {
        return response;
    }
    match data
        .repositories
        .wards
        .discharge(&id, &caller.id, Utc::now())
        .await
    {
        Ok(Some(a)) => HttpResponse::Ok().json(serde_json::json!({ "admission": a })),
        Ok(None) => refuse(
            actix_web::http::StatusCode::CONFLICT,
            "This admission is already discharged",
            "ALREADY_DISCHARGED",
        ),
        Err(error) => unavailable("discharge", error),
    }
}

/// GET /api/nursing/my-ward — patients on the wards the caller is rostered on now.
#[get("/api/nursing/my-ward")]
pub async fn my_ward(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    let caller = match require_clinical_staff(&data, &req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let shifts = match data
        .repositories
        .wards
        .current_shifts_of(&caller.id, Utc::now())
        .await
    {
        Ok(shifts) => shifts,
        Err(error) => return unavailable("load shifts", error),
    };
    let ward_ids: Vec<String> = shifts.iter().map(|s| s.ward_id.clone()).collect();
    let mut wards = Vec::new();
    for id in &ward_ids {
        if let Ok(Some(ward)) = data.repositories.wards.get_ward(id).await {
            wards.push(ward);
        }
    }
    let admissions = if ward_ids.is_empty() {
        Vec::new()
    } else {
        match data.repositories.wards.open_admissions_on(&ward_ids).await {
            Ok(list) => list,
            Err(error) => return unavailable("load admissions", error),
        }
    };
    let mut patients = Vec::with_capacity(admissions.len());
    for admission in admissions {
        if let Err(response) = require_durable_audit(
            &data,
            audit(
                &caller,
                "view",
                &admission.patient_id,
                "admission",
                &admission.id,
            ),
        )
        .await
        {
            return response;
        }
        let profile = data
            .repositories
            .patients
            .get_by_id(&admission.patient_id)
            .await
            .ok()
            .and_then(|e| patient_entity_to_profile(&e, &data.encryption_keyring));
        patients.push(serde_json::json!({
            "admission": admission,
            "full_name": profile.as_ref().map(|p| p.full_name.clone()),
            "date_of_birth": profile.as_ref().map(|p| p.date_of_birth.clone()),
            "content_available": profile.is_some(),
        }));
    }
    HttpResponse::Ok()
        .json(serde_json::json!({ "shifts": shifts, "wards": wards, "patients": patients }))
}

#[cfg(test)]
mod api_tests {
    //! Rostering grants charts, discharge takes them away, and an unassigned
    //! nurse's list is empty rather than somebody else's patients.
    use crate::{test_fixtures, AppState, Role};
    use actix_web::{test, web, App};
    use chrono::{Duration, Utc};
    use serde_json::{json, Value};

    const ADMIN: &str = "ward-admin";
    const DOCTOR: &str = "ward-doctor";
    const NURSE: &str = "ward-nurse";
    const IDLE_NURSE: &str = "ward-idle-nurse";
    const PATIENT: &str = "PAT-WARD-1";

    macro_rules! call {
        ($app:expr, $user:expr, $method:expr, $uri:expr, $body:expr) => {{
            let req = match $method {
                "GET" => test::TestRequest::get(),
                _ => test::TestRequest::post().set_json(&$body),
            }
            .uri($uri)
            .insert_header(test_fixtures::as_user($user))
            .to_request();
            let resp = test::call_service(&$app, req).await;
            let status = resp.status().as_u16();
            let body: Value = test::read_body_json(resp).await;
            (status, body)
        }};
    }

    #[actix_web::test]
    async fn a_rostered_nurse_reads_the_ward_and_discharge_ends_it() {
        let state = AppState::new();
        test_fixtures::register(&state, ADMIN, Role::Admin);
        test_fixtures::register(&state, DOCTOR, Role::Doctor);
        test_fixtures::register(&state, NURSE, Role::Nurse);
        test_fixtures::register(&state, IDLE_NURSE, Role::Nurse);
        test_fixtures::seed_patient(&state, PATIENT).await;
        crate::care_access::record_encounter(&state, PATIENT, DOCTOR, "APT-W1", Utc::now()).await;
        let data = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(data.clone())
                .service(super::create_ward)
                .service(super::assign_ward_shift)
                .service(super::admit_patient)
                .service(super::discharge_admission)
                .service(super::my_ward),
        )
        .await;

        let (status, ward) = call!(
            app,
            ADMIN,
            "POST",
            "/api/wards",
            json!({ "name": "Ward 4", "kind": "general", "facility_id": "fac-1" })
        );
        assert_eq!(status, 201, "{ward}");
        let ward_id = ward["ward"]["id"].as_str().unwrap().to_string();

        let (status, _) = call!(app, NURSE, "GET", "/api/nursing/my-ward", json!({}));
        assert_eq!(status, 200);
        assert!(!crate::care_access::treats_patient(
            &data,
            &super::active_user(&data, NURSE).unwrap(),
            PATIENT
        )
        .await
        .unwrap());

        let now = Utc::now();
        let shift = json!({ "clinician_id": NURSE, "starts_at": now - Duration::hours(1), "ends_at": now + Duration::hours(7) });
        let (status, body) = call!(
            app,
            ADMIN,
            "POST",
            &format!("/api/wards/{ward_id}/shifts"),
            shift
        );
        assert_eq!(status, 201, "{body}");

        let (status, admitted) = call!(
            app,
            DOCTOR,
            "POST",
            "/api/admissions",
            json!({ "patient_id": PATIENT, "ward_id": ward_id, "bed_label": "B4" })
        );
        assert_eq!(status, 201, "{admitted}");
        let admission_id = admitted["admission"]["id"].as_str().unwrap().to_string();

        let (_, list) = call!(app, NURSE, "GET", "/api/nursing/my-ward", json!({}));
        assert_eq!(list["patients"][0]["admission"]["patient_id"], PATIENT);
        assert!(crate::care_access::treats_patient(
            &data,
            &super::active_user(&data, NURSE).unwrap(),
            PATIENT
        )
        .await
        .unwrap());

        let (_, idle) = call!(app, IDLE_NURSE, "GET", "/api/nursing/my-ward", json!({}));
        assert_eq!(
            idle["patients"],
            json!([]),
            "an unassigned nurse sees nobody"
        );

        let (status, _) = call!(
            app,
            DOCTOR,
            "POST",
            "/api/admissions",
            json!({ "patient_id": PATIENT, "ward_id": ward_id })
        );
        assert_eq!(status, 409, "one open admission per patient");

        let (status, _) = call!(
            app,
            NURSE,
            "POST",
            &format!("/api/admissions/{admission_id}/discharge"),
            json!({})
        );
        assert_eq!(status, 200);
        assert!(
            !crate::care_access::treats_patient(
                &data,
                &super::active_user(&data, NURSE).unwrap(),
                PATIENT
            )
            .await
            .unwrap(),
            "discharge ends ward access"
        );
    }

    #[actix_web::test]
    async fn only_an_administrator_rosters_and_only_clinicians_are_rostered() {
        let state = AppState::new();
        test_fixtures::register(&state, ADMIN, Role::Admin);
        test_fixtures::register(&state, NURSE, Role::Nurse);
        test_fixtures::register(&state, "ward-lab", Role::LabTechnician);
        let data = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(data.clone())
                .service(super::create_ward)
                .service(super::assign_ward_shift),
        )
        .await;
        let (_, ward) = call!(
            app,
            ADMIN,
            "POST",
            "/api/wards",
            json!({ "name": "ED", "kind": "emergency", "facility_id": "fac-1" })
        );
        let ward_id = ward["ward"]["id"].as_str().unwrap().to_string();
        let now = Utc::now();

        let (status, _) = call!(
            app,
            NURSE,
            "POST",
            &format!("/api/wards/{ward_id}/shifts"),
            json!({ "clinician_id": NURSE, "starts_at": now, "ends_at": now + Duration::hours(8) })
        );
        assert_eq!(status, 403, "a nurse cannot roster herself");
        let (status, _) = call!(
            app,
            ADMIN,
            "POST",
            &format!("/api/wards/{ward_id}/shifts"),
            json!({ "clinician_id": "ward-lab", "starts_at": now, "ends_at": now + Duration::hours(8) })
        );
        assert_eq!(status, 400);
        let (status, _) = call!(
            app,
            ADMIN,
            "POST",
            &format!("/api/wards/{ward_id}/shifts"),
            json!({ "clinician_id": NURSE, "starts_at": now, "ends_at": now + Duration::hours(30) })
        );
        assert_eq!(status, 400, "a shift is at most 24 hours");
        let (status, _) = call!(
            app,
            ADMIN,
            "POST",
            "/api/wards",
            json!({ "name": "ed", "kind": "emergency", "facility_id": "fac-1" })
        );
        assert_eq!(
            status, 409,
            "ward names are unique per facility, ignoring case"
        );
    }
}
