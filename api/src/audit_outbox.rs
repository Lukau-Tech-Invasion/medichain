//! Privacy-minimised audit events and multi-approver governance decisions.
//!
//! An audit event is a durable row in `audit_events`: an event type, an
//! aggregate identity and a digest of its payload -- ids and digests, never PHI.
//! Nothing here delivers anywhere. The sealing job (`audit_batching`) takes every
//! event into a hash-chained, signed batch, so an event is written once, inside
//! the request's own transaction where there is one, and sealed later.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha3::{Digest, Sha3_256};
use std::collections::HashMap;
use std::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AuditEvent {
    pub id: String,
    pub event_type: String,
    pub aggregate_type: String,
    pub aggregate_id: String,
    pub payload_hash: String,
    pub payload: serde_json::Value,
    pub occurred_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GovernanceStatus {
    Proposed,
    Approved,
    Rejected,
    Executed,
    Cancelled,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GovernanceDecision {
    pub id: String,
    pub decision_type: String,
    pub subject_type: String,
    pub subject_id: String,
    pub proposal_hash: String,
    pub status: GovernanceStatus,
    pub required_approvals: usize,
    pub approved_by: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub executed_at: Option<DateTime<Utc>>,
}

/// The in-process audit store of the memory backend, and the governance
/// decisions of both backends.
pub struct AuditOutbox {
    events: RwLock<HashMap<String, AuditEvent>>,
    decisions: RwLock<HashMap<String, GovernanceDecision>>,
}

impl AuditOutbox {
    pub fn new() -> Self {
        Self {
            events: RwLock::new(HashMap::new()),
            decisions: RwLock::new(HashMap::new()),
        }
    }
    pub fn record(
        &self,
        event_type: String,
        aggregate_type: String,
        aggregate_id: String,
        payload: serde_json::Value,
        now: DateTime<Utc>,
    ) -> Result<AuditEvent, &'static str> {
        let event = Self::prepare_event(event_type, aggregate_type, aggregate_id, payload, now)?;
        self.events
            .write()
            .map_err(|_| "Audit outbox is unavailable")?
            .insert(event.id.clone(), event.clone());
        Ok(event)
    }

    /// Construct an audit event without making it visible or durable. Database
    /// repositories use this before a business mutation so both inserts can
    /// commit in one transaction.
    pub fn prepare_event(
        event_type: String,
        aggregate_type: String,
        aggregate_id: String,
        payload: serde_json::Value,
        now: DateTime<Utc>,
    ) -> Result<AuditEvent, &'static str> {
        if event_type.is_empty() || aggregate_type.is_empty() || aggregate_id.is_empty() {
            return Err("Event type and aggregate identity are required");
        }
        let payload_bytes =
            serde_json::to_vec(&payload).map_err(|_| "Audit payload cannot be serialised")?;
        let payload_hash = format!("{:x}", Sha3_256::digest(payload_bytes));
        let event = AuditEvent {
            id: Uuid::new_v4().to_string(),
            event_type,
            aggregate_type,
            aggregate_id,
            payload_hash,
            payload,
            occurred_at: now,
        };
        Ok(event)
    }

    /// Add a pre-validated event to the in-process memory-backend store. Production
    /// persistence is performed by the repository transaction instead.
    pub fn record_prepared(&self, event: AuditEvent) -> Result<(), &'static str> {
        self.events
            .write()
            .map_err(|_| "Audit outbox is unavailable")?
            .insert(event.id.clone(), event);
        Ok(())
    }

    /// Record locally and, when PostgreSQL is configured, durably persist the
    /// same event before reporting success to a caller.
    pub async fn record_durable(
        &self,
        pool: Option<&sqlx::PgPool>,
        event_type: String,
        aggregate_type: String,
        aggregate_id: String,
        payload: serde_json::Value,
        now: DateTime<Utc>,
    ) -> Result<AuditEvent, String> {
        let event = self
            .record(event_type, aggregate_type, aggregate_id, payload, now)
            .map_err(str::to_string)?;
        let Some(pool) = pool else {
            return Ok(event);
        };
        insert_event(pool, &event)
            .await
            .map_err(|error| error.to_string())?;
        Ok(event)
    }
    /// Every event the in-process store holds (memory backend only; on
    /// PostgreSQL events live in `audit_events`).
    pub fn recorded(&self) -> Vec<AuditEvent> {
        self.events
            .read()
            .map(|events| events.values().cloned().collect())
            .unwrap_or_default()
    }
    pub fn propose(
        &self,
        decision_type: String,
        subject_type: String,
        subject_id: String,
        proposal: &str,
        required_approvals: usize,
        now: DateTime<Utc>,
    ) -> Result<GovernanceDecision, &'static str> {
        if decision_type.is_empty()
            || subject_type.is_empty()
            || subject_id.is_empty()
            || proposal.is_empty()
            || required_approvals == 0
        {
            return Err("Complete proposal metadata and at least one approval are required");
        }
        let decision = GovernanceDecision {
            id: Uuid::new_v4().to_string(),
            decision_type,
            subject_type,
            subject_id,
            proposal_hash: format!("{:x}", Sha3_256::digest(proposal.as_bytes())),
            status: GovernanceStatus::Proposed,
            required_approvals,
            approved_by: Vec::new(),
            created_at: now,
            executed_at: None,
        };
        self.decisions
            .write()
            .map_err(|_| "Governance decision store is unavailable")?
            .insert(decision.id.clone(), decision.clone());
        Ok(decision)
    }
    /// One decision by id, if the in-memory store holds it.
    pub fn decision(&self, id: &str) -> Option<GovernanceDecision> {
        self.decisions.read().ok()?.get(id).cloned()
    }
    pub fn approve(&self, id: &str, approver: String) -> Result<GovernanceDecision, &'static str> {
        let mut decisions = self
            .decisions
            .write()
            .map_err(|_| "Governance decision store is unavailable")?;
        let decision = decisions
            .get_mut(id)
            .ok_or("Governance decision not found")?;
        if decision.status != GovernanceStatus::Proposed {
            return Err("Governance decision is no longer awaiting approval");
        }
        if approver.is_empty() || decision.approved_by.contains(&approver) {
            return Err("Approver must be non-empty and may only approve once");
        }
        decision.approved_by.push(approver);
        if decision.approved_by.len() >= decision.required_approvals {
            decision.status = GovernanceStatus::Approved;
        }
        Ok(decision.clone())
    }
    pub fn execute(
        &self,
        id: &str,
        now: DateTime<Utc>,
    ) -> Result<GovernanceDecision, &'static str> {
        let mut decisions = self
            .decisions
            .write()
            .map_err(|_| "Governance decision store is unavailable")?;
        let decision = decisions
            .get_mut(id)
            .ok_or("Governance decision not found")?;
        if decision.status != GovernanceStatus::Approved {
            return Err("Governance decision requires all approvals before execution");
        }
        decision.status = GovernanceStatus::Executed;
        decision.executed_at = Some(now);
        Ok(decision.clone())
    }
}

impl Default for AuditOutbox {
    fn default() -> Self {
        Self::new()
    }
}

/// Insert one audit event on `executor` -- the pool, or a transaction, so an
/// event can commit with the change it describes.
pub async fn insert_event<'e, E>(executor: E, event: &AuditEvent) -> Result<(), sqlx::Error>
where
    E: sqlx::PgExecutor<'e>,
{
    sqlx::query(
        "INSERT INTO audit_events
            (id, event_type, aggregate_type, aggregate_id, payload_hash, payload, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(&event.id)
    .bind(&event.event_type)
    .bind(&event.aggregate_type)
    .bind(&event.aggregate_id)
    .bind(&event.payload_hash)
    .bind(&event.payload)
    .bind(event.occurred_at)
    .execute(executor)
    .await?;
    Ok(())
}

/// Write one audit event durably. The single path the three commitment writers
/// below share.
async fn write_event(
    data: &crate::AppState,
    event_type: &str,
    aggregate_type: &str,
    aggregate_id: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    data.audit_outbox
        .record_durable(
            data.db_pool.as_ref(),
            event_type.to_string(),
            aggregate_type.to_string(),
            aggregate_id.to_string(),
            payload,
            Utc::now(),
        )
        .await
        .map(|_| ())
}

/// Event type of a published emergency-capsule commitment.
pub const CAPSULE_PUBLISHED_EVENT: &str = "emergency_capsule_published";
/// Event type of a stored medical record's content digest.
pub const RECORD_STORED_EVENT: &str = "medical_record_stored";
/// Event type of a patient registration digest.
pub const PATIENT_REGISTERED_EVENT: &str = "patient_registered";

/// The aggregate id of a capsule version's event: `<patient id>:<version>`.
pub fn capsule_aggregate_id(patient_id: &str, version: i32) -> String {
    format!("{patient_id}:{version}")
}

/// Record that a capsule version's commitment was published. Sealing it is what
/// lets the capsule be verified later against a commitment nobody can edit.
pub async fn record_capsule_published(
    data: &crate::AppState,
    patient_id: &str,
    commitment: &str,
    version: i32,
) -> Result<(), String> {
    if crate::audit_merkle::decode_digest(commitment).is_none() {
        return Err("commitment must be 64 hex characters".to_string());
    }
    write_event(
        data,
        CAPSULE_PUBLISHED_EVENT,
        "emergency_capsule",
        &capsule_aggregate_id(patient_id, version),
        serde_json::json!({
            "patient_id": patient_id,
            "commitment": commitment,
            "version": version
        }),
    )
    .await
}

/// Record that an encrypted medical record was stored, by its content digest
/// (the digest of the encrypted bytes; never the record).
pub async fn record_medical_record_stored(
    data: &crate::AppState,
    record_id: &str,
    content_digest: &str,
) -> Result<(), String> {
    write_event(
        data,
        RECORD_STORED_EVENT,
        "medical_record",
        record_id,
        serde_json::json!({
            "record_id": record_id,
            "content_digest": content_digest
        }),
    )
    .await
}

/// Domain prefix of a registration digest.
const REGISTRATION_DOMAIN: &[u8] = b"medichain.patient.registration.v1\0";

/// The digest a registration is recorded by: the patient id, the hash of the
/// national identifier and the registrar, each length-prefixed. The identifier
/// itself never leaves the patient record.
pub fn registration_digest(
    patient_id: &str,
    national_id_hash: &str,
    registered_by: &str,
) -> String {
    let mut hasher = Sha3_256::new();
    hasher.update(REGISTRATION_DOMAIN);
    for field in [patient_id, national_id_hash, registered_by] {
        hasher.update((field.len() as u32).to_be_bytes());
        hasher.update(field.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

/// Record that a patient was registered, by registration digest.
pub async fn record_patient_registered(
    data: &crate::AppState,
    patient_id: &str,
    registration_digest: &str,
) -> Result<(), String> {
    write_event(
        data,
        PATIENT_REGISTERED_EVENT,
        "patient",
        patient_id,
        serde_json::json!({
            "patient_id": patient_id,
            "registration_digest": registration_digest
        }),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_recorded_event_is_held_with_a_digest_of_its_payload() {
        let outbox = AuditOutbox::new();
        let event = outbox
            .record(
                "emergency_grant_issued".into(),
                "grant".into(),
                "grant-1".into(),
                serde_json::json!({"patient_reference":"opaque"}),
                Utc::now(),
            )
            .unwrap();
        assert_eq!(event.payload_hash.len(), 64);
        assert_eq!(outbox.recorded().len(), 1);
    }
    #[test]
    fn the_registration_digest_binds_all_three_fields_and_their_boundaries() {
        let base = registration_digest("PAT-1", "hash", "dr");
        assert_ne!(base, registration_digest("PAT-2", "hash", "dr"));
        assert_ne!(base, registration_digest("PAT-1", "other", "dr"));
        assert_ne!(base, registration_digest("PAT-1", "hash", "nurse"));
        // "ab"+"c" and "a"+"bc" must not collide.
        assert_ne!(
            registration_digest("ab", "c", "x"),
            registration_digest("a", "bc", "x")
        );
    }
    #[test]
    fn governance_decision_requires_distinct_approvers_before_execution() {
        let outbox = AuditOutbox::new();
        let decision = outbox
            .propose(
                "validator_onboarding".into(),
                "validator".into(),
                "hospital-c".into(),
                "proposal-v1",
                2,
                Utc::now(),
            )
            .unwrap();
        outbox.approve(&decision.id, "operator-a".into()).unwrap();
        assert!(outbox.execute(&decision.id, Utc::now()).is_err());
        outbox.approve(&decision.id, "operator-b".into()).unwrap();
        assert_eq!(
            outbox.execute(&decision.id, Utc::now()).unwrap().status,
            GovernanceStatus::Executed
        );
    }
}
