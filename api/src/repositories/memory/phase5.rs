//! In-memory implementations for Phase 7-10 repositories.
//!
//! This module provides HashMap-based implementations for testing and development.
//! Phases covered:
//! - Phase 7: Wearables & IoT
//! - Phase 8: Telehealth
//! - Phase 9: Clinical Decision Support
//! - Phase 10: Insurance & Billing

use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

// =============================================================================
// PHASE 7: WEARABLES & IOT
// =============================================================================

// =============================================================================
// PHASE 8: TELEHEALTH
// =============================================================================

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

    async fn update(&self, alert: CdsAlertEntity) -> RepositoryResult<CdsAlertEntity> {
        let mut alerts = self.alerts.write().unwrap();
        if !alerts.contains_key(&alert.id) {
            return Err(RepositoryError::NotFound(format!(
                "CDS alert {} not found",
                alert.id
            )));
        }
        alerts.insert(alert.id.clone(), alert.clone());
        Ok(alert)
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

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CdsAlertEntity>> {
        let alerts = self.alerts.read().unwrap();
        let all: Vec<_> = alerts.values().cloned().collect();
        let total = all.len() as u64;
        let items: Vec<_> = all
            .into_iter()
            .skip(pagination.offset() as usize)
            .take(pagination.limit() as usize)
            .collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }
    async fn count_by_severity(&self) -> RepositoryResult<(u64, u64)> {
        let alerts = self
            .alerts
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let total = alerts.len() as u64;
        let critical = alerts
            .values()
            .filter(|a| a.severity.eq_ignore_ascii_case("critical"))
            .count() as u64;
        Ok((total, critical))
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

/// In-memory SMS opt-out repository
#[derive(Debug, Default)]
pub struct MemorySmsOptOutRepository {
    opt_outs: RwLock<HashMap<String, SmsOptOutEntity>>,
}

impl MemorySmsOptOutRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl SmsOptOutRepository for MemorySmsOptOutRepository {
    async fn add_opt_out(&self, entity: SmsOptOutEntity) -> RepositoryResult<()> {
        let mut opt_outs = self.opt_outs.write().unwrap();
        opt_outs.insert(entity.phone_number.clone(), entity);
        Ok(())
    }

    async fn is_opted_out(&self, phone_number: &str) -> RepositoryResult<bool> {
        let opt_outs = self.opt_outs.read().unwrap();
        Ok(opt_outs.contains_key(phone_number))
    }

    async fn remove_opt_out(&self, phone_number: &str) -> RepositoryResult<()> {
        let mut opt_outs = self.opt_outs.write().unwrap();
        opt_outs.remove(phone_number);
        Ok(())
    }
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

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
            currency: Some("ZAR".to_string()),
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

    // -------- Phase 2.2 coverage: insurance lifecycle methods --------

    fn make_insurance(
        id: &str,
        patient: &str,
        kind: &str,
        term_days: i64,
    ) -> InsuranceRecordEntity {
        let today = chrono::Utc::now().date_naive();
        let now = Utc::now();
        InsuranceRecordEntity {
            id: id.to_string(),
            patient_id: patient.to_string(),
            insurance_type: kind.to_string(),
            payer_name: "Acme".to_string(),
            payer_id: None,
            plan_name: None,
            plan_type: None,
            policy_number: format!("POL-{id}"),
            group_number: None,
            subscriber_id: "SUB".to_string(),
            subscriber_name: None,
            subscriber_relationship: None,
            subscriber_dob: None,
            effective_date: today - chrono::Duration::days(30),
            termination_date: Some(today + chrono::Duration::days(term_days)),
            is_active: true,
            copay_amount: None,
            currency: Some("ZAR".to_string()),
            deductible_amount: None,
            deductible_met: None,
            out_of_pocket_max: None,
            out_of_pocket_met: None,
            coinsurance_percent: None,
            coverage_details: None,
            prior_auth_required: None,
            prior_auth_phone: None,
            claims_address: None,
            claims_phone: None,
            claims_fax: None,
            electronic_claims_eligible: None,
            verification_status: None,
            last_verified_date: None,
            last_verified_by: None,
            verification_notes: None,
            card_front_image_url: None,
            card_back_image_url: None,
            notes: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn test_insurance_deactivate_and_terminate() {
        let repo = MemoryInsuranceRecordRepository::new();
        repo.create(make_insurance("ins-A", "pat-X", "primary", 60))
            .await
            .unwrap();

        let deactivated = repo.deactivate("ins-A").await.unwrap();
        assert!(!deactivated.is_active);

        let term_date = chrono::Utc::now().date_naive() + chrono::Duration::days(5);
        let terminated = repo.terminate("ins-A", term_date).await.unwrap();
        assert_eq!(terminated.termination_date, Some(term_date));
        assert!(!terminated.is_active);
    }

    #[tokio::test]
    async fn test_insurance_get_primary_and_set_primary() {
        let repo = MemoryInsuranceRecordRepository::new();
        repo.create(make_insurance("ins-1", "pat-Y", "primary", 100))
            .await
            .unwrap();
        repo.create(make_insurance("ins-2", "pat-Y", "secondary", 100))
            .await
            .unwrap();

        let primary = repo.get_primary("pat-Y").await.unwrap().unwrap();
        assert_eq!(primary.id, "ins-1");

        repo.set_primary("pat-Y", "ins-2").await.unwrap();

        let new_primary = repo.get_primary("pat-Y").await.unwrap().unwrap();
        assert_eq!(new_primary.id, "ins-2");
        assert_eq!(
            repo.get_by_id("ins-1").await.unwrap().insurance_type,
            "secondary"
        );
    }

    #[tokio::test]
    async fn test_insurance_get_expiring_and_active() {
        let repo = MemoryInsuranceRecordRepository::new();
        repo.create(make_insurance("ins-soon", "pat-Z", "primary", 10))
            .await
            .unwrap();
        repo.create(make_insurance("ins-far", "pat-Z", "secondary", 400))
            .await
            .unwrap();

        let expiring = repo.get_expiring(30).await.unwrap();
        assert!(expiring.iter().any(|r| r.id == "ins-soon"));
        assert!(!expiring.iter().any(|r| r.id == "ins-far"));

        let active = repo.get_active("pat-Z").await.unwrap();
        assert_eq!(active.len(), 2);
    }

    #[tokio::test]
    async fn test_insurance_verify_eligibility() {
        let repo = MemoryInsuranceRecordRepository::new();
        repo.create(make_insurance("ins-V", "pat-V", "primary", 60))
            .await
            .unwrap();

        let verified = repo.verify_eligibility("ins-V", "staff-007").await.unwrap();
        assert_eq!(verified.verification_status.as_deref(), Some("verified"));
        assert_eq!(verified.last_verified_by.as_deref(), Some("staff-007"));
    }

    // -------- Phase 2.2 coverage: billing code methods --------

    // -------- Phase 2.2 coverage: CDS alert methods --------

    fn make_alert(id: &str, severity: &str, encounter: Option<&str>, rule: &str) -> CdsAlertEntity {
        CdsAlertEntity {
            id: id.to_string(),
            patient_id: "pat-1".to_string(),
            encounter_id: encounter.map(|e| e.to_string()),
            provider_id: "prov-1".to_string(),
            alert_datetime: Utc::now(),
            alert_type: "drug_interaction".to_string(),
            alert_category: "safety".to_string(),
            severity: severity.to_string(),
            alert_title: "Test".to_string(),
            alert_message: "msg".to_string(),
            clinical_evidence: None,
            recommendation: None,
            source_system: None,
            rule_id: Some(rule.to_string()),
            rule_version: None,
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
        }
    }

    #[tokio::test]
    async fn test_cds_alert_dismiss_and_filters() {
        let repo = MemoryCdsAlertRepository::new();
        repo.create(make_alert("a-1", "critical", Some("enc-1"), "R-A"))
            .await
            .unwrap();
        repo.create(make_alert("a-2", "low", Some("enc-1"), "R-B"))
            .await
            .unwrap();
        repo.create(make_alert("a-3", "high", None, "R-A"))
            .await
            .unwrap();

        // get_by_encounter
        let in_enc = repo.get_by_encounter("enc-1").await.unwrap();
        assert_eq!(in_enc.len(), 2);

        // get_unacknowledged (with patient filter and without)
        let all_unack = repo.get_unacknowledged(None).await.unwrap();
        assert_eq!(all_unack.len(), 3);
        let pat_unack = repo.get_unacknowledged(Some("pat-1")).await.unwrap();
        assert_eq!(pat_unack.len(), 3);

        // get_high_severity (critical + high, excludes low)
        let high = repo.get_high_severity().await.unwrap();
        assert_eq!(high.len(), 2);

        // get_by_rule pagination
        let by_rule = repo
            .get_by_rule("R-A", Pagination::new(0, 10))
            .await
            .unwrap();
        assert_eq!(by_rule.total, 2);

        // dismiss
        let dismissed = repo.dismiss("a-2").await.unwrap();
        assert_eq!(dismissed.status, "dismissed");
    }
}
