-- Phase 7-10: Wearables & IoT, Telehealth, Clinical Decision Support, Insurance
-- 
-- Tables created:
--   Phase 7 - Wearables & IoT (4 tables):
--     1. wearable_devices - Patient wearable device registrations
--     2. wearable_data - Continuous monitoring data from devices
--     3. wearable_alerts - Alerts generated from wearable data
--     4. wearable_integration_logs - Integration status and sync logs
--   
--   Phase 8 - Telehealth (4 tables):
--     5. telehealth_sessions - Video consultation sessions
--     6. telehealth_notes - Clinical notes from telehealth visits
--     7. remote_patient_monitoring - RPM program enrollments
--     8. rpm_readings - Individual RPM readings
--
--   Phase 9 - Clinical Decision Support (1 table):
--     9. cds_alerts - Clinical decision support alerts
--
--   Phase 10 - Insurance & Billing (2 tables):
--     10. insurance_records - Patient insurance information
--     11. billing_codes - Medical billing codes (ICD-10, CPT)
--
-- Views created:
--     1. v_active_wearables - Currently active wearable devices
--     2. v_pending_telehealth - Upcoming telehealth sessions
--     3. v_active_cds_alerts - Unacknowledged CDS alerts
--     4. v_active_insurance - Current valid insurance records
--
-- IMPORTANT: This migration uses PostgreSQL native types.
-- All timestamps use TIMESTAMPTZ for timezone awareness.

-- ============================================================================
-- PHASE 7: WEARABLES & IOT TABLES
-- ============================================================================

-- 7.1 Wearable Devices Table
CREATE TABLE IF NOT EXISTS wearable_devices (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL,
    device_type VARCHAR(100) NOT NULL, -- smartwatch, glucose_monitor, blood_pressure_cuff, pulse_oximeter, etc.
    device_manufacturer VARCHAR(100),
    device_model VARCHAR(100),
    device_serial_number VARCHAR(100),
    firmware_version VARCHAR(50),
    registered_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    registered_by VARCHAR(64) NOT NULL,
    last_sync_datetime TIMESTAMPTZ,
    sync_frequency_minutes INT,
    battery_level_percent INT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    connection_status VARCHAR(50) DEFAULT 'unknown', -- connected, disconnected, unknown
    alert_thresholds JSONB, -- Custom thresholds for alerts
    integration_api_key VARCHAR(255),
    integration_endpoint VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wearable_devices_patient ON wearable_devices(patient_id);
CREATE INDEX idx_wearable_devices_type ON wearable_devices(device_type);
CREATE INDEX idx_wearable_devices_active ON wearable_devices(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_wearable_devices_sync ON wearable_devices(last_sync_datetime);

-- 7.2 Wearable Data Table
CREATE TABLE IF NOT EXISTS wearable_data (
    id VARCHAR(64) PRIMARY KEY,
    device_id VARCHAR(64) NOT NULL REFERENCES wearable_devices(id),
    patient_id VARCHAR(64) NOT NULL,
    reading_datetime TIMESTAMPTZ NOT NULL,
    data_type VARCHAR(50) NOT NULL, -- heart_rate, blood_glucose, blood_pressure, spo2, steps, sleep, ecg, etc.
    value_numeric DECIMAL(10, 4),
    value_text VARCHAR(255),
    value_json JSONB, -- For complex readings like ECG waveforms
    unit_of_measure VARCHAR(50),
    quality_score DECIMAL(5, 2), -- Data quality indicator 0-100
    is_valid BOOLEAN DEFAULT TRUE,
    anomaly_detected BOOLEAN DEFAULT FALSE,
    anomaly_type VARCHAR(100),
    processed BOOLEAN DEFAULT FALSE,
    processed_datetime TIMESTAMPTZ,
    raw_data BYTEA, -- Optional raw device data
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wearable_data_device ON wearable_data(device_id);
CREATE INDEX idx_wearable_data_patient ON wearable_data(patient_id);
CREATE INDEX idx_wearable_data_datetime ON wearable_data(reading_datetime);
CREATE INDEX idx_wearable_data_type ON wearable_data(data_type);
CREATE INDEX idx_wearable_data_anomaly ON wearable_data(anomaly_detected) WHERE anomaly_detected = TRUE;
CREATE INDEX idx_wearable_data_unprocessed ON wearable_data(processed) WHERE processed = FALSE;

-- 7.3 Wearable Alerts Table
CREATE TABLE IF NOT EXISTS wearable_alerts (
    id VARCHAR(64) PRIMARY KEY,
    device_id VARCHAR(64) NOT NULL REFERENCES wearable_devices(id),
    patient_id VARCHAR(64) NOT NULL,
    data_reading_id VARCHAR(64) REFERENCES wearable_data(id),
    alert_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    alert_type VARCHAR(100) NOT NULL, -- threshold_exceeded, anomaly_detected, device_issue, battery_low, etc.
    severity VARCHAR(20) NOT NULL DEFAULT 'medium', -- low, medium, high, critical
    alert_title VARCHAR(255) NOT NULL,
    alert_message TEXT NOT NULL,
    threshold_value DECIMAL(10, 4),
    actual_value DECIMAL(10, 4),
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by VARCHAR(64),
    acknowledged_datetime TIMESTAMPTZ,
    escalated BOOLEAN DEFAULT FALSE,
    escalated_to VARCHAR(64),
    escalated_datetime TIMESTAMPTZ,
    resolution_notes TEXT,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_datetime TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wearable_alerts_device ON wearable_alerts(device_id);
CREATE INDEX idx_wearable_alerts_patient ON wearable_alerts(patient_id);
CREATE INDEX idx_wearable_alerts_severity ON wearable_alerts(severity);
CREATE INDEX idx_wearable_alerts_unack ON wearable_alerts(acknowledged) WHERE acknowledged = FALSE;
CREATE INDEX idx_wearable_alerts_datetime ON wearable_alerts(alert_datetime);

-- 7.4 Wearable Integration Logs Table
CREATE TABLE IF NOT EXISTS wearable_integration_logs (
    id VARCHAR(64) PRIMARY KEY,
    device_id VARCHAR(64) NOT NULL REFERENCES wearable_devices(id),
    patient_id VARCHAR(64) NOT NULL,
    log_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type VARCHAR(50) NOT NULL, -- sync_started, sync_completed, sync_failed, connection_lost, firmware_update, etc.
    status VARCHAR(50) NOT NULL, -- success, failure, warning, info
    records_synced INT,
    error_code VARCHAR(50),
    error_message TEXT,
    request_payload JSONB,
    response_payload JSONB,
    duration_ms INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wearable_logs_device ON wearable_integration_logs(device_id);
CREATE INDEX idx_wearable_logs_patient ON wearable_integration_logs(patient_id);
CREATE INDEX idx_wearable_logs_datetime ON wearable_integration_logs(log_datetime);
CREATE INDEX idx_wearable_logs_status ON wearable_integration_logs(status);

-- ============================================================================
-- PHASE 8: TELEHEALTH TABLES
-- ============================================================================

-- 8.1 Telehealth Sessions Table
CREATE TABLE IF NOT EXISTS telehealth_sessions (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL,
    provider_id VARCHAR(64) NOT NULL,
    appointment_id VARCHAR(64), -- Link to regular appointment if applicable
    session_type VARCHAR(50) NOT NULL, -- video, audio, chat, async
    scheduled_datetime TIMESTAMPTZ NOT NULL,
    actual_start_datetime TIMESTAMPTZ,
    actual_end_datetime TIMESTAMPTZ,
    duration_minutes INT,
    status VARCHAR(50) NOT NULL DEFAULT 'scheduled', -- scheduled, in_progress, completed, no_show, cancelled, technical_failure
    platform VARCHAR(100), -- zoom, teams, doxy, custom, etc.
    session_url VARCHAR(500),
    session_access_code VARCHAR(100),
    patient_location VARCHAR(100), -- State/country for licensure
    patient_device_type VARCHAR(50), -- mobile, desktop, tablet
    provider_location VARCHAR(100),
    connection_quality VARCHAR(50), -- excellent, good, fair, poor
    technical_issues JSONB, -- Array of issues encountered
    interpreter_required BOOLEAN DEFAULT FALSE,
    interpreter_language VARCHAR(50),
    interpreter_present BOOLEAN DEFAULT FALSE,
    guardian_present BOOLEAN DEFAULT FALSE,
    guardian_name VARCHAR(255),
    consent_obtained BOOLEAN NOT NULL DEFAULT FALSE,
    consent_datetime TIMESTAMPTZ,
    billing_code VARCHAR(50), -- Telehealth-specific billing code
    reason_for_visit TEXT,
    chief_complaint TEXT,
    follow_up_required BOOLEAN DEFAULT FALSE,
    follow_up_notes TEXT,
    recording_available BOOLEAN DEFAULT FALSE,
    recording_url VARCHAR(500),
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_telehealth_sessions_patient ON telehealth_sessions(patient_id);
CREATE INDEX idx_telehealth_sessions_provider ON telehealth_sessions(provider_id);
CREATE INDEX idx_telehealth_sessions_scheduled ON telehealth_sessions(scheduled_datetime);
CREATE INDEX idx_telehealth_sessions_status ON telehealth_sessions(status);
CREATE INDEX idx_telehealth_sessions_appointment ON telehealth_sessions(appointment_id);

-- 8.2 Telehealth Notes Table
CREATE TABLE IF NOT EXISTS telehealth_notes (
    id VARCHAR(64) PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL REFERENCES telehealth_sessions(id),
    patient_id VARCHAR(64) NOT NULL,
    provider_id VARCHAR(64) NOT NULL,
    note_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    subjective TEXT, -- Patient's description of symptoms
    objective TEXT, -- Provider's observations
    assessment TEXT, -- Diagnosis/impression
    plan TEXT, -- Treatment plan
    physical_exam_limitations TEXT, -- What couldn't be assessed virtually
    recommendations_for_inperson TEXT, -- If in-person visit needed
    prescriptions_issued JSONB, -- Medications prescribed
    referrals_made JSONB, -- Specialist referrals
    lab_orders JSONB, -- Labs ordered
    imaging_orders JSONB, -- Imaging ordered
    patient_education_provided TEXT,
    patient_understanding_verified BOOLEAN DEFAULT FALSE,
    follow_up_timeframe VARCHAR(100),
    provider_signature VARCHAR(255),
    signed_datetime TIMESTAMPTZ,
    addendum TEXT,
    addendum_datetime TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_telehealth_notes_session ON telehealth_notes(session_id);
CREATE INDEX idx_telehealth_notes_patient ON telehealth_notes(patient_id);
CREATE INDEX idx_telehealth_notes_provider ON telehealth_notes(provider_id);
CREATE INDEX idx_telehealth_notes_datetime ON telehealth_notes(note_datetime);

-- 8.3 Remote Patient Monitoring Table
CREATE TABLE IF NOT EXISTS remote_patient_monitoring (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL,
    program_name VARCHAR(255) NOT NULL, -- CHF Monitoring, Diabetes Management, Hypertension Control, etc.
    enrollment_date DATE NOT NULL,
    enrolled_by VARCHAR(64) NOT NULL,
    primary_condition VARCHAR(100) NOT NULL, -- ICD-10 code or description
    secondary_conditions JSONB, -- Array of other monitored conditions
    monitoring_parameters JSONB NOT NULL, -- What metrics to track: BP, weight, glucose, etc.
    target_goals JSONB, -- Target ranges for each parameter
    alert_thresholds JSONB NOT NULL, -- When to alert provider
    monitoring_frequency VARCHAR(100), -- daily, twice_daily, weekly, etc.
    assigned_care_manager VARCHAR(64),
    care_team_members JSONB, -- Array of provider IDs
    devices_assigned JSONB, -- Array of device IDs
    billing_eligible BOOLEAN DEFAULT TRUE,
    insurance_authorization VARCHAR(100),
    authorization_expiry DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, paused, graduated, terminated
    status_reason TEXT,
    graduation_criteria TEXT,
    last_review_date DATE,
    next_review_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rpm_patient ON remote_patient_monitoring(patient_id);
CREATE INDEX idx_rpm_status ON remote_patient_monitoring(status);
CREATE INDEX idx_rpm_program ON remote_patient_monitoring(program_name);
CREATE INDEX idx_rpm_care_manager ON remote_patient_monitoring(assigned_care_manager);

-- 8.4 RPM Readings Table
CREATE TABLE IF NOT EXISTS rpm_readings (
    id VARCHAR(64) PRIMARY KEY,
    rpm_enrollment_id VARCHAR(64) NOT NULL REFERENCES remote_patient_monitoring(id),
    patient_id VARCHAR(64) NOT NULL,
    device_id VARCHAR(64),
    reading_datetime TIMESTAMPTZ NOT NULL,
    reading_type VARCHAR(50) NOT NULL, -- blood_pressure, weight, blood_glucose, spo2, heart_rate, temperature, etc.
    systolic INT, -- For BP readings
    diastolic INT, -- For BP readings
    value_numeric DECIMAL(10, 4), -- For single value readings
    unit_of_measure VARCHAR(50),
    measurement_context VARCHAR(100), -- fasting, post_meal, at_rest, after_exercise, etc.
    symptoms_reported TEXT,
    patient_notes TEXT,
    is_within_target BOOLEAN,
    deviation_type VARCHAR(50), -- above_target, below_target, null if within
    deviation_severity VARCHAR(20), -- mild, moderate, severe
    alert_triggered BOOLEAN DEFAULT FALSE,
    alert_id VARCHAR(64),
    reviewed BOOLEAN DEFAULT FALSE,
    reviewed_by VARCHAR(64),
    reviewed_datetime TIMESTAMPTZ,
    review_notes TEXT,
    action_taken TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rpm_readings_enrollment ON rpm_readings(rpm_enrollment_id);
CREATE INDEX idx_rpm_readings_patient ON rpm_readings(patient_id);
CREATE INDEX idx_rpm_readings_datetime ON rpm_readings(reading_datetime);
CREATE INDEX idx_rpm_readings_type ON rpm_readings(reading_type);
CREATE INDEX idx_rpm_readings_unreviewed ON rpm_readings(reviewed) WHERE reviewed = FALSE;
CREATE INDEX idx_rpm_readings_alerts ON rpm_readings(alert_triggered) WHERE alert_triggered = TRUE;

-- ============================================================================
-- PHASE 9: CLINICAL DECISION SUPPORT TABLES
-- ============================================================================

-- 9.1 CDS Alerts Table
CREATE TABLE IF NOT EXISTS cds_alerts (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL,
    encounter_id VARCHAR(64),
    provider_id VARCHAR(64) NOT NULL,
    alert_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    alert_type VARCHAR(100) NOT NULL, -- drug_interaction, allergy_warning, duplicate_therapy, lab_critical, gap_in_care, etc.
    alert_category VARCHAR(50) NOT NULL, -- safety, quality, efficiency, regulatory
    severity VARCHAR(20) NOT NULL, -- info, warning, critical
    alert_title VARCHAR(255) NOT NULL,
    alert_message TEXT NOT NULL,
    clinical_evidence TEXT, -- Supporting clinical information
    recommendation TEXT, -- Suggested action
    source_system VARCHAR(100), -- Which CDS rule triggered this
    rule_id VARCHAR(100),
    rule_version VARCHAR(50),
    trigger_data JSONB, -- Data that triggered the alert
    related_order_id VARCHAR(64), -- If triggered by an order
    related_medication_id VARCHAR(64), -- If medication-related
    related_lab_id VARCHAR(64), -- If lab-related
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, acknowledged, overridden, auto_resolved
    acknowledged_by VARCHAR(64),
    acknowledged_datetime TIMESTAMPTZ,
    override_reason VARCHAR(255),
    override_justification TEXT,
    action_taken VARCHAR(255),
    action_datetime TIMESTAMPTZ,
    auto_resolved BOOLEAN DEFAULT FALSE,
    resolution_reason TEXT,
    was_helpful BOOLEAN, -- Provider feedback
    feedback_notes TEXT,
    displayed_duration_seconds INT, -- How long alert was shown
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cds_alerts_patient ON cds_alerts(patient_id);
CREATE INDEX idx_cds_alerts_provider ON cds_alerts(provider_id);
CREATE INDEX idx_cds_alerts_type ON cds_alerts(alert_type);
CREATE INDEX idx_cds_alerts_severity ON cds_alerts(severity);
CREATE INDEX idx_cds_alerts_status ON cds_alerts(status);
CREATE INDEX idx_cds_alerts_datetime ON cds_alerts(alert_datetime);
CREATE INDEX idx_cds_alerts_active ON cds_alerts(status) WHERE status = 'active';

-- ============================================================================
-- PHASE 10: INSURANCE & BILLING TABLES
-- ============================================================================

-- 10.1 Insurance Records Table
CREATE TABLE IF NOT EXISTS insurance_records (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL,
    insurance_type VARCHAR(50) NOT NULL, -- primary, secondary, tertiary, workers_comp, auto_accident
    payer_name VARCHAR(255) NOT NULL,
    payer_id VARCHAR(100), -- Payer ID for claims
    plan_name VARCHAR(255),
    plan_type VARCHAR(100), -- HMO, PPO, EPO, POS, HDHP, Medicare, Medicaid, Tricare
    policy_number VARCHAR(100) NOT NULL,
    group_number VARCHAR(100),
    subscriber_id VARCHAR(100) NOT NULL,
    subscriber_name VARCHAR(255),
    subscriber_relationship VARCHAR(50), -- self, spouse, child, other
    subscriber_dob DATE,
    effective_date DATE NOT NULL,
    termination_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    copay_amount DECIMAL(10, 2),
    deductible_amount DECIMAL(10, 2),
    deductible_met DECIMAL(10, 2),
    out_of_pocket_max DECIMAL(10, 2),
    out_of_pocket_met DECIMAL(10, 2),
    coinsurance_percent DECIMAL(5, 2),
    coverage_details JSONB, -- What's covered, limits, etc.
    prior_auth_required BOOLEAN DEFAULT FALSE,
    prior_auth_phone VARCHAR(20),
    claims_address TEXT,
    claims_phone VARCHAR(20),
    claims_fax VARCHAR(20),
    electronic_claims_eligible BOOLEAN DEFAULT TRUE,
    verification_status VARCHAR(50) DEFAULT 'pending', -- pending, verified, failed, expired
    last_verified_date DATE,
    last_verified_by VARCHAR(64),
    verification_notes TEXT,
    card_front_image_url VARCHAR(500),
    card_back_image_url VARCHAR(500),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_insurance_patient ON insurance_records(patient_id);
CREATE INDEX idx_insurance_type ON insurance_records(insurance_type);
CREATE INDEX idx_insurance_payer ON insurance_records(payer_name);
CREATE INDEX idx_insurance_active ON insurance_records(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_insurance_policy ON insurance_records(policy_number);
CREATE INDEX idx_insurance_subscriber ON insurance_records(subscriber_id);

-- 10.2 Billing Codes Table
CREATE TABLE IF NOT EXISTS billing_codes (
    id VARCHAR(64) PRIMARY KEY,
    code_type VARCHAR(20) NOT NULL, -- ICD-10-CM, ICD-10-PCS, CPT, HCPCS, DRG, NDC
    code VARCHAR(20) NOT NULL,
    description TEXT NOT NULL,
    short_description VARCHAR(255),
    category VARCHAR(100),
    subcategory VARCHAR(100),
    effective_date DATE,
    termination_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    billable BOOLEAN DEFAULT TRUE,
    requires_modifier BOOLEAN DEFAULT FALSE,
    common_modifiers JSONB, -- Array of common modifier codes
    relative_value_units DECIMAL(10, 4), -- RVU for CPT
    global_period_days INT, -- For surgical codes
    age_restrictions JSONB, -- Min/max age if applicable
    gender_restrictions VARCHAR(10), -- M, F, or null
    place_of_service_restrictions JSONB, -- Allowed POS codes
    requires_prior_auth BOOLEAN DEFAULT FALSE,
    typical_duration_minutes INT, -- For time-based codes
    add_on_code BOOLEAN DEFAULT FALSE, -- Is this an add-on code
    parent_code VARCHAR(20), -- Parent code for add-ons
    laterality_applicable BOOLEAN DEFAULT FALSE,
    notes TEXT,
    last_updated_by VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_billing_codes_unique ON billing_codes(code_type, code);
CREATE INDEX idx_billing_codes_type ON billing_codes(code_type);
CREATE INDEX idx_billing_codes_code ON billing_codes(code);
CREATE INDEX idx_billing_codes_active ON billing_codes(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_billing_codes_category ON billing_codes(category);
CREATE INDEX idx_billing_codes_description ON billing_codes USING gin(to_tsvector('english', description));

-- ============================================================================
-- VIEWS
-- ============================================================================

-- View: Active wearable devices
CREATE OR REPLACE VIEW v_active_wearables AS
SELECT 
    wd.id,
    wd.patient_id,
    wd.device_type,
    wd.device_manufacturer,
    wd.device_model,
    wd.last_sync_datetime,
    wd.battery_level_percent,
    wd.connection_status,
    (SELECT COUNT(*) FROM wearable_data wda WHERE wda.device_id = wd.id AND wda.reading_datetime > NOW() - INTERVAL '24 hours') as readings_24h,
    (SELECT COUNT(*) FROM wearable_alerts wa WHERE wa.device_id = wd.id AND wa.acknowledged = FALSE) as pending_alerts
FROM wearable_devices wd
WHERE wd.is_active = TRUE;

-- View: Pending/Upcoming telehealth sessions
CREATE OR REPLACE VIEW v_pending_telehealth AS
SELECT 
    ts.id,
    ts.patient_id,
    ts.provider_id,
    ts.session_type,
    ts.scheduled_datetime,
    ts.status,
    ts.platform,
    ts.session_url,
    ts.reason_for_visit,
    EXTRACT(EPOCH FROM (ts.scheduled_datetime - NOW())) / 60 as minutes_until_start
FROM telehealth_sessions ts
WHERE ts.status IN ('scheduled', 'in_progress')
AND ts.scheduled_datetime >= NOW() - INTERVAL '30 minutes'
ORDER BY ts.scheduled_datetime ASC;

-- View: Active CDS alerts
CREATE OR REPLACE VIEW v_active_cds_alerts AS
SELECT 
    ca.id,
    ca.patient_id,
    ca.provider_id,
    ca.alert_datetime,
    ca.alert_type,
    ca.alert_category,
    ca.severity,
    ca.alert_title,
    ca.alert_message,
    ca.recommendation,
    ca.related_order_id,
    ca.related_medication_id,
    EXTRACT(EPOCH FROM (NOW() - ca.alert_datetime)) / 60 as minutes_since_alert
FROM cds_alerts ca
WHERE ca.status = 'active'
ORDER BY 
    CASE ca.severity 
        WHEN 'critical' THEN 1 
        WHEN 'warning' THEN 2 
        ELSE 3 
    END,
    ca.alert_datetime DESC;

-- View: Active insurance records
CREATE OR REPLACE VIEW v_active_insurance AS
SELECT 
    ir.id,
    ir.patient_id,
    ir.insurance_type,
    ir.payer_name,
    ir.plan_name,
    ir.policy_number,
    ir.subscriber_id,
    ir.effective_date,
    ir.termination_date,
    ir.copay_amount,
    ir.deductible_amount,
    ir.deductible_met,
    ir.verification_status,
    ir.last_verified_date,
    CASE 
        WHEN ir.termination_date IS NOT NULL AND ir.termination_date < CURRENT_DATE + INTERVAL '30 days' 
        THEN TRUE 
        ELSE FALSE 
    END as expiring_soon
FROM insurance_records ir
WHERE ir.is_active = TRUE
AND (ir.termination_date IS NULL OR ir.termination_date >= CURRENT_DATE)
ORDER BY 
    CASE ir.insurance_type 
        WHEN 'primary' THEN 1 
        WHEN 'secondary' THEN 2 
        WHEN 'tertiary' THEN 3 
        ELSE 4 
    END;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Phase 7 triggers
CREATE TRIGGER trg_wearable_devices_updated_at
    BEFORE UPDATE ON wearable_devices
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_wearable_alerts_updated_at
    BEFORE UPDATE ON wearable_alerts
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

-- Phase 8 triggers
CREATE TRIGGER trg_telehealth_sessions_updated_at
    BEFORE UPDATE ON telehealth_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_telehealth_notes_updated_at
    BEFORE UPDATE ON telehealth_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_remote_patient_monitoring_updated_at
    BEFORE UPDATE ON remote_patient_monitoring
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

-- Phase 9 trigger
CREATE TRIGGER trg_cds_alerts_updated_at
    BEFORE UPDATE ON cds_alerts
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

-- Phase 10 triggers
CREATE TRIGGER trg_insurance_records_updated_at
    BEFORE UPDATE ON insurance_records
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_billing_codes_updated_at
    BEFORE UPDATE ON billing_codes
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
