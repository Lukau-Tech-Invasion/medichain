//! Explanation-of-benefits documents (WP7.3): the index of encrypted EOB files
//! filed against insurance claims. The bytes live, encrypted, in the IPFS
//! document pipeline; the table's CHECKs
//! (`20260926000004_claim_eob_documents.sql`) enforce type, size and scan
//! status.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::sync::RwLock;

use super::traits::{RepositoryError, RepositoryResult};

/// Most claim ids one listing may ask documents for, so no read is unbounded.
pub const MAX_CLAIMS_PER_EOB_READ: usize = 500;

/// One EOB document row, column for column.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct EobDocumentEntity {
    pub id: String,
    pub claim_id: String,
    pub patient_id: String,
    pub uploaded_by: String,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub ipfs_hash: String,
    pub metadata_hash: String,
    /// `clean` when a configured scanner passed it, `not_scanned` otherwise.
    pub scan_status: String,
    pub created_at: DateTime<Utc>,
}

/// Storage for EOB document rows.
#[async_trait]
pub trait EobDocumentRepository: Send + Sync + fmt::Debug {
    /// Store a new document row.
    async fn create(&self, document: EobDocumentEntity) -> RepositoryResult<EobDocumentEntity>;
    /// One document by id, or `None`.
    async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<EobDocumentEntity>>;
    /// Every document on any of `claim_ids`, newest first. At most
    /// [`MAX_CLAIMS_PER_EOB_READ`] ids are considered.
    async fn list_for_claims(
        &self,
        claim_ids: &[String],
    ) -> RepositoryResult<Vec<EobDocumentEntity>>;
}

/// In-memory EOB document rows.
#[derive(Debug, Default)]
pub struct MemoryEobDocumentRepository {
    rows: RwLock<HashMap<String, EobDocumentEntity>>,
}

impl MemoryEobDocumentRepository {
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
impl EobDocumentRepository for MemoryEobDocumentRepository {
    async fn create(&self, document: EobDocumentEntity) -> RepositoryResult<EobDocumentEntity> {
        let mut rows = self.rows.write().map_err(lock_error)?;
        if rows.contains_key(&document.id) {
            return Err(RepositoryError::Duplicate(document.id));
        }
        rows.insert(document.id.clone(), document.clone());
        Ok(document)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<EobDocumentEntity>> {
        Ok(self.rows.read().map_err(lock_error)?.get(id).cloned())
    }

    async fn list_for_claims(
        &self,
        claim_ids: &[String],
    ) -> RepositoryResult<Vec<EobDocumentEntity>> {
        let wanted: std::collections::HashSet<&String> =
            claim_ids.iter().take(MAX_CLAIMS_PER_EOB_READ).collect();
        let rows = self.rows.read().map_err(lock_error)?;
        let mut found: Vec<_> = rows
            .values()
            .filter(|row| wanted.contains(&row.claim_id))
            .cloned()
            .collect();
        found.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(found)
    }
}

#[cfg(feature = "postgres")]
pub use pg::PgEobDocumentRepository;

#[cfg(feature = "postgres")]
pub(crate) mod pg {
    //! PostgreSQL EOB document rows. Every value is bound.

    use super::*;
    use sqlx::PgPool;

    const COLUMNS: &str = "id, claim_id, patient_id, uploaded_by, filename, content_type, \
        size_bytes, sha256, ipfs_hash, metadata_hash, scan_status, created_at";

    /// PostgreSQL-backed [`EobDocumentRepository`].
    #[derive(Debug, Clone)]
    pub struct PgEobDocumentRepository {
        pool: PgPool,
    }

    impl PgEobDocumentRepository {
        /// Wrap a pool.
        pub fn new(pool: PgPool) -> Self {
            Self { pool }
        }
    }

    /// Insert a document row inside a caller's transaction.
    pub(crate) async fn insert_document(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        row: &EobDocumentEntity,
    ) -> RepositoryResult<EobDocumentEntity> {
        let sql = format!(
            "INSERT INTO claim_eob_documents
                (id, claim_id, patient_id, uploaded_by, filename, content_type, size_bytes,
                 sha256, ipfs_hash, metadata_hash, scan_status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING {COLUMNS}"
        );
        Ok(sqlx::query_as::<_, EobDocumentEntity>(&sql)
            .bind(&row.id)
            .bind(&row.claim_id)
            .bind(&row.patient_id)
            .bind(&row.uploaded_by)
            .bind(&row.filename)
            .bind(&row.content_type)
            .bind(row.size_bytes)
            .bind(&row.sha256)
            .bind(&row.ipfs_hash)
            .bind(&row.metadata_hash)
            .bind(&row.scan_status)
            .bind(row.created_at)
            .fetch_one(&mut **tx)
            .await?)
    }

    #[async_trait]
    impl EobDocumentRepository for PgEobDocumentRepository {
        async fn create(&self, document: EobDocumentEntity) -> RepositoryResult<EobDocumentEntity> {
            let mut tx = self.pool.begin().await?;
            let stored = insert_document(&mut tx, &document).await?;
            tx.commit().await?;
            Ok(stored)
        }

        async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<EobDocumentEntity>> {
            let sql = format!("SELECT {COLUMNS} FROM claim_eob_documents WHERE id = $1");
            Ok(sqlx::query_as::<_, EobDocumentEntity>(&sql)
                .bind(id)
                .fetch_optional(&self.pool)
                .await?)
        }

        async fn list_for_claims(
            &self,
            claim_ids: &[String],
        ) -> RepositoryResult<Vec<EobDocumentEntity>> {
            let bounded: Vec<&String> = claim_ids.iter().take(MAX_CLAIMS_PER_EOB_READ).collect();
            let sql = format!(
                "SELECT {COLUMNS} FROM claim_eob_documents
                 WHERE claim_id = ANY($1) ORDER BY created_at DESC"
            );
            Ok(sqlx::query_as::<_, EobDocumentEntity>(&sql)
                .bind(bounded)
                .fetch_all(&self.pool)
                .await?)
        }
    }
}

#[cfg(all(test, feature = "postgres"))]
mod pg_tests {
    use super::*;

    /// The database refuses a document for a patient who does not exist, and
    /// a type the intake would never accept.
    #[tokio::test]
    async fn test_pg_eob_document_rules_hold_in_the_database() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        sqlx::query(
            "INSERT INTO patients (id, health_id, national_id_hash, national_id_type)
             VALUES ('PAT-EOB', 'PAT-EOB', 'test-hash', 'SmartID') ON CONFLICT (id) DO NOTHING",
        )
        .execute(&pool)
        .await
        .unwrap();
        let repo = PgEobDocumentRepository::new(pool.clone());
        let row = |id: &str, patient: &str, content_type: &str| EobDocumentEntity {
            id: id.into(),
            claim_id: "CLM-EOB".into(),
            patient_id: patient.into(),
            uploaded_by: "admin_pg".into(),
            filename: "eob.pdf".into(),
            content_type: content_type.into(),
            size_bytes: 2048,
            sha256: "b".repeat(64),
            ipfs_hash: "bafyeob".into(),
            metadata_hash: "bafymeta".into(),
            scan_status: "clean".into(),
            created_at: Utc::now(),
        };
        repo.create(row("EOB-OK", "PAT-EOB", "application/pdf"))
            .await
            .unwrap();
        assert!(repo
            .create(row("EOB-NOBODY", "PAT-NOBODY", "application/pdf"))
            .await
            .is_err());
        assert!(repo
            .create(row("EOB-SVG", "PAT-EOB", "image/svg+xml"))
            .await
            .is_err());
        let listed = repo
            .list_for_claims(&["CLM-EOB".to_string()])
            .await
            .unwrap();
        assert_eq!(listed.len(), 1);
        pool.close().await;
    }
}
