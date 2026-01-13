# MediChain Database Schema

> **Version:** 1.0  
> **Last Updated:** January 13, 2026  
> © 2025 Trustware. All rights reserved.

---

## Overview

MediChain uses a hybrid storage architecture:
- **On-chain (Substrate):** Patient identity hashes, access control, audit logs
- **Off-chain (IPFS):** Encrypted medical documents
- **In-memory/PostgreSQL:** API server state, clinical documentation

---

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CORE ENTITIES                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐       ┌──────────────┐       ┌──────────────┐            │
│  │    User      │       │   Patient    │       │  NFCCard     │            │
│  ├──────────────┤       ├──────────────┤       ├──────────────┤            │
│  │ user_id (PK) │       │patient_id(PK)│◄──────│patient_id(FK)│            │
│  │ username     │       │ full_name    │       │ card_id      │            │
│  │ role         │───────│ date_of_birth│       │ card_hash    │            │
│  │ created_at   │       │ national_id  │       │ status       │            │
│  │ created_by   │       │ created_at   │       │ created_at   │            │
│  └──────────────┘       └──────────────┘       └──────────────┘            │
│         │                      │                                            │
│         │                      │                                            │
│         ▼                      ▼                                            │
│  ┌──────────────┐       ┌──────────────┐       ┌──────────────┐            │
│  │  AccessLog   │       │EmergencyInfo │       │MedicalRecord │            │
│  ├──────────────┤       ├──────────────┤       │  Reference   │            │
│  │ access_id(PK)│       │patient_id(FK)│       ├──────────────┤            │
│  │patient_id(FK)│       │ blood_type   │       │patient_id(FK)│            │
│  │accessor_id   │       │ allergies[]  │       │ content_hash │            │
│  │ access_type  │       │ medications[]│       │metadata_hash │            │
│  │ timestamp    │       │ conditions[] │       │ record_type  │            │
│  │ emergency    │       │ dnr_status   │       │ uploaded_at  │            │
│  └──────────────┘       └──────────────┘       └──────────────┘            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                          CLINICAL DOCUMENTATION                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐       ┌──────────────┐       ┌──────────────┐            │
│  │   Triage     │       │   SOAPNote   │       │  VitalSigns  │            │
│  │  Assessment  │       │              │       │  Flowsheet   │            │
│  ├──────────────┤       ├──────────────┤       ├──────────────┤            │
│  │assessment_id │       │  note_id(PK) │       │patient_id(FK)│            │
│  │patient_id(FK)│       │patient_id(FK)│       │ readings[]   │            │
│  │ esi_level    │       │ subjective   │       │              │            │
│  │chief_complaint│      │ objective    │       │              │            │
│  │ vital_signs  │       │ assessment   │       │              │            │
│  │ performed_by │       │ plan         │       │              │            │
│  └──────────────┘       └──────────────┘       └──────────────┘            │
│         │                      │                      │                     │
│         └──────────────────────┼──────────────────────┘                     │
│                                ▼                                            │
│                    ┌───────────────────────┐                                │
│                    │      Patient          │                                │
│                    │    (Central Entity)   │                                │
│                    └───────────────────────┘                                │
│                                ▲                                            │
│         ┌──────────────────────┼──────────────────────┐                     │
│         │                      │                      │                     │
│  ┌──────────────┐       ┌──────────────┐       ┌──────────────┐            │
│  │  CodeBlue    │       │   Trauma     │       │   Sepsis     │            │
│  │   Record     │       │  Assessment  │       │  Assessment  │            │
│  ├──────────────┤       ├──────────────┤       ├──────────────┤            │
│  │ event_id(PK) │       │assessment_id │       │assessment_id │            │
│  │patient_id(FK)│       │patient_id(FK)│       │patient_id(FK)│            │
│  │ code_type    │       │ mechanism    │       │ qsofa_score  │            │
│  │ initial_rhythm│      │ primary_survey│      │ sirs_criteria│            │
│  │ cpr_metrics  │       │trauma_score  │       │ bundle_started│           │
│  │ medications  │       │ injuries[]   │       │              │            │
│  └──────────────┘       └──────────────┘       └──────────────┘            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Tables

### 1. Users

```sql
CREATE TABLE users (
    user_id         VARCHAR(50) PRIMARY KEY,
    username        VARCHAR(100) NOT NULL UNIQUE,
    role            VARCHAR(20) NOT NULL CHECK (role IN (
                        'Admin', 'Doctor', 'Nurse', 
                        'LabTechnician', 'Pharmacist', 'Patient'
                    )),
    password_hash   VARCHAR(255),  -- For future auth
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by      VARCHAR(50) REFERENCES users(user_id),
    is_active       BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_username ON users(username);
```

### 2. Patients

```sql
CREATE TABLE patients (
    patient_id      VARCHAR(50) PRIMARY KEY,
    full_name       VARCHAR(200) NOT NULL,
    date_of_birth   DATE NOT NULL,
    national_id     VARCHAR(50) NOT NULL,
    national_id_hash VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 hash
    gender          VARCHAR(10),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_updated    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by      VARCHAR(50) REFERENCES users(user_id)
);

CREATE INDEX idx_patients_national_id_hash ON patients(national_id_hash);
CREATE INDEX idx_patients_name ON patients(full_name);
```

### 3. Emergency Info

```sql
CREATE TABLE emergency_info (
    patient_id          VARCHAR(50) PRIMARY KEY REFERENCES patients(patient_id),
    blood_type          VARCHAR(10) NOT NULL,
    organ_donor         BOOLEAN DEFAULT FALSE,
    dnr_status          BOOLEAN DEFAULT FALSE,
    languages           TEXT[],  -- Array of ISO language codes
    last_updated        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE allergies (
    allergy_id      SERIAL PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    name            VARCHAR(200) NOT NULL,
    severity        VARCHAR(20) CHECK (severity IN ('Mild', 'Moderate', 'Severe', 'Unknown')),
    reaction        TEXT,
    verified_at     TIMESTAMP WITH TIME ZONE,
    verified_by     VARCHAR(50) REFERENCES users(user_id)
);

CREATE TABLE medications (
    medication_id   SERIAL PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    name            VARCHAR(200) NOT NULL,
    dosage          VARCHAR(100),
    frequency       VARCHAR(100),
    start_date      DATE,
    end_date        DATE,
    prescribed_by   VARCHAR(50) REFERENCES users(user_id)
);

CREATE TABLE chronic_conditions (
    condition_id    SERIAL PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    name            VARCHAR(200) NOT NULL,
    diagnosed_date  DATE,
    notes           TEXT
);

CREATE TABLE emergency_contacts (
    contact_id      SERIAL PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    name            VARCHAR(200) NOT NULL,
    phone           VARCHAR(50) NOT NULL,
    relationship    VARCHAR(100),
    priority        SMALLINT DEFAULT 1,
    can_make_medical_decisions BOOLEAN DEFAULT FALSE,
    language        VARCHAR(10)
);

CREATE INDEX idx_allergies_patient ON allergies(patient_id);
CREATE INDEX idx_medications_patient ON medications(patient_id);
CREATE INDEX idx_emergency_contacts_patient ON emergency_contacts(patient_id);
```

### 4. NFC Cards

```sql
CREATE TABLE nfc_cards (
    card_id         VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    card_hash       VARCHAR(64) NOT NULL UNIQUE,
    national_id_type VARCHAR(50),
    status          VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
    created_at      BIGINT NOT NULL,  -- Unix timestamp
    last_used_at    BIGINT
);

CREATE INDEX idx_nfc_cards_hash ON nfc_cards(card_hash);
CREATE INDEX idx_nfc_cards_patient ON nfc_cards(patient_id);
```

### 5. Access Logs (Audit Trail)

```sql
CREATE TABLE access_logs (
    access_id       VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    accessor_id     VARCHAR(50) REFERENCES users(user_id),
    accessor_role   VARCHAR(20) NOT NULL,
    access_type     VARCHAR(50) NOT NULL,
    location        TEXT,
    timestamp       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    emergency       BOOLEAN DEFAULT FALSE,
    ip_address      INET,
    user_agent      TEXT
);

CREATE INDEX idx_access_logs_patient ON access_logs(patient_id);
CREATE INDEX idx_access_logs_accessor ON access_logs(accessor_id);
CREATE INDEX idx_access_logs_timestamp ON access_logs(timestamp);
CREATE INDEX idx_access_logs_emergency ON access_logs(emergency) WHERE emergency = TRUE;
```

### 6. Medical Record References (IPFS)

```sql
CREATE TABLE medical_record_references (
    id              SERIAL PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    content_hash    VARCHAR(100) NOT NULL,  -- IPFS CID
    metadata_hash   VARCHAR(100) NOT NULL,  -- IPFS CID for encrypted metadata
    record_type     VARCHAR(50) NOT NULL,
    uploaded_at     BIGINT NOT NULL,
    content_checksum VARCHAR(64) NOT NULL,
    uploaded_by     VARCHAR(50) REFERENCES users(user_id)
);

CREATE INDEX idx_medical_records_patient ON medical_record_references(patient_id);
CREATE INDEX idx_medical_records_type ON medical_record_references(record_type);
```

---

## Clinical Documentation Tables

### 7. Triage Assessments

```sql
CREATE TABLE triage_assessments (
    assessment_id   VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    esi_level       SMALLINT NOT NULL CHECK (esi_level BETWEEN 1 AND 5),
    chief_complaint TEXT NOT NULL,
    vital_signs     JSONB NOT NULL,
    pain_scale      SMALLINT CHECK (pain_scale BETWEEN 0 AND 10),
    notes           TEXT,
    performed_by    VARCHAR(50) REFERENCES users(user_id),
    performed_at    BIGINT NOT NULL
);

CREATE INDEX idx_triage_patient ON triage_assessments(patient_id);
CREATE INDEX idx_triage_esi ON triage_assessments(esi_level);
```

### 8. SOAP Notes

```sql
CREATE TABLE soap_notes (
    note_id         VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    encounter_type  VARCHAR(100),
    subjective      JSONB NOT NULL,
    objective       JSONB NOT NULL,
    assessment      JSONB NOT NULL,
    plan            JSONB NOT NULL,
    author_id       VARCHAR(50) REFERENCES users(user_id),
    created_at      BIGINT NOT NULL,
    updated_at      BIGINT,
    status          VARCHAR(20) DEFAULT 'active'
);

CREATE TABLE soap_addenda (
    addendum_id     VARCHAR(50) PRIMARY KEY,
    note_id         VARCHAR(50) REFERENCES soap_notes(note_id),
    content         TEXT NOT NULL,
    author_id       VARCHAR(50) REFERENCES users(user_id),
    created_at      BIGINT NOT NULL
);

CREATE INDEX idx_soap_patient ON soap_notes(patient_id);
```

### 9. Vital Signs

```sql
CREATE TABLE vital_signs_readings (
    reading_id      VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    timestamp       BIGINT NOT NULL,
    heart_rate      SMALLINT,
    systolic_bp     SMALLINT,
    diastolic_bp    SMALLINT,
    respiratory_rate SMALLINT,
    oxygen_saturation SMALLINT,
    temperature_celsius DECIMAL(4,2),
    pain_scale      SMALLINT,
    recorded_by     VARCHAR(50) REFERENCES users(user_id),
    notes           TEXT
);

CREATE INDEX idx_vitals_patient ON vital_signs_readings(patient_id);
CREATE INDEX idx_vitals_timestamp ON vital_signs_readings(timestamp);
```

### 10. Emergency Records

```sql
-- Code Blue / Resuscitation
CREATE TABLE code_blue_records (
    event_id        VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    code_type       VARCHAR(50) NOT NULL,
    location        VARCHAR(200),
    called_at       BIGINT NOT NULL,
    initial_rhythm  VARCHAR(50),
    cpr_metrics     JSONB,
    defibrillations JSONB,
    medications     JSONB,
    rosc_achieved   BOOLEAN,
    rosc_time       BIGINT,
    outcome         VARCHAR(50),
    team_leader     VARCHAR(50) REFERENCES users(user_id),
    notes           TEXT
);

-- Trauma Assessments
CREATE TABLE trauma_assessments (
    assessment_id   VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    mechanism       VARCHAR(200) NOT NULL,
    primary_survey  JSONB NOT NULL,  -- ABCDE assessment
    secondary_survey JSONB,
    trauma_score    JSONB,
    injuries        JSONB,
    performed_by    VARCHAR(50) REFERENCES users(user_id),
    performed_at    BIGINT NOT NULL
);

-- Stroke Assessments
CREATE TABLE stroke_assessments (
    assessment_id   VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    symptom_onset   BIGINT NOT NULL,
    last_known_well BIGINT,
    nihss_score     JSONB NOT NULL,
    total_score     SMALLINT NOT NULL,
    tpa_eligible    BOOLEAN,
    tpa_administered BOOLEAN,
    performed_by    VARCHAR(50) REFERENCES users(user_id),
    performed_at    BIGINT NOT NULL
);

-- Sepsis Assessments
CREATE TABLE sepsis_assessments (
    assessment_id   VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    qsofa_score     JSONB NOT NULL,
    sirs_criteria   JSONB,
    lactate_readings JSONB,
    bundle_started  BIGINT,
    antibiotics     JSONB,
    sepsis_confirmed BOOLEAN,
    performed_by    VARCHAR(50) REFERENCES users(user_id),
    performed_at    BIGINT NOT NULL
);

CREATE INDEX idx_codeblue_patient ON code_blue_records(patient_id);
CREATE INDEX idx_trauma_patient ON trauma_assessments(patient_id);
CREATE INDEX idx_stroke_patient ON stroke_assessments(patient_id);
CREATE INDEX idx_sepsis_patient ON sepsis_assessments(patient_id);
```

### 11. Nursing Documentation

```sql
-- Medication Administration Records
CREATE TABLE medication_administration_records (
    mar_id          VARCHAR(100) PRIMARY KEY,  -- patient_id + date
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    date            DATE NOT NULL,
    scheduled_meds  JSONB,
    prn_meds        JSONB,
    infusions       JSONB,
    created_by      VARCHAR(50) REFERENCES users(user_id)
);

-- Intake/Output Records
CREATE TABLE intake_output_records (
    io_id           VARCHAR(100) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    date            DATE NOT NULL,
    shift           VARCHAR(20),
    intakes         JSONB,
    outputs         JSONB,
    totals          JSONB,
    recorded_by     VARCHAR(50) REFERENCES users(user_id)
);

-- Nursing Care Plans
CREATE TABLE nursing_care_plans (
    care_plan_id    VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    diagnoses       JSONB NOT NULL,
    goals           JSONB NOT NULL,
    interventions   JSONB NOT NULL,
    created_by      VARCHAR(50) REFERENCES users(user_id),
    created_at      BIGINT NOT NULL,
    status          VARCHAR(20) DEFAULT 'active'
);

-- Wound Assessments
CREATE TABLE wound_assessments (
    assessment_id   VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    wound_id        VARCHAR(50),
    location        JSONB NOT NULL,
    measurements    JSONB,
    wound_bed       JSONB,
    drainage        JSONB,
    treatment       JSONB,
    assessed_by     VARCHAR(50) REFERENCES users(user_id),
    assessed_at     BIGINT NOT NULL
);

-- Shift Handoffs
CREATE TABLE shift_handoffs (
    handoff_id      VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    situation       JSONB NOT NULL,
    background      JSONB NOT NULL,
    assessment      JSONB NOT NULL,
    recommendation  JSONB NOT NULL,
    outgoing_nurse  VARCHAR(50) REFERENCES users(user_id),
    incoming_nurse  VARCHAR(50) REFERENCES users(user_id),
    handoff_time    BIGINT NOT NULL
);

CREATE INDEX idx_mar_patient ON medication_administration_records(patient_id);
CREATE INDEX idx_io_patient ON intake_output_records(patient_id);
CREATE INDEX idx_careplan_patient ON nursing_care_plans(patient_id);
CREATE INDEX idx_wound_patient ON wound_assessments(patient_id);
```

### 12. Lab Documentation

```sql
-- Specimen Collections
CREATE TABLE specimen_collections (
    collection_id   VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    specimen_type   VARCHAR(100) NOT NULL,
    collection_site VARCHAR(200),
    collected_at    BIGINT NOT NULL,
    collected_by    VARCHAR(50) REFERENCES users(user_id),
    order_id        VARCHAR(50),
    status          VARCHAR(20) DEFAULT 'collected'
);

-- Lab Result Submissions
CREATE TABLE lab_submissions (
    id              VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    patient_name    VARCHAR(200),
    test_name       VARCHAR(200) NOT NULL,
    test_category   VARCHAR(100),
    results         JSONB NOT NULL,
    notes           TEXT,
    submitted_by    VARCHAR(50) REFERENCES users(user_id),
    submitted_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status          VARCHAR(20) DEFAULT 'pending',
    reviewed_by     VARCHAR(50) REFERENCES users(user_id),
    reviewed_at     TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    content_hash    VARCHAR(100),
    metadata_hash   VARCHAR(100)
);

-- Critical Value Notifications
CREATE TABLE critical_value_notifications (
    notification_id VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    test_name       VARCHAR(200) NOT NULL,
    critical_value  VARCHAR(100) NOT NULL,
    normal_range    VARCHAR(100),
    notified_provider VARCHAR(50) REFERENCES users(user_id),
    notification_time BIGINT NOT NULL,
    acknowledged    BOOLEAN DEFAULT FALSE,
    acknowledged_at BIGINT,
    notified_by     VARCHAR(50) REFERENCES users(user_id)
);

CREATE INDEX idx_specimen_patient ON specimen_collections(patient_id);
CREATE INDEX idx_lab_sub_patient ON lab_submissions(patient_id);
CREATE INDEX idx_lab_sub_status ON lab_submissions(status);
CREATE INDEX idx_critical_patient ON critical_value_notifications(patient_id);
```

### 13. Physician Documentation

```sql
-- Physician Orders
CREATE TABLE physician_orders (
    order_id        VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    order_type      VARCHAR(50) NOT NULL,
    order_text      TEXT NOT NULL,
    priority        VARCHAR(20) DEFAULT 'routine',
    status          VARCHAR(20) DEFAULT 'pending',
    ordered_by      VARCHAR(50) REFERENCES users(user_id),
    ordered_at      BIGINT NOT NULL,
    completed_at    BIGINT
);

-- Discharge Summaries
CREATE TABLE discharge_summaries (
    summary_id      VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    admission_date  BIGINT NOT NULL,
    discharge_date  BIGINT NOT NULL,
    admitting_diagnosis TEXT,
    discharge_diagnoses JSONB,
    hospital_course TEXT,
    procedures_performed JSONB,
    discharge_medications JSONB,
    follow_up       JSONB,
    discharge_disposition VARCHAR(100),
    author_id       VARCHAR(50) REFERENCES users(user_id),
    created_at      BIGINT NOT NULL
);

-- E-Prescriptions
CREATE TABLE electronic_prescriptions (
    rx_id           VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    prescriber_info JSONB NOT NULL,
    pharmacy_info   JSONB,
    medications     JSONB NOT NULL,
    prescribed_at   BIGINT NOT NULL,
    status          VARCHAR(20) DEFAULT 'pending',
    dispensed_at    BIGINT
);

CREATE INDEX idx_orders_patient ON physician_orders(patient_id);
CREATE INDEX idx_orders_status ON physician_orders(status);
CREATE INDEX idx_discharge_patient ON discharge_summaries(patient_id);
CREATE INDEX idx_rx_patient ON electronic_prescriptions(patient_id);
```

### 14. Appointments

```sql
CREATE TABLE appointments (
    appointment_id  VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    provider_id     VARCHAR(50) REFERENCES users(user_id),
    appointment_type VARCHAR(100),
    scheduled_time  BIGINT NOT NULL,
    duration_minutes INTEGER DEFAULT 30,
    location        JSONB,
    status          VARCHAR(20) DEFAULT 'scheduled',
    reason          TEXT,
    notes           TEXT,
    created_by      VARCHAR(50) REFERENCES users(user_id),
    created_at      BIGINT NOT NULL
);

CREATE INDEX idx_appt_patient ON appointments(patient_id);
CREATE INDEX idx_appt_provider ON appointments(provider_id);
CREATE INDEX idx_appt_time ON appointments(scheduled_time);
CREATE INDEX idx_appt_status ON appointments(status);
```

---

## Messaging & Notifications

```sql
-- Secure Messages
CREATE TABLE messages (
    message_id      VARCHAR(50) PRIMARY KEY,
    sender_id       VARCHAR(50) REFERENCES users(user_id),
    recipient_id    VARCHAR(50) REFERENCES users(user_id),
    subject         VARCHAR(200),
    content         TEXT NOT NULL,
    priority        VARCHAR(20) DEFAULT 'normal',
    is_read         BOOLEAN DEFAULT FALSE,
    sent_at         BIGINT NOT NULL,
    read_at         BIGINT
);

-- Notifications
CREATE TABLE notifications (
    notification_id VARCHAR(50) PRIMARY KEY,
    user_id         VARCHAR(50) REFERENCES users(user_id),
    type            VARCHAR(50) NOT NULL,
    title           VARCHAR(200),
    message         TEXT,
    data            JSONB,
    is_read         BOOLEAN DEFAULT FALSE,
    created_at      BIGINT NOT NULL
);

CREATE INDEX idx_messages_recipient ON messages(recipient_id);
CREATE INDEX idx_messages_unread ON messages(recipient_id) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE is_read = FALSE;
```

---

## Consent Management

```sql
CREATE TABLE consent_forms (
    consent_id      VARCHAR(50) PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    consent_type    VARCHAR(100) NOT NULL,
    version         VARCHAR(20),
    signed_at       BIGINT NOT NULL,
    signature_hash  VARCHAR(64),  -- Hash of signature image
    witness_id      VARCHAR(50) REFERENCES users(user_id),
    expires_at      BIGINT,
    revoked_at      BIGINT,
    notes           TEXT
);

CREATE INDEX idx_consent_patient ON consent_forms(patient_id);
CREATE INDEX idx_consent_type ON consent_forms(consent_type);
```

---

## Insurance

```sql
CREATE TABLE insurance_info (
    id              SERIAL PRIMARY KEY,
    patient_id      VARCHAR(50) REFERENCES patients(patient_id),
    provider        VARCHAR(200) NOT NULL,
    policy_number   VARCHAR(100) NOT NULL,
    group_number    VARCHAR(100),
    valid_from      DATE,
    valid_to        DATE,
    coverage_type   VARCHAR(50),
    is_active       BOOLEAN DEFAULT TRUE,
    verified_at     TIMESTAMP WITH TIME ZONE,
    verified_by     VARCHAR(50) REFERENCES users(user_id)
);

CREATE INDEX idx_insurance_patient ON insurance_info(patient_id);
CREATE INDEX idx_insurance_active ON insurance_info(patient_id) WHERE is_active = TRUE;
```

---

## Views for Common Queries

```sql
-- Active patients with emergency info
CREATE VIEW v_patient_emergency AS
SELECT 
    p.patient_id,
    p.full_name,
    p.date_of_birth,
    e.blood_type,
    e.organ_donor,
    e.dnr_status,
    e.languages,
    (SELECT json_agg(a) FROM allergies a WHERE a.patient_id = p.patient_id) as allergies,
    (SELECT json_agg(m) FROM medications m WHERE m.patient_id = p.patient_id AND m.end_date IS NULL) as current_medications,
    (SELECT json_agg(c) FROM chronic_conditions c WHERE c.patient_id = p.patient_id) as conditions,
    (SELECT json_agg(ec ORDER BY ec.priority) FROM emergency_contacts ec WHERE ec.patient_id = p.patient_id) as emergency_contacts
FROM patients p
LEFT JOIN emergency_info e ON p.patient_id = e.patient_id;

-- Recent vital signs
CREATE VIEW v_recent_vitals AS
SELECT DISTINCT ON (patient_id)
    patient_id,
    reading_id,
    timestamp,
    heart_rate,
    systolic_bp,
    diastolic_bp,
    respiratory_rate,
    oxygen_saturation,
    temperature_celsius,
    pain_scale
FROM vital_signs_readings
ORDER BY patient_id, timestamp DESC;

-- Pending lab results
CREATE VIEW v_pending_labs AS
SELECT 
    ls.*,
    p.full_name as patient_name
FROM lab_submissions ls
JOIN patients p ON ls.patient_id = p.patient_id
WHERE ls.status = 'pending'
ORDER BY ls.submitted_at DESC;

-- Today's appointments
CREATE VIEW v_todays_appointments AS
SELECT 
    a.*,
    p.full_name as patient_name,
    u.username as provider_name
FROM appointments a
JOIN patients p ON a.patient_id = p.patient_id
JOIN users u ON a.provider_id = u.user_id
WHERE DATE(to_timestamp(a.scheduled_time)) = CURRENT_DATE
ORDER BY a.scheduled_time;
```

---

## Migration Notes

### From In-Memory to PostgreSQL

1. Export current in-memory data using API endpoints
2. Run schema creation scripts
3. Import data using batch insert scripts
4. Verify data integrity
5. Switch API to use PostgreSQL connections

### Indexing Strategy

- All foreign keys are indexed
- Timestamp columns indexed for time-range queries
- Status columns indexed with partial indexes
- Full-text search indexes on text fields (future)

---

## Backup & Recovery

```sql
-- Daily backup command
pg_dump -Fc medichain > backup_$(date +%Y%m%d).dump

-- Restore command
pg_restore -d medichain backup_20260106.dump
```

---

## Performance Considerations

1. **Partitioning**: Consider partitioning `access_logs` and `vital_signs_readings` by date
2. **Archiving**: Move records older than 7 years to archive tables
3. **Connection Pooling**: Use PgBouncer for production
4. **Read Replicas**: For analytics queries

---

*Schema Version: 1.0*  
*Compatible with: PostgreSQL 14+*
