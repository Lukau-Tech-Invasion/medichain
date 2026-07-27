//! Privacy-minimising telehealth artifact classification, retention, and legal hold.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TelehealthArtifactType {
    Caption,
    ClinicalSummary,
    FullTranscript,
    Recording,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TelehealthRetentionArtifact {
    pub id: String,
    pub session_id: String,
    pub artifact_type: TelehealthArtifactType,
    pub encrypted_content_reference: Option<String>,
    pub content_hash: Option<String>,
    pub model_name: Option<String>,
    pub model_version: Option<String>,
    pub retention_until: Option<DateTime<Utc>>,
    pub legal_hold: bool,
    pub legal_hold_reason: Option<String>,
    pub deleted_at: Option<DateTime<Utc>>,
}

pub struct TelehealthRetentionStore {
    artifacts: RwLock<HashMap<String, TelehealthRetentionArtifact>>,
}

impl TelehealthRetentionStore {
    pub fn new() -> Self {
        Self {
            artifacts: RwLock::new(HashMap::new()),
        }
    }

    /// Register metadata only. Ephemeral live captions deliberately have no retained content reference.
    pub fn register(
        &self,
        session_id: String,
        artifact_type: TelehealthArtifactType,
        encrypted_content_reference: Option<String>,
        content_hash: Option<String>,
        model_name: Option<String>,
        model_version: Option<String>,
        now: DateTime<Utc>,
    ) -> Result<TelehealthRetentionArtifact, &'static str> {
        if session_id.is_empty() {
            return Err("Telehealth session is required");
        }
        if matches!(
            artifact_type,
            TelehealthArtifactType::FullTranscript | TelehealthArtifactType::Recording
        ) && (encrypted_content_reference.is_none() || content_hash.is_none())
        {
            return Err("Sensitive telehealth artifacts require an encrypted reference and tamper-evident hash");
        }
        let retention_until = match artifact_type {
            TelehealthArtifactType::Caption => None,
            TelehealthArtifactType::ClinicalSummary => None,
            TelehealthArtifactType::FullTranscript => Some(now + Duration::days(30)),
            TelehealthArtifactType::Recording => Some(now + Duration::days(30)),
        };
        let artifact = TelehealthRetentionArtifact {
            id: Uuid::new_v4().to_string(),
            session_id,
            artifact_type,
            encrypted_content_reference,
            content_hash,
            model_name,
            model_version,
            retention_until,
            legal_hold: false,
            legal_hold_reason: None,
            deleted_at: None,
        };
        self.artifacts
            .write()
            .map_err(|_| "Telehealth retention store is unavailable")?
            .insert(artifact.id.clone(), artifact.clone());
        Ok(artifact)
    }

    /// Legal hold prevents scheduled deletion and records its explicit reason.
    pub fn apply_legal_hold(
        &self,
        id: &str,
        reason: String,
    ) -> Result<TelehealthRetentionArtifact, &'static str> {
        if reason.trim().is_empty() {
            return Err("A legal-hold reason is required");
        }
        let mut artifacts = self
            .artifacts
            .write()
            .map_err(|_| "Telehealth retention store is unavailable")?;
        let artifact = artifacts
            .get_mut(id)
            .ok_or("Telehealth artifact not found")?;
        if artifact.deleted_at.is_some() {
            return Err("Deleted telehealth artifacts cannot be placed on legal hold");
        }
        artifact.legal_hold = true;
        artifact.legal_hold_reason = Some(reason);
        Ok(artifact.clone())
    }

    /// Return deletable artifacts; a repository job must perform verified encrypted-object deletion.
    pub fn due_for_deletion(&self, now: DateTime<Utc>) -> Vec<TelehealthRetentionArtifact> {
        self.artifacts
            .read()
            .map(|artifacts| {
                artifacts
                    .values()
                    .filter(|artifact| {
                        !artifact.legal_hold
                            && artifact.deleted_at.is_none()
                            && artifact
                                .retention_until
                                .map(|until| until <= now)
                                .unwrap_or(false)
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn mark_deleted(
        &self,
        id: &str,
        now: DateTime<Utc>,
    ) -> Result<TelehealthRetentionArtifact, &'static str> {
        let mut artifacts = self
            .artifacts
            .write()
            .map_err(|_| "Telehealth retention store is unavailable")?;
        let artifact = artifacts
            .get_mut(id)
            .ok_or("Telehealth artifact not found")?;
        if artifact.legal_hold {
            return Err("Telehealth artifact is under legal hold");
        }
        artifact.deleted_at = Some(now);
        artifact.encrypted_content_reference = None;
        Ok(artifact.clone())
    }
}

impl Default for TelehealthRetentionStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sensitive_transcript_needs_encrypted_reference_and_hash() {
        let store = TelehealthRetentionStore::new();
        assert_eq!(
            store
                .register(
                    "session-1".into(),
                    TelehealthArtifactType::FullTranscript,
                    None,
                    None,
                    None,
                    None,
                    Utc::now()
                )
                .unwrap_err(),
            "Sensitive telehealth artifacts require an encrypted reference and tamper-evident hash"
        );
    }
    #[test]
    fn legal_hold_excludes_expired_artifact_from_deletion() {
        let store = TelehealthRetentionStore::new();
        let now = Utc::now();
        let artifact = store
            .register(
                "session-1".into(),
                TelehealthArtifactType::Recording,
                Some("encrypted://recording".into()),
                Some("sha3".into()),
                None,
                None,
                now,
            )
            .unwrap();
        store
            .apply_legal_hold(&artifact.id, "active complaint".into())
            .unwrap();
        assert!(store.due_for_deletion(now + Duration::days(31)).is_empty());
    }
}
