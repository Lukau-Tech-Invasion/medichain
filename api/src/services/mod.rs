//! Services for MediChain API
//!
//! Contains business logic for authentication and blockchain sync.
//!
//! Horizon HZ-014: `user_service` (a Postgres-backed `UserService` with a
//! `upsert_profile` method writing PII in plaintext) was removed here —
//! proven dead (nothing ever constructed a `UserService`; the live user
//! read/write paths are `AppState::persist_user`/`load_demo_users_from_db`
//! in `state.rs`, which predate and superseded it).

pub mod transcription;
