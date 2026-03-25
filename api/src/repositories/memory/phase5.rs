//! In-memory implementations for Phase 7-10 repositories.
//!
//! This module provides HashMap-based implementations for testing and development.
//! Phases covered:
//! - Phase 7: Wearables & IoT
//! - Phase 8: Telehealth
//! - Phase 9: Clinical Decision Support
//! - Phase 10: Insurance & Billing

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

// =============================================================================
// PHASE 7: WEARABLES & IOT
// =============================================================================

/// In-memory wearable device repository
#[derive(Debug, Default)]
pub struct MemoryWearableDeviceRepository {
    devices: RwLock<HashMap<String, WearableDeviceEntity>>,
}

impl MemoryWearableDeviceRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl WearableDeviceRepository for MemoryWearableDeviceRepository {
    async fn create(&self, device: WearableDeviceEntity) -> RepositoryResult<WearableDeviceEntity> {
        let mut devices = self.devices.write().unwrap();
        devices.insert(device.id.clone(), device.clone());
        Ok(device)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<WearableDeviceEntity> {
        let devices = self.devices.read().unwrap();
        devices
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Wearable device {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<WearableDeviceEntity>> {
        let devices = self.devices.read().unwrap();
        let result: Vec<_> = devices
            .values()
            .filter(|d| d.patient_id == patient_id)
            .cloned()
            .collect();
        Ok(result)
    }

    async fn update(&self, device: WearableDeviceEntity) -> RepositoryResult<WearableDeviceEntity> {
        let mut devices = self.devices.write().unwrap();
        if devices.contains_key(&device.id) {
            devices.insert(device.id.clone(), device.clone());
            Ok(device)
        } else {
            Err(RepositoryError::NotFound(format!(
                "Wearable device {} not found",
                device.id
            )))
        }
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut devices = self.devices.write().unwrap();
        devices.remove(id);
        Ok(())
    }

    async fn get_active(&self) -> RepositoryResult<Vec<WearableDeviceEntity>> {
        let devices = self.devices.read().unwrap();
        let result: Vec<_> = devices.values().filter(|d| d.is_active).cloned().collect();
        Ok(result)
    }

    async fn update_sync_status(
        &self,
        id: &str,
        last_sync: DateTime<Utc>,
    ) -> RepositoryResult<WearableDeviceEntity> {
        let mut devices = self.devices.write().unwrap();
        if let Some(device) = devices.get_mut(id) {
            device.last_sync_datetime = Some(last_sync);
            device.updated_at = Utc::now();
            Ok(device.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Wearable device {} not found",
                id
            )))
        }
    }
}

/// In-memory wearable data repository
#[derive(Debug, Default)]
pub struct MemoryWearableDataRepository {
    data: RwLock<HashMap<String, WearableDataEntity>>,
}

impl MemoryWearableDataRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl WearableDataRepository for MemoryWearableDataRepository {
    async fn create(&self, data: WearableDataEntity) -> RepositoryResult<WearableDataEntity> {
        let mut store = self.data.write().unwrap();
        store.insert(data.id.clone(), data.clone());
        Ok(data)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<WearableDataEntity> {
        let store = self.data.read().unwrap();
        store
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Wearable data {} not found", id)))
    }

    async fn get_by_device(
        &self,
        device_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WearableDataEntity>> {
        let store = self.data.read().unwrap();
        let filtered: Vec<_> = store
            .values()
            .filter(|d| d.device_id == device_id)
            .cloned()
            .collect();
        let total = filtered.len() as u64;
        let items: Vec<_> = filtered
            .into_iter()
            .skip(pagination.offset() as usize)
            .take(pagination.limit() as usize)
            .collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        data_type: Option<&str>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WearableDataEntity>> {
        let store = self.data.read().unwrap();
        let filtered: Vec<_> = store
            .values()
            .filter(|d| d.patient_id == patient_id)
            .filter(|d| data_type.is_none_or(|t| d.data_type == t))
            .cloned()
            .collect();
        let total = filtered.len() as u64;
        let items: Vec<_> = filtered
            .into_iter()
            .skip(pagination.offset() as usize)
            .take(pagination.limit() as usize)
            .collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_anomalies(&self, patient_id: &str) -> RepositoryResult<Vec<WearableDataEntity>> {
        let store = self.data.read().unwrap();
        let result: Vec<_> = store
            .values()
            .filter(|d| d.patient_id == patient_id && d.anomaly_detected == Some(true))
            .cloned()
            .collect();
        Ok(result)
    }

    async fn get_unprocessed(&self, limit: i32) -> RepositoryResult<Vec<WearableDataEntity>> {
        let store = self.data.read().unwrap();
        let result: Vec<_> = store
            .values()
            .filter(|d| d.processed != Some(true))
            .take(limit as usize)
            .cloned()
            .collect();
        Ok(result)
    }

    async fn mark_processed(&self, id: &str) -> RepositoryResult<WearableDataEntity> {
        let mut store = self.data.write().unwrap();
        if let Some(data) = store.get_mut(id) {
            data.processed = Some(true);
            data.processed_datetime = Some(Utc::now());
            Ok(data.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Wearable data {} not found",
                id
            )))
        }
    }
}

/// In-memory wearable alert repository
#[derive(Debug, Default)]
pub struct MemoryWearableAlertRepository {
    alerts: RwLock<HashMap<String, WearableAlertEntity>>,
}

impl MemoryWearableAlertRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl WearableAlertRepository for MemoryWearableAlertRepository {
    async fn create(&self, alert: WearableAlertEntity) -> RepositoryResult<WearableAlertEntity> {
        let mut alerts = self.alerts.write().unwrap();
        alerts.insert(alert.id.clone(), alert.clone());
        Ok(alert)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<WearableAlertEntity> {
        let alerts = self.alerts.read().unwrap();
        alerts
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Wearable alert {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WearableAlertEntity>> {
        let alerts = self.alerts.read().unwrap();
        let filtered: Vec<_> = alerts
            .values()
            .filter(|a| a.patient_id == patient_id)
            .cloned()
            .collect();
        let total = filtered.len() as u64;
        let items: Vec<_> = filtered
            .into_iter()
            .skip(pagination.offset() as usize)
            .take(pagination.limit() as usize)
            .collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_unacknowledged(&self) -> RepositoryResult<Vec<WearableAlertEntity>> {
        let alerts = self.alerts.read().unwrap();
        let result: Vec<_> = alerts
            .values()
            .filter(|a| a.acknowledged != Some(true))
            .cloned()
            .collect();
        Ok(result)
    }

    async fn acknowledge(
        &self,
        id: &str,
        acknowledged_by: &str,
    ) -> RepositoryResult<WearableAlertEntity> {
        let mut alerts = self.alerts.write().unwrap();
        if let Some(alert) = alerts.get_mut(id) {
            alert.acknowledged = Some(true);
            alert.acknowledged_by = Some(acknowledged_by.to_string());
            alert.acknowledged_datetime = Some(Utc::now());
            alert.updated_at = Utc::now();
            Ok(alert.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Wearable alert {} not found",
                id
            )))
        }
    }

    async fn escalate(
        &self,
        id: &str,
        escalated_to: &str,
    ) -> RepositoryResult<WearableAlertEntity> {
        let mut alerts = self.alerts.write().unwrap();
        if let Some(alert) = alerts.get_mut(id) {
            alert.escalated = Some(true);
            alert.escalated_to = Some(escalated_to.to_string());
            alert.escalated_datetime = Some(Utc::now());
            alert.updated_at = Utc::now();
            Ok(alert.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Wearable alert {} not found",
                id
            )))
        }
    }

    async fn resolve(
        &self,
        id: &str,
        resolution_notes: Option<&str>,
    ) -> RepositoryResult<WearableAlertEntity> {
        let mut alerts = self.alerts.write().unwrap();
        if let Some(alert) = alerts.get_mut(id) {
            alert.resolved = Some(true);
            alert.resolved_datetime = Some(Utc::now());
            alert.resolution_notes = resolution_notes.map(|s| s.to_string());
            alert.updated_at = Utc::now();
            Ok(alert.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Wearable alert {} not found",
                id
            )))
        }
    }
}

/// In-memory wearable integration log repository
#[derive(Debug, Default)]
pub struct MemoryWearableIntegrationLogRepository {
    logs: RwLock<HashMap<String, WearableIntegrationLogEntity>>,
}

impl MemoryWearableIntegrationLogRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl WearableIntegrationLogRepository for MemoryWearableIntegrationLogRepository {
    async fn create(
        &self,
        log: WearableIntegrationLogEntity,
    ) -> RepositoryResult<WearableIntegrationLogEntity> {
        let mut logs = self.logs.write().unwrap();
        logs.insert(log.id.clone(), log.clone());
        Ok(log)
    }

    async fn get_by_device(
        &self,
        device_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WearableIntegrationLogEntity>> {
        let logs = self.logs.read().unwrap();
        let filtered: Vec<_> = logs
            .values()
            .filter(|l| l.device_id == device_id)
            .cloned()
            .collect();
        let total = filtered.len() as u64;
        let items: Vec<_> = filtered
            .into_iter()
            .skip(pagination.offset() as usize)
            .take(pagination.limit() as usize)
            .collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_failures(
        &self,
        hours: i32,
    ) -> RepositoryResult<Vec<WearableIntegrationLogEntity>> {
        let cutoff = Utc::now() - chrono::Duration::hours(hours as i64);
        let logs = self.logs.read().unwrap();
        let result: Vec<_> = logs
            .values()
            .filter(|l| l.status == "failure" && l.log_datetime >= cutoff)
            .cloned()
            .collect();
        Ok(result)
    }
}

// =============================================================================
// PHASE 8: TELEHEALTH
// =============================================================================

/// In-memory telehealth session repository
#[derive(Debug, Default)]
pub struct MemoryTelehealthSessionRepository {
    sessions: RwLock<HashMap<String, TelehealthSessionEntity>>,
}

impl MemoryTelehealthSessionRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl TelehealthSessionRepository for MemoryTelehealthSessionRepository {
    async fn create(
        &self,
        session: TelehealthSessionEntity,
    ) -> RepositoryResult<TelehealthSessionEntity> {
        let mut sessions = self.sessions.write().unwrap();
        sessions.insert(session.id.clone(), session.clone());
        Ok(session)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<TelehealthSessionEntity> {
        let sessions = self.sessions.read().unwrap();
        sessions.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Telehealth session {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<TelehealthSessionEntity>> {
        let sessions = self.sessions.read().unwrap();
        let filtered: Vec<_> = sessions
            .values()
            .filter(|s| s.patient_id == patient_id)
            .cloned()
            .collect();
        let total = filtered.len() as u64;
        let items: Vec<_> = filtered
            .into_iter()
            .skip(pagination.offset() as usize)
            .take(pagination.limit() as usize)
            .collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_provider(
        &self,
        provider_id: &str,
        date: chrono::NaiveDate,
    ) -> RepositoryResult<Vec<TelehealthSessionEntity>> {
        let sessions = self.sessions.read().unwrap();
        let result: Vec<_> = sessions
            .values()
            .filter(|s| s.provider_id == provider_id && s.scheduled_datetime.date_naive() == date)
            .cloned()
            .collect();
        Ok(result)
    }

    async fn update(
        &self,
        session: TelehealthSessionEntity,
    ) -> RepositoryResult<TelehealthSessionEntity> {
        let mut sessions = self.sessions.write().unwrap();
        if sessions.contains_key(&session.id) {
            sessions.insert(session.id.clone(), session.clone());
            Ok(session)
        } else {
            Err(RepositoryError::NotFound(format!(
                "Telehealth session {} not found",
                session.id
            )))
        }
    }

    async fn get_upcoming(
        &self,
        provider_id: &str,
    ) -> RepositoryResult<Vec<TelehealthSessionEntity>> {
        let now = Utc::now();
        let sessions = self.sessions.read().unwrap();
        let result: Vec<_> = sessions
            .values()
            .filter(|s| {
                s.provider_id == provider_id
                    && s.scheduled_datetime > now
                    && s.status == "scheduled"
            })
            .cloned()
            .collect();
        Ok(result)
    }

    async fn start_session(&self, id: &str) -> RepositoryResult<TelehealthSessionEntity> {
        let mut sessions = self.sessions.write().unwrap();
        if let Some(session) = sessions.get_mut(id) {
            session.status = "in_progress".to_string();
            session.actual_start_datetime = Some(Utc::now());
            session.updated_at = Utc::now();
            Ok(session.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Telehealth session {} not found",
                id
            )))
        }
    }

    async fn end_session(&self, id: &str) -> RepositoryResult<TelehealthSessionEntity> {
        let mut sessions = self.sessions.write().unwrap();
        if let Some(session) = sessions.get_mut(id) {
            let end_time = Utc::now();
            session.status = "completed".to_string();
            session.actual_end_datetime = Some(end_time);
            if let Some(start) = session.actual_start_datetime {
                session.duration_minutes = Some((end_time - start).num_minutes() as i32);
            }
            session.updated_at = end_time;
            Ok(session.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Telehealth session {} not found",
                id
            )))
        }
    }
}

/// In-memory telehealth note repository
#[derive(Debug, Default)]
pub struct MemoryTelehealthNoteRepository {
    notes: RwLock<HashMap<String, TelehealthNoteEntity>>,
}

impl MemoryTelehealthNoteRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl TelehealthNoteRepository for MemoryTelehealthNoteRepository {
    async fn create(&self, note: TelehealthNoteEntity) -> RepositoryResult<TelehealthNoteEntity> {
        let mut notes = self.notes.write().unwrap();
        notes.insert(note.id.clone(), note.clone());
        Ok(note)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<TelehealthNoteEntity> {
        let notes = self.notes.read().unwrap();
        notes
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Telehealth note {} not found", id)))
    }

    async fn get_by_session(
        &self,
        session_id: &str,
    ) -> RepositoryResult<Option<TelehealthNoteEntity>> {
        let notes = self.notes.read().unwrap();
        let result = notes.values().find(|n| n.session_id == session_id).cloned();
        Ok(result)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<TelehealthNoteEntity>> {
        let notes = self.notes.read().unwrap();
        let filtered: Vec<_> = notes
            .values()
            .filter(|n| n.patient_id == patient_id)
            .cloned()
            .collect();
        let total = filtered.len() as u64;
        let items: Vec<_> = filtered
            .into_iter()
            .skip(pagination.offset() as usize)
            .take(pagination.limit() as usize)
            .collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(&self, note: TelehealthNoteEntity) -> RepositoryResult<TelehealthNoteEntity> {
        let mut notes = self.notes.write().unwrap();
        if notes.contains_key(&note.id) {
            notes.insert(note.id.clone(), note.clone());
            Ok(note)
        } else {
            Err(RepositoryError::NotFound(format!(
                "Telehealth note {} not found",
                note.id
            )))
        }
    }

    async fn sign(
        &self,
        id: &str,
        provider_signature: &str,
    ) -> RepositoryResult<TelehealthNoteEntity> {
        let mut notes = self.notes.write().unwrap();
        if let Some(note) = notes.get_mut(id) {
            note.provider_signature = Some(provider_signature.to_string());
            note.signed_datetime = Some(Utc::now());
            note.updated_at = Utc::now();
            Ok(note.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Telehealth note {} not found",
                id
            )))
        }
    }

    async fn add_addendum(
        &self,
        id: &str,
        addendum: &str,
    ) -> RepositoryResult<TelehealthNoteEntity> {
        let mut notes = self.notes.write().unwrap();
        if let Some(note) = notes.get_mut(id) {
            note.addendum = Some(addendum.to_string());
            note.addendum_datetime = Some(Utc::now());
            note.updated_at = Utc::now();
            Ok(note.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Telehealth note {} not found",
                id
            )))
        }
    }
}

/// In-memory remote patient monitoring repository
#[derive(Debug, Default)]
pub struct MemoryRemotePatientMonitoringRepository {
    enrollments: RwLock<HashMap<String, RemotePatientMonitoringEntity>>,
}

impl MemoryRemotePatientMonitoringRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl RemotePatientMonitoringRepository for MemoryRemotePatientMonitoringRepository {
    async fn create(
        &self,
        enrollment: RemotePatientMonitoringEntity,
    ) -> RepositoryResult<RemotePatientMonitoringEntity> {
        let mut enrollments = self.enrollments.write().unwrap();
        enrollments.insert(enrollment.id.clone(), enrollment.clone());
        Ok(enrollment)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<RemotePatientMonitoringEntity> {
        let enrollments = self.enrollments.read().unwrap();
        enrollments
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("RPM enrollment {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<RemotePatientMonitoringEntity>> {
        let enrollments = self.enrollments.read().unwrap();
        let result: Vec<_> = enrollments
            .values()
            .filter(|e| e.patient_id == patient_id)
            .cloned()
            .collect();
        Ok(result)
    }

    async fn get_active_by_program(
        &self,
        program_name: &str,
    ) -> RepositoryResult<Vec<RemotePatientMonitoringEntity>> {
        let enrollments = self.enrollments.read().unwrap();
        let result: Vec<_> = enrollments
            .values()
            .filter(|e| e.program_name == program_name && e.status == "active")
            .cloned()
            .collect();
        Ok(result)
    }

    async fn update(
        &self,
        enrollment: RemotePatientMonitoringEntity,
    ) -> RepositoryResult<RemotePatientMonitoringEntity> {
        let mut enrollments = self.enrollments.write().unwrap();
        if enrollments.contains_key(&enrollment.id) {
            enrollments.insert(enrollment.id.clone(), enrollment.clone());
            Ok(enrollment)
        } else {
            Err(RepositoryError::NotFound(format!(
                "RPM enrollment {} not found",
                enrollment.id
            )))
        }
    }

    async fn update_status(
        &self,
        id: &str,
        status: &str,
        reason: Option<&str>,
    ) -> RepositoryResult<RemotePatientMonitoringEntity> {
        let mut enrollments = self.enrollments.write().unwrap();
        if let Some(enrollment) = enrollments.get_mut(id) {
            enrollment.status = status.to_string();
            enrollment.status_reason = reason.map(|s| s.to_string());
            enrollment.updated_at = Utc::now();
            Ok(enrollment.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "RPM enrollment {} not found",
                id
            )))
        }
    }

    async fn get_by_care_manager(
        &self,
        care_manager_id: &str,
    ) -> RepositoryResult<Vec<RemotePatientMonitoringEntity>> {
        let enrollments = self.enrollments.read().unwrap();
        let result: Vec<_> = enrollments
            .values()
            .filter(|e| e.assigned_care_manager.as_deref() == Some(care_manager_id))
            .cloned()
            .collect();
        Ok(result)
    }
}

/// In-memory RPM reading repository
#[derive(Debug, Default)]
pub struct MemoryRpmReadingRepository {
    readings: RwLock<HashMap<String, RpmReadingEntity>>,
}

impl MemoryRpmReadingRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl RpmReadingRepository for MemoryRpmReadingRepository {
    async fn create(&self, reading: RpmReadingEntity) -> RepositoryResult<RpmReadingEntity> {
        let mut readings = self.readings.write().unwrap();
        readings.insert(reading.id.clone(), reading.clone());
        Ok(reading)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<RpmReadingEntity> {
        let readings = self.readings.read().unwrap();
        readings
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("RPM reading {} not found", id)))
    }

    async fn get_by_enrollment(
        &self,
        enrollment_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<RpmReadingEntity>> {
        let readings = self.readings.read().unwrap();
        let filtered: Vec<_> = readings
            .values()
            .filter(|r| r.rpm_enrollment_id == enrollment_id)
            .cloned()
            .collect();
        let total = filtered.len() as u64;
        let items: Vec<_> = filtered
            .into_iter()
            .skip(pagination.offset() as usize)
            .take(pagination.limit() as usize)
            .collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        reading_type: Option<&str>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<RpmReadingEntity>> {
        let readings = self.readings.read().unwrap();
        let filtered: Vec<_> = readings
            .values()
            .filter(|r| r.patient_id == patient_id)
            .filter(|r| reading_type.is_none_or(|t| r.reading_type == t))
            .cloned()
            .collect();
        let total = filtered.len() as u64;
        let items: Vec<_> = filtered
            .into_iter()
            .skip(pagination.offset() as usize)
            .take(pagination.limit() as usize)
            .collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_unreviewed(&self) -> RepositoryResult<Vec<RpmReadingEntity>> {
        let readings = self.readings.read().unwrap();
        let result: Vec<_> = readings
            .values()
            .filter(|r| r.reviewed != Some(true))
            .cloned()
            .collect();
        Ok(result)
    }

    async fn review(
        &self,
        id: &str,
        reviewed_by: &str,
        notes: Option<&str>,
        action: Option<&str>,
    ) -> RepositoryResult<RpmReadingEntity> {
        let mut readings = self.readings.write().unwrap();
        if let Some(reading) = readings.get_mut(id) {
            reading.reviewed = Some(true);
            reading.reviewed_by = Some(reviewed_by.to_string());
            reading.reviewed_datetime = Some(Utc::now());
            reading.review_notes = notes.map(|s| s.to_string());
            reading.action_taken = action.map(|s| s.to_string());
            Ok(reading.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "RPM reading {} not found",
                id
            )))
        }
    }

    async fn get_alerts(&self, enrollment_id: &str) -> RepositoryResult<Vec<RpmReadingEntity>> {
        let readings = self.readings.read().unwrap();
        let result: Vec<_> = readings
            .values()
            .filter(|r| r.rpm_enrollment_id == enrollment_id && r.alert_triggered == Some(true))
            .cloned()
            .collect();
        Ok(result)
    }
}

// =============================================================================
// PHASE 9: CLINICAL DECISION SUPPORT
// =============================================================================

/// In-memory CDS alert repository
#[derive(Debug, Default)]
pub struct MemoryCdsAlertRepository {
    alerts: RwLock<HashMap<String, CdsAlertEntity>>,
}

impl MemoryCdsAlertRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl CdsAlertRepository for MemoryCdsAlertRepository {
    async fn create(&self, alert: CdsAlertEntity) -> RepositoryResult<CdsAlertEntity> {
        let mut alerts = self.alerts.write().unwrap();
        alerts.insert(alert.id.clone(), alert.clone());
        Ok(alert)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<CdsAlertEntity> {
        let alerts = self.alerts.read().unwrap();
        alerts
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("CDS alert {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        active_only: bool,
    ) -> RepositoryResult<Vec<CdsAlertEntity>> {
        let alerts = self.alerts.read().unwrap();
        let result: Vec<_> = alerts
            .values()
            .filter(|a| a.patient_id == patient_id)
            .filter(|a| !active_only || a.status == "active")
            .cloned()
            .collect();
        Ok(result)
    }

    async fn acknowledge(
        &self,
        id: &str,
        by: &str,
        reason: Option<&str>,
    ) -> RepositoryResult<CdsAlertEntity> {
        let mut alerts = self.alerts.write().unwrap();
        if let Some(alert) = alerts.get_mut(id) {
            alert.status = "acknowledged".to_string();
            alert.acknowledged_by = Some(by.to_string());
            alert.acknowledged_datetime = Some(Utc::now());
            if let Some(r) = reason {
                alert.action_taken = Some(r.to_string());
            }
            alert.updated_at = Utc::now();
            Ok(alert.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "CDS alert {} not found",
                id
            )))
        }
    }

    async fn override_alert(
        &self,
        id: &str,
        by: &str,
        reason: &str,
    ) -> RepositoryResult<CdsAlertEntity> {
        let mut alerts = self.alerts.write().unwrap();
        if let Some(alert) = alerts.get_mut(id) {
            alert.status = "overridden".to_string();
            alert.override_justification = Some(by.to_string());
            alert.override_reason = Some(reason.to_string());
            alert.updated_at = Utc::now();
            Ok(alert.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "CDS alert {} not found",
                id
            )))
        }
    }

    async fn get_by_encounter(&self, encounter_id: &str) -> RepositoryResult<Vec<CdsAlertEntity>> {
        let alerts = self.alerts.read().unwrap();
        let result: Vec<_> = alerts
            .values()
            .filter(|a| {
                a.encounter_id
                    .as_ref()
                    .map(|e| e == encounter_id)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        Ok(result)
    }

    async fn get_unacknowledged(
        &self,
        patient_id: Option<&str>,
    ) -> RepositoryResult<Vec<CdsAlertEntity>> {
        let alerts = self.alerts.read().unwrap();
        let result: Vec<_> = alerts
            .values()
            .filter(|a| a.acknowledged_by.is_none() && a.status == "active")
            .filter(|a| patient_id.map(|pid| a.patient_id == pid).unwrap_or(true))
            .cloned()
            .collect();
        Ok(result)
    }

    async fn dismiss(&self, id: &str) -> RepositoryResult<CdsAlertEntity> {
        let mut alerts = self.alerts.write().unwrap();
        if let Some(alert) = alerts.get_mut(id) {
            alert.status = "dismissed".to_string();
            alert.updated_at = Utc::now();
            Ok(alert.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "CDS alert {} not found",
                id
            )))
        }
    }

    async fn get_by_rule(
        &self,
        rule_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CdsAlertEntity>> {
        let alerts = self.alerts.read().unwrap();
        let filtered: Vec<_> = alerts
            .values()
            .filter(|a| a.rule_id.as_deref() == Some(rule_id))
            .cloned()
            .collect();
        let total = filtered.len() as u64;
        let items: Vec<_> = filtered
            .into_iter()
            .skip(pagination.offset() as usize)
            .take(pagination.limit() as usize)
            .collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_high_severity(&self) -> RepositoryResult<Vec<CdsAlertEntity>> {
        let alerts = self.alerts.read().unwrap();
        let result: Vec<_> = alerts
            .values()
            .filter(|a| {
                a.status == "active"
                    && a.acknowledged_by.is_none()
                    && (a.severity == "critical" || a.severity == "high")
            })
            .cloned()
            .collect();
        Ok(result)
    }
}

// =============================================================================
// PHASE 10: INSURANCE & BILLING
// =============================================================================

/// In-memory insurance record repository
#[derive(Debug, Default)]
pub struct MemoryInsuranceRecordRepository {
    records: RwLock<HashMap<String, InsuranceRecordEntity>>,
}

impl MemoryInsuranceRecordRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl InsuranceRecordRepository for MemoryInsuranceRecordRepository {
    async fn create(
        &self,
        record: InsuranceRecordEntity,
    ) -> RepositoryResult<InsuranceRecordEntity> {
        let mut records = self.records.write().unwrap();
        records.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<InsuranceRecordEntity> {
        let records = self.records.read().unwrap();
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Insurance record {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<InsuranceRecordEntity>> {
        let records = self.records.read().unwrap();
        let result: Vec<_> = records
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        Ok(result)
    }

    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<InsuranceRecordEntity>> {
        let records = self.records.read().unwrap();
        let today = chrono::Utc::now().date_naive();
        let result: Vec<_> = records
            .values()
            .filter(|r| {
                r.patient_id == patient_id
                    && r.is_active
                    && r.termination_date.is_none_or(|d| d >= today)
            })
            .cloned()
            .collect();
        Ok(result)
    }

    async fn update(
        &self,
        record: InsuranceRecordEntity,
    ) -> RepositoryResult<InsuranceRecordEntity> {
        let mut records = self.records.write().unwrap();
        if records.contains_key(&record.id) {
            records.insert(record.id.clone(), record.clone());
            Ok(record)
        } else {
            Err(RepositoryError::NotFound(format!(
                "Insurance record {} not found",
                record.id
            )))
        }
    }

    async fn verify(
        &self,
        id: &str,
        verified_by: &str,
        notes: Option<&str>,
    ) -> RepositoryResult<InsuranceRecordEntity> {
        let mut records = self.records.write().unwrap();
        if let Some(record) = records.get_mut(id) {
            record.verification_status = Some("verified".to_string());
            record.last_verified_date = Some(chrono::Utc::now().date_naive());
            record.last_verified_by = Some(verified_by.to_string());
            record.verification_notes = notes.map(|s| s.to_string());
            record.updated_at = Utc::now();
            Ok(record.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Insurance record {} not found",
                id
            )))
        }
    }

    async fn deactivate(&self, id: &str) -> RepositoryResult<InsuranceRecordEntity> {
        let mut records = self.records.write().unwrap();
        if let Some(record) = records.get_mut(id) {
            record.is_active = false;
            record.updated_at = Utc::now();
            Ok(record.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Insurance record {} not found",
                id
            )))
        }
    }

    async fn get_expiring(&self, days: i32) -> RepositoryResult<Vec<InsuranceRecordEntity>> {
        let records = self.records.read().unwrap();
        let cutoff = chrono::Utc::now().date_naive() + chrono::Duration::days(days as i64);
        let result: Vec<_> = records
            .values()
            .filter(|r| r.is_active && r.termination_date.is_some_and(|d| d <= cutoff))
            .cloned()
            .collect();
        Ok(result)
    }

    async fn get_primary(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<InsuranceRecordEntity>> {
        let records = self.records.read().unwrap();
        Ok(records
            .values()
            .find(|r| r.patient_id == patient_id && r.is_active && r.insurance_type == "primary")
            .cloned())
    }

    async fn get_active(&self, patient_id: &str) -> RepositoryResult<Vec<InsuranceRecordEntity>> {
        let records = self.records.read().unwrap();
        let today = chrono::Utc::now().date_naive();
        let result: Vec<_> = records
            .values()
            .filter(|r| {
                r.patient_id == patient_id
                    && r.is_active
                    && r.termination_date.is_none_or(|d| d >= today)
            })
            .cloned()
            .collect();
        Ok(result)
    }

    async fn verify_eligibility(
        &self,
        id: &str,
        verified_by: &str,
    ) -> RepositoryResult<InsuranceRecordEntity> {
        let mut records = self.records.write().unwrap();
        if let Some(record) = records.get_mut(id) {
            record.verification_status = Some("verified".to_string());
            record.last_verified_date = Some(chrono::Utc::now().date_naive());
            record.last_verified_by = Some(verified_by.to_string());
            record.updated_at = Utc::now();
            Ok(record.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Insurance record {} not found",
                id
            )))
        }
    }

    async fn set_primary(&self, patient_id: &str, record_id: &str) -> RepositoryResult<()> {
        let mut records = self.records.write().unwrap();

        // 1. Mark all other records for this patient as not primary
        for record in records.values_mut() {
            if record.patient_id == patient_id && record.insurance_type == "primary" {
                record.insurance_type = "secondary".to_string();
                record.updated_at = Utc::now();
            }
        }

        // 2. Set the specified record as primary
        if let Some(record) = records.get_mut(record_id) {
            if record.patient_id == patient_id {
                record.insurance_type = "primary".to_string();
                record.is_active = true;
                record.updated_at = Utc::now();
                Ok(())
            } else {
                Err(RepositoryError::Validation(format!(
                    "Record {} does not belong to patient {}",
                    record_id, patient_id
                )))
            }
        } else {
            Err(RepositoryError::NotFound(format!(
                "Insurance record {} not found",
                record_id
            )))
        }
    }

    async fn terminate(
        &self,
        id: &str,
        termination_date: chrono::NaiveDate,
    ) -> RepositoryResult<InsuranceRecordEntity> {
        let mut records = self.records.write().unwrap();

        if let Some(record) = records.get_mut(id) {
            record.is_active = false;
            record.termination_date = Some(termination_date);
            record.updated_at = Utc::now();
            Ok(record.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Insurance record {} not found",
                id
            )))
        }
    }
}

/// In-memory device token repository
#[derive(Debug, Default)]
pub struct MemoryDeviceTokenRepository {
    tokens: RwLock<HashMap<String, DeviceTokenEntity>>,
}

impl MemoryDeviceTokenRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl DeviceTokenRepository for MemoryDeviceTokenRepository {
    async fn register(&self, mut entity: DeviceTokenEntity) -> RepositoryResult<DeviceTokenEntity> {
        let mut tokens = self.tokens.write().unwrap();

        // Check for existing token for this user to simulate ON CONFLICT
        let existing_id = tokens
            .values()
            .find(|t| t.user_id == entity.user_id && t.token == entity.token)
            .map(|t| t.id.clone());

        if let Some(id) = existing_id {
            if let Some(existing) = tokens.get_mut(&id) {
                existing.device_type = entity.device_type.clone();
                existing.device_name = entity.device_name.clone();
                existing.last_seen_at = Utc::now();
                return Ok(existing.clone());
            }
        }

        entity.last_seen_at = Utc::now();
        entity.created_at = Utc::now();
        tokens.insert(entity.id.clone(), entity.clone());
        Ok(entity)
    }

    async fn get_by_user(&self, user_id: &str) -> RepositoryResult<Vec<DeviceTokenEntity>> {
        let tokens = self.tokens.read().unwrap();
        let result = tokens
            .values()
            .filter(|t| t.user_id == user_id)
            .cloned()
            .collect();
        Ok(result)
    }

    async fn delete(&self, user_id: &str, token: &str) -> RepositoryResult<()> {
        let mut tokens = self.tokens.write().unwrap();
        let id_to_remove = tokens
            .values()
            .find(|t| t.user_id == user_id && t.token == token)
            .map(|t| t.id.clone());

        if let Some(id) = id_to_remove {
            tokens.remove(&id);
        }
        Ok(())
    }

    async fn update_last_seen(&self, id: &str) -> RepositoryResult<()> {
        let mut tokens = self.tokens.write().unwrap();
        if let Some(token) = tokens.get_mut(id) {
            token.last_seen_at = Utc::now();
            Ok(())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Device token {} not found",
                id
            )))
        }
    }
}

/// In-memory billing code repository
#[derive(Debug, Default)]
pub struct MemoryBillingCodeRepository {
    codes: RwLock<HashMap<String, BillingCodeEntity>>,
}

impl MemoryBillingCodeRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl BillingCodeRepository for MemoryBillingCodeRepository {
    async fn create(&self, code: BillingCodeEntity) -> RepositoryResult<BillingCodeEntity> {
        let mut codes = self.codes.write().unwrap();
        codes.insert(code.id.clone(), code.clone());
        Ok(code)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<BillingCodeEntity> {
        let codes = self.codes.read().unwrap();
        codes
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Billing code {} not found", id)))
    }

    async fn get_by_code(
        &self,
        code_type: &str,
        code: &str,
    ) -> RepositoryResult<Option<BillingCodeEntity>> {
        let codes = self.codes.read().unwrap();
        Ok(codes
            .values()
            .find(|c| c.code_type == code_type && c.code == code)
            .cloned())
    }

    async fn search(
        &self,
        query: &str,
        code_type: Option<&str>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<BillingCodeEntity>> {
        let codes = self.codes.read().unwrap();
        let query_lower = query.to_lowercase();
        let filtered: Vec<_> = codes
            .values()
            .filter(|c| code_type.is_none_or(|t| c.code_type == t))
            .filter(|c| {
                c.code.to_lowercase().contains(&query_lower)
                    || c.description.to_lowercase().contains(&query_lower)
            })
            .cloned()
            .collect();
        let total = filtered.len() as u64;
        let items: Vec<_> = filtered
            .into_iter()
            .skip(pagination.offset() as usize)
            .take(pagination.limit() as usize)
            .collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(&self, code: BillingCodeEntity) -> RepositoryResult<BillingCodeEntity> {
        let mut codes = self.codes.write().unwrap();
        if codes.contains_key(&code.id) {
            codes.insert(code.id.clone(), code.clone());
            Ok(code)
        } else {
            Err(RepositoryError::NotFound(format!(
                "Billing code {} not found",
                code.id
            )))
        }
    }

    async fn get_by_category(&self, category: &str) -> RepositoryResult<Vec<BillingCodeEntity>> {
        let codes = self.codes.read().unwrap();
        let result: Vec<_> = codes
            .values()
            .filter(|c| c.category.as_deref() == Some(category) && c.is_active)
            .cloned()
            .collect();
        Ok(result)
    }

    async fn get_active(&self, code_type: &str) -> RepositoryResult<Vec<BillingCodeEntity>> {
        let codes = self.codes.read().unwrap();
        let result: Vec<_> = codes
            .values()
            .filter(|c| c.code_type == code_type && c.is_active)
            .cloned()
            .collect();
        Ok(result)
    }

    async fn deactivate(&self, id: &str) -> RepositoryResult<BillingCodeEntity> {
        let mut codes = self.codes.write().unwrap();
        if let Some(code) = codes.get_mut(id) {
            code.is_active = false;
            code.updated_at = Utc::now();
            Ok(code.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Billing code {} not found",
                id
            )))
        }
    }

    async fn list_by_type(
        &self,
        code_type: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<BillingCodeEntity>> {
        let codes = self.codes.read().unwrap();
        let filtered: Vec<_> = codes
            .values()
            .filter(|c| c.code_type == code_type && c.is_active)
            .cloned()
            .collect();
        let total = filtered.len() as u64;
        let items: Vec<_> = filtered
            .into_iter()
            .skip(pagination.offset() as usize)
            .take(pagination.limit() as usize)
            .collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_wearable_device_crud() {
        let repo = MemoryWearableDeviceRepository::new();

        let device = WearableDeviceEntity {
            id: "dev-001".to_string(),
            patient_id: "patient-001".to_string(),
            device_type: "smartwatch".to_string(),
            device_manufacturer: Some("Apple".to_string()),
            device_model: Some("Watch Series 9".to_string()),
            device_serial_number: Some("ABC123".to_string()),
            firmware_version: Some("10.0".to_string()),
            registered_datetime: Utc::now(),
            registered_by: "provider-001".to_string(),
            last_sync_datetime: None,
            sync_frequency_minutes: Some(15),
            battery_level_percent: Some(85),
            is_active: true,
            connection_status: Some("connected".to_string()),
            alert_thresholds: None,
            integration_api_key: None,
            integration_endpoint: None,
            notes: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let created = repo.create(device.clone()).await.unwrap();
        assert_eq!(created.id, "dev-001");

        let fetched = repo.get_by_id("dev-001").await.unwrap();
        assert_eq!(fetched.device_type, "smartwatch");

        let patient_devices = repo.get_by_patient("patient-001").await.unwrap();
        assert_eq!(patient_devices.len(), 1);

        let active = repo.get_active().await.unwrap();
        assert_eq!(active.len(), 1);
    }

    #[tokio::test]
    async fn test_telehealth_session_flow() {
        let repo = MemoryTelehealthSessionRepository::new();

        let session = TelehealthSessionEntity {
            id: "session-001".to_string(),
            patient_id: "patient-001".to_string(),
            provider_id: "provider-001".to_string(),
            appointment_id: None,
            session_type: "video".to_string(),
            scheduled_datetime: Utc::now() + chrono::Duration::hours(1),
            actual_start_datetime: None,
            actual_end_datetime: None,
            duration_minutes: None,
            status: "scheduled".to_string(),
            platform: Some("zoom".to_string()),
            session_url: Some("https://zoom.us/j/123".to_string()),
            session_access_code: Some("123456".to_string()),
            patient_location: Some("CA".to_string()),
            patient_device_type: Some("desktop".to_string()),
            provider_location: Some("CA".to_string()),
            connection_quality: None,
            technical_issues: None,
            interpreter_required: Some(false),
            interpreter_language: None,
            interpreter_present: None,
            guardian_present: None,
            guardian_name: None,
            consent_obtained: true,
            consent_datetime: Some(Utc::now()),
            billing_code: Some("99213".to_string()),
            reason_for_visit: Some("Follow-up".to_string()),
            chief_complaint: None,
            follow_up_required: None,
            follow_up_notes: None,
            recording_available: None,
            recording_url: None,
            created_by: "provider-001".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let created = repo.create(session).await.unwrap();
        assert_eq!(created.status, "scheduled");

        let started = repo.start_session("session-001").await.unwrap();
        assert_eq!(started.status, "in_progress");
        assert!(started.actual_start_datetime.is_some());

        let ended = repo.end_session("session-001").await.unwrap();
        assert_eq!(ended.status, "completed");
        assert!(ended.actual_end_datetime.is_some());
    }

    #[tokio::test]
    async fn test_cds_alert_workflow() {
        let repo = MemoryCdsAlertRepository::new();

        let alert = CdsAlertEntity {
            id: "alert-001".to_string(),
            patient_id: "patient-001".to_string(),
            encounter_id: None,
            provider_id: "provider-001".to_string(),
            alert_datetime: Utc::now(),
            alert_type: "drug_interaction".to_string(),
            alert_category: "safety".to_string(),
            severity: "critical".to_string(),
            alert_title: "Drug Interaction".to_string(),
            alert_message: "Potential interaction between medications".to_string(),
            clinical_evidence: None,
            recommendation: Some("Consider alternative".to_string()),
            source_system: Some("CDS Engine".to_string()),
            rule_id: Some("DI-001".to_string()),
            rule_version: Some("1.0".to_string()),
            trigger_data: None,
            related_order_id: None,
            related_medication_id: None,
            related_lab_id: None,
            status: "active".to_string(),
            acknowledged_by: None,
            acknowledged_datetime: None,
            override_reason: None,
            override_justification: None,
            action_taken: None,
            action_datetime: None,
            auto_resolved: None,
            resolution_reason: None,
            was_helpful: None,
            feedback_notes: None,
            displayed_duration_seconds: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let created = repo.create(alert).await.unwrap();
        assert_eq!(created.status, "active");

        let acknowledged = repo
            .acknowledge("alert-001", "provider-001", Some("Reviewed"))
            .await
            .unwrap();
        assert_eq!(acknowledged.status, "acknowledged");
        assert!(acknowledged.acknowledged_datetime.is_some());
    }

    #[tokio::test]
    async fn test_insurance_record_operations() {
        let repo = MemoryInsuranceRecordRepository::new();

        // Use dynamic dates to ensure the insurance is always active
        let today = chrono::Utc::now().date_naive();
        let effective_date = today - chrono::Duration::days(30);
        let termination_date = today + chrono::Duration::days(365);

        let record = InsuranceRecordEntity {
            id: "ins-001".to_string(),
            patient_id: "patient-001".to_string(),
            insurance_type: "primary".to_string(),
            payer_name: "Blue Cross".to_string(),
            payer_id: Some("BCBS".to_string()),
            plan_name: Some("Gold Plan".to_string()),
            plan_type: Some("PPO".to_string()),
            policy_number: "POL123456".to_string(),
            group_number: Some("GRP789".to_string()),
            subscriber_id: "SUB001".to_string(),
            subscriber_name: Some("John Doe".to_string()),
            subscriber_relationship: Some("self".to_string()),
            subscriber_dob: None,
            effective_date,
            termination_date: Some(termination_date),
            is_active: true,
            copay_amount: Some(rust_decimal::Decimal::new(2500, 2)),
            deductible_amount: Some(rust_decimal::Decimal::new(100000, 2)),
            deductible_met: Some(rust_decimal::Decimal::new(50000, 2)),
            out_of_pocket_max: Some(rust_decimal::Decimal::new(500000, 2)),
            out_of_pocket_met: Some(rust_decimal::Decimal::new(100000, 2)),
            coinsurance_percent: Some(rust_decimal::Decimal::new(20, 0)),
            coverage_details: None,
            prior_auth_required: Some(false),
            prior_auth_phone: None,
            claims_address: None,
            claims_phone: None,
            claims_fax: None,
            electronic_claims_eligible: Some(true),
            verification_status: Some("pending".to_string()),
            last_verified_date: None,
            last_verified_by: None,
            verification_notes: None,
            card_front_image_url: None,
            card_back_image_url: None,
            notes: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let created = repo.create(record).await.unwrap();
        assert!(created.is_active);

        let verified = repo
            .verify("ins-001", "staff-001", Some("Verified via phone"))
            .await
            .unwrap();
        assert_eq!(verified.verification_status, Some("verified".to_string()));

        let active = repo.get_active_by_patient("patient-001").await.unwrap();
        assert_eq!(active.len(), 1);
    }
}
