//! Prescription refill requests (WP7.1).
//!
//! A patient asks for a refill on a prescription with refills left; a doctor
//! approves it (the original's `refills_remaining` goes down by one and a new,
//! unsigned prescription linked to it is created) or denies it with a reason
//! the patient sees; the patient may cancel while it is open.
//!
//! The status machine and "one open request per prescription" are enforced by
//! the database (`20260926000002_prescription_refill_requests.sql`); the memory
//! backend mirrors them so handler tests exercise the same rules.
//!
//! The multi-table transitions (request + audit, approval + prescriptions +
//! audit) are `RepositoryContainer` methods, following
//! `apply_prescription_mutation`: one transaction on PostgreSQL, or the shared
//! prescription workflow lock on the memory backend.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::sync::RwLock;

use super::traits::{AccessLogEntity, JsonRecordEntity, RepositoryError, RepositoryResult};

/// Upper bound on any refill list read, so no query is unbounded.
pub const MAX_REFILL_REQUESTS_PER_READ: usize = 200;

/// Where a refill request is in its life. Stored as lowercase text; the
/// database CHECK allows exactly these four values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RefillRequestStatus {
    Requested,
    Approved,
    Denied,
    Cancelled,
}

impl RefillRequestStatus {
    /// The stored text form. Returns the value the database CHECK accepts.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Requested => "requested",
            Self::Approved => "approved",
            Self::Denied => "denied",
            Self::Cancelled => "cancelled",
        }
    }

    /// Parse the stored text form. Returns `None` for anything unrecognised,
    /// which callers treat as corrupt data rather than guessing a status.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "requested" => Some(Self::Requested),
            "approved" => Some(Self::Approved),
            "denied" => Some(Self::Denied),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

/// One stored refill request, column for column.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct RefillRequestEntity {
    pub id: String,
    pub prescription_id: String,
    pub patient_id: String,
    pub prescriber_id: String,
    /// The medicine's name when the request was made.
    pub medication_name: String,
    pub requested_by: String,
    /// Text form of [`RefillRequestStatus`].
    pub status: String,
    pub patient_note: Option<String>,
    pub decided_by: Option<String>,
    pub decided_at: Option<DateTime<Utc>>,
    pub denial_reason: Option<String>,
    pub new_prescription_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Closing an open request: approve, deny or cancel.
#[derive(Debug, Clone)]
pub struct RefillClosure {
    pub request_id: String,
    pub status: RefillRequestStatus,
    pub decided_by: String,
    pub decided_at: DateTime<Utc>,
    pub denial_reason: Option<String>,
    pub new_prescription_id: Option<String>,
}

/// Everything an approval writes, as one unit.
#[derive(Debug, Clone)]
pub struct RefillApproval {
    pub closure: RefillClosure,
    pub original_prescription_id: String,
    /// `refills_remaining` as read before the change; the write is refused if
    /// it has moved since (another approval or edit got there first).
    pub expected_refills_remaining: String,
    pub updated_original: JsonRecordEntity,
    pub new_prescription: JsonRecordEntity,
    pub audit: AccessLogEntity,
}

/// Storage for refill requests.
#[async_trait]
pub trait RefillRequestRepository: Send + Sync + fmt::Debug {
    /// Store a new open request. `Duplicate` if the prescription already has one.
    async fn create(&self, request: RefillRequestEntity) -> RepositoryResult<RefillRequestEntity>;
    /// One request by id, or `None`.
    async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<RefillRequestEntity>>;
    /// A patient's requests, newest first, at most [`MAX_REFILL_REQUESTS_PER_READ`].
    async fn list_by_patient(&self, patient_id: &str)
        -> RepositoryResult<Vec<RefillRequestEntity>>;
    /// Open requests on one prescriber's prescriptions, oldest first.
    async fn list_open_by_prescriber(
        &self,
        prescriber_id: &str,
    ) -> RepositoryResult<Vec<RefillRequestEntity>>;
    /// Close the request if it is still open. `None` when it was not open.
    async fn close_if_open(
        &self,
        closure: &RefillClosure,
    ) -> RepositoryResult<Option<RefillRequestEntity>>;
}

/// In-memory refill requests, with the database's rules mirrored.
#[derive(Debug, Default)]
pub struct MemoryRefillRequestRepository {
    requests: RwLock<HashMap<String, RefillRequestEntity>>,
}

impl MemoryRefillRequestRepository {
    /// An empty store.
    pub fn new() -> Self {
        Self::default()
    }
}

/// Map a poisoned lock to a storage error rather than panicking a worker.
fn lock_error<T>(error: std::sync::PoisonError<T>) -> RepositoryError {
    RepositoryError::Database(error.to_string())
}

/// Apply a closure's fields to a stored request (memory backend).
fn apply_closure(request: &mut RefillRequestEntity, closure: &RefillClosure) {
    request.status = closure.status.as_str().to_string();
    request.decided_by = Some(closure.decided_by.clone());
    request.decided_at = Some(closure.decided_at);
    request.denial_reason = closure.denial_reason.clone();
    request.new_prescription_id = closure.new_prescription_id.clone();
    request.updated_at = closure.decided_at;
}

#[async_trait]
impl RefillRequestRepository for MemoryRefillRequestRepository {
    async fn create(&self, request: RefillRequestEntity) -> RepositoryResult<RefillRequestEntity> {
        let mut requests = self.requests.write().map_err(lock_error)?;
        // Mirrors uq_prescription_refill_one_open_request.
        let open_exists = requests.values().any(|existing| {
            existing.prescription_id == request.prescription_id
                && existing.status == RefillRequestStatus::Requested.as_str()
        });
        if open_exists || requests.contains_key(&request.id) {
            return Err(RepositoryError::Duplicate(
                "an open refill request already exists".into(),
            ));
        }
        requests.insert(request.id.clone(), request.clone());
        Ok(request)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<RefillRequestEntity>> {
        Ok(self.requests.read().map_err(lock_error)?.get(id).cloned())
    }

    async fn list_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<RefillRequestEntity>> {
        let requests = self.requests.read().map_err(lock_error)?;
        let mut found: Vec<_> = requests
            .values()
            .filter(|request| request.patient_id == patient_id)
            .cloned()
            .collect();
        found.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        found.truncate(MAX_REFILL_REQUESTS_PER_READ);
        Ok(found)
    }

    async fn list_open_by_prescriber(
        &self,
        prescriber_id: &str,
    ) -> RepositoryResult<Vec<RefillRequestEntity>> {
        let requests = self.requests.read().map_err(lock_error)?;
        let mut found: Vec<_> = requests
            .values()
            .filter(|request| {
                request.prescriber_id == prescriber_id
                    && request.status == RefillRequestStatus::Requested.as_str()
            })
            .cloned()
            .collect();
        found.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        found.truncate(MAX_REFILL_REQUESTS_PER_READ);
        Ok(found)
    }

    async fn close_if_open(
        &self,
        closure: &RefillClosure,
    ) -> RepositoryResult<Option<RefillRequestEntity>> {
        let mut requests = self.requests.write().map_err(lock_error)?;
        let Some(request) = requests.get_mut(&closure.request_id) else {
            return Ok(None);
        };
        if request.status != RefillRequestStatus::Requested.as_str() {
            return Ok(None);
        }
        apply_closure(request, closure);
        Ok(Some(request.clone()))
    }
}

#[cfg(feature = "postgres")]
pub use pg::PgRefillRequestRepository;

#[cfg(feature = "postgres")]
pub(crate) mod pg {
    //! PostgreSQL refill requests. Every value is bound; no SQL is built from
    //! request data.

    use super::*;
    use sqlx::PgPool;

    const COLUMNS: &str =
        "id, prescription_id, patient_id, prescriber_id, medication_name, requested_by, status, \
        patient_note, decided_by, decided_at, denial_reason, new_prescription_id, created_at, \
        updated_at";

    /// PostgreSQL-backed [`RefillRequestRepository`].
    #[derive(Debug, Clone)]
    pub struct PgRefillRequestRepository {
        pool: PgPool,
    }

    impl PgRefillRequestRepository {
        /// Wrap a pool.
        pub fn new(pool: PgPool) -> Self {
            Self { pool }
        }
    }

    /// Insert a request inside a caller's transaction.
    pub(crate) async fn insert_request(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        request: &RefillRequestEntity,
    ) -> RepositoryResult<RefillRequestEntity> {
        let sql = format!(
            "INSERT INTO prescription_refill_requests
                (id, prescription_id, patient_id, prescriber_id, medication_name,
                 requested_by, status, patient_note, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING {COLUMNS}"
        );
        Ok(sqlx::query_as::<_, RefillRequestEntity>(&sql)
            .bind(&request.id)
            .bind(&request.prescription_id)
            .bind(&request.patient_id)
            .bind(&request.prescriber_id)
            .bind(&request.medication_name)
            .bind(&request.requested_by)
            .bind(&request.status)
            .bind(&request.patient_note)
            .bind(request.created_at)
            .bind(request.updated_at)
            .fetch_one(&mut **tx)
            .await?)
    }

    /// Close a request inside a caller's transaction, only if still open.
    pub(crate) async fn close_request(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        closure: &RefillClosure,
    ) -> RepositoryResult<Option<RefillRequestEntity>> {
        let sql = format!(
            "UPDATE prescription_refill_requests
             SET status = $2, decided_by = $3, decided_at = $4, denial_reason = $5,
                 new_prescription_id = $6, updated_at = $4
             WHERE id = $1 AND status = 'requested'
             RETURNING {COLUMNS}"
        );
        Ok(sqlx::query_as::<_, RefillRequestEntity>(&sql)
            .bind(&closure.request_id)
            .bind(closure.status.as_str())
            .bind(&closure.decided_by)
            .bind(closure.decided_at)
            .bind(&closure.denial_reason)
            .bind(&closure.new_prescription_id)
            .fetch_optional(&mut **tx)
            .await?)
    }

    #[async_trait]
    impl RefillRequestRepository for PgRefillRequestRepository {
        async fn create(
            &self,
            request: RefillRequestEntity,
        ) -> RepositoryResult<RefillRequestEntity> {
            let mut tx = self.pool.begin().await?;
            let stored = insert_request(&mut tx, &request).await?;
            tx.commit().await?;
            Ok(stored)
        }

        async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<RefillRequestEntity>> {
            let sql = format!("SELECT {COLUMNS} FROM prescription_refill_requests WHERE id = $1");
            Ok(sqlx::query_as::<_, RefillRequestEntity>(&sql)
                .bind(id)
                .fetch_optional(&self.pool)
                .await?)
        }

        async fn list_by_patient(
            &self,
            patient_id: &str,
        ) -> RepositoryResult<Vec<RefillRequestEntity>> {
            let sql = format!(
                "SELECT {COLUMNS} FROM prescription_refill_requests
                 WHERE patient_id = $1 ORDER BY created_at DESC LIMIT $2"
            );
            Ok(sqlx::query_as::<_, RefillRequestEntity>(&sql)
                .bind(patient_id)
                .bind(MAX_REFILL_REQUESTS_PER_READ as i64)
                .fetch_all(&self.pool)
                .await?)
        }

        async fn list_open_by_prescriber(
            &self,
            prescriber_id: &str,
        ) -> RepositoryResult<Vec<RefillRequestEntity>> {
            let sql = format!(
                "SELECT {COLUMNS} FROM prescription_refill_requests
                 WHERE prescriber_id = $1 AND status = 'requested'
                 ORDER BY created_at ASC LIMIT $2"
            );
            Ok(sqlx::query_as::<_, RefillRequestEntity>(&sql)
                .bind(prescriber_id)
                .bind(MAX_REFILL_REQUESTS_PER_READ as i64)
                .fetch_all(&self.pool)
                .await?)
        }

        async fn close_if_open(
            &self,
            closure: &RefillClosure,
        ) -> RepositoryResult<Option<RefillRequestEntity>> {
            let mut tx = self.pool.begin().await?;
            let closed = close_request(&mut tx, closure).await?;
            tx.commit().await?;
            Ok(closed)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An open request on `prescription_id`, created `minutes_ago`.
    fn open_request(id: &str, prescription_id: &str, minutes_ago: i64) -> RefillRequestEntity {
        let at = Utc::now() - chrono::Duration::minutes(minutes_ago);
        RefillRequestEntity {
            id: id.into(),
            prescription_id: prescription_id.into(),
            patient_id: "PAT-1".into(),
            prescriber_id: "DOC-1".into(),
            medication_name: "Amlodipine".into(),
            requested_by: "PAT-WALLET".into(),
            status: RefillRequestStatus::Requested.as_str().into(),
            patient_note: None,
            decided_by: None,
            decided_at: None,
            denial_reason: None,
            new_prescription_id: None,
            created_at: at,
            updated_at: at,
        }
    }

    fn cancel(request_id: &str) -> RefillClosure {
        RefillClosure {
            request_id: request_id.into(),
            status: RefillRequestStatus::Cancelled,
            decided_by: "PAT-WALLET".into(),
            decided_at: Utc::now(),
            denial_reason: None,
            new_prescription_id: None,
        }
    }

    #[test]
    fn status_text_round_trips_and_rejects_unknown_values() {
        for status in [
            RefillRequestStatus::Requested,
            RefillRequestStatus::Approved,
            RefillRequestStatus::Denied,
            RefillRequestStatus::Cancelled,
        ] {
            assert_eq!(RefillRequestStatus::parse(status.as_str()), Some(status));
        }
        assert_eq!(RefillRequestStatus::parse("Approved"), None);
    }

    #[tokio::test]
    async fn only_one_open_request_per_prescription() {
        let repo = MemoryRefillRequestRepository::new();
        repo.create(open_request("R1", "RX-1", 1)).await.unwrap();
        let second = repo.create(open_request("R2", "RX-1", 0)).await;
        assert!(matches!(second, Err(RepositoryError::Duplicate(_))));
        // A different prescription is unaffected.
        repo.create(open_request("R3", "RX-2", 0)).await.unwrap();
    }

    #[tokio::test]
    async fn a_closed_request_frees_the_prescription_and_cannot_close_twice() {
        let repo = MemoryRefillRequestRepository::new();
        repo.create(open_request("R1", "RX-1", 1)).await.unwrap();
        assert!(repo.close_if_open(&cancel("R1")).await.unwrap().is_some());
        assert!(repo.close_if_open(&cancel("R1")).await.unwrap().is_none());
        repo.create(open_request("R2", "RX-1", 0)).await.unwrap();
    }

    #[tokio::test]
    async fn prescriber_queue_holds_only_open_requests_oldest_first() {
        let repo = MemoryRefillRequestRepository::new();
        repo.create(open_request("NEW", "RX-1", 1)).await.unwrap();
        repo.create(open_request("OLD", "RX-2", 10)).await.unwrap();
        repo.create(open_request("DONE", "RX-3", 5)).await.unwrap();
        repo.close_if_open(&cancel("DONE")).await.unwrap();
        let queue = repo.list_open_by_prescriber("DOC-1").await.unwrap();
        let ids: Vec<_> = queue.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, ["OLD", "NEW"]);
    }
}

#[cfg(all(test, feature = "postgres"))]
mod pg_tests {
    //! The database's own rules, proven against a migrated schema: the
    //! one-open-request index, the denial CHECK, and an approval that writes
    //! nothing when the refill count has moved.

    use super::*;
    use crate::repositories::RepositoryContainer;

    const PATIENT: &str = "PAT-RF-PG";

    /// A migrated schema with one patient and prescription `rx_id` holding
    /// `refills` refills. Returns the pool and a container over it.
    async fn seeded(rx_id: &str, refills: u8) -> (sqlx::PgPool, RepositoryContainer) {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        sqlx::query(
            "INSERT INTO patients (id, health_id, national_id_hash, national_id_type)
             VALUES ($1, $1, 'test-hash', 'SmartID') ON CONFLICT (id) DO NOTHING",
        )
        .bind(PATIENT)
        .execute(&pool)
        .await
        .expect("seed patient");
        sqlx::query(
            "INSERT INTO e_prescription_v2_records (id, owner_id, data) VALUES ($1, $2, $3)",
        )
        .bind(rx_id)
        .bind(PATIENT)
        .bind(serde_json::json!({ "refills_remaining": refills, "status": "Dispensed" }))
        .execute(&pool)
        .await
        .expect("seed prescription");
        let container = RepositoryContainer::new_postgres(pool.clone())
            .await
            .unwrap();
        (pool, container)
    }

    fn request(id: &str, rx_id: &str) -> RefillRequestEntity {
        let now = Utc::now();
        RefillRequestEntity {
            id: id.into(),
            prescription_id: rx_id.into(),
            patient_id: PATIENT.into(),
            prescriber_id: "DOC-PG".into(),
            medication_name: "Amlodipine".into(),
            requested_by: "PAT-WALLET".into(),
            status: RefillRequestStatus::Requested.as_str().into(),
            patient_note: None,
            decided_by: None,
            decided_at: None,
            denial_reason: None,
            new_prescription_id: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn audit(action: &str) -> AccessLogEntity {
        AccessLogEntity {
            id: format!("AUD-{}", uuid::Uuid::new_v4()),
            accessor_id: "DOC-PG".into(),
            accessor_role: "Doctor".into(),
            patient_id: Some(PATIENT.into()),
            resource_type: "patient_record".into(),
            resource_id: None,
            action: action.into(),
            access_reason: None,
            is_emergency_access: false,
            ip_address: None,
            user_agent: None,
            blockchain_tx_hash: None,
            accessed_at: Utc::now(),
            facility_id: None,
        }
    }

    fn json_record(id: &str, refills: u8) -> JsonRecordEntity {
        let now = Utc::now();
        JsonRecordEntity {
            id: id.into(),
            owner_id: PATIENT.into(),
            data: serde_json::json!({ "refills_remaining": refills }),
            created_at: now,
            updated_at: now,
        }
    }

    fn approval(request_id: &str, rx_id: &str, new_id: &str, expected: &str) -> RefillApproval {
        RefillApproval {
            closure: RefillClosure {
                request_id: request_id.into(),
                status: RefillRequestStatus::Approved,
                decided_by: "DOC-PG".into(),
                decided_at: Utc::now(),
                denial_reason: None,
                new_prescription_id: Some(new_id.into()),
            },
            original_prescription_id: rx_id.into(),
            expected_refills_remaining: expected.into(),
            updated_original: json_record(rx_id, 1),
            new_prescription: json_record(new_id, 0),
            audit: audit("refill_approved"),
        }
    }

    #[tokio::test]
    async fn test_pg_refill_allows_only_one_open_request_per_prescription() {
        let (pool, repos) = seeded("RX-PG-1", 2).await;
        repos
            .create_refill_request(request("RF-1", "RX-PG-1"), audit("refill_requested"))
            .await
            .unwrap();
        let second = repos
            .create_refill_request(request("RF-2", "RX-PG-1"), audit("refill_requested"))
            .await;
        assert!(
            matches!(second, Err(RepositoryError::Duplicate(_))),
            "{second:?}"
        );
        pool.close().await;
    }

    #[tokio::test]
    async fn test_pg_refill_denial_without_a_reason_is_refused_by_the_database() {
        let (pool, repos) = seeded("RX-PG-2", 2).await;
        repos
            .create_refill_request(request("RF-3", "RX-PG-2"), audit("refill_requested"))
            .await
            .unwrap();
        let blank = RefillClosure {
            request_id: "RF-3".into(),
            status: RefillRequestStatus::Denied,
            decided_by: "DOC-PG".into(),
            decided_at: Utc::now(),
            denial_reason: Some("   ".into()),
            new_prescription_id: None,
        };
        assert!(repos
            .close_refill_request(blank, audit("refill_denied"))
            .await
            .is_err());
        let still = repos
            .refill_requests
            .get_by_id("RF-3")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(still.status, "requested");
        pool.close().await;
    }

    #[tokio::test]
    async fn test_pg_refill_approval_is_all_or_nothing() {
        let (pool, repos) = seeded("RX-PG-3", 2).await;
        repos
            .create_refill_request(request("RF-4", "RX-PG-3"), audit("refill_requested"))
            .await
            .unwrap();
        // The count moved (another approval won): nothing may be written.
        let stale = repos
            .approve_refill_request(approval("RF-4", "RX-PG-3", "RX-PG-NEW-A", "5"))
            .await
            .unwrap();
        assert!(stale.is_none());
        let orphan: Option<String> =
            sqlx::query_scalar("SELECT id FROM e_prescription_v2_records WHERE id = 'RX-PG-NEW-A'")
                .fetch_optional(&pool)
                .await
                .unwrap();
        assert!(
            orphan.is_none(),
            "the new prescription must roll back with the refused approval"
        );
        // The real count: the approval commits every part.
        let done = repos
            .approve_refill_request(approval("RF-4", "RX-PG-3", "RX-PG-NEW-B", "2"))
            .await
            .unwrap();
        assert_eq!(
            done.expect("approved").new_prescription_id.as_deref(),
            Some("RX-PG-NEW-B")
        );
        let remaining: Option<String> = sqlx::query_scalar("SELECT data ->> 'refills_remaining' FROM e_prescription_v2_records WHERE id = 'RX-PG-3'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(remaining.as_deref(), Some("1"));
        pool.close().await;
    }
}
