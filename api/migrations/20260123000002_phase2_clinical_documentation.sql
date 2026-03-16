-- Phase 2 Clinical Documentation and Nursing Care Tables
-- Migration: 20260123000002_phase2_clinical_documentation.sql
-- Created: January 23, 2026
-- Purpose: Add clinical documentation and nursing care tables for MediChain

-- =============================================================================
-- SAMPLE Histories Table (Signs, Allergies, Medications, Past history, Last intake, Events)
-- =============================================================================
CREATE TABLE sample_histories (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    
    -- Signs and symptoms (stored as JSON array)
    signs_symptoms JSONB NOT NULL DEFAULT '[]',
    
    -- Past medical history (stored as JSON array)  
    past_medical_history JSONB NOT NULL DEFAULT '[]',
    
    -- Events leading to current situation
    events_leading TEXT NOT NULL,
    
    -- Last oral intake information (JSON object)
    last_intake JSONB,
    
    -- Medication list (JSON array) - not normalized for performance
    medications JSONB NOT NULL DEFAULT '[]',
    
    -- Allergy list (JSON array) - references separate allergies table
    allergies_snapshot JSONB NOT NULL DEFAULT '[]',
    
    -- Collection metadata
    collected_by UUID NOT NULL REFERENCES users(id),
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Standard audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    facility_id VARCHAR(64),
    is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_sample_histories_patient ON sample_histories(patient_id);
CREATE INDEX idx_sample_histories_collected_by ON sample_histories(collected_by);
CREATE INDEX idx_sample_histories_collected_at ON sample_histories(collected_at DESC);

-- =============================================================================
-- Glasgow Coma Scale Assessments Table
-- =============================================================================
CREATE TABLE gcs_assessments (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    
    -- Eye opening response (1-4)
    eye_response INTEGER NOT NULL CHECK (eye_response BETWEEN 1 AND 4),
    
    -- Verbal response (1-5)
    verbal_response INTEGER NOT NULL CHECK (verbal_response BETWEEN 1 AND 5),
    
    -- Motor response (1-6)
    motor_response INTEGER NOT NULL CHECK (motor_response BETWEEN 1 AND 6),
    
    -- Total score (automatically calculated: 3-15)
    total_score INTEGER GENERATED ALWAYS AS (eye_response + verbal_response + motor_response) STORED,
    
    -- Interpretation text
    interpretation VARCHAR(128) NOT NULL,
    
    -- Special notes
    notes TEXT,
    
    -- Pupil assessment (JSON object - optional)
    pupil_assessment JSONB,
    
    -- Assessment metadata
    assessed_by UUID NOT NULL REFERENCES users(id),
    assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Standard audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    facility_id VARCHAR(64)
);

CREATE INDEX idx_gcs_assessments_patient ON gcs_assessments(patient_id);
CREATE INDEX idx_gcs_assessments_total_score ON gcs_assessments(total_score);
CREATE INDEX idx_gcs_assessments_assessed_at ON gcs_assessments(assessed_at DESC);
CREATE INDEX idx_gcs_assessments_assessed_by ON gcs_assessments(assessed_by);

-- =============================================================================
-- Progress Notes Table
-- =============================================================================
CREATE TABLE progress_notes (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    
    -- Note content and metadata
    note_type VARCHAR(64) NOT NULL, -- 'physician', 'nursing', 'therapy', etc.
    subjective TEXT, -- Patient's reported experience
    objective TEXT, -- Observable findings
    assessment TEXT, -- Clinical impression
    plan_content TEXT, -- Treatment plan
    
    -- Additional structured data
    addendum TEXT, -- Any additions or corrections
    cosigned_by UUID REFERENCES users(id), -- Supervising provider
    cosigned_at TIMESTAMPTZ,
    
    -- Visit context
    visit_type VARCHAR(32), -- 'inpatient', 'outpatient', 'emergency', etc.
    encounter_id VARCHAR(64), -- Link to specific encounter/visit
    
    -- Creation metadata
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    facility_id VARCHAR(64),
    
    -- Document status
    status VARCHAR(32) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'amended', 'deleted')),
    is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_progress_notes_patient ON progress_notes(patient_id);
CREATE INDEX idx_progress_notes_type ON progress_notes(note_type);
CREATE INDEX idx_progress_notes_created_at ON progress_notes(created_at DESC);
CREATE INDEX idx_progress_notes_created_by ON progress_notes(created_by);
CREATE INDEX idx_progress_notes_encounter ON progress_notes(encounter_id);

-- =============================================================================
-- History and Physical Table
-- =============================================================================
CREATE TABLE history_physicals (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    
    -- Chief complaint and history
    chief_complaint TEXT NOT NULL,
    history_present_illness TEXT NOT NULL,
    past_medical_history TEXT,
    family_history TEXT,
    social_history TEXT,
    medications TEXT,
    allergies TEXT,
    
    -- Review of systems (JSON structure for flexibility)
    review_of_systems JSONB,
    
    -- Physical examination findings
    physical_exam JSONB NOT NULL, -- Structured exam findings
    vital_signs JSONB, -- Vital signs at time of exam
    
    -- Assessment and plan
    assessment TEXT NOT NULL,
    plan_content TEXT NOT NULL,
    
    -- Document metadata
    exam_type VARCHAR(32) DEFAULT 'comprehensive', -- 'comprehensive', 'focused', 'follow-up'
    
    -- Provider information
    performed_by UUID NOT NULL REFERENCES users(id),
    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Standard audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    facility_id VARCHAR(64),
    is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_history_physicals_patient ON history_physicals(patient_id);
CREATE INDEX idx_history_physicals_performed_by ON history_physicals(performed_by);
CREATE INDEX idx_history_physicals_performed_at ON history_physicals(performed_at DESC);
CREATE INDEX idx_history_physicals_exam_type ON history_physicals(exam_type);

-- =============================================================================
-- Consultation Notes Table
-- =============================================================================
CREATE TABLE consultation_notes (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    
    -- Consultation details
    consultation_type VARCHAR(64) NOT NULL, -- 'cardiology', 'neurology', 'psychiatry', etc.
    requesting_provider UUID NOT NULL REFERENCES users(id),
    consulting_provider UUID NOT NULL REFERENCES users(id),
    
    -- Clinical content
    reason_for_consultation TEXT NOT NULL,
    clinical_question TEXT,
    pertinent_history TEXT,
    examination_findings TEXT,
    recommendations TEXT NOT NULL,
    follow_up_plan TEXT,
    
    -- Consultation metadata
    urgency VARCHAR(16) DEFAULT 'routine' CHECK (urgency IN ('stat', 'urgent', 'routine')),
    status VARCHAR(16) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    
    -- Timing
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    -- Standard audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    facility_id VARCHAR(64),
    is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_consultation_notes_patient ON consultation_notes(patient_id);
CREATE INDEX idx_consultation_notes_type ON consultation_notes(consultation_type);
CREATE INDEX idx_consultation_notes_requesting ON consultation_notes(requesting_provider);
CREATE INDEX idx_consultation_notes_consulting ON consultation_notes(consulting_provider);
CREATE INDEX idx_consultation_notes_status ON consultation_notes(status);
CREATE INDEX idx_consultation_notes_urgency ON consultation_notes(urgency);

-- =============================================================================
-- Nursing Care Plans Table
-- =============================================================================
CREATE TABLE nursing_care_plans (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    
    -- Care plan metadata
    plan_name VARCHAR(128) NOT NULL,
    care_level VARCHAR(32), -- 'basic', 'intermediate', 'intensive', 'critical'
    
    -- Nursing diagnoses (JSON array)
    nursing_diagnoses JSONB NOT NULL DEFAULT '[]',
    
    -- Goals and outcomes (JSON array)
    goals JSONB NOT NULL DEFAULT '[]',
    
    -- Interventions (JSON array)
    interventions JSONB NOT NULL DEFAULT '[]',
    
    -- Evaluation notes
    evaluation_notes TEXT,
    
    -- Plan status and timing
    status VARCHAR(16) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'discontinued')),
    start_date DATE NOT NULL,
    target_end_date DATE,
    actual_end_date DATE,
    
    -- Provider information
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    
    -- Standard audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    facility_id VARCHAR(64),
    is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_nursing_care_plans_patient ON nursing_care_plans(patient_id);
CREATE INDEX idx_nursing_care_plans_status ON nursing_care_plans(status);
CREATE INDEX idx_nursing_care_plans_care_level ON nursing_care_plans(care_level);
CREATE INDEX idx_nursing_care_plans_start_date ON nursing_care_plans(start_date DESC);
CREATE INDEX idx_nursing_care_plans_created_by ON nursing_care_plans(created_by);

-- =============================================================================
-- Medication Administration Records Table
-- =============================================================================
CREATE TABLE medication_records (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    
    -- MAR date
    record_date DATE NOT NULL,
    
    -- Scheduled medications (JSON array)
    scheduled_medications JSONB NOT NULL DEFAULT '[]',
    
    -- PRN medications (JSON array) 
    prn_medications JSONB NOT NULL DEFAULT '[]',
    
    -- Continuous infusions (JSON array)
    infusions JSONB NOT NULL DEFAULT '[]',
    
    -- MAR completion status
    completion_status VARCHAR(16) DEFAULT 'pending' CHECK (completion_status IN ('pending', 'partial', 'complete')),
    completion_percentage INTEGER DEFAULT 0 CHECK (completion_percentage BETWEEN 0 AND 100),
    
    -- Nursing staff involved
    primary_nurse UUID REFERENCES users(id),
    
    -- Standard audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    facility_id VARCHAR(64),
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    -- Ensure one MAR per patient per date
    UNIQUE(patient_id, record_date)
);

CREATE INDEX idx_medication_records_patient ON medication_records(patient_id);
CREATE INDEX idx_medication_records_date ON medication_records(record_date DESC);
CREATE INDEX idx_medication_records_status ON medication_records(completion_status);
CREATE INDEX idx_medication_records_nurse ON medication_records(primary_nurse);

-- =============================================================================
-- Intake/Output Records Table  
-- =============================================================================
CREATE TABLE io_records (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    
    -- Record timing
    record_date DATE NOT NULL,
    shift VARCHAR(16) NOT NULL CHECK (shift IN ('day', 'evening', 'night', '24hr')),
    
    -- Intake totals (in mL)
    oral_intake INTEGER DEFAULT 0,
    iv_intake INTEGER DEFAULT 0,
    tube_feeding INTEGER DEFAULT 0,
    other_intake INTEGER DEFAULT 0,
    total_intake INTEGER GENERATED ALWAYS AS (oral_intake + iv_intake + tube_feeding + other_intake) STORED,
    
    -- Output totals (in mL)
    urine_output INTEGER DEFAULT 0,
    emesis INTEGER DEFAULT 0,
    drainage INTEGER DEFAULT 0,
    stool INTEGER DEFAULT 0,
    other_output INTEGER DEFAULT 0,
    total_output INTEGER GENERATED ALWAYS AS (urine_output + emesis + drainage + stool + other_output) STORED,
    
    -- Net balance (calculated from base columns since can't reference generated columns)
    net_balance INTEGER GENERATED ALWAYS AS ((oral_intake + iv_intake + tube_feeding + other_intake) - (urine_output + emesis + drainage + stool + other_output)) STORED,
    
    -- Detailed intake items (JSON array)
    intake_items JSONB DEFAULT '[]',
    
    -- Detailed output items (JSON array)
    output_items JSONB DEFAULT '[]',
    
    -- Special notes
    notes TEXT,
    
    -- Nursing staff
    recorded_by UUID NOT NULL REFERENCES users(id),
    verified_by UUID REFERENCES users(id),
    
    -- Standard audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    facility_id VARCHAR(64),
    
    -- Ensure one I/O record per patient per date per shift
    UNIQUE(patient_id, record_date, shift)
);

CREATE INDEX idx_io_records_patient ON io_records(patient_id);
CREATE INDEX idx_io_records_date ON io_records(record_date DESC);
CREATE INDEX idx_io_records_shift ON io_records(shift);
CREATE INDEX idx_io_records_net_balance ON io_records(net_balance);
CREATE INDEX idx_io_records_recorded_by ON io_records(recorded_by);

-- =============================================================================
-- Wound Assessments Table
-- =============================================================================
CREATE TABLE wound_assessments (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    
    -- Wound identification
    wound_id VARCHAR(64) NOT NULL, -- Links multiple assessments of same wound
    wound_location VARCHAR(128) NOT NULL,
    wound_type VARCHAR(32) NOT NULL, -- 'surgical', 'traumatic', 'pressure', 'diabetic', etc.
    
    -- Wound dimensions (in cm)
    length_cm DECIMAL(5,2),
    width_cm DECIMAL(5,2), 
    depth_cm DECIMAL(5,2),
    
    -- Wound characteristics
    tissue_type VARCHAR(32), -- 'granulation', 'slough', 'necrotic', 'epithelial'
    drainage_amount VARCHAR(16), -- 'none', 'minimal', 'moderate', 'heavy'
    drainage_type VARCHAR(32), -- 'serous', 'serosanguinous', 'sanguinous', 'purulent'
    
    -- Surrounding skin
    periwound_condition VARCHAR(32), -- 'intact', 'macerated', 'erythema', 'induration'
    
    -- Pain assessment
    pain_level INTEGER CHECK (pain_level BETWEEN 0 AND 10),
    
    -- Treatment applied
    treatment_applied TEXT,
    dressing_type VARCHAR(64),
    
    -- Clinical notes
    notes TEXT,
    photo_taken BOOLEAN DEFAULT false,
    
    -- Assessment metadata
    assessed_by UUID NOT NULL REFERENCES users(id),
    assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Standard audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    facility_id VARCHAR(64)
);

CREATE INDEX idx_wound_assessments_patient ON wound_assessments(patient_id);
CREATE INDEX idx_wound_assessments_wound_id ON wound_assessments(wound_id);
CREATE INDEX idx_wound_assessments_location ON wound_assessments(wound_location);
CREATE INDEX idx_wound_assessments_type ON wound_assessments(wound_type);
CREATE INDEX idx_wound_assessments_assessed_at ON wound_assessments(assessed_at DESC);
CREATE INDEX idx_wound_assessments_assessed_by ON wound_assessments(assessed_by);

-- =============================================================================
-- IV Site Assessments Table
-- =============================================================================
CREATE TABLE iv_assessments (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    
    -- IV site identification
    site_id VARCHAR(64) NOT NULL, -- Links assessments of same IV site
    site_location VARCHAR(64) NOT NULL, -- 'right_forearm', 'left_hand', etc.
    catheter_type VARCHAR(32), -- 'peripheral', 'central', 'picc', 'port'
    catheter_gauge VARCHAR(8), -- '18g', '20g', '22g', etc.
    
    -- Site assessment
    insertion_date DATE,
    patency VARCHAR(16) CHECK (patency IN ('patent', 'sluggish', 'occluded')),
    site_appearance VARCHAR(32), -- 'clean_dry', 'redness', 'swelling', 'drainage'
    
    -- Complications
    infiltration_grade INTEGER CHECK (infiltration_grade BETWEEN 0 AND 4),
    phlebitis_grade INTEGER CHECK (phlebitis_grade BETWEEN 0 AND 4),
    
    -- Current infusions (JSON array)
    current_infusions JSONB DEFAULT '[]',
    
    -- Dressing status
    dressing_intact BOOLEAN DEFAULT true,
    dressing_change_due DATE,
    
    -- Assessment findings
    pain_level INTEGER CHECK (pain_level BETWEEN 0 AND 10),
    notes TEXT,
    
    -- Actions taken
    actions_taken TEXT,
    site_discontinued BOOLEAN DEFAULT false,
    discontinuation_reason TEXT,
    
    -- Assessment metadata
    assessed_by UUID NOT NULL REFERENCES users(id),
    assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Standard audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    facility_id VARCHAR(64)
);

CREATE INDEX idx_iv_assessments_patient ON iv_assessments(patient_id);
CREATE INDEX idx_iv_assessments_site_id ON iv_assessments(site_id);
CREATE INDEX idx_iv_assessments_location ON iv_assessments(site_location);
CREATE INDEX idx_iv_assessments_patency ON iv_assessments(patency);
CREATE INDEX idx_iv_assessments_assessed_at ON iv_assessments(assessed_at DESC);
CREATE INDEX idx_iv_assessments_assessed_by ON iv_assessments(assessed_by);

-- =============================================================================
-- Fall Risk Assessments Table
-- =============================================================================
CREATE TABLE fall_risk_assessments (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    
    -- Assessment tool used
    assessment_tool VARCHAR(32) DEFAULT 'morse' CHECK (assessment_tool IN ('morse', 'hendrich', 'stratify', 'custom')),
    
    -- Morse Fall Scale factors (most common)
    history_of_falling INTEGER DEFAULT 0 CHECK (history_of_falling IN (0, 25)),
    secondary_diagnosis INTEGER DEFAULT 0 CHECK (secondary_diagnosis IN (0, 15)),
    ambulatory_aid INTEGER DEFAULT 0 CHECK (ambulatory_aid IN (0, 15, 30)),
    iv_therapy INTEGER DEFAULT 0 CHECK (iv_therapy IN (0, 20)),
    gait_status INTEGER DEFAULT 0 CHECK (gait_status IN (0, 10, 20)),
    mental_status INTEGER DEFAULT 0 CHECK (mental_status IN (0, 15)),
    
    -- Total score (calculated)
    total_score INTEGER GENERATED ALWAYS AS (
        history_of_falling + secondary_diagnosis + ambulatory_aid + 
        iv_therapy + gait_status + mental_status
    ) STORED,
    
    -- Risk level based on score
    risk_level VARCHAR(16) GENERATED ALWAYS AS (
        CASE 
            WHEN (history_of_falling + secondary_diagnosis + ambulatory_aid + 
                  iv_therapy + gait_status + mental_status) < 25 THEN 'low'
            WHEN (history_of_falling + secondary_diagnosis + ambulatory_aid + 
                  iv_therapy + gait_status + mental_status) < 45 THEN 'moderate' 
            ELSE 'high'
        END
    ) STORED,
    
    -- Additional risk factors (JSON array)
    additional_factors JSONB DEFAULT '[]',
    
    -- Interventions implemented (JSON array)
    interventions JSONB DEFAULT '[]',
    
    -- Assessment notes
    notes TEXT,
    
    -- Assessment metadata
    assessed_by UUID NOT NULL REFERENCES users(id),
    assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_assessment_due TIMESTAMPTZ,
    
    -- Standard audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    facility_id VARCHAR(64)
);

CREATE INDEX idx_fall_risk_assessments_patient ON fall_risk_assessments(patient_id);
CREATE INDEX idx_fall_risk_assessments_total_score ON fall_risk_assessments(total_score DESC);
CREATE INDEX idx_fall_risk_assessments_risk_level ON fall_risk_assessments(risk_level);
CREATE INDEX idx_fall_risk_assessments_assessed_at ON fall_risk_assessments(assessed_at DESC);
CREATE INDEX idx_fall_risk_assessments_assessed_by ON fall_risk_assessments(assessed_by);
CREATE INDEX idx_fall_risk_assessments_due ON fall_risk_assessments(next_assessment_due);

-- =============================================================================
-- Create triggers for updated_at timestamps
-- =============================================================================

-- Create trigger function if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS '
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        ' LANGUAGE plpgsql;
    END IF;
END $$;

-- Apply triggers to all Phase 2 tables
CREATE TRIGGER update_sample_histories_updated_at 
    BEFORE UPDATE ON sample_histories 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_gcs_assessments_updated_at 
    BEFORE UPDATE ON gcs_assessments 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_progress_notes_updated_at 
    BEFORE UPDATE ON progress_notes 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_history_physicals_updated_at 
    BEFORE UPDATE ON history_physicals 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_consultation_notes_updated_at 
    BEFORE UPDATE ON consultation_notes 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_nursing_care_plans_updated_at 
    BEFORE UPDATE ON nursing_care_plans 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_medication_records_updated_at 
    BEFORE UPDATE ON medication_records 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_io_records_updated_at 
    BEFORE UPDATE ON io_records 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_wound_assessments_updated_at 
    BEFORE UPDATE ON wound_assessments 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_iv_assessments_updated_at 
    BEFORE UPDATE ON iv_assessments 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_fall_risk_assessments_updated_at 
    BEFORE UPDATE ON fall_risk_assessments 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- Create useful views for Phase 2 data
-- =============================================================================

-- View: Active nursing care plans by patient
CREATE OR REPLACE VIEW v_active_nursing_care_plans AS
SELECT 
    ncp.patient_id,
    p.health_id,
    ncp.plan_name,
    ncp.care_level,
    ncp.status,
    ncp.start_date,
    ncp.target_end_date,
    u.name as created_by_name,
    ncp.created_at
FROM nursing_care_plans ncp
JOIN patients p ON ncp.patient_id = p.id
JOIN users u ON ncp.created_by = u.id
WHERE ncp.status = 'active' 
AND ncp.is_active = true
ORDER BY ncp.start_date DESC;

-- View: High fall risk patients
CREATE OR REPLACE VIEW v_high_fall_risk_patients AS
SELECT 
    fra.patient_id,
    p.health_id,
    fra.total_score,
    fra.risk_level,
    fra.assessed_at,
    fra.next_assessment_due,
    u.name as assessed_by_name,
    fra.interventions
FROM fall_risk_assessments fra
JOIN patients p ON fra.patient_id = p.id  
JOIN users u ON fra.assessed_by = u.id
WHERE fra.risk_level IN ('moderate', 'high')
AND fra.assessed_at = (
    SELECT MAX(assessed_at) 
    FROM fall_risk_assessments fra2 
    WHERE fra2.patient_id = fra.patient_id
)
ORDER BY fra.total_score DESC;

-- View: Recent wound assessments needing attention
CREATE OR REPLACE VIEW v_wound_care_alerts AS
SELECT 
    wa.patient_id,
    p.health_id,
    wa.wound_id,
    wa.wound_location,
    wa.wound_type,
    wa.drainage_amount,
    wa.pain_level,
    wa.assessed_at,
    wa.notes,
    u.name as assessed_by_name
FROM wound_assessments wa
JOIN patients p ON wa.patient_id = p.id
JOIN users u ON wa.assessed_by = u.id
WHERE (wa.drainage_amount IN ('moderate', 'heavy') 
    OR wa.pain_level >= 7
    OR wa.periwound_condition != 'intact')
AND wa.assessed_at >= NOW() - INTERVAL '24 hours'
ORDER BY wa.assessed_at DESC;

-- Add comment on migration
COMMENT ON SCHEMA public IS 'MediChain Phase 2 Clinical Documentation Migration - January 23, 2026';
