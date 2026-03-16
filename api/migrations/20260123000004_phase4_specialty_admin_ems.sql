-- ============================================================================
-- MediChain Phase 4-6: Specialty Assessments, Administrative, EMS Tables
-- Created: January 23, 2026
-- 
-- This migration creates 15 tables:
-- Phase 4 - Specialty Assessments: burn_assessments, psychiatric_assessments,
--           toxicology_assessments, pediatric_assessments, obstetric_emergencies
-- Phase 5 - Administrative: appointments, physician_orders, discharge_summaries,
--           discharge_instructions, ama_discharges, shift_handoffs, incident_reports
-- Phase 6 - EMS & External: ems_handoffs, mci_records, chain_of_custody
-- ============================================================================

-- ============================================================================
-- PHASE 4: SPECIALTY ASSESSMENTS
-- ============================================================================

-- Burn Assessments
CREATE TABLE IF NOT EXISTS burn_assessments (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    assessed_by UUID NOT NULL REFERENCES users(id),
    assessment_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    mechanism_of_injury TEXT NOT NULL,
    burn_agent VARCHAR(128),
    time_of_injury TIMESTAMPTZ,
    tbsa_percentage DECIMAL(5,2) NOT NULL,
    burn_depth JSONB NOT NULL DEFAULT '[]',
    affected_areas JSONB NOT NULL DEFAULT '[]',
    inhalation_injury BOOLEAN NOT NULL DEFAULT FALSE,
    inhalation_symptoms TEXT,
    airway_status VARCHAR(64),
    circumferential_burns BOOLEAN NOT NULL DEFAULT FALSE,
    circumferential_locations JSONB DEFAULT '[]',
    escharotomy_needed BOOLEAN NOT NULL DEFAULT FALSE,
    escharotomy_performed BOOLEAN NOT NULL DEFAULT FALSE,
    fluid_resuscitation_started BOOLEAN NOT NULL DEFAULT FALSE,
    parkland_formula_volume INTEGER,
    urine_output_goal INTEGER,
    pain_score INTEGER CHECK (pain_score BETWEEN 0 AND 10),
    tetanus_status VARCHAR(32),
    transfer_to_burn_center BOOLEAN NOT NULL DEFAULT FALSE,
    burn_center_notified BOOLEAN NOT NULL DEFAULT FALSE,
    photos_taken BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_burn_assessments_patient ON burn_assessments(patient_id);
CREATE INDEX idx_burn_assessments_datetime ON burn_assessments(assessment_datetime DESC);
CREATE INDEX idx_burn_assessments_tbsa ON burn_assessments(tbsa_percentage);

-- Psychiatric Assessments
CREATE TABLE IF NOT EXISTS psychiatric_assessments (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    assessed_by UUID NOT NULL REFERENCES users(id),
    assessment_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    chief_complaint TEXT NOT NULL,
    presenting_symptoms JSONB NOT NULL DEFAULT '[]',
    psychiatric_history TEXT,
    previous_hospitalizations JSONB DEFAULT '[]',
    current_medications JSONB DEFAULT '[]',
    substance_use JSONB,
    suicidal_ideation BOOLEAN NOT NULL DEFAULT FALSE,
    suicidal_plan BOOLEAN NOT NULL DEFAULT FALSE,
    suicidal_intent BOOLEAN NOT NULL DEFAULT FALSE,
    suicidal_means_access BOOLEAN NOT NULL DEFAULT FALSE,
    homicidal_ideation BOOLEAN NOT NULL DEFAULT FALSE,
    homicidal_target VARCHAR(256),
    safety_plan TEXT,
    mental_status_exam JSONB NOT NULL,
    appearance VARCHAR(256),
    behavior VARCHAR(256),
    speech VARCHAR(256),
    mood VARCHAR(128),
    affect VARCHAR(128),
    thought_process VARCHAR(256),
    thought_content TEXT,
    perceptions TEXT,
    cognition VARCHAR(256),
    insight VARCHAR(128),
    judgment VARCHAR(128),
    risk_level VARCHAR(32) NOT NULL CHECK (risk_level IN ('low', 'moderate', 'high', 'imminent')),
    disposition VARCHAR(64),
    involuntary_hold BOOLEAN NOT NULL DEFAULT FALSE,
    hold_type VARCHAR(64),
    sitter_required BOOLEAN NOT NULL DEFAULT FALSE,
    one_to_one_observation BOOLEAN NOT NULL DEFAULT FALSE,
    psychiatry_consulted BOOLEAN NOT NULL DEFAULT FALSE,
    psychiatrist_id UUID REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_psych_assessments_patient ON psychiatric_assessments(patient_id);
CREATE INDEX idx_psych_assessments_risk ON psychiatric_assessments(risk_level);
CREATE INDEX idx_psych_assessments_suicidal ON psychiatric_assessments(suicidal_ideation) WHERE suicidal_ideation = TRUE;

-- Toxicology Assessments
CREATE TABLE IF NOT EXISTS toxicology_assessments (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    assessed_by UUID NOT NULL REFERENCES users(id),
    assessment_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    exposure_type VARCHAR(64) NOT NULL CHECK (exposure_type IN ('ingestion', 'inhalation', 'injection', 'dermal', 'ocular', 'unknown')),
    intentionality VARCHAR(32) NOT NULL CHECK (intentionality IN ('accidental', 'intentional', 'therapeutic_error', 'unknown')),
    substances JSONB NOT NULL DEFAULT '[]',
    time_of_exposure TIMESTAMPTZ,
    amount_if_known TEXT,
    route_of_exposure VARCHAR(64),
    symptoms JSONB NOT NULL DEFAULT '[]',
    vital_signs_on_arrival JSONB,
    mental_status VARCHAR(128),
    pupil_size VARCHAR(32),
    pupil_reactivity VARCHAR(32),
    skin_findings TEXT,
    toxidrome VARCHAR(64),
    decontamination_performed BOOLEAN NOT NULL DEFAULT FALSE,
    decontamination_type VARCHAR(128),
    antidote_given BOOLEAN NOT NULL DEFAULT FALSE,
    antidote_name VARCHAR(128),
    antidote_dose VARCHAR(64),
    activated_charcoal BOOLEAN NOT NULL DEFAULT FALSE,
    whole_bowel_irrigation BOOLEAN NOT NULL DEFAULT FALSE,
    enhanced_elimination BOOLEAN NOT NULL DEFAULT FALSE,
    elimination_method VARCHAR(128),
    poison_control_called BOOLEAN NOT NULL DEFAULT FALSE,
    poison_control_case_number VARCHAR(64),
    lab_results JSONB,
    drug_screen_results JSONB,
    serum_levels JSONB,
    disposition VARCHAR(64),
    icu_admission BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tox_assessments_patient ON toxicology_assessments(patient_id);
CREATE INDEX idx_tox_assessments_exposure ON toxicology_assessments(exposure_type);
CREATE INDEX idx_tox_assessments_intentional ON toxicology_assessments(intentionality);

-- Pediatric Assessments
CREATE TABLE IF NOT EXISTS pediatric_assessments (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    assessed_by UUID NOT NULL REFERENCES users(id),
    assessment_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    age_months INTEGER NOT NULL,
    weight_kg DECIMAL(5,2),
    weight_estimated BOOLEAN NOT NULL DEFAULT FALSE,
    length_cm DECIMAL(5,1),
    head_circumference_cm DECIMAL(4,1),
    broselow_color VARCHAR(32),
    chief_complaint TEXT NOT NULL,
    history_source VARCHAR(64),
    immunizations_up_to_date BOOLEAN,
    last_immunization_date DATE,
    developmental_milestones JSONB,
    developmental_concerns TEXT,
    birth_history JSONB,
    feeding_pattern VARCHAR(128),
    last_feed_time TIMESTAMPTZ,
    wet_diapers_24hr INTEGER,
    activity_level VARCHAR(64),
    pediatric_triangle JSONB,
    appearance_score VARCHAR(32),
    work_of_breathing VARCHAR(32),
    circulation_to_skin VARCHAR(32),
    pain_scale_type VARCHAR(32),
    pain_score INTEGER,
    fontanelle_status VARCHAR(32),
    capillary_refill_seconds DECIMAL(3,1),
    skin_turgor VARCHAR(32),
    mucous_membranes VARCHAR(32),
    parent_guardian_present BOOLEAN NOT NULL DEFAULT TRUE,
    parent_guardian_name VARCHAR(128),
    parent_guardian_relationship VARCHAR(64),
    child_protective_concerns BOOLEAN NOT NULL DEFAULT FALSE,
    cps_notified BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_peds_assessments_patient ON pediatric_assessments(patient_id);
CREATE INDEX idx_peds_assessments_age ON pediatric_assessments(age_months);
CREATE INDEX idx_peds_assessments_cps ON pediatric_assessments(child_protective_concerns) WHERE child_protective_concerns = TRUE;

-- Obstetric Emergencies
CREATE TABLE IF NOT EXISTS obstetric_emergencies (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    assessed_by UUID NOT NULL REFERENCES users(id),
    assessment_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    gestational_age_weeks INTEGER NOT NULL,
    gestational_age_days INTEGER DEFAULT 0,
    gravida INTEGER NOT NULL,
    para INTEGER NOT NULL,
    abortions INTEGER DEFAULT 0,
    living_children INTEGER DEFAULT 0,
    lmp_date DATE,
    edd_date DATE,
    prenatal_care BOOLEAN NOT NULL DEFAULT TRUE,
    prenatal_care_provider VARCHAR(128),
    pregnancy_complications JSONB DEFAULT '[]',
    chief_complaint TEXT NOT NULL,
    contractions BOOLEAN NOT NULL DEFAULT FALSE,
    contraction_frequency_min INTEGER,
    contraction_duration_sec INTEGER,
    rupture_of_membranes BOOLEAN NOT NULL DEFAULT FALSE,
    rom_time TIMESTAMPTZ,
    fluid_color VARCHAR(64),
    vaginal_bleeding BOOLEAN NOT NULL DEFAULT FALSE,
    bleeding_amount VARCHAR(32),
    cervical_exam_performed BOOLEAN NOT NULL DEFAULT FALSE,
    dilation_cm INTEGER,
    effacement_percent INTEGER,
    station INTEGER,
    presentation VARCHAR(64),
    fetal_heart_rate INTEGER,
    fetal_heart_variability VARCHAR(32),
    fetal_decelerations VARCHAR(64),
    uterine_tenderness BOOLEAN NOT NULL DEFAULT FALSE,
    fundal_height_cm INTEGER,
    fetal_movement VARCHAR(32),
    emergency_type VARCHAR(64),
    placenta_previa BOOLEAN NOT NULL DEFAULT FALSE,
    placental_abruption BOOLEAN NOT NULL DEFAULT FALSE,
    cord_prolapse BOOLEAN NOT NULL DEFAULT FALSE,
    eclampsia BOOLEAN NOT NULL DEFAULT FALSE,
    preeclampsia_severe BOOLEAN NOT NULL DEFAULT FALSE,
    blood_pressure_systolic INTEGER,
    blood_pressure_diastolic INTEGER,
    proteinuria VARCHAR(32),
    magnesium_sulfate_given BOOLEAN NOT NULL DEFAULT FALSE,
    delivery_imminent BOOLEAN NOT NULL DEFAULT FALSE,
    ob_notified BOOLEAN NOT NULL DEFAULT FALSE,
    ob_physician_id UUID REFERENCES users(id),
    nicu_notified BOOLEAN NOT NULL DEFAULT FALSE,
    or_notified BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ob_emergencies_patient ON obstetric_emergencies(patient_id);
CREATE INDEX idx_ob_emergencies_gestational ON obstetric_emergencies(gestational_age_weeks);
CREATE INDEX idx_ob_emergencies_type ON obstetric_emergencies(emergency_type);

-- ============================================================================
-- PHASE 5: ADMINISTRATIVE & SCHEDULING
-- ============================================================================

-- Appointments
CREATE TABLE IF NOT EXISTS appointments (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    provider_id UUID NOT NULL REFERENCES users(id),
    appointment_type VARCHAR(64) NOT NULL,
    scheduled_datetime TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    status VARCHAR(32) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show')),
    location VARCHAR(128),
    room VARCHAR(32),
    reason_for_visit TEXT,
    visit_type VARCHAR(32) CHECK (visit_type IN ('in_person', 'telehealth', 'phone')),
    priority VARCHAR(16) DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent', 'follow_up')),
    recurring BOOLEAN NOT NULL DEFAULT FALSE,
    recurrence_pattern VARCHAR(64),
    parent_appointment_id VARCHAR(64) REFERENCES appointments(id),
    insurance_verified BOOLEAN NOT NULL DEFAULT FALSE,
    copay_amount DECIMAL(10,2),
    copay_collected BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_sent BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_sent_at TIMESTAMPTZ,
    check_in_time TIMESTAMPTZ,
    check_out_time TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    cancelled_by UUID REFERENCES users(id),
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_appointments_patient ON appointments(patient_id);
CREATE INDEX idx_appointments_provider ON appointments(provider_id);
CREATE INDEX idx_appointments_datetime ON appointments(scheduled_datetime);
CREATE INDEX idx_appointments_status ON appointments(status);
CREATE INDEX idx_appointments_provider_date ON appointments(provider_id, scheduled_datetime);

-- Physician Orders
CREATE TABLE IF NOT EXISTS physician_orders (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    ordering_provider_id UUID NOT NULL REFERENCES users(id),
    order_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    order_type VARCHAR(64) NOT NULL CHECK (order_type IN ('medication', 'lab', 'imaging', 'procedure', 'consult', 'nursing', 'diet', 'activity', 'other')),
    priority VARCHAR(16) NOT NULL DEFAULT 'routine' CHECK (priority IN ('stat', 'asap', 'urgent', 'routine', 'prn')),
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'discontinued', 'cancelled', 'on_hold')),
    order_details JSONB NOT NULL,
    indication TEXT,
    diagnosis_codes JSONB DEFAULT '[]',
    start_datetime TIMESTAMPTZ,
    end_datetime TIMESTAMPTZ,
    frequency VARCHAR(64),
    duration TEXT,
    special_instructions TEXT,
    requires_cosign BOOLEAN NOT NULL DEFAULT FALSE,
    cosigned_by UUID REFERENCES users(id),
    cosigned_at TIMESTAMPTZ,
    verified_by UUID REFERENCES users(id),
    verified_at TIMESTAMPTZ,
    executed_by UUID REFERENCES users(id),
    executed_at TIMESTAMPTZ,
    discontinued_by UUID REFERENCES users(id),
    discontinued_at TIMESTAMPTZ,
    discontinue_reason TEXT,
    linked_order_id VARCHAR(64) REFERENCES physician_orders(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_physician_orders_patient ON physician_orders(patient_id);
CREATE INDEX idx_physician_orders_provider ON physician_orders(ordering_provider_id);
CREATE INDEX idx_physician_orders_type ON physician_orders(order_type);
CREATE INDEX idx_physician_orders_status ON physician_orders(status);
CREATE INDEX idx_physician_orders_priority ON physician_orders(priority) WHERE priority IN ('stat', 'asap');

-- Discharge Summaries
CREATE TABLE IF NOT EXISTS discharge_summaries (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    encounter_id VARCHAR(64) NOT NULL,
    attending_physician_id UUID NOT NULL REFERENCES users(id),
    admission_datetime TIMESTAMPTZ NOT NULL,
    discharge_datetime TIMESTAMPTZ NOT NULL,
    admission_diagnosis JSONB NOT NULL DEFAULT '[]',
    discharge_diagnosis JSONB NOT NULL DEFAULT '[]',
    principal_diagnosis VARCHAR(256),
    secondary_diagnoses JSONB DEFAULT '[]',
    procedures_performed JSONB DEFAULT '[]',
    hospital_course TEXT NOT NULL,
    condition_at_discharge VARCHAR(64) NOT NULL CHECK (condition_at_discharge IN ('stable', 'improved', 'unchanged', 'deteriorated', 'deceased')),
    discharge_disposition VARCHAR(64) NOT NULL CHECK (discharge_disposition IN ('home', 'home_health', 'snf', 'rehab', 'ltac', 'hospice', 'ama', 'transfer', 'expired')),
    discharge_destination VARCHAR(256),
    discharge_medications JSONB NOT NULL DEFAULT '[]',
    medication_changes TEXT,
    follow_up_appointments JSONB DEFAULT '[]',
    follow_up_instructions TEXT,
    diet_instructions TEXT,
    activity_restrictions TEXT,
    wound_care_instructions TEXT,
    warning_signs TEXT,
    pending_results JSONB DEFAULT '[]',
    pending_studies JSONB DEFAULT '[]',
    primary_care_notified BOOLEAN NOT NULL DEFAULT FALSE,
    specialist_follow_up JSONB DEFAULT '[]',
    durable_medical_equipment JSONB DEFAULT '[]',
    home_health_orders JSONB,
    physical_therapy_orders JSONB,
    dictated_by UUID REFERENCES users(id),
    dictated_at TIMESTAMPTZ,
    transcribed_by VARCHAR(64),
    signed_by UUID REFERENCES users(id),
    signed_at TIMESTAMPTZ,
    addendum TEXT,
    addendum_by UUID REFERENCES users(id),
    addendum_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_discharge_summaries_patient ON discharge_summaries(patient_id);
CREATE INDEX idx_discharge_summaries_encounter ON discharge_summaries(encounter_id);
CREATE INDEX idx_discharge_summaries_attending ON discharge_summaries(attending_physician_id);
CREATE INDEX idx_discharge_summaries_date ON discharge_summaries(discharge_datetime DESC);

-- Discharge Instructions
CREATE TABLE IF NOT EXISTS discharge_instructions (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    discharge_summary_id VARCHAR(64) REFERENCES discharge_summaries(id),
    visit_date DATE NOT NULL,
    diagnosis_summary TEXT NOT NULL,
    medications_list JSONB NOT NULL DEFAULT '[]',
    new_medications JSONB DEFAULT '[]',
    stopped_medications JSONB DEFAULT '[]',
    changed_medications JSONB DEFAULT '[]',
    diet_instructions TEXT,
    activity_level VARCHAR(64),
    activity_restrictions JSONB DEFAULT '[]',
    wound_care TEXT,
    follow_up_appointments JSONB NOT NULL DEFAULT '[]',
    return_precautions TEXT NOT NULL,
    emergency_instructions TEXT NOT NULL,
    contact_numbers JSONB NOT NULL,
    patient_education_materials JSONB DEFAULT '[]',
    language VARCHAR(32) NOT NULL DEFAULT 'en',
    reading_level VARCHAR(32),
    special_instructions TEXT,
    equipment_needed JSONB DEFAULT '[]',
    home_health_arranged BOOLEAN NOT NULL DEFAULT FALSE,
    transportation_arranged BOOLEAN NOT NULL DEFAULT FALSE,
    pharmacy_notified BOOLEAN NOT NULL DEFAULT FALSE,
    printed_at TIMESTAMPTZ,
    emailed_at TIMESTAMPTZ,
    patient_portal_posted BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_by_patient BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,
    witness_signature VARCHAR(128),
    provided_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_discharge_instructions_patient ON discharge_instructions(patient_id);
CREATE INDEX idx_discharge_instructions_summary ON discharge_instructions(discharge_summary_id);
CREATE INDEX idx_discharge_instructions_date ON discharge_instructions(visit_date DESC);

-- AMA (Against Medical Advice) Discharges
CREATE TABLE IF NOT EXISTS ama_discharges (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    encounter_id VARCHAR(64) NOT NULL,
    discharge_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attending_physician_id UUID NOT NULL REFERENCES users(id),
    reason_for_leaving TEXT NOT NULL,
    risks_explained JSONB NOT NULL DEFAULT '[]',
    specific_risks_discussed TEXT NOT NULL,
    patient_verbalized_understanding BOOLEAN NOT NULL DEFAULT FALSE,
    decision_making_capacity BOOLEAN NOT NULL DEFAULT TRUE,
    capacity_assessment TEXT,
    alternatives_offered JSONB DEFAULT '[]',
    patient_refused_alternatives BOOLEAN NOT NULL DEFAULT TRUE,
    ama_form_signed BOOLEAN NOT NULL DEFAULT FALSE,
    ama_form_refused_reason TEXT,
    witness_present BOOLEAN NOT NULL DEFAULT FALSE,
    witness_name VARCHAR(128),
    witness_signature VARCHAR(256),
    patient_given_prescriptions BOOLEAN NOT NULL DEFAULT FALSE,
    prescriptions_given JSONB DEFAULT '[]',
    follow_up_offered BOOLEAN NOT NULL DEFAULT TRUE,
    follow_up_instructions TEXT,
    patient_contact_info_verified BOOLEAN NOT NULL DEFAULT FALSE,
    emergency_contact_notified BOOLEAN NOT NULL DEFAULT FALSE,
    belongings_returned BOOLEAN NOT NULL DEFAULT TRUE,
    security_escort BOOLEAN NOT NULL DEFAULT FALSE,
    police_notified BOOLEAN NOT NULL DEFAULT FALSE,
    social_work_notified BOOLEAN NOT NULL DEFAULT FALSE,
    documentation_complete BOOLEAN NOT NULL DEFAULT FALSE,
    physician_narrative TEXT NOT NULL,
    nurse_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ama_discharges_patient ON ama_discharges(patient_id);
CREATE INDEX idx_ama_discharges_encounter ON ama_discharges(encounter_id);
CREATE INDEX idx_ama_discharges_date ON ama_discharges(discharge_datetime DESC);

-- Shift Handoffs
CREATE TABLE IF NOT EXISTS shift_handoffs (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    outgoing_provider_id UUID NOT NULL REFERENCES users(id),
    incoming_provider_id UUID NOT NULL REFERENCES users(id),
    handoff_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    handoff_type VARCHAR(32) NOT NULL CHECK (handoff_type IN ('shift_change', 'transfer', 'procedure', 'break_coverage', 'escalation')),
    location_from VARCHAR(128),
    location_to VARCHAR(128),
    situation TEXT NOT NULL,
    background TEXT NOT NULL,
    assessment TEXT NOT NULL,
    recommendation TEXT NOT NULL,
    pending_tasks JSONB NOT NULL DEFAULT '[]',
    pending_results JSONB DEFAULT '[]',
    pending_consults JSONB DEFAULT '[]',
    critical_values JSONB DEFAULT '[]',
    code_status VARCHAR(32),
    isolation_precautions JSONB DEFAULT '[]',
    fall_risk_level VARCHAR(16),
    skin_integrity_issues JSONB DEFAULT '[]',
    iv_access JSONB DEFAULT '[]',
    drains_tubes JSONB DEFAULT '[]',
    family_concerns TEXT,
    anticipated_disposition VARCHAR(64),
    contingency_plans TEXT,
    questions_asked JSONB DEFAULT '[]',
    read_back_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_by_incoming BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,
    handoff_tool_used VARCHAR(32) DEFAULT 'sbar',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shift_handoffs_patient ON shift_handoffs(patient_id);
CREATE INDEX idx_shift_handoffs_outgoing ON shift_handoffs(outgoing_provider_id);
CREATE INDEX idx_shift_handoffs_incoming ON shift_handoffs(incoming_provider_id);
CREATE INDEX idx_shift_handoffs_datetime ON shift_handoffs(handoff_datetime DESC);

-- Incident Reports
CREATE TABLE IF NOT EXISTS incident_reports (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) REFERENCES patients(id),
    reporter_id UUID NOT NULL REFERENCES users(id),
    incident_datetime TIMESTAMPTZ NOT NULL,
    discovery_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    incident_type VARCHAR(64) NOT NULL CHECK (incident_type IN ('fall', 'medication_error', 'adverse_drug_reaction', 'equipment_failure', 'security', 'violence', 'elopement', 'other')),
    severity VARCHAR(16) NOT NULL CHECK (severity IN ('near_miss', 'no_harm', 'minor', 'moderate', 'major', 'sentinel')),
    location VARCHAR(128) NOT NULL,
    department VARCHAR(64),
    description TEXT NOT NULL,
    immediate_actions_taken TEXT,
    patient_outcome TEXT,
    patient_notified BOOLEAN NOT NULL DEFAULT FALSE,
    patient_notified_by UUID REFERENCES users(id),
    family_notified BOOLEAN NOT NULL DEFAULT FALSE,
    attending_notified BOOLEAN NOT NULL DEFAULT FALSE,
    supervisor_notified BOOLEAN NOT NULL DEFAULT FALSE,
    risk_management_notified BOOLEAN NOT NULL DEFAULT FALSE,
    witnesses JSONB DEFAULT '[]',
    contributing_factors JSONB DEFAULT '[]',
    root_cause TEXT,
    preventable BOOLEAN,
    similar_incidents_prior BOOLEAN NOT NULL DEFAULT FALSE,
    corrective_actions JSONB DEFAULT '[]',
    follow_up_required BOOLEAN NOT NULL DEFAULT FALSE,
    follow_up_assigned_to UUID REFERENCES users(id),
    follow_up_due_date DATE,
    follow_up_completed BOOLEAN NOT NULL DEFAULT FALSE,
    follow_up_completed_at TIMESTAMPTZ,
    investigation_status VARCHAR(32) DEFAULT 'open' CHECK (investigation_status IN ('open', 'investigating', 'pending_review', 'closed')),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    review_comments TEXT,
    regulatory_reportable BOOLEAN NOT NULL DEFAULT FALSE,
    reported_to_agencies JSONB DEFAULT '[]',
    confidential BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_incident_reports_patient ON incident_reports(patient_id);
CREATE INDEX idx_incident_reports_reporter ON incident_reports(reporter_id);
CREATE INDEX idx_incident_reports_type ON incident_reports(incident_type);
CREATE INDEX idx_incident_reports_severity ON incident_reports(severity);
CREATE INDEX idx_incident_reports_datetime ON incident_reports(incident_datetime DESC);
CREATE INDEX idx_incident_reports_status ON incident_reports(investigation_status);

-- ============================================================================
-- PHASE 6: EMS & EXTERNAL
-- ============================================================================

-- EMS Handoffs
CREATE TABLE IF NOT EXISTS ems_handoffs (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) REFERENCES patients(id),
    receiving_provider_id UUID NOT NULL REFERENCES users(id),
    handoff_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ems_agency VARCHAR(128) NOT NULL,
    ems_unit_number VARCHAR(32),
    crew_members JSONB NOT NULL DEFAULT '[]',
    run_number VARCHAR(64),
    dispatch_time TIMESTAMPTZ,
    on_scene_time TIMESTAMPTZ,
    transport_start_time TIMESTAMPTZ,
    arrival_time TIMESTAMPTZ NOT NULL,
    scene_address TEXT,
    incident_type VARCHAR(64),
    chief_complaint TEXT NOT NULL,
    mechanism_of_injury TEXT,
    patient_found VARCHAR(256),
    mental_status_on_scene VARCHAR(128),
    gcs_on_scene INTEGER,
    vital_signs_on_scene JSONB,
    vital_signs_transport JSONB,
    vital_signs_arrival JSONB,
    interventions_performed JSONB DEFAULT '[]',
    medications_given JSONB DEFAULT '[]',
    iv_access_obtained BOOLEAN NOT NULL DEFAULT FALSE,
    iv_details JSONB,
    airway_management VARCHAR(128),
    cpr_performed BOOLEAN NOT NULL DEFAULT FALSE,
    aed_used BOOLEAN NOT NULL DEFAULT FALSE,
    shocks_delivered INTEGER,
    spinal_immobilization BOOLEAN NOT NULL DEFAULT FALSE,
    splinting_performed BOOLEAN NOT NULL DEFAULT FALSE,
    tourniquet_applied BOOLEAN NOT NULL DEFAULT FALSE,
    bleeding_controlled BOOLEAN,
    patient_belongings JSONB DEFAULT '[]',
    family_at_scene BOOLEAN NOT NULL DEFAULT FALSE,
    family_contact_info TEXT,
    police_at_scene BOOLEAN NOT NULL DEFAULT FALSE,
    police_report_number VARCHAR(64),
    trauma_alert BOOLEAN NOT NULL DEFAULT FALSE,
    stroke_alert BOOLEAN NOT NULL DEFAULT FALSE,
    stemi_alert BOOLEAN NOT NULL DEFAULT FALSE,
    sepsis_alert BOOLEAN NOT NULL DEFAULT FALSE,
    report_received_by UUID REFERENCES users(id),
    report_received_time TIMESTAMPTZ,
    verbal_report_complete BOOLEAN NOT NULL DEFAULT FALSE,
    ems_documentation_received BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ems_handoffs_patient ON ems_handoffs(patient_id);
CREATE INDEX idx_ems_handoffs_receiving ON ems_handoffs(receiving_provider_id);
CREATE INDEX idx_ems_handoffs_datetime ON ems_handoffs(handoff_datetime DESC);
CREATE INDEX idx_ems_handoffs_agency ON ems_handoffs(ems_agency);
CREATE INDEX idx_ems_handoffs_alerts ON ems_handoffs(trauma_alert, stroke_alert, stemi_alert, sepsis_alert);

-- MCI (Mass Casualty Incident) Records
CREATE TABLE IF NOT EXISTS mci_records (
    id VARCHAR(64) PRIMARY KEY,
    incident_id VARCHAR(64) NOT NULL,
    incident_name VARCHAR(256) NOT NULL,
    incident_datetime TIMESTAMPTZ NOT NULL,
    incident_location TEXT NOT NULL,
    incident_type VARCHAR(64) NOT NULL CHECK (incident_type IN ('natural_disaster', 'transportation', 'industrial', 'terrorism', 'active_shooter', 'hazmat', 'pandemic', 'other')),
    activation_level VARCHAR(32) NOT NULL CHECK (activation_level IN ('level_1', 'level_2', 'level_3', 'standby', 'deactivated')),
    incident_commander VARCHAR(128),
    medical_branch_director VARCHAR(128),
    hospital_incident_command_activated BOOLEAN NOT NULL DEFAULT TRUE,
    patient_id VARCHAR(64) REFERENCES patients(id),
    triage_tag_number VARCHAR(32),
    triage_category VARCHAR(16) NOT NULL CHECK (triage_category IN ('red', 'yellow', 'green', 'black', 'white')),
    start_triage_category VARCHAR(16),
    arrival_datetime TIMESTAMPTZ,
    arrival_mode VARCHAR(32),
    ems_agency VARCHAR(128),
    treatment_area VARCHAR(64),
    injuries JSONB DEFAULT '[]',
    mechanism_of_injury TEXT,
    decontamination_required BOOLEAN NOT NULL DEFAULT FALSE,
    decontamination_completed BOOLEAN NOT NULL DEFAULT FALSE,
    treatments_provided JSONB DEFAULT '[]',
    disposition VARCHAR(64),
    disposition_datetime TIMESTAMPTZ,
    destination VARCHAR(256),
    family_notified BOOLEAN NOT NULL DEFAULT FALSE,
    family_reunification_completed BOOLEAN NOT NULL DEFAULT FALSE,
    patient_tracking_updated BOOLEAN NOT NULL DEFAULT TRUE,
    media_release_authorized BOOLEAN NOT NULL DEFAULT FALSE,
    special_circumstances TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mci_records_incident ON mci_records(incident_id);
CREATE INDEX idx_mci_records_patient ON mci_records(patient_id);
CREATE INDEX idx_mci_records_triage ON mci_records(triage_category);
CREATE INDEX idx_mci_records_datetime ON mci_records(incident_datetime DESC);
CREATE INDEX idx_mci_records_tag ON mci_records(triage_tag_number);

-- Chain of Custody
CREATE TABLE IF NOT EXISTS chain_of_custody (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) REFERENCES patients(id),
    case_number VARCHAR(64),
    evidence_type VARCHAR(64) NOT NULL CHECK (evidence_type IN ('blood_sample', 'urine_sample', 'clothing', 'personal_effects', 'weapon', 'document', 'electronic_device', 'biological', 'other')),
    evidence_description TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_of_measure VARCHAR(32),
    collection_datetime TIMESTAMPTZ NOT NULL,
    collection_location VARCHAR(256),
    collected_by UUID NOT NULL REFERENCES users(id),
    collection_witnessed_by UUID REFERENCES users(id),
    collection_method TEXT,
    packaging_description TEXT,
    seal_number VARCHAR(64),
    storage_location VARCHAR(128),
    storage_requirements TEXT,
    current_custodian_id UUID NOT NULL REFERENCES users(id),
    transfers JSONB NOT NULL DEFAULT '[]',
    law_enforcement_agency VARCHAR(128),
    law_enforcement_officer VARCHAR(128),
    law_enforcement_badge VARCHAR(32),
    warrant_number VARCHAR(64),
    court_order_number VARCHAR(64),
    released_to VARCHAR(256),
    release_datetime TIMESTAMPTZ,
    release_authorized_by UUID REFERENCES users(id),
    release_documentation TEXT,
    destruction_authorized BOOLEAN NOT NULL DEFAULT FALSE,
    destruction_datetime TIMESTAMPTZ,
    destruction_method TEXT,
    destruction_witnessed_by UUID REFERENCES users(id),
    status VARCHAR(32) NOT NULL DEFAULT 'in_custody' CHECK (status IN ('in_custody', 'transferred', 'released', 'destroyed', 'lost')),
    photos_taken BOOLEAN NOT NULL DEFAULT FALSE,
    photo_references JSONB DEFAULT '[]',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chain_custody_patient ON chain_of_custody(patient_id);
CREATE INDEX idx_chain_custody_case ON chain_of_custody(case_number);
CREATE INDEX idx_chain_custody_type ON chain_of_custody(evidence_type);
CREATE INDEX idx_chain_custody_custodian ON chain_of_custody(current_custodian_id);
CREATE INDEX idx_chain_custody_status ON chain_of_custody(status);

-- ============================================================================
-- VIEWS FOR PHASE 4-6
-- ============================================================================

-- High-Risk Patients Dashboard
CREATE OR REPLACE VIEW v_high_risk_patients AS
SELECT 
    p.id AS patient_id,
    p.health_id,
    'psychiatric' AS risk_type,
    pa.risk_level,
    pa.assessment_datetime AS last_assessment,
    pa.assessed_by
FROM patients p
JOIN psychiatric_assessments pa ON p.id = pa.patient_id
WHERE pa.risk_level IN ('high', 'imminent')
AND pa.assessment_datetime = (
    SELECT MAX(assessment_datetime) 
    FROM psychiatric_assessments 
    WHERE patient_id = p.id
)
UNION ALL
SELECT 
    p.id AS patient_id,
    p.health_id,
    'burn' AS risk_type,
    CASE WHEN ba.tbsa_percentage >= 20 THEN 'high' ELSE 'moderate' END AS risk_level,
    ba.assessment_datetime AS last_assessment,
    ba.assessed_by
FROM patients p
JOIN burn_assessments ba ON p.id = ba.patient_id
WHERE ba.tbsa_percentage >= 10
AND ba.assessment_datetime = (
    SELECT MAX(assessment_datetime) 
    FROM burn_assessments 
    WHERE patient_id = p.id
);

-- Today's Appointments
CREATE OR REPLACE VIEW v_todays_appointments AS
SELECT 
    a.id,
    a.patient_id,
    p.health_id,
    a.provider_id,
    u.name AS provider_name,
    a.appointment_type,
    a.scheduled_datetime,
    a.duration_minutes,
    a.status,
    a.location,
    a.room,
    a.reason_for_visit,
    a.visit_type
FROM appointments a
JOIN patients p ON a.patient_id = p.id
JOIN users u ON a.provider_id = u.id
WHERE DATE(a.scheduled_datetime) = CURRENT_DATE
ORDER BY a.scheduled_datetime;

-- Pending Orders Summary
CREATE OR REPLACE VIEW v_pending_orders AS
SELECT 
    po.id,
    po.patient_id,
    p.health_id,
    po.ordering_provider_id,
    u.name AS ordering_provider,
    po.order_type,
    po.priority,
    po.order_datetime,
    po.order_details,
    EXTRACT(EPOCH FROM (NOW() - po.order_datetime))/3600 AS hours_pending
FROM physician_orders po
JOIN patients p ON po.patient_id = p.id
JOIN users u ON po.ordering_provider_id = u.id
WHERE po.status = 'pending'
ORDER BY 
    CASE po.priority 
        WHEN 'stat' THEN 1 
        WHEN 'asap' THEN 2 
        WHEN 'urgent' THEN 3 
        ELSE 4 
    END,
    po.order_datetime;

-- MCI Active Incidents
CREATE OR REPLACE VIEW v_mci_active AS
SELECT 
    incident_id,
    incident_name,
    incident_datetime,
    incident_type,
    activation_level,
    COUNT(DISTINCT patient_id) AS patient_count,
    SUM(CASE WHEN triage_category = 'red' THEN 1 ELSE 0 END) AS red_count,
    SUM(CASE WHEN triage_category = 'yellow' THEN 1 ELSE 0 END) AS yellow_count,
    SUM(CASE WHEN triage_category = 'green' THEN 1 ELSE 0 END) AS green_count,
    SUM(CASE WHEN triage_category = 'black' THEN 1 ELSE 0 END) AS black_count
FROM mci_records
WHERE activation_level != 'deactivated'
GROUP BY incident_id, incident_name, incident_datetime, incident_type, activation_level
ORDER BY incident_datetime DESC;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_phase4_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_burn_assessments_updated_at
    BEFORE UPDATE ON burn_assessments
    FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_psychiatric_assessments_updated_at
    BEFORE UPDATE ON psychiatric_assessments
    FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_toxicology_assessments_updated_at
    BEFORE UPDATE ON toxicology_assessments
    FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_pediatric_assessments_updated_at
    BEFORE UPDATE ON pediatric_assessments
    FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_obstetric_emergencies_updated_at
    BEFORE UPDATE ON obstetric_emergencies
    FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_appointments_updated_at
    BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_physician_orders_updated_at
    BEFORE UPDATE ON physician_orders
    FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_discharge_summaries_updated_at
    BEFORE UPDATE ON discharge_summaries
    FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_discharge_instructions_updated_at
    BEFORE UPDATE ON discharge_instructions
    FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_ama_discharges_updated_at
    BEFORE UPDATE ON ama_discharges
    FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_shift_handoffs_updated_at
    BEFORE UPDATE ON shift_handoffs
    FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_incident_reports_updated_at
    BEFORE UPDATE ON incident_reports
    FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_ems_handoffs_updated_at
    BEFORE UPDATE ON ems_handoffs
    FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_mci_records_updated_at
    BEFORE UPDATE ON mci_records
    FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_chain_custody_updated_at
    BEFORE UPDATE ON chain_of_custody
    FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();
