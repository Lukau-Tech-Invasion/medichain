//! Approval-gated retention execution.
//!
//! # What this does and does not do
//!
//! Execution **restricts** processing and **registers** the decision. It does
//! not delete, archive, or modify any clinical record. `super` explains why the
//! evaluation half shipped alone first; this is the second step, and it stops
//! deliberately short of the third.
//!
//! A restriction is recoverable. The retention periods in
//! `docs/PRODUCTION_READINESS_GATES.md` §4 are still "subject to formal legal
//! confirmation", so the first thing built on top of them must be reversible if
//! they turn out to be wrong. Irreversible destruction — cascade across caches,
//! indexes and object storage, backup expiry, cryptographic erasure — remains
//! unbuilt and is listed as outstanding in that document.
//!
//! # The approval flow
//!
//! ```text
//! request_approval(assessment)  -> token bound to a digest of THAT assessment
//! decide_approval(token, true)  -> a human authorises it
//! execute_approved(token)       -> re-assess, re-verify digest, re-check holds,
//!                                  restrict + register
//! ```
//!
//! The digest is the load-bearing part. Approving a report of three records and
//! executing against three thousand would otherwise be indistinguishable from
//! approving the three: the approval would be genuine and meaningless. If the
//! record set moves between approval and execution, execution aborts and a
//! fresh report has to be approved.

use chrono::{Duration, Utc};
use sha3::{Digest, Sha3_256};

use super::job::{run_retention_assessment, RetentionAssessment};
use crate::repositories::traits::{
    DeletionRegisterEntity, ProcessingRestrictionEntity, RetentionApprovalEntity,
};
use crate::state::AppState;

/// How long an approval stays executable.
///
/// Retention boundaries move daily and new clinical entries land continuously,
/// so an approval older than this describes a record set that has drifted. Short
/// enough that the digest check is a backstop rather than the only defence.
const APPROVAL_VALIDITY_HOURS: i64 = 24;

/// Domain separator, so an assessment digest cannot collide with another hash
/// this system computes.
const ASSESSMENT_DOMAIN: &[u8] = b"medichain:retention-assessment:v1";

/// What an execution actually did.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ExecutionOutcome {
    pub token: String,
    pub restricted: usize,
    pub registered: usize,
    /// Patients that were due at approval time but are now under a legal hold.
    /// Skipped, and reported so the skip is visible rather than silent.
    pub skipped_for_hold: usize,
    pub failed: Vec<String>,
    /// Always 0. Present so an execution report cannot be misread as having
    /// deleted something.
    pub deleted: usize,
}

/// Reasons an execution can be refused.
#[derive(Debug)]
pub enum ExecutionError {
    NotFound(String),
    NotExecutable(String),
    /// The record set changed between approval and execution.
    AssessmentDrifted {
        approved: String,
        current: String,
    },
    Repository(String),
}

impl std::fmt::Display for ExecutionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(t) => write!(f, "approval {t} not found"),
            Self::NotExecutable(reason) => write!(f, "approval is not executable: {reason}"),
            Self::AssessmentDrifted { approved, current } => write!(
                f,
                "the retention assessment changed since approval (approved digest {}…, current \
                 {}…); request and approve a fresh report",
                &approved[..8.min(approved.len())],
                &current[..8.min(current.len())]
            ),
            Self::Repository(e) => write!(f, "repository error: {e}"),
        }
    }
}

/// Digest the parts of an assessment that decide what execution would do.
///
/// Covers the assessment date, and for each policy its id and the patient ids
/// found due — in a stable order, with length-prefixed fields so no two
/// distinct assessments can share a digest. Counts are deliberately excluded:
/// they are derived from the ids, and hashing both would let a change in one
/// mask a change in the other.
pub fn assessment_digest(assessment: &RetentionAssessment) -> String {
    let mut hasher = Sha3_256::new();
    hasher.update(ASSESSMENT_DOMAIN);

    let mut field = |bytes: &[u8]| {
        hasher.update((bytes.len() as u64).to_be_bytes());
        hasher.update(bytes);
    };

    field(assessment.assessed_on.to_string().as_bytes());

    // Sorted so two assessments that found the same records in a different
    // order are correctly treated as identical.
    let mut policies: Vec<_> = assessment.policies.iter().collect();
    policies.sort_by(|a, b| a.policy_id.cmp(&b.policy_id));

    for policy in policies {
        field(policy.policy_id.as_bytes());
        let mut ids: Vec<_> = policy.due_patient_ids.iter().collect();
        ids.sort();
        field(&(ids.len() as u64).to_be_bytes());
        for id in ids {
            field(id.as_bytes());
        }
    }

    hex::encode(hasher.finalize())
}

/// Create a pending approval bound to this assessment's exact contents.
pub async fn request_approval(
    data: &actix_web::web::Data<AppState>,
    assessment: &RetentionAssessment,
    requested_by: &str,
) -> Result<RetentionApprovalEntity, ExecutionError> {
    let now = Utc::now();
    let approval = RetentionApprovalEntity {
        token: format!("RA-{}", uuid::Uuid::new_v4()),
        assessment_digest: assessment_digest(assessment),
        assessed_on: assessment.assessed_on,
        due_count: i32::try_from(assessment.total_due).unwrap_or(i32::MAX),
        requested_by: requested_by.to_string(),
        requested_at: now,
        approved_by: None,
        approved_at: None,
        executed_by: None,
        executed_at: None,
        status: "pending".to_string(),
        expires_at: now + Duration::hours(APPROVAL_VALIDITY_HOURS),
        rejection_reason: None,
    };

    data.repositories
        .retention_execution
        .create_approval(approval)
        .await
        .map_err(|e| ExecutionError::Repository(e.to_string()))
}

/// Execute an approved retention run.
///
/// Re-runs the assessment rather than trusting the stored report, re-checks
/// legal holds at execution time, and refuses if either the approval state or
/// the record set has moved.
pub async fn execute_approved(
    data: &actix_web::web::Data<AppState>,
    token: &str,
    executed_by: &str,
) -> Result<ExecutionOutcome, ExecutionError> {
    let repo = &data.repositories.retention_execution;

    let approval = repo
        .get_approval(token)
        .await
        .map_err(|_| ExecutionError::NotFound(token.to_string()))?;

    let now = Utc::now();
    if !approval.is_executable(now) {
        return Err(ExecutionError::NotExecutable(format!(
            "status '{}', executed_at {:?}, expires_at {}",
            approval.status, approval.executed_at, approval.expires_at
        )));
    }

    // Re-assess. The stored report is evidence of what was approved, not a
    // work list — acting on a snapshot would mean acting on records whose
    // status may have changed since a human looked at them.
    let current = run_retention_assessment(data).await;
    if let Some(reason) = &current.incomplete_reason {
        // Abort rather than compare digests. An incomplete assessment yields an
        // empty record set, which would either mismatch the approved digest
        // (confusing) or — if the approval was itself minted from an empty
        // assessment — match it and "successfully" execute against nothing.
        return Err(ExecutionError::Repository(format!(
            "refusing to execute: the re-run assessment could not be completed: {reason}"
        )));
    }
    let current_digest = assessment_digest(&current);
    if current_digest != approval.assessment_digest {
        return Err(ExecutionError::AssessmentDrifted {
            approved: approval.assessment_digest.clone(),
            current: current_digest,
        });
    }

    // Claim the approval BEFORE doing any work. If this fails, another
    // execution already claimed it and this one must not proceed — the check is
    // atomic in the repository, unlike a read-then-write here.
    repo.mark_executed(token, executed_by)
        .await
        .map_err(|e| ExecutionError::NotExecutable(e.to_string()))?;

    let mut outcome = ExecutionOutcome {
        token: token.to_string(),
        restricted: 0,
        registered: 0,
        skipped_for_hold: 0,
        failed: Vec::new(),
        deleted: 0,
    };

    // Holds are re-read here, not reused from the assessment: a hold placed
    // between the report and this moment must stop the record being restricted.
    // Unlike the assessment job, a failure to load holds ABORTS rather than
    // proceeding with an empty list — this code path acts on records.
    let held_patients = match data.repositories.legal_holds.get_active().await {
        Ok(holds) => holds
            .into_iter()
            .filter_map(|h| h.patient_id)
            .collect::<std::collections::HashSet<_>>(),
        Err(e) => {
            return Err(ExecutionError::Repository(format!(
                "could not verify legal holds at execution time, aborting: {e}"
            )))
        }
    };

    for policy in &current.policies {
        for patient_id in &policy.due_patient_ids {
            if held_patients.contains(patient_id) {
                outcome.skipped_for_hold += 1;
                continue;
            }

            let basis = format!(
                "retention period elapsed under policy '{}' ({}), assessed {}",
                policy.policy_name, policy.policy_id, current.assessed_on
            );

            let restriction = ProcessingRestrictionEntity {
                id: format!("PR-{}", uuid::Uuid::new_v4()),
                patient_id: patient_id.clone(),
                entity_type: policy.entity_type.clone(),
                reason: basis.clone(),
                policy_id: Some(policy.policy_id.clone()),
                approval_token: Some(token.to_string()),
                restricted_by: executed_by.to_string(),
                restricted_at: Utc::now(),
                lifted_by: None,
                lifted_at: None,
                lift_reason: None,
            };

            if let Err(e) = repo.record_restriction(restriction).await {
                // One patient failing must not abandon the rest, but it must be
                // reported: a partially-executed run that claims success would
                // leave records the register says were handled.
                log::error!("retention execution: could not restrict record: {e}");
                outcome.failed.push(patient_id.clone());
                continue;
            }
            outcome.restricted += 1;

            let entry = DeletionRegisterEntity {
                id: format!("DR-{}", uuid::Uuid::new_v4()),
                patient_id: patient_id.clone(),
                entity_type: policy.entity_type.clone(),
                action: "restricted".to_string(),
                policy_id: Some(policy.policy_id.clone()),
                policy_name: Some(policy.policy_name.clone()),
                basis,
                approval_token: Some(token.to_string()),
                executed_by: executed_by.to_string(),
                executed_at: Utc::now(),
            };

            if let Err(e) = repo.append_register_entry(entry).await {
                log::error!("retention execution: could not register record: {e}");
                outcome.failed.push(patient_id.clone());
                continue;
            }
            outcome.registered += 1;
        }
    }

    log::info!(
        "retention execution {token} by {executed_by}: {} restricted, {} registered, {} held, {} \
         failed, 0 deleted",
        outcome.restricted,
        outcome.registered,
        outcome.skipped_for_hold,
        outcome.failed.len()
    );

    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::retention::job::PolicyAssessment;
    use chrono::NaiveDate;

    fn policy(id: &str, due: &[&str]) -> PolicyAssessment {
        PolicyAssessment {
            policy_id: id.to_string(),
            policy_name: format!("policy {id}"),
            entity_type: "clinical_record".to_string(),
            evaluated: due.len(),
            due: due.len(),
            not_due: 0,
            held: 0,
            excluded: 0,
            due_patient_ids: due.iter().map(|s| s.to_string()).collect(),
            configuration_error: None,
        }
    }

    fn assessment(policies: Vec<PolicyAssessment>) -> RetentionAssessment {
        let total_due = policies.iter().map(|p| p.due).sum();
        RetentionAssessment {
            assessed_on: NaiveDate::from_ymd_opt(2026, 7, 29).unwrap(),
            policies,
            total_due,
            total_held: 0,
            records_deleted: 0,
            incomplete_reason: None,
        }
    }

    #[test]
    fn digest_is_stable_across_ordering() {
        let a = assessment(vec![
            policy("P-1", &["PAT-2", "PAT-1"]),
            policy("P-2", &["PAT-3"]),
        ]);
        let b = assessment(vec![
            policy("P-2", &["PAT-3"]),
            policy("P-1", &["PAT-1", "PAT-2"]),
        ]);

        assert_eq!(assessment_digest(&a), assessment_digest(&b));
    }

    /// The whole point of the digest: approving a small set must not authorise
    /// executing against a larger one.
    #[test]
    fn adding_a_patient_changes_the_digest() {
        let approved = assessment(vec![policy("P-1", &["PAT-1"])]);
        let drifted = assessment(vec![policy("P-1", &["PAT-1", "PAT-2"])]);

        assert_ne!(assessment_digest(&approved), assessment_digest(&drifted));
    }

    #[test]
    fn removing_a_patient_changes_the_digest() {
        let approved = assessment(vec![policy("P-1", &["PAT-1", "PAT-2"])]);
        let drifted = assessment(vec![policy("P-1", &["PAT-1"])]);

        assert_ne!(assessment_digest(&approved), assessment_digest(&drifted));
    }

    /// A different day is a different assessment even over identical records:
    /// retention boundaries are date-dependent.
    #[test]
    fn a_different_assessment_date_changes_the_digest() {
        let today = assessment(vec![policy("P-1", &["PAT-1"])]);
        let mut tomorrow = assessment(vec![policy("P-1", &["PAT-1"])]);
        tomorrow.assessed_on = NaiveDate::from_ymd_opt(2026, 7, 30).unwrap();

        assert_ne!(assessment_digest(&today), assessment_digest(&tomorrow));
    }

    /// Moving a patient between policies must be visible: the same ids under a
    /// different policy means a different disposal basis.
    #[test]
    fn moving_a_patient_between_policies_changes_the_digest() {
        let a = assessment(vec![policy("P-1", &["PAT-1"]), policy("P-2", &[])]);
        let b = assessment(vec![policy("P-1", &[]), policy("P-2", &["PAT-1"])]);

        assert_ne!(assessment_digest(&a), assessment_digest(&b));
    }

    /// Length-prefixing guards this: "PAT-1","PAT-2" must not hash the same as
    /// a single id "PAT-1PAT-2".
    #[test]
    fn digest_resists_id_boundary_ambiguity() {
        let split = assessment(vec![policy("P-1", &["PAT-1", "PAT-2"])]);
        let joined = assessment(vec![policy("P-1", &["PAT-1PAT-2"])]);

        assert_ne!(assessment_digest(&split), assessment_digest(&joined));
    }

    #[test]
    fn empty_assessment_still_produces_a_digest() {
        let empty = assessment(vec![]);
        assert_eq!(assessment_digest(&empty).len(), 64);
    }

    /// "The assessment found nothing" and "the assessment could not run" must
    /// never be the same state.
    ///
    /// Before `incomplete_reason` existed, a database outage produced an empty
    /// assessment identical to a clean run, and the report endpoint answered
    /// `200 {"success": true}` with "0 records due". Observed on 2026-07-29
    /// during a Postgres outage — the synthetic suite recorded it as a PASS,
    /// which is precisely the failure mode: a compliance control that reports
    /// success without having run.
    #[test]
    fn an_incomplete_assessment_is_distinguishable_from_an_empty_one() {
        let ran_and_found_nothing = assessment(vec![]);
        let mut never_ran = assessment(vec![]);
        never_ran.incomplete_reason = Some("database unreachable".to_string());

        // Asserted on the field itself: the `is_complete()` wrapper had no
        // production caller and was removed in the 2026-07-31 dead-code pass.
        // `incomplete_reason` *is* the distinction this test exists to protect.
        assert!(ran_and_found_nothing.incomplete_reason.is_none());
        assert!(never_ran.incomplete_reason.is_some());

        // They are indistinguishable by their findings alone — which is exactly
        // why the flag has to carry the difference.
        assert_eq!(ran_and_found_nothing.total_due, never_ran.total_due);
        assert_eq!(
            assessment_digest(&ran_and_found_nothing),
            assessment_digest(&never_ran)
        );
    }
}
