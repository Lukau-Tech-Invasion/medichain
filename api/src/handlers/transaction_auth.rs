//! Class B step-up and Class C transaction-authorization endpoints (ADR-0008).
//!
//! Both classes run through one challenge mechanism. A step-up is simply a
//! challenge whose action is `session.step_up` and whose intent binds nothing
//! but the session; an exact transaction authorization binds the mutation as
//! well. Keeping one code path means the replay, expiry, session-binding and
//! single-use guarantees cannot drift apart between the two.
//!
//! Inherits shared imports from the parent module via `use super::*`.

use super::*;
use crate::transaction_authorization::{
    self as txn, AuthenticatorType, ChallengeError, TransactionIntent,
};

/// The action recorded for a Class B elevation, so a step-up signature can never
/// be replayed as authorization for a real mutation.
const STEP_UP_ACTION: &str = "session.step_up";

#[derive(Debug, Deserialize)]
pub struct StepUpVerifyRequest {
    pub challenge_id: String,
    pub nonce: String,
    pub signature: String,
    /// Which authenticator produced the signature. Recorded as evidence of the
    /// mechanism used; it is not proof a prompt was displayed.
    pub authenticator: String,
}

#[derive(Debug, Deserialize)]
pub struct TransactionChallengeRequest {
    pub action: String,
    pub method: String,
    pub path: String,
    /// SHA-256 of the exact request body bytes the client will transmit. The
    /// client must hash the bytes it sends, not a re-serialisation of an object.
    #[serde(default)]
    pub body_digest: Option<String>,
    #[serde(default)]
    pub resource_id: Option<String>,
    /// The resource's concurrency token: a terminal status for a state-machine
    /// row, or `xmin` for an ordinary mutable row.
    #[serde(default)]
    pub expected_state: Option<String>,
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

/// Resolve the caller's verified subject and login session.
///
/// Both come from the JWT. Nothing here reads an identity header: a wallet proof
/// is evidence *about* an identity, never a declaration of one.
fn authenticated_session(req: &HttpRequest) -> Option<(String, Uuid)> {
    let claims = get_current_claims(req)?;
    let sid = claims
        .sid
        .as_deref()
        .and_then(|s| Uuid::parse_str(s).ok())?;
    Some((claims.sub, sid))
}

fn session_required() -> HttpResponse {
    HttpResponse::Unauthorized().json(ErrorResponse {
        success: false,
        error: "A current signed-in session is required".to_string(),
        code: "SESSION_REQUIRED".to_string(),
    })
}

fn storage_required() -> HttpResponse {
    HttpResponse::ServiceUnavailable().json(ErrorResponse {
        success: false,
        error: "Authorization is temporarily unavailable".to_string(),
        code: "AUTH_STORAGE_REQUIRED".to_string(),
    })
}

async fn challenge_error_response(
    pool: &sqlx::PgPool,
    error: ChallengeError,
    wallet: &str,
    sid: Uuid,
    action: &str,
) -> HttpResponse {
    match error {
        ChallengeError::SessionNotActive => HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "This session has ended; sign in again".to_string(),
            code: "SESSION_REVOKED".to_string(),
        }),
        // Both budgets exist to stop an authenticated client minting unbounded
        // authorization objects, so both are recorded as security events.
        ChallengeError::RateLimited | ChallengeError::TooManyLive => {
            txn::record_security_event(
                pool,
                txn::SecurityEvent::ChallengeRateLimited,
                Some(wallet),
                Some(sid),
                None,
                Some(action),
            )
            .await;
            HttpResponse::TooManyRequests().json(ErrorResponse {
                success: false,
                error: "Too many authorization requests; wait a moment and try again".to_string(),
                code: "CHALLENGE_RATE_LIMITED".to_string(),
            })
        }
        ChallengeError::Database(error) => {
            log::error!("Challenge issuance failed: {error}");
            storage_required()
        }
    }
}

/// Begin a Class B step-up for the current session.
#[post("/api/auth/step-up/challenge")]
pub async fn step_up_challenge(data: web::Data<AppState>, req: HttpRequest) -> HttpResponse {
    let Some((wallet, sid)) = authenticated_session(&req) else {
        return session_required();
    };
    let Some(pool) = data.db_pool.as_ref() else {
        return storage_required();
    };

    // A step-up binds the session and nothing else: it answers "does this person
    // still control the registered key", not "did they approve this mutation".
    let intent = TransactionIntent {
        action: STEP_UP_ACTION.to_string(),
        method: "POST".to_string(),
        path: "/api/auth/step-up/verify".to_string(),
        body_digest: txn::body_digest(b""),
        resource_id: None,
        expected_state: None,
        idempotency_key: None,
    };

    match txn::issue_transaction_challenge(pool, &wallet, sid, &intent).await {
        Ok(challenge) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "challenge": challenge,
            "instructions": {
                "step1": "Sign the returned message with your wallet's sr25519 private key",
                "step2": "POST the challenge_id, nonce, signature and authenticator to /api/auth/step-up/verify",
            },
        })),
        Err(error) => challenge_error_response(pool, error, &wallet, sid, STEP_UP_ACTION).await,
    }
}

/// Complete a Class B step-up, elevating the session for a short window.
#[post("/api/auth/step-up/verify")]
pub async fn step_up_verify(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<StepUpVerifyRequest>,
) -> HttpResponse {
    let Some((wallet, sid)) = authenticated_session(&req) else {
        return session_required();
    };
    let Some(pool) = data.db_pool.as_ref() else {
        return storage_required();
    };
    let (Ok(challenge_id), Some(authenticator)) = (
        Uuid::parse_str(&body.challenge_id),
        AuthenticatorType::parse(&body.authenticator),
    ) else {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Malformed authorization".to_string(),
            code: "INVALID_AUTHORIZATION".to_string(),
        });
    };

    let intent = TransactionIntent {
        action: STEP_UP_ACTION.to_string(),
        method: "POST".to_string(),
        path: "/api/auth/step-up/verify".to_string(),
        body_digest: txn::body_digest(b""),
        resource_id: None,
        expected_state: None,
        idempotency_key: None,
    };

    // Step-up establishes stronger assurance, so it requires an authenticator
    // that evidences a deliberate human act rather than mere key possession.
    match txn::authorize_transaction(
        pool,
        challenge_id,
        &wallet,
        sid,
        &intent,
        &body.nonce,
        &body.signature,
        authenticator,
        true,
    )
    .await
    {
        Ok(()) => match txn::record_step_up(pool, sid, authenticator).await {
            Ok(true) => HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "step_up_expires_in": txn::STEP_UP_TTL_SECS,
                "authenticator": authenticator.as_str(),
            })),
            // The session ended between authorization and elevation.
            Ok(false) => HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "This session has ended; sign in again".to_string(),
                code: "SESSION_REVOKED".to_string(),
            }),
            Err(error) => {
                log::error!("Step-up could not be recorded: {error}");
                storage_required()
            }
        },
        Err(failure) => {
            txn::record_security_event(
                pool,
                failure.security_event(),
                Some(&wallet),
                Some(sid),
                Some(challenge_id),
                Some(STEP_UP_ACTION),
            )
            .await;
            HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: failure.client_message().to_string(),
                code: "AUTHORIZATION_REJECTED".to_string(),
            })
        }
    }
}

/// Begin a Class C authorization for one exact mutation.
///
/// The server composes the challenge from what the client says it intends to do,
/// then binds it. The client cannot choose the nonce, the expiry, or the identity
/// the signature will be checked against.
#[post("/api/auth/transaction/challenge")]
pub async fn transaction_challenge(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<TransactionChallengeRequest>,
) -> HttpResponse {
    let Some((wallet, sid)) = authenticated_session(&req) else {
        return session_required();
    };
    let Some(pool) = data.db_pool.as_ref() else {
        return storage_required();
    };

    // A step-up signature must never double as authorization for a real
    // mutation, so the reserved action is refused here.
    if body.action == STEP_UP_ACTION {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Malformed authorization".to_string(),
            code: "INVALID_AUTHORIZATION".to_string(),
        });
    }

    let intent = TransactionIntent {
        action: body.action.clone(),
        method: body.method.to_uppercase(),
        path: body.path.clone(),
        // A request with no body authorizes the empty byte string, stated rather
        // than left implicit.
        body_digest: body
            .body_digest
            .clone()
            .unwrap_or_else(|| txn::body_digest(b"")),
        resource_id: body.resource_id.clone(),
        expected_state: body.expected_state.clone(),
        idempotency_key: body.idempotency_key.clone(),
    };

    match txn::issue_transaction_challenge(pool, &wallet, sid, &intent).await {
        Ok(challenge) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "challenge": challenge,
        })),
        Err(error) => challenge_error_response(pool, error, &wallet, sid, &body.action).await,
    }
}

/// Report the current session's assurance level.
///
/// Lets a client decide whether to prompt for step-up before starting a
/// privileged workflow, instead of discovering it from a rejected mutation.
#[get("/api/auth/assurance")]
pub async fn session_assurance(data: web::Data<AppState>, req: HttpRequest) -> HttpResponse {
    let Some((_, sid)) = authenticated_session(&req) else {
        return session_required();
    };
    let Some(pool) = data.db_pool.as_ref() else {
        return storage_required();
    };
    match txn::has_active_step_up(pool, sid).await {
        Ok(elevated) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "class_a": true,
            "class_b": elevated,
            "step_up_ttl_secs": txn::STEP_UP_TTL_SECS,
        })),
        Err(error) => {
            log::error!("Assurance lookup failed: {error}");
            storage_required()
        }
    }
}
