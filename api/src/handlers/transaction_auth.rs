//! Class C transaction-authorization endpoints (ADR-0008).
//!
//! The Class B step-up uses the current TOTP endpoint in `auth_jwt`; the
//! retired challenge routes are not part of the public API.
//!
//! Inherits shared imports from the parent module via `use super::*`.

use super::*;
use crate::state::{TotpOutcome, TotpScope};
use crate::transaction_authorization::{self as txn, ChallengeError, Factor, TransactionIntent};

/// Reserved action: a transaction challenge cannot impersonate session elevation.
const STEP_UP_ACTION: &str = "session.step_up";

#[derive(Debug, Deserialize)]
pub struct StepUpVerifyRequest {
    pub challenge_id: String,
    pub code: Option<String>,
    pub auth_proof: Option<String>,
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
/// Both come from the verified JWT; an identity header cannot declare a caller.
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
        error: "A current signed-in session is required".to_string(),
        code: "SESSION_REQUIRED".to_string(),
    })
}

fn storage_required() -> HttpResponse {
    HttpResponse::ServiceUnavailable().json(ErrorResponse {
        error: "Authorization is temporarily unavailable".to_string(),
        code: "AUTH_STORAGE_REQUIRED".to_string(),
    })
}

async fn challenge_error_response(
    pool: &sqlx::PgPool,
    error: ChallengeError,
    user_id: &str,
    sid: Uuid,
    action: &str,
) -> HttpResponse {
    match error {
        ChallengeError::SessionNotActive => HttpResponse::Unauthorized().json(ErrorResponse {
            error: "This session has ended; sign in again".to_string(),
            code: "SESSION_REVOKED".to_string(),
        }),
        // Both budgets exist to stop an authenticated client minting unbounded
        // authorization objects, so both are recorded as security events.
        ChallengeError::RateLimited | ChallengeError::TooManyLive => {
            txn::record_security_event(
                pool,
                txn::SecurityEvent::ChallengeRateLimited,
                Some(user_id),
                Some(sid),
                None,
                Some(action),
            )
            .await;
            HttpResponse::TooManyRequests().json(ErrorResponse {
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

fn invalid_authorization() -> HttpResponse {
    HttpResponse::Unauthorized().json(ErrorResponse {
        error: "This authorization is no longer valid. Please confirm the action again."
            .to_string(),
        code: "AUTHORIZATION_REJECTED".to_string(),
    })
}

/// The stored challenge chooses the factor; a caller cannot downgrade it.
async fn verify_challenge_factor(
    data: &web::Data<AppState>,
    pool: &sqlx::PgPool,
    user_id: &str,
    sid: Uuid,
    body: &StepUpVerifyRequest,
) -> Result<(Uuid, Factor), HttpResponse> {
    let challenge_id = Uuid::parse_str(&body.challenge_id).map_err(|_| invalid_authorization())?;
    let user_uuid = crate::actor_directory::parse_user_id(user_id).ok_or_else(session_required)?;
    let stored: Option<String> = sqlx::query_scalar(
        "SELECT required_factor FROM auth_transaction_challenges
         WHERE id = $1 AND user_id = $2 AND login_session_id = $3
           AND consumed_at IS NULL AND verified_at IS NULL AND expires_at > NOW()",
    )
    .bind(challenge_id)
    .bind(user_uuid)
    .bind(sid)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        log::error!("Factor lookup failed: {error}");
        storage_required()
    })?;
    let factor = stored
        .as_deref()
        .and_then(Factor::parse)
        .ok_or_else(invalid_authorization)?;
    let accepted = match factor {
        Factor::Totp => match data
            .verify_totp(
                user_id,
                body.code.as_deref().unwrap_or(""),
                TotpScope::Enabled,
            )
            .await
        {
            TotpOutcome::Accepted => true,
            TotpOutcome::Unavailable => return Err(storage_required()),
            _ => false,
        },
        Factor::Password => {
            let proof = body.auth_proof.as_deref().unwrap_or("");
            let verifier: Option<String> = sqlx::query_scalar(
                "SELECT credential_verifier FROM users WHERE id = $1 AND status = 'active'",
            )
            .bind(user_uuid)
            .fetch_optional(pool)
            .await
            .map_err(|error| {
                log::error!("Credential lookup failed: {error}");
                storage_required()
            })?
            .flatten();
            let verifier = verifier
                .as_deref()
                .unwrap_or(crate::credentials::timing_equaliser());
            crate::credentials::is_valid_auth_proof(proof)
                && medichain_crypto::password::verify_secret(proof, verifier)
        }
    };
    if !accepted {
        txn::record_security_event(
            pool,
            txn::SecurityEvent::FactorRejected,
            Some(user_id),
            Some(sid),
            Some(challenge_id),
            None,
        )
        .await;
        return Err(invalid_authorization());
    }
    let proof = txn::TransactionProof {
        challenge_id,
        subject: user_id,
        login_session_id: sid,
    };
    txn::mark_verified(pool, proof, factor)
        .await
        .map_err(|_| invalid_authorization())?;
    Ok((challenge_id, factor))
}

/// Begin a Class C authorization for one exact mutation.
///
/// The server composes the challenge from what the client says it intends to do,
/// then binds it. The client cannot choose the factor, expiry, or identity.
#[post("/api/auth/transaction/challenge")]
pub async fn transaction_challenge(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<TransactionChallengeRequest>,
) -> HttpResponse {
    let Some((user_id, sid)) = authenticated_session(&req) else {
        return session_required();
    };
    let Some(pool) = data.db_pool.as_ref() else {
        return storage_required();
    };

    if body.action == STEP_UP_ACTION
        || body.action.is_empty()
        || body.path.is_empty()
        || !matches!(body.method.as_str(), "POST" | "PUT" | "PATCH" | "DELETE")
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
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

    match txn::issue_transaction_challenge(pool, &user_id, sid, &intent).await {
        Ok(challenge) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "challenge": challenge,
        })),
        Err(error) => challenge_error_response(pool, error, &user_id, sid, &body.action).await,
    }
}

/// Verify a Class C factor. The returned ID is not authority on its own: the
/// mutation must atomically consume it against the original intent.
#[post("/api/auth/transaction/verify")]
pub async fn transaction_verify(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<StepUpVerifyRequest>,
) -> HttpResponse {
    let Some((user_id, sid)) = authenticated_session(&req) else {
        return session_required();
    };
    let Some(pool) = data.db_pool.as_ref() else {
        return storage_required();
    };
    match verify_challenge_factor(&data, pool, &user_id, sid, &body).await {
        Ok((challenge_id, _)) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "authorization_id": challenge_id.to_string(),
        })),
        Err(response) => response,
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
