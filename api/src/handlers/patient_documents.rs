//! Patient-scoped listings for documents written *about* a patient.
//!
//! The patient portal could list lab results, IPFS-backed records, SOAP notes,
//! prescriptions and triage assessments, but nothing else — so a History &
//! Physical, a progress note, a wound assessment or a vital-signs reading was
//! created about the patient and then unreachable by them. The existing
//! listings for those kinds are ward-wide (`/api/clinical/hp`,
//! `/api/platform/list/progress-notes`, `/api/emergency/wound/list`) and are
//! restricted to clinical staff, which is correct: a patient must not be able
//! to enumerate other people's records to reach their own.
//!
//! Each endpoint here returns one patient's documents and authorises the caller
//! against that patient, so a patient may read their own and a provider may
//! read any.

use super::*;

/// A patient may read their own documents; any provider may read a patient's.
fn may_read(
    data: &web::Data<AppState>,
    caller: &crate::types::User,
    caller_id: &str,
    patient_id: &str,
) -> bool {
    caller.role.can_view_medical_records()
        || crate::support::caller_owns_patient_record(data, caller_id, patient_id)
}

/// Resolve and authorise the caller, or return the response to send instead.
fn authorize(
    data: &web::Data<AppState>,
    http_req: &HttpRequest,
    patient_id: &str,
) -> Result<(), HttpResponse> {
    let caller_id = get_current_user_id(http_req).ok_or_else(|| {
        HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Missing X-User-Id header".to_string(),
            code: "UNAUTHORIZED".to_string(),
        })
    })?;
    let caller = get_user(data, &caller_id).ok_or_else(|| {
        HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "User not found".to_string(),
            code: "USER_NOT_FOUND".to_string(),
        })
    })?;
    if !may_read(data, &caller, &caller_id, patient_id) {
        return Err(HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "You can only read your own records".to_string(),
            code: "ACCESS_DENIED".to_string(),
        }));
    }
    Ok(())
}

/// How many of each kind to return. Bounded per the project's rule against
/// unbounded reads; a patient's record list is paged in the UI anyway.
const PAGE: u32 = 100;

/// Every History & Physical recorded for one patient.
#[get("/api/clinical/patient/{patient_id}/history-physicals")]
pub async fn list_patient_history_physicals(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    let items = data
        .repositories
        .history_physicals
        .get_by_patient(&patient_id, Pagination::new(0, PAGE))
        .await
        .map(|r| r.items)
        .unwrap_or_default();
    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "history_physicals": items,
    }))
}

/// Every progress note recorded for one patient.
#[get("/api/clinical/patient/{patient_id}/progress-notes")]
pub async fn list_patient_progress_notes(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    let items = data
        .repositories
        .progress_notes
        .get_by_patient(&patient_id, Pagination::new(0, PAGE))
        .await
        .map(|r| r.items)
        .unwrap_or_default();
    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "progress_notes": items,
    }))
}

/// Every wound assessment recorded for one patient.
#[get("/api/clinical/patient/{patient_id}/wounds")]
pub async fn list_patient_wounds(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = authorize(&data, &http_req, &patient_id) {
        return resp;
    }
    let items = data
        .repositories
        .wound_assessments
        .get_by_patient(&patient_id, Pagination::new(0, PAGE))
        .await
        .map(|r| r.items)
        .unwrap_or_default();
    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "wounds": items,
    }))
}
