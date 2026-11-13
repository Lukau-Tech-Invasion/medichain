# Full Application Verification Report

## Executive Summary

## Environment

Windows 11 Home Single Language, PowerShell, Node 24.12.0, npm 11.11.0, Cargo 1.92.0, Docker 29.7.2. An isolated PostgreSQL 16 container (`medichain_horizon_postgres`) ran on `127.0.0.1:55432`. Its pre-existing database had 94 applied migrations. A new database, `medichain_verify_20261004`, was created for this run and migrated from empty to all 129 SQL files; 129 succeeded and 0 failed. It has 167 public base tables and 137 foreign keys. A current-source executable produced at `target/debug/deps/medichain_api.exe` started successfully on port 8091 against this database. Cargo could not replace the older, still-running port-8090 executable (`Access is denied`), so the conventional `cargo build` command exited 1 despite producing the current-source executable. No production or third-party endpoint was exercised. Free C: space fell to about 0.6 GiB during linking; automatic approval review blocked removal of the build-generated PDB.

**Environment incidents:** At 20:26 UTC, parallel API tests exhausted the PostgreSQL container's 64 MiB `/dev/shm`; the service recovered and later focused database tests passed. On 2026-10-05, the new Rust bootstrap test failed during linking with `rustc-LLVM ERROR: IO failure on output stream: no space on device`; about 0.1 GiB remained on C:. Neither incident proves an application defect.

## Architecture Discovered

## Feature Inventory

The 17 significant capability groups below cover the current product surface. They are coarse groups: this is not an assertion that each of the 487 routes or every page was exercised. The backend declares seven roles: Admin, Doctor, Nurse, LabTechnician, Pharmacist, Paramedic and Patient. Background jobs include one-time patient-name indexing, audit sealing/export, medication and appointment reminders, daily report-only retention assessment, and optional deferred emergency-audit replay. The client also has an offline operation queue. PostgreSQL is the durable store; there is no separate Redis or Kafka service in the base stack.

| Feature | Backend | Frontend | Database | Auth | Automated test in this run | Manual/runtime in this run | Status |
|---|---|---|---|---|---|---|---|
| Bootstrap and staff accounts | Account-admin handlers | Admin screens | Users and credential grants | Bootstrap secret/admin | API suite incomplete | Fresh-db `POST /api/auth/bootstrap` returned 409; zero credentialed users | FAIL |
| Password login and sessions | Credential and JWT handlers | Both apps | Users and sessions | Password proof/JWT | Frontend suites and API suite | No source-matched login | PARTIAL |
| MFA and Class B assurance | Auth handlers | Staff step-up dialog | Challenges/sessions | MFA/step-up | Frontend suite, API suite running | No full privileged action | PARTIAL |
| Class C exact-intent authorization | Challenge endpoints and `authorize_transaction` | Staff authorization dialog | Challenge rows | Exact action/body/resource | Module tests in API suite | No mutation consumes it; ADR-0008 says handler policy awaits clinical governance | OWNER-GATED |
| RBAC and patient scope | Handler guards | Role routes | Patient/actor links | Seven roles | 512-handler static scan | No cross-role API attempt | PARTIAL |
| Patient registration and identity | Registration/identity handlers | Staff registration and patient activation | Patients, accounts, grants | Staff write/patient activation | Eight stale in-memory API tests fail; suite running | No UI-to-DB activation | PARTIAL |
| Emergency ID, NFC and break-glass | Medical ID and emergency handlers | Responder/staff and patient screens | Capsules, devices, grants, access logs | Scoped capability/role | API suite running | No emergency disclosure journey | PARTIAL |
| Consent and access history | Consent/access handlers | Patient consent and history screens | Consent, requests, grants, audit | Patient/clinician scope | Frontend suites | No grant/revoke/read-back | PARTIAL |
| Clinical charting and diagnostics | Clinical endpoint domains | Staff chart pages | Clinical tables | Staff/patient scope | API suite running, frontend suites | No write/read/restart journey | PARTIAL |
| Pharmacy and blood bank | Prescription and blood-bank handlers | Staff pharmacy/blood-bank pages | Dispense and blood-bank tables | Pharmacist/lab roles | Latest Blood Bank component tests pass | No dispense or transfusion journey | PARTIAL |
| Appointments and telehealth | Engagement/telehealth handlers | Both apps | Appointment/session rows | Participant scope | Frontend suites, API suite running | No booking/join journey | PARTIAL |
| Documents and downloads | Encrypted blob/document handlers | Staff/patient records | PostgreSQL encrypted blobs | Authorized read purpose | API suite running, frontend suites | No byte-for-byte upload/download/restart | PARTIAL |
| Messaging and notifications | Message/reminder handlers and jobs | Both apps | Message/notification rows | Recipient scope | Frontend suites, API suite running | No cross-user delivery/read-back | PARTIAL |
| Research and FHIR | Export/FHIR handlers | Research controls | Consent/export/clinical rows | Patient preference and staff role | API suite running, frontend suites | No provider-facing export | PARTIAL |
| Settings and offline sync | Settings and sync handlers | Both apps and offline queue | Profiles/queued operations | Account/session | Frontend suites | No reconnect/replay journey | PARTIAL |
| Audit, retention and operations | Sealing, retention, health, metrics | Status/access screens | Audit batches and job state | Admin/operator | API suite running, static gates | Only health probes on older memory process | PARTIAL |
| External providers and devices | National-ID/SMS/Jitsi/device adapters | Relevant flows | Provider records | Provider credentials | Source inventory only | No qualified third-party sandbox/physical device | BLOCKED |

## Test Coverage Matrix

| Area | Feature | Test Performed | Result | Evidence | Notes |
|---|---|---|---|---|---|
| Patient UI | Component behavior | Full Vitest workspace suite | PASS | Latest run: 38 files, 216 tests passed | No browser-to-database journey in this run. |
| Doctor UI | Component behavior | Full Vitest workspace suite | PASS | Latest run after error-state repair: 114 files, 570 tests passed | Earlier full runs exposed a transient Blood Bank error. |
| Shared client | Type safety | TypeScript check | PASS | `npm run typecheck --workspace=shared`, exit 0 | Static only. |
| Frontend | Typecheck and build | Three workspace typechecks; `npm run build:all` | PASS | All exit 0 | Build emitted chunk-size and dependency-comment warnings. |
| Frontend | ESLint | Doctor, patient and shared lint | PASS WITH WARNINGS | Doctor: 0 errors/15 warnings; latest patient: 0 errors/3 warnings; shared: 0 errors/1 warning | Patient errors were repaired. |
| API | Source compilation | Rust check | PASS | `cargo check -p medichain-api`, exit 0 with 8 warnings | Includes unused transaction-authorization code warnings. |
| API | Strict lint | Clippy all targets/features, deny warnings | FAIL | Duplicate `#[cfg(test)]` at `api/src/startup.rs:701-702`; dead code in migration helpers and transaction authorization | Exit 1. |
| Database | Clean migration | `sqlx migrate run --source api/migrations` on new isolated DB | PASS | 129 applied, 0 failed; SQL query of `_sqlx_migrations` | This proves schema creation, not the clinical read/write journey. |
| API auth | Route guard inventory | Static gate | PARTIAL | `python scripts/check-endpoint-auth.py`: 512 handlers, 0 tier-0/1, 50 unscoped bulk reads | Does not prove tenant isolation dynamically. |
| API storage | In-process clinical state | Static gate | PARTIAL | `python scripts/check-state-durability.py`: 0 production map references | Does not prove actual DB durability. |
| Frontend/API | Route caller inventory | Static scan | PARTIAL | `python scripts/unused-endpoints.py`: 487 routes, 378 frontend-called, 109 uncalled | Uncalled routes require individual disposition; some are intentionally UI-less. |
| Formatting | Rust source | Formatting check | PASS | `cargo fmt --all -- --check`, exit 0 after removal of the credential-bearing debug print. | Formatting only. |
| Runtime | Health/readiness | HTTP GET `/health`, `/health/ready`, `/health/db` on existing process | PARTIAL | 200 health; readiness says `backend=memory`; DB health says `database_connected=false` and data lost on restart | Process/source parity unknown; this process is not a durable clinical stack. |
| Runtime | Current-source PostgreSQL API | Start pre-repair `target/debug/deps/medichain_api.exe` on 8091 | PARTIAL | `/health/ready`: `backend=postgres`, ready; `/health/db`: connected with pool size 8 | This binary predates the bootstrap repair. |

## Automated Test Results

| Command | Executed | Passed | Failed | Skipped | Duration / status |
|---|---:|---:|---:|---:|---|
| `npm run test:run --workspace=patient-app` | 216 | 216 | 0 | 0 | 148.88 s, exit 0 |
| `npm run test:run --workspace=doctor-portal`, first run | 570 | 569 | 1 | 0 | 225.09 s, exit 1 |
| `npm run test:run --workspace=doctor-portal`, repeat | 570 | 569 | 1 | 0 | 143.27 s, exit 1; same assertion |
| Focused `BloodBankPage.test.tsx` | 5 | 4 | 1 | 0 | 6.03 s, exit 1; same assertion |
| `cargo test -p medichain-crypto --quiet` | 27 | 27 | 0 | 0 | 27.75 s, exit 0 |
| `cargo test --bin medichain-api --quiet` | — | — | — | — | Three attempted full runs; eight early in-memory registration-era tests failed consistently. The fresh 12-thread run was stopped after PostgreSQL shared-memory exhaustion and crash recovery. No terminal suite count is claimed. |
| Latest doctor suite after repair | 570 | 570 | 0 | 0 | 114 files, exit 0 on 2026-10-05. |
| Latest patient suite after repair | 216 | 216 | 0 | 0 | 38 files, exit 0 on 2026-10-05. |
| New PostgreSQL bootstrap regression | — | — | — | — | Compilation began, then Rust linker failed because C: had no free space. No test result is claimed. |

The first doctor run and the patient run emitted React Router future warnings. Patient settings tests also logged a research-consent mock response error; the test passed, so this is not yet a confirmed product defect. No skips were reported in the two completed frontend suites or crypto suite.

## User Journey Results

No source-matched, UI → API → database → read-back → restart journey has completed in this run. Prior journey counts are historical and are not reclassified as current PASS.

## API Results

`GET /health` on an existing local process returned 200, but it has not been tied to the current source. `/health/ready` returned 200 with `backend=memory`; `/health/db` returned 200 with `database_connected=false`, `status=degraded` and a warning that state is lost on restart. No authenticated route or negative-path result is yet counted as runtime proof. Playwright discovered 139 doctor tests and 116 patient tests; these were listed, not executed.

The current-source executable on port 8091 returned `backend=postgres`, `ready=true`, and `database_connected=true`. On that API, `GET /api/patients` without a token returned 401; a missing-field registration body returned 400; an invalid bootstrap secret returned 403. With the valid synthetic bootstrap key, a first-admin request returned 409 `BOOTSTRAP_NOT_ALLOWED` on the just-migrated database. The database query showed 12 users, 2 Admins, 0 login IDs and 0 credential verifiers; all five patients have demo IDs. This blocks authenticated browser journeys on a clean deployment and is a confirmed application defect.

## Frontend Results

## Authentication & Authorization

The static guard gate found no handler with no auth decision or mere caller-ID presence. It identified 50 bulk reads that depend on the documented single-organisation posture; dynamic cross-patient and cross-role attempts are still required.

## Database & Persistence

The isolated PostgreSQL service was initially healthy. A new database migrated successfully through the original 129 SQL files, including the pre-existing untracked shift-handoff migration. The new bootstrap migration then applied as version 130. Parallel per-test schema creation later exhausted the container's 64 MiB shared-memory mount; the service recovered. No UI/API create/read/restart comparison has completed in this run. Current catalog inspection shows many user and patient foreign keys with `NO ACTION`, plus `CASCADE`, `SET NULL`, and `RESTRICT` actions. A direct account/patient delete is therefore insufficient for the requested existing-database reset; the migration must account for dependent clinical, session, grant, and audit records and then be tested transactionally on an isolated populated copy.

PostgreSQL recovered and again accepted connections. The migration ledger still reported 129 successful and 0 failed migrations, with 167 public tables. Four focused PostgreSQL tests then passed individually: encrypted-document round-trip, patient-access grant persistence after restart, signed audit batching across both sources, and one-time credential redemption. These are component/integration proofs, not a complete UI journey.

## Security Findings

| Severity | ID | Finding | Evidence and limit |
|---|---|---|---|
| High | FAV-001 | A pre-existing working-tree Compose edit embedded a fixed bootstrap key. | Restored `${MEDICHAIN_BOOTSTRAP_KEY:-}` in source. Runtime deployment configuration not retested. |
| High | FAV-002 | A pre-existing working-tree debug print exposed the full `DATABASE_URL`. | Removed the print in source. Rebuilt startup log not retested. |
| Informational | FAV-003 | Existing local API health reports audit signing `unsigned` and sink `none`. | `/health` response. This is appropriate only for an isolated demo/test posture; production configuration was not tested. |
| High | FAV-005 | Exact Class C transaction authorization is not connected to mutation handlers. | `authorize_transaction` has only same-module test callers. ADR-0008 explicitly defers the handler-by-handler policy to clinical governance; `scripts/check-write-authorization.py` records related unresolved role decisions. Runtime exploitability was not tested. |
| Critical | FAV-009 | Fresh installation cannot bootstrap its first credentialed administrator. | Migrations seed 12 active users and five demo patients unconditionally; no user has a login ID/verifier. Current-source bootstrap returned 409 on the clean migrated DB. |
| Medium | FAV-010 | API reference and setup guides had obsolete authentication and storage contracts. | The authentication and record sections were corrected against `credential_auth.rs`, `account_admin.rs`, `ipfs_records.rs` and `ipfs.rs`. `docs/SETUP_AND_RUNNING.md` now uses bearer-token examples; `POSTGRES_SETUP.md` was rewritten against current Compose, environment, and credential handlers. The OpenAPI file has only 33 documented operations, and other older guide sections still require review. |
| Medium | FAV-011 | Document and insurance-card failures exposed raw storage or repository error text in HTTP responses. | `api/src/handlers/ipfs_records.rs` and `insurance_cards.rs` returned internal error strings in several 500 branches. The source fix now logs details server-side and returns stable messages; runtime response tests remain pending. |
| High | FAV-012 | Browser fixture provisioning used the wrong first-admin protocol and an embedded fallback bootstrap key. | The script sent `auth_proof` to bootstrap and attempted login without redeeming its returned one-time code. It now requires the operator's `MEDICHAIN_BOOTSTRAP_KEY` and redeems the code. Syntax transpilation passes; live provisioning is unverified. |

## Bugs Found

| ID | Severity | Feature | Reproduction | Expected | Actual | Root cause | Fix | Verification status |
|---|---|---|---|---|---|---|---|---|
| FAV-001 | High | First-admin bootstrap configuration | Inspect effective Compose environment and bootstrap handler | Secret injected from deployment configuration | Fixed key in working-tree Compose | Literal replaced the environment pass-through | Restored environment pass-through | Source fixed; runtime retest pending |
| FAV-002 | High | Startup logging | Inspect `initialise_storage` | Never log credential-bearing connection strings | Full URL printed in debug line | Pre-existing uncommitted print | Removed line | Source fixed; runtime retest pending |
| FAV-004 | Medium | Blood Bank load error | Run full doctor suite with malformed register response | Persistent visible error | Earlier `findByText` resolved then element disappeared | Follow-up request cleared the first error | Latest request wins and loading does not clear a visible error | Latest focused 5/5 and full doctor 570/570 pass |
| FAV-005 | High | Class C exact-intent authorization | Trace `authorize_transaction` callers and ADR-0008 | Approved privileged mutations consume an exact challenge | No handler caller found | ADR-0008 deliberately defers the handler matrix to clinical governance | Obtain an approved matrix, then wire named mutations and test changed-body, changed-resource and replay denial | Owner-gated; source confirmed, runtime unverified |
| FAV-006 | Medium | Patient lint gate | Run `npm run lint --workspace=patient-app` | Zero lint errors | Unused disable directive and raw control-range regex failed | Stale directive and validator/rule mismatch | Fixed directive placement and preserved control-character sanitization | Latest lint: 0 errors, 3 warnings; typecheck and 216 tests pass |
| FAV-007 | Low | Strict Rust lint | Run `cargo clippy --all-targets --all-features -- -D warnings` | Clean lint | Duplicate `#[cfg(test)]` at `startup.rs:701-702` and unused code warnings failed the gate | Duplicated annotation; disconnected or obsolete code | Duplicate annotation removed; dead paths still require disposition | Source partially fixed; strict gate not rerun |
| FAV-008 | Medium | API test fixtures | Run registration-dependent `api_tests.rs` tests | Fixture matches durable registration design | Eight tests expect memory-only registration to succeed; handler correctly returns `PATIENT_REGISTRATION_UNAVAILABLE` | Tests predate the atomic account/activation/audit storage rule | Exercise registration with a real isolated PostgreSQL fixture and retain a memory-backend denial test | Reproduced on old and fresh DB runs; unfixed |
| FAV-009 | Critical | First-run provisioning | Migrate an empty DB, query users/credentials, then POST bootstrap with a valid synthetic key | No credentialless demo accounts in production; first admin can be provisioned once | 12 active demo users, 0 credentials, 2 Admins; bootstrap returns 409 | Unconditional legacy demo seeds in `20240121000001_initial_schema.sql` and `20260126000001_demo_patients.sql`; bootstrap rejects any existing non-system user | Forward-only, narrowly scoped migration and first-run policy repair, with populated-database safety and browser-seed regression tests | Reproduced on current-source API; unfixed |
| FAV-010 | Medium | API documentation | Compare published examples with registered auth and record handlers | Credential login, bearer/session authentication and document storage described accurately | Older OpenAPI and Markdown reference described retired identity and IPFS-only flows | Docs predate ADR-0010 Phase C and PostgreSQL document storage | Reconcile remaining request/response schemas and expand route coverage from source | Authentication and record-storage sections corrected; YAML parses, 0 unresolved schema refs, and all 33 documented method/path pairs registered; remaining clinical schemas and most routes unverified |
| FAV-011 | Medium | Document and insurance-card error handling | Inspect upload/download and repository error branches | Raw storage errors stay in server logs; clients get stable messages | Storage/repository errors were formatted into HTTP 500 bodies | Handlers returned internal exception text | Centralize insurance-card repository failures, log details and return generic storage messages | Source fixed; `cargo check -p medichain-api` and `cargo fmt --check` pass; runtime response unverified |
| FAV-012 | High | Browser fixture first-admin setup | Compare fixture request sequence with bootstrap and redeem handlers | Operator-supplied key, bootstrap, code redemption, then authenticated fixture writes | Embedded fallback key was rejected by the API length check; script sent an ignored proof and then tried login before redeeming the issued code | Fixture script lagged the credential bootstrap contract | Require `MEDICHAIN_BOOTSTRAP_KEY`, redeem returned code, use resulting token | Source fixed; TypeScript transpilation has zero diagnostics; no live fixture run |

## Missing or Incomplete Features

## Tests Added

A PostgreSQL bootstrap guard regression test was added in `api/src/handlers/account_admin.rs`. It checks that an unchanged legacy seed does not block first provisioning while an unrelated user or a claimed seed does. The test could not link because C: ran out of space, so it is unverified. The checkout also contains a pre-existing untracked patient audit-trail browser spec, which was not modified here.

## Remaining Risks

## Final Verdict

### Numerical totals for this run

These are current measured totals, not a substitute for a 487-route disposition: 17 significant feature groups assessed; 0 verified end to end; 14 partial, 1 runtime-confirmed first-run failure before repair, 1 blocked by external qualification, and 1 owner-gated (Class C exact-intent consumption). The latest complete doctor suite passed 570/570, patient suite passed 216/216, crypto crate passed 27/27, and four focused PostgreSQL tests passed. Earlier failed runs remain in the table above. The 931-case API suite and the new bootstrap test have no terminal passing result. Twelve findings are recorded; six have source fixes (FAV-001, FAV-002, FAV-004, FAV-006, FAV-011, FAV-012), two are partially repaired (FAV-007, FAV-010), and the remainder are open. Disk exhaustion and PostgreSQL shared-memory exhaustion are separate environment incidents.

### Prioritized next actions

1. **P0:** Repair fresh-install provisioning and demo-data isolation with a forward-only migration and a checked bootstrap/login journey on an empty database.
2. **P1:** Validate secure bootstrap-key injection and startup logs in a rebuilt deployment; source fixes are in place.
3. **P1:** Obtain clinical-governance approval of the handler assurance matrix, then connect Class C to named mutations and test changed-body, changed-resource and replay denial.
4. **P1:** Increase the isolated test container's shared memory, finish the full API suite, and move registration-dependent API tests onto a durable fixture without weakening the fail-closed behavior.
5. **P1:** After account provisioning works, run role, cross-role and browser journeys with persistence/read-back/restart evidence.
6. **P2:** Confirm the Blood Bank and patient lint source fixes through browser journeys; latest component and lint suites pass.
7. **P2:** Verify background sealing/export, SSE, document integrity, failure paths and all remaining significant routes.
9. **P3:** Reconcile remaining source documentation and warnings after the identity transition.
