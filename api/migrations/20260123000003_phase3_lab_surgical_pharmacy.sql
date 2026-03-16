-- Phase 3: Lab & Diagnostics, Surgical, Radiology, Blood Bank, Pharmacy
-- MediChain PostgreSQL Migration - January 2026
-- 
-- This migration creates tables for:
-- 1. Lab & Diagnostics (7 tables)
-- 2. Surgical & Procedures (7 tables)
-- 3. Radiology & Imaging (3 tables)
-- 4. Blood Bank (3 tables)
-- 5. Pharmacy & Medications (4 tables)
--
-- Total: 24 tables

-- ============================================================================
-- SECTION 1: LAB & DIAGNOSTICS (7 tables)
-- ============================================================================

-- Lab Submissions - Orders for laboratory tests
CREATE TABLE IF NOT EXISTS lab_submissions (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    ordering_provider_id UUID NOT NULL REFERENCES users(id),
    order_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    priority VARCHAR(32) NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent', 'stat', 'asap')),
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'collected', 'in_progress', 'completed', 'cancelled')),
    tests_ordered JSONB NOT NULL DEFAULT '[]',
    clinical_notes TEXT,
    diagnosis_codes JSONB DEFAULT '[]',
    fasting_required BOOLEAN NOT NULL DEFAULT false,
    collection_instructions TEXT,
    expected_completion TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lab_submissions_patient ON lab_submissions(patient_id);
CREATE INDEX idx_lab_submissions_provider ON lab_submissions(ordering_provider_id);
CREATE INDEX idx_lab_submissions_status ON lab_submissions(status);
CREATE INDEX idx_lab_submissions_priority ON lab_submissions(priority);
CREATE INDEX idx_lab_submissions_date ON lab_submissions(order_date DESC);

-- Lab Panels - Groupings of related tests
CREATE TABLE IF NOT EXISTS lab_panels (
    id VARCHAR(64) PRIMARY KEY,
    submission_id VARCHAR(64) NOT NULL REFERENCES lab_submissions(id) ON DELETE CASCADE,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    panel_code VARCHAR(32) NOT NULL,
    panel_name VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    results JSONB DEFAULT '[]',
    reference_ranges JSONB DEFAULT '{}',
    abnormal_flags JSONB DEFAULT '[]',
    performing_lab VARCHAR(128),
    technician_id UUID REFERENCES users(id),
    verified_by UUID REFERENCES users(id),
    collected_at TIMESTAMPTZ,
    resulted_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lab_panels_submission ON lab_panels(submission_id);
CREATE INDEX idx_lab_panels_patient ON lab_panels(patient_id);
CREATE INDEX idx_lab_panels_code ON lab_panels(panel_code);
CREATE INDEX idx_lab_panels_status ON lab_panels(status);

-- Lab QC Records - Quality control for laboratory
CREATE TABLE IF NOT EXISTS lab_qc_records (
    id VARCHAR(64) PRIMARY KEY,
    instrument_id VARCHAR(64) NOT NULL,
    instrument_name VARCHAR(128) NOT NULL,
    qc_level VARCHAR(32) NOT NULL CHECK (qc_level IN ('level1', 'level2', 'level3')),
    test_code VARCHAR(32) NOT NULL,
    test_name VARCHAR(128) NOT NULL,
    expected_value DECIMAL(12,4) NOT NULL,
    measured_value DECIMAL(12,4) NOT NULL,
    unit VARCHAR(32) NOT NULL,
    acceptable_range_low DECIMAL(12,4) NOT NULL,
    acceptable_range_high DECIMAL(12,4) NOT NULL,
    passed BOOLEAN NOT NULL,
    deviation_percent DECIMAL(8,4),
    corrective_action TEXT,
    performed_by UUID NOT NULL REFERENCES users(id),
    reviewed_by UUID REFERENCES users(id),
    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    lot_number VARCHAR(64),
    expiration_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lab_qc_instrument ON lab_qc_records(instrument_id);
CREATE INDEX idx_lab_qc_test ON lab_qc_records(test_code);
CREATE INDEX idx_lab_qc_performed ON lab_qc_records(performed_at DESC);
CREATE INDEX idx_lab_qc_passed ON lab_qc_records(passed);

-- Critical Values - Abnormal lab results requiring immediate notification
CREATE TABLE IF NOT EXISTS critical_values (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    lab_panel_id VARCHAR(64) REFERENCES lab_panels(id),
    test_code VARCHAR(32) NOT NULL,
    test_name VARCHAR(128) NOT NULL,
    value DECIMAL(12,4) NOT NULL,
    unit VARCHAR(32) NOT NULL,
    reference_low DECIMAL(12,4),
    reference_high DECIMAL(12,4),
    critical_low DECIMAL(12,4),
    critical_high DECIMAL(12,4),
    severity VARCHAR(16) NOT NULL CHECK (severity IN ('critical', 'panic', 'alert')),
    notified_provider_id UUID REFERENCES users(id),
    notification_method VARCHAR(32),
    notified_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES users(id),
    action_taken TEXT,
    reported_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_critical_values_patient ON critical_values(patient_id);
CREATE INDEX idx_critical_values_severity ON critical_values(severity);
CREATE INDEX idx_critical_values_acknowledged ON critical_values(acknowledged_at);
CREATE INDEX idx_critical_values_created ON critical_values(created_at DESC);

-- Specimen Collections - Physical sample collection tracking
CREATE TABLE IF NOT EXISTS specimen_collections (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    submission_id VARCHAR(64) NOT NULL REFERENCES lab_submissions(id),
    specimen_type VARCHAR(64) NOT NULL,
    collection_site VARCHAR(128),
    collection_method VARCHAR(64),
    collector_id UUID NOT NULL REFERENCES users(id),
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_at TIMESTAMPTZ,
    received_by UUID REFERENCES users(id),
    container_type VARCHAR(64),
    volume_ml DECIMAL(8,2),
    temperature_c DECIMAL(5,2),
    condition VARCHAR(32) DEFAULT 'acceptable' CHECK (condition IN ('acceptable', 'hemolyzed', 'lipemic', 'icteric', 'clotted', 'insufficient')),
    barcode VARCHAR(64) UNIQUE,
    storage_location VARCHAR(128),
    chain_of_custody JSONB DEFAULT '[]',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_specimen_patient ON specimen_collections(patient_id);
CREATE INDEX idx_specimen_submission ON specimen_collections(submission_id);
CREATE INDEX idx_specimen_barcode ON specimen_collections(barcode);
CREATE INDEX idx_specimen_collected ON specimen_collections(collected_at DESC);

-- Specimen Rejections - Rejected specimens with reasons
CREATE TABLE IF NOT EXISTS specimen_rejections (
    id VARCHAR(64) PRIMARY KEY,
    specimen_id VARCHAR(64) NOT NULL REFERENCES specimen_collections(id),
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    rejection_reason VARCHAR(128) NOT NULL,
    rejection_category VARCHAR(64) NOT NULL CHECK (rejection_category IN ('collection_error', 'transport_error', 'labeling_error', 'specimen_quality', 'container_issue', 'other')),
    detailed_notes TEXT,
    rejected_by UUID NOT NULL REFERENCES users(id),
    rejected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recollection_required BOOLEAN NOT NULL DEFAULT true,
    recollection_scheduled TIMESTAMPTZ,
    notified_ordering_provider BOOLEAN NOT NULL DEFAULT false,
    notification_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rejection_specimen ON specimen_rejections(specimen_id);
CREATE INDEX idx_rejection_patient ON specimen_rejections(patient_id);
CREATE INDEX idx_rejection_category ON specimen_rejections(rejection_category);
CREATE INDEX idx_rejection_date ON specimen_rejections(rejected_at DESC);

-- Lab Trends - Historical trend data for lab values
CREATE TABLE IF NOT EXISTS lab_trends (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    test_code VARCHAR(32) NOT NULL,
    test_name VARCHAR(128) NOT NULL,
    values_json JSONB NOT NULL DEFAULT '[]',
    unit VARCHAR(32) NOT NULL,
    reference_low DECIMAL(12,4),
    reference_high DECIMAL(12,4),
    trend_direction VARCHAR(16) CHECK (trend_direction IN ('increasing', 'decreasing', 'stable', 'fluctuating')),
    percent_change DECIMAL(8,4),
    first_value_date TIMESTAMPTZ,
    last_value_date TIMESTAMPTZ,
    data_points_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lab_trends_patient ON lab_trends(patient_id);
CREATE INDEX idx_lab_trends_test ON lab_trends(test_code);
CREATE INDEX idx_lab_trends_patient_test ON lab_trends(patient_id, test_code);

-- ============================================================================
-- SECTION 2: SURGICAL & PROCEDURES (7 tables)
-- ============================================================================

-- Pre-Op Assessments - Pre-operative evaluations
CREATE TABLE IF NOT EXISTS pre_op_assessments (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    procedure_name VARCHAR(256) NOT NULL,
    procedure_code VARCHAR(32),
    scheduled_date TIMESTAMPTZ,
    surgeon_id UUID NOT NULL REFERENCES users(id),
    anesthesiologist_id UUID REFERENCES users(id),
    asa_classification VARCHAR(8) CHECK (asa_classification IN ('I', 'II', 'III', 'IV', 'V', 'VI', 'I-E', 'II-E', 'III-E', 'IV-E', 'V-E')),
    mallampati_score INTEGER CHECK (mallampati_score BETWEEN 1 AND 4),
    airway_assessment JSONB DEFAULT '{}',
    cardiac_assessment JSONB DEFAULT '{}',
    pulmonary_assessment JSONB DEFAULT '{}',
    renal_assessment JSONB DEFAULT '{}',
    hepatic_assessment JSONB DEFAULT '{}',
    medications_reviewed JSONB DEFAULT '[]',
    allergies_confirmed BOOLEAN NOT NULL DEFAULT false,
    npo_status VARCHAR(64),
    labs_reviewed JSONB DEFAULT '[]',
    ekg_reviewed BOOLEAN DEFAULT false,
    chest_xray_reviewed BOOLEAN DEFAULT false,
    consent_signed BOOLEAN NOT NULL DEFAULT false,
    blood_type_confirmed BOOLEAN DEFAULT false,
    risk_score DECIMAL(5,2),
    assessment_notes TEXT,
    assessed_by UUID NOT NULL REFERENCES users(id),
    assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cleared_for_surgery BOOLEAN NOT NULL DEFAULT false,
    clearance_conditions TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_preop_patient ON pre_op_assessments(patient_id);
CREATE INDEX idx_preop_surgeon ON pre_op_assessments(surgeon_id);
CREATE INDEX idx_preop_scheduled ON pre_op_assessments(scheduled_date);
CREATE INDEX idx_preop_cleared ON pre_op_assessments(cleared_for_surgery);

-- Operative Notes - Surgical procedure documentation
CREATE TABLE IF NOT EXISTS operative_notes (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    pre_op_assessment_id VARCHAR(64) REFERENCES pre_op_assessments(id),
    procedure_name VARCHAR(256) NOT NULL,
    procedure_codes JSONB DEFAULT '[]',
    preoperative_diagnosis TEXT NOT NULL,
    postoperative_diagnosis TEXT NOT NULL,
    surgeon_id UUID NOT NULL REFERENCES users(id),
    assistant_surgeons JSONB DEFAULT '[]',
    anesthesiologist_id UUID REFERENCES users(id),
    anesthesia_type VARCHAR(64) NOT NULL,
    scrub_nurse_id UUID REFERENCES users(id),
    circulating_nurse_id UUID REFERENCES users(id),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    incision_time TIMESTAMPTZ,
    closure_time TIMESTAMPTZ,
    estimated_blood_loss_ml INTEGER,
    fluids_given_ml INTEGER,
    blood_products_given JSONB DEFAULT '[]',
    specimens_collected JSONB DEFAULT '[]',
    implants_used JSONB DEFAULT '[]',
    drains_placed JSONB DEFAULT '[]',
    operative_findings TEXT,
    procedure_description TEXT NOT NULL,
    complications TEXT,
    disposition VARCHAR(64),
    post_op_orders TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_operative_patient ON operative_notes(patient_id);
CREATE INDEX idx_operative_surgeon ON operative_notes(surgeon_id);
CREATE INDEX idx_operative_start ON operative_notes(start_time DESC);
CREATE INDEX idx_operative_procedure ON operative_notes(procedure_name);

-- Post-Op Notes - Post-operative follow-up documentation
CREATE TABLE IF NOT EXISTS post_op_notes (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    operative_note_id VARCHAR(64) NOT NULL REFERENCES operative_notes(id),
    post_op_day INTEGER NOT NULL DEFAULT 0,
    note_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    provider_id UUID NOT NULL REFERENCES users(id),
    pain_level INTEGER CHECK (pain_level BETWEEN 0 AND 10),
    pain_management TEXT,
    vital_signs JSONB DEFAULT '{}',
    wound_assessment JSONB DEFAULT '{}',
    drain_output JSONB DEFAULT '[]',
    diet_status VARCHAR(64),
    ambulation_status VARCHAR(64),
    voiding_status VARCHAR(64),
    bowel_function VARCHAR(64),
    lab_results_reviewed JSONB DEFAULT '[]',
    complications TEXT,
    plan TEXT,
    discharge_criteria_met BOOLEAN NOT NULL DEFAULT false,
    estimated_discharge_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_postop_patient ON post_op_notes(patient_id);
CREATE INDEX idx_postop_operative ON post_op_notes(operative_note_id);
CREATE INDEX idx_postop_day ON post_op_notes(post_op_day);
CREATE INDEX idx_postop_date ON post_op_notes(note_date DESC);

-- Anesthesia Records - Anesthesia administration documentation
CREATE TABLE IF NOT EXISTS anesthesia_records (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    operative_note_id VARCHAR(64) REFERENCES operative_notes(id),
    anesthesiologist_id UUID NOT NULL REFERENCES users(id),
    crna_id UUID REFERENCES users(id),
    anesthesia_type VARCHAR(64) NOT NULL CHECK (anesthesia_type IN ('general', 'regional', 'local', 'sedation', 'combined', 'mac')),
    asa_classification VARCHAR(8),
    airway_management JSONB DEFAULT '{}',
    induction_agents JSONB DEFAULT '[]',
    maintenance_agents JSONB DEFAULT '[]',
    neuromuscular_blockers JSONB DEFAULT '[]',
    reversal_agents JSONB DEFAULT '[]',
    vasopressors JSONB DEFAULT '[]',
    intraop_fluids JSONB DEFAULT '[]',
    blood_products JSONB DEFAULT '[]',
    monitoring JSONB DEFAULT '{}',
    vital_signs_timeline JSONB DEFAULT '[]',
    events JSONB DEFAULT '[]',
    complications TEXT,
    emergence_time TIMESTAMPTZ,
    extubation_time TIMESTAMPTZ,
    pacu_arrival_time TIMESTAMPTZ,
    pacu_discharge_time TIMESTAMPTZ,
    aldrete_score_arrival INTEGER CHECK (aldrete_score_arrival BETWEEN 0 AND 10),
    aldrete_score_discharge INTEGER CHECK (aldrete_score_discharge BETWEEN 0 AND 10),
    post_anesthesia_orders TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_anesthesia_patient ON anesthesia_records(patient_id);
CREATE INDEX idx_anesthesia_provider ON anesthesia_records(anesthesiologist_id);
CREATE INDEX idx_anesthesia_operative ON anesthesia_records(operative_note_id);
CREATE INDEX idx_anesthesia_type ON anesthesia_records(anesthesia_type);

-- Intubation Records - Airway management documentation
CREATE TABLE IF NOT EXISTS intubation_records (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    indication VARCHAR(128) NOT NULL,
    urgency VARCHAR(32) NOT NULL CHECK (urgency IN ('emergent', 'urgent', 'elective')),
    intubator_id UUID NOT NULL REFERENCES users(id),
    assistant_id UUID REFERENCES users(id),
    pre_oxygenation BOOLEAN NOT NULL DEFAULT true,
    pre_oxygenation_method VARCHAR(64),
    induction_agents JSONB DEFAULT '[]',
    paralytic_agent VARCHAR(64),
    paralytic_dose VARCHAR(32),
    laryngoscope_type VARCHAR(64),
    blade_size VARCHAR(16),
    ett_size DECIMAL(3,1) NOT NULL,
    ett_depth_cm DECIMAL(4,1),
    cuff_pressure_cmh2o DECIMAL(4,1),
    attempts INTEGER NOT NULL DEFAULT 1,
    view_grade VARCHAR(8) CHECK (view_grade IN ('I', 'IIa', 'IIb', 'III', 'IV')),
    adjuncts_used JSONB DEFAULT '[]',
    difficult_airway BOOLEAN NOT NULL DEFAULT false,
    difficult_airway_features JSONB DEFAULT '[]',
    complications JSONB DEFAULT '[]',
    verification_methods JSONB DEFAULT '[]',
    post_intubation_vitals JSONB DEFAULT '{}',
    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_intubation_patient ON intubation_records(patient_id);
CREATE INDEX idx_intubation_intubator ON intubation_records(intubator_id);
CREATE INDEX idx_intubation_urgency ON intubation_records(urgency);
CREATE INDEX idx_intubation_performed ON intubation_records(performed_at DESC);

-- Laceration Repairs - Wound closure documentation
CREATE TABLE IF NOT EXISTS laceration_repairs (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    location VARCHAR(128) NOT NULL,
    length_cm DECIMAL(5,2) NOT NULL,
    depth_cm DECIMAL(5,2),
    width_cm DECIMAL(5,2),
    mechanism VARCHAR(128),
    contamination_level VARCHAR(32) CHECK (contamination_level IN ('clean', 'clean_contaminated', 'contaminated', 'dirty')),
    wound_age_hours DECIMAL(5,1),
    tetanus_status VARCHAR(32),
    tetanus_given BOOLEAN DEFAULT false,
    anesthesia_type VARCHAR(64) NOT NULL,
    anesthetic_agent VARCHAR(64),
    anesthetic_volume_ml DECIMAL(5,2),
    irrigation_solution VARCHAR(64),
    irrigation_volume_ml INTEGER,
    debridement_performed BOOLEAN NOT NULL DEFAULT false,
    closure_technique VARCHAR(64) NOT NULL,
    suture_material VARCHAR(64),
    suture_size VARCHAR(16),
    number_of_sutures INTEGER,
    deep_sutures_placed BOOLEAN DEFAULT false,
    skin_adhesive_used BOOLEAN DEFAULT false,
    steri_strips_applied BOOLEAN DEFAULT false,
    dressing_applied VARCHAR(128),
    complications TEXT,
    aftercare_instructions TEXT,
    follow_up_date DATE,
    suture_removal_date DATE,
    performed_by UUID NOT NULL REFERENCES users(id),
    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_laceration_patient ON laceration_repairs(patient_id);
CREATE INDEX idx_laceration_location ON laceration_repairs(location);
CREATE INDEX idx_laceration_performed ON laceration_repairs(performed_at DESC);

-- Splint/Cast Records - Orthopedic immobilization documentation
CREATE TABLE IF NOT EXISTS splint_cast_records (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    injury_type VARCHAR(128) NOT NULL,
    injury_location VARCHAR(128) NOT NULL,
    laterality VARCHAR(16) CHECK (laterality IN ('left', 'right', 'bilateral')),
    fracture_type VARCHAR(64),
    immobilization_type VARCHAR(32) NOT NULL CHECK (immobilization_type IN ('splint', 'cast', 'brace', 'sling', 'boot')),
    material VARCHAR(64) NOT NULL,
    position VARCHAR(64),
    padding_type VARCHAR(64),
    neurovascular_check_pre JSONB DEFAULT '{}',
    neurovascular_check_post JSONB DEFAULT '{}',
    xray_pre BOOLEAN DEFAULT false,
    xray_post BOOLEAN DEFAULT false,
    reduction_performed BOOLEAN DEFAULT false,
    reduction_technique VARCHAR(128),
    anesthesia_type VARCHAR(64),
    complications TEXT,
    weight_bearing_status VARCHAR(64),
    elevation_instructions BOOLEAN DEFAULT true,
    ice_instructions BOOLEAN DEFAULT true,
    follow_up_date DATE,
    follow_up_provider VARCHAR(64),
    removal_date DATE,
    applied_by UUID NOT NULL REFERENCES users(id),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_splint_patient ON splint_cast_records(patient_id);
CREATE INDEX idx_splint_location ON splint_cast_records(injury_location);
CREATE INDEX idx_splint_type ON splint_cast_records(immobilization_type);
CREATE INDEX idx_splint_applied ON splint_cast_records(applied_at DESC);

-- ============================================================================
-- SECTION 3: RADIOLOGY & IMAGING (3 tables)
-- ============================================================================

-- Radiology Orders - Imaging study requests
CREATE TABLE IF NOT EXISTS radiology_orders (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    ordering_provider_id UUID NOT NULL REFERENCES users(id),
    modality VARCHAR(32) NOT NULL CHECK (modality IN ('xray', 'ct', 'mri', 'ultrasound', 'pet', 'nuclear', 'fluoroscopy', 'mammography', 'dexa')),
    study_type VARCHAR(128) NOT NULL,
    body_part VARCHAR(128) NOT NULL,
    laterality VARCHAR(16) CHECK (laterality IN ('left', 'right', 'bilateral', 'na')),
    priority VARCHAR(32) NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent', 'stat', 'asap')),
    status VARCHAR(32) NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'scheduled', 'in_progress', 'completed', 'cancelled')),
    clinical_indication TEXT NOT NULL,
    diagnosis_codes JSONB DEFAULT '[]',
    contrast_required BOOLEAN DEFAULT false,
    contrast_type VARCHAR(64),
    sedation_required BOOLEAN DEFAULT false,
    patient_prep_instructions TEXT,
    special_instructions TEXT,
    scheduled_datetime TIMESTAMPTZ,
    completed_datetime TIMESTAMPTZ,
    performing_technologist_id UUID REFERENCES users(id),
    accession_number VARCHAR(64) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_radiology_orders_patient ON radiology_orders(patient_id);
CREATE INDEX idx_radiology_orders_provider ON radiology_orders(ordering_provider_id);
CREATE INDEX idx_radiology_orders_modality ON radiology_orders(modality);
CREATE INDEX idx_radiology_orders_status ON radiology_orders(status);
CREATE INDEX idx_radiology_orders_accession ON radiology_orders(accession_number);
CREATE INDEX idx_radiology_orders_scheduled ON radiology_orders(scheduled_datetime);

-- Radiology Reports - Imaging interpretation reports
CREATE TABLE IF NOT EXISTS radiology_reports (
    id VARCHAR(64) PRIMARY KEY,
    order_id VARCHAR(64) NOT NULL REFERENCES radiology_orders(id),
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    radiologist_id UUID NOT NULL REFERENCES users(id),
    study_datetime TIMESTAMPTZ NOT NULL,
    report_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    comparison_studies TEXT,
    technique TEXT,
    findings TEXT NOT NULL,
    impression TEXT NOT NULL,
    recommendations TEXT,
    critical_finding BOOLEAN NOT NULL DEFAULT false,
    critical_finding_communicated BOOLEAN DEFAULT false,
    communicated_to UUID REFERENCES users(id),
    communicated_at TIMESTAMPTZ,
    communication_method VARCHAR(32),
    addendum TEXT,
    addendum_datetime TIMESTAMPTZ,
    addendum_by UUID REFERENCES users(id),
    status VARCHAR(32) NOT NULL DEFAULT 'preliminary' CHECK (status IN ('preliminary', 'final', 'amended', 'corrected')),
    image_count INTEGER,
    pacs_study_uid VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_radiology_reports_order ON radiology_reports(order_id);
CREATE INDEX idx_radiology_reports_patient ON radiology_reports(patient_id);
CREATE INDEX idx_radiology_reports_radiologist ON radiology_reports(radiologist_id);
CREATE INDEX idx_radiology_reports_critical ON radiology_reports(critical_finding);
CREATE INDEX idx_radiology_reports_status ON radiology_reports(status);
CREATE INDEX idx_radiology_reports_datetime ON radiology_reports(report_datetime DESC);

-- Pathology Reports - Tissue/cytology analysis reports
CREATE TABLE IF NOT EXISTS pathology_reports (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    specimen_id VARCHAR(64) REFERENCES specimen_collections(id),
    ordering_provider_id UUID NOT NULL REFERENCES users(id),
    pathologist_id UUID NOT NULL REFERENCES users(id),
    specimen_type VARCHAR(128) NOT NULL,
    specimen_source VARCHAR(128) NOT NULL,
    collection_date TIMESTAMPTZ NOT NULL,
    received_date TIMESTAMPTZ NOT NULL,
    report_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    clinical_history TEXT,
    gross_description TEXT NOT NULL,
    microscopic_description TEXT NOT NULL,
    special_stains JSONB DEFAULT '[]',
    immunohistochemistry JSONB DEFAULT '[]',
    molecular_studies JSONB DEFAULT '[]',
    diagnosis TEXT NOT NULL,
    staging VARCHAR(64),
    tnm_classification JSONB DEFAULT '{}',
    margin_status VARCHAR(64),
    lymph_node_status JSONB DEFAULT '{}',
    comments TEXT,
    addendum TEXT,
    addendum_datetime TIMESTAMPTZ,
    addendum_by UUID REFERENCES users(id),
    status VARCHAR(32) NOT NULL DEFAULT 'preliminary' CHECK (status IN ('preliminary', 'final', 'amended', 'corrected')),
    synoptic_report JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pathology_patient ON pathology_reports(patient_id);
CREATE INDEX idx_pathology_pathologist ON pathology_reports(pathologist_id);
CREATE INDEX idx_pathology_specimen_type ON pathology_reports(specimen_type);
CREATE INDEX idx_pathology_status ON pathology_reports(status);
CREATE INDEX idx_pathology_report_date ON pathology_reports(report_date DESC);

-- ============================================================================
-- SECTION 4: BLOOD BANK (3 tables)
-- ============================================================================

-- Blood Type Screens - ABO/Rh typing and antibody screens
CREATE TABLE IF NOT EXISTS blood_type_screens (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    specimen_id VARCHAR(64) REFERENCES specimen_collections(id),
    abo_type VARCHAR(8) NOT NULL CHECK (abo_type IN ('A', 'B', 'AB', 'O')),
    rh_type VARCHAR(16) NOT NULL CHECK (rh_type IN ('positive', 'negative')),
    abo_confirmation VARCHAR(8),
    rh_confirmation VARCHAR(16),
    weak_d_testing BOOLEAN DEFAULT false,
    weak_d_result VARCHAR(16),
    antibody_screen_result VARCHAR(16) NOT NULL CHECK (antibody_screen_result IN ('negative', 'positive', 'indeterminate')),
    antibodies_identified JSONB DEFAULT '[]',
    antibody_titer JSONB DEFAULT '{}',
    direct_antiglobulin_test VARCHAR(16) CHECK (direct_antiglobulin_test IN ('negative', 'positive', 'not_performed')),
    dat_specificity JSONB DEFAULT '{}',
    special_requirements JSONB DEFAULT '[]',
    historical_records_reviewed BOOLEAN DEFAULT true,
    discrepancy_notes TEXT,
    performed_by UUID NOT NULL REFERENCES users(id),
    verified_by UUID REFERENCES users(id),
    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    expiration_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_blood_type_patient ON blood_type_screens(patient_id);
CREATE INDEX idx_blood_type_abo_rh ON blood_type_screens(abo_type, rh_type);
CREATE INDEX idx_blood_type_antibody ON blood_type_screens(antibody_screen_result);
CREATE INDEX idx_blood_type_performed ON blood_type_screens(performed_at DESC);

-- Crossmatch Records - Blood compatibility testing
CREATE TABLE IF NOT EXISTS crossmatch_records (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    blood_type_screen_id VARCHAR(64) NOT NULL REFERENCES blood_type_screens(id),
    unit_number VARCHAR(64) NOT NULL,
    product_type VARCHAR(64) NOT NULL CHECK (product_type IN ('prbc', 'platelets', 'ffp', 'cryo', 'whole_blood', 'granulocytes')),
    product_abo VARCHAR(8) NOT NULL,
    product_rh VARCHAR(16) NOT NULL,
    donation_date DATE,
    expiration_date DATE NOT NULL,
    crossmatch_type VARCHAR(32) NOT NULL CHECK (crossmatch_type IN ('immediate_spin', 'full', 'electronic', 'emergency')),
    result VARCHAR(16) NOT NULL CHECK (result IN ('compatible', 'incompatible', 'pending')),
    incompatibility_details TEXT,
    special_processing JSONB DEFAULT '[]',
    irradiated BOOLEAN DEFAULT false,
    leukoreduced BOOLEAN DEFAULT false,
    washed BOOLEAN DEFAULT false,
    volume_reduced BOOLEAN DEFAULT false,
    reserved_until TIMESTAMPTZ,
    issued_at TIMESTAMPTZ,
    issued_to UUID REFERENCES users(id),
    returned_at TIMESTAMPTZ,
    return_reason VARCHAR(128),
    performed_by UUID NOT NULL REFERENCES users(id),
    verified_by UUID REFERENCES users(id),
    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crossmatch_patient ON crossmatch_records(patient_id);
CREATE INDEX idx_crossmatch_unit ON crossmatch_records(unit_number);
CREATE INDEX idx_crossmatch_result ON crossmatch_records(result);
CREATE INDEX idx_crossmatch_product ON crossmatch_records(product_type);
CREATE INDEX idx_crossmatch_reserved ON crossmatch_records(reserved_until);

-- Transfusion Records - Blood product administration
CREATE TABLE IF NOT EXISTS transfusion_records (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    crossmatch_id VARCHAR(64) NOT NULL REFERENCES crossmatch_records(id),
    unit_number VARCHAR(64) NOT NULL,
    product_type VARCHAR(64) NOT NULL,
    volume_ml INTEGER NOT NULL,
    ordering_provider_id UUID NOT NULL REFERENCES users(id),
    indication TEXT NOT NULL,
    pre_transfusion_vitals JSONB NOT NULL DEFAULT '{}',
    pre_transfusion_labs JSONB DEFAULT '{}',
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    flow_rate_ml_hr INTEGER,
    administering_nurse_id UUID NOT NULL REFERENCES users(id),
    verifying_nurse_id UUID NOT NULL REFERENCES users(id),
    bedside_verification_time TIMESTAMPTZ NOT NULL,
    patient_identification_method VARCHAR(64) NOT NULL,
    vitals_15_min JSONB DEFAULT '{}',
    vitals_1_hr JSONB DEFAULT '{}',
    vitals_post JSONB DEFAULT '{}',
    reaction_occurred BOOLEAN NOT NULL DEFAULT false,
    reaction_type VARCHAR(64),
    reaction_severity VARCHAR(32) CHECK (reaction_severity IN ('mild', 'moderate', 'severe', 'life_threatening')),
    reaction_symptoms JSONB DEFAULT '[]',
    reaction_time TIMESTAMPTZ,
    reaction_interventions JSONB DEFAULT '[]',
    transfusion_completed BOOLEAN NOT NULL DEFAULT true,
    volume_transfused_ml INTEGER,
    reason_not_completed TEXT,
    post_transfusion_labs JSONB DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transfusion_patient ON transfusion_records(patient_id);
CREATE INDEX idx_transfusion_crossmatch ON transfusion_records(crossmatch_id);
CREATE INDEX idx_transfusion_unit ON transfusion_records(unit_number);
CREATE INDEX idx_transfusion_reaction ON transfusion_records(reaction_occurred);
CREATE INDEX idx_transfusion_start ON transfusion_records(start_time DESC);

-- ============================================================================
-- SECTION 5: PHARMACY & MEDICATIONS (4 tables)
-- ============================================================================

-- E-Prescriptions - Electronic prescription records
CREATE TABLE IF NOT EXISTS e_prescriptions (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    prescriber_id UUID NOT NULL REFERENCES users(id),
    medication_name VARCHAR(256) NOT NULL,
    medication_code VARCHAR(32),
    ndc_code VARCHAR(32),
    rxnorm_code VARCHAR(32),
    strength VARCHAR(64),
    strength_unit VARCHAR(32),
    dosage_form VARCHAR(64) NOT NULL,
    route VARCHAR(64) NOT NULL,
    frequency VARCHAR(128) NOT NULL,
    duration_days INTEGER,
    quantity INTEGER NOT NULL,
    quantity_unit VARCHAR(32),
    refills_authorized INTEGER NOT NULL DEFAULT 0,
    refills_remaining INTEGER NOT NULL DEFAULT 0,
    daw_code VARCHAR(8) DEFAULT '0',
    sig TEXT NOT NULL,
    diagnosis_codes JSONB DEFAULT '[]',
    indication TEXT,
    is_controlled BOOLEAN NOT NULL DEFAULT false,
    schedule VARCHAR(8) CHECK (schedule IN ('II', 'III', 'IV', 'V')),
    prior_authorization_required BOOLEAN DEFAULT false,
    prior_authorization_number VARCHAR(64),
    pharmacy_id VARCHAR(64),
    pharmacy_name VARCHAR(256),
    pharmacy_npi VARCHAR(32),
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'filled', 'cancelled', 'expired', 'denied')),
    sent_at TIMESTAMPTZ,
    filled_at TIMESTAMPTZ,
    fill_number INTEGER DEFAULT 1,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_eprescription_patient ON e_prescriptions(patient_id);
CREATE INDEX idx_eprescription_prescriber ON e_prescriptions(prescriber_id);
CREATE INDEX idx_eprescription_medication ON e_prescriptions(medication_name);
CREATE INDEX idx_eprescription_status ON e_prescriptions(status);
CREATE INDEX idx_eprescription_controlled ON e_prescriptions(is_controlled);
CREATE INDEX idx_eprescription_created ON e_prescriptions(created_at DESC);

-- Drug Interactions - Drug-drug and drug-allergy interactions
CREATE TABLE IF NOT EXISTS drug_interactions (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    prescription_id VARCHAR(64) REFERENCES e_prescriptions(id),
    drug1_name VARCHAR(256) NOT NULL,
    drug1_code VARCHAR(32),
    drug2_name VARCHAR(256),
    drug2_code VARCHAR(32),
    interaction_type VARCHAR(32) NOT NULL CHECK (interaction_type IN ('drug_drug', 'drug_allergy', 'drug_food', 'drug_disease', 'duplicate_therapy')),
    severity VARCHAR(32) NOT NULL CHECK (severity IN ('minor', 'moderate', 'major', 'contraindicated')),
    clinical_significance TEXT NOT NULL,
    mechanism TEXT,
    management TEXT,
    documentation_level VARCHAR(32) CHECK (documentation_level IN ('established', 'probable', 'suspected', 'possible', 'unlikely')),
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged BOOLEAN NOT NULL DEFAULT false,
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    override_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_drug_interaction_patient ON drug_interactions(patient_id);
CREATE INDEX idx_drug_interaction_prescription ON drug_interactions(prescription_id);
CREATE INDEX idx_drug_interaction_severity ON drug_interactions(severity);
CREATE INDEX idx_drug_interaction_type ON drug_interactions(interaction_type);
CREATE INDEX idx_drug_interaction_acknowledged ON drug_interactions(acknowledged);

-- Medication Reminders - Patient medication reminder schedules
CREATE TABLE IF NOT EXISTS medication_reminders (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    prescription_id VARCHAR(64) REFERENCES e_prescriptions(id),
    medication_name VARCHAR(256) NOT NULL,
    dosage VARCHAR(64),
    scheduled_time TIME NOT NULL,
    days_of_week JSONB NOT NULL DEFAULT '["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]',
    reminder_type VARCHAR(32) NOT NULL DEFAULT 'push' CHECK (reminder_type IN ('push', 'sms', 'email', 'all')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    snooze_minutes INTEGER DEFAULT 10,
    max_snoozes INTEGER DEFAULT 3,
    escalation_contact VARCHAR(128),
    start_date DATE NOT NULL,
    end_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reminder_patient ON medication_reminders(patient_id);
CREATE INDEX idx_reminder_prescription ON medication_reminders(prescription_id);
CREATE INDEX idx_reminder_active ON medication_reminders(is_active);
CREATE INDEX idx_reminder_time ON medication_reminders(scheduled_time);

-- Adherence Logs - Medication adherence tracking
CREATE TABLE IF NOT EXISTS adherence_logs (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    reminder_id VARCHAR(64) REFERENCES medication_reminders(id),
    prescription_id VARCHAR(64) REFERENCES e_prescriptions(id),
    medication_name VARCHAR(256) NOT NULL,
    scheduled_time TIMESTAMPTZ NOT NULL,
    action_taken VARCHAR(32) NOT NULL CHECK (action_taken IN ('taken', 'skipped', 'delayed', 'missed', 'early')),
    actual_time TIMESTAMPTZ,
    reported_by VARCHAR(32) DEFAULT 'patient' CHECK (reported_by IN ('patient', 'caregiver', 'system', 'provider')),
    skip_reason VARCHAR(128),
    side_effects_reported JSONB DEFAULT '[]',
    notes TEXT,
    device_id VARCHAR(64),
    location JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_adherence_patient ON adherence_logs(patient_id);
CREATE INDEX idx_adherence_reminder ON adherence_logs(reminder_id);
CREATE INDEX idx_adherence_prescription ON adherence_logs(prescription_id);
CREATE INDEX idx_adherence_action ON adherence_logs(action_taken);
CREATE INDEX idx_adherence_scheduled ON adherence_logs(scheduled_time DESC);
CREATE INDEX idx_adherence_patient_date ON adherence_logs(patient_id, scheduled_time);

-- ============================================================================
-- SECTION 6: TRIGGERS FOR UPDATED_AT
-- ============================================================================

-- Function to update updated_at timestamp (if not exists from Phase 1/2)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Lab & Diagnostics triggers
CREATE TRIGGER update_lab_submissions_updated_at BEFORE UPDATE ON lab_submissions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_lab_panels_updated_at BEFORE UPDATE ON lab_panels FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_specimen_collections_updated_at BEFORE UPDATE ON specimen_collections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_lab_trends_updated_at BEFORE UPDATE ON lab_trends FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Surgical triggers
CREATE TRIGGER update_pre_op_assessments_updated_at BEFORE UPDATE ON pre_op_assessments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_operative_notes_updated_at BEFORE UPDATE ON operative_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_post_op_notes_updated_at BEFORE UPDATE ON post_op_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_anesthesia_records_updated_at BEFORE UPDATE ON anesthesia_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_intubation_records_updated_at BEFORE UPDATE ON intubation_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_laceration_repairs_updated_at BEFORE UPDATE ON laceration_repairs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_splint_cast_records_updated_at BEFORE UPDATE ON splint_cast_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Radiology triggers
CREATE TRIGGER update_radiology_orders_updated_at BEFORE UPDATE ON radiology_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_radiology_reports_updated_at BEFORE UPDATE ON radiology_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_pathology_reports_updated_at BEFORE UPDATE ON pathology_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Blood bank triggers
CREATE TRIGGER update_blood_type_screens_updated_at BEFORE UPDATE ON blood_type_screens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_crossmatch_records_updated_at BEFORE UPDATE ON crossmatch_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_transfusion_records_updated_at BEFORE UPDATE ON transfusion_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Pharmacy triggers
CREATE TRIGGER update_e_prescriptions_updated_at BEFORE UPDATE ON e_prescriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_medication_reminders_updated_at BEFORE UPDATE ON medication_reminders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- SECTION 7: CLINICAL VIEWS
-- ============================================================================

-- View: Pending Lab Orders Dashboard
CREATE OR REPLACE VIEW v_pending_labs AS
SELECT 
    ls.id,
    ls.patient_id,
    p.health_id,
    ls.priority,
    ls.status,
    ls.order_date,
    ls.expected_completion,
    u.name as ordering_provider,
    jsonb_array_length(ls.tests_ordered) as test_count,
    CASE 
        WHEN ls.priority = 'stat' THEN 1
        WHEN ls.priority = 'asap' THEN 2
        WHEN ls.priority = 'urgent' THEN 3
        ELSE 4
    END as priority_order
FROM lab_submissions ls
JOIN patients p ON ls.patient_id = p.id
JOIN users u ON ls.ordering_provider_id = u.id
WHERE ls.status IN ('pending', 'collected', 'in_progress')
ORDER BY priority_order, ls.order_date;

-- View: Critical Values Requiring Acknowledgment
CREATE OR REPLACE VIEW v_unacknowledged_critical_values AS
SELECT 
    cv.id,
    cv.patient_id,
    p.health_id,
    cv.test_name,
    cv.value,
    cv.unit,
    cv.severity,
    cv.created_at,
    EXTRACT(EPOCH FROM (NOW() - cv.created_at))/60 as minutes_since_detection
FROM critical_values cv
JOIN patients p ON cv.patient_id = p.id
WHERE cv.acknowledged_at IS NULL
ORDER BY 
    CASE cv.severity 
        WHEN 'panic' THEN 1 
        WHEN 'critical' THEN 2 
        ELSE 3 
    END,
    cv.created_at;

-- View: Active Surgical Schedule
CREATE OR REPLACE VIEW v_surgical_schedule AS
SELECT 
    po.id,
    po.patient_id,
    p.health_id,
    po.procedure_name,
    po.scheduled_date,
    s.name as surgeon_name,
    a.name as anesthesiologist_name,
    po.asa_classification,
    po.cleared_for_surgery,
    po.consent_signed
FROM pre_op_assessments po
JOIN patients p ON po.patient_id = p.id
JOIN users s ON po.surgeon_id = s.id
LEFT JOIN users a ON po.anesthesiologist_id = a.id
WHERE po.scheduled_date >= CURRENT_DATE
ORDER BY po.scheduled_date;

-- View: Pending Radiology Studies
CREATE OR REPLACE VIEW v_pending_radiology AS
SELECT 
    ro.id,
    ro.patient_id,
    p.health_id,
    ro.modality,
    ro.study_type,
    ro.body_part,
    ro.priority,
    ro.status,
    ro.scheduled_datetime,
    u.name as ordering_provider
FROM radiology_orders ro
JOIN patients p ON ro.patient_id = p.id
JOIN users u ON ro.ordering_provider_id = u.id
WHERE ro.status IN ('ordered', 'scheduled', 'in_progress')
ORDER BY 
    CASE ro.priority 
        WHEN 'stat' THEN 1 
        WHEN 'asap' THEN 2 
        WHEN 'urgent' THEN 3 
        ELSE 4 
    END,
    ro.scheduled_datetime NULLS LAST;

-- View: Blood Products Reserved/Available
CREATE OR REPLACE VIEW v_blood_products_status AS
SELECT 
    cr.product_type,
    cr.product_abo,
    cr.product_rh,
    COUNT(*) FILTER (WHERE cr.result = 'compatible' AND cr.issued_at IS NULL AND cr.returned_at IS NULL) as reserved_count,
    COUNT(*) FILTER (WHERE cr.issued_at IS NOT NULL AND cr.returned_at IS NULL) as issued_count,
    MIN(cr.expiration_date) as earliest_expiration
FROM crossmatch_records cr
WHERE cr.reserved_until > NOW() OR cr.issued_at IS NOT NULL
GROUP BY cr.product_type, cr.product_abo, cr.product_rh
ORDER BY cr.product_type, cr.product_abo, cr.product_rh;

-- View: Transfusion Reactions Summary
CREATE OR REPLACE VIEW v_transfusion_reactions AS
SELECT 
    tr.id,
    tr.patient_id,
    p.health_id,
    tr.product_type,
    tr.unit_number,
    tr.reaction_type,
    tr.reaction_severity,
    tr.reaction_time,
    tr.start_time,
    tr.reaction_symptoms,
    tr.reaction_interventions
FROM transfusion_records tr
JOIN patients p ON tr.patient_id = p.id
WHERE tr.reaction_occurred = true
ORDER BY tr.reaction_time DESC;

-- View: Controlled Substance Prescriptions
CREATE OR REPLACE VIEW v_controlled_substances AS
SELECT 
    ep.id,
    ep.patient_id,
    p.health_id,
    ep.medication_name,
    ep.schedule,
    ep.quantity,
    ep.refills_authorized,
    ep.refills_remaining,
    ep.prescriber_id,
    u.name as prescriber_name,
    ep.created_at,
    ep.status
FROM e_prescriptions ep
JOIN patients p ON ep.patient_id = p.id
JOIN users u ON ep.prescriber_id = u.id
WHERE ep.is_controlled = true
ORDER BY ep.created_at DESC;

-- View: Medication Adherence Summary by Patient
CREATE OR REPLACE VIEW v_medication_adherence_summary AS
SELECT 
    al.patient_id,
    p.health_id,
    al.medication_name,
    COUNT(*) as total_doses,
    COUNT(*) FILTER (WHERE al.action_taken = 'taken') as taken_count,
    COUNT(*) FILTER (WHERE al.action_taken = 'skipped') as skipped_count,
    COUNT(*) FILTER (WHERE al.action_taken = 'missed') as missed_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE al.action_taken = 'taken') / NULLIF(COUNT(*), 0), 1) as adherence_rate
FROM adherence_logs al
JOIN patients p ON al.patient_id = p.id
WHERE al.scheduled_time >= NOW() - INTERVAL '30 days'
GROUP BY al.patient_id, p.health_id, al.medication_name
ORDER BY adherence_rate NULLS LAST;

-- ============================================================================
-- SECTION 8: COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE lab_submissions IS 'Laboratory test orders with priority and status tracking';
COMMENT ON TABLE lab_panels IS 'Individual lab panel results with reference ranges and flags';
COMMENT ON TABLE lab_qc_records IS 'Quality control records for laboratory instruments';
COMMENT ON TABLE critical_values IS 'Critical/panic lab values requiring immediate notification';
COMMENT ON TABLE specimen_collections IS 'Physical specimen collection and chain of custody';
COMMENT ON TABLE specimen_rejections IS 'Rejected specimens with reasons and recollection status';
COMMENT ON TABLE lab_trends IS 'Historical trend data for patient lab values';

COMMENT ON TABLE pre_op_assessments IS 'Pre-operative evaluation and surgical clearance';
COMMENT ON TABLE operative_notes IS 'Surgical procedure documentation';
COMMENT ON TABLE post_op_notes IS 'Post-operative follow-up notes';
COMMENT ON TABLE anesthesia_records IS 'Anesthesia administration and monitoring records';
COMMENT ON TABLE intubation_records IS 'Airway management and intubation documentation';
COMMENT ON TABLE laceration_repairs IS 'Wound repair and closure documentation';
COMMENT ON TABLE splint_cast_records IS 'Orthopedic immobilization documentation';

COMMENT ON TABLE radiology_orders IS 'Imaging study orders with scheduling and status';
COMMENT ON TABLE radiology_reports IS 'Radiology interpretation reports';
COMMENT ON TABLE pathology_reports IS 'Pathology and cytology reports';

COMMENT ON TABLE blood_type_screens IS 'ABO/Rh typing and antibody screening';
COMMENT ON TABLE crossmatch_records IS 'Blood product compatibility testing';
COMMENT ON TABLE transfusion_records IS 'Blood product administration with reaction monitoring';

COMMENT ON TABLE e_prescriptions IS 'Electronic prescriptions with pharmacy routing';
COMMENT ON TABLE drug_interactions IS 'Drug-drug and drug-allergy interaction alerts';
COMMENT ON TABLE medication_reminders IS 'Patient medication reminder schedules';
COMMENT ON TABLE adherence_logs IS 'Medication adherence tracking records';
