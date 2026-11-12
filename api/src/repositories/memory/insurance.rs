//! In-memory repositories for insurance records.

use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
