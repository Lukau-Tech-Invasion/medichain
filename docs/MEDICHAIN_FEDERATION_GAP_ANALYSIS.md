# MediChain federation gap analysis (Phase 0)

**Assessment date:** 2026-07-27  
**Scope:** Phase 0 only, as required by `MEDICHAIN_CODEX_IMPLEMENTATION_HANDOFF.md`. This is a source-backed inventory and migration plan; it does not claim production readiness and makes no future-phase architecture changes.

## Evidence and baseline

The checkout is on `main` at `699f8b4` and is already substantially dirty. All pre-existing modified, deleted, and untracked implementation files were preserved. This Phase 0 assessment adds only this analysis and the companion machine-readable manifest; it does not commit anything.

| Check | Result | Evidence / limitation |
|---|---|---|
| Doctor portal TypeScript | Verified | `npm run typecheck --workspace=doctor-portal` passed. |
| Patient app TypeScript | Verified | `npm run typecheck --workspace=patient-app` passed. |
| Rust workspace compilation | Externally blocked | `cargo check --workspace` could not start compilation because MSVC `link.exe` is absent from this Windows environment. This is a developer-toolchain failure, not proof of an application failure. |
| Rust/pallet tests | Not run | They require the same missing linker. Restore Visual Studio Build Tools / Developer Command Prompt, then run `cargo test --workspace`. |
| Live Postgres, IPFS, Jitsi, physical NFC, Android/iOS secure-storage, multi-validator operation | Externally gated | No services, physical devices, partner infrastructure, or production credentials were started or assumed during this audit. |

## Verified status matrix

| Handoff capability | Status | Current evidence | Main gap to federation target |
|---|---|---|---|
| Actix API, React portals, Expo foundation | Verified | `api/src/main.rs`, `api/src/routes.rs`, `client/*`, `mobile-examples/expo-starter/*` | No federation-specific boundary yet. |
| In-memory plus PostgreSQL repository layer | Verified | `api/src/repositories/{memory,postgres}`, migrations in `api/migrations` | Tables and repositories have no organisation/facility ownership boundary. |
| Versioned deployment keyring | Partial | `api/src/encryption_keyring.rs`, `state.rs`, `types/domain.rs`, `ipfs.rs`, patient `key_version` migration | One deployment-wide `ENCRYPTION_KEYS` source; no KeyManager, per-record DEK, public-key directory, envelope or key-use index. |
| Encrypted records/IPFS | Partial | `crypto/src/lib.rs` uses ChaCha20-Poly1305; `api/src/ipfs.rs` encrypts content and metadata | Records use the deployment key, not recipient envelopes; no cross-hospital sharing or HSM/KMS boundary. |
| Wallet/JWT/MFA/RBAC | Partial | `handlers/{auth_challenge,auth_jwt,session,rbac}.rs`, `middleware/signature_auth.rs` | Current role/session model is global; no person, professional identity, patient profile, work/personal context, assignment, or context-scoped claim. |
| NFC/QR emergency access | Partial | `handlers/nfc.rs`, `nfc_simulator.rs`, `handlers/general.rs`, `clinical_endpoints/emergency_access.rs` | NFC tag expiry exists, but no first-class server-side 15-minute grant bound to person, facility, device, scope and every protected endpoint. |
| Emergency audit and chain evidence | Partial | `repositories/*/access_log.rs`, `blockchain.rs`, `pallets/access-control` | No durable audit outbox, correlation model, async anchor replay, high-availability emergency summary or proven p99. |
| Patient mobile auth/NFC | Partial | `mobile-examples/expo-starter/src/auth/AuthContext.tsx`, `screens/NfcCardScreen.tsx` | Tokens use SecureStore; there is no device-bound encrypted records package, remote revocation, offline expiry, controlled export, or physical-device proof. |
| Jitsi telehealth and transcription abstraction | Partial | `telehealth.rs`, `clinical_endpoints/clinical_support/telehealth.rs`, `services/transcription.rs`, `docker-compose.jitsi.yml` | Current provider abstraction includes Google Speech-to-Text; there is no Jitsi server-side audio bridge, self-hosted STT/translation pipeline, captions, retention classes, legal hold, or consent enforcement end-to-end. |
| Substrate chain and pallet tests | Partial | `pallets/{access-control,patient-identity,medical-records}`, `runtime`, `node`, `blockchain.rs` | Current pallets model global roles, patient identity and record hashes. They lack organisation/facility/key/grant/audit-anchor registries and four-validator operating proof. |

## Inventory index

The companion manifest points to the authoritative source locations rather than copying stale API documentation. The current API registry is assembled in `api/src/routes.rs`; implementation-level endpoint attributes are distributed through `api/src/handlers` and `api/src/clinical_endpoints`. The machine manifest records these boundaries and the important route groups.

### Encryption and keys

- Key source: `ENCRYPTION_KEYS`, parsed by `api/src/encryption_keyring.rs`; current version is the highest configured version. Missing configuration can fall back to an explicitly warned ephemeral key, while production startup validation is in `api/src/startup.rs`.
- Call sites: `crypto/src/lib.rs` implements ChaCha20-Poly1305; `api/src/types/domain.rs`, `api/src/ipfs.rs`, `api/src/state.rs`, and the MFA flow in `api/src/state.rs` call it.
- Version fields: `PatientEntity::key_version` in `api/src/repositories/traits.rs`, the patient persistence path in `api/src/repositories/postgres/patient.rs`, and `IpfsMetadata::key_version` in `api/src/ipfs.rs`.
- Risk: this is a good restart/retained-key fix but not a hospital-isolated cryptographic model. A direct rewrite would strand existing records; Phase 3 must use a legacy-keyring adapter and read fallback.

### Identity, devices, emergency access and mobile

- Current identity concepts: wallet address, JWT/session token, MFA, RBAC role, and patient profile. Sources: `api/src/handlers/auth_*`, `handlers/session.rs`, `handlers/rbac.rs`, `models/user.rs`, `types/auth.rs`, and `pallets/access-control`.
- Device concepts now present are registration/device tokens and NFC tags, not managed clinical-device identity. Sources: `handlers/general.rs`, `nfc_simulator.rs`, `repositories/*/nfc_tag.rs`, migration `20260419000001_communication_features.sql`, and client push support.
- Emergency routes and flows: `handlers/general.rs::emergency_access`, `handlers/nfc.rs`, `clinical_endpoints/emergency_access.rs`, `clinical_endpoints/medical_id/emergency_views.rs`, and `pallets/access-control::{grant_emergency_access,revoke_access,cleanup_expired_access}`.
- Mobile storage paths: Expo auth uses `expo-secure-store` only for session state in `mobile-examples/expo-starter/src/auth/AuthContext.tsx`; web patient offline state is in `client/patient-app/src/utils/offlineStorage.ts`. No source-backed encrypted-file package/storage path was found.

### Telehealth, audit and blockchain

- Telehealth/Jitsi: `api/src/telehealth.rs`, `api/src/clinical_endpoints/clinical_support/telehealth.rs`, `api/src/services/transcription.rs`, and `docker-compose.jitsi.yml`.
- Audit: access-log repositories, `api/src/blockchain.rs`, `api/src/routes.rs`, and PostgreSQL phase-6 audit repositories. There is no identified `audit_outbox` migration or service.
- Pallets/calls: `access-control` (role assignment/revocation, emergency grant/revocation/expiry cleanup, audit log); `patient-identity` (register, verify, organ donor, DNR, language, photo ID); `medical-records` (create record, alert, update IPFS hash). No organisation, facility, organisation-key, envelope-manifest, or audit-anchor pallet exists.

## Contradictions and missing foundations

1. The handoff requires federation, but the current data model and blockchain pallet model are globally scoped. Adding organisation fields to only HTTP handlers would be insecure: repositories, JWT claims, audit records and pallets must agree.
2. `EncryptionKeyring` versioning solves restart survivability, not recipient isolation. A shared `ENCRYPTION_KEYS` deployment config conflicts with per-hospital private-key custody.
3. Existing emergency access has expiry-related primitives, but there is no evidence of a grant database object or endpoint-wide middleware that enforces scope, server-time expiry, revocation, device and context binding.
4. Existing mobile secure token storage must not be represented as encrypted clinical-document storage. SecureStore cannot establish the required encrypted private file, revocation and offline-freshness guarantees by itself.
5. Current telehealth can issue Jitsi-related session material and call a transcription abstraction, but comments identify a missing recording/audio artifact. This conflicts with a claim of self-hosted streaming transcription.
6. The repository contains substantial uncommitted work, including endpoint module moves/deletions. No Phase 1+ migration should start until that working state is independently reviewed and either committed or deliberately carried as the baseline.

## Ordered branch and commit plan

Create one protected migration branch per phase from a clean, reviewed baseline; do not mix schema, security model, client changes, and validator operations in one commit.

1. `feat/federation-identity-context`: Phase 1 schema, repositories, token/context middleware, transition adapters, tests.
2. `feat/organization-key-directory`: Phase 2 organisation/facility/key directory, proof-of-possession, cache and pallet/event additions.
3. `feat/record-envelopes`: Phase 3 KeyManager, envelope tables, legacy adapter, rewrap worker and compatibility tests.
4. `feat/managed-device-rotation`: Phase 4 enrolment, credentials, rotation scheduler, compliance and client invalidation.
5. `feat/emergency-grant-enforcement`: Phase 5 precomputed summaries, grant middleware, audit outbox, cache invalidation and performance harness.
6. `feat/secure-mobile-records`: Phase 6 device-bound package and mobile private storage, revocation/offline policy tests on real platforms.
7. `feat/self-hosted-clinical-transcription`: Phase 7 controlled media bridge, local STT/translation, consent/retention/legal hold.
8. `ops/four-validator-testnet`: Phase 8 infrastructure, monitoring, backup/restore and failure rehearsal evidence.
9. `pilot/multi-hospital-shadow-mode`: Phase 9 synthetic-data pilot only after prior acceptance evidence is accepted.

## Likely file sets by future phase

| Phase | Primary files/directories expected to change |
|---|---|
| 1 | `api/migrations/*`, `api/src/{models,types,repositories,handlers,middleware,state}.rs`, `handlers/auth_jwt.rs`, `handlers/session.rs`, `handlers/rbac.rs`, `client/shared/src/{api,types}`, both clients, `pallets/access-control` |
| 2 | new organisation/facility/key repositories and migrations, `api/src/services`, route registry, `blockchain.rs`, new/extended registry pallet(s), `runtime/src/lib.rs`, node chain specs |
| 3 | `crypto/src/lib.rs`, new `api/src/key_management/*`, record/IPFS repositories, migrations, background jobs, `ipfs.rs`, clinical record handlers and tests |
| 4 | device migrations/repositories/services, auth middleware, device routes, mobile application security modules, push/remote logout and tests |
| 5 | emergency endpoints, access middleware, summary projection service, audit repository/outbox worker, `blockchain.rs`, NFC clients, browser/mobile cache handling, performance tests |
| 6 | `mobile-examples/expo-starter/*`, client record API/types, mobile-device routes, encrypted package service and Android/iOS test harnesses |
| 7 | Jitsi deployment, telehealth service/routes, transcription service adapters, event transport, retention migrations/repositories and consent UI |
| 8 | `node/*`, `runtime/*`, chain specs, Compose/operations docs, monitoring configuration and recovery test scripts |
| 9 | synthetic fixtures, deployment topology, cross-facility integration tests, operational runbooks and governance records |

## Required next verification step

Install or expose the MSVC C++ linker (`link.exe`), then run `cargo check --workspace`, `cargo test --workspace`, pallet-specific tests, and the database-backed integration suite before starting Phase 1. The successful frontend typechecks do not substitute for Rust, database, security, hardware or operational evidence.
