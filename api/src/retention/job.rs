//! The scheduled retention assessment.
//!
//! **This job does not delete anything.** It evaluates active policies against
//! current records and records the outcome as a `retention_job_runs` row with
//! `dry_run = true` and `records_deleted = 0`. See the module docs in
//! `super` for why the deletion half is deliberately absent.

use chrono::{NaiveDate, Utc};

use super::evaluator::{evaluate, ActiveHold, RecordFacts, RetentionDecision, RetentionRule};
use crate::repositories::traits::{DataRetentionPolicyEntity, Pagination, RetentionJobRunEntity};
use crate::state::AppState;

/// How often the assessment runs. Retention boundaries move by one day at a
/// time, so a daily pass is as often as it can produce new information.
pub const RETENTION_ASSESSMENT_INTERVAL_SECS: u64 = 24 * 60 * 60;

/// Upper bound on pages walked per policy per run (100 patients per page).
/// Keeps a timer-driven job's cost bounded; exceeding it is reported, not
/// silently ignored.
const MAX_PAGES_PER_ASSESSMENT: u32 = 100;

/// What a single policy's assessment found.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PolicyAssessment {
    pub policy_id: String,
    pub policy_name: String,
    pub entity_type: String,
    pub evaluated: usize,
    pub due: usize,
    pub not_due: usize,
    pub held: usize,
    pub excluded: usize,
    /// Patient ids whose records are eligible for disposal. Reported so a human
    /// can review them; nothing acts on this list.
    pub due_patient_ids: Vec<String>,
    /// Populated when the policy itself is unusable (e.g. an unrecognised rule
    /// kind), rather than silently skipping it.
    pub configuration_error: Option<String>,
}

/// The whole run.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RetentionAssessment {
    pub assessed_on: NaiveDate,
    pub policies: Vec<PolicyAssessment>,
    pub total_due: usize,
    pub total_held: usize,
    /// Always 0. Present so the report cannot be misread as having deleted
    /// something, and so the number is visible in the API response rather than
    /// only implied by the absence of deletion code.
    pub records_deleted: usize,
    /// Set when the assessment could not actually be carried out.
    ///
    /// **An assessment that did not run is not an assessment that found
    /// nothing.** Both previously produced the same empty result: when the
    /// database was unreachable this reported "0 records due" and the endpoint
    /// answered `200 {"success": true}`, which is indistinguishable from a
    /// healthy run over a clean dataset. Observed on 2026-07-29 during a
    /// Postgres outage, where the synthetic test suite recorded it as a PASS.
    ///
    /// A retention control that reports success without running manufactures
    /// false assurance about a legal obligation, which is worse than having no
    /// control at all.
    pub incomplete_reason: Option<String>,
}

impl RetentionAssessment {
    /// Whether this assessment actually ran to completion.
    pub fn is_complete(&self) -> bool {
        self.incomplete_reason.is_none()
    }
}

/// Evaluate every active policy and persist a dry-run job record.
///
/// Failures are logged rather than propagated: this runs on a timer, and a
/// retention *assessment* failing must never take down request handling.
pub async fn run_retention_assessment(
    data: &actix_web::web::Data<AppState>,
) -> RetentionAssessment {
    let today = Utc::now().date_naive();
    let mut assessment = RetentionAssessment {
        assessed_on: today,
        policies: Vec::new(),
        total_due: 0,
        total_held: 0,
        records_deleted: 0,
        incomplete_reason: None,
    };

    let policies = match data.repositories.data_retention_policies.get_active().await {
        Ok(p) => p,
        Err(e) => {
            // ERROR, not WARN: this is a compliance control failing to run, not
            // a routine condition. Callers are told explicitly rather than
            // being handed an empty result that looks like a clean run.
            log::error!("retention assessment: could not load policies: {}", e);
            assessment.incomplete_reason = Some(format!("could not load retention policies: {e}"));
            return assessment;
        }
    };

    if policies.is_empty() {
        // Expected until someone activates the seeded matrix — the seeds ship
        // inactive on purpose, since the periods await legal confirmation.
        log::debug!("retention assessment: no active policies; nothing to evaluate");
        return assessment;
    }

    let holds = match load_active_holds(data).await {
        Ok(h) => h,
        Err(e) => {
            // Without the hold list, records under legal hold would be reported
            // as due. The report is still produced (it has diagnostic value)
            // but is explicitly marked incomplete so nobody approves an
            // execution against it.
            log::error!("retention assessment: could not load legal holds: {}", e);
            assessment.incomplete_reason = Some(format!(
                "could not load legal holds ({e}); held records may appear due"
            ));
            return assessment;
        }
    };

    for policy in policies {
        let result = assess_policy(data, &policy, &holds, today).await;
        assessment.total_due += result.due;
        assessment.total_held += result.held;
        assessment.policies.push(result);
    }

    persist_job_run(data, &assessment).await;
    assessment
}

/// Evaluate one policy across the patients it covers.
async fn assess_policy(
    data: &actix_web::web::Data<AppState>,
    policy: &DataRetentionPolicyEntity,
    holds: &[ActiveHold],
    today: NaiveDate,
) -> PolicyAssessment {
    let mut result = PolicyAssessment {
        policy_id: policy.id.clone(),
        policy_name: policy.policy_name.clone(),
        entity_type: policy.entity_type.clone(),
        evaluated: 0,
        due: 0,
        not_due: 0,
        held: 0,
        excluded: 0,
        due_patient_ids: Vec::new(),
        configuration_error: None,
    };

    let rule = match rule_for(policy) {
        Some(r) => r,
        None => {
            // A policy nobody can interpret is a configuration bug worth
            // surfacing, not something to skip quietly.
            result.configuration_error = Some(format!(
                "unusable policy configuration: rule_kind={:?}, period_years={:?}, min_age={:?}",
                policy.retention_rule_kind, policy.retention_period_years, policy.minimum_age_years
            ));
            log::warn!(
                "retention policy {} has an unusable configuration and was not evaluated",
                policy.id
            );
            return result;
        }
    };

    // Paginated with a hard page cap rather than loading every patient at once:
    // NASA Power of 10 Rule 2 (bounded loops) applies, and a timer-driven job
    // needs a predictable per-run cost. If a deployment ever exceeds the cap
    // the run is truncated and says so, instead of growing without limit.
    let mut page_index = 0u32;
    let mut truncated = false;

    'pages: loop {
        if page_index >= MAX_PAGES_PER_ASSESSMENT {
            truncated = true;
            break;
        }

        let pagination = Pagination::new(page_index, Pagination::MAX_PER_PAGE);
        let batch = match data.repositories.patients.list(pagination).await {
            Ok(p) => p,
            Err(e) => {
                result.configuration_error = Some(format!("could not load patients: {}", e));
                return result;
            }
        };

        if batch.items.is_empty() {
            break 'pages;
        }

        for patient in &batch.items {
            let facts = RecordFacts {
                patient_id: patient.id.clone(),
                entity_type: policy.entity_type.clone(),
                created_on: patient.created_at.date_naive(),
                // No `last_clinical_entry_at` column exists. `updated_at` is
                // the closest available proxy; deriving the real value means
                // aggregating MAX(record_date) across the clinical tables,
                // which belongs with the deletion work rather than here.
                // Recorded as a known approximation rather than a silent one —
                // it must be replaced before anything acts on these dates.
                last_clinical_entry_on: Some(patient.updated_at.date_naive()),
                // Age-based policies need a decrypted date of birth. Left
                // `None` here so those policies report `Excluded` (never
                // `Due`), which is the safe direction while this is
                // report-only.
                date_of_birth: None,
            };

            result.evaluated += 1;
            match evaluate(rule, &facts, holds, today) {
                RetentionDecision::Due { .. } => {
                    result.due += 1;
                    result.due_patient_ids.push(patient.id.clone());
                }
                RetentionDecision::NotDue { .. } => result.not_due += 1,
                RetentionDecision::Held { .. } => result.held += 1,
                RetentionDecision::Excluded { .. } => result.excluded += 1,
            }
        }

        let seen = u64::from(page_index + 1) * u64::from(Pagination::MAX_PER_PAGE);
        if seen >= batch.total {
            break 'pages;
        }
        page_index += 1;
    }

    if truncated {
        result.configuration_error = Some(format!(
            "assessment truncated after {} pages ({} patients); not all records were evaluated",
            MAX_PAGES_PER_ASSESSMENT,
            MAX_PAGES_PER_ASSESSMENT * Pagination::MAX_PER_PAGE
        ));
        log::warn!(
            "retention policy {} truncated at the page cap; report is incomplete",
            policy.id
        );
    }

    result
}

/// Map a stored policy row onto a rule the evaluator understands.
fn rule_for(policy: &DataRetentionPolicyEntity) -> Option<RetentionRule> {
    let kind = policy.retention_rule_kind.as_deref()?;
    let years = policy
        .retention_period_years
        .and_then(|y| u32::try_from(y).ok())
        .unwrap_or(0);
    let min_age = policy.minimum_age_years.and_then(|a| u32::try_from(a).ok());
    RetentionRule::from_policy(kind, years, min_age)
}

/// Load every unreleased legal hold.
///
/// Returns `Err` rather than an empty list on failure. An empty hold list is
/// indistinguishable from "no holds exist", which would silently make held
/// records look eligible for disposal — and since
/// `retention::execution::execute_approved` now acts on an approved
/// assessment, that is no longer merely reportable.
async fn load_active_holds(
    data: &actix_web::web::Data<AppState>,
) -> Result<Vec<ActiveHold>, String> {
    match data.repositories.legal_holds.get_active().await {
        Ok(holds) => Ok(holds
            .into_iter()
            .map(|h| ActiveHold {
                patient_id: h.patient_id,
                entity_type: h.entity_type,
                reason: h.reason,
            })
            .collect()),
        Err(e) => Err(e.to_string()),
    }
}

/// Record the assessment as a dry-run job row.
async fn persist_job_run(data: &actix_web::web::Data<AppState>, assessment: &RetentionAssessment) {
    let total_evaluated: usize = assessment.policies.iter().map(|p| p.evaluated).sum();
    let total_skipped: usize = assessment
        .policies
        .iter()
        .map(|p| p.held + p.excluded)
        .sum();
    let error_count = assessment
        .policies
        .iter()
        .filter(|p| p.configuration_error.is_some())
        .count();

    let run = RetentionJobRunEntity {
        id: format!("RJR-{}", uuid::Uuid::new_v4()),
        policy_id: None,
        job_type: "audit".to_string(),
        started_at: Some(Utc::now()),
        completed_at: Some(Utc::now()),
        entity_type: "all".to_string(),
        date_threshold: assessment.assessed_on,
        status: Some("completed".to_string()),
        records_evaluated: i32::try_from(total_evaluated).ok(),
        records_archived: Some(0),
        // Structurally zero: this job has no deletion code path.
        records_deleted: Some(0),
        records_skipped: i32::try_from(total_skipped).ok(),
        error_count: i32::try_from(error_count).ok(),
        error_details: Some(serde_json::json!(assessment
            .policies
            .iter()
            .filter_map(
                |p| p.configuration_error.as_ref().map(|e| serde_json::json!({
                    "policy_id": p.policy_id,
                    "error": e,
                }))
            )
            .collect::<Vec<_>>())),
        run_by: Some("system:retention-assessment".to_string()),
        dry_run: Some(true),
        created_at: Some(Utc::now()),
    };

    if let Err(e) = data.repositories.retention_job_runs.create(run).await {
        log::warn!("retention assessment: could not persist job run: {}", e);
    }
}
