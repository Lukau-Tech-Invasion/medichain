//! In-memory repositories for shift handoffs.

use async_trait::async_trait;
use chrono::{NaiveDate, Utc};
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// Memory-based shift handoff repository
#[derive(Debug)]
pub struct MemoryShiftHandoffRepository {
    data: RwLock<HashMap<String, ShiftHandoffEntity>>,
}

impl Default for MemoryShiftHandoffRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryShiftHandoffRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl ShiftHandoffRepository for MemoryShiftHandoffRepository {
    async fn create(&self, handoff: ShiftHandoffEntity) -> RepositoryResult<ShiftHandoffEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&handoff.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Shift handoff {} already exists",
                handoff.id
            )));
        }
        data.insert(handoff.id.clone(), handoff.clone());
        Ok(handoff)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ShiftHandoffEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Shift handoff {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<ShiftHandoffEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|h| h.patient_id == patient_id)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.handoff_datetime));
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

    async fn get_by_provider_since(
        &self,
        provider_id: &str,
        since: NaiveDate,
    ) -> RepositoryResult<Vec<ShiftHandoffEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut handoffs: Vec<ShiftHandoffEntity> = data
            .values()
            .filter(|h| {
                (h.outgoing_provider_id == provider_id || h.incoming_provider_id == provider_id)
                    && h.handoff_datetime.date_naive() >= since
            })
            .cloned()
            .collect();
        handoffs.sort_by_key(|h| std::cmp::Reverse(h.handoff_datetime));
        Ok(handoffs)
    }

    async fn get_by_batch(&self, batch_id: &str) -> RepositoryResult<Vec<ShiftHandoffEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let prefix = format!("{batch_id}-");
        let mut items: Vec<_> = data
            .values()
            .filter(|h| h.id.starts_with(&prefix))
            .cloned()
            .collect();
        items.sort_by_key(|h| std::cmp::Reverse(h.handoff_datetime));
        Ok(items)
    }

    async fn acknowledge(&self, id: &str) -> RepositoryResult<ShiftHandoffEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let handoff = data
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Shift handoff {} not found", id)))?;
        if !handoff.acknowledged_by_incoming {
            handoff.updated_at = Utc::now();
        }
        handoff.acknowledged_by_incoming = true;
        handoff.acknowledged_at.get_or_insert_with(Utc::now);
        Ok(handoff.clone())
    }

    async fn get_unacknowledged(
        &self,
        incoming_provider_id: &str,
    ) -> RepositoryResult<Vec<ShiftHandoffEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|h| {
                h.incoming_provider_id == incoming_provider_id && !h.acknowledged_by_incoming
            })
            .cloned()
            .collect())
    }
}
