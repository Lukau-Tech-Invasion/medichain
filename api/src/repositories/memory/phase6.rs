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

/// In-memory family medical history repository
#[derive(Debug, Default)]
pub struct MemoryFamilyMedicalHistoryRepository {
    records: RwLock<HashMap<String, FamilyMedicalHistoryEntity>>,
}

impl MemoryFamilyMedicalHistoryRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl FamilyMedicalHistoryRepository for MemoryFamilyMedicalHistoryRepository {
    async fn create(
        &self,
        history: FamilyMedicalHistoryEntity,
    ) -> RepositoryResult<FamilyMedicalHistoryEntity> {
        let mut records = self.records.write().unwrap();
        records.insert(history.id.clone(), history.clone());
        Ok(history)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<FamilyMedicalHistoryEntity> {
        let records = self.records.read().unwrap();
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Family history {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<FamilyMedicalHistoryEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_by_relationship(
        &self,
        patient_id: &str,
        relationship: &str,
    ) -> RepositoryResult<Vec<FamilyMedicalHistoryEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.patient_id == patient_id && r.relationship == relationship)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn update(
        &self,
        history: FamilyMedicalHistoryEntity,
    ) -> RepositoryResult<FamilyMedicalHistoryEntity> {
        let mut records = self.records.write().unwrap();
        if !records.contains_key(&history.id) {
            return Err(RepositoryError::NotFound(format!(
                "Family history {} not found",
                history.id
            )));
        }
        records.insert(history.id.clone(), history.clone());
        Ok(history)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut records = self.records.write().unwrap();
        records.remove(id);
        Ok(())
    }

    async fn verify(
        &self,
        id: &str,
        verified_by: &str,
    ) -> RepositoryResult<FamilyMedicalHistoryEntity> {
        let mut records = self.records.write().unwrap();
        let history = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Family history {} not found", id)))?;
        history.verified = Some(true);
        history.verified_by = Some(verified_by.to_string());
        history.verified_date = Some(chrono::Utc::now().date_naive());
        Ok(history.clone())
    }
}

/// In-memory genetic test result repository
#[derive(Debug, Default)]
pub struct MemoryGeneticTestResultRepository {
    records: RwLock<HashMap<String, GeneticTestResultEntity>>,
}

impl MemoryGeneticTestResultRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl GeneticTestResultRepository for MemoryGeneticTestResultRepository {
    async fn create(
        &self,
        result: GeneticTestResultEntity,
    ) -> RepositoryResult<GeneticTestResultEntity> {
        let mut records = self.records.write().unwrap();
        records.insert(result.id.clone(), result.clone());
        Ok(result)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<GeneticTestResultEntity> {
        let records = self.records.read().unwrap();
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Genetic test {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<GeneticTestResultEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_by_test_type(
        &self,
        patient_id: &str,
        test_type: &str,
    ) -> RepositoryResult<Vec<GeneticTestResultEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.patient_id == patient_id && r.test_type == test_type)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn update(
        &self,
        result: GeneticTestResultEntity,
    ) -> RepositoryResult<GeneticTestResultEntity> {
        let mut records = self.records.write().unwrap();
        if !records.contains_key(&result.id) {
            return Err(RepositoryError::NotFound(format!(
                "Genetic test {} not found",
                result.id
            )));
        }
        records.insert(result.id.clone(), result.clone());
        Ok(result)
    }

    async fn get_pathogenic(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<GeneticTestResultEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.patient_id == patient_id
                    && r.clinical_significance
                        .as_ref()
                        .map(|s| s == "pathogenic" || s == "likely_pathogenic")
                        .unwrap_or(false)
            })
            .cloned()
            .collect();
        Ok(items)
    }
}

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

/// In-memory immunization schedule repository
#[derive(Debug, Default)]
pub struct MemoryImmunizationScheduleRepository {
    records: RwLock<HashMap<String, ImmunizationScheduleEntity>>,
}

impl MemoryImmunizationScheduleRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl ImmunizationScheduleRepository for MemoryImmunizationScheduleRepository {
    async fn create(
        &self,
        schedule: ImmunizationScheduleEntity,
    ) -> RepositoryResult<ImmunizationScheduleEntity> {
        let mut records = self.records.write().unwrap();
        records.insert(schedule.id.clone(), schedule.clone());
        Ok(schedule)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ImmunizationScheduleEntity> {
        let records = self.records.read().unwrap();
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Schedule {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ImmunizationScheduleEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_due(&self, patient_id: &str) -> RepositoryResult<Vec<ImmunizationScheduleEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.patient_id == patient_id && r.status.as_ref().map(|s| s == "due").unwrap_or(false)
            })
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_overdue(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ImmunizationScheduleEntity>> {
        let today = chrono::Utc::now().date_naive();
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.patient_id == patient_id
                    && r.status.as_ref().map(|s| s == "due").unwrap_or(false)
                    && r.due_date < today
            })
            .cloned()
            .collect();
        Ok(items)
    }

    async fn update(
        &self,
        schedule: ImmunizationScheduleEntity,
    ) -> RepositoryResult<ImmunizationScheduleEntity> {
        let mut records = self.records.write().unwrap();
        if !records.contains_key(&schedule.id) {
            return Err(RepositoryError::NotFound(format!(
                "Schedule {} not found",
                schedule.id
            )));
        }
        records.insert(schedule.id.clone(), schedule.clone());
        Ok(schedule)
    }

    async fn complete(
        &self,
        id: &str,
        immunization_id: &str,
    ) -> RepositoryResult<ImmunizationScheduleEntity> {
        let mut records = self.records.write().unwrap();
        let schedule = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Schedule {} not found", id)))?;
        schedule.status = Some("completed".to_string());
        schedule.completed_immunization_id = Some(immunization_id.to_string());
        Ok(schedule.clone())
    }

    async fn skip(&self, id: &str, reason: &str) -> RepositoryResult<ImmunizationScheduleEntity> {
        let mut records = self.records.write().unwrap();
        let schedule = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Schedule {} not found", id)))?;
        schedule.status = Some("skipped".to_string());
        schedule.skip_reason = Some(reason.to_string());
        Ok(schedule.clone())
    }

    async fn list_all(&self) -> RepositoryResult<Vec<ImmunizationScheduleEntity>> {
        let records = self.records.read().unwrap();
        Ok(records.values().cloned().collect())
    }
}

/// In-memory vaccine inventory repository
#[derive(Debug, Default)]
pub struct MemoryVaccineInventoryRepository {
    records: RwLock<HashMap<String, VaccineInventoryEntity>>,
}

impl MemoryVaccineInventoryRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl VaccineInventoryRepository for MemoryVaccineInventoryRepository {
    async fn create(
        &self,
        inventory: VaccineInventoryEntity,
    ) -> RepositoryResult<VaccineInventoryEntity> {
        let mut records = self.records.write().unwrap();
        records.insert(inventory.id.clone(), inventory.clone());
        Ok(inventory)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<VaccineInventoryEntity> {
        let records = self.records.read().unwrap();
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Inventory {} not found", id)))
    }

    async fn get_by_facility(
        &self,
        facility_id: &str,
    ) -> RepositoryResult<Vec<VaccineInventoryEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.facility_id
                    .as_ref()
                    .map(|f| f == facility_id)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_available(
        &self,
        facility_id: &str,
        vaccine_type: &str,
    ) -> RepositoryResult<Vec<VaccineInventoryEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.facility_id
                    .as_ref()
                    .map(|f| f == facility_id)
                    .unwrap_or(false)
                    && r.vaccine_type == vaccine_type
                    && r.status.as_ref().map(|s| s == "available").unwrap_or(false)
                    && r.quantity_remaining > 0
            })
            .cloned()
            .collect();
        Ok(items)
    }

    async fn update(
        &self,
        inventory: VaccineInventoryEntity,
    ) -> RepositoryResult<VaccineInventoryEntity> {
        let mut records = self.records.write().unwrap();
        if !records.contains_key(&inventory.id) {
            return Err(RepositoryError::NotFound(format!(
                "Inventory {} not found",
                inventory.id
            )));
        }
        records.insert(inventory.id.clone(), inventory.clone());
        Ok(inventory)
    }

    async fn decrement_quantity(
        &self,
        id: &str,
        amount: i32,
    ) -> RepositoryResult<VaccineInventoryEntity> {
        let mut records = self.records.write().unwrap();
        let inventory = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Inventory {} not found", id)))?;
        inventory.quantity_remaining = (inventory.quantity_remaining - amount).max(0);
        if inventory.quantity_remaining == 0 {
            inventory.status = Some("depleted".to_string());
        }
        Ok(inventory.clone())
    }

    async fn get_expiring_soon(&self, days: i32) -> RepositoryResult<Vec<VaccineInventoryEntity>> {
        let cutoff = chrono::Utc::now().date_naive() + chrono::Duration::days(days as i64);
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.status.as_ref().map(|s| s == "available").unwrap_or(false)
                    && r.expiration_date <= cutoff
            })
            .cloned()
            .collect();
        Ok(items)
    }

    async fn mark_recalled(
        &self,
        lot_number: &str,
        recall_number: &str,
    ) -> RepositoryResult<Vec<VaccineInventoryEntity>> {
        let mut records = self.records.write().unwrap();
        let mut updated: Vec<VaccineInventoryEntity> = Vec::new();
        for inv in records.values_mut() {
            if inv.lot_number == lot_number {
                inv.status = Some("recalled".to_string());
                inv.recall_number = Some(recall_number.to_string());
                updated.push(inv.clone());
            }
        }
        Ok(updated)
    }
}

// =============================================================================
// PHASE 13: DEATH RECORDS & CERTIFICATION
// =============================================================================

/// In-memory death record repository
#[derive(Debug, Default)]
pub struct MemoryDeathRecordRepository {
    records: RwLock<HashMap<String, DeathRecordEntity>>,
}

impl MemoryDeathRecordRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl DeathRecordRepository for MemoryDeathRecordRepository {
    async fn create(&self, record: DeathRecordEntity) -> RepositoryResult<DeathRecordEntity> {
        let mut records = self.records.write().unwrap();
        records.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<DeathRecordEntity> {
        let records = self.records.read().unwrap();
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Death record {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<DeathRecordEntity>> {
        let records = self.records.read().unwrap();
        Ok(records
            .values()
            .find(|r| r.patient_id == patient_id)
            .cloned())
    }

    async fn update(&self, record: DeathRecordEntity) -> RepositoryResult<DeathRecordEntity> {
        let mut records = self.records.write().unwrap();
        if !records.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "Death record {} not found",
                record.id
            )));
        }
        records.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn certify(
        &self,
        id: &str,
        certifier_id: &str,
        certifier_name: &str,
    ) -> RepositoryResult<DeathRecordEntity> {
        let mut records = self.records.write().unwrap();
        let record = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Death record {} not found", id)))?;
        record.certifier_id = Some(certifier_id.to_string());
        record.certifier_name = Some(certifier_name.to_string());
        record.certification_date = Some(chrono::Utc::now().date_naive());
        Ok(record.clone())
    }

    async fn get_pending_certification(&self) -> RepositoryResult<Vec<DeathRecordEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.certification_date.is_none())
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_by_date_range(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> RepositoryResult<Vec<DeathRecordEntity>> {
        let start = chrono::NaiveDate::parse_from_str(start_date, "%Y-%m-%d")
            .map_err(|e| RepositoryError::Validation(format!("Invalid start date: {}", e)))?;
        let end = chrono::NaiveDate::parse_from_str(end_date, "%Y-%m-%d")
            .map_err(|e| RepositoryError::Validation(format!("Invalid end date: {}", e)))?;
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.date_of_death >= start && r.date_of_death <= end)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_by_certificate_number(
        &self,
        certificate_number: &str,
    ) -> RepositoryResult<DeathRecordEntity> {
        let records = self.records.read().unwrap();
        records
            .values()
            .find(|r| r.death_certificate_number.as_deref() == Some(certificate_number))
            .cloned()
            .ok_or_else(|| {
                RepositoryError::NotFound(format!(
                    "Death record with certificate {} not found",
                    certificate_number
                ))
            })
    }

    async fn get_medical_examiner_cases(&self) -> RepositoryResult<Vec<DeathRecordEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.medical_examiner_case.unwrap_or(false))
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_pending_autopsies(&self) -> RepositoryResult<Vec<DeathRecordEntity>> {
        let records = self.records.read().unwrap();
        let mut items: Vec<_> = records
            .values()
            .filter(|r| {
                r.autopsy_performed.unwrap_or(false)
                    && !r.autopsy_findings_available.unwrap_or(false)
            })
            .cloned()
            .collect();
        items.sort_by(|a, b| a.date_of_death.cmp(&b.date_of_death));
        Ok(items)
    }
}

/// In-memory organ donation record repository
#[derive(Debug, Default)]
pub struct MemoryOrganDonationRecordRepository {
    records: RwLock<HashMap<String, OrganDonationRecordEntity>>,
}

impl MemoryOrganDonationRecordRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl OrganDonationRecordRepository for MemoryOrganDonationRecordRepository {
    async fn create(
        &self,
        record: OrganDonationRecordEntity,
    ) -> RepositoryResult<OrganDonationRecordEntity> {
        let mut records = self.records.write().unwrap();
        records.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<OrganDonationRecordEntity> {
        let records = self.records.read().unwrap();
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Organ donation {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<OrganDonationRecordEntity>> {
        let records = self.records.read().unwrap();
        Ok(records
            .values()
            .find(|r| r.patient_id == patient_id)
            .cloned())
    }

    async fn get_by_death_record(
        &self,
        death_record_id: &str,
    ) -> RepositoryResult<Option<OrganDonationRecordEntity>> {
        let records = self.records.read().unwrap();
        Ok(records
            .values()
            .find(|r| {
                r.death_record_id
                    .as_ref()
                    .map(|d| d == death_record_id)
                    .unwrap_or(false)
            })
            .cloned())
    }

    async fn update(
        &self,
        record: OrganDonationRecordEntity,
    ) -> RepositoryResult<OrganDonationRecordEntity> {
        let mut records = self.records.write().unwrap();
        if !records.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "Organ donation {} not found",
                record.id
            )));
        }
        records.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_registered_donors(&self) -> RepositoryResult<Vec<OrganDonationRecordEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.registered_donor.unwrap_or(false))
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_pending_recovery(&self) -> RepositoryResult<Vec<OrganDonationRecordEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.consent_type.is_some()
                    && r.medical_suitability.unwrap_or(false)
                    && r.recovery_datetime.is_none()
            })
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_by_opo(&self, opo_name: &str) -> RepositoryResult<Vec<OrganDonationRecordEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.opo_name.as_deref() == Some(opo_name))
            .cloned()
            .collect();
        Ok(items)
    }
}

// =============================================================================
// PHASE 14: DATA SYNCHRONIZATION & CONFLICT RESOLUTION
// =============================================================================

/// In-memory sync operation repository
#[derive(Debug, Default)]
pub struct MemorySyncOperationRepository {
    records: RwLock<HashMap<String, SyncOperationEntity>>,
}

impl MemorySyncOperationRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl SyncOperationRepository for MemorySyncOperationRepository {
    async fn create(
        &self,
        operation: SyncOperationEntity,
    ) -> RepositoryResult<SyncOperationEntity> {
        let mut records = self.records.write().unwrap();
        records.insert(operation.id.clone(), operation.clone());
        Ok(operation)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<SyncOperationEntity> {
        let records = self.records.read().unwrap();
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Sync operation {} not found", id)))
    }

    async fn get_recent(&self, hours: i32) -> RepositoryResult<Vec<SyncOperationEntity>> {
        let cutoff = chrono::Utc::now() - chrono::Duration::hours(hours as i64);
        let records = self.records.read().unwrap();
        let mut items: Vec<_> = records
            .values()
            .filter(|r| r.initiated_at.map(|t| t >= cutoff).unwrap_or(false))
            .cloned()
            .collect();
        items.sort_by(|a, b| b.initiated_at.cmp(&a.initiated_at));
        Ok(items)
    }

    async fn get_by_entity(
        &self,
        entity_type: &str,
        _entity_id: &str,
    ) -> RepositoryResult<Vec<SyncOperationEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                // Search within entity_types JSON array for the entity_type
                if let Some(ref types_val) = r.entity_types {
                    if let Some(arr) = types_val.as_array() {
                        return arr.iter().any(|v| v.as_str() == Some(entity_type));
                    }
                }
                false
            })
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_by_status(&self, status: &str) -> RepositoryResult<Vec<SyncOperationEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.status.as_ref().map(|s| s == status).unwrap_or(false))
            .cloned()
            .collect();
        Ok(items)
    }

    async fn update(
        &self,
        operation: SyncOperationEntity,
    ) -> RepositoryResult<SyncOperationEntity> {
        let mut records = self.records.write().unwrap();
        if !records.contains_key(&operation.id) {
            return Err(RepositoryError::NotFound(format!(
                "Sync operation {} not found",
                operation.id
            )));
        }
        records.insert(operation.id.clone(), operation.clone());
        Ok(operation)
    }

    async fn update_progress(
        &self,
        id: &str,
        processed: i32,
        success: i32,
        errors: i32,
    ) -> RepositoryResult<SyncOperationEntity> {
        let mut records = self.records.write().unwrap();
        let operation = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Sync operation {} not found", id)))?;
        operation.processed_records = Some(processed);
        operation.success_count = Some(success);
        operation.error_count = Some(errors);
        Ok(operation.clone())
    }

    async fn complete(
        &self,
        id: &str,
        summary: serde_json::Value,
    ) -> RepositoryResult<SyncOperationEntity> {
        let mut records = self.records.write().unwrap();
        let operation = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Sync operation {} not found", id)))?;
        operation.status = Some("completed".to_string());
        operation.completed_at = Some(chrono::Utc::now());
        operation.sync_summary = Some(summary);
        Ok(operation.clone())
    }

    async fn fail(
        &self,
        id: &str,
        error_details: serde_json::Value,
    ) -> RepositoryResult<SyncOperationEntity> {
        let mut records = self.records.write().unwrap();
        let operation = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Sync operation {} not found", id)))?;
        operation.status = Some("failed".to_string());
        operation.completed_at = Some(chrono::Utc::now());
        operation.error_details = Some(error_details);
        Ok(operation.clone())
    }

    async fn get_pending_retries(&self) -> RepositoryResult<Vec<SyncOperationEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.status.as_deref() == Some("failed"))
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_in_progress(&self) -> RepositoryResult<Vec<SyncOperationEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.status.as_deref() == Some("in_progress"))
            .cloned()
            .collect();
        Ok(items)
    }
}

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

/// In-memory external ID mapping repository
#[derive(Debug, Default)]
pub struct MemoryExternalIdMappingRepository {
    records: RwLock<HashMap<String, ExternalIdMappingEntity>>,
}

impl MemoryExternalIdMappingRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl ExternalIdMappingRepository for MemoryExternalIdMappingRepository {
    async fn create(
        &self,
        mapping: ExternalIdMappingEntity,
    ) -> RepositoryResult<ExternalIdMappingEntity> {
        let mut records = self.records.write().unwrap();
        records.insert(mapping.id.clone(), mapping.clone());
        Ok(mapping)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ExternalIdMappingEntity> {
        let records = self.records.read().unwrap();
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("ID mapping {} not found", id)))
    }

    async fn get_by_internal(
        &self,
        entity_type: &str,
        internal_id: &str,
    ) -> RepositoryResult<Vec<ExternalIdMappingEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.entity_type == entity_type && r.internal_id == internal_id)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_by_external(
        &self,
        external_system: &str,
        external_id: &str,
    ) -> RepositoryResult<Option<ExternalIdMappingEntity>> {
        let records = self.records.read().unwrap();
        Ok(records
            .values()
            .find(|r| r.external_system == external_system && r.external_id == external_id)
            .cloned())
    }

    async fn update(
        &self,
        mapping: ExternalIdMappingEntity,
    ) -> RepositoryResult<ExternalIdMappingEntity> {
        let mut records = self.records.write().unwrap();
        if !records.contains_key(&mapping.id) {
            return Err(RepositoryError::NotFound(format!(
                "ID mapping {} not found",
                mapping.id
            )));
        }
        records.insert(mapping.id.clone(), mapping.clone());
        Ok(mapping)
    }

    async fn update_sync_time(&self, id: &str) -> RepositoryResult<ExternalIdMappingEntity> {
        let mut records = self.records.write().unwrap();
        let mapping = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("ID mapping {} not found", id)))?;
        mapping.last_synced_at = Some(chrono::Utc::now());
        Ok(mapping.clone())
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut records = self.records.write().unwrap();
        records.remove(id);
        Ok(())
    }

    async fn deactivate(&self, id: &str) -> RepositoryResult<ExternalIdMappingEntity> {
        let mut records = self.records.write().unwrap();
        let mapping = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("ID mapping {} not found", id)))?;
        mapping.sync_status = Some("inactive".to_string());
        Ok(mapping.clone())
    }

    async fn get_by_system(
        &self,
        external_system: &str,
    ) -> RepositoryResult<Vec<ExternalIdMappingEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.external_system == external_system)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_unverified(&self) -> RepositoryResult<Vec<ExternalIdMappingEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.sync_status.is_none() || r.sync_status.as_deref() == Some("pending"))
            .cloned()
            .collect();
        Ok(items)
    }
}

// =============================================================================
// PHASE 15: ENHANCED AUDIT & COMPLIANCE
// =============================================================================

/// In-memory compliance report repository
#[derive(Debug, Default)]
pub struct MemoryComplianceReportRepository {
    records: RwLock<HashMap<String, ComplianceReportEntity>>,
}

impl MemoryComplianceReportRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl ComplianceReportRepository for MemoryComplianceReportRepository {
    async fn create(
        &self,
        report: ComplianceReportEntity,
    ) -> RepositoryResult<ComplianceReportEntity> {
        let mut records = self.records.write().unwrap();
        records.insert(report.id.clone(), report.clone());
        Ok(report)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ComplianceReportEntity> {
        let records = self.records.read().unwrap();
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Compliance report {} not found", id)))
    }

    async fn get_by_type(
        &self,
        report_type: &str,
    ) -> RepositoryResult<Vec<ComplianceReportEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.report_type == report_type)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_by_period(
        &self,
        start: chrono::NaiveDate,
        end: chrono::NaiveDate,
    ) -> RepositoryResult<Vec<ComplianceReportEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| r.reporting_period_start >= start && r.reporting_period_end <= end)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn update(
        &self,
        report: ComplianceReportEntity,
    ) -> RepositoryResult<ComplianceReportEntity> {
        let mut records = self.records.write().unwrap();
        if !records.contains_key(&report.id) {
            return Err(RepositoryError::NotFound(format!(
                "Compliance report {} not found",
                report.id
            )));
        }
        records.insert(report.id.clone(), report.clone());
        Ok(report)
    }

    async fn approve(
        &self,
        id: &str,
        reviewed_by: &str,
        notes: Option<&str>,
    ) -> RepositoryResult<ComplianceReportEntity> {
        let mut records = self.records.write().unwrap();
        let report = records.get_mut(id).ok_or_else(|| {
            RepositoryError::NotFound(format!("Compliance report {} not found", id))
        })?;
        report.status = Some("approved".to_string());
        report.reviewed_by = Some(reviewed_by.to_string());
        report.reviewed_at = Some(chrono::Utc::now());
        report.review_notes = notes.map(|n| n.to_string());
        Ok(report.clone())
    }

    async fn get_pending_review(&self) -> RepositoryResult<Vec<ComplianceReportEntity>> {
        let records = self.records.read().unwrap();
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.status
                    .as_ref()
                    .map(|s| s == "pending_review")
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        Ok(items)
    }
}

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
        items.sort_by(|a, b| b.started_at.cmp(&a.started_at));
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
        consent.revoked = Some(true);
        consent.revoked_by = Some(revoked_by.to_string());
        consent.revocation_reason = reason.map(|r| r.to_string());
        consent.revoked_datetime = Some(chrono::Utc::now());
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
    async fn test_family_history_crud() {
        let repo = MemoryFamilyMedicalHistoryRepository::new();

        let history = FamilyMedicalHistoryEntity {
            id: "FH-001".to_string(),
            patient_id: "PAT-001".to_string(),
            relationship: "mother".to_string(),
            ..Default::default()
        };

        let created = repo.create(history).await.unwrap();
        assert_eq!(created.id, "FH-001");

        let retrieved = repo.get_by_id("FH-001").await.unwrap();
        assert_eq!(retrieved.relationship, "mother");

        let by_patient = repo.get_by_patient("PAT-001").await.unwrap();
        assert_eq!(by_patient.len(), 1);
    }

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

    // -------- Phase 2.2 coverage: Death/Organ/Sync/External methods --------

    #[tokio::test]
    async fn test_death_record_certify_and_queues() {
        let repo = MemoryDeathRecordRepository::new();

        let pending = DeathRecordEntity {
            id: "DR-1".to_string(),
            patient_id: "P-1".to_string(),
            date_of_death: chrono::Utc::now().date_naive(),
            certifier_id: None,
            certification_date: None,
            medical_examiner_case: Some(false),
            autopsy_performed: Some(false),
            ..Default::default()
        };
        let me_case = DeathRecordEntity {
            id: "DR-2".to_string(),
            patient_id: "P-2".to_string(),
            date_of_death: chrono::Utc::now().date_naive(),
            certifier_id: None,
            certification_date: None,
            medical_examiner_case: Some(true),
            autopsy_performed: Some(true),
            autopsy_findings_available: Some(false),
            ..Default::default()
        };
        repo.create(pending).await.unwrap();
        repo.create(me_case).await.unwrap();

        let pending_list = repo.get_pending_certification().await.unwrap();
        assert!(pending_list.iter().any(|r| r.id == "DR-1"));

        let me_list = repo.get_medical_examiner_cases().await.unwrap();
        assert!(me_list.iter().any(|r| r.id == "DR-2"));

        let pending_autopsies = repo.get_pending_autopsies().await.unwrap();
        assert!(pending_autopsies.iter().any(|r| r.id == "DR-2"));

        let certified = repo
            .certify("DR-1", "doc-9", "Dr. Smith")
            .await
            .unwrap();
        assert_eq!(certified.certifier_id.as_deref(), Some("doc-9"));
        assert!(certified.certification_date.is_some());

        let pending_after = repo.get_pending_certification().await.unwrap();
        assert!(!pending_after.iter().any(|r| r.id == "DR-1"));
    }

    #[tokio::test]
    async fn test_organ_donation_pending_recovery_and_by_opo() {
        let repo = MemoryOrganDonationRecordRepository::new();

        let pending = OrganDonationRecordEntity {
            id: "OD-1".to_string(),
            patient_id: "P-1".to_string(),
            consent_type: Some("registry".to_string()),
            medical_suitability: Some(true),
            opo_name: Some("Gift of Life".to_string()),
            recovery_datetime: None,
            ..Default::default()
        };
        let recovered = OrganDonationRecordEntity {
            id: "OD-2".to_string(),
            patient_id: "P-2".to_string(),
            consent_type: Some("registry".to_string()),
            medical_suitability: Some(true),
            opo_name: Some("Gift of Life".to_string()),
            recovery_datetime: Some(chrono::Utc::now()),
            ..Default::default()
        };
        repo.create(pending).await.unwrap();
        repo.create(recovered).await.unwrap();

        let pending_list = repo.get_pending_recovery().await.unwrap();
        assert_eq!(pending_list.len(), 1);
        assert_eq!(pending_list[0].id, "OD-1");

        let by_opo = repo.get_by_opo("Gift of Life").await.unwrap();
        assert_eq!(by_opo.len(), 2);
    }

    #[tokio::test]
    async fn test_sync_operation_lifecycle() {
        let repo = MemorySyncOperationRepository::new();

        let op = SyncOperationEntity {
            id: "SYNC-1".to_string(),
            operation_type: "import".to_string(),
            source_system: "ext".to_string(),
            target_system: "medichain".to_string(),
            status: Some("in_progress".to_string()),
            total_records: Some(100),
            ..Default::default()
        };
        repo.create(op).await.unwrap();

        let progressed = repo.update_progress("SYNC-1", 50, 48, 2).await.unwrap();
        assert_eq!(progressed.processed_records, Some(50));
        assert_eq!(progressed.success_count, Some(48));
        assert_eq!(progressed.error_count, Some(2));

        let in_prog = repo.get_in_progress().await.unwrap();
        assert!(in_prog.iter().any(|o| o.id == "SYNC-1"));

        let completed = repo
            .complete("SYNC-1", serde_json::json!({"summary": "ok"}))
            .await
            .unwrap();
        assert_eq!(completed.status.as_deref(), Some("completed"));
        assert!(completed.completed_at.is_some());

        // Add a failing operation and verify pending retries excludes completed
        let failing = SyncOperationEntity {
            id: "SYNC-2".to_string(),
            operation_type: "import".to_string(),
            source_system: "ext".to_string(),
            target_system: "medichain".to_string(),
            status: Some("in_progress".to_string()),
            ..Default::default()
        };
        repo.create(failing).await.unwrap();
        let failed = repo
            .fail("SYNC-2", serde_json::json!({"reason": "boom"}))
            .await
            .unwrap();
        assert_eq!(failed.status.as_deref(), Some("failed"));

        let retries = repo.get_pending_retries().await.unwrap();
        assert!(retries.iter().any(|o| o.id == "SYNC-2"));
        assert!(!retries.iter().any(|o| o.id == "SYNC-1"));
    }

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

    #[tokio::test]
    async fn test_external_id_mapping_lifecycle() {
        let repo = MemoryExternalIdMappingRepository::new();

        let m1 = ExternalIdMappingEntity {
            id: "EM-1".to_string(),
            entity_type: "patient".to_string(),
            internal_id: "p-1".to_string(),
            external_system: "epic".to_string(),
            external_id: "EPIC-A".to_string(),
            sync_status: Some("pending".to_string()),
            ..Default::default()
        };
        let m2 = ExternalIdMappingEntity {
            id: "EM-2".to_string(),
            entity_type: "patient".to_string(),
            internal_id: "p-2".to_string(),
            external_system: "cerner".to_string(),
            external_id: "CER-B".to_string(),
            sync_status: Some("verified".to_string()),
            ..Default::default()
        };
        repo.create(m1).await.unwrap();
        repo.create(m2).await.unwrap();

        let by_sys = repo.get_by_system("epic").await.unwrap();
        assert_eq!(by_sys.len(), 1);

        let unverified = repo.get_unverified().await.unwrap();
        assert!(unverified.iter().any(|m| m.id == "EM-1"));
        assert!(!unverified.iter().any(|m| m.id == "EM-2"));

        let touched = repo.update_sync_time("EM-1").await.unwrap();
        assert!(touched.last_synced_at.is_some());

        let deact = repo.deactivate("EM-1").await.unwrap();
        assert_eq!(deact.sync_status.as_deref(), Some("inactive"));

        repo.delete("EM-2").await.unwrap();
        assert!(repo.get_by_id("EM-2").await.is_err());
    }
}
