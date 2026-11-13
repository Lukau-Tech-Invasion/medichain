//! In-memory repositories for consent records.

use super::lock_poisoned;
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// In-memory consent record repository
#[derive(Debug, Default)]
pub struct MemoryConsentRecordRepository {
    records: RwLock<HashMap<String, ConsentRecordEntity>>,
}

impl MemoryConsentRecordRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl ConsentRecordRepository for MemoryConsentRecordRepository {
    async fn create(&self, consent: ConsentRecordEntity) -> RepositoryResult<ConsentRecordEntity> {
        let mut records = self.records.write().map_err(lock_poisoned)?;
        records.insert(consent.id.clone(), consent.clone());
        Ok(consent)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<ConsentRecordEntity> {
        let records = self.records.read().map_err(lock_poisoned)?;
        records
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("Consent {} not found", id)))
    }

    async fn get_by_patient(&self, patient_id: &str) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let records = self.records.read().map_err(lock_poisoned)?;
        let items: Vec<_> = records
            .values()
            .filter(|r| r.patient_id == patient_id)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn get_active_by_type(
        &self,
        patient_id: &str,
        consent_type: &str,
    ) -> RepositoryResult<Option<ConsentRecordEntity>> {
        let now = chrono::Utc::now();
        let records = self.records.read().map_err(lock_poisoned)?;
        Ok(records
            .values()
            .find(|r| {
                r.patient_id == patient_id
                    && r.consent_type == consent_type
                    && !r.revoked.unwrap_or(false)
                    && r.expiration_datetime.map(|e| e > now).unwrap_or(true)
            })
            .cloned())
    }

    async fn get_active(&self, patient_id: &str) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let now = chrono::Utc::now();
        let records = self.records.read().map_err(lock_poisoned)?;
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                r.patient_id == patient_id
                    && !r.revoked.unwrap_or(false)
                    && r.expiration_datetime.map(|e| e > now).unwrap_or(true)
            })
            .cloned()
            .collect();
        Ok(items)
    }

    async fn update(&self, consent: ConsentRecordEntity) -> RepositoryResult<ConsentRecordEntity> {
        let mut records = self.records.write().map_err(lock_poisoned)?;
        if !records.contains_key(&consent.id) {
            return Err(RepositoryError::NotFound(format!(
                "Consent {} not found",
                consent.id
            )));
        }
        records.insert(consent.id.clone(), consent.clone());
        Ok(consent)
    }

    async fn revoke(
        &self,
        id: &str,
        revoked_by: &str,
        reason: Option<&str>,
    ) -> RepositoryResult<ConsentRecordEntity> {
        let mut records = self.records.write().map_err(lock_poisoned)?;
        let consent = records
            .get_mut(id)
            .ok_or_else(|| RepositoryError::NotFound(format!("Consent {} not found", id)))?;
        if consent.revoked.unwrap_or(false) {
            return Err(RepositoryError::Validation(format!(
                "Consent {} is already revoked",
                id
            )));
        }
        consent.revoked = Some(true);
        consent.revoked_by = Some(revoked_by.to_string());
        consent.revocation_reason = reason.map(|r| r.to_string());
        consent.revoked_datetime = Some(chrono::Utc::now());
        // Both the authoritative status and its legacy boolean projection move
        // together. This backend previously left `consent_given` true on a
        // revoked record, diverging from the Postgres implementation, which
        // clears it — a revoked consent that still reads as "given" is exactly
        // the kind of disagreement between backends that makes a consent audit
        // untrustworthy.
        consent.consent_given = false;
        consent.consent_status = crate::types::ConsentStatus::Withdrawn.as_str().to_string();
        Ok(consent.clone())
    }

    async fn get_by_type(
        &self,
        patient_id: &str,
        consent_type: &str,
    ) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let records = self.records.read().map_err(lock_poisoned)?;
        let items: Vec<_> = records
            .values()
            .filter(|r| r.patient_id == patient_id && r.consent_type == consent_type)
            .cloned()
            .collect();
        Ok(items)
    }

    async fn check_consent(
        &self,
        patient_id: &str,
        consent_type: &str,
        purpose: &str,
    ) -> RepositoryResult<bool> {
        let records = self.records.read().map_err(lock_poisoned)?;
        let has_consent = records.values().any(|r| {
            r.patient_id == patient_id
                && r.consent_type == consent_type
                && r.purpose.as_deref() == Some(purpose)
                && !r.revoked.unwrap_or(false)
        });
        Ok(has_consent)
    }

    async fn get_expiring_soon(&self, days: i32) -> RepositoryResult<Vec<ConsentRecordEntity>> {
        let now = chrono::Utc::now();
        let cutoff = now + chrono::Duration::days(days as i64);
        let records = self.records.read().map_err(lock_poisoned)?;
        let items: Vec<_> = records
            .values()
            .filter(|r| {
                !r.revoked.unwrap_or(false)
                    && r.expiration_datetime
                        .map(|e| e > now && e <= cutoff)
                        .unwrap_or(false)
            })
            .cloned()
            .collect();
        Ok(items)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_consent_active() {
        let repo = MemoryConsentRecordRepository::new();

        let consent = ConsentRecordEntity {
            id: "CON-001".to_string(),
            patient_id: "PAT-001".to_string(),
            consent_type: "hipaa_notice".to_string(),
            consent_given: true,
            // Must agree with `consent_given`, which is a derived projection of
            // this field rather than an independent value.
            consent_status: crate::types::ConsentStatus::Granted.as_str().to_string(),
            consent_datetime: chrono::Utc::now(),
            revoked: Some(false),
            ..Default::default()
        };

        repo.create(consent).await.unwrap();

        let active = repo
            .get_active_by_type("PAT-001", "hipaa_notice")
            .await
            .unwrap();
        assert!(active.is_some());
    }

    #[tokio::test]
    async fn consent_revocation_is_one_time_and_updates_status() {
        let repo = MemoryConsentRecordRepository::new();
        let consent = ConsentRecordEntity {
            id: "CON-REVOKE-001".to_string(),
            patient_id: "PAT-001".to_string(),
            consent_type: "treatment".to_string(),
            consent_given: true,
            consent_status: crate::types::ConsentStatus::Granted.as_str().to_string(),
            consent_datetime: chrono::Utc::now(),
            revoked: Some(false),
            ..Default::default()
        };
        repo.create(consent).await.unwrap();

        let revoked = repo
            .revoke("CON-REVOKE-001", "guardian-user_id", Some("withdrawn"))
            .await
            .unwrap();
        assert!(!revoked.consent_given);
        assert_eq!(
            revoked.consent_status,
            crate::types::ConsentStatus::Withdrawn.as_str()
        );
        assert!(repo
            .revoke("CON-REVOKE-001", "guardian-user_id", None)
            .await
            .is_err());
    }
}
