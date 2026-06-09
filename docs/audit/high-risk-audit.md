# MediChain High-Risk Backend Audit

**Date:** 2026-06-09
**Scope:** `api/src/blockchain.rs`, `api/src/middleware/signature_auth.rs`, `api/src/security/jwt.rs`, `api/src/handlers/rbac.rs`, `api/src/handlers/auth_jwt.rs`, `api/src/clinical_endpoints/` (emergency, lab, medical_id, workflow, insurance_pharmacy, billing, fhir)
**Method:** Static read-only analysis — no build, no execution.

---

## Section 1: Blockchain (`api/src/blockchain.rs`)

### Classification Table

| Component | Classification | Notes |
|---|---|---|
| `blockchain_enabled()` | Production-ready | Correctly reads `BLOCKCHAIN_ENABLED` env var; defaults to `false`. |
| `SubstrateClient::new()` | Partial | Initializes `subxt` only when `BLOCKCHAIN_ENABLED=true`. Otherwise builds without it. Connection health is properly wired. |
| `health_check()` | Production-ready | Genuine RPC call with 5-second timeout and connected-flag update. |
| `register_patient_on_chain()` | Partial/Stub | Attempts real SCALE path if patient_id parses as `AccountId32`; non-SS58 IDs fall back to `pending_extrinsic`. SS58 input also calls `pending_extrinsic` (the real extrinsic is only dispatched when `BLOCKCHAIN_ENABLED=true` AND subxt is ready). |
| `record_ipfs_hash_on_chain()` | Partial/Stub | Same pattern as above. |
| `log_access_on_chain()` | Stub (critical) | Maps all access-audit calls to `AccessControl::grant_emergency_access`. This is semantically wrong — a read-access audit should not be recorded as an emergency-access grant. |
| `pending_extrinsic()` (disabled path) | Mock | Returns deterministic SHA3-256 hash of `pallet_name + call_name + timestamp`. Nothing is written to the chain. |
| `pending_extrinsic()` (enabled path) | Partial | Uses `subxt_signer::sr25519::dev::alice()` as the signing keypair — a well-known test key. Real submission code is present but falls back to a placeholder hash on any error. |

### Key Findings

- **BLOCKCHAIN_ENABLED=false (default):** ALL on-chain operations return a deterministic SHA3-256 hash prefixed `0x` without contacting any node. No patient registration, IPFS hash anchoring, or access audit is real.
- **BLOCKCHAIN_ENABLED=true:** Submission logic is present via `subxt`, but uses the Alice dev key (`subxt_signer::sr25519::dev::alice()` at line 564). This is a known insecure test key and must never be used in production.
- `log_access_on_chain` misroutes audit events to `AccessControl::grant_emergency_access` pallet call (lines 452–453). Access-log events appear on-chain as emergency-access grants.
- Consent records are NOT stored on-chain at all (see Section 3).
- Non-SS58 patient IDs (e.g. UUIDs like "PAT-12345") always hit the placeholder path because `patient_id.parse::<AccountId32>()` fails.

---

## Section 2: Auth & Middleware

### Classification Table

| Component | Classification | Notes |
|---|---|---|
| `SignatureAuthMiddleware::enabled()` | Production-ready | Cryptographic sr25519 verification via `medichain_crypto::signature::verify_wallet_signature`. 5-minute replay window. Rejects POST with `X-User-Id` but no `X-Signature`. |
| `SignatureAuthMiddleware::disabled()` | Mock/Demo | All requests pass through. `X-User-Id` is completely unverified and spoofable. |
| `main.rs` middleware config | Production-ready | Secure-by-default: enabled unless `IS_DEMO=true` or `REQUIRE_SIGNATURES=false`. Logs a loud `warn!` when disabled. |
| `jwt.rs` — `issue_access_token` | Production-ready | HS256 with `exp`, `iat`, token-type discrimination (`TYP_ACCESS` vs `TYP_REFRESH`). Refresh tokens cannot be replayed as access tokens. |
| `jwt.rs` — `jwt_secret()` | Partial/Risk | Falls back to hardcoded dev secret `"medichain-dev-secret-change-in-production"` if `JWT_SECRET` and `SESSION_SECRET` are both unset. `validate_production_secrets()` catches this at startup in non-demo mode. |
| `jwt.rs` — `decode_token()` | Production-ready | Uses `Validation::default()` which enforces HS256 and validates `exp`. No `None` algorithm or alg confusion. |
| `auth_jwt.rs` — `issue_jwt` | Partial | Demo mode (`IS_DEMO=true`) accepts a JWT with no signature at all (lines 78–79). Intended, but must not reach production. |
| `auth_jwt.rs` — `refresh_jwt` | Production-ready | Validates `typ == TYP_REFRESH` before accepting refresh token. |
| `rbac.rs` / `support.rs` — role resolution | Production-ready | Role always read from server-side `users` map keyed by wallet address. No endpoint reads role from a client header. `support.rs:226` explicitly documents this invariant. |
| Rate limit (`rate_limit.rs`) | Production-ready | Intentionally does NOT trust `X-User-Role` header (lines 221–222). |
| `auth_challenge.rs::wallet_login` / `wallet_login_get` | Medium risk | These endpoints confirm wallet registration and return name + role without requiring a signature. They disclose whether a wallet is registered. Names are logged in plaintext at INFO level (line 80, 129). |
| `signature_auth.rs` — bypass when no `X-User-Id` | Design gap | If a request has no `X-User-Id` at all, the middleware lets it through (lines 157–160) and leaves auth to the endpoint. Endpoints check `get_current_user_id` and return 401 if absent, so the net effect is correct — but the middleware silently passes unauthenticated requests. |
| `rbac.rs` — `assign_role` | Production-ready | Admin check is server-side; prevents assigning the Admin role via API. |
| `mfa.rs` — `enforce_mfa_step_up` | Design gap | `X-User-Id`-only requests (no JWT) are exempt from MFA step-up (line 525). This means the `declare_breach` admin endpoint can be called without MFA if the caller uses the legacy header path rather than JWT. |

---

## Section 3: Clinical Endpoints

### Classification Table

| Component | Classification | Notes |
|---|---|---|
| `emergency.rs` — code-blue, trauma, stroke, sepsis, cardiac (create/get) | Partial | RBAC correct (`can_edit_medical_records`). Data persists via repository. However, `get_patient_emergency_records` reads from **in-memory** `RwLock` maps (not repository), causing stale data if running with PostgreSQL backend. |
| `emergency.rs` — `administer_medication` (`POST /api/nursing/mar/administer`) | Stub | Returns a success JSON without writing any persistent record. Administration is not logged to the MAR repository. |
| `emergency.rs` — `record_fluid` (`POST /api/nursing/intake-output/record`) | Stub | Same pattern — returns success without persisting. |
| `medical_id.rs` — `get_medical_id`, `get_medical_id_qr` | Partial | RBAC correct. DNR verification logic is sound and well-tested. Critical medications, chronic conditions, and emergency contacts return **empty arrays** (TODO Phase 2 repository). |
| `medical_id.rs` — `get_emergency_medical_id` | Critical gap | Emergency access is "validated" by checking if a `?token` or `?nfc_hash` query param is **present** (non-empty), not by cryptographically verifying it (lines 345–349). Any arbitrary token string grants access to the patient's PHI. Medications and conditions are also empty. |
| `medical_id.rs` — `get_lockscreen_medical_id` | Partial | No authentication required (get_current_user_id is optional, not enforced). Returns blood type, allergy list, and DNR status without any access control. |
| `workflow.rs` — `sign_consent` | Mock | Uses `std::collections::hash_map::DefaultHasher` (non-cryptographic, platform-specific) as the "signature hash" (lines 1864–1874). Hardcodes `ip_address: "127.0.0.1"`. Consent is NOT persisted to a repository (only an access log entry). No blockchain anchor. |
| `workflow.rs` — `get_patient_consents` | Stub | Returns two hardcoded demo consent records (`CSNT-001`, `CSNT-002`) regardless of patient (lines 1960–1976). |
| `workflow.rs` — `pharmacist_dashboard` | Partial | Drug interaction and allergy alert lists are empty placeholders (lines 719–723). |
| `lab.rs` — `create_critical_value` | Production-ready | RBAC gated, persists via repository, pushes real-time SSE notification. |
| `fhir.rs` — `fhir_get_patient` | Partial | Name and DOB are redacted ("Encrypted"/"Redacted"). `address` and `contact` arrays are empty (TODO). RBAC correct. |
| `billing.rs` — `create_prescription` | Partial | Correctly restricts to Doctor role. NPI is hardcoded `"1234567890"` and DEA number is hardcoded `"AA1234567"` for demo. E-signature IP is hardcoded `"127.0.0.1"`. |
| `insurance_pharmacy.rs` — `verify_insurance` | Partial | Comment says "Simulate verification (in production: call external API)". Returns locally-stored data, not a real payer verification. |
| `clinical_support.rs`, `platform.rs` | Partial | Multiple `.unwrap()` on `RwLock::read()` — will panic on lock poisoning. |

---

## Findings

### Critical

| # | Severity | Location | Issue | Risk | Recommended Fix |
|---|---|---|---|---|---|
| F-01 | **Critical** | `clinical_endpoints/medical_id.rs:345–349` | Emergency medical ID endpoint (`GET /api/medical-id/{id}/emergency`) accepts any non-empty `?token` or `?nfc_hash` parameter as valid authorization. No cryptographic check is performed. | Any unauthenticated actor can pass `?token=x` and receive a patient's blood type, critical allergies, DNR status, organ-donor status, and patient ID. This is a full PHI disclosure with no access control. | Verify the NFC hash or token against the patient's stored NFC card hash (SHA3-256). At minimum, reject if the value does not match a record in the `nfc_tags` repository. |
| F-02 | **Critical** | `clinical_endpoints/medical_id.rs:504–651` | Lock screen endpoint (`GET /api/medical-id/{id}/lockscreen`) has no access control. `get_current_user_id` result is ignored; any unauthenticated caller receives blood type, allergy list, and DNR status. | PHI accessible without any credential, even with `REQUIRE_SIGNATURES=true`. | Enforce authentication check: require at minimum a valid NFC hash or authenticated session, and return 401 when absent. |
| F-03 | **Critical** | `clinical_endpoints/workflow.rs:1960–1976` | `GET /api/consent/patient/{patient_id}` returns two hardcoded demo consent records (`CSNT-001`, `CSNT-002`) for every patient. | All patients appear to have signed treatment and HIPAA consents when they may not have. A provider may proceed with treatment believing consent is on file when it is not. | Remove demo stubs; read real consents from the repository. Return an empty list until the consent repository is populated. |
| F-04 | **Critical** | `blockchain.rs:564` | When `BLOCKCHAIN_ENABLED=true`, all extrinsics are signed with `subxt_signer::sr25519::dev::alice()` — the well-known Substrate Alice test key. | Any extrinsic submitted to a real chain would be attributed to Alice, not the actual operator. If Alice has tokens on a live network, her funds are exposed. All audit entries on-chain are attributable to an insecure shared key. | Replace with a real operator keypair loaded from `SUBSTRATE_SIGNING_KEY` environment variable. |
| F-05 | **Critical** | `blockchain.rs:413–453` | `log_access_on_chain` submits `AccessControl::grant_emergency_access` for all access types including ordinary reads. | All access-audit trail entries on-chain incorrectly appear as emergency access grants. A real auditor or regulator reviewing on-chain records would see every record read as an "emergency access" event. Renders the blockchain audit trail legally unreliable. | Map access_type strings to the correct pallet calls (read-only access should use a dedicated audit pallet entry, not grant_emergency_access). |

### High

| # | Severity | Location | Issue | Risk | Recommended Fix |
|---|---|---|---|---|---|
| F-06 | **High** | `clinical_endpoints/workflow.rs:1862–1874` | `sign_consent` uses `std::collections::hash_map::DefaultHasher` as the "signature hash". This is a non-cryptographic, platform-specific hash; its output may vary across Rust versions or platforms. The hash is also not stored to a persistent repository. | Consent "signatures" provide no cryptographic integrity. A consent record cannot be verified or proven in a legal or regulatory context. | Replace with SHA3-256 or the patient's sr25519 wallet signature over the consent content. Persist consent records to the consent repository. Anchor the hash on-chain via `blockchain.rs`. |
| F-07 | **High** | `clinical_endpoints/emergency.rs:1114–1155` | `POST /api/nursing/mar/administer` returns a success response without writing any record to the MAR repository. | Medication administration events are not persisted. A nurse tapping "Administer" produces no audit trail, no MAR update, and no duplicate-dose prevention. Patient safety risk. | Write an `AdherenceLogEntity` or `MedicationAdministrationEntity` to the appropriate repository before returning success. |
| F-08 | **High** | `clinical_endpoints/emergency.rs:902–946` | `GET /api/clinical/patient/{id}/emergency` reads from legacy in-memory `RwLock` maps (`data.code_blue_records`, `data.trauma_assessments`, etc.) rather than the repository layer. | When `MEDICHAIN_STORAGE=postgres`, emergency records written via the create-endpoints (which use the repository) will not appear in this summary endpoint. Emergency-summary data will be stale or empty. | Replace direct in-memory reads with repository calls (`.get_by_patient()`). |
| F-09 | **High** | `clinical_endpoints/medical_id.rs:136–139`, `:465–471`, `:316`, `:624` | Emergency medical ID endpoints return empty `medications: []`, `conditions: []`, and `emergency_contact: null`. These are documented as `TODO: Phase 2 repository`. | A first responder tapping an NFC card in an emergency will see no current medications or conditions. A patient on warfarin, insulin, or immunosuppressants is invisible. Patient safety risk. | Fetch from prescription and condition repositories. Mark the card as "INCOMPLETE" if these fields are absent. |
| F-10 | **High** | `blockchain.rs` (all public functions) | Default mode (`BLOCKCHAIN_ENABLED=false`) silently returns placeholder tx hashes for all on-chain calls. The API returns a `tx_hash` value that looks real to callers, but nothing was written to the chain. | System operators and auditors may believe consent, patient registration, and IPFS hash records are on-chain when they are not. No warning is surfaced in API responses. | Include an explicit `"on_chain": false, "mode": "demo"` field in API responses when returning a placeholder hash. |

### Medium

| # | Severity | Location | Issue | Risk | Recommended Fix |
|---|---|---|---|---|---|
| F-11 | **Medium** | `handlers/auth_challenge.rs:79–83`, `:128–132` | `wallet_login` and `wallet_login_get` log the user's wallet address, full name, and role at `INFO` level without any redaction. | User PII (name, role) flows into structured logs, potentially violating POPIA data minimisation requirements. Log aggregators or any party with log access can build user profiles. | Log only wallet address and role, not the user's real name. |
| F-12 | **Medium** | `clinical_endpoints/billing.rs:82–88` | Prescription NPI is hardcoded `"1234567890"` and DEA number is `"AA1234567"`. E-signature IP is hardcoded `"127.0.0.1"`. | Prescriptions have invalid regulator identifiers. If prescriptions are used in real clinical flow, they would fail DEA/NPI validation at a pharmacy. | Populate from the prescriber's User record (add `npi` and `dea_number` fields); capture real IP from `req.connection_info()`. |
| F-13 | **Medium** | `clinical_endpoints/clinical_support.rs:40`, `:830`, `:1406`, etc.; `emergency.rs:906–942`; multiple files | Widespread use of `.unwrap()` on `RwLock::read()` in request handlers. | A panicking thread will kill the Actix worker. Under concurrent load or after a previous panic in the same lock, a poisoned lock will cause a cascade of 500-panics. | Replace with `.read().map_err(|e| { log::error!(...); HttpResponse::InternalServerError()... })` pattern. |
| F-14 | **Medium** | `auth_jwt.rs:524–534` | `enforce_mfa_step_up` is exempt for `X-User-Id`-only requests (no JWT). The comment says "demo mode and legacy clients still work". | Admin operations that call `enforce_mfa_step_up` (currently: `declare_breach`) can be performed without MFA by using `X-User-Id` instead of a JWT — even with `REQUIRE_SIGNATURES=true` and a valid signature. | In production mode, require JWT (not just `X-User-Id`) for all MFA-gated operations. |
| F-15 | **Medium** | `handlers/general.rs:388–390` | New patients are registered with `wallet_address = patient_id` (a UUID) as a placeholder. This populates the `users` map with a non-SS58 wallet address. | Any RBAC check that compares `current_user_id` (a real wallet) with `patient_id` (a UUID) will fail the equality check, potentially breaking "patient viewing own records" checks on newly registered patients who have not yet linked a wallet. | Store new patients with an explicit `None` or empty wallet and handle the "no wallet linked" case explicitly in the RBAC logic. |

### Low

| # | Severity | Location | Issue | Risk | Recommended Fix |
|---|---|---|---|---|---|
| F-16 | **Low** | `support.rs:246–248` | `is_valid_wallet_address` only checks length (45–50 chars) and that the address starts with `'5'`. No SS58 checksum validation. | A malformed wallet address (wrong checksum but correct prefix/length) passes validation. | Use `sp_core::crypto::AccountId32::from_ss58check()` for proper SS58 checksum validation. |
| F-17 | **Low** | `clinical_endpoints/workflow.rs:719–723` | Pharmacist dashboard returns empty `drug_interaction_alerts` and `allergy_alerts` with a comment saying they are "placeholders for now". | Pharmacist UI shows no drug-interaction or allergy warnings. A pharmacist dispensing a contraindicated drug combination would see no alert. | Wire the existing `check_interactions` endpoint logic (which has a real drug interaction table in `insurance_pharmacy.rs:1078+`) into the dashboard. |
| F-18 | **Low** (uncertain) | `middleware/signature_auth.rs:156–160` | When a request has no `X-User-Id` header at all, the middleware passes it through without verification — leaving auth entirely to the endpoint. | Relies on every endpoint performing its own auth check. If any endpoint forgets to call `get_current_user_id`, it becomes publicly accessible without raising a middleware-level flag. | Consider returning 401 at the middleware level for any route not in `BYPASS_ROUTES` if no `X-User-Id` is present. |
