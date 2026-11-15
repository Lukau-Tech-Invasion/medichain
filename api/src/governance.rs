//! Durable multi-approver governance decisions.
//!
//! `AuditOutbox::propose/approve/execute` keeps decisions in process memory,
//! so an approval did not survive a restart and two API instances each had
//! their own view. The `governance_decisions` table has existed since
//! migration 20260727000008 but nothing wrote to it. These functions make it
//! the authority whenever PostgreSQL is configured: every transition is one
//! guarded statement, so a decision is approved once per approver, executed
//! at most once, and never executed before its approvals are in, whichever
//! instance handles the request. Without a database they delegate to the
//! in-memory `AuditOutbox`, which applies the same rules.

use chrono::{DateTime, Utc};

use crate::audit_outbox::{GovernanceDecision, GovernanceStatus};
use crate::state::AppState;

/// Why a governance transition did not happen.
#[derive(Debug)]
pub enum GovernanceError {
    /// No decision with that id.
    NotFound,
    /// The decision is not in a state that allows this (the text says why).
    Refused(&'static str),
    /// Storage failed; the detail is for logs only.
    Storage(String),
}

const COLUMNS: &str = "id, decision_type, subject_type, subject_id, proposal_hash, status, \
    required_approvals, approved_by, created_at, executed_at";

/// Parse a stored status; an unknown value is corrupt data, not a guess.
fn parse_status(value: &str) -> Result<GovernanceStatus, GovernanceError> {
    match value {
        "proposed" => Ok(GovernanceStatus::Proposed),
        "approved" => Ok(GovernanceStatus::Approved),
        "rejected" => Ok(GovernanceStatus::Rejected),
        "executed" => Ok(GovernanceStatus::Executed),
        "cancelled" => Ok(GovernanceStatus::Cancelled),
        other => Err(GovernanceError::Storage(format!(
            "unknown governance status {other}"
        ))),
    }
}

/// Build a decision from a `governance_decisions` row.
fn from_row(row: &sqlx::postgres::PgRow) -> Result<GovernanceDecision, GovernanceError> {
    use sqlx::Row;
    let storage = |e: sqlx::Error| GovernanceError::Storage(e.to_string());
    let approved: serde_json::Value = row.try_get("approved_by").map_err(storage)?;
    let required: i32 = row.try_get("required_approvals").map_err(storage)?;
    Ok(GovernanceDecision {
        id: row.try_get("id").map_err(storage)?,
        decision_type: row.try_get("decision_type").map_err(storage)?,
        subject_type: row.try_get("subject_type").map_err(storage)?,
        subject_id: row.try_get("subject_id").map_err(storage)?,
        proposal_hash: row.try_get("proposal_hash").map_err(storage)?,
        status: parse_status(&row.try_get::<String, _>("status").map_err(storage)?)?,
        required_approvals: usize::try_from(required).unwrap_or(usize::MAX),
        approved_by: serde_json::from_value(approved).unwrap_or_default(),
        created_at: row.try_get("created_at").map_err(storage)?,
        executed_at: row.try_get("executed_at").map_err(storage)?,
    })
}

/// Open a decision that needs `required_approvals` distinct approvers.
///
/// Parameters: what kind of decision, what it is about, the exact proposal
/// text (hashed, so what is approved is what is executed), and the approval
/// count. Returns the stored decision.
pub async fn propose(
    data: &AppState,
    decision_type: &str,
    subject: (&str, &str),
    proposal: &str,
    required_approvals: usize,
    now: DateTime<Utc>,
) -> Result<GovernanceDecision, GovernanceError> {
    let decision = data
        .audit_outbox
        .propose(
            decision_type.to_string(),
            subject.0.to_string(),
            subject.1.to_string(),
            proposal,
            required_approvals,
            now,
        )
        .map_err(GovernanceError::Refused)?;
    let Some(pool) = data.db_pool.as_ref() else {
        return Ok(decision);
    };
    sqlx::query(
        "INSERT INTO governance_decisions
            (id, decision_type, subject_type, subject_id, proposal_hash, status,
             required_approvals, approved_by, created_at)
         VALUES ($1, $2, $3, $4, $5, 'proposed', $6, '[]'::jsonb, $7)",
    )
    .bind(&decision.id)
    .bind(&decision.decision_type)
    .bind(&decision.subject_type)
    .bind(&decision.subject_id)
    .bind(&decision.proposal_hash)
    .bind(i32::try_from(required_approvals).unwrap_or(i32::MAX))
    .bind(now)
    .execute(pool)
    .await
    .map_err(|e| GovernanceError::Storage(e.to_string()))?;
    Ok(decision)
}

/// One decision by id.
pub async fn get(data: &AppState, id: &str) -> Result<GovernanceDecision, GovernanceError> {
    let Some(pool) = data.db_pool.as_ref() else {
        return data
            .audit_outbox
            .decision(id)
            .ok_or(GovernanceError::NotFound);
    };
    let sql = format!("SELECT {COLUMNS} FROM governance_decisions WHERE id = $1");
    let row = sqlx::query(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| GovernanceError::Storage(e.to_string()))?;
    row.as_ref()
        .map(from_row)
        .unwrap_or(Err(GovernanceError::NotFound))
}

/// Record `approver`'s approval: once per approver, only while proposed.
/// The decision becomes `approved` when enough distinct approvers have signed.
pub async fn approve(
    data: &AppState,
    id: &str,
    approver: &str,
) -> Result<GovernanceDecision, GovernanceError> {
    let Some(pool) = data.db_pool.as_ref() else {
        return data
            .audit_outbox
            .approve(id, approver.to_string())
            .map_err(memory_refusal);
    };
    let sql = format!(
        "UPDATE governance_decisions
         SET approved_by = approved_by || to_jsonb($2::text),
             status = CASE WHEN jsonb_array_length(approved_by) + 1 >= required_approvals
                           THEN 'approved' ELSE status END
         WHERE id = $1 AND status = 'proposed' AND NOT (approved_by ? $2)
         RETURNING {COLUMNS}"
    );
    let row = sqlx::query(&sql)
        .bind(id)
        .bind(approver)
        .fetch_optional(pool)
        .await
        .map_err(|e| GovernanceError::Storage(e.to_string()))?;
    match row {
        Some(row) => from_row(&row),
        None => refusal_for(data, id).await,
    }
}

/// Mark an approved decision executed, exactly once.
pub async fn execute(
    data: &AppState,
    id: &str,
    now: DateTime<Utc>,
) -> Result<GovernanceDecision, GovernanceError> {
    let Some(pool) = data.db_pool.as_ref() else {
        return data.audit_outbox.execute(id, now).map_err(memory_refusal);
    };
    let sql = format!(
        "UPDATE governance_decisions SET status = 'executed', executed_at = $2
         WHERE id = $1 AND status = 'approved'
         RETURNING {COLUMNS}"
    );
    let row = sqlx::query(&sql)
        .bind(id)
        .bind(now)
        .fetch_optional(pool)
        .await
        .map_err(|e| GovernanceError::Storage(e.to_string()))?;
    match row {
        Some(row) => from_row(&row),
        None => refusal_for(data, id).await,
    }
}

/// Explain why a guarded update matched nothing: missing, or wrong state.
async fn refusal_for(data: &AppState, id: &str) -> Result<GovernanceDecision, GovernanceError> {
    get(data, id).await?;
    Err(GovernanceError::Refused(
        "This decision is not in a state that allows that (already approved by you, not yet fully approved, or already executed).",
    ))
}

/// Map the in-memory store's refusal text onto the error type.
fn memory_refusal(message: &'static str) -> GovernanceError {
    if message == "Governance decision not found" {
        GovernanceError::NotFound
    } else {
        GovernanceError::Refused(message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn memory_governance_needs_distinct_approvers_before_execution() {
        let state = AppState::new();
        let now = Utc::now();
        let decision = propose(
            &state,
            "research_export",
            ("research_export", "RX-1"),
            "p",
            2,
            now,
        )
        .await
        .unwrap();
        assert!(matches!(
            execute(&state, &decision.id, now).await,
            Err(GovernanceError::Refused(_))
        ));
        approve(&state, &decision.id, "admin_a").await.unwrap();
        assert!(matches!(
            approve(&state, &decision.id, "admin_a").await,
            Err(GovernanceError::Refused(_))
        ));
        let approved = approve(&state, &decision.id, "admin_b").await.unwrap();
        assert_eq!(approved.status, GovernanceStatus::Approved);
        execute(&state, &decision.id, now).await.unwrap();
        assert!(matches!(
            execute(&state, &decision.id, now).await,
            Err(GovernanceError::Refused(_))
        ));
        assert!(matches!(
            get(&state, "missing").await,
            Err(GovernanceError::NotFound)
        ));
    }
}

#[cfg(all(test, feature = "postgres"))]
mod pg_tests {
    use super::*;

    /// On PostgreSQL the table is the authority: a second process (here, a
    /// second AppState over the same database, with its own empty memory)
    /// sees the same decision and cannot approve twice or execute early.
    #[tokio::test]
    async fn test_pg_governance_is_shared_and_guarded() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let mut first = AppState::new();
        first.db_pool = Some(pool.clone());
        let mut second = AppState::new();
        second.db_pool = Some(pool.clone());
        let now = Utc::now();
        let decision = propose(
            &first,
            "research_export",
            ("research_export", "REX-PG"),
            "p",
            2,
            now,
        )
        .await
        .unwrap();
        assert!(matches!(
            execute(&second, &decision.id, now).await,
            Err(GovernanceError::Refused(_))
        ));
        approve(&second, &decision.id, "admin_b").await.unwrap();
        assert!(matches!(
            approve(&first, &decision.id, "admin_b").await,
            Err(GovernanceError::Refused(_))
        ));
        let approved = approve(&first, &decision.id, "admin_c").await.unwrap();
        assert_eq!(approved.status, GovernanceStatus::Approved);
        execute(&second, &decision.id, now).await.unwrap();
        assert!(matches!(
            execute(&first, &decision.id, now).await,
            Err(GovernanceError::Refused(_))
        ));
        pool.close().await;
    }
}
