//! User models for PostgreSQL database
//!
//! These models match the database schema and are used for SQLx queries.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// =============================================================================
// DATABASE MODELS (match PostgreSQL schema)
// =============================================================================

/// User stored in PostgreSQL database.
///
/// Horizon HZ-014: the `users` table's schema-level `password_hash` column
/// (a vestige of the original hackathon schema's "optional email
/// authentication" design) is deliberately not modeled here — this codebase's
/// real, sole auth mechanism is wallet + Sr25519 signature (see `CLAUDE.md`),
/// and no code anywhere reads or writes a password hash (confirmed by grep:
/// `password_hash` appears nowhere in `api/src` outside this file before this
/// change, and `AppState::persist_user`'s `INSERT INTO users` column list
/// never included it). Omitting the field is safe with `SELECT *` — sqlx
/// simply doesn't map an unmodeled column into the struct.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DbUser {
    pub id: Uuid,
    pub wallet_address: String,
    pub email: Option<String>,
    pub role: String,
    pub name: Option<String>,
    pub username: Option<String>,
    pub blockchain_address: Option<String>,
    pub blockchain_tx_hash: Option<String>,
    pub is_active: bool,
    /// Account status: `active | inactive | suspended | pending`.
    ///
    /// Authoritative, and the reason this column exists: `is_active` alone
    /// cannot represent `suspended`/`pending`, so persisting through the
    /// boolean silently promoted both back to `active` on restart (H1 / D-1).
    /// A DB constraint ties `is_active` to `status = 'active'`.
    pub status: String,
    pub email_verified: bool,
    pub last_login_at: Option<DateTime<Utc>>,
    pub login_count: i32,
    pub linked_patient_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub created_by: Option<String>,
}

/// A user joined to the professional half of their profile.
///
/// H1 (issue #7): the logical user spans `users` and `user_profiles`, so
/// reloading it needs both. Only the professional attributes are carried —
/// `phone` and the other HZ-014 plaintext-PII columns are deliberately not
/// read into the runtime model, because nothing writes them and surfacing
/// them would imply a round trip that does not occur.
#[derive(Debug, Clone, FromRow)]
pub struct DbUserWithProfile {
    #[sqlx(flatten)]
    pub user: DbUser,
    pub department: Option<String>,
    pub specialty: Option<String>,
    pub license_number: Option<String>,
}

/// User profile with extended information.
///
/// **Horizon HZ-014 (data-minimization audit, WP8):** `first_name`, `last_name`,
/// `date_of_birth`, `phone`, and the `address_*` fields are stored in
/// PLAINTEXT in the `user_profiles` table — unlike the equivalent patient
/// fields (`PatientEntity.first_name_encrypted` etc.), which are encrypted at
/// rest via `EncryptionKeyring`/`enc_patient_field` (see `types/domain.rs`).
/// The only write path into this table (`services::user_service::UserService`)
/// was proven dead — never instantiated anywhere in this binary — and has
/// been removed as part of this finding's resolution, so there is now no code
/// path anywhere capable of writing to this table at all; it is read-only
/// (`handlers::auth_challenge`), populated only by whatever a DBA inserts
/// directly. If a staff-profile write feature is ever built, these fields
/// MUST be encrypted the same way patient fields already are before any new
/// write path is connected. Do not remove this table speculatively (CLAUDE.md:
/// never delete without asking) — the read path is live.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DbUserProfile {
    pub id: Uuid,
    pub user_id: Uuid,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub date_of_birth: Option<NaiveDate>,
    pub phone: Option<String>,
    pub address_line1: Option<String>,
    pub address_line2: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub license_number: Option<String>,
    pub specialty: Option<String>,
    pub department: Option<String>,
    pub preferences: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
