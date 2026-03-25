//! Emergency Protocol Memory Repositories
//!
//! In-memory HashMap implementations for Code Blue, Trauma, Stroke,
//! Cardiac, and Sepsis emergency protocol entities.

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

// =============================================================================
// CODE BLUE REPOSITORY
// =============================================================================

/// Memory-based Code Blue repository
#[derive(Debug)]
pub struct MemoryCodeBlueRepository {
    data: RwLock<HashMap<String, CodeBlueEntity>>,
}

impl Default for MemoryCodeBlueRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryCodeBlueRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl CodeBlueRepository for MemoryCodeBlueRepository {
    async fn create(&self, record: CodeBlueEntity) -> RepositoryResult<CodeBlueEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&record.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Code Blue record {} already exists",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<CodeBlueEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Code Blue record {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CodeBlueEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        let total = items.len() as u64;
        let start = pagination.offset() as usize;
        let end = (start + pagination.limit() as usize).min(items.len());
        let items = if start < items.len() {
            items[start..end].to_vec()
        } else {
            vec![]
        };
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(&self, record: CodeBlueEntity) -> RepositoryResult<CodeBlueEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "Code Blue record {} not found",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.remove(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Code Blue record {} not found", id)))
            .map(|_| ())
    }
}

// =============================================================================
// TRAUMA ASSESSMENT REPOSITORY
// =============================================================================

/// Memory-based Trauma Assessment repository
#[derive(Debug)]
pub struct MemoryTraumaAssessmentRepository {
    data: RwLock<HashMap<String, TraumaAssessmentEntity>>,
}

impl Default for MemoryTraumaAssessmentRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryTraumaAssessmentRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl TraumaAssessmentRepository for MemoryTraumaAssessmentRepository {
    async fn create(
        &self,
        assessment: TraumaAssessmentEntity,
    ) -> RepositoryResult<TraumaAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&assessment.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Trauma assessment {} already exists",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<TraumaAssessmentEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Trauma assessment {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<TraumaAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        let total = items.len() as u64;
        let start = pagination.offset() as usize;
        let end = (start + pagination.limit() as usize).min(items.len());
        let items = if start < items.len() {
            items[start..end].to_vec()
        } else {
            vec![]
        };
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        assessment: TraumaAssessmentEntity,
    ) -> RepositoryResult<TraumaAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&assessment.id) {
            return Err(RepositoryError::NotFound(format!(
                "Trauma assessment {} not found",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.remove(id)
            .ok_or_else(|| {
                RepositoryError::NotFound(format!("Trauma assessment {} not found", id))
            })
            .map(|_| ())
    }
}

// =============================================================================
// STROKE ASSESSMENT REPOSITORY
// =============================================================================

/// Memory-based Stroke Assessment repository
#[derive(Debug)]
pub struct MemoryStrokeAssessmentRepository {
    data: RwLock<HashMap<String, StrokeAssessmentEntity>>,
}

impl Default for MemoryStrokeAssessmentRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryStrokeAssessmentRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl StrokeAssessmentRepository for MemoryStrokeAssessmentRepository {
    async fn create(
        &self,
        assessment: StrokeAssessmentEntity,
    ) -> RepositoryResult<StrokeAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&assessment.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Stroke assessment {} already exists",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<StrokeAssessmentEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Stroke assessment {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<StrokeAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        let total = items.len() as u64;
        let start = pagination.offset() as usize;
        let end = (start + pagination.limit() as usize).min(items.len());
        let items = if start < items.len() {
            items[start..end].to_vec()
        } else {
            vec![]
        };
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        assessment: StrokeAssessmentEntity,
    ) -> RepositoryResult<StrokeAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&assessment.id) {
            return Err(RepositoryError::NotFound(format!(
                "Stroke assessment {} not found",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.remove(id)
            .ok_or_else(|| {
                RepositoryError::NotFound(format!("Stroke assessment {} not found", id))
            })
            .map(|_| ())
    }
}

// =============================================================================
// CARDIAC EVENT REPOSITORY
// =============================================================================

/// Memory-based Cardiac Event repository
#[derive(Debug)]
pub struct MemoryCardiacEventRepository {
    data: RwLock<HashMap<String, CardiacEventEntity>>,
}

impl Default for MemoryCardiacEventRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryCardiacEventRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl CardiacEventRepository for MemoryCardiacEventRepository {
    async fn create(&self, event: CardiacEventEntity) -> RepositoryResult<CardiacEventEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&event.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Cardiac event {} already exists",
                event.id
            )));
        }
        data.insert(event.id.clone(), event.clone());
        Ok(event)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<CardiacEventEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Cardiac event {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CardiacEventEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        let total = items.len() as u64;
        let start = pagination.offset() as usize;
        let end = (start + pagination.limit() as usize).min(items.len());
        let items = if start < items.len() {
            items[start..end].to_vec()
        } else {
            vec![]
        };
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(&self, event: CardiacEventEntity) -> RepositoryResult<CardiacEventEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&event.id) {
            return Err(RepositoryError::NotFound(format!(
                "Cardiac event {} not found",
                event.id
            )));
        }
        data.insert(event.id.clone(), event.clone());
        Ok(event)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.remove(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Cardiac event {} not found", id)))
            .map(|_| ())
    }
}

// =============================================================================
// SEPSIS ASSESSMENT REPOSITORY
// =============================================================================

/// Memory-based Sepsis Assessment repository
#[derive(Debug)]
pub struct MemorySepsisAssessmentRepository {
    data: RwLock<HashMap<String, SepsisAssessmentEntity>>,
}

impl Default for MemorySepsisAssessmentRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemorySepsisAssessmentRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl SepsisAssessmentRepository for MemorySepsisAssessmentRepository {
    async fn create(
        &self,
        assessment: SepsisAssessmentEntity,
    ) -> RepositoryResult<SepsisAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&assessment.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Sepsis assessment {} already exists",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<SepsisAssessmentEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Sepsis assessment {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<SepsisAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        let total = items.len() as u64;
        let start = pagination.offset() as usize;
        let end = (start + pagination.limit() as usize).min(items.len());
        let items = if start < items.len() {
            items[start..end].to_vec()
        } else {
            vec![]
        };
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn update(
        &self,
        assessment: SepsisAssessmentEntity,
    ) -> RepositoryResult<SepsisAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&assessment.id) {
            return Err(RepositoryError::NotFound(format!(
                "Sepsis assessment {} not found",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.remove(id)
            .ok_or_else(|| {
                RepositoryError::NotFound(format!("Sepsis assessment {} not found", id))
            })
            .map(|_| ())
    }
}
