//! In-memory sample history repository implementation.

use crate::repositories::traits::{
    PaginatedResult, Pagination, RepositoryError, RepositoryResult, SampleHistoryEntity,
    SampleHistoryRepository,
};
use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// In-memory sample history repository
#[derive(Debug, Clone)]
pub struct MemorySampleHistoryRepository {
    /// In-memory storage using HashMap
    data: Arc<RwLock<HashMap<String, SampleHistoryEntity>>>,
}

impl MemorySampleHistoryRepository {
    /// Create new memory repository
    pub fn new() -> Self {
        Self {
            data: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create with existing data
    #[allow(dead_code)]
    pub fn with_data(data: HashMap<String, SampleHistoryEntity>) -> Self {
        Self {
            data: Arc::new(RwLock::new(data)),
        }
    }
}

#[async_trait]
impl SampleHistoryRepository for MemorySampleHistoryRepository {
    async fn create(
        &self,
        mut history: SampleHistoryEntity,
    ) -> RepositoryResult<SampleHistoryEntity> {
        let mut storage = self.data.write().unwrap();

        // Check for existing ID
        if storage.contains_key(&history.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Sample history with ID {} already exists",
                history.id
            )));
        }

        // Set timestamps
        let now = Utc::now();
        history.created_at = now;
        history.updated_at = now;

        storage.insert(history.id.clone(), history.clone());
        Ok(history)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<SampleHistoryEntity> {
        let storage = self.data.read().unwrap();
        storage.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Sample history with ID {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<SampleHistoryEntity>> {
        let storage = self.data.read().unwrap();

        let mut histories: Vec<SampleHistoryEntity> = storage
            .values()
            .filter(|h| h.patient_id == patient_id && h.is_active)
            .cloned()
            .collect();

        // Sort by collection time (newest first)
        histories.sort_by(|a, b| b.collected_at.cmp(&a.collected_at));

        let total = histories.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = histories.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<SampleHistoryEntity>> {
        let storage = self.data.read().unwrap();

        let latest = storage
            .values()
            .filter(|h| h.patient_id == patient_id && h.is_active)
            .max_by(|a, b| a.collected_at.cmp(&b.collected_at))
            .cloned();

        Ok(latest)
    }

    async fn update(
        &self,
        mut history: SampleHistoryEntity,
    ) -> RepositoryResult<SampleHistoryEntity> {
        let mut storage = self.data.write().unwrap();

        if !storage.contains_key(&history.id) {
            return Err(RepositoryError::NotFound(format!(
                "Sample history with ID {} not found",
                history.id
            )));
        }

        history.updated_at = Utc::now();
        storage.insert(history.id.clone(), history.clone());
        Ok(history)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut storage = self.data.write().unwrap();

        if let Some(mut history) = storage.get(id).cloned() {
            history.is_active = false;
            history.updated_at = Utc::now();
            storage.insert(id.to_string(), history);
            Ok(())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Sample history with ID {} not found",
                id
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[tokio::test]
    async fn test_create_sample_history() {
        let repo = MemorySampleHistoryRepository::new();

        let history = SampleHistoryEntity {
            id: Uuid::new_v4().to_string(),
            patient_id: "patient_1".to_string(),
            signs_symptoms: serde_json::json!(["chest pain", "shortness of breath"]),
            past_medical_history: serde_json::json!(["hypertension", "diabetes"]),
            events_leading: "Patient was walking when chest pain started".to_string(),
            last_intake: Some(serde_json::json!({"time": "2h ago", "substance": "coffee"})),
            medications: serde_json::json!(["lisinopril", "metformin"]),
            allergies_snapshot: serde_json::json!(["penicillin"]),
            collected_by: "DOC-001".to_string(),
            collected_at: Utc::now(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            facility_id: Some("facility_1".to_string()),
            is_active: true,
        };

        let result = repo.create(history.clone()).await;
        assert!(result.is_ok());

        let retrieved = repo.get_by_id(&history.id).await.unwrap();
        assert_eq!(retrieved.patient_id, history.patient_id);
        assert_eq!(retrieved.events_leading, history.events_leading);
    }

    #[tokio::test]
    async fn test_get_by_patient() {
        let repo = MemorySampleHistoryRepository::new();
        let patient_id = "patient_1";

        // Create multiple histories for the same patient
        for i in 1..=3 {
            let history = SampleHistoryEntity {
                id: Uuid::new_v4().to_string(),
                patient_id: patient_id.to_string(),
                signs_symptoms: serde_json::json!([format!("symptom_{}", i)]),
                past_medical_history: serde_json::json!([]),
                events_leading: format!("Event {}", i),
                last_intake: None,
                medications: serde_json::json!([]),
                allergies_snapshot: serde_json::json!([]),
                collected_by: format!("DOC-{}", i),
                collected_at: Utc::now(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
                facility_id: None,
                is_active: true,
            };
            repo.create(history).await.unwrap();
        }

        let pagination = Pagination::new(0, 10);
        let result = repo.get_by_patient(patient_id, pagination).await.unwrap();

        assert_eq!(result.items.len(), 3);
        assert_eq!(result.total, 3);
    }

    #[tokio::test]
    async fn test_get_latest_by_patient() {
        let repo = MemorySampleHistoryRepository::new();
        let patient_id = "patient_1";

        // Create multiple histories with different timestamps
        let mut timestamps = Vec::new();
        for i in 1..=3 {
            let timestamp = Utc::now() - chrono::Duration::hours(i);
            timestamps.push(timestamp);

            let history = SampleHistoryEntity {
                id: Uuid::new_v4().to_string(),
                patient_id: patient_id.to_string(),
                signs_symptoms: serde_json::json!([format!("symptom_{}", i)]),
                past_medical_history: serde_json::json!([]),
                events_leading: format!("Event {}", i),
                last_intake: None,
                medications: serde_json::json!([]),
                allergies_snapshot: serde_json::json!([]),
                collected_by: format!("DOC-{}", i),
                collected_at: timestamp,
                created_at: timestamp,
                updated_at: timestamp,
                facility_id: None,
                is_active: true,
            };
            repo.create(history).await.unwrap();
        }

        let latest = repo.get_latest_by_patient(patient_id).await.unwrap();
        assert!(latest.is_some());

        // The latest should have the most recent timestamp (1 hour ago)
        let latest_history = latest.unwrap();
        assert_eq!(latest_history.events_leading, "Event 1");
    }
}
