//! In-memory emergency capsule repository (Horizon HZ-003).
//!
//! See `repositories::traits::EmergencyCapsuleRepository` for why capsules are
//! append-only and revocable rather than mutable.

use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::{
    EmergencyCapsuleAccessEntity, EmergencyCapsuleEntity, EmergencyCapsuleRepository,
    RepositoryError, RepositoryResult,
};

#[derive(Debug, Default)]
pub struct MemoryEmergencyCapsuleRepository {
    /// patient_id -> versions, kept sorted ascending by version.
    capsules: RwLock<HashMap<String, Vec<EmergencyCapsuleEntity>>>,
    accesses: RwLock<Vec<EmergencyCapsuleAccessEntity>>,
}

impl MemoryEmergencyCapsuleRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl EmergencyCapsuleRepository for MemoryEmergencyCapsuleRepository {
    async fn put(
        &self,
        capsule: EmergencyCapsuleEntity,
    ) -> RepositoryResult<EmergencyCapsuleEntity> {
        let mut capsules = self
            .capsules
            .write()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        let versions = capsules.entry(capsule.patient_id.clone()).or_default();

        // Mirrors the pallet's rule. Without this the off-chain store would
        // accept a stale capsule the chain would reject, and the two would
        // silently disagree about which version is current.
        if let Some(newest) = versions.last() {
            if capsule.version <= newest.version {
                return Err(RepositoryError::Validation(format!(
                    "capsule version {} is not newer than stored version {}",
                    capsule.version, newest.version
                )));
            }
        }

        versions.push(capsule.clone());
        Ok(capsule)
    }

    async fn current(&self, patient_id: &str) -> RepositoryResult<Option<EmergencyCapsuleEntity>> {
        let capsules = self
            .capsules
            .read()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        Ok(capsules
            .get(patient_id)
            .and_then(|versions| versions.iter().rev().find(|c| c.is_live()).cloned()))
    }

    async fn latest_version(&self, patient_id: &str) -> RepositoryResult<i32> {
        let capsules = self
            .capsules
            .read()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        Ok(capsules
            .get(patient_id)
            .and_then(|versions| versions.last())
            .map(|c| c.version)
            .unwrap_or(0))
    }

    async fn history(&self, patient_id: &str) -> RepositoryResult<Vec<EmergencyCapsuleEntity>> {
        let capsules = self
            .capsules
            .read()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        Ok(capsules
            .get(patient_id)
            .map(|versions| versions.iter().rev().cloned().collect())
            .unwrap_or_default())
    }

    async fn revoke(
        &self,
        patient_id: &str,
        version: i32,
        revoked_by: &str,
        reason: Option<String>,
    ) -> RepositoryResult<EmergencyCapsuleEntity> {
        let mut capsules = self
            .capsules
            .write()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        let capsule = capsules
            .get_mut(patient_id)
            .and_then(|versions| versions.iter_mut().find(|c| c.version == version))
            .ok_or_else(|| {
                RepositoryError::NotFound(format!(
                    "Emergency capsule {}/v{} not found",
                    patient_id, version
                ))
            })?;

        // Revocation is idempotent in the safe direction: a second revoke must
        // not overwrite who first revoked it or when. Mirrors the Postgres
        // implementation's `AND revoked_at IS NULL` guard — without this the
        // two backends disagree, and the in-memory one quietly destroys the
        // original revocation's attribution.
        if capsule.revoked_at.is_some() {
            return Err(RepositoryError::NotFound(format!(
                "Emergency capsule {}/v{} not found or already revoked",
                patient_id, version
            )));
        }

        capsule.revoked_at = Some(Utc::now());
        capsule.revoked_by = Some(revoked_by.to_string());
        capsule.revocation_reason = reason;
        Ok(capsule.clone())
    }

    async fn record_chain_result(
        &self,
        patient_id: &str,
        version: i32,
        tx_hash: &str,
        finalized: bool,
    ) -> RepositoryResult<()> {
        let mut capsules = self
            .capsules
            .write()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        let capsule = capsules
            .get_mut(patient_id)
            .and_then(|versions| versions.iter_mut().find(|c| c.version == version))
            .ok_or_else(|| {
                RepositoryError::NotFound(format!(
                    "Emergency capsule {}/v{} not found",
                    patient_id, version
                ))
            })?;

        capsule.chain_tx_hash = Some(tx_hash.to_string());
        capsule.chain_finalized = finalized;
        Ok(())
    }

    async fn log_access(
        &self,
        access: EmergencyCapsuleAccessEntity,
    ) -> RepositoryResult<EmergencyCapsuleAccessEntity> {
        let mut accesses = self
            .accesses
            .write()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        accesses.push(access.clone());
        Ok(access)
    }

    async fn access_history(
        &self,
        patient_id: &str,
        limit: i64,
    ) -> RepositoryResult<Vec<EmergencyCapsuleAccessEntity>> {
        let accesses = self
            .accesses
            .read()
            .map_err(|e| RepositoryError::Database(e.to_string()))?;
        Ok(accesses
            .iter()
            .rev()
            .filter(|a| a.patient_id == patient_id)
            .take(limit.max(0) as usize)
            .cloned()
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn capsule(patient: &str, version: i32) -> EmergencyCapsuleEntity {
        EmergencyCapsuleEntity {
            patient_id: patient.to_string(),
            version,
            commitment: format!("{:064x}", version),
            capsule_encrypted: vec![1, 2, 3],
            key_version: 1,
            created_by: "DR-1".to_string(),
            created_at: Utc::now(),
            revoked_at: None,
            revoked_by: None,
            revocation_reason: None,
            chain_tx_hash: None,
            chain_finalized: false,
        }
    }

    #[tokio::test]
    async fn current_returns_newest_version() {
        let repo = MemoryEmergencyCapsuleRepository::new();
        repo.put(capsule("PAT-1", 1)).await.unwrap();
        repo.put(capsule("PAT-1", 2)).await.unwrap();

        let current = repo.current("PAT-1").await.unwrap().unwrap();
        assert_eq!(current.version, 2);
    }

    /// The pallet rejects a non-increasing version; the off-chain store must
    /// too, or the two disagree about which capsule is current.
    #[tokio::test]
    async fn stale_version_is_rejected() {
        let repo = MemoryEmergencyCapsuleRepository::new();
        repo.put(capsule("PAT-1", 2)).await.unwrap();

        assert!(repo.put(capsule("PAT-1", 2)).await.is_err());
        assert!(repo.put(capsule("PAT-1", 1)).await.is_err());
    }

    /// A revoked directive must not read as current, but must remain
    /// retrievable — "a DNR was in force until this date" is clinically and
    /// legally significant.
    #[tokio::test]
    async fn revoked_capsule_is_not_current_but_is_retained() {
        let repo = MemoryEmergencyCapsuleRepository::new();
        repo.put(capsule("PAT-1", 1)).await.unwrap();
        repo.revoke("PAT-1", 1, "DR-9", Some("directive withdrawn".into()))
            .await
            .unwrap();

        assert!(repo.current("PAT-1").await.unwrap().is_none());

        let history = repo.history("PAT-1").await.unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].revoked_by.as_deref(), Some("DR-9"));
    }

    /// Revoking the newest version must fall back to nothing rather than
    /// silently resurrecting an older capsule the clinician believed replaced.
    #[tokio::test]
    async fn revoking_newest_does_not_resurrect_older_version() {
        let repo = MemoryEmergencyCapsuleRepository::new();
        repo.put(capsule("PAT-1", 1)).await.unwrap();
        repo.put(capsule("PAT-1", 2)).await.unwrap();
        repo.revoke("PAT-1", 2, "DR-9", None).await.unwrap();

        let current = repo.current("PAT-1").await.unwrap();
        assert_eq!(current.map(|c| c.version), Some(1));
    }

    /// Re-revoking must not overwrite the original revocation's attribution.
    ///
    /// Found by exercising the live endpoint with synthetic data on
    /// 2026-07-29: the Postgres backend refused the second revoke (its UPDATE
    /// carries `AND revoked_at IS NULL`) while this one accepted it and
    /// rewrote `revoked_by`/`revoked_at`. The earlier single-revoke test could
    /// not see the divergence.
    #[tokio::test]
    async fn revoking_twice_is_refused_and_preserves_the_first_revocation() {
        let repo = MemoryEmergencyCapsuleRepository::new();
        repo.put(capsule("PAT-1", 1)).await.unwrap();

        let first = repo
            .revoke("PAT-1", 1, "DR-FIRST", Some("original reason".into()))
            .await
            .unwrap();

        assert!(repo.revoke("PAT-1", 1, "DR-SECOND", None).await.is_err());

        let stored = repo.history("PAT-1").await.unwrap();
        assert_eq!(stored[0].revoked_by.as_deref(), Some("DR-FIRST"));
        assert_eq!(stored[0].revoked_at, first.revoked_at);
        assert_eq!(
            stored[0].revocation_reason.as_deref(),
            Some("original reason")
        );
    }

    /// A revoked version number must never be reissued — otherwise two
    /// different capsules would share a version, and the on-chain commitment
    /// could not distinguish them.
    #[tokio::test]
    async fn latest_version_counts_revoked_versions() {
        let repo = MemoryEmergencyCapsuleRepository::new();
        repo.put(capsule("PAT-1", 1)).await.unwrap();
        repo.revoke("PAT-1", 1, "DR-9", None).await.unwrap();

        assert_eq!(repo.latest_version("PAT-1").await.unwrap(), 1);
    }

    #[tokio::test]
    async fn access_log_is_scoped_per_patient() {
        let repo = MemoryEmergencyCapsuleRepository::new();
        for patient in ["PAT-1", "PAT-2"] {
            repo.log_access(EmergencyCapsuleAccessEntity {
                id: format!("ACC-{patient}"),
                patient_id: patient.to_string(),
                capsule_version: Some(1),
                accessed_by: "PARAMEDIC-1".to_string(),
                grant_id: Some("GRANT-1".to_string()),
                reason_code: "cardiac_arrest".to_string(),
                reason_text: None,
                fields_revealed: vec!["blood_type".to_string()],
                commitment_verified: true,
                accessed_at: Utc::now(),
            })
            .await
            .unwrap();
        }

        let history = repo.access_history("PAT-1", 10).await.unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].patient_id, "PAT-1");
    }
}
