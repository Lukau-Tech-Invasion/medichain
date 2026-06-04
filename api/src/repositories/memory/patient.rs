//! In-memory patient repository implementation.

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// In-memory patient repository
#[derive(Debug)]
pub struct MemoryPatientRepository {
    storage: RwLock<HashMap<String, PatientEntity>>,
    health_id_index: RwLock<HashMap<String, String>>,
    national_id_index: RwLock<HashMap<String, String>>,
    wallet_index: RwLock<HashMap<String, String>>,
}

impl MemoryPatientRepository {
    pub fn new() -> Self {
        Self {
            storage: RwLock::new(HashMap::new()),
            health_id_index: RwLock::new(HashMap::new()),
            national_id_index: RwLock::new(HashMap::new()),
            wallet_index: RwLock::new(HashMap::new()),
        }
    }

    fn lock_error(e: impl std::fmt::Display) -> RepositoryError {
        RepositoryError::Internal(format!("Lock poisoned: {}", e))
    }
}

impl Default for MemoryPatientRepository {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl PatientRepository for MemoryPatientRepository {
    async fn create(&self, patient: PatientEntity) -> RepositoryResult<PatientEntity> {
        // Check for duplicates first (read locks)
        {
            let storage = self.storage.read().map_err(Self::lock_error)?;
            if storage.contains_key(&patient.id) {
                return Err(RepositoryError::Duplicate(format!(
                    "Patient with ID {} already exists",
                    patient.id
                )));
            }
        }

        {
            let health_index = self.health_id_index.read().map_err(Self::lock_error)?;
            if health_index.contains_key(&patient.health_id) {
                return Err(RepositoryError::Duplicate(format!(
                    "Health ID {} already exists",
                    patient.health_id
                )));
            }
        }

        // Insert into storage and indices (write locks)
        {
            let mut storage = self.storage.write().map_err(Self::lock_error)?;
            storage.insert(patient.id.clone(), patient.clone());
        }

        {
            let mut health_index = self.health_id_index.write().map_err(Self::lock_error)?;
            health_index.insert(patient.health_id.clone(), patient.id.clone());
        }

        {
            let mut national_index = self.national_id_index.write().map_err(Self::lock_error)?;
            national_index.insert(patient.national_id_hash.clone(), patient.id.clone());
        }

        if let Some(ref wallet) = patient.wallet_address {
            let mut wallet_index = self.wallet_index.write().map_err(Self::lock_error)?;
            wallet_index.insert(wallet.clone(), patient.id.clone());
        }

        Ok(patient)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<PatientEntity> {
        let storage = self.storage.read().map_err(Self::lock_error)?;
        storage
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Patient {} not found", id)))
    }

    async fn get_by_health_id(&self, health_id: &str) -> RepositoryResult<PatientEntity> {
        let id = {
            let health_index = self.health_id_index.read().map_err(Self::lock_error)?;
            health_index.get(health_id).cloned().ok_or_else(|| {
                RepositoryError::NotFound(format!("Health ID {} not found", health_id))
            })?
        };
        self.get_by_id(&id).await
    }

    async fn get_by_national_id_hash(&self, hash: &str) -> RepositoryResult<PatientEntity> {
        let id = {
            let national_index = self.national_id_index.read().map_err(Self::lock_error)?;
            national_index.get(hash).cloned().ok_or_else(|| {
                RepositoryError::NotFound("National ID hash not found".to_string())
            })?
        };
        self.get_by_id(&id).await
    }

    async fn get_by_wallet(&self, wallet: &str) -> RepositoryResult<PatientEntity> {
        let id = {
            let wallet_index = self.wallet_index.read().map_err(Self::lock_error)?;
            wallet_index
                .get(wallet)
                .cloned()
                .ok_or_else(|| RepositoryError::NotFound("Wallet address not found".to_string()))?
        };
        self.get_by_id(&id).await
    }

    async fn update(&self, patient: PatientEntity) -> RepositoryResult<PatientEntity> {
        let mut storage = self.storage.write().map_err(Self::lock_error)?;
        if !storage.contains_key(&patient.id) {
            return Err(RepositoryError::NotFound(format!(
                "Patient {} not found",
                patient.id
            )));
        }
        storage.insert(patient.id.clone(), patient.clone());
        Ok(patient)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut storage = self.storage.write().map_err(Self::lock_error)?;
        if let Some(patient) = storage.get_mut(id) {
            patient.is_active = false;
            Ok(())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Patient {} not found",
                id
            )))
        }
    }

    async fn list(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>> {
        let storage = self.storage.read().map_err(Self::lock_error)?;

        let mut patients: Vec<PatientEntity> =
            storage.values().filter(|p| p.is_active).cloned().collect();

        patients.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        let total = patients.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items: Vec<PatientEntity> = patients.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn search(
        &self,
        query: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>> {
        let storage = self.storage.read().map_err(Self::lock_error)?;
        let query_lower = query.to_lowercase();

        let mut patients: Vec<PatientEntity> = storage
            .values()
            .filter(|p| {
                p.is_active
                    && (p.health_id.to_lowercase().contains(&query_lower)
                        || p.id.to_lowercase().contains(&query_lower))
            })
            .cloned()
            .collect();

        patients.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        let total = patients.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items: Vec<PatientEntity> = patients.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_provider(
        &self,
        provider_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>> {
        let storage = self.storage.read().map_err(Self::lock_error)?;

        let mut patients: Vec<PatientEntity> = storage
            .values()
            .filter(|p| p.is_active && p.primary_provider_id.as_deref() == Some(provider_id))
            .cloned()
            .collect();

        patients.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        let total = patients.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items: Vec<PatientEntity> = patients.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn count(&self) -> RepositoryResult<u64> {
        let storage = self.storage.read().map_err(Self::lock_error)?;
        let count = storage.values().filter(|p| p.is_active).count() as u64;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn create_test_patient(id: &str) -> PatientEntity {
        PatientEntity {
            id: id.to_string(),
            health_id: format!("HID-{}", id),
            national_id_hash: format!("hash-{}", id),
            national_id_type: "FaydaID".to_string(),
            first_name_encrypted: None,
            last_name_encrypted: None,
            date_of_birth_encrypted: None,
            gender: Some("Male".to_string()),
            blood_type: Some("O+".to_string()),
            phone_encrypted: None,
            email_encrypted: None,
            address_encrypted: None,
            emergency_contact_name_encrypted: None,
            emergency_contact_phone_encrypted: None,
            emergency_contact_relationship: None,
            organ_donor: false,
            dnr_status: false,
            primary_provider_id: None,
            wallet_address: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            registered_by: None,
            is_verified: false,
            is_active: true,
            profile_extras_encrypted: None,
        }
    }

    #[tokio::test]
    async fn test_create_and_get() {
        let repo = MemoryPatientRepository::new();
        let patient = create_test_patient("PAT-001");

        let created = repo.create(patient.clone()).await.unwrap();
        assert_eq!(created.id, "PAT-001");

        let fetched = repo.get_by_id("PAT-001").await.unwrap();
        assert_eq!(fetched.health_id, "HID-PAT-001");
    }

    #[tokio::test]
    async fn test_duplicate_prevention() {
        let repo = MemoryPatientRepository::new();
        let patient = create_test_patient("PAT-001");

        repo.create(patient.clone()).await.unwrap();

        let result = repo.create(patient).await;
        assert!(matches!(result, Err(RepositoryError::Duplicate(_))));
    }

    #[tokio::test]
    async fn test_soft_delete() {
        let repo = MemoryPatientRepository::new();
        let patient = create_test_patient("PAT-001");

        repo.create(patient).await.unwrap();
        repo.delete("PAT-001").await.unwrap();

        // Should still exist but be inactive
        let fetched = repo.get_by_id("PAT-001").await.unwrap();
        assert!(!fetched.is_active);

        // Should not appear in list
        let list = repo.list(Pagination::new(0, 10)).await.unwrap();
        assert_eq!(list.total, 0);
    }
}
