//! In-memory nursing care plan repository implementation.

use crate::repositories::traits::{
    NursingCarePlanEntity, NursingCarePlanRepository, PaginatedResult, Pagination, RepositoryError,
    RepositoryResult,
};
use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// In-memory nursing care plan repository
#[derive(Debug, Clone)]
pub struct MemoryNursingCarePlanRepository {
    /// In-memory storage using HashMap
    data: Arc<RwLock<HashMap<String, NursingCarePlanEntity>>>,
}

impl MemoryNursingCarePlanRepository {
    /// Create new memory repository
    pub fn new() -> Self {
        Self {
            data: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create with existing data
    #[allow(dead_code)]
    pub fn with_data(data: HashMap<String, NursingCarePlanEntity>) -> Self {
        Self {
            data: Arc::new(RwLock::new(data)),
        }
    }
}

#[async_trait]
impl NursingCarePlanRepository for MemoryNursingCarePlanRepository {
    async fn create(
        &self,
        mut plan: NursingCarePlanEntity,
    ) -> RepositoryResult<NursingCarePlanEntity> {
        let mut storage = self.data.write().unwrap();

        if storage.contains_key(&plan.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Nursing care plan with ID {} already exists",
                plan.id
            )));
        }

        let now = Utc::now();
        plan.created_at = now;
        plan.updated_at = now;

        storage.insert(plan.id.clone(), plan.clone());
        Ok(plan)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<NursingCarePlanEntity> {
        let storage = self.data.read().unwrap();
        storage.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Nursing care plan with ID {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<NursingCarePlanEntity>> {
        let storage = self.data.read().unwrap();

        let mut plans: Vec<NursingCarePlanEntity> = storage
            .values()
            .filter(|p| p.patient_id == patient_id && p.is_active)
            .cloned()
            .collect();

        plans.sort_by(|a, b| b.start_date.cmp(&a.start_date));

        let total = plans.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = plans.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_active_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<NursingCarePlanEntity>> {
        let storage = self.data.read().unwrap();

        let active_plans: Vec<NursingCarePlanEntity> = storage
            .values()
            .filter(|p| {
                p.patient_id == patient_id
                    && p.is_active
                    && p.status.as_ref().map(|s| s == "active").unwrap_or(false)
            })
            .cloned()
            .collect();

        Ok(active_plans)
    }

    async fn update(
        &self,
        mut plan: NursingCarePlanEntity,
    ) -> RepositoryResult<NursingCarePlanEntity> {
        let mut storage = self.data.write().unwrap();

        if !storage.contains_key(&plan.id) {
            return Err(RepositoryError::NotFound(format!(
                "Nursing care plan with ID {} not found",
                plan.id
            )));
        }

        plan.updated_at = Utc::now();
        storage.insert(plan.id.clone(), plan.clone());
        Ok(plan)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut storage = self.data.write().unwrap();

        if let Some(mut plan) = storage.get(id).cloned() {
            plan.is_active = false;
            plan.updated_at = Utc::now();
            storage.insert(id.to_string(), plan);
            Ok(())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Nursing care plan with ID {} not found",
                id
            )))
        }
    }

    async fn get_by_care_level(
        &self,
        care_level: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<NursingCarePlanEntity>> {
        let storage = self.data.read().unwrap();

        let mut plans: Vec<NursingCarePlanEntity> = storage
            .values()
            .filter(|p| {
                p.care_level
                    .as_ref()
                    .map(|cl| cl == care_level)
                    .unwrap_or(false)
                    && p.is_active
            })
            .cloned()
            .collect();

        plans.sort_by(|a, b| b.start_date.cmp(&a.start_date));

        let total = plans.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = plans.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }
}
