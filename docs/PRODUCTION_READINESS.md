# MediChain — Production-Readiness Gap Report & Feature Completion Matrix

**Date:** 2026-06-09 · **Verdict:** 🔴 **NOT launch-ready** — 5 unresolved Critical gaps.
**Owner:** Keorapetswe Kgoatlha (mrlucas679)

This report is the launch gate. Per the agreed criteria, launch is permitted only when
**all Critical items are DONE**, **all High items are resolved or explicitly risk-accepted**,
and the system is **green in CI** (build + tests + security scan) and **passes e2e in a
production-like environment**. Today none of those hold.

Detailed evidence lives in `docs/audit/`:
- [`postgres-coverage.md`](audit/postgres-coverage.md) — persistence map (68 traits, 115 tables)
- [`high-risk-audit.md`](audit/high-risk-audit.md) — blockchain, auth, clinical endpoints
- [`frontend-review.md`](audit/frontend-review.md) — review of the 24 recently-changed UI files

## Verification status (honest)

| Gate | Status |
|------|--------|
| `cargo check --workspace` | ✅ green (verified earlier) |
| `cargo build --release` (API) | ⏳ running this session |
| `cargo test` | ⚠️ blocked earlier by full disk; re-running |
| clippy `-D warnings` | ⚠️ 238 **pre-existing** findings, CI report-only (Stage-2 backlog) |
| frontend `tsc` typecheck | ✅ green |
| frontend unit tests | ❌ ~57 pre-existing failures (no data mocks); not a real gate yet |
| e2e in production-like env | ❌ **not executed** — needs Docker/Postgres up + a clean build host |

> The earlier C: disk exhaustion (0 bytes) prevented full release builds, `cargo test`, and any
> e2e/security-scan run. Treat the dynamic gates above as **unverified** until CI runs them on a
> clean host. This report is grounded in static analysis + targeted code reads.

---

## Feature Completion Matrix

Legend: 🟢 production-ready · 🟡 partial · 🟠 mock/placeholder · 🔴 stub/missing

### Data persistence (does it survive a restart?)
| Domain | Memory | Postgres | Under `MEDICHAIN_STORAGE=postgres` | Status | Sev |
|--------|:--:|:--:|--|:--:|:--:|
| Patients, allergies, records, NFC, vitals, triage, access logs, Phase 1–15 clinical docs (63 repos) | ✅ | ✅ complete | persists | 🟢 | — |
| **CodeBlue / Trauma / Stroke / Cardiac / Sepsis** (emergency protocols) | ✅ | ❌ none | **memory only** (`mod.rs:587-592`) | 🔴 | **Crit** |
| **Users / RBAC** (profile updates, role revocation) | ✅ | ❌ no `UserRepository` | **memory only** (`auth_challenge.rs:650`, `rbac.rs:164`) | 🔴 | **High** |
| Provider schedules, family-link requests, sync status | ✅ | ❌ no table | memory only | 🟡 | Med |

### Security & trust model
| Component | Status | Sev | Evidence |
|-----------|:--:|:--:|----------|
| Signature auth (sr25519), secure-by-default, no client-role trust | 🟢 | — | `signature_auth.rs`, `rate_limit.rs` |
| Production secret-abort (fail-closed) | 🟢 | — | `startup.rs` (fixed this session) |
| `/api/medical-id/{id}/emergency` PHI access | 🟠 | **Crit** | any non-empty `?token`/`?nfc_hash` grants PHI — `medical_id.rs:336-357` |
| `/api/medical-id/{id}/lockscreen` PHI access | 🟠 | **Crit** | identity fetched but not enforced — `medical_id.rs:504+` |
| MFA step-up enforcement | 🟡 | High | bypassable via `X-User-Id` instead of MFA'd JWT (e.g. `declare_breach`) |
| Demo-mode JWTs | 🟡 | High | issued without signature when `IS_DEMO=true` |

### Blockchain (core product promise: blockchain-verified consent + audit)
| Function | Status | Sev | Evidence |
|----------|:--:|:--:|----------|
| `health_check`, enabled-flag | 🟢 | — | real |
| `register_patient_on_chain` / `record_ipfs_hash_on_chain` / `log_access_on_chain` | 🟠 | **Crit** | placeholder SHA3 hash by default (`BLOCKCHAIN_ENABLED=false`); no node touched |
| Extrinsic signing (when enabled) | 🔴 | **Crit** | signs with **Alice dev key** — `blockchain.rs:564` |
| Access-audit anchoring | 🔴 | **Crit** | misrouted to `grant_emergency_access` — `blockchain.rs:413-453` (audit trail legally unreliable) |
| Substrate node | 🔴 | High | stub (per CLAUDE.md) |

### Clinical / consent / real-time
| Flow | Status | Sev | Evidence |
|------|:--:|:--:|----------|
| `/api/consent/patient/{id}` | 🟠 | **Crit** | returns 2 hardcoded demo consents for **every** patient — `workflow.rs:1960-1976` |
| Most clinical handlers (RBAC + validation) | 🟢 | — | correct RBAC, parameterized SQL |
| SSE real-time → frontend | 🔴 | Med | backend works; frontend never subscribes |
| Insurance currency | 🟡 | Med | amounts have no currency code; demo `$` figures render as `R` |

### Frontend (24 recently-changed files)
| Result | Detail |
|--------|--------|
| 🟢 22/24 clean | dashboards, both LoginPages (auth unchanged — emoji→icon only), shared components, i18n |
| 🟡 2 Medium | `RegisterPatientPage.tsx:68` blank-phone shows "invalid" not "required"; `InsurancePage` ZAR re-denomination of $-sized demo data |

---

## Release-blocking gaps (→ tracked as GitHub issues)

### 🔴 Critical (must be DONE before launch)
- **C1 — Emergency-protocol records lost on restart.** Implement `Pg*` repos for CodeBlue/Trauma/Stroke/Cardiac/Sepsis and wire them in `new_postgres()`. *Accept:* records persist across restart under Postgres; integration test proves round-trip.
- **C2 — Emergency medical-ID endpoint leaks PHI to anyone.** Replace `token.is_some() || nfc_hash.is_some()` with cryptographic validation (NFC hash match + time-limited signed emergency token) and audit each access. *Accept:* invalid/forged token → 401; valid responder token → 200 + audit row.
- **C3 — Lock-screen endpoint serves PHI ungated.** Enforce device/identity binding. *Accept:* request without a valid bound identity → 401.
- **C4 — Consent endpoint returns hardcoded consents.** Back `/api/consent/patient/{id}` with the real consent repository. *Accept:* returns the patient's actual consents (empty when none); test with 0/1/N consents.
- **C5 — Blockchain consent/audit is not real.** Implement real extrinsic submission with operator-managed keys (not Alice), correct access-audit pallet call, and gate launch on `BLOCKCHAIN_ENABLED=true` working end-to-end. *Accept:* a consent + an access event are verifiable on a real node; audit uses the correct extrinsic.

### 🟠 High (resolve or risk-accept with written justification)
- **H1 — Users/RBAC persistence.** Add a `UserRepository` (Postgres) for profile + role changes. *Accept:* role revocation survives restart.
- **H2 — MFA step-up bypass.** Require an MFA'd JWT (not raw `X-User-Id`) for sensitive ops (`declare_breach`, role changes). *Accept:* `X-User-Id`-only call to a step-up route → 401/403.
- **H3 — No real automated test gate.** Add data mocks so frontend unit tests pass; add a Postgres-service CI job to run the `postgres`-feature tests; make clippy a hard gate after the 238-finding cleanup. *Accept:* CI runs and is green on all three.
- **H4 — Demo-mode unsigned JWTs.** Document/limit to non-prod; the fail-closed default now prevents accidental prod demo-mode. *Accept:* prod boot cannot issue unsigned JWTs.

### 🟡 Medium / 🟢 Low (tracked, non-blocking)
- M1 provider-schedule/family-link/sync persistence · M2 insurance currency code on model · M3 SSE frontend wiring · M4 RegisterPatientPage blank-phone message · L1 238-finding clippy cleanup (Stage-2 backlog).

---

## Strengths (already production-grade)
`docker-compose.prod.yml` (TLS/nginx, Postgres unpublished, pgAdmin off, `IS_DEMO=false`,
`REQUIRE_SIGNATURES=true`); fail-closed secret validation; secure-by-default signature auth with
server-side role resolution; parameterized SQL throughout; ChaCha20-Poly1305/Argon2id crypto;
63 fully-implemented Postgres repositories; CI matrix (fmt enforced, build, cargo-deny bans/sources
enforced, SBOM, client builds, Lighthouse).

## Path to launch
1. Close all 5 Criticals (C1–C5) with the acceptance criteria above + automated tests.
2. Resolve/risk-accept H1–H4.
3. Free a clean build host; make CI green incl. Postgres-feature tests + clippy hard gate.
4. Run e2e against the prod-like Docker stack (API + Postgres + IPFS + nginx/TLS).
5. Re-run this gate; flip the verdict only when Critical = 0 and the dynamic gates are green.
