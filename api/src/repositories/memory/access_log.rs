//! In-memory access log repository implementation.

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// In-memory access log repository
#[derive(Debug)]
pub struct MemoryAccessLogRepository {
    storage: RwLock<HashMap<String, AccessLogEntity>>,
    accessor_index: RwLock<HashMap<String, Vec<String>>>,
    patient_index: RwLock<HashMap<String, Vec<String>>>,
}

impl MemoryAccessLogRepository {
    pub fn new() -> Self {
        Self {
            storage: RwLock::new(HashMap::new()),
            accessor_index: RwLock::new(HashMap::new()),
            patient_index: RwLock::new(HashMap::new()),
        }
    }
}

impl Default for MemoryAccessLogRepository {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AccessLogRepository for MemoryAccessLogRepository {
    async fn create(&self, log: AccessLogEntity) -> RepositoryResult<AccessLogEntity> {
        let mut storage = self
            .storage
            .write()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        // Allow duplicate IDs for logs (append-only)
        storage.insert(log.id.clone(), log.clone());

        let mut accessor_index = self
            .accessor_index
            .write()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;
        accessor_index
            .entry(log.accessor_id.clone())
            .or_default()
            .push(log.id.clone());

        if let Some(ref patient_id) = log.patient_id {
            let mut patient_index = self
                .patient_index
                .write()
                .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;
            patient_index
                .entry(patient_id.clone())
                .or_default()
                .push(log.id.clone());
        }

        Ok(log)
    }

    async fn get_by_accessor(
        &self,
        accessor_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AccessLogEntity>> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let accessor_index = self
            .accessor_index
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let mut logs: Vec<AccessLogEntity> = match accessor_index.get(accessor_id) {
            Some(ids) => ids
                .iter()
                .filter_map(|id| storage.get(id).cloned())
                .collect(),
            None => Vec::new(),
        };

        logs.sort_by(|a, b| b.accessed_at.cmp(&a.accessed_at));

        let total = logs.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items: Vec<AccessLogEntity> = logs.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AccessLogEntity>> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let patient_index = self
            .patient_index
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let mut logs: Vec<AccessLogEntity> = match patient_index.get(patient_id) {
            Some(ids) => ids
                .iter()
                .filter_map(|id| storage.get(id).cloned())
                .collect(),
            None => Vec::new(),
        };

        logs.sort_by(|a, b| b.accessed_at.cmp(&a.accessed_at));

        let total = logs.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items: Vec<AccessLogEntity> = logs.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_by_date_range(
        &self,
        range: DateRange,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AccessLogEntity>> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let mut logs: Vec<AccessLogEntity> = storage
            .values()
            .filter(|log| {
                if let Some(from) = range.from {
                    if log.accessed_at < from {
                        return false;
                    }
                }
                if let Some(to) = range.to {
                    if log.accessed_at > to {
                        return false;
                    }
                }
                true
            })
            .cloned()
            .collect();

        logs.sort_by(|a, b| b.accessed_at.cmp(&a.accessed_at));

        let total = logs.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items: Vec<AccessLogEntity> = logs.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_emergency_accesses(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AccessLogEntity>> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let mut logs: Vec<AccessLogEntity> = storage
            .values()
            .filter(|log| log.is_emergency_access)
            .cloned()
            .collect();

        logs.sort_by(|a, b| b.accessed_at.cmp(&a.accessed_at));

        let total = logs.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items: Vec<AccessLogEntity> = logs.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn list(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AccessLogEntity>> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let mut logs: Vec<AccessLogEntity> = storage.values().cloned().collect();

        logs.sort_by(|a, b| b.accessed_at.cmp(&a.accessed_at));

        let total = logs.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items: Vec<AccessLogEntity> = logs.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn search(
        &self,
        query: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<AccessLogEntity>> {
        let storage = self
            .storage
            .read()
            .map_err(|e| RepositoryError::Internal(format!("Lock poisoned: {}", e)))?;

        let query_lower = query.to_lowercase();

        let mut logs: Vec<AccessLogEntity> = storage
            .values()
            .filter(|log| {
                log.accessor_id.to_lowercase().contains(&query_lower)
                    || log.resource_type.to_lowercase().contains(&query_lower)
                    || log.action.to_lowercase().contains(&query_lower)
                    || log
                        .access_reason
                        .as_ref()
                        .map(|r| r.to_lowercase().contains(&query_lower))
                        .unwrap_or(false)
            })
            .cloned()
            .collect();

        logs.sort_by(|a, b| b.accessed_at.cmp(&a.accessed_at));

        let total = logs.len() as u64;
        let offset = pagination.offset() as usize;
        let limit = pagination.limit() as usize;

        let items: Vec<AccessLogEntity> = logs.into_iter().skip(offset).take(limit).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn create_test_log(
        id: &str,
        accessor_id: &str,
        patient_id: Option<&str>,
        emergency: bool,
    ) -> AccessLogEntity {
        AccessLogEntity {
            id: id.to_string(),
            accessor_id: accessor_id.to_string(),
            accessor_role: "Doctor".to_string(),
            patient_id: patient_id.map(|s| s.to_string()),
            resource_type: "medical_record".to_string(),
            resource_id: Some("REC-001".to_string()),
            action: "View".to_string(),
            access_reason: Some("Routine care".to_string()),
            is_emergency_access: emergency,
            ip_address: Some("192.168.1.1".to_string()),
            user_agent: Some("MediChain/1.0".to_string()),
            blockchain_tx_hash: None,
            accessed_at: Utc::now(),
            facility_id: None,
        }
    }

    #[tokio::test]
    async fn test_create_and_get() {
        let repo = MemoryAccessLogRepository::new();
        let log = create_test_log("LOG-001", "DOC-001", Some("PAT-001"), false);

        let created = repo.create(log).await.unwrap();
        assert_eq!(created.id, "LOG-001");
    }

    #[tokio::test]
    async fn test_get_emergency_accesses() {
        let repo = MemoryAccessLogRepository::new();

        repo.create(create_test_log(
            "LOG-001",
            "DOC-001",
            Some("PAT-001"),
            false,
        ))
        .await
        .unwrap();
        repo.create(create_test_log("LOG-002", "DOC-001", Some("PAT-002"), true))
            .await
            .unwrap();
        repo.create(create_test_log("LOG-003", "DOC-002", Some("PAT-003"), true))
            .await
            .unwrap();

        let emergency = repo
            .get_emergency_accesses(Pagination::new(0, 10))
            .await
            .unwrap();
        assert_eq!(emergency.total, 2);
    }

    #[tokio::test]
    async fn test_get_by_patient() {
        let repo = MemoryAccessLogRepository::new();

        repo.create(create_test_log(
            "LOG-001",
            "DOC-001",
            Some("PAT-001"),
            false,
        ))
        .await
        .unwrap();
        repo.create(create_test_log(
            "LOG-002",
            "DOC-002",
            Some("PAT-001"),
            false,
        ))
        .await
        .unwrap();
        repo.create(create_test_log(
            "LOG-003",
            "DOC-001",
            Some("PAT-002"),
            false,
        ))
        .await
        .unwrap();

        let logs = repo
            .get_by_patient("PAT-001", Pagination::new(0, 10))
            .await
            .unwrap();
        assert_eq!(logs.total, 2);
    }
}
