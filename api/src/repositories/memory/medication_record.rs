//! In-memory medication record repository implementation.

use crate::repositories::traits::{
    DateRange, MedicationRecordEntity, MedicationRecordRepository, PaginatedResult, Pagination,
    RepositoryError, RepositoryResult,
};
use async_trait::async_trait;
use chrono::{NaiveDate, Utc};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone)]
pub struct MemoryMedicationRecordRepository {
    data: Arc<RwLock<HashMap<String, MedicationRecordEntity>>>,
}

impl MemoryMedicationRecordRepository {
    pub fn new() -> Self {
        Self {
            data: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

#[async_trait]
impl MedicationRecordRepository for MemoryMedicationRecordRepository {
    async fn create(
        &self,
        mut record: MedicationRecordEntity,
    ) -> RepositoryResult<MedicationRecordEntity> {
        let mut storage = self.data.write().unwrap();

        if storage.contains_key(&record.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Medication record with ID {} already exists",
                record.id
            )));
        }

        // Check for existing record for same patient and date
        let exists = storage
            .values()
            .any(|r| r.patient_id == record.patient_id && r.record_date == record.record_date);

        if exists {
            return Err(RepositoryError::Duplicate(format!(
                "Medication record for patient {} on date {} already exists",
                record.patient_id, record.record_date
            )));
        }

        let now = Utc::now();
        record.created_at = now;
        record.updated_at = now;

        storage.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<MedicationRecordEntity> {
        let storage = self.data.read().unwrap();
        storage.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Medication record with ID {} not found", id))
        })
    }

    async fn get_by_patient_and_date(
        &self,
        patient_id: &str,
        date: NaiveDate,
    ) -> RepositoryResult<Option<MedicationRecordEntity>> {
        let storage = self.data.read().unwrap();

        let record = storage
            .values()
            .find(|r| r.patient_id == patient_id && r.record_date == date && r.is_active)
            .cloned();

        Ok(record)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        date_range: Option<DateRange>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<MedicationRecordEntity>> {
        let storage = self.data.read().unwrap();

        let mut records: Vec<MedicationRecordEntity> = storage
            .values()
            .filter(|r| {
                r.patient_id == patient_id && r.is_active && {
                    if let Some(range) = &date_range {
                        let record_datetime = r
                            .record_date
                            .and_hms_opt(0, 0, 0)
                            .unwrap()
                            .and_local_timezone(chrono::Utc)
                            .single();

                        if let Some(record_dt) = record_datetime {
                            let after_from = range.from.map(|f| record_dt >= f).unwrap_or(true);
                            let before_to = range.to.map(|t| record_dt <= t).unwrap_or(true);
                            after_from && before_to
                        } else {
                            false
                        }
                    } else {
                        true
                    }
                }
            })
            .cloned()
            .collect();

        records.sort_by(|a, b| b.record_date.cmp(&a.record_date));

        let total = records.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = records.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        mut record: MedicationRecordEntity,
    ) -> RepositoryResult<MedicationRecordEntity> {
        let mut storage = self.data.write().unwrap();

        if !storage.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "Medication record with ID {} not found",
                record.id
            )));
        }

        record.updated_at = Utc::now();
        storage.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_incomplete_records(&self) -> RepositoryResult<Vec<MedicationRecordEntity>> {
        let storage = self.data.read().unwrap();

        let incomplete: Vec<MedicationRecordEntity> = storage
            .values()
            .filter(|r| {
                r.is_active
                    && (r
                        .completion_status
                        .as_ref()
                        .map(|s| s != "complete")
                        .unwrap_or(true)
                        || r.completion_percentage.map(|p| p < 100).unwrap_or(true))
            })
            .cloned()
            .collect();

        Ok(incomplete)
    }
}
