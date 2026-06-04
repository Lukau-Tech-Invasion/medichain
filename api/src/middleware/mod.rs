//! MediChain API Middleware
//!
//! This module contains middleware for the MediChain API including:
//! - Rate limiting to prevent DoS attacks
//! - Signature authentication for wallet verification (SEC-005)
//! - Request validation
//! - Error handling utilities
//!
//! © 2025-2026 Trustware. All rights reserved.

pub mod error_handling;
pub mod idempotency;
pub mod metrics;
pub mod rate_limit;
pub mod security_headers;
pub mod signature_auth;
pub mod versioning;

// Re-exports for convenience - allow unused as these are public API ready for use
#[allow(unused_imports)]
pub use error_handling::*;
#[allow(unused_imports)]
pub use rate_limit::RateLimitMiddleware;
#[allow(unused_imports)]
pub use signature_auth::{generate_auth_challenge, AuthChallenge, SignatureAuthMiddleware};
