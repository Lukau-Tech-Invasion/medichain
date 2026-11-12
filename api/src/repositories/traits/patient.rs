//! Patients.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::{PaginatedResult, Pagination, RepositoryResult};

/// Patient entity (database model)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PatientEntity {
    pub id: String,
    pub health_id: String,
    pub national_id_hash: String,
    pub national_id_type: String,

    // Encrypted fields stored as bytes
    #[serde(skip_serializing)]
    pub first_name_encrypted: Option<Vec<u8>>,
    #[serde(skip_serializing)]
    pub last_name_encrypted: Option<Vec<u8>>,
    #[serde(skip_serializing)]
    pub date_of_birth_encrypted: Option<Vec<u8>>,

    pub gender: Option<String>,
    pub blood_type: Option<String>,

    #[serde(skip_serializing)]
    pub phone_encrypted: Option<Vec<u8>>,
    #[serde(skip_serializing)]
    pub email_encrypted: Option<Vec<u8>>,
    #[serde(skip_serializing)]
    pub address_encrypted: Option<Vec<u8>>,

    #[serde(skip_serializing)]
    pub emergency_contact_name_encrypted: Option<Vec<u8>>,
    #[serde(skip_serializing)]
    pub emergency_contact_phone_encrypted: Option<Vec<u8>>,
    pub emergency_contact_relationship: Option<String>,

    pub organ_donor: bool,
    pub dnr_status: bool,

    /// DNR advance-directive verification metadata (typed columns for query/search).
    /// The authoritative copy round-trips losslessly in `profile_extras_encrypted`;
    /// these mirror it so a `DO NOT RESUSCITATE` directive is only treated as
    /// verified when `dnr_verified_by` and `dnr_verified_at` are both present.
    #[serde(default)]
    pub dnr_verified_by: Option<String>,
    #[serde(default)]
    pub dnr_verified_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub dnr_document_ref: Option<String>,

    pub primary_provider_id: Option<String>,

    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub registered_by: Option<String>,
    pub is_verified: bool,
    pub is_active: bool,

    /// Full `PatientProfile` (address, insurance, doctors, preferences, advanced
    /// directives, structured emergency_info) serialized to JSON and encrypted
    /// with ChaCha20-Poly1305. Lossless source of truth on read; a real persisted
    /// column so it survives a PostgreSQL round-trip.
    #[serde(skip_serializing)]
    #[serde(default)]
    pub profile_extras_encrypted: Option<Vec<u8>>,

    /// Keyed blind-index tokens for the patient's name. These are not
    /// reversible plaintext, but do reveal equality of equal name tokens to a
    /// party that can read this column; never serialize them to clients.
    #[serde(skip_serializing)]
    #[serde(default)]
    pub name_search_tokens: Vec<String>,

    /// Which `ENCRYPTION_KEYS` version the encrypted fields above were sealed
    /// with (Phase 6.3 — key rotation). Rows written before this column existed
    /// default to `1`. New writes stamp the keyring's current version; reads
    /// decrypt with whichever version the row carries.
    #[serde(default = "default_key_version")]
    pub key_version: i32,
}

fn default_key_version() -> i32 {
    1
}

/// Patient repository trait
#[async_trait]
pub trait PatientRepository: Send + Sync + fmt::Debug {
    /// Create a new patient
    async fn create(&self, patient: PatientEntity) -> RepositoryResult<PatientEntity>;

    /// Get patient by ID
    async fn get_by_id(&self, id: &str) -> RepositoryResult<PatientEntity>;

    /// Get patient by health ID
    async fn get_by_health_id(&self, health_id: &str) -> RepositoryResult<PatientEntity>;

    /// Get patient by national ID hash
    async fn get_by_national_id_hash(&self, hash: &str) -> RepositoryResult<PatientEntity>;

    /// Update patient
    async fn update(&self, patient: PatientEntity) -> RepositoryResult<PatientEntity>;

    /// Delete patient (soft delete - sets is_active = false)
    async fn delete(&self, id: &str) -> RepositoryResult<()>;

    /// List patients with pagination
    async fn list(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>>;

    /// List a stable page ordered by `updated_at DESC, id ASC`.
    ///
    /// The cursor is the final row from the preceding page. Keeping this at
    /// the repository boundary prevents a roster handler from loading and
    /// decrypting an arbitrary national register just to paginate it.
    async fn list_keyset(
        &self,
        cursor: Option<(DateTime<Utc>, String)>,
        limit: u32,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>>;

    /// Search patients by identifier or keyed name-token equality.
    async fn search(
        &self,
        query: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>>;

    /// Search a stable page by identifier or keyed name-token equality.
    async fn search_keyset(
        &self,
        query: &str,
        cursor: Option<(DateTime<Utc>, String)>,
        limit: u32,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>>;

    /// Get patients by provider
    async fn get_by_provider(
        &self,
        provider_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>>;

    /// Count total patients
    async fn count(&self) -> RepositoryResult<u64>;

    /// Patients whose name index is empty, ordered by id, after `after_id`.
    ///
    /// Rows written before the blind index existed have no tokens, and SQL
    /// cannot compute them: the name is sealed under the application keyring.
    /// `patient_name_index::backfill_missing_name_index` pages through these.
    async fn list_unindexed_names(
        &self,
        after_id: Option<&str>,
        limit: u32,
    ) -> RepositoryResult<Vec<PatientEntity>>;

    /// Set a patient's name-search tokens and nothing else.
    ///
    /// Not even `updated_at`: indexing is not a change to the patient, and the
    /// roster is ordered by it.
    async fn set_name_search_tokens(&self, id: &str, tokens: &[String]) -> RepositoryResult<()>;

    /// Count active patients grouped by administrative gender.
    ///
    /// Aggregated in the query rather than by listing every patient and
    /// counting in Rust: the population analytics endpoint needs the shape of
    /// the cohort, not its rows, and loading a national register into memory to
    /// produce four integers does not scale past a demo.
    ///
    /// Patients who did not supply a gender are counted under `"not_recorded"`
    /// so the buckets always sum to the population — a distribution that
    /// silently drops them misstates every proportion derived from it.
    async fn count_by_gender(&self) -> RepositoryResult<std::collections::HashMap<String, u64>>;
}
