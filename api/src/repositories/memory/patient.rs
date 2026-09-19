//! In-memory patient repository implementation.

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::patient_search::PatientSearchCriteria;
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

        patients.sort_by_key(|b| std::cmp::Reverse(b.created_at));

        let total = patients.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items: Vec<PatientEntity> = patients.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn list_keyset(
        &self,
        cursor: Option<(chrono::DateTime<chrono::Utc>, String)>,
        limit: u32,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>> {
        let storage = self.storage.read().map_err(Self::lock_error)?;
        let mut patients: Vec<PatientEntity> = storage
            .values()
            .filter(|patient| patient.is_active)
            .cloned()
            .collect();
        patients.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        let total = patients.len() as u64;
        if let Some((updated_at, id)) = cursor {
            patients.retain(|patient| {
                patient.updated_at < updated_at
                    || (patient.updated_at == updated_at && patient.id > id)
            });
        }
        let page = patients.into_iter().take(limit as usize).collect();
        Ok(PaginatedResult::new(
            page,
            total,
            &Pagination::new(0, limit),
        ))
    }

    async fn search(
        &self,
        query: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>> {
        let storage = self.storage.read().map_err(Self::lock_error)?;
        let criteria = PatientSearchCriteria::new(query);

        let mut patients: Vec<PatientEntity> = storage
            .values()
            .filter(|p| criteria.matches(p))
            .cloned()
            .collect();

        patients.sort_by_key(|b| std::cmp::Reverse(b.created_at));

        let total = patients.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items: Vec<PatientEntity> = patients.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn search_keyset(
        &self,
        query: &str,
        cursor: Option<(chrono::DateTime<chrono::Utc>, String)>,
        limit: u32,
    ) -> RepositoryResult<PaginatedResult<PatientEntity>> {
        let storage = self.storage.read().map_err(Self::lock_error)?;
        let criteria = PatientSearchCriteria::new(query);
        let mut patients: Vec<PatientEntity> = storage
            .values()
            .filter(|patient| criteria.matches(patient))
            .cloned()
            .collect();
        patients.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        let total = patients.len() as u64;
        if let Some((updated_at, id)) = cursor {
            patients.retain(|patient| {
                patient.updated_at < updated_at
                    || (patient.updated_at == updated_at && patient.id > id)
            });
        }
        let page = patients.into_iter().take(limit as usize).collect();
        Ok(PaginatedResult::new(
            page,
            total,
            &Pagination::new(0, limit),
        ))
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

        patients.sort_by_key(|b| std::cmp::Reverse(b.created_at));

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

    async fn list_unindexed_names(
        &self,
        after_id: Option<&str>,
        limit: u32,
    ) -> RepositoryResult<Vec<PatientEntity>> {
        let storage = self.storage.read().map_err(Self::lock_error)?;
        let mut patients: Vec<PatientEntity> = storage
            .values()
            .filter(|p| p.name_search_tokens.is_empty())
            .filter(|p| after_id.is_none_or(|after| p.id.as_str() > after))
            .cloned()
            .collect();
        patients.sort_by(|left, right| left.id.cmp(&right.id));
        patients.truncate(limit as usize);
        Ok(patients)
    }

    async fn set_name_search_tokens(&self, id: &str, tokens: &[String]) -> RepositoryResult<()> {
        let mut storage = self.storage.write().map_err(Self::lock_error)?;
        let patient = storage
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Patient {id} not found")))?;
        patient.name_search_tokens = tokens.to_vec();
        Ok(())
    }

    async fn count_by_gender(&self) -> RepositoryResult<HashMap<String, u64>> {
        let storage = self.storage.read().map_err(Self::lock_error)?;
        let mut counts: HashMap<String, u64> = HashMap::new();
        for patient in storage.values().filter(|p| p.is_active) {
            // Normalised so "Female"/"female" are one bucket rather than two,
            // matching the `LOWER(...)` grouping the Postgres implementation
            // uses. An absent value is its own bucket, never dropped.
            let bucket = patient
                .gender
                .as_deref()
                .map(str::trim)
                .filter(|g| !g.is_empty())
                .map(|g| g.to_lowercase())
                .unwrap_or_else(|| "not_recorded".to_string());
            *counts.entry(bucket).or_insert(0) += 1;
        }
        Ok(counts)
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
            dnr_verified_by: None,
            dnr_verified_at: None,
            dnr_document_ref: None,
            primary_provider_id: None,
            wallet_address: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            registered_by: None,
            is_verified: false,
            is_active: true,
            profile_extras_encrypted: None,
            name_search_tokens: Vec::new(),
            key_version: 1,
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
    async fn keyed_name_search_returns_only_all_matching_tokens() {
        let repo = MemoryPatientRepository::new();
        let mut patient = create_test_patient("PAT-NAME-001");
        patient.name_search_tokens = crate::support::patient_name_search_tokens("Ama Mensah");
        repo.create(patient).await.unwrap();

        let found = repo.search_keyset("Ama Mensah", None, 10).await.unwrap();
        assert_eq!(found.total, 1);
        assert_eq!(found.items[0].id, "PAT-NAME-001");
        assert_eq!(
            repo.search_keyset("Unknown", None, 10).await.unwrap().total,
            0
        );
    }

    #[tokio::test]
    async fn keyset_page_does_not_repeat_or_hide_later_patients() {
        let repo = MemoryPatientRepository::new();
        let base = Utc::now();
        for (id, offset) in [("PAT-ONE", 3_i64), ("PAT-TWO", 2), ("PAT-THREE", 1)] {
            let mut patient = create_test_patient(id);
            patient.updated_at = base - chrono::Duration::seconds(offset);
            repo.create(patient).await.unwrap();
        }

        let first = repo.list_keyset(None, 2).await.unwrap();
        assert_eq!(first.items.len(), 2);
        let final_first = first.items.last().unwrap();
        let second = repo
            .list_keyset(Some((final_first.updated_at, final_first.id.clone())), 2)
            .await
            .unwrap();
        assert_eq!(first.total, 3);
        assert_eq!(second.items.len(), 1);
        assert!(first
            .items
            .iter()
            .all(|patient| patient.id != second.items[0].id));
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
