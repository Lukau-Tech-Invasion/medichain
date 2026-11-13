# Production Readiness Gates — Real Patient Data

**This is the canonical, durable record of what must be true before MediChain
processes any real (non-synthetic) patient data or is deployed to any real
users.** It exists because the project's synthetic-data security campaign
(Horizon HZ-2026-MC1) surfaced questions no engineering decision alone can
answer, and the owner obtained a substantive POPIA legal review to answer
them (2026-07-28). This document is derived from that review; see
`docs/POPIA_LEGAL_REVIEW_BRIEFING.md` for the original briefing questions and
`.horizon/decision-log.md` / `.horizon/findings-private/HZ-003.md` for the
full session record.

## Implementation status (updated 2026-07-29, second pass)

| # | Item | Status |
|---|---|---|
| 2 | Legal-basis / consent provenance | **Implemented** (`api/src/types/legal_basis.rs`, migration `20260729000001`) |
| 3 | Guardian legal authority + child participation | **Implemented** — guardian model (migration `20260729000002`, `handlers/rbac.rs`) plus Children's Act §129 age + maturity enforcement (migration `20260729000005`, `support::treatment_consent_capacity`) |
| 4 | Retention & deletion jobs active | **Partially implemented** — evaluation, legal holds, approval-gated execution, processing restriction and a deletion register (`api/src/retention/`, migrations `20260729000003`/`20260729000006`). **Irreversible deletion is deliberately NOT built.** |
| 5 | Legal entity + registered Information Officer | Not started — not an engineering task (`docs/GOVERNANCE_RECORD.md`) |
| 6 | POPIA prior-authorisation / transborder assessment | Not started — not an engineering task (`docs/GOVERNANCE_RECORD.md`) |
| 7 | SA health/privacy lawyer sign-off on production model | Not started — not an engineering task (`docs/GOVERNANCE_RECORD.md`) |

### Correction to the previous version of this table

The first version of this table (earlier the same day) marked items 1 and 3
**Implemented** when neither was wired into a live code path:

- `CHILD_SELF_CONSENT_MIN_AGE_YEARS` was declared and **never read**. The
  `child_over_12_mature` capacity was accepted on the caller's word, with no
  check against the patient's actual age and no maturity finding recorded.

Both were caught by dead-code warnings, which is the honest reason to keep the
zero-warnings policy. The lesson worth carrying: "the module is written" and
"the requirement is implemented" are different claims, and a status table that
conflates them is worse than no status table.

### What is still outstanding within item 4

Execution **restricts** processing (POPIA restriction: retained, but processing
limited to storage) and writes a deletion-register entry. It does not delete.
Still unbuilt, and required before item 4 can be called closed:

- Irreversible deletion, once the retention periods are legally confirmed.
- Cascade across caches, search indexes, queues, and object storage.
- Backup expiry.
- Cryptographic erasure where appropriate.

Restriction enforcement is also **not yet universal**: `support::ensure_not_restricted`
is called on the write paths that initiate new processing, not by every route.
Universal enforcement depends on the Horizon HZ-010 authorization-chokepoint
retrofit (~386 routes), which is not complete.

**Real patient data therefore remains blocked.**

## The gate

## 2. Legal basis and consent provenance

A `consent_recorded: true/false` boolean is legally and operationally
insufficient. POPIA §11 recognizes multiple lawful-processing grounds beyond
consent (contractual necessity, legal obligation, protection of the data
subject's legitimate interests, public-law duty, legitimate interests of the
responsible party/a third party); health data additionally needs a
special-information authorization under §32 (processing necessary for
proper treatment and care).

Required fields (schema, not yet implemented):

```text
processing_purpose
popia_section_11_basis
special_information_basis
child_information_basis
consent_required
consent_status
consent_given_by
consent_giver_capacity
guardian_authority_evidence_id
privacy_notice_version
scope_of_consent
granted_at
expires_at
withdrawn_at
withdrawal_reason
emergency_basis
emergency_justification
recorded_by
```

South African legal mappings to use, not GDPR-style labels:

- **Treatment**: POPIA §11 ground + §32 health-processing authorization.
- **Public health**: the applicable legal obligation or public-law duty,
  with the enabling law recorded.
- **Emergency/vital interest**: protection of the data subject's legitimate
  interest, together with the applicable National Health Act emergency
  justification.
- **Consent**: voluntary, specific, informed consent, with evidence and
  withdrawal support.

The National Health Act permits treatment without ordinary informed consent
in defined situations (serious public-health risk, or delay would risk death
or irreversible harm and the patient hasn't refused the service) — that
emergency event should be recorded as its own legal justification, never
mislabeled as consent.

## 3. Guardian model for minors

Admin verification, permission scoping, and expiry (the model built this
campaign) are good security controls but do not alone satisfy POPIA. Two
legal layers apply simultaneously to a minor's health information: POPIA
§§27/32 (health information generally) and §§34/35 (children's information
specifically). §35 generally requires prior consent from a legally
competent person unless another specified ground applies, plus appropriate
safeguards and a way for that person to review or prevent further
processing.

Additional requirements beyond the current model:

- Verify the person is *legally authorized*, not merely an adult relative.
- Record evidence type, issuing authority, verification date, reviewer.
- Handle expired authority, custody disputes, changed guardianship.
- Separate scopes for view / update / share / emergency-access /
  grant-access-to-others (the current model already does some of this —
  extend, don't replace).
- Immediate revocation and periodic re-verification.
- Child participation/assent appropriate to age and maturity.
- Separate records for treatment consent vs. data-processing permission.
- No unrestricted administrator override.
- Emergency override: reason code, limited fields, automatic expiry,
  retrospective review.

The Children's Act allows a child over 12 with sufficient maturity/capacity
to consent to their own medical treatment; parents/guardians ordinarily
consent where the child is under 12 or lacks sufficient maturity. This must
not collapse into a single generic guardian-database permission flag.

**Status**: engineering half implemented (2026-07-29). The guardian model
supplies verified authority, evidence, scoped permissions, expiry, revocation
and recorded child assent. The Children's Act §129 layer was added separately:
`support::treatment_consent_capacity` applies the age test against the
patient's actual date of birth, `child_over_12_mature` is refused for anyone
under 12 and requires a recorded maturity finding (migration
`20260729000005`), a patient under 12 cannot self-consent at all, and a mature
child's own consent is recorded as `s129_mature_child_self_consent` rather
than being collapsed into competent-person consent — the two are different
legal facts.

One question is deliberately left open rather than answered in code: the
precise POPIA §35 ground for processing a mature child's information on their
own consent. It is recorded as its own value so the question stays visible for
counsel, instead of being buried under a wrong label.

## 4. Retention periods and the retention job

The existing `data_retention_policies`/`retention_job_runs` mechanism is not
sufficient while inactive — a retention policy without an operational
deletion, restriction, and legal-hold process does not enforce retention.

Conservative initial matrix (subject to formal legal confirmation before use):

| Category | Retention |
|---|---|
| Ordinary clinical records | 6 years from the last entry |
| Minor records | later of 21st birthday or 6 years after last clinical entry |
| Obstetric records | later of child reaching 21, or the applicable 6-year dormancy period |
| Patients legally incapable of managing their affairs / State patients | lifetime |
| Occupational health and safety incident records | 20 years |
| Long-latency occupational exposure | at least 25 years |
| Clinical-trial records | 15 years after completion |
| Clinical forensic records | at least 25 years |
| Litigation / anticipated claims | legal hold until finalized, then applicable retention calculation |

(Source: National Department of Health guideline on filing/archiving/
disposal of patient records — ordinary dormant records destroyed after 6
years, with longer periods for minors, obstetric records, occupational
incidents, long-latency exposure, trials, forensic medicine.)

Application-specific internal baselines (subject to counsel approval):

- Consent/guardian-authority evidence: same period as the record/processing
  activity it authorizes.
- Emergency-access audit events: same period as the associated clinical
  record.
- General security telemetry: 12–24 months unless attached to an
  investigation.
- Backups: rolling 30–90-day expiry, no indefinite orphaned backups.
- Synthetic test datasets: delete at campaign closure or within 30 days.
- Security findings/remediation evidence: retain while required for
  assurance/audit, without retaining unnecessary patient payloads.

**Status (2026-07-29): evaluation and reversible execution implemented;
irreversible disposal not built.**

- Evaluation, the seeded retention matrix, and per-record legal holds:
  migration `20260729000003`, `api/src/retention/evaluator.rs`, `job.rs`.
- Approval-gated execution: `api/src/retention/execution.rs`, migration
  `20260729000006`. A dry-run report issues a token bound to a SHA3-256 digest
  of *that* assessment; execution re-runs the assessment, aborts if the record
  set has drifted, re-checks legal holds at execution time (aborting outright
  if holds cannot be read), then marks records restricted and writes a
  deletion-register entry. Approvals expire and can only be executed once.
- The register carries no clinical payload by design: a register that copied a
  record's contents to prove disposal would defeat the disposal.

## 5. Synthetic-data isolated security campaign

No external POPIA authorization is ordinarily required solely for wholly
synthetic data that is not derived from, linkable to, or modeled too closely
on identifiable people — POPIA excludes information de-identified such that
it cannot be re-identified, and genuinely artificial records don't represent
real data subjects.

However, `.horizon/authorization-scope.json` existing is not by itself
sufficient — it should be backed by an approved rules-of-engagement package
covering: named system owner and test authorizer; exact repos/hosts/
interfaces/environments in scope; start/end dates; permitted/prohibited
techniques; confirmation only synthetic data is used; proof the synthetic
data wasn't copied from production; isolation/network-boundary description;
third-party systems explicitly excluded unless separately authorized; stop
conditions and emergency contact; evidence-handling/deletion requirements;
finding-disclosure/remediation process; approval signatures or immutable
approval records.

For testing the app locally on the owner's own laptop, this can remain
internal documentation (which is what `.horizon/` already is). **Do not**
test payment processors, cloud tenants, government systems, healthcare-
provider systems, or other third-party services beyond their published
sandbox permissions.

## 6. Information Officer

**Not currently verifiable from the repository — treat as unfulfilled until
documentary evidence exists.** For a private body, the head of the body is
ordinarily the Information Officer under the POPIA/PAIA framework, and must
be registered with the Information Regulator before formally taking up
POPIA duties.

Record the appointment in: the Information Regulator eServices
registration; a founder/director/board resolution; the PAIA manual; the
privacy notice and data-subject contact page; the internal POPIA compliance
framework; the processing-activity register; and a repository governance
record shaped like:

```json
{
  "organisation": "Legal entity operating MediChain",
  "information_officer": {
    "name": "Named natural person",
    "role": "Chief Executive Officer / Information Officer",
    "business_email": "privacy@example.co.za",
    "appointed_at": "YYYY-MM-DD",
    "regulator_registration_status": "pending|registered",
    "registration_evidence_location": "restricted-governance-store"
  },
  "deputy_information_officers": []
}
```

**Do not** place identity-document numbers, registration certificates, or
personal addresses in a public repository — the governance record above
belongs in a restricted store, not this repo, if it ever contains real
identifying details.

## Relationship to the Horizon security campaign

The synthetic-data, isolated Horizon security campaign (WP7/WP8, 43 active +
3 disruptive rows) **may continue** — this gate does not block it. It blocks
only the separate, later decision to process real patient data or deploy to
real users. See `.horizon/authorization-scope.json` for the campaign's own
authorization state and `.horizon/findings-private/HZ-003.md` for how this
gate connects to that specific finding.

### Emergency contact routing
Configure the web build argument `VITE_EMERGENCY_NUMBER` for the deployment jurisdiction. The South African default is `112` (cellphone emergency service), independent of display language. Rebuild the web image after changing it; it is not a runtime nginx environment setting. Verify both symptom-checker contact links and newly generated discharge instructions in the target region. Reference: https://www.westerncape.gov.za/health-wellness/know-who-you-can-call-emergency
