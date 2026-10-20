# Changelog

All notable changes to MediChain are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project is
pre-1.0 and does not yet make compatibility guarantees.

## [Unreleased]

### Fixed (2026-10-20)
- Notifications have New and History. Read state was a single "read up to"
  marker that only "Mark all as read" moved, so opening a notification left it
  new forever. Opening or marking one read now moves it to History, and each
  can be removed from that person's list (`POST
  /api/notifications/{type:id}/read`, `.../remove`). Removing hides it for that
  account only: the record it describes and its audit trail are untouched, and
  nobody else's list changes. A mark covers the entry as it was, so an
  aggregate such as "6 lab results awaiting approval" is new again when it
  changes.
- Medication reminders fire on the clinic's clock (`CLINIC_TIMEZONE`, now
  `Africa/Johannesburg` on AWS); they were compared against UTC and arrived two
  hours late.
- Notifications reach the account they are for. Every real-time event went
  to every staff and administrator connection, so a doctor setting a
  patient's medication reminder put "Time to take" on the administrator's
  screen and every clinician's. Events now carry an audience: reminders to
  the patient only; clinical alerts to the patient and the clinicians treating
  them (patient grant, care relationship or break-glass); telehealth events to
  the consultation's clinician and patient; security alerts to administrators.
  An event without an audience reaches nobody. The bell list likewise shows a
  clinician only their own patients' critical values and code blues, and
  shows an administrator no clinical items. `POST
  /api/telehealth/sessions/{id}/event` now refuses anyone outside the
  consultation (it accepted events for any session from anyone signed in).

### Added (2026-10-20)
- Emergency access by camera. The emergency screen's QR option opens the
  phone's back camera or the laptop webcam (with the browser's permission
  prompt) and reads the code itself: `BarcodeDetector` where the browser has
  one, jsQR elsewhere (Windows Chrome has none). It previously offered only a
  text box for pasting the code's JSON.
- The patient's Medical ID QR carries `emergency_proof`, an HMAC the server
  mints over the patient id. `POST /api/emergency/access` accepts it in place
  of an NFC tag id (`patient_id` + `qr_proof`), under the same device, work
  context, grant and audit; a patient id without its proof is refused
  (`QR_PROOF_INVALID`), since patient ids appear in every chart URL. QR codes
  downloaded earlier carry no proof: patients re-download. When the server is
  unreachable the screen shows the summary printed in the code, labelled as
  unverified and unrecorded.

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

### Security (2026-10-19)
- Passwords are checked by the server when set (ADR-0011): 15-128 characters,
  not common or decorated-common, not a keyboard run, not the person's name or
  login ID, and not in Pwned Passwords (k-anonymity). Activation, recovery and
  change send the password once; sign-in still sends only a proof.
- A body holding a password is left out of the stored idempotency digest.

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
- Patients can change their password (the Settings row did nothing).
- Registering a login ID already in use answers 409 instead of 503.
- Appointment actions and the dashboard code-blue panel meet contrast in dark mode.

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
