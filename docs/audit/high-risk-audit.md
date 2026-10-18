# MediChain High-Risk Backend Audit

> Historical finding snapshot. The descriptions below record the state at
> discovery and are intentionally not rewritten during remediation. Current
> implementation and verification status is maintained in
> [`../PRODUCTION_READINESS.md`](../PRODUCTION_READINESS.md) (2026-08-09).

---

## Section 2: Auth & Middleware

### Classification Table

| Component | Classification | Notes |
|---|---|---|
| `SignatureAuthMiddleware::disabled()` | Mock/Demo | All requests pass through. `X-User-Id` is completely unverified and spoofable. |
| `main.rs` middleware config | Production-ready | Secure-by-default: enabled unless `IS_DEMO=true` or `REQUIRE_SIGNATURES=false`. Logs a loud `warn!` when disabled. |
| `jwt.rs` — `issue_access_token` | Production-ready | HS256 with `exp`, `iat`, token-type discrimination (`TYP_ACCESS` vs `TYP_REFRESH`). Refresh tokens cannot be replayed as access tokens. |
| `jwt.rs` — `jwt_secret()` | Partial/Risk | Falls back to hardcoded dev secret `"medichain-dev-secret-change-in-production"` if `JWT_SECRET` and `SESSION_SECRET` are both unset. `validate_production_secrets()` catches this at startup in non-demo mode. |
| `jwt.rs` — `decode_token()` | Production-ready | Uses `Validation::default()` which enforces HS256 and validates `exp`. No `None` algorithm or alg confusion. |
| `auth_jwt.rs` — `issue_jwt` | Partial | Demo mode (`IS_DEMO=true`) accepts a JWT with no signature at all (lines 78–79). Intended, but must not reach production. |
| `auth_jwt.rs` — `refresh_jwt` | Production-ready | Validates `typ == TYP_REFRESH` before accepting refresh token. |
| Rate limit (`rate_limit.rs`) | Production-ready | Intentionally does NOT trust `X-User-Role` header (lines 221–222). |
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

### High

| # | Severity | Location | Issue | Risk | Recommended Fix |
|---|---|---|---|---|---|
| F-07 | **High** | `clinical_endpoints/emergency.rs:1114–1155` | `POST /api/nursing/mar/administer` returns a success response without writing any record to the MAR repository. | Medication administration events are not persisted. A nurse tapping "Administer" produces no audit trail, no MAR update, and no duplicate-dose prevention. Patient safety risk. | Write an `AdherenceLogEntity` or `MedicationAdministrationEntity` to the appropriate repository before returning success. |
| F-08 | **High** | `clinical_endpoints/emergency.rs:902–946` | `GET /api/clinical/patient/{id}/emergency` reads from legacy in-memory `RwLock` maps (`data.code_blue_records`, `data.trauma_assessments`, etc.) rather than the repository layer. | When `MEDICHAIN_STORAGE=postgres`, emergency records written via the create-endpoints (which use the repository) will not appear in this summary endpoint. Emergency-summary data will be stale or empty. | Replace direct in-memory reads with repository calls (`.get_by_patient()`). |
| F-09 | **High** | `clinical_endpoints/medical_id.rs:136–139`, `:465–471`, `:316`, `:624` | Emergency medical ID endpoints return empty `medications: []`, `conditions: []`, and `emergency_contact: null`. These are documented as `TODO: Phase 2 repository`. | A first responder tapping an NFC card in an emergency will see no current medications or conditions. A patient on warfarin, insulin, or immunosuppressants is invisible. Patient safety risk. | Fetch from prescription and condition repositories. Mark the card as "INCOMPLETE" if these fields are absent. |

### Medium

| # | Severity | Location | Issue | Risk | Recommended Fix |
|---|---|---|---|---|---|
| F-12 | **Medium** | `clinical_endpoints/billing.rs:82–88` | Prescription NPI is hardcoded `"1234567890"` and DEA number is `"AA1234567"`. E-signature IP is hardcoded `"127.0.0.1"`. | Prescriptions have invalid regulator identifiers. If prescriptions are used in real clinical flow, they would fail DEA/NPI validation at a pharmacy. | Populate from the prescriber's User record (add `npi` and `dea_number` fields); capture real IP from `req.connection_info()`. |
| F-13 | **Medium** | `clinical_endpoints/clinical_support.rs:40`, `:830`, `:1406`, etc.; `emergency.rs:906–942`; multiple files | Widespread use of `.unwrap()` on `RwLock::read()` in request handlers. | A panicking thread will kill the Actix worker. Under concurrent load or after a previous panic in the same lock, a poisoned lock will cause a cascade of 500-panics. | Replace with `.read().map_err(|e| { log::error!(...); HttpResponse::InternalServerError()... })` pattern. |
| F-14 | **Medium** | `auth_jwt.rs:524–534` | `enforce_mfa_step_up` is exempt for `X-User-Id`-only requests (no JWT). The comment says "demo mode and legacy clients still work". | Admin operations that call `enforce_mfa_step_up` (currently: `declare_breach`) can be performed without MFA by using `X-User-Id` instead of a JWT — even with `REQUIRE_SIGNATURES=true` and a valid signature. | In production mode, require JWT (not just `X-User-Id`) for all MFA-gated operations. |

### Low

| # | Severity | Location | Issue | Risk | Recommended Fix |
|---|---|---|---|---|---|
| F-17 | **Low** | `clinical_endpoints/workflow.rs:719–723` | Pharmacist dashboard returns empty `drug_interaction_alerts` and `allergy_alerts` with a comment saying they are "placeholders for now". | Pharmacist UI shows no drug-interaction or allergy warnings. A pharmacist dispensing a contraindicated drug combination would see no alert. | Wire the existing `check_interactions` endpoint logic (which has a real drug interaction table in `insurance_pharmacy.rs:1078+`) into the dashboard. |
| F-18 | **Low** (uncertain) | `middleware/signature_auth.rs:156–160` | When a request has no `X-User-Id` header at all, the middleware passes it through without verification — leaving auth entirely to the endpoint. | Relies on every endpoint performing its own auth check. If any endpoint forgets to call `get_current_user_id`, it becomes publicly accessible without raising a middleware-level flag. | Consider returning 401 at the middleware level for any route not in `BYPASS_ROUTES` if no `X-User-Id` is present. |
