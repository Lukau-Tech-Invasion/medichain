//! Data retention evaluation and reporting.
//!
//! # Scope: evaluation only, no deletion
//!
//! This module **never deletes, archives, or modifies clinical data.** It reads
//! retention policies, works out which records would be eligible for disposal,
//! records that assessment as a `retention_job_runs` row with `dry_run = true`,
//! and — once an operator has approved a specific assessment — restricts
//! processing on the records it identified and writes a deletion-register entry
//! for each.
//!
//! That boundary is deliberate. The `data_retention_policies` /
//! `retention_job_runs` tables and their repository layer have existed since
//! January 2026 with no caller at all — nothing has ever read a policy or
//! written a job run. The first code to act on them should be able to be run,
//! observed, and argued with before it can destroy a patient record, so
//! `evaluator`/`job` supply the observation half and `execution` supplies a
//! reversible action half.
//!
//! Still outstanding, and listed as such in
//! `docs/PRODUCTION_READINESS_GATES.md` §4: irreversible deletion, cascade
//! across caches/indexes/queues/object storage, backup expiry, and
//! cryptographic erasure. A restriction can be lifted if the retention periods
//! — which remain "subject to formal legal confirmation" — turn out to be
//! wrong. A deletion cannot.

pub mod evaluator;
pub mod execution;
pub mod job;

// Only the entry point is re-exported. The evaluator's types are an internal
// vocabulary shared between `evaluator` and `job`; re-exporting them here would
// advertise an API surface nothing outside this module uses, and `cargo` would
// (correctly) flag the unused re-exports.
pub use job::run_retention_assessment;
