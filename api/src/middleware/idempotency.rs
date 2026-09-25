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

/// The same claim semantics, held in this process.
///
/// The guard above is PostgreSQL-only, and the middleware answered 503
/// `IDEMPOTENCY_STORAGE_UNAVAILABLE` whenever `AppState.db_pool` was `None`.
/// That is every request on the in-memory backend -- which `CLAUDE.md`
/// documents as the default for dev and demo -- so **every authenticated
/// mutation in the API failed** there, and CI's `E2E (memory backend)` job had
/// been red since the guard landed.
///
/// This is deliberately NOT a bypass. The key is still required, a replay is
/// still refused as `IDEMPOTENCY_DUPLICATE`, and a key reused for a different
/// body is still refused as `IDEMPOTENCY_KEY_REUSED`. What changes is only the
/// durability tier, and it changes to match the backend it serves: on the
/// memory backend the patient records themselves do not survive a restart, so
/// claims that do not survive one either are consistent with the guarantee that
/// mode already offers. It buys nothing to fail closed on the durability of a
/// claim protecting a write that is itself volatile.
///
/// Selection is on the repository backend, not on `db_pool.is_some()`. A
/// PostgreSQL deployment that has lost its pool is a real outage and must keep
/// failing closed with 503 -- it must not quietly degrade to in-process claims,
/// which would let a restart erase the replay protection a live deployment is
/// relying on.
#[derive(Default)]
pub struct MemoryOperationStore {
    claims: std::sync::Mutex<std::collections::HashMap<OperationKey, MemoryClaim>>,
}

type OperationKey = (String, String, String, String);

struct MemoryClaim {
    digest: String,
    expires_at: chrono::DateTime<chrono::Utc>,
}

impl MemoryOperationStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn claim(
        &self,
        subject: &str,
        method: &str,
        route: &str,
        key: &str,
        digest: &str,
    ) -> ClaimResult {
        let now = chrono::Utc::now();
        let id: OperationKey = (
            subject.to_string(),
            method.to_string(),
            route.to_string(),
            key.to_string(),
        );
        let mut claims = match self.claims.lock() {
            Ok(guard) => guard,
            // A poisoned lock means a previous holder panicked. Recovering the
            // guard is right here: the map is a plain HashMap that cannot be
            // left half-updated by a panic between statements, and refusing
            // every subsequent mutation for the life of the process is a worse
            // outcome than continuing.
            Err(poisoned) => poisoned.into_inner(),
        };
        match claims.get(&id) {
            Some(existing) if existing.expires_at > now => {
                if existing.digest == digest {
                    ClaimResult::Duplicate
                } else {
                    ClaimResult::DigestMismatch
                }
            }
            // Absent, or present but expired: claim it.
            _ => {
                claims.insert(
                    id,
                    MemoryClaim {
                        digest: digest.to_string(),
                        expires_at: now + chrono::Duration::hours(OPERATION_TTL_HOURS),
                    },
                );
                ClaimResult::Claimed
            }
        }
    }

    /// Drops a claim whose request was refused, mirroring `release_failed_claim`.
    /// Without this a client that fixes a 400 and retries with the same key --
    /// the obvious thing to do -- would be told its corrected request is a
    /// duplicate.
    fn release(&self, subject: &str, method: &str, route: &str, key: &str) {
        let id: OperationKey = (
            subject.to_string(),
            method.to_string(),
            route.to_string(),
            key.to_string(),
        );
        let mut claims = match self.claims.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        claims.remove(&id);
    }

    /// Evicts expired claims. Called on each claim so a long-lived process does
    /// not grow the map without bound; the map is small and this is O(n) over
    /// live claims only.
    fn evict_expired(&self) {
        let now = chrono::Utc::now();
        let mut claims = match self.claims.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        claims.retain(|_, claim| claim.expires_at > now);
    }
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
        // Both the durable store and the in-process one are resolved here,
        // before the request is moved into the async block. Which one applies
        // is decided by the repository backend, not by whether a pool happens
        // to exist -- see `MemoryOperationStore`.
        let state = req.app_data::<web::Data<crate::state::AppState>>().cloned();
        let on_memory_backend = state.as_ref().is_some_and(|state| {
            state.repositories.backend == crate::repositories::StorageBackend::Memory
        });
        let pool = state.as_ref().and_then(|state| state.db_pool.clone());

        Box::pin(async move {
            let Some(subject) = subject else {
                return Ok(req.into_response(operation_error(
                    "IDEMPOTENCY_AUTH_REQUIRED",
                    "Authentication is required for an idempotent mutation",
                )));
            };
            if pool.is_none() && !on_memory_backend {
                return Ok(req.into_response(HttpResponse::ServiceUnavailable().json(
                    crate::middleware::error_handling::error_envelope_json(
                        "IDEMPOTENCY_STORAGE_UNAVAILABLE",
                        "Durable idempotency storage is unavailable",
                        None,
                    ),
                )));
            }
            let key = key.expect("participating request has an idempotency key");
            let mut body = BytesMut::new();
            let mut payload = req.take_payload();
            while let Some(chunk) = payload.next().await {
                body.extend_from_slice(&chunk?);
            }
            let body: Bytes = body.freeze();
            let digest = digest_request(&subject, &method, &route, &key, &body);
            req.set_payload(Payload::from(body));

            let claim = match &pool {
                Some(pool) => claim_operation(pool, &subject, &method, &route, &key, &digest).await,
                None => {
                    let store = &state
                        .as_ref()
                        .expect("memory backend implies application state")
                        .idempotency_memory;
                    store.evict_expired();
                    Ok(store.claim(&subject, &method, &route, &key, &digest))
                }
            };
            match claim {
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
            match &pool {
                Some(pool) => {
                    if status.is_success() {
                        complete_operation(pool, &subject, &method, &route, &key).await;
                    } else if status.is_client_error() {
                        release_failed_claim(pool, &subject, &method, &route, &key).await;
                    }
                }
                None => {
                    // The memory store records no completion marker: nothing
                    // reads one, because a duplicate is refused on the presence
                    // of a live claim rather than on its state.
                    if status.is_client_error() {
                        state
                            .as_ref()
                            .expect("memory backend implies application state")
                            .idempotency_memory
                            .release(&subject, &method, &route, &key);
                    }
                }
            }
            Ok(response.map_into_boxed_body())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The memory store exists because the durable guard 503'd every
    // authenticated mutation on the in-memory backend. These assert it is a
    // real guard and not a way around one.

    fn claim(store: &MemoryOperationStore, key: &str, digest: &str) -> ClaimResult {
        store.claim("actor-a", "POST", "/api/orders", key, digest)
    }

    #[test]
    fn memory_store_claims_a_first_operation() {
        let store = MemoryOperationStore::new();
        assert_eq!(claim(&store, "key-1", "digest-1"), ClaimResult::Claimed);
    }

    #[test]
    fn memory_store_refuses_a_replay() {
        let store = MemoryOperationStore::new();
        assert_eq!(claim(&store, "key-1", "digest-1"), ClaimResult::Claimed);
        assert_eq!(claim(&store, "key-1", "digest-1"), ClaimResult::Duplicate);
    }

    #[test]
    fn memory_store_refuses_a_key_reused_for_a_different_body() {
        let store = MemoryOperationStore::new();
        assert_eq!(claim(&store, "key-1", "digest-1"), ClaimResult::Claimed);
        assert_eq!(
            claim(&store, "key-1", "digest-2"),
            ClaimResult::DigestMismatch
        );
    }

    #[test]
    fn memory_store_scopes_claims_to_subject_method_and_route() {
        let store = MemoryOperationStore::new();
        assert_eq!(claim(&store, "key-1", "digest-1"), ClaimResult::Claimed);
        // Same key, different actor / verb / path: each is a distinct operation
        // and must not be refused as somebody else's replay.
        for (subject, method, route) in [
            ("actor-b", "POST", "/api/orders"),
            ("actor-a", "PUT", "/api/orders"),
            ("actor-a", "POST", "/api/notes"),
        ] {
            assert_eq!(
                store.claim(subject, method, route, "key-1", "digest-1"),
                ClaimResult::Claimed,
                "{subject} {method} {route} should be its own operation"
            );
        }
    }

    #[test]
    fn memory_store_releases_a_refused_claim_so_a_corrected_retry_works() {
        let store = MemoryOperationStore::new();
        assert_eq!(claim(&store, "key-1", "digest-1"), ClaimResult::Claimed);
        store.release("actor-a", "POST", "/api/orders", "key-1");
        // The client fixed a 400 and retried with the same key, which is the
        // obvious thing to do. It must not be told its corrected request is a
        // duplicate.
        assert_eq!(claim(&store, "key-1", "digest-2"), ClaimResult::Claimed);
    }

    #[test]
    fn memory_store_reclaims_an_expired_operation() {
        let store = MemoryOperationStore::new();
        assert_eq!(claim(&store, "key-1", "digest-1"), ClaimResult::Claimed);
        // Age the claim past its TTL rather than sleeping for a day.
        {
            let mut claims = store.claims.lock().expect("claims lock");
            let entry = claims.values_mut().next().expect("one claim");
            entry.expires_at = chrono::Utc::now() - chrono::Duration::seconds(1);
        }
        assert_eq!(claim(&store, "key-1", "digest-1"), ClaimResult::Claimed);
    }

    #[test]
    fn memory_store_evicts_expired_claims() {
        let store = MemoryOperationStore::new();
        assert_eq!(claim(&store, "key-1", "digest-1"), ClaimResult::Claimed);
        {
            let mut claims = store.claims.lock().expect("claims lock");
            let entry = claims.values_mut().next().expect("one claim");
            entry.expires_at = chrono::Utc::now() - chrono::Duration::seconds(1);
        }
        store.evict_expired();
        assert!(
            store.claims.lock().expect("claims lock").is_empty(),
            "an expired claim must not be retained indefinitely"
        );
    }

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
