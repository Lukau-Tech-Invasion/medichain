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
| Browser workflows | Bounded live coverage: public landing, clinician credential-entry/alternate-sign-in access, and an already-authenticated synthetic patient session across eight read/navigation routes plus reload persistence. A further headed-browser attempt is blocked: the declared in-app browser skill is absent and the supported Playwright CLI fallback could not download because npm timed out. No browser mutation, clinician sign-in, staff role, consent change, appointment booking, emergency action, or cross-role workflow has been executed. |
| Database verification | Migration startup plus targeted idempotency, retention maker-checker, and consent-revocation transition rehearsals; not a full business-write/race or restore verification |

Manual inventory at this checkpoint: 940 tracked source/config files in scope,
including 272 Rust files, 335 TypeScript/TSX files, and 63 SQL migrations.
This is inventory coverage, not a statement that every file has been manually
reviewed. Static follow-up still finds 124 `X-User-Id` references and 142 direct
`println!`/`eprintln!`/`dbg!` calls in API source; those counts define remaining
authentication and log-sink audit scope.

## Findings

| ID | Severity | Root cause | Changed files | Automated evidence | Runtime/API evidence | Browser/DB evidence | Commit | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | P1 | Anonymous routes disclosed wallet-linked identity before ownership proof and had only a process-local request throttle. | `api/src/auth_challenges.rs`, `api/migrations/20260821000001_auth_challenges.sql`, auth handlers/routes/types, shared/portal auth clients, and the nonce-message verifier | Focused challenge and JWT-field tests pass. `a65f19f` adds a PostgreSQL advisory-lock-protected per-wallet rolling budget of five challenges per minute; its six-way concurrent test passed with exactly five issues and one typed rate-limit result. Direct PostgreSQL tests prove a challenge consumes once, identical replay is denied, and an expired challenge is denied. | Current image manifest `sha256:18dda856…` is healthy. A real synthetic `//Alice` wallet signed the dynamic issued login message; `/api/auth/jwt` returned `200` with access and refresh tokens, while replaying the identical proof returned `401 INVALID_AUTH_CHALLENGE`. Through Nginx, five valid-format challenge calls returned `200`; the sixth and seventh returned `429` with `AUTH_CHALLENGE_RATE_LIMITED`. | Browser wallet signing and broader database race verification not yet run. | `8a7a5e3`, `a65f19f`, `9b360d0`, `f05abe1`, `7e04eed` | PARTIALLY FIXED |
| SEC-002 | P1 | Provider failure could fall back to public Jitsi. | `api/src/telehealth.rs`, telehealth endpoint, startup, production compose | `cargo test --bin medichain-api telehealth -- --nocapture` passed 27 tests, including disabled-provider no-room behavior, join-window closure, role recording authority, Jitsi credential lifecycle, and session concurrency. Production startup source rejects public Jitsi and missing private-provider credentials. | Production Compose resolves `IS_DEMO=false`, `REQUIRE_SIGNATURES=true`, and `TELEHEALTH_ENABLED=false` by default. A provider-enabled production startup was not launched. | No provider outage or unauthenticated-join test. | `8a7a5e3` | PARTIALLY FIXED |
| APP-001 | P1 | Access requests could be self-approved and grants could be indefinite. | `api/src/handlers/access_control.rs`; retention repositories; consent workflow/repositories/routes | Focused access, retention maker-checker, and one-time consent-revocation tests pass. | Not exercised with authenticated roles. | Direct PostgreSQL rehearsals: requester self-approval updated 0 rows and left a synthetic pending request unchanged; a distinct approver updated 1 row. A synthetic consent revoke set legacy and authoritative fields to withdrawn, and a second revoke updated 0 rows. Probe data was removed. The authenticated patient portal reaches its `Access Control` page in-browser, but no browser consent request, grant, approval, revoke, or concurrent-role workflow was performed. | `492546e`, `211f3cc` | PARTIALLY FIXED |
| AUD-001 | P1 | High-risk business mutations and durable audit-outbox inserts were often separate operations; handlers could log an outbox failure and still return a successful mutation. | Patient access, guardian relationships, emergency grants, and the PostgreSQL identity-claim link now span their business transition and prepared audit event. Registry bulk reads, managed-device revocation, and mobile-device revocation fail closed when audit persistence is unavailable. Production mobile-device and protected-session authority is PostgreSQL-backed. | Isolated PostgreSQL tests prove patient-access, guardian, emergency-grant, identity-claim, and mobile-device restart/revocation behavior. | `cargo check -p medichain-api --message-format short` passes. Static follow-up finds each remaining audit-error branch returns `503`; none returns a success response. | A new PostgreSQL-backed mobile store saw a device registered by a prior instance, authorized a protected session, then—after device revocation—saw both the device and the session as revoked. The handler still persists its required audit event before the separate mobile-state transaction, so this is fail-closed ordering rather than a single cross-write transaction. No browser/deployed-image evidence exists. This remains a release blocker. | `40ab8be` plus pending verification commit | PARTIALLY FIXED |
| INT-001 | P1 | Production could treat stub identity verification as verified. | `api/src/national_id.rs`, handler, startup, production compose | National-ID test module passes. | Production Compose resolves `NATIONAL_ID_VERIFICATION_MODE=live`; production startup and real/sandbox provider verification remain unexecuted. | No live/sandbox provider verification. | `8a7a5e3` | PARTIALLY FIXED |
| DATA-001 | P1 | Process-local idempotency and offline queue had no stable end-to-end key or durable operation state. | `client/shared/src/api/client.ts`, `api/src/middleware/idempotency.rs`, `api/migrations/20260822000002_idempotency_operations.sql` | Shared-client typecheck and middleware digest-scope test pass. | Rebuilt image `sha256:dc878554…` is healthy and applied migration `20260822000002`. A synthetic authenticated challenge request produced one completed PostgreSQL claim; same key/body returned `409 IDEMPOTENCY_DUPLICATE`, and same key/different body returned `409 IDEMPOTENCY_KEY_REUSED`. After API recreation, the same request remained `409` and the claim remained `completed`. Automatic reconnect replay remains disabled. | Two-replica, response-loss, business-write atomicity, and browser proof remain absent. | `0ed9bb7`, `60a543a` | PARTIALLY FIXED |
| PRIV-001 | P1 | Sensitive identifiers can enter logs and related telemetry. | `api/src/privacy_logging.rs`, logging initialization, `api/src/middleware/signature_auth.rs`, `api/src/main.rs`, and 18 production call-site files | Sanitizer and `log::Record` sink-path leakage tests pass, including labelled wallet fields. `ad1ad6c` removes direct wallet, patient, user, and record-ID interpolation from staff login, MFA, emergency, FHIR, surgical, messaging, retention, and related paths; `cargo check --bin medichain-api` passes. | Current rebuilt image manifest `sha256:844bbaf2…` was exercised with a shaped invalid staff login. It returned `401`; container logs contained only `STAFF_LOGIN_UNKNOWN identifier_hash=…` and did not contain the unique submitted identifier. | Static sink/metrics/browser collector audit remains incomplete; the ignored synthetic chain E2E test retains public synthetic output only. | `4af04c7`, `67240d8`, `bf58b86`, `254fd50`, `ad1ad6c` | PARTIALLY FIXED |
| AUTH-002 | P2 | Refresh JWTs were stateless and non-rotating. | `api/src/auth_sessions.rs`, auth JWT handler, session migration, shared client | Session-token hash test and shared-client typecheck pass. | Not yet rebuilt into a running API. | A pre-existing synthetic patient browser session remains authenticated after a dashboard reload, but this does not prove JWT issuance, refresh rotation, reuse rejection, logout, multi-device behavior, migration, or server-side session persistence. | `56ad565`, `e48705a` | PARTIALLY FIXED |
| OPS-001 | P2 | Development pgAdmin crash-looped because its default email used a reserved `.local` domain rejected by the current image. | `docker-compose.yml`, `.env.example`, PostgreSQL guide | Compose configuration resolves a globally valid development-only default; production compose already restricts pgAdmin to its `debug` profile with no public port. | After recreation, pgAdmin remained up and `http://localhost:5050/` returned `302 /browser/`; startup log shows Gunicorn listening on port 80. | No browser login or DB-admin workflow was exercised. | pending | PARTIALLY FIXED |
| OPS-002 | P2 | Backup/restore mechanism had not been demonstrated end to end. | `scripts/backup-postgres.ps1`, `scripts/restore-postgres.ps1`, row-count query helper | Backup script produced custom dump, SHA-256 checksum, and exact row-count manifest. Restore script verified checksum and exact table-by-table counts. | Local development backup created `medichain-20260822T025708Z.dump`; restore into isolated `medichain_restore_audit_20260822` reported `PASS`. Source and restored patient counts were both 81; restored `_sqlx_migrations` count was 62. A disposable API instance connected to the restored DB, rechecked migrations, loaded users/patients, and returned health `200`. | No decrypted-record read-back, backup policy/RPO/RTO, off-site storage, or browser evidence. | pending | PARTIALLY FIXED |
| OBS-001 | P2 | Prometheus had no authenticated scrape configuration and its default scrape path did not match the API route. | `.env.example`, Compose API/Prometheus configuration, `docs/observability/prometheus.yml`, alert rules | Compose source wires a `metrics_token` secret and `/api/metrics` credentials file; the merged production configuration requires `NATIONAL_ID_HASH_KEY`. | Anonymous `/api/metrics` returned `401`. On 2026-08-24, the running Prometheus target was `down` with `401 Unauthorized` and `ApiInstanceDown` firing after an API recreation from development Compose; that development environment has no `METRICS_TOKEN`. The merged production configuration could not be rendered because `NATIONAL_ID_HASH_KEY` is absent. | Alert firing/delivery, Grafana browser workflow, a fully provisioned production credential set, and no-PHI metric-label audit remain absent. | `a0748dc` | PARTIALLY FIXED |
| ARCH-001 | P2 | Correctness-critical state previously risked process-local storage and handler authorization had uneven explicit coverage. | Handler inventory, repository wiring, authorization gate scripts | Endpoint-auth gate scanned 424 handlers: 74 resource/patient scoped, 246 role authorized, 67 registered-identity resolved, 0 presence-only, 0 with no decision. Durability gate found 65 AppState maps and 0 live production references. | Static-only. | Write-authorization gate accepts 13 reviewed writes but leaves three owner decisions for break-glass emergency access and NFC identity issuance; no browser/production role matrix execution. | pending | PARTIALLY FIXED |
| TEST-001 | P2 | Parallel PostgreSQL tests concurrently swept and dropped the same historical test schema; SQLx also serialized isolated-schema migrations with a database-wide lock. | `api/src/repositories/postgres/tests.rs` | Focused PostgreSQL repository test passes after serializing extension setup, stale-schema sweeping, and test-schema creation. A 34-test PostgreSQL subset passes with eight test workers after disabling only the redundant database-wide migration lock for fresh isolated schemas. A fresh complete API suite passes. | The subset completed `34 passed; 0 failed` in 241.32s with zero advisory-lock waiters. The complete API suite then completed `421 passed; 0 failed; 1 ignored` in 201.12s. | Browser/database restore evidence remains separate. | `abc906e`, `c2e6e34` | PARTIALLY FIXED |
| TEST-002 | P2 | The clinician frontend full-test gate was vulnerable to a legitimate crypto test exceeding the global 10-second timeout under suite contention; compatibility warnings remain. | `client/doctor-portal/src/store/credentialKeystore.test.ts`, Vitest configuration, affected page rendering keys | Patient full suite passed: 26 files, 82 tests. The seed-derived credential round-trip has a local 30-second budget; the fresh complete clinician suite passed 83 files / 304 tests in 177.16 seconds. Focused provider and note-template duplicate-key tests remain green. React Router v7 future warnings remain. | No browser mutation or production build proof for these cases. | Unit tests are not browser evidence. The keystore test is security-relevant because it covers a clinician signing credential. | pending | PARTIALLY FIXED |
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

## Remaining release blockers

`DATA-001` and `PRIV-001` remain P1 blockers.  SEC-001, SEC-002, APP-001, and
INT-001 require their missing runtime, browser, database, and external-service
evidence before they can become `CONFIRMED FIXED`.  The Phase B/C trust,
session, outbox, consent, and durability work has not been closed by this
ledger.
