//! MediChain API Middleware
//!
//! This module contains middleware for the MediChain API including:
//! - Rate limiting to prevent DoS attacks
//! - Signature authentication for wallet verification (SEC-005)
//! - Request validation
//! - Error handling utilities
//!
//! © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.

pub mod authorized_user;
pub mod encryption_policy;
pub mod error_handling;
pub mod idempotency;
pub mod jwt_identity;
pub mod metrics;
pub mod rate_limit;
pub mod security_headers;
pub mod session_state;
pub mod signature_auth;
pub mod versioning;

// Re-exports the handlers use through `crate::middleware::...`. The two
// middleware types are reached by their module paths in `main.rs`, so they are
// not re-exported here.
pub use authorized_user::AuthorizedUser;
pub use error_handling::*;
