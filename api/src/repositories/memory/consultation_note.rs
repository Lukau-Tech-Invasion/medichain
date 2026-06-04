//! In-memory consultation note repository implementation.

use crate::repositories::traits::{
    ConsultationNoteEntity, ConsultationNoteRepository, PaginatedResult, Pagination,
    RepositoryError, RepositoryResult,
};
use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone)]
pub struct MemoryConsultationNoteRepository {
    data: Arc<RwLock<HashMap<String, ConsultationNoteEntity>>>,
}

impl MemoryConsultationNoteRepository {
    pub fn new() -> Self {
        Self {
            data: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

#[async_trait]
impl ConsultationNoteRepository for MemoryConsultationNoteRepository {
    async fn create(
        &self,
        mut consultation: ConsultationNoteEntity,
    ) -> RepositoryResult<ConsultationNoteEntity> {
        let mut storage = self.data.write().unwrap();

        if storage.contains_key(&consultation.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Consultation note with ID {} already exists",
                consultation.id
            )));
        }

        let now = Utc::now();
        consultation.created_at = now;
        consultation.updated_at = now;

        storage.insert(consultation.id.clone(), consultation.clone());
        Ok(consultation)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ConsultationNoteEntity> {
        let storage = self.data.read().unwrap();
        storage.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Consultation note with ID {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ConsultationNoteEntity>> {
        let storage = self.data.read().unwrap();

        let mut consultations: Vec<ConsultationNoteEntity> = storage
            .values()
            .filter(|c| c.patient_id == patient_id && c.is_active)
            .cloned()
            .collect();

        consultations.sort_by(|a, b| b.requested_at.cmp(&a.requested_at));

        let total = consultations.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = consultations.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_provider(
        &self,
        provider_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ConsultationNoteEntity>> {
        let storage = self.data.read().unwrap();

        let mut consultations: Vec<ConsultationNoteEntity> = storage
            .values()
            .filter(|c| {
                (c.requesting_provider == provider_id || c.consulting_provider == provider_id)
                    && c.is_active
            })
            .cloned()
            .collect();

        consultations.sort_by(|a, b| b.requested_at.cmp(&a.requested_at));

        let total = consultations.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = consultations.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        mut consultation: ConsultationNoteEntity,
    ) -> RepositoryResult<ConsultationNoteEntity> {
        let mut storage = self.data.write().unwrap();

        if !storage.contains_key(&consultation.id) {
            return Err(RepositoryError::NotFound(format!(
                "Consultation note with ID {} not found",
                consultation.id
            )));
        }

        consultation.updated_at = Utc::now();
        storage.insert(consultation.id.clone(), consultation.clone());
        Ok(consultation)
    }

    async fn get_by_status(
        &self,
        status: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ConsultationNoteEntity>> {
        let storage = self.data.read().unwrap();

        let mut consultations: Vec<ConsultationNoteEntity> = storage
            .values()
            .filter(|c| c.status.as_ref().map(|s| s == status).unwrap_or(false) && c.is_active)
            .cloned()
            .collect();

        consultations.sort_by(|a, b| b.requested_at.cmp(&a.requested_at));

        let total = consultations.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = consultations.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn list_all(&self) -> RepositoryResult<Vec<ConsultationNoteEntity>> {
        let storage = self.data.read().unwrap();
        let mut items: Vec<ConsultationNoteEntity> =
            storage.values().filter(|c| c.is_active).cloned().collect();
        items.sort_by(|a, b| b.requested_at.cmp(&a.requested_at));
        Ok(items)
    }
}
