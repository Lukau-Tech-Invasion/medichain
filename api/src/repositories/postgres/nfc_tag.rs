//! PostgreSQL implementation of NfcTagRepository.
//! Uses sqlx::QueryBuilder pattern for dynamic query construction.

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::{NfcTagEntity, NfcTagRepository, RepositoryError, RepositoryResult};

/// PostgreSQL-backed NFC tag repository
#[derive(Debug, Clone)]
pub struct PgNfcTagRepository {
    pool: PgPool,
}

impl PgNfcTagRepository {
    /// Create a new PostgreSQL NFC tag repository
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl NfcTagRepository for PgNfcTagRepository {
    async fn create(&self, tag: NfcTagEntity) -> RepositoryResult<NfcTagEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO nfc_tags (id, tag_uid, patient_id, tag_type, is_active, pin_hash, issued_at, expires_at, last_used_at, use_count, issued_by) "
        );

        qb.push_values([&tag], |mut b, t| {
            b.push_bind(&t.id)
                .push_bind(&t.tag_uid)
                .push_bind(&t.patient_id)
                .push_bind(&t.tag_type)
                .push_bind(t.is_active)
                .push_bind(&t.pin_hash)
                .push_bind(t.issued_at)
                .push_bind(t.expires_at)
                .push_bind(t.last_used_at)
                .push_bind(t.use_count)
                .push_bind(&t.issued_by);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<NfcTagEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<NfcTagEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM nfc_tags WHERE id = ");
        qb.push_bind(id);

        let tag = qb
            .build_query_as::<NfcTagEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(tag)
    }

    async fn get_by_uid(&self, uid: &str) -> RepositoryResult<NfcTagEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM nfc_tags WHERE tag_uid = ");
        qb.push_bind(uid);

        let tag = qb
            .build_query_as::<NfcTagEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(tag)
    }

    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<NfcTagEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM nfc_tags WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY issued_at DESC");

        let tags = qb
            .build_query_as::<NfcTagEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(tags)
    }

    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<NfcTagEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM nfc_tags WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND is_active = true AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY issued_at DESC LIMIT 1");

        let tag = qb
            .build_query_as::<NfcTagEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(tag)
    }

    async fn update(&self, tag: NfcTagEntity) -> RepositoryResult<NfcTagEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE nfc_tags SET ");
        qb.push("tag_type = ").push_bind(&tag.tag_type);
        qb.push(", is_active = ").push_bind(tag.is_active);
        qb.push(", pin_hash = ").push_bind(&tag.pin_hash);
        qb.push(", expires_at = ").push_bind(tag.expires_at);
        qb.push(", last_used_at = ").push_bind(tag.last_used_at);
        qb.push(", use_count = ").push_bind(tag.use_count);
        qb.push(" WHERE id = ").push_bind(&tag.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<NfcTagEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn deactivate(&self, id: &str) -> RepositoryResult<()> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("UPDATE nfc_tags SET is_active = false WHERE id = ");
        qb.push_bind(id);

        let result = qb.build().execute(&self.pool).await?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound(format!(
                "NFC tag {} not found",
                id
            )));
        }

        Ok(())
    }

    async fn record_usage(&self, id: &str) -> RepositoryResult<()> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "UPDATE nfc_tags SET use_count = use_count + 1, last_used_at = NOW() WHERE id = ",
        );
        qb.push_bind(id);

        let result = qb.build().execute(&self.pool).await?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound(format!(
                "NFC tag {} not found",
                id
            )));
        }

        Ok(())
    }
}
