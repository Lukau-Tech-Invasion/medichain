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
| Browser workflows | Bounded live coverage: public landing, clinician credential-entry/alternate-sign-in access, and an already-authenticated synthetic patient session across eight read/navigation routes plus reload persistence. No browser mutation, clinician sign-in, staff role, consent change, appointment booking, emergency action, or cross-role workflow has been executed. |
| Database verification | Migration startup plus targeted idempotency, retention maker-checker, and consent-revocation transition rehearsals; not a full business-write/race or restore verification |

Manual inventory at this checkpoint: 918 tracked source/config files in scope,
including 241 Rust files, 320 TypeScript/TSX files, and 63 SQL migrations.
This is inventory coverage, not a statement that every file has been manually
reviewed. Static follow-up still finds 235 `X-User-Id` references and 152 direct
`println!`/`eprintln!`/`dbg!` calls in API source; those counts define remaining
authentication and log-sink audit scope.

## Findings

| ID | Severity | Root cause | Changed files | Automated evidence | Runtime/API evidence | Browser/DB evidence | Commit | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | P1 | Anonymous routes disclosed wallet-linked identity before ownership proof. | `api/src/auth_challenges.rs`, `api/migrations/20260821000001_auth_challenges.sql`, auth handlers/routes/types, shared and portal auth clients | Focused challenge and JWT-field tests pass. | Rebuilt image `sha256:dc878554…` is healthy. Legacy anonymous login returns `404`; known and unknown valid wallets return exactly the same top-level (`challenge`, `instructions`, `success`) and challenge field names, with no name/role/patient/linkage fields. | Browser wallet signing, valid proof, replay, expiry, and database race verification not yet run. | `8a7a5e3` | PARTIALLY FIXED |
| SEC-002 | P1 | Provider failure could fall back to public Jitsi. | `api/src/telehealth.rs`, telehealth endpoint, startup, production compose | Disabled-provider test passes. | Production Compose resolves `IS_DEMO=false`, `REQUIRE_SIGNATURES=true`, and `TELEHEALTH_ENABLED=false` by default. A provider-enabled production startup was not launched. | No provider outage or unauthenticated-join test. | `8a7a5e3` | PARTIALLY FIXED |
| APP-001 | P1 | Access requests could be self-approved and grants could be indefinite. | `api/src/handlers/access_control.rs`; retention repositories; consent workflow/repositories/routes | Focused access, retention maker-checker, and one-time consent-revocation tests pass. | Not exercised with authenticated roles. | Direct PostgreSQL rehearsals: requester self-approval updated 0 rows and left a synthetic pending request unchanged; a distinct approver updated 1 row. A synthetic consent revoke set legacy and authoritative fields to withdrawn, and a second revoke updated 0 rows. Probe data was removed. The authenticated patient portal reaches its `Access Control` page in-browser, but no browser consent request, grant, approval, revoke, or concurrent-role workflow was performed. | `492546e`, `211f3cc` | PARTIALLY FIXED |
| AUD-001 | P1 | High-risk business mutations and durable audit-outbox inserts were often separate operations; handlers could log an outbox failure and still return a successful mutation. | Patient access, guardian relationships, emergency grants, and the PostgreSQL identity-claim link now span their business transition and prepared audit event. Registry bulk reads, managed-device revocation, and mobile-device revocation now fail closed when audit persistence is unavailable. | Isolated PostgreSQL tests prove patient-access, guardian, emergency-grant, and identity-claim rollback behavior. | `cargo check -p medichain-api --message-format short` passes. Static follow-up finds each remaining audit-error branch returns `503`; none returns a success response. | The device/mobile stores remain memory-authority state, so audit-first ordering prevents successful unlogged mutations but does not prove restart durability or strict all-or-nothing atomicity. No browser/deployed-image evidence exists. This remains a release blocker. | pending | PARTIALLY FIXED |
| INT-001 | P1 | Production could treat stub identity verification as verified. | `api/src/national_id.rs`, handler, startup, production compose | National-ID test module passes. | Production Compose resolves `NATIONAL_ID_VERIFICATION_MODE=live`; production startup and real/sandbox provider verification remain unexecuted. | No live/sandbox provider verification. | `8a7a5e3` | PARTIALLY FIXED |
| DATA-001 | P1 | Process-local idempotency and offline queue had no stable end-to-end key or durable operation state. | `client/shared/src/api/client.ts`, `api/src/middleware/idempotency.rs`, `api/migrations/20260822000002_idempotency_operations.sql` | Shared-client typecheck and middleware digest-scope test pass. | Rebuilt image `sha256:dc878554…` is healthy and applied migration `20260822000002`. A synthetic authenticated challenge request produced one completed PostgreSQL claim; same key/body returned `409 IDEMPOTENCY_DUPLICATE`, and same key/different body returned `409 IDEMPOTENCY_KEY_REUSED`. After API recreation, the same request remained `409` and the claim remained `completed`. Automatic reconnect replay remains disabled. | Two-replica, response-loss, business-write atomicity, and browser proof remain absent. | `0ed9bb7`, `60a543a` | PARTIALLY FIXED |
| PRIV-001 | P1 | Sensitive identifiers can enter logs and related telemetry. | `api/src/privacy_logging.rs`, logging initialization, `api/src/middleware/signature_auth.rs`, `api/src/main.rs` | Sanitizer and `log::Record` sink-path leakage tests pass, including labelled wallet fields; a focused enabled-middleware response regression test passes; the API compiles after routing dynamic startup errors and the configured blockchain URL through the shared logger. | Rebuilt image `sha256:2f2d380d…` is healthy. An isolated signature-enabled API instance returned `400` to an invalid-signature request without reflecting the supplied wallet; its corresponding log rendered `wallet [REDACTED]`. The newer startup-log change has source/build proof only because its image build stalled and was terminated; its runtime status is `UNKNOWN`. | Static follow-up reduced direct stdout/stderr/debug sites from 152 to 142. Remaining sites are startup banners/route templates, ignored synthetic blockchain E2E output, and test cleanup; browser/metrics collector audit remains incomplete. | `4af04c7`, `67240d8`, `bf58b86`, `254fd50` | PARTIALLY FIXED |
| AUTH-002 | P2 | Refresh JWTs were stateless and non-rotating. | `api/src/auth_sessions.rs`, auth JWT handler, session migration, shared client | Session-token hash test and shared-client typecheck pass. | Not yet rebuilt into a running API. | A pre-existing synthetic patient browser session remains authenticated after a dashboard reload, but this does not prove JWT issuance, refresh rotation, reuse rejection, logout, multi-device behavior, migration, or server-side session persistence. | `56ad565`, `e48705a` | PARTIALLY FIXED |
| OPS-001 | P2 | Development pgAdmin crash-looped because its default email used a reserved `.local` domain rejected by the current image. | `docker-compose.yml`, `.env.example`, PostgreSQL guide | Compose configuration resolves a globally valid development-only default; production compose already restricts pgAdmin to its `debug` profile with no public port. | After recreation, pgAdmin remained up and `http://localhost:5050/` returned `302 /browser/`; startup log shows Gunicorn listening on port 80. | No browser login or DB-admin workflow was exercised. | pending | PARTIALLY FIXED |
| OPS-002 | P2 | Backup/restore mechanism had not been demonstrated end to end. | `scripts/backup-postgres.ps1`, `scripts/restore-postgres.ps1`, row-count query helper | Backup script produced custom dump, SHA-256 checksum, and exact row-count manifest. Restore script verified checksum and exact table-by-table counts. | Local development backup created `medichain-20260822T025708Z.dump`; restore into isolated `medichain_restore_audit_20260822` reported `PASS`. Source and restored patient counts were both 81; restored `_sqlx_migrations` count was 62. A disposable API instance connected to the restored DB, rechecked migrations, loaded users/patients, and returned health `200`. | No decrypted-record read-back, backup policy/RPO/RTO, off-site storage, or browser evidence. | pending | PARTIALLY FIXED |
| OBS-001 | P2 | Prometheus had no authenticated scrape configuration and its default scrape path did not match the API route. | `.env.example`, Compose API/Prometheus configuration, `docs/observability/prometheus.yml`, alert rules | Compose resolves a runtime `metrics_token` secret mounted at `/run/secrets/metrics_token`; Prometheus config uses `/api/metrics` and `credentials_file`, while the API receives the same environment token. | Anonymous `/api/metrics` returned `401`; bearer-authenticated probe returned `200` Prometheus exposition. Monitoring-profile Prometheus reported target health `up` with `lastError` empty at `http://api:8080/api/metrics`; its rules API reported all five MediChain alert rules with health `ok`. | Alert firing/delivery, Grafana browser workflow, production credentials, and no-PHI metric-label audit remain absent. | `a0748dc` | PARTIALLY FIXED |
| ARCH-001 | P2 | Correctness-critical state previously risked process-local storage and handler authorization had uneven explicit coverage. | Handler inventory, repository wiring, authorization gate scripts | Endpoint-auth gate scanned 424 handlers: 74 resource/patient scoped, 246 role authorized, 67 registered-identity resolved, 0 presence-only, 0 with no decision. Durability gate found 65 AppState maps and 0 live production references. | Static-only. | Write-authorization gate accepts 13 reviewed writes but leaves three owner decisions for break-glass emergency access and NFC identity issuance; no browser/production role matrix execution. | pending | PARTIALLY FIXED |
| TEST-001 | P2 | Parallel PostgreSQL tests concurrently swept and dropped the same historical test schema; SQLx also serialized isolated-schema migrations with a database-wide lock. | `api/src/repositories/postgres/tests.rs` | Focused PostgreSQL repository test passes after serializing extension setup, stale-schema sweeping, and test-schema creation. A 34-test PostgreSQL subset passes with eight test workers after disabling only the redundant database-wide migration lock for fresh isolated schemas. A fresh complete API suite passes. | The subset completed `34 passed; 0 failed` in 241.32s with zero advisory-lock waiters. The complete API suite then completed `421 passed; 0 failed; 1 ignored` in 201.12s. | Browser/database restore evidence remains separate. | `abc906e`, `c2e6e34` | PARTIALLY FIXED |
| TEST-002 | P2 | The clinician frontend full-test gate was vulnerable to a legitimate crypto test exceeding the global 10-second timeout under suite contention; compatibility warnings remain. | `client/doctor-portal/src/store/credentialKeystore.test.ts`, Vitest configuration, affected page rendering keys | Patient full suite passed: 26 files, 82 tests. The previously timing-out seed-derived credential round-trip now has a local 30-second budget and passed 7/7 in a single-worker focused run. Duplicate-key handling was corrected for provider options and note-template/section lists; focused `AppointmentsPage` (7 tests) and `NoteTemplatesPage` (3 tests, single worker) now pass without their former key warnings. A fresh full clinician suite and the React Router v7 future-warning remediation remain unexecuted. | No browser mutation or production build proof for these cases. | Unit tests are not browser evidence. The keystore test is security-relevant because it covers a clinician signing credential. | pending | PARTIALLY FIXED |
| CI-001 | P2 | API image artifacts lacked a machine-verifiable source revision. | `api/Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml` | API runtime image now carries OCI `org.opencontainers.image.revision`; local Compose explicitly marks builds `local-unverified`. CI builds the API using `github.sha` and inspects the image label for exact equality. Workflow YAML parsed successfully. | No successful Docker rebuild after this change and no hosted CI run; therefore no release artifact, digest, or registry attestation evidence yet. | Not applicable. | pending | PARTIALLY FIXED |

## Commands and immutable evidence identifiers

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
* Anonymous authentication runtime probe: the healthy running image returned
  bodyless `404` for both known and unknown legacy login/wallet routes. Direct
  challenge requests for both addresses returned the same top-level
  `success`, `challenge`, and `instructions` keys and contained no profile,
  role, username, email, or patient-linkage fields. This confirms only
  non-enumerating response shape on that image; no signature, replay, or
  expiry workflow was exercised.

## Remaining release blockers

`DATA-001` and `PRIV-001` remain P1 blockers.  SEC-001, SEC-002, APP-001, and
INT-001 require their missing runtime, browser, database, and external-service
evidence before they can become `CONFIRMED FIXED`.  The Phase B/C trust,
session, outbox, consent, and durability work has not been closed by this
ledger.
