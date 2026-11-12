//! In-memory repositories for emergency medical services: handoffs, mass-casualty records, chain of custody.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// Memory-based EMS handoff repository
#[derive(Debug)]
pub struct MemoryEmsHandoffRepository {
    data: RwLock<HashMap<String, EmsHandoffEntity>>,
}

impl Default for MemoryEmsHandoffRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryEmsHandoffRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl EmsHandoffRepository for MemoryEmsHandoffRepository {
    async fn create(&self, handoff: EmsHandoffEntity) -> RepositoryResult<EmsHandoffEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&handoff.id) {
            return Err(RepositoryError::Duplicate(format!(
                "EMS handoff {} already exists",
                handoff.id
            )));
        }
        data.insert(handoff.id.clone(), handoff.clone());
        Ok(handoff)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<EmsHandoffEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("EMS handoff {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<EmsHandoffEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let mut items: Vec<_> = data
            .values()
            .filter(|h| h.patient_id.as_deref() == Some(patient_id))
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.arrival_time));
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

    async fn update(&self, handoff: EmsHandoffEntity) -> RepositoryResult<EmsHandoffEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&handoff.id) {
            return Err(RepositoryError::NotFound(format!(
                "EMS handoff {} not found",
                handoff.id
            )));
        }
        data.insert(handoff.id.clone(), handoff.clone());
        Ok(handoff)
    }

    async fn get_recent(&self, hours: i32) -> RepositoryResult<Vec<EmsHandoffEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let cutoff = Utc::now() - chrono::Duration::hours(hours as i64);
        let mut items: Vec<_> = data
            .values()
            .filter(|h| h.arrival_time >= cutoff)
            .cloned()
            .collect();
        items.sort_by_key(|b| std::cmp::Reverse(b.arrival_time));
        Ok(items)
    }

    async fn get_alerts(&self) -> RepositoryResult<Vec<EmsHandoffEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|h| h.trauma_alert || h.stroke_alert || h.stemi_alert || h.sepsis_alert)
            .cloned()
            .collect())
    }
}

/// Memory-based MCI record repository
#[derive(Debug)]
pub struct MemoryMciRecordRepository {
    data: RwLock<HashMap<String, MciRecordEntity>>,
}

impl Default for MemoryMciRecordRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryMciRecordRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl MciRecordRepository for MemoryMciRecordRepository {
    async fn create(&self, record: MciRecordEntity) -> RepositoryResult<MciRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&record.id) {
            return Err(RepositoryError::Duplicate(format!(
                "MCI record {} already exists",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<MciRecordEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("MCI record {} not found", id)))
    }

    async fn get_by_incident(&self, incident_id: &str) -> RepositoryResult<Vec<MciRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.incident_id == incident_id)
            .cloned()
            .collect())
    }

    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<MciRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.patient_id.as_deref() == Some(patient_id))
            .cloned()
            .collect())
    }

    async fn update(&self, record: MciRecordEntity) -> RepositoryResult<MciRecordEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "MCI record {} not found",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_active_incidents(&self) -> RepositoryResult<Vec<MciRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        // Get unique active incidents (disposition is None or not ended)
        let items: Vec<_> = data
            .values()
            .filter(|r| r.disposition.is_none())
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_by_triage_category(
        &self,
        incident_id: &str,
        category: &str,
    ) -> RepositoryResult<Vec<MciRecordEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.incident_id == incident_id && r.triage_category == category)
            .cloned()
            .collect())
    }
}

/// Memory-based chain of custody repository
#[derive(Debug)]
pub struct MemoryChainOfCustodyRepository {
    data: RwLock<HashMap<String, ChainOfCustodyEntity>>,
}

impl Default for MemoryChainOfCustodyRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryChainOfCustodyRepository {
    pub fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl ChainOfCustodyRepository for MemoryChainOfCustodyRepository {
    async fn create(&self, record: ChainOfCustodyEntity) -> RepositoryResult<ChainOfCustodyEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if data.contains_key(&record.id) {
            return Err(RepositoryError::Duplicate(format!(
                "Chain of custody {} already exists",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ChainOfCustodyEntity> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        data.get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Chain of custody {} not found", id)))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
    ) -> RepositoryResult<Vec<ChainOfCustodyEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.patient_id.as_deref() == Some(patient_id))
            .cloned()
            .collect())
    }

    async fn get_by_case(&self, case_number: &str) -> RepositoryResult<Vec<ChainOfCustodyEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.case_number.as_deref() == Some(case_number))
            .cloned()
            .collect())
    }

    async fn update(&self, record: ChainOfCustodyEntity) -> RepositoryResult<ChainOfCustodyEntity> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        if !data.contains_key(&record.id) {
            return Err(RepositoryError::NotFound(format!(
                "Chain of custody {} not found",
                record.id
            )));
        }
        data.insert(record.id.clone(), record.clone());
        Ok(record)
    }

    async fn transfer(
        &self,
        id: &str,
        expected_updated_at: DateTime<Utc>,
        transfer: CustodyTransfer,
    ) -> RepositoryResult<Option<ChainOfCustodyEntity>> {
        let mut data = self
            .data
            .write()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let record = data.get_mut(id).ok_or_else(|| {
            RepositoryError::NotFound(format!("Chain of custody {} not found", id))
        })?;
        if record.updated_at != expected_updated_at {
            return Ok(None);
        }
        let mut transfers = record.transfers.as_array().cloned().unwrap_or_default();
        transfers.push(transfer.entry);
        record.transfers = serde_json::Value::Array(transfers);
        record.current_custodian_id = transfer.new_custodian;
        record.storage_location = Some(transfer.location);
        record.status = transfer.status;
        record.data = transfer.data;
        record.updated_at = Utc::now().max(expected_updated_at + chrono::Duration::microseconds(1));
        Ok(Some(record.clone()))
    }

    async fn get_by_custodian(
        &self,
        custodian_id: &str,
    ) -> RepositoryResult<Vec<ChainOfCustodyEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data
            .values()
            .filter(|r| r.current_custodian_id == custodian_id)
            .cloned()
            .collect())
    }

    async fn list_all(&self) -> RepositoryResult<Vec<ChainOfCustodyEntity>> {
        let data = self
            .data
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        Ok(data.values().cloned().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_chain_of_custody_transfer() {
        let repo = MemoryChainOfCustodyRepository::new();
        let record = ChainOfCustodyEntity {
            id: "coc-001".to_string(),
            current_custodian_id: "nurse-001".to_string(),
            transfers: serde_json::json!([]),
            ..Default::default()
        };

        let created = repo.create(record).await.unwrap();
        let hand_over = || CustodyTransfer {
            new_custodian: "detective-001".to_string(),
            location: "Evidence room".to_string(),
            status: "transferred".to_string(),
            entry: serde_json::json!({ "transferredFrom": "nurse-001", "transferredTo": "detective-001" }),
            data: serde_json::json!({}),
        };
        let transferred = repo
            .transfer("coc-001", created.updated_at, hand_over())
            .await
            .unwrap()
            .expect("an unchanged record accepts the hand-over");
        assert_eq!(transferred.current_custodian_id, "detective-001");
        assert_eq!(transferred.transfers.as_array().unwrap().len(), 1);

        // A second hand-over against the same stale read must not also land.
        assert!(repo
            .transfer("coc-001", created.updated_at, hand_over())
            .await
            .unwrap()
            .is_none());
    }
}
