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
| Browser workflows | Not yet executed |
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
| APP-001 | P1 | Access requests could be self-approved and grants could be indefinite. | `api/src/handlers/access_control.rs`; retention repositories; consent workflow/repositories/routes | Focused access, retention maker-checker, and one-time consent-revocation tests pass. | Not exercised with authenticated roles. | Direct PostgreSQL rehearsals: requester self-approval updated 0 rows and left a synthetic pending request unchanged; a distinct approver updated 1 row. A synthetic consent revoke set legacy and authoritative fields to withdrawn, and a second revoke updated 0 rows. Probe data was removed. Handler authorization, concurrency, and browser workflow evidence remain absent. | `492546e`, `211f3cc` | PARTIALLY FIXED |
| INT-001 | P1 | Production could treat stub identity verification as verified. | `api/src/national_id.rs`, handler, startup, production compose | National-ID test module passes. | Production Compose resolves `NATIONAL_ID_VERIFICATION_MODE=live`; production startup and real/sandbox provider verification remain unexecuted. | No live/sandbox provider verification. | `8a7a5e3` | PARTIALLY FIXED |
| DATA-001 | P1 | Process-local idempotency and offline queue had no stable end-to-end key or durable operation state. | `client/shared/src/api/client.ts`, `api/src/middleware/idempotency.rs`, `api/migrations/20260822000002_idempotency_operations.sql` | Shared-client typecheck and middleware digest-scope test pass. | Rebuilt image `sha256:dc878554…` is healthy and applied migration `20260822000002`. A synthetic authenticated challenge request produced one completed PostgreSQL claim; same key/body returned `409 IDEMPOTENCY_DUPLICATE`, and same key/different body returned `409 IDEMPOTENCY_KEY_REUSED`. After API recreation, the same request remained `409` and the claim remained `completed`. Automatic reconnect replay remains disabled. | Two-replica, response-loss, business-write atomicity, and browser proof remain absent. | `0ed9bb7`, `60a543a` | PARTIALLY FIXED |
| PRIV-001 | P1 | Sensitive identifiers can enter logs and related telemetry. | `api/src/privacy_logging.rs`, logging initialization, `api/src/middleware/signature_auth.rs` | Sanitizer and `log::Record` sink-path leakage tests pass, including labelled wallet fields; a focused enabled-middleware response regression test passes. | Rebuilt image `sha256:2f2d380d…` is healthy. An isolated signature-enabled API instance returned `400` to an invalid-signature request without reflecting the supplied wallet; its corresponding log rendered `wallet [REDACTED]`. | Direct stdout/stderr call sites and browser/metrics collector audit remain incomplete. | `4af04c7`, `67240d8`, `bf58b86` | PARTIALLY FIXED |
| AUTH-002 | P2 | Refresh JWTs were stateless and non-rotating. | `api/src/auth_sessions.rs`, auth JWT handler, session migration, shared client | Session-token hash test and shared-client typecheck pass. | Not yet rebuilt into a running API. | Rotation occurs in one PostgreSQL transaction in source; reuse, logout, multi-device, migration, and runtime proof remain absent. | `56ad565`, `e48705a` | PARTIALLY FIXED |
| OPS-001 | P2 | Development pgAdmin crash-looped because its default email used a reserved `.local` domain rejected by the current image. | `docker-compose.yml`, `.env.example`, PostgreSQL guide | Compose configuration resolves a globally valid development-only default; production compose already restricts pgAdmin to its `debug` profile with no public port. | After recreation, pgAdmin remained up and `http://localhost:5050/` returned `302 /browser/`; startup log shows Gunicorn listening on port 80. | No browser login or DB-admin workflow was exercised. | pending | PARTIALLY FIXED |

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

## Remaining release blockers

`DATA-001` and `PRIV-001` remain P1 blockers.  SEC-001, SEC-002, APP-001, and
INT-001 require their missing runtime, browser, database, and external-service
evidence before they can become `CONFIRMED FIXED`.  The Phase B/C trust,
session, outbox, consent, and durability work has not been closed by this
ledger.
