//! Data-retention administration.
//!
//! - `GET  /api/admin/retention/report` — what the retention policies would
//!   consider eligible for disposal today, and what is under legal hold.
//! - `POST /api/admin/retention/holds` — place a litigation/regulatory hold.
//! - `POST /api/admin/retention/holds/{id}/release` — release a hold.
//!
//! **Nothing here deletes data.** The report endpoint runs the same assessment
//! as the daily background job and returns its findings; disposal is not
//! implemented (see `crate::retention` for why that boundary is deliberate).
//!
//! Inherits shared imports via `use super::*`.

use super::*;
use crate::middleware::error_handling::{error_codes, error_envelope_json};
use crate::repositories::traits::LegalHoldEntity;

/// Resolve the caller and require the Admin role, or return an error response.
fn require_admin(data: &web::Data<AppState>, req: &HttpRequest) -> Result<String, HttpResponse> {
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
    Ok(uid)
}

/// GET /api/admin/retention/report
///
/// Runs a retention assessment on demand and returns it. Read-only: the
/// assessment evaluates and reports, and has no code path that disposes of a
/// record.
#[get("/api/admin/retention/report")]
pub async fn get_retention_report(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    if let Err(resp) = require_admin(&data, &req) {
        return resp;
    }

    let assessment = crate::retention::run_retention_assessment(&data).await;

    // An assessment that could not run must not answer 200/success. Reporting
    // "0 records due" when the database was unreachable is indistinguishable
    // from a healthy run over a clean dataset, and would let an operator
    // believe a legal obligation had been checked when it had not.
    if let Some(reason) = &assessment.incomplete_reason {
        return HttpResponse::ServiceUnavailable().json(serde_json::json!({
            "success": false,
            "error": {
                "code": "RETENTION_ASSESSMENT_INCOMPLETE",
                "message": format!("Retention assessment could not be completed: {reason}"),
            },
            "assessment": assessment,
        }));
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "assessment": assessment,
        // Stated explicitly rather than left to be inferred: a report that
        // lists records as "due" should not be mistaken for a report of
        // records that were acted on.
        "note": "Report-only. No records are deleted, archived, or modified by \
                 this endpoint or by the scheduled assessment.",
    }))
}

#[derive(Debug, serde::Deserialize)]
pub struct CreateLegalHoldRequest {
    /// Hold one patient's records. At least one of this or `entity_type` must
    /// be present, or the hold would cover nothing.
    pub patient_id: Option<String>,
    /// Hold an entire entity type (e.g. all occupational-health records).
    pub entity_type: Option<String>,
    pub reason: String,
    /// Case or matter reference.
    pub reference: Option<String>,
}

/// POST /api/admin/retention/holds
#[post("/api/admin/retention/holds")]
pub async fn create_legal_hold(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<CreateLegalHoldRequest>,
) -> impl Responder {
    let admin_id = match require_admin(&data, &req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    // A hold naming neither a patient nor an entity type protects nothing,
    // while looking like protection — reject rather than store it.
    if body.patient_id.is_none() && body.entity_type.is_none() {
        return HttpResponse::BadRequest().json(error_envelope_json(
            error_codes::VALIDATION_ERROR,
            "A hold must name a patient_id, an entity_type, or both",
            None,
        ));
    }

    if body.reason.trim().is_empty() {
        return HttpResponse::BadRequest().json(error_envelope_json(
            error_codes::VALIDATION_ERROR,
            "reason is required — an unexplained hold cannot be reviewed later",
            None,
        ));
    }

    let now = chrono::Utc::now();
    let hold = LegalHoldEntity {
        id: format!("LH-{}", uuid::Uuid::new_v4()),
        patient_id: body.patient_id.clone(),
        entity_type: body.entity_type.clone(),
        reason: body.reason.clone(),
        reference: body.reference.clone(),
        applied_by: admin_id,
        applied_at: now,
        released_by: None,
        released_at: None,
        release_reason: None,
        created_at: Some(now),
    };

    match data.repositories.legal_holds.create(hold).await {
        Ok(created) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "hold": created,
        })),
        Err(e) => HttpResponse::InternalServerError().json(error_envelope_json(
            error_codes::INTERNAL_ERROR,
            &format!("Could not create legal hold: {}", e),
            None,
        )),
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct ReleaseLegalHoldRequest {
    pub reason: Option<String>,
}

/// POST /api/admin/retention/holds/{id}/release
///
/// Releasing does not delete the hold record: the period during which records
/// were held is itself part of the audit trail.
#[post("/api/admin/retention/holds/{id}/release")]
pub async fn release_legal_hold(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<ReleaseLegalHoldRequest>,
) -> impl Responder {
    let admin_id = match require_admin(&data, &req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    let hold_id = path.into_inner();

    match data
        .repositories
        .legal_holds
        .release(&hold_id, &admin_id, body.reason.clone())
        .await
    {
        Ok(released) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "hold": released,
        })),
        Err(e) => HttpResponse::NotFound().json(error_envelope_json(
            error_codes::NOT_FOUND,
            &format!("Could not release hold {}: {}", hold_id, e),
            None,
        )),
    }
}

/// GET /api/admin/retention/holds
#[get("/api/admin/retention/holds")]
pub async fn list_active_legal_holds(
    data: web::Data<AppState>,
    req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = require_admin(&data, &req) {
        return resp;
    }

    match data.repositories.legal_holds.get_active().await {
        Ok(holds) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "holds": holds,
            "count": holds.len(),
        })),
        Err(e) => HttpResponse::InternalServerError().json(error_envelope_json(
            error_codes::INTERNAL_ERROR,
            &format!("Could not list legal holds: {}", e),
            None,
        )),
    }
}

// ---------------------------------------------------------------------------
// Approval-gated execution
// ---------------------------------------------------------------------------
// Execution restricts processing and registers the decision. It does not
// delete. See `crate::retention::execution` for the flow and its rationale.

/// POST /api/admin/retention/approvals
///
/// Runs an assessment and issues an approval token bound to its exact contents.
/// The token authorises executing against *that* record set and no other.
#[post("/api/admin/retention/approvals")]
pub async fn request_retention_approval(
    data: web::Data<AppState>,
    req: HttpRequest,
) -> impl Responder {
    let uid = match require_admin(&data, &req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    let assessment = crate::retention::run_retention_assessment(&data).await;

    // Never mint an approval token against an assessment that did not run.
    // Its digest would faithfully describe an empty record set that was never
    // examined, and approving it would be approving nothing while looking
    // exactly like approving something.
    if let Some(reason) = &assessment.incomplete_reason {
        return HttpResponse::ServiceUnavailable().json(serde_json::json!({
            "success": false,
            "error": {
                "code": "RETENTION_ASSESSMENT_INCOMPLETE",
                "message": format!(
                    "Refusing to issue an approval token: the assessment could not be \
                     completed: {reason}"
                ),
            },
        }));
    }

    match crate::retention::execution::request_approval(&data, &assessment, &uid).await {
        Ok(approval) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "approval": approval,
            "assessment": assessment,
            "note": "This token authorises restricting the listed records only. It expires, and \
                     execution aborts if the record set changes before it is used. No records \
                     are deleted by executing it.",
        })),
        Err(e) => HttpResponse::InternalServerError().json(error_envelope_json(
            error_codes::INTERNAL_ERROR,
            &format!("Could not create approval: {e}"),
            None,
        )),
    }
}

#[derive(Debug, Deserialize)]
pub struct DecideApprovalRequest {
    pub approved: bool,
    pub reason: Option<String>,
}

/// POST /api/admin/retention/approvals/{token}/decide
#[post("/api/admin/retention/approvals/{token}/decide")]
pub async fn decide_retention_approval(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<DecideApprovalRequest>,
) -> impl Responder {
    let uid = match require_admin(&data, &req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };
    let token = path.into_inner();

    match data
        .repositories
        .retention_execution
        .decide_approval(&token, body.approved, &uid, body.reason.clone())
        .await
    {
        Ok(approval) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "approval": approval,
        })),
        Err(e) => HttpResponse::BadRequest().json(error_envelope_json(
            error_codes::VALIDATION_ERROR,
            &format!("Could not decide approval: {e}"),
            None,
        )),
    }
}

/// POST /api/admin/retention/approvals/{token}/execute
///
/// Re-assesses, verifies the record set has not moved, re-checks legal holds,
/// then restricts and registers. Nothing is deleted.
#[post("/api/admin/retention/approvals/{token}/execute")]
pub async fn execute_retention_approval(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let uid = match require_admin(&data, &req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };
    let token = path.into_inner();

    match crate::retention::execution::execute_approved(&data, &token, &uid).await {
        Ok(outcome) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "outcome": outcome,
            "note": "Records were restricted (processing limited to storage) and registered. \
                     No record was deleted.",
        })),
        Err(crate::retention::execution::ExecutionError::NotFound(t)) => HttpResponse::NotFound()
            .json(error_envelope_json(
                error_codes::NOT_FOUND,
                &format!("Approval {t} not found"),
                None,
            )),
        // A drifted assessment is a conflict, not a client mistake: the request
        // was valid when it was approved.
        Err(e @ crate::retention::execution::ExecutionError::AssessmentDrifted { .. }) => {
            HttpResponse::Conflict().json(error_envelope_json(
                error_codes::VALIDATION_ERROR,
                &e.to_string(),
                None,
            ))
        }
        Err(e) => HttpResponse::BadRequest().json(error_envelope_json(
            error_codes::VALIDATION_ERROR,
            &e.to_string(),
            None,
        )),
    }
}

/// GET /api/admin/retention/approvals
#[get("/api/admin/retention/approvals")]
pub async fn list_retention_approvals(
    data: web::Data<AppState>,
    req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = require_admin(&data, &req) {
        return resp;
    }

    match data
        .repositories
        .retention_execution
        .list_open_approvals()
        .await
    {
        Ok(approvals) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "count": approvals.len(),
            "approvals": approvals,
        })),
        Err(e) => HttpResponse::InternalServerError().json(error_envelope_json(
            error_codes::INTERNAL_ERROR,
            &format!("Could not list approvals: {e}"),
            None,
        )),
    }
}

/// GET /api/admin/retention/register
///
/// The deletion register: what was acted on, under which policy, on whose
/// authority. Carries no clinical payload by design.
#[get("/api/admin/retention/register")]
pub async fn get_deletion_register(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    if let Err(resp) = require_admin(&data, &req) {
        return resp;
    }

    match data
        .repositories
        .retention_execution
        .list_register(500)
        .await
    {
        Ok(entries) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "count": entries.len(),
            "entries": entries,
        })),
        Err(e) => HttpResponse::InternalServerError().json(error_envelope_json(
            error_codes::INTERNAL_ERROR,
            &format!("Could not read deletion register: {e}"),
            None,
        )),
    }
}

/// GET /api/admin/retention/restrictions
#[get("/api/admin/retention/restrictions")]
pub async fn list_processing_restrictions(
    data: web::Data<AppState>,
    req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = require_admin(&data, &req) {
        return resp;
    }

    match data
        .repositories
        .retention_execution
        .list_active_restrictions()
        .await
    {
        Ok(restrictions) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "count": restrictions.len(),
            "restrictions": restrictions,
        })),
        Err(e) => HttpResponse::InternalServerError().json(error_envelope_json(
            error_codes::INTERNAL_ERROR,
            &format!("Could not list restrictions: {e}"),
            None,
        )),
    }
}

#[derive(Debug, Deserialize)]
pub struct LiftRestrictionRequest {
    pub reason: Option<String>,
}

/// POST /api/admin/retention/restrictions/{id}/lift
///
/// Restores ordinary processing. The restriction row is retained — that
/// processing was restricted between two dates is the auditable fact.
#[post("/api/admin/retention/restrictions/{id}/lift")]
pub async fn lift_processing_restriction(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<LiftRestrictionRequest>,
) -> impl Responder {
    let uid = match require_admin(&data, &req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };
    let id = path.into_inner();

    match data
        .repositories
        .retention_execution
        .lift_restriction(&id, &uid, body.reason.clone())
        .await
    {
        Ok(restriction) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "restriction": restriction,
        })),
        Err(e) => HttpResponse::NotFound().json(error_envelope_json(
            error_codes::NOT_FOUND,
            &format!("Could not lift restriction: {e}"),
            None,
        )),
    }
}
