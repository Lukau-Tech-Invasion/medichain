//! PostgreSQL implementations for Phase 7 Wearables & IoT repositories.
//!
//! Uses `sqlx::QueryBuilder` pattern for dynamic query construction
//! instead of manual positional placeholders ($1, $2, etc.).

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::repositories::traits::*;

// =============================================================================
// WEARABLE DEVICE REPOSITORY
// =============================================================================

/// PostgreSQL-backed wearable device repository
#[derive(Debug, Clone)]
pub struct PgWearableDeviceRepository {
    pool: PgPool,
}

impl PgWearableDeviceRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl WearableDeviceRepository for PgWearableDeviceRepository {
    async fn create(&self, device: WearableDeviceEntity) -> RepositoryResult<WearableDeviceEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO wearable_devices (
                id, patient_id, device_type, device_manufacturer, device_model,
                device_serial_number, firmware_version, registered_datetime, registered_by,
                last_sync_datetime, sync_frequency_minutes, battery_level_percent,
                is_active, connection_status, alert_thresholds, integration_api_key,
                integration_endpoint, notes
            ) ",
        );

        qb.push_values([&device], |mut b, d| {
            b.push_bind(&d.id)
                .push_bind(&d.patient_id)
                .push_bind(&d.device_type)
                .push_bind(&d.device_manufacturer)
                .push_bind(&d.device_model)
                .push_bind(&d.device_serial_number)
                .push_bind(&d.firmware_version)
                .push_bind(d.registered_datetime)
                .push_bind(&d.registered_by)
                .push_bind(d.last_sync_datetime)
                .push_bind(d.sync_frequency_minutes)
                .push_bind(d.battery_level_percent)
                .push_bind(d.is_active)
                .push_bind(&d.connection_status)
                .push_bind(&d.alert_thresholds)
                .push_bind(&d.integration_api_key)
                .push_bind(&d.integration_endpoint)
                .push_bind(&d.notes);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<WearableDeviceEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<WearableDeviceEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM wearable_devices WHERE id = ");
        qb.push_bind(id);

        let device = qb
            .build_query_as::<WearableDeviceEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(device)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<WearableDeviceEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM wearable_devices WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY registered_datetime DESC");

        let devices = qb
            .build_query_as::<WearableDeviceEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(devices)
    }

    async fn update(&self, device: WearableDeviceEntity) -> RepositoryResult<WearableDeviceEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE wearable_devices SET ");
        qb.push("device_type = ").push_bind(&device.device_type);
        qb.push(", device_manufacturer = ")
            .push_bind(&device.device_manufacturer);
        qb.push(", device_model = ").push_bind(&device.device_model);
        qb.push(", firmware_version = ")
            .push_bind(&device.firmware_version);
        qb.push(", last_sync_datetime = ")
            .push_bind(device.last_sync_datetime);
        qb.push(", battery_level_percent = ")
            .push_bind(device.battery_level_percent);
        qb.push(", is_active = ").push_bind(device.is_active);
        qb.push(", connection_status = ")
            .push_bind(&device.connection_status);
        qb.push(", alert_thresholds = ")
            .push_bind(&device.alert_thresholds);
        qb.push(", notes = ").push_bind(&device.notes);
        qb.push(", updated_at = NOW() WHERE id = ")
            .push_bind(&device.id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<WearableDeviceEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("DELETE FROM wearable_devices WHERE id = ");
        qb.push_bind(id);

        qb.build().execute(&self.pool).await?;
        Ok(())
    }

    async fn get_active(&self) -> RepositoryResult<Vec<WearableDeviceEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM wearable_devices WHERE is_active = true ORDER BY registered_datetime DESC"
        );

        let devices = qb
            .build_query_as::<WearableDeviceEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(devices)
    }

    async fn update_sync_status(
        &self,
        id: &str,
        last_sync: DateTime<Utc>,
    ) -> RepositoryResult<WearableDeviceEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE wearable_devices SET ");
        qb.push("last_sync_datetime = ").push_bind(last_sync);
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<WearableDeviceEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// WEARABLE DATA REPOSITORY
// =============================================================================

/// PostgreSQL-backed wearable data repository
#[derive(Debug, Clone)]
pub struct PgWearableDataRepository {
    pool: PgPool,
}

impl PgWearableDataRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl WearableDataRepository for PgWearableDataRepository {
    async fn create(&self, data: WearableDataEntity) -> RepositoryResult<WearableDataEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO wearable_data (
                id, device_id, patient_id, reading_datetime, data_type,
                value_numeric, value_text, value_json, unit_of_measure,
                quality_score, is_valid, anomaly_detected, anomaly_type,
                processed, processed_datetime, raw_data
            ) ",
        );

        qb.push_values([&data], |mut b, d| {
            b.push_bind(&d.id)
                .push_bind(&d.device_id)
                .push_bind(&d.patient_id)
                .push_bind(d.reading_datetime)
                .push_bind(&d.data_type)
                .push_bind(d.value_numeric)
                .push_bind(&d.value_text)
                .push_bind(&d.value_json)
                .push_bind(&d.unit_of_measure)
                .push_bind(d.quality_score)
                .push_bind(d.is_valid)
                .push_bind(d.anomaly_detected)
                .push_bind(&d.anomaly_type)
                .push_bind(d.processed)
                .push_bind(d.processed_datetime)
                .push_bind(&d.raw_data);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<WearableDataEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<WearableDataEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM wearable_data WHERE id = ");
        qb.push_bind(id);

        let data = qb
            .build_query_as::<WearableDataEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(data)
    }

    async fn get_by_device(
        &self,
        device_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WearableDataEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM wearable_data WHERE device_id = ");
        count_qb.push_bind(device_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM wearable_data WHERE device_id = ");
        qb.push_bind(device_id);
        qb.push(" ORDER BY reading_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<WearableDataEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        data_type: Option<&str>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WearableDataEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM wearable_data WHERE patient_id = ");
        count_qb.push_bind(patient_id);
        if let Some(dt) = data_type {
            count_qb.push(" AND data_type = ");
            count_qb.push_bind(dt);
        }

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM wearable_data WHERE patient_id = ");
        qb.push_bind(patient_id);
        if let Some(dt) = data_type {
            qb.push(" AND data_type = ");
            qb.push_bind(dt);
        }
        qb.push(" ORDER BY reading_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<WearableDataEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_anomalies(&self, patient_id: &str) -> RepositoryResult<Vec<WearableDataEntity>> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM wearable_data WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" AND anomaly_detected = true ORDER BY reading_datetime DESC");

        let items = qb
            .build_query_as::<WearableDataEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn get_unprocessed(&self, limit: i32) -> RepositoryResult<Vec<WearableDataEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM wearable_data WHERE processed = false ORDER BY reading_datetime ASC LIMIT "
        );
        qb.push_bind(limit);

        let items = qb
            .build_query_as::<WearableDataEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn mark_processed(&self, id: &str) -> RepositoryResult<WearableDataEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE wearable_data SET ");
        qb.push("processed = true, processed_datetime = NOW() WHERE id = ")
            .push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<WearableDataEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// WEARABLE ALERT REPOSITORY
// =============================================================================

/// PostgreSQL-backed wearable alert repository
#[derive(Debug, Clone)]
pub struct PgWearableAlertRepository {
    pool: PgPool,
}

impl PgWearableAlertRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl WearableAlertRepository for PgWearableAlertRepository {
    async fn create(&self, alert: WearableAlertEntity) -> RepositoryResult<WearableAlertEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO wearable_alerts (
                id, device_id, patient_id, data_reading_id, alert_datetime,
                alert_type, severity, alert_title, alert_message,
                threshold_value, actual_value, acknowledged, acknowledged_by,
                acknowledged_datetime, escalated, escalated_to, escalated_datetime,
                resolution_notes, resolved, resolved_datetime
            ) ",
        );

        qb.push_values([&alert], |mut b, a| {
            b.push_bind(&a.id)
                .push_bind(&a.device_id)
                .push_bind(&a.patient_id)
                .push_bind(&a.data_reading_id)
                .push_bind(a.alert_datetime)
                .push_bind(&a.alert_type)
                .push_bind(&a.severity)
                .push_bind(&a.alert_title)
                .push_bind(&a.alert_message)
                .push_bind(a.threshold_value)
                .push_bind(a.actual_value)
                .push_bind(a.acknowledged)
                .push_bind(&a.acknowledged_by)
                .push_bind(a.acknowledged_datetime)
                .push_bind(a.escalated)
                .push_bind(&a.escalated_to)
                .push_bind(a.escalated_datetime)
                .push_bind(&a.resolution_notes)
                .push_bind(a.resolved)
                .push_bind(a.resolved_datetime);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<WearableAlertEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<WearableAlertEntity> {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM wearable_alerts WHERE id = ");
        qb.push_bind(id);

        let alert = qb
            .build_query_as::<WearableAlertEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(alert)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WearableAlertEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM wearable_alerts WHERE patient_id = ");
        count_qb.push_bind(patient_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM wearable_alerts WHERE patient_id = ");
        qb.push_bind(patient_id);
        qb.push(" ORDER BY alert_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<WearableAlertEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_unacknowledged(&self) -> RepositoryResult<Vec<WearableAlertEntity>> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM wearable_alerts WHERE acknowledged = false 
             ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, alert_datetime DESC"
        );

        let items = qb
            .build_query_as::<WearableAlertEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn acknowledge(
        &self,
        id: &str,
        acknowledged_by: &str,
    ) -> RepositoryResult<WearableAlertEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE wearable_alerts SET ");
        qb.push("acknowledged = true, acknowledged_by = ")
            .push_bind(acknowledged_by);
        qb.push(", acknowledged_datetime = NOW(), updated_at = NOW() WHERE id = ")
            .push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<WearableAlertEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn escalate(
        &self,
        id: &str,
        escalated_to: &str,
    ) -> RepositoryResult<WearableAlertEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE wearable_alerts SET ");
        qb.push("escalated = true, escalated_to = ")
            .push_bind(escalated_to);
        qb.push(", escalated_datetime = NOW(), updated_at = NOW() WHERE id = ")
            .push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<WearableAlertEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn resolve(
        &self,
        id: &str,
        resolution_notes: Option<&str>,
    ) -> RepositoryResult<WearableAlertEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE wearable_alerts SET ");
        qb.push("resolved = true, resolved_datetime = NOW()");
        if let Some(notes) = resolution_notes {
            qb.push(", resolution_notes = ").push_bind(notes);
        }
        qb.push(", updated_at = NOW() WHERE id = ").push_bind(id);
        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<WearableAlertEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }
}

// =============================================================================
// WEARABLE INTEGRATION LOG REPOSITORY
// =============================================================================

/// PostgreSQL-backed wearable integration log repository
#[derive(Debug, Clone)]
pub struct PgWearableIntegrationLogRepository {
    pool: PgPool,
}

impl PgWearableIntegrationLogRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl WearableIntegrationLogRepository for PgWearableIntegrationLogRepository {
    async fn create(
        &self,
        log: WearableIntegrationLogEntity,
    ) -> RepositoryResult<WearableIntegrationLogEntity> {
        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "INSERT INTO wearable_integration_logs (
                id, device_id, patient_id, log_datetime, event_type, status,
                records_synced, error_code, error_message, request_payload,
                response_payload, duration_ms
            ) ",
        );

        qb.push_values([&log], |mut b, l| {
            b.push_bind(&l.id)
                .push_bind(&l.device_id)
                .push_bind(&l.patient_id)
                .push_bind(l.log_datetime)
                .push_bind(&l.event_type)
                .push_bind(&l.status)
                .push_bind(l.records_synced)
                .push_bind(&l.error_code)
                .push_bind(&l.error_message)
                .push_bind(&l.request_payload)
                .push_bind(&l.response_payload)
                .push_bind(l.duration_ms);
        });

        qb.push(" RETURNING *");

        let result = qb
            .build_query_as::<WearableIntegrationLogEntity>()
            .fetch_one(&self.pool)
            .await?;

        Ok(result)
    }

    async fn get_by_device(
        &self,
        device_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WearableIntegrationLogEntity>> {
        let mut count_qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT COUNT(*) FROM wearable_integration_logs WHERE device_id = ");
        count_qb.push_bind(device_id);

        let total = count_qb
            .build_query_scalar::<i64>()
            .fetch_one(&self.pool)
            .await? as u64;

        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("SELECT * FROM wearable_integration_logs WHERE device_id = ");
        qb.push_bind(device_id);
        qb.push(" ORDER BY log_datetime DESC LIMIT ");
        qb.push_bind(pagination.limit() as i32);
        qb.push(" OFFSET ");
        qb.push_bind(pagination.offset() as i32);

        let items = qb
            .build_query_as::<WearableIntegrationLogEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_failures(
        &self,
        hours: i32,
    ) -> RepositoryResult<Vec<WearableIntegrationLogEntity>> {
        let cutoff = Utc::now() - chrono::Duration::hours(hours as i64);

        let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
            "SELECT * FROM wearable_integration_logs WHERE status = 'failure' AND log_datetime >= ",
        );
        qb.push_bind(cutoff);
        qb.push(" ORDER BY log_datetime DESC");

        let items = qb
            .build_query_as::<WearableIntegrationLogEntity>()
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }
}
