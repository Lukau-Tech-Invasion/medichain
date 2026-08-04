# Security issue register

Opened 2026-08-04 from the external review plus the Horizon campaign. One row =
one issue to file and close. Ordered by the gate it blocks, not by severity
alone — an issue that blocks the clinic demo outranks a worse one that doesn't.

**Status key:** `FIXED` verified this pass · `OPEN` confirmed, not started ·
`PARTIAL` mitigated but not closed.

## Closed this pass

| ID | Issue | Evidence it's closed |
|---|---|---|
| SEC-01 | Auth gate passed handlers that merely mention `X-User-Id` | Gate now tiers 0–4; found 2 real holes immediately |
| SEC-02 | Startup fell open: migration failure warned, DB failure → volatile storage, no `DATABASE_URL` → volatile | Aborts outside demo mode; 3 distinct abort paths |
| SEC-03 | Idempotency cache keyed by caller's raw string → cross-user/route/tenant replay **before** handler authz | Key = `SHA3(subject‖method‖path‖key)`, length-prefixed |
| SEC-04 | `ports: []` no-op left Postgres/pgAdmin/IPFS published in prod | `!override` on all three; pgAdmin behind `debug` profile |
| SEC-05 | Rate limiter: any `X-User-Id` bought the higher quota + unbounded map | Elevated tier requires a resolved user; unknown ids share the IP bucket |
| SEC-06 | `/api/metrics` unauthenticated; unmatched paths → unbounded label cardinality | Auth or `METRICS_TOKEN`; unmatched → `<unmatched>` |
| SEC-07 | `demo-login` auto-created accounts; `MEDICHAIN_DEV_MODE` defaulted **true** | Defaults false **and** requires demo mode |
| SEC-08 | `POST /api/insurance/cards`: any caller could file a card against any patient | Owner-or-provider check added |
| SEC-09 | HZ-024 — four endpoints authorized on a `0xPROV` id prefix; unauthenticated PHI read | Fixed + live-retested 403; found before this review |
| SEC-10 | HZ-023 — fabricated clinical data (invented chronic conditions, custody chain, inbox) | Replaced with real stores; 14 round-trip assertions |

## P0 — blocks showing anything to a clinic

| ID | Issue | Notes |
|---|---|---|
| SEC-11 | **Presence-only handlers: 144 → 103** (`PARTIAL`) | 41 fixed via two shared gates (`require_registry_reader`, `require_clinical_staff`): 15 platform registries + 26 surgical/public-health/diagnostics/perioperative/emergency-assessment handlers. Verified forged→401, anon→401, patient→403, clinician served. Remaining clusters: `emergency/management.rs` (20), `platform/sync.rs` (6), `engagement/wearables.rs` (6), `engagement/family.rs` (5), `clinical_support/telehealth.rs` (5). Ratchet holds the ceiling at 103. |
| SEC-12 | **41 unscoped `list_all()` bulk reads** (`PARTIAL`) | Callers are now resolved and role-checked, and registry reads are **audited** — but `list_all()` still returns deployment-wide data. This narrows *who may call*, not *what is returned*. True isolation needs SEC-16/SEC-18. Full list: `python scripts/check-endpoint-auth.py --list-weak`. |
| SEC-33 | Hardcoded blood-bank inventory (`FIXED`) | Returned "O-Pos: 12 units, adequate" / "A-Neg: 2 units, low" regardless of real stock. Unit counts drive transfusion decisions. Now empty + `inventory_available:false`. |
| SEC-13 | **No frontend served by Docker** — `/` is a bare nginx 404; 5173/5174 refuse | A clinic demo cannot start with "run two Vite servers". Needs one deterministic entry point. |
| SEC-14 | Docs/README contradict runtime | Partly addressed by `WHERE_WE_ARE.md`; README still overstates. |
| SEC-15 | No visual/accessibility audit possible | Requires SEC-13 first. Keyboard, focus, contrast, RTL, small-screen all uncertified. |

## P1 — blocks any real-patient pilot

| ID | Issue | Notes |
|---|---|---|
| SEC-16 | **Authorization chokepoint** | Resolve identity→org→facility→role→treatment relationship→consent→resource scope, and push scope **into the query**. Post-`list_all()` filtering is not isolation. Largest single piece. |
| SEC-17 | **Process-local clinical state** | Dozens of `RwLock<HashMap<…>>` in `AppState`. For MAR, critical results and emergency grants this is patient safety, not debt. |
| SEC-18 | Nullable organization/facility ownership | Make non-null for hospital-owned records; add DB constraints / RLS as defence in depth. |
| SEC-19 | Signature replay | No consumed-nonce ledger; replayable inside the 5-min window. Worst for prescribing and MAR. |
| SEC-20 | Unencrypted offline PHI in IndexedDB, **two** duplicate implementations | Different DB names/schemas → inconsistent clearing and expiry. Needs per-user key, secure-logout purge, device policy. |
| SEC-21 | Background jobs duplicate per replica | `tokio::spawn` in every process → duplicate reminders, repeated retention actions. Needs leases/leader election. |
| SEC-22 | Idempotency is process-local | Retries to another replica are not idempotent at all. Needs Redis/durable store written transactionally. |
| SEC-23 | Idempotency not bound to a body digest | Same key + different body on one route replays the first response. Needs payload buffering — sits in front of large uploads. |
| SEC-24 | Audit completeness | Must record denied reads and consent decisions, be immutable and org-scoped. |
| SEC-25 | Backup/restore, downtime and corruption drills never rehearsed | Also blocks the Horizon active gate. |
| SEC-26 | PostgreSQL path never run end-to-end; new HZ-023 migration unapplied | Docker down. Largest unverified surface. |

## P2 — blocks multi-hospital or blockchain claims

| ID | Issue | Notes |
|---|---|---|
| SEC-27 | No adversarial Hospital A/B isolation test | Until this exists, isolation is a claim. |
| SEC-28 | `node` + `runtime` excluded from workspace; `node/Dockerfile` absent; subcommands return `Ok(())` | **Do not call this blockchain-backed.** |
| SEC-29 | Placeholder pallet weights | Benchmark before any validator topology. |
| SEC-30 | No validator/finality/partition/key-rotation/upgrade policy | The review's unanswered questions are the right list. |
| SEC-31 | Shared encryption key blast radius | Per-organization domains backed by KMS/HSM. |
| SEC-32 | No load test at realistic volume or 10/100-hospital traffic | — |

## Standing risk

`HZ-021` — patient consent grants are recorded, audited and displayed but
**enforced nowhere**. The patient-facing copy was corrected so it no longer
claims a technical block, but revoking consent still has no technical effect.
Owner decision, tangled with SEC-16.

## Note on process

Two green signals were wrong here: an e2e suite asserting a medication
administration that persisted nothing, and an auth gate asserting 408 safe
handlers when 144 accept a forged header. Both are now instrumented to fail
instead. Prefer a check that reports an uncomfortable number over one that
reports PASS.
