//! In-memory medical record repository implementation.

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// In-memory medical record repository
#[derive(Debug)]
pub struct MemoryMedicalRecordRepository {
    storage: RwLock<HashMap<String, MedicalRecordEntity>>,
    patient_index: RwLock<HashMap<String, Vec<String>>>,
    ipfs_index: RwLock<HashMap<String, String>>,
}

impl MemoryMedicalRecordRepository {
    pub fn new() -> Self {
        Self {
            storage: RwLock::new(HashMap::new()),
            patient_index: RwLock::new(HashMap::new()),
            ipfs_index: RwLock::new(HashMap::new()),
        }
    }

    fn lock_error(e: impl std::fmt::Display) -> RepositoryError {
        RepositoryError::Internal(format!("Lock poisoned: {}", e))
    }
}

impl Default for MemoryMedicalRecordRepository {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl MedicalRecordRepository for MemoryMedicalRecordRepository {
    async fn create(&self, record: MedicalRecordEntity) -> RepositoryResult<MedicalRecordEntity> {
        {
            let storage = self.storage.read().map_err(Self::lock_error)?;
            if storage.contains_key(&record.id) {
                return Err(RepositoryError::Duplicate(format!(
                    "Record {} already exists",
                    record.id
                )));
            }
        }

        {
            let mut storage = self.storage.write().map_err(Self::lock_error)?;
            storage.insert(record.id.clone(), record.clone());
        }

        {
            let mut patient_index = self.patient_index.write().map_err(Self::lock_error)?;
            patient_index
                .entry(record.patient_id.clone())
                .or_default()
                .push(record.id.clone());
        }

        if let Some(ref ipfs_hash) = record.ipfs_content_hash {
            let mut ipfs_index = self.ipfs_index.write().map_err(Self::lock_error)?;
            ipfs_index.insert(ipfs_hash.clone(), record.id.clone());
        }

        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<MedicalRecordEntity> {
        let storage = self.storage.read().map_err(Self::lock_error)?;
        storage
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Record {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<MedicalRecordEntity>> {
        let storage = self.storage.read().map_err(Self::lock_error)?;
        let patient_index = self.patient_index.read().map_err(Self::lock_error)?;

        let mut records: Vec<MedicalRecordEntity> = match patient_index.get(patient_id) {
            Some(ids) => ids
                .iter()
                .filter_map(|id| storage.get(id))
                .filter(|r| r.is_active)
                .cloned()
                .collect(),
            None => Vec::new(),
        };

        records.sort_by(|a, b| b.record_date.cmp(&a.record_date));

        let total = records.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items: Vec<MedicalRecordEntity> =
            records.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_patient_and_type(
        &self,
        patient_id: &str,
        record_type: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<MedicalRecordEntity>> {
        let storage = self.storage.read().map_err(Self::lock_error)?;
        let patient_index = self.patient_index.read().map_err(Self::lock_error)?;

        let mut records: Vec<MedicalRecordEntity> = match patient_index.get(patient_id) {
            Some(ids) => ids
                .iter()
                .filter_map(|id| storage.get(id))
                .filter(|r| r.is_active && r.record_type == record_type)
                .cloned()
                .collect(),
            None => Vec::new(),
        };

        records.sort_by(|a, b| b.record_date.cmp(&a.record_date));

        let total = records.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items: Vec<MedicalRecordEntity> =
            records.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_ipfs_hash(&self, ipfs_hash: &str) -> RepositoryResult<MedicalRecordEntity> {
        let id = {
            let ipfs_index = self.ipfs_index.read().map_err(Self::lock_error)?;
            ipfs_index
                .get(ipfs_hash)
                .cloned()
                .ok_or_else(|| RepositoryError::NotFound("IPFS hash not found".to_string()))?
        };
        self.get_by_id(&id).await
    }

    async fn update(&self, record: MedicalRecordEntity) -> RepositoryResult<MedicalRecordEntity> {
        let mut storage = self.storage.write().map_err(Self::lock_error)?;

        let existing = storage
            .get(&record.id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Record {} not found", record.id)))?;

        if existing.is_locked {
            return Err(RepositoryError::Validation("Record is locked".to_string()));
        }

        storage.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut storage = self.storage.write().map_err(Self::lock_error)?;

        if let Some(record) = storage.get_mut(id) {
            if record.is_locked {
                return Err(RepositoryError::Validation(
                    "Cannot delete locked record".to_string(),
                ));
            }
            record.is_active = false;
            Ok(())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Record {} not found",
                id
            )))
        }
    }

    async fn lock(&self, id: &str) -> RepositoryResult<()> {
        let mut storage = self.storage.write().map_err(Self::lock_error)?;

        if let Some(record) = storage.get_mut(id) {
            record.is_locked = true;
            Ok(())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Record {} not found",
                id
            )))
        }
    }

    async fn get_by_date_range(
        &self,
        patient_id: &str,
        range: DateRange,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<MedicalRecordEntity>> {
        let storage = self.storage.read().map_err(Self::lock_error)?;
        let patient_index = self.patient_index.read().map_err(Self::lock_error)?;

        let mut records: Vec<MedicalRecordEntity> = match patient_index.get(patient_id) {
            Some(ids) => ids
                .iter()
                .filter_map(|id| storage.get(id))
                .filter(|r| {
                    if !r.is_active {
                        return false;
                    }
                    if let Some(from) = range.from {
                        if r.record_date < from {
                            return false;
                        }
                    }
                    if let Some(to) = range.to {
                        if r.record_date > to {
                            return false;
                        }
                    }
                    true
                })
                .cloned()
                .collect(),
            None => Vec::new(),
        };

        records.sort_by(|a, b| b.record_date.cmp(&a.record_date));

        let total = records.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items: Vec<MedicalRecordEntity> =
            records.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn create_test_record(id: &str, patient_id: &str) -> MedicalRecordEntity {
        MedicalRecordEntity {
            id: id.to_string(),
            patient_id: patient_id.to_string(),
            record_type: "lab_result".to_string(),
            category: Some("Laboratory".to_string()),
            ipfs_content_hash: Some(format!("Qm{}", id)),
            ipfs_metadata_hash: None,
            content_checksum: None,
            on_chain_hash: None,
            blockchain_tx_hash: None,
            summary_encrypted: None,
            record_date: Utc::now(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            created_by: "DOC-001".to_string(),
            last_modified_by: "DOC-001".to_string(),
            facility_id: None,
            is_active: true,
            is_locked: false,
        }
    }

    #[tokio::test]
    async fn test_create_and_get() {
        let repo = MemoryMedicalRecordRepository::new();
        let record = create_test_record("REC-001", "PAT-001");

        let created = repo.create(record).await.unwrap();
        assert_eq!(created.id, "REC-001");

        let fetched = repo.get_by_id("REC-001").await.unwrap();
        assert_eq!(fetched.record_type, "lab_result");
    }

    #[tokio::test]
    async fn test_lock_prevents_update() {
        let repo = MemoryMedicalRecordRepository::new();
        let record = create_test_record("REC-001", "PAT-001");

        repo.create(record.clone()).await.unwrap();
        repo.lock("REC-001").await.unwrap();

        let result = repo.update(record).await;
        assert!(matches!(result, Err(RepositoryError::Validation(_))));
    }
}
