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
//! © 2025-2026 Trustware. All rights reserved.

use actix_web::{
    body::EitherBody,
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    Error, HttpResponse,
};
use futures::future::{ok, LocalBoxFuture, Ready};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
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
pub struct RateLimitMiddleware {
    config: RateLimitConfig,
}

#[allow(dead_code)]
impl RateLimitMiddleware {
    pub fn new(config: RateLimitConfig) -> Self {
        Self { config }
    }

    pub fn default_config() -> Self {
        Self {
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
            // Per-instance rate limit tracking (in production, use Redis)
            rate_limits: Rc::new(RefCell::new(HashMap::new())),
        })
    }
}

pub struct RateLimitMiddlewareService<S> {
    service: Rc<S>,
    config: RateLimitConfig,
    rate_limits: Rc<RefCell<HashMap<String, RateLimitEntry>>>,
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
                let mut limits = rate_limits.borrow_mut();

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
            }; // borrow_mut is dropped here

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

/// Extract client identifier from request
fn get_client_identifier(req: &ServiceRequest) -> String {
    // Prefer user ID from header if present
    if let Some(user_id) = req.headers().get("X-User-Id") {
        if let Ok(id) = user_id.to_str() {
            return format!("user:{}", id);
        }
    }

    // Fall back to IP address
    req.connection_info()
        .realip_remote_addr()
        .map(|ip| format!("ip:{}", ip))
        .unwrap_or_else(|| "unknown".to_string())
}

/// Determine rate limit based on user role
fn get_rate_limit(req: &ServiceRequest, config: &RateLimitConfig) -> u32 {
    // Check for X-User-Role header (set by auth middleware in production)
    if let Some(role) = req.headers().get("X-User-Role") {
        if let Ok(role_str) = role.to_str() {
            return match role_str.to_lowercase().as_str() {
                "admin" => config.admin_limit,
                "doctor" | "nurse" | "labtechnician" | "pharmacist" => config.authenticated_limit,
                _ => config.anonymous_limit,
            };
        }
    }

    // Check if user ID is present (basic authentication)
    if req.headers().get("X-User-Id").is_some() {
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
}
