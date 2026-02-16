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

/// PostgreSQL-backed sync operation repository
#[derive(Debug, Clone)]
pub struct PgSyncOperationRepository {
    pool: PgPool,
}

impl PgSyncOperationRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl SyncOperationRepository for PgSyncOperationRepository {
    async fn create(
        &self,
        operation: SyncOperationEntity,
    ) -> RepositoryResult<SyncOperationEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO sync_operations (
                id, operation_type, source_system, target_system, initiated_by,
                initiated_at, completed_at, entity_types, patient_ids,
                date_range_start, date_range_end, status, total_records,
                processed_records, success_count, error_count, conflict_count,
                error_details, sync_summary
            ) ",
        );

        qb.push_values([&operation], |mut b, o| {
            b.push_bind(&o.id)
                .push_bind(&o.operation_type)
                .push_bind(&o.source_system)
                .push_bind(&o.target_system)
                .push_bind(&o.initiated_by)
                .push_bind(o.initiated_at)
                .push_bind(o.completed_at)
                .push_bind(&o.entity_types)
                .push_bind(&o.patient_ids)
                .push_bind(o.date_range_start)
                .push_bind(o.date_range_end)
                .push_bind(&o.status)
                .push_bind(o.total_records)
                .push_bind(o.processed_records)
                .push_bind(o.success_count)
                .push_bind(o.error_count)
                .push_bind(o.conflict_count)
                .push_bind(&o.error_details)
                .push_bind(&o.sync_summary);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<SyncOperationEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<SyncOperationEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM sync_operations WHERE id = ");
        qb.push_bind(id);

        let operation = qb
            .build_query_as::<SyncOperationEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(operation)
    }

    async fn get_by_status(&self, status: &str) -> RepositoryResult<Vec<SyncOperationEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM sync_operations WHERE status = ");
        qb.push_bind(status);
        qb.push(" ORDER BY initiated_at DESC");

        let items = qb
            .build_query_as::<SyncOperationEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_entity(
        &self,
        entity_type: &str,
        _entity_id: &str,
    ) -> RepositoryResult<Vec<SyncOperationEntity>> {
        // entity_types is a JSONB array, use @> to check containment
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM sync_operations WHERE entity_types @> ");
        // Wrap entity_type as JSON array for containment check
        let json_array = serde_json::json!([entity_type]);
        qb.push_bind(json_array);
        qb.push(" ORDER BY initiated_at DESC");

        let items = qb
            .build_query_as::<SyncOperationEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn update(
        &self,
        operation: SyncOperationEntity,
    ) -> RepositoryResult<SyncOperationEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE sync_operations SET ");
        qb.push("status = ").push_bind(&operation.status);
        qb.push(", completed_at = ")
            .push_bind(operation.completed_at);
        qb.push(", processed_records = ")
            .push_bind(operation.processed_records);
        qb.push(", success_count = ")
            .push_bind(operation.success_count);
        qb.push(", error_count = ").push_bind(operation.error_count);
        qb.push(", conflict_count = ")
            .push_bind(operation.conflict_count);
        qb.push(", error_details = ")
            .push_bind(&operation.error_details);
        qb.push(", sync_summary = ")
            .push_bind(&operation.sync_summary);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&operation.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<SyncOperationEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn update_progress(
        &self,
        id: &str,
        processed: i32,
        success: i32,
        errors: i32,
    ) -> RepositoryResult<SyncOperationEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE sync_operations SET ");
        qb.push("processed_records = ").push_bind(processed);
        qb.push(", success_count = ").push_bind(success);
        qb.push(", error_count = ").push_bind(errors);
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<SyncOperationEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn complete(
        &self,
        id: &str,
        summary: serde_json::Value,
    ) -> RepositoryResult<SyncOperationEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE sync_operations SET ");
        qb.push("status = 'completed', sync_summary = ")
            .push_bind(summary);
        qb.push(", completed_at = NOW(), updated_at = NOW() WHERE id = ")
            .push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<SyncOperationEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn fail(
        &self,
        id: &str,
        error_details: serde_json::Value,
    ) -> RepositoryResult<SyncOperationEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE sync_operations SET ");
        qb.push("status = 'failed', error_details = ")
            .push_bind(error_details);
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<SyncOperationEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_pending_retries(&self) -> RepositoryResult<Vec<SyncOperationEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM sync_operations 
             WHERE status = 'failed' 
             ORDER BY initiated_at ASC",
        );

        let items = qb
            .build_query_as::<SyncOperationEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_in_progress(&self) -> RepositoryResult<Vec<SyncOperationEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM sync_operations WHERE status = 'in_progress' ORDER BY initiated_at ASC",
        );

        let items = qb
            .build_query_as::<SyncOperationEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_recent(&self, hours: i32) -> RepositoryResult<Vec<SyncOperationEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM sync_operations WHERE initiated_at >= NOW() - INTERVAL '",
        );
        qb.push(hours.to_string());
        qb.push(" hours' ORDER BY initiated_at DESC");

        let items = qb
            .build_query_as::<SyncOperationEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}

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

/// PostgreSQL-backed external ID mapping repository
#[derive(Debug, Clone)]
pub struct PgExternalIdMappingRepository {
    pool: PgPool,
}

impl PgExternalIdMappingRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ExternalIdMappingRepository for PgExternalIdMappingRepository {
    async fn create(
        &self,
        mapping: ExternalIdMappingEntity,
    ) -> RepositoryResult<ExternalIdMappingEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO external_id_mappings (
                id, entity_type, internal_id, external_system, external_id,
                last_synced_at, sync_status, sync_direction, external_metadata, notes
            ) ",
        );

        qb.push_values([&mapping], |mut b, m| {
            b.push_bind(&m.id)
                .push_bind(&m.entity_type)
                .push_bind(&m.internal_id)
                .push_bind(&m.external_system)
                .push_bind(&m.external_id)
                .push_bind(m.last_synced_at)
                .push_bind(&m.sync_status)
                .push_bind(&m.sync_direction)
                .push_bind(&m.external_metadata)
                .push_bind(&m.notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ExternalIdMappingEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ExternalIdMappingEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM external_id_mappings WHERE id = ");
        qb.push_bind(id);

        let mapping = qb
            .build_query_as::<ExternalIdMappingEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(mapping)
    }

    async fn get_by_internal(
        &self,
        entity_type: &str,
        internal_id: &str,
    ) -> RepositoryResult<Vec<ExternalIdMappingEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM external_id_mappings WHERE entity_type = ");
        qb.push_bind(entity_type);
        qb.push(" AND internal_id = ");
        qb.push_bind(internal_id);
        qb.push(" ORDER BY created_at DESC");

        let items = qb
            .build_query_as::<ExternalIdMappingEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_by_external(
        &self,
        external_system: &str,
        external_id: &str,
    ) -> RepositoryResult<Option<ExternalIdMappingEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM external_id_mappings WHERE external_system = ");
        qb.push_bind(external_system);
        qb.push(" AND external_id = ");
        qb.push_bind(external_id);

        let mapping = qb
            .build_query_as::<ExternalIdMappingEntity>()
            .fetch_optional(&self.pool)
            .await?;

        Ok(mapping)
    }

    async fn update(
        &self,
        mapping: ExternalIdMappingEntity,
    ) -> RepositoryResult<ExternalIdMappingEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE external_id_mappings SET ");
        qb.push("last_synced_at = ")
            .push_bind(mapping.last_synced_at);
        qb.push(", sync_status = ").push_bind(&mapping.sync_status);
        qb.push(", sync_direction = ")
            .push_bind(&mapping.sync_direction);
        qb.push(", external_metadata = ")
            .push_bind(&mapping.external_metadata);
        qb.push(", notes = ").push_bind(&mapping.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&mapping.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ExternalIdMappingEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn update_sync_time(&self, id: &str) -> RepositoryResult<ExternalIdMappingEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "UPDATE external_id_mappings SET last_synced_at = NOW(), updated_at = NOW() WHERE id = ",
        );
        qb.push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ExternalIdMappingEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("DELETE FROM external_id_mappings WHERE id = ");
        qb.push_bind(id);

        qb.build().execute(&self.pool).await?;

        Ok(())
    }

    async fn deactivate(&self, id: &str) -> RepositoryResult<ExternalIdMappingEntity> {
        // Mark as inactive via sync_status
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "UPDATE external_id_mappings SET sync_status = 'inactive', updated_at = NOW() WHERE id = ",
        );
        qb.push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<ExternalIdMappingEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_system(
        &self,
        external_system: &str,
    ) -> RepositoryResult<Vec<ExternalIdMappingEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM external_id_mappings WHERE external_system = ");
        qb.push_bind(external_system);
        qb.push(" ORDER BY created_at DESC");

        let items = qb
            .build_query_as::<ExternalIdMappingEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_unverified(&self) -> RepositoryResult<Vec<ExternalIdMappingEntity>> {
        // Unverified mappings are those with no sync_status or 'pending' status
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM external_id_mappings WHERE sync_status IS NULL OR sync_status = 'pending' ORDER BY created_at ASC",
        );

        let items = qb
            .build_query_as::<ExternalIdMappingEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}
