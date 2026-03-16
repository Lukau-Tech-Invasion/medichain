//! In-memory Glasgow Coma Scale assessment repository implementation.

use crate::repositories::traits::{
    GcsAssessmentEntity, GcsAssessmentRepository, PaginatedResult, Pagination, RepositoryError,
    RepositoryResult,
};
use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// In-memory GCS assessment repository
#[derive(Debug, Clone)]
pub struct MemoryGcsAssessmentRepository {
    /// In-memory storage using HashMap
    data: Arc<RwLock<HashMap<String, GcsAssessmentEntity>>>,
}

impl MemoryGcsAssessmentRepository {
    /// Create new memory repository
    pub fn new() -> Self {
        Self {
            data: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create with existing data
    #[allow(dead_code)]
    pub fn with_data(data: HashMap<String, GcsAssessmentEntity>) -> Self {
        Self {
            data: Arc::new(RwLock::new(data)),
        }
    }
}

#[async_trait]
impl GcsAssessmentRepository for MemoryGcsAssessmentRepository {
    async fn create(
        &self,
        mut assessment: GcsAssessmentEntity,
    ) -> RepositoryResult<GcsAssessmentEntity> {
        let mut storage = self.data.write().unwrap();

        // Check for existing ID
        if storage.contains_key(&assessment.id) {
            return Err(RepositoryError::Duplicate(format!(
                "GCS assessment with ID {} already exists",
                assessment.id
            )));
        }

        // Set timestamps and calculate total score
        let now = Utc::now();
        assessment.created_at = now;
        assessment.updated_at = now;
        assessment.total_score =
            assessment.eye_response + assessment.verbal_response + assessment.motor_response;

        storage.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<GcsAssessmentEntity> {
        let storage = self.data.read().unwrap();
        storage.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("GCS assessment with ID {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<GcsAssessmentEntity>> {
        let storage = self.data.read().unwrap();

        let mut assessments: Vec<GcsAssessmentEntity> = storage
            .values()
            .filter(|a| a.patient_id == patient_id)
            .cloned()
            .collect();

        // Sort by assessment time (newest first)
        assessments.sort_by(|a, b| b.assessed_at.cmp(&a.assessed_at));

        let total = assessments.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = assessments.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_latest_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Option<GcsAssessmentEntity>> {
        let storage = self.data.read().unwrap();

        let latest = storage
            .values()
            .filter(|a| a.patient_id == patient_id)
            .max_by(|a, b| a.assessed_at.cmp(&b.assessed_at))
            .cloned();

        Ok(latest)
    }

    async fn update(
        &self,
        mut assessment: GcsAssessmentEntity,
    ) -> RepositoryResult<GcsAssessmentEntity> {
        let mut storage = self.data.write().unwrap();

        if !storage.contains_key(&assessment.id) {
            return Err(RepositoryError::NotFound(format!(
                "GCS assessment with ID {} not found",
                assessment.id
            )));
        }

        // Recalculate total score
        assessment.total_score =
            assessment.eye_response + assessment.verbal_response + assessment.motor_response;
        assessment.updated_at = Utc::now();

        storage.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_critical_scores(
        &self,
        threshold: i32,
    ) -> RepositoryResult<Vec<GcsAssessmentEntity>> {
        let storage = self.data.read().unwrap();

        let critical_assessments: Vec<GcsAssessmentEntity> = storage
            .values()
            .filter(|a| a.total_score <= threshold)
            .cloned()
            .collect();

        Ok(critical_assessments)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[tokio::test]
    async fn test_create_gcs_assessment() {
        let repo = MemoryGcsAssessmentRepository::new();

        let assessment = GcsAssessmentEntity {
            id: Uuid::new_v4().to_string(),
            patient_id: "patient_1".to_string(),
            eye_response: 4,
            verbal_response: 5,
            motor_response: 6,
            total_score: 0, // Will be calculated
            interpretation: "Normal".to_string(),
            notes: Some("Patient alert and oriented".to_string()),
            pupil_assessment: None,
            assessed_by: "DOC-001".to_string(),
            assessed_at: Utc::now(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            facility_id: Some("facility_1".to_string()),
        };

        let result = repo.create(assessment.clone()).await;
        assert!(result.is_ok());

        let created = result.unwrap();
        assert_eq!(created.total_score, 15); // 4 + 5 + 6

        let retrieved = repo.get_by_id(&assessment.id).await.unwrap();
        assert_eq!(retrieved.total_score, 15);
        assert_eq!(retrieved.interpretation, "Normal");
    }

    #[tokio::test]
    async fn test_get_critical_scores() {
        let repo = MemoryGcsAssessmentRepository::new();

        // Create assessments with different scores
        let scores = [(2, 3, 3), (3, 4, 4), (4, 5, 6)]; // Total: 8, 11, 15

        for (i, (eye, verbal, motor)) in scores.iter().enumerate() {
            let assessment = GcsAssessmentEntity {
                id: Uuid::new_v4().to_string(),
                patient_id: format!("patient_{}", i + 1),
                eye_response: *eye,
                verbal_response: *verbal,
                motor_response: *motor,
                total_score: 0, // Will be calculated
                interpretation: format!("Score {}", eye + verbal + motor),
                notes: None,
                pupil_assessment: None,
                assessed_by: "DOC-001".to_string(),
                assessed_at: Utc::now(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
                facility_id: None,
            };
            repo.create(assessment).await.unwrap();
        }

        // Get critical scores (≤ 8)
        let critical = repo.get_critical_scores(8).await.unwrap();
        assert_eq!(critical.len(), 1);
        assert_eq!(critical[0].total_score, 8);

        // Get moderately impaired scores (≤ 12)
        let moderate = repo.get_critical_scores(12).await.unwrap();
        assert_eq!(moderate.len(), 2); // Scores 8 and 11
    }

    #[tokio::test]
    async fn test_get_latest_by_patient() {
        let repo = MemoryGcsAssessmentRepository::new();
        let patient_id = "patient_1";

        // Create multiple assessments with different timestamps
        for i in 1..=3i32 {
            let timestamp = Utc::now() - chrono::Duration::hours(i as i64);

            let assessment = GcsAssessmentEntity {
                id: Uuid::new_v4().to_string(),
                patient_id: patient_id.to_string(),
                eye_response: 3 + i,
                verbal_response: 4,
                motor_response: 5,
                total_score: 0,
                interpretation: format!("Assessment {}", i),
                notes: None,
                pupil_assessment: None,
                assessed_by: "DOC-001".to_string(),
                assessed_at: timestamp,
                created_at: timestamp,
                updated_at: timestamp,
                facility_id: None,
            };
            repo.create(assessment).await.unwrap();
        }

        let latest = repo.get_latest_by_patient(patient_id).await.unwrap();
        assert!(latest.is_some());

        // The latest should be the most recent (1 hour ago)
        let latest_assessment = latest.unwrap();
        assert_eq!(latest_assessment.interpretation, "Assessment 1");
        assert_eq!(latest_assessment.eye_response, 4); // 3 + 1
    }
}
