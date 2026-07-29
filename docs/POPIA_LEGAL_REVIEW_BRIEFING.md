# POPIA Legal Review Briefing (Horizon HZ-WP1-HLTH-001)

> **REVIEW OUTCOME (2026-07-28)**: the owner returned a substantive, cited
> POPIA/National-Health-Act/Children's-Act review answering the 6 questions
> below. Full outcome recorded in `docs/PRODUCTION_READINESS_GATES.md` (the
> canonical, durable reference) and `.horizon/decision-log.md`. Headline:
> **the synthetic-data, isolated Horizon security campaign may continue.
> Real patient data remains blocked** until seven specific items close,
> most notably a redesign of HZ-003's on-chain plaintext emergency fields
> (`.horizon/findings-private/HZ-003.md`). The rest of this document is
> preserved as the original briefing that prompted that review.

> **This document is briefing material, not the legal review itself.** It is
> written by an engineering assistant, not a lawyer, and does not constitute
> legal advice or a compliance determination. Its purpose is to make the
> actual human legal review (by the project owner or retained counsel)
> faster and better-informed, by collecting in one place what MediChain
> actually does with personal information, what technical safeguards already
> exist, and the specific questions a reviewer needs to answer.
> `.horizon/authorization-scope.json`'s `jurisdiction_reviewed` field stays
> `false` until a qualified human completes that review — nothing in this
> document changes that.

## 1. Why this review gates the campaign

MediChain's Horizon security campaign (HZ-2026-MC1) has 43 active-tier and 3
disruptive-tier test rows (WP7/WP8) blocked behind two prerequisites: an
isolated test environment (see `docs/BACKUP_RESTORE_RUNBOOK.md` and
`docker-compose.horizon-isolated.yml` for that half) and this POPIA legal
review. South Africa's Protection of Personal Information Act treats health
data as **special personal information** — a higher processing bar than
ordinary personal information, with Information Regulator and data-subject
notification duties on breach. Testing against even synthetic data in an
environment modeling a live health-records system is the kind of decision
that should have a named human sign-off, not just an engineering judgment
call — hence this gate.

## 2. What MediChain processes (data map, from source review)

See `.horizon/evidence-private/HZ-WP8-PRIV-001/data-map.md` for the full
table-by-table inventory; summarized for legal review:

| Category | Examples | POPIA classification |
|---|---|---|
| Patient identity + emergency data | Name, DOB, phone, address, blood type, allergies, emergency contacts | Special (health-linked) |
| National ID | South African/regional national ID numbers | Special (linked to health record) |
| Clinical records | Diagnoses, medications, lab results, vitals, procedure notes | Special |
| Genetic test results | Variants, clinical significance, counseling records | Special (POPIA explicitly names genetic data as special) |
| Guardian/dependent relationships | Guardian wallet address + relationship type + permissions (no guardian PII duplicated) | Ordinary (metadata about a relationship, not itself health data) |
| Death records | Cause of death, manner of death, address at death | Special, but lower ongoing re-identification risk (data subject deceased) |
| Insurance/billing | Policy numbers, subscriber name/DOB, claims contact info | Ordinary |
| Staff/user accounts | Wallet address, name, email, role | Ordinary |
| Security/audit logs | IP address, accessor identity, access timestamps | Ordinary, processed under the "security" legitimate-interest ground |

## 3. Current technical safeguards (verifiable in source, not asserted)

- **Encryption at rest**: patient PHI fields (name, DOB, phone, address,
  emergency contact) are ChaCha20-Poly1305 encrypted via a versioned
  `EncryptionKeyring`, keyed by an env-var-sourced key that survives
  restarts (`api/src/encryption_keyring.rs`). National ID is stored as a
  keyed HMAC-style digest, not the raw number or a bare hash
  (`api/src/support.rs::hash_national_id`).
- **Access control**: role-based (Admin > Doctor/Nurse > LabTechnician/
  Pharmacist > Patient-read-own-only), enforced server-side against a
  server-controlled role store — never a client-supplied header
  (`api/src/support.rs::get_user`'s doc comment states this invariant
  explicitly).
- **Consent**: a dedicated consent-record system
  (`clinical_endpoints/workflow/compliance.rs::sign_consent`) requiring the
  patient, an Admin, or a permission-holding verified guardian
  (`GuardianRelationshipRepository`) — not a blanket provider-role check.
- **Guardian/pediatric protections**: guardian relationships are
  Admin-verified (not self-declared), permission-granular (view/consent/
  book-appointments/etc. are separate grants, not an all-or-nothing flag),
  and time-limitable (`expires_at`, for foster-care-style placements) — see
  this session's guardian-relationship work.
- **Audit logging**: every access is logged (`AccessLogEntity`), with a
  TOCTOU-safe atomic recording path (`record_access_atomic`) and a
  data-retention-policy system (`data_retention_policies`,
  `retention_job_runs`) governing how long logs are kept.
- **Breach notification**: a working, tested path from breach declaration
  (`POST /api/admin/security/breach`, Admin+MFA gated) through a 72-hour
  POPIA notification clock to actual dispatch (SMS to a security officer,
  email to the regulator/data subjects) — see
  `.horizon/evidence-private/HZ-WP8-HLTH-003/notes.md` for the full trace.
  One disclosed gap: real SMTP delivery is a scaffold pending a production
  mail provider (logs the email rather than sending it until
  `SMTP_ENABLED=true` and real credentials are configured).
- **Emergency access**: a documented, time-limited ("break-glass") path with
  its own audit trail — reviewed under this same campaign's WP1-6 static
  passes (see `.horizon/coverage-ledger.csv` rows tagged `emergency-access`).
- **Data minimization**: reviewed this session (HZ-WP8-PRIV-001, passed) —
  one real gap found and fully remediated (`HZ-014`: a dead, unencrypted
  staff-profile write path was deleted outright, not just documented).

## 4. Known, disclosed gaps (not hidden, need a legal judgment call)

- **National-ID verification** falls back to a stub (non-live) verifier
  when a country's real API key isn't configured (`HZ-004`, this campaign)
  — loudly logged at boot, not silent, but means identity verification
  isn't always checking a live government system.
- **On-chain fields**: `blood_type` (medical-records pallet) and
  `organ_donor`/`dnr_status` (patient-identity pallet) are stored in the
  clear on the Substrate blockchain, not hashed — a deliberate, documented
  exception (`HZ-003`, this campaign) for instant offline paramedic access.
  Accepted residual risk: re-identification if an on-chain account is ever
  correlated to a real identity. **This is the single item most likely to
  need explicit legal sign-off** — it's a genuine, intentional deviation
  from "hash everything on-chain," made for a life-safety reason, and POPIA
  counsel should confirm this tradeoff is acceptable as designed.
- **Third-party processors**: Africa's Talking (SMS), national-ID provider
  APIs (Fayda, Ghana Card, etc.), and any IPFS pinning service are all
  third parties that would need their own data-processing agreements if/when
  used with real data — this campaign's authorization scope explicitly
  excludes testing them, but a production deployment needs those agreements
  in place, which is outside what source review can confirm.
- **Cross-border data flows**: MediChain targets multiple African
  jurisdictions (Ethiopia/Fayda, Ghana/Ghana Card, Kenya/Huduma, etc.) in
  addition to South Africa — a full legal review likely needs to consider
  each target jurisdiction's own data-protection regime, not POPIA alone.
  This briefing is South-Africa/POPIA-focused because that's what the
  existing `docs/INCIDENT_RESPONSE.md` and `authorization-scope.json`
  already scope to; flagged as a gap in the briefing itself, not just the
  code.

## 5. Specific questions for the reviewer

1. Does the on-chain plaintext `blood_type`/`organ_donor`/`dnr_status`
   exception (§4) meet POPIA's "appropriate technical and organisational
   measures" bar given its documented justification and accepted residual
   risk, or does it need additional mitigation (e.g. a legal basis
   memorandum, additional on-chain access restrictions) before any real
   (non-synthetic) data touches it?
2. Is the current consent model (§3) sufficient for POPIA's conditions for
   lawful processing of special personal information (health data generally
   needs an explicit legal basis beyond simple consent — e.g. medical
   treatment, public health, or vital-interest grounds) — or does the
   consent-record system need to capture *which* legal basis applies per
   record, not just "consent given: true/false"?
3. Does the guardian-relationship model (Admin-verified, permission-scoped,
   time-limited) meet the bar for processing a minor's special personal
   information under POPIA §34-35 (children's information provisions)?
4. What retention period should `data_retention_policies` actually enforce
   for each data category (§2), and does the current
   `retention_job_runs`/deletion mechanism satisfy POPIA's "retain no longer
   than necessary" requirement in its current (not-yet-activated in
   production) form?
5. Does authorizing a synthetic-data, isolated-environment security test
   campaign (this campaign, WP7/WP8) require any formal documentation beyond
   what already exists in `.horizon/authorization-scope.json`, given the
   target system's data classification?
6. Is a named Information Officer (POPIA requires one) already designated
   for MediChain, and is that name/contact recorded anywhere durable (the
   incident-response doc explicitly says contact rosters belong in a secure
   ops vault, not the repository)?

## 6. What this briefing does NOT do

It does not review MediChain's actual deployment/hosting arrangements,
data-processing agreements with any third party, insurance/liability
coverage, or the legal sufficiency of any consent-form *language* shown to
real patients (only the code path that records a consent decision was
reviewed). Those are squarely legal/business decisions requiring documents
this source-tree review has no visibility into.
