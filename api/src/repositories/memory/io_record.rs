//! In-memory I/O record repository implementation.

use crate::repositories::traits::{
    DateRange, IORecordEntity, IORecordRepository, PaginatedResult, Pagination, RepositoryError,
    RepositoryResult,
};
use async_trait::async_trait;
use chrono::{NaiveDate, Utc};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone)]
pub struct MemoryIORecordRepository {
    data: Arc<RwLock<HashMap<String, IORecordEntity>>>,
}

impl MemoryIORecordRepository {
    pub fn new() -> Self {
        Self {
            data: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

#[async_trait]
impl IORecordRepository for MemoryIORecordRepository {
    async fn create(&self, mut record: IORecordEntity) -> RepositoryResult<IORecordEntity> {
        let mut storage = self.data.write().unwrap();

        if storage.contains_key(&record.id) {
            return Err(RepositoryError::Duplicate(format!(
                "I/O record with ID {} already exists",
                record.id
            )));
        }

        // Check for existing record for same patient, date, and shift
        let exists = storage.values().any(|r| {
            r.patient_id == record.patient_id
                && r.record_date == record.record_date
                && r.shift == record.shift
        });

        if exists {
            return Err(RepositoryError::Duplicate(format!(
                "I/O record for patient {} on date {} shift {} already exists",
                record.patient_id, record.record_date, record.shift
            )));
        }

        let now = Utc::now();
        record.created_at = now;
        record.updated_at = now;

        // Calculate totals and balance
        record.total_intake = record.oral_intake.unwrap_or(0)
            + record.iv_intake.unwrap_or(0)
            + record.tube_feeding.unwrap_or(0)
            + record.other_intake.unwrap_or(0);

        record.total_output = record.urine_output.unwrap_or(0)
            + record.emesis.unwrap_or(0)
            + record.drainage.unwrap_or(0)
            + record.stool.unwrap_or(0)
            + record.other_output.unwrap_or(0);

        record.net_balance = record.total_intake - record.total_output;

        storage.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<IORecordEntity> {
        let storage = self.data.read().unwrap();
        storage.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("I/O record with ID {} not found", id))
        })
    }

    async fn get_by_patient_date_shift(
        &self,
        patient_id: &str,
        date: NaiveDate,
        shift: &str,
    ) -> RepositoryResult<Option<IORecordEntity>> {
        let storage = self.data.read().unwrap();

        let record = storage
            .values()
            .find(|r| r.patient_id == patient_id && r.record_date == date && r.shift == shift)
            .cloned();

        Ok(record)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        date_range: Option<DateRange>,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IORecordEntity>> {
        let storage = self.data.read().unwrap();

        let mut records: Vec<IORecordEntity> = storage
            .values()
            .filter(|r| {
                r.patient_id == patient_id && {
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

        records.sort_by(|a, b| {
            b.record_date
                .cmp(&a.record_date)
                .then_with(|| a.shift.cmp(&b.shift))
        });

        let total = records.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = records.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(&self, mut record: IORecordEntity) -> RepositoryResult<IORecordEntity> {
        let mut storage = self.data.write().unwrap();

        if !storage.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "I/O record with ID {} not found",
                record.id
            )));
        }

        // Recalculate totals and balance
        record.total_intake = record.oral_intake.unwrap_or(0)
            + record.iv_intake.unwrap_or(0)
            + record.tube_feeding.unwrap_or(0)
            + record.other_intake.unwrap_or(0);

        record.total_output = record.urine_output.unwrap_or(0)
            + record.emesis.unwrap_or(0)
            + record.drainage.unwrap_or(0)
            + record.stool.unwrap_or(0)
            + record.other_output.unwrap_or(0);

        record.net_balance = record.total_intake - record.total_output;
        record.updated_at = Utc::now();

        storage.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_negative_balance_patients(&self) -> RepositoryResult<Vec<IORecordEntity>> {
        let storage = self.data.read().unwrap();

        let negative_balance: Vec<IORecordEntity> = storage
            .values()
            .filter(|r| r.net_balance < 0)
            .cloned()
            .collect();

        Ok(negative_balance)
    }

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IORecordEntity>> {
        let storage = self.data.read().unwrap();

        let mut records: Vec<IORecordEntity> = storage.values().cloned().collect();

        records.sort_by(|a, b| {
            b.record_date
                .cmp(&a.record_date)
                .then_with(|| a.shift.cmp(&b.shift))
        });

        let total = records.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = records.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }
}
