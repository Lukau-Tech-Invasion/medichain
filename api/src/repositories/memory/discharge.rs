//! In-memory repositories for discharge: summaries, instructions, discharge against medical advice.

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// Memory-based discharge summary repository
#[derive(Debug)]
pub struct MemoryDischargeSummaryRepository {
    data: RwLock<HashMap<String, DischargeSummaryEntity>>,
}

impl Default for MemoryDischargeSummaryRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryDischargeSummaryRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl DischargeSummaryRepository for MemoryDischargeSummaryRepository {
    async fn create(
        &self,
        summary: DischargeSummaryEntity,
    ) -> RepositoryResult<DischargeSummaryEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&summary.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Discharge summary {} already exists",
                summary.id
            )));
        }
        data.insert(summary.id.clone(), summary.clone());
        Ok(summary)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<DischargeSummaryEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Discharge summary {} not found", id)))
    }

    async fn get_by_encounter(
        &self,
        encounter_id: &str,
    ) -> RepositoryResult<Option<DischargeSummaryEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .find(|s| s.encounter_id == encounter_id)
            .cloned())
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<DischargeSummaryEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|s| s.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.discharge_datetime));
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

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<DischargeSummaryEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data.values().cloned().collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.discharge_datetime));
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
        summary: DischargeSummaryEntity,
    ) -> RepositoryResult<DischargeSummaryEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&summary.id) {
            return Err(RepositoryError::NotFound(format!(
                "Discharge summary {} not found",
                summary.id
            )));
        }
        data.insert(summary.id.clone(), summary.clone());
        Ok(summary)
    }
}

/// Memory-based discharge instructions repository
#[derive(Debug)]
pub struct MemoryDischargeInstructionsRepository {
    data: RwLock<HashMap<String, DischargeInstructionsEntity>>,
}

impl Default for MemoryDischargeInstructionsRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryDischargeInstructionsRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl DischargeInstructionsRepository for MemoryDischargeInstructionsRepository {
    async fn create(
        &self,
        instructions: DischargeInstructionsEntity,
    ) -> RepositoryResult<DischargeInstructionsEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&instructions.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Discharge instructions {} already exists",
                instructions.id
            )));
        }
        data.insert(instructions.id.clone(), instructions.clone());
        Ok(instructions)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<DischargeInstructionsEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id).cloned().ok_or_else(|| {
            RepositoryError::NotFound(format!("Discharge instructions {} not found", id))
        })
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<DischargeInstructionsEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|i| i.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.visit_date));
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

    async fn get_by_summary(
        &self,
        summary_id: &str,
    ) -> RepositoryResult<Option<DischargeInstructionsEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .find(|i| i.discharge_summary_id.as_deref() == Some(summary_id))
            .cloned())
    }

    async fn update(
        &self,
        instructions: DischargeInstructionsEntity,
    ) -> RepositoryResult<DischargeInstructionsEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&instructions.id) {
            return Err(RepositoryError::NotFound(format!(
                "Discharge instructions {} not found",
                instructions.id
            )));
        }
        data.insert(instructions.id.clone(), instructions.clone());
        Ok(instructions)
    }
}

/// Memory-based AMA discharge repository
#[derive(Debug)]
pub struct MemoryAmaDischargeRepository {
    data: RwLock<HashMap<String, AmaDischargeEntity>>,
}

impl Default for MemoryAmaDischargeRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryAmaDischargeRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl AmaDischargeRepository for MemoryAmaDischargeRepository {
    async fn create(&self, discharge: AmaDischargeEntity) -> RepositoryResult<AmaDischargeEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&discharge.id) {
            return Err(RepositoryError::Duplicate(format!(
                "AMA discharge {} already exists",
                discharge.id
            )));
        }
        data.insert(discharge.id.clone(), discharge.clone());
        Ok(discharge)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<AmaDischargeEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("AMA discharge {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AmaDischargeEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|d| d.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.discharge_datetime));
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

    async fn get_by_encounter(
        &self,
        encounter_id: &str,
    ) -> RepositoryResult<Option<AmaDischargeEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .find(|d| d.encounter_id == encounter_id)
            .cloned())
    }

    async fn update(&self, discharge: AmaDischargeEntity) -> RepositoryResult<AmaDischargeEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&discharge.id) {
            return Err(RepositoryError::NotFound(format!(
                "AMA discharge {} not found",
                discharge.id
            )));
        }
        data.insert(discharge.id.clone(), discharge.clone());
        Ok(discharge)
    }

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AmaDischargeEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<AmaDischargeEntity> = data.values().cloned().collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.discharge_datetime));
        let total = items.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;
        let page: Vec<AmaDischargeEntity> = items.into_iter().skip(offset).take(limit).collect();
        Ok(PaginatedResult::new(page, total, &pagination))
    }
}
