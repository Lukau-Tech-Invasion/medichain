//! In-memory vital signs repository implementation.

use async_trait::async_trait;
use chrono::{Duration, Utc};
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// In-memory vital signs repository
#[derive(Debug)]
pub struct MemoryVitalSignsRepository {
    storage: RwLock<HashMap<String, VitalSignsEntity>>,
    patient_index: RwLock<HashMap<String, Vec<String>>>,
}

impl MemoryVitalSignsRepository {
    pub fn new() -> Self {
        Self {
            storage: RwLock::new(HashMap::new()),
            patient_index: RwLock::new(HashMap::new()),
        }
    }
}

impl Default for MemoryVitalSignsRepository {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl VitalSignsRepository for MemoryVitalSignsRepository {
    async fn create(&self, vitals: VitalSignsEntity) -> RepositoryResult<VitalSignsEntity> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        if storage.contains_key(&vitals.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Vitals {} already exists",
                vitals.id
            )));
        }
        drop(storage);

        let mut storage = self
            .storage
            .write()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;
        storage.insert(vitals.id.clone(), vitals.clone());

        let mut patient_index = self
            .patient_index
            .write()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;
        patient_index
            .entry(vitals.patient_id.clone())
            .or_default()
            .push(vitals.id.clone());

        Ok(vitals)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<VitalSignsEntity> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        storage
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Vitals {} not found", id)))
    }

    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<VitalSignsEntity>> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let patient_index = self
            .patient_index
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let latest = match patient_index.get(patient_id) {
            Some(ids) => ids
                .iter()
                .filter_map(|id| storage.get(id))
                .max_by_key(|v| v.recorded_at)
                .cloned(),
            None => None,
        };

        Ok(latest)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<VitalSignsEntity>> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let patient_index = self
            .patient_index
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let mut vitals: Vec<VitalSignsEntity> = match patient_index.get(patient_id) {
            Some(ids) => ids
                .iter()
                .filter_map(|id| storage.get(id).cloned())
                .collect(),
            None => Vec::new(),
        };

        vitals.sort_by(|a, b| b.recorded_at.cmp(&a.recorded_at));

        let total = vitals.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items: Vec<VitalSignsEntity> = vitals.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_date_range(
        &self,
        patient_id: &str,
        range: DateRange,
    ) -> RepositoryResult<Vec<VitalSignsEntity>> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let patient_index = self
            .patient_index
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let mut vitals: Vec<VitalSignsEntity> = match patient_index.get(patient_id) {
            Some(ids) => ids
                .iter()
                .filter_map(|id| storage.get(id))
                .filter(|v| {
                    if let Some(from) = range.from {
                        if v.recorded_at < from {
                            return false;
                        }
                    }
                    if let Some(to) = range.to {
                        if v.recorded_at > to {
                            return false;
                        }
                    }
                    true
                })
                .cloned()
                .collect(),
            None => Vec::new(),
        };

        vitals.sort_by(|a, b| b.recorded_at.cmp(&a.recorded_at));
        Ok(vitals)
    }

    async fn get_critical(&self) -> RepositoryResult<Vec<VitalSignsEntity>> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let cutoff = Utc::now() - Duration::hours(24);

        let mut critical: Vec<VitalSignsEntity> = storage
            .values()
            .filter(|v| v.is_critical && v.recorded_at > cutoff)
            .cloned()
            .collect();

        critical.sort_by(|a, b| b.recorded_at.cmp(&a.recorded_at));
        Ok(critical)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn create_test_vitals(id: &str, patient_id: &str, is_critical: bool) -> VitalSignsEntity {
        VitalSignsEntity {
            id: id.to_string(),
            patient_id: patient_id.to_string(),
            heart_rate: Some(80),
            respiratory_rate: Some(16),
            blood_pressure_systolic: Some(120),
            blood_pressure_diastolic: Some(80),
            mean_arterial_pressure: Some(93),
            temperature: Some(37.0),
            temperature_site: Some("Oral".to_string()),
            oxygen_saturation: Some(98),
            oxygen_delivery: None,
            fio2: None,
            pain_scale: Some(2),
            gcs_score: Some(15),
            gcs_eye: Some(4),
            gcs_verbal: Some(5),
            gcs_motor: Some(6),
            blood_glucose: Some(100),
            weight_kg: Some(70.0),
            height_cm: Some(175.0),
            bmi: Some(22.9),
            position: Some("Sitting".to_string()),
            activity_level: Some("Resting".to_string()),
            is_critical,
            critical_values: None,
            recorded_at: Utc::now(),
            recorded_by: "RN-001".to_string(),
            facility_id: None,
            created_at: Utc::now(),
        }
    }

    #[tokio::test]
    async fn test_create_and_get() {
        let repo = MemoryVitalSignsRepository::new();
        let vitals = create_test_vitals("VS-001", "PAT-001", false);

        let created = repo.create(vitals).await.unwrap();
        assert_eq!(created.id, "VS-001");

        let fetched = repo.get_by_id("VS-001").await.unwrap();
        assert_eq!(fetched.heart_rate, Some(80));
    }

    #[tokio::test]
    async fn test_get_latest() {
        let repo = MemoryVitalSignsRepository::new();

        repo.create(create_test_vitals("VS-001", "PAT-001", false))
            .await
            .unwrap();

        // Simulate later recording
        let mut later = create_test_vitals("VS-002", "PAT-001", false);
        later.heart_rate = Some(90);
        repo.create(later).await.unwrap();

        let latest = repo.get_latest_by_patient("PAT-001").await.unwrap();
        assert!(latest.is_some());
        assert_eq!(latest.unwrap().id, "VS-002");
    }
}
