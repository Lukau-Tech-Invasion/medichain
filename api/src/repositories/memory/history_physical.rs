//! In-memory history and physical repository implementation.

use crate::repositories::traits::{
    HistoryPhysicalEntity, HistoryPhysicalRepository, PaginatedResult, Pagination, RepositoryError,
    RepositoryResult,
};
use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone)]
pub struct MemoryHistoryPhysicalRepository {
    data: Arc<RwLock<HashMap<String, HistoryPhysicalEntity>>>,
}

impl MemoryHistoryPhysicalRepository {
    pub fn new() -> Self {
        Self {
            data: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

#[async_trait]
impl HistoryPhysicalRepository for MemoryHistoryPhysicalRepository {
    async fn create(
        &self,
        mut history: HistoryPhysicalEntity,
    ) -> RepositoryResult<HistoryPhysicalEntity> {
        let mut storage = self.data.write().unwrap();

        if storage.contains_key(&history.id) {
            return Err(RepositoryError::Duplicate(format!(
                "History and physical with ID {} already exists",
                history.id
            )));
        }

        let now = Utc::now();
        history.created_at = now;
        history.updated_at = now;

        storage.insert(history.id.clone(), history.clone());
        Ok(history)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<HistoryPhysicalEntity> {
        let storage = self.data.read().unwrap();
        storage.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("History and physical with ID {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<HistoryPhysicalEntity>> {
        let storage = self.data.read().unwrap();

        let mut histories: Vec<HistoryPhysicalEntity> = storage
            .values()
            .filter(|h| h.patient_id == patient_id && h.is_active)
            .cloned()
            .collect();

        histories.sort_by(|a, b| b.performed_at.cmp(&a.performed_at));

        let total = histories.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = histories.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        mut history: HistoryPhysicalEntity,
    ) -> RepositoryResult<HistoryPhysicalEntity> {
        let mut storage = self.data.write().unwrap();

        if !storage.contains_key(&history.id) {
            return Err(RepositoryError::NotFound(format!(
                "History and physical with ID {} not found",
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
                "History and physical with ID {} not found",
                id
            )))
        }
    }

    async fn get_by_exam_type(
        &self,
        exam_type: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<HistoryPhysicalEntity>> {
        let storage = self.data.read().unwrap();

        let mut histories: Vec<HistoryPhysicalEntity> = storage
            .values()
            .filter(|h| {
                h.exam_type
                    .as_ref()
                    .map(|et| et == exam_type)
                    .unwrap_or(false)
                    && h.is_active
            })
            .cloned()
            .collect();

        histories.sort_by(|a, b| b.performed_at.cmp(&a.performed_at));

        let total = histories.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = histories.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }
}
