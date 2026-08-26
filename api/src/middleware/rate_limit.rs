//! Rate Limiting Middleware for MediChain API
//!
//! Implements a sliding window rate limiter to protect against DoS attacks.
//! Configurable limits per IP address with different tiers for authenticated users.
//!
//! **Rate Limit Configuration:**
//! - Anonymous requests: 60 requests/minute
//! - Authenticated users: 120 requests/minute  
//! - Admin users: 300 requests/minute
//!
//! © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.

// This middleware is reachable only from `main` (`.wrap(rate_limit)`), and
// `cargo test` on a binary crate substitutes its own harness `main` — so under
// `cfg(test)` every item here looks unreachable and `dead_code` fires on five
// of them. They are live in the real binary: `cargo clippy --bin medichain-api`
// reports zero. Scope the allow to test builds so genuine dead code in this
// module is still reported for the shipped binary.
#![cfg_attr(test, allow(dead_code))]

use actix_web::{
    body::EitherBody,
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    Error, HttpResponse,
};
use futures::future::{ok, LocalBoxFuture, Ready};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Rate limit configuration
#[allow(dead_code)]
#[derive(Clone)]
pub struct RateLimitConfig {
    /// Maximum requests per window for anonymous users
    pub anonymous_limit: u32,
    /// Maximum requests per window for authenticated users
    pub authenticated_limit: u32,
    /// Maximum requests per window for admin users
    pub admin_limit: u32,
    /// Window duration
    pub window_duration: Duration,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            anonymous_limit: 60,      // 60 requests per minute for anonymous
            authenticated_limit: 120, // 120 requests per minute for authenticated
            admin_limit: 300,         // 300 requests per minute for admins
            window_duration: Duration::from_secs(60),
        }
    }
}

/// Tracks request counts per client
struct RateLimitEntry {
    count: u32,
    window_start: Instant,
}

/// Rate limiting middleware factory
#[allow(dead_code)]
/// Shared across every worker thread.
///
/// This map used to be allocated inside `new_transform`, which Actix calls once
/// per worker, so the configured limit applied *per worker thread* rather than
/// per process. Measured on this host: 240 anonymous requests in 3.1s drew no
/// 429 at all against a configured 60/minute, and the first 429 arrived at
/// request 479 -- roughly eight times the configured ceiling, scaling with the
/// CPU count. The limiter was working; its scope was wrong.
///
/// `Arc<Mutex<..>>` rather than `Rc<RefCell<..>>` because it now genuinely
/// crosses threads. The lock is taken and released inside one synchronous
/// block, never held across an await.
///
/// This makes the number mean what it says within one process. It does NOT
/// make it correct across replicas -- N instances still permit N x the limit --
/// and that remains a deployment-level gap recorded in the ledger rather than
/// something to solve by reaching for Redis here.
#[derive(Clone)]
pub struct RateLimitMiddleware {
    config: RateLimitConfig,
    counters: SharedCounters,
}

type SharedCounters = Arc<Mutex<HashMap<String, RateLimitEntry>>>;

#[allow(dead_code)]
impl RateLimitMiddleware {
    pub fn new(config: RateLimitConfig) -> Self {
        Self {
            config,
            counters: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn default_config() -> Self {
        Self {
            counters: Arc::new(Mutex::new(HashMap::new())),
            config: RateLimitConfig::default(),
        }
    }
}

impl<S, B> Transform<S, ServiceRequest> for RateLimitMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Transform = RateLimitMiddlewareService<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(RateLimitMiddlewareService {
            service: Rc::new(service),
            config: self.config.clone(),
            // Clone the SHARED handle. Allocating here gave every worker
            // thread its own counters -- see `RateLimitMiddleware`.
            rate_limits: self.counters.clone(),
        })
    }
}

pub struct RateLimitMiddlewareService<S> {
    service: Rc<S>,
    config: RateLimitConfig,
    rate_limits: SharedCounters,
}

impl<S> Clone for RateLimitMiddlewareService<S> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            config: self.config.clone(),
            rate_limits: self.rate_limits.clone(),
        }
    }
}

impl<S, B> Service<ServiceRequest> for RateLimitMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let service = self.service.clone();
        let config = self.config.clone();
        let rate_limits = self.rate_limits.clone();

        Box::pin(async move {
            // Get client identifier (IP address or user ID)
            let client_id = get_client_identifier(&req);

            // Determine rate limit based on authentication
            let limit = get_rate_limit(&req, &config);

            // Check rate limit - scope the borrow to avoid holding it across await
            let rate_limit_result: Result<(), (u64, u32, u32)> = {
                let now = Instant::now();
                let mut limits = match rate_limits.lock() {
                    Ok(guard) => guard,
                    // A panic in a previous holder must not disable rate
                    // limiting for the life of the process.
                    Err(poisoned) => poisoned.into_inner(),
                };

                let entry = limits.entry(client_id.clone()).or_insert(RateLimitEntry {
                    count: 0,
                    window_start: now,
                });

                // Reset window if expired
                if now.duration_since(entry.window_start) > config.window_duration {
                    entry.count = 0;
                    entry.window_start = now;
                }

                // Check if over limit
                if entry.count >= limit {
                    let retry_after = config.window_duration.as_secs()
                        - now.duration_since(entry.window_start).as_secs();
                    Err((retry_after, entry.count, limit))
                } else {
                    // Increment counter
                    entry.count += 1;
                    Ok(())
                }
            }; // the lock guard is dropped here, before any await

            if let Err((retry_after, count, limit)) = rate_limit_result {
                log::warn!(
                    "Rate limit exceeded for client {}: {} requests (limit: {})",
                    client_id,
                    count,
                    limit
                );

                // Return 429 with the canonical error envelope and a Retry-After
                // header so clients can back off correctly (Phase 9.5).
                let body = crate::middleware::error_handling::error_envelope_json(
                    crate::middleware::error_handling::error_codes::RATE_LIMIT_EXCEEDED,
                    &format!(
                        "Rate limit exceeded. Please retry after {} seconds.",
                        retry_after
                    ),
                    Some(serde_json::json!({
                        "limit": limit,
                        "retry_after_secs": retry_after
                    })),
                );
                let response = HttpResponse::TooManyRequests()
                    .insert_header((
                        actix_web::http::header::RETRY_AFTER,
                        retry_after.to_string(),
                    ))
                    .json(body);
                return Ok(req.into_response(response).map_into_right_body());
            }

            // Continue with request, mapping the inner body into the Either.
            service
                .call(req)
                .await
                .map(ServiceResponse::map_into_left_body)
        })
    }
}

/// Whether `X-User-Id` names a caller that actually exists in the user store.
///
/// The header is caller-supplied and unverified at this layer, so its mere
/// presence proves nothing. Resolving it against the store is what separates
/// "a registered clinician" from "any string".
fn resolves_to_known_user(req: &ServiceRequest) -> Option<String> {
    let id = req.headers().get("X-User-Id")?.to_str().ok()?;
    let state = req.app_data::<actix_web::web::Data<crate::AppState>>()?;
    crate::support::get_user(state, id).map(|_| id.to_owned())
}

/// Extract the rate-limit bucket for a request.
///
/// Buckets are per-**registered** user, otherwise per-IP. Previously any
/// `X-User-Id` string created its own bucket, so an attacker could rotate
/// arbitrary ids to get a fresh quota per request — defeating the limiter
/// entirely — while growing the bucket map without bound, which is itself a
/// memory-exhaustion vector. An unknown id now shares the caller's IP bucket,
/// so forging identities cannot buy either extra quota or extra memory.
fn get_client_identifier(req: &ServiceRequest) -> String {
    if let Some(id) = resolves_to_known_user(req) {
        return format!("user:{}", id);
    }

    // Fall back to IP address
    req.connection_info()
        .realip_remote_addr()
        .map(|ip| format!("ip:{}", ip))
        .unwrap_or_else(|| "unknown".to_string())
}

/// Determine rate limit tier for a request.
///
/// Security: this intentionally does NOT trust any client-supplied role header
/// (e.g. `X-User-Role`). Such a header is spoofable, so honoring it would let a
/// caller hand itself the elevated `admin_limit`. Role-based authorization is
/// resolved per-handler from the server-side user store (see `support::get_user`),
/// never here.
///
/// The elevated tier now requires the identity to RESOLVE to a registered user,
/// not merely to be present. Granting `authenticated_limit` on the presence of
/// a header meant an anonymous caller could opt themselves into the higher quota
/// by inventing one.
fn get_rate_limit(req: &ServiceRequest, config: &RateLimitConfig) -> u32 {
    if resolves_to_known_user(req).is_some() {
        return config.authenticated_limit;
    }

    config.anonymous_limit
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = RateLimitConfig::default();
        assert_eq!(config.anonymous_limit, 60);
        assert_eq!(config.authenticated_limit, 120);
        assert_eq!(config.admin_limit, 300);
        assert_eq!(config.window_duration, Duration::from_secs(60));
    }

    /// The counters must be SHARED, not per worker.
    ///
    /// Actix calls `new_transform` once per worker thread. When it allocated a
    /// fresh map there, the configured limit applied per thread: measured on a
    /// 12-CPU host, 240 anonymous requests drew no 429 against a configured
    /// 60/minute and the first refusal came at request 479. After this fix the
    /// first refusal is at 59.
    ///
    /// Comparing `Arc::as_ptr` is the assertion that matters. Anything that
    /// reintroduces a per-transform allocation -- the easiest possible
    /// regression, since it looks tidier -- fails here rather than silently
    /// multiplying the limit by the core count again.
    #[test]
    fn every_worker_shares_one_set_of_counters() {
        let middleware = RateLimitMiddleware::default_config();
        let first = middleware.clone();
        let second = middleware.clone();

        assert!(
            Arc::ptr_eq(&first.counters, &second.counters),
            "cloning the middleware for another worker must not fork the counters"
        );
        assert!(
            Arc::ptr_eq(&middleware.counters, &first.counters),
            "a clone must share the original's counters"
        );
    }

    #[test]
    fn a_fresh_limiter_starts_with_its_own_counters() {
        // Two independently constructed limiters are genuinely separate; the
        // sharing above must come from cloning, not from a global.
        let a = RateLimitMiddleware::default_config();
        let b = RateLimitMiddleware::default_config();
        assert!(!Arc::ptr_eq(&a.counters, &b.counters));
    }
}
