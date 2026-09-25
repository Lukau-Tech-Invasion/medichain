//! Durable fallback for governance-approved break-glass disclosure auditing.
//!
//! The default policy remains deny. The fallback is usable only when a
//! deployment explicitly selects it and configures a writable durable path.

use crate::repositories::traits::{EmergencyCapsuleAccessEntity, RepositoryError};
use crate::AppState;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const MODE_ENV: &str = "EMERGENCY_AUDIT_AVAILABILITY_MODE";
const DIR_ENV: &str = "EMERGENCY_DEFERRED_AUDIT_DIR";
const MAX_AGE_ENV: &str = "EMERGENCY_DEFERRED_AUDIT_MAX_AGE_SECS";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmergencyAuditMode {
    Deny,
    DurableDefer,
}

impl EmergencyAuditMode {
    pub fn from_env() -> Result<Self, String> {
        // An EMPTY value means the same as an unset one.
        //
        // `unwrap_or_else` alone only covers "the variable does not exist",
        // and a container almost never expresses "not configured" that way: a
        // Compose pass-through written `${VAR:-}` sets the variable to an
        // empty string, which reached `parse` and refused to boot with
        // "must be deny or durable_defer, got ". The API would not start, and
        // the message pointed at a value nobody had written.
        let configured = std::env::var(MODE_ENV).unwrap_or_default();
        if configured.trim().is_empty() {
            return Ok(Self::Deny);
        }
        Self::parse(&configured)
    }

    fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "deny" => Ok(Self::Deny),
            "durable_defer" => Ok(Self::DurableDefer),
            value => Err(format!(
                "{MODE_ENV} must be deny or durable_defer, got {value}"
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeferredEmergencyAudit {
    pub event_id: String,
    pub disclosure: EmergencyCapsuleAccessEntity,
    pub organization_id: String,
    pub facility_id: Option<String>,
    pub device_id: String,
    pub work_context_id: String,
    pub correlation_id: String,
    pub authorization: String,
    pub deferred_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DeferredAuditAcknowledgement {
    event_id: String,
    acknowledged_at: DateTime<Utc>,
}

fn configured_dir() -> Result<PathBuf, String> {
    let value = std::env::var(DIR_ENV)
        .map_err(|_| format!("{DIR_ENV} is required in durable_defer mode"))?;
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(format!("{DIR_ENV} must be an absolute path"));
    }
    Ok(path)
}

fn configured_max_age() -> Result<chrono::Duration, String> {
    let seconds = std::env::var(MAX_AGE_ENV)
        .map_err(|_| format!("{MAX_AGE_ENV} is required in durable_defer mode"))?
        .parse::<i64>()
        .map_err(|_| format!("{MAX_AGE_ENV} must be a positive integer"))?;
    if seconds <= 0 {
        return Err(format!("{MAX_AGE_ENV} must be greater than zero"));
    }
    Ok(chrono::Duration::seconds(seconds))
}

fn pending_path(dir: &Path, event_id: &str) -> PathBuf {
    dir.join(format!("{event_id}.pending.json"))
}

fn acknowledgement_path(dir: &Path, event_id: &str) -> PathBuf {
    dir.join(format!("{event_id}.ack.json"))
}

fn write_new_synced(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("create {}: {error}", path.display()))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("sync {}: {error}", path.display()))
}

fn persist_sync(dir: &Path, event: &DeferredEmergencyAudit) -> Result<(), String> {
    if event.event_id != event.disclosure.id {
        return Err("deferred event id must match the canonical disclosure id".to_string());
    }
    fs::create_dir_all(dir).map_err(|error| format!("create {}: {error}", dir.display()))?;
    let bytes = serde_json::to_vec(event)
        .map_err(|error| format!("serialize deferred emergency audit: {error}"))?;
    write_new_synced(&pending_path(dir, &event.event_id), &bytes)
}

pub async fn persist(event: DeferredEmergencyAudit) -> Result<(), String> {
    let dir = configured_dir()?;
    let max_age = configured_max_age()?;
    tokio::task::spawn_blocking(move || {
        reject_overdue_backlog(&dir, max_age)?;
        persist_sync(&dir, &event)
    })
    .await
    .map_err(|error| format!("deferred audit writer stopped: {error}"))?
}

fn load_pending(dir: &Path) -> Result<Vec<DeferredEmergencyAudit>, String> {
    let mut events = Vec::new();
    if !dir.exists() {
        return Ok(events);
    }
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if !path.to_string_lossy().ends_with(".pending.json") {
            continue;
        }
        let bytes = fs::read(&path).map_err(|error| format!("read {}: {error}", path.display()))?;
        let event = serde_json::from_slice(&bytes)
            .map_err(|error| format!("decode {}: {error}", path.display()))?;
        events.push(event);
    }
    Ok(events)
}

fn acknowledge(dir: &Path, event_id: &str) -> Result<(), String> {
    let acknowledgement = DeferredAuditAcknowledgement {
        event_id: event_id.to_string(),
        acknowledged_at: Utc::now(),
    };
    let evidence = serde_json::to_vec(&acknowledgement).map_err(|error| error.to_string())?;
    match write_new_synced(&acknowledgement_path(dir, event_id), &evidence) {
        Ok(()) => Ok(()),
        Err(_) if is_acknowledged(dir, event_id)? => Ok(()),
        Err(error) => Err(error),
    }
}

fn is_acknowledged(dir: &Path, event_id: &str) -> Result<bool, String> {
    let path = acknowledgement_path(dir, event_id);
    if !path.exists() {
        return Ok(false);
    }
    let bytes = fs::read(&path).map_err(|error| format!("read {}: {error}", path.display()))?;
    let acknowledgement: DeferredAuditAcknowledgement = serde_json::from_slice(&bytes)
        .map_err(|error| format!("decode {}: {error}", path.display()))?;
    Ok(acknowledgement.event_id == event_id)
}

fn reject_overdue_backlog(dir: &Path, max_age: chrono::Duration) -> Result<(), String> {
    let now = Utc::now();
    for event in load_pending(dir)? {
        if is_acknowledged(dir, &event.event_id)? {
            continue;
        }
        if now.signed_duration_since(event.deferred_at) > max_age {
            return Err(format!(
                "deferred emergency audit {} exceeded the configured reconciliation limit",
                event.event_id
            ));
        }
    }
    Ok(())
}

pub async fn replay_pending(data: &AppState) -> Result<usize, String> {
    let dir = configured_dir()?;
    let _ = configured_max_age()?;
    replay_from_dir(data, dir).await
}

async fn replay_from_dir(data: &AppState, dir: PathBuf) -> Result<usize, String> {
    let read_dir = dir.clone();
    let events = tokio::task::spawn_blocking(move || load_pending(&read_dir))
        .await
        .map_err(|error| format!("deferred audit reader stopped: {error}"))??;
    let mut reconciled = 0;
    for event in events {
        if is_acknowledged(&dir, &event.event_id)? {
            continue;
        }
        let result = data
            .repositories
            .emergency_capsules
            .log_access(event.disclosure)
            .await;
        match result {
            Ok(_) | Err(RepositoryError::Duplicate(_)) => {
                let ack_dir = dir.clone();
                let id = event.event_id.clone();
                tokio::task::spawn_blocking(move || acknowledge(&ack_dir, &id))
                    .await
                    .map_err(|error| format!("deferred audit acknowledger stopped: {error}"))??;
                reconciled += 1;
            }
            Err(error) => return Err(format!("deferred audit replay failed: {error}")),
        }
    }
    Ok(reconciled)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("medichain-{name}-{}", uuid::Uuid::new_v4()))
    }

    fn event() -> DeferredEmergencyAudit {
        let event_id = format!("ECA-{}", uuid::Uuid::new_v4());
        DeferredEmergencyAudit {
            event_id: event_id.clone(),
            disclosure: EmergencyCapsuleAccessEntity {
                id: event_id,
                patient_id: "PAT-1".into(),
                capsule_version: Some(2),
                accessed_by: "clinician-1".into(),
                grant_id: Some("grant-1".into()),
                reason_code: "life_threatening".into(),
                reason_text: Some("Emergency treatment".into()),
                fields_revealed: vec!["blood_type".into()],
                commitment_verified: true,
                accessed_at: Utc::now(),
            },
            organization_id: "org-1".into(),
            facility_id: Some("facility-1".into()),
            device_id: "device-1".into(),
            work_context_id: "context-1".into(),
            correlation_id: "correlation-1".into(),
            authorization: "active_professional_context_and_emergency_grant".into(),
            deferred_at: Utc::now(),
        }
    }

    #[test]
    fn durable_file_survives_a_new_reader_and_duplicate_write_is_rejected() {
        let dir = temporary_dir("deferred-audit");
        let audit = event();
        persist_sync(&dir, &audit).unwrap();
        assert_eq!(load_pending(&dir).unwrap()[0].event_id, audit.event_id);
        assert!(persist_sync(&dir, &audit).is_err());
    }

    #[test]
    fn acknowledgement_preserves_the_original_evidence() {
        let dir = temporary_dir("deferred-ack");
        let audit = event();
        persist_sync(&dir, &audit).unwrap();
        acknowledge(&dir, &audit.event_id).unwrap();
        assert!(pending_path(&dir, &audit.event_id).exists());
        assert!(acknowledgement_path(&dir, &audit.event_id).exists());
    }

    #[test]
    fn malformed_acknowledgement_cannot_suppress_replay() {
        let dir = temporary_dir("deferred-bad-ack");
        let audit = event();
        persist_sync(&dir, &audit).unwrap();
        fs::write(acknowledgement_path(&dir, &audit.event_id), b"not-json").unwrap();
        assert!(is_acknowledged(&dir, &audit.event_id).is_err());
    }

    #[test]
    fn policy_mode_is_explicit_and_unknown_values_fail_closed() {
        assert_eq!(
            EmergencyAuditMode::parse("deny").unwrap(),
            EmergencyAuditMode::Deny
        );
        assert_eq!(
            EmergencyAuditMode::parse("durable_defer").unwrap(),
            EmergencyAuditMode::DurableDefer
        );
        assert!(EmergencyAuditMode::parse("warn_and_continue").is_err());
    }

    #[test]
    fn overdue_unacknowledged_backlog_blocks_another_deferred_disclosure() {
        let dir = temporary_dir("deferred-overdue");
        let mut audit = event();
        audit.deferred_at = Utc::now() - chrono::Duration::seconds(61);
        persist_sync(&dir, &audit).unwrap();
        assert!(reject_overdue_backlog(&dir, chrono::Duration::seconds(60)).is_err());
    }

    #[actix_web::test]
    async fn replay_is_idempotent_and_preserves_source_evidence() {
        let dir = temporary_dir("deferred-replay");
        let audit = event();
        persist_sync(&dir, &audit).unwrap();
        let state = AppState::new();

        assert_eq!(replay_from_dir(&state, dir.clone()).await.unwrap(), 1);
        assert_eq!(replay_from_dir(&state, dir.clone()).await.unwrap(), 0);
        let history = state
            .repositories
            .emergency_capsules
            .access_history("PAT-1", 10)
            .await
            .unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, audit.disclosure.id);
        assert!(pending_path(&dir, &audit.event_id).exists());
        assert!(acknowledgement_path(&dir, &audit.event_id).exists());
    }
}
