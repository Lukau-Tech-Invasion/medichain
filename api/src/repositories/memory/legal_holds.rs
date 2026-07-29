//! In-memory legal-hold repository.
//!
//! See `repositories::traits::LegalHoldEntity` for why holds are per-record
//! rather than the policy-level boolean that already existed.

use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::{
    LegalHoldEntity, LegalHoldRepository, RepositoryError, RepositoryResult,
};

#[derive(Debug, Default)]
pub struct MemoryLegalHoldRepository {
    holds: RwLock<HashMap<String, LegalHoldEntity>>,
}

impl MemoryLegalHoldRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl LegalHoldRepository for MemoryLegalHoldRepository {
    async fn create(&self, hold: LegalHoldEntity) -> RepositoryResult<LegalHoldEntity> {
        let mut holds = self
            .holds
            .write()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        holds.insert(hold.id.clone(), hold.clone());
        Ok(hold)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<LegalHoldEntity> {
        let holds = self
            .holds
            .read()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        holds
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Legal hold {} not found", id)))
    }

    async fn get_active(&self) -> RepositoryResult<Vec<LegalHoldEntity>> {
        let holds = self
            .holds
            .read()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        Ok(holds.values().filter(|h| h.is_active()).cloned().collect())
    }

    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<LegalHoldEntity>> {
        let holds = self
            .holds
            .read()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        Ok(holds
            .values()
            .filter(|h| h.patient_id.as_deref() == Some(patient_id))
            .cloned()
            .collect())
    }

    async fn release(
        &self,
        id: &str,
        released_by: &str,
        reason: Option<String>,
    ) -> RepositoryResult<LegalHoldEntity> {
        let mut holds = self
            .holds
            .write()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        let hold = holds
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Legal hold {} not found", id)))?;
        hold.released_by = Some(released_by.to_string());
        hold.released_at = Some(Utc::now());
        hold.release_reason = reason;
        Ok(hold.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hold(id: &str, patient: Option<&str>) -> LegalHoldEntity {
        LegalHoldEntity {
            id: id.to_string(),
            patient_id: patient.map(String::from),
            entity_type: None,
            reason: "litigation".to_string(),
            reference: Some("2026/114".to_string()),
            applied_by: "admin".to_string(),
            applied_at: Utc::now(),
            released_by: None,
            released_at: None,
            release_reason: None,
            created_at: Some(Utc::now()),
        }
    }

    #[tokio::test]
    async fn created_hold_is_active_and_released_hold_is_not() {
        let repo = MemoryLegalHoldRepository::new();
        repo.create(hold("LH-1", Some("PAT-1"))).await.unwrap();

        assert_eq!(repo.get_active().await.unwrap().len(), 1);

        repo.release("LH-1", "admin", Some("matter closed".into()))
            .await
            .unwrap();

        assert!(repo.get_active().await.unwrap().is_empty());
    }

    /// A released hold must remain retrievable — the fact that records were
    /// held between two dates is part of the audit trail, so release is not
    /// deletion.
    #[tokio::test]
    async fn released_hold_is_retained_not_deleted() {
        let repo = MemoryLegalHoldRepository::new();
        repo.create(hold("LH-2", Some("PAT-1"))).await.unwrap();
        repo.release("LH-2", "admin", Some("resolved".into()))
            .await
            .unwrap();

        let stored = repo.get_by_id("LH-2").await.unwrap();
        assert!(!stored.is_active());
        assert_eq!(stored.released_by.as_deref(), Some("admin"));
        assert!(stored.released_at.is_some());
    }

    #[tokio::test]
    async fn holds_filter_by_patient() {
        let repo = MemoryLegalHoldRepository::new();
        repo.create(hold("LH-3", Some("PAT-1"))).await.unwrap();
        repo.create(hold("LH-4", Some("PAT-2"))).await.unwrap();

        let for_patient = repo.get_by_patient("PAT-1").await.unwrap();
        assert_eq!(for_patient.len(), 1);
        assert_eq!(for_patient[0].id, "LH-3");
    }
}
