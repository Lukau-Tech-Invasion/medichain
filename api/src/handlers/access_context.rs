//! Server-issued chart access contexts (WP10).
//!
//! `POST /api/patients/{patient_id}/access-context` with the clinician's reason.
//! The server checks their authority over the chart (WP9) and records the
//! reason against it; reads then send the context id (`X-Access-Context`), and
//! the disclosure row takes its reason from the context, not from a header the
//! client declares on each request.

use actix_web::{post, web, HttpRequest, HttpResponse, Responder};
use serde::Deserialize;

use crate::care_access::ChartAuthority;
use crate::middleware::phi_access_audit::{normalise_access_reason, REASON_NOT_STATED};
use crate::repositories::care_relationships::AccessContextEntity;
use crate::state::AppState;
use crate::ErrorResponse;

/// Hours an access context lasts: one working shift (default pending WP13).
pub const ACCESS_CONTEXT_HOURS: i64 = 8;

/// Body: why the chart is being opened (a reason code or short free text).
#[derive(Debug, Deserialize)]
pub struct AccessContextRequest {
    pub reason: String,
}

/// A JSON error with a stable code.
fn refuse(mut builder: actix_web::HttpResponseBuilder, message: &str, code: &str) -> HttpResponse {
    builder.json(ErrorResponse {
        error: message.to_string(),
        code: code.to_string(),
    })
}

/// The context row for an authorised clinician.
fn context_for(
    caller: &crate::User,
    patient_id: &str,
    reason: String,
    authority: &ChartAuthority,
) -> AccessContextEntity {
    let now = chrono::Utc::now();
    AccessContextEntity {
        id: format!("ACX-{}", uuid::Uuid::new_v4()),
        patient_id: patient_id.to_string(),
        clinician_id: caller.wallet_address.clone(),
        reason,
        authority_type: authority.authority_type().unwrap_or_default().to_string(),
        authority_id: authority.authority_id(),
        created_at: now,
        expires_at: now + chrono::Duration::hours(ACCESS_CONTEXT_HOURS),
    }
}

/// Open a chart access context (clinical staff).
///
/// Returns 201 with `access_context_id`, `authority_type` and `expires_at`;
/// 400 without a reason; 403 `CARE_RELATIONSHIP_REQUIRED` (with
/// `break_glass_available`) when the clinician has no authority; 404 for an
/// unknown patient; 503 when authority or storage cannot be checked.
#[post("/api/patients/{patient_id}/access-context")]
pub async fn open_access_context(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<AccessContextRequest>,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let patient_id = path.into_inner();
    let reason = normalise_access_reason(Some(&body.reason));
    if reason == REASON_NOT_STATED {
        return refuse(
            HttpResponse::BadRequest(),
            "Say why you are opening this chart.",
            "REASON_REQUIRED",
        );
    }
    if let Err(response) = require_patient(&data, &patient_id).await {
        return response;
    }
    let authority =
        match crate::care_access::resolve_chart_access(&data, &caller, &patient_id).await {
            Ok(ChartAuthority::Denied) => {
                return crate::middleware::phi_access_audit::chart_refused(
                    caller.role.may_break_glass(),
                )
            }
            Ok(ChartAuthority::SelfAccess) => {
                return refuse(
                    HttpResponse::BadRequest(),
                    "This is your own record.",
                    "NOT_NEEDED",
                )
            }
            Ok(authority) => authority,
            Err(error) => {
                log::error!(
                    "access context: authority for {patient_id} unavailable: {}",
                    error.0
                );
                return refuse(
                    HttpResponse::ServiceUnavailable(),
                    "Access to this chart cannot be checked right now. Please try again shortly.",
                    "ACCESS_CHECK_UNAVAILABLE",
                );
            }
        };
    let row = context_for(&caller, &patient_id, reason, &authority);
    match data
        .repositories
        .care_relationships
        .create_access_context(row)
        .await
    {
        Ok(stored) => HttpResponse::Created().json(serde_json::json!({
            "access_context_id": stored.id,
            "authority_type": stored.authority_type,
            "expires_at": stored.expires_at,
        })),
        Err(error) => {
            log::error!("access context not stored: {error}");
            refuse(
                HttpResponse::ServiceUnavailable(),
                "The chart could not be opened right now. Please try again shortly.",
                "ACCESS_CONTEXT_UNAVAILABLE",
            )
        }
    }
}

/// 404 for an unknown patient, 503 when the lookup fails.
async fn require_patient(data: &web::Data<AppState>, patient_id: &str) -> Result<(), HttpResponse> {
    match data.repositories.patients.get_by_id(patient_id).await {
        Ok(_) => Ok(()),
        Err(crate::repositories::traits::RepositoryError::NotFound(_)) => Err(refuse(
            HttpResponse::NotFound(),
            "Patient not found.",
            "NOT_FOUND",
        )),
        Err(error) => {
            log::error!("access context: patient lookup failed: {error}");
            Err(refuse(
                HttpResponse::ServiceUnavailable(),
                "The chart could not be opened right now. Please try again shortly.",
                "ACCESS_CONTEXT_UNAVAILABLE",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::middleware::phi_access_audit::{
        PhiAccessAuditMiddleware, ACCESS_CONTEXT_HEADER, ACCESS_REASON_HEADER,
    };
    use crate::repositories::traits::Pagination;
    use actix_web::{test, App};

    const PATIENT_ID: &str = "PAT-ACX";
    const TREATING: &str = "doctor_treating_acx";
    const COLLEAGUE: &str = "doctor_colleague_acx";
    const STRANGER: &str = "doctor_stranger_acx";

    async fn state() -> web::Data<AppState> {
        let state = AppState::new();
        for wallet in [TREATING, COLLEAGUE, STRANGER] {
            crate::test_fixtures::register(&state, wallet, crate::Role::Doctor);
        }
        crate::test_fixtures::seed_patient(&state, PATIENT_ID).await;
        for wallet in [TREATING, COLLEAGUE] {
            crate::care_access::record_encounter(
                &state,
                PATIENT_ID,
                wallet,
                &format!("APT-{wallet}"),
                chrono::Utc::now(),
            )
            .await;
        }
        web::Data::new(state)
    }

    async fn call(
        data: &web::Data<AppState>,
        request: test::TestRequest,
    ) -> actix_web::dev::ServiceResponse<actix_web::body::EitherBody<actix_web::body::BoxBody>>
    {
        let app = test::init_service(
            App::new()
                .wrap(PhiAccessAuditMiddleware)
                .app_data(data.clone())
                .service(open_access_context)
                .service(crate::handlers::get_patient_vitals),
        )
        .await;
        test::call_service(&app, request.to_request()).await
    }

    fn open(wallet: &str, reason: &str) -> test::TestRequest {
        test::TestRequest::post()
            .uri(&format!("/api/patients/{PATIENT_ID}/access-context"))
            .insert_header(("x-user-id", wallet))
            .set_json(serde_json::json!({ "reason": reason }))
    }

    async fn context_id(data: &web::Data<AppState>, wallet: &str) -> String {
        let response = call(data, open(wallet, "treatment")).await;
        assert_eq!(response.status(), 201);
        let body: serde_json::Value = test::read_body_json(response).await;
        assert_eq!(body["authority_type"], "care_relationship");
        body["access_context_id"].as_str().unwrap().to_string()
    }

    fn read_citing(wallet: &str, context: &str, header_reason: &str) -> test::TestRequest {
        test::TestRequest::get()
            .uri(&format!("/api/clinical/patient/{PATIENT_ID}/vitals"))
            .insert_header(("x-user-id", wallet))
            .insert_header((ACCESS_CONTEXT_HEADER, context))
            .insert_header((ACCESS_REASON_HEADER, header_reason))
    }

    async fn last_reason(data: &web::Data<AppState>) -> Option<String> {
        data.repositories
            .access_logs
            .get_by_patient(PATIENT_ID, Pagination::new(0, 100))
            .await
            .unwrap()
            .items
            .into_iter()
            .max_by_key(|row| row.accessed_at)
            .and_then(|row| row.access_reason)
    }

    #[actix_web::test]
    async fn the_recorded_reason_comes_from_the_server_issued_context() {
        let data = state().await;
        let id = context_id(&data, TREATING).await;
        // A header claiming something else does not change what is recorded.
        let response = call(&data, read_citing(TREATING, &id, "administrative")).await;
        assert_eq!(response.status(), 200);
        assert_eq!(last_reason(&data).await.as_deref(), Some("Treatment"));
    }

    #[actix_web::test]
    async fn another_clinicians_context_cannot_be_borrowed() {
        let data = state().await;
        let id = context_id(&data, TREATING).await;
        let response = call(&data, read_citing(COLLEAGUE, &id, "referral")).await;
        assert_eq!(response.status(), 200);
        assert_eq!(last_reason(&data).await.as_deref(), Some("Referral"));
    }

    #[actix_web::test]
    async fn no_authority_no_context_and_no_reason_no_context() {
        let data = state().await;
        let refused = call(&data, open(STRANGER, "treatment")).await;
        assert_eq!(refused.status(), 403);
        let body: serde_json::Value = test::read_body_json(refused).await;
        assert_eq!(body["code"], "CARE_RELATIONSHIP_REQUIRED");
        assert_eq!(call(&data, open(TREATING, "   ")).await.status(), 400);
    }
}
