//! In-memory triage assessment repository implementation.

use async_trait::async_trait;
use chrono::{Duration, Utc};
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// In-memory triage assessment repository
#[derive(Debug)]
pub struct MemoryTriageAssessmentRepository {
    storage: RwLock<HashMap<String, TriageAssessmentEntity>>,
    patient_index: RwLock<HashMap<String, Vec<String>>>,
}

impl MemoryTriageAssessmentRepository {
    pub fn new() -> Self {
        Self {
            storage: RwLock::new(HashMap::new()),
            patient_index: RwLock::new(HashMap::new()),
        }
    }
}

impl Default for MemoryTriageAssessmentRepository {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl TriageAssessmentRepository for MemoryTriageAssessmentRepository {
    async fn create(
        &self,
        assessment: TriageAssessmentEntity,
    ) -> RepositoryResult<TriageAssessmentEntity> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        if storage.contains_key(&assessment.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Triage {} already exists",
                assessment.id
            )));
        }
        drop(storage);

        let mut storage = self
            .storage
            .write()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;
        storage.insert(assessment.id.clone(), assessment.clone());

        let mut patient_index = self
            .patient_index
            .write()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;
        patient_index
            .entry(assessment.patient_id.clone())
            .or_default()
            .push(assessment.id.clone());

        Ok(assessment)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<TriageAssessmentEntity> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        storage
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Triage {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<TriageAssessmentEntity>> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let patient_index = self
            .patient_index
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let mut assessments: Vec<TriageAssessmentEntity> = match patient_index.get(patient_id) {
            Some(ids) => ids
                .iter()
                .filter_map(|id| storage.get(id).cloned())
                .collect(),
            None => Vec::new(),
        };

        assessments.sort_by(|a, b| b.triage_time.cmp(&a.triage_time));

        let total = assessments.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items: Vec<TriageAssessmentEntity> =
            assessments.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<TriageAssessmentEntity>> {
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
                .max_by_key(|t| t.triage_time)
                .cloned(),
            None => None,
        };

        Ok(latest)
    }

    async fn update(
        &self,
        assessment: TriageAssessmentEntity,
    ) -> RepositoryResult<TriageAssessmentEntity> {
        let mut storage = self
            .storage
            .write()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        if !storage.contains_key(&assessment.id) {
            return Err(RepositoryError::NotFound(format!(
                "Triage {} not found",
                assessment.id
            )));
        }

        storage.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_critical(&self) -> RepositoryResult<Vec<TriageAssessmentEntity>> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let cutoff = Utc::now() - Duration::hours(24);

        // ESI 1-2 are critical
        let mut critical: Vec<TriageAssessmentEntity> = storage
            .values()
            .filter(|t| t.esi_level <= 2 && t.triage_time > cutoff)
            .cloned()
            .collect();

        // Sort by ESI level (lower = more critical), then by time
        critical.sort_by(|a, b| {
            a.esi_level
                .cmp(&b.esi_level)
                .then(a.triage_time.cmp(&b.triage_time))
        });

        Ok(critical)
    }

    async fn get_ed_dashboard(&self) -> RepositoryResult<Vec<TriageAssessmentEntity>> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let cutoff = Utc::now() - Duration::hours(24);

        let mut triages: Vec<TriageAssessmentEntity> = storage
            .values()
            .filter(|t| t.triage_time > cutoff)
            .cloned()
            .collect();

        // Sort by ESI level, then by wait time (older first)
        triages.sort_by(|a, b| {
            a.esi_level
                .cmp(&b.esi_level)
                .then(a.triage_time.cmp(&b.triage_time))
        });

        Ok(triages)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn create_test_triage(id: &str, patient_id: &str, esi_level: i32) -> TriageAssessmentEntity {
        TriageAssessmentEntity {
            id: id.to_string(),
            patient_id: patient_id.to_string(),
            esi_level,
            chief_complaint: "Chest pain".to_string(),
            heart_rate: Some(88),
            respiratory_rate: Some(18),
            blood_pressure_systolic: Some(140),
            blood_pressure_diastolic: Some(90),
            temperature: Some(37.2),
            oxygen_saturation: Some(97),
            pain_scale: Some(7),
            gcs_score: Some(15),
            blood_glucose: Some(110),
            weight: Some(80.0),
            is_critical: esi_level <= 2,
            requires_isolation: false,
            disposition: None,
            assigned_bed: None,
            triage_time: Utc::now(),
            seen_by_provider_at: None,
            performed_by: "RN-001".to_string(),
            facility_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[tokio::test]
    async fn test_create_and_get() {
        let repo = MemoryTriageAssessmentRepository::new();
        let triage = create_test_triage("TRI-001", "PAT-001", 2);

        let created = repo.create(triage).await.unwrap();
        assert_eq!(created.id, "TRI-001");

        let fetched = repo.get_by_id("TRI-001").await.unwrap();
        assert_eq!(fetched.esi_level, 2);
    }

    #[tokio::test]
    async fn test_get_critical() {
        let repo = MemoryTriageAssessmentRepository::new();

        repo.create(create_test_triage("TRI-001", "PAT-001", 1))
            .await
            .unwrap();
        repo.create(create_test_triage("TRI-002", "PAT-002", 2))
            .await
            .unwrap();
        repo.create(create_test_triage("TRI-003", "PAT-003", 3))
            .await
            .unwrap();
        repo.create(create_test_triage("TRI-004", "PAT-004", 4))
            .await
            .unwrap();

        let critical = repo.get_critical().await.unwrap();
        assert_eq!(critical.len(), 2);
        assert_eq!(critical[0].esi_level, 1);
        assert_eq!(critical[1].esi_level, 2);
    }
}
