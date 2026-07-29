# ADR-0005: Restriction before deletion for retention

- **Status:** Accepted
- **Date:** 2026-07-29
- **Deciders:** Founder, informed by the 2026-07-28 POPIA legal review

## Context

POPIA requires that personal information not be retained longer than necessary,
and that it be destroyed, deleted or effectively de-identified once retention is
no longer authorised. The legal review was blunt: a retention *policy* without an
operational deletion, restriction and legal-hold process does not enforce
retention.

The `data_retention_policies` and `retention_job_runs` tables had existed since
January 2026 with **no caller at all** — nothing had ever read a policy or written
a job run.

Two facts shaped the decision. First, the retention-period matrix (6 years
ordinary clinical, later-of-21st-birthday-or-6-years for minors, 20–25 years
occupational and forensic, lifetime for State patients) is explicitly *subject to
formal legal confirmation*. Second, deletion of a clinical record is irreversible.

Building irreversible destruction on top of legally unconfirmed periods would mean
the first bug destroys records that should have been kept, with no recovery.

## Options considered

**A. Full deletion pipeline now.** Closes the obligation properly. Rejected for
sequencing: it makes an unconfirmed policy set destructive.

**B. Leave it evaluation-only.** Zero risk of wrongful destruction. Rejected: a
system that identifies expired records but cannot act does not satisfy retention
limitation, and the review said so.

**C. Approval-gated restriction plus a deletion register.** *(chosen)* Act, but
reversibly.

## Decision

Execution **restricts** processing (POPIA restriction: retained, processing limited
to storage) and writes a deletion-register entry. It issues no destructive
`DELETE`.

Controls, each answering a specific failure:

- **Digest-bound approval.** A token binds to a SHA3-256 digest of *that*
  assessment. Without it, approving a report of three records could execute
  against three thousand — the approval would be genuine and meaningless.
- **Re-assessment at execution**, aborting on drift. The stored report is
  evidence of what was approved, not a work list.
- **Legal holds re-read at execution**, aborting if unreadable. An empty hold list
  is indistinguishable from "no holds exist", which would make held records look
  disposable.
- **Single-use, expiring tokens** (24 h). An older approval describes a record set
  that has since moved.
- **Register carries no clinical payload.** A register that copied a record's
  contents to prove disposal would defeat the disposal.
- **Incomplete assessments cannot be approved or executed.** "Did not run" and
  "found nothing" are different states — see below.

## Consequences

**Gained.** Retention acts, auditably, and every action is reversible while the
periods remain unconfirmed. The register provides the evidence trail an auditor
would ask for.

**Cost.** The obligation is **not** fully discharged. Absent: irreversible
deletion, cascade across caches/indexes/queues/object storage, backup expiry,
cryptographic erasure, and tests proving no on-chain personal values remain. Item
4 of the production gate stays open, correctly.

**A defect this surfaced.** During testing, with the database unreachable, the
retention report returned `200 {"success": true, "total_due": 0}` — the error was
swallowed and an empty assessment was indistinguishable from a clean run. The
synthetic test suite recorded it as a PASS. A compliance control that reports
success without running manufactures false assurance exactly when something is
already wrong, which is worse than having no control. Now: `incomplete_reason`
propagates, the endpoint returns 503, and approval and execution both refuse an
incomplete assessment.
