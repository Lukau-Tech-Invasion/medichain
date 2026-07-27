# MediChain — Complete Codex Implementation Handoff

## Purpose of this document

This document consolidates the full MediChain discussion into one implementation and planning brief that can be given directly to Codex. It combines:

- The product purpose and real-world healthcare flow.
- The implementation status reported from the current local development work.
- The architectural problems identified during discussion.
- The proposed solutions that have **not necessarily been implemented yet**.
- A staged roadmap for implementing, verifying and operating the system.
- Security, privacy, performance and failure-handling requirements.
- Clear instructions that prevent Codex from confusing completed local work with future architecture.

This is **not** a claim that every feature below already exists. Every item must be classified before implementation as one of:

1. **Reported implemented locally** — described in the local implementation record, but Codex must still inspect the current checkout.
2. **Partially implemented** — foundations exist, but the complete real-world guarantee has not been proven.
3. **Planned architecture** — agreed direction from the discussion, not yet assumed to exist.
4. **Operational work** — code may exist, but the system has not been run under realistic hospital conditions.
5. **Externally gated** — requires credentials, physical devices, legal review, hospital partners or production infrastructure.

---

# 1. Non-negotiable instructions for Codex

1. Use the name **MediChain** everywhere.
2. Treat the user’s current local checkout as the source of truth.
3. Do not assume that the public GitHub repository is current; substantial work has been implemented locally and may not yet be pushed.
4. Inspect the repository before changing anything.
5. Build an implementation inventory before coding:
   - what exists;
   - what is partial;
   - what is missing;
   - what conflicts with this architecture;
   - what is dead, duplicated or stale.
6. Preserve existing working features unless a migration plan explicitly replaces them.
7. Do not silently rewrite the entire application.
8. Prefer additive, versioned migrations over destructive changes.
9. Maintain backward compatibility while legacy encrypted records are being migrated.
10. Do not delete an old encryption key until the system proves that no live record or key envelope depends on it.
11. Never put plaintext medical information, plaintext data-encryption keys, hospital private keys, device private keys or complete clinical documents on the blockchain.
12. Do not make blockchain finality a blocking dependency for the three-second emergency response.
13. Do not allow a doctor’s professional role to expose that person’s private patient record.
14. Do not save downloaded medical records into ordinary phone Downloads, Documents or Gallery storage.
15. Do not retain every call recording and transcript forever merely because misuse is possible.
16. Do not claim production readiness based only on compilation and unit tests.
17. Every security-sensitive flow must include:
   - identity verification;
   - authorisation;
   - expiry;
   - revocation;
   - audit logging;
   - failure handling;
   - tests.

---

# 2. Product vision

MediChain is a blockchain-verified national or consortium healthcare platform intended to make critical patient information available during emergencies while preserving patient privacy, hospital independence and accountability.

The primary real-world scenario is:

1. A patient is unconscious or unable to communicate after an accident.
2. An authorised healthcare worker is already signed into MediChain on an approved hospital device.
3. The worker taps the patient’s NFC medical ID or scans a barcode/QR code.
4. The system identifies the patient using a protected identifier.
5. Critical emergency information appears in under three seconds.
6. The healthcare worker receives a temporary 15-minute emergency-access grant.
7. Access is limited to medically necessary information.
8. Every action is logged locally and anchored to the blockchain.
9. The access automatically expires and cannot silently continue.
10. The patient can later see who accessed the information and why.

The application also aims to support:

- Connected patient histories across hospitals and clinics.
- Separate databases and operational control for each facility.
- Secure patient access to results on mobile devices.
- Separate professional and personal identities for healthcare workers.
- Secure telehealth.
- Live transcription and language translation.
- Offline and low-connectivity operation.
- Immutable integrity and access evidence through a permissioned blockchain.

---

# 3. Current reported local implementation

Codex must verify each of these in the current checkout. They are reported as locally implemented or substantially implemented.

## 3.1 Core application and storage

Reported foundations include:

- Rust/Actix-web backend.
- React doctor portal.
- React patient application.
- Expo/React Native patient mobile foundation.
- PostgreSQL repository layer.
- In-memory development mode.
- Encrypted IPFS or encrypted document storage.
- Substrate blockchain node.
- Real `subxt` extrinsic submission.
- NFC and QR-based patient identity flows.
- FHIR support.
- Large clinical workflow coverage.

Clinical data persistence work reportedly migrated most important domains away from process memory and into PostgreSQL-backed repositories, including patient profiles, medical records, appointments, vital signs, laboratory workflows, prescriptions, insurance, wearables, telehealth, family groups, offline synchronisation and numerous specialised clinical records.

Multi-step operations reportedly use PostgreSQL transactions in important flows, and health/readiness endpoints detect database problems rather than pretending the service is healthy.

## 3.2 Authentication and access

Reported implementation includes:

- Wallet challenge-response authentication.
- JWT access and refresh tokens.
- Legacy/demo user header fallback.
- Role-based access control.
- TOTP MFA.
- Step-up authentication for sensitive actions.
- Persisted MFA enrolment with secrets encrypted at rest.
- Production secret validation.
- TLS reverse-proxy termination.
- HSTS and security headers.
- Rate limiting.
- Security alerts.
- Breach declaration flow.
- SMS security-officer notification support.
- Server-sent event notifications.

## 3.3 Existing encryption fix

The old failure was severe: a new encryption key was generated when the server restarted, making previously encrypted medical information unreadable.

The reported local fix introduced:

- A persistent `EncryptionKeyring`.
- Versioned keys loaded from an environment configuration such as `ENCRYPTION_KEYS`.
- A current active key version.
- Older retained versions.
- A patient-row `key_version`.
- Version-aware encryption and decryption.
- Lazy rotation: old rows migrate when they are rewritten.
- Version-aware encrypted IPFS handling.
- Encryption-required middleware.
- No public plaintext upload path.
- Ciphertext-versus-plaintext regression protection.

This is a valid fix for one deployment’s restart and rotation problem.

It is **not yet the complete multi-hospital key architecture** described later in this document.

## 3.4 Emergency and NFC foundations

Reported foundations include:

- NFC card hashing and verification.
- QR fallback.
- Provider emergency-access endpoint.
- Patient self-verification endpoint for the mobile app.
- Atomic patient-state check and access-log write.
- Emergency access represented on the blockchain.
- A documented three-second NFC performance goal.
- Time-limited access foundations.
- A blockchain default described as approximately 150 blocks or about 15 minutes.

Codex must not assume that the complete 15-minute guarantee is already enforced across every endpoint, screen, cache, downloaded document and offline state.

## 3.5 Mobile foundation

Reported mobile functionality includes:

- JWT API client.
- Secure token storage.
- Biometric authentication.
- Login.
- Emergency card.
- Medical records.
- Family linking.
- Offline queue and status.
- QR scanning.
- NFC self-verification.
- Type-checked source.

Still externally gated or not fully proven:

- Native development-client build.
- Physical NFC testing.
- Real Android and iOS secure-file containment.
- Lost-device revocation.
- Screenshot and export policy.
- Encrypted application-only downloads.
- Full remote invalidation behaviour.

## 3.6 Telehealth foundation

Reported functionality includes:

- Self-hosted Jitsi architecture.
- Jitsi JWT room credentials.
- Doctor and patient browser video.
- Moderator/participant mapping.
- Session lifecycle persistence.
- Consent and recording foundations.
- SSE event relay.
- Health checks.
- Mobile web joining.
- A pluggable transcription service.
- A Google Speech-to-Text implementation tested against a mock HTTP service.

Known blocker:

- The application does not yet have a complete server-side audio or recording artifact pipeline available to the transcription provider.
- The user now prefers self-hosted transcription rather than sending medical audio to Google.

## 3.7 Blockchain foundation

Reported functionality includes:

- A real Substrate node.
- Aura block production and GRANDPA finality components.
- Chain specifications.
- Real blockchain extrinsics for patient registration, medical-record hash updates and emergency access.
- Docker Compose integration.
- Wallet integration.

Not yet proven operationally:

- Sustained multi-validator operation.
- Validator loss.
- Finality under failure.
- Runtime upgrade.
- Backup and restore.
- Consortium governance.
- Validator key custody.
- Hospital-operated node onboarding.
- Production monitoring and on-call response.

---

# 4. Architecture principle: federation, not one central hospital system

MediChain must evolve from one secure deployment into a federated healthcare network.

Each hospital or clinic should remain an independent organisation with:

- Its own organisation identity.
- Its own database.
- Its own operational administrators.
- Its own approved staff.
- Its own approved devices.
- Its own private encryption keys.
- Its own audit trail and local availability.
- Optional blockchain validator responsibility.

The consortium provides shared:

- Organisation registration.
- Public-key discovery.
- Trust and revocation status.
- Patient identity resolution.
- Consent and emergency-grant coordination.
- Record integrity verification.
- Access auditing.
- Network governance.

Separate hospital databases reduce breach blast radius and preserve local control. They do **not** themselves make the blockchain secure. Blockchain security comes from independent validators, governance, consensus, monitoring and key custody.

---

# 5. Multi-hospital encryption architecture

## 5.1 The wrong designs

Do not implement either of these:

### One shared master key for every hospital

Consequences:

- One hospital compromise exposes the network.
- Rotation affects every organisation.
- No meaningful cryptographic separation.
- Difficult governance and incident containment.

### A direct key relationship between every pair of hospitals

For 200 hospitals, this creates up to 19,900 pairwise relationships.

Consequences:

- Manual or semi-manual key tracking.
- Rotation propagation failures.
- Difficult revocation.
- Complex onboarding and offboarding.
- Inconsistent trust state.

## 5.2 Correct model: consortium public-key registry

Every hospital manages only its own private keys.

MediChain maintains one trusted organisation-key directory containing public information:

- `organization_id`
- `facility_id`, where relevant
- `key_id`
- `key_version`
- `key_purpose`
- `algorithm`
- `public_key`
- `status`
- `valid_from`
- `valid_until`
- `retired_at`
- `revoked_at`
- `replaced_by`
- `certificate_fingerprint`
- `registration_transaction`
- `metadata_hash`

Key statuses should include:

- `pending`
- `active`
- `retiring`
- `retired`
- `revoked`
- `compromised`
- `destroyed`

Private keys remain only in the hospital’s KMS, HSM, operating-system keystore or approved secure device hardware.

Hospitals retrieve the current public key automatically from the registry. No hospital manually tracks the keys of the other 199 hospitals.

## 5.3 Envelope encryption

Every medical record or protected document receives a random data-encryption key (DEK).

Flow:

1. Generate a random 256-bit DEK.
2. Encrypt the medical content with the DEK using an authenticated encryption algorithm.
3. Store the ciphertext in PostgreSQL, private object storage or encrypted IPFS.
4. Wrap the DEK for the origin hospital.
5. Add additional recipient envelopes when another hospital is authorised.
6. Store envelope metadata off-chain.
7. Store hashes, provenance and access events on-chain.

Conceptual record:

```text
Encrypted Medical Record
    ├── Envelope for Hospital A key A-2026-07
    ├── Envelope for Hospital B key B-2026-08
    ├── Optional patient-device envelope
    └── Optional controlled emergency-service envelope
```

The medical document is not re-encrypted separately for each hospital. One ciphertext can have multiple small recipient envelopes.

## 5.4 Suggested database structures

```sql
organizations
-------------
id
name
type
status
parent_organization_id
created_at
suspended_at

facilities
----------
id
organization_id
name
facility_type
status
location
created_at

organization_keys
-----------------
id
organization_id
facility_id
key_id
version
purpose
algorithm
public_key
status
valid_from
valid_until
retired_at
revoked_at
replaced_by
created_at

record_crypto_metadata
----------------------
record_id
patient_id
origin_organization_id
origin_facility_id
crypto_profile
content_algorithm
nonce
aad_version
ciphertext_uri
ciphertext_hash
created_at

key_envelopes
-------------
id
record_id
recipient_type
recipient_id
recipient_key_id
wrapping_algorithm
wrapped_dek
access_grant_id
status
created_at
expires_at
revoked_at
superseded_by

key_rotation_jobs
-----------------
id
organization_id
old_key_id
new_key_id
job_type
status
records_total
records_completed
records_failed
started_at
completed_at

key_usage_index
---------------
key_id
resource_type
resource_id
envelope_id
active
last_verified_at
```

## 5.5 Key-management service boundary

Introduce a stable abstraction, not direct key operations scattered through handlers.

Example:

```rust
#[async_trait]
pub trait KeyManager {
    async fn generate_data_key(
        &self,
        context: &EncryptionContext,
    ) -> Result<GeneratedDataKey>;

    async fn wrap_for_recipient(
        &self,
        plaintext_dek: &[u8],
        recipient: &RecipientPublicKey,
    ) -> Result<KeyEnvelope>;

    async fn unwrap_envelope(
        &self,
        envelope: &KeyEnvelope,
    ) -> Result<Zeroizing<Vec<u8>>>;

    async fn rewrap_envelope(
        &self,
        source: &KeyEnvelope,
        new_recipient_key: &RecipientPublicKey,
    ) -> Result<KeyEnvelope>;

    async fn active_key_for(
        &self,
        organization_id: OrganizationId,
        purpose: KeyPurpose,
    ) -> Result<RecipientPublicKey>;

    async fn revoke_key(
        &self,
        key_id: KeyId,
        reason: RevocationReason,
    ) -> Result<()>;
}
```

Possible adapters:

- `LegacyDeploymentKeyringAdapter`
- `LocalDevelopmentKeyManager`
- `HospitalKmsAdapter`
- `Pkcs11HsmAdapter`
- `CloudKmsAdapter`
- `ConsortiumDirectoryClient`

---

# 6. How many keys a hospital needs

Do not think in terms of one master key per hospital.

A normal hospital or clinic needs a small set of long-term key purposes:

1. **Organisation identity/signing key**
   - Proves organisation-controlled actions.
   - Signs registration and administrative changes.

2. **Medical-record wrapping key**
   - Receives wrapped record DEKs.
   - Used for cross-hospital record access.

3. **Secure service communication certificate/key**
   - Protects service-to-service API communication.

4. **Recovery key**
   - Highly restricted.
   - Used only under approved recovery procedure.

5. **Device-issuing or device-authority key**
   - Issues credentials to approved hospital devices.
   - May be kept under an internal certificate authority.

6. **Validator/session keys**
   - Only when the hospital operates a blockchain validator.
   - Must remain separate from medical encryption keys.

The system will also generate:

- One device identity key per approved tablet, workstation, scanner or managed endpoint.
- One DEK per protected medical record or document.
- Recipient-specific key envelopes.
- Short-lived login tokens and emergency grants.

With 200 hospitals, the consortium directory may contain hundreds of active organisation-level keys and thousands of historical public-key versions. This is operationally small. The largest count will be record DEKs, potentially millions, but those are automatically managed and stored only in wrapped form.

---

# 7. Mandatory monthly rotation

The user requires a monthly key-change routine. Apply it by key purpose, not blindly to every key.

## 7.1 Monthly rotation candidates

Reasonable monthly rotation targets:

- Hospital device certificates.
- Workstation and tablet device credentials.
- Scanner and NFC-reader service credentials.
- Certain service-to-service credentials.
- Hospital operational wrapping keys, if performance and governance permit.
- Application secrets where supported by dual-key overlap.

## 7.2 Keys that should not be blindly rotated monthly

Use a controlled cryptoperiod for:

- Consortium root keys.
- Offline recovery keys.
- Blockchain governance keys.
- Cold storage authority keys.
- Record DEKs.
- Long-lived validator stash/root keys.

Validator session keys may rotate independently according to validator procedure.

## 7.3 Rotation workflow

At least seven days before rotation:

1. Generate the next key inside the correct secure boundary.
2. Register the new public key as `pending`.
3. Validate proof of possession.
4. Distribute trust metadata.
5. Test new credentials without switching all traffic.
6. Confirm every managed device can receive the update.

At activation:

1. Mark the new version `active`.
2. Mark the previous version `retiring`.
3. New encryption and new device authentication use the new key.
4. Existing data remains readable with the old key.
5. Begin lazy and background rewrapping.
6. Monitor failures.

During grace period:

1. Accept the old credential only for specifically permitted historical operations.
2. Alert on devices that did not rotate.
3. Quarantine non-compliant devices.
4. Retry delivery.
5. Escalate to facility administrators.

At retirement:

1. Confirm no new operations use the old key.
2. Confirm all required envelopes are migrated.
3. Mark old key `retired`.
4. Keep it in restricted historical-decryption custody while dependencies remain.
5. Destroy it only after the key-usage index proves no active dependency remains and policy authorises destruction.

## 7.4 Emergency compromise rotation

Different from scheduled rotation:

1. Mark key `compromised` or `revoked` immediately.
2. Stop new encryption to it.
3. Issue a new active key.
4. Find every dependent envelope.
5. Rewrap as a high-priority incident job.
6. Review access logs.
7. Notify security leadership.
8. Preserve evidence.
9. Apply legal and regulatory incident procedures.

---

# 8. Hospital device management

Every hospital device must have its own identity.

Devices include:

- Tablets.
- Nursing workstations.
- Doctor workstations.
- Emergency department kiosks.
- NFC readers.
- Barcode scanners.
- Mobile clinical devices.
- Telehealth endpoints.
- Laboratory terminals.
- Pharmacy terminals.

Suggested device model:

```sql
managed_devices
---------------
id
organization_id
facility_id
device_name
device_type
hardware_fingerprint
platform
ownership
status
current_key_id
last_seen_at
last_rotation_at
next_rotation_at
compliance_state
revoked_at
revocation_reason

device_keys
-----------
id
device_id
key_id
public_key
version
status
valid_from
valid_until
replaced_by
revoked_at
attestation_data
```

Required states:

- enrolled
- active
- rotation_due
- grace
- non_compliant
- quarantined
- lost
- stolen
- revoked
- retired

Rules:

- A device missing monthly rotation must not silently continue forever.
- A lost or stolen device is revoked immediately.
- One compromised device must not require the hospital’s entire key set to be replaced.
- Device authentication is separate from the logged-in clinician.
- Emergency access requires both an approved device and an authorised professional.
- Device revocation must invalidate access and cached decryption capability.
- All device lifecycle events are auditable.

---

# 9. Doctor work identity and personal patient identity

A single person may be both a healthcare professional and a patient.

Do not model this as one role field that changes between `Doctor` and `Patient`.

Required identity separation:

```text
Person
├── Patient Profile
│   ├── Medical ID
│   ├── Private medical record
│   └── Personal devices
└── Professional Identity
    ├── Licence/registration
    ├── Employment at Hospital A
    ├── Clinical role
    ├── Work devices
    └── Professional permissions
```

Suggested data model:

```sql
persons
-------
id
legal_identity_reference
status

patient_profiles
----------------
id
person_id
medical_id
status

professional_identities
-----------------------
id
person_id
professional_registration
profession
status

organization_assignments
------------------------
id
professional_identity_id
organization_id
facility_id
role
department
valid_from
valid_until
status

login_contexts
--------------
id
user_id
context_type
patient_profile_id
organization_assignment_id
created_at
expires_at
```

Required behaviour:

- The user explicitly enters `Work` or `My Health`.
- Professional permissions never carry into `My Health`.
- Patient permissions never permit clinical actions.
- A doctor cannot use professional access to open their own patient record unless an authorised clinical relationship and policy permit it.
- Access to colleagues’ records receives heightened monitoring.
- Switching context invalidates or replaces context-specific authorisation claims.
- Audit events include the person, active context, organisation, device and purpose.

JWT claims should represent context, not only a global role.

Example:

```json
{
  "sub": "person-id",
  "context": "professional",
  "organization_id": "hospital-a",
  "facility_id": "facility-1",
  "assignment_id": "assignment-id",
  "role": "doctor",
  "mfa": true
}
```

Personal context:

```json
{
  "sub": "person-id",
  "context": "patient",
  "patient_profile_id": "patient-id",
  "role": "patient"
}
```

---

# 10. Patient mobile access and encrypted downloads

The user wants patients to view and download results, but downloaded files must remain protected inside MediChain.

## 10.1 Required storage behaviour

Medical files must be stored in application-private encrypted storage.

Do not save readable PHI to:

- Downloads.
- Documents.
- Gallery.
- Shared external storage.
- Clipboard.
- Unprotected temporary files.
- Third-party viewer caches.

## 10.2 Device-bound encryption

Each registered patient device receives a device-bound key protected by:

- Android Keystore.
- Apple Keychain/Secure Enclave.
- Biometric or device-passcode policy.
- App-level session controls.

Flow:

1. Patient authenticates.
2. Device is registered and attested where possible.
3. MediChain creates or provisions a device-specific key.
4. A result is downloaded as ciphertext.
5. The application stores it only in private storage.
6. Decryption occurs only in memory or a protected temporary surface.
7. Copying the encrypted file to another device does not make it readable.

## 10.3 Required controls

- Biometric unlock.
- Device revocation.
- Remote logout.
- Token revocation.
- Local key invalidation.
- Offline expiry.
- Controlled export.
- Watermarking where appropriate.
- Screenshot and screen-recording policy.
- Root/jailbreak warning or restriction.
- App reinstall handling.
- Secure deletion.
- Last-synchronised timestamp.
- Stale-information warnings.
- Audit of view, export and share actions.

## 10.4 Offline emergency information

If an emergency summary is available offline:

- Keep it deliberately small.
- Encrypt it with the device-bound key.
- Give it a freshness timestamp.
- Show when it was last updated.
- Do not represent stale data as current.
- Allow revocation once the device reconnects.
- Do not store the complete longitudinal record as the emergency cache.

---

# 11. Emergency access: real-life data flow

## 11.1 Preconditions

To meet the three-second target:

- The nurse or doctor must already be signed in.
- The device must already be enrolled and trusted.
- The application must already be open or ready.
- The emergency summary must already exist.
- The summary must be indexed and available near the point of care.
- The flow must not assemble the full patient history.
- Blockchain finality must not block display.

## 11.2 End-to-end flow

1. Approved device reads NFC or barcode.
2. Card supplies only a protected patient/card identifier and integrity data.
3. Device sends:
   - card identifier;
   - healthcare-worker identity;
   - active work context;
   - organisation;
   - facility;
   - device identity;
   - emergency reason;
   - request ID;
   - timestamp.
4. Nearest MediChain hospital or regional hub verifies:
   - device status;
   - clinician session;
   - clinician role;
   - organisation membership;
   - card validity;
   - patient status;
   - revocation state.
5. System locates the precomputed emergency summary.
6. System decrypts the summary.
7. System writes a durable local access event/outbox record.
8. System creates a 15-minute emergency grant.
9. System returns only the emergency dataset.
10. UI renders the critical information.
11. Blockchain submission happens asynchronously.
12. Detailed records can load afterward under additional authorisation.
13. At expiry, the grant becomes unusable everywhere.

## 11.3 Emergency summary contents

Default emergency view should be limited to:

- Patient identity confirmation.
- Blood type.
- Severe allergies.
- Active high-risk medications.
- Serious chronic conditions.
- Critical diagnoses.
- Implants or devices.
- Pregnancy status where relevant and lawful.
- Verified DNR or advance directive.
- Emergency contacts.
- Recent critical alerts.
- Last-updated timestamp.
- Provenance.

Do not automatically expose:

- Complete psychiatric history.
- Complete reproductive history.
- Full notes.
- Unrelated historical records.
- All billing and insurance data.
- Every document attachment.

## 11.4 Three-second latency budget

Define the target precisely:

> From the moment an approved hospital device successfully reads the NFC card or barcode, 99% of valid emergency requests must display a usable critical emergency summary within three seconds under supported operating conditions.

Recommended budget:

| Stage | Target maximum |
|---|---:|
| NFC/barcode read and parsing | 250 ms |
| Device-to-nearest-hub network | 350 ms |
| User, device and card verification | 350 ms |
| Patient and emergency-summary lookup | 400 ms |
| Envelope resolution and decryption | 150 ms |
| Durable local audit/outbox write | 100 ms |
| Response transfer and UI rendering | 500 ms |
| Safety reserve | 900 ms |
| Total | 3,000 ms |

Internal service-level goals:

- Median: under 1.2 seconds.
- p95: under 2 seconds.
- p99: under 3 seconds.
- Every request over three seconds recorded as a performance failure.

## 11.5 Stage-level telemetry

Record at least:

- `scan_completed_at`
- `request_sent_at`
- `server_received_at`
- `device_verified_at`
- `clinician_verified_at`
- `patient_resolved_at`
- `summary_loaded_at`
- `summary_decrypted_at`
- `audit_committed_at`
- `response_sent_at`
- `screen_rendered_at`
- `blockchain_submitted_at`
- `blockchain_finalized_at`

Use one correlation/request ID.

## 11.6 Blockchain must not block emergency treatment

Required pattern:

1. Save a local durable audit event.
2. Put a blockchain event in an outbox.
3. Display emergency information.
4. Submit to blockchain.
5. Retry until anchored.
6. Alert if anchoring remains unsuccessful.

The emergency response must continue during temporary blockchain unavailability, but the local audit event must never be skipped.

## 11.7 Original hospital offline

Hospital B must not depend on Hospital A being online.

Use one or more:

- Regional encrypted emergency-summary replicas.
- Consortium emergency-summary service.
- Local authorised facility cache.
- Patient-device protected emergency summary.
- Carefully limited card payload as last resort.

The full longitudinal record can remain at origin facilities, but the minimum emergency dataset must be highly available.

---

# 12. The 15-minute access grant

A visual timer is not enough.

The grant must be a first-class server-side security object.

Suggested structure:

```sql
emergency_access_grants
-----------------------
id
patient_id
requesting_person_id
professional_identity_id
organization_id
facility_id
device_id
reason_code
reason_text
scope
issued_at
expires_at
revoked_at
revoked_reason
status
local_audit_id
blockchain_tx_hash
created_from_card_id
```

Required scopes:

- `emergency_summary`
- `selected_record`
- `full_record`, only under stronger policy
- `document_view`
- `download_prohibited`
- `offline_prohibited`

Every protected API request must verify:

- grant exists;
- status active;
- current time before expiry;
- patient matches;
- organisation matches;
- facility matches where required;
- device matches;
- clinician/session matches;
- requested scope is included;
- grant not revoked.

Expiry behaviour:

- API returns a specific expired-grant error.
- Frontend closes or masks the record.
- Further document fetches fail.
- Cached decrypted content is purged or locked.
- Download keys become unusable.
- SSE or websocket event informs all active clients.
- Audit event records expiry.
- Any continued request is logged as denied.

Test expiry while:

- Summary screen is open.
- A document is open.
- Device goes offline.
- Browser tab is suspended.
- Mobile app is backgrounded.
- User changes device time.
- Blockchain is unavailable.
- Clinician switches patient.
- Clinician switches from work to personal context.

Use server time, never client time, as authority.

---

# 13. Telehealth transcription and translation

## 13.1 Goal

Provide live transcription and translation during medical calls without unnecessarily sending sensitive audio to an external provider.

## 13.2 Recommended architecture

```text
Self-hosted Jitsi call
        ↓
Authenticated audio bridge / media pipeline
        ↓
Short audio frames in memory
        ↓
Self-hosted speech-to-text service
        ↓
Medical terminology normalisation
        ↓
Self-hosted translation service
        ↓
Live captions returned to participants
        ↓
Approved summary and audit handling
```

## 13.3 Server versus device

Primary processing should run on MediChain-controlled servers because:

- Consistent model versions.
- Central access control.
- Easier monitoring.
- Easier audit.
- Easier updates.
- Better performance control.
- No dependency on low-power patient devices.
- Better support for compliance retention rules.

Optional on-device processing can later support:

- Poor connectivity.
- Offline captions.
- Privacy-sensitive local mode.
- Edge fallback.

Do not make on-device processing the only compliance source.

## 13.4 Model components

Possible self-hosted speech-to-text:

- Whisper.
- `faster-whisper`.
- `whisper.cpp`.
- Another medically evaluated local ASR model.

Possible translation service:

- NLLB.
- M2M100.
- MarianMT.
- A domain-adapted multilingual model.
- A future specialised local model supporting South African languages.

Do not refer to “Whisper Flow” as required. Whisper is the model family; streaming orchestration is a separate implementation concern.

## 13.5 Missing integration to build

The reported code has Jitsi and a transcription provider abstraction, but the missing link is the media source.

Implement:

1. Server-side audio access from Jitsi.
2. Participant and channel identification.
3. Audio segmentation.
4. Voice activity detection.
5. Streaming transcription.
6. Language identification or explicit selected language.
7. Translation.
8. Caption events.
9. Error and confidence handling.
10. Consent state.
11. Recording/transcription indicator.
12. Audit events.
13. Retention routing.

## 13.6 Privacy and retention classes

Separate these data classes:

### Ephemeral audio frames

- Used for live transcription.
- Held in memory briefly.
- Deleted immediately after processing.
- Not retained by default.

### Live caption events

- Short-lived.
- Delivered to authorised participants.
- May be retained only when policy requires.

### Clinical summary

- Reviewed or approved by a clinician.
- Stored as part of the medical record.
- Must identify that it was machine-assisted.
- Must not silently replace clinical judgement.

### Full transcript

- Highly sensitive.
- Stored only for an explicit legal, clinical or compliance purpose.
- Encrypted separately.
- Restricted access.
- Fixed retention period.
- Legal-hold support.
- Tamper-evident hash.

### Audit metadata

May include:

- Session ID.
- Appointment/case ID.
- Participants.
- Organisation and facility.
- Start/end time.
- Transcription enabled.
- Languages.
- Model/version.
- Consent events.
- Access to transcript.
- Export events.
- Complaint/legal-hold status.

Audit metadata can prove legitimate use without retaining all raw audio.

## 13.7 Prevent non-medical misuse

A translation/transcription room must be linked to:

- A real appointment.
- An emergency case.
- A documented clinical workflow.
- A permitted healthcare purpose.

Require:

- Authenticated participants.
- Professional work context.
- Approved organisation.
- Patient relationship or consent.
- Session purpose.
- Automatic closure.
- Audit.
- Abuse reporting.

Do not allow unrestricted private rooms through the medical system.

---

# 14. Blockchain responsibilities

Use blockchain for:

- Organisation registration.
- Organisation public-key registration.
- Key activation, retirement and revocation.
- Patient identity references.
- Record ciphertext hashes.
- Provenance.
- Consent grants.
- Emergency-access events.
- Envelope-manifest hashes.
- Audit anchoring.
- Governance events.

Do not put on-chain:

- Plaintext PHI.
- Complete documents.
- Private keys.
- Plaintext DEKs.
- Passwords.
- Recovery secrets.
- Raw transcripts.
- Raw audio.
- Direct national identity numbers without a privacy-preserving design.

## 14.1 Suggested blockchain additions

Potential pallets or storage maps:

- `OrganizationRegistry`
- `OrganizationKeyRegistry`
- `FacilityRegistry`
- `EmergencyGrantRegistry`
- `RecordIntegrityRegistry`
- `AuditAnchorRegistry`

Events:

- `OrganizationRegistered`
- `OrganizationSuspended`
- `FacilityRegistered`
- `PublicKeyAdded`
- `PublicKeyActivated`
- `PublicKeyRetired`
- `PublicKeyRevoked`
- `EmergencyGrantIssued`
- `EmergencyGrantExpired`
- `EmergencyGrantRevoked`
- `RecordHashAnchored`
- `AuditBatchAnchored`

Do not put every high-volume read event directly on-chain synchronously. Use local audit storage, batching and hash anchoring where appropriate.

---

# 15. Blockchain network operationalisation

Code existence is not network readiness.

## 15.1 Initial network

Recommended starting point:

- Four independent validators as the minimum fault-tolerant consortium set.
- Grow toward seven as additional organisations join.
- Validators operated by different trusted organisations.
- Separate governance authority from routine session keys.

## 15.2 Required tests

- Continuous block production.
- Continuous finality.
- Kill one of four validators.
- Network partition.
- Validator restart.
- Database or RocksDB recovery.
- Key rotation.
- Validator onboarding.
- Validator offboarding.
- Runtime upgrade.
- Failed runtime upgrade.
- Monitoring outage.
- API operating while chain is temporarily unavailable.
- Audit outbox replay after chain recovery.

## 15.3 Key separation

Keep distinct:

- Organisation medical wrapping keys.
- Organisation signing keys.
- Validator stash/root keys.
- Validator session keys.
- Node identity keys.
- TLS certificates.
- Recovery keys.

A medical-key incident must not compromise consensus. A validator-key incident must not decrypt medical data.

## 15.4 Operations

Create procedures for:

- Session-key generation.
- No copying of session keys between validators.
- Cold storage.
- Backup.
- Restore drills.
- Runtime-upgrade rehearsal.
- Rollback or emergency recovery.
- Monitoring and alerts.
- Finality lag.
- Peer count.
- Node liveness.
- Disk usage.
- On-call escalation.
- Incident reporting.

---

# 16. Cross-hospital patient journey

Use this scenario for implementation testing.

## Step 1: Clinic A registers patient

- Resolve or create canonical person.
- Create patient profile.
- Issue medical ID.
- Register NFC/card.
- Generate emergency summary.
- Encrypt new records with per-record DEKs.
- Wrap DEKs for Clinic A.
- Anchor patient and record integrity data.

## Step 2: Patient visits Hospital B

- Resolve the same patient identity.
- Verify consent or permitted care relationship.
- Discover Hospital B’s active public wrapping key.
- Create a recipient envelope for Hospital B.
- Hospital B retrieves ciphertext.
- Hospital B decrypts locally.
- Preserve origin and provenance.
- Hospital B creates new local records with Hospital B as origin.

## Step 3: Hospital B rotates key

- Publish new key.
- New envelopes use the new key.
- Old key remains available for historical envelopes.
- Lazy and background rewrapping begins.
- No medical file needs full re-encryption merely because the hospital key changed.

## Step 4: Patient views result on phone

- Patient enters personal context.
- Device authenticates biometrically.
- Result remains encrypted in application-private storage.
- No readable copy appears in Downloads or Gallery.
- View is audited.
- Lost phone can be revoked.

## Step 5: Emergency at Hospital C

- Clinician already logged in on approved device.
- Tap card.
- Get emergency summary in under three seconds.
- Issue 15-minute grant.
- Hospital A or B being offline does not block minimum emergency information.
- Access logged locally and anchored asynchronously.

## Step 6: Telehealth follow-up

- Session linked to appointment.
- Participants authenticated.
- Self-hosted Jitsi.
- Self-hosted transcription and translation.
- Raw audio frames deleted.
- Clinician-approved summary stored.
- Full transcript retained only under explicit policy.

---

# 17. API additions and service boundaries

Codex must inspect existing routes before adding anything.

Potential services:

- `OrganizationService`
- `FacilityService`
- `OrganizationKeyService`
- `KeyEnvelopeService`
- `DeviceManagementService`
- `IdentityContextService`
- `EmergencyGrantService`
- `EmergencySummaryService`
- `AuditOutboxService`
- `TranscriptRetentionService`
- `TranslationService`
- `BlockchainAnchorService`

Potential routes:

```text
POST   /api/organizations
GET    /api/organizations/{id}
POST   /api/organizations/{id}/keys
POST   /api/organizations/{id}/keys/{key_id}/activate
POST   /api/organizations/{id}/keys/{key_id}/retire
POST   /api/organizations/{id}/keys/{key_id}/revoke
GET    /api/organizations/{id}/keys/active

POST   /api/devices/enroll
POST   /api/devices/{id}/rotate
POST   /api/devices/{id}/revoke
GET    /api/devices/compliance

POST   /api/identity/context/work
POST   /api/identity/context/patient
POST   /api/identity/context/switch

POST   /api/records/{id}/envelopes
POST   /api/records/{id}/envelopes/rewrap
GET    /api/records/{id}/envelopes

POST   /api/emergency/access
GET    /api/emergency/grants/{id}
POST   /api/emergency/grants/{id}/revoke
GET    /api/emergency/summary/{patient_id}

POST   /api/mobile/devices/register
POST   /api/mobile/devices/{id}/revoke
POST   /api/mobile/records/{id}/offline-package

POST   /api/telehealth/sessions/{id}/transcription/start
POST   /api/telehealth/sessions/{id}/transcription/stop
GET    /api/telehealth/sessions/{id}/captions
POST   /api/telehealth/sessions/{id}/summary/approve
POST   /api/telehealth/sessions/{id}/legal-hold
```

All new writes should support idempotency where retries can occur.

---

# 18. Audit architecture

Use an append-only local audit record plus blockchain anchoring.

Audit record should include:

- Event ID.
- Correlation ID.
- Timestamp.
- Actor person.
- Active identity context.
- Professional assignment.
- Organisation.
- Facility.
- Device.
- Patient.
- Resource.
- Action.
- Purpose.
- Grant.
- Decision.
- Outcome.
- Denial reason.
- Key IDs involved, never private keys.
- Source IP/network context.
- Integrity hash.
- Previous-event hash where useful.
- Blockchain status.

Use an outbox:

```sql
audit_outbox
------------
id
event_id
payload_hash
payload
status
attempt_count
next_attempt_at
last_error
created_at
anchored_at
blockchain_tx_hash
```

---

# 19. Failure scenarios that must be designed and tested

## Encryption and keys

- Server restart.
- Missing current key.
- Missing old key.
- Wrong key version.
- Corrupted envelope.
- Revoked hospital key.
- Compromised key.
- Rotation interrupted halfway.
- KMS unavailable.
- Recipient key changes during sharing.
- Old-key destruction attempted with active dependencies.

## Hospitals

- Origin hospital offline.
- Recipient hospital suspended.
- Hospital removed from consortium.
- Facility closed.
- Organisation merger.
- Database unavailable.
- Conflicting patient identity.
- Duplicate patient record.

## Devices

- Device misses monthly rotation.
- Device clock incorrect.
- Device stolen.
- Device offline for months.
- Device cloned.
- Rooted/jailbroken patient phone.
- App reinstalled.
- Secure hardware unavailable.

## Emergency access

- Blockchain unavailable.
- Local database unavailable.
- Regional cache stale.
- Card revoked.
- Card cloned.
- Wrong patient.
- Grant expires during active view.
- Clinician logs out.
- Work context changes.
- Device revoked during 15-minute window.
- Patient later disputes access.

## Telehealth

- Audio bridge unavailable.
- STT model overloaded.
- Translation unavailable.
- Low-confidence transcription.
- Wrong language selected.
- Participant does not consent.
- Session is not linked to a medical case.
- Transcript requested after deletion.
- Legal hold created before scheduled deletion.
- Model output contains harmful clinical mistranslation.

---

# 20. Test programme

## 20.1 Unit tests

- Key-status transitions.
- Key-version selection.
- Envelope wrapping and unwrapping.
- Grant expiry.
- Scope enforcement.
- Device compliance state.
- Identity-context separation.
- Emergency-summary filtering.
- Retention calculations.
- Translation confidence handling.

## 20.2 Integration tests

- PostgreSQL plus KMS adapter.
- Hospital A to Hospital B envelope sharing.
- Rotation and rewrapping.
- Revocation.
- Mobile encrypted package.
- Emergency grant on every protected endpoint.
- Audit outbox replay.
- Blockchain retry.
- Jitsi audio to local STT.
- Caption delivery.

## 20.3 End-to-end tests

- Clinic A → Hospital B → patient phone → Hospital C emergency.
- Doctor work context → personal patient context.
- 15-minute expiry with open screens.
- Lost hospital tablet.
- Lost patient phone.
- Monthly rotation across mixed devices.
- Original hospital offline.
- Blockchain validator offline.
- Telehealth with transcription and translation.

## 20.4 Performance tests

Test:

- Warm and cold cache.
- 2G/3G/4G/Wi-Fi.
- 100, 1,000 and larger concurrent emergency requests.
- Large patient history.
- Old and new key versions.
- Regional replica.
- Cross-hospital resolution.
- Blockchain unavailable.
- Database failover.

Report:

- Median.
- p90.
- p95.
- p99.
- Error rate.
- Requests over three seconds.
- Time by stage.

## 20.5 Security tests

- Privilege escalation.
- Work-to-patient context leakage.
- Self-access abuse.
- Colleague-record access.
- Device impersonation.
- Card cloning.
- Replay.
- Token theft.
- Expired emergency grant.
- Key-directory tampering.
- Compromised hospital key.
- Transcript unauthorised access.
- Offline-package extraction.
- Screenshot/export leakage.

---

# 21. Legal, privacy and clinical governance

The implementation must support policy decisions; code alone cannot decide them.

Required governance decisions:

- Emergency-data scope.
- Transcript retention.
- Raw recording retention.
- Legal hold.
- Patient notification.
- Minor and guardian access.
- Doctor self-access.
- Break-glass access.
- Hospital onboarding.
- Key revocation authority.
- Consortium governance.
- Validator ownership.
- Data residency.
- Incident reporting.
- Record correction.
- Patient identity disputes.
- Device loss.
- Facility suspension.

Before real patient data:

- Information Officer review.
- South African privacy/legal review.
- Clinical safety review.
- Independent penetration test.
- Disaster-recovery exercise.
- Controlled pilot.
- Clear patient and clinician consent language.
- Formal retention schedule.

---

# 22. Implementation roadmap

Do not implement everything in one uncontrolled pass.

## Phase 0 — Inventory and reconciliation

1. Inspect the full local repository.
2. Produce a capability manifest.
3. Map current implementation to this document.
4. Label each item:
   - verified;
   - partial;
   - missing;
   - conflicting;
   - externally gated.
5. Identify existing schemas, services and routes that can be extended.
6. Run current tests and save a baseline.
7. Make no architectural changes until inventory is complete.

Deliverable:

- `docs/MEDICHAIN_FEDERATION_GAP_ANALYSIS.md`
- Machine-readable manifest.
- Baseline test report.

## Phase 1 — Identity and trust model

Implement or refactor:

- `Person`
- `PatientProfile`
- `ProfessionalIdentity`
- `Organization`
- `Facility`
- `OrganizationAssignment`
- `Device`
- `LoginContext`

Add context-specific tokens and tests.

Acceptance:

- A doctor can enter Work and My Health separately.
- No work permission leaks into patient context.
- Existing authentication still works during migration.

## Phase 2 — Organisation and public-key registry

Implement:

- Organisation membership.
- Facility membership.
- Public keys by purpose and version.
- Key status transitions.
- Proof of possession.
- Revocation.
- Local cache.
- Blockchain events.

Acceptance:

- Hospital A can resolve Hospital B’s current public wrapping key.
- Rotation is visible without manual reconfiguration.
- Revoked keys cannot receive new envelopes.

## Phase 3 — Envelope encryption

Implement:

- Per-record DEKs.
- Key envelopes.
- Legacy-keyring migration adapter.
- Rewrap jobs.
- Key usage index.
- Backward-compatible reads.

Acceptance:

- Old records remain readable.
- New records use envelope encryption.
- One hospital can share with another without sharing private keys.
- Hospital rotation does not require full document re-encryption.

## Phase 4 — Device lifecycle and monthly rotation

Implement:

- Device enrolment.
- Device credentials.
- Automated monthly rotation.
- Grace period.
- Compliance state.
- Immediate revocation.
- Lost/stolen flow.

Acceptance:

- Device rotates without manual key replacement.
- Missed rotation causes visible non-compliance.
- Revoked device cannot access records.
- One device compromise does not break the hospital.

## Phase 5 — Emergency summary and grant enforcement

Implement:

- Precomputed emergency summary.
- Regional/high-availability access.
- First-class 15-minute grant.
- Server-time expiry.
- Endpoint-wide enforcement.
- Client closure and cache invalidation.
- Audit outbox.

Acceptance:

- p99 under three seconds in defined conditions.
- Blockchain outage does not block display.
- Access stops after 15 minutes.
- Origin hospital outage does not block minimum summary.

## Phase 6 — Secure mobile records

Implement:

- Device-bound key.
- Application-private encrypted storage.
- Revocation.
- Offline expiry.
- Safe viewing.
- Controlled export.
- Reinstall/lost-device behaviour.

Acceptance:

- No plaintext result in shared storage.
- Copied encrypted package is unreadable elsewhere.
- Revoked device loses access.
- Offline state shows freshness.

## Phase 7 — Self-hosted transcription and translation

Implement:

- Jitsi media bridge.
- Local STT.
- Local translation.
- Caption events.
- Consent.
- Retention classes.
- Clinical summary approval.
- Legal hold.

Acceptance:

- Medical audio does not leave controlled infrastructure.
- Audio frames are deleted after processing by default.
- Only authorised sessions can start transcription.
- Retention policy is enforced.

## Phase 8 — Blockchain testnet operationalisation

Implement and run:

- Four-validator testnet.
- Validator loss test.
- Monitoring.
- Backup.
- Restore.
- Runtime upgrade rehearsal.
- Audit outbox replay.

Acceptance:

- One of four validators can fail without losing expected finality.
- Upgrade is rehearsed.
- Node recovery is documented and tested.

## Phase 9 — Multi-hospital pilot

Use synthetic data first.

Pilot scenario:

- Multiple independent facility databases.
- Multiple organisation keys.
- Multiple devices.
- Multiple user contexts.
- Cross-hospital patient journey.
- Emergency access.
- Telehealth.
- Offline operation.
- Key rotation during pilot.

Do not replace existing clinical systems initially. Run shadow mode.

---

# 23. Definition of done for real-world readiness

MediChain is not ready for real patients until all of these are true:

- No critical PHI is lost on restart.
- No plaintext upload or mobile-download path exists.
- Multi-hospital private keys are isolated.
- Key rotation and revocation work.
- Old records survive rotation.
- Doctor and patient contexts are separate.
- Devices are individually enrolled and revocable.
- Three-second p99 emergency target is proven.
- Fifteen-minute expiry is enforced end to end.
- Original hospital outage does not block minimum emergency data.
- Blockchain outage does not block immediate emergency response.
- Audit events are durable and eventually anchored.
- Self-hosted transcription is privacy controlled.
- Retention is policy driven.
- Physical NFC is tested.
- Mobile secure storage is tested on Android and iOS.
- Multi-validator network is tested.
- Backup and recovery are tested.
- Independent security review is complete.
- Clinical safety review is complete.
- Privacy/legal review is complete.
- Controlled pilot is complete.

---

# 24. Immediate Codex assignment

Start with **Phase 0 only**.

Codex should:

1. Inspect the entire local MediChain repository.
2. Read all architecture, implementation-plan, security, encryption, emergency-access, mobile, telehealth, blockchain and deployment files.
3. Enumerate every:
   - API route;
   - database table;
   - repository;
   - encryption call site;
   - key source;
   - key version field;
   - mobile storage path;
   - device concept;
   - identity/role concept;
   - emergency grant;
   - NFC/QR flow;
   - Jitsi/transcription component;
   - blockchain pallet, call and event;
   - audit event;
   - test.
4. Compare the implementation with this handoff.
5. Do not implement future phases yet.
6. Produce:
   - verified status matrix;
   - contradictions;
   - missing foundations;
   - migration risks;
   - recommended branch/commit plan;
   - exact files likely to change in each later phase;
   - test baseline.
7. Preserve all current working behaviour.
8. Do not commit unless explicitly asked.

Suggested first prompt to Codex:

> Treat the current local MediChain repository as the source of truth. Read `MEDICHAIN_CODEX_IMPLEMENTATION_HANDOFF.md` completely, then perform Phase 0 only. Inspect the repository from the first line to the last relevant line and create a verified implementation-gap analysis. Do not assume the public GitHub repository is current. Do not implement the proposed multi-hospital architecture yet. First identify what is already implemented, partially implemented, missing, duplicated or conflicting. Map every finding to concrete files, routes, schemas, services, tests and migration risks. Run the existing test and build commands, preserve the baseline, and produce an ordered implementation plan for Phases 1–9. Do not delete working code and do not make commits unless explicitly instructed.

---

# 25. Final architectural summary

MediChain should not be rebuilt from zero. Its existing local implementation reportedly already includes substantial clinical persistence, encryption, authentication, telehealth, mobile, blockchain, monitoring and testing foundations.

The required evolution is:

- from one deployment-wide keyring to hospital-isolated envelope encryption;
- from global roles to person, patient and professional contexts;
- from ordinary application sessions to managed hospital-device identities;
- from a nominal emergency timer to end-to-end 15-minute grant enforcement;
- from generic record retrieval to a precomputed high-availability emergency summary;
- from normal mobile downloads to device-bound encrypted application storage;
- from external transcription dependency to self-hosted medical transcription and translation;
- from a runnable blockchain node to an operated consortium network.

The desired outcome is a federated healthcare network in which independent hospitals and clinics can cooperate without sharing one master secret, patients can move between facilities without losing their medical history, authorised workers can retrieve critical information in under three seconds, access automatically closes after 15 minutes, and every action remains protected and accountable.
