# MediChain Remediation Ledger — 2026-08-22

This ledger supersedes no historical audit.  It records current implementation
and validation evidence from the remediation campaign.  Status values are
deliberately restricted to `CONFIRMED FIXED`, `PARTIALLY FIXED`, `STILL
PRESENT`, and `UNKNOWN`.

## Evidence posture

| Evidence layer | Current coverage |
| --- | --- |
| Deep Scan | 0 files; tooling unavailable |
| Manual source coverage | Measured separately per finding below |
| Runtime/API adversarial | Recorded per finding below |
| Browser workflows | Bounded live coverage: public landing, clinician credential-entry/alternate-sign-in access, and an already-authenticated synthetic patient session across nine read/navigation routes plus dashboard reload persistence. On 2026-08-24, the public landing and clinician entry flow rendered with no console warnings/errors; selecting the unavailable Polkadot-extension path showed its explicit error state (“No Polkadot extension found…”) with no console error. No browser mutation, clinician sign-in, staff role, consent change, appointment booking, emergency action, or cross-role workflow has been executed. |
| Database verification | Migration startup; targeted idempotency, retention maker-checker, and consent-revocation transition rehearsals; and bounded backup/restore read-back. Not a full business-write/race, decrypted-record, or application-against-restored-DB verification. |

Manual inventory at this checkpoint: 940 tracked source/config files in scope,
including 272 Rust files, 335 TypeScript/TSX files, and 64 SQL migrations.
This is inventory coverage, not a statement that every file has been manually
reviewed. Static follow-up currently finds 126 production-source and 24
test/fixture `X-User-Id` references, plus 142 direct
`println!`/`eprintln!`/`dbg!` calls in API source; those counts define remaining
authentication and log-sink audit scope.

## Findings

| ID | Severity | Root cause | Changed files | Automated evidence | Runtime/API evidence | Browser/DB evidence | Commit | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | P1 | Anonymous routes disclosed wallet-linked identity before ownership proof and had only a process-local request throttle. | `api/src/auth_challenges.rs`, `api/migrations/20260821000001_auth_challenges.sql`, auth handlers/routes/types, shared/portal auth clients, and the nonce-message verifier | Focused challenge and JWT-field tests pass. `a65f19f` adds a PostgreSQL advisory-lock-protected per-wallet rolling budget of five challenges per minute; its six-way concurrent test passed with exactly five issues and one typed rate-limit result. Direct PostgreSQL tests prove a challenge consumes once, identical replay is denied, and an expired challenge is denied. | Current image manifest `sha256:18dda856…` is healthy. A real synthetic `//Alice` wallet signed the dynamic issued login message; `/api/auth/jwt` returned `200` with access and refresh tokens, while replaying the identical proof returned `401 INVALID_AUTH_CHALLENGE`. Through Nginx, five valid-format challenge calls returned `200`; the sixth and seventh returned `429` with `AUTH_CHALLENGE_RATE_LIMITED`. | Browser wallet signing and broader database race verification not yet run. | `8a7a5e3`, `a65f19f`, `9b360d0`, `f05abe1`, `7e04eed` | PARTIALLY FIXED |
| SEC-002 | P1 | Provider failure could fall back to public Jitsi. | `api/src/telehealth.rs`, telehealth endpoint, startup, production compose | `cargo test --bin medichain-api telehealth -- --nocapture` passed 28 tests, including disabled-provider service failure with no persisted session or join credentials, join-window closure, role recording authority, Jitsi credential lifecycle, and session concurrency. Production startup source rejects public Jitsi and missing private-provider credentials. | Production Compose resolves `IS_DEMO=false`, `REQUIRE_SIGNATURES=true`, and `TELEHEALTH_ENABLED=false` by default. A provider-enabled production startup was not launched. | No actual provider outage or authenticated browser join test. | `8a7a5e3` plus pending verification commit | PARTIALLY FIXED |
| APP-001 | P1 | Access requests could be self-approved and grants could be indefinite. | `api/src/handlers/access_control.rs`; patient-access service/repositories and migration; retention repositories; consent workflow/repositories/routes | Focused access, retention maker-checker, and one-time consent-revocation tests pass. A PostgreSQL concurrent creation test proves one provider can create only one pending request per patient; the loser receives a typed conflict. The forward-only migration refuses historical duplicate pending requests for manual governance review rather than changing them automatically. | Not exercised with authenticated roles. | Direct PostgreSQL rehearsals: requester self-approval updated 0 rows and left a synthetic pending request unchanged; a distinct approver updated 1 row. A synthetic consent revoke set legacy and authoritative fields to withdrawn, and a second revoke updated 0 rows. Probe data was removed. The authenticated patient portal reaches its `Access Control` page in-browser, but no browser consent request, grant, approval, revoke, or concurrent-role workflow was performed. | `492546e`, `211f3cc` plus pending verification commit | PARTIALLY FIXED |
| AUD-001 | P1 | High-risk business mutations and durable audit-outbox inserts were often separate operations; handlers could log an outbox failure and still return a successful mutation. | Patient access, guardian relationships, emergency grants, and the PostgreSQL identity-claim link now span their business transition and prepared audit event. Registry bulk reads, managed-device revocation, and mobile-device revocation fail closed when audit persistence is unavailable. Production mobile-device and protected-session authority is PostgreSQL-backed. | Isolated PostgreSQL tests prove patient-access, guardian, emergency-grant, identity-claim, and mobile-device restart/revocation behavior. | `cargo check -p medichain-api --message-format short` passes. Static follow-up finds each remaining audit-error branch returns `503`; none returns a success response. | A new PostgreSQL-backed mobile store saw a device registered by a prior instance, authorized a protected session, then—after device revocation—saw both the device and the session as revoked. The handler still persists its required audit event before the separate mobile-state transaction, so this is fail-closed ordering rather than a single cross-write transaction. No browser/deployed-image evidence exists. This remains a release blocker. | `40ab8be` plus pending verification commit | PARTIALLY FIXED |
| INT-001 | P1 | Production could treat stub identity verification as verified. | `api/src/national_id.rs`, handler, startup, production compose | National-ID test module passes. | Production Compose resolves `NATIONAL_ID_VERIFICATION_MODE=live`; production startup and real/sandbox provider verification remain unexecuted. | No live/sandbox provider verification. | `8a7a5e3` | PARTIALLY FIXED |
| DATA-001 | P1 | Process-local idempotency and offline queue had no stable end-to-end key or durable operation state. | `client/shared/src/api/client.ts`, `api/src/middleware/idempotency.rs`, `api/migrations/20260822000002_idempotency_operations.sql` | Shared-client typecheck and middleware digest-scope test pass. | Rebuilt image `sha256:dc878554…` is healthy and applied migration `20260822000002`. A synthetic authenticated challenge request produced one completed PostgreSQL claim; same key/body returned `409 IDEMPOTENCY_DUPLICATE`, and same key/different body returned `409 IDEMPOTENCY_KEY_REUSED`. After API recreation, the same request remained `409` and the claim remained `completed`. A direct two-connection database rehearsal observed exactly one concurrent durable claim winner (`INSERT 0 1` and `INSERT 0 0`); its one synthetic row was removed. Automatic reconnect replay remains disabled. | Two-replica HTTP, response-loss, business-write atomicity, and browser proof remain absent. | `0ed9bb7`, `60a543a` | PARTIALLY FIXED |
| PRIV-001 | P1 | Sensitive identifiers can enter logs and related telemetry. | `api/src/privacy_logging.rs`, logging initialization, `api/src/middleware/signature_auth.rs`, `api/src/main.rs`, `api/src/startup.rs`, `api/src/handlers/auth_challenge.rs`, and 18 production call-site files | Sanitizer and `log::Record` sink-path leakage tests pass, including labelled wallet fields. `ad1ad6c` removes direct wallet, patient, user, and record-ID interpolation from staff login, MFA, emergency, FHIR, surgical, messaging, retention, and related paths. The dormant, unregistered legacy wallet-login handler now logs no identity fields. A startup-guard regression proves privileged development-account wallet addresses are omitted from its returned error while role/count diagnostics remain. Focused challenge tests and strict Clippy pass. | Local image `sha256:66ed062a…` contains the latest source and returned `200` from both health endpoints after recreation. A current shaped invalid-staff-login request returned `401`; neither its response nor container logs contained the unique identifier, while the log retained only `STAFF_LOGIN_UNKNOWN identifier_hash=…`. | Static sink/metrics/browser collector audit remains incomplete; no external collector review or browser mutation evidence. The ignored synthetic chain E2E test retains public synthetic output only. | `4af04c7`, `67240d8`, `bf58b86`, `254fd50`, `ad1ad6c` plus pending verification commit | PARTIALLY FIXED |
| AUTH-002 | P2 | Refresh JWTs were stateless and non-rotating. | `api/src/auth_sessions.rs`, auth JWT handler, session migration, shared client | Session-token hash test and shared-client typecheck pass. A PostgreSQL concurrent-rotation regression passed: two uses of one refresh token yielded exactly one successor and one revoked predecessor. | Current healthy local image `sha256:cd924697…` issued a signed synthetic `//Alice` session, rotated it once, and rejected the original refresh token on replay with `401`; the successor refresh token differed. PostgreSQL showed the predecessor marked `rotated`. | No browser token lifecycle, logout, multi-device, or production-artifact evidence. | `56ad565`, `e48705a` | PARTIALLY FIXED |
| AUTH-003 | P2 | The intended JWT-session contract is not yet the sole client/server identity mechanism: clinician pages and test/demo scripts still emit legacy `X-User-Id`. | `api/src/support.rs`, `api/src/middleware/jwt_identity.rs`, `api/src/middleware/signature_auth.rs`, `api/src/main.rs`, `client/shared/src/api/client.ts`, direct clinician fetch call sites, test/demo scripts | Source review found production signature middleware rejects an `X-User-Id` request without its bound wallet signature, while a valid Bearer token resolves identity from its verified `sub` claim. The typed shared client now omits `X-User-Id` whenever it has a Bearer token, retaining header-only behavior only for tokenless demo compatibility. A reusable `getSessionHeaders()` helper now migrates every production patient-app direct call, both dashboards, reusable selector components, and the cardiac, code-blue, emergency-protocol, operative-note, and post-operative pages. A server-side transition middleware inserts the verified JWT subject for legacy handlers only after signature authentication and only when the client supplied no header; five focused tests pass, including a Bearer-only request through the actual signature-plus-bridge ordering to a header-reading handler. Shared, clinician, and patient TypeScript checks pass; focused dashboard tests pass (clinician 4/4, patient 3/3); the complete patient suite passed 26 files / 83 tests. One prior complete-suite Medical-ID timeout passed in isolation and on the immediate complete-suite rerun, so it is not treated as a deterministic regression. The initial direct-portal inventory was 104 occurrences across 54 files (79 clinician, 25 patient); 71 clinician occurrences across 34 files remain. Shared-client and documentation references are counted separately. | No rebuilt current image, production-mode browser session, or JWT-only clinician role workflow yet. | The legacy header remains deliberately allowed in demo mode, and the remaining clinician migration must preserve wallet-signature step-up where policy requires it. The normal patient and typed-client paths are improved, but the full requested migration is incomplete. | pending | PARTIALLY FIXED |
| OPS-001 | P2 | Development pgAdmin crash-looped because its default email used a reserved `.local` domain rejected by the current image. | `docker-compose.yml`, `.env.example`, PostgreSQL guide | Compose configuration resolves a globally valid development-only default; production compose already restricts pgAdmin to its `debug` profile with no public port. | After recreation, pgAdmin remained up and `http://localhost:5050/` returned `302 /browser/`; startup log shows Gunicorn listening on port 80. | No browser login or DB-admin workflow was exercised. | pending | PARTIALLY FIXED |
| OPS-002 | P2 | Backup/restore mechanism had not been demonstrated end to end. | `scripts/backup-postgres.ps1`, `scripts/restore-postgres.ps1`, row-count query helper | Backup script produced custom dump, SHA-256 checksum, and exact row-count manifest. Restore script verified checksum and exact table-by-table counts. | Local development backup created `medichain-20260822T025708Z.dump`; restore into isolated `medichain_restore_audit_20260822` reported `PASS`. Source and restored patient counts were both 81; restored `_sqlx_migrations` count was 62. A disposable API instance connected to the restored DB, rechecked migrations, loaded users/patients, and returned health `200`. | No decrypted-record read-back, backup policy/RPO/RTO, off-site storage, or browser evidence. | pending | PARTIALLY FIXED |
| OBS-001 | P2 | Prometheus had no authenticated scrape configuration and its default scrape path did not match the API route; the optional production Grafana profile had a public default administrator credential. | `.env.example`, Compose API/Prometheus/Grafana configuration, `docs/observability/prometheus.yml`, alert rules, `api/src/middleware/metrics.rs` | Compose source wires a `metrics_token` secret and `/api/metrics` credentials file. Production Compose now requires `METRICS_TOKEN`, preventing a deployment that silently returns `401` to every scrape, and `GRAFANA_ADMIN_PASSWORD`, preventing a default Grafana administrator. New pure policy tests prove production without `METRICS_TOKEN` has no legacy-identity fallback, while explicit demo retains local diagnostics. Source audit confirms labels are method, matched route template, and status; unmatched raw paths collapse to one constant. | Anonymous `/api/metrics` returned `401`. Fully synthetic production Compose configuration rendered successfully; removal of only `METRICS_TOKEN` or only `GRAFANA_ADMIN_PASSWORD` caused Compose to fail specifically for that required variable. On 2026-08-24, the running Prometheus target was `down` with `401 Unauthorized` and `ApiInstanceDown` firing after an API recreation from development Compose; that development environment has no `METRICS_TOKEN`. | A production-mode HTTP probe is blocked by the deliberately rejected local demo database; alert firing/delivery, Grafana browser workflow, fully provisioned production credentials, and collector review remain absent. | `a0748dc` plus pending verification commit | PARTIALLY FIXED |
| ARCH-001 | P2 | Correctness-critical state previously risked process-local storage and handler authorization had uneven explicit coverage. | Handler inventory, repository wiring, authorization gate scripts, `api/src/startup.rs`, and PostgreSQL startup-boundary tests | Endpoint-auth gate scanned 424 handlers: 74 resource/patient scoped, 246 role authorized, 67 registered-identity resolved, 0 presence-only, 0 with no decision. Durability gate found 65 AppState maps and 0 live production references. A schema mismatch in the ADR-0007 guard was corrected: it now counts `organizations.status = 'active'` and fails closed if the boundary query cannot run. Two focused PostgreSQL startup-boundary tests, strict Clippy, and the full API regression pass; a rebuilt local API image is healthy. | Current development database has zero active organization rows, which is not a multi-organization configuration. The rebuilt local image proves startup compatibility, not live rejection with multiple active organizations. | Write-authorization gate accepts 13 reviewed writes but leaves three owner decisions for break-glass emergency access and NFC identity issuance; no browser/production role matrix execution. | pending | PARTIALLY FIXED |
| TEST-001 | P2 | Parallel PostgreSQL tests concurrently swept and dropped the same historical test schema; SQLx also serialized isolated-schema migrations with a database-wide lock. | `api/src/repositories/postgres/tests.rs` | Focused PostgreSQL repository test passes after serializing extension setup, stale-schema sweeping, and test-schema creation. A 34-test PostgreSQL subset passes with eight test workers after disabling only the redundant database-wide migration lock for fresh isolated schemas. A fresh complete API suite passes. | The subset completed `34 passed; 0 failed` in 241.32s with zero advisory-lock waiters. The complete API suite then completed `421 passed; 0 failed; 1 ignored` in 201.12s. | Browser/database restore evidence remains separate. | `abc906e`, `c2e6e34` | PARTIALLY FIXED |
| TEST-002 | P2 | The clinician frontend full-test gate was vulnerable to a legitimate crypto test exceeding the global 10-second timeout under suite contention; compatibility warnings remain. | `client/doctor-portal/src/store/credentialKeystore.test.ts`, Vitest configuration, affected page rendering keys | Patient full suite passed: 26 files, 82 tests. The seed-derived credential round-trip has a local 30-second budget; the fresh complete clinician suite passed 83 files / 304 tests in 177.16 seconds. Focused provider and note-template duplicate-key tests remain green. React Router v7 future warnings remain. | No browser mutation or production build proof for these cases. | Unit tests are not browser evidence. The keystore test is security-relevant because it covers a clinician signing credential. | pending | PARTIALLY FIXED |
| UI-001 | P3 | The patient wearable page force-cast typed API envelopes to UI arrays and called the readings route with a patient ID although the API path parameter is a device ID. | `client/patient-app/src/pages/WearablesPage.tsx`, its focused test, `client/shared/src/api/endpoints.ts`, shared wearable types, API wearable handlers | The page now consumes typed device/reading envelopes, requests readings for each returned device ID, maps server records into the display model, and retains the latest supported metric per type. The focused contract test and patient typecheck pass; full patient suite passed 26 files / 83 tests. | Source comparison confirms `getWearableDevices()` returns `{ success, devices, count }`, `getWearableReadings()` returns `{ success, readings, count }`, and `/api/wearables/readings/{device_id}` requires a device ID. | No live wearable integration, browser flow, or authenticated API read-back. Server-provided trend/history semantics remain limited to the current page display model. | pending | PARTIALLY FIXED |
| SC-001 | P1 | The separately locked Substrate/Polkadot node dependency graph contains unresolved RustSec vulnerabilities and unsound/unmaintained crates. | `blockchain/Cargo.lock`, upstream Substrate/Polkadot dependency constraints | `cargo audit --file blockchain/Cargo.lock --no-yanked` scanned 1,171 packages and reported 10 vulnerabilities plus 13 allowed warnings. A dependency-tree trace connects affected packages to node networking/RPC/tracing components. | No node is currently running, so external reachability and exploitability are not verified; vulnerable versions are nevertheless present in the lockfile. | No blockchain runtime, peer-network, or multi-validator proof. | pending | STILL PRESENT |
| SC-002 | P1 | The main API workspace fails its configured dependency-policy gate due to current RustSec findings and unresolved license metadata/policy mismatches. | Root `Cargo.lock`, `crypto/Cargo.toml`, `deny.toml`, and upstream Actix/Reqwest/SQLx/Subxt dependency constraints | A precise lockfile update advanced `h2` 0.4.15 to its patched 0.4.16 release; `cargo check --bin medichain-api` passed and advisory output no longer lists that instance. `cargo deny check` still fails for `RUSTSEC-2026-0258` in Actix-bound `h2` 0.3.27, unmaintained `RUSTSEC-2026-0173` (`proc-macro-error2`) and `RUSTSEC-2026-0215` (`smallstr`) in the Subxt graph, rejected transitive NCSA/CDLA-Permissive-2.0 licenses, and unlicensed `medichain-crypto`. | Lockfile evidence only; no exploitability, runtime reachability, or upstream upgrade compatibility has been demonstrated. | No browser, provider, or deployment evidence applies. | pending | STILL PRESENT |
| CI-001 | P2 | API image artifacts lacked a machine-verifiable source revision and client CI could resolve dependencies differently from the committed lockfile. The older E2E harness also contradicted current maker-checker and mandatory-expiry policy. | `api/Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `scripts/synthetic-e2e-test.sh`, `client/package-lock.json` | API runtime image now carries OCI `org.opencontainers.image.revision`; local Compose explicitly marks builds `local-unverified`. CI builds the API using `github.sha` and inspects the image label for exact equality. Client and Lighthouse CI now use lockfile-enforced `npm ci`; a local `npm ci --dry-run --ignore-scripts` accepted the committed lockfile. The current E2E harness creates a second demo-only admin for maker-checker approval and supplies a required grant expiry; `bash -n` and the focused retention suite passed (29/29). | The latest hosted runs at old commit `40ab8be` failed: Postgres E2E queried the former `organizations.is_active` guard, and its retention/access assertions still expected policy now deliberately denied by the application. No current source has been pushed or hosted, so there is no current hosted CI run, release artifact, digest, or registry attestation evidence. | Not applicable. | pending | PARTIALLY FIXED |

## Commands and immutable evidence identifiers

* JWT-migration source reconciliation (2026-08-24): after the selector,
  emergency/peri-operative, and analytics workflow commits, `rg` finds 63
  remaining `X-User-Id` occurrences across 30 clinician portal files. This
  supersedes the earlier 71/34 checkpoint in the AUTH-003 row; no patient-app
  production source occurrence remains. The count is source coverage only and
  does not substitute for a rebuilt image, browser workflow, or API runtime
  proof.

* `cargo test --bin medichain-api auth_challenges -- --nocapture` — pass (2 tests).
* `cargo test --bin medichain-api jwt_issue_tests -- --nocapture` — pass (1 test).
* `cargo fmt --all --check` — pass.
* Doctor and patient portal TypeScript checks — pass during this campaign slice.
* `docker compose build api` — completed; release image
  `sha256:55306c016bf1624e219b438371684c6c89f8172345f3a6d8c12e2f06e1c54e68`.
* `docker compose up -d --no-deps --force-recreate api` — healthy; migrations completed.

* `cargo test --bin medichain-api` — pass: 415 passed, 0 failed, 1 ignored in
  366.74 seconds (captured after the Phase A commit and before the subsequent
  retention-only change).
* `cargo test --bin medichain-api privacy_logging -- --nocapture` — pass (2
  tests) after `4af04c7`.
* `cargo check -p medichain-api --message-format short` — pass after
  `60a543a` (5m 38s).
* `cargo test --bin medichain-api idempotency -- --nocapture` — pass (1 test;
  420 filtered) after `60a543a`.
* Rebuilt image `sha256:dc87855423b4b67872645a1016ccb691399482c7f9a17922673755be01b0503d`
  is healthy. PostgreSQL records `20260822000001` and `20260822000002` as
  successful. The authenticated synthetic idempotency probe produced `200`,
  then `409 IDEMPOTENCY_DUPLICATE` for the same key/body and
  `409 IDEMPOTENCY_KEY_REUSED` for the same key/different body.
* Rebuilt cache-layout image `sha256:2f2d380d476e6707d9c566f06fd8cbd5b427dfea116e885328ca58396ea35655`
  is healthy under the normal Compose service. The Docker cache stage reused
  dependency layers and then recompiled application source; this is build
  behavior evidence only, not a numeric build-time SLO.
* Signature-error runtime probe: a disposable signature-enabled API instance
  returned `400` with no supplied wallet value in the JSON body for malformed
  signature input. Its `log::warn!` record rendered the wallet as `[REDACTED]`.
* pgAdmin recovery probe: the former crash-loop log named
  `admin@medichain.local` as invalid; after replacement with the
  development-only `admin@medichain.dev` default and Compose recreation, the
  container remained up and its HTTP root returned `302 /browser/`.
* PostgreSQL test-isolation probe: the prior full suite created many concurrent
  `DROP SCHEMA` operations for one stale test schema and blocked on object
  locks. After setup-lock expansion and historical cleanup, the focused
  `test_pg_allergy_repository` test passed in 26.05 seconds. The subsequent
  34-test PostgreSQL subset with eight test workers passed in 241.32 seconds
  after disabling SQLx's redundant database-wide migration lock only for fresh
  isolated test schemas.
* `cargo test --bin medichain-api` after `c2e6e34` — `421 passed; 0 failed; 1
  ignored` in 201.12 seconds.
* Static privacy-boundary follow-up after `254fd50`: 142 direct
  `println!`/`eprintln!`/`dbg!` sites remain, down from 152; source compile
  passed. The corresponding Docker rebuild stalled during release linking, was
  terminated without replacing the prior healthy image, and therefore does not
  provide runtime evidence for this newest source change.
* Manual source gates: `check-endpoint-auth.py` scanned 424 handlers with no
  tier-0/tier-1 decisions; `check-write-authorization.py` accepted 13 writes
  and named three explicit owner decisions; `check-state-durability.py` found
  zero live production references across 65 AppState maps.
* Browser route/access probe: `http://localhost/` rendered the synthetic-data
  disclosure and clinician/patient portal choices; `/doctor/login` rendered
  employee-ID/password entry and a Polkadot-extension alternative with no
  console warnings or errors. An already-authenticated synthetic patient
  session rendered `/patient/records`, `/patient/medications`,
  `/patient/appointments`, `/patient/messages`, `/patient/settings`,
  `/patient/consent`, `/patient/emergency-card`, and `/patient/profile`.
  Reloading `/patient/dashboard` retained `Hello, Pat` and health ID
  `PAT-11b127a6`, with no console warnings or errors. This is route/read and
  session-reload coverage only; it is not write, approval, or cross-role proof.
* Frontend full-suite probe: `client/patient-app npm run test:run` passed 26
  files / 82 tests in 166.28 seconds. `client/doctor-portal npm run test:run`
  failed with 82 files / 303 tests passing and one timeout in
  `credentialKeystore.test.ts`; Vitest is configured with a 10,000 ms timeout.
  Its output also reports React list-key warnings in `AppointmentsPage` and
  `NoteTemplatesPage`, and repeated React Router v7 future warnings.
* Follow-up UI-list probe: corrected duplicate React keys in the patient
  booking provider list and clinician note-template/section lists. Focused
  patient appointment tests passed 7/7; focused clinician note-template tests
  passed 3/3 when run in one worker. Patient TypeScript typecheck passed. The
  clinician full-suite timeout and React Router warnings remain open.
* Keystore timeout probe: the seed-derived credential round-trip has an
  explicit per-test 30-second timeout, leaving the ordinary 10-second global
  timeout intact. Its seven focused tests passed in 17.28 seconds under one
  worker; a fresh complete clinician suite remains required before closing the
  broader gate.
* Access-approval atomic-outbox probe: `cargo check -p medichain-api
  --message-format short` passed. `cargo test --bin medichain-api
  repositories::postgres::tests::test_pg_access_approval_rolls_back_when_audit_outbox_insert_fails
  -- --nocapture` passed (`1 passed`, 423 filtered, 22.97s): a duplicate event
  ID leaves the request `pending` and inserts no grant. The corresponding
  `test_pg_access_approval_with_audit_commits_grant_and_event` passed (`1
  passed`, 424 filtered, 25.75s), proving the normal PostgreSQL approval path
  commits the grant and its durable audit event together. The existing memory
  state-machine control also passed (`1 passed`, 423 filtered).
* Access-denial atomic-outbox probe: `cargo check -p medichain-api
  --message-format short` passed. `cargo test --bin medichain-api
  repositories::postgres::tests::test_pg_access_denial_rolls_back_when_audit_outbox_insert_fails
  -- --nocapture` passed (`1 passed`, 425 filtered, 25.75s): a duplicate event
  ID leaves the request `pending`. Its normal PostgreSQL commit test is also
  included in the later three-test transaction probe.
* Access-revocation atomic-outbox probe: `cargo check -p medichain-api
  --message-format short` passed. `cargo test --bin medichain-api
  repositories::postgres::tests::test_pg_access_revocation_rolls_back_when_audit_outbox_insert_fails
  -- --nocapture` passed (`1 passed`, 426 filtered, 28.41s): a duplicate event
  ID leaves the grant `active`. Its normal PostgreSQL commit test is also
  included in the later three-test transaction probe.
* Patient-access normal transaction probe: `cargo test --bin medichain-api
  with_audit_commits -- --nocapture` passed all three focused PostgreSQL tests
  in 30.90s (426 filtered): approval commits request, grant, and event; denial
  commits request and event; revocation commits grant and event. The prior
  creation transaction success evidence remains its original focused test.
* Emergency-grant durability probe: `cargo test --bin medichain-api
  repositories::postgres::tests::test_pg_emergency_grant_survives_restart_and_enforces_bindings
  -- --nocapture` passed (`1 passed`, 429 filtered, 49.37s). It seeded the real
  organization/facility/device foreign-key chain, issued via PostgreSQL, read
  through a new store instance, validated its binding, persisted revocation,
  and denied reuse. This does not prove atomic coupling to `audit_outbox_events`.
* Guardian-revocation atomic-outbox probe: `cargo test --bin medichain-api
  repositories::postgres::tests::test_pg_guardian_revocation_rolls_back_when_audit_outbox_insert_fails
  -- --nocapture` passed (`1 passed`, 430 filtered, 93.97s). Reserving the
  event ID made the transaction fail and left the guardian relationship active.
  A normal PostgreSQL success-path event test remains unrun.
* Guardian-permission-update atomic-outbox probe: `cargo test --bin
  medichain-api repositories::postgres::tests::test_pg_guardian_permission_update_rolls_back_when_audit_outbox_insert_fails
  -- --nocapture` passed (`1 passed`, 431 filtered, 147.48s). Reserving the
  event ID made the transaction fail and left the original permission set
  unchanged. A normal PostgreSQL success-path event test remains unrun.
* Guardian-creation atomic-outbox probe: `cargo test --bin medichain-api
  repositories::postgres::tests::test_pg_guardian_creation_rolls_back_when_audit_outbox_insert_fails
  -- --nocapture` passed (`1 passed`, 432 filtered, 26.08s). Reserving the
  event ID made the transaction fail and inserted no guardian relationship.
  A normal PostgreSQL success-path event test remains unrun.
* Emergency-grant issuance atomic-outbox probe: `cargo test --bin medichain-api
  repositories::postgres::tests::test_pg_emergency_grant_and_audit_commit_together
  -- --nocapture` passed (`1 passed`, 434 filtered, 23.29s): a PostgreSQL grant
  and its `audit_outbox_events` row committed together. The forced-failure
  companion `test_pg_emergency_grant_rolls_back_when_audit_insert_fails` passed
  (`1 passed`, 434 filtered, 22.29s): an audit trigger rejection left no grant.
  `test_pg_emergency_grant_revocation_rolls_back_when_audit_insert_fails`
  passed (`1 passed`, 435 filtered, 21.94s): the grant remained `active` when
  its required revocation audit insert was rejected.
* Complete post-emergency-audit suite: `cargo test --bin medichain-api` passed
  `435 passed; 0 failed; 1 ignored` in 234.13 seconds. The ignored blockchain
  E2E test still explicitly requires a running MediChain development node.
* Identity-claim atomic-outbox probe: `cargo test --bin medichain-api
  repositories::postgres::tests::test_pg_identity_claim_rolls_back_when_audit_insert_fails
  -- --nocapture` passed (`1 passed`, 436 filtered, 24.79s): a forced outbox
  insert failure left the persisted `users.linked_patient_id` unset.
* Complete post-audit-containment suite: `cargo test --bin medichain-api`
  passed `436 passed; 0 failed; 1 ignored` in 281.72 seconds. The ignored
  blockchain E2E test still requires a running MediChain development node.
* Fresh complete API suite after the mobile-authority verification:
  `cargo test --bin medichain-api` passed `437 passed; 0 failed; 1 ignored`
  in 180.72 seconds. The ignored blockchain E2E test still requires a running
  MediChain development node.
* Fresh complete API suite after the nonce-bound JWT verifier and challenge
  durability additions: `cargo test --bin medichain-api` passed `440 passed;
  0 failed; 1 ignored` in 124.52 seconds. The ignored blockchain E2E test
  still requires a running MediChain development node.
* Current-source anonymous challenge probe: `docker compose build api` built
  image manifest `sha256:926596d4f4e0f1af541ae5c6a93c804ca27e5f8b590e231b4b08e067424b3e99`;
  recreating only `medichain_api` produced a healthy container. Gateway
  challenge calls for two supplied wallet addresses both returned `200` with
  exactly `challenge`, `instructions`, and `success`, and neither contained
  identity fields. The OCI revision label was `local-unverified`, so the
  result proves local runtime behavior but does not establish release-artifact
  provenance.
* Current monitoring probe: anonymous `/api/metrics` returned `401`, as
  required. The running Prometheus target for `api:8080` was nevertheless
  `down` with `lastError` `401 Unauthorized`, and `ApiInstanceDown` was firing.
  The API had been recreated from development Compose, whose `.env` has no
  `METRICS_TOKEN`; its monitoring-profile peer was therefore not a valid shared
  credential deployment. Rendering the merged production configuration was
  blocked by a missing required `NATIONAL_ID_HASH_KEY`, so no production-profile
  recovery attempt was made.
* Privacy call-site reduction: `cargo test --bin medichain-api privacy_logging
  -- --nocapture` passed both sink-redaction tests and `cargo check --bin
  medichain-api` passed after `ad1ad6c`. That commit removes direct wallet,
  patient, user, and record-ID interpolation from 18 production source files.
  Runtime verification of that image remains pending.
* Privacy runtime probe: current-source image manifest
  `sha256:844bbaf2f1c93454eb36e756a1bdc2e76d2cbfea9e244936bd0198fe77a50b37`
  was rebuilt and its API container recreated. A shaped invalid staff-login
  request with a unique synthetic identifier returned `401`; the container log
  contained only a short `identifier_hash` and did not contain the identifier.
* Durable challenge-throttle probe: `cargo test --bin medichain-api
  test_pg_auth_challenge_throttle_is_atomic_across_concurrent_requests --
  --nocapture` passed (`1 passed`, `438 filtered`, 20.19s). Six concurrent
  requests through cloned PostgreSQL pools produced exactly five issued
  challenges and one `RateLimited` outcome. `cargo check --bin medichain-api`
  also passed after `a65f19f`; runtime HTTP `429` verification remains pending.
* Durable challenge-throttle runtime probe: current-source image manifest
  `sha256:c26180a1bcc06fcc9b869fdadde798c32b6fe76558d273350474636b3028c4f5`
  was rebuilt and the API recreated healthy. Six sequential valid-format
  challenge requests through Nginx returned five `200` responses followed by
  `429`; a seventh returned `429` with
  `AUTH_CHALLENGE_RATE_LIMITED`.
* Challenge replay probe: `cargo test --bin medichain-api
  test_pg_auth_challenge_cannot_be_replayed -- --nocapture` passed (`1 passed`,
  `439 filtered`, 10.16s). A durable challenge consumed once; an identical
  second consume returned false.
* Challenge-expiry probe: `cargo test --bin medichain-api
  test_pg_auth_challenge_expiry_is_enforced -- --nocapture` passed (`1 passed`,
  `440 filtered`, 13.07s). A validly shaped but already-expired challenge row
  could not be consumed.
* Signed JWT runtime probe: current-source image manifest
  `sha256:18dda85614fae6addff7af2bde732104eb72ebb6f76a790b3f585f543b3c71a9`
  was rebuilt and healthy. The existing synthetic `//Alice` wallet signed the
  dynamic `MediChain login:` challenge; `/api/auth/jwt` returned `200` with
  access and refresh tokens. Replaying the identical signed body returned
  `401` with `INVALID_AUTH_CHALLENGE`.
* Telehealth focused suite: `cargo test --bin medichain-api telehealth --
  --nocapture` passed 27 tests in 11.99s, including disabled-provider
  fail-closed behavior and join-window/recording-authority cases. It is not a
  provider-outage or unauthenticated-join runtime qualification.
* Anonymous authentication runtime probe: the healthy running image returned
  bodyless `404` for both known and unknown legacy login/wallet routes. Direct
  challenge requests for both addresses returned the same top-level
  `success`, `challenge`, and `instructions` keys and contained no profile,
  role, username, email, or patient-linkage fields. This confirms only
  non-enumerating response shape on that image; no signature, replay, or
  expiry workflow was exercised.
* Clinician frontend static verification: `client/doctor-portal npm run
  typecheck` passed after the fresh complete Vitest suite. React Router v7
  future warnings remain in test-local `MemoryRouter` rendering paths.
* Mobile-device durability/revocation probe: PostgreSQL was restored from a
  clean administrator-requested Compose shutdown (no data recreation). `docker
  inspect --format '{{.State.Health.Status}}' medichain_postgres` returned
  `healthy`; `cargo test --bin medichain-api
  test_pg_mobile_device_authority_survives_restart_and_revocation` then passed
  (`1 passed`, `437 filtered`, 192.74s). The test registers through one
  PostgreSQL-backed store, reads through a new store instance, authorizes a
  protected-record session, revokes the device, and directly verifies the
  session row status is `revoked`.
* Fresh patient frontend static verification: `client/patient-app npm run
  test:run` passed `26` test files and `82` tests in 25.75 seconds. React
  Router v7 future warnings appeared in test-local `MemoryRouter` paths. This
  is component/static coverage, not browser workflow, API, or database
  read-back evidence.
* Fresh approval and consent transition probes: `cargo test --bin
  medichain-api test_pg_approve_is_not_replayable -- --nocapture` passed one
  PostgreSQL-backed test (440 filtered, 6.74 seconds); `test_pg_expiry_is_applied_and_lapsed_grants_are_not_revocable`
  passed one PostgreSQL-backed test (440 filtered, 7.29 seconds); and
  `test_consent_active` passed one memory-repository consent state test (440
  filtered). These tests do not exercise authenticated roles, a real browser,
  or concurrent approval attempts.
* Idempotency trust-boundary correction: authenticated `POST`, `PUT`, `PATCH`,
  and `DELETE` requests without `Idempotency-Key` now receive
  `IDEMPOTENCY_KEY_REQUIRED`; the middleware is registered inside signature
  authentication so a durable operation claim is not scoped using an
  unverified legacy header. `cargo fmt --all --check` passed; its two focused
  middleware tests passed; `client npm run build:shared` passed; and the full
  API suite passed `441 passed; 0 failed; 1 ignored` in 165.84 seconds. Runtime
  deployment and direct HTTP proof of the new rejection remain pending.
* Idempotency runtime probe: rebuilt API image manifest
  `sha256:5d1cd1e6d73098c77145171542747e238a6cd97f2a9c7177ac1a3853d2026f74`
  was recreated healthy. A newly issued synthetic `//Alice` wallet JWT sent a
  `POST /api/nonexistent-idempotency-probe` through Nginx without an
  `Idempotency-Key`; it returned `409 IDEMPOTENCY_KEY_REQUIRED`. The route does
  not exist and no business mutation was attempted. The local image remains
  `local-unverified`; this is runtime behavior, not release provenance.

* Privacy source-hygiene follow-up: direct interpolation of identifier-shaped
  variables in `log::*` macros was removed from record lookup, surgical,
  perioperative, diagnostic, telehealth, appointment, NFC, SOAP, CDS, and
  security-alert paths. The current focused source gate found `0` remaining
  direct sensitive-identifier interpolations. The shared output filter now has
  a regression case for UUIDs embedded in operational error messages. `cargo
  fmt --all --check`, three privacy logging tests, and the complete API suite
  passed (`442 passed; 0 failed; 1 ignored`, 186.06 seconds). A rebuilt runtime
  log probe and full metric/browser collector review remain required.
* Identity-verification production policy: startup validation is now a pure,
  directly tested policy function. Seven runtime-posture tests prove production
  rejects missing and `stub` mode while accepting only `live`; a focused
  national-ID service test proves a missing live credential returns
  `ServiceUnavailable` rather than a verified result. `cargo fmt --all --check`
  and `cargo check --bin medichain-api` passed. This is not real/sandbox
  provider qualification and does not prove deployed production configuration.
* PostgreSQL test-harness regression: a full 446-test API run exposed four
  isolated-schema migrations failing with PostgreSQL `53200` shared-memory lock
  exhaustion. The harness now serializes only migration application while
  retaining parallel test execution. The former replay failure now passes in an
  exact rerun (`1 passed`, 445 filtered, 7.12 seconds). The post-change complete
  suite result is not yet recorded; this remains `TEST-001` partial evidence.
* PostgreSQL test-harness complete regression: after migration serialization,
  `cargo test --bin medichain-api` passed `445 passed; 0 failed; 1 ignored` in
  592.79 seconds. The four formerly failing migration setup tests passed in the
  same parallel run. The ignored blockchain E2E test still requires a running
  MediChain development node; browser and deployed-image qualification remain
  separate evidence layers.
* Privacy runtime follow-up: rebuilt local image
  `sha256:cd924697f69e22529e96fd79430d5a566dea6c821d35a08603b16b8b879e06ff`
  was healthy. A shaped invalid staff login carrying the unique synthetic
  identifier `privacy-runtime-9e2f5a3b-1d26-4b90-a7d3-58b744cff111` returned
  `401`; post-request container logs did not contain that identifier and showed
  only `STAFF_LOGIN_UNKNOWN identifier_hash=ae1414ceb69a`. This verifies one
  operational log path only; it is not complete metric, collector, or browser
  leakage coverage.
* Telehealth production-startup probe: a disposable current-image container
  with `APP_ENV=production`, signatures enabled, and telehealth enabled using
  default Jitsi configuration exited before database startup with `Refusing
  production startup: Jitsi must use a non-public self-hosted domain with
  JITSI_APP_ID and JITSI_APP_SECRET token authentication`. No provider request
  or application data mutation occurred. Authenticated-room and provider-outage
  evidence remain absent.
* Patient-access approval race probe: `cargo test --bin medichain-api
  test_pg_concurrent_approvals_mint_exactly_one_grant -- --nocapture` passed
  (`1 passed`, 446 filtered, 10.87 seconds). Two simultaneous PostgreSQL
  approval attempts produced exactly one successful transition and one
  persisted grant. This is repository/database evidence only; authenticated
  cross-role and browser approval workflow coverage remain absent.
* Patient-access mixed-decision race probe: `cargo test --bin medichain-api
  test_pg_approval_and_denial_race_resolves_once -- --nocapture` passed (`1
  passed`, 447 filtered, 12.27 seconds). Competing approval and denial attempts
  produced exactly one terminal decision; a denied request persisted no grant.
  This remains database-level evidence, not an authenticated role workflow.

* Refresh-session runtime probe: the current healthy local image
  `sha256:cd924697f69e22529e96fd79430d5a566dea6c821d35a08603b16b8b879e06ff`
  issued a signed synthetic `//Alice` session through Nginx (`200`), rotated
  its refresh token (`200`, distinct successor), and rejected replay of the
  original token (`401`). Aggregate PostgreSQL inspection recorded a
  `rotated` predecessor. This is local runtime and database evidence only;
  browser lifecycle, multi-device, and production-artifact qualification are
  still absent.
* Refresh-session concurrency probe: `cargo test --bin medichain-api
  test_pg_refresh_token_rotation_allows_exactly_one_concurrent_successor --
  --nocapture` passed (`1 passed`, `448 filtered`, 12.01 seconds). Two
  PostgreSQL transactions using the same seeded refresh token produced exactly
  one successful rotation; the resulting sessions were one revoked predecessor
  and one active successor. This proves the database primitive, not a
  production multi-replica HTTP workflow.
* Metrics production-fail-closed follow-up: production `/api/metrics` no
  longer accepts a registered legacy `X-User-Id` when `METRICS_TOKEN` is
  absent; that compatibility path is restricted to explicit demo mode because
  the endpoint bypasses per-request signature authentication for Prometheus.
  `cargo test --bin medichain-api middleware::metrics::tests -- --nocapture`
  passed (`2 passed`, `448 filtered`) and `cargo check --bin medichain-api`
  passed. Static source review verified that metric labels use only method,
  matched route pattern, and status, with unmatched raw paths collapsed to
  `<unmatched>`. This has no production HTTP or collector proof yet.
* Telehealth provider-failure regression: `cargo test --bin medichain-api
  telehealth -- --nocapture` passed (`28 passed`, `423 filtered`, 10.14
  seconds). The service-level unavailable-provider case proves a provisioning
  failure creates neither a session nor Jitsi join credentials; source wording
  no longer describes a non-existent `jitsi-fallback`. `cargo check --bin
  medichain-api` passed. This is automated evidence only, not provider-outage
  or authenticated browser-join qualification.
* Startup diagnostic privacy follow-up: the production startup guard for
  privileged well-known development accounts now reports only the affected
  role set and count, never wallet values that might escape the shared logger
  through a process-level startup error. `cargo test --bin medichain-api
  dev_account_tests -- --nocapture` passed (`2 passed`, `450 filtered`, 0.28
  seconds), including a direct non-leak assertion; `cargo check --bin
  medichain-api` passed. This does not qualify external log collectors,
  metrics, or browser telemetry.
* Patient-access duplicate-request race probe: migration
  `20260824000001_patient_access_pending_unique.sql` enforces one pending
  request per patient/provider pair and deliberately stops an upgrade with
  historical duplicates for manual review. `cargo test --bin medichain-api
  test_pg_concurrent_access_requests_create_exactly_one_pending_request --
  --nocapture` passed (`1 passed`, `452 filtered`, 14.52 seconds): two
  concurrent PostgreSQL submissions created one pending row and returned one
  typed conflict. `cargo check --bin medichain-api` passed. This is database
  evidence, not an authenticated-role or browser consent workflow.
* Patient-access migration database rehearsal: the current local Compose
  PostgreSQL database had 10 access-request rows and zero historical duplicate
  pending patient/provider groups before application. The forward-only
  `20260824000001_patient_access_pending_unique.sql` migration then completed
  through `psql` and direct catalog inspection confirmed
  `uq_patient_access_requests_pending_provider` as a unique partial index on
  `(patient_id, provider_id)` where `status = 'pending'`. This is a local
  development-database verification, applied outside the API startup migration
  tracker; the currently running API image predates this migration and no
  authenticated HTTP or browser workflow was exercised.
* Aggregate API regression after the latest authentication, access-control,
  metrics, telehealth, and startup-diagnostic changes: `cargo test --bin
  medichain-api` completed with `452 passed; 0 failed; 1 ignored` in 708.47
  seconds. The ignored blockchain end-to-end test still requires a running
  MediChain development node. This is automated source/repository regression
  evidence; it neither qualifies an external provider nor replaces direct
  production, browser, multi-replica, or authenticated cross-role validation.
* Production observability configuration follow-up: `docker compose -f
  docker-compose.yml -f docker-compose.prod.yml config` with all synthetic
  production inputs except `METRICS_TOKEN` failed specifically with
  `METRICS_TOKEN is required`; the same fully synthetic configuration rendered
  successfully with the monitoring profile. `cargo test --bin medichain-api
  middleware::metrics::tests -- --nocapture` passed (`2 passed`, `451
  filtered`). The production override now requires the token and the
  observability runbook documents the bearer-token/secret-file contract. This
  is configuration and automated-policy evidence only; it does not show a
  deployed scrape, an alert delivery, or Grafana browser use.
* CI dependency reproducibility follow-up: the Client CI and Lighthouse jobs
  now use `npm ci` rather than resolver-permissive `npm install` against the
  committed client lockfile. `npm ci --dry-run --ignore-scripts` completed
  successfully locally. This is a static lockfile check, not evidence of a
  hosted workflow, dependency scan, SBOM publication, or release artifact.
* Grafana production-credential follow-up: the monitoring profile no longer
  supplies `admin` as `GF_SECURITY_ADMIN_PASSWORD`; production Compose requires
  `GRAFANA_ADMIN_PASSWORD`. With all other synthetic production inputs set,
  Compose failed specifically when that value was omitted and rendered when it
  was supplied. Because Compose interpolates profile services before deciding
  whether to start them, the secret is required even for a non-monitoring
  production render. This is configuration evidence only; no Grafana instance,
  login, dashboard, or alert delivery was exercised.
* Legacy identity-header source audit: `rg` found 150 `X-User-Id` references in
  `api/src` Rust files (126 production source, 24 tests/fixtures). The shared
  resolver prefers a verified JWT subject and otherwise reads the legacy header;
  with production signature middleware enabled, any request that supplies that
  header must present a valid wallet signature bound to method, path, and body.
  The shared log backend redacts the raw wallet in failed-signature messages,
  which is covered by existing `privacy_logging` sink tests. This is source and
  automated evidence, not a replacement for a full authenticated role/browser
  matrix or a complete handler-by-handler authorization audit.
* Authorization-gate refresh: `python scripts/check-endpoint-auth.py` scanned
  424 handlers and reported 74 resource/patient-scoped, 246 role-authorized,
  67 registered-identity-resolved, zero presence-only, and zero no-decision
  handlers. It reported 39 `list_all` deployment-wide reads, bounded by the
  single-organisation startup invariant rather than tenant isolation. `python
  scripts/check-write-authorization.py` accepted 13 reviewed state-changing
  handlers, while retaining three explicit owner decisions: the roles allowed
  to initiate break-glass access, mint its NFC token, and issue a patient NFC
  identity credential. These are policy decisions requiring clinical/governance
  approval, not implementation closure; no browser or production role matrix
  was exercised.
* Frontend aggregate build: `npm run build:all` completed for shared code,
  clinician portal, and patient portal. `npm run test:run --workspace=patient-app`
  completed with 26 files and 82 tests passing. The build reported stale
  Browserslist data and a non-fatal Rollup annotation warning in a Polkadot
  dependency; the patient suite reported React Router v7 compatibility warnings
  and revealed the wearable contract defect tracked as `UI-001`. Build/unit
  success is not browser workflow, external wearable, or authenticated API
  evidence.
* Wearable API-contract repair: the patient page now loads the typed device
  envelope first, fetches each device's readings using its server-provided
  `device_id`, and maps the newest supported reading per metric into the
  dashboard. `npm run typecheck --workspace=patient-app` and the focused
  `WearablesPage.test.tsx` passed; the complete patient suite passed 26 files
  / 83 tests. This is source and component-test evidence only, not live device,
  authenticated API, persistence, or browser qualification.
* Rebuilt runtime and health-proxy rehearsal: the API release image rebuilt as
  `sha256:d63569c…`, was recreated healthy, and SQLx recorded migration
  `20260824000001`. The web image then rebuilt as `medichain-web:local`
  with the health proxy routes baked in. Through the local Nginx endpoint,
  `/health`, `/health/ready`, `/health/db`, and Nginx's independent
  `/healthz` all returned `200`. The API reference and demo-seed probe now
  use the actual `/health` liveness route. This is local demo-runtime and
  database-startup evidence only; it does not qualify production credentials,
  alert delivery, external dependencies, or browser role workflows.
* Startup process-error privacy follow-up: database migration and connectivity
  startup failures now return stable `database migrations failed` or
  `database unreachable` categories rather than interpolating underlying
  errors into process-level output. The redacted structured logger still
  retains operational diagnostics. `cargo check --bin medichain-api` passed,
  and `cargo test --bin medichain-api dev_account_tests -- --nocapture`
  passed (`2 passed`, `451 filtered`). This narrows one direct-output path;
  it does not qualify collectors, all error paths, or browser telemetry.
* Direct-output source classification: the non-test `println!`/`eprintln!`
  inventory consists of static startup banners, endpoint labels, service status,
  and aggregate counts; it contains no remaining production patient, wallet,
  token, or raw error interpolation after the startup-error repair. Remaining
  dynamic direct output is confined to blockchain and PostgreSQL test code using
  synthetic signer, commitment, and fixture values. This is a static source
  result, not evidence about external collectors or telemetry sinks.
* Backup/restore follow-up (2026-08-24): the local Windows backup procedure
  produced a custom dump, SHA-256 checksum, and row-count manifest in a fresh
  temporary evidence directory. The restore procedure created the isolated
  `medichain_remediation_restore_20260824` database. Direct database read-back
  confirmed 63 `_sqlx_migrations` rows and matched the representative
  `patients` count (`81` source, `81` restored). The repository's separate
  `test-backup-manifest.sh` harness was not run because it is intentionally
  bound to the non-running `medichain_horizon_postgres` isolated stack. The
  terminal integration did not return the restore script's final manifest
  transcript, so this is bounded database read-back evidence rather than a
  claim that every table, decrypted record, or application workflow was
  restored successfully.
* Dependency-advisory follow-up (2026-08-24): the external `cargo-audit`
  developer utility was installed without changing MediChain dependencies or
  lockfiles. After it refreshed the RustSec advisory database, `cargo audit`
  exited `0` with no reported advisories. This is a point-in-time local Rust
  dependency result only; the configured CI scan, SBOM generation, container
  scan, and provenance workflow remain unverified until an actual hosted or
  release-artifact run is captured.
* Authorization and observability refresh (2026-08-24):
  `check-endpoint-auth.py` again scanned 424 handlers with zero presence-only
  and zero no-decision handlers; its 39 deployment-wide `list_all` reads remain
  under the one-organisation deployment assumption. The write gate again
  accepted 13 reviewed writes and retained the three explicitly documented
  emergency/NFC role-policy decisions for governance rather than guessing an
  authorization policy. `cargo test --bin medichain-api privacy_logging --
  --nocapture` passed 3 tests and the separate `metrics` filter passed 2.
  Production Compose rejected an omitted Grafana password and rendered when all
  required secrets/endpoints were supplied as synthetic configuration values.
  This is source, test, and configuration evidence only: it does not establish
  real role workflows, Prometheus scraping, Grafana login, alerts, or a release
  image provenance chain.
* Signature-bypass boundary repair (2026-08-24): the wallet-signature
  middleware previously treated a path beginning with a public route as public.
  It now permits only an exact match against the registered public paths. The
  focused `signature_auth` suite passed 6 tests, including an adversarial
  `/api/metrics-private` route with an asserted legacy identity but no
  signature; it returned `401` rather than inheriting `/api/metrics`' bypass.
  This is focused middleware evidence, not a full authenticated browser or
  endpoint-by-endpoint production proof.
* Local SBOM generation (2026-08-24): the same `cargo cyclonedx --format json
  --all` command configured for CI generated valid CycloneDX 1.3 documents:
  API 676 components (`sha256:4e2283b1904895c24f1245eedca782d456025f866f5a1255a2ca4a87c802938f`)
  and crypto 244 components
  (`sha256:5f758fb7ecaed72d5d6a9b6c4240eb4acc4af038609697e357d2df3340107718`).
  The local generated files were intentionally not committed because the CI
  workflow publishes them as build artifacts. This validates the generator at
  this source revision only; no hosted upload, container SBOM, image digest, or
  attestation has been demonstrated.
* Blockchain dependency audit (2026-08-24): `cargo audit --file
  blockchain/Cargo.lock --no-yanked` completed against the refreshed RustSec
  database and scanned 1,171 locked packages. It reported 10 vulnerabilities:
  `RUSTSEC-2026-0258` in `h2` 0.3.27 and 0.4.15;
  `RUSTSEC-2026-0118` and `RUSTSEC-2026-0119` in `hickory-proto` 0.25.2
  (plus 0119 in 0.24.4); `RUSTSEC-2025-0009` in `ring` 0.16.20;
  `RUSTSEC-2026-0098`, `-0099`, and `-0104` in `rustls-webpki` 0.101.7;
  and `RUSTSEC-2025-0055` in `tracing-subscriber` 0.3.19. It also reported 13
  allowed unmaintained/unsound warnings. Dependency tracing locates these in
  the Substrate/Polkadot networking, RPC, and tracing graph, not a simple
  direct application dependency. `hickory-proto` 0.25.2 has one advisory with
  no fixed version; the remaining proposed upgrades must be evaluated as a
  coordinated supported-SDK update. No lockfile override was applied blindly.
* Idempotency-expiry repair (2026-08-24): the original unique key outlived an
  operation's TTL and no retention worker reclaimed expired records, making a
  key permanently unusable despite the stated 24-hour expiry. The claim insert
  now atomically replaces only an expired record for that exact subject, method,
  route, and key; a live record continues to win the conflict. `cargo check
  --bin medichain-api` and the focused idempotency suite (2 tests) passed. A
  direct PostgreSQL rehearsal inserted an expired synthetic operation, observed
  the conditional upsert replace it with the new ID/digest/state and future
  expiry, then deleted the fixture. This fixes TTL reclamation only; it does not
  add response replay, response-loss proof, multi-replica testing, or atomic
  coupling of every business write to its idempotency completion marker.
* Browser read-only refresh (2026-08-24): the in-app browser rendered the
  public synthetic-data landing page, the unauthenticated clinician credential
  entry page, and a pre-existing synthetic patient session. The patient routes
  `/dashboard`, `/records`, `/medications`, `/appointments`, `/messages`,
  `/settings`, `/emergency-card`, `/consent`, and `/profile` all loaded their
  intended route; each collected zero browser-console errors. Reloading the
  dashboard retained the `Hello, Pat` synthetic-session state with zero errors.
  No controls that create, modify, revoke, book, sign in, sign out, or disclose
  medical information were used. This is browser route/read persistence
  evidence only, not a test of form validation, data mutation, access denial,
  clinician authentication, or cross-role consequences.
* Landing favicon repair (2026-08-24): terminal browser evidence found a
  `404` for the public landing page's implicit `/favicon.ico` request. The
  landing now declares the existing `/patient/medichain-icon.svg` asset. After
  the web image rebuilt and only Nginx was recreated healthy, a fresh in-app
  browser tab loaded the landing page with that icon link and zero console
  warnings/errors. The pre-recreation patient tab logged two SSE fetch failures
  while its proxy was deliberately being restarted; the fresh steady-state tab
  did not reproduce them. This is a P3 public-page repair, not proof of SSE
  resiliency or authenticated browser workflow correctness.
* HTTPS-exemption boundary repair (2026-08-24): the encryption-policy
  middleware also used prefix matching for public exception paths. It now
  accepts only exact route identities, so a future `/api/metrics-private` or
  `/api/auth/challenge-private` route cannot inherit a public HTTP exception.
  The focused `encryption_policy` suite passed 5 tests, including the
  adversarial `/api/metrics-private` HTTP request returning `403`. This is
  middleware-level enforcement evidence; TLS termination, proxy forwarding,
  mobile transport, and all deployed ingress paths remain separately
  unqualified.
* Full API regression (2026-08-24): `cargo test --bin medichain-api` completed
  with `454 passed; 0 failed; 1 ignored` in 709.43 seconds. The ignored test is
  the documented finalized-chain E2E case, which requires a running MediChain
  node. The run exercised the new exact-path signature and HTTPS policy tests,
  PostgreSQL approval/audit rollback and race tests, challenge replay/rate
  limits, token rotation, restart persistence, consent, and telehealth failure
  handling. This is full local automated evidence for the API binary; it does
  not establish browser mutation coverage, real external-provider behavior,
  multi-validator blockchain proof, hosted CI, or a production release image.
* Full patient-portal regression (2026-08-24): from the client workspace,
  `npm run test:run --workspace=patient-app` completed with `26` test files and
  `83` tests passing in 41.29 seconds. This includes the wearable contract,
  consent management, appointment action/error surfaces, patient login,
  emergency card, settings persistence, and telehealth components. The suite
  reports existing React Router v7 future-compatibility warnings. Component
  tests do not replace browser mutation/read-back, role authorization, device,
  or external-provider evidence.
* Full clinician-portal regression (2026-08-24): from the client workspace,
  `npm run test:run --workspace=doctor-portal` completed with `83` test files
  and `304` tests passing in 124.69 seconds. This includes clinician page,
  role dashboard, credential-keystore, session, settings, and clinical-form
  component cases. It is local automated component evidence only; it does not
  prove clinician authentication, real clinical writes, authorization denial,
  cross-role persistence, browser mutation/read-back, or a deployed web image.
* Portal static validation (2026-08-24): `npm run typecheck
  --workspace=doctor-portal` and `npm run typecheck --workspace=patient-app`
  both completed successfully from the client workspace. This checks the
  TypeScript source at this revision; it does not qualify runtime bundles,
  browser behavior, access control, or API compatibility.
* Current API image refresh (2026-08-24): `docker compose build api` completed
  from the current source and produced image manifest
  `sha256:dd3881a37141b4225036a9e874ce4ff95b2d6cb67591c088cd3f6ea88aaa1b8f`.
  Recreating only `medichain_api` yielded a healthy container; `/health` and
  `/health/ready` returned `200`. Its OCI revision label is
  `local-unverified`. The development Compose profile reports signature
  verification disabled and permits development HTTP, so this runtime cannot
  validate the latest production-only signature/HTTPS negative branches; the
  focused adversarial middleware tests remain the applicable evidence. No
  production artifact provenance is claimed.
* Full client production build (2026-08-24): `npm run build:all` completed
  successfully, including shared TypeScript validation and both Vite portal
  bundles. The build reports two maintenance warnings: the checked-in
  Browserslist/caniuse-lite data is eight months old, and Rollup removes a
  misplaced `/*#__PURE__*/` annotation from the third-party
  `@polkadot/x-global` package. Neither warning failed the build or establishes
  a functional defect, but both remain visible dependency/build hygiene debt.
  This is local bundle evidence, not deployed-image, browser workflow, or
  production performance proof.
* Direct-output source classification (2026-08-24): all 142 remaining direct
  `println!`/`eprintln!`/`dbg!` sites in `api/src` were classified by file: 91
  are the static startup banner and endpoint inventory in `startup.rs`; 42 are
  generic startup/degradation diagnostics or aggregate counts in `main.rs`; 7
  are within the ignored synthetic-only blockchain E2E test; and 2 are test
  schema-cleanup diagnostics. None directly interpolates a production patient,
  wallet, user, record, request, clinical field, or secret to stdout/stderr.
  Errors that can include operational details are emitted through the logging
  layer, whose record-sink sanitizer tests pass. This narrows the direct-output
  finding; it does not qualify downstream log collectors, third-party tracing,
  browser telemetry, or every non-stdout sink, so `PRIV-001` remains
  `PARTIALLY FIXED`.
* API strict-lint repair (2026-08-24): `cargo clippy --bin medichain-api --
  -D warnings` initially identified one eight-argument emergency-grant issuance
  method and three repeated complex mobile-device database-row tuple types.
  Issuance now receives one named `AuditedEmergencyGrantRequest`, which keeps
  the mandatory audit inputs together, and the shared SQL projection is named
  `MobileDeviceRow`; no transition, SQL, policy, or serialized response changed.
  `cargo fmt --all --check`, `cargo clippy --bin medichain-api -- -D warnings`,
  the six-case `emergency_grant` test filter (including PostgreSQL commit and
  rollback cases), and the two-case `mobile_records` filter all passed. This is
  local source and targeted database-test evidence, not a deployment or browser
  workflow qualification.
* Post-refactor full API regression (2026-08-24): `cargo test --bin
  medichain-api` completed with `454 passed; 0 failed; 1 ignored` in 605.72
  seconds. The ignored case is the documented finalized-chain E2E, which needs
  a running MediChain development node. This validates the current API source,
  including the strict-lint refactor, against its local test and PostgreSQL
  harness; it does not supply blockchain, browser mutation, external provider,
  hosted CI, or production-release-image proof.
* Post-refactor API runtime parity (2026-08-24): `docker compose build api`
  produced image manifest
  `sha256:16d782035df3e98703007dd440f16288a369d258b8cbc1cb438a06ed06624242`.
  Recreating only `medichain_api` yielded a healthy container; `/health` and
  `/health/ready` returned `200`. The image label remains `local-unverified`,
  so this is current local-runtime evidence only, not hosted CI, registry
  attestation, or release provenance.
* Main-workspace dependency-policy audit (2026-08-24): `cargo deny check`
  failed (`advisories FAILED`, `licenses FAILED`; bans and sources passed).
  Advisory-only extraction confirms `RUSTSEC-2026-0258` in locked `h2` 0.3.27
  through `actix-http`/`actix-web` and 0.4.15 through
  `reqwest`/`tonic`/`hyper`; `RUSTSEC-2026-0173` in `proc-macro-error2` and
  `RUSTSEC-2026-0215` in `smallstr`, both reached through Subxt. The policy
  also rejects NCSA (`libfuzzer-sys` through image/qrcode) and
  CDLA-Permissive-2.0 (`webpki` root-cert packages through SQLx and Subxt),
  while `medichain-crypto` has no declared SPDX license. These are confirmed
  current lockfile/policy facts, not an exploitability finding. No dependency
  or license-policy override was applied without a compatibility and legal
  decision.
* Main-workspace `h2` remediation (2026-08-24): the precise supported update
  `cargo update -p h2@0.4.15 --precise 0.4.16` changed the lockfile to the
  advisory's patched release. The resolver also adjusted its transitive Windows
  target support entries. `cargo check --bin medichain-api`, `cargo fmt --all
  --check`, and `git diff --check` passed. A follow-up `cargo deny check
  advisories` no longer reports the former 0.4.15 instance; it still reports
  the Actix-bound 0.3.27 instance and the two Subxt maintenance advisories.
  This reduces, but does not close, `SC-002`.
* Post-`h2` full API regression (2026-08-24): `cargo test --bin
  medichain-api` completed with `454 passed; 0 failed; 1 ignored` in 731.57
  seconds after rebuilding the affected HTTP, SQLx, and Subxt test graph. The
  ignored finalized-chain E2E still needs a running MediChain development node.
  This validates the lockfile update against the local API and PostgreSQL test
  harness only; it does not close the remaining dependency-policy, blockchain,
  provider, browser, CI, or production-artifact gaps.
* Post-`h2` API runtime parity (2026-08-24): the clean Docker rebuild produced
  image manifest
  `sha256:25928a32b43a8f29fa7b4ce60fd82a9d8b8f2d4dfc31ecaf0a37120db9e10d10`.
  Recreating only `medichain_api` yielded a healthy container and both
  `/health` and `/health/ready` returned `200`. The image remains labelled
  `local-unverified`; this confirms current local runtime parity only, not
  hosted CI, registry attestation, production credentials, or release
  provenance.
* Remaining Actix `h2` constraint (2026-08-24): `cargo update -p h2@0.3.27
  --dry-run` reported `Locking 0 packages to latest compatible versions` and
  did not modify the lockfile. The remaining `RUSTSEC-2026-0258` instance is
  therefore constrained by the current Actix dependency range, not a missed
  routine patch update. It requires a compatible Actix/Actix-HTTP upgrade and
  regression/production review; `SC-002` remains `STILL PRESENT`.
* Tenant-boundary enforcement repair (2026-08-24): direct PostgreSQL inspection
  found `organizations` uses `status`, not the nonexistent `is_active` column.
  The ADR-0007 startup guard had swallowed that query error and therefore did
  not actually enforce the one-organization boundary. It now counts
  `status = 'active'` and fails closed when the query cannot be verified. The
  focused PostgreSQL tests prove both two active organizations are refused and
  an unreachable database pool produces the explicit refusal. `cargo fmt --all
  --check` and `cargo clippy --bin medichain-api -- -D warnings` passed. The
  live development database currently has zero active organization rows; this
  is source/database-test evidence pending a current-image runtime recreation.
* Tenant-boundary runtime parity (2026-08-24): the corrected API source was
  built as image
  `sha256:1e1f9175c35b7aa25478e07efc9da85969ce5600de34f637573e0077e1364331`.
  Recreating only `medichain_api` produced a healthy container; `/health` and
  `/health/ready` returned `200`. The current development database has zero
  active organization rows, so this confirms startup compatibility rather than
  a live multi-organization rejection. The image label is `local-unverified`;
  no hosted CI, registry attestation, or production deployment claim is made.
* Post-tenant-boundary full API regression (2026-08-24): `cargo test --bin
  medichain-api` completed with `455 passed; 0 failed; 1 ignored` in 809.64
  seconds. The additional passing test covers refusal when the organization
  boundary cannot be verified. The ignored finalized-chain E2E still requires
  a running MediChain development node, so this is local source/database-test
  evidence rather than blockchain runtime evidence.
* Dormant legacy-login privacy hardening (2026-08-24): the deliberately
  unregistered `/api/auth/login` handler retained a raw wallet/name/role log
  call despite being excluded from the route table. Its diagnostic now records
  only that the deprecated handler was invoked. `cargo fmt --all --check`, the
  focused auth-challenge suite (`6 passed; 0 failed`), and strict API Clippy
  passed. This is source/automated evidence; the current container predates
  the change and the endpoint remains intentionally unregistered.
* Latest local API runtime parity (2026-08-24): image
  `sha256:66ed062a81b32e4efcc7c6a27d475e6d2c8aed49b58cf295c88bc1f03962c6e3`
  was built from the current source and `medichain_api` was recreated. Both
  `/health` and `/health/ready` returned `200`. The label remains
  `local-unverified`; this does not prove hosted CI, registry provenance, a
  release deployment, or a full privacy collector qualification.
* Idempotency concurrent-connection rehearsal (2026-08-24): two independent
  PostgreSQL client connections issued the production conditional upsert for
  one unique synthetic subject/route/key at the same time. The results were
  `INSERT 0 1` and `INSERT 0 0`; the queried row count was one, and cleanup
  deleted that one probe row. This confirms database-level arbitration across
  separate connections, but not HTTP routing across two API replicas,
  response-loss recovery, or business-write atomicity.
* Hosted-CI harness reassessment (2026-08-24): GitHub runs
  `32556843764` (MediChain CI) and `32556843759` (Development Verification)
  ran old commit `40ab8be` and failed. The former's PostgreSQL E2E log shows
  the pre-fix `organizations.is_active` startup query; its synthetic workflow
  also expected an administrator to approve its own retention token and sent
  an empty access-approval body although an expiry is now mandatory. The
  harness now creates a distinct demo-only judge administrator, expects the
  self-approval denial, and supplies a one-day synthetic expiry. `bash -n
  scripts/synthetic-e2e-test.sh`, `git diff --check`, and `cargo test --bin
  medichain-api retention -- --nocapture` passed (29/29). This is local
  harness and policy evidence only: the revised workflow has not yet been run
  against either local CI topology or GitHub Actions.

* AUTH-003 clinician migration completed (2026-08-25): the remaining 59 direct
  `X-User-Id` occurrences across 29 clinician portal files were migrated onto
  `getApiClient().getSessionHeaders(...)`, the one helper that owns the
  Bearer-vs-legacy decision. `client/doctor-portal npm run typecheck` passed;
  the fresh complete clinician suite passed 83 files / 304 tests in 96.56s; the
  clinician production build (`npm run build`) succeeded. Three further defects
  were found in `client/shared` during the migration and fixed: (a)
  `exportDocumentToPdf` built its headers by hand and sent the wallet address
  in `X-User-Id` *alongside* a valid `Authorization: Bearer`, contradicting the
  contract documented in `client.ts`; (b) `useProviderDirectory` and (c)
  `useSSE` sent only the legacy header and ignored an available session token.
  All three now spread the shared helper. `client/shared npm run typecheck`
  passed and the patient suite passed 26 files / 83 tests. Source coverage is
  now zero direct production sites outside the shared authority; this is static
  and component evidence only and is not a browser, runtime, or rebuilt-image
  proof.

* New ratchet gate `scripts/check-legacy-identity-headers.py` (2026-08-25),
  registered in `.github/workflows/ci.yml` beside the endpoint-auth and
  write-authorization gates. It fails the build when any frontend production
  module outside `client/shared/src/api/client.ts` names the `X-User-Id`
  literal, and fails equally when its baseline goes stale, in the same shape as
  `check-state-durability.py`. Current run: `PASS — the legacy identity header
  is named at 2 site(s) in 1 module(s)`. `python scripts/lint-workflows.py`
  passed. All four gates pass together (endpoint-auth 424 handlers / 0 tier-0 /
  0 tier-1; write-authorization 13 accepted with 3 recorded owner decisions;
  state-durability 0 live references; legacy-identity 2 allowlisted sites).

* SC-002 partial closure — licence metadata (2026-08-25): the repository's
  authoritative `LICENSE` is a proprietary, all-rights-reserved grant (Lukau
  Invasion (Pty) Ltd), but shipped package metadata contradicted it in three
  places: `api/Cargo.toml` declared `license = "MIT"`,
  `client/shared/package.json` declared `MIT`, and
  `client/patient-app/package.json` declared `Apache-2.0` — each of which
  grants in metadata exactly the rights `LICENSE` withholds. `crypto/Cargo.toml`
  declared nothing, which is the `unlicensed medichain-crypto` failure recorded
  in the SC-002 row. Both Rust crates now carry `license-file = "../LICENSE"`
  and `publish = false`; all four npm packages now carry `private: true` and
  `"license": "SEE LICENSE IN LICENSE"`. `deny.toml` gained
  `[licenses] private = { ignore = true }`, cargo-deny's mechanism for
  unpublished workspace crates, so third-party checking is unchanged.
  `cargo metadata` confirms `license_file=../LICENSE, publish=[]` for both
  crates and `cargo deny check licenses` no longer reports any `unlicensed`
  finding. The remaining third-party licence rejections are unchanged and are
  deliberately left as an owner decision.

* SC-002 partial closure — NCSA rejection removed at its source (2026-08-25):
  the `(MIT OR Apache-2.0) AND NCSA` rejection was `libfuzzer-sys`, reached via
  `rav1e` → `ravif` → `image`, i.e. an entire AV1 encoder pulled in by `image`'s
  default features. `api/src/support.rs` and `api/src/nfc_simulator.rs` are the
  only consumers and both write one format: an 8-bit greyscale QR bitmap as
  PNG. `image` and `qrcode` are now declared `default-features = false` with
  `features = ["png"]` / `["image"]`. This removes 48 crates from `Cargo.lock`
  and adds none — including `rav1e`, `ravif`, `libfuzzer-sys`, `avif-serialize`,
  `exr`, `tiff`, `gif`, `image-webp`, `qoi`, `zune-jpeg` and `fax`, every one of
  them a decoder for a format MediChain never reads. `cargo check --bin
  medichain-api` passed. `cargo tree -i rav1e --all-features --target all` and
  the same for `libfuzzer-sys` now report no matching package. This is a
  supply-chain surface reduction, not only a licence fix, and it is preferable
  to granting an NCSA policy exception. Runtime coverage of the narrowed
  codecs: `cargo test --bin medichain-api qr` passed 3 tests including
  `nfc_simulator::tests::test_qr_image_generation`, which is the PNG encode
  path itself. `cargo test --bin medichain-api -- --skip repositories::postgres`
  then passed `402 passed; 0 failed; 1 ignored; 58 filtered out` in 5.02s.
  **The 58 filtered tests are the `repositories::postgres` set and were NOT
  run**: the Docker daemon was left unresponsive after C: reached 0 bytes free
  during this session (`docker ps` hangs; the recorded recovery is a Docker
  Desktop restart). The dependency change is a codec-feature narrowing and does
  not touch repository code, but that is an argument, not evidence — the
  PostgreSQL suite still owes a run before this row is closed.

* Session hazard worth recording against future evidence claims (2026-08-25):
  a backgrounded `cargo test` reported `completed (exit code 0)` through the
  task channel while its output actually ended in a `cc-rs`/`gcc.exe` failure
  building `zstd-sys`, because the build had died on disk exhaustion; reading
  the output file from Bash then failed with `write error: No space left on
  device`. `cargo clean` removed 23.5 GB and restored 20.6 GB free, after which
  the same command produced the genuine results above. **A background exit code
  is not evidence a Rust build passed on this host** — the output tail must be
  read, and a tool reporting a write error means checking free space first.

* SC-002 remaining advisories traced to their owning boundary (2026-08-25), so
  the outstanding work is upstream rather than local: `RUSTSEC-2026-0258` is
  `h2 0.3.27` ← `actix-http 3.13.1` ← `actix-web 4.14.0`; `RUSTSEC-2026-0173`
  is `proc-macro-error2 2.0.1` ← `subxt-macro 0.50.3` (a proc-macro crate, so
  compile-time only — it does not ship in the binary); `RUSTSEC-2026-0215` is
  `smallstr 0.3.1` ← `scale-info-legacy` ← `frame-decode` ← `subxt 0.50.3`. The
  subxt line cannot be moved independently: `Cargo.toml` records that its
  version is coupled to the runtime metadata format. `deny.toml`'s own header
  states that flipping advisory entries is the owner's call and not something
  to change inside a remediation pass, so no advisory was ignored or suppressed
  here.

* AUTH-003 root cause restated (2026-08-25). The finding was recorded as
  "clinician pages still emit legacy `X-User-Id`", which framed it as an
  unfinished migration measured by a count. The migration surfaced three
  defects in `client/shared` -- not in unmigrated pages -- and they share one
  cause: **request identity construction was not exclusively owned by one
  trusted client boundary.** `exportDocumentToPdf` re-derived the rule by hand
  and sent the wallet header *alongside* a valid Bearer token;
  `useProviderDirectory` and `useSSE` sent only the legacy header and ignored an
  available session. The count was a symptom. The defect class is a duplicated
  authentication policy, and it is what the ratchet gate and the contract tests
  below actually protect.

* AUTH-003 identity-contract consolidation and a real downgrade fix
  (2026-08-25). `client/shared/src/api/client.ts` re-derived the
  Bearer-vs-legacy rule inline in `executeRequest` and re-assigned `X-User-Id`
  under the same condition `getSessionHeaders()` already handles. That
  duplicate is folded: `getSessionHeaders()` is now the single decision, the
  signing branch keys off the identity header actually emitted rather than off
  `this.userId`, and the signed message binds that same emitted value, so the
  value signed and the value sent cannot diverge.

  **A live downgrade was found while doing it.** `refreshAccessToken()` calls
  `clearTokens()` when a refresh fails, which cleared both tokens but left
  `userId` set, so every subsequent request fell back to legacy identity. On
  the typed client the signature provider is still installed, and
  `api/src/middleware/signature_auth.rs` accepts a signed wallet header with no
  session at all -- so an expired *or revoked* session silently became
  per-request wallet authentication and kept working. Session revocation was
  therefore unenforceable against any client still holding a signer, which
  defeats the rotation/revocation property recorded under AUTH-002. Fixed with
  a latched `sessionEnded`: a client that never held a session keeps the demo
  path; a session that existed and ended yields no identity, including when a
  caller passes a wallet address explicitly. `setTokens()` with a real token
  clears the latch, so a genuine re-login is unaffected.

  Evidence: nine tests in
  `client/doctor-portal/src/api/identityContract.test.ts` pin the contract --
  no identity before sign-in; legacy header only on the tokenless demo path;
  Bearer never accompanied by the wallet header; a caller-supplied wallet
  cannot override an active session; no downgrade after revocation, after an
  explicit wallet offer, or after logout; genuine re-login restored; a
  never-signed-in client still reaches the demo path. **Three of the nine were
  verified to FAIL against the pre-fix source**, so they detect the real defect
  rather than describing the new code. Full clinician suite: 84 files / 313
  tests pass (was 83 / 304; +1 file, +9 tests). Patient suite: 26 files / 83
  tests. Shared, clinician and patient TypeScript checks pass. The
  legacy-identity ratchet still reports 2 allowlisted sites in 1 module.
  One earlier clinician full-suite run failed and the identical re-run passed
  with no source change between them; the first run's output was not retained,
  so it is recorded as an undiagnosed flake consistent with the TEST-002
  contention timeout, not as a clean result.

* AUTH-003 unresolved design gap surfaced by this work (2026-08-25): a Bearer
  session structurally cannot carry a wallet signature. The signing branch was
  gated -- and remains gated -- on the legacy identity header being present, so
  JWT sessions never sign. If privileged step-up requires a wallet signature
  (the AUTH-005 assurance matrix), the client must sign alongside Bearer and
  the server must verify that signature against the JWT subject rather than
  against `X-User-Id`. This is a design decision, not a migration leftover, and
  is not addressed here.

* SC-002 closed for the main workspace (2026-08-25). `cargo deny check` now
  reports `advisories ok, bans ok, licenses ok, sources ok`.

  Two of the three advisory findings were **removed at the source, not
  suppressed**. `RUSTSEC-2026-0258` (`h2 0.3.27`, unbounded empty HTTP/2 DATA
  frames) arrived through the `http2` feature of `actix-http`, on by default.
  `nginx/default.prod.conf` terminates HTTP/2 at the edge (`http2 on`) and
  proxies with `proxy_http_version 1.1`, so the API process never speaks
  HTTP/2. Verified no `awc`, no actix websockets, no `Compress` middleware, no
  cookie reads and no non-ASCII route patterns, then set
  `actix-web = { default-features = false, features = ["macros"] }` -- `macros`
  is required by 424 attribute-routed handlers. `cargo tree -i h2@0.3.27` now
  reports no matching package; only the already-patched `h2 0.4.16` remains.
  The NCSA rejection (`libfuzzer-sys`) was removed by the earlier
  `image`/`qrcode` narrowing. Combined: **60 crates removed from `Cargo.lock`,
  0 added.**

  The CDLA-Permissive-2.0 rejection is accepted as a package-scoped exception
  rather than a global allowance, so that licence does not silently become
  acceptable for future dependencies. **Both crate names are excepted:**
  `webpki-roots` and `webpki-root-certs` are separate published crates, each
  present at 0.26.11 and 1.0.9 via `sqlx-core`; excepting only the first leaves
  the gate red. Obligation carried by the exception: the distributed product's
  third-party notices must include the CDLA-Permissive-2.0 text.

  `RUSTSEC-2026-0173` (`proc-macro-error2`, a build-time proc macro that ships
  in no artifact) and `RUSTSEC-2026-0215` (`smallstr`) are **temporarily
  accepted upstream risk, not ignored**: both are INFO/unmaintained with no
  patched release, both are owned by `subxt`, and `subxt`'s version is coupled
  to the runtime metadata format. Each carries an inline reason and a removal
  criterion tied to the coordinated Subxt/runtime upgrade; the full record with
  its review trigger is in `docs/TECHNICAL_DEBT_REGISTER.md`.
  `cargo check --bin medichain-api` passes with the narrowed features.

* Evidence-state detail for the two rows above, recorded because a single
  `PARTIALLY FIXED` cannot distinguish "not started" from "everything except a
  browser run". Proposed as the pattern for the remaining rows.

  | Row | Implementation | Static | Automated | DB | Local runtime | Browser | Adversarial | Hosted CI | Release |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | AUTH-003 | complete | complete | complete | n/a | not run | not run | not run | not run | not run |
  | SC-002 (main workspace) | complete | complete | complete | n/a | complete | n/a | n/a | not run | not run |

  SC-001 (the separate `blockchain/` workspace lockfile) is untouched by this
  work and remains `STILL PRESENT`.

* Related open owner decision, not acted on (2026-08-25):
  `docs/TECHNICAL_DEBT_REGISTER.md` records that `blockchain/Cargo.toml`
  declares `license = "MIT"` while `medichain-node` links 17 strict GPL-3.0-only
  crates, all through `frame-benchmarking-cli`. That is the same
  contradictory-metadata defect corrected in `api` and `crypto` here, in a third
  place, and the proprietary root `LICENSE` sharpens the register's own options:
  because a proprietary licence cannot be granted over a work that links
  GPL-3.0-only code, **Option A (make the dependency optional) is the only route
  that keeps the node distributable under `LICENSE`**; Option B corrects the
  label but confines that binary to GPL-3.0-only distribution. Left entirely to
  the owner.

* Stale supply-chain documentation found while verifying the above
  (2026-08-25): `deny.toml`'s `[advisories]` header still describes four
  `rustls-webpki` advisories as reachable and unfixed, and its `ignore` list
  still carries `RUSTSEC-2022-0061`, `RUSTSEC-2024-0370`, `RUSTSEC-2024-0384`
  and `RUSTSEC-2025-0134`, none of which now match any crate -- cargo-deny
  reports four `advisory-not-detected` warnings. With both gates green, CI's
  `continue-on-error: true` on the advisory and licence steps can now be
  flipped to enforcing. All three are deliberately left alone: the file states
  that editing the advisory list is the owner's call.

* PostgreSQL baseline closed (2026-08-25). The 58 `repositories::postgres` tests
  had been unrun all session because the Docker daemon was wedged, and every
  earlier claim in this ledger was explicit that they were missing. Diagnosed
  rather than assumed: Docker Desktop was running with no `backend.error.json`,
  so this was not the recorded stale-socket startup failure -- the daemon had
  been wedged by C: reaching 0 bytes free. Killing the backend processes,
  `wsl --shutdown`, and relaunching brought all five containers back healthy.
  The suite was then run against the **committed** revision with the ADR-0008
  work stashed, so the session-migration tests are not substituted for the
  baseline they were supposed to follow:

      test result: ok. 58 passed; 0 failed; 0 ignored; 0 measured; 403 filtered out; finished in 965.05s

* ADR-0008 accepted and its session substrate implemented (2026-08-25).
  Two blocking questions from the implementation review were decided by the
  owner: the login session is split from the refresh generations rather than
  rotated in place, and initial break-glass is exempt from exact transaction
  signing.

  **Session split.** `auth_sessions::rotate()` previously revoked its row and
  inserted a successor with a fresh UUID, so no identifier survived a refresh and
  a `sid` claim would have been worthless -- a ten-minute Class B elevation would
  have died at the next token refresh. Migration `20260825000001` adds a parent
  `auth_login_sessions` table and a `login_session_id` foreign key on
  `auth_sessions`, backfilled so every historical generation becomes its own
  single-generation login (the old model recorded nothing about which rows
  belonged together, and inventing a grouping would fabricate session history;
  revoked generations produce revoked parents). The generation model itself is
  kept deliberately: revoking the predecessor and inserting a successor is what
  proves AUTH-002's concurrent-rotation property, and rotating in place would
  have discarded that evidence to make an identifier convenient.

  Rotation now retires the predecessor and reads its parent in a single
  `UPDATE ... RETURNING`, so one statement performs both the concurrency win and
  the lookup of which login to continue -- there is no second query to race. It
  joins `auth_login_sessions.revoked_at IS NULL`, so a logged-out session cannot
  be resurrected by a refresh token that is still cryptographically intact.

  **Issuance order.** `issue_access_token` now takes the session id, and
  `issue_token_pair` persists the session *before* minting the access token: a
  token is never returned for a session that failed to persist. If minting fails
  afterwards the unused session row simply expires, which is operational debris
  rather than an issued credential. MFA step-up and identity-context switching
  both carry the existing `sid` forward, since neither starts a new login;
  dropping it there would have silently detached the caller from their session's
  revocation and step-up state.

  **Logout did not exist.** Decision 1 requires logout and logout-all to revoke
  sessions, and the API had no logout endpoint at all -- both portals only
  discarded tokens client-side, which never ended the server session. Added
  `POST /api/auth/logout` and `POST /api/auth/logout-all`, plus
  `ApiClient.endSession()`, which revokes server-side and clears local
  credentials regardless of the outcome so a user who asked to sign out is never
  left holding credentials because the network was down.

* ADR-0008 corrections carried into the decision text (2026-08-25), each from a
  measured fact rather than a preference:

  - **Class E** added for emergency access. Initial break-glass is exempt from
    Class C and is not a fallback from it: "try Class C, else skip it" makes the
    control a switch an attacker wants to flip. Expiry stays at the implemented
    `EMERGENCY_GRANT_TTL_MINUTES = 15`; published break-glass guidance clusters
    at 15-60 minutes with automatic expiry, whole-day grants being for scheduled
    administrative access rather than field use, so the existing value was
    already at the protective end of that band and was justified rather than
    changed. Extension is Class C; ending one's own emergency session is Class A,
    because relinquishing privilege must never be impeded.
  - **Body digest** is taken over the exact transmitted bytes, not a
    re-serialisation. The existing path hashes `JSON.stringify(body)`, whose
    output depends on property insertion order, so reordering a struct literal
    silently changes the digest.
  - **Concurrency tokens** are per resource class. No Class C target table
    carries a version column, and adding one everywhere would be a migration
    across dozens of tables for a decorative field. State-machine resources bind
    to their terminal-status field with a conditional `UPDATE ... WHERE status =
    'pending'` requiring exactly one affected row; ordinary rows bind to
    PostgreSQL `xmin`, explicitly as an ephemeral database-local token for one
    120-second challenge and never as a durable business version.
  - **Challenges bind to `sub` + `sid`**, never to one access token's `jti`. This
    diverges from DPoP knowingly: an authorization the user has already approved
    must not become invalid because a token generation rotated while the wallet
    prompt was open.
  - **Authenticator assurance is recorded.** The Polkadot extension prompts a
    human; a password-unlocked `staff_credentials.encrypted_keystore` can sign
    silently. Both produce valid signatures and only one evidences intent, so
    every Class B/C authorization records authenticator type, key id, interaction
    class and assurance class.
  - **Failed authorizations produce security events** distinct from business
    audit, carrying no raw token, signature, body or patient detail, and
    themselves rate-limited so invalid signatures cannot exhaust storage.
  - **Class C gets its own rate budget**, not the anonymous login budget.

  ADR-0008 is recorded as *amending* ADR-0003 rather than superseding it: the
  base authentication and session architecture there is unchanged.

* The rotate/logout race, and a test that could not detect it (2026-08-25).
  Review raised a second race the single-statement rotation did not close: a
  concurrent logout could revoke the parent between the moment rotation read its
  state and the moment it inserted the successor, leaving a live refresh
  generation under a dead login. The invariant is that after a login session is
  revoked, no transaction may create another generation beneath it.

  Fixed by making the parent row the serialization point. `rotate()` now takes
  `SELECT ... FOR UPDATE OF s` on `auth_login_sessions` before touching any
  generation; `revoke_session()` locks the same row first; and
  `revoke_all_for_wallet()` locks every parent for the wallet in `ORDER BY id`
  before revoking, so two concurrent logout-alls cannot deadlock. Every path
  locks parent then generation, never the reverse.

  **The first two race tests did not prove the fix.** Written with
  `tokio::join!`, they passed three times in a row against the deliberately
  unfixed code, because two fast queries almost never interleave at the
  microsecond window that matters. They are kept as end-state assertions but
  they are not the evidence. The evidence is
  `test_pg_parent_session_lock_blocks_concurrent_revocation`, which holds the
  lock rotation takes and then proves from a second connection, with
  `FOR UPDATE NOWAIT`, that logout cannot proceed past it -- turning "would
  block" into an immediate observable error. That test **fails** with the
  `FOR UPDATE` removed and passes with it, verified in both directions.

* Session revocation is now enforced on every authenticated request
  (2026-08-25). Adding a `sid` claim changes nothing on its own: an access token
  stays cryptographically valid until it expires, so logging out would revoke the
  refresh generation while the access token kept working for the rest of its
  lifetime -- and "sign out everywhere" after a lost device would not actually
  sign anything out. `SessionStateMiddleware` resolves the claimed `sid` against
  `auth_login_sessions` on every Bearer request and rejects it when the session
  is revoked, unknown, or bound to a different subject than the token names. It
  is wrapped outside `JwtIdentityMiddleware` so a revoked session never reaches
  the point where its subject would be injected downstream, and it fails closed
  when session state cannot be read. This is a database lookup per authenticated
  request, accepted deliberately: the semantics are not worth weakening to save
  it, and it can be optimised later if measurement justifies it. Tokens issued
  before ADR-0008 carry no `sid` and are unaffected, as are in-memory
  deployments, which have no session store to consult.

* Full before/after evidence for the session substrate (2026-08-25), run in this
  order so the baseline could not be contaminated by the change it precedes:

  | Stage | Result |
  | --- | --- |
  | Pre-change PostgreSQL baseline (work stashed) | `58 passed; 0 failed` in 965.05s |
  | Focused session tests | `19 passed; 0 failed` |
  | Parent-lock regression, fix removed | **FAILED** (the intended detection) |
  | Parent-lock regression, fix restored | passed |
  | Post-change PostgreSQL regression | `66 passed; 0 failed` in 1007.27s (58 + 8 new) |
  | Full API suite, nothing filtered | `468 passed; 0 failed; 1 ignored` in 680.20s |
  | Clinician / patient suites | 84 files / 313 tests, 26 files / 83 tests |
  | Typechecks, production builds | all pass |
  | `cargo fmt --check`, `clippy --all-targets -D warnings` | clean |
  | 5 repo gates + workflow lint | pass |

  One clinician run failed on `NoteTemplatesPage` under suite contention and
  passed in isolation twice and on a full re-run. That file is untouched by this
  work, so it is recorded as a TEST-002-class flake rather than as a clean first
  result.

* Evidence-state detail for this slice:

  | Row | Implementation | Static | Automated | DB | Local runtime | Browser | Adversarial | Hosted CI | Release |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | ADR-0008 session substrate | complete | complete | complete | complete | not run | not run | not run | not run | not run |
  | ADR-0008 revocation enforcement | complete | complete | partial | partial | not run | not run | not run | not run | not run |
  | ADR-0008 Class B/C challenge | not started | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

  `SessionStateMiddleware` is marked *partial* on automated and DB evidence
  honestly: the store behaviour it depends on is covered by the session tests,
  but the middleware itself has no HTTP-level test asserting that a revoked
  session yields 401 on a real request. That belongs to the runtime/browser pass
  and is not claimed here.

  Class B step-up and Class C transaction authorization are deliberately not
  implemented here. The ordering was explicit: build the stable session first,
  prove it, and only then build the challenge state that depends on it.

* ADR-0008 Class B and Class C implemented (2026-08-25), on top of the session
  substrate rather than beside it.

  **One mechanism, two uses.** A Class B step-up is a challenge whose action is
  `session.step_up` and which binds nothing but the session; a Class C
  authorization binds the exact mutation as well. Keeping one code path means the
  replay, expiry, session-binding and single-use guarantees cannot drift apart
  between them, which is the failure mode a parallel implementation invites. The
  reserved step-up action is refused by the transaction endpoint, so a step-up
  signature can never be presented as authorization for a real mutation.

  **What the signed message covers**, and therefore what a signature cannot be
  moved to: protocol version, audience, subject, session, challenge id, action,
  method, path, body digest, resource id, expected resource state, idempotency
  key, nonce, expiry. A unit test asserts that changing *each* of these produces
  a different message, so the binding is proven field by field rather than
  assumed from reading the format string.

  **The body digest covers transmitted bytes.** `body_digest` hashes the byte
  slice, never a re-serialisation, and the empty body has a stated digest
  (verified against the known SHA-256 of the empty string) rather than an
  implicit one. A test pins that two orderings of the same logical JSON hash
  differently -- the case a canonicalising implementation would have silently
  merged.

  **Verification order, with consumption last.** Existence, expiry, prior
  consumption, session binding, subject binding, session liveness *at the moment
  of use*, intent match, expected-state match, nonce, authenticator class, and
  only then the signature; the challenge is consumed on a conditional UPDATE that
  requires it still be unconsumed. A rejected attempt therefore cannot burn a
  legitimate user's authorization, and two concurrent valid submissions still
  yield exactly one authorization. A test asserts both halves.

  **Assurance is not uniform and the code says so.** `AuthenticatorType`
  distinguishes the prompting extension from a password-unlocked keystore that
  can sign silently, `authorize_transaction` takes `require_interactive` from the
  action rather than the caller, and the consuming UPDATE records which
  authenticator was used. A test shows the same valid signature is accepted where
  possession suffices and refused where the action demands human intent.

  **Refusals are recorded and indistinguishable.** Every `AuthorizationFailure`
  maps to a security event written to `auth_security_events`, a table with no
  column capable of holding a token, signature, body or patient identifier -- a
  test asserts that by querying `information_schema`. Event writing is
  deduplicated within a short window, and a test floods 25 identical failures and
  asserts fewer are written, so the logging cannot become the resource-exhaustion
  vector it exists to detect. The client message is uniform across every failure,
  asserted by collecting them into a set of size one: a caller probing the
  protocol learns that authorization failed, not which check caught it.

  **Budgets are per session, not per wallet or per IP.** At most 3 unconsumed
  challenges and 10 issued per 5 minutes, enforced under a PostgreSQL advisory
  lock so replicas share one budget, and separate from the anonymous login
  challenge budget, which defends a different resource. Exceeding either is
  itself a recorded security event.

  Endpoints: `POST /api/auth/step-up/challenge`, `POST /api/auth/step-up/verify`,
  `POST /api/auth/transaction/challenge`, `GET /api/auth/assurance`. The last
  exists so a client can discover it needs to elevate before starting a
  privileged workflow instead of learning it from a rejected mutation.

  Evidence: 8 unit tests on the signed-message contract and 10 PostgreSQL tests
  driving the real protocol with real sr25519 signatures, including a forged
  signature from a different dev key, six ways of presenting a changed request,
  cross-session presentation, use after logout, replay of a consumed challenge,
  and elevation surviving a refresh rotation while dying with the session.

* Endpoint-auth gate extended, and a near-miss worth recording (2026-08-25). The
  six new endpoints authenticate through `get_current_claims`, a verified-JWT
  extractor the marker list predated, so the gate correctly reported them as
  tier 0 -- no auth decision. The first fix added the marker to `AUTH_MARKERS`,
  which `classify()` never reads: it would have looked like a fix and changed
  nothing, and the gate kept failing, which is the only reason it was caught.
  The markers now sit in `KNOWN_MARKERS` (tier 2, "registered identity
  resolved") with the reasoning that a verified signature and expiry check
  resolves a real caller, strictly more than reading `X-User-Id`, which stays in
  `PRESENCE_MARKERS` precisely because it is only a header. Gate returns to
  tier 0 = 0.

* Evidence-state detail after Class B/C:

  | Row | Implementation | Static | Automated | DB | Local runtime | Browser | Adversarial | Hosted CI | Release |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | ADR-0008 Class B step-up | complete | complete | complete | complete | not run | not run | not run | not run | not run |
  | ADR-0008 Class C transaction auth | complete | complete | complete | complete | not run | not run | not run | not run | not run |

  Explicitly outstanding, and not claimed anywhere: no Class C requirement is
  yet *attached* to a real clinical mutation. The mechanism is built, proven and
  reachable, but the assurance matrix that says which specific handlers demand
  Class B or Class C is policy the deciders own, and wiring it without that
  decision would be inventing clinical governance. No HTTP-level test yet asserts
  a revoked session returns 401 on a live request, and nothing here is
  browser-verified.

## Remaining release blockers

`DATA-001`, `PRIV-001`, `SC-001`, and `SC-002` remain P1 blockers. SEC-001, SEC-002,
APP-001, and INT-001 require their missing runtime, browser, database, and
external-service evidence before they can become `CONFIRMED FIXED`. The Phase
B/C trust, session, outbox, consent, and durability work has not been closed
by this ledger.

## Complete outstanding-scope register — reconciled 2026-08-24

This appendix records every deliverable, validation lane, and decision from
the whole-system reassessment and Deep Scan override prompts that is not
demonstrated by the evidence above. It is intentionally broader than the
finding table: a requirement can remain open because it was never assessed,
because it was assessed only from source, or because it was implemented but
not independently qualified. It does **not** convert source inspection, a
unit test, a component test, a Compose render, or a route-render check into
runtime, browser, external-integration, multi-tenant, or production proof.

### Non-negotiable coverage boundaries

| Coverage lane | Status | Outstanding action |
| --- | --- | --- |
| Deep Scan | UNKNOWN | `TOOLING-BLOCKER-001`: Deep Scan was blocked before discovery because its worker could not obtain the managed read-only filesystem permission profile. It reviewed 0 repository files and produced no findings. Do not retry blindly, alter repository permissions, weaken sandboxing, or draw any security conclusion from the failure. Run it later only in a supported managed environment and reconcile it as an independent lane. |
| Manual source review | PARTIALLY FIXED | The tracked-file inventory is not a handler-by-handler manual review. Complete traceable coverage for every source/configuration file, endpoint, workflow, role, persistence path, integration, and trust boundary; record reviewer, files, evidence, and unknowns. |
| Direct API adversarial validation | PARTIALLY FIXED | Current focused probes do not cover every protected endpoint, all roles, wrong hospital/patient/resource IDs, expired credentials/consent, missing MFA, replay, duplicate, concurrent, or revoked-access cases. Execute the matrix below against an isolated safe environment. |
| Runtime/browser validation | PARTIALLY FIXED | Existing browser evidence is limited to public/entry pages and a synthetic patient read/navigation session. It is not control-by-control, mutation, clinician, staff-role, authorization-denial, or cross-role proof. |
| Database verification | PARTIALLY FIXED | Existing migration, targeted transition/race, and bounded restore evidence does not cover all clinical writes, all transaction boundaries, all rows/tables, decrypted records, API-against-restored database, multi-replica behavior, or RPO/RTO. |
| Hosted release qualification | UNKNOWN | The revised branch has been pushed, but a current hosted workflow, artifact, SBOM upload, image scan, registry digest/attestation, and deployed release proof have not been captured. |

### Architecture, requirements, and audit deliverables not yet produced

| ID | Outstanding deliverable | Evidence gap / closure criterion | Status |
| --- | --- | --- | --- |
| AUDIT-001 | Dated audit plan and explicit scope exclusions | Produce the phase plan, source-of-truth hierarchy, evidence rules, environment boundaries, and approval/validation sequence used for the reassessment. | UNKNOWN |
| AUDIT-002 | Whole-system inventory | Inventory frontend, API, database, migrations, repositories, blockchain, IPFS, external services, Docker/ingress, background jobs, CI/CD, secrets/configuration, tests, documents, and operational tooling with paths and runtime ownership. | UNKNOWN |
| AUDIT-003 | Current architecture, intended architecture, and drift map | Reconstruct component/data/control flows and compare them with maintained documentation and stated requirements. Include the API edge, auth, authorization, persistence, IPFS, blockchain, integrations, metrics, CI/CD, and admin paths. | UNKNOWN |
| AUDIT-004 | Functional/NFR reconstruction | Map implemented and intended requirements to evidence. Explicitly cover safety, privacy, availability, durability, RPO/RTO, performance, scale, accessibility, auditability, and multi-hospital posture. | UNKNOWN |
| AUDIT-005 | Claims-versus-reality matrix | Reconcile README/CLAUDE/architecture/ADR/plan claims with current source and runtime evidence; flag stale or unsupported claims rather than rewriting historical records. | UNKNOWN |
| AUDIT-006 | Complete debt/risk/root-cause register | Produce the requested debt classification, dependency map, root-cause grouping, risk register, architecture decisions required, prioritized remediation programme, recommended execution order, and explicit “must not add yet” list. | UNKNOWN |
| AUDIT-007 | Architecture fitness functions | Define enforceable checks for auth identity provenance, endpoint authorization, tenant boundary, durable writes/outbox, idempotency, migration compatibility, no-PHI logging, release provenance, and security-regression prevention; wire and demonstrate them in CI. | UNKNOWN |

### Manual security reassessment outputs still required

| ID | Outstanding deliverable | Evidence gap / closure criterion | Status |
| --- | --- | --- | --- |
| SEC-MAP-001 | Security attack-surface and trust-boundary map | Trace external actor → frontend → reverse proxy → API → authentication → authorization → services → persistence. Add blockchain, IPFS/files, PostgreSQL/cache, background workers, admin/metrics/internal endpoints, emergency access, integrations, CI/CD, and secret stores. Mark every boundary and trust assumption. | UNKNOWN |
| SEC-INV-001 | Endpoint security inventory | Enumerate every backend endpoint with method, path, purpose, authentication mechanisms, identity source, authorization/permission/role, hospital/resource/consent/MFA scope, sensitivity, mutation/audit expectation, tests, and potential bypass. Do not infer this from middleware names. | UNKNOWN |
| SEC-AUTH-004 | Authentication graph and weakest-path analysis | Trace every `Authorization`/Bearer/JWT/signature/wallet/session/cookie/header/refresh/MFA/OTP/step-up entry path through actual middleware ordering into protected handlers. Prove whether the weakest accepted path can bypass the strongest path's controls. | PARTIALLY FIXED |
| SEC-AUTHZ-001 | Role × resource × action × scope matrix | Populate from code and direct validation for patient, doctor, nurse, hospital admin, system admin, pharmacist, lab technician, and emergency personas. Include relationship, assigned-care, ownership, hospital, and deployment scopes; do not guess policy. | UNKNOWN |
| SEC-IDOR-001 | Object-reference / IDOR review | Trace all routes accepting user, patient, provider, doctor, hospital, tenant, document, record, appointment, request, or approval identifiers. For each, show server-side authorization against the target object and test manipulated IDs. | UNKNOWN |
| SEC-BULK-001 | Bulk/list/search/analytics/export scoping review | Review every list/all/search/report/export/dashboard/summary/statistics query and its repository SQL. The existing 39 deployment-wide `list_all` reads and single-organisation assumption require explicit acceptance or tenant-safe redesign before multi-organisation use. | PARTIALLY FIXED |
| SEC-APPROVAL-001 | Complete approval-workflow audit | For each approval, consent, access, retention, break-glass, guardian, credential, and administrative workflow answer all 20 prompt questions: creator, eligibility, exact object/version, reviewer/approver, self-approval, tenant, MFA, state machine, expiry/revoke/change handling, concurrency/idempotency, downstream transactions/audit/failure, direct API/ID manipulation, and exact later browser test. | UNKNOWN |
| SEC-THREAT-001 | Implementation-grounded threat model and finding register | Document the specified cross-patient, cross-hospital, manipulated-provider, self-approval, MFA bypass, revoked-session/consent, permanent emergency access, modified approval, bulk-read, restart/cache/audit/log/blockchain scenarios with precondition, entry point, boundary, expected control, evidence, impact, and validation. Give each finding the required code/documentation/negative/direct-API/browser/independent-validation fields and state Deep Scan corroboration as unavailable. | UNKNOWN |
| SEC-VALIDATE-001 | Safe adversarial security validation plan | For every relevant endpoint execute or schedule valid, unauthenticated, expired-auth, wrong-role, wrong-hospital, wrong-patient, modified resource/hospital/provider ID, self-approval, direct API, replay, duplicate, concurrent, revoked permission, expired consent, and missing-MFA cases. Record expected and actual results. | UNKNOWN |

### Trust-model, authorization, consent, and persistence work still open

| ID | Outstanding work | Evidence gap / closure criterion | Status |
| --- | --- | --- | --- |
| AUTH-003 | Retire `X-User-Id` as a trusted production identity mechanism | Migrate the remaining clinician direct-call sites and test/demo paths; prove a current production-mode JWT/signature session across all roles. Preserve required wallet-signature step-up. Remove or tightly quarantine demo compatibility only after a documented migration decision. | PARTIALLY FIXED |
| AUTH-004 | Session lifecycle qualification | Validate short-lived access tokens, rotating hashed refresh sessions, JTI/session revocation, logout, logout-all, reuse detection, multi-device behavior, expiry, revocation propagation, and browser lifecycle. | PARTIALLY FIXED |
| AUTH-005 | Privileged MFA / step-up policy | Identify every privileged and clinical-risk action, specify step-up policy and assurance level, then test missing/expired/wrong/replayed MFA and direct API bypasses. | UNKNOWN |
| AUTHZ-001 | Per-resource and relationship authorization | Beyond endpoint gate counts, prove doctor/patient, nurse/assigned patient, pharmacist/lab, admin/hospital, and emergency scopes at query and mutation time, including direct API negative cases. | UNKNOWN |
| TENANT-001 | Multi-hospital/tenant decision and proof | The one-active-organisation startup guard is not multi-tenant isolation. Decide whether production is single organisation or multi-hospital; for multi-hospital, add and validate tenant propagation, query scoping, cache/job/file/integration isolation, and cross-tenant denial. | PARTIALLY FIXED |
| CONSENT-001 | Consent lifecycle and downstream enforcement | Prove grant, expiry, revoke, refresh/direct API denial after revoke, downstream document/record visibility, audit trail, concurrent transitions, and browser workflows. Existing targeted DB rehearsal is insufficient. | PARTIALLY FIXED |
| APP-001 | Full maker-checker lifecycle proof | Validate stale/double/concurrent approvals, resource change after approval, expiry/revocation, downstream effect rollback, direct API and browser self-approval denials for every applicable flow. | PARTIALLY FIXED |
| DATA-001 | End-to-end durable idempotency | Validate response-loss recovery, stored/replayed response semantics, atomic business-write/completion coupling, API restart, replica switching, high-risk offline queue behavior, and browser mutations. | PARTIALLY FIXED |
| AUD-001 | Required audit/outbox transactional semantics | Catalogue every critical business transition and prove the mutation and audit event are atomic where required; test rollback, backlog, retry, ordering, tamper resistance, and recovery. The current mobile-state ordering remains a release blocker. | PARTIALLY FIXED |
| DATA-002 | Database data-integrity and disaster-recovery qualification | Test representative clinical writes/read-backs, transaction isolation/races, API restart, DB restart, backup/restore all relevant data (including encrypted/decrypted access as permitted), API against restored DB, RPO/RTO, retention, and off-site/operational backup policy. | PARTIALLY FIXED |
| PRIV-001 | Sensitive-data, telemetry, and error-sink qualification | Complete static/dynamic review of structured logs, direct stdout/stderr, metrics, traces, browser telemetry, collectors, proxies, dashboards, error responses, documents, and third-party integrations. Add leakage tests for each sink. | PARTIALLY FIXED |

### Browser workflow qualification — required before release

No role below has a complete control-by-control browser ledger. For every visible
control: exercise allowed behavior, invalid input, denied access, loading,
empty, and error state. For every mutation prove: UI create/update → API
read-back → database read-back where appropriate → UI read-back → reload →
logout/login → read-back. Capture dated console/network evidence.

| ID | Required live browser coverage | Status |
| --- | --- | --- |
| BROW-001 | Doctor: production-like sign-in, dashboard, patient selection, clinical forms/orders/notes/documents/telehealth, invalid/denied states, writes/read-backs, sign-out/relogin, wrong-patient and wrong-hospital URL/API denial. | UNKNOWN |
| BROW-002 | Nurse: sign-in, assigned-care workflow, handoffs/care plans/IV and clinical updates, role limits, persistence, doctor→nurse→patient dependent flow, and audit evidence. | UNKNOWN |
| BROW-003 | Patient: real sign-in/out, records/documents, appointments, messages, consent grant/revoke, emergency card, profile/settings, invalid/error/empty/loading states, and persisted read-backs. Existing nine-route session is read-only only. | PARTIALLY FIXED |
| BROW-004 | Admin: staff/role/tenant/approval/retention/audit/operational controls, privilege boundaries, MFA, self-approval denial, and direct-API parity. | UNKNOWN |
| BROW-005 | Pharmacist and lab technician: sign-in, permitted result/prescription workflow, prohibited patient/resource access, mutations, persistence, and audit trail. | UNKNOWN |
| BROW-006 | Emergency persona: break-glass initiation, NFC/credential constraints, expiry, revocation, emergency-only scope, audit, denied non-emergency access, and recovery behavior. | UNKNOWN |
| BROW-007 | Cross-role / cross-hospital security scenarios | Doctor creates → nurse acts → patient sees only permitted result → audit confirms activity; Patient grants/revokes → doctor refreshes/direct API denied; Hospital A user requests Hospital B URL/resource → denied. | UNKNOWN |
| BROW-008 | Browser testability infrastructure | Provide isolated synthetic staff fixtures, role-to-patient links, safe login/authentication, deterministic reset/teardown, and runtime/source-image identity. Do not use a route render or component test as a substitute. | UNKNOWN |

### API, external integrations, blockchain, and operational qualification

| ID | Outstanding work | Evidence gap / closure criterion | Status |
| --- | --- | --- | --- |
| INT-001 | National identity live/sandbox verification | Exercise supported provider success, failure, timeout, malformed response, credential error, and production startup mode; prove no stub can return production “verified.” | PARTIALLY FIXED |
| EXT-001 | External integration qualification | Safely test national identity, email, SMS, push, IPFS, telehealth, FHIR, and any service-to-service credentials: success, authentication, timeout/retry, outage, reconciliation, sensitive-data handling, and audit behavior. | UNKNOWN |
| SEC-002 | Private telehealth provider proof | Run production-like provider-enabled startup and authenticate/join/deny/outage/cleanup tests using private rooms; prove no public fallback. | PARTIALLY FIXED |
| API-001 | API boundary architecture decisions | Decide, with requirements evidence, whether API gateway, rate-limit/WAF policy, load balancer, background-worker isolation, cache, and service-to-service trust mechanisms are needed now; do not add infrastructure by assumption. | UNKNOWN |
| BC-001 | Blockchain end-to-end qualification | For business/audit event: create → outbox pending → submit → finalized block → query commitment → recompute source hash → equality. Test unavailable chain, recovery, duplicate/replay, and audit consistency. The finalized-chain test remains ignored. | UNKNOWN |
| BC-002 | Blockchain deployment/security review | Qualify the external runtime, genesis role bootstrap, signer/key custody, node/RPC exposure, multi-validator operation, pallet authorization, dependency advisories, and no-PHI-on-chain invariant. | UNKNOWN |
| OPS-001 | pgAdmin operational decision | Either demonstrate a restricted debug-only admin workflow or remove it from the operational baseline with documented rationale; do not treat a `302` as administrator access/security proof. | PARTIALLY FIXED |
| OPS-002 | Monitoring and alert delivery | Prove authenticated Prometheus scrape in production-like mode, target health, dashboard login, dashboard correctness, alert evaluation/delivery/response path, and absence of PHI/high-cardinality identifiers. | PARTIALLY FIXED |
| OPS-003 | Secrets/configuration/production exposure review | Inventory all secrets and config precedence, secret injection/rotation, debug/demo flags, TLS/ingress/header forwarding, CORS/CSRF, database permissions, network exposure, and fail-closed startup behavior. | UNKNOWN |

### Reliability, performance, supply-chain, CI/CD, and documentation debt

| ID | Outstanding work | Evidence gap / closure criterion | Status |
| --- | --- | --- |
| REL-001 | Reliability and resilience programme | Define SLOs first, then test timeout/retry, API restart, DB restart, duplicate submission, outbox backlog/recovery, provider failure, multiple replicas, cache/job behavior, and chain failure/recovery. | UNKNOWN |
| PERF-001 | Performance/scalability programme | Define representative workload and SLO targets; measure capacity, DB-pool saturation, p95/p99 latency, error rate, large encrypted upload, queue/backlog, backup/restore timing, and horizontal scale behavior. | UNKNOWN |
| CI-001 | Current hosted CI and release gate | Run the revised branch in GitHub Actions and retain logs for API, PostgreSQL E2E, frontend build/typecheck/tests, static gates, dependency policies, and synthetic workflow. The known old-commit failures do not validate current source. | PARTIALLY FIXED |
| CI-002 | Artifact provenance and supply-chain proof | Produce current hosted SBOMs, dependency/container scans, signed/published artifact or attestation, exact source SHA → image digest linkage, registry verification, and release deployment provenance. | UNKNOWN |
| SC-001 | Remaining dependency advisories | Triage and remediate or formally accept the remaining main-workspace and blockchain RustSec findings with upstream constraints, impact analysis, upgrade plan, regression evidence, and a time-bound owner. | STILL PRESENT |
| SC-002 | Dependency license-policy failures | Resolve or formally accept NCSA/CDLA policy failures and the missing `medichain-crypto` SPDX declaration with legal/maintainer approval; do not bypass `cargo deny` policy blindly. | STILL PRESENT |
| DOC-001 | Documentation/ADR reconciliation | Update maintained docs only after evidence: architecture, auth/identity header contract, endpoint/health/readiness, deployment, backup/restore, monitoring, tenant posture, external integrations, browser qualification, and blockchain constraints. Preserve historical audit records and date all superseding evidence. | UNKNOWN |
| TEST-001 | Test-debt reconciliation | Classify the historical failing/generated frontend tests, restore/replace only tests that exercise real code and current policy, remove stale assumptions through approved changes, and publish a traceable suite/coverage matrix. | UNKNOWN |

### Required release decision

Do not declare healthcare-production readiness, close P1 findings, or label the
system secure because code appears correct until all applicable implementation,
automated, direct runtime, database, browser, external-provider, and hosted
artifact evidence is captured. The minimum gate remains: no open critical/high
finding; all P1 implementation plus independent evidence; full role browser
ledger; database restart and backup/restore qualification; authenticated
metrics and alert delivery; no insecure production/demo fallback; exact
source-to-release artifact provenance; and an explicit acceptance record for
any P2 exception. Until then, every row above remains a work item, not a pass.
