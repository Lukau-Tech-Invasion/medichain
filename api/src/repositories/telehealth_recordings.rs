//! Telehealth recordings (WP7.6): the index of encrypted consultation
//! recordings. The bytes live, encrypted, in the IPFS document pipeline; the
//! table's CHECKs (`20260926000007_telehealth_recordings.sql`) enforce type,
//! size, and that both consents precede the start of recording.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::sync::RwLock;

use super::traits::{RepositoryError, RepositoryResult};

/// The retention policy recordings fall under: the ordinary clinical record.
pub const RECORDING_RETENTION_ENTITY: &str = "clinical_record";

/// One recording row, column for column.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct TelehealthRecordingEntity {
    pub id: String,
    pub session_id: String,
    pub patient_id: String,
    pub provider_id: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub ipfs_hash: String,
    pub metadata_hash: String,
    pub provider_consented_at: DateTime<Utc>,
    pub patient_consented_at: DateTime<Utc>,
    pub recording_started_at: DateTime<Utc>,
    pub retention_entity_type: String,
    pub created_at: DateTime<Utc>,
}

impl TelehealthRecordingEntity {
    /// Whether both consents were given no later than recording started (the
    /// same rule as the table's CHECK, so memory storage refuses it too).
    pub fn consent_precedes_start(&self) -> bool {
        self.provider_consented_at <= self.recording_started_at
            && self.patient_consented_at <= self.recording_started_at
    }
}

/// Storage for recording rows.
#[async_trait]
pub trait TelehealthRecordingRepository: Send + Sync + fmt::Debug {
    /// Store a new recording row.
    async fn create(
        &self,
        recording: TelehealthRecordingEntity,
    ) -> RepositoryResult<TelehealthRecordingEntity>;
    /// One recording by id, or `None`.
    async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<TelehealthRecordingEntity>>;
    /// Every recording of one session, newest first.
    async fn list_for_session(
        &self,
        session_id: &str,
    ) -> RepositoryResult<Vec<TelehealthRecordingEntity>>;
}

/// In-memory recording rows.
#[derive(Debug, Default)]
pub struct MemoryTelehealthRecordingRepository {
    rows: RwLock<HashMap<String, TelehealthRecordingEntity>>,
}

impl MemoryTelehealthRecordingRepository {
    /// An empty store.
    pub fn new() -> Self {
        Self::default()
    }
}

/// Map a poisoned lock to a storage error rather than panicking a worker.
fn lock_error<T>(error: std::sync::PoisonError<T>) -> RepositoryError {
    RepositoryError::Database(error.to_string())
}

#[async_trait]
impl TelehealthRecordingRepository for MemoryTelehealthRecordingRepository {
    async fn create(
        &self,
        recording: TelehealthRecordingEntity,
    ) -> RepositoryResult<TelehealthRecordingEntity> {
        if !recording.consent_precedes_start() {
            return Err(RepositoryError::Validation(
                "a recording's consents must precede its start".into(),
            ));
        }
        let mut rows = self.rows.write().map_err(lock_error)?;
        if rows.contains_key(&recording.id) {
            return Err(RepositoryError::Duplicate(recording.id));
        }
        rows.insert(recording.id.clone(), recording.clone());
        Ok(recording)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<TelehealthRecordingEntity>> {
        Ok(self.rows.read().map_err(lock_error)?.get(id).cloned())
    }

    async fn list_for_session(
        &self,
        session_id: &str,
    ) -> RepositoryResult<Vec<TelehealthRecordingEntity>> {
        let rows = self.rows.read().map_err(lock_error)?;
        let mut found: Vec<_> = rows
            .values()
            .filter(|row| row.session_id == session_id)
            .cloned()
            .collect();
        found.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(found)
    }
}

#[cfg(feature = "postgres")]
pub use pg::PgTelehealthRecordingRepository;

#[cfg(feature = "postgres")]
pub(crate) mod pg {
    //! PostgreSQL recording rows. Every value is bound.

    use super::*;
    use sqlx::PgPool;

    const COLUMNS: &str = "id, session_id, patient_id, provider_id, content_type, size_bytes, \
        sha256, ipfs_hash, metadata_hash, provider_consented_at, patient_consented_at, \
        recording_started_at, retention_entity_type, created_at";

    /// PostgreSQL-backed [`TelehealthRecordingRepository`].
    #[derive(Debug, Clone)]
    pub struct PgTelehealthRecordingRepository {
        pool: PgPool,
    }

    impl PgTelehealthRecordingRepository {
        /// Wrap a pool.
        pub fn new(pool: PgPool) -> Self {
            Self { pool }
        }
    }

    /// Insert a recording row inside a caller's transaction.
    pub(crate) async fn insert_recording(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        row: &TelehealthRecordingEntity,
    ) -> RepositoryResult<TelehealthRecordingEntity> {
        let sql = format!(
            "INSERT INTO telehealth_recordings ({COLUMNS})
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING {COLUMNS}"
        );
        Ok(sqlx::query_as::<_, TelehealthRecordingEntity>(&sql)
            .bind(&row.id)
            .bind(&row.session_id)
            .bind(&row.patient_id)
            .bind(&row.provider_id)
            .bind(&row.content_type)
            .bind(row.size_bytes)
            .bind(&row.sha256)
            .bind(&row.ipfs_hash)
            .bind(&row.metadata_hash)
            .bind(row.provider_consented_at)
            .bind(row.patient_consented_at)
            .bind(row.recording_started_at)
            .bind(&row.retention_entity_type)
            .bind(row.created_at)
            .fetch_one(&mut **tx)
            .await?)
    }

    #[async_trait]
    impl TelehealthRecordingRepository for PgTelehealthRecordingRepository {
        async fn create(
            &self,
            recording: TelehealthRecordingEntity,
        ) -> RepositoryResult<TelehealthRecordingEntity> {
            let mut tx = self.pool.begin().await?;
            let stored = insert_recording(&mut tx, &recording).await?;
            tx.commit().await?;
            Ok(stored)
        }

        async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<TelehealthRecordingEntity>> {
            let sql = format!("SELECT {COLUMNS} FROM telehealth_recordings WHERE id = $1");
            Ok(sqlx::query_as::<_, TelehealthRecordingEntity>(&sql)
                .bind(id)
                .fetch_optional(&self.pool)
                .await?)
        }

        async fn list_for_session(
            &self,
            session_id: &str,
        ) -> RepositoryResult<Vec<TelehealthRecordingEntity>> {
            let sql = format!(
                "SELECT {COLUMNS} FROM telehealth_recordings
                 WHERE session_id = $1 ORDER BY created_at DESC"
            );
            Ok(sqlx::query_as::<_, TelehealthRecordingEntity>(&sql)
                .bind(session_id)
                .fetch_all(&self.pool)
                .await?)
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A recording whose consents precede its start by `lead` seconds (a
    /// negative lead puts the consent after the start).
    pub(crate) fn recording(id: &str, patient: &str, lead: i64) -> TelehealthRecordingEntity {
        let started = Utc::now() - chrono::Duration::minutes(30);
        let consented = started - chrono::Duration::seconds(lead);
        TelehealthRecordingEntity {
            id: id.into(),
            session_id: "TH-REC".into(),
            patient_id: patient.into(),
            provider_id: "doctor_rec".into(),
            content_type: "video/mp4".into(),
            size_bytes: 4096,
            sha256: "c".repeat(64),
            ipfs_hash: "bafyrec".into(),
            metadata_hash: "bafymeta".into(),
            provider_consented_at: consented,
            patient_consented_at: consented,
            recording_started_at: started,
            retention_entity_type: RECORDING_RETENTION_ENTITY.into(),
            created_at: Utc::now(),
        }
    }

    #[tokio::test]
    async fn memory_storage_refuses_a_recording_consented_after_it_started() {
        let repo = MemoryTelehealthRecordingRepository::new();
        repo.create(recording("REC-1", "PAT-REC", 60))
            .await
            .unwrap();
        assert!(repo
            .create(recording("REC-2", "PAT-REC", -60))
            .await
            .is_err());
        assert!(repo
            .create(recording("REC-1", "PAT-REC", 60))
            .await
            .is_err());
        assert_eq!(repo.list_for_session("TH-REC").await.unwrap().len(), 1);
    }
}

#[cfg(all(test, feature = "postgres"))]
mod pg_tests {
    use super::tests::recording;
    use super::*;

    /// The database refuses consent after the start, an unknown patient, and
    /// a type the ingest would never accept.
    #[tokio::test]
    async fn test_pg_recording_rules_hold_in_the_database() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        sqlx::query(
            "INSERT INTO patients (id, health_id, national_id_hash, national_id_type)
             VALUES ('PAT-REC', 'PAT-REC', 'test-hash', 'SmartID') ON CONFLICT (id) DO NOTHING",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM telehealth_recordings WHERE session_id = 'TH-REC'")
            .execute(&pool)
            .await
            .unwrap();
        let repo = PgTelehealthRecordingRepository::new(pool.clone());
        repo.create(recording("REC-PG-OK", "PAT-REC", 60))
            .await
            .unwrap();
        // The memory guard is bypassed here: this is the database's own CHECK.
        assert!(repo
            .create(recording("REC-PG-LATE", "PAT-REC", -60))
            .await
            .is_err());
        assert!(repo
            .create(recording("REC-PG-NOBODY", "PAT-NOBODY", 60))
            .await
            .is_err());
        let mut audio = recording("REC-PG-WAV", "PAT-REC", 60);
        audio.content_type = "audio/wav".into();
        assert!(repo.create(audio).await.is_err());
        assert_eq!(repo.list_for_session("TH-REC").await.unwrap().len(), 1);
        pool.close().await;
    }
}
