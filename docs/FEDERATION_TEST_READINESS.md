# MediChain federation test-readiness plan

This plan distinguishes code written locally from proof that can only be collected when the Rust toolchain, database, mobile devices, and supporting services are available.

## Current source-only checks

- Rust Phase 1-3 modules are formatted with `rustfmt`.
- Doctor and patient portal TypeScript typechecks have passed locally.
- The local Rust build is intentionally deferred: this machine has no MSVC `link.exe`.

## First verification session next month

1. Install Visual Studio Build Tools with MSVC x64/x86 and launch a Developer PowerShell.
2. Run `cargo check --workspace` and `cargo test --workspace`.
3. Run `cargo test -p medichain-api federation_identity`, `cargo test -p medichain-api organization_keys`, `cargo test -p medichain-api device_lifecycle`, `cargo test -p medichain-api emergency_grants`, `cargo test -p medichain-api mobile_records`, `cargo test -p medichain-api telehealth_retention`, and `cargo test -p medichain-api audit_outbox` to validate the new security and governance invariants.
4. Start a disposable PostgreSQL database, run the API migrations, and verify that the Phase 1-3 migration chain applies from an empty database.
5. Run `npm run typecheck --workspace=doctor-portal` and `npm run typecheck --workspace=patient-app` from `client`.

## Required scenario tests before any patient data

| Scenario | Expected proof |
|---|---|
| Work versus My Health | A professional token cannot contain patient-profile claims; a patient token cannot contain organisation assignment claims. |
| Key registration | Invalid proof of possession is rejected; a pending key cannot be resolved as active. |
| Key lifecycle | Only the owning organisation can transition its key; revoked/compromised keys cannot be resolved for new envelopes. |
| Approved device lifecycle | A newly enrolled device cannot access clinical data, a current credential activates it, and revocation removes access immediately. |
| Monthly rotation | A device beyond its 7-day rotation grace period becomes non-compliant and cannot regain access without rotation. |
| Emergency grant | A valid provider on an approved device receives only a 15-minute summary-scoped grant; full-record scope is rejected. |
| Grant binding and expiry | A grant cannot be reused for another patient, facility, clinician, or device; it is denied after server-time expiry or revocation. |
| Grant-bound NFC emergency path | A request without a live professional context, compliant device, matching facility, or valid NFC tag is denied before the emergency summary is returned. |
| Open emergency screen expiry | The doctor portal clears its emergency summary and grant state at the server-provided expiry time; subsequent requests still fail server-side. |
| Mobile record capability | The API returns only a ciphertext reference tied to one active patient device; it cannot be replayed on another device. |
| Mobile-device revocation | Revoking a patient device invalidates every active record capability immediately and denies subsequent access. |
| Telehealth retention | Raw transcript/recording artifacts require encrypted references and hashes; a legal hold prevents scheduled deletion. |
| Audit outbox | A failed chain delivery leaves a privacy-minimised event replayable; security revocations create an outbox event. |
| Governance | A validator or policy decision cannot execute until its configured number of distinct approvals exists. |
| Legacy record compatibility | A record encrypted with an existing `ENCRYPTION_KEYS` version remains readable after the federation migrations apply. |
| Envelope implementation | Hospital A can create an envelope for Hospital B without any private key being stored in the database or blockchain. |
| Emergency access | Server time, device, active context, scope, and grant expiry are enforced for every protected endpoint. |

## Deliberately unproven until infrastructure exists

- KMS/HSM key custody and private-key isolation.
- PostgreSQL migration and persistence behaviour.
- Migration of the legacy NFC emergency demonstration route to mandatory grant-bound summary retrieval.
- Four-validator testnet, finality-loss, network-partition, node-recovery, and audit-outbox replay drills.
- Android/iOS private encrypted file storage, biometric policy, screenshot controls, NFC hardware and remote revocation delivery.
- Jitsi audio bridge, self-hosted STT/translation, retention jobs and legal hold.
- Multi-validator finality, failure, restore and runtime-upgrade rehearsals.
- Clinical, legal, privacy and independent security review.
