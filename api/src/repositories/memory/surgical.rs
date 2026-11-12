//! In-memory repositories for surgery and procedures: pre-op, operative and post-op notes, anaesthesia, intubation, laceration repair, splints and casts.

use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// Memory-based pre-op assessment repository
#[derive(Debug)]
pub struct MemoryPreOpAssessmentRepository {
    data: RwLock<HashMap<String, PreOpAssessmentEntity>>,
}

impl Default for MemoryPreOpAssessmentRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryPreOpAssessmentRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl PreOpAssessmentRepository for MemoryPreOpAssessmentRepository {
    async fn create(
        &self,
        assessment: PreOpAssessmentEntity,
    ) -> RepositoryResult<PreOpAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&assessment.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Pre-op assessment {} already exists",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<PreOpAssessmentEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Pre-op assessment {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PreOpAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|a| a.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.assessed_at));
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

    async fn get_by_surgeon(
        &self,
        surgeon_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PreOpAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|a| a.surgeon_id == surgeon_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.assessed_at));
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
        assessment: PreOpAssessmentEntity,
    ) -> RepositoryResult<PreOpAssessmentEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&assessment.id) {
            return Err(RepositoryError::NotFound(format!(
                "Pre-op assessment {} not found",
                assessment.id
            )));
        }
        data.insert(assessment.id.clone(), assessment.clone());
        Ok(assessment)
    }

    async fn get_scheduled(
        &self,
        date_range: DateRange,
    ) -> RepositoryResult<Vec<PreOpAssessmentEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|a| {
                if let Some(scheduled) = a.scheduled_date {
                    if let Some(from) = date_range.from {
                        if scheduled < from {
                            return false;
                        }
                    }
                    if let Some(to) = date_range.to {
                        if scheduled > to {
                            return false;
                        }
                    }
                    true
                } else {
                    false
                }
            })
            .cloned()
            .collect();
        items.sort_by_key(|a| a.scheduled_date);
        Ok(items)
    }
}

/// Memory-based operative note repository
#[derive(Debug)]
pub struct MemoryOperativeNoteRepository {
    data: RwLock<HashMap<String, OperativeNoteEntity>>,
}

impl Default for MemoryOperativeNoteRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryOperativeNoteRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl OperativeNoteRepository for MemoryOperativeNoteRepository {
    /// Deployment-wide read, newest first, matching the ordering the PostgreSQL
    /// implementation uses so the two backends agree on what "the latest 500"
    /// means.
    async fn list_all(&self) -> RepositoryResult<Vec<OperativeNoteEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<OperativeNoteEntity> = data.values().cloned().collect();
        items.sort_by_key(|item| std::cmp::Reverse(item.created_at));
        items.truncate(500);
        Ok(items)
    }

    async fn create(&self, note: OperativeNoteEntity) -> RepositoryResult<OperativeNoteEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&note.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Operative note {} already exists",
                note.id
            )));
        }
        data.insert(note.id.clone(), note.clone());
        Ok(note)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<OperativeNoteEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Operative note {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<OperativeNoteEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|n| n.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.start_time));
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

    async fn get_by_surgeon(
        &self,
        surgeon_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<OperativeNoteEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|n| n.surgeon_id == surgeon_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.start_time));
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

    async fn update(&self, note: OperativeNoteEntity) -> RepositoryResult<OperativeNoteEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&note.id) {
            return Err(RepositoryError::NotFound(format!(
                "Operative note {} not found",
                note.id
            )));
        }
        data.insert(note.id.clone(), note.clone());
        Ok(note)
    }
}

/// Memory-based post-op note repository
#[derive(Debug)]
pub struct MemoryPostOpNoteRepository {
    data: RwLock<HashMap<String, PostOpNoteEntity>>,
}

impl Default for MemoryPostOpNoteRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryPostOpNoteRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl PostOpNoteRepository for MemoryPostOpNoteRepository {
    async fn create(&self, note: PostOpNoteEntity) -> RepositoryResult<PostOpNoteEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&note.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Post-op note {} already exists",
                note.id
            )));
        }
        data.insert(note.id.clone(), note.clone());
        Ok(note)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<PostOpNoteEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Post-op note {} not found", id)))
    }

    async fn get_by_operative_note(
        &self,
        operative_note_id: &str,
    ) -> RepositoryResult<Vec<PostOpNoteEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|n| n.operative_note_id.as_deref() == Some(operative_note_id))
            .cloned()
            .collect();
        items.sort_by_key(|n| n.post_op_day);
        Ok(items)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<PostOpNoteEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|n| n.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.note_date));
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

    async fn update(&self, note: PostOpNoteEntity) -> RepositoryResult<PostOpNoteEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&note.id) {
            return Err(RepositoryError::NotFound(format!(
                "Post-op note {} not found",
                note.id
            )));
        }
        data.insert(note.id.clone(), note.clone());
        Ok(note)
    }
}

/// Memory-based anesthesia record repository
#[derive(Debug)]
pub struct MemoryAnesthesiaRecordRepository {
    data: RwLock<HashMap<String, AnesthesiaRecordEntity>>,
}

impl Default for MemoryAnesthesiaRecordRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryAnesthesiaRecordRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl AnesthesiaRecordRepository for MemoryAnesthesiaRecordRepository {
    async fn create(
        &self,
        record: AnesthesiaRecordEntity,
    ) -> RepositoryResult<AnesthesiaRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&record.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Anesthesia record {} already exists",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<AnesthesiaRecordEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Anesthesia record {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AnesthesiaRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.created_at));
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

    async fn get_by_provider(
        &self,
        anesthesiologist_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AnesthesiaRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.anesthesiologist_id == anesthesiologist_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.created_at));
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
        record: AnesthesiaRecordEntity,
    ) -> RepositoryResult<AnesthesiaRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "Anesthesia record {} not found",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn list_all(&self) -> RepositoryResult<Vec<AnesthesiaRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.values().cloned().collect())
    }
}

/// Memory-based intubation record repository
#[derive(Debug)]
pub struct MemoryIntubationRecordRepository {
    data: RwLock<HashMap<String, IntubationRecordEntity>>,
}

impl Default for MemoryIntubationRecordRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryIntubationRecordRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl IntubationRecordRepository for MemoryIntubationRecordRepository {
    /// Deployment-wide read, newest first, matching the ordering the PostgreSQL
    /// implementation uses so the two backends agree on what "the latest 500"
    /// means.
    async fn list_all(&self) -> RepositoryResult<Vec<IntubationRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<IntubationRecordEntity> = data.values().cloned().collect();
        items.sort_by_key(|item| std::cmp::Reverse(item.performed_at));
        items.truncate(500);
        Ok(items)
    }

    async fn create(
        &self,
        record: IntubationRecordEntity,
    ) -> RepositoryResult<IntubationRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&record.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Intubation record {} already exists",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<IntubationRecordEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Intubation record {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<IntubationRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.performed_at));
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

    async fn get_difficult_airways(&self) -> RepositoryResult<Vec<IntubationRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.difficult_airway)
            .cloned()
            .collect())
    }

    async fn update(
        &self,
        record: IntubationRecordEntity,
    ) -> RepositoryResult<IntubationRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "Intubation record {} not found",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }
}

/// Memory-based laceration repair repository
#[derive(Debug)]
pub struct MemoryLacerationRepairRepository {
    data: RwLock<HashMap<String, LacerationRepairEntity>>,
}

impl Default for MemoryLacerationRepairRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryLacerationRepairRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl LacerationRepairRepository for MemoryLacerationRepairRepository {
    /// Deployment-wide read, newest first, matching the ordering the PostgreSQL
    /// implementation uses so the two backends agree on what "the latest 500"
    /// means.
    async fn list_all(&self) -> RepositoryResult<Vec<LacerationRepairEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<LacerationRepairEntity> = data.values().cloned().collect();
        items.sort_by_key(|item| std::cmp::Reverse(item.performed_at));
        items.truncate(500);
        Ok(items)
    }

    async fn create(
        &self,
        repair: LacerationRepairEntity,
    ) -> RepositoryResult<LacerationRepairEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&repair.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Laceration repair {} already exists",
                repair.id
            )));
        }
        data.insert(repair.id.clone(), repair.clone());
        Ok(repair)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<LacerationRepairEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Laceration repair {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<LacerationRepairEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.performed_at));
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

    async fn get_pending_followups(&self) -> RepositoryResult<Vec<LacerationRepairEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let today = Utc::now().date_naive();
        Ok(data
            .values()
            .filter(|r| r.follow_up_date.map(|d| d >= today).unwrap_or(false))
            .cloned()
            .collect())
    }

    async fn update(
        &self,
        repair: LacerationRepairEntity,
    ) -> RepositoryResult<LacerationRepairEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&repair.id) {
            return Err(RepositoryError::NotFound(format!(
                "Laceration repair {} not found",
                repair.id
            )));
        }
        data.insert(repair.id.clone(), repair.clone());
        Ok(repair)
    }
}

/// Memory-based splint/cast record repository
#[derive(Debug)]
pub struct MemorySplintCastRecordRepository {
    data: RwLock<HashMap<String, SplintCastRecordEntity>>,
}

impl Default for MemorySplintCastRecordRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemorySplintCastRecordRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl SplintCastRecordRepository for MemorySplintCastRecordRepository {
    async fn list_all(&self) -> RepositoryResult<Vec<SplintCastRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<SplintCastRecordEntity> = data.values().cloned().collect();
        items.sort_by_key(|item| std::cmp::Reverse(item.applied_at));
        items.truncate(500);
        Ok(items)
    }

    async fn create(
        &self,
        record: SplintCastRecordEntity,
    ) -> RepositoryResult<SplintCastRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&record.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Splint/cast record {} already exists",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<SplintCastRecordEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Splint/cast record {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<SplintCastRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.applied_at));
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

    async fn get_active(&self, patient_id: &str) -> RepositoryResult<Vec<SplintCastRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.patient_id == patient_id && r.removal_date.is_none())
            .cloned()
            .collect())
    }

    async fn update(
        &self,
        record: SplintCastRecordEntity,
    ) -> RepositoryResult<SplintCastRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "Splint/cast record {} not found",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }
}
