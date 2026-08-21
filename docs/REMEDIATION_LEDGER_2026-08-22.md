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
| Database verification | Migration startup verified; no data-flow/race rehearsal yet |

## Findings

| ID | Severity | Root cause | Changed files | Automated evidence | Runtime/API evidence | Browser/DB evidence | Commit | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | P1 | Anonymous routes disclosed wallet-linked identity before ownership proof. | `api/src/auth_challenges.rs`, `api/migrations/20260821000001_auth_challenges.sql`, auth handlers/routes/types, shared and portal auth clients | Focused challenge and JWT-field tests pass. | Release image `55306c016bf1` starts and applies migrations. Legacy anonymous routes return 404; known and unknown wallets return the same challenge envelope; invalid proof returns `INVALID_AUTH_CHALLENGE`. | Browser wallet signing, valid proof, replay, expiry, and database race verification not yet run. | Pending | PARTIALLY FIXED |
| SEC-002 | P1 | Provider failure could fall back to public Jitsi. | `api/src/telehealth.rs`, telehealth endpoint, startup, production compose | Disabled-provider test passes. | New image starts in demo configuration only; production configuration was not launched. | No provider outage or unauthenticated-join test. | Pending | PARTIALLY FIXED |
| APP-001 | P1 | Access requests could be self-approved and grants could be indefinite. | `api/src/handlers/access_control.rs` | Source-level expiry and requester check compiled in focused backend suite. | Not exercised with authenticated roles. | No concurrency, stale approval, or consent-revocation evidence. Retention maker-checker remains open. | Pending | PARTIALLY FIXED |
| INT-001 | P1 | Production could treat stub identity verification as verified. | `api/src/national_id.rs`, handler, startup, production compose | National-ID test module passes. | Development runtime only. | No live/sandbox provider verification. | Pending | PARTIALLY FIXED |
| DATA-001 | P1 | Process-local idempotency and offline queue have no stable end-to-end key or durable replay state. | None in this campaign slice. | Source inspection confirms the current limitation. | Not retested because no remediation exists. | No restart, replica, or duplicate-write proof. | — | STILL PRESENT |
| PRIV-001 | P1 | Sensitive identifiers can enter logs and related telemetry. | None in this campaign slice. | Not yet remediated. | Current startup logs still expose insecure-demo posture messages; PHI leakage suite not run. | No browser/metrics audit. | — | STILL PRESENT |

## Commands and immutable evidence identifiers

* `cargo test --bin medichain-api auth_challenges -- --nocapture` — pass (2 tests).
* `cargo test --bin medichain-api jwt_issue_tests -- --nocapture` — pass (1 test).
* `cargo fmt --all --check` — pass.
* Doctor and patient portal TypeScript checks — pass during this campaign slice.
* `docker compose build api` — completed; release image
  `sha256:55306c016bf1624e219b438371684c6c89f8172345f3a6d8c12e2f06e1c54e68`.
* `docker compose up -d --no-deps --force-recreate api` — healthy; migrations completed.

The full backend test suite was started but did not produce a captured terminal
result before the tool window elapsed.  It is therefore **not** recorded as a
pass.

## Remaining release blockers

`DATA-001` and `PRIV-001` remain P1 blockers.  SEC-001, SEC-002, APP-001, and
INT-001 require their missing runtime, browser, database, and external-service
evidence before they can become `CONFIRMED FIXED`.  The Phase B/C trust,
session, outbox, consent, and durability work has not been closed by this
ledger.
