//! Database models for MediChain
//!
//! Provides database-backed models that match the PostgreSQL schema.

pub mod user;

// Re-export commonly used types
#[allow(unused_imports)]
pub use user::{DbSession, DbUser, DbUserProfile, UserResponse};
