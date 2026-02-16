//! In-memory allergy repository implementation.

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// In-memory allergy repository
#[derive(Debug)]
pub struct MemoryAllergyRepository {
    storage: RwLock<HashMap<String, AllergyEntity>>,
    patient_index: RwLock<HashMap<String, Vec<String>>>,
}

impl MemoryAllergyRepository {
    pub fn new() -> Self {
        Self {
            storage: RwLock::new(HashMap::new()),
            patient_index: RwLock::new(HashMap::new()),
        }
    }
}

impl Default for MemoryAllergyRepository {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AllergyRepository for MemoryAllergyRepository {
    async fn create(&self, allergy: AllergyEntity) -> RepositoryResult<AllergyEntity> {
        // Validation check
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        if storage.contains_key(&allergy.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Allergy {} already exists",
                allergy.id
            )));
        }
        drop(storage);

        // Insert into storage
        let mut storage = self
            .storage
            .write()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;
        storage.insert(allergy.id.clone(), allergy.clone());

        // Update patient index
        let mut patient_index = self
            .patient_index
            .write()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;
        patient_index
            .entry(allergy.patient_id.clone())
            .or_default()
            .push(allergy.id.clone());

        Ok(allergy)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<AllergyEntity> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        storage
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Allergy {} not found", id)))
    }

    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<AllergyEntity>> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let patient_index = self
            .patient_index
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let allergy_ids = patient_index.get(patient_id);

        let allergies: Vec<AllergyEntity> = match allergy_ids {
            Some(ids) => ids
                .iter()
                .filter_map(|id| storage.get(id).cloned())
                .collect(),
            None => Vec::new(),
        };

        Ok(allergies)
    }

    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<AllergyEntity>> {
        let all = self.get_by_patient(patient_id).await?;
        Ok(all.into_iter().filter(|a| a.is_active).collect())
    }

    async fn update(&self, allergy: AllergyEntity) -> RepositoryResult<AllergyEntity> {
        let mut storage = self
            .storage
            .write()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        if !storage.contains_key(&allergy.id) {
            return Err(RepositoryError::NotFound(format!(
                "Allergy {} not found",
                allergy.id
            )));
        }

        storage.insert(allergy.id.clone(), allergy.clone());
        Ok(allergy)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut storage = self
            .storage
            .write()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        if let Some(allergy) = storage.get_mut(id) {
            allergy.is_active = false;
            Ok(())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Allergy {} not found",
                id
            )))
        }
    }

    async fn has_allergen(&self, patient_id: &str, allergen: &str) -> RepositoryResult<bool> {
        let allergies = self.get_active_by_patient(patient_id).await?;
        let allergen_lower = allergen.to_lowercase();

        Ok(allergies
            .iter()
            .any(|a| a.allergen.to_lowercase().contains(&allergen_lower)))
    }

    async fn get_severe_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<AllergyEntity>> {
        let allergies = self.get_active_by_patient(patient_id).await?;

        Ok(allergies
            .into_iter()
            .filter(|a| a.severity == "Severe" || a.severity == "LifeThreatening")
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn create_test_allergy(id: &str, patient_id: &str, severity: &str) -> AllergyEntity {
        AllergyEntity {
            id: id.to_string(),
            patient_id: patient_id.to_string(),
            allergen: "Penicillin".to_string(),
            allergen_type: "Drug".to_string(),
            reaction: Some("Rash".to_string()),
            severity: severity.to_string(),
            onset_date: None,
            last_occurrence: None,
            verified: false,
            verified_by: None,
            verified_at: None,
            source: Some("Patient Reported".to_string()),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            created_by: "DOC-001".to_string(),
            is_active: true,
        }
    }

    #[tokio::test]
    async fn test_create_and_get() {
        let repo = MemoryAllergyRepository::new();
        let allergy = create_test_allergy("ALG-001", "PAT-001", "Moderate");

        let created = repo.create(allergy).await.unwrap();
        assert_eq!(created.id, "ALG-001");

        let fetched = repo.get_by_id("ALG-001").await.unwrap();
        assert_eq!(fetched.allergen, "Penicillin");
    }

    #[tokio::test]
    async fn test_get_by_patient() {
        let repo = MemoryAllergyRepository::new();

        repo.create(create_test_allergy("ALG-001", "PAT-001", "Moderate"))
            .await
            .unwrap();
        repo.create(create_test_allergy("ALG-002", "PAT-001", "Severe"))
            .await
            .unwrap();
        repo.create(create_test_allergy("ALG-003", "PAT-002", "Mild"))
            .await
            .unwrap();

        let allergies = repo.get_by_patient("PAT-001").await.unwrap();
        assert_eq!(allergies.len(), 2);
    }

    #[tokio::test]
    async fn test_get_severe() {
        let repo = MemoryAllergyRepository::new();

        repo.create(create_test_allergy("ALG-001", "PAT-001", "Moderate"))
            .await
            .unwrap();
        repo.create(create_test_allergy("ALG-002", "PAT-001", "Severe"))
            .await
            .unwrap();
        repo.create(create_test_allergy("ALG-003", "PAT-001", "LifeThreatening"))
            .await
            .unwrap();

        let severe = repo.get_severe_by_patient("PAT-001").await.unwrap();
        assert_eq!(severe.len(), 2);
    }
}
