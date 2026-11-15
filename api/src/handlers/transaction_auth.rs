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

/// The intent a gated mutation must be authorized for, told to a client that
/// sent none so it can request exactly this challenge.
fn authorization_required(
    action: &str,
    method: &str,
    path: &str,
    resource_id: &str,
    expected_state: &str,
) -> HttpResponse {
    HttpResponse::build(actix_web::http::StatusCode::PRECONDITION_REQUIRED).json(
        crate::middleware::error_handling::error_envelope_json(
            "TRANSACTION_AUTHORIZATION_REQUIRED",
            "Confirm this action to continue.",
            Some(serde_json::json!({
                "action": action,
                "method": method,
                "path": path,
                "resource_id": resource_id,
                "expected_state": expected_state,
            })),
        ),
    )
}

/// Require an exact, single-use Class C authorization for this request
/// (ADR-0008 Decision 5): bound to the session, the action, the method and
/// path, the SHA-256 of the transmitted bytes, the resource and its current
/// state, and the idempotency key -- consumed once.
///
/// `expected_state` is the resource's state as the server reads it now, so an
/// authorization issued against `pending` cannot approve what has since become
/// `revoked`. Consumption precedes the mutation: if the mutation then fails,
/// the person confirms again; an authorization can never execute twice.
///
/// Production cannot run without PostgreSQL (`validate_production_storage_and_origins`),
/// where the challenge store lives. The in-memory development backend has no
/// such store and skips the gate; `startup` says so when it starts.
pub async fn require_exact_authorization(
    data: &web::Data<AppState>,
    req: &HttpRequest,
    action: &str,
    resource_id: &str,
    expected_state: &str,
) -> Result<(), HttpResponse> {
    let Some(pool) = data.db_pool.as_ref() else {
        return Ok(());
    };
    let Some((user_id, sid)) = authenticated_session(req) else {
        return Err(session_required());
    };
    let method = req.method().as_str().to_uppercase();
    let path = req.path().to_string();
    let Some(header) = req.headers().get(txn::AUTHORIZATION_HEADER) else {
        return Err(authorization_required(
            action,
            &method,
            &path,
            resource_id,
            expected_state,
        ));
    };
    let challenge_id = header
        .to_str()
        .ok()
        .and_then(|value| Uuid::parse_str(value.trim()).ok())
        .ok_or_else(invalid_authorization)?;
    let Some(transmitted) = actix_web::HttpMessage::extensions(req)
        .get::<txn::TransmittedRequest>()
        .cloned()
    else {
        log::error!("Class C gate on {path} ran without the idempotency middleware");
        return Err(storage_required());
    };
    let intent = TransactionIntent {
        action: action.to_string(),
        method,
        path,
        body_digest: transmitted.body_digest,
        resource_id: Some(resource_id.to_string()),
        expected_state: Some(expected_state.to_string()),
        idempotency_key: Some(transmitted.idempotency_key),
    };
    let proof = txn::TransactionProof {
        challenge_id,
        subject: &user_id,
        login_session_id: sid,
    };
    match txn::authorize_transaction(pool, proof, &intent).await {
        Ok(()) => Ok(()),
        Err(failure) => {
            txn::record_security_event(
                pool,
                failure.security_event(),
                Some(&user_id),
                Some(sid),
                Some(challenge_id),
                Some(action),
            )
            .await;
            Err(HttpResponse::Unauthorized().json(ErrorResponse {
                error: failure.client_message().to_string(),
                code: "AUTHORIZATION_REJECTED".to_string(),
            }))
        }
    }
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

#[cfg(test)]
mod class_c_gate_pg_tests {
    use super::*;
    use actix_web::{test, HttpMessage};

    /// A signed-in caller with a live login session, and a request the gate
    /// can read: its token carries the `sid`, and the middleware's record of
    /// the transmitted bytes is attached as it would be in the running server.
    struct Caller {
        data: web::Data<AppState>,
        pool: sqlx::PgPool,
        user_id: String,
        sid: Uuid,
    }

    async fn caller() -> Caller {
        let pool = crate::repositories::postgres::tests::create_test_pool().await;
        let user_id = crate::test_fixtures::insert_pg_user(&pool, "Admin").await;
        let sid = crate::auth_sessions::create(
            &pool,
            &user_id,
            "refresh-under-test",
            &Uuid::new_v4().to_string(),
            chrono::Utc::now() + chrono::Duration::hours(1),
        )
        .await
        .expect("login session");
        let mut state = AppState::new();
        state.db_pool = Some(pool.clone());
        Caller {
            data: web::Data::new(state),
            pool,
            user_id,
            sid,
        }
    }

    fn request(caller: &Caller, body: &[u8], authorization: Option<Uuid>) -> HttpRequest {
        let token = crate::security::jwt::issue_access_token(
            &caller.user_id,
            "Admin",
            false,
            Some(&caller.sid.to_string()),
        )
        .unwrap();
        let mut builder = test::TestRequest::post()
            .uri("/api/access/requests/REQ-1/approve")
            .insert_header(("Authorization", format!("Bearer {token}")));
        if let Some(id) = authorization {
            builder = builder.insert_header((txn::AUTHORIZATION_HEADER, id.to_string()));
        }
        let req = builder.to_http_request();
        req.extensions_mut().insert(txn::TransmittedRequest {
            body_digest: txn::body_digest(body),
            idempotency_key: "key-under-test".to_string(),
        });
        req
    }

    /// A verified challenge for exactly this approval of `REQ-1` in `pending`.
    async fn verified_challenge(caller: &Caller, body: &[u8], state: &str) -> Uuid {
        let intent = TransactionIntent {
            action: "access_request.approve".to_string(),
            method: "POST".to_string(),
            path: "/api/access/requests/REQ-1/approve".to_string(),
            body_digest: txn::body_digest(body),
            resource_id: Some("REQ-1".to_string()),
            expected_state: Some(state.to_string()),
            idempotency_key: Some("key-under-test".to_string()),
        };
        let issued =
            txn::issue_transaction_challenge(&caller.pool, &caller.user_id, caller.sid, &intent)
                .await
                .expect("challenge");
        let id = Uuid::parse_str(&issued.challenge_id).unwrap();
        let proof = txn::TransactionProof {
            challenge_id: id,
            subject: &caller.user_id,
            login_session_id: caller.sid,
        };
        txn::mark_verified(&caller.pool, proof, Factor::Password)
            .await
            .expect("verified");
        id
    }

    async fn gate(caller: &Caller, req: &HttpRequest, state: &str) -> Result<(), HttpResponse> {
        require_exact_authorization(&caller.data, req, "access_request.approve", "REQ-1", state)
            .await
    }

    /// Without an authorization the request is told exactly what to confirm.
    #[actix_rt::test]
    async fn an_unconfirmed_request_is_told_what_to_confirm() {
        let caller = caller().await;
        let refused = gate(&caller, &request(&caller, b"{}", None), "pending")
            .await
            .unwrap_err();
        assert_eq!(refused.status().as_u16(), 428);
        let body: serde_json::Value = serde_json::from_slice(
            &actix_web::body::to_bytes(refused.into_body())
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(body["error"]["code"], "TRANSACTION_AUTHORIZATION_REQUIRED");
        assert_eq!(body["error"]["details"]["expected_state"], "pending");
        assert_eq!(body["error"]["details"]["resource_id"], "REQ-1");
    }

    /// A verified authorization passes once and never again.
    #[actix_rt::test]
    async fn a_verified_authorization_is_consumed_exactly_once() {
        let caller = caller().await;
        let id = verified_challenge(&caller, b"{\"expires_at\":\"x\"}", "pending").await;
        let req = request(&caller, b"{\"expires_at\":\"x\"}", Some(id));
        assert!(gate(&caller, &req, "pending").await.is_ok());
        let replay = gate(&caller, &req, "pending").await.unwrap_err();
        assert_eq!(replay.status().as_u16(), 401);
    }

    /// Different bytes, or a record whose state moved on, are not what was confirmed.
    #[actix_rt::test]
    async fn changed_bytes_or_a_changed_record_are_refused() {
        let caller = caller().await;
        let id = verified_challenge(&caller, b"{\"days\":7}", "pending").await;
        let other_bytes = request(&caller, b"{\"days\":30}", Some(id));
        assert_eq!(
            gate(&caller, &other_bytes, "pending")
                .await
                .unwrap_err()
                .status()
                .as_u16(),
            401
        );

        let id = verified_challenge(&caller, b"{\"days\":7}", "pending").await;
        let same_bytes = request(&caller, b"{\"days\":7}", Some(id));
        assert_eq!(
            gate(&caller, &same_bytes, "approved")
                .await
                .unwrap_err()
                .status()
                .as_u16(),
            401
        );
    }

    /// An issued but unverified challenge authorizes nothing.
    #[actix_rt::test]
    async fn an_unverified_challenge_authorizes_nothing() {
        let caller = caller().await;
        let intent = TransactionIntent {
            action: "access_request.approve".to_string(),
            method: "POST".to_string(),
            path: "/api/access/requests/REQ-1/approve".to_string(),
            body_digest: txn::body_digest(b"{}"),
            resource_id: Some("REQ-1".to_string()),
            expected_state: Some("pending".to_string()),
            idempotency_key: Some("key-under-test".to_string()),
        };
        let issued =
            txn::issue_transaction_challenge(&caller.pool, &caller.user_id, caller.sid, &intent)
                .await
                .unwrap();
        let id = Uuid::parse_str(&issued.challenge_id).unwrap();
        let req = request(&caller, b"{}", Some(id));
        assert_eq!(
            gate(&caller, &req, "pending")
                .await
                .unwrap_err()
                .status()
                .as_u16(),
            401
        );
    }
}
