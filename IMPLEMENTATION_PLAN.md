# MediChain Implementation Plan

> **Last audited:** 2026-06-01 (Round 2 partial: 10 entities migrated to repositories + 7 admin-list endpoints migrated to repositories — access_logs, nfc_tags, medical_records, allergies, vital_signs, triage_assessments, cds_alerts, appointments, medication_reminders, immunization_records; admin list endpoints now use list_all() for chain_of_custody, lab_qc, critical_values, radiology orders+reports, pathology_reports, immunization_schedules, blood bank trio; patients/lab_submissions/sync_queue deferred pending schema work)
> **Method:** Full codebase investigation across all layers (backend, frontend, blockchain, database, DevOps)
>
> **Round 3 partial (2026-06-01):** Migrated 13 sites off legacy `AppState` HashMaps onto repositories. **Read-only** (creates already persisted; reads were returning empty): `wound_assessments`, `iv_assessments`, `code_blue_records`, `history_physicals`, `io_records`, `anesthesia_records`, `consult_notes`, and the lab-tech dashboard cluster (`specimen_collections`, `specimen_rejections`, `lab_qc_records`, `critical_values`, `chain_of_custody`). **Write-path** (was lost on restart, now persisted): `adherence_logs`. Added memory `list_all()` overrides for CodeBlue, HistoryPhysical, SpecimenCollection, SpecimenRejection, Anesthesia, ConsultationNote (+ a `list_all` trait default for ConsultationNote). Verified `cargo check -p medichain-api` passes. **Still open:** shape-mismatch types (`drug_interactions`, `lab_trends`, `lab_submissions`, `e_prescriptions_v2`), ~8 new-repository domains, surgical/radiology FHIR mappers, and the `patients` encryption wall — see the Round 3 lists below. Remaining work is multi-day, not mechanical.
>
> **Round 4 (2026-06-01):** Built the 8 new-repository domains end-to-end. Added a shared `JsonRecordRepository`/`JsonRecordEntity` (JSON-blob: `id` + `owner_id` + JSONB `data` + timestamps), `MemoryJsonRecordRepository` (2 passing tests), 9 macro-generated Pg repos (compile-time table literals, fully parameterized), migration `20260601000001_phase7_new_domains.sql` (9 tables), and container wiring. Migrated all handlers (incl. read-modify-write: family add/remove member, insurance submit, symptom respond, sync push) for `language_preferences`, `eligibility_checks`, `satisfaction_surveys`, `symptom_sessions`, `family_groups`, `insurance_claims`, `autopsy_requests`/`autopsy_reports`, `sync_queue_items`. `cargo check` passes for both default and `--features postgres`.
>
> **Round 5 (2026-06-01):** Reconciled `wearable_*` (devices, readings, alerts, alert rules) and `telehealth_sessions` onto the shared `JsonRecordRepository` (their typed entities didn't fit the rich legacy structs). Added 5 JSON-record domains + migration `20260601000002_phase7_wearables_telehealth.sql` + container wiring; migrated all ~15 sites including `submit_wearable_reading` (verify → rule-eval → alerts/reading/device-sync) and telehealth join/end RMW handlers. Both builds pass; 50 memory tests pass. **Remaining 2.1:** shape-mismatch types (`drug_interactions`, `lab_trends`, `lab_submissions`, `e_prescriptions_v2`), the surgical/radiology FHIR mappers, and the `patients` encryption wall.
>
> **Round 6 (2026-06-01):** Reconciled the 4 shape-mismatch domains onto `JsonRecordRepository` with distinct tables (migration `20260601000003`): `e_prescriptions_v2`, `drug_interaction_checks`, `lab_trend_results`, `lab_result_submissions`. Migrated all sites incl. the e-prescription create/sign/transmit RMW chain. The surgical/radiology FHIR mappers (operative notes, intubations, lacerations, radiology reports) now read from repositories via the `entity.data` escape-hatch. Both builds pass.
>
> **Round 9 (2026-06-02):** **(10.1 Split clinical_endpoints.rs)** Converted the 21,446-line monolith into a directory module: `clinical_endpoints/mod.rs` (48 lines — shared imports + submodule wiring) + **13 domain submodules** (`emergency`, `assessment`, `lab`, `physician`, `workflow`, `medical_id`, `surgical`, `fhir`, `insurance_pharmacy`, `engagement`, `clinical_support`, `billing`, `platform`; 565–3,833 lines each). Each submodule does `use super::*` to inherit the shared imports/helpers and is glob-re-exported from `mod.rs`, so all `crate::clinical_endpoints::<handler>` paths (route registrations in `main.rs`) are **unchanged — zero behavior change**. Promoted the one cross-cutting helper (`get_current_user`) to `pub`. `cargo check` passes (0 errors, same 13 pre-existing warnings); 111/111 non-DB unit tests pass (the 3 `Pg*` failures need a live PostgreSQL); the whole `clinical_endpoints/` dir is rustfmt-clean. **Still open for 10.1:** the largest submodules (`engagement` ~3.8K, `workflow` ~2.6K, `surgical` ~2.2K) still exceed the skill's 300-line target and can be split further; the 40-line-per-function limit and a shared `validators.rs` were not addressed.
>
> **Round 8 (2026-06-02):** Tier-1 cross-cutting hardening pass across 5 items (no large refactors). **(5.3 SMS)** Added `SmsTemplate` enum (medication/appointment/lab/critical/OTP) with a compliance opt-out footer, `send_sms_with_retry` (bounded 3-attempt retry + `SMS_GLOBAL_DISABLE` kill-switch + per-recipient opt-in gate + `SmsDeliveryStatus` tracking), STOP-keyword detection, and 5 unit tests; wired the medication-reminder background task to use them. **(6.1 Secrets)** Parameterized all docker-compose credentials via `.env` interpolation (dev-only defaults), added a startup `validate_production_secrets()` gate that warns on demo secrets and hard-aborts when `IS_DEMO=false`, and documented the new vars in `.env.example`. **(6.3 Encryption)** Documented the enforcement audit (only `upload_encrypted` is public; `upload_raw` is private → no plaintext path), added a defense-in-depth ciphertext≠plaintext guard + regression test. **(9.5 Errors)** Added a canonical `error_envelope_json` helper (`{error:{code,message,details}}`) + a `Retry-After` header on the 429 rate-limit path (rate-limit middleware switched to `EitherBody`); full per-endpoint migration of the ~1140 ad-hoc error sites remains a tracked follow-up. **(11.2 Supply chain)** Added `deny.toml` (advisories/licenses/bans/sources) + a `supply-chain` CI job running `cargo-deny` and generating a CycloneDX SBOM artifact. `cargo check` passes (default features); 7 new unit tests pass; all touched files are rustfmt-clean. **Deliberately NOT started (large/risky, need explicit go-ahead):** 5.1 telehealth frontend/WebRTC, 9.4 JWT migration, 10.1/10.2 file splits.
>
> **Round 7 (2026-06-01):** Closed out the 2.1 entity-migration scope. (1) **Leftovers:** `soap_notes` → new `soap_note_records` JSON-record domain (migration `20260601000004`) + 4 handlers; `lab_panels` (3 sites) served from the canonical `clinical::get_standard_lab_panels()` (static reference data — no persistence needed); `specimen_collections`/`critical_values` list sites → repository `list_all()`. (2) **`patients` encryption wall (A1):** added encrypted `profile_extras_encrypted BYTEA` column (migration `20260601000005`); `patient_profile_to_entity`/`patient_entity_to_profile` helpers encrypt PHI + the full profile blob (ChaCha20-Poly1305 via `AppState.encryption_key`) for a lossless round-trip, typed columns populated for lookup; FK columns (registered_by, primary_provider_id) kept NULL since user IDs are wallet addresses not `users(id)` UUIDs. Migrated **all ~22 `data.patients` sites** (registration, NFC emergency read, list, get, update/emergency-contact/preferences RMW, 5× verify-exists, analytics, offline sync) to the repository; `load_patients_from_db` also seeds the memory repo so the DB-demo+memory config stays visible. (3) **Transactions (C1):** `RepositoryContainer::create_patient_with_nfc` commits patient + NFC tag in one PostgreSQL transaction (sequential on memory), built with `QueryBuilder`/`push_bind` (no hand-written placeholders). (4) **Graceful degradation (D1):** new `/health/ready` probe returns `503 + Retry-After` when the Postgres pool is unhealthy; pool acquire-timeout (`DB_ACQUIRE_TIMEOUT_SECS`, default 3s) already fails fast on exhaustion. **Only legacy HashMap accesses remaining** are 2 *dead/unregistered* duplicate autopsy handlers in `main.rs` (superseded by the registered `clinical_endpoints` versions — flagged for dead-code cleanup, Phase 8.4) and the `users` auth subsystem (explicitly out of 2.1 scope). Both `cargo check` (default + `--features postgres`) pass; 104 memory unit tests pass (3 `Pg*` tests need a live PostgreSQL).

> **Round 10 (2026-06-03):** Security-hardening batch **9.4 → 11.4** (backend). New `api/src/security/` module with three submodules. **(9.4 JWT)** `jwt.rs` issues HS256 access (1h) + refresh (7d) tokens with `{sub, role, mfa, typ, iat, exp}` claims (secret from `JWT_SECRET`→`SESSION_SECRET`, already in the prod-secret gate); endpoints `POST /api/auth/jwt` (verifies the sr25519 challenge then issues a pair; signature optional only in demo mode) + `POST /api/auth/jwt/refresh`. **Additive, non-destructive:** `support::get_current_user_id` now prefers a verified `Authorization: Bearer <jwt>` and falls back to the legacy `X-User-Id`, so all ~60 handlers gained JWT support with **one** change and demo mode still works. **(11.3 MFA)** `mfa.rs` RFC-6238 TOTP (SHA-1/6-digit/30s) via `totp-rs`; endpoints enroll (returns secret + `otpauth://` URI + QR PNG) / verify / challenge (step-up → new `mfa=true` token) / status / disable; enrollments live in `SecurityState.mfa` (in-memory, alongside the in-memory `users` store — DB persistence is a tracked follow-up); `enforce_mfa_step_up` gates the breach-declare endpoint (lenient for pure-`X-User-Id` callers so demo/legacy clients aren't locked out). **(11.1 TOCTOU)** `RepositoryContainer::record_access_atomic` locks the patient row `SELECT … FOR UPDATE` and verifies `is_active` in the **same transaction** as the access-log insert (memory backend: check-then-act under repo locking); wired into the `emergency_access` handler. **(11.4 Incident response)** `breach.rs` two bounded detectors — failed-auth burst (≥5/5min) + abnormal access (≥30 distinct patients/5min) — emit `SecurityAlert`s logged + pushed over SSE (`security_alert`) into a 500-entry ring buffer; admin endpoints `GET /api/admin/security/alerts` + `POST /api/admin/security/breach` (starts the POPIA 72h clock); full playbook in `docs/INCIDENT_RESPONSE.md`. `cargo check` passes (default features incl. postgres); 12 pre-existing warnings unchanged. **Still open:** JWT frontend client (Bearer storage/refresh), DB-persisted MFA enrollments + alerts, automated breach-notification dispatch, annual pen-test scheduling.

> **Round 11 (2026-06-03):** Closed the Round-10 follow-ups, completing **9.4, 11.3, 11.4** end-to-end. **(9.4 frontend)** Shared `ApiClient` now stores JWT access/refresh tokens (`setTokens`/`clearTokens`), sends `Authorization: Bearer` (X-User-Id kept as fallback), and transparently refreshes once on a 401 (deduped). Added typed `endpoints.ts` wrappers (`issueJwt`, `refreshJwt`, `mfa*`, `getSecurityAlerts`, `declareBreach`). Both `authStore`s acquire tokens on login/demo-login/restore (doctor portal signs the challenge via the wallet extension; patient app uses demo issuance) and clear them on logout. `npm run typecheck` passes for both apps. **(11.3 persistence)** MFA enrollments now persist to a new `user_mfa` table with the TOTP secret **encrypted at rest** (ChaCha20-Poly1305 via the app key); write-through on enroll/verify/disable + decrypt-on-startup loader (`AppState::load_security_from_db`). **(11.4 persistence + dispatch)** Security alerts persist to `security_alerts` (`SecurityState` carries the pool; alerts written on detection/declaration, recent ones reloaded at startup); breach declaration now dispatches an SMS to `SECURITY_OFFICER_PHONE` via the existing Africa's Talking retry sender (`notifications::dispatch_breach_notification`). Migration `20260603000001_phase11_security.sql`. `cargo check` passes; 123 unit tests pass (3 `Pg*` need a live DB). **Remaining:** regulator/data-subject email dispatch (no SMTP provider wired), annual pen-test scheduling.

> **Round 12 (2026-06-03):** Batch across **8.2, 8.3, 12.1, 12.2, 12.3, 13.3, 13.4**. **(8.2)** Prometheus `/api/metrics` (new `middleware/metrics.rs` — `http_requests_total` + `http_request_duration_seconds`, labelled by matched route pattern to bound cardinality) via a `MetricsMiddleware`; `LOG_FORMAT=json` switches logging to structured `tracing` JSON (bridges existing `log::` calls). **(12.1)** `docs/PERFORMANCE_BUDGETS.md` (3s NFC budget + LCP/TTI + bundle budgets), `client/.lighthouserc.json`, and a report-only `lighthouse` CI job. **(12.2)** `proptest` dev-dep + `property_tests.rs` (12 properties): consent-expiry overflow safety (new `checked_consent_expiry`), blood-type compatibility matrix (new `blood_type_compatible`), NFC hash determinism/separator-safety (new pub `card_hash`), MAP overflow-free (new `mean_arterial_pressure`). **(12.3)** `.pre-commit-config.yaml` mirroring CI (fmt/clippy/typecheck + hygiene). **(13.3)** `printpdf`-backed `pdf.rs` + `POST /api/pdf/document` (titled, sectioned, paginated A4 → `application/pdf`). **(13.4)** Insurance-card CRUD: added `delete` to `JsonRecordRepository` (memory + pg macro), new `insurance_cards` JSON-record domain + table, `GET/POST/PUT/DELETE /api/insurance/cards` + shared client wrappers. **(8.3)** Turned the Expo connectivity-tester into a functional patient-app core under `mobile-examples/expo-starter/src/` (JWT API client, secure-store + biometric auth, Login/EmergencyCard/MyRecords screens, tab root) — **delivered unverified** (mobile `node_modules` not installed here; NFC/QR hardware pending). `cargo check --tests` passes; 138 unit tests pass (3 `Pg*` need a live DB) incl. all 12 property tests + PDF + metrics; frontend `npm run typecheck` passes. **Still open:** Grafana dashboard + alerting (8.2), fuzz targets + flamegraph/RUM (12.1/12.2), print CSS + per-domain PDF buttons (13.3), insurance-card image upload (13.4), full mobile parity + NFC/QR (8.3).

> **Round 13 (2026-06-03):** Multi-area batch. **(9.1 versioning)** `ApiVersionMiddleware` rewrites `/api/v1/...`→`/api/...` before routing, so both prefixes hit the same handlers with no per-route churn. **(9.2 idempotency)** `IdempotencyMiddleware` caches (24h, bounded) the response of `POST`/`PUT` requests carrying `Idempotency-Key` and replays it verbatim on retry — exactly-once for chain-coupled writes. **(9.3 pagination)** `pagination.rs` opaque base64 cursor util (`{ts,id}`, ts DESC) + `Cursorable` trait + `CursorQuery`, adopted on `GET /api/insurance/cards/{patient_id}` (returns `next_cursor`). **(6.2 TLS)** Reverse-proxy termination via Caddy (`Caddyfile`, `docker-compose.tls.yml`, `docs/TLS.md`, automatic Let's Encrypt) + `SecurityHeadersMiddleware` (HSTS over forwarded-HTTPS, nosniff, frame-deny, referrer-policy). **(8.2 follow-up)** `docs/observability/` — Grafana dashboard JSON + Prometheus alert rules (down/5xx/latency/401-spike) + README. **(13.4 follow-up)** `POST /api/insurance/cards/{id}/image` → ChaCha20-Poly1305-encrypted IPFS upload, hash saved on the card; shared `uploadInsuranceCardImage`. **(13.3 follow-up)** shared `exportDocumentToPdf` (downloads from `/api/pdf/document`). **(3.5 i18n)** React `I18nProvider` + `useTranslation` + `LanguageSwitcher` (`i18n/react.tsx`), English-fallback deep merge, added `sw-KE`/`am-ET` locales + `fr-FR`/Swahili/Amharic starter bundles, wired into both app roots. **(13.2)** confirmed already gated behind `IS_DEMO` (Insurance/LabTrends/Wearables). `cargo check --tests` green; 144 unit tests pass (3 `Pg*` need a live DB) incl. new idempotency/versioning/pagination tests; both client workspaces `tsc --noEmit` clean. **Still open:** native Actix TLS (reverse-proxy preferred), cursor adoption on remaining list endpoints, full i18n string extraction across pages, `cargo-fuzz` targets (12.2), print CSS (13.3), and 13.1 `@ts-ignore` cleanup.

> **Round 14 (2026-06-04):** **(3.5 i18n — reference flow)** Audited 13.1 (production source is `@ts-ignore`/`as any`-clean; remaining are test mocks) and 13.3 (print CSS already present in both apps' `index.css`). Then extracted the patient **Login page** end-to-end as the i18n reference implementation: added an `auth` section + `common.or` to `en-US` and `fr-FR`/`sw-KE`/`am-ET` (aligned the `emergency` keys across locales), wired `useTranslation()` + a `LanguageSwitcher` into `LoginPage.tsx`, and replaced every user-facing string with `t('auth.*')`. Both client workspaces `tsc --noEmit` clean. Remaining pages follow the same mechanical pattern.

> **Round 15 (2026-06-04) — Jitsi telehealth, foundation (Phases 1–2):** Decisions: self-hosted Jitsi, foundation-first, recording opt-in/E2EE-off, mobile in the Expo app (later). **(Phase 1, backend)** `telehealth.rs` now signs HS256 Jitsi JWTs for self-hosted Prosody token auth (`sign_jitsi_jwt`, claims `iss/aud/sub/room/iat/nbf/exp/context.user{...,moderator}`, 30-min TTL, secret from `JITSI_APP_SECRET` — `None` ⇒ open room); `role_is_moderator` maps Doctor/Nurse/LabTech/Admin→moderator, Pharmacist/Patient→participant; new trait method `join_credentials` + `TelehealthService::join_credentials`; the `POST /…/join` handler now returns `{role, jitsi:{domain,room,jwt,moderator,expires_in}}`. Env documented in `.env.example`. **Corrected the plan:** JWT only works on self-hosted/JaaS, not public meet.jit.si — flagged to the user before building. **(Phase 2, frontend)** New `JitsiMeetComponent.tsx` replaces the raw iframe with `JitsiMeetExternalAPI` (JWT option, `videoConferenceJoined`/`participantJoined|Left`/`errorOccurred`/`readyToClose` listeners → connection status + live participant count + error overlay, `dispose()` cleanup, moderator badge); `TelehealthPage` now calls the join endpoint for credentials and renders it (raw-iframe fallback retained). `cargo check` green, 146 unit tests pass (3 `Pg*` need a live DB) incl. 2 new JWT tests; doctor-portal `tsc` clean. **Stopped here for review** per the foundation-first decision; Phases 3–8 (session lifecycle, mobile deep-link/RN SDK, self-host Docker/TURN, recording+transcription, SSE relay, load/E2E) remain.

> **Round 16 (2026-06-04) — Jitsi telehealth Phase 5 (self-hosted deployment):** `docker-compose.jitsi.yml` stands up the official Jitsi stack (web/prosody/jicofo/jvb) with **Prosody JWT auth wired to the same `JITSI_APP_ID`/`JITSI_APP_SECRET` the API signs with** (`JWT_APP_*`, `ENABLE_GUESTS=0`, `ENABLE_E2EE=0` per the recording decision) — closing the loop so self-hosted Prosody validates the API's HS256 tokens. New `GET /api/health/telehealth` probes Jitsi reachability + latency and reports `{status, domain, provider, jwt_configured, response_time_ms}` (503 when unreachable; unauthenticated under the `/api/health` bypass). `docs/jitsi-deployment.md` documents DNS/TLS/TURN/firewall (UDP 10000), the shared-secret requirement, verification, and monitoring. `JITSI_DOMAIN` was already configurable. `cargo check` green. **Phases 3, 4, 6, 7, 8 remain** (session lifecycle, mobile RN SDK, recording+transcription, SSE relay, load/E2E).

## Executive Summary

> **Status refresh — 2026-06-04.** The "critical gaps" that defined the original audit are
> now **closed**: blockchain extrinsics are real (`subxt`), clinical data persists to
> PostgreSQL via the repository layer, the frontend consumes SSE in both apps, and there is
> a real frontend test suite (Vitest + Playwright). Since then the project also gained JWT +
> TOTP MFA, offline support, full Jitsi telehealth, observability (`/api/metrics` + Grafana),
> TLS, API versioning/idempotency/pagination, incident response, and i18n scaffolding.

MediChain is now well into **production hardening** (roughly **85-90%** of the tracked plan
complete). The core architecture is sound — 70+ database tables, 130+ API endpoint
definitions, 76 doctor-portal + 26 patient-app pages, 3 Substrate pallets, and
ChaCha20-Poly1305 encryption. Remaining work is incremental polish and breadth (full i18n
string extraction, FCM push, residual PostgreSQL round-trip fidelity, module-split &
dead-code cleanup, error-envelope migration, fuzz/load tests) — tracked in
[`docs/NEXT_WEEK_TODO.md`](docs/NEXT_WEEK_TODO.md). The per-item status tables below remain
the source of truth for each feature.

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| :white_check_mark: | Fully implemented and working |
| :large_orange_diamond: | Partially implemented — functional but incomplete |
| :red_circle: | Stubbed/mock/not implemented |

---

## Phase 1: Critical — Blockchain Integration :white_check_mark:

**Priority:** CRITICAL
**Impact:** Core value proposition — immutable medical records on-chain

### 1.1 Real Extrinsic Submission :white_check_mark:
**Files:** `api/src/blockchain.rs`, `api/Cargo.toml`

**Current state:** Implemented real extrinsic submission using `subxt` dynamic calls. Supports `register_patient`, `update_ipfs_hash`, and `grant_emergency_access`.

**What's needed:**
- [x] Add `subxt` and `parity-scale-codec` to `api/Cargo.toml`
- [x] Generate type-safe client from Substrate node metadata (`subxt codegen`) - *Using dynamic calls for Phase 1*
- [x] Replace `pending_extrinsic()` placeholder logic with real SCALE-encoded extrinsic submission
- [x] Add proper error handling, retry logic, and transaction status tracking
- [x] Wire up `register_patient_on_chain()` to submit real `patient_identity::register` extrinsic
- [x] Wire up `record_ipfs_hash_on_chain()` to submit real `medical_records::update_ipfs_hash` extrinsic
- [x] Wire up `log_access_on_chain()` to submit real `access_control::grant_emergency_access` extrinsic
- [x] Store real transaction hashes in the `blockchain_tx_hash` columns already in the DB schema

### 1.2 Substrate Node Implementation :white_check_mark:
**File:** `node/src/main.rs`

**Current state:** Basic Substrate node implemented with `sc-service`, `sc-cli`, and support for MediChain runtime.

**What's needed:**
- [x] Implement full Substrate node with `sc-service`, `sc-client-api`, `sc-consensus`
- [x] Create chain specification (dev, local testnet, production)
- [x] Configure genesis state with initial accounts and roles
- [x] Add the node service to `docker-compose.yml` (currently missing)
- [ ] OR: Document use of an external/shared Substrate testnet instead of self-hosted node

### 1.3 Frontend Wallet Integration :white_check_mark:
**Files:** `client/shared/src/wallet/types.ts`, `client/doctor-portal/src/pages/LoginPage.tsx`

**Current state:** Integrated `@polkadot/extension-dapp`. Supports real wallet connection and message signing.

**What's needed:**
- [x] Integrate `@polkadot/extension-dapp` for real wallet connection
- [x] Implement `signMessage()` flow for transaction signing
- [x] Add wallet connect UI with extension detection and fallback instructions
- [x] Send `X-Signature` header with signed payloads on protected API calls
- [x] Enable `IS_DEMO=false` path and test end-to-end signature verification

---

## Phase 2: Critical — Data Persistence

**Priority:** CRITICAL
**Impact:** All clinical data is lost on server restart

### 2.1 Clinical Endpoints: Memory → PostgreSQL :large_orange_diamond:
**File:** `api/src/clinical_endpoints.rs` (~16K lines, ~478 handlers) + `api/src/main.rs`

**Current state (Round 2 partial):** Migration is now entity-by-entity. Conversion impls (legacy struct ↔ repository entity) live in `main.rs` next to the legacy struct definitions. Sites migrated to `data.repositories.*` for these entity types:

**Migrated (read+write paths via repositories):**
- [x] `access_logs` — 16 sites (12 in main.rs, 4 in clinical_endpoints.rs); read/write via `AccessLogRepository`
- [x] `nfc_tags` — 3 handler sites (registration write, emergency-access read, simulate-nfc-tap read+write) via `NfcTagRepository`. Seed loader at `main.rs:1900` left on legacy HashMap (init-only path).
- [x] `medical_records` — 4 sites (upload write, ownership read, list read, lab-approval write) via `MedicalRecordRepository`. Bidirectional `MedicalRecordReference ↔ MedicalRecordEntity` conversion.
- [x] `allergies` — 1 site (drug-interaction check) via `AllergyRepository`.
- [x] `vital_signs` — 2 sites (add-reading write, FHIR Observation read) via `VitalSignsRepository`. Bidirectional `VitalSignsReading ↔ VitalSignsEntity` conversion.
- [x] `triage_assessments` — 1 site (FHIR Encounter read) via `TriageAssessmentRepository`.
- [x] `cds_alerts` — 8 sites (create, list-by-provider, get-by-id, respond, list-by-patient, analytics dashboard, list-all, rules-engine write inside record_vital_signs) via `CdsAlertRepository`. Bidirectional `CDSAlert ↔ CdsAlertEntity` round-trips via packing extras (clinical_context, expires_at, guideline_reference, original triggering_data) into `trigger_data` JSON, and serializing `recommended_actions`/`evidence` arrays to JSON strings in `recommendation`/`clinical_evidence`. Added `update()` and `list_all(pagination)` trait methods + memory + postgres impls to support response-payload round-trips and admin views.
- [x] `appointments` — 9 sites (book, get-by-patient, get-by-provider, cancel, check-in, available-slots, dashboard analytics, appointment analytics, patient sync data) via `AppointmentRepository`. Bidirectional `Appointment ↔ AppointmentEntity` conversion packs legacy-only fields (provider_name, scheduled_date/start_time strings, AppointmentLocation struct, reminders_sent, instructions, booked_by, is_telehealth) into `entity.data` (a `serde_json::Value`). **Postgres caveat:** `entity.data` is `#[sqlx(skip)]` and not persisted, so a postgres round-trip reconstructs primary fields from columns but loses the extras (provider_name → defaults to "Dr. Provider", location → flat string, reminders_sent → empty). Memory backend preserves everything. Added `list_all(pagination)` and `get_by_provider_all(provider_id, pagination)` to the trait with memory + postgres impls.
- [x] `medication_reminders` — 6 sites (create, list-active by patient, ownership check for adherence log, deactivate, background due-time scanner, patient sync data) via `MedicationReminderRepository`. Bidirectional `MedicationReminder ↔ MedicationReminderEntity` conversion packs the legacy multi-time `reminder_times: Vec<String>`, `frequency` enum, `created_by`, and `notification_prefs` struct into a new `entity.data` field. The entity's single `scheduled_time: NaiveTime` is seeded from the first reminder time so postgres backends still trigger once per day. **Postgres caveat:** Same `#[sqlx(skip)]` pattern as appointments — extras are lost on postgres round-trip, so the background HH:MM matcher only fires on `scheduled_time` (the first/seed time), not the full Vec, after a postgres reload. Added `list_all_active()` trait method + memory + postgres impls to support the background scanner.
- [x] `immunization_records` — 3 sites (create, FHIR Bundle by patient, admin list-all) via `ImmunizationRecordRepository`. Bidirectional `ImmunizationRecord ↔ ImmunizationRecordEntity` conversion now populates primary entity columns (vaccine_name, cvx_code, lot_number, manufacturer, administration_date, route enum→string, funding_source enum→string, etc.) instead of stuffing the whole record into `entity.data`. Legacy-only fields (`expiration_date`, `registry_reported`, plus enum snapshots for restoration) are packed into `entity.data`. Added `list_all()` trait method + memory + postgres impls for the admin endpoint. **Postgres caveat:** `expiration_date` and `registry_reported` are lost on postgres round-trip (no columns); FHIR Bundle still works because primary fields are now persisted.

**Admin-list endpoints migrated (read-only via `list_all()`):** These return entity types directly (rather than legacy structs) since the admin endpoints don't have established client consumers and the shape change is acceptable. Each entity got a `list_all()` default trait method + memory backend override; postgres backends inherit the default (which returns `NotFound`) so they fall through `unwrap_or_default()` to an empty list — postgres `list_all` impls are a Round-3 follow-up.
- [x] `chain_of_custody` (admin list, line 19565) — via `ChainOfCustodyRepository::list_all()`
- [x] `lab_qc_records` (admin list, line 19608) — via `LabQcRecordRepository::list_all()`
- [x] `critical_values` (admin list, line 19654) — via `CriticalValueRepository::list_all()`
- [x] `radiology_orders` + `radiology_reports` (admin list, lines 19700-01) — via `RadiologyOrderRepository::list_all()` + `RadiologyReportRepository::list_all()`
- [x] `pathology_reports` (admin list, line 19751) — via `PathologyReportRepository::list_all()`
- [x] `immunization_schedules` (admin list, line 19809) — via `ImmunizationScheduleRepository::list_all()`
- [x] `blood_type_screens` + `crossmatch_records` + `transfusion_records` (admin list, lines 19858-60) — via respective `*::list_all()`

**list_all default trait method added (memory backend overrides included) but admin endpoints not yet migrated:** these have parity ready for Round 3 endpoint migration: `BloodTypeScreen`, `Crossmatch`, `Transfusion`, `ImmunizationSchedule`, `SpecimenCollection`, `SpecimenRejection`, `LabPanel`, `Anesthesia`, `CodeBlue`, `OperativeNote`, `IntubationRecord`, `LacerationRepair`, `HistoryPhysical`, `LabTrend`. (Memory overrides done for those used in admin endpoints; remaining ones inherit the default and need overrides during Round 3 endpoint migration.)

**Not yet migrated (deferred, with reasons):**

*Schema/encryption blockers (need design work):*
- [ ] `patients` (18 main.rs + 4 clinical_endpoints.rs sites) — **BLOCKED**: `PatientProfile` (rich plaintext nested struct) cannot losslessly convert to `PatientEntity` (encrypted byte fields + missing address/insurance/preferences/contacts). Needs encryption helpers (ChaCha20 using `data.encryption_key`) + side tables OR a JSON blob column on `patients` table.
- [ ] `lab_submissions` (10 sites across main.rs + clinical_endpoints.rs) — **BLOCKED**: `LabResultSubmission` models a *result review workflow* (status=Pending/Approved/Rejected, reviewed_by, rejection_reason, IPFS content_hash); `LabSubmissionEntity` models a *test order ticket* (ordering_provider_id, tests_ordered JSON, priority, no review fields). Different domain concepts. Either add review fields to `LabSubmissionEntity`, build a new `LabResultRepository`, or accept lossy mapping.
- [ ] `sync_queue` (3 sites) — **BLOCKED**: `SyncQueueItem` is a *per-item pending queue* (device_id, entity_type, entity_id, operation, attempts, priority); `SyncOperationEntity` is a *batch sync run summary* (total_records, processed_records, success_count). Different concepts. Needs a `SyncQueueItemRepository` or rework of `SyncOperationEntity`.

*Workable but non-trivial (enum→string + datetime conversion):*
- (none currently — see Migrated list above)

*Round 3 — Feature-site migrations (repos+list_all ready, sites still on legacy HashMap):*
- [x] lab-tech dashboard cluster → migrated via `list_all()`: `specimen_collections` (4853), `specimen_rejections` (4859), `lab_qc_records` (4865), `critical_values` (4871), `chain_of_custody` (4877). Added memory `list_all()` overrides for `specimen_collections` + `specimen_rejections`. **(Round 3)**
- [ ] `specimen_collections` (1 remaining site: 3147), `lab_panels` (1 site: 4883 — seed-loaded, no repo create path) — still on legacy HashMap.
- [ ] `lab_trends` (3 sites) — **deferred (shape mismatch)**: handler stores `LabTrendResult` (rich trend *analysis*: rate, statistical significance, prediction) but `LabTrendEntity` is a summary row with no `data`/JSON escape-hatch column. Needs an added JSON column or a dedicated repo.
- [ ] `operative_notes` (10567), `intubation_records` (10622), `laceration_records` (10661), `radiology_reports` (10424) — **deferred (lossy FHIR mappers)**: FHIR `Procedure`/`DiagnosticReport` builders read rich legacy fields (`note.surgeons[].name`, `note.findings`, `note.complications`, `intub.successful`) that the flattened entities rename/drop. No data loss (creates already persist) — needs careful per-field remap.
- [x] `anesthesia_records` (list endpoint: 8166) → `AnesthesiaRecordRepository::list_all()` (added memory override). **(Round 3)**
- [x] `history_physicals` (1 site: 4260) → `HistoryPhysicalRepository::list_all()`; `code_blue_records` (1 site: 5429) → `CodeBlueRepository::list_all()`. Added the missing memory `list_all()` overrides for both (previously inherited the `NotFound` default). **(Round 3)**
- [x] `io_records` (1 site: 20367) → `IORecordRepository::list_all()`. **(Round 3)**
- [x] `adherence_logs` (write path: 11435) → `AdherenceLogRepository::create()` (was lost on restart; now persisted). Inline `MedicationAdherenceLog` → `AdherenceLogEntity` mapping. **(Round 3)**
- [x] `insurance_claims` (5 sites) → new shared `JsonRecordRepository` (`insurance_claims` table). Create + submit (RMW) + get + list-by-patient + analytics dashboard all persisted. **(Round 4)**
- [x] `wound_assessments` (1 site: 5646) → `WoundAssessmentRepository::list_all()`; `iv_assessments` (1 site: 5662) → `IVAssessmentRepository::get_sites_needing_attention()` (semantically correct for a nursing task list). **(Round 3)**
- [ ] `drug_interactions` (2 sites) — **deferred (shape mismatch)**: handler stores a `DrugInteractionResult` (a *check session* with N interactions, `safe_to_prescribe`, `checked_by`); `DrugInteractionEntity` models a *single* drug-pair with no session/JSON column. Needs a flattened (lossy) mapping or a dedicated `DrugInteractionCheckRepository`.

*Round 3 — Migrated (repo existed; added `list_all()` where missing):*
- [x] `consult_notes` (list: 20071) → `ConsultationNoteRepository::list_all()` (added trait default + memory override). **(Round 3)**

*Round 4 — New-repository domains (DONE):* built a shared `JsonRecordRepository` + `JsonRecordEntity` (`id`, `owner_id`, JSONB `data`, timestamps), a memory backend (`MemoryJsonRecordRepository`, 2 passing unit tests), 9 macro-generated PostgreSQL types (compile-time table literals — no SQL string concatenation, all values bound), migration `20260601000001_phase7_new_domains.sql` (9 tables + owner indexes), and `RepositoryContainer` wiring (struct + `new_memory` + `new_postgres`). Each handler serializes the full legacy struct losslessly into `data`:
- [x] `language_preferences` (upsert-by-user + get) **(Round 4)**
- [x] `eligibility_checks` (write) **(Round 4)**
- [x] `satisfaction_surveys` (write + get) **(Round 4)**
- [x] `symptom_sessions` (write + respond RMW + get + history) **(Round 4)**
- [x] `family_groups` (8 sites: create + add-member RMW + remove-member RMW + get + my-groups + appointment-booking check) **(Round 4)**
- [x] `insurance_claims` (5 sites) **(Round 4)**
- [x] `autopsy_requests` + `autopsy_reports` (write + get + list) **(Round 4)**
- [x] `sync_queue_items` (push loop + pending-count + device-queue) **(Round 4)**
- Verified: `cargo check` (default + `--features postgres`) both pass; 2 new memory tests pass.

*Round 5 — Wearables + Telehealth (DONE):* the existing typed repos (`WearableDeviceRepository`, `TelehealthSessionRepository`, …) have rich column shapes that don't match the legacy structs, so these persist losslessly through the shared `JsonRecordRepository` instead. Added 5 distinctly-named domains (`wearable_device_records`, `wearable_reading_records`, `wearable_alert_records`, `wearable_alert_rules`, `telehealth_session_records`) with 5 Pg types + migration `20260601000002_phase7_wearables_telehealth.sql` + container wiring. Migrated all ~15 sites incl. the complex `submit_wearable_reading` (device verify → alert-rule evaluation → store alerts/reading → device-sync RMW) and the telehealth join/end RMW handlers.
- [x] `wearable_devices` / `wearable_readings` / `wearable_alerts` / `wearable_alert_rules` (register, list, submit-reading, rules CRUD, alerts read) **(Round 5)**
- [x] `telehealth_sessions` (create, get, join RMW, end RMW, list-by-patient) **(Round 5)**
- Verified: `cargo check` (default + `--features postgres`) both pass; 50 memory tests pass.

*Round 3/4/5 — Out of scope / still open:*
- [ ] `users` (~30 sites) — no repository exists; auth subsystem keeps own state (out of scope for 2.1).
- [ ] `e_prescriptions_v2` (7 sites) — `EPrescriptionRepository` exists but shape differs; reconcile via `data` JSON (same pattern as Round 5) — not yet done.

**What's still needed:**
- [ ] Remaining deferred migrations: shape mismatches (`drug_interactions`, `lab_trends`, `lab_submissions`, `e_prescriptions_v2`); surgical/radiology FHIR mappers (per-field remaps); the `patients` encryption wall. The 8 new-repository domains (Round 4) **and** `wearable_*` + `telehealth_sessions` (Round 5) are **DONE**.
- [ ] Resolve patient encryption/schema wall (separate design task — security-sensitive PHI encryption)
- [ ] Ensure `MEDICHAIN_STORAGE=postgres` activates PostgreSQL for ALL endpoints
- [ ] Add database transaction support for multi-step operations (e.g., creating a record + logging access)
- [ ] Verify all 70+ DB tables have matching repository CRUD operations
- [ ] Add connection pool health monitoring and graceful degradation

### 2.2 Unimplemented Repository Trait Methods :white_check_mark:
**File:** `api/src/repositories/traits.rs`

**Current state:** All 43 previously-default `NotImplemented` trait methods now have real implementations in both `memory/` and `postgres/` backends. Memory backend covered by 11 new unit tests in `phase5.rs` and `phase6.rs` (44 memory tests pass).

**What's needed (by repository):**

**InsuranceRecordRepository:**
- [x] `deactivate()` — mark insurance record inactive
- [x] `get_expiring()` — find records nearing expiration
- [x] `get_primary()` — return patient's primary insurance
- [x] `get_active()` — list active insurance records
- [x] `verify_eligibility()` — run eligibility rules engine
- [x] `set_primary()` — designate primary insurance
- [x] `terminate()` — end an insurance record

**BillingCodeRepository:**
- [x] `get_active()`, `deactivate()`, `list_by_type()`

**CdsAlertRepository:**
- [x] `get_by_encounter()`, `get_unacknowledged()`, `dismiss()`, `get_by_rule()`, `get_high_severity()`

**DeathRecordRepository:**
- [x] `certify()`, `get_pending_certification()`, `get_medical_examiner_cases()`, `get_pending_autopsies()`

**OrganDonationRecordRepository:**
- [x] `get_pending_recovery()`, `get_by_opo()`

**SyncOperationRepository:**
- [x] `update_progress()`, `complete()`, `fail()`, `get_pending_retries()`, `get_in_progress()`

**SyncConflictRepository:**
- [x] `get_auto_resolvable()`

**ExternalIdMappingRepository:**
- [x] `update_sync_time()`, `delete()`, `deactivate()`, `get_by_system()`

---

## Phase 3: High — Frontend Completeness

**Priority:** HIGH
**Impact:** Many pages are form shells without real API integration

> **Phase B (2026-06-02):** Audited all 152 doctor-portal + 26 patient-app page files for real backend wiring (scanned every `@medichain/shared` import, `getApiClient`, `apiUrl`/`fetch`, and write call). **Finding: the frontend is largely wired already** — the "form shells" framing was stale. Only a handful of genuine gaps exist:
> - **Wired this pass:** `LabQCPage` (imported `createLabQc` but its submit handlers only updated local state → now `await createLabQc(...)`); `LanguageSettingsPage` (patient app — `handleSaveSettings` was a simulated `setTimeout` → now `await setLanguagePreference(...)` with the patient's `walletAddress`). Frontend `npm run typecheck` passes clean.
> - **`EmergencyAccessPage`** — not a gap: it delegates the emergency lookup to the wired `NFCTapSimulator` component.
> - **Remaining gaps (larger than gap-fill, flagged):** `DeathCertificatePage` is a 4-step wizard whose certifier fields aren't held in React state and whose "Sign & Submit" button has no handler — needs certifier state + a payload matching the backend `DeathCertificate` struct. `PediatricsPage` has **no backend endpoint and no shared API wrapper** — a full vertical feature (backend route + shared fn + page wiring), not a frontend gap-fill.
> - Everything else (Burn, Psych, OB, Cardiac, MAR, Triage, Vitals, SymptomChecker, Appointments, Medications, Telehealth, …) already calls the API.

### 3.1 Clinical Form Pages — API Integration :large_orange_diamond:
**Files:** `client/doctor-portal/src/pages/` (76 pages)

**Current state:** Core pages (Dashboard, PatientSearch, LabResults, Login) are fully integrated with the shared API client. However, many specialty clinical form pages (Burn, Psych, Pediatrics, Obstetrics, and others) are form shells that manage local state but don't submit to the backend.

**What's needed:**
- [ ] Audit all 76 pages — identify which ones call `apiClient.*` vs only `useState`
- [ ] Wire remaining form pages to their corresponding shared API endpoint functions
- [ ] Add proper loading states, error handling, and success feedback to each form
- [ ] Add form validation (required fields, value ranges, format checks)
- [ ] Ensure all forms send `X-User-Id` auth header via the shared API client

### 3.2 Patient App Completeness :large_orange_diamond:
**Files:** `client/patient-app/src/pages/` (26 pages)

**Current state:** Login, Dashboard, and MyRecords are fully implemented. Appointments, Vital Signs, Medications, Offline Sync, Symptom Checker, Telehealth, and Family Groups pages exist but have minimal backend integration.

**What's needed:**
- [ ] Complete API integration for Appointments, Vital Signs, Medications pages
- [ ] Wire Symptom Checker page to backend `analyze_symptom_combination` endpoint
- [ ] Wire Telehealth page to backend session creation/join endpoints
- [ ] Implement Family Groups page with real family medical history API calls
- [ ] Add offline indicator UI and sync status display

### 3.3 Real-Time Events (SSE) in Frontend :white_check_mark:
**Files:** `client/doctor-portal/`, `client/patient-app/`

> **Phase B2 (2026-06-02):** Found already implemented — the plan text below is stale. A `useSSE` hook (`shared/src/hooks/useSSE.ts`, fetch+ReadableStream with `X-User-Id` auth + 5s reconnect) feeds both shells: the **shared `Layout`** (used by the patient app via `variant="patient"`) and the **doctor-portal's own `Layout`** each call `useSSE()` and convert events to toasts via `useToastActions` (variant-specific: appointment/medication reminders + notifications for patients; CDS/system alerts for doctors) and refresh sidebar badges. The patient app re-exports the shared `ToastProvider` (`export * from '@medichain/shared'`), so the contexts match and toasts render. No change needed.

**Current state:** Backend has a fully working SSE system (`GET /api/events` with `WsSessionManager`). The shared client has a `websocket.ts` utility. But NO frontend page actually connects to SSE or displays real-time notifications.

**What's needed:**
- [ ] Create a React hook (`useSSE` or `useRealTimeEvents`) that connects to `/api/events`
- [ ] Wire into doctor portal: show real-time CDS alerts, lab result notifications, Code Blue alerts
- [ ] Wire into patient app: show appointment reminders, medication reminders, lab results ready
- [ ] Add a notification bell/toast system for incoming events
- [ ] Handle SSE reconnection on connection drop

### 3.4 Offline Support :large_orange_diamond:
**Files:** `client/shared/src/` (IndexedDB utils, OfflineQueue)

> **Phase B2 (2026-06-02):** Mostly already implemented. The shared **API client (`client.ts`) integrates `OfflineQueue`**: it enqueues write operations when offline and `processQueue`s them on reconnect (so the "integrate OfflineQueue into the API client" item is done). The **shared `Layout` already renders an offline banner** (`useApiStatus` → `{isOnline, queueSize}` with a Retry button), so the patient app had the indicator; **added the same indicator to the doctor-portal's own `Layout`** this pass (it was the one shell missing it). Frontend `npm run typecheck` clean.
>
> **Phase B3 (2026-06-02):** Offline *read* cache done. Added a reusable `useOfflineCache<T>(cacheId, category, fetcher, ttl)` hook (`shared/src/hooks/useOfflineCache.ts`): online → fetch + `cacheData()` to IndexedDB; offline or on fetch failure → serve `getCachedData()` and flag `fromCache`. Wired it into the flagship **`EmergencyCardPage`** (patient app) — the emergency card (blood type, allergies, conditions, meds, contact) now caches on load and is viewable with no network, with an "Offline — showing your saved copy" badge. The same hook can wrap other read pages (MyRecords, Medications) incrementally. `npm run typecheck` clean. `npm run typecheck` clean.
>
> **Phase B4 (2026-06-02) — 3.4 conflict resolution (B1, full vertical) DONE:** Replaced the `/api/sync` `conflicts` stub with **real last-write-wins detection** in `perform_sync` (`clinical_endpoints/platform.rs`): it builds the latest server-side version per `(entity_type, entity_id)` from sync history and, when an incoming item's `local_timestamp` is older than the server's, records a `SyncConflict` (persisted via `SyncConflictRepository`) and holds the change instead of applying it. Added **`GET /api/sync/conflicts`** (pending list) and **`POST /api/sync/conflicts/{id}/resolve`** (`UseLocal`/`UseServer`/`Merge`; local/merged winners are written back as the newest synced version) — registered in `main.rs`. Shared wrappers `getSyncConflicts()` + `resolveSyncConflict(id, resolution)`. Frontend: **OfflineSyncPage** now shows a "Sync Conflicts" section (your-version vs server-version diff + **Keep mine / Keep server** buttons). Both `cargo check` (default + `--features postgres`) pass; 111 backend unit tests pass (3 `Pg*` need a live DB); frontend `npm run typecheck` clean. **3.4 is now complete.**

**Current state:** Offline utilities (IndexedDB, OfflineQueue) exist in the shared package but are not integrated into any page component.

**What's needed:**
- [ ] Integrate OfflineQueue into API client for automatic request queuing when offline
- [ ] Add offline detection (navigator.onLine + fetch-based heartbeat)
- [ ] Implement sync-on-reconnect with conflict resolution UI
- [ ] Cache critical patient data in IndexedDB for offline viewing
- [ ] Add visual offline/online status indicator in the app shell

### 3.5 Internationalization (i18n) :red_circle:
**Files:** `client/shared/src/` (i18n utils exist)

**Current state:** i18n utilities exist in the shared package but are not integrated. All UI is English-only.

**What's needed:**
- [ ] Integrate i18n provider into both apps' root components
- [ ] Extract all user-facing strings to translation files
- [ ] Add language switcher UI
- [ ] Prioritize: English, Amharic, Swahili, French (target African markets)

---

## Phase 4: High — Clinical Logic Engine

**Priority:** HIGH
**Impact:** Core clinical decision support features are data-layer-only

> **Phase A (2026-06-02):** Closed the genuinely-missing pieces; much of this phase was already implemented (the plan text below predates that).
> - **4.1 Drug interactions — DONE for the auto-screen.** Extracted the ~200-pair curated table into a shared `evaluate_drug_interactions(&[String])` (single source of truth) and wired it into `create_e_prescription`: the new drug is screened against the patient's current medications, **contraindicated combinations block the save unless `override_interactions=true`** (with `override_reason`), major/contraindicated findings are persisted (audit trail) and pushed via SSE, and warnings are returned in the response. (Importing RxNorm/DrugBank remains a separate data-pipeline task.)
> - **4.3 CDS rules — DONE (wired into more handlers).** Added a shared `run_and_persist_cds_alerts(...)` with **alert-fatigue suppression** (skips an alert when an active one with the same title already exists, and de-dups within a batch). Call sites added: medication-administration (`create_mar`) and lab-result submission (`submit_lab_results`, building a numeric `lab_values` map for the hyperkalemia/AKI/etc. rules); the vital-signs site now passes the patient's **real** chronic conditions + current medications (via `patient_conditions_and_meds`) instead of empty vecs. (Nursing assessments largely flow through the vitals path; a dedicated nursing call site remains optional.)
> - **4.2 Symptom checker — already complete; mappings expanded.** The engine already had multi-symptom scoring with ICD-10, extensive red-flag triage (ACS/MI, stroke FAST, meningitis/SAH, hypertensive encephalopathy, peritonitis, ectopic/obstetric haemorrhage, appendicitis, renal colic, pneumonia…), patient-facing disclaimers on both endpoints, and the patient SymptomChecker page is wired. Added 4 missing critical emergencies: **sepsis, anaphylaxis, pulmonary embolism, diabetic ketoacidosis.**
>
> Both `cargo check` (default + `--features postgres`) pass; 104 memory unit tests pass (3 `Pg*` tests need a live DB). **Phase B (frontend 3.1/3.2)** = audit-for-gaps + polish, since the pages are largely wired already.

### 4.1 Drug Interaction Checking :large_orange_diamond:
**Files:** `api/src/clinical_endpoints.rs`, `api/src/repositories/traits.rs`

**Current state:** The `check_drug_interactions` function has 130+ entries (contraindicated/major/moderate) hardcoded. The DrugInteraction entity and CDS Alert repository exist. But there's no dynamic rule engine — it's a static lookup table.

**What's needed:**
- [ ] Expand drug interaction database (consider importing from RxNorm or DrugBank open datasets)
- [ ] Add severity scoring and clinical recommendation text
- [ ] Wire interaction checks into e-prescription creation flow (automatic check before saving)
- [ ] Surface interaction warnings in the frontend prescription UI

### 4.2 Symptom Checker :large_orange_diamond:
**Current state:** `analyze_symptom_combination` has a multi-symptom scoring engine with ICD-10 codes. `generate_symptom_questions` covers 10+ symptom categories. Functional but limited.

**What's needed:**
- [ ] Expand symptom-condition mappings (currently covers common conditions only)
- [ ] Add red-flag symptom detection (chest pain + shortness of breath → emergency triage)
- [ ] Wire patient app Symptom Checker page to these endpoints
- [ ] Add disclaimer/liability text for patient-facing symptom results

### 4.3 CDS Rules Engine :large_orange_diamond:
**Current state:** `evaluate_cds_rules()` has 15+ clinical rules (sepsis/qSOFA, shock, hypertensive crisis, stroke, AKI, hyperkalemia, etc.). Wired into `record_vital_signs` handler. CDS alerts push via SSE.

**What's needed:**
- [ ] Wire CDS evaluation into MORE handlers (not just vital signs) — lab results, medication administration, nursing assessments
- [x] Add configurable rule thresholds per facility — `CdsThresholds` (Default = engine cut-offs) loaded per facility from the `cds_threshold_configs` JSON-record domain; admin `GET/PUT /api/admin/cds/thresholds/{facility_id}` (Phase 4.3)
- [x] Implement alert fatigue reduction (suppression of repeated low-severity alerts)
- [x] Add CDS audit trail (which rules fired, what action was taken) — every fired/suppressed alert recorded in `cds_audit_entries` (rule id, severity, outcome, facility, threshold snapshot); admin `GET /api/admin/cds/audit` (Phase 4.3)

---

## Phase 5: Medium — Telehealth & Communication

**Priority:** MEDIUM
**Impact:** Telehealth is state-management-only, no actual video/audio

### 5.1 Telehealth WebRTC/Video :white_check_mark:
**File:** `api/src/telehealth.rs`

**Current state:** Full Jitsi integration. `TelehealthProvider` trait with JWT
(`join_credentials`), `configure_room`, and `validate_token`. Real WebRTC video
via `JitsiMeetExternalAPI` (in-browser) in **both** the doctor portal and
patient app. Self-hosted stack (`docker-compose.jitsi.yml`,
`docs/jitsi-deployment.md`), health probe, recording w/ consent + audit,
pluggable transcription (`api/src/services/transcription.rs`), SSE event relay +
in-call live status, and in-app mobile join (QR + 302 redirect, **no native
app**). Docs: `mobile-setup.md`, `e2ee-policy.md`, `security-checklist.md`,
`monitoring.md`.

**What's needed:**
- [x] Real video provider (Jitsi) with JWT auth + role→moderator mapping
- [x] Real join URLs / IFrame-API that open working video calls (both apps)
- [x] Persist telehealth session notes/lifecycle to the repository (Round 5)
- [x] Frontend: embed video component in Telehealth pages (doctor + patient)
- [x] Mobile (in-app web only — QR/redirect, no downloads), recording+consent,
      transcription stub, SSE consumer, self-host stack, Phase-8 docs/tests
- [ ] Optional future: real STT provider wiring (google/aws/azure) behind a BAA

### 5.2 FCM Push Notifications :red_circle:
**File:** `api/src/main.rs`

**Current state:** `FCM_SERVER_KEY` env var is documented but never used. Notifications only work via SSE (which frontend doesn't even consume yet).

**What's needed:**
- [ ] Add FCM HTTP v1 API client (via `reqwest`)
- [ ] Add `device_tokens` table and registration endpoint
- [ ] Dispatch push notifications on: new lab results, appointment reminders, medication due, emergency alerts
- [ ] Test with Android/iOS (or web push via FCM)

### 5.3 SMS Notifications (Africa's Talking) :large_orange_diamond:
**Current state:** `check_and_send_medication_reminders()` background task exists, supports Africa's Talking SMS via `AT_API_KEY`. Runs every 60s as tokio background task.

**What's needed:**
- [ ] Verify SMS delivery end-to-end with real AT sandbox credentials (needs live AT creds)
- [x] Add SMS templates for different notification types — `SmsTemplate` enum (medication/appointment/lab/critical/OTP) **(Round 8)**
- [x] Add delivery status tracking and retry logic — `SmsDeliveryStatus` + `send_sms_with_retry` (bounded 3 attempts) **(Round 8)**
- [~] Implement opt-in/opt-out SMS preferences per patient — per-recipient opt-in gate + `SMS_GLOBAL_DISABLE` kill-switch + STOP-keyword detection + opt-out footer done; **persistent per-patient opt-out table is a follow-up** **(Round 8)**

---

## Phase 6: Medium — Security Hardening

**Priority:** MEDIUM
**Impact:** Demo-grade security needs production hardening

### 6.1 Production Secrets Management :large_orange_diamond:
**Current state:** Demo credentials hardcoded in docker-compose.yml (`medichain_dev_2024`), pgAdmin (`admin@medichain.com/admin`), and `.env.example` (`medichain-demo-secret-key-change-in-production-2024`).

**What's needed:**
- [x] Remove hardcoded credentials from docker-compose.yml — `.env` interpolation with dev-only defaults **(Round 8)**
- [ ] Add secrets rotation documentation
- [ ] Implement proper key management for `SESSION_SECRET`, `AT_API_KEY`, `FCM_SERVER_KEY`
- [x] Add startup validation that warns if default/demo secrets are used in production mode — `validate_production_secrets()` warns, and hard-aborts when `IS_DEMO=false` **(Round 8)**

### 6.2 TLS/HTTPS :red_circle:
**Current state:** All communication is HTTP. No TLS configuration anywhere.

**What's needed:**
- [ ] Add TLS termination (reverse proxy via Nginx/Caddy, or Actix-web native TLS)
- [ ] Generate/manage SSL certificates (Let's Encrypt for production)
- [ ] Enforce HTTPS redirects
- [ ] Add HSTS headers

### 6.3 Encryption Enforcement :large_orange_diamond:
**File:** `api/src/ipfs.rs`

**Current state:** ChaCha20-Poly1305 encryption exists (`upload_encrypted()`, `download_decrypted()`), but it's unclear if ALL document upload endpoints enforce encryption.

**What's needed:**
- [x] Audit all file upload endpoints — only `upload_encrypted` is public; `upload_raw` is private → no plaintext path; added a ciphertext≠plaintext guard + regression test **(Round 8)**
- [~] Add encryption-required policy at the API middleware layer — structurally enforced at the IPFS client layer; a dedicated middleware policy is still open **(Round 8)**
- [ ] Verify encryption key management (per-patient keys vs shared keys)
- [ ] Add key rotation support





---

## Phase 7: Medium — Testing

**Priority:** MEDIUM
**Impact:** Frontend has ~5% test coverage; backend is strong but has gaps

### 7.1 Frontend Test Suite :white_check_mark:
**Current state:** Unit tests for all stores, component tests for all major pages, and basic E2E setup.
**What's needed:**
- [x] Add Vitest unit tests for all Zustand stores (authStore, patientStore, themeStore)
- [x] Add component tests for critical UI: LoginPage, DashboardPage, PatientSearchPage, LabResultsPage
- [x] Add React Testing Library tests for form validation on clinical pages
- [x] Add Playwright or Cypress E2E tests for critical flows:
  - Login → Dashboard → Patient Search → View Patient → Create Clinical Record
- [x] Set up frontend test coverage reporting in CI

### 7.2 Backend Integration Test Gaps :white_check_mark:
**Current state:** Added PostgreSQL repository tests and API-level integration tests.
**What's needed:**
- [x] Add integration tests for PostgreSQL repository implementations (PgPatientRepository, PgMedicalRecordRepository, PgAllergyRepository)
- [x] Add API-level integration tests (spin up Actix test server, hit endpoints, verify responses)
- [x] Add tests for auth middleware (valid/invalid/expired tokens)
- [ ] Add load/stress tests for concurrent clinical endpoint access

---

## Phase 8: Low — Infrastructure & Deployment

**Priority:** LOW (not blocking functionality)

### 8.1 Docker Compose Completion :large_orange_diamond:
**What's needed:**
- [ ] Add Substrate node service to docker-compose.yml
- [ ] Add Nginx reverse proxy with TLS termination
- [ ] Add health check endpoints for all services
- [ ] Add volume management for data persistence
- [ ] Create `docker-compose.prod.yml` with production overrides

### 8.2 Monitoring & Observability :large_orange_diamond:
**Current state (Round 12):** Prometheus `/api/metrics` + request-timing middleware and optional structured JSON logging are in place. Dashboards/alerting remain ops follow-ups.
**What's needed:**
- [x] Add structured logging (tracing crate with JSON output) — `LOG_FORMAT=json` installs a `tracing` JSON subscriber bridging existing `log::` calls **(Round 12)**
- [x] Add Prometheus metrics endpoint (`/api/metrics`) — `middleware/metrics.rs` (`http_requests_total`, `http_request_duration_seconds`) via `MetricsMiddleware` **(Round 12)**
- [x] Add Grafana dashboard for API latency, error rates, active sessions — `docs/observability/grafana-dashboard.json` auto-provisioned via the `monitoring` compose profile (`docker-compose.prod.yml`)
- [ ] Add health check dashboard aggregating DB, IPFS, blockchain, and API status (raw probes exist: `/api/health`, `/health/ready`)
- [x] Set up alerting for critical events (DB connection loss, high error rate) — `docs/observability/prometheus-alerts.yml` loaded by the in-compose Prometheus (instance-down/5xx/latency/401-spike)

### 8.3 Mobile App :large_orange_diamond:
**File:** `mobile-examples/expo-starter/src/`

**Current state (Round 12):** Functional patient-app core added — JWT API client, secure-store + biometric auth context, and Login / EmergencyCard / MyRecords screens behind a tabbed root (`MediChainApp.tsx`). Uses only already-declared deps; the diagnostic `App.tsx` is preserved. **Delivered unverified** — the mobile project's `node_modules` are not installed in this environment, so `tsc` was not run; run `npm install && npm run typecheck` before use.

**What's needed:**
- [x] Implement React Native screens mirroring core patient-app functionality (login, emergency card, records) **(Round 12)**
- [x] Add biometric authentication (fingerprint/face) — `expo-local-authentication` gate **(Round 12)**
- [ ] Add NFC card scanning (`react-native-nfc-manager`)
- [ ] Add QR code scanning for patient identification (`expo-barcode-scanner`)
- [ ] Add offline-first architecture with sync (wire existing `services/offlineQueue.ts`)
- [ ] Verify build/typecheck (`npm install`) and reach full patient-app parity

### 8.4 Dead Code Cleanup :large_orange_diamond:
**Files:** Multiple files with `#[allow(dead_code)]`

**What's needed:**
- [ ] Audit `api/src/clinical.rs`, `clinical_endpoints.rs`, `models/user.rs`, `db/mod.rs`
- [ ] Wire unused structs/functions into active code paths, or delete them
- [ ] Remove `#[allow(dead_code)]` attributes after resolution

---

## Progress Tracking

| # | Feature | Status | Priority |
|---|---------|--------|----------|
| 1.1 | Blockchain real extrinsic submission | :white_check_mark: Fully Implemented | CRITICAL |
| 1.2 | Substrate node implementation | :white_check_mark: Fully Implemented | CRITICAL |
| 1.3 | Frontend wallet integration | :white_check_mark: Fully Implemented | CRITICAL |
| 2.1 | Clinical endpoints → PostgreSQL | :large_orange_diamond: Partial | CRITICAL |
| 2.2 | 43 repository trait methods | :white_check_mark: Fully Implemented | CRITICAL |
| 3.1 | Clinical form pages API integration | :large_orange_diamond: Partial | HIGH |
| 3.2 | Patient app completeness | :large_orange_diamond: Partial | HIGH |
| 3.3 | SSE real-time events in frontend | :red_circle: Not Started | HIGH |
| 3.4 | Offline support integration | :red_circle: Not Started | HIGH |
| 3.5 | Internationalization (i18n) | :large_orange_diamond: Provider/switcher + 4 locales; patient Login fully extracted as reference (Round 14); remaining pages incremental | HIGH |
| 4.1 | Drug interaction engine | :large_orange_diamond: Partial | HIGH |
| 4.2 | Symptom checker expansion | :large_orange_diamond: Partial | HIGH |
| 4.3 | CDS rules engine expansion | :large_orange_diamond: Partial | HIGH |
| 5.1 | Telehealth WebRTC/video | :white_check_mark: Jitsi JWT + IFrame-API (doctor+patient) + self-host stack + recording/consent + transcription stub + SSE consumer + in-app mobile QR/redirect + Phase-8 docs/tests | MEDIUM |
| 5.2 | FCM push notifications | :red_circle: Not Started | MEDIUM |
| 5.3 | SMS notifications (Africa's Talking) | :large_orange_diamond: Partial | MEDIUM |
| 6.1 | Production secrets management | :large_orange_diamond: Partial | MEDIUM |
| 6.2 | TLS/HTTPS | :large_orange_diamond: Reverse-proxy TLS + HSTS headers (Round 13); native Actix TLS optional | MEDIUM |
| 6.3 | Encryption enforcement | :large_orange_diamond: Partial | MEDIUM |
| 7.1 | Frontend test suite | :white_check_mark: Fully Implemented | MEDIUM |
| 7.2 | Backend integration test gaps | :white_check_mark: Fully Implemented | MEDIUM |
| 8.1 | Docker compose completion | :large_orange_diamond: Partial | LOW |
| 8.2 | Monitoring & observability | :red_circle: Not Started | LOW |
| 8.3 | Mobile app | :red_circle: Not Started | LOW |
| 8.4 | Dead code cleanup | :large_orange_diamond: Partial | LOW |

---

## Phase 9: Medium — API Design Alignment (per SKILL: api-design)

**Priority:** MEDIUM
**Impact:** Current API violates several design principles defined in the project's own skill docs

### 9.1 API Versioning :red_circle:
**Current state:** All endpoints use `/api/` prefix with no version. The api-design skill mandates `/api/v1/` path versioning.

**What's needed:**
- [ ] Add `/v1/` to all API route registrations in `main.rs`
- [ ] Update all 130+ shared API client endpoint URLs in `client/shared/src/api/endpoints.ts`
- [ ] Keep old `/api/` routes as redirects during transition

### 9.2 Idempotency Keys for Chain-Coupled Writes :red_circle:
**Current state:** No idempotency key support. If a network drop occurs during a blockchain-coupled write (consent grant, record creation), retries could cause duplicates.

**What's needed:**
- [ ] Add `Idempotency-Key` header parsing middleware
- [ ] Add Redis or in-memory cache for idempotency key → response storage (24h TTL)
- [ ] Apply idempotency to all POST endpoints that trigger on-chain transactions
- [ ] Return cached response on duplicate key

### 9.3 Cursor-Based Pagination :red_circle:
**Current state:** No pagination on list endpoints. All endpoints return full result sets.

**What's needed:**
- [ ] Implement cursor-based pagination (base64-encoded `{created_at, id}`)
- [ ] Add `?limit=N&cursor=<opaque>` support to all list endpoints
- [ ] Return `next_cursor` in responses (null when no more)
- [ ] Update frontend to handle paginated responses with "load more" or infinite scroll

### 9.4 JWT Authentication (Upgrade from X-User-Id) :white_check_mark:
**Current state (Round 10 backend + Round 11 frontend):** Backend JWT is implemented additively (`api/src/security/jwt.rs`, HS256 access 1h + refresh 7d, `{sub, role, mfa, typ, iat, exp}`); `support::get_current_user_id` accepts a verified `Authorization: Bearer <jwt>` and falls back to `X-User-Id`. The shared `ApiClient` stores tokens, sends Bearer, and auto-refreshes on 401; both `authStore`s acquire/clear tokens across the login lifecycle.

**What's needed:**
- [x] Implement challenge-response flow: `POST /api/auth/challenge` (existing) → sign → `POST /api/auth/jwt` (verifies sr25519 signature, issues tokens) **(Round 10)**
- [x] Issue JWT tokens with expiration — access 1h, refresh 7d **(Round 10)**
- [x] Accept `Authorization: Bearer <jwt>` on all endpoints — additive change to `get_current_user_id` (legacy `X-User-Id` retained for demo/back-compat) **(Round 10)**
- [x] Add JWT refresh/rotation logic — `POST /api/auth/jwt/refresh` **(Round 10)**
- [x] Update frontend API client to use Bearer tokens — `ApiClient.setTokens`/`clearTokens`, `Authorization: Bearer`, auto-refresh on 401; wired into both `authStore`s + typed `endpoints.ts` wrappers **(Round 11)**

### 9.5 Consistent Error Envelope :large_orange_diamond:
**Current state:** Error responses exist but may not follow a consistent shape across all endpoints.

**What's needed:**
- [x] Audit all error responses — canonical `error_envelope_json` helper (`{error:{code,message,details}}`) is the single source of truth; **both** error structs (`ErrorResponse`, ~734 sites, and `ApiError`, incl. the `safe_read!`/`safe_write!` paths) have hand-written `Serialize` impls that emit the envelope, so every generic error response is canonical without per-site edits. FHIR endpoints intentionally return `OperationOutcome` (the shared client's `parseErrorBody` handles both). **(Phase 9.5 complete)**
- [x] Define stable machine-readable error codes — the `error_codes` module is the single source of truth **(Round 8)**
- [x] Add `Retry-After` header on 429 rate limit responses **(Round 8)**

---

## Phase 10: Medium — Architecture & Refactoring (per SKILL: refactoring)

**Priority:** MEDIUM
**Impact:** `clinical_endpoints.rs` is 16K lines — the skill docs flag anything over 300 lines as needing splitting

### 10.1 Split clinical_endpoints.rs :large_orange_diamond:
**Current state (Round 9):** The 21,446-line monolith is now a **directory module** — `clinical_endpoints/mod.rs` (48 lines: shared imports + submodule wiring) plus **13 domain submodules** (565–3,833 lines each), glob-re-exported so route registrations in `main.rs` are unchanged. Build green, 111/111 non-DB tests pass, dir is rustfmt-clean. The 300-line file target and 40-line function limit are not yet met.

**What's needed:**
- [x] Split into domain-specific handler modules — done as 13 contiguous-domain submodules (`emergency`, `assessment`, `lab`, `physician`, `workflow`, `medical_id`, `surgical`, `fhir`, `insurance_pharmacy`, `engagement`, `clinical_support`, `billing`, `platform`). Names follow the file's existing phase grouping rather than the exact list below, but cover the same surface. **(Round 9)**
- [ ] Further-split the still-large submodules to approach the 300-line target (`engagement` ~3.8K, `workflow` ~2.6K, `surgical` ~2.2K, `platform` ~2.0K, `emergency` ~2.0K)
- [ ] Extract shared validation into a `validators.rs` module
- [ ] Keep each handler function under 40 lines (extract helpers as needed)

### 10.2 Split main.rs :large_orange_diamond:
**Current state:** `main.rs` is 302KB+ — contains route registration, app state, and likely handler code.

**What's needed:**
- [ ] Extract route registration into `routes.rs`
- [ ] Extract app state into `state.rs`
- [ ] Keep `main.rs` to bootstrapping only (~50 lines)

---

## Phase 11: Medium — Security Hardening (per Security Deep Dive)

**Priority:** MEDIUM
**Impact:** 23 critical security areas identified in the project's own security audit

### 11.1 TOCTOU (Time-of-Check-to-Time-of-Use) Prevention :white_check_mark:
**Current state (Round 10):** `RepositoryContainer::record_access_atomic` performs the patient existence/active check and the access-log insert in a single PostgreSQL transaction with `SELECT … FOR UPDATE` row-locking (memory backend: check-then-act under the repo's own locking). Wired into the `emergency_access` handler so the check and the logged access can no longer drift apart under concurrent writers.

**What's needed:**
- [x] Use database transactions to combine check + action in a single operation — `record_access_atomic` (`api/src/repositories/mod.rs`) **(Round 10)**
- [x] Add row-level locking for concurrent access to patient records — `SELECT is_active … FOR UPDATE` **(Round 10)**
- [x] Apply the atomic pattern to the highest-risk flow (emergency access) **(Round 10)**
- [ ] Extend the pattern to other check-then-write clinical flows as they are hardened (follow-up)

### 11.2 Supply Chain Security :large_orange_diamond:
**Current state:** `cargo audit` runs in CI but no dependency pinning or SBOM generation.

**What's needed:**
- [ ] Pin all dependency versions (exact versions in `Cargo.toml`)
- [x] Add `cargo-deny` to CI for license compliance and advisory checks — `deny.toml` + `supply-chain` CI job **(Round 8)**
- [x] Generate SBOM (Software Bill of Materials) for compliance — CycloneDX via `cargo-cyclonedx`, uploaded as a CI artifact **(Round 8)**
- [ ] Add Snyk scanning (per `.github/instructions/snyk_rules.instructions.md`)

### 11.3 Zero Trust & MFA :red_circle:
**Current state:** Single-factor wallet auth. New HIPAA regulations (Jan 2025) mandate MFA for all ePHI access.

**Current state (Round 10):** TOTP MFA implemented (`api/src/security/mfa.rs`) — wallet signature is factor 1, RFC-6238 TOTP is factor 2.

**What's needed:**
- [x] Add multi-factor authentication (wallet signature + TOTP code) — enroll/verify/challenge/status/disable endpoints; `otpauth://` URI + QR for authenticator apps **(Round 10)**
- [x] Implement session timeout and re-authentication for sensitive operations — JWT access tokens expire in 1h; `enforce_mfa_step_up` requires a fresh `mfa=true` token (via `/api/auth/mfa/challenge`) for gated ops **(Round 10)**
- [x] Persist MFA enrollments to PostgreSQL — `user_mfa` table, TOTP secret encrypted at rest (ChaCha20-Poly1305), write-through + decrypt-on-startup loader **(Round 11)**
- [ ] Add annual penetration testing framework (per HIPAA 2025 requirements) — tracked in `docs/INCIDENT_RESPONSE.md`

### 11.4 Incident Response Plan :white_check_mark:
**Current state (Round 10):** Playbook + inline anomaly detection + admin tooling delivered.

**What's needed:**
- [x] Create incident response playbook (detection → containment → eradication → notification) — `docs/INCIDENT_RESPONSE.md` (POPIA 72h + HIPAA rules, roles, SEV runbook) **(Round 10)**
- [x] Add automated breach detection alerts — `api/src/security/breach.rs` failed-auth-burst + abnormal-access detectors → logged + SSE `security_alert` + `GET /api/admin/security/alerts` **(Round 10)**
- [x] Implement data breach notification trigger — `POST /api/admin/security/breach` records a critical alert and stamps the POPIA 72-hour `notify_deadline` **(Round 10)**
- [x] Persist security alerts to PostgreSQL — `security_alerts` table; written on detection/declaration, recent alerts reloaded at startup **(Round 11)**
- [x] Automated security-officer notification dispatch (SMS) — `notifications::dispatch_breach_notification` → `SECURITY_OFFICER_PHONE` via Africa's Talking on breach declaration **(Round 11)**
- [ ] Automated **regulator / data-subject** notification dispatch (email/postal) — no SMTP provider wired yet; follow-up

---

## Phase 12: Low — Performance & Quality (per SKILL: performance-optimization)

**Priority:** LOW
**Impact:** Performance not yet measured; skill docs define a 3-second NFC budget

### 12.1 Performance Budgets :large_orange_diamond:
**Current state (Round 12):** Budgets documented (`docs/PERFORMANCE_BUDGETS.md`), server latency histogram via `/api/metrics`, and a report-only Lighthouse CI job (`client/.lighthouserc.json`). Profiling/RUM remain manual.
**What's needed:**
- [x] Define the 3-second NFC tap-to-display budget — documented + server p95 measurable via `/api/metrics` **(Round 12)**
- [x] Add Lighthouse CI checks to frontend CI pipeline (LCP < 2.5s, TTI < 3.5s) — `.lighthouserc.json` + `lighthouse` CI job **(Round 12)**
- [ ] Profile backend with `cargo flamegraph` — identify hot paths
- [ ] Add `tokio-console` integration for async task debugging
- [x] Frontend bundle analysis — `ANALYZE=1 npm run build` (`rollup-plugin-visualizer`); both apps measured under budget (doctor ~104 KB, patient ~89 KB gzip initial JS)
- [x] Code-split doctor portal and patient app properly — route-level `React.lazy` (both apps) + `manualChunks` vendor splitting + lazy `@polkadot` wallet libs; separate builds, no cross-shipping

### 12.2 Property/Fuzz Testing :large_orange_diamond:
**Current state (Round 12):** `proptest` added with 12 properties in `api/src/property_tests.rs` (all pass). Fuzz targets remain.
**What's needed (per SKILL: testing-strategy):**
- [x] Add `proptest` to `api/Cargo.toml` **(Round 12)**
- [x] Write property tests for consent duration arithmetic (overflow prevention) — `checked_consent_expiry` **(Round 12)**
- [x] Write property tests for blood type compatibility matrix — `blood_type_compatible` (universal donor/recipient, Rh rules, reflexivity) **(Round 12)**
- [x] Write property tests for NFC card hash generation — `card_hash` (determinism, 64-hex, separator-collision resistance) **(Round 12)**
- [ ] Add fuzz targets for input validation functions (`cargo-fuzz`/libfuzzer)

### 12.3 Pre-Commit Hooks :white_check_mark:
**Current state (Round 12):** `.pre-commit-config.yaml` added, mirroring the CI gates.

**What's needed:**
- [x] Add `.pre-commit-config.yaml` with cargo fmt, cargo clippy, and frontend typecheck (+ hygiene hooks, private-key detection) **(Round 12)**

---

## Phase 13: Low — Feature Audit Items (per FEATURE_COMPLETENESS_AUDIT.md)

**Priority:** LOW
**Impact:** Known minor gaps from prior audit

### 13.1 TypeScript Type Safety :large_orange_diamond:
**Current state:** 27 instances of `@ts-ignore` and `as any` across frontend pages.

**What's needed:**
- [ ] Fix `@ts-ignore` in FamilyGroupPage.tsx, TelehealthPage.tsx, MedicationRemindersPage.tsx
- [ ] Replace `as any` casts with proper TypeScript interfaces
- [ ] Ensure all API response types in `endpoints.ts` return typed results (not `unknown`)

### 13.2 Demo Data Fallback Cleanup :large_orange_diamond:
**Current state:** InsurancePage, LabTrendsPage, WearablesPage, MARPage fall back to demo data when API returns empty.

**What's needed:**
- [ ] Guard demo fallbacks behind `IS_DEMO` environment flag
- [ ] Show "no data" empty states instead of demo data in production mode
- [ ] Remove `loadDemoCards()`, `loadDemoClaims()`, `loadDemoData()`, `loadDemoDevices()` from production builds

### 13.3 PDF Export & Print :large_orange_diamond:
**Current state (Round 12):** `printpdf`-backed `pdf.rs` + a generic `POST /api/pdf/document` endpoint (titled, sectioned, paginated A4 → `application/pdf`) that powers any "Export as PDF" — the frontend posts the formatted content. Print CSS + page buttons remain.

**What's needed:**
- [x] Add PDF generation endpoint(s) for lab results, prescriptions, visit summaries, discharge instructions — one generic sectioned-document endpoint covers all **(Round 12)**
- [x] Use a Rust PDF library — `printpdf` **(Round 12)**
- [ ] Add print-friendly CSS stylesheets for formatted browser printing
- [ ] Add "Export as PDF"/"Print" buttons to relevant pages (call `POST /api/pdf/document`)

### 13.4 Insurance Cards CRUD :white_check_mark:
**Current state (Round 12):** Full CRUD on the `insurance_cards` JSON-record domain (memory + PostgreSQL) + typed shared-client wrappers. Image upload remains.

**What's needed:**
- [x] Add `GET /api/insurance/cards/{patient_id}` endpoint **(Round 12)**
- [x] Add `POST /api/insurance/cards` endpoint **(Round 12)**
- [x] Add `PUT /api/insurance/cards/{id}` endpoint **(Round 12)**
- [x] Add `DELETE /api/insurance/cards/{id}` endpoint (added `delete` to `JsonRecordRepository`) **(Round 12)**
- [x] Shared client wrappers (`getInsuranceCards`/`createInsuranceCard`/`updateInsuranceCard`/`deleteInsuranceCard`) **(Round 12)**
- [ ] Add insurance card image upload support (IPFS-backed)

---

## Updated Progress Tracking

| # | Feature | Status | Priority |
|---|---------|--------|----------|
| 1.1 | Blockchain real extrinsic submission | :white_check_mark: Fully Implemented | CRITICAL |
| 1.2 | Substrate node implementation | :white_check_mark: Fully Implemented | CRITICAL |
| 1.3 | Frontend wallet integration | :white_check_mark: Fully Implemented | CRITICAL |
| 2.1 | Clinical endpoints → PostgreSQL | :large_orange_diamond: Partial | CRITICAL |
| 2.2 | 43 repository trait methods | :white_check_mark: Fully Implemented | CRITICAL |
| 3.1 | Clinical form pages API integration | :large_orange_diamond: Partial | HIGH |
| 3.2 | Patient app completeness | :large_orange_diamond: Partial | HIGH |
| 3.3 | SSE real-time events in frontend | :red_circle: Not Started | HIGH |
| 3.4 | Offline support integration | :red_circle: Not Started | HIGH |
| 3.5 | Internationalization (i18n) | :large_orange_diamond: Provider/switcher + 4 locales; patient Login fully extracted as reference (Round 14); remaining pages incremental | HIGH |
| 4.1 | Drug interaction engine | :large_orange_diamond: Partial | HIGH |
| 4.2 | Symptom checker expansion | :large_orange_diamond: Partial | HIGH |
| 4.3 | CDS rules engine expansion | :large_orange_diamond: Partial | HIGH |
| 5.1 | Telehealth WebRTC/video | :white_check_mark: Jitsi JWT + IFrame-API (doctor+patient) + self-host stack + recording/consent + transcription stub + SSE consumer + in-app mobile QR/redirect + Phase-8 docs/tests | MEDIUM |
| 5.2 | FCM push notifications | :red_circle: Not Started | MEDIUM |
| 5.3 | SMS notifications (Africa's Talking) | :large_orange_diamond: Partial | MEDIUM |
| 6.1 | Production secrets management | :large_orange_diamond: Partial | MEDIUM |
| 6.2 | TLS/HTTPS | :large_orange_diamond: Reverse-proxy TLS + HSTS headers (Round 13); native Actix TLS optional | MEDIUM |
| 6.3 | Encryption enforcement | :large_orange_diamond: Partial | MEDIUM |
| 7.1 | Frontend test suite | :white_check_mark: Fully Implemented | MEDIUM |
| 7.2 | Backend integration test gaps | :white_check_mark: Fully Implemented | MEDIUM |
| 8.1 | Docker compose completion | :large_orange_diamond: Partial | LOW |
| 8.2 | Monitoring & observability | :large_orange_diamond: /metrics + JSON logging (Round 12); Grafana/alerting pending | LOW |
| 8.3 | Mobile app | :large_orange_diamond: Functional core (Round 12, unverified); NFC/QR pending | LOW |
| 8.4 | Dead code cleanup | :large_orange_diamond: Partial | LOW |
| 9.1 | API versioning (/v1/) | :white_check_mark: Implemented (Round 13, rewrite middleware) | MEDIUM |
| 9.2 | Idempotency keys | :white_check_mark: Implemented (Round 13) | MEDIUM |
| 9.3 | Cursor-based pagination | :large_orange_diamond: Util + first endpoint (Round 13); broader adoption pending | MEDIUM |
| 9.4 | JWT auth (upgrade from X-User-Id) | :white_check_mark: Implemented (Round 10 backend + Round 11 frontend) | MEDIUM |
| 9.5 | Consistent error envelope | :white_check_mark: Canonical envelope via centralized `ErrorResponse`/`ApiError` Serialize | MEDIUM |
| 10.1 | Split clinical_endpoints.rs | :large_orange_diamond: Partial | MEDIUM |
| 10.2 | Split main.rs | :large_orange_diamond: Partial | MEDIUM |
| 11.1 | TOCTOU prevention | :white_check_mark: Implemented (Round 10) | MEDIUM |
| 11.2 | Supply chain security (cargo-deny, SBOM) | :large_orange_diamond: Partial | MEDIUM |
| 11.3 | Zero Trust & MFA (HIPAA 2025) | :white_check_mark: Implemented (Round 10 + DB-persist Round 11) | MEDIUM |
| 11.4 | Incident response plan | :white_check_mark: Implemented (Round 10) | MEDIUM |
| 12.1 | Performance budgets | :large_orange_diamond: Budgets + /metrics histogram + Lighthouse CI (Round 12); RUM/flamegraph pending | LOW |
| 12.2 | Property/fuzz testing | :large_orange_diamond: 12 proptest properties (Round 12); fuzz targets pending | LOW |
| 12.3 | Pre-commit hooks | :white_check_mark: Implemented (Round 12) | LOW |
| 13.1 | TypeScript type safety | :white_check_mark: Production source clean (Round 13 audit); remaining `as any` are test mocks | LOW |
| 13.2 | Demo data fallback cleanup | :large_orange_diamond: Partial | LOW |
| 13.3 | PDF export & print | :white_check_mark: Endpoint + lib + shared download helper + print CSS present (Round 12/13); per-page buttons trivial via `exportDocumentToPdf` | LOW |
| 13.4 | Insurance cards CRUD | :white_check_mark: CRUD + shared client (Round 12); image upload pending | LOW |

---

## What IS Working Well

These features are fully implemented and production-quality:

- **Authentication system** — Wallet-based auth with RBAC enforcement, demo mode, session management
- **Database schema** — 70+ tables across 9 migrations with proper indexes, constraints, and encrypted columns
- **IPFS integration** — Real upload/download with ChaCha20-Poly1305 encryption, pinning, health checks
- **SSE real-time backend** — Working broadcast system with CDS alerts and medication reminders
- **Substrate pallets** — All 3 pallets (access-control, patient-identity, medical-records) fully implemented with tests
- **Crypto module** — ChaCha20-Poly1305 AEAD, Argon2id KDF, zeroization, constant-time operations
- **National ID verification** — Real HTTP verifier trait with fallback stub, 5 African ID systems supported
- **NFC simulation** — Full card lifecycle with SHA3-256 verification and QR generation
- **CI/CD pipeline** — 3-job GitHub Actions (Rust, Client, WASM) with security audit
- **API client** — 130+ typed endpoint functions with retry logic, error handling, auth headers
- **Core frontend pages** — Dashboard, PatientSearch, LabResults, Login fully integrated
- **Documentation** — Comprehensive README, setup guides, API docs, architecture docs