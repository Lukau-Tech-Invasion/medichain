//! CDS administration (Phase 4.3): per-facility threshold config + audit trail.
//!
//! - `GET  /api/admin/cds/thresholds/{facility_id}` — effective thresholds for a
//!   facility (engine defaults when no override is stored).
//! - `PUT  /api/admin/cds/thresholds/{facility_id}` — upsert a facility's
//!   thresholds (admin only). Body is a partial/full `CdsThresholds`; missing
//!   fields fall back to defaults.
//! - `GET  /api/admin/cds/audit?patient_id=` — CDS audit trail (admin only):
//!   which rule fired/was suppressed, severity, facility, threshold snapshot.
//!
//! Inherits shared imports via `use super::*`.

use super::*;
use crate::middleware::error_handling::{error_codes, error_envelope_json};
use crate::repositories::traits::JsonRecordEntity;

/// Resolve the caller and require the Admin role, or return an error response.
fn require_admin(data: &web::Data<AppState>, req: &HttpRequest) -> Result<(), HttpResponse> {
    let uid = get_current_user_id(req).ok_or_else(|| {
        HttpResponse::Unauthorized().json(error_envelope_json(
            error_codes::UNAUTHORIZED,
            "Authentication required",
            None,
        ))
    })?;
    let user = get_user(data, &uid).ok_or_else(|| {
        HttpResponse::Unauthorized().json(error_envelope_json(
            error_codes::USER_NOT_FOUND,
            "User not found",
            None,
        ))
    })?;
    if !user.role.is_admin() {
        return Err(HttpResponse::Forbidden().json(error_envelope_json(
            error_codes::INSUFFICIENT_ROLE,
            "Admin role required",
            None,
        )));
    }
    Ok(())
}

/// GET /api/admin/cds/thresholds/{facility_id}
#[get("/api/admin/cds/thresholds/{facility_id}")]
pub async fn get_cds_thresholds(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = require_admin(&data, &req) {
        return resp;
    }
    let facility_id = path.into_inner();
    let thresholds =
        crate::clinical_endpoints::load_cds_thresholds(&data, Some(&facility_id)).await;
    HttpResponse::Ok().json(serde_json::json!({
        "facility_id": facility_id,
        "thresholds": thresholds,
    }))
}

/// PUT /api/admin/cds/thresholds/{facility_id}
#[put("/api/admin/cds/thresholds/{facility_id}")]
pub async fn set_cds_thresholds(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<crate::clinical_endpoints::CdsThresholds>,
) -> impl Responder {
    if let Err(resp) = require_admin(&data, &req) {
        return resp;
    }
    let facility_id = path.into_inner();
    let thresholds = body.into_inner();
    let now = chrono::Utc::now();
    let record = JsonRecordEntity {
        id: facility_id.clone(),
        owner_id: facility_id.clone(),
        data: serde_json::to_value(&thresholds).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };
    match data.repositories.cds_threshold_configs.create(record).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "facility_id": facility_id,
            "thresholds": thresholds,
            "message": "CDS thresholds updated",
        })),
        Err(e) => HttpResponse::InternalServerError().json(error_envelope_json(
            error_codes::DATABASE_ERROR,
            "Failed to store CDS thresholds",
            Some(serde_json::json!({ "detail": e.to_string() })),
        )),
    }
}

/// GET /api/admin/cds/audit?patient_id=
#[get("/api/admin/cds/audit")]
pub async fn get_cds_audit(
    data: web::Data<AppState>,
    req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    if let Err(resp) = require_admin(&data, &req) {
        return resp;
    }
    let result = match query.get("patient_id") {
        Some(pid) => data.repositories.cds_audit_entries.get_by_owner(pid).await,
        None => data.repositories.cds_audit_entries.list_all().await,
    };
    match result {
        Ok(records) => {
            let entries: Vec<serde_json::Value> = records.into_iter().map(|r| r.data).collect();
            HttpResponse::Ok().json(serde_json::json!({
                "count": entries.len(),
                "entries": entries,
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(error_envelope_json(
            error_codes::DATABASE_ERROR,
            "Failed to load CDS audit trail",
            Some(serde_json::json!({ "detail": e.to_string() })),
        )),
    }
}
