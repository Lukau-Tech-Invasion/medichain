# Browser full-application audit — 2026-08-19

## Scope and evidence rules

This is a new audit record. It does not replace `docs/FEATURE_END_TO_END_AUDIT.md`,
`docs/PRODUCTION_READINESS.md`, or the Horizon campaign ledger. It records only
observations reproduced in the locally running Docker stack on 2026-08-19.

- Target: local Docker Compose application at `http://localhost`.
- Data: synthetic demo identity only; no real patient data and no third-party services.
- Browser: Codex in-app browser.
- Required roles: patient, doctor, nurse.
- Completion standard: every interactive control must be catalogued, assigned to a
  role/workflow, and marked `passed`, `failed`, `blocked`, or `not-applicable` with
  browser evidence. A rendered page or a unit test is not completion.

## Update — 2026-08-20: the blocker is cleared

**Doctor and nurse browser workflows can now be started.** The verdict below is
retained as the record of what was blocked and why; this section supersedes it.

`scripts/seed-browser-test-fixtures.ts` provisions real accounts through the
product's own onboarding path — no demo bypass is enabled in the image, which is
what remediation step 1 required. It imports `client/shared/src/auth/credentials.ts`,
so the fixture password is turned into an auth proof and an encrypted keystore by
exactly the code a later sign-in verifies; a seed that wrote its own row would
drift from the login it exists to exercise.

Run against a local deployment:

```bash
MEDICHAIN_ADMIN_WALLET=<existing-admin> npx vite-node scripts/seed-browser-test-fixtures.ts
```

It writes `.browser-test/fixtures.json` (git-ignored) and **proves each fixture
before exiting**: every staff identifier signs in, the patient wallet reads its
own record, and `linked_patient_id` is asserted to equal the seeded record.

| ID | Status now | Evidence |
|---|---|---|
| BFA-003 | **Resolved** | `bt.doctor` signs in at `/doctor/` and reaches the dashboard as "Dr Browser Test". |
| BFA-007 | **Resolved** | `bt.nurse` is provisioned identically and passes the same sign-in preflight. |
| BFA-006 | **Resolved** | `useSSE` no longer connects as `anonymous`. `GET /api/events` returns 200 after sign-in; the pre-auth 401 and its 5-second retry loop are gone. |
| BFA-005 | **Addressed; browser re-check pending** | The seed asserts the wallet→record binding, so a fixture whose dashboard would fall back to a generated identity fails provisioning instead of misleading a tester. |
| Admin | **Resolved** | See below — it needed a real product fix, not a workaround. |

### The admin fixture, and the product bug behind it

Creating an admin fixture looked impossible against an existing database:
`/api/auth/bootstrap` is once-only and `assign_role` refuses to grant `Admin` —
both correct controls that should stay. The obvious workarounds (loosen one of
them, or insert a row) would each have weakened a real boundary.

Pulling on it instead surfaced a genuine product limitation. The seeded
administrator is `//Alice`, whose key is published in the Substrate source — so
its credentials *can* legitimately be enrolled. Except they could not be: the
credential keystore stored a **32-byte mini-secret** and rebuilt the account with
`sr25519PairFromSeed`, which only reproduces accounts derived straight from a
seed. `//Alice` comes from a derivation path and has no such mini-secret.

That is not an Alice problem. **Any clinician whose wallet uses a derivation
path could not use credential sign-in** — and derivation paths are what the
Polkadot extension produces. Enrolment appeared to succeed, then unlocked a
different account, and login failed with "your stored key does not match this
account" and no explanation.

Fixed by `KEYSTORE_VERSION = 2`: the envelope now carries either a 32-byte
mini-secret or a 64-byte secret key, tagged with `kind`. v1 envelopes still open
(absent `kind` means `seed`), so no enrolled clinician is locked out. Covered by
`client/doctor-portal/src/store/credentialKeystore.test.ts` — seed account, path
account, v1 compatibility, wrong password, and the malformed-input refusals.

**A control was added alongside it, not weakened.**
`startup::validate_no_privileged_dev_accounts` now refuses to boot a non-demo
instance where any well-known Substrate development account (`//Alice`
… `//Ferdie`, derived rather than hardcoded) holds a privileged role. Their
secrets are public, so seeding one as an active `Admin` means anyone who has
read the Substrate docs is an administrator of that deployment. `blockchain.rs`
already guarded the chain *signer*; nothing guarded the *user table*. Deriving
Alice's key for a fixture is safe precisely because production can no longer
have her.

### A trap this exposed

The first browser pass reported three defects that were **already fixed in
source** — a dashboard showing 0 patients, literal `{{gender}}`/`{{id}}`
placeholders, and every blood type as "Unknown". The running images were five
days old. `docker compose up` reuses whatever image exists and nothing in the UI
reveals its age.

Before treating anything seen in the browser as a live defect, check
`docker images` and rebuild **both** services — `client/Dockerfile` builds the
two portals into the `nginx` service, so rebuilding `api` alone leaves the
frontend stale.

### Defects the first authenticated pass found

Real, and fixed:

- **Credential sign-in could never obtain a JWT.** `u8aToHex` emits the
  canonical `0x` prefix; `medichain_crypto::from_hex` rejected it, so a valid
  sr25519 signature failed at the hex decoder and surfaced as
  `SIGNATURE_VERIFICATION_FAILED`. Demo mode hid it behind the `X-User-Id`
  fallback — with `REQUIRE_SIGNATURES=true` the whole employee-ID login path was
  unusable. Fixed in `crypto/src/lib.rs` with regression coverage at both the
  decoder and the signature layer.
- **Doctor dashboard rendered its own alerts wrongly.** `CriticalValue` and
  `PhysicianOrder` declared `critical_reason`/`reported_at` and
  `order_id`/`description`/`ordered_at`; the API sends none of those. A
  potassium of 6.9 displayed as `6.9000 -` with no unit and "Invalid Date", and
  every order as a bare `lab:`. A lowercase `stat` priority also never matched
  the `'STAT'` comparison, so the most urgent orders rendered in neutral grey.
- **The analytics dashboard reported a hospital with 0 patients.** Beneath the
  twelve fabricated KPIs (above), the four *real* tiles read
  `data.patient_metrics.total_patients`, `data.appointment_metrics`,
  `data.cds_metrics` and `data.financial_metrics` — four shapes the API has
  never sent. Every lookup was `undefined`, every `|| 0` fallback fired, and an
  administrator saw **0 patients / 0 appointments / 0 alerts** against a
  database holding 7 active patients and 63 appointments. So the page had
  invented figures on top and false zeros underneath, and the false zeros were
  the more dangerous half: a fabricated 94% invites scepticism, "0 patients"
  reads as a fact about the hospital. Now 7 and 63, matching `curl`.
  `AnalyticsPage.test.tsx` had mocked the same invented contract, so the test
  agreed with the bug; its fixtures are now copied from real responses.
- **The period selector changed nothing.** "Today / This Week / This Month /
  This Year" posted a date range that
  `get_appointment_analytics` bound to `_query` and ignored, so every period
  rendered identical figures. The endpoint now honours `start_date`/`end_date`.
- **Telehealth recording could be started by a pharmacist.** The gate asked
  `is_healthcare_provider()` (true for Pharmacist and LabTechnician) while the
  Jitsi JWT's moderator claim, set by `role_is_moderator()`, correctly excluded
  them — two definitions of "moderator" in one feature, and the
  security-relevant one was the wider. Collapsed to a single definition.
- **Joining a consultation wrote no audit row.** Recording start and stop both
  audited; joining did not. A provider could sit in a patient's video visit
  leaving no trace, in the system whose central claim is a tamper-evident
  access trail. The recording rows also filed `accessor_role: "moderator"` — not
  a real role, so they fell outside every role-based audit query.

## Original verdict (2026-08-19)

**BLOCKED — doctor and nurse browser workflows cannot be started in the live image.**

The patient demo wallet can sign in. The clinician portal exposes only (1) a
username/password form and (2) an external-wallet-extension option. The demo
identity buttons exist in source but are compiled behind the development-only
`FEATURES.DEMO_WALLET_GENERATION` flag, so they are absent from the Docker image.
The inspected `users.password_hash` model is intentionally not used by application
code, and no documented synthetic staff credentials are available. The wallet
extension is unavailable in this isolated test browser.

This prevents an honest claim that doctor or nurse screens, buttons, permissions,
and workflows are browser-tested.

## Reproduced observations

| ID | Role / flow | Browser observation | Status |
|---|---|---|---|
| BFA-001 | Doctor credential entry | `dr.mbeki` plus a synthetic invalid password returns a clear generic error: “That identifier and password combination was not recognised.” No console error was emitted. | Passed negative path |
| BFA-002 | Doctor wallet extension | The only alternative sign-in reports: “No Polkadot extension found. Please install Polkadot.js or Talisman.” | Blocked by test environment |
| BFA-003 | Doctor demo login | No demo-user controls are rendered in the production Docker image, despite `LoginPage.tsx` declaring doctor and nurse demo users. | Failed testability / release-demo readiness |
| BFA-004 | Patient wallet entry | The synthetic Thabo wallet signs in and reaches `/patient/dashboard`. | Passed entry path |
| BFA-005 | Patient dashboard truthfulness | The signed-in dashboard labels the session `Demo`, presents `Hello, Pat`, a generated ID, `Unknown` blood type, and zero allergies/medications. This is not proof that the intended seeded patient record is bound and read. | Candidate functional defect |
| BFA-006 | Patient login realtime | Browser console recorded `SSE connection failed: 401 Unauthorized` during the login journey. | Candidate functional defect |
| BFA-007 | Nurse login | Nurse identity controls are likewise absent; no independent nurse sign-in route or fixture credential is exposed. | Blocked |

## Required remediation plan before broad UI testing

1. Create an **isolated browser-test auth profile**, separate from production,
   that supplies one signed-in synthetic identity for Doctor, Nurse, and Patient.
   It must use a dedicated Compose override, synthetic-only seed data, and expiry/
   teardown instructions. Do not enable demo bypasses in the production image.
2. Make the role fixture contract explicit: fixture wallet, role, linked patient ID,
   supported sign-in method, and expected dashboard data. Add a startup preflight
   that fails the browser-test profile if any link is missing.
3. Fix or deliberately suppress unauthenticated SSE startup. The client must not
   attempt a protected event stream before an authenticated session exists, and it
   must reconnect after sign-in. Add browser coverage for both conditions.
4. Trace the patient wallet-to-patient-record link. The dashboard must either show
   the linked synthetic record's data or render an explicit empty/error state; it
   must never silently substitute a generated demo identity for a claimed fixture.
5. Once steps 1–4 are accepted and implemented, execute the role-by-role ledger
   below one workflow at a time. Every mutation requires a synthetic canary record,
   API/read-back assertion, and cleanup plan.

## Coverage ledger

| Ledger group | Required proof | Current state |
|---|---|---|
| Doctor authentication and dashboard | Sign in, role verified, roster renders actual synthetic patients, logout and session expiry verified | Blocked by BFA-003 |
| Doctor clinical workflows | Each form validation, save, read-back, denied action, audit event, and print/export path | Not started |
| Nurse authentication and dashboard | Sign in, assigned work queue, permitted documentation, forbidden prescription path, logout | Blocked by BFA-007 |
| Nurse clinical workflows | Triage, vital signs, care plan, MAR, handoff, escalation, error states | Not started |
| Patient authentication and dashboard | Wallet login, correct linked record, no pre-auth SSE error, logout | Partial; BFA-005/BFA-006 open |
| Patient self-service workflows | Records, consent, appointments, messages, profile, emergency card, settings, offline/error states | Not started |
| Cross-role workflows | Doctor creates data -> nurse acts -> patient views/audits; authorization denials verified | Blocked by clinician access |
| Accessibility and layout | Keyboard-only navigation, visible focus, label semantics, mobile/desktop screenshots, error/empty states | Not started |

## Definition of “fully browser tested”

The application is fully browser tested only when every row above has a dated
evidence record containing: role fixture, initial state, action/control, expected
result, visible result, console/network errors, durable API read-back where
applicable, and cleanup result. Blocked rows remain visible in the final report;
they cannot be counted as passed.
