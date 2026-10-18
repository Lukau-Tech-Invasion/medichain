# Changelog

All notable changes to MediChain are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project is
pre-1.0 and does not yet make compatibility guarantees.

## [Unreleased]

### Added (2026-10-18/19)
- `AUDIT_CHECKPOINT_SINK=s3`: sealed checkpoints written once per batch to an
  S3 bucket under Object Lock (`If-None-Match`, SHA-256 integrity header),
  credentials from the environment or the EC2 instance role.
- AWS deployment: `infra/aws/medichain.yaml` (af-south-1), `budget.yaml`,
  `deploy.sh`, `RUNBOOK.md`, cfn-guard rules, `docker-compose.aws.yml` with
  Caddy TLS and an S3 pgBackRest repository.
- ADR-0008 Class C phase 1: consequential actions confirmed per request.
- Patient-readable medication administrations and emergency care (code blue,
  trauma, stroke, cardiac, sepsis) in My Records.
- Print previews for SOAP notes, progress notes and answered consults.
- Browser coverage: an all-routes spec per portal, eleven workflow specs and
  print checks.

### Changed (2026-10-18/19)
- The 143 historical migrations are one schema baseline
  (`api/migrations/20261019000000_baseline.sql`); a database that applied the
  full history adopts it at startup.
- The nurse's medication record lists medication the pharmacy has received,
  filled or dispensed, for every patient (it stopped at 50 and dropped
  dispensed drugs).
- Signing in from a deep link returns to the page that was asked for.
- Page modals are real dialogs (focus, Escape, names); unlabelled form
  controls on 23 pages are labelled; critical vital signs are flagged in words.
- CSV exports quote every cell and neutralise spreadsheet formulas.
- The offline medical ID cache is cleared when a session ends.

### Fixed (2026-10-18/19)
- A clinician's record list or document download under a patient's grant is
  recorded against that grant, so the grant's disclosure count is no longer 0.
- Escape closes a dialog even after the control that had focus is gone, and
  closes only the topmost of two.
- "View Front/Back" on an insurance card shows the stored photo instead of only
  offering a new upload.
- Completing a specimen recollection keeps its confirmation on screen after the
  row leaves the open list.
- The operative-note history names the surgeon instead of showing a user id.

### Added (2026-09-29, ADR-0010)
- The sealed audit stream: `access_logs` and `audit_events` rows are
  Merkle-batched, hash-chained, signed with Ed25519 and exported as checkpoints
  by the single-instance job. New `AUDIT_SEAL_SIGNING_KEY`,
  `AUDIT_CHECKPOINT_SINK` and `AUDIT_CHECKPOINT_DIR` configuration, an
  `audit_checkpoints` volume, `seal_status` on API responses and an `audit_seal`
  block on `GET /api/health`. See `docs/AUDIT_LOG.md`.

### Added
- Emergency capsule with a sealed commitment: versioned, revocable, encrypted
  under the server keyring, with field-level access logging and integrity
  verification on every break-glass read.
- Children's Act §129 mature-minor consent enforcement — age verified against the
  patient's recorded date of birth, with a required clinical maturity finding.
- Approval-gated retention execution: digest-bound approval tokens, processing
  restriction, and a deletion register carrying no clinical payload.
- Architecture Decision Records under `docs/adr/`.
- C4 and sequence diagrams in `docs/architecture.md`.
- `SECURITY.md`, `CONTRIBUTING.md`, `docs/SECURITY_ASSESSMENT.md`,
  `docs/GOVERNANCE_RECORD.md`, `docs/TECHNICAL_DEBT_REGISTER.md`.
- Synthetic end-to-end test harness (`scripts/synthetic-e2e-test.sh`, 40 assertions).

### Changed
- Company renamed to Lukau Invasion (Pty) Ltd throughout.
- `sqlx` upgraded 0.7.4 → 0.8.6, closing a reachable advisory (RUSTSEC-2024-0363).
- Retention assessment now distinguishes "did not run" from "found nothing"; the
  report endpoint returns 503 rather than reporting success for an assessment that
  could not complete.
- Dependency advisories triaged individually by reachability.

### Removed
- Plaintext `blood_type`, `organ_donor` and `dnr_status` from immutable storage,
  and the events that republished them.
- Unreachable code holding staff personal data in plaintext.

### Fixed
- `ConsentGiverCapacity` wire format did not match its stored format, which meant
  the Children's Act consent checks were unreachable — requests were rejected
  during deserialisation before those checks ran.
- Emergency capsule revocation was not idempotent in the in-memory backend,
  allowing a second revoke to overwrite the original revocation's attribution.
- Test isolation: two tests raced on a process-global environment variable.
- Isolated test environment did not isolate — `container_name` is global in Docker
  Compose and `ports: []` does not override a merged list.

### Security
- Internal security assessment conducted against an isolated, synthetic-data-only
  environment. Process and outcomes: `docs/SECURITY_ASSESSMENT.md`.

## [0.1.0] — 2026-01

### Added
- Initial submission for the Rust Africa Hackathon 2026: patient identity,
  medical records and access control; Rust/Actix-web API; React doctor and
  patient applications.
