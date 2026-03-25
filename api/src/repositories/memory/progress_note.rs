//! In-memory progress note repository implementation.

use crate::repositories::traits::{
    PaginatedResult, Pagination, ProgressNoteEntity, ProgressNoteRepository, RepositoryError,
    RepositoryResult,
};
use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// In-memory progress note repository
#[derive(Debug, Clone)]
pub struct MemoryProgressNoteRepository {
    /// In-memory storage using HashMap
    data: Arc<RwLock<HashMap<String, ProgressNoteEntity>>>,
}

impl MemoryProgressNoteRepository {
    /// Create new memory repository
    pub fn new() -> Self {
        Self {
            data: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create with existing data
    #[allow(dead_code)]
    pub fn with_data(data: HashMap<String, ProgressNoteEntity>) -> Self {
        Self {
            data: Arc::new(RwLock::new(data)),
        }
    }
}

#[async_trait]
impl ProgressNoteRepository for MemoryProgressNoteRepository {
    async fn create(&self, mut note: ProgressNoteEntity) -> RepositoryResult<ProgressNoteEntity> {
        let mut storage = self.data.write().unwrap();

        if storage.contains_key(&note.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Progress note with ID {} already exists",
                note.id
            )));
        }

        let now = Utc::now();
        note.created_at = now;
        note.updated_at = now;

        storage.insert(note.id.clone(), note.clone());
        Ok(note)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ProgressNoteEntity> {
        let storage = self.data.read().unwrap();
        storage.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Progress note with ID {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ProgressNoteEntity>> {
        let storage = self.data.read().unwrap();

        let mut notes: Vec<ProgressNoteEntity> = storage
            .values()
            .filter(|n| n.patient_id == patient_id && n.is_active)
            .cloned()
            .collect();

        notes.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        let total = notes.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = notes.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_encounter(
        &self,
        encounter_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ProgressNoteEntity>> {
        let storage = self.data.read().unwrap();

        let mut notes: Vec<ProgressNoteEntity> = storage
            .values()
            .filter(|n| {
                n.encounter_id
                    .as_ref()
                    .map(|e| e == encounter_id)
                    .unwrap_or(false)
                    && n.is_active
            })
            .cloned()
            .collect();

        notes.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        let total = notes.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = notes.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(&self, mut note: ProgressNoteEntity) -> RepositoryResult<ProgressNoteEntity> {
        let mut storage = self.data.write().unwrap();

        if !storage.contains_key(&note.id) {
            return Err(RepositoryError::NotFound(format!(
                "Progress note with ID {} not found",
                note.id
            )));
        }

        note.updated_at = Utc::now();
        storage.insert(note.id.clone(), note.clone());
        Ok(note)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut storage = self.data.write().unwrap();

        if let Some(mut note) = storage.get(id).cloned() {
            note.is_active = false;
            note.updated_at = Utc::now();
            storage.insert(id.to_string(), note);
            Ok(())
        } else {
            Err(RepositoryError::NotFound(format!(
                "Progress note with ID {} not found",
                id
            )))
        }
    }

    async fn search_by_type(
        &self,
        note_type: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ProgressNoteEntity>> {
        let storage = self.data.read().unwrap();

        let mut notes: Vec<ProgressNoteEntity> = storage
            .values()
            .filter(|n| n.note_type == note_type && n.is_active)
            .cloned()
            .collect();

        notes.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        let total = notes.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = notes.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ProgressNoteEntity>> {
        let storage = self.data.read().unwrap();

        let mut notes: Vec<ProgressNoteEntity> =
            storage.values().filter(|n| n.is_active).cloned().collect();

        notes.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        let total = notes.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items = notes.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }
}
