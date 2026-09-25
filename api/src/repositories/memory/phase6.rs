//! In-memory implementations for Phase 11-15 repositories.
//!
//! These implementations use thread-safe HashMap storage and are useful
//! for development, testing, and environments without PostgreSQL.
//!
//! Phases:
//!   11. Family History & Genetics
//!   12. Immunization Records
//!   13. Death Records & Certification
//!   14. Data Synchronization & Conflict Resolution
//!   15. Enhanced Audit & Compliance

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

// =============================================================================
// PHASE 11: FAMILY HISTORY & GENETICS
// =============================================================================

// =============================================================================
// PHASE 12: IMMUNIZATION RECORDS
// =============================================================================

/// In-memory immunization record repository
#[derive(Debug, Default)]
pub struct MemoryImmunizationRecordRepository {
    records: RwLock<HashMap<String, ImmunizationRecordEntity>>,
}

impl MemoryImmunizationRecordRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl ImmunizationRecordRepository for MemoryImmunizationRecordRepository {
    async fn create(
        &self,
        record: ImmunizationRecordEntity,
    ) -> RepositoryResult<ImmunizationRecordEntity> {
        let mut records = self.records.write().unwrap();
        records.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ImmunizationRecordEntity> {
        let records = self.records.read().unwrap();
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Immunization {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_by_vaccine_type(
        &self,
        patient_id: &str,
        vaccine_type: &str,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.patient_id == patient_id && r.vaccine_type == vaccine_type)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn update(
        &self,
        record: ImmunizationRecordEntity,
    ) -> RepositoryResult<ImmunizationRecordEntity> {
        let mut records = self.records.write().unwrap();
        if !records.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "Immunization {} not found",
                record.id
            )));
        }
        records.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_recent(
        &self,
        patient_id: &str,
        days: i32,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>> {
        let cutoff = chrono::Utc::now().date_naive() - chrono::Duration::days(days as i64);
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.patient_id == patient_id && r.administration_date >= cutoff)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_by_lot_number(
        &self,
        lot_number: &str,
    ) -> RepositoryResult<Vec<ImmunizationRecordEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.lot_number
                    .as_ref()
                    .map(|l| l == lot_number)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        Ok(items)
    }

    async fn list_all(&self) -> RepositoryResult<Vec<ImmunizationRecordEntity>> {
        let records = self.records.read().unwrap();
        Ok(records.values().cloned().collect())
    }
}

// =============================================================================
// PHASE 13: DEATH RECORDS & CERTIFICATION
// =============================================================================

// =============================================================================
// PHASE 14: DATA SYNCHRONIZATION & CONFLICT RESOLUTION
// =============================================================================

/// In-memory sync conflict repository
#[derive(Debug, Default)]
pub struct MemorySyncConflictRepository {
    records: RwLock<HashMap<String, SyncConflictEntity>>,
}

impl MemorySyncConflictRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl SyncConflictRepository for MemorySyncConflictRepository {
    async fn create(&self, conflict: SyncConflictEntity) -> RepositoryResult<SyncConflictEntity> {
        let mut records = self.records.write().unwrap();
        records.insert(conflict.id.clone(), conflict.clone());
        Ok(conflict)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<SyncConflictEntity> {
        let records = self.records.read().unwrap();
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Sync conflict {} not found", id)))
    }

    async fn get_by_operation(
        &self,
        operation_id: &str,
    ) -> RepositoryResult<Vec<SyncConflictEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.sync_operation_id
                    .as_ref()
                    .map(|o| o == operation_id)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_pending(&self) -> RepositoryResult<Vec<SyncConflictEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.status.as_ref().map(|s| s == "pending").unwrap_or(false))
            .cloned()
            .collect();
        Ok(items)
    }

    async fn resolve(
        &self,
        id: &str,
        resolved_value: &str,
        resolved_by: &str,
        notes: Option<&str>,
    ) -> RepositoryResult<SyncConflictEntity> {
        let mut records = self.records.write().unwrap();
        let conflict = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Sync conflict {} not found", id)))?;
        conflict.status = Some("manually_resolved".to_string());
        conflict.resolved_value = Some(resolved_value.to_string());
        conflict.resolved_by = Some(resolved_by.to_string());
        conflict.resolved_at = Some(chrono::Utc::now());
        conflict.resolution_notes = notes.map(|n| n.to_string());
        Ok(conflict.clone())
    }

    async fn get_by_entity(
        &self,
        entity_type: &str,
        entity_id: &str,
    ) -> RepositoryResult<Vec<SyncConflictEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.entity_type == entity_type && r.entity_id == entity_id)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_auto_resolvable(&self) -> RepositoryResult<Vec<SyncConflictEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.status.as_deref() == Some("pending") && r.resolution_strategy.is_some())
            .cloned()
            .collect();
        Ok(items)
    }
}

// =============================================================================
// PHASE 15: ENHANCED AUDIT & COMPLIANCE
// =============================================================================

/// In-memory data retention policy repository
#[derive(Debug, Default)]
pub struct MemoryDataRetentionPolicyRepository {
    records: RwLock<HashMap<String, DataRetentionPolicyEntity>>,
}

impl MemoryDataRetentionPolicyRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl DataRetentionPolicyRepository for MemoryDataRetentionPolicyRepository {
    /// Policies in force today.
    ///
    /// Mirrors the PostgreSQL predicate: active, already effective, and not
    /// past its end date.
    async fn get_due_for_execution(&self) -> RepositoryResult<Vec<DataRetentionPolicyEntity>> {
        let today = chrono::Utc::now().date_naive();
        let records = self.records.read().unwrap();
        let mut items: Vec<DataRetentionPolicyEntity> = records
            .values()
            .filter(|p| {
                p.is_active.unwrap_or(false)
                    && p.effective_date <= today
                    && p.end_date.map(|d| d > today).unwrap_or(true)
            })
            .cloned()
            .collect();
        items.sort_by(|a, b| a.policy_name.cmp(&b.policy_name));
        Ok(items)
    }

    async fn create(
        &self,
        policy: DataRetentionPolicyEntity,
    ) -> RepositoryResult<DataRetentionPolicyEntity> {
        let mut records = self.records.write().unwrap();
        records.insert(policy.id.clone(), policy.clone());
        Ok(policy)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<DataRetentionPolicyEntity> {
        let records = self.records.read().unwrap();
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Retention policy {} not found", id)))
    }

    async fn get_by_entity_type(
        &self,
        entity_type: &str,
    ) -> RepositoryResult<Vec<DataRetentionPolicyEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.entity_type == entity_type)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_active(&self) -> RepositoryResult<Vec<DataRetentionPolicyEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.is_active.unwrap_or(false))
            .cloned()
            .collect();
        Ok(items)
    }

    async fn update(
        &self,
        policy: DataRetentionPolicyEntity,
    ) -> RepositoryResult<DataRetentionPolicyEntity> {
        let mut records = self.records.write().unwrap();
        if !records.contains_key(&policy.id) {
            return Err(RepositoryError::NotFound(format!(
                "Retention policy {} not found",
                policy.id
            )));
        }
        records.insert(policy.id.clone(), policy.clone());
        Ok(policy)
    }

    async fn deactivate(&self, id: &str) -> RepositoryResult<DataRetentionPolicyEntity> {
        let mut records = self.records.write().unwrap();
        let policy = records.get_mut(id).ok_or_else(|| {
            RepositoryError::NotFound(format!("Retention policy {} not found", id))
        })?;
        policy.is_active = Some(false);
        Ok(policy.clone())
    }

    async fn get_due_for_review(&self) -> RepositoryResult<Vec<DataRetentionPolicyEntity>> {
        let today = chrono::Utc::now().date_naive();
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.is_active.unwrap_or(false)
                    && r.last_reviewed_date
                        .and_then(|d| {
                            r.review_frequency_days
                                .map(|f| d + chrono::Duration::days(f as i64))
                        })
                        .map(|next| next <= today)
                        .unwrap_or(true)
            })
            .cloned()
            .collect();
        Ok(items)
    }
}

/// In-memory retention job run repository
#[derive(Debug, Default)]
pub struct MemoryRetentionJobRunRepository {
    records: RwLock<HashMap<String, RetentionJobRunEntity>>,
}

impl MemoryRetentionJobRunRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl RetentionJobRunRepository for MemoryRetentionJobRunRepository {
    async fn get_by_status(&self, status: &str) -> RepositoryResult<Vec<RetentionJobRunEntity>> {
        let records = self.records.read().unwrap();
        let mut items: Vec<RetentionJobRunEntity> = records
            .values()
            .filter(|r| r.status.as_deref() == Some(status))
            .cloned()
            .collect();
        items.sort_by_key(|r| std::cmp::Reverse(r.started_at));
        Ok(items)
    }

    /// Runs that started and have not finished.
    ///
    /// Keyed on `completed_at` being absent rather than on a status string, so
    /// a run that died without updating its status is still reported as
    /// outstanding instead of silently disappearing from the queue.
    async fn get_in_progress(&self) -> RepositoryResult<Vec<RetentionJobRunEntity>> {
        let records = self.records.read().unwrap();
        Ok(records
            .values()
            .filter(|r| r.started_at.is_some() && r.completed_at.is_none())
            .cloned()
            .collect())
    }

    async fn create(&self, job: RetentionJobRunEntity) -> RepositoryResult<RetentionJobRunEntity> {
        let mut records = self.records.write().unwrap();
        records.insert(job.id.clone(), job.clone());
        Ok(job)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<RetentionJobRunEntity> {
        let records = self.records.read().unwrap();
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Retention job {} not found", id)))
    }

    async fn get_by_policy(&self, policy_id: &str) -> RepositoryResult<Vec<RetentionJobRunEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.policy_id
                    .as_ref()
                    .map(|p| p == policy_id)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_recent(&self, limit: i32) -> RepositoryResult<Vec<RetentionJobRunEntity>> {
        let records = self.records.read().unwrap();
        let mut items: Vec<_> = records.values().cloned().collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.started_at));
        items.truncate(limit as usize);
        Ok(items)
    }

    async fn update(&self, job: RetentionJobRunEntity) -> RepositoryResult<RetentionJobRunEntity> {
        let mut records = self.records.write().unwrap();
        if !records.contains_key(&job.id) {
            return Err(RepositoryError::NotFound(format!(
                "Retention job {} not found",
                job.id
            )));
        }
        records.insert(job.id.clone(), job.clone());
        Ok(job)
    }

    async fn complete(
        &self,
        id: &str,
        archived: i32,
        deleted: i32,
        skipped: i32,
    ) -> RepositoryResult<RetentionJobRunEntity> {
        let mut records = self.records.write().unwrap();
        let job = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Retention job {} not found", id)))?;
        job.status = Some("completed".to_string());
        job.completed_at = Some(chrono::Utc::now());
        job.records_archived = Some(archived);
        job.records_deleted = Some(deleted);
        job.records_skipped = Some(skipped);
        Ok(job.clone())
    }

    async fn fail(
        &self,
        id: &str,
        error_details: serde_json::Value,
    ) -> RepositoryResult<RetentionJobRunEntity> {
        let mut records = self.records.write().unwrap();
        let job = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Retention job {} not found", id)))?;
        job.status = Some("failed".to_string());
        job.completed_at = Some(chrono::Utc::now());
        job.error_details = Some(error_details);
        Ok(job.clone())
    }
}

/// In-memory consent record repository
#[derive(Debug, Default)]
pub struct MemoryConsentRecordRepository {
    records: RwLock<HashMap<String, ConsentRecordEntity>>,
}

impl MemoryConsentRecordRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl ConsentRecordRepository for MemoryConsentRecordRepository {
    async fn create(&self, consent: ConsentRecordEntity) -> RepositoryResult<ConsentRecordEntity> {
        let mut records = self.records.write().unwrap();
        records.insert(consent.id.clone(), consent.clone());
        Ok(consent)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ConsentRecordEntity> {
        let records = self.records.read().unwrap();
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Consent {} not found", id)))
    }

    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_active_by_type(
        &self,
        patient_id: &str,
        consent_type: &str,
    ) -> RepositoryResult<Option<ConsentRecordEntity>> {
        let now = chrono::Utc::now();
        let records = self.records.read().unwrap();
        Ok(records
            .values()
            .find(|r| {
                r.patient_id == patient_id
                    && r.consent_type == consent_type
                    && !r.revoked.unwrap_or(false)
                    && r.expiration_datetime.map(|e| e > now).unwrap_or(true)
            })
            .cloned())
    }

    async fn get_active(&self, patient_id: &str) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let now = chrono::Utc::now();
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.patient_id == patient_id
                    && !r.revoked.unwrap_or(false)
                    && r.expiration_datetime.map(|e| e > now).unwrap_or(true)
            })
            .cloned()
            .collect();
        Ok(items)
    }

    async fn update(&self, consent: ConsentRecordEntity) -> RepositoryResult<ConsentRecordEntity> {
        let mut records = self.records.write().unwrap();
        if !records.contains_key(&consent.id) {
            return Err(RepositoryError::NotFound(format!(
                "Consent {} not found",
                consent.id
            )));
        }
        records.insert(consent.id.clone(), consent.clone());
        Ok(consent)
    }

    async fn revoke(
        &self,
        id: &str,
        revoked_by: &str,
        reason: Option<&str>,
    ) -> RepositoryResult<ConsentRecordEntity> {
        let mut records = self.records.write().unwrap();
        let consent = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Consent {} not found", id)))?;
        if consent.revoked.unwrap_or(false) {
            return Err(RepositoryError::Validation(format!(
                "Consent {} is already revoked",
                id
            )));
        }
        consent.revoked = Some(true);
        consent.revoked_by = Some(revoked_by.to_string());
        consent.revocation_reason = reason.map(|r| r.to_string());
        consent.revoked_datetime = Some(chrono::Utc::now());
        // Both the authoritative status and its legacy boolean projection move
        // together. This backend previously left `consent_given` true on a
        // revoked record, diverging from the Postgres implementation, which
        // clears it — a revoked consent that still reads as "given" is exactly
        // the kind of disagreement between backends that makes a consent audit
        // untrustworthy.
        consent.consent_given = false;
        consent.consent_status = crate::types::ConsentStatus::Withdrawn.as_str().to_string();
        Ok(consent.clone())
    }

    async fn get_by_type(
        &self,
        patient_id: &str,
        consent_type: &str,
    ) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.patient_id == patient_id && r.consent_type == consent_type)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn check_consent(
        &self,
        patient_id: &str,
        consent_type: &str,
        purpose: &str,
    ) -> RepositoryResult<bool> {
        let records = self.records.read().unwrap();
        let has_consent = records.values().any(|r| {
            r.patient_id == patient_id
                && r.consent_type == consent_type
                && r.purpose.as_deref() == Some(purpose)
                && !r.revoked.unwrap_or(false)
        });
        Ok(has_consent)
    }

    async fn get_expiring_soon(&self, days: i32) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let now = chrono::Utc::now();
        let cutoff = now + chrono::Duration::days(days as i64);
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                !r.revoked.unwrap_or(false)
                    && r.expiration_datetime
                        .map(|e| e > now && e <= cutoff)
                        .unwrap_or(false)
            })
            .cloned()
            .collect();
        Ok(items)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_immunization_crud() {
        let repo = MemoryImmunizationRecordRepository::new();

        let record = ImmunizationRecordEntity {
            id: "IMM-001".to_string(),
            patient_id: "PAT-001".to_string(),
            vaccine_type: "COVID-19".to_string(),
            vaccine_name: "Pfizer-BioNTech".to_string(),
            administration_date: chrono::Utc::now().date_naive(),
            ..Default::default()
        };

        let created = repo.create(record).await.unwrap();
        assert_eq!(created.vaccine_type, "COVID-19");
    }

    #[tokio::test]
    async fn test_consent_active() {
        let repo = MemoryConsentRecordRepository::new();

        let consent = ConsentRecordEntity {
            id: "CON-001".to_string(),
            patient_id: "PAT-001".to_string(),
            consent_type: "hipaa_notice".to_string(),
            consent_given: true,
            // Must agree with `consent_given`, which is a derived projection of
            // this field rather than an independent value.
            consent_status: crate::types::ConsentStatus::Granted.as_str().to_string(),
            consent_datetime: chrono::Utc::now(),
            revoked: Some(false),
            ..Default::default()
        };

        repo.create(consent).await.unwrap();

        let active = repo
            .get_active_by_type("PAT-001", "hipaa_notice")
            .await
            .unwrap();
        assert!(active.is_some());
    }

    #[tokio::test]
    async fn consent_revocation_is_one_time_and_updates_status() {
        let repo = MemoryConsentRecordRepository::new();
        let consent = ConsentRecordEntity {
            id: "CON-REVOKE-001".to_string(),
            patient_id: "PAT-001".to_string(),
            consent_type: "treatment".to_string(),
            consent_given: true,
            consent_status: crate::types::ConsentStatus::Granted.as_str().to_string(),
            consent_datetime: chrono::Utc::now(),
            revoked: Some(false),
            ..Default::default()
        };
        repo.create(consent).await.unwrap();

        let revoked = repo
            .revoke("CON-REVOKE-001", "guardian-wallet", Some("withdrawn"))
            .await
            .unwrap();
        assert!(!revoked.consent_given);
        assert_eq!(
            revoked.consent_status,
            crate::types::ConsentStatus::Withdrawn.as_str()
        );
        assert!(repo
            .revoke("CON-REVOKE-001", "guardian-wallet", None)
            .await
            .is_err());
    }

    // -------- Phase 2.2 coverage: Death/Organ/Sync/External methods --------

    #[tokio::test]
    async fn test_sync_conflict_auto_resolvable() {
        let repo = MemorySyncConflictRepository::new();

        let with_strategy = SyncConflictEntity {
            id: "CF-1".to_string(),
            entity_type: "patient".to_string(),
            entity_id: "p-1".to_string(),
            conflict_type: "field_mismatch".to_string(),
            status: Some("pending".to_string()),
            resolution_strategy: Some("latest_wins".to_string()),
            ..Default::default()
        };
        let no_strategy = SyncConflictEntity {
            id: "CF-2".to_string(),
            entity_type: "patient".to_string(),
            entity_id: "p-2".to_string(),
            conflict_type: "field_mismatch".to_string(),
            status: Some("pending".to_string()),
            resolution_strategy: None,
            ..Default::default()
        };
        let already_resolved = SyncConflictEntity {
            id: "CF-3".to_string(),
            entity_type: "patient".to_string(),
            entity_id: "p-3".to_string(),
            conflict_type: "field_mismatch".to_string(),
            status: Some("manually_resolved".to_string()),
            resolution_strategy: Some("latest_wins".to_string()),
            ..Default::default()
        };
        repo.create(with_strategy).await.unwrap();
        repo.create(no_strategy).await.unwrap();
        repo.create(already_resolved).await.unwrap();

        let resolvable = repo.get_auto_resolvable().await.unwrap();
        assert_eq!(resolvable.len(), 1);
        assert_eq!(resolvable[0].id, "CF-1");
    }
}
