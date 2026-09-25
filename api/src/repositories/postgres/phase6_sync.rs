//! PostgreSQL implementations for Phase 14 Sync/Integration repositories.
//!
//! Uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

// =============================================================================
// SYNC OPERATION REPOSITORY
// =============================================================================

// =============================================================================
// SYNC CONFLICT REPOSITORY
// =============================================================================

/// PostgreSQL-backed sync conflict repository
#[derive(Debug, Clone)]
pub struct PgSyncConflictRepository {
    pool: PgPool,
}

impl PgSyncConflictRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl SyncConflictRepository for PgSyncConflictRepository {
    async fn create(&self, conflict: SyncConflictEntity) -> RepositoryResult<SyncConflictEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO sync_conflicts (
                id, sync_operation_id, entity_type, entity_id, patient_id,
                conflict_type, field_name, local_value, remote_value,
                local_timestamp, remote_timestamp, local_version, remote_version,
                status, resolution_strategy, resolved_value, resolved_by,
                resolved_at, resolution_notes
            ) ",
        );

        qb.push_values([&conflict], |mut b, c| {
            b.push_bind(&c.id)
                .push_bind(&c.sync_operation_id)
                .push_bind(&c.entity_type)
                .push_bind(&c.entity_id)
                .push_bind(&c.patient_id)
                .push_bind(&c.conflict_type)
                .push_bind(&c.field_name)
                .push_bind(&c.local_value)
                .push_bind(&c.remote_value)
                .push_bind(c.local_timestamp)
                .push_bind(c.remote_timestamp)
                .push_bind(c.local_version)
                .push_bind(c.remote_version)
                .push_bind(&c.status)
                .push_bind(&c.resolution_strategy)
                .push_bind(&c.resolved_value)
                .push_bind(&c.resolved_by)
                .push_bind(c.resolved_at)
                .push_bind(&c.resolution_notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<SyncConflictEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<SyncConflictEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM sync_conflicts WHERE id = ");
        qb.push_bind(id);

        let conflict = qb
            .build_query_as::<SyncConflictEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(conflict)
    }

    async fn get_by_operation(
        &self,
        operation_id: &str,
    ) -> RepositoryResult<Vec<SyncConflictEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM sync_conflicts WHERE sync_operation_id = ");
        qb.push_bind(operation_id);
        qb.push(" ORDER BY created_at ASC");

        let items = qb
            .build_query_as::<SyncConflictEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_pending(&self) -> RepositoryResult<Vec<SyncConflictEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM sync_conflicts WHERE status = 'pending' ORDER BY created_at ASC",
        );

        let items = qb
            .build_query_as::<SyncConflictEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_entity(
        &self,
        entity_type: &str,
        entity_id: &str,
    ) -> RepositoryResult<Vec<SyncConflictEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM sync_conflicts WHERE entity_type = ");
        qb.push_bind(entity_type);
        qb.push(" AND entity_id = ");
        qb.push_bind(entity_id);
        qb.push(" ORDER BY created_at DESC");

        let items = qb
            .build_query_as::<SyncConflictEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn resolve(
        &self,
        id: &str,
        resolved_value: &str,
        resolved_by: &str,
        notes: Option<&str>,
    ) -> RepositoryResult<SyncConflictEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE sync_conflicts SET ");
        qb.push("status = 'resolved', resolved_value = ")
            .push_bind(resolved_value);
        qb.push(", resolved_by = ").push_bind(resolved_by);
        qb.push(", resolved_at = NOW()");
        qb.push(", resolution_notes = ").push_bind(notes);
        qb.push(" WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<SyncConflictEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_auto_resolvable(&self) -> RepositoryResult<Vec<SyncConflictEntity>> {
        // Auto-resolvable conflicts are those with a resolution_strategy set
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM sync_conflicts WHERE status = 'pending' AND resolution_strategy IS NOT NULL ORDER BY created_at ASC",
        );

        let items = qb
            .build_query_as::<SyncConflictEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

// =============================================================================
// EXTERNAL ID MAPPING REPOSITORY
// =============================================================================
