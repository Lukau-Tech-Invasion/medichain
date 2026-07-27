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
        self.events
            .write()
            .map_err(|_| "Audit outbox is unavailable")?
            .insert(event.id.clone(), event.clone());
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
