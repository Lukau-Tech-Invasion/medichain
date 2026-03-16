# MediChain Database Schema Documentation

© 2025 Trustware. All rights reserved.

---

## Overview

MediChain uses a **hybrid storage architecture**:
1. **On-chain storage**: Substrate blockchain for immutable metadata, access control, and audit trails
2. **Off-chain storage**: IPFS for encrypted medical documents
3. **In-memory cache**: REST API server for session data and real-time access

This document describes all data structures used across the system.

---

## Table of Contents

1. [Blockchain Pallets](#blockchain-pallets)
2. [API Data Types](#api-data-types)
3. [Clinical Documentation Types](#clinical-documentation)
4. [IPFS Storage Types](#ipfs-storage)
5. [HL7 FHIR Mappings](#fhir-mappings)

---

## 1. Blockchain Pallets {#blockchain-pallets}

### 1.1 Access Control Pallet

**Storage Items:**

| Name | Type | Description |
|------|------|-------------|
| `UserRoles` | `StorageMap<AccountId, Role>` | Maps accounts to their roles |
| `ActiveAccess` | `StorageDoubleMap<AccountId, AccountId, AccessLog>` | Active access grants (patient → accessor) |
| `AccessCount` | `StorageMap<AccountId, u32>` | Count of active accesses per patient |

**Types:**

```rust
enum Role {
    Admin,        // System administrator
    Doctor,       // Licensed physician
    Nurse,        // Registered nurse
    LabTechnician,// Laboratory staff
    Pharmacist,   // Licensed pharmacist
    Patient,      // End user (read-only)
}

enum AccessType {
    Emergency,    // Time-limited emergency access
    Regular,      // Patient-granted access
    Full,         // Primary care provider
}

struct AccessLog<T> {
    accessor: AccountId,
    access_type: AccessType,
    granted_at: BlockNumber,
    expires_at: BlockNumber,
    reason_hash: [u8; 32],
    revoked: bool,
}
```

### 1.2 Patient Identity Pallet

**Storage Items:**

| Name | Type | Description |
|------|------|-------------|
| `Patients` | `StorageMap<PatientId, Patient>` | Patient metadata |
| `NationalIdToPatient` | `StorageMap<IdHash, PatientId>` | National ID lookup (hashed) |
| `PatientCount` | `StorageValue<u64>` | Total registered patients |

**Types:**

```rust
struct Patient<T> {
    patient_id: PatientId,
    id_hash: [u8; 32],         // SHA-256 of national ID
    id_type: NationalIdType,
    registered_by: AccountId,
    registered_at: BlockNumber,
    is_active: bool,
}

enum NationalIdType {
    FaydaId,           // Ethiopia
    GhanaCard,         // Ghana
    NigeriaNIN,        // Nigeria
    SouthAfricaSmartId,// South Africa
    KenyaHuduma,       // Kenya
    Other,
}
```

### 1.3 Medical Records Pallet

**Storage Items:**

| Name | Type | Description |
|------|------|-------------|
| `HealthRecords` | `StorageMap<PatientId, HealthRecord>` | Health record metadata |
| `MedicalAlerts` | `StorageMap<PatientId, BoundedVec<Alert>>` | Active medical alerts |
| `RecordCount` | `StorageValue<u64>` | Total records |

**Types:**

```rust
struct HealthRecord<T> {
    patient_id: PatientId,
    ipfs_hash: IpfsHash,       // Encrypted document hash
    record_type: RecordType,
    created_by: AccountId,
    created_at: BlockNumber,
    last_modified_by: AccountId,
    updated_at: BlockNumber,
}

struct Alert<T> {
    alert_type: AlertType,
    severity: AlertSeverity,
    description: BoundedVec<u8>,
    created_at: BlockNumber,
    created_by: AccountId,
    is_active: bool,
}

enum AlertType {
    Allergy,
    DrugInteraction,
    ChronicCondition,
    CriticalVital,
    LabResult,
    Custom,
}

enum AlertSeverity {
    Low,
    Medium,
    High,
    Critical,
}
```

---

## 2. API Data Types {#api-data-types}

### 2.1 User & Authentication

```typescript
interface User {
    user_id: string;
    username: string;
    role: Role;
    created_at: DateTime;
    created_by: string | null;
}

type Role = 'Admin' | 'Doctor' | 'Nurse' | 'LabTechnician' | 'Pharmacist' | 'Patient';
```

### 2.2 Patient Profile

```typescript
interface PatientProfile {
    patient_id: string;
    full_name: string;
    date_of_birth: string;           // ISO 8601
    national_id: string;
    emergency_info: EmergencyInfo;
    address?: Address;
    insurance?: InsuranceInfo;
    primary_doctor?: HealthcareProvider;
    community_health_worker?: HealthcareProvider;
    preferences: PatientPreferences;
    advanced_directives: AdvancedDirectives[];
    family_notifications?: FamilyNotificationSettings;
    created_at: DateTime;
    last_updated: DateTime;
}

interface EmergencyInfo {
    patient_id: string;
    blood_type: BloodType;
    allergies: Allergy[];
    current_medications: string[];
    chronic_conditions: string[];
    emergency_contacts: EmergencyContact[];
    organ_donor: boolean;
    dnr_status: boolean;
    languages: string[];             // ISO 639-1 codes
    last_updated: DateTime;
}

type BloodType = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';

interface Allergy {
    name: string;
    severity: 'Mild' | 'Moderate' | 'Severe' | 'Unknown';
    reaction?: string;
    verified_at?: DateTime;
}

interface EmergencyContact {
    name: string;
    phone: string;                   // E.164 format
    relationship: string;
    priority: number;                // 1 = primary
    can_make_medical_decisions: boolean;
    language?: string;
}
```

### 2.3 Address & Insurance

```typescript
interface Address {
    street?: string;
    city: string;
    state?: string;
    country: string;                 // ISO 3166-1 alpha-2
    postal_code?: string;
    coordinates?: GeoCoordinates;    // For rural areas
}

interface GeoCoordinates {
    latitude: number;
    longitude: number;
}

interface InsuranceInfo {
    provider: string;
    policy_number: string;
    group_number?: string;
    valid_from: string;              // ISO 8601
    valid_to: string;
    coverage_type: CoverageType;
    is_active: boolean;
}

type CoverageType = 'Public' | 'Private' | 'Employer' | 'NHIS' | 'Community' | 'None';
```

### 2.4 NFC Card System

```typescript
interface NFCCard {
    card_id: string;
    patient_id: string;
    card_hash: string;               // SHA-256
    national_id_type: NationalIdType;
    status: CardStatus;
    created_at: number;              // Unix timestamp
    last_used_at?: number;
}

type CardStatus = 'Active' | 'Suspended' | 'Revoked';

interface QRCodeData {
    version: number;
    card_hash: string;
    patient_id: string;
    timestamp: number;
    expires_at: number;
    checksum: string;
}
```

### 2.5 Lab Results

```typescript
interface LabResultSubmission {
    id: string;
    patient_id: string;
    patient_name: string;
    test_name: string;
    test_category: string;
    results: LabTestResult[];
    notes?: string;
    submitted_by: string;
    submitted_at: DateTime;
    status: 'pending' | 'approved' | 'rejected';
    reviewed_by?: string;
    reviewed_at?: DateTime;
    rejection_reason?: string;
    content_hash?: string;           // IPFS hash (after approval)
    metadata_hash?: string;
}

interface LabTestResult {
    parameter: string;
    value: string;
    unit: string;
    reference_range: string;
    flag?: 'HIGH' | 'LOW' | 'CRITICAL';
}
```

```

## 2.6 Postgres Indexer (Off-chain)

To support fast queries, reporting, and joins that are inefficient on-chain, the API maintains an off-chain Postgres indexer. The indexer ingests blockchain events and API actions and stores denormalized views for read-heavy operations.

Key design points:
- The indexer is eventual-consistent and replayable from block/event logs.
- Tables include `patients`, `users`, `health_records`, `lab_submissions`, `access_logs`, and `nfc_cards`.
- Each table includes `source_block` (u64) and `source_tx` (varchar) for traceability to the on-chain event.
- Soft-delete is handled by an `archived` boolean flag rather than physical deletes.

Example high-level table schemas:

``sql
CREATE TABLE patients (
    patient_id UUID PRIMARY KEY,
    full_name TEXT NOT NULL,
    date_of_birth DATE,
    id_hash BYTEA, -- SHA-256
    registered_by TEXT,
    registered_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    archived BOOLEAN DEFAULT FALSE,
    source_block BIGINT,
    source_tx TEXT
);

CREATE TABLE health_records (
    id UUID PRIMARY KEY,
    patient_id UUID REFERENCES patients(patient_id),
    ipfs_hash TEXT,
    record_type TEXT,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    last_modified_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE,
    archived BOOLEAN DEFAULT FALSE,
    source_block BIGINT,
    source_tx TEXT
);

CREATE TABLE access_logs (
    id UUID PRIMARY KEY,
    patient_id UUID,
    accessor TEXT,
    access_type TEXT,
    granted_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    reason_hash BYTEA,
    revoked BOOLEAN DEFAULT FALSE,
    source_block BIGINT,
    source_tx TEXT
);
```

Indexer migration/versioning:
- Use `diesel` or `sqlx` migrations managed alongside the `api/` code. Include a `schema_version` table with migration timestamps.
- Provide `POSTGRES_SETUP.md` with sample connection strings and `docker-compose` snippets.

---

## Migration Notes

When deploying the Postgres indexer you must run migrations before starting the API server. The indexer expects the following notable schema additions compared to the original on-chain-only model:

- `archived BOOLEAN DEFAULT FALSE` on read tables to support soft-deletes and safe recovery.
- `source_block BIGINT` and `source_tx TEXT` on denormalized tables to link back to the on-chain event that produced the row.
- UUID primary keys for indexer tables (separate from on-chain numeric IDs) to support joins and external integrations.

Recommended migration steps (example using `sqlx`):

```bash
# from repository root
cd api
# ensure DATABASE_URL is set in env or .env
export DATABASE_URL=postgres://medichain:password@localhost:5432/medichain
cargo install sqlx-cli --no-default-features --features postgres
sqlx migrate run --source ../migrations
```

If you use `diesel` instead, maintain `diesel` migrations under `api/migrations` and run:

```bash
diesel migration run --database-url $DATABASE_URL
```

After successful migrations, start the API server and the indexer worker (if separate). The indexer can be replayed from a given block by providing `START_BLOCK` env var to the worker.


## 3. Clinical Documentation Types {#clinical-documentation}

### 3.1 Triage & Assessment

```typescript
interface TriageAssessment {
    assessment_id: string;
    patient_id: string;
    esi_level: 1 | 2 | 3 | 4 | 5;
    chief_complaint: string;
    vital_signs: TriageVitalSigns;
    pain_scale?: number;             // 0-10
    notes?: string;
    performed_by: string;
    performed_at: number;
}

interface TriageVitalSigns {
    heart_rate?: number;
    systolic_bp?: number;
    diastolic_bp?: number;
    respiratory_rate?: number;
    oxygen_saturation?: number;
    temperature_celsius?: number;
}

// ESI Level Reference:
// 1 = Immediate (cardiac arrest, severe trauma)
// 2 = Emergent (chest pain, stroke symptoms)
// 3 = Urgent (abdominal pain, fractures)
// 4 = Less Urgent (minor injuries)
// 5 = Non-Urgent (prescription refills)
```

### 3.2 SOAP Notes

```typescript
interface SOAPNote {
    note_id: string;
    patient_id: string;
    encounter_type: string;
    subjective: SubjectiveSection;
    objective: ObjectiveSection;
    assessment: AssessmentSection;
    plan: PlanSection;
    author_id: string;
    created_at: number;
    updated_at?: number;
    status: 'active' | 'amended' | 'entered_in_error';
    addenda: SOAPAddendum[];
}

interface SubjectiveSection {
    chief_complaint: string;
    history_of_present_illness: string;
    review_of_systems: ReviewOfSystems;
    past_medical_history?: string;
    medications?: string[];
    allergies?: string[];
    social_history?: string;
    family_history?: string;
}

interface ObjectiveSection {
    vital_signs: VitalSigns;
    physical_exam: PhysicalExam;
    diagnostic_results?: string[];
}

interface AssessmentSection {
    diagnoses: Diagnosis[];
    differential_diagnoses?: string[];
    clinical_impression: string;
}

interface PlanSection {
    treatments: Treatment[];
    medications: MedicationOrder[];
    labs_ordered?: string[];
    imaging_ordered?: string[];
    referrals?: string[];
    patient_education?: string;
    follow_up?: string;
    disposition: string;
}
```

### 3.3 Glasgow Coma Scale

```typescript
interface GlasgowComaScale {
    assessment_id: string;
    patient_id: string;
    eye_response: 1 | 2 | 3 | 4;
    verbal_response: 1 | 2 | 3 | 4 | 5;
    motor_response: 1 | 2 | 3 | 4 | 5 | 6;
    total_score: number;             // 3-15 (auto-calculated)
    pupil_assessment?: PupilAssessment;
    notes?: string;
    performed_by: string;
    performed_at: number;
}

// Interpretation:
// 15 = Normal
// 13-14 = Mild impairment
// 9-12 = Moderate impairment
// 3-8 = Severe impairment (comatose)
// ≤8 = Airway protection needed
```

### 3.4 Emergency Protocols

```typescript
interface CodeBlueRecord {
    event_id: string;
    patient_id: string;
    code_start_time: number;
    code_end_time?: number;
    location: string;
    initial_rhythm: CardiacRhythm;
    interventions: CodeIntervention[];
    medications: CodeMedication[];
    defibrillations: Defibrillation[];
    outcome: CodeOutcome;
    team_leader: string;
    team_members: string[];
    notes?: string;
}

interface TraumaAssessment {
    assessment_id: string;
    patient_id: string;
    mechanism_of_injury: string;
    time_of_injury?: string;
    primary_survey: PrimarySurvey;    // ABCDE
    secondary_survey: SecondarySurvey;
    trauma_score?: number;
    injury_severity_score?: number;
    performed_by: string;
    performed_at: number;
}

interface StrokeAssessment {
    assessment_id: string;
    patient_id: string;
    symptom_onset_time?: string;
    last_known_well?: string;
    nihss_score: number;              // 0-42
    fast_positive: boolean;
    ct_performed: boolean;
    tpa_candidate: boolean;
    tpa_given: boolean;
    tpa_time?: string;
    performed_by: string;
    performed_at: number;
}

interface SepsisAssessment {
    assessment_id: string;
    patient_id: string;
    qsofa_score: number;              // 0-3
    sirs_criteria_met: number;        // 0-4
    sepsis_suspected: boolean;
    septic_shock: boolean;
    lactate_level?: number;
    bundle_started: boolean;
    antibiotics_given: boolean;
    fluids_given: boolean;
    performed_by: string;
    performed_at: number;
}
```

### 3.5 Nursing Documentation

```typescript
interface MedicationAdministrationRecord {
    mar_id: string;
    patient_id: string;
    date: string;
    shift: 'day' | 'evening' | 'night';
    administrations: MedicationAdministration[];
    nurse_id: string;
    notes?: string;
}

interface MedicationAdministration {
    medication_name: string;
    dose: string;
    route: string;
    scheduled_time: string;
    given_time?: string;
    status: 'given' | 'held' | 'refused' | 'not_given';
    reason_not_given?: string;
    administered_by: string;
    witnessed_by?: string;
    five_rights_verified: boolean;
}

interface IntakeOutputRecord {
    record_id: string;
    patient_id: string;
    date: string;
    shift: string;
    intake: FluidEntry[];
    output: FluidEntry[];
    total_intake: number;
    total_output: number;
    fluid_balance: number;
    recorded_by: string;
}

interface NursingCarePlan {
    care_plan_id: string;
    patient_id: string;
    diagnoses: NursingDiagnosis[];
    goals: CareGoal[];
    interventions: NursingIntervention[];
    created_by: string;
    created_at: number;
    review_date: string;
}
```

---

## 4. IPFS Storage Types {#ipfs-storage}

### 4.1 Encrypted Document Storage

```typescript
interface MedicalRecordReference {
    content_hash: string;            // IPFS CID of encrypted content
    metadata_hash: string;           // IPFS CID of encrypted metadata
    record_type: RecordType;
    uploaded_at: number;
    content_checksum: string;        // SHA-256 of plaintext
}

interface EncryptedMetadata {
    filename: string;
    content_type: string;            // MIME type
    uploaded_at: number;
    patient_id: string;
    uploaded_by: string;
    record_type: string;
}

type RecordType = 
    | 'lab_result'
    | 'imaging'
    | 'prescription'
    | 'consultation'
    | 'discharge_summary'
    | 'vaccination'
    | 'operative_note'
    | 'pathology'
    | 'other';
```

### 4.2 Encryption Scheme

- **Algorithm**: ChaCha20-Poly1305 (AEAD)
- **Key Size**: 256 bits
- **Nonce**: 12 bytes (random per encryption)
- **Key Derivation**: Argon2id (for patient-specific keys)
- **Document Hash**: SHA-256

---

## 5. HL7 FHIR R4 Mappings {#fhir-mappings}

MediChain exposes FHIR R4 compatible endpoints for interoperability.

### 5.1 Resource Mappings

| MediChain Type | FHIR Resource | Endpoint |
|----------------|---------------|----------|
| `PatientProfile` | `Patient` | `/api/fhir/r4/Patient/{id}` |
| `Allergy` | `AllergyIntolerance` | `/api/fhir/r4/AllergyIntolerance?patient={id}` |
| `Medication` | `MedicationStatement` | `/api/fhir/r4/MedicationStatement?patient={id}` |
| `ChronicCondition` | `Condition` | `/api/fhir/r4/Condition?patient={id}` |
| `VitalSigns` | `Observation` | `/api/fhir/r4/Observation?patient={id}` |

### 5.2 Capability Statement

```
GET /api/fhir/r4/metadata
```

Returns FHIR CapabilityStatement with:
- Supported resources
- Search parameters
- Operations
- Conformance level

### 5.3 Example FHIR Patient Response

```json
{
  "resourceType": "Patient",
  "id": "PAT-2026-XXXX-XXXX",
  "meta": {
    "versionId": "1",
    "lastUpdated": "2026-01-06T10:00:00Z"
  },
  "identifier": [
    {
      "system": "urn:medichain:national-id",
      "value": "HASHED_NATIONAL_ID"
    },
    {
      "system": "urn:medichain:patient-id",
      "value": "PAT-2026-XXXX-XXXX"
    }
  ],
  "active": true,
  "name": [
    {
      "use": "official",
      "text": "Patient Name"
    }
  ],
  "birthDate": "1980-05-15",
  "address": [
    {
      "use": "home",
      "city": "City",
      "state": "State",
      "country": "ZA",
      "postalCode": "0000"
    }
  ],
  "contact": [
    {
      "relationship": [{"text": "Spouse"}],
      "name": {"text": "Contact Name"},
      "telecom": [{"system": "phone", "value": "+27000000000"}]
    }
  ],
  "communication": [
    {
      "language": {
        "coding": [{"system": "urn:ietf:bcp:47", "code": "en"}]
      }
    },
    {
      "language": {
        "coding": [{"system": "urn:ietf:bcp:47", "code": "zu"}]
      }
    }
  ]
}
```

---

## Appendix: Constants & Limits

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_ACTIVE_ACCESSES` | 10 | Max concurrent access grants per patient |
| `DEFAULT_ACCESS_DURATION` | 150 blocks | ~15 minutes emergency access |
| `MAX_REASON_LENGTH` | 256 bytes | Max length for access reason |
| `MAX_ALERTS_PER_PATIENT` | 50 | Max stored alerts |
| `QR_CODE_EXPIRY` | 3600 seconds | 1 hour QR validity |
| `MAX_LAB_RESULTS` | 20 | Max results per submission |

---

*Document Version: 1.0*  
*Last Updated: January 6, 2026*  
*Generated for: MediChain v0.1.0*
