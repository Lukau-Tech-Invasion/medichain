//! Database models for MediChain
//!
//! Provides database-backed models that match the PostgreSQL schema.

pub mod user;

// Re-export commonly used types. `DbUserProfile` is intentionally not
// re-exported here — its only consumer (`handlers::auth_challenge`) reaches
// it via the fully-qualified `crate::models::user::DbUserProfile` path.
// `DbUser` is no longer re-exported here: H1 replaced its only consumer
// (`load_demo_users_from_db`) with `DbUserWithProfile`, which carries it as a
// flattened field. The type itself is unchanged and still reachable as
// `crate::models::user::DbUser` — only the now-unused re-export is gone, which
// in a binary crate clippy reports as an unused import.
pub use user::DbUserWithProfile;
