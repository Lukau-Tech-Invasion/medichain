//! Break-glass (WP9): a clinician with no care relationship opens a patient's
//! chart in an emergency.
//!
//! `POST /api/patients/{patient_id}/break-glass` with a reason. The grant is
//! time-limited ([`BREAK_GLASS_MINUTES`]), written with its audit row in one
//! transaction, anchored on its own (emergency access is never batched away),
//! and the patient is told at once. Every chart read under it is recorded as
//! emergency access, which the patient's history highlights.

use actix_web::{post, web, HttpRequest, HttpResponse, Responder};
use serde::Deserialize;

use crate::care_access::BREAK_GLASS_MINUTES;
use crate::repositories::care_relationships::BreakGlassGrantEntity;
use crate::state::AppState;
use crate::ErrorResponse;

/// Shortest reason accepted, in characters (the table's CHECK agrees).
const MIN_REASON_CHARS: usize = 10;
/// Longest reason accepted, in characters.
const MAX_REASON_CHARS: usize = 500;

/// Body: why the glass is being broken.
#[derive(Debug, Deserialize)]
pub struct BreakGlassRequest {
    pub reason: String,
}

/// A JSON error with a stable code.
fn refuse(mut builder: actix_web::HttpResponseBuilder, message: &str, code: &str) -> HttpResponse {
    builder.json(ErrorResponse {
        error: message.to_string(),
        code: code.to_string(),
    })
}

/// The reason with control characters removed, or `None` when it is outside
/// the accepted length.
fn clean_reason(raw: &str) -> Option<String> {
    let cleaned: String = raw.chars().filter(|c| !c.is_control()).collect();
    let trimmed = cleaned.trim();
    let length = trimmed.chars().count();
    (MIN_REASON_CHARS..=MAX_REASON_CHARS)
        .contains(&length)
        .then(|| trimmed.to_string())
}

/// The grant and its audit row: emergency access, on the patient's record,
/// citing the grant as its authority.
fn grant_and_audit(
    caller: &crate::User,
    patient_id: &str,
    reason: String,
) -> (
    BreakGlassGrantEntity,
    crate::repositories::traits::AccessLogEntity,
) {
    let now = chrono::Utc::now();
    let grant = BreakGlassGrantEntity {
        id: format!("BG-{}", uuid::Uuid::new_v4()),
        patient_id: patient_id.to_string(),
        clinician_id: caller.wallet_address.clone(),
        reason: reason.clone(),
        starts_at: now,
        expires_at: now + chrono::Duration::minutes(BREAK_GLASS_MINUTES),
        created_at: now,
    };
    let audit = crate::repositories::traits::AccessLogEntity {
        id: crate::middleware::secure_tokens::generate_access_id(),
        accessor_id: caller.wallet_address.clone(),
        accessor_role: caller.role.to_string(),
        patient_id: Some(patient_id.to_string()),
        resource_type: "patient_chart".to_string(),
        resource_id: Some(grant.id.clone()),
        action: "break_glass_opened".to_string(),
        access_reason: Some(reason),
        is_emergency_access: true,
        ip_address: None,
        user_agent: None,
        blockchain_tx_hash: None,
        accessed_at: now,
        facility_id: None,
        authority_type: Some("break_glass".to_string()),
        authority_id: Some(grant.id.clone()),
    };
    (grant, audit)
}

/// Tell the patient now, and queue the grant's own chain anchor. Neither may
/// hold up the clinician: both are spawned, and failures are logged.
fn announce(data: &web::Data<AppState>, grant: &BreakGlassGrantEntity, role: String) {
    let state = data.clone();
    let grant = grant.clone();
    tokio::spawn(async move {
        crate::notifications::notify_patient(
            &state,
            &grant.patient_id,
            &["accessAlerts", "pushNotifications"],
            "Emergency access to your record",
            &format!(
                "A {role} with no existing care relationship opened your record in an emergency. Reason given: {}",
                grant.reason
            ),
            "break_glass",
        )
        .await;
        let wallet = match state
            .repositories
            .patients
            .get_by_id(&grant.patient_id)
            .await
        {
            Ok(patient) => patient.wallet_address,
            Err(error) => {
                log::error!(
                    "break-glass {}: patient lookup for anchoring failed: {error}",
                    grant.id
                );
                None
            }
        };
        if let Some(wallet) = wallet {
            if let Err(error) = crate::audit_outbox::anchor_access_or_queue(
                &state,
                "break_glass",
                &grant.id,
                &wallet,
                &grant.clinician_id,
                "EMERGENCY_ACCESS",
            )
            .await
            {
                log::error!("break-glass {} anchor not queued: {error}", grant.id);
            }
        }
    });
}

/// Break the glass on a patient's chart (clinical staff).
///
/// Body: `{ "reason": "…" }` (10–500 characters). Returns 201 with the grant
/// id and expiry; 400 for a missing or overlong reason; 404 for an unknown
/// patient; 503 when the grant cannot be recorded (no access without
/// evidence).
#[post("/api/patients/{patient_id}/break-glass")]
pub async fn break_glass(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<BreakGlassRequest>,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if !caller.role.may_break_glass() {
        return refuse(
            HttpResponse::Forbidden(),
            "Your role cannot break the glass on a chart.",
            "INSUFFICIENT_ROLE",
        );
    }
    let patient_id = path.into_inner();
    let Some(reason) = clean_reason(&body.reason) else {
        return refuse(
            HttpResponse::BadRequest(),
            "Give a reason of 10 to 500 characters. The patient will read it.",
            "REASON_REQUIRED",
        );
    };
    match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(_) => {}
        Err(crate::repositories::traits::RepositoryError::NotFound(_)) => {
            return refuse(HttpResponse::NotFound(), "Patient not found.", "NOT_FOUND")
        }
        Err(error) => {
            log::error!("break-glass: patient lookup failed: {error}");
            return refuse(
                HttpResponse::ServiceUnavailable(),
                "Emergency access could not be recorded. Please try again.",
                "BREAK_GLASS_UNAVAILABLE",
            );
        }
    }
    let (grant, audit) = grant_and_audit(&caller, &patient_id, reason);
    match data
        .repositories
        .create_break_glass_grant(grant, audit)
        .await
    {
        Ok(stored) => {
            announce(&data, &stored, caller.role.to_string());
            HttpResponse::Created().json(serde_json::json!({
                "success": true,
                "grant_id": stored.id,
                "expires_at": stored.expires_at,
            }))
        }
        Err(error) => {
            log::error!("break-glass: grant not recorded: {error}");
            refuse(
                HttpResponse::ServiceUnavailable(),
                "Emergency access could not be recorded. Please try again.",
                "BREAK_GLASS_UNAVAILABLE",
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::middleware::phi_access_audit::PhiAccessAuditMiddleware;
    use crate::repositories::traits::Pagination;
    use actix_web::{test, App};

    const PATIENT_ID: &str = "PAT-BREAK-GLASS";
    const PATIENT: &str = "patient_break_glass";
    const STRANGER: &str = "doctor_stranger_bg";
    const TREATING: &str = "doctor_treating_bg";

    async fn state() -> web::Data<AppState> {
        let state = AppState::new();
        crate::test_fixtures::register(&state, STRANGER, crate::Role::Doctor);
        crate::test_fixtures::register(&state, TREATING, crate::Role::Doctor);
        let mut patient = crate::test_fixtures::staff(PATIENT, crate::Role::Patient);
        patient.linked_patient_id = Some(PATIENT_ID.into());
        state.users.write().unwrap().insert(PATIENT.into(), patient);
        crate::test_fixtures::seed_patient(&state, PATIENT_ID).await;
        crate::care_access::record_encounter(
            &state,
            PATIENT_ID,
            TREATING,
            "APT-BG",
            chrono::Utc::now(),
        )
        .await;
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
                .service(break_glass)
                .service(crate::handlers::get_patient_vitals)
                .service(crate::handlers::get_access_logs),
        )
        .await;
        test::call_service(&app, request.to_request()).await
    }

    fn vitals(wallet: &str) -> test::TestRequest {
        test::TestRequest::get()
            .uri(&format!("/api/clinical/patient/{PATIENT_ID}/vitals"))
            .insert_header(("x-user-id", wallet))
    }

    fn break_the_glass(wallet: &str, reason: &str) -> test::TestRequest {
        test::TestRequest::post()
            .uri(&format!("/api/patients/{PATIENT_ID}/break-glass"))
            .insert_header(("x-user-id", wallet))
            .set_json(serde_json::json!({ "reason": reason }))
    }

    async fn rows(data: &web::Data<AppState>) -> Vec<crate::repositories::traits::AccessLogEntity> {
        data.repositories
            .access_logs
            .get_by_patient(PATIENT_ID, Pagination::new(0, 100))
            .await
            .unwrap()
            .items
    }

    /// WP9 "done when": no relationship means 403 on a chart route, break-glass
    /// still works, and what follows is recorded as emergency access.
    #[actix_web::test]
    async fn a_stranger_is_refused_but_can_break_the_glass() {
        let data = state().await;
        let refused = call(&data, vitals(STRANGER)).await;
        assert_eq!(refused.status(), 403);
        let body: serde_json::Value = test::read_body_json(refused).await;
        assert_eq!(body["code"], "CARE_RELATIONSHIP_REQUIRED");
        assert_eq!(body["break_glass_available"], true);

        let opened = call(
            &data,
            break_the_glass(STRANGER, "Unconscious in resus, no history"),
        )
        .await;
        assert_eq!(opened.status(), 201);
        assert_eq!(call(&data, vitals(STRANGER)).await.status(), 200);

        let read = rows(&data)
            .await
            .into_iter()
            .find(|r| r.action == "view")
            .unwrap();
        assert!(read.is_emergency_access);
        assert_eq!(read.authority_type.as_deref(), Some("break_glass"));
        let opening = rows(&data)
            .await
            .into_iter()
            .find(|r| r.action == "break_glass_opened")
            .unwrap();
        assert_eq!(
            opening.access_reason.as_deref(),
            Some("Unconscious in resus, no history")
        );
    }

    #[actix_web::test]
    async fn the_treating_clinician_reads_under_their_relationship() {
        let data = state().await;
        assert_eq!(call(&data, vitals(TREATING)).await.status(), 200);
        let row = rows(&data).await.into_iter().next().unwrap();
        assert_eq!(row.authority_type.as_deref(), Some("care_relationship"));
        assert!(!row.is_emergency_access);
    }

    #[actix_web::test]
    async fn the_patient_sees_the_break_glass_entry_highlighted() {
        let data = state().await;
        call(
            &data,
            break_the_glass(STRANGER, "Collapsed in the waiting room"),
        )
        .await;
        call(&data, vitals(STRANGER)).await;
        let request = test::TestRequest::get()
            .uri(&format!("/api/access-logs/{PATIENT_ID}"))
            .insert_header(("x-user-id", PATIENT));
        let response = call(&data, request).await;
        assert_eq!(response.status(), 200);
        let body: serde_json::Value = test::read_body_json(response).await;
        let logs = body["access_logs"].as_array().unwrap();
        assert!(logs
            .iter()
            .any(|log| log["authority_type"] == "break_glass" && log["emergency"] == true));
    }

    #[actix_web::test]
    async fn break_glass_needs_a_real_reason_and_a_clinician() {
        let data = state().await;
        assert_eq!(
            call(&data, break_the_glass(STRANGER, "urgent"))
                .await
                .status(),
            400
        );
        assert_eq!(
            call(&data, break_the_glass(PATIENT, "I would like to see it"))
                .await
                .status(),
            403
        );
        let unknown = test::TestRequest::post()
            .uri("/api/patients/PAT-NOBODY/break-glass")
            .insert_header(("x-user-id", STRANGER))
            .set_json(serde_json::json!({ "reason": "Unconscious in resus" }));
        assert_eq!(call(&data, unknown).await.status(), 404);
    }
}
