# MediChain Implementation Plan

## Overview

This file tracks all unimplemented, stub, or incomplete features found in the codebase.
Items are ordered by priority/impact.

---

## 1. Blockchain Integration (CRITICAL)

**File:** `api/src/blockchain.rs`

The blockchain module uses deterministic SHA3-256 placeholder hashes instead of real SCALE codec submission.

### Missing:
- `subxt` or `parity-scale-codec` + `sp-core`/`sp-runtime` crates in `Cargo.toml`
- `register_patient_on_chain()` — logs but does not submit extrinsic
- `record_ipfs_hash_on_chain()` — logs but does not submit extrinsic
- `log_access_on_chain()` — logs but does not submit extrinsic
- `pending_extrinsic()` — returns placeholder hash, does not execute on-chain

### Implementation Steps:
1. Add `subxt` to `Cargo.toml`
2. Generate type-safe client from Substrate node metadata
3. Replace placeholder hash logic with real extrinsic submission
4. Handle on-chain errors and retry logic

---

## 2. Repository Trait Methods — 41 Unimplemented (HIGH)

**File:** `api/src/repositories/traits.rs`

Default trait implementations return `RepositoryError::NotImplemented`. These need real logic.

### InsuranceRecordRepository:
- `deactivate()`
- `get_expiring()`
- `get_primary()`
- `get_active()`
- `verify_eligibility()`
- `set_primary()` (planned in TODO comment, line 217 of phase5_insurance.rs)
- `terminate()` (planned in TODO comment, line 217 of phase5_insurance.rs)

### BillingCodeRepository:
- `get_active()`
- `deactivate()`
- `list_by_type()`

### CdsAlertRepository:
- `get_by_encounter()`
- `get_unacknowledged()`
- `dismiss()`
- `get_by_rule()`
- `get_high_severity()`

### DeathRecordRepository:
- `certify()`
- `get_pending_certification()`
- `get_medical_examiner_cases()`
- `get_pending_autopsies()`

### OrganDonationRecordRepository:
- `get_pending_recovery()`
- `get_by_opo()`

### SyncOperationRepository:
- `update_progress()`
- `complete()`
- `fail()`
- `get_pending_retries()`
- `get_in_progress()`

### SyncConflictRepository:
- `get_auto_resolvable()`

### ExternalIdMappingRepository:
- `update_sync_time()`
- `delete()`
- `deactivate()`
- `get_by_system()`

### Implementation Steps:
1. Implement each method in the corresponding `postgres/` and `memory/` repository files
2. Remove `RepositoryError::NotImplemented` returns from trait defaults once concrete implementations exist

---

## 3. Firebase Cloud Messaging (FCM) Push Notifications (MEDIUM)

**File:** `api/src/main.rs` (line ~1157)

FCM_SERVER_KEY env var is documented but never used. Push notifications only work via SSE/WebSocket.

### Missing:
- FCM HTTP v1 API integration
- Device token storage per user
- Push notification dispatch on clinical events (new appointment, lab result, prescription, etc.)

### Implementation Steps:
1. Add `fcm` or `reqwest`-based FCM client
2. Add `device_tokens` table/store per user
3. Wire notification dispatch into relevant event handlers
4. Test with Android/iOS clients

---

## 4. Polkadot.js Wallet Signature Authentication (MEDIUM)

**File:** `client/shared/src/wallet/types.ts`

Signature authentication headers (`X-Signature`) are defined but the frontend wallet signing workflow is incomplete. Production signature verification is disabled by default (`IS_DEMO=true`).

### Missing:
- Full Polkadot.js extension sign-in flow in frontend
- Backend signature verification enabled in non-demo mode
- User onboarding for wallet connection

### Implementation Steps:
1. Complete wallet connect UI in frontend
2. Implement `signMessage()` using `@polkadot/extension-dapp`
3. Enable `IS_DEMO=false` path in backend signature verification
4. Add fallback/error handling for users without Polkadot extension

---

## 5. National ID Verification — Government API Integration (MEDIUM)

No real government API integration exists. Only a stub NFC simulator with SHA3-256 verification is present.

### Planned integrations:
- **Ethiopia:** Fayda ID
- **Ghana:** Ghana Card
- **Nigeria:** NIN (National Identity Number)
- **South Africa:** Smart ID
- **Kenya:** Huduma Namba

### Implementation Steps:
1. Define a `NationalIdVerifier` trait with `verify(id: &str, country: Country) -> Result<VerificationResult>`
2. Implement per-country adapters behind feature flags or config
3. Add fallback to manual/document verification when API is unavailable
4. Store verification status in patient record

---

## 6. Telehealth WebRTC Signaling (MEDIUM)

**File:** `api/src/clinical_endpoints.rs` (lines ~13943–14402)

Session management exists but no real video/audio. Telehealth links are placeholder URLs.

### Missing:
- WebRTC signaling server (or integration with Agora/Twilio/Daily.co)
- STUN/TURN server configuration
- Media stream handling
- Session state persistence (currently in-memory HashMap)

### Implementation Steps:
1. Choose signaling approach: self-hosted (mediasoup/ion-sfu) or third-party SDK
2. Replace placeholder URL generation with real session tokens from chosen provider
3. Persist session state to database
4. Implement `end_telehealth_session()` to properly release resources

---

## 7. Dead Code — Unused Structures and Handlers (LOW)

Multiple files have `#[allow(dead_code)]` indicating planned but unused features.

### Files:
- `api/src/clinical.rs` (lines 15, 192, 5420, 5440)
- `api/src/clinical_endpoints.rs` (lines 10347, 12159, 15261, 15659, 16971, 17211, 17221, 17239)
- `api/src/models/user.rs` (lines 15, 39, 63, 81, 93, 102, 137)
- `api/src/db/mod.rs` (lines 130, 139, 148)
- Various `memory/` and `postgres/` repository files

### Implementation Steps:
1. Audit each `#[allow(dead_code)]` site
2. Either wire the struct/function into an active code path, or delete it
3. Remove `#[allow(dead_code)]` attributes after resolution

---

## 8. Encryption Wiring for Document Uploads (LOW)

**File:** `api/src/ipfs.rs`

ChaCha20-Poly1305 encryption via `medichain_crypto` crate exists (`upload_encrypted()`, `download_decrypted()`), but it is unclear if all document upload endpoints enforce encryption.

### Missing:
- Audit all endpoints that accept file uploads
- Ensure `encrypted: false` is not the default or silently accepted
- Add encryption-required policy enforcement at the API layer

---

## Progress Tracking

| # | Feature | Status |
|---|---------|--------|
| 1 | Blockchain real extrinsic submission | Implemented |
| 2 | 41 repository trait methods | Implemented |
| 3 | FCM push notifications | Implemented |
| 4 | Polkadot.js wallet signing | Implemented |
| 5 | National ID verification APIs | Implemented |
| 6 | Telehealth WebRTC | Implemented |
| 7 | Dead code cleanup | Implemented |
| 8 | Encryption enforcement | Implemented |
