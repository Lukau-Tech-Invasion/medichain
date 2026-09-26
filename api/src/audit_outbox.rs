//! Privacy-minimised audit outbox and multi-approver governance decisions.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha3::{Digest, Sha3_256};
use std::collections::HashMap;
use std::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AuditOutboxEvent {
    pub id: String,
    pub event_type: String,
    pub aggregate_type: String,
    pub aggregate_id: String,
    pub payload_hash: String,
    pub payload: serde_json::Value,
    pub occurred_at: DateTime<Utc>,
    pub delivered_at: Option<DateTime<Utc>>,
    pub delivery_attempts: u32,
    pub last_error: Option<String>,
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

pub struct AuditOutbox {
    events: RwLock<HashMap<String, AuditOutboxEvent>>,
    decisions: RwLock<HashMap<String, GovernanceDecision>>,
}

/// Result of an attempted chain anchor. `pending` means a durable outbox row
/// exists; it never means that a best-effort background task was merely spawned.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ChainAnchorOutcome {
    pub status: String,
    pub transaction_hash: Option<String>,
}

impl ChainAnchorOutcome {
    fn disabled() -> Self {
        Self {
            status: "disabled".to_string(),
            transaction_hash: None,
        }
    }

    fn pending() -> Self {
        Self {
            status: "pending".to_string(),
            transaction_hash: None,
        }
    }
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
    ) -> Result<AuditOutboxEvent, &'static str> {
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
    ) -> Result<AuditOutboxEvent, &'static str> {
        if event_type.is_empty() || aggregate_type.is_empty() || aggregate_id.is_empty() {
            return Err("Event type and aggregate identity are required");
        }
        let payload_bytes =
            serde_json::to_vec(&payload).map_err(|_| "Audit payload cannot be serialised")?;
        let payload_hash = format!("{:x}", Sha3_256::digest(payload_bytes));
        let event = AuditOutboxEvent {
            id: Uuid::new_v4().to_string(),
            event_type,
            aggregate_type,
            aggregate_id,
            payload_hash,
            payload,
            occurred_at: now,
            delivered_at: None,
            delivery_attempts: 0,
            last_error: None,
        };
        Ok(event)
    }

    /// Add a pre-validated event to the in-process demo queue. Production
    /// persistence is performed by the repository transaction instead.
    pub fn record_prepared(&self, event: AuditOutboxEvent) -> Result<(), &'static str> {
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
    ) -> Result<AuditOutboxEvent, String> {
        let event = self
            .record(event_type, aggregate_type, aggregate_id, payload, now)
            .map_err(str::to_string)?;
        let Some(pool) = pool else {
            return Ok(event);
        };
        sqlx::query(
            "INSERT INTO audit_outbox_events (
                id, event_type, aggregate_type, aggregate_id, payload_hash,
                payload, occurred_at, delivered_at, delivery_attempts, last_error
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(&event.id)
        .bind(&event.event_type)
        .bind(&event.aggregate_type)
        .bind(&event.aggregate_id)
        .bind(&event.payload_hash)
        .bind(&event.payload)
        .bind(event.occurred_at)
        .bind(event.delivered_at)
        .bind(
            i32::try_from(event.delivery_attempts)
                .map_err(|_| "delivery attempt count exceeds PostgreSQL INTEGER".to_string())?,
        )
        .bind(&event.last_error)
        .execute(pool)
        .await
        .map_err(|error| error.to_string())?;
        Ok(event)
    }
    pub fn pending(&self) -> Vec<AuditOutboxEvent> {
        self.events
            .read()
            .map(|events| {
                events
                    .values()
                    .filter(|event| event.delivered_at.is_none())
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }
    pub fn mark_delivered(
        &self,
        id: &str,
        now: DateTime<Utc>,
    ) -> Result<AuditOutboxEvent, &'static str> {
        let mut events = self
            .events
            .write()
            .map_err(|_| "Audit outbox is unavailable")?;
        let event = events.get_mut(id).ok_or("Audit event not found")?;
        event.delivery_attempts += 1;
        event.delivered_at = Some(now);
        event.last_error = None;
        Ok(event.clone())
    }
    pub fn mark_failed(&self, id: &str, error: String) -> Result<AuditOutboxEvent, &'static str> {
        let mut events = self
            .events
            .write()
            .map_err(|_| "Audit outbox is unavailable")?;
        let event = events.get_mut(id).ok_or("Audit event not found")?;
        event.delivery_attempts += 1;
        event.last_error = Some(error);
        Ok(event.clone())
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

async fn queue_chain_operation(
    data: &crate::AppState,
    event_type: &str,
    aggregate_type: &str,
    aggregate_id: &str,
    payload: serde_json::Value,
) -> Result<ChainAnchorOutcome, String> {
    data.audit_outbox
        .record_durable(
            data.db_pool.as_ref(),
            event_type.to_string(),
            aggregate_type.to_string(),
            aggregate_id.to_string(),
            payload,
            Utc::now(),
        )
        .await?;
    Ok(ChainAnchorOutcome::pending())
}

/// Refuse an argument the chain would reject, before it is queued: a queued
/// operation that can never succeed would retry forever.
fn require_ss58(account: &str) -> Result<(), String> {
    account
        .parse::<sp_core::crypto::AccountId32>()
        .map(|_| ())
        .map_err(|_| "patient wallet is not SS58".to_string())
}

/// Durably queue an access audit anchor. Never awaits the chain: the outbox
/// worker submits it and records the result only from a finalized block.
///
/// Since WP8 ordinary reads are anchored in Merkle batches instead
/// (`audit_batching`); this per-event anchor is kept for emergency and
/// break-glass access and for consent acts.
pub async fn anchor_access_or_queue(
    data: &crate::AppState,
    aggregate_type: &str,
    aggregate_id: &str,
    patient_account: &str,
    accessor_id: &str,
    access_type: &str,
) -> Result<ChainAnchorOutcome, String> {
    if !crate::blockchain::blockchain_enabled() {
        return Ok(ChainAnchorOutcome::disabled());
    }
    require_ss58(patient_account)?;
    queue_chain_operation(
        data,
        "chain_access_anchor",
        aggregate_type,
        aggregate_id,
        serde_json::json!({
            "patient_account": patient_account,
            "audit_event_id": aggregate_id,
            "accessor_id": accessor_id,
            "access_type": access_type
        }),
    )
    .await
}

/// Durably queue a patient registration for the chain (never awaited).
pub async fn anchor_patient_registration_or_queue(
    data: &crate::AppState,
    patient_id: &str,
    patient_account: &str,
    id_hash: &str,
    id_type: &str,
    registered_by: &str,
) -> Result<ChainAnchorOutcome, String> {
    if !crate::blockchain::blockchain_enabled() {
        return Ok(ChainAnchorOutcome::disabled());
    }
    require_ss58(patient_account)?;
    queue_chain_operation(
        data,
        "patient_registration_chain_anchor",
        "patient",
        patient_id,
        serde_json::json!({
            "patient_account": patient_account,
            "id_hash": id_hash,
            "id_type": id_type,
            "registered_by": registered_by
        }),
    )
    .await
}

/// Durably queue an IPFS record anchor for the chain (never awaited).
pub async fn anchor_medical_record_or_queue(
    data: &crate::AppState,
    record_id: &str,
    patient_account: &str,
    ipfs_hash: &str,
    record_type: &str,
    uploaded_by: &str,
) -> Result<ChainAnchorOutcome, String> {
    if !crate::blockchain::blockchain_enabled() {
        return Ok(ChainAnchorOutcome::disabled());
    }
    require_ss58(patient_account)?;
    queue_chain_operation(
        data,
        "medical_record_chain_anchor",
        "medical_record",
        record_id,
        serde_json::json!({
            "patient_account": patient_account,
            "ipfs_hash": ipfs_hash,
            "record_type": record_type,
            "uploaded_by": uploaded_by
        }),
    )
    .await
}

/// Durably queue an emergency-capsule commitment for the chain (never awaited).
pub async fn anchor_capsule_or_queue(
    data: &crate::AppState,
    patient_id: &str,
    patient_account: &str,
    commitment: &str,
    version: i32,
) -> Result<ChainAnchorOutcome, String> {
    if !crate::blockchain::blockchain_enabled() {
        return Ok(ChainAnchorOutcome::disabled());
    }
    u32::try_from(version).map_err(|_| "capsule version must be non-negative".to_string())?;
    require_ss58(patient_account)?;
    if crate::audit_merkle::decode_digest(commitment).is_none() {
        return Err("commitment must be 64 hex characters".to_string());
    }
    queue_chain_operation(
        data,
        "emergency_capsule_chain_anchor",
        "emergency_capsule",
        &format!("{patient_id}:{version}"),
        serde_json::json!({
            "patient_id": patient_id,
            "patient_account": patient_account,
            "commitment": commitment,
            "version": version
        }),
    )
    .await
}

async fn submit_queued_chain_operation(
    client: &crate::blockchain::SubstrateClient,
    event_type: &str,
    aggregate_id: &str,
    payload: &serde_json::Value,
) -> Result<crate::blockchain::ChainTxResult, crate::blockchain::BlockchainError> {
    let required = |name: &str| {
        payload
            .get(name)
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                crate::blockchain::BlockchainError::InvalidArgument(format!(
                    "outbox payload is missing {name}"
                ))
            })
    };
    match event_type {
        "chain_access_anchor" | "consent_chain_anchor" => {
            client
                .log_access_on_chain(
                    payload
                        .get("audit_event_id")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or(aggregate_id),
                    required("accessor_id")?,
                    required("patient_account")?,
                    required("access_type")?,
                )
                .await
        }
        "patient_registration_chain_anchor" => {
            client
                .register_patient_on_chain(
                    required("patient_account")?,
                    required("id_hash")?,
                    required("id_type")?,
                    required("registered_by")?,
                )
                .await
        }
        "medical_record_chain_anchor" => {
            client
                .record_ipfs_hash_on_chain(
                    required("patient_account")?,
                    required("ipfs_hash")?,
                    required("record_type")?,
                    required("uploaded_by")?,
                )
                .await
        }
        "emergency_capsule_chain_anchor" => {
            let version = payload
                .get("version")
                .and_then(serde_json::Value::as_i64)
                .and_then(|value| u32::try_from(value).ok())
                .ok_or_else(|| {
                    crate::blockchain::BlockchainError::InvalidArgument(
                        "outbox payload has an invalid capsule version".into(),
                    )
                })?;
            client
                .set_emergency_capsule_commitment_on_chain(
                    required("patient_account")?,
                    required("commitment")?,
                    version,
                )
                .await
        }
        crate::audit_batching::AUDIT_BATCH_EVENT => submit_batch_anchor(client, payload).await,
        other => Err(crate::blockchain::BlockchainError::InvalidArgument(
            format!("unsupported chain outbox event type: {other}"),
        )),
    }
}

/// Submit a queued Merkle batch root (WP8).
async fn submit_batch_anchor(
    client: &crate::blockchain::SubstrateClient,
    payload: &serde_json::Value,
) -> Result<crate::blockchain::ChainTxResult, crate::blockchain::BlockchainError> {
    let invalid = |name: &str| {
        crate::blockchain::BlockchainError::InvalidArgument(format!(
            "batch outbox payload has an invalid {name}"
        ))
    };
    let number = |name: &str| payload.get(name).and_then(serde_json::Value::as_i64);
    let root = payload
        .get("merkle_root")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| invalid("merkle_root"))?;
    let first = number("first_seq").and_then(|v| u64::try_from(v).ok());
    let last = number("last_seq").and_then(|v| u64::try_from(v).ok());
    let count = number("leaf_count").and_then(|v| u32::try_from(v).ok());
    client
        .anchor_audit_batch_on_chain(
            root,
            first.ok_or_else(|| invalid("first_seq"))?,
            last.ok_or_else(|| invalid("last_seq"))?,
            count.ok_or_else(|| invalid("leaf_count"))?,
        )
        .await
}

async fn record_queued_chain_success(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    event_type: &str,
    payload: &serde_json::Value,
    transaction_hash: &str,
) -> Result<(), String> {
    if event_type == "chain_access_anchor" {
        return record_access_anchor_success(transaction, payload, transaction_hash).await;
    }
    if event_type == "medical_record_chain_anchor" {
        return record_medical_record_anchor_success(transaction, payload, transaction_hash).await;
    }
    if event_type != "emergency_capsule_chain_anchor" {
        return Ok(());
    }
    let patient_id = payload
        .get("patient_id")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "capsule outbox payload is missing patient_id".to_string())?;
    let version = payload
        .get("version")
        .and_then(serde_json::Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .ok_or_else(|| "capsule outbox payload has an invalid version".to_string())?;
    sqlx::query(
        "UPDATE emergency_capsules SET chain_tx_hash = $3, chain_finalized = true
         WHERE patient_id = $1 AND version = $2",
    )
    .bind(patient_id)
    .bind(version)
    .bind(transaction_hash)
    .execute(&mut **transaction)
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

/// Stamp the finalized transaction hash onto the access-log row it anchors.
///
/// This is what lets a patient see "anchored" next to a read. Only rows queued
/// by the disclosure audit carry `access_log_id`; older anchor events (whose
/// aggregate is a grant or consent id, not an access-log row) are left alone.
/// An existing hash is never overwritten.
///
/// # Parameters
/// * `transaction` - the delivery transaction, so the stamp commits with the delivery.
/// * `payload` - the outbox payload.
/// * `transaction_hash` - the finalized extrinsic hash.
///
/// # Returns
/// `Ok(())`, or the database error text.
async fn record_access_anchor_success(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    payload: &serde_json::Value,
    transaction_hash: &str,
) -> Result<(), String> {
    let Some(access_log_id) = payload
        .get("access_log_id")
        .and_then(serde_json::Value::as_str)
    else {
        return Ok(());
    };
    sqlx::query(
        "UPDATE access_logs SET blockchain_tx_hash = $2
         WHERE id = $1 AND blockchain_tx_hash IS NULL",
    )
    .bind(access_log_id)
    .bind(transaction_hash)
    .execute(&mut **transaction)
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

/// Stamp the finalized transaction hash onto the medical record it anchors.
///
/// # Parameters
/// * `transaction` - the delivery transaction.
/// * `payload` - the outbox payload (carries the record's IPFS content hash).
/// * `transaction_hash` - the finalized extrinsic hash.
///
/// # Returns
/// `Ok(())`, or the database error text.
async fn record_medical_record_anchor_success(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    payload: &serde_json::Value,
    transaction_hash: &str,
) -> Result<(), String> {
    let ipfs_hash = payload
        .get("ipfs_hash")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "record outbox payload is missing ipfs_hash".to_string())?;
    sqlx::query(
        "UPDATE medical_records SET blockchain_tx_hash = $2
         WHERE ipfs_content_hash = $1 AND blockchain_tx_hash IS NULL",
    )
    .bind(ipfs_hash)
    .bind(transaction_hash)
    .execute(&mut **transaction)
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

/// Retry every durable chain operation in bounded batches. Success is recorded
/// only after Substrate reports finalized execution.
pub async fn deliver_pending_chain_events(
    pool: &sqlx::PgPool,
    client: &crate::blockchain::SubstrateClient,
) -> Result<usize, String> {
    // Keep each selected row locked until its chain attempt and status update
    // finish. `SKIP LOCKED` lets another replica process different events while
    // preventing two replicas from submitting the same event concurrently.
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    let events: Vec<(String, String, String, serde_json::Value)> = sqlx::query_as(
        "SELECT id, event_type, aggregate_id, payload FROM audit_outbox_events
         WHERE delivered_at IS NULL AND event_type IN (
            'chain_access_anchor', 'consent_chain_anchor', 'patient_registration_chain_anchor',
            'medical_record_chain_anchor', 'emergency_capsule_chain_anchor',
            'audit_batch_chain_anchor'
         )
         ORDER BY occurred_at ASC LIMIT 50 FOR UPDATE SKIP LOCKED",
    )
    .fetch_all(&mut *transaction)
    .await
    .map_err(|error| error.to_string())?;
    let mut delivered = 0usize;
    for (id, event_type, aggregate_id, payload) in events {
        let outcome =
            submit_queued_chain_operation(client, &event_type, &aggregate_id, &payload).await;
        match outcome {
            Ok(result) => {
                if event_type == crate::audit_batching::AUDIT_BATCH_EVENT {
                    let block_number = client
                        .finalized_block_number(&result.finalized_block_hash)
                        .await;
                    crate::audit_batching::record_batch_finalized(
                        &mut transaction,
                        &payload,
                        &result,
                        block_number,
                    )
                    .await?;
                }
                record_queued_chain_success(&mut transaction, &event_type, &payload, &result.hash)
                    .await?;
                sqlx::query(
                    "UPDATE audit_outbox_events SET delivered_at = NOW(),
                     delivery_attempts = delivery_attempts + 1, last_error = NULL WHERE id = $1",
                )
                .bind(&id)
                .execute(&mut *transaction)
                .await
                .map_err(|error| error.to_string())?;
                delivered += 1;
            }
            Err(error) => {
                let message: String = error.to_string().chars().take(500).collect();
                sqlx::query(
                    "UPDATE audit_outbox_events SET delivery_attempts = delivery_attempts + 1,
                     last_error = $2 WHERE id = $1",
                )
                .bind(&id)
                .bind(message)
                .execute(&mut *transaction)
                .await
                .map_err(|update_error| update_error.to_string())?;
            }
        }
    }
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;
    Ok(delivered)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn outbox_event_is_replayable_after_a_delivery_failure() {
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
        outbox
            .mark_failed(&event.id, "chain unavailable".into())
            .unwrap();
        assert_eq!(outbox.pending().len(), 1);
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
