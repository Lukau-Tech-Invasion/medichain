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

## Current verdict

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
