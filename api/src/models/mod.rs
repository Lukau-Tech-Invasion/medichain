//! Database models for MediChain
//!
//! Provides database-backed models that match the PostgreSQL schema.

pub mod user;

// Re-export commonly used types. `DbUserProfile` is intentionally not
// re-exported here — its only consumer (`handlers::auth_challenge`) reaches
// it via the fully-qualified `crate::models::user::DbUserProfile` path.
pub use user::DbUser;
