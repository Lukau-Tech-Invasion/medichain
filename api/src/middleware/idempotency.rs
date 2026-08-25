//! Durable idempotency-operation guard.
//!
//! A mutation bearing an `Idempotency-Key` is claimed in PostgreSQL using the
//! authenticated subject, method, route, key, and request-body digest. The
//! claim survives process restart and replica routing. We deliberately do not
//! persist response bodies because they may contain PHI; a duplicate receives a
//! conflict and the client must read the authoritative resource instead.
//!
//! This guard prevents duplicate execution. Individual high-risk write paths
//! still need transactional coupling of their business write and audit/outbox
//! record before they can claim end-to-end exactly-once completion semantics.

use actix_web::{
    body::{BoxBody, MessageBody},
    dev::{forward_ready, Payload, Service, ServiceRequest, ServiceResponse, Transform},
    http::Method,
    web, Error, HttpMessage, HttpResponse,
};
use bytes::{Bytes, BytesMut};
use futures::{
    future::{ok, LocalBoxFuture, Ready},
    StreamExt,
};
use sha3::{Digest, Sha3_256};
use std::rc::Rc;
use uuid::Uuid;

const OPERATION_TTL_HOURS: i64 = 24;

#[derive(Debug, PartialEq, Eq)]
enum ClaimResult {
    Claimed,
    Duplicate,
    DigestMismatch,
}

fn digest_request(subject: &str, method: &str, route: &str, key: &str, body: &[u8]) -> String {
    let mut hasher = Sha3_256::new();
    for part in [
        subject.as_bytes(),
        method.as_bytes(),
        route.as_bytes(),
        key.as_bytes(),
        body,
    ] {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part);
    }
    format!("{:x}", hasher.finalize())
}

async fn claim_operation(
    pool: &sqlx::PgPool,
    subject: &str,
    method: &str,
    route: &str,
    key: &str,
    digest: &str,
) -> Result<ClaimResult, sqlx::Error> {
    let claimed = sqlx::query(
        "INSERT INTO idempotency_operations
             (id, subject, method, route, idempotency_key, request_digest, state, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'processing', NOW() + ($7 * INTERVAL '1 hour'))
         ON CONFLICT (subject, method, route, idempotency_key) DO UPDATE
         SET id = EXCLUDED.id,
             request_digest = EXCLUDED.request_digest,
             state = 'processing',
             created_at = NOW(),
             updated_at = NOW(),
             expires_at = EXCLUDED.expires_at
         WHERE idempotency_operations.expires_at <= NOW()",
    )
    .bind(Uuid::new_v4())
    .bind(subject)
    .bind(method)
    .bind(route)
    .bind(key)
    .bind(digest)
    .bind(OPERATION_TTL_HOURS)
    .execute(pool)
    .await?;
    if claimed.rows_affected() == 1 {
        return Ok(ClaimResult::Claimed);
    }

    let existing_digest = sqlx::query_scalar::<_, String>(
        "SELECT request_digest FROM idempotency_operations
         WHERE subject = $1 AND method = $2 AND route = $3 AND idempotency_key = $4
           AND expires_at > NOW()",
    )
    .bind(subject)
    .bind(method)
    .bind(route)
    .bind(key)
    .fetch_optional(pool)
    .await?;
    Ok(match existing_digest {
        Some(existing) if existing == digest => ClaimResult::Duplicate,
        Some(_) => ClaimResult::DigestMismatch,
        // A concurrent transaction may still hold the expired row's unique key
        // while the reclaiming upsert is in progress. Fail closed rather than
        // allowing a second execution in that narrow race.
        None => ClaimResult::Duplicate,
    })
}

async fn complete_operation(
    pool: &sqlx::PgPool,
    subject: &str,
    method: &str,
    route: &str,
    key: &str,
) {
    if let Err(error) = sqlx::query(
        "UPDATE idempotency_operations SET state = 'completed', updated_at = NOW()
         WHERE subject = $1 AND method = $2 AND route = $3 AND idempotency_key = $4",
    )
    .bind(subject)
    .bind(method)
    .bind(route)
    .bind(key)
    .execute(pool)
    .await
    {
        log::error!("idempotency completion marker failed: {error}");
    }
}

async fn release_failed_claim(
    pool: &sqlx::PgPool,
    subject: &str,
    method: &str,
    route: &str,
    key: &str,
) {
    if let Err(error) = sqlx::query(
        "DELETE FROM idempotency_operations
         WHERE subject = $1 AND method = $2 AND route = $3 AND idempotency_key = $4
           AND state = 'processing'",
    )
    .bind(subject)
    .bind(method)
    .bind(route)
    .bind(key)
    .execute(pool)
    .await
    {
        log::error!("idempotency failed-claim release failed: {error}");
    }
}

fn operation_error(code: &str, message: &str) -> HttpResponse {
    HttpResponse::Conflict().json(crate::middleware::error_handling::error_envelope_json(
        code, message, None,
    ))
}

/// Endpoints whose whole purpose is to establish a subject, and which therefore
/// cannot present one on the way in.
///
/// Deliberately an explicit list. Skipping subject-keyed idempotency wherever a
/// subject happens to be absent would let any caller opt out by omitting their
/// credentials, which is the opposite of what this middleware is for.
const ESTABLISHES_IDENTITY: &[&str] = &[
    "/api/auth/challenge",
    "/api/auth/jwt",
    "/api/auth/jwt/refresh",
    "/api/auth/staff/login",
    "/api/auth/register",
    "/api/auth/demo-login",
];

fn mutation_requires_key(method: &Method, subject: Option<&str>, key: Option<&str>) -> bool {
    matches!(
        *method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    ) && subject.is_some()
        && key.is_none()
}

pub struct IdempotencyMiddleware;

impl<S, B> Transform<S, ServiceRequest> for IdempotencyMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<BoxBody>;
    type Error = Error;
    type Transform = IdempotencyMiddlewareService<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(IdempotencyMiddlewareService {
            service: Rc::new(service),
        })
    }
}

pub struct IdempotencyMiddlewareService<S> {
    service: Rc<S>,
}

impl<S, B> Service<ServiceRequest> for IdempotencyMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<BoxBody>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, mut req: ServiceRequest) -> Self::Future {
        let service = self.service.clone();
        let key = req
            .headers()
            .get("Idempotency-Key")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let method = req.method().as_str().to_owned();
        let route = req.path().to_owned();
        let subject = crate::support::get_current_user_id(req.request());
        if mutation_requires_key(req.method(), subject.as_deref(), key.as_deref()) {
            return Box::pin(async move {
                Ok(req.into_response(operation_error(
                    "IDEMPOTENCY_KEY_REQUIRED",
                    "Authenticated mutations require an Idempotency-Key",
                )))
            });
        }
        // Idempotency records are keyed per subject, so a request that has no
        // subject cannot participate. For an authenticated mutation that is a
        // hard error -- the identity went missing and the replay guarantee
        // cannot be honoured. For the handful of endpoints that establish
        // identity in the first place it is simply the normal case: sign-in has
        // no subject until it succeeds, so demanding one made every credential
        // login fail with IDEMPOTENCY_AUTH_REQUIRED the moment the client
        // attached a key. Those endpoints carry their own replay protection --
        // single-use challenges consumed in the same transaction that issues the
        // token -- which is stronger than a client-supplied key would be.
        let establishes_identity = ESTABLISHES_IDENTITY.contains(&route.as_str());
        let participates = matches!(
            *req.method(),
            Method::POST | Method::PUT | Method::PATCH | Method::DELETE
        ) && key.is_some()
            && !(subject.is_none() && establishes_identity);
        if !participates {
            return Box::pin(async move { Ok(service.call(req).await?.map_into_boxed_body()) });
        }
        let pool = req
            .app_data::<web::Data<crate::state::AppState>>()
            .and_then(|state| state.db_pool.clone());

        Box::pin(async move {
            let Some(subject) = subject else {
                return Ok(req.into_response(operation_error(
                    "IDEMPOTENCY_AUTH_REQUIRED",
                    "Authentication is required for an idempotent mutation",
                )));
            };
            let Some(pool) = pool else {
                return Ok(req.into_response(HttpResponse::ServiceUnavailable().json(
                    crate::middleware::error_handling::error_envelope_json(
                        "IDEMPOTENCY_STORAGE_UNAVAILABLE",
                        "Durable idempotency storage is unavailable",
                        None,
                    ),
                )));
            };
            let key = key.expect("participating request has an idempotency key");
            let mut body = BytesMut::new();
            let mut payload = req.take_payload();
            while let Some(chunk) = payload.next().await {
                body.extend_from_slice(&chunk?);
            }
            let body: Bytes = body.freeze();
            let digest = digest_request(&subject, &method, &route, &key, &body);
            req.set_payload(Payload::from(body));

            match claim_operation(&pool, &subject, &method, &route, &key, &digest).await {
                Ok(ClaimResult::Claimed) => {}
                Ok(ClaimResult::Duplicate) => {
                    return Ok(req.into_response(operation_error(
                        "IDEMPOTENCY_DUPLICATE",
                        "This operation was already submitted; read the resource before retrying",
                    )));
                }
                Ok(ClaimResult::DigestMismatch) => {
                    return Ok(req.into_response(operation_error(
                        "IDEMPOTENCY_KEY_REUSED",
                        "This idempotency key belongs to a different request",
                    )));
                }
                Err(error) => {
                    log::error!("idempotency claim failed: {error}");
                    return Ok(req.into_response(HttpResponse::ServiceUnavailable().json(
                        crate::middleware::error_handling::error_envelope_json(
                            "IDEMPOTENCY_STORAGE_UNAVAILABLE",
                            "Durable idempotency storage is unavailable",
                            None,
                        ),
                    )));
                }
            }
            let response = service.call(req).await?;
            let status = response.status();
            if status.is_success() {
                complete_operation(&pool, &subject, &method, &route, &key).await;
            } else if status.is_client_error() {
                release_failed_claim(&pool, &subject, &method, &route, &key).await;
            }
            Ok(response.map_into_boxed_body())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digest_binds_subject_route_key_and_body() {
        let base = digest_request("actor-a", "POST", "/api/orders", "key-1", b"one");
        assert_ne!(
            base,
            digest_request("actor-b", "POST", "/api/orders", "key-1", b"one")
        );
        assert_ne!(
            base,
            digest_request("actor-a", "POST", "/api/orders", "key-1", b"two")
        );
        assert_ne!(
            base,
            digest_request("actor-a", "POST", "/api/notes", "key-1", b"one")
        );
    }

    #[test]
    fn authenticated_mutations_require_an_operation_key() {
        assert!(mutation_requires_key(&Method::POST, Some("actor-a"), None));
        assert!(mutation_requires_key(
            &Method::DELETE,
            Some("actor-a"),
            None
        ));
        assert!(!mutation_requires_key(&Method::GET, Some("actor-a"), None));
        assert!(!mutation_requires_key(&Method::POST, None, None));
        assert!(!mutation_requires_key(
            &Method::POST,
            Some("actor-a"),
            Some("operation-a")
        ));
    }
}
