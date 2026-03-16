-- MediChain Phase 11-15 Migration: Family History, Immunization, Death Record, Sync & Audit
-- Part of PostgreSQL migration from in-memory storage
--
-- Phases:
--   11. Family History & Genetics
--   12. Immunization Records
--   13. Death Records & Certification
--   14. Data Synchronization & Conflict Resolution
--   15. Enhanced Audit & Compliance
--
-- Total: 17 tables

-- ============================================================================
-- PHASE 11: FAMILY HISTORY & GENETICS
-- ============================================================================

-- Family Member Medical History
CREATE TABLE IF NOT EXISTS family_medical_history (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    relationship VARCHAR(50) NOT NULL,  -- mother, father, sibling, grandparent, etc.
    relationship_type VARCHAR(50),       -- biological, adoptive
    relative_name VARCHAR(255),
    relative_dob DATE,
    relative_gender VARCHAR(20),
    living_status VARCHAR(20),           -- living, deceased, unknown
    age_at_death INTEGER,
    cause_of_death VARCHAR(500),
    
    -- Medical conditions
    conditions JSONB DEFAULT '[]',       -- Array of condition objects
    cancer_history JSONB,                -- Specific cancer details
    cardiac_history JSONB,               -- Heart disease details
    diabetes_history JSONB,              -- Diabetes details
    mental_health_history JSONB,         -- Mental health conditions
    genetic_conditions JSONB,            -- Known genetic conditions
    
    -- Risk assessment
    hereditary_risk_score INTEGER,       -- Calculated risk 0-100
    genetic_testing_recommended BOOLEAN DEFAULT false,
    genetic_counseling_received BOOLEAN DEFAULT false,
    
    -- Documentation
    notes TEXT,
    verified BOOLEAN DEFAULT false,
    verified_by VARCHAR(64),
    verified_date DATE,
    source VARCHAR(100),                 -- patient_reported, medical_records, genetic_test
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_family_history_patient ON family_medical_history(patient_id);
CREATE INDEX idx_family_history_relationship ON family_medical_history(relationship);

-- Genetic Test Results
CREATE TABLE IF NOT EXISTS genetic_test_results (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    test_type VARCHAR(100) NOT NULL,     -- whole_genome, targeted_panel, single_gene
    panel_name VARCHAR(255),
    lab_name VARCHAR(255),
    lab_accession VARCHAR(100),
    ordered_by VARCHAR(64),
    ordered_date DATE,
    collected_date DATE,
    reported_date DATE,
    
    -- Results
    result_status VARCHAR(50) NOT NULL,  -- positive, negative, vus, inconclusive
    variants JSONB DEFAULT '[]',         -- Array of variant objects
    interpretation TEXT,
    clinical_significance VARCHAR(50),   -- pathogenic, likely_pathogenic, vus, likely_benign, benign
    
    -- Recommendations
    recommendations JSONB DEFAULT '[]',
    follow_up_required BOOLEAN DEFAULT false,
    genetic_counseling_provided BOOLEAN DEFAULT false,
    counselor_name VARCHAR(255),
    counseling_date DATE,
    
    -- Documentation
    report_url VARCHAR(500),
    report_ipfs_hash VARCHAR(100),
    consent_form_signed BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_genetic_tests_patient ON genetic_test_results(patient_id);
CREATE INDEX idx_genetic_tests_type ON genetic_test_results(test_type);

-- ============================================================================
-- PHASE 12: IMMUNIZATION RECORDS
-- ============================================================================

-- Immunization Records
CREATE TABLE IF NOT EXISTS immunization_records (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    vaccine_type VARCHAR(100) NOT NULL,  -- COVID-19, Influenza, Tetanus, etc.
    vaccine_name VARCHAR(255) NOT NULL,
    manufacturer VARCHAR(255),
    lot_number VARCHAR(100),
    ndc_code VARCHAR(50),                -- National Drug Code
    cvx_code VARCHAR(20),                -- CDC Vaccine Code
    mvx_code VARCHAR(20),                -- Manufacturer Code
    
    -- Administration
    administration_date DATE NOT NULL,
    administration_time TIME,
    administered_by VARCHAR(64),
    administered_by_name VARCHAR(255),
    administration_site VARCHAR(50),     -- left_arm, right_arm, left_thigh, etc.
    route VARCHAR(50),                   -- intramuscular, subcutaneous, oral, intranasal
    dose_amount VARCHAR(50),
    dose_unit VARCHAR(20),
    dose_number INTEGER,                 -- 1st, 2nd, booster, etc.
    series_complete BOOLEAN DEFAULT false,
    
    -- Facility
    facility_id VARCHAR(64),
    facility_name VARCHAR(255),
    facility_address TEXT,
    
    -- Eligibility & Documentation
    vfc_eligibility VARCHAR(50),         -- Vaccines for Children program
    funding_source VARCHAR(100),
    information_source VARCHAR(100),     -- new_immunization, historical, registry
    documentation_type VARCHAR(50),      -- written, electronic, verbal
    
    -- Reactions & Notes
    reaction_observed BOOLEAN DEFAULT false,
    reaction_details TEXT,
    contraindications_reviewed BOOLEAN DEFAULT true,
    patient_consent BOOLEAN DEFAULT true,
    vis_given BOOLEAN DEFAULT true,      -- Vaccine Information Statement
    vis_date DATE,
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_immunization_patient ON immunization_records(patient_id);
CREATE INDEX idx_immunization_vaccine ON immunization_records(vaccine_type);
CREATE INDEX idx_immunization_date ON immunization_records(administration_date);

-- Immunization Schedule
CREATE TABLE IF NOT EXISTS immunization_schedules (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    vaccine_type VARCHAR(100) NOT NULL,
    due_date DATE NOT NULL,
    earliest_date DATE,
    latest_date DATE,
    dose_number INTEGER,
    is_overdue BOOLEAN DEFAULT false,
    
    -- Status
    status VARCHAR(50) DEFAULT 'due',    -- due, completed, skipped, contraindicated
    completed_immunization_id VARCHAR(64) REFERENCES immunization_records(id),
    skip_reason TEXT,
    
    -- Reminder
    reminder_sent BOOLEAN DEFAULT false,
    reminder_date DATE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_imm_schedule_patient ON immunization_schedules(patient_id);
CREATE INDEX idx_imm_schedule_due ON immunization_schedules(due_date);
CREATE INDEX idx_imm_schedule_status ON immunization_schedules(status);

-- Vaccine Inventory (for facility management)
CREATE TABLE IF NOT EXISTS vaccine_inventory (
    id VARCHAR(64) PRIMARY KEY,
    facility_id VARCHAR(64),
    vaccine_type VARCHAR(100) NOT NULL,
    vaccine_name VARCHAR(255) NOT NULL,
    manufacturer VARCHAR(255),
    lot_number VARCHAR(100) NOT NULL,
    ndc_code VARCHAR(50),
    
    -- Inventory
    quantity_received INTEGER NOT NULL,
    quantity_remaining INTEGER NOT NULL,
    unit_of_measure VARCHAR(20) DEFAULT 'dose',
    
    -- Storage
    storage_location VARCHAR(100),
    storage_temperature_min DECIMAL(5, 2),
    storage_temperature_max DECIMAL(5, 2),
    temperature_monitored BOOLEAN DEFAULT true,
    
    -- Dates
    received_date DATE NOT NULL,
    expiration_date DATE NOT NULL,
    first_use_date DATE,
    
    -- Status
    status VARCHAR(50) DEFAULT 'available', -- available, expired, recalled, depleted
    recall_number VARCHAR(100),
    disposal_date DATE,
    disposal_reason TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vaccine_inv_facility ON vaccine_inventory(facility_id);
CREATE INDEX idx_vaccine_inv_lot ON vaccine_inventory(lot_number);
CREATE INDEX idx_vaccine_inv_expiry ON vaccine_inventory(expiration_date);

-- ============================================================================
-- PHASE 13: DEATH RECORDS & CERTIFICATION
-- ============================================================================

-- Death Records
CREATE TABLE IF NOT EXISTS death_records (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    
    -- Death Information
    date_of_death DATE NOT NULL,
    time_of_death TIME,
    pronounced_datetime TIMESTAMPTZ,
    pronounced_by VARCHAR(64),
    pronounced_by_name VARCHAR(255),
    
    -- Location
    place_of_death VARCHAR(50),          -- hospital, home, nursing_home, other
    facility_id VARCHAR(64),
    facility_name VARCHAR(255),
    death_address TEXT,
    county VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100) DEFAULT 'United States',
    
    -- Cause of Death (following death certificate format)
    immediate_cause VARCHAR(500),
    immediate_cause_duration VARCHAR(100),
    underlying_cause_a VARCHAR(500),
    underlying_cause_a_duration VARCHAR(100),
    underlying_cause_b VARCHAR(500),
    underlying_cause_b_duration VARCHAR(100),
    underlying_cause_c VARCHAR(500),
    underlying_cause_c_duration VARCHAR(100),
    other_significant_conditions TEXT,
    
    -- Manner of Death
    manner_of_death VARCHAR(50),         -- natural, accident, suicide, homicide, pending, undetermined
    autopsy_performed BOOLEAN DEFAULT false,
    autopsy_findings_available BOOLEAN DEFAULT false,
    autopsy_findings TEXT,
    medical_examiner_case BOOLEAN DEFAULT false,
    medical_examiner_number VARCHAR(100),
    
    -- Certification
    certifier_type VARCHAR(50),          -- physician, medical_examiner, coroner
    certifier_id VARCHAR(64),
    certifier_name VARCHAR(255),
    certifier_license VARCHAR(100),
    certification_date DATE,
    
    -- Registration
    death_certificate_number VARCHAR(100),
    registration_date DATE,
    registrar_district VARCHAR(100),
    
    -- Disposition
    disposition_method VARCHAR(50),      -- burial, cremation, donation, other
    disposition_date DATE,
    funeral_home VARCHAR(255),
    
    -- Additional
    tobacco_contributed BOOLEAN,
    pregnancy_status VARCHAR(50),        -- not_pregnant, pregnant, within_42_days, within_1_year
    injury_at_work BOOLEAN,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_death_records_patient ON death_records(patient_id);
CREATE INDEX idx_death_records_date ON death_records(date_of_death);

-- Organ Donation Records
CREATE TABLE IF NOT EXISTS organ_donation_records (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    death_record_id VARCHAR(64) REFERENCES death_records(id),
    
    -- Donor Registration
    registered_donor BOOLEAN DEFAULT false,
    registry_id VARCHAR(100),
    registration_date DATE,
    
    -- Consent
    consent_type VARCHAR(50),            -- registry, family, advance_directive
    consenting_party VARCHAR(255),
    consenting_relationship VARCHAR(50),
    consent_datetime TIMESTAMPTZ,
    
    -- Donation Details
    donation_type VARCHAR(50),           -- organ, tissue, both, research
    organs_donated JSONB DEFAULT '[]',   -- Array: heart, liver, kidney, etc.
    tissues_donated JSONB DEFAULT '[]',  -- Array: cornea, skin, bone, etc.
    
    -- Organ Procurement
    opo_name VARCHAR(255),               -- Organ Procurement Organization
    opo_contact VARCHAR(255),
    referral_datetime TIMESTAMPTZ,
    evaluation_datetime TIMESTAMPTZ,
    recovery_datetime TIMESTAMPTZ,
    recovery_location VARCHAR(255),
    
    -- Outcomes
    organs_recovered INTEGER,
    organs_transplanted INTEGER,
    tissues_recovered INTEGER,
    recipients_helped INTEGER,
    
    -- Documentation
    medical_suitability BOOLEAN,
    exclusion_reasons TEXT,
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_organ_donation_patient ON organ_donation_records(patient_id);

-- ============================================================================
-- PHASE 14: DATA SYNCHRONIZATION & CONFLICT RESOLUTION
-- ============================================================================

-- Sync Operations
CREATE TABLE IF NOT EXISTS sync_operations (
    id VARCHAR(64) PRIMARY KEY,
    operation_type VARCHAR(50) NOT NULL, -- full_sync, incremental, push, pull
    source_system VARCHAR(100) NOT NULL,
    target_system VARCHAR(100) NOT NULL,
    initiated_by VARCHAR(64),
    initiated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    -- Scope
    entity_types JSONB DEFAULT '[]',     -- Which entities to sync
    patient_ids JSONB,                   -- Specific patients, null for all
    date_range_start TIMESTAMPTZ,
    date_range_end TIMESTAMPTZ,
    
    -- Progress
    status VARCHAR(50) DEFAULT 'pending', -- pending, in_progress, completed, failed, cancelled
    total_records INTEGER DEFAULT 0,
    processed_records INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    conflict_count INTEGER DEFAULT 0,
    
    -- Results
    error_details JSONB DEFAULT '[]',
    sync_summary JSONB,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sync_ops_status ON sync_operations(status);
CREATE INDEX idx_sync_ops_source ON sync_operations(source_system);

-- Sync Conflicts
CREATE TABLE IF NOT EXISTS sync_conflicts (
    id VARCHAR(64) PRIMARY KEY,
    sync_operation_id VARCHAR(64) REFERENCES sync_operations(id),
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    patient_id VARCHAR(64),
    
    -- Conflict Details
    conflict_type VARCHAR(50) NOT NULL,  -- field_mismatch, missing_local, missing_remote, version_conflict
    field_name VARCHAR(100),
    local_value TEXT,
    remote_value TEXT,
    local_timestamp TIMESTAMPTZ,
    remote_timestamp TIMESTAMPTZ,
    local_version INTEGER,
    remote_version INTEGER,
    
    -- Resolution
    status VARCHAR(50) DEFAULT 'pending', -- pending, auto_resolved, manually_resolved, skipped
    resolution_strategy VARCHAR(50),      -- local_wins, remote_wins, merge, manual
    resolved_value TEXT,
    resolved_by VARCHAR(64),
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sync_conflicts_op ON sync_conflicts(sync_operation_id);
CREATE INDEX idx_sync_conflicts_status ON sync_conflicts(status);
CREATE INDEX idx_sync_conflicts_entity ON sync_conflicts(entity_type, entity_id);

-- External System Mappings
CREATE TABLE IF NOT EXISTS external_id_mappings (
    id VARCHAR(64) PRIMARY KEY,
    entity_type VARCHAR(100) NOT NULL,
    internal_id VARCHAR(64) NOT NULL,
    external_system VARCHAR(100) NOT NULL,
    external_id VARCHAR(255) NOT NULL,
    
    -- Sync State
    last_synced_at TIMESTAMPTZ,
    sync_status VARCHAR(50) DEFAULT 'active', -- active, stale, invalid, deleted
    sync_direction VARCHAR(20) DEFAULT 'bidirectional', -- inbound, outbound, bidirectional
    
    -- Metadata
    external_metadata JSONB,
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(entity_type, internal_id, external_system)
);

CREATE INDEX idx_ext_mappings_internal ON external_id_mappings(entity_type, internal_id);
CREATE INDEX idx_ext_mappings_external ON external_id_mappings(external_system, external_id);

-- ============================================================================
-- PHASE 15: ENHANCED AUDIT & COMPLIANCE
-- ============================================================================

-- Compliance Reports
CREATE TABLE IF NOT EXISTS compliance_reports (
    id VARCHAR(64) PRIMARY KEY,
    report_type VARCHAR(100) NOT NULL,   -- hipaa_audit, access_review, breach_assessment
    report_name VARCHAR(255) NOT NULL,
    reporting_period_start DATE NOT NULL,
    reporting_period_end DATE NOT NULL,
    generated_by VARCHAR(64),
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Scope
    department VARCHAR(100),
    facility_id VARCHAR(64),
    
    -- Findings
    total_events INTEGER DEFAULT 0,
    compliant_count INTEGER DEFAULT 0,
    violation_count INTEGER DEFAULT 0,
    high_risk_count INTEGER DEFAULT 0,
    findings JSONB DEFAULT '[]',
    recommendations JSONB DEFAULT '[]',
    
    -- Status
    status VARCHAR(50) DEFAULT 'draft',  -- draft, pending_review, approved, archived
    reviewed_by VARCHAR(64),
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    
    -- Report File
    report_url VARCHAR(500),
    report_ipfs_hash VARCHAR(100),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_compliance_reports_type ON compliance_reports(report_type);
CREATE INDEX idx_compliance_reports_period ON compliance_reports(reporting_period_start, reporting_period_end);

-- Data Retention Policies
CREATE TABLE IF NOT EXISTS data_retention_policies (
    id VARCHAR(64) PRIMARY KEY,
    policy_name VARCHAR(255) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    
    -- Retention Rules
    retention_period_days INTEGER NOT NULL,
    retention_period_type VARCHAR(50),   -- from_creation, from_last_access, from_patient_death
    archive_after_days INTEGER,
    delete_after_days INTEGER,
    
    -- Scope
    applies_to_status JSONB,             -- Which record statuses this applies to
    department VARCHAR(100),
    
    -- Exceptions
    exceptions JSONB,                    -- Conditions where policy doesn't apply
    legal_hold_override BOOLEAN DEFAULT true,
    
    -- Compliance
    regulatory_basis VARCHAR(255),       -- HIPAA, state_law, etc.
    review_frequency_days INTEGER DEFAULT 365,
    last_reviewed_date DATE,
    reviewed_by VARCHAR(64),
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    effective_date DATE NOT NULL,
    end_date DATE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_retention_policies_entity ON data_retention_policies(entity_type);
CREATE INDEX idx_retention_policies_active ON data_retention_policies(is_active);

-- Retention Job History
CREATE TABLE IF NOT EXISTS retention_job_runs (
    id VARCHAR(64) PRIMARY KEY,
    policy_id VARCHAR(64) REFERENCES data_retention_policies(id),
    job_type VARCHAR(50) NOT NULL,       -- archive, delete, audit
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    -- Scope
    entity_type VARCHAR(100) NOT NULL,
    date_threshold DATE NOT NULL,
    
    -- Results
    status VARCHAR(50) DEFAULT 'running', -- running, completed, failed, cancelled
    records_evaluated INTEGER DEFAULT 0,
    records_archived INTEGER DEFAULT 0,
    records_deleted INTEGER DEFAULT 0,
    records_skipped INTEGER DEFAULT 0,
    
    -- Errors
    error_count INTEGER DEFAULT 0,
    error_details JSONB DEFAULT '[]',
    
    -- Audit
    run_by VARCHAR(64),
    dry_run BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_retention_jobs_policy ON retention_job_runs(policy_id);
CREATE INDEX idx_retention_jobs_status ON retention_job_runs(status);

-- Consent Management
CREATE TABLE IF NOT EXISTS consent_records (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL REFERENCES patients(id),
    consent_type VARCHAR(100) NOT NULL,  -- treatment, hipaa_notice, research, marketing, data_sharing
    
    -- Consent Details
    consent_given BOOLEAN NOT NULL,
    consent_datetime TIMESTAMPTZ NOT NULL,
    expiration_datetime TIMESTAMPTZ,
    
    -- Scope
    scope_description TEXT,
    data_types_covered JSONB,
    purpose VARCHAR(255),
    recipient_organization VARCHAR(255),
    
    -- Collection
    collection_method VARCHAR(50),       -- written, electronic, verbal
    witness_name VARCHAR(255),
    witness_signature VARCHAR(255),
    collector_id VARCHAR(64),
    collector_name VARCHAR(255),
    
    -- Revocation
    revoked BOOLEAN DEFAULT false,
    revoked_datetime TIMESTAMPTZ,
    revocation_reason TEXT,
    revoked_by VARCHAR(64),
    
    -- Documentation
    document_url VARCHAR(500),
    document_ipfs_hash VARCHAR(100),
    
    -- Compliance
    regulatory_requirement VARCHAR(100),
    version VARCHAR(50),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_consent_patient ON consent_records(patient_id);
CREATE INDEX idx_consent_type ON consent_records(consent_type);
-- Note: Expiration check removed from index predicate since NOW() is not IMMUTABLE
-- Expiration should be checked at query time
CREATE INDEX idx_consent_active ON consent_records(patient_id, consent_type) WHERE revoked = false;

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Active consents view
CREATE OR REPLACE VIEW v_active_consents AS
SELECT * FROM consent_records
WHERE revoked = false
AND (expiration_datetime IS NULL OR expiration_datetime > NOW());

-- Overdue immunizations view
CREATE OR REPLACE VIEW v_overdue_immunizations AS
SELECT * FROM immunization_schedules
WHERE status = 'due' AND due_date < CURRENT_DATE;

-- Pending sync conflicts view
CREATE OR REPLACE VIEW v_pending_sync_conflicts AS
SELECT * FROM sync_conflicts
WHERE status = 'pending'
ORDER BY created_at ASC;

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================

CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all Phase 11-15 tables
DO $$ 
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN 
        SELECT unnest(ARRAY[
            'family_medical_history', 'genetic_test_results',
            'immunization_records', 'immunization_schedules', 'vaccine_inventory',
            'death_records', 'organ_donation_records',
            'sync_operations', 'sync_conflicts', 'external_id_mappings',
            'compliance_reports', 'data_retention_policies', 'retention_job_runs', 'consent_records'
        ])
    LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I;
            CREATE TRIGGER trg_%s_updated_at
            BEFORE UPDATE ON %I
            FOR EACH ROW EXECUTE FUNCTION update_timestamp();
        ', tbl, tbl, tbl, tbl);
    END LOOP;
END $$;
