//! In-memory wound assessment and IV assessment repository implementations.

use crate::repositories::traits::{
    Pagination, PaginatedResult, RepositoryError, RepositoryResult,
    WoundAssessmentEntity, WoundAssessmentRepository,
    IVAssessmentEntity, IVAssessmentRepository,
};
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use chrono::Utc;

// Wound Assessment Repository
#[derive(Debug, Clone)]
pub struct MemoryWoundAssessmentRepository {
    data: Arc<RwLock<HashMap<String, WoundAssessmentEntity>>>,
}

impl MemoryWoundAssessmentRepository {
    pub fn new() -> Self {
        Self {
            data: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

#[async_trait]
impl WoundAssessmentRepository for MemoryWoundAssessmentRepository {
    async fn create(&self, mut assessment: WoundAssessmentEntity) -> RepositoryResult<WoundAssessmentEntity> {
        let mut storage = self.data.write().unwrap();
        
        if storage.contains_key(&assessment.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Wound assessment with ID {} already exists",
                assessment.id
            )));
        }

        let now = Utc::now();
        assessment.created_at = now;
        assessment.updated_at = now;

        storage.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<WoundAssessmentEntity> {
        let storage = self.data.read().unwrap();
        storage
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Wound assessment with ID {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WoundAssessmentEntity>> {
        let storage = self.data.read().unwrap();
        
        let mut assessments: Vec<WoundAssessmentEntity> = storage
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

    async fn get_by_wound_id(
        &self,
        wound_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<WoundAssessmentEntity>> {
        let storage = self.data.read().unwrap();
        
        let mut assessments: Vec<WoundAssessmentEntity> = storage
            .values()
            .filter(|a| a.wound_id == wound_id)
            .cloned()
            .collect();

        assessments.sort_by(|a, b| b.assessed_at.cmp(&a.assessed_at));

        let total = assessments.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = assessments.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(&self, mut assessment: WoundAssessmentEntity) -> RepositoryResult<WoundAssessmentEntity> {
        let mut storage = self.data.write().unwrap();

        if !storage.contains_key(&assessment.id) {
            return Err(RepositoryError::NotFound(format!(
                "Wound assessment with ID {} not found",
                assessment.id
            )));
        }

        assessment.updated_at = Utc::now();
        storage.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_critical_wounds(&self) -> RepositoryResult<Vec<WoundAssessmentEntity>> {
        let storage = self.data.read().unwrap();
        
        let critical_wounds: Vec<WoundAssessmentEntity> = storage
            .values()
            .filter(|a| {
                a.drainage_amount.as_ref().map(|d| d == "moderate" || d == "heavy").unwrap_or(false) ||
                a.pain_level.map(|p| p >= 7).unwrap_or(false) ||
                a.periwound_condition.as_ref().map(|p| p != "intact").unwrap_or(false)
            })
            .cloned()
            .collect();

        Ok(critical_wounds)
    }
}

// IV Assessment Repository
#[derive(Debug, Clone)]
pub struct MemoryIVAssessmentRepository {
    data: Arc<RwLock<HashMap<String, IVAssessmentEntity>>>,
}

impl MemoryIVAssessmentRepository {
    pub fn new() -> Self {
        Self {
            data: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

#[async_trait]
impl IVAssessmentRepository for MemoryIVAssessmentRepository {
    async fn create(&self, mut assessment: IVAssessmentEntity) -> RepositoryResult<IVAssessmentEntity> {
        let mut storage = self.data.write().unwrap();
        
        if storage.contains_key(&assessment.id) {
            return Err(RepositoryError::Duplicate(format!(
                "IV assessment with ID {} already exists",
                assessment.id
            )));
        }

        let now = Utc::now();
        assessment.created_at = now;
        assessment.updated_at = now;

        storage.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<IVAssessmentEntity> {
        let storage = self.data.read().unwrap();
        storage
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("IV assessment with ID {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IVAssessmentEntity>> {
        let storage = self.data.read().unwrap();
        
        let mut assessments: Vec<IVAssessmentEntity> = storage
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

    async fn get_by_site_id(
        &self,
        site_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IVAssessmentEntity>> {
        let storage = self.data.read().unwrap();
        
        let mut assessments: Vec<IVAssessmentEntity> = storage
            .values()
            .filter(|a| a.site_id == site_id)
            .cloned()
            .collect();

        assessments.sort_by(|a, b| b.assessed_at.cmp(&a.assessed_at));

        let total = assessments.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = assessments.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(&self, mut assessment: IVAssessmentEntity) -> RepositoryResult<IVAssessmentEntity> {
        let mut storage = self.data.write().unwrap();

        if !storage.contains_key(&assessment.id) {
            return Err(RepositoryError::NotFound(format!(
                "IV assessment with ID {} not found",
                assessment.id
            )));
        }

        assessment.updated_at = Utc::now();
        storage.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_active_sites_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<IVAssessmentEntity>> {
        let storage = self.data.read().unwrap();
        
        let active_sites: Vec<IVAssessmentEntity> = storage
            .values()
            .filter(|a| {
                a.patient_id == patient_id && 
                !a.site_discontinued.unwrap_or(false)
            })
            .cloned()
            .collect();

        Ok(active_sites)
    }

    async fn get_sites_needing_attention(&self) -> RepositoryResult<Vec<IVAssessmentEntity>> {
        let storage = self.data.read().unwrap();
        
        let needing_attention: Vec<IVAssessmentEntity> = storage
            .values()
            .filter(|a| {
                a.infiltration_grade.map(|g| g > 0).unwrap_or(false) ||
                a.phlebitis_grade.map(|g| g > 0).unwrap_or(false) ||
                a.patency.as_ref().map(|p| p == "occluded" || p == "sluggish").unwrap_or(false) ||
                !a.dressing_intact.unwrap_or(true)
            })
            .cloned()
            .collect();

        Ok(needing_attention)
    }
}