//! In-memory fall risk assessment repository implementation.

use crate::repositories::traits::{
    FallRiskAssessmentEntity, FallRiskAssessmentRepository, PaginatedResult, Pagination,
    RepositoryError, RepositoryResult,
};
use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// In-memory fall risk assessment repository
#[derive(Debug, Clone)]
pub struct MemoryFallRiskAssessmentRepository {
    /// In-memory storage using HashMap
    data: Arc<RwLock<HashMap<String, FallRiskAssessmentEntity>>>,
}

impl MemoryFallRiskAssessmentRepository {
    /// Create new memory repository
    pub fn new() -> Self {
        Self {
            data: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create with existing data
    #[allow(dead_code)]
    pub fn with_data(data: HashMap<String, FallRiskAssessmentEntity>) -> Self {
        Self {
            data: Arc::new(RwLock::new(data)),
        }
    }

    /// Calculate risk level based on Morse Fall Scale score
    fn calculate_risk_level(score: i32) -> String {
        match score {
            0..=24 => "low".to_string(),
            25..=44 => "moderate".to_string(),
            _ => "high".to_string(),
        }
    }
}

#[async_trait]
impl FallRiskAssessmentRepository for MemoryFallRiskAssessmentRepository {
    async fn create(
        &self,
        mut assessment: FallRiskAssessmentEntity,
    ) -> RepositoryResult<FallRiskAssessmentEntity> {
        let mut storage = self.data.write().unwrap();

        if storage.contains_key(&assessment.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Fall risk assessment with ID {} already exists",
                assessment.id
            )));
        }

        let now = Utc::now();
        assessment.created_at = now;
        assessment.updated_at = now;

        // Calculate total score and risk level
        assessment.total_score = assessment.history_of_falling.unwrap_or(0)
            + assessment.secondary_diagnosis.unwrap_or(0)
            + assessment.ambulatory_aid.unwrap_or(0)
            + assessment.iv_therapy.unwrap_or(0)
            + assessment.gait_status.unwrap_or(0)
            + assessment.mental_status.unwrap_or(0);

        assessment.risk_level = Self::calculate_risk_level(assessment.total_score);

        storage.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<FallRiskAssessmentEntity> {
        let storage = self.data.read().unwrap();
        storage.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Fall risk assessment with ID {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<FallRiskAssessmentEntity>> {
        let storage = self.data.read().unwrap();

        let mut assessments: Vec<FallRiskAssessmentEntity> = storage
            .values()
            .filter(|a| a.patient_id == patient_id)
            .cloned()
            .collect();

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
    ) -> RepositoryResult<Option<FallRiskAssessmentEntity>> {
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
        mut assessment: FallRiskAssessmentEntity,
    ) -> RepositoryResult<FallRiskAssessmentEntity> {
        let mut storage = self.data.write().unwrap();

        if !storage.contains_key(&assessment.id) {
            return Err(RepositoryError::NotFound(format!(
                "Fall risk assessment with ID {} not found",
                assessment.id
            )));
        }

        // Recalculate total score and risk level
        assessment.total_score = assessment.history_of_falling.unwrap_or(0)
            + assessment.secondary_diagnosis.unwrap_or(0)
            + assessment.ambulatory_aid.unwrap_or(0)
            + assessment.iv_therapy.unwrap_or(0)
            + assessment.gait_status.unwrap_or(0)
            + assessment.mental_status.unwrap_or(0);

        assessment.risk_level = Self::calculate_risk_level(assessment.total_score);
        assessment.updated_at = Utc::now();

        storage.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_high_risk_patients(&self) -> RepositoryResult<Vec<FallRiskAssessmentEntity>> {
        let storage = self.data.read().unwrap();

        let high_risk_assessments: Vec<FallRiskAssessmentEntity> = storage
            .values()
            .filter(|a| a.risk_level == "moderate" || a.risk_level == "high")
            .cloned()
            .collect();

        Ok(high_risk_assessments)
    }

    async fn get_assessments_due(&self) -> RepositoryResult<Vec<FallRiskAssessmentEntity>> {
        let storage = self.data.read().unwrap();
        let now = Utc::now();

        let due_assessments: Vec<FallRiskAssessmentEntity> = storage
            .values()
            .filter(|a| {
                a.next_assessment_due
                    .map(|due_date| due_date <= now)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();

        Ok(due_assessments)
    }
}
