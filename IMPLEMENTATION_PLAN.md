# MediChain Implementation Plan

> **Last audited:** 2026-04-18
> **Method:** Full codebase investigation across all layers (backend, frontend, blockchain, database, DevOps)

## Executive Summary

MediChain is approximately **60-65% production-ready**. The core architecture is sound — 70+ database tables, 130+ API endpoint definitions, 76 doctor portal pages, 3 Substrate pallets, and ChaCha20-Poly1305 encryption. However, critical gaps remain: blockchain extrinsics are placeholder-only, clinical endpoints persist to memory not PostgreSQL, the frontend doesn't consume SSE events, and there are no frontend tests.

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
**File:** `api/src/clinical_endpoints.rs` (~16K lines, ~478 handlers)

**Current state:** All clinical handlers (Code Blue, Trauma, Stroke, Cardiac, Sepsis, SOAP notes, vitals, etc.) store data in `AppState` RwLock-protected HashMaps. PostgreSQL repository implementations exist in `api/src/repositories/postgres/` but the clinical endpoint handlers don't use them — they directly read/write the in-memory HashMaps on `AppState`.

**What's needed:**
- [ ] Refactor all clinical endpoint handlers to use `data.repositories.*` instead of direct HashMap access
- [ ] Ensure `MEDICHAIN_STORAGE=postgres` activates PostgreSQL for ALL endpoints, not just the repository-based ones
- [ ] Add database transaction support for multi-step operations (e.g., creating a record + logging access)
- [ ] Verify all 70+ DB tables have matching repository CRUD operations
- [ ] Add connection pool health monitoring and graceful degradation

### 2.2 Unimplemented Repository Trait Methods :large_orange_diamond:
**File:** `api/src/repositories/traits.rs`

**Current state:** 41 trait methods return `RepositoryError::NotImplemented` as their default. These need real implementations in both `memory/` and `postgres/` backends.

**What's needed (by repository):**

**InsuranceRecordRepository:**
- [ ] `deactivate()` — mark insurance record inactive
- [ ] `get_expiring()` — find records nearing expiration
- [ ] `get_primary()` — return patient's primary insurance
- [ ] `get_active()` — list active insurance records
- [ ] `verify_eligibility()` — run eligibility rules engine
- [ ] `set_primary()` — designate primary insurance
- [ ] `terminate()` — end an insurance record

**BillingCodeRepository:**
- [ ] `get_active()`, `deactivate()`, `list_by_type()`

**CdsAlertRepository:**
- [ ] `get_by_encounter()`, `get_unacknowledged()`, `dismiss()`, `get_by_rule()`, `get_high_severity()`

**DeathRecordRepository:**
- [ ] `certify()`, `get_pending_certification()`, `get_medical_examiner_cases()`, `get_pending_autopsies()`

**OrganDonationRecordRepository:**
- [ ] `get_pending_recovery()`, `get_by_opo()`

**SyncOperationRepository:**
- [ ] `update_progress()`, `complete()`, `fail()`, `get_pending_retries()`, `get_in_progress()`

**SyncConflictRepository:**
- [ ] `get_auto_resolvable()`

**ExternalIdMappingRepository:**
- [ ] `update_sync_time()`, `delete()`, `deactivate()`, `get_by_system()`

---

## Phase 3: High — Frontend Completeness

**Priority:** HIGH
**Impact:** Many pages are form shells without real API integration

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

### 3.3 Real-Time Events (SSE) in Frontend :red_circle:
**Files:** `client/doctor-portal/`, `client/patient-app/`

**Current state:** Backend has a fully working SSE system (`GET /api/events` with `WsSessionManager`). The shared client has a `websocket.ts` utility. But NO frontend page actually connects to SSE or displays real-time notifications.

**What's needed:**
- [ ] Create a React hook (`useSSE` or `useRealTimeEvents`) that connects to `/api/events`
- [ ] Wire into doctor portal: show real-time CDS alerts, lab result notifications, Code Blue alerts
- [ ] Wire into patient app: show appointment reminders, medication reminders, lab results ready
- [ ] Add a notification bell/toast system for incoming events
- [ ] Handle SSE reconnection on connection drop

### 3.4 Offline Support :red_circle:
**Files:** `client/shared/src/` (IndexedDB utils, OfflineQueue)

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
- [ ] Add configurable rule thresholds per facility
- [ ] Implement alert fatigue reduction (suppression of repeated low-severity alerts)
- [ ] Add CDS audit trail (which rules fired, what action was taken)

---

## Phase 5: Medium — Telehealth & Communication

**Priority:** MEDIUM
**Impact:** Telehealth is state-management-only, no actual video/audio

### 5.1 Telehealth WebRTC/Video :large_orange_diamond:
**File:** `api/src/telehealth.rs`

**Current state:** `TelehealthProvider` trait exists. `InternalProvider` generates HMAC-signed join URLs. `DailyProvider` and `TwilioProvider` are stubs. No actual WebRTC signaling, STUN/TURN, or media handling.

**What's needed:**
- [ ] Choose provider self-hosted (mediasoup/ion-sfu)
- [ ] Implement chosen provider's SDK integration (API key management, room creation, token generation)
- [ ] Add real join URLs that open working video calls
- [ ] Persist telehealth session notes to database
- [ ] Frontend: embed video call iframe/component in Telehealth pages

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
- [ ] Verify SMS delivery end-to-end with real AT sandbox credentials
- [ ] Add SMS templates for different notification types (not just medication reminders)
- [ ] Add delivery status tracking and retry logic
- [ ] Implement opt-in/opt-out SMS preferences per patient

---

## Phase 6: Medium — Security Hardening

**Priority:** MEDIUM
**Impact:** Demo-grade security needs production hardening

### 6.1 Production Secrets Management :large_orange_diamond:
**Current state:** Demo credentials hardcoded in docker-compose.yml (`medichain_dev_2024`), pgAdmin (`admin@medichain.com/admin`), and `.env.example` (`medichain-demo-secret-key-change-in-production-2024`).

**What's needed:**
- [ ] Remove hardcoded credentials from docker-compose.yml (use `.env` file or Docker secrets)
- [ ] Add secrets rotation documentation
- [ ] Implement proper key management for `SESSION_SECRET`, `AT_API_KEY`, `FCM_SERVER_KEY`
- [ ] Add startup validation that warns if default/demo secrets are used in production mode

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
- [ ] Audit all file upload endpoints — ensure encryption is mandatory, not optional
- [ ] Add encryption-required policy at the API middleware layer
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

### 8.2 Monitoring & Observability :red_circle:
**What's needed:**
- [ ] Add structured logging (tracing crate with JSON output)
- [ ] Add Prometheus metrics endpoint (`/metrics`)
- [ ] Add Grafana dashboard for API latency, error rates, active sessions
- [ ] Add health check dashboard aggregating DB, IPFS, blockchain, and API status
- [ ] Set up alerting for critical events (DB connection loss, high error rate)

### 8.3 Mobile App :red_circle:
**File:** `mobile-examples/`

**Current state:** Expo starter with documentation only. No actual React Native screens, components, or navigation. Only a diagnostic connectivity checker.

**What's needed:**
- [ ] Implement React Native screens mirroring patient-app functionality
- [ ] Add NFC card scanning (react-native-nfc-manager)
- [ ] Add QR code scanning for patient identification
- [ ] Add biometric authentication (fingerprint/face)
- [ ] Add offline-first architecture with sync

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
| 1.1 | Blockchain real extrinsic submission | :red_circle: Not Started | CRITICAL |
| 1.2 | Substrate node implementation | :red_circle: Not Started | CRITICAL |
| 1.3 | Frontend wallet integration | :red_circle: Not Started | CRITICAL |
| 2.1 | Clinical endpoints → PostgreSQL | :large_orange_diamond: Partial | CRITICAL |
| 2.2 | 41 repository trait methods | :red_circle: Not Started | CRITICAL |
| 3.1 | Clinical form pages API integration | :large_orange_diamond: Partial | HIGH |
| 3.2 | Patient app completeness | :large_orange_diamond: Partial | HIGH |
| 3.3 | SSE real-time events in frontend | :red_circle: Not Started | HIGH |
| 3.4 | Offline support integration | :red_circle: Not Started | HIGH |
| 3.5 | Internationalization (i18n) | :red_circle: Not Started | HIGH |
| 4.1 | Drug interaction engine | :large_orange_diamond: Partial | HIGH |
| 4.2 | Symptom checker expansion | :large_orange_diamond: Partial | HIGH |
| 4.3 | CDS rules engine expansion | :large_orange_diamond: Partial | HIGH |
| 5.1 | Telehealth WebRTC/video | :large_orange_diamond: Partial | MEDIUM |
| 5.2 | FCM push notifications | :red_circle: Not Started | MEDIUM |
| 5.3 | SMS notifications (Africa's Talking) | :large_orange_diamond: Partial | MEDIUM |
| 6.1 | Production secrets management | :large_orange_diamond: Partial | MEDIUM |
| 6.2 | TLS/HTTPS | :red_circle: Not Started | MEDIUM |
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

### 9.4 JWT Authentication (Upgrade from X-User-Id) :large_orange_diamond:
**Current state:** Auth uses `X-User-Id` header with raw wallet address. The api-design skill specifies JWT tokens issued after wallet signature challenge.

**What's needed:**
- [ ] Implement full challenge-response flow: `GET /api/v1/auth/challenge?wallet=<pubkey>` → sign → `POST /api/v1/auth/verify`
- [ ] Issue JWT tokens with expiration
- [ ] Switch all endpoints from `X-User-Id` to `Authorization: Bearer <jwt>`
- [ ] Add JWT refresh/rotation logic
- [ ] Update frontend API client to use Bearer tokens

### 9.5 Consistent Error Envelope :large_orange_diamond:
**Current state:** Error responses exist but may not follow a consistent shape across all endpoints.

**What's needed:**
- [ ] Audit all error responses — ensure uniform `{ error: { code, message, details } }` shape
- [ ] Define stable machine-readable error codes (never change once shipped)
- [ ] Add `Retry-After` header on 429 rate limit responses

---

## Phase 10: Medium — Architecture & Refactoring (per SKILL: refactoring)

**Priority:** MEDIUM
**Impact:** `clinical_endpoints.rs` is 16K lines — the skill docs flag anything over 300 lines as needing splitting

### 10.1 Split clinical_endpoints.rs :large_orange_diamond:
**Current state:** Single 16K-line file with ~478 handlers. Violates the refactoring skill's 300-line file limit and 40-line function limit.

**What's needed:**
- [ ] Split into domain-specific handler modules:
  - `handlers/emergency.rs` — Code Blue, Trauma, Stroke, Cardiac, Sepsis, MCI
  - `handlers/lab.rs` — Lab submissions, panels, QC, critical values, trends
  - `handlers/surgical.rs` — Pre-op, operative notes, post-op, anesthesia
  - `handlers/pharmacy.rs` — E-prescriptions, drug interactions, reminders
  - `handlers/specialty.rs` — Burn, Psych, Toxicology, Pediatrics, Obstetrics
  - `handlers/admin.rs` — Appointments, discharge, shift handoffs, incidents
  - `handlers/wearables.rs` — Wearables, telehealth, remote monitoring
  - `handlers/patient.rs` — Patient registration, consent, family groups
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

### 11.1 TOCTOU (Time-of-Check-to-Time-of-Use) Prevention :red_circle:
**Current state:** Permission checks and resource access may not be atomic in clinical endpoints.

**What's needed:**
- [ ] Audit all endpoints for TOCTOU vulnerabilities — ensure permission checks and data access are atomic
- [ ] Use database transactions to combine check + action in a single operation
- [ ] Add row-level locking for concurrent access to patient records

### 11.2 Supply Chain Security :large_orange_diamond:
**Current state:** `cargo audit` runs in CI but no dependency pinning or SBOM generation.

**What's needed:**
- [ ] Pin all dependency versions (exact versions in `Cargo.toml`)
- [ ] Add `cargo-deny` to CI for license compliance and advisory checks
- [ ] Generate SBOM (Software Bill of Materials) for compliance
- [ ] Add Snyk scanning (per `.github/instructions/snyk_rules.instructions.md`)

### 11.3 Zero Trust & MFA :red_circle:
**Current state:** Single-factor wallet auth. New HIPAA regulations (Jan 2025) mandate MFA for all ePHI access.

**What's needed:**
- [ ] Add multi-factor authentication (wallet signature + TOTP/SMS code)
- [ ] Implement session timeout and re-authentication for sensitive operations
- [ ] Add annual penetration testing framework (per HIPAA 2025 requirements)

### 11.4 Incident Response Plan :red_circle:
**What's needed:**
- [ ] Create incident response playbook (breach detection → containment → notification)
- [ ] Add automated breach detection alerts
- [ ] Implement data breach notification system (POPIA requires 72-hour notification)

---

## Phase 12: Low — Performance & Quality (per SKILL: performance-optimization)

**Priority:** LOW
**Impact:** Performance not yet measured; skill docs define a 3-second NFC budget

### 12.1 Performance Budgets :red_circle:
**What's needed:**
- [ ] Define and measure the 3-second NFC tap-to-display budget
- [ ] Add Lighthouse CI checks to frontend CI pipeline (LCP < 2.5s, TTI < 3.5s)
- [ ] Profile backend with `cargo flamegraph` — identify hot paths
- [ ] Add `tokio-console` integration for async task debugging
- [ ] Frontend bundle analysis — target < 200KB initial JS gzipped
- [ ] Code-split doctor portal and patient app properly (they shouldn't ship each other's code)

### 12.2 Property/Fuzz Testing :red_circle:
**What's needed (per SKILL: testing-strategy):**
- [ ] Add `proptest` to `api/Cargo.toml`
- [ ] Write property tests for consent duration arithmetic (overflow prevention)
- [ ] Write property tests for blood type compatibility matrix
- [ ] Write property tests for NFC card hash generation
- [ ] Add fuzz targets for input validation functions

### 12.3 Pre-Commit Hooks :red_circle:
**Current state:** No pre-commit hooks configured.

**What's needed:**
- [ ] Add `.pre-commit-config.yaml` with cargo fmt, cargo clippy, and frontend typecheck
- [ ] Or configure Husky for the JS side

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

### 13.3 PDF Export & Print :red_circle:
**Current state:** No export endpoints. Browser print only (Ctrl+P) with no formatted views.

**What's needed:**
- [ ] Add PDF generation endpoints for: lab results, prescriptions, visit summaries, discharge instructions
- [ ] Use a Rust PDF library (e.g., `printpdf` or `genpdf`)
- [ ] Add print-friendly CSS stylesheets for formatted browser printing
- [ ] Add "Export as PDF" and "Print" buttons to relevant pages

### 13.4 Insurance Cards CRUD :red_circle:
**Current state:** Frontend InsurancePage expects `GET/POST /api/insurance/cards` but these endpoints don't exist.

**What's needed:**
- [ ] Add `GET /api/insurance/cards/{patient_id}` endpoint
- [ ] Add `POST /api/insurance/cards` endpoint
- [ ] Add `PUT /api/insurance/cards/{id}` endpoint
- [ ] Add `DELETE /api/insurance/cards/{id}` endpoint
- [ ] Add insurance card image upload support

---

## Updated Progress Tracking

| # | Feature | Status | Priority |
|---|---------|--------|----------|
| 1.1 | Blockchain real extrinsic submission | :red_circle: Not Started | CRITICAL |
| 1.2 | Substrate node implementation | :red_circle: Not Started | CRITICAL |
| 1.3 | Frontend wallet integration | :red_circle: Not Started | CRITICAL |
| 2.1 | Clinical endpoints → PostgreSQL | :large_orange_diamond: Partial | CRITICAL |
| 2.2 | 41 repository trait methods | :red_circle: Not Started | CRITICAL |
| 3.1 | Clinical form pages API integration | :large_orange_diamond: Partial | HIGH |
| 3.2 | Patient app completeness | :large_orange_diamond: Partial | HIGH |
| 3.3 | SSE real-time events in frontend | :red_circle: Not Started | HIGH |
| 3.4 | Offline support integration | :red_circle: Not Started | HIGH |
| 3.5 | Internationalization (i18n) | :red_circle: Not Started | HIGH |
| 4.1 | Drug interaction engine | :large_orange_diamond: Partial | HIGH |
| 4.2 | Symptom checker expansion | :large_orange_diamond: Partial | HIGH |
| 4.3 | CDS rules engine expansion | :large_orange_diamond: Partial | HIGH |
| 5.1 | Telehealth WebRTC/video | :large_orange_diamond: Partial | MEDIUM |
| 5.2 | FCM push notifications | :red_circle: Not Started | MEDIUM |
| 5.3 | SMS notifications (Africa's Talking) | :large_orange_diamond: Partial | MEDIUM |
| 6.1 | Production secrets management | :large_orange_diamond: Partial | MEDIUM |
| 6.2 | TLS/HTTPS | :red_circle: Not Started | MEDIUM |
| 6.3 | Encryption enforcement | :large_orange_diamond: Partial | MEDIUM |
| 7.1 | Frontend test suite | :white_check_mark: Fully Implemented | MEDIUM |
| 7.2 | Backend integration test gaps | :white_check_mark: Fully Implemented | MEDIUM |
| 8.1 | Docker compose completion | :large_orange_diamond: Partial | LOW |
| 8.2 | Monitoring & observability | :red_circle: Not Started | LOW |
| 8.3 | Mobile app | :red_circle: Not Started | LOW |
| 8.4 | Dead code cleanup | :large_orange_diamond: Partial | LOW |
| 9.1 | API versioning (/v1/) | :red_circle: Not Started | MEDIUM |
| 9.2 | Idempotency keys | :red_circle: Not Started | MEDIUM |
| 9.3 | Cursor-based pagination | :red_circle: Not Started | MEDIUM |
| 9.4 | JWT auth (upgrade from X-User-Id) | :large_orange_diamond: Partial | MEDIUM |
| 9.5 | Consistent error envelope | :large_orange_diamond: Partial | MEDIUM |
| 10.1 | Split clinical_endpoints.rs | :large_orange_diamond: Partial | MEDIUM |
| 10.2 | Split main.rs | :large_orange_diamond: Partial | MEDIUM |
| 11.1 | TOCTOU prevention | :red_circle: Not Started | MEDIUM |
| 11.2 | Supply chain security (cargo-deny, SBOM) | :large_orange_diamond: Partial | MEDIUM |
| 11.3 | Zero Trust & MFA (HIPAA 2025) | :red_circle: Not Started | MEDIUM |
| 11.4 | Incident response plan | :red_circle: Not Started | MEDIUM |
| 12.1 | Performance budgets | :red_circle: Not Started | LOW |
| 12.2 | Property/fuzz testing | :red_circle: Not Started | LOW |
| 12.3 | Pre-commit hooks | :red_circle: Not Started | LOW |
| 13.1 | TypeScript type safety (27 issues) | :large_orange_diamond: Partial | LOW |
| 13.2 | Demo data fallback cleanup | :large_orange_diamond: Partial | LOW |
| 13.3 | PDF export & print | :red_circle: Not Started | LOW |
| 13.4 | Insurance cards CRUD | :red_circle: Not Started | LOW |

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