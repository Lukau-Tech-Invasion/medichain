-- Phase 1: Core Clinical Tables Migration
-- MediChain PostgreSQL Migration Plan - Phase 1
-- Created: January 23, 2026
-- Purpose: Persist critical clinical data that was previously in-memory HashMaps

-- ============================================================================
-- PART 1: CORE PATIENT DATA
-- ============================================================================

-- Patients table (replaces patients HashMap)
CREATE TABLE IF NOT EXISTS patients (
    id VARCHAR(64) PRIMARY KEY,
    health_id VARCHAR(32) UNIQUE NOT NULL,
    national_id_hash VARCHAR(64) NOT NULL,
    national_id_type VARCHAR(32) NOT NULL CHECK (national_id_type IN ('FaydaID', 'GhanaCard', 'NIN', 'SmartID')),
    
    -- Encrypted PII fields (encrypted at application layer with ChaCha20-Poly1305)
    first_name_encrypted BYTEA,
    last_name_encrypted BYTEA,
    date_of_birth_encrypted BYTEA,
    
    -- Non-sensitive demographics
    gender VARCHAR(16),
    blood_type VARCHAR(8) CHECK (blood_type IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown')),
    
    -- Contact info (encrypted)
    phone_encrypted BYTEA,
    email_encrypted BYTEA,
    address_encrypted BYTEA,
    
    -- Emergency contact (encrypted)
    emergency_contact_name_encrypted BYTEA,
    emergency_contact_phone_encrypted BYTEA,
    emergency_contact_relationship VARCHAR(64),
    
    -- Medical flags
    organ_donor BOOLEAN DEFAULT FALSE,
    dnr_status BOOLEAN DEFAULT FALSE,
    
    -- Provider relationship
    primary_provider_id UUID REFERENCES users(id),
    wallet_address VARCHAR(48),
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    registered_by UUID REFERENCES users(id),
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_patients_health_id ON patients(health_id);
CREATE INDEX idx_patients_national_id_hash ON patients(national_id_hash);
CREATE INDEX idx_patients_primary_provider ON patients(primary_provider_id);
CREATE INDEX idx_patients_wallet ON patients(wallet_address) WHERE wallet_address IS NOT NULL;
CREATE INDEX idx_patients_created ON patients(created_at DESC);

-- NFC Tags table (replaces nfc_tags HashMap)
CREATE TABLE IF NOT EXISTS nfc_tags (
    id VARCHAR(64) PRIMARY KEY,
    tag_uid VARCHAR(32) UNIQUE NOT NULL,
    patient_id VARCHAR(64) REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
    tag_type VARCHAR(32) NOT NULL DEFAULT 'NTAG216',
    
    -- Security
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    pin_hash VARCHAR(128),
    
    -- Lifecycle
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    use_count INTEGER DEFAULT 0,
    
    -- Issuer
    issued_by UUID REFERENCES users(id)
);

CREATE INDEX idx_nfc_tags_uid ON nfc_tags(tag_uid);
CREATE INDEX idx_nfc_tags_patient ON nfc_tags(patient_id);
CREATE INDEX idx_nfc_tags_active ON nfc_tags(is_active) WHERE is_active = TRUE;

-- Medical Records table (replaces medical_records HashMap)
-- Stores metadata and IPFS references; actual content is in IPFS
CREATE TABLE IF NOT EXISTS medical_records (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
    
    -- Record classification
    record_type VARCHAR(64) NOT NULL,
    category VARCHAR(64),
    
    -- IPFS storage (encrypted content)
    ipfs_content_hash VARCHAR(128),
    ipfs_metadata_hash VARCHAR(128),
    content_checksum VARCHAR(128),
    
    -- Blockchain verification
    on_chain_hash VARCHAR(128),
    blockchain_tx_hash VARCHAR(128),
    
    -- Summary for quick access (encrypted)
    summary_encrypted BYTEA,
    
    -- Timestamps
    record_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Audit
    created_by UUID REFERENCES users(id) NOT NULL,
    last_modified_by UUID REFERENCES users(id) NOT NULL,
    facility_id VARCHAR(64),
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_medical_records_patient ON medical_records(patient_id);
CREATE INDEX idx_medical_records_type ON medical_records(record_type);
CREATE INDEX idx_medical_records_category ON medical_records(category);
CREATE INDEX idx_medical_records_date ON medical_records(record_date DESC);
CREATE INDEX idx_medical_records_created ON medical_records(created_at DESC);
CREATE INDEX idx_medical_records_ipfs ON medical_records(ipfs_content_hash) WHERE ipfs_content_hash IS NOT NULL;

-- Allergies table (replaces allergies HashMap)
CREATE TABLE IF NOT EXISTS allergies (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
    
    -- Allergy details
    allergen VARCHAR(256) NOT NULL,
    allergen_type VARCHAR(64) NOT NULL CHECK (allergen_type IN ('Drug', 'Food', 'Environmental', 'Latex', 'Contrast', 'Other')),
    
    -- Reaction
    reaction VARCHAR(512),
    severity VARCHAR(16) NOT NULL CHECK (severity IN ('Mild', 'Moderate', 'Severe', 'LifeThreatening')),
    
    -- Clinical details
    onset_date DATE,
    last_occurrence DATE,
    
    -- Verification
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_by UUID REFERENCES users(id),
    verified_at TIMESTAMPTZ,
    
    -- Source
    source VARCHAR(64) DEFAULT 'Patient Reported',
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_allergies_patient ON allergies(patient_id);
CREATE INDEX idx_allergies_allergen ON allergies(allergen);
CREATE INDEX idx_allergies_severity ON allergies(severity);
CREATE INDEX idx_allergies_type ON allergies(allergen_type);

-- ============================================================================
-- PART 2: TRIAGE & EMERGENCY DATA
-- ============================================================================

-- Triage Assessments table (replaces triage_assessments HashMap)
CREATE TABLE IF NOT EXISTS triage_assessments (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
    
    -- ESI Level (1-5)
    esi_level INTEGER NOT NULL CHECK (esi_level BETWEEN 1 AND 5),
    
    -- Chief complaint
    chief_complaint TEXT NOT NULL,
    
    -- Vital signs at triage
    heart_rate INTEGER,
    respiratory_rate INTEGER,
    blood_pressure_systolic INTEGER,
    blood_pressure_diastolic INTEGER,
    temperature DECIMAL(4,1),
    oxygen_saturation INTEGER,
    pain_scale INTEGER CHECK (pain_scale BETWEEN 0 AND 10),
    gcs_score INTEGER CHECK (gcs_score BETWEEN 3 AND 15),
    blood_glucose INTEGER,
    weight DECIMAL(5,1),
    
    -- Clinical flags
    is_critical BOOLEAN DEFAULT FALSE,
    requires_isolation BOOLEAN DEFAULT FALSE,
    
    -- Disposition
    disposition VARCHAR(64),
    assigned_bed VARCHAR(32),
    
    -- Timestamps
    triage_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    seen_by_provider_at TIMESTAMPTZ,
    
    -- Audit
    performed_by UUID REFERENCES users(id) NOT NULL,
    facility_id VARCHAR(64),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_triage_patient ON triage_assessments(patient_id);
CREATE INDEX idx_triage_esi ON triage_assessments(esi_level);
CREATE INDEX idx_triage_time ON triage_assessments(triage_time DESC);
CREATE INDEX idx_triage_critical ON triage_assessments(is_critical) WHERE is_critical = TRUE;

-- Code Blue Records table (replaces code_blue_records HashMap)
CREATE TABLE IF NOT EXISTS code_blue_records (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
    
    -- Event timing
    event_time TIMESTAMPTZ NOT NULL,
    response_time_seconds INTEGER,
    duration_minutes INTEGER,
    
    -- Initial findings
    initial_rhythm VARCHAR(64) NOT NULL,
    witnessed BOOLEAN DEFAULT FALSE,
    bystander_cpr BOOLEAN DEFAULT FALSE,
    
    -- Interventions (stored as JSONB for flexibility)
    cpr_cycles INTEGER DEFAULT 0,
    defibrillation_count INTEGER DEFAULT 0,
    medications_given JSONB DEFAULT '[]',
    airways_interventions JSONB DEFAULT '[]',
    
    -- Outcome
    outcome VARCHAR(32) NOT NULL CHECK (outcome IN ('ROSC', 'Expired', 'Ongoing', 'Transferred')),
    rosc_time TIMESTAMPTZ,
    
    -- Team
    team_leader UUID REFERENCES users(id),
    team_members JSONB DEFAULT '[]',
    
    -- Notes
    narrative TEXT,
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) NOT NULL,
    facility_id VARCHAR(64)
);

CREATE INDEX idx_code_blue_patient ON code_blue_records(patient_id);
CREATE INDEX idx_code_blue_time ON code_blue_records(event_time DESC);
CREATE INDEX idx_code_blue_outcome ON code_blue_records(outcome);

-- Trauma Assessments table (replaces trauma_assessments HashMap)
CREATE TABLE IF NOT EXISTS trauma_assessments (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
    
    -- Trauma classification
    trauma_type VARCHAR(64) NOT NULL,
    mechanism_of_injury TEXT NOT NULL,
    trauma_level INTEGER CHECK (trauma_level BETWEEN 1 AND 3),
    
    -- Primary survey (ABCDE)
    airway_status VARCHAR(64),
    breathing_status VARCHAR(64),
    circulation_status VARCHAR(64),
    disability_status VARCHAR(64),
    exposure_notes TEXT,
    
    -- Scores
    gcs_score INTEGER CHECK (gcs_score BETWEEN 3 AND 15),
    iss_score INTEGER,
    rts_score DECIMAL(4,2),
    
    -- Injuries (JSONB array)
    injuries JSONB DEFAULT '[]',
    
    -- Interventions
    interventions JSONB DEFAULT '[]',
    
    -- Disposition
    disposition VARCHAR(64),
    
    -- Notes
    additional_notes TEXT,
    
    -- Audit
    assessment_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    performed_by UUID REFERENCES users(id) NOT NULL,
    facility_id VARCHAR(64),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trauma_patient ON trauma_assessments(patient_id);
CREATE INDEX idx_trauma_type ON trauma_assessments(trauma_type);
CREATE INDEX idx_trauma_level ON trauma_assessments(trauma_level);
CREATE INDEX idx_trauma_time ON trauma_assessments(assessment_time DESC);

-- Stroke Assessments table (replaces stroke_assessments HashMap)
CREATE TABLE IF NOT EXISTS stroke_assessments (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
    
    -- Symptom onset
    symptom_onset_time TIMESTAMPTZ,
    last_known_well TIMESTAMPTZ,
    onset_witnessed BOOLEAN DEFAULT FALSE,
    
    -- NIHSS Score
    nihss_score INTEGER CHECK (nihss_score BETWEEN 0 AND 42),
    nihss_components JSONB,
    
    -- FAST assessment
    facial_droop BOOLEAN,
    arm_weakness BOOLEAN,
    speech_difficulty BOOLEAN,
    
    -- Stroke type
    stroke_type VARCHAR(32) CHECK (stroke_type IN ('Ischemic', 'Hemorrhagic', 'TIA', 'Unknown')),
    
    -- Imaging
    ct_performed BOOLEAN DEFAULT FALSE,
    ct_time TIMESTAMPTZ,
    ct_findings TEXT,
    large_vessel_occlusion BOOLEAN,
    
    -- Treatment
    tpa_candidate BOOLEAN DEFAULT FALSE,
    tpa_given BOOLEAN DEFAULT FALSE,
    tpa_time TIMESTAMPTZ,
    thrombectomy_candidate BOOLEAN DEFAULT FALSE,
    
    -- Blood pressure
    bp_systolic INTEGER,
    bp_diastolic INTEGER,
    blood_glucose INTEGER,
    
    -- Disposition
    disposition VARCHAR(64),
    
    -- Audit
    assessment_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    performed_by UUID REFERENCES users(id) NOT NULL,
    facility_id VARCHAR(64),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stroke_patient ON stroke_assessments(patient_id);
CREATE INDEX idx_stroke_type ON stroke_assessments(stroke_type);
CREATE INDEX idx_stroke_nihss ON stroke_assessments(nihss_score);
CREATE INDEX idx_stroke_time ON stroke_assessments(assessment_time DESC);

-- Cardiac Events table (replaces cardiac_events HashMap)
CREATE TABLE IF NOT EXISTS cardiac_events (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
    
    -- Event type
    event_type VARCHAR(64) NOT NULL CHECK (event_type IN ('STEMI', 'NSTEMI', 'UnstableAngina', 'StableAngina', 'Arrhythmia', 'HeartFailure', 'Other')),
    
    -- Symptom onset
    symptom_onset TIMESTAMPTZ,
    chest_pain_character TEXT,
    associated_symptoms JSONB DEFAULT '[]',
    
    -- Vitals
    heart_rate INTEGER,
    blood_pressure_systolic INTEGER,
    blood_pressure_diastolic INTEGER,
    oxygen_saturation INTEGER,
    
    -- Labs
    troponin_value DECIMAL(10,4),
    troponin_time TIMESTAMPTZ,
    bnp_value DECIMAL(10,2),
    
    -- ECG
    ecg_rhythm VARCHAR(64),
    ecg_interpretation TEXT,
    st_changes BOOLEAN DEFAULT FALSE,
    affected_leads JSONB DEFAULT '[]',
    
    -- Risk scores
    timi_score INTEGER,
    heart_score INTEGER,
    
    -- Treatment
    aspirin_given BOOLEAN DEFAULT FALSE,
    heparin_given BOOLEAN DEFAULT FALSE,
    cath_lab_activated BOOLEAN DEFAULT FALSE,
    pci_performed BOOLEAN DEFAULT FALSE,
    
    -- Disposition
    disposition VARCHAR(64),
    
    -- Audit
    event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    performed_by UUID REFERENCES users(id) NOT NULL,
    facility_id VARCHAR(64),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cardiac_patient ON cardiac_events(patient_id);
CREATE INDEX idx_cardiac_type ON cardiac_events(event_type);
CREATE INDEX idx_cardiac_stemi ON cardiac_events(event_type) WHERE event_type = 'STEMI';
CREATE INDEX idx_cardiac_time ON cardiac_events(event_time DESC);

-- Sepsis Assessments table (replaces sepsis_assessments HashMap)
CREATE TABLE IF NOT EXISTS sepsis_assessments (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
    
    -- SIRS Criteria
    temperature DECIMAL(4,1),
    heart_rate INTEGER,
    respiratory_rate INTEGER,
    wbc_count DECIMAL(6,2),
    sirs_criteria_met INTEGER DEFAULT 0,
    
    -- qSOFA Score
    altered_mental_status BOOLEAN DEFAULT FALSE,
    systolic_bp INTEGER,
    qsofa_score INTEGER CHECK (qsofa_score BETWEEN 0 AND 3),
    
    -- SOFA Score
    sofa_score INTEGER,
    sofa_components JSONB,
    
    -- Sepsis classification
    sepsis_level VARCHAR(32) CHECK (sepsis_level IN ('SIRS', 'Sepsis', 'SevereSepsis', 'SepticShock')),
    
    -- Source of infection
    suspected_source VARCHAR(64),
    confirmed_source VARCHAR(64),
    
    -- Labs
    lactate_value DECIMAL(4,2),
    procalcitonin DECIMAL(6,2),
    
    -- Bundle compliance
    blood_cultures_drawn BOOLEAN DEFAULT FALSE,
    antibiotics_given BOOLEAN DEFAULT FALSE,
    antibiotic_time TIMESTAMPTZ,
    fluid_bolus_given BOOLEAN DEFAULT FALSE,
    fluid_volume_ml INTEGER,
    vasopressors_started BOOLEAN DEFAULT FALSE,
    
    -- Disposition
    disposition VARCHAR(64),
    
    -- Audit
    assessment_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    performed_by UUID REFERENCES users(id) NOT NULL,
    facility_id VARCHAR(64),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sepsis_patient ON sepsis_assessments(patient_id);
CREATE INDEX idx_sepsis_level ON sepsis_assessments(sepsis_level);
CREATE INDEX idx_sepsis_shock ON sepsis_assessments(sepsis_level) WHERE sepsis_level = 'SepticShock';
CREATE INDEX idx_sepsis_time ON sepsis_assessments(assessment_time DESC);

-- ============================================================================
-- PART 3: CLINICAL DOCUMENTATION
-- ============================================================================

-- SOAP Notes table (replaces soap_notes HashMap)
CREATE TABLE IF NOT EXISTS soap_notes (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
    
    -- SOAP components
    subjective TEXT NOT NULL,
    objective TEXT NOT NULL,
    assessment TEXT NOT NULL,
    plan TEXT NOT NULL,
    
    -- Encounter info
    encounter_type VARCHAR(64),
    visit_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Diagnosis codes
    icd10_codes JSONB DEFAULT '[]',
    
    -- Addenda
    addenda JSONB DEFAULT '[]',
    
    -- Signature
    is_signed BOOLEAN DEFAULT FALSE,
    signed_at TIMESTAMPTZ,
    signed_by UUID REFERENCES users(id),
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) NOT NULL,
    facility_id VARCHAR(64)
);

CREATE INDEX idx_soap_patient ON soap_notes(patient_id);
CREATE INDEX idx_soap_date ON soap_notes(visit_date DESC);
CREATE INDEX idx_soap_signed ON soap_notes(is_signed);
CREATE INDEX idx_soap_created_by ON soap_notes(created_by);

-- Vital Signs table (replaces vital_signs HashMap)
CREATE TABLE IF NOT EXISTS vital_signs (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
    
    -- Core vitals
    heart_rate INTEGER,
    respiratory_rate INTEGER,
    blood_pressure_systolic INTEGER,
    blood_pressure_diastolic INTEGER,
    mean_arterial_pressure INTEGER,
    temperature DECIMAL(4,1),
    temperature_site VARCHAR(16),
    oxygen_saturation INTEGER,
    oxygen_delivery VARCHAR(32),
    fio2 INTEGER,
    
    -- Additional measurements
    pain_scale INTEGER CHECK (pain_scale BETWEEN 0 AND 10),
    gcs_score INTEGER CHECK (gcs_score BETWEEN 3 AND 15),
    gcs_eye INTEGER CHECK (gcs_eye BETWEEN 1 AND 4),
    gcs_verbal INTEGER CHECK (gcs_verbal BETWEEN 1 AND 5),
    gcs_motor INTEGER CHECK (gcs_motor BETWEEN 1 AND 6),
    blood_glucose INTEGER,
    weight_kg DECIMAL(5,1),
    height_cm DECIMAL(5,1),
    bmi DECIMAL(4,1),
    
    -- Context
    position VARCHAR(32),
    activity_level VARCHAR(32),
    
    -- Flags
    is_critical BOOLEAN DEFAULT FALSE,
    critical_values JSONB DEFAULT '[]',
    
    -- Audit
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recorded_by UUID REFERENCES users(id) NOT NULL,
    facility_id VARCHAR(64),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vitals_patient ON vital_signs(patient_id);
CREATE INDEX idx_vitals_time ON vital_signs(recorded_at DESC);
CREATE INDEX idx_vitals_critical ON vital_signs(is_critical) WHERE is_critical = TRUE;
CREATE INDEX idx_vitals_patient_time ON vital_signs(patient_id, recorded_at DESC);

-- ============================================================================
-- PART 4: ACCESS LOGS (replaces access_logs HashMap)
-- ============================================================================

CREATE TABLE IF NOT EXISTS access_logs (
    id VARCHAR(64) PRIMARY KEY,
    
    -- Who accessed
    accessor_id UUID REFERENCES users(id) NOT NULL,
    accessor_role VARCHAR(32) NOT NULL,
    
    -- What was accessed
    patient_id VARCHAR(64) REFERENCES patients(id) ON DELETE CASCADE,
    resource_type VARCHAR(64) NOT NULL,
    resource_id VARCHAR(64),
    
    -- Action
    action VARCHAR(32) NOT NULL CHECK (action IN ('View', 'Create', 'Update', 'Delete', 'Export', 'Print', 'EmergencyAccess')),
    
    -- Context
    access_reason TEXT,
    is_emergency_access BOOLEAN DEFAULT FALSE,
    
    -- Request info
    ip_address VARCHAR(45),
    user_agent TEXT,
    
    -- Blockchain reference
    blockchain_tx_hash VARCHAR(128),
    
    -- Timestamp
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    facility_id VARCHAR(64)
);

CREATE INDEX idx_access_logs_accessor ON access_logs(accessor_id);
CREATE INDEX idx_access_logs_patient ON access_logs(patient_id);
CREATE INDEX idx_access_logs_time ON access_logs(accessed_at DESC);
CREATE INDEX idx_access_logs_emergency ON access_logs(is_emergency_access) WHERE is_emergency_access = TRUE;
CREATE INDEX idx_access_logs_action ON access_logs(action);

-- ============================================================================
-- PART 5: TRIGGERS AND FUNCTIONS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND column_name = 'updated_at'
        AND table_name NOT IN ('users', 'user_profiles') -- Already have triggers
    LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS update_%I_updated_at ON %I;
            CREATE TRIGGER update_%I_updated_at
            BEFORE UPDATE ON %I
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        ', t, t, t, t);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PART 6: VIEWS FOR COMMON QUERIES
-- ============================================================================

-- Active patients with latest vitals
CREATE OR REPLACE VIEW v_patient_summary AS
SELECT 
    p.id,
    p.health_id,
    p.blood_type,
    p.gender,
    p.organ_donor,
    p.dnr_status,
    p.is_verified,
    p.created_at,
    u.name as primary_provider_name,
    (SELECT COUNT(*) FROM allergies a WHERE a.patient_id = p.id AND a.is_active = TRUE) as allergy_count,
    (SELECT MAX(recorded_at) FROM vital_signs v WHERE v.patient_id = p.id) as last_vitals_at
FROM patients p
LEFT JOIN users u ON p.primary_provider_id = u.id
WHERE p.is_active = TRUE;

-- Emergency department dashboard
CREATE OR REPLACE VIEW v_ed_dashboard AS
SELECT 
    t.id as triage_id,
    t.patient_id,
    p.health_id,
    t.esi_level,
    t.chief_complaint,
    t.is_critical,
    t.assigned_bed,
    t.triage_time,
    t.disposition,
    u.name as triage_nurse
FROM triage_assessments t
JOIN patients p ON t.patient_id = p.id
JOIN users u ON t.performed_by = u.id
WHERE t.triage_time > NOW() - INTERVAL '24 hours'
ORDER BY t.esi_level ASC, t.triage_time ASC;

-- Critical patients requiring attention
CREATE OR REPLACE VIEW v_critical_patients AS
SELECT 
    p.id as patient_id,
    p.health_id,
    'Triage' as source,
    t.esi_level as severity,
    t.chief_complaint as reason,
    t.triage_time as event_time
FROM triage_assessments t
JOIN patients p ON t.patient_id = p.id
WHERE t.is_critical = TRUE 
AND t.triage_time > NOW() - INTERVAL '24 hours'

UNION ALL

SELECT 
    p.id as patient_id,
    p.health_id,
    'Sepsis' as source,
    CASE s.sepsis_level 
        WHEN 'SepticShock' THEN 1 
        WHEN 'SevereSepsis' THEN 2 
        ELSE 3 
    END as severity,
    s.sepsis_level as reason,
    s.assessment_time as event_time
FROM sepsis_assessments s
JOIN patients p ON s.patient_id = p.id
WHERE s.sepsis_level IN ('SepticShock', 'SevereSepsis')
AND s.assessment_time > NOW() - INTERVAL '24 hours'

UNION ALL

SELECT 
    p.id as patient_id,
    p.health_id,
    'Stroke' as source,
    1 as severity,
    s.stroke_type as reason,
    s.assessment_time as event_time
FROM stroke_assessments s
JOIN patients p ON s.patient_id = p.id
WHERE s.tpa_candidate = TRUE 
AND s.assessment_time > NOW() - INTERVAL '24 hours'

ORDER BY severity ASC, event_time DESC;

-- ============================================================================
-- PART 7: COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE patients IS 'Core patient demographics with encrypted PII fields';
COMMENT ON TABLE nfc_tags IS 'NFC card/tag registry for patient identification';
COMMENT ON TABLE medical_records IS 'Medical record metadata with IPFS content references';
COMMENT ON TABLE allergies IS 'Patient allergies with severity classification';
COMMENT ON TABLE triage_assessments IS 'Emergency department triage using ESI 5-level system';
COMMENT ON TABLE code_blue_records IS 'Cardiac arrest and resuscitation documentation';
COMMENT ON TABLE trauma_assessments IS 'ATLS-compliant trauma assessments';
COMMENT ON TABLE stroke_assessments IS 'Stroke assessments with NIHSS scoring';
COMMENT ON TABLE cardiac_events IS 'Cardiac events including STEMI/NSTEMI';
COMMENT ON TABLE sepsis_assessments IS 'Sepsis assessments with qSOFA/SOFA scoring';
COMMENT ON TABLE soap_notes IS 'SOAP format clinical notes';
COMMENT ON TABLE vital_signs IS 'Vital signs measurements with critical value flags';
COMMENT ON TABLE access_logs IS 'HIPAA-compliant access audit trail';

-- Migration complete
SELECT 'Phase 1 migration complete: Created 13 tables for clinical data persistence' as status;
