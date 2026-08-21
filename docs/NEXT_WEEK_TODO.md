# MediChain — Next Week TODO

**Created:** 2026-06-04
**Owner:** Keorapetswe Kgoatlha (mrlucas679)

This is the active backlog for the upcoming week. It supersedes the historical
hackathon trackers. Source of per-feature detail: [`../IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md).

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Stage 1 — Finish remaining IMPLEMENTATION_PLAN items (in-scope)

### Persistence & data fidelity (2.1)
- [x] Replace `#[sqlx(skip)]` "extras" data-loss on PostgreSQL round-trips
      (appointments, medication_reminders, immunization) with a JSONB column or typed columns
- [x] Verify all 179 tables have matching repository CRUD; close any gaps
- [x] Confirm `MEDICHAIN_STORAGE=postgres` activates PostgreSQL for **every** endpoint

### Frontend completeness (3.1, 3.2, 4.1-UI, 13.2)
- [x] `DeathCertificatePage` — add certifier state + working "Sign & Submit" handler
- [x] `PediatricsPage` — full vertical (backend route + shared API fn + page wiring)
- [x] Finish thin patient-app pages (Vital Signs, Medications integration polish)
- [x] Surface drug-interaction warnings in the prescription UI
- [x] Gate all demo-data fallbacks behind `IS_DEMO` (Insurance/LabTrends/Wearables/MAR)

### Notifications & security (5.2, 5.3, 6.1, 6.3, 11.4)
- [x] FCM push: HTTP v1 client + `device_tokens` table + registration endpoint
- [x] Persistent per-patient SMS opt-out table
- [x] Secrets-rotation documentation + key-management guidance
- [x] Encryption-required policy at the API middleware layer + key-rotation support
- [x] SMTP dispatch for regulator/data-subject breach notifications **(needs SMTP provider — scaffold + document)**

### Infra & observability (8.1, 8.2, 12.1)
- [x] Add Substrate node service + `docker-compose.prod.yml` overrides + per-service health checks
- [x] Wire Grafana dashboard + Prometheus alert rules into the deployment
- [x] Frontend bundle analysis + code-split doctor vs patient apps (< 200KB initial JS)

### i18n + CDS (3.5, 4.3)
- [x] Extract user-facing strings to translation files across all remaining pages
      (Login page is the reference implementation) — all 76 doctor-portal + 25 patient-app
      pages wired to `useTranslation()`/`t()`; verified via a project-wide leftover-string
      sweep (remaining hardcoded text is intentionally-excluded mock/demo data and proper
      nouns, per convention)
- [x] Per-facility configurable CDS thresholds + CDS audit trail (which rule fired, action taken)

### API & data pipeline (9.3, 9.5, 4.1-data)
- [x] Adopt cursor pagination on the remaining list endpoints (+ "load more" UI)
- [x] Migrate the ~1140 ad-hoc error responses to the canonical `error_envelope_json`
      (done centrally: `ErrorResponse` + `ApiError` serialize to the envelope; FHIR
      endpoints keep `OperationOutcome` by design)
- [x] Import RxNorm/DrugBank open datasets to expand drug-interaction coverage **(data pipeline — infra
      done, external data still needs a license)**: extracted the curated ~170-entry interaction table out
      of `evaluate_drug_interactions()` into `api/data/drug_interactions_builtin.json` (single source of
      truth, compiled in via `include_str!`), added an additive `DRUG_INTERACTIONS_DATA_PATH` overlay
      loader (fail-open: bad/missing overlay logs a warning and falls back to the built-in table), and
      documented the actual import path in `api/data/README.md`. RxNorm's own interaction API was retired
      by the NLM in 2024 (licensing) and DrugBank's export needs a commercial/academic license — neither is
      a fetchable "open" dataset, and fabricating interaction pairs would be unsafe for a clinical system —
      so real expansion requires the user to obtain a licensed export and drop it in via the new env var.
      5 new unit tests (`interaction_table_tests`) cover JSON parse integrity, a known contraindicated
      pair, and overlay-file parsing. `cargo check`/`clippy -D warnings`/`cargo test` all pass.

### Mobile (Phase 8.3)
- [ ] NFC card scanning (`react-native-nfc-manager`) **(needs device hardware)**
- [x] QR scanning (`expo-barcode-scanner`) — **scope decision made 2026-07-21: patient-only, not
      provider-mode.** The web `NFCTapSimulator` QR flow is provider-only (RBAC: Doctor/Nurse scanning an
      *other* patient's record via `POST /api/emergency-access`); the mobile app has no provider role, so
      that flow doesn't fit. Implemented instead: a new `FamilyScreen.tsx` lets a patient display their own
      Medical ID QR (reusing the existing, already self-scoped `GET /api/medical-id/{patient_id}/qr` — no
      new backend endpoint needed) and lets a family group's primary contact scan another patient's own QR
      to add them via the existing `/api/family/groups/{id}/members` endpoint (relationship + access-level
      picker before confirming). Added `expo-barcode-scanner@^12.3.0` (compatible with this project's Expo
      SDK 48); camera permission strings were already present in `Info.plist`/`AndroidManifest.xml`. New
      third "Family" tab wired into `MediChainApp.tsx`.
- [x] `npm install && npm run typecheck` verification — both **actually run this pass** (this environment
      has `node_modules` installed, unlike the prior "delivered unverified" round) and pass clean. NFC
      scanning remains the only unimplemented mobile item (needs physical hardware to verify against).

---

## Stage 2 — Multi-agent codebase cleanup (after Stage 1)

Run as specialist agents in separate lanes (worktrees) with a verifier gate between merges.

- [x] **Refactor agent** — further-split large submodules toward ~300 lines; extract `validators.rs`;
      slim `main.rs` toward bootstrapping-only (10.1, 10.2). **Note:** the briefed targets
      (`engagement`/`workflow`/`surgical`/`platform`/`emergency`, main.rs) were stale — a prior round
      had already split/slimmed them. Retargeted to the real remaining offenders: split
      `clinical_support.rs` (2393 lines) and `insurance_pharmacy.rs` (1493 lines) into submodules
      (Round 9 glob-re-export pattern, zero behavior change); added `validators.rs` with 2 shared
      auth-check helpers applied to 33 verified-identical call sites. Several large files remain
      (`fhir.rs` 1353, `billing.rs` 1131, `assessment.rs` 995, `medical_id.rs` 925, `physician.rs` 921) —
      tracked, not attempted this pass.
- [x] **Dead-code / debug agent + toolchain fix** — the environment's Rust toolchain had no working
      linker (no MSVC Build Tools, no mingw); fixed by installing mingw-w64 (WinLibs UCRT via winget)
      + a Rust GNU-host toolchain (`rustup toolchain install stable-x86_64-pc-windows-gnu`). With a
      real compiler, the "~175 warnings" figure was **stale** — actual count was **4** (all in
      `middleware/rate_limit.rs`, a `#[cfg(test)]`-only artifact; the middleware is genuinely wired
      into the app via `.wrap(rate_limit)` in `main.rs`, not dead). The 2 unregistered duplicate
      autopsy handlers were confirmed (now in `handlers/sample.rs`, not `main.rs` as documented) but
      **not deleted** per this repo's "never delete without asking" rule — reported as deletion
      candidates instead (16 items + 1 new orphaned-file finding, `wound_iv_assessments.rs` — an
      unregistered duplicate of `wound_assessment.rs`/`iv_assessment.rs`). **Reviewed and actioned
      2026-07-21:** deleted the 2 duplicate autopsy handlers, 5 unused `with_data` constructors, the
      orphaned `wound_iv_assessments.rs` file, `seed_demo_users` (duplicated a DB migration), and 3
      low-confidence items (`pagination::encode_cursor`, `support::request_has_mfa`,
      `security::breach::severity::MEDIUM`). Also removed the dead `ApiError`/`SafeRwLock`/
      `safe_read!`/`safe_write!` cluster in `middleware/error_handling.rs` — kept `error_codes`/
      `error_envelope_json`/`secure_tokens`/`validation` from that same file since those are actively
      used elsewhere (43 call sites). Left untouched, per explicit instruction: the `UserService`
      struct itself (only its dead `seed_demo_users` fn was approved for removal). Verified clean
      after every step: `cargo check --workspace --all-targets`, `cargo clippy -- -D warnings`,
      `cargo test --workspace` (169 passed, same 4 known DB-dependent failures — a 5th, unrelated
      flake in `test_from_env_present` was confirmed as a pre-existing env-var race under parallel
      test execution, not a regression, by re-running with `--test-threads=1`).
- [x] **Test agent — run directly, not via subagent** (the subagent lane hit the session limit before
      starting real work). **(7.2)** Added `test_concurrent_patient_registration_load` (50 concurrent
      writes) and `test_concurrent_patient_read_load` (100 concurrent reads) to `api/src/api_tests.rs`,
      exercising the in-memory `RwLock`-backed stores under real concurrency via `futures::join_all`
      against a shared `actix_web::test` service — asserting no lost writes, no panics/5xx, and a
      generous latency bound. Both pass. **(12.2)** Added a `cargo-fuzz` scaffold (`api/fuzz/`) for the
      same 4 functions covered by `property_tests.rs` (`checked_consent_expiry`,
      `blood_type_compatible`, `card_hash`, `mean_arterial_pressure`). Since `medichain-api` is a
      `[[bin]]`-only crate (no `[lib]` target) the fuzz targets mirror each function's body verbatim
      rather than importing it (documented in `api/fuzz/README.md`, with source-of-truth pointers to
      keep in sync). The mirrored logic was sanity-compiled and run standalone successfully; the actual
      `cargo fuzz run` could not be verified end-to-end in this environment — `libfuzzer-sys`'s bundled
      libFuzzer C++ shim fails to compile under mingw-w64 g++ (confirmed directly), since libFuzzer's
      Windows support targets MSVC/clang-cl. Needs Linux/WSL/macOS or a full MSVC+clang-cl setup to run.
      Frontend coverage was not raised further this pass.
- [x] **Frontend-quality agent** — replace remaining `as any`/`@ts-ignore` in production source;
      retype `endpoints.ts` (was cut off by the session limit mid-task, but left the tree in a
      verified-clean state — all of doctor-portal/patient-app/shared `npm run typecheck` pass).
      Added `client/shared/src/types/clinical.ts` (1489 lines) — real interfaces for
      clinical-domain API responses derived from the Rust structs, replacing `unknown` returns.
- [x] **Verifier agent — run directly, not via subagent** (the subagent lane hit the session limit
      before starting). Full gate, all green:
      - `cargo check --workspace --all-targets` — clean
      - `cargo clippy --workspace -- -D warnings` — **clean** (was 148 issues on the newer clippy
        1.97.1 toolchain vs. whatever version last gave this project a green run — not a regression
        from any change this session; fixed via `cargo clippy --fix` for the mechanical ~27, then
        99× `sort_by(|a,b| b.X.cmp(&a.X))` → `sort_by_key(|b| Reverse(b.X))` across 21 repository
        files, 9× `match {Ok(v)=>v, Err(_)=>default}` → `.unwrap_or_default()`, 1× manual
        `strip_prefix`, plus 3 cases left with a scoped, commented `#[allow]` instead of a risky
        rewrite: a deliberate single-arm match scaffold, an unwrap-after-is_some in blockchain
        extrinsic submission code, and an enum variant rename that would've silently changed its
        serde wire format — and 9× `await_holding_lock` false positives (this clippy version doesn't
        recognize explicit `drop()` calls; all 9 sites already correctly drop the guard before
        awaiting, confirmed file-by-file)
      - `cargo test --workspace` — 168 passed, only the 3 known `Pg*` tests fail (need a live
        PostgreSQL, expected in this environment)
      - `npm run typecheck` — clean in doctor-portal, patient-app, and shared

---

## Stage 3 — Full IMPLEMENTATION_PLAN.md reconciliation + remaining gaps (2026-07-21)

Closed out the two items still literally unchecked in Stage 1/2 above, then did a full
verify-don't-trust-the-doc sweep of every other section in `IMPLEMENTATION_PLAN.md`
(three parallel fork lanes), and fixed two genuine architectural gaps discovered along
the way rather than just documenting them as blocked.

- [x] **Drug-interaction data pipeline (4.1)** — extracted the curated ~170-entry table
      into `api/data/drug_interactions_builtin.json` + an additive `DRUG_INTERACTIONS_DATA_PATH`
      overlay loader. RxNorm's interaction API was retired (2024, licensing) and DrugBank
      needs a commercial license — neither is fetchable, so this delivers the *import
      pipeline*, not fabricated data. 5 new tests.
- [x] **Mobile QR scanning (8.3)** — scope decision: patient-only (display own Medical ID
      QR + scan another patient's own QR to add them to a family group via
      `expo-barcode-scanner`), not the web's provider-only emergency-access flow. `npm
      install && npm run typecheck` actually run this time (this environment has
      `node_modules`) and pass clean.
- [x] **Full doc reconciliation** — 3 parallel forks re-verified every remaining
      `IMPLEMENTATION_PLAN.md` section against real code (not prior doc claims). Net:
      8 sections were stale "not done" (now flipped to done: 3.1–3.4, 6.1, 6.2, 8.1, 8.2,
      10.2) and 1 was stale "overstated" (9.3 cursor pagination — only 2 endpoints, zero
      frontend adoption, corrected to accurately partial).
- [x] **Patients' PHI-encryption "wall" (2.1)** — turned out to already be fully closed
      in an earlier round (Round 7) with real ChaCha20-Poly1305 + lossless conversion;
      the doc's "BLOCKED" framing was simply never updated. Verified directly (zero live
      reads of the legacy `AppState.patients` HashMap remain anywhere).
- [x] **Key rotation (6.3)** — found a more serious bug while checking this: the
      encryption key was regenerated fresh and random on *every* process start (both
      `AppState` constructors), meaning any restart silently orphaned all previously
      encrypted PHI, IPFS content, and MFA secrets — not just "no rotation," a live
      data-loss bug. Fixed with a versioned `EncryptionKeyring` (`ENCRYPTION_KEYS` env
      var, `api/src/encryption_keyring.rs`) that persists across restarts; extended to
      real per-row lazy rotation for both patient PHI (`PatientEntity.key_version`,
      migration `20260721000001_patient_key_version.sql`) and IPFS documents (which had
      an identical hardcoded, never-consulted `key_version: "1"`).
- [x] **Dead-code re-audit (8.4)** — re-verified 33 new candidates found in the doc
      sweep; 29 were false positives (live DTOs tied to real routes), 5 genuinely dead
      and removed after explicit approval (orphaned auth/token helpers, an unused
      response struct, an unwired overflow-safety helper + its now-orphaned tests/fuzz
      target, and the legacy `AppState.patients` HashMap + its redundant writer).
- [x] **10.1 large-file split** — split all 6 remaining >900-line `clinical_endpoints`
      files into per-domain submodules (161–612 lines each). Found and fixed 3 genuine
      split-boundary bugs (an attribute/doc-comment separated from its function across
      a file cut) plus one visibility fix, during verification.
- [x] **Appointment-reminder scanner (5.2) + appointments repository migration (2.1)** —
      added a 24h-ahead reminder background task (mirroring the medication-reminder
      pattern). Building it surfaced a real gap: `book_appointment`/`cancel_appointment`/
      `check_in_appointment`/etc. had never actually migrated to `AppointmentRepository`
      despite 2.1 claiming "9 sites... via AppointmentRepository" — the conversion code
      existed (`types/conversions.rs`) but was never wired into the handlers. Rather than
      build the scanner on unstable ground, migrated all 9 real call sites (including 2
      more in `surgical/public_health.rs` and 1 in `platform/analytics.rs` not in the
      original count) to the repository for real, and removed the legacy
      `AppState.appointments` HashMap entirely (zero remaining readers/writers). Added a
      shared `fetch_all_appointments()` helper to avoid duplicating pagination logic
      between the scanner and the analytics endpoint. 6 new/updated unit tests.
- Verified end-to-end after every change: `cargo check`/`clippy -D warnings --workspace`
  clean, `cargo test --workspace` 183 passed (same 4 known `Pg*` failures + 1 known
  parallel-test env-var race — confirmed both directions of that race independently,
  via `--test-threads=1` and by re-running), frontend `npm run typecheck` clean in all
  4 workspaces (incl. the mobile Expo app). No deletions without approval, nothing
  committed.

**Side finding, flagged not fixed:** `platform/sync.rs`'s conflict-resolution endpoints
are mock stubs that appear to duplicate the real ones built in Stage 2 (3.4) at a
different path — a "which endpoint should the frontend call" question, not dead code.

**Explicitly deferred by the user (2026-07-21, via direct question, not assumed):**
per-patient HSM key management (needs a KMS/HSM provider decision + real credentials
neither of which I can supply), and NFC-hardware / live FCM device testing (both need
physical hardware or a real Firebase project this environment doesn't have). All three
are implemented as far as code alone can go; further progress requires the user to
supply a provider choice, credentials, or physical hardware.

---

## Process / external dependencies (track, not blocking)
- [ ] **Decide break-glass role scope** (3 endpoints, surfaced by
      `scripts/check-write-authorization.py`). `POST /api/emergency-access` and
      `POST /api/emergency/nfc-token` currently admit Pharmacist and
      LabTechnician; `POST /api/nfc/generate` issues an identity credential to
      any clinical role. Answer the first two together. Not a code task — a
      clinical-policy decision that then becomes a one-line predicate change.
- [ ] Annual penetration-testing framework (HIPAA 2025) — schedule + scope (11.3)
- [x] Snyk scanning in CI — **wired** in `.github/workflows/ci.yml` (`snyk` job, Rust + frontend, `--severity-threshold=high`). Deliberately opt-in: it runs when the `SNYK_ENABLED` repo *variable* is `"true"` and the `SNYK_TOKEN` secret is set, so adding the token alone cannot start failing builds before the severity threshold and project scope are agreed. `cargo audit` already runs unconditionally in the same workflow. Nothing further to build; this is now an account action. (11.2)
- [x] Pin exact dependency versions — already covered by the committed `Cargo.lock` (standard Rust mechanism); see IMPLEMENTATION_PLAN.md 11.2 note (11.2)
- [ ] Live Africa's Talking SMS verification **(needs sandbox creds)** (5.3)

---

## Notes
- Commits are authored solely by the repository owner; no AI-assistant attribution.
- Keep the working tree green (`cargo check --workspace`, `npm run typecheck`) before each commit.
