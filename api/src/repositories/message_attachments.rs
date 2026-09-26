//! Message attachments (WP7.2): the index of encrypted files attached to
//! secure messages. The bytes live, encrypted, in the IPFS document pipeline;
//! a row here says which message they belong to and what they are.
//!
//! The table's CHECK constraints (`20260926000003_message_attachments.sql`)
//! enforce the allowed types, the size cap and the scan status; the memory
//! backend stores what it is given, and the handler validates before either.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::sync::RwLock;

use super::traits::{RepositoryError, RepositoryResult};

/// Most message ids one listing may ask attachments for, so no read is unbounded.
pub const MAX_MESSAGES_PER_ATTACHMENT_READ: usize = 500;

/// One attachment row, column for column.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "postgres", derive(sqlx::FromRow))]
pub struct MessageAttachmentEntity {
    pub id: String,
    pub message_id: String,
    pub uploaded_by: String,
    pub patient_id: Option<String>,
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

/// Storage for attachment rows.
#[async_trait]
pub trait MessageAttachmentRepository: Send + Sync + fmt::Debug {
    /// Store a new attachment row.
    async fn create(
        &self,
        attachment: MessageAttachmentEntity,
    ) -> RepositoryResult<MessageAttachmentEntity>;
    /// One attachment by id, or `None`.
    async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<MessageAttachmentEntity>>;
    /// Every attachment on any of `message_ids`, oldest first. At most
    /// [`MAX_MESSAGES_PER_ATTACHMENT_READ`] ids are considered.
    async fn list_for_messages(
        &self,
        message_ids: &[String],
    ) -> RepositoryResult<Vec<MessageAttachmentEntity>>;
}

/// In-memory attachment rows.
#[derive(Debug, Default)]
pub struct MemoryMessageAttachmentRepository {
    rows: RwLock<HashMap<String, MessageAttachmentEntity>>,
}

impl MemoryMessageAttachmentRepository {
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
impl MessageAttachmentRepository for MemoryMessageAttachmentRepository {
    async fn create(
        &self,
        attachment: MessageAttachmentEntity,
    ) -> RepositoryResult<MessageAttachmentEntity> {
        let mut rows = self.rows.write().map_err(lock_error)?;
        if rows.contains_key(&attachment.id) {
            return Err(RepositoryError::Duplicate(attachment.id));
        }
        rows.insert(attachment.id.clone(), attachment.clone());
        Ok(attachment)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<MessageAttachmentEntity>> {
        Ok(self.rows.read().map_err(lock_error)?.get(id).cloned())
    }

    async fn list_for_messages(
        &self,
        message_ids: &[String],
    ) -> RepositoryResult<Vec<MessageAttachmentEntity>> {
        let wanted: std::collections::HashSet<&String> = message_ids
            .iter()
            .take(MAX_MESSAGES_PER_ATTACHMENT_READ)
            .collect();
        let rows = self.rows.read().map_err(lock_error)?;
        let mut found: Vec<_> = rows
            .values()
            .filter(|row| wanted.contains(&row.message_id))
            .cloned()
            .collect();
        found.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(found)
    }
}

#[cfg(feature = "postgres")]
pub use pg::PgMessageAttachmentRepository;

#[cfg(feature = "postgres")]
pub(crate) mod pg {
    //! PostgreSQL attachment rows. Every value is bound.

    use super::*;
    use sqlx::PgPool;

    const COLUMNS: &str = "id, message_id, uploaded_by, patient_id, filename, content_type, \
        size_bytes, sha256, ipfs_hash, metadata_hash, scan_status, created_at";

    /// PostgreSQL-backed [`MessageAttachmentRepository`].
    #[derive(Debug, Clone)]
    pub struct PgMessageAttachmentRepository {
        pool: PgPool,
    }

    impl PgMessageAttachmentRepository {
        /// Wrap a pool.
        pub fn new(pool: PgPool) -> Self {
            Self { pool }
        }
    }

    /// Insert an attachment row inside a caller's transaction.
    pub(crate) async fn insert_attachment(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        row: &MessageAttachmentEntity,
    ) -> RepositoryResult<MessageAttachmentEntity> {
        let sql = format!(
            "INSERT INTO message_attachments
                (id, message_id, uploaded_by, patient_id, filename, content_type, size_bytes,
                 sha256, ipfs_hash, metadata_hash, scan_status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING {COLUMNS}"
        );
        Ok(sqlx::query_as::<_, MessageAttachmentEntity>(&sql)
            .bind(&row.id)
            .bind(&row.message_id)
            .bind(&row.uploaded_by)
            .bind(&row.patient_id)
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
    impl MessageAttachmentRepository for PgMessageAttachmentRepository {
        async fn create(
            &self,
            attachment: MessageAttachmentEntity,
        ) -> RepositoryResult<MessageAttachmentEntity> {
            let mut tx = self.pool.begin().await?;
            let stored = insert_attachment(&mut tx, &attachment).await?;
            tx.commit().await?;
            Ok(stored)
        }

        async fn get_by_id(&self, id: &str) -> RepositoryResult<Option<MessageAttachmentEntity>> {
            let sql = format!("SELECT {COLUMNS} FROM message_attachments WHERE id = $1");
            Ok(sqlx::query_as::<_, MessageAttachmentEntity>(&sql)
                .bind(id)
                .fetch_optional(&self.pool)
                .await?)
        }

        async fn list_for_messages(
            &self,
            message_ids: &[String],
        ) -> RepositoryResult<Vec<MessageAttachmentEntity>> {
            let bounded: Vec<&String> = message_ids
                .iter()
                .take(MAX_MESSAGES_PER_ATTACHMENT_READ)
                .collect();
            let sql = format!(
                "SELECT {COLUMNS} FROM message_attachments
                 WHERE message_id = ANY($1) ORDER BY created_at ASC"
            );
            Ok(sqlx::query_as::<_, MessageAttachmentEntity>(&sql)
                .bind(bounded)
                .fetch_all(&self.pool)
                .await?)
        }
    }
}

#[cfg(all(test, feature = "postgres"))]
mod pg_tests {
    use super::*;

    fn row(id: &str, content_type: &str, size_bytes: i64) -> MessageAttachmentEntity {
        MessageAttachmentEntity {
            id: id.into(),
            message_id: "MSG-pg000001".into(),
            uploaded_by: "patient_pg".into(),
            patient_id: None,
            filename: "scan.pdf".into(),
            content_type: content_type.into(),
            size_bytes,
            sha256: "a".repeat(64),
            ipfs_hash: "bafytest".into(),
            metadata_hash: "bafymeta".into(),
            scan_status: "not_scanned".into(),
            created_at: Utc::now(),
        }
    }

    /// The database refuses what the handler must never store, even if a
    /// future handler forgot to check: another type, or an oversized file.
    #[tokio::test]
    async fn test_pg_message_attachment_rules_hold_in_the_database() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let repo = PgMessageAttachmentRepository::new(pool.clone());
        repo.create(row("ATT-OK", "application/pdf", 1024))
            .await
            .unwrap();
        assert!(repo
            .create(row("ATT-HTML", "text/html", 1024))
            .await
            .is_err());
        assert!(repo
            .create(row("ATT-BIG", "image/png", 10_485_761))
            .await
            .is_err());
        let listed = repo
            .list_for_messages(&["MSG-pg000001".to_string()])
            .await
            .unwrap();
        assert_eq!(
            listed.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            ["ATT-OK"]
        );
        pool.close().await;
    }
}
