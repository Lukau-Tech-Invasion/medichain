//! `/api/nursing/*` — the doctor-portal Nursing dashboard and Care Plan pages.
//!
//! These are thin read-aliases over the repository-backed MAR / intake-output /
//! nursing-care-plan stores already exposed under `/api/emergency/*`. The pages
//! (`NursingPage.tsx`, `CarePlanPage.tsx`) expect `{records: [...]}` /
//! `{plans: [...]}` envelopes, which is the only reason these exist separately
//! from the `/list` routes (which return bare arrays). The two write shortcuts
//! mirror the existing `/api/emergency/{administer-med,record-fluid}` behavior;
//! their persistence limitation is tracked in the technical-debt register.

use super::*;

/// The nursing dashboard is provider-facing; require an authenticated caller.
fn require_provider(data: &web::Data<AppState>, req: &HttpRequest) -> Result<(), HttpResponse> {
    let user_id = match get_current_user_id(req) {
        Some(id) => id,
        None => return Err(HttpResponse::Unauthorized().finish()),
    };
    match get_user(data, &user_id) {
        Some(user) if user.role.is_healthcare_provider() || user.role.is_admin() => Ok(()),
        Some(_) => Err(HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Nursing records are restricted to clinical staff".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        })),
        None => Err(HttpResponse::Unauthorized().finish()),
    }
}

/// Medication Administration Records for the ward.
#[get("/api/nursing/mar")]
pub async fn nursing_list_mar(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    if let Err(resp) = require_provider(&data, &req) {
        return resp;
    }
    match data
        .repositories
        .medication_records
        .list_all(Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(serde_json::json!({ "records": result.items })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Intake / output records for the ward.
#[get("/api/nursing/intake-output")]
pub async fn nursing_list_intake_output(
    data: web::Data<AppState>,
    req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = require_provider(&data, &req) {
        return resp;
    }
    match data
        .repositories
        .io_records
        .list_all(Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(serde_json::json!({ "records": result.items })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Nursing care plans for the ward.
#[get("/api/nursing/care-plans")]
pub async fn nursing_list_care_plans(
    data: web::Data<AppState>,
    req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = require_provider(&data, &req) {
        return resp;
    }
    match data
        .repositories
        .nursing_care_plans
        .list_all(Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(serde_json::json!({ "plans": result.items })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Extract a required, non-empty `patient_id` from the request body.
fn required_patient_id(body: &serde_json::Value) -> Result<String, HttpResponse> {
    match body.get("patient_id").and_then(|v| v.as_str()) {
        Some(p) if !p.trim().is_empty() => Ok(p.to_string()),
        _ => Err(HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id is required".to_string(),
            code: "MISSING_PATIENT_ID".to_string(),
        })),
    }
}

/// Mark a scheduled/PRN dose administered, appending it to the patient's MAR.
///
/// Shares one writer with `/api/emergency/administer-med` so the two cannot
/// diverge — both previously returned success without persisting anything.
#[post("/api/nursing/mar/administer")]
pub async fn nursing_administer_medication(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    if let Err(resp) = require_provider(&data, &req) {
        return resp;
    }
    let current_user_id = match get_current_user_id(&req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };
    let body = body.into_inner();
    let patient_id = match required_patient_id(&body) {
        Ok(p) => p,
        Err(resp) => return resp,
    };
    // Keep everything the eMAR form captures. The five-rights verification, the
    // witnessing nurse and whether the dose was actually given (versus held or
    // refused) are the clinically and legally meaningful parts of a medication
    // record; the previous version recorded only drug/dose/route and discarded
    // the rest, so a held dose was indistinguishable from a given one.
    let text = |key: &str| body.get(key).and_then(|v| v.as_str());
    let flag = |key: &str| body.get(key).and_then(|v| v.as_bool()).unwrap_or(false);
    let administration = serde_json::json!({
        "administration_id": format!("ADM-{}", Uuid::new_v4()),
        "medication_id": text("medication_id"),
        "medication_name": body.get("medication_name").or_else(|| body.get("medication")).and_then(|v| v.as_str()),
        "dose": text("dose"),
        "route": text("route"),
        "notes": text("notes"),
        "status": text("status").unwrap_or("given"),
        "scheduled_time": text("scheduled_time"),
        "actual_time": text("actual_time"),
        "reason_not_given": text("reason_not_given"),
        "site": text("site"),
        "witnessed_by": text("witnessed_by"),
        "patient_response": text("patient_response"),
        "barcode_scanned": flag("barcode_scanned"),
        "five_rights_verified": flag("five_rights_verified"),
        "administered_by": current_user_id,
        "administered_at": Utc::now().to_rfc3339(),
    });

    match crate::clinical_endpoints::append_mar_administration(
        &data,
        &patient_id,
        &current_user_id,
        administration,
    )
    .await
    {
        Ok(record_id) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "record_id": record_id,
            "message": "Medication administration recorded"
        })),
        Err(e) => {
            log::error!("MAR administration failed for {}: {}", patient_id, e);
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Could not record the administration".to_string(),
                code: "MAR_WRITE_FAILED".to_string(),
            })
        }
    }
}

/// Record a fluid intake/output entry against today's shift record.
///
/// Shares one writer with `/api/emergency/record-fluid`.
#[post("/api/nursing/intake-output/record")]
pub async fn nursing_record_fluid(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    if let Err(resp) = require_provider(&data, &req) {
        return resp;
    }
    let current_user_id = match get_current_user_id(&req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };
    let body = body.into_inner();
    let patient_id = match required_patient_id(&body) {
        Ok(p) => p,
        Err(resp) => return resp,
    };
    let amount_ml = match body
        .get("amount_ml")
        .or_else(|| body.get("amount"))
        .and_then(|v| v.as_i64())
    {
        Some(a) if a >= 0 => a as i32,
        _ => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "amount_ml is required and must be a non-negative number".to_string(),
                code: "INVALID_AMOUNT".to_string(),
            })
        }
    };
    let category = body
        .get("category")
        .or_else(|| body.get("type"))
        .and_then(|v| v.as_str())
        .unwrap_or("other")
        .to_string();
    let shift = body
        .get("shift")
        .and_then(|v| v.as_str())
        .unwrap_or("day")
        .to_string();

    match crate::clinical_endpoints::append_io_event(
        &data,
        &patient_id,
        &shift,
        &current_user_id,
        &category,
        amount_ml,
    )
    .await
    {
        Ok(record_id) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "record_id": record_id,
            "message": "Fluid intake/output recorded"
        })),
        Err(e) => {
            log::error!("I/O write failed for {}: {}", patient_id, e);
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Could not record the fluid event".to_string(),
                code: "IO_WRITE_FAILED".to_string(),
            })
        }
    }
}
