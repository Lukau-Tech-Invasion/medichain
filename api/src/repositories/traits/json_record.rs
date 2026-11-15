//! The generic JSON-record store.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::common::RepositoryResult;

// =============================================================================
// PHASE 7 (Round 4): GENERIC JSON-RECORD DOMAINS
// =============================================================================
//
// Several feature domains (language preferences, eligibility checks, satisfaction
// surveys, symptom sessions, family groups, insurance claims, autopsy
// requests/reports, sync-queue items) previously lived only in volatile AppState
// HashMaps and were lost on restart. Their payloads are rich, heterogeneous
// structs whose full shape we want to preserve losslessly. Rather than model each
// with a bespoke column set, they share one JSON-blob entity: the full legacy
// struct is serialized into `data` (JSONB), with `id` + `owner_id` kept as
// queryable columns.

/// Generic JSON-blob record entity shared by the Phase-7 feature domains.
#[derive(Debug, Clone, Serialize, Deserialize, Default, sqlx::FromRow)]
pub struct JsonRecordEntity {
    /// Primary key (e.g. survey id, claim id, or owner id for singleton records).
    pub id: String,
    /// Owning entity id (patient id, user id, device id, deceased id, ...).
    pub owner_id: String,
    /// Full domain payload, serialized losslessly.
    pub data: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Generic repository for JSON-blob feature records.
///
/// `create` has upsert semantics (insert-or-replace by `id`) so singleton
/// records (e.g. one language preference per user) and status updates both work.
#[async_trait]
pub trait JsonRecordRepository: Send + Sync + fmt::Debug {
    /// Insert only if absent, atomically; a competing initial writer returns None.
    async fn create_if_absent(
        &self,
        record: JsonRecordEntity,
    ) -> RepositoryResult<Option<JsonRecordEntity>>;
    /// Insert or replace a record by `id`.
    async fn create(&self, record: JsonRecordEntity) -> RepositoryResult<JsonRecordEntity>;
    /// Fetch a single record by primary key.
    async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<JsonRecordEntity>>;
    /// Fetch all records owned by `owner_id`, newest first.
    async fn get_by_owner(&self, owner_id: &str) -> RepositoryResult<Vec<JsonRecordEntity>>;
    /// Fetch the records whose top-level `data` field `field` holds `value` as
    /// text, newest first (bounded like `get_by_owner`).
    ///
    /// For the second party to a record: a telehealth session is owned by the
    /// patient and names its clinician in `provider_id`, and an owner lookup by
    /// the clinician's user id can never find it.
    async fn get_by_data_field(
        &self,
        field: &str,
        value: &str,
    ) -> RepositoryResult<Vec<JsonRecordEntity>>;
    /// Fetch all records, newest first (bounded).
    async fn list_all(&self) -> RepositoryResult<Vec<JsonRecordEntity>>;
    /// Delete a record by id. Idempotent: deleting a missing id is `Ok(())`.
    async fn delete(&self, id: &str) -> RepositoryResult<()>;

    /// Replace a record **only if** one of its stored JSON fields still holds
    /// `expected`. Returns `Ok(None)` when the guard did not hold.
    ///
    /// This is the state-machine primitive for these tables. `create` is an
    /// unconditional upsert, so a handler that reads a record, checks its
    /// status and then writes it back has a read-modify-write race: two
    /// concurrent approvals both observe `Pending` and both commit, and the
    /// second silently overwrites the first. Expressing the guard *inside* the
    /// write makes the transition atomic — the same shape
    /// `RetentionExecutionRepository::decide_approval` already uses
    /// (`WHERE status = 'pending' AND requested_by <> $3`).
    ///
    /// `field` is a top-level key of the stored `data` object and is compared
    /// as text, so it must name a field whose JSON representation is a string.
    async fn replace_if_field_eq(
        &self,
        id: &str,
        field: &str,
        expected: &str,
        record: JsonRecordEntity,
    ) -> RepositoryResult<Option<JsonRecordEntity>>;
}
