-- MediChain schema baseline (2026-10-19).
--
-- One migration for the whole schema and its reference rows, generated from a
-- database built by every earlier migration in order. A database that applied
-- that full history adopts this file in place of it (see
-- api/src/db/migration_history.rs); a new database runs only this.
--
-- Forward-only from here: change the schema with new, later migration files.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE FUNCTION cleanup_expired_sessions() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

CREATE FUNCTION freeze_patient_health_id() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.health_id IS DISTINCT FROM OLD.health_id THEN
        RAISE EXCEPTION 'issued patient health ID cannot be changed';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION prevent_medical_id_reuse() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'medical ID issuance is immutable';
END;
$$;

CREATE FUNCTION register_medical_id() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO medical_id_issuances (medical_id, patient_id)
    VALUES (CASE
              WHEN NEW.health_id LIKE 'MCHI-%' THEN NEW.health_id
              WHEN NEW.id LIKE 'PAT-%' AND length(NEW.id) <= 31
                THEN 'MCHI-' || upper(substr(NEW.id, 5))
              ELSE 'MCHI-' || upper(substr(md5(NEW.id), 1, 26))
            END,
            NEW.id);
    RETURN NEW;
END;
$$;

CREATE FUNCTION update_phase4_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE FUNCTION update_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE FUNCTION update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TABLE access_contexts (
    id text NOT NULL,
    patient_id character varying(64) NOT NULL,
    clinician_id text NOT NULL,
    reason text NOT NULL,
    authority_type text NOT NULL,
    authority_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT access_context_is_bounded CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '12:00:00'::interval)))),
    CONSTRAINT access_contexts_authority_type_check CHECK ((authority_type = ANY (ARRAY['guardian'::text, 'admin'::text, 'patient_grant'::text, 'care_relationship'::text, 'break_glass'::text]))),
    CONSTRAINT access_contexts_reason_check CHECK (((length(TRIM(BOTH FROM reason)) >= 1) AND (length(TRIM(BOTH FROM reason)) <= 140)))
);

CREATE TABLE access_logs (
    id character varying(64) NOT NULL,
    accessor_id character varying(66) NOT NULL,
    accessor_role character varying(32) NOT NULL,
    patient_id character varying(64),
    resource_type character varying(64) NOT NULL,
    resource_id character varying(128),
    action character varying(64) NOT NULL,
    access_reason text,
    is_emergency_access boolean DEFAULT false,
    ip_address character varying(45),
    user_agent text,
    accessed_at timestamp with time zone DEFAULT now() NOT NULL,
    facility_id character varying(64),
    seal_seq bigint NOT NULL,
    authority_type text,
    authority_id text,
    CONSTRAINT access_logs_action_check CHECK (((action)::text = ANY ((ARRAY['View'::character varying, 'Create'::character varying, 'Update'::character varying, 'Delete'::character varying, 'Export'::character varying, 'Print'::character varying, 'EmergencyAccess'::character varying, 'view'::character varying, 'create'::character varying, 'emergency'::character varying, 'restricted'::character varying, 'upload_record'::character varying, 'download_record'::character varying, 'list_records'::character varying, 'view_medical_id'::character varying, 'nfc_tap'::character varying, 'nfc_self_verify'::character varying, 'qr_verification'::character varying, 'log_symptom'::character varying, 'lab_submission'::character varying, 'add_vital_signs'::character varying, 'lab_review_approve'::character varying, 'lab_review_reject'::character varying, 'create_soap_note'::character varying, 'create_operative_note'::character varying, 'create_pre_op'::character varying, 'create_post_op'::character varying, 'create_anesthesia'::character varying, 'create_pathology'::character varying, 'create_radiology_order'::character varying, 'create_radiology_report'::character varying, 'create_transfusion'::character varying, 'create_e_prescription'::character varying, 'create_death_certificate'::character varying, 'file_death_certificate'::character varying, 'create_autopsy_request'::character varying, 'create_autopsy_report'::character varying, 'prescription_signed'::character varying, 'prescription_transmitted'::character varying, 'specimen_rejection_notified'::character varying, 'create_trauma_assessment'::character varying, 'create_stroke_assessment'::character varying, 'create_sepsis_assessment'::character varying, 'create_ems_handoff'::character varying, 'create_code_blue'::character varying, 'create_cardiac_event'::character varying, 'telehealth'::character varying, 'recording-started'::character varying, 'recording-stopped'::character varying, 'conference-joined'::character varying, 'conference-left'::character varying, 'participant-joined'::character varying, 'participant-left'::character varying, 'error'::character varying, 'specimen_recollection_requested'::character varying, 'specimen_recollection_completed'::character varying, 'specimen_recollection_cancelled'::character varying, 'prescription_received'::character varying, 'prescription_fill_started'::character varying, 'prescription_dispensed'::character varying, 'prescription_partial_fill'::character varying, 'prescription_dispense_reversed'::character varying, 'prescription_verification_requested'::character varying, 'prescription_verification_approved'::character varying, 'prescription_verification_rejected'::character varying, 'prescription_verification_expired'::character varying, 'prescription_verification_revoked'::character varying, 'retract_symptom'::character varying, 'critical_value_acknowledged'::character varying, 'critical_value_cancelled'::character varying, 'custody_transferred'::character varying, 'update_pathology_report'::character varying, 'pharmacy_dispensing_decision'::character varying, 'ama_signatures_collected'::character varying, 'refill_requested'::character varying, 'refill_approved'::character varying, 'refill_denied'::character varying, 'refill_cancelled'::character varying, 'message_attachment_uploaded'::character varying, 'message_attachment_downloaded'::character varying, 'eob_uploaded'::character varying, 'eob_downloaded'::character varying, 'research_export_proposed'::character varying, 'research_export_approved'::character varying, 'research_export_executed'::character varying, 'research_export_included'::character varying, 'blood_unit_received'::character varying, 'blood_unit_reserved'::character varying, 'blood_unit_released'::character varying, 'blood_unit_issued'::character varying, 'blood_unit_discarded'::character varying, 'recording_consent_given'::character varying, 'recording_consent_withdrawn'::character varying, 'telehealth_recording_stored'::character varying, 'telehealth_recording_viewed'::character varying, 'break_glass_opened'::character varying, 'handoff_receipt_requested'::character varying])::text[]))),
    CONSTRAINT access_logs_authority_type_check CHECK (((authority_type IS NULL) OR (authority_type = ANY (ARRAY['self'::text, 'guardian'::text, 'admin'::text, 'patient_grant'::text, 'care_relationship'::text, 'break_glass'::text, 'emergency_token'::text]))))
);

CREATE TABLE actor_column_registry (
    table_name text NOT NULL,
    column_name text NOT NULL,
    kind text NOT NULL,
    sealed boolean DEFAULT false NOT NULL,
    fk text,
    note text,
    CONSTRAINT actor_column_registry_check CHECK ((sealed = (kind = 'sealed'::text))),
    CONSTRAINT actor_column_registry_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'mixed'::text, 'jsonb'::text, 'record_id'::text, 'sealed'::text, 'legacy'::text, 'session'::text, 'uuid_fk'::text])))
);

CREATE TABLE adherence_logs (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    reminder_id character varying(64),
    prescription_id character varying(64),
    medication_name character varying(256) NOT NULL,
    scheduled_time timestamp with time zone NOT NULL,
    action_taken character varying(32) NOT NULL,
    actual_time timestamp with time zone,
    reported_by character varying(32) DEFAULT 'patient'::character varying,
    skip_reason character varying(128),
    side_effects_reported jsonb DEFAULT '[]'::jsonb,
    notes text,
    device_id character varying(64),
    location jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT adherence_logs_action_taken_check CHECK (((action_taken)::text = ANY ((ARRAY['taken'::character varying, 'skipped'::character varying, 'delayed'::character varying, 'missed'::character varying, 'early'::character varying])::text[]))),
    CONSTRAINT adherence_logs_reported_by_check CHECK (((reported_by)::text = ANY ((ARRAY['patient'::character varying, 'caregiver'::character varying, 'system'::character varying, 'provider'::character varying])::text[])))
);

CREATE TABLE ama_discharges (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    encounter_id character varying(64) NOT NULL,
    discharge_datetime timestamp with time zone DEFAULT now() NOT NULL,
    attending_physician_id character varying(66) NOT NULL,
    reason_for_leaving text NOT NULL,
    risks_explained jsonb DEFAULT '[]'::jsonb NOT NULL,
    specific_risks_discussed text NOT NULL,
    patient_verbalized_understanding boolean DEFAULT false NOT NULL,
    decision_making_capacity boolean DEFAULT true NOT NULL,
    capacity_assessment text,
    alternatives_offered jsonb DEFAULT '[]'::jsonb,
    patient_refused_alternatives boolean DEFAULT true NOT NULL,
    ama_form_signed boolean DEFAULT false NOT NULL,
    ama_form_refused_reason text,
    witness_present boolean DEFAULT false NOT NULL,
    witness_name character varying(128),
    witness_signature character varying(256),
    patient_given_prescriptions boolean DEFAULT false NOT NULL,
    prescriptions_given jsonb DEFAULT '[]'::jsonb,
    follow_up_offered boolean DEFAULT true NOT NULL,
    follow_up_instructions text,
    patient_contact_info_verified boolean DEFAULT false NOT NULL,
    emergency_contact_notified boolean DEFAULT false NOT NULL,
    belongings_returned boolean DEFAULT true NOT NULL,
    security_escort boolean DEFAULT false NOT NULL,
    police_notified boolean DEFAULT false NOT NULL,
    social_work_notified boolean DEFAULT false NOT NULL,
    documentation_complete boolean DEFAULT false NOT NULL,
    physician_narrative text NOT NULL,
    nurse_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    patient_signature text,
    patient_signature_at timestamp with time zone,
    witness_signature_at timestamp with time zone,
    signatures_collected_by text
);

CREATE TABLE anesthesia_records (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    operative_note_id character varying(64),
    anesthesiologist_id character varying(66) NOT NULL,
    crna_id character varying(66),
    anesthesia_type character varying(64),
    asa_classification character varying(8),
    airway_management jsonb DEFAULT '{}'::jsonb,
    induction_agents jsonb DEFAULT '[]'::jsonb,
    maintenance_agents jsonb DEFAULT '[]'::jsonb,
    neuromuscular_blockers jsonb DEFAULT '[]'::jsonb,
    reversal_agents jsonb DEFAULT '[]'::jsonb,
    vasopressors jsonb DEFAULT '[]'::jsonb,
    intraop_fluids jsonb DEFAULT '[]'::jsonb,
    blood_products jsonb DEFAULT '[]'::jsonb,
    monitoring jsonb DEFAULT '{}'::jsonb,
    vital_signs_timeline jsonb DEFAULT '[]'::jsonb,
    events jsonb DEFAULT '[]'::jsonb,
    complications text,
    emergence_time timestamp with time zone,
    extubation_time timestamp with time zone,
    pacu_arrival_time timestamp with time zone,
    pacu_discharge_time timestamp with time zone,
    aldrete_score_arrival integer,
    aldrete_score_discharge integer,
    post_anesthesia_orders text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    record_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT anesthesia_records_aldrete_score_arrival_check CHECK (((aldrete_score_arrival >= 0) AND (aldrete_score_arrival <= 10))),
    CONSTRAINT anesthesia_records_aldrete_score_discharge_check CHECK (((aldrete_score_discharge >= 0) AND (aldrete_score_discharge <= 10))),
    CONSTRAINT anesthesia_records_anesthesia_type_check CHECK (((anesthesia_type)::text = ANY ((ARRAY['general'::character varying, 'regional'::character varying, 'local'::character varying, 'sedation'::character varying, 'combined'::character varying, 'mac'::character varying, 'spinal'::character varying, 'epidural'::character varying])::text[])))
);

CREATE TABLE appointments (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    provider_id character varying(66) NOT NULL,
    appointment_type character varying(64) NOT NULL,
    scheduled_datetime timestamp with time zone NOT NULL,
    duration_minutes integer DEFAULT 30 NOT NULL,
    status character varying(32) DEFAULT 'scheduled'::character varying NOT NULL,
    location character varying(128),
    room character varying(32),
    reason_for_visit text,
    visit_type character varying(32),
    priority character varying(16) DEFAULT 'routine'::character varying,
    recurring boolean DEFAULT false NOT NULL,
    recurrence_pattern character varying(64),
    parent_appointment_id character varying(64),
    insurance_verified boolean DEFAULT false NOT NULL,
    copay_amount numeric(10,2),
    copay_collected boolean DEFAULT false NOT NULL,
    reminder_sent boolean DEFAULT false NOT NULL,
    reminder_sent_at timestamp with time zone,
    check_in_time timestamp with time zone,
    check_out_time timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancellation_reason text,
    cancelled_by character varying(66),
    notes text,
    created_by character varying(66) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    currency character varying(3) DEFAULT 'ZAR'::character varying NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT appointments_priority_check CHECK (((priority)::text = ANY ((ARRAY['routine'::character varying, 'urgent'::character varying, 'follow_up'::character varying])::text[]))),
    CONSTRAINT appointments_status_check CHECK (((status)::text = ANY ((ARRAY['scheduled'::character varying, 'confirmed'::character varying, 'checked_in'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'cancelled'::character varying, 'no_show'::character varying, 'rescheduled'::character varying, 'waitlisted'::character varying, 'declined'::character varying])::text[]))),
    CONSTRAINT appointments_visit_type_check CHECK (((visit_type)::text = ANY ((ARRAY['in_person'::character varying, 'telehealth'::character varying, 'phone'::character varying])::text[])))
);

CREATE SEQUENCE audit_seal_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE audit_seal_seq OWNED BY access_logs.seal_seq;

CREATE TABLE audit_events (
    id text NOT NULL,
    event_type text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    payload_hash text NOT NULL,
    payload jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    seal_seq bigint DEFAULT nextval('audit_seal_seq'::regclass) NOT NULL
);

CREATE TABLE audit_seal_batch_members (
    batch_id bigint NOT NULL,
    leaf_index integer NOT NULL,
    source_id text NOT NULL,
    leaf_hash text NOT NULL,
    source text NOT NULL,
    CONSTRAINT audit_seal_batch_members_leaf_hash_check CHECK ((leaf_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT audit_seal_batch_members_leaf_index_check CHECK ((leaf_index >= 0)),
    CONSTRAINT audit_seal_batch_members_source_check CHECK ((source = ANY (ARRAY['access_log'::text, 'audit_event'::text])))
);

CREATE TABLE audit_seal_batches (
    id bigint NOT NULL,
    merkle_root text NOT NULL,
    first_seq bigint NOT NULL,
    last_seq bigint NOT NULL,
    leaf_count integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    prev_batch_hash text,
    batch_hash text,
    signature text,
    signing_key_id text,
    sealed_at timestamp with time zone,
    exported_at timestamp with time zone,
    export_ref text,
    CONSTRAINT audit_seal_batches_leaf_count_check CHECK ((leaf_count > 0)),
    CONSTRAINT audit_seal_batches_merkle_root_check CHECK ((merkle_root ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT audit_seal_batch_exported_has_ref CHECK (((status <> 'exported'::text) OR ((exported_at IS NOT NULL) AND (export_ref IS NOT NULL)))),
    CONSTRAINT audit_seal_batch_hash_format CHECK (((batch_hash IS NULL) OR (batch_hash ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT audit_seal_batch_prev_hash_format CHECK (((prev_batch_hash IS NULL) OR (prev_batch_hash ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT audit_seal_batch_range CHECK ((first_seq <= last_seq)),
    CONSTRAINT audit_seal_batch_sealed_has_hash CHECK (((status = 'pending'::text) OR ((batch_hash IS NOT NULL) AND (sealed_at IS NOT NULL)))),
    CONSTRAINT audit_seal_batch_signature_format CHECK (((signature IS NULL) OR (signature ~ '^[0-9a-f]{128}$'::text))),
    CONSTRAINT audit_seal_batch_signature_has_key CHECK (((signature IS NULL) = (signing_key_id IS NULL))),
    CONSTRAINT audit_seal_batch_status CHECK ((status = ANY (ARRAY['pending'::text, 'sealed'::text, 'exported'::text])))
);

CREATE SEQUENCE audit_seal_batches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE audit_seal_batches_id_seq OWNED BY audit_seal_batches.id;

CREATE TABLE auth_login_sessions (
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_authenticated_at timestamp with time zone DEFAULT now() NOT NULL,
    step_up_until timestamp with time zone,
    step_up_method character varying(64),
    revoked_at timestamp with time zone,
    revocation_reason character varying(64),
    user_id uuid NOT NULL,
    CONSTRAINT auth_login_sessions_step_up_method_check CHECK (((step_up_method IS NULL) OR ((step_up_method)::text = ANY ((ARRAY['totp'::character varying, 'password'::character varying])::text[]))))
);

CREATE TABLE auth_security_events (
    id bigint NOT NULL,
    event_type character varying(48) NOT NULL,
    login_session_id uuid,
    challenge_id uuid,
    action character varying(64),
    detail character varying(200),
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid
);

CREATE SEQUENCE auth_security_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE auth_security_events_id_seq OWNED BY auth_security_events.id;

CREATE TABLE auth_sessions (
    id uuid NOT NULL,
    refresh_token_hash character(64) NOT NULL,
    refresh_jti uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revocation_reason character varying(64),
    login_session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    CONSTRAINT auth_sessions_expiry_after_creation CHECK ((expires_at > created_at))
);

CREATE TABLE auth_transaction_challenges (
    id uuid NOT NULL,
    login_session_id uuid NOT NULL,
    action character varying(64) NOT NULL,
    method character varying(8) NOT NULL,
    path text NOT NULL,
    body_digest character(64) NOT NULL,
    resource_id text,
    expected_state text,
    idempotency_key text,
    authenticator_type character varying(32),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    user_id uuid NOT NULL,
    required_factor character varying(16) NOT NULL,
    verified_at timestamp with time zone,
    CONSTRAINT auth_txn_challenge_authenticator_check CHECK (((authenticator_type IS NULL) OR ((authenticator_type)::text = ANY ((ARRAY['totp'::character varying, 'password'::character varying])::text[])))),
    CONSTRAINT auth_txn_challenge_expiry_after_creation CHECK ((expires_at > created_at)),
    CONSTRAINT auth_txn_challenge_factor_check CHECK (((required_factor)::text = ANY ((ARRAY['totp'::character varying, 'password'::character varying])::text[])))
);

CREATE TABLE autopsy_reports (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE backup_canaries (
    id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT backup_canaries_id_check CHECK ((id ~ '^canary-[0-9A-Za-z-]{8,64}$'::text))
);

CREATE TABLE barcode_scans (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE blood_type_screen_records (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE blood_units (
    id text NOT NULL,
    unit_number text NOT NULL,
    product_type text NOT NULL,
    abo text NOT NULL,
    rh text NOT NULL,
    collected_on date NOT NULL,
    expires_on date NOT NULL,
    status text DEFAULT 'available'::text NOT NULL,
    location text NOT NULL,
    reserved_for_patient_id character varying(64),
    crossmatch_reference text,
    reserved_at timestamp with time zone,
    issued_to_patient_id character varying(64),
    transfusion_id text,
    issued_at timestamp with time zone,
    discard_reason text,
    received_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blood_unit_discard_has_reason CHECK (((status <> 'discarded'::text) OR (discard_reason IS NOT NULL))),
    CONSTRAINT blood_unit_expiry_after_collection CHECK ((expires_on >= collected_on)),
    CONSTRAINT blood_unit_issued_names_transfusion CHECK (((status <> 'issued'::text) OR ((issued_to_patient_id IS NOT NULL) AND (transfusion_id IS NOT NULL)))),
    CONSTRAINT blood_unit_not_issued_expired CHECK (((status <> 'issued'::text) OR ((issued_at IS NOT NULL) AND ((issued_at)::date <= expires_on)))),
    CONSTRAINT blood_unit_not_reserved_expired CHECK (((status <> 'reserved'::text) OR ((reserved_at IS NOT NULL) AND ((reserved_at)::date <= expires_on)))),
    CONSTRAINT blood_unit_reserved_names_patient CHECK (((status <> 'reserved'::text) OR ((reserved_for_patient_id IS NOT NULL) AND (crossmatch_reference IS NOT NULL)))),
    CONSTRAINT blood_units_abo_check CHECK ((abo = ANY (ARRAY['A'::text, 'B'::text, 'AB'::text, 'O'::text]))),
    CONSTRAINT blood_units_crossmatch_reference_check CHECK (((crossmatch_reference IS NULL) OR ((length(crossmatch_reference) >= 1) AND (length(crossmatch_reference) <= 64)))),
    CONSTRAINT blood_units_discard_reason_check CHECK (((discard_reason IS NULL) OR ((length(discard_reason) >= 5) AND (length(discard_reason) <= 500)))),
    CONSTRAINT blood_units_location_check CHECK (((length(location) >= 1) AND (length(location) <= 120))),
    CONSTRAINT blood_units_product_type_check CHECK ((product_type = ANY (ARRAY['PackedRBC'::text, 'FFP'::text, 'Platelets'::text, 'Cryoprecipitate'::text, 'WholeBlood'::text]))),
    CONSTRAINT blood_units_rh_check CHECK ((rh = ANY (ARRAY['positive'::text, 'negative'::text]))),
    CONSTRAINT blood_units_status_check CHECK ((status = ANY (ARRAY['available'::text, 'reserved'::text, 'issued'::text, 'expired'::text, 'discarded'::text]))),
    CONSTRAINT blood_units_unit_number_check CHECK ((unit_number ~ '^[A-Z0-9-]{5,32}$'::text))
);

CREATE TABLE break_glass_grants (
    id text NOT NULL,
    patient_id character varying(64) NOT NULL,
    clinician_id text NOT NULL,
    reason text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT break_glass_grants_reason_check CHECK (((length(TRIM(BOTH FROM reason)) >= 10) AND (length(TRIM(BOTH FROM reason)) <= 500))),
    CONSTRAINT break_glass_is_time_limited CHECK (((expires_at > starts_at) AND (expires_at <= (starts_at + '12:00:00'::interval))))
);

CREATE TABLE burn_assessments (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    assessed_by character varying(66) NOT NULL,
    assessment_datetime timestamp with time zone DEFAULT now() NOT NULL,
    mechanism_of_injury text NOT NULL,
    burn_agent character varying(128),
    time_of_injury timestamp with time zone,
    tbsa_percentage numeric(5,2) NOT NULL,
    burn_depth jsonb DEFAULT '[]'::jsonb NOT NULL,
    affected_areas jsonb DEFAULT '[]'::jsonb NOT NULL,
    inhalation_injury boolean DEFAULT false NOT NULL,
    inhalation_symptoms text,
    airway_status character varying(64),
    circumferential_burns boolean DEFAULT false NOT NULL,
    circumferential_locations jsonb DEFAULT '[]'::jsonb,
    escharotomy_needed boolean DEFAULT false NOT NULL,
    escharotomy_performed boolean DEFAULT false NOT NULL,
    fluid_resuscitation_started boolean DEFAULT false NOT NULL,
    parkland_formula_volume integer,
    urine_output_goal integer,
    pain_score integer,
    tetanus_status character varying(32),
    transfer_to_burn_center boolean DEFAULT false NOT NULL,
    burn_center_notified boolean DEFAULT false NOT NULL,
    photos_taken boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    weight_kg numeric(6,2),
    severity character varying(16),
    parkland_first_8h_ml integer,
    parkland_next_16h_ml integer,
    associated_injuries jsonb DEFAULT '[]'::jsonb NOT NULL,
    interventions jsonb DEFAULT '[]'::jsonb NOT NULL,
    fluid_start_time timestamp with time zone,
    urine_output_ml_hr integer,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT burn_assessments_pain_score_check CHECK (((pain_score >= 0) AND (pain_score <= 10))),
    CONSTRAINT burn_assessments_severity_check CHECK (((severity IS NULL) OR ((severity)::text = ANY ((ARRAY['minor'::character varying, 'moderate'::character varying, 'major'::character varying])::text[]))))
);

CREATE TABLE cardiac_events (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    event_type character varying(64) NOT NULL,
    symptom_onset timestamp with time zone,
    chest_pain_character text,
    associated_symptoms jsonb DEFAULT '[]'::jsonb,
    heart_rate integer,
    blood_pressure_systolic integer,
    blood_pressure_diastolic integer,
    oxygen_saturation integer,
    troponin_value numeric(10,4),
    troponin_time timestamp with time zone,
    bnp_value numeric(10,2),
    ecg_rhythm character varying(64),
    ecg_interpretation text,
    st_changes boolean DEFAULT false,
    affected_leads jsonb DEFAULT '[]'::jsonb,
    timi_score integer,
    heart_score integer,
    aspirin_given boolean DEFAULT false,
    heparin_given boolean DEFAULT false,
    cath_lab_activated boolean DEFAULT false,
    pci_performed boolean DEFAULT false,
    disposition character varying(64),
    event_time timestamp with time zone DEFAULT now() NOT NULL,
    performed_by character varying(66) NOT NULL,
    facility_id character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cardiac_events_event_type_check CHECK (((event_type)::text = ANY ((ARRAY['STEMI'::character varying, 'NSTEMI'::character varying, 'UnstableAngina'::character varying, 'StableAngina'::character varying, 'Arrhythmia'::character varying, 'HeartFailure'::character varying, 'Other'::character varying])::text[])))
);

CREATE TABLE care_relationships (
    id text NOT NULL,
    patient_id character varying(64) NOT NULL,
    clinician_id text,
    facility_id text,
    source text NOT NULL,
    source_id text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT care_relationship_ends_after_start CHECK (((ends_at IS NULL) OR (ends_at > starts_at))),
    CONSTRAINT care_relationship_names_someone CHECK (((clinician_id IS NOT NULL) OR (facility_id IS NOT NULL))),
    CONSTRAINT care_relationships_source_check CHECK ((source = ANY (ARRAY['encounter'::text, 'admission'::text, 'referral'::text, 'patient_grant'::text])))
);

CREATE TABLE cds_alerts (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    encounter_id character varying(64),
    provider_id character varying(64) NOT NULL,
    alert_datetime timestamp with time zone DEFAULT now() NOT NULL,
    alert_type character varying(100) NOT NULL,
    alert_category character varying(50) NOT NULL,
    severity character varying(20) NOT NULL,
    alert_title character varying(255) NOT NULL,
    alert_message text NOT NULL,
    clinical_evidence text,
    recommendation text,
    source_system character varying(100),
    rule_id character varying(100),
    rule_version character varying(50),
    trigger_data jsonb,
    related_order_id character varying(64),
    related_medication_id character varying(64),
    related_lab_id character varying(64),
    status character varying(50) DEFAULT 'active'::character varying NOT NULL,
    acknowledged_by character varying(64),
    acknowledged_datetime timestamp with time zone,
    override_reason character varying(255),
    override_justification text,
    action_taken character varying(255),
    action_datetime timestamp with time zone,
    auto_resolved boolean DEFAULT false,
    resolution_reason text,
    was_helpful boolean,
    feedback_notes text,
    displayed_duration_seconds integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE cds_audit_entries (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE cds_rules (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE cds_threshold_configs (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE chain_of_custody (
    id character varying(64) NOT NULL,
    patient_id character varying(64),
    case_number character varying(64),
    evidence_type character varying(64) NOT NULL,
    evidence_description text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_of_measure character varying(32),
    collection_datetime timestamp with time zone NOT NULL,
    collection_location character varying(256),
    collected_by character varying(66) NOT NULL,
    collection_witnessed_by character varying(66),
    collection_method text,
    packaging_description text,
    seal_number character varying(64),
    storage_location character varying(128),
    storage_requirements text,
    current_custodian_id character varying(66) NOT NULL,
    transfers jsonb DEFAULT '[]'::jsonb NOT NULL,
    law_enforcement_agency character varying(128),
    law_enforcement_officer character varying(128),
    law_enforcement_badge character varying(32),
    warrant_number character varying(64),
    court_order_number character varying(64),
    released_to character varying(256),
    release_datetime timestamp with time zone,
    release_authorized_by character varying(66),
    release_documentation text,
    destruction_authorized boolean DEFAULT false NOT NULL,
    destruction_datetime timestamp with time zone,
    destruction_method text,
    destruction_witnessed_by character varying(66),
    status character varying(32) DEFAULT 'in_custody'::character varying NOT NULL,
    photos_taken boolean DEFAULT false NOT NULL,
    photo_references jsonb DEFAULT '[]'::jsonb,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT chain_of_custody_evidence_type_check CHECK (((evidence_type)::text = ANY ((ARRAY['blood_sample'::character varying, 'urine_sample'::character varying, 'clothing'::character varying, 'personal_effects'::character varying, 'weapon'::character varying, 'document'::character varying, 'electronic_device'::character varying, 'biological'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT chain_of_custody_status_check CHECK (((status)::text = ANY ((ARRAY['in_custody'::character varying, 'transferred'::character varying, 'released'::character varying, 'destroyed'::character varying, 'lost'::character varying])::text[])))
);

CREATE TABLE claim_eob_documents (
    id text NOT NULL,
    claim_id text NOT NULL,
    patient_id character varying(64) NOT NULL,
    uploaded_by text NOT NULL,
    filename text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 text NOT NULL,
    ipfs_hash text NOT NULL,
    metadata_hash text NOT NULL,
    scan_status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT claim_eob_documents_content_type_check CHECK ((content_type = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text]))),
    CONSTRAINT claim_eob_documents_filename_check CHECK (((length(filename) >= 1) AND (length(filename) <= 200))),
    CONSTRAINT claim_eob_documents_scan_status_check CHECK ((scan_status = ANY (ARRAY['clean'::text, 'not_scanned'::text]))),
    CONSTRAINT claim_eob_documents_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT claim_eob_documents_size_bytes_check CHECK (((size_bytes > 0) AND (size_bytes <= 10485760)))
);

CREATE TABLE code_blue_records (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    event_time timestamp with time zone NOT NULL,
    response_time_seconds integer,
    duration_minutes integer,
    initial_rhythm character varying(64) NOT NULL,
    witnessed boolean DEFAULT false,
    bystander_cpr boolean DEFAULT false,
    cpr_cycles integer DEFAULT 0,
    defibrillation_count integer DEFAULT 0,
    medications_given jsonb DEFAULT '[]'::jsonb,
    airways_interventions jsonb DEFAULT '[]'::jsonb,
    outcome character varying(32) NOT NULL,
    rosc_time timestamp with time zone,
    team_leader character varying(66),
    team_members jsonb DEFAULT '[]'::jsonb,
    narrative text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(66) NOT NULL,
    facility_id character varying(64),
    CONSTRAINT code_blue_records_outcome_check CHECK (((outcome)::text = ANY ((ARRAY['ROSC'::character varying, 'Expired'::character varying, 'Ongoing'::character varying, 'Transferred'::character varying])::text[])))
);

CREATE TABLE consent_records (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    consent_type character varying(100) NOT NULL,
    consent_given boolean NOT NULL,
    consent_datetime timestamp with time zone NOT NULL,
    expiration_datetime timestamp with time zone,
    scope_description text,
    data_types_covered jsonb,
    purpose character varying(255),
    recipient_organization character varying(255),
    collection_method character varying(50),
    witness_name character varying(255),
    witness_signature character varying(255),
    collector_id character varying(64),
    collector_name character varying(255),
    revoked boolean DEFAULT false,
    revoked_datetime timestamp with time zone,
    revocation_reason text,
    revoked_by character varying(64),
    document_url character varying(500),
    document_ipfs_hash character varying(100),
    regulatory_requirement character varying(100),
    version character varying(50),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    popia_section_11_basis character varying(64) DEFAULT 'consent'::character varying NOT NULL,
    special_information_basis character varying(64) DEFAULT 's32_treatment'::character varying NOT NULL,
    child_information_basis character varying(64) DEFAULT 'not_applicable'::character varying NOT NULL,
    consent_required boolean DEFAULT true NOT NULL,
    consent_status character varying(32) DEFAULT 'granted'::character varying NOT NULL,
    consent_given_by character varying(64),
    consent_giver_capacity character varying(32),
    guardian_authority_evidence_id character varying(64),
    privacy_notice_version character varying(64),
    emergency_basis character varying(32) DEFAULT 'none'::character varying NOT NULL,
    emergency_justification text,
    child_maturity_assessment text,
    child_maturity_assessed_by character varying(64)
);

CREATE TABLE consultation_notes (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    consultation_type character varying(64) NOT NULL,
    requesting_provider character varying(66) NOT NULL,
    consulting_provider character varying(66) NOT NULL,
    reason_for_consultation text NOT NULL,
    clinical_question text,
    pertinent_history text,
    examination_findings text,
    recommendations text NOT NULL,
    follow_up_plan text,
    urgency character varying(16) DEFAULT 'routine'::character varying,
    status character varying(32) DEFAULT 'pending'::character varying,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    facility_id character varying(64),
    is_active boolean DEFAULT true NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT consultation_notes_status_check CHECK (((status)::text = ANY ((ARRAY['requested'::character varying, 'acknowledged'::character varying, 'in-progress'::character varying, 'completed'::character varying, 'declined'::character varying, 'cancelled'::character varying, 'pending'::character varying, 'in_progress'::character varying])::text[]))),
    CONSTRAINT consultation_notes_urgency_check CHECK (((urgency)::text = ANY ((ARRAY['stat'::character varying, 'urgent'::character varying, 'routine'::character varying])::text[])))
);

CREATE TABLE credential_grants (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    purpose text NOT NULL,
    code_hash character(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    revoked_at timestamp with time zone,
    failed_attempts integer DEFAULT 0 NOT NULL,
    issued_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT credential_grants_expiry_after_creation CHECK ((expires_at > created_at)),
    CONSTRAINT credential_grants_failed_attempts_check CHECK ((failed_attempts >= 0)),
    CONSTRAINT credential_grants_purpose_check CHECK ((purpose = ANY (ARRAY['activation'::text, 'reset'::text]))),
    CONSTRAINT credential_grants_spent_or_replaced CHECK (((consumed_at IS NULL) OR (revoked_at IS NULL)))
);

CREATE TABLE critical_values (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    lab_panel_id character varying(64),
    test_code character varying(32) NOT NULL,
    test_name character varying(128) NOT NULL,
    value numeric(12,4) NOT NULL,
    unit character varying(32) NOT NULL,
    reference_low numeric(12,4),
    reference_high numeric(12,4),
    critical_low numeric(12,4),
    critical_high numeric(12,4),
    severity character varying(16) NOT NULL,
    notified_provider_id character varying(66),
    notification_method character varying(32),
    notified_at timestamp with time zone,
    acknowledged_at timestamp with time zone,
    acknowledged_by character varying(66),
    action_taken text,
    reported_by character varying(66) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT critical_values_severity_check CHECK (((severity)::text = ANY ((ARRAY['critical'::character varying, 'panic'::character varying, 'alert'::character varying])::text[])))
);

CREATE TABLE data_retention_policies (
    id character varying(64) NOT NULL,
    policy_name character varying(255) NOT NULL,
    entity_type character varying(100) NOT NULL,
    retention_period_days integer NOT NULL,
    retention_period_type character varying(50),
    archive_after_days integer,
    delete_after_days integer,
    applies_to_status jsonb,
    department character varying(100),
    exceptions jsonb,
    legal_hold_override boolean DEFAULT true,
    regulatory_basis character varying(255),
    review_frequency_days integer DEFAULT 365,
    last_reviewed_date date,
    reviewed_by character varying(64),
    is_active boolean DEFAULT true,
    effective_date date NOT NULL,
    end_date date,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    retention_rule_kind character varying(64) DEFAULT 'years_from_last_entry'::character varying NOT NULL,
    retention_period_years integer,
    minimum_age_years integer,
    legal_source text
);

CREATE TABLE death_certificate_records (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE deletion_register (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    entity_type character varying(100) NOT NULL,
    action character varying(32) NOT NULL,
    policy_id character varying(64),
    policy_name character varying(255),
    basis text NOT NULL,
    approval_token character varying(64),
    executed_by character varying(64) NOT NULL,
    executed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE device_keys (
    id text NOT NULL,
    device_id text NOT NULL,
    key_id text NOT NULL,
    public_key text NOT NULL,
    version integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    valid_from timestamp with time zone,
    valid_until timestamp with time zone,
    replaced_by text,
    revoked_at timestamp with time zone,
    attestation_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_keys_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'retiring'::text, 'retired'::text, 'revoked'::text, 'compromised'::text]))),
    CONSTRAINT device_keys_version_check CHECK ((version > 0))
);

CREATE TABLE device_tokens (
    id character varying(64) NOT NULL,
    user_id character varying(64) NOT NULL,
    token text NOT NULL,
    device_type character varying(50),
    device_name character varying(100),
    last_seen_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE discharge_instructions (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    discharge_summary_id character varying(64),
    visit_date date NOT NULL,
    diagnosis_summary text NOT NULL,
    medications_list jsonb DEFAULT '[]'::jsonb NOT NULL,
    new_medications jsonb DEFAULT '[]'::jsonb,
    stopped_medications jsonb DEFAULT '[]'::jsonb,
    changed_medications jsonb DEFAULT '[]'::jsonb,
    diet_instructions text,
    activity_level character varying(64),
    activity_restrictions jsonb DEFAULT '[]'::jsonb,
    wound_care text,
    follow_up_appointments jsonb DEFAULT '[]'::jsonb NOT NULL,
    return_precautions text NOT NULL,
    emergency_instructions text NOT NULL,
    contact_numbers jsonb NOT NULL,
    patient_education_materials jsonb DEFAULT '[]'::jsonb,
    language character varying(32) DEFAULT 'en'::character varying NOT NULL,
    reading_level character varying(32),
    special_instructions text,
    equipment_needed jsonb DEFAULT '[]'::jsonb,
    home_health_arranged boolean DEFAULT false NOT NULL,
    transportation_arranged boolean DEFAULT false NOT NULL,
    pharmacy_notified boolean DEFAULT false NOT NULL,
    printed_at timestamp with time zone,
    emailed_at timestamp with time zone,
    patient_portal_posted boolean DEFAULT false NOT NULL,
    acknowledged_by_patient boolean DEFAULT false NOT NULL,
    acknowledged_at timestamp with time zone,
    witness_signature character varying(128),
    provided_by character varying(66) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE discharge_summaries (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    encounter_id character varying(64) NOT NULL,
    attending_physician_id character varying(66) NOT NULL,
    admission_datetime timestamp with time zone,
    discharge_datetime timestamp with time zone NOT NULL,
    admission_diagnosis jsonb DEFAULT '[]'::jsonb NOT NULL,
    discharge_diagnosis jsonb DEFAULT '[]'::jsonb NOT NULL,
    principal_diagnosis character varying(256),
    secondary_diagnoses jsonb DEFAULT '[]'::jsonb,
    procedures_performed jsonb DEFAULT '[]'::jsonb,
    hospital_course text NOT NULL,
    condition_at_discharge character varying(64) NOT NULL,
    discharge_disposition character varying(64) NOT NULL,
    discharge_destination character varying(256),
    discharge_medications jsonb DEFAULT '[]'::jsonb NOT NULL,
    medication_changes text,
    follow_up_appointments jsonb DEFAULT '[]'::jsonb,
    follow_up_instructions text,
    diet_instructions text,
    activity_restrictions text,
    wound_care_instructions text,
    warning_signs text,
    pending_results jsonb DEFAULT '[]'::jsonb,
    pending_studies jsonb DEFAULT '[]'::jsonb,
    primary_care_notified boolean DEFAULT false NOT NULL,
    specialist_follow_up jsonb DEFAULT '[]'::jsonb,
    durable_medical_equipment jsonb DEFAULT '[]'::jsonb,
    home_health_orders jsonb,
    physical_therapy_orders jsonb,
    dictated_by character varying(66),
    dictated_at timestamp with time zone,
    transcribed_by character varying(64),
    signed_by character varying(66),
    signed_at timestamp with time zone,
    addendum text,
    addendum_by character varying(66),
    addendum_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT discharge_summaries_condition_at_discharge_check CHECK (((condition_at_discharge)::text = ANY ((ARRAY['stable'::character varying, 'improved'::character varying, 'unchanged'::character varying, 'deteriorated'::character varying, 'deceased'::character varying])::text[]))),
    CONSTRAINT discharge_summaries_discharge_disposition_check CHECK (((discharge_disposition)::text = ANY ((ARRAY['home'::character varying, 'home_health'::character varying, 'snf'::character varying, 'rehab'::character varying, 'ltac'::character varying, 'hospice'::character varying, 'ama'::character varying, 'transfer'::character varying, 'expired'::character varying])::text[])))
);

CREATE TABLE dispense_events (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE drug_interaction_checks (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE e_prescription_v2_records (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE eligibility_checks (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE emergency_access_grants (
    id text NOT NULL,
    patient_id text NOT NULL,
    requesting_person_id text NOT NULL,
    professional_identity_id text,
    organization_id text NOT NULL,
    facility_id text,
    device_id text NOT NULL,
    reason_code text NOT NULL,
    reason_text text,
    scopes jsonb NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    revoked_reason text,
    status text DEFAULT 'active'::text NOT NULL,
    local_audit_id text,
    created_from_card_id text,
    CONSTRAINT emergency_access_grants_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'revoked'::text])))
);

CREATE TABLE emergency_capsule_access_log (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    capsule_version integer,
    accessed_by character varying(64) NOT NULL,
    grant_id character varying(64),
    reason_code character varying(64) NOT NULL,
    reason_text text,
    fields_revealed text[] NOT NULL,
    commitment_verified boolean NOT NULL,
    accessed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE emergency_capsules (
    patient_id character varying(64) NOT NULL,
    version integer NOT NULL,
    commitment character(64) NOT NULL,
    capsule_encrypted bytea NOT NULL,
    key_version integer NOT NULL,
    created_by character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by character varying(64),
    revocation_reason text
);

CREATE TABLE ems_handoffs (
    id character varying(64) NOT NULL,
    patient_id character varying(64),
    receiving_provider_id character varying(66) NOT NULL,
    handoff_datetime timestamp with time zone DEFAULT now() NOT NULL,
    ems_agency character varying(128) NOT NULL,
    ems_unit_number character varying(32),
    crew_members jsonb DEFAULT '[]'::jsonb NOT NULL,
    run_number character varying(64),
    dispatch_time timestamp with time zone,
    on_scene_time timestamp with time zone,
    transport_start_time timestamp with time zone,
    arrival_time timestamp with time zone NOT NULL,
    scene_address text,
    incident_type character varying(64),
    chief_complaint text NOT NULL,
    mechanism_of_injury text,
    patient_found character varying(256),
    mental_status_on_scene character varying(128),
    gcs_on_scene integer,
    vital_signs_on_scene jsonb,
    vital_signs_transport jsonb,
    vital_signs_arrival jsonb,
    interventions_performed jsonb DEFAULT '[]'::jsonb,
    medications_given jsonb DEFAULT '[]'::jsonb,
    iv_access_obtained boolean DEFAULT false NOT NULL,
    iv_details jsonb,
    airway_management character varying(128),
    cpr_performed boolean DEFAULT false NOT NULL,
    aed_used boolean DEFAULT false NOT NULL,
    shocks_delivered integer,
    spinal_immobilization boolean DEFAULT false NOT NULL,
    splinting_performed boolean DEFAULT false NOT NULL,
    tourniquet_applied boolean DEFAULT false NOT NULL,
    bleeding_controlled boolean,
    patient_belongings jsonb DEFAULT '[]'::jsonb,
    family_at_scene boolean DEFAULT false NOT NULL,
    family_contact_info text,
    police_at_scene boolean DEFAULT false NOT NULL,
    police_report_number character varying(64),
    trauma_alert boolean DEFAULT false NOT NULL,
    stroke_alert boolean DEFAULT false NOT NULL,
    stemi_alert boolean DEFAULT false NOT NULL,
    sepsis_alert boolean DEFAULT false NOT NULL,
    report_received_by character varying(66),
    report_received_time timestamp with time zone,
    verbal_report_complete boolean DEFAULT false NOT NULL,
    ems_documentation_received boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE encrypted_document_blobs (
    content_hash text NOT NULL,
    encrypted_bytes bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT encrypted_document_blobs_nonempty CHECK ((octet_length(encrypted_bytes) > 0))
);

CREATE TABLE ep_cardiac_events (
    id text NOT NULL,
    patient_id text NOT NULL,
    record_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ep_code_blue_records (
    id text NOT NULL,
    patient_id text NOT NULL,
    record_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ep_sepsis_assessments (
    id text NOT NULL,
    patient_id text NOT NULL,
    record_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ep_stroke_assessments (
    id text NOT NULL,
    patient_id text NOT NULL,
    record_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ep_trauma_assessments (
    id text NOT NULL,
    patient_id text NOT NULL,
    record_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE facilities (
    id text NOT NULL,
    organization_id text NOT NULL,
    name text NOT NULL,
    facility_type text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    location jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE fall_risk_assessments (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    assessment_tool character varying(32) DEFAULT 'morse'::character varying,
    history_of_falling integer DEFAULT 0,
    secondary_diagnosis integer DEFAULT 0,
    ambulatory_aid integer DEFAULT 0,
    iv_therapy integer DEFAULT 0,
    gait_status integer DEFAULT 0,
    mental_status integer DEFAULT 0,
    total_score integer GENERATED ALWAYS AS ((((((history_of_falling + secondary_diagnosis) + ambulatory_aid) + iv_therapy) + gait_status) + mental_status)) STORED,
    risk_level character varying(16) GENERATED ALWAYS AS (
CASE
    WHEN ((((((history_of_falling + secondary_diagnosis) + ambulatory_aid) + iv_therapy) + gait_status) + mental_status) < 25) THEN 'low'::text
    WHEN ((((((history_of_falling + secondary_diagnosis) + ambulatory_aid) + iv_therapy) + gait_status) + mental_status) < 45) THEN 'moderate'::text
    ELSE 'high'::text
END) STORED,
    additional_factors jsonb DEFAULT '[]'::jsonb,
    interventions jsonb DEFAULT '[]'::jsonb,
    notes text,
    assessed_by character varying(66) NOT NULL,
    assessed_at timestamp with time zone DEFAULT now() NOT NULL,
    next_assessment_due timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    facility_id character varying(64),
    environmental_hazards jsonb DEFAULT '[]'::jsonb NOT NULL,
    medications jsonb DEFAULT '[]'::jsonb NOT NULL,
    recent_fall boolean DEFAULT false NOT NULL,
    mobility character varying(64),
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT fall_risk_assessments_ambulatory_aid_check CHECK ((ambulatory_aid = ANY (ARRAY[0, 15, 30]))),
    CONSTRAINT fall_risk_assessments_assessment_tool_check CHECK (((assessment_tool)::text = ANY ((ARRAY['morse'::character varying, 'hendrich'::character varying, 'stratify'::character varying, 'custom'::character varying])::text[]))),
    CONSTRAINT fall_risk_assessments_gait_status_check CHECK ((gait_status = ANY (ARRAY[0, 10, 20]))),
    CONSTRAINT fall_risk_assessments_history_of_falling_check CHECK ((history_of_falling = ANY (ARRAY[0, 25]))),
    CONSTRAINT fall_risk_assessments_iv_therapy_check CHECK ((iv_therapy = ANY (ARRAY[0, 20]))),
    CONSTRAINT fall_risk_assessments_mental_status_check CHECK ((mental_status = ANY (ARRAY[0, 15]))),
    CONSTRAINT fall_risk_assessments_secondary_diagnosis_check CHECK ((secondary_diagnosis = ANY (ARRAY[0, 15])))
);

CREATE TABLE family_groups (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE family_history_records (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE gcs_assessments (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    eye_response integer NOT NULL,
    verbal_response integer NOT NULL,
    motor_response integer NOT NULL,
    total_score integer GENERATED ALWAYS AS (((eye_response + verbal_response) + motor_response)) STORED,
    interpretation character varying(128) NOT NULL,
    notes text,
    pupil_assessment jsonb,
    assessed_by character varying(66) NOT NULL,
    assessed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    facility_id character varying(64),
    CONSTRAINT gcs_assessments_eye_response_check CHECK (((eye_response >= 1) AND (eye_response <= 4))),
    CONSTRAINT gcs_assessments_motor_response_check CHECK (((motor_response >= 1) AND (motor_response <= 6))),
    CONSTRAINT gcs_assessments_verbal_response_check CHECK (((verbal_response >= 1) AND (verbal_response <= 5)))
);

CREATE TABLE governance_decisions (
    id text NOT NULL,
    decision_type text NOT NULL,
    subject_type text NOT NULL,
    subject_id text NOT NULL,
    proposal_hash text NOT NULL,
    status text NOT NULL,
    required_approvals integer NOT NULL,
    approved_by jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    executed_at timestamp with time zone,
    CONSTRAINT governance_decisions_required_approvals_check CHECK ((required_approvals > 0)),
    CONSTRAINT governance_decisions_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'approved'::text, 'rejected'::text, 'executed'::text, 'cancelled'::text])))
);

CREATE TABLE guardian_relationships (
    id text NOT NULL,
    guardian_user_id text NOT NULL,
    ward_patient_id text NOT NULL,
    relationship_type text NOT NULL,
    permissions text[] DEFAULT '{}'::text[] NOT NULL,
    verified_by text NOT NULL,
    verified_at timestamp with time zone DEFAULT now() NOT NULL,
    active boolean DEFAULT true NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoked_reason text,
    authority_evidence_type text,
    authority_evidence_reference text,
    authority_issuing_authority text,
    authority_verified_by_role text,
    authority_evidence_recorded_at timestamp with time zone,
    next_reverification_due timestamp with time zone,
    child_assent_status text,
    child_assent_recorded_at timestamp with time zone,
    child_assent_notes text,
    supersedes_relationship_id text,
    dispute_flag boolean DEFAULT false NOT NULL,
    dispute_notes text,
    CONSTRAINT guardian_relationships_authority_evidence_type_check CHECK (((authority_evidence_type IS NULL) OR (authority_evidence_type = ANY (ARRAY['birth_certificate'::text, 'court_order'::text, 'adoption_order'::text, 'power_of_attorney_document'::text, 'foster_placement_order'::text, 'affidavit'::text, 'other'::text])))),
    CONSTRAINT guardian_relationships_child_assent_status_check CHECK (((child_assent_status IS NULL) OR (child_assent_status = ANY (ARRAY['not_applicable'::text, 'not_sought'::text, 'given'::text, 'refused'::text, 'unable'::text])))),
    CONSTRAINT guardian_relationships_relationship_type_check CHECK ((relationship_type = ANY (ARRAY['parent_or_guardian'::text, 'legal_proxy'::text, 'power_of_attorney'::text])))
);

CREATE TABLE history_physicals (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    chief_complaint text NOT NULL,
    history_present_illness text NOT NULL,
    past_medical_history text,
    family_history text,
    social_history text,
    medications text,
    allergies text,
    review_of_systems jsonb,
    physical_exam jsonb NOT NULL,
    vital_signs jsonb,
    assessment text NOT NULL,
    plan_content text NOT NULL,
    exam_type character varying(32) DEFAULT 'comprehensive'::character varying,
    performed_by character varying(66) NOT NULL,
    performed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    facility_id character varying(64),
    is_active boolean DEFAULT true NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE idempotency_operations (
    id uuid NOT NULL,
    subject character varying(128) NOT NULL,
    method character varying(10) NOT NULL,
    route text NOT NULL,
    idempotency_key character varying(256) NOT NULL,
    request_digest character(64) NOT NULL,
    state character varying(16) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT idempotency_operations_expiry_after_creation CHECK ((expires_at > created_at)),
    CONSTRAINT idempotency_operations_state CHECK (((state)::text = ANY ((ARRAY['processing'::character varying, 'completed'::character varying])::text[])))
);

CREATE TABLE identity_remap_notes (
    table_name text,
    column_name text,
    value text,
    row_count bigint,
    noted_at timestamp with time zone
);

CREATE TABLE immunization_records (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    vaccine_type character varying(100) NOT NULL,
    vaccine_name character varying(255) NOT NULL,
    manufacturer character varying(255),
    lot_number character varying(100),
    ndc_code character varying(50),
    cvx_code character varying(20),
    mvx_code character varying(20),
    administration_date date NOT NULL,
    administration_time time without time zone,
    administered_by character varying(64),
    administered_by_name character varying(255),
    administration_site character varying(50),
    route character varying(50),
    dose_amount character varying(50),
    dose_unit character varying(20),
    dose_number integer,
    series_complete boolean DEFAULT false,
    facility_id character varying(64),
    facility_name character varying(255),
    facility_address text,
    vfc_eligibility character varying(50),
    funding_source character varying(100),
    information_source character varying(100),
    documentation_type character varying(50),
    reaction_observed boolean DEFAULT false,
    reaction_details text,
    contraindications_reviewed boolean DEFAULT true,
    patient_consent boolean DEFAULT true,
    vis_given boolean DEFAULT true,
    vis_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    data jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE incident_reports (
    id character varying(64) NOT NULL,
    patient_id character varying(64),
    reporter_id character varying(66) NOT NULL,
    incident_datetime timestamp with time zone NOT NULL,
    discovery_datetime timestamp with time zone DEFAULT now() NOT NULL,
    incident_type character varying(64) NOT NULL,
    severity character varying(16) NOT NULL,
    location character varying(128) NOT NULL,
    department character varying(64),
    description text NOT NULL,
    immediate_actions_taken text,
    patient_outcome text,
    patient_notified boolean DEFAULT false NOT NULL,
    patient_notified_by character varying(66),
    family_notified boolean DEFAULT false NOT NULL,
    attending_notified boolean DEFAULT false NOT NULL,
    supervisor_notified boolean DEFAULT false NOT NULL,
    risk_management_notified boolean DEFAULT false NOT NULL,
    witnesses jsonb DEFAULT '[]'::jsonb,
    contributing_factors jsonb DEFAULT '[]'::jsonb,
    root_cause text,
    preventable boolean,
    similar_incidents_prior boolean DEFAULT false NOT NULL,
    corrective_actions jsonb DEFAULT '[]'::jsonb,
    follow_up_required boolean DEFAULT false NOT NULL,
    follow_up_assigned_to character varying(66),
    follow_up_due_date date,
    follow_up_completed boolean DEFAULT false NOT NULL,
    follow_up_completed_at timestamp with time zone,
    investigation_status character varying(32) DEFAULT 'open'::character varying,
    reviewed_by character varying(66),
    reviewed_at timestamp with time zone,
    review_comments text,
    regulatory_reportable boolean DEFAULT false NOT NULL,
    reported_to_agencies jsonb DEFAULT '[]'::jsonb,
    confidential boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT incident_reports_incident_type_check CHECK (((incident_type)::text = ANY ((ARRAY['fall'::character varying, 'medication_error'::character varying, 'adverse_drug_reaction'::character varying, 'equipment_failure'::character varying, 'security'::character varying, 'violence'::character varying, 'elopement'::character varying, 'exposure'::character varying, 'behavioral'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT incident_reports_investigation_status_check CHECK (((investigation_status)::text = ANY ((ARRAY['open'::character varying, 'investigating'::character varying, 'pending_review'::character varying, 'closed'::character varying])::text[]))),
    CONSTRAINT incident_reports_severity_check CHECK (((severity)::text = ANY ((ARRAY['near_miss'::character varying, 'no_harm'::character varying, 'minor'::character varying, 'moderate'::character varying, 'major'::character varying, 'sentinel'::character varying])::text[])))
);

CREATE TABLE insurance_cards (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE insurance_claims (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE insurance_records (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    insurance_type character varying(50) NOT NULL,
    payer_name character varying(255) NOT NULL,
    payer_id character varying(100),
    plan_name character varying(255),
    plan_type character varying(100),
    policy_number character varying(100) NOT NULL,
    group_number character varying(100),
    subscriber_id character varying(100) NOT NULL,
    subscriber_name character varying(255),
    subscriber_relationship character varying(50),
    subscriber_dob date,
    effective_date date NOT NULL,
    termination_date date,
    is_active boolean DEFAULT true NOT NULL,
    copay_amount numeric(10,2),
    deductible_amount numeric(10,2),
    deductible_met numeric(10,2),
    out_of_pocket_max numeric(10,2),
    out_of_pocket_met numeric(10,2),
    coinsurance_percent numeric(5,2),
    coverage_details jsonb,
    prior_auth_required boolean DEFAULT false,
    prior_auth_phone character varying(20),
    claims_address text,
    claims_phone character varying(20),
    claims_fax character varying(20),
    electronic_claims_eligible boolean DEFAULT true,
    verification_status character varying(50) DEFAULT 'pending'::character varying,
    last_verified_date date,
    last_verified_by character varying(64),
    verification_notes text,
    card_front_image_url character varying(500),
    card_back_image_url character varying(500),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    currency character varying(3) DEFAULT 'ZAR'::character varying NOT NULL
);

CREATE TABLE intubation_records (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    indication character varying(128) NOT NULL,
    urgency character varying(32) NOT NULL,
    intubator_id character varying(66) NOT NULL,
    assistant_id character varying(66),
    pre_oxygenation boolean DEFAULT true NOT NULL,
    pre_oxygenation_method character varying(64),
    induction_agents jsonb DEFAULT '[]'::jsonb,
    paralytic_agent character varying(64),
    paralytic_dose character varying(32),
    laryngoscope_type character varying(64),
    blade_size character varying(16),
    ett_size numeric(3,1) NOT NULL,
    ett_depth_cm numeric(4,1),
    cuff_pressure_cmh2o numeric(4,1),
    attempts integer DEFAULT 1 NOT NULL,
    view_grade character varying(8),
    adjuncts_used jsonb DEFAULT '[]'::jsonb,
    difficult_airway boolean DEFAULT false NOT NULL,
    difficult_airway_features jsonb DEFAULT '[]'::jsonb,
    complications jsonb DEFAULT '[]'::jsonb,
    verification_methods jsonb DEFAULT '[]'::jsonb,
    post_intubation_vitals jsonb DEFAULT '{}'::jsonb,
    performed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT intubation_records_urgency_check CHECK (((urgency)::text = ANY ((ARRAY['emergent'::character varying, 'urgent'::character varying, 'elective'::character varying])::text[]))),
    CONSTRAINT intubation_records_view_grade_check CHECK (((view_grade)::text = ANY ((ARRAY['I'::character varying, 'IIa'::character varying, 'IIb'::character varying, 'III'::character varying, 'IV'::character varying])::text[])))
);

CREATE TABLE io_records (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    record_date date NOT NULL,
    shift character varying(16) NOT NULL,
    oral_intake integer DEFAULT 0,
    iv_intake integer DEFAULT 0,
    tube_feeding integer DEFAULT 0,
    other_intake integer DEFAULT 0,
    total_intake integer GENERATED ALWAYS AS ((((oral_intake + iv_intake) + tube_feeding) + other_intake)) STORED,
    urine_output integer DEFAULT 0,
    emesis integer DEFAULT 0,
    drainage integer DEFAULT 0,
    stool integer DEFAULT 0,
    other_output integer DEFAULT 0,
    total_output integer GENERATED ALWAYS AS (((((urine_output + emesis) + drainage) + stool) + other_output)) STORED,
    net_balance integer GENERATED ALWAYS AS (((((oral_intake + iv_intake) + tube_feeding) + other_intake) - ((((urine_output + emesis) + drainage) + stool) + other_output))) STORED,
    intake_items jsonb DEFAULT '[]'::jsonb,
    output_items jsonb DEFAULT '[]'::jsonb,
    notes text,
    recorded_by character varying(66) NOT NULL,
    verified_by character varying(66),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    facility_id character varying(64),
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT io_records_shift_check CHECK (((shift)::text = ANY ((ARRAY['day'::character varying, 'evening'::character varying, 'night'::character varying, '24hr'::character varying])::text[])))
);

CREATE TABLE iv_assessments (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    site_id character varying(64) NOT NULL,
    site_location character varying(64) NOT NULL,
    catheter_type character varying(32),
    catheter_gauge character varying(8),
    insertion_date date,
    patency character varying(16),
    site_appearance character varying(32),
    infiltration_grade integer,
    phlebitis_grade integer,
    current_infusions jsonb DEFAULT '[]'::jsonb,
    dressing_intact boolean DEFAULT true,
    dressing_change_due date,
    pain_level integer,
    notes text,
    actions_taken text,
    site_discontinued boolean DEFAULT false,
    discontinuation_reason text,
    assessed_by character varying(66) NOT NULL,
    assessed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    facility_id character varying(64),
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT iv_assessments_infiltration_grade_check CHECK (((infiltration_grade >= 0) AND (infiltration_grade <= 4))),
    CONSTRAINT iv_assessments_pain_level_check CHECK (((pain_level >= 0) AND (pain_level <= 10))),
    CONSTRAINT iv_assessments_patency_check CHECK (((patency)::text = ANY ((ARRAY['patent'::character varying, 'sluggish'::character varying, 'occluded'::character varying])::text[]))),
    CONSTRAINT iv_assessments_phlebitis_grade_check CHECK (((phlebitis_grade IS NULL) OR ((phlebitis_grade >= 0) AND (phlebitis_grade <= 5))))
);

CREATE TABLE key_envelopes (
    id text NOT NULL,
    record_id text NOT NULL,
    recipient_type text NOT NULL,
    recipient_id text NOT NULL,
    recipient_key_id text NOT NULL,
    wrapping_algorithm text NOT NULL,
    wrapped_dek bytea NOT NULL,
    access_grant_id text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    superseded_by text
);

CREATE TABLE key_usage_index (
    key_id text NOT NULL,
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    envelope_id text,
    active boolean DEFAULT true NOT NULL,
    last_verified_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE lab_calibrations (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE lab_qc_records (
    id character varying(64) NOT NULL,
    instrument_id character varying(64) NOT NULL,
    instrument_name character varying(128) NOT NULL,
    qc_level character varying(32) NOT NULL,
    test_code character varying(32) NOT NULL,
    test_name character varying(128) NOT NULL,
    expected_value numeric(12,4) NOT NULL,
    measured_value numeric(12,4) NOT NULL,
    unit character varying(32) NOT NULL,
    acceptable_range_low numeric(12,4) NOT NULL,
    acceptable_range_high numeric(12,4) NOT NULL,
    passed boolean NOT NULL,
    deviation_percent numeric(8,4),
    corrective_action text,
    performed_by character varying(66) NOT NULL,
    reviewed_by character varying(66),
    performed_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    lot_number character varying(64),
    expiration_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT lab_qc_records_qc_level_check CHECK (((qc_level)::text = ANY ((ARRAY['level1'::character varying, 'level2'::character varying, 'level3'::character varying])::text[])))
);

CREATE TABLE lab_result_submissions (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE lab_submissions (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    ordering_provider_id character varying(66) NOT NULL,
    order_date timestamp with time zone DEFAULT now() NOT NULL,
    priority character varying(32) DEFAULT 'routine'::character varying NOT NULL,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    tests_ordered jsonb DEFAULT '[]'::jsonb NOT NULL,
    clinical_notes text,
    diagnosis_codes jsonb DEFAULT '[]'::jsonb,
    fasting_required boolean DEFAULT false NOT NULL,
    collection_instructions text,
    expected_completion timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lab_submissions_priority_check CHECK (((priority)::text = ANY ((ARRAY['routine'::character varying, 'urgent'::character varying, 'stat'::character varying, 'asap'::character varying])::text[]))),
    CONSTRAINT lab_submissions_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'collected'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[])))
);

CREATE TABLE laceration_repairs (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    location character varying(128) NOT NULL,
    length_cm numeric(5,2) NOT NULL,
    depth_cm numeric(5,2),
    width_cm numeric(5,2),
    mechanism character varying(128),
    contamination_level character varying(32),
    wound_age_hours numeric(5,1),
    tetanus_status character varying(32),
    tetanus_given boolean DEFAULT false,
    anesthesia_type character varying(64) NOT NULL,
    anesthetic_agent character varying(64),
    anesthetic_volume_ml numeric(5,2),
    irrigation_solution character varying(64),
    irrigation_volume_ml integer,
    debridement_performed boolean DEFAULT false NOT NULL,
    closure_technique character varying(64) NOT NULL,
    suture_material character varying(64),
    suture_size character varying(16),
    number_of_sutures integer,
    deep_sutures_placed boolean DEFAULT false,
    skin_adhesive_used boolean DEFAULT false,
    steri_strips_applied boolean DEFAULT false,
    dressing_applied character varying(128),
    complications text,
    aftercare_instructions text,
    follow_up_date date,
    suture_removal_date date,
    performed_by character varying(66) NOT NULL,
    performed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT laceration_repairs_contamination_level_check CHECK (((contamination_level)::text = ANY ((ARRAY['clean'::character varying, 'clean_contaminated'::character varying, 'contaminated'::character varying, 'dirty'::character varying])::text[])))
);

CREATE TABLE language_preferences (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE legal_holds (
    id character varying(64) NOT NULL,
    patient_id character varying(64),
    entity_type character varying(100),
    reason text NOT NULL,
    reference character varying(255),
    applied_by character varying(64) NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    released_by character varying(64),
    released_at timestamp with time zone,
    release_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_legal_hold_scope CHECK (((patient_id IS NOT NULL) OR (entity_type IS NOT NULL)))
);

CREATE TABLE login_contexts (
    id text NOT NULL,
    person_id text NOT NULL,
    context_type text NOT NULL,
    patient_profile_id text,
    organization_assignment_id text,
    device_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    user_id uuid NOT NULL,
    CONSTRAINT login_contexts_check CHECK ((((context_type = 'patient'::text) AND (patient_profile_id IS NOT NULL) AND (organization_assignment_id IS NULL)) OR ((context_type = 'professional'::text) AND (organization_assignment_id IS NOT NULL) AND (patient_profile_id IS NULL)))),
    CONSTRAINT login_contexts_context_type_check CHECK ((context_type = ANY (ARRAY['patient'::text, 'professional'::text])))
);

CREATE TABLE managed_devices (
    id text NOT NULL,
    organization_id text NOT NULL,
    facility_id text,
    device_name text NOT NULL,
    device_type text NOT NULL,
    hardware_fingerprint text,
    platform text,
    ownership text,
    status text DEFAULT 'enrolled'::text NOT NULL,
    compliance_state text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revocation_reason text,
    current_key_id text,
    last_seen_at timestamp with time zone,
    last_rotation_at timestamp with time zone,
    next_rotation_at timestamp with time zone
);

CREATE TABLE mci_records (
    id character varying(64) NOT NULL,
    incident_id character varying(64) NOT NULL,
    incident_name character varying(256) NOT NULL,
    incident_datetime timestamp with time zone NOT NULL,
    incident_location text NOT NULL,
    incident_type character varying(64) NOT NULL,
    activation_level character varying(32) NOT NULL,
    incident_commander character varying(128),
    medical_branch_director character varying(128),
    hospital_incident_command_activated boolean DEFAULT true NOT NULL,
    patient_id character varying(64),
    triage_tag_number character varying(32),
    triage_category character varying(16) NOT NULL,
    start_triage_category character varying(16),
    arrival_datetime timestamp with time zone,
    arrival_mode character varying(32),
    ems_agency character varying(128),
    treatment_area character varying(64),
    injuries jsonb DEFAULT '[]'::jsonb,
    mechanism_of_injury text,
    decontamination_required boolean DEFAULT false NOT NULL,
    decontamination_completed boolean DEFAULT false NOT NULL,
    treatments_provided jsonb DEFAULT '[]'::jsonb,
    disposition character varying(64),
    disposition_datetime timestamp with time zone,
    destination character varying(256),
    family_notified boolean DEFAULT false NOT NULL,
    family_reunification_completed boolean DEFAULT false NOT NULL,
    patient_tracking_updated boolean DEFAULT true NOT NULL,
    media_release_authorized boolean DEFAULT false NOT NULL,
    special_circumstances text,
    created_by character varying(66) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT mci_records_activation_level_check CHECK (((activation_level)::text = ANY ((ARRAY['level_1'::character varying, 'level_2'::character varying, 'level_3'::character varying, 'standby'::character varying, 'deactivated'::character varying])::text[]))),
    CONSTRAINT mci_records_incident_type_check CHECK (((incident_type)::text = ANY ((ARRAY['natural_disaster'::character varying, 'transportation'::character varying, 'industrial'::character varying, 'terrorism'::character varying, 'active_shooter'::character varying, 'hazmat'::character varying, 'pandemic'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT mci_records_triage_category_check CHECK (((triage_category)::text = ANY ((ARRAY['red'::character varying, 'yellow'::character varying, 'green'::character varying, 'black'::character varying, 'white'::character varying])::text[])))
);

CREATE TABLE medical_id_issuances (
    medical_id character varying(32) NOT NULL,
    patient_id character varying(64) NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE medical_records (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    record_type character varying(64) NOT NULL,
    category character varying(64),
    ipfs_content_hash character varying(128),
    ipfs_metadata_hash character varying(128),
    content_checksum character varying(128),
    summary_encrypted bytea,
    record_date timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(66) NOT NULL,
    last_modified_by character varying(66) NOT NULL,
    facility_id character varying(64),
    is_active boolean DEFAULT true NOT NULL,
    is_locked boolean DEFAULT false NOT NULL
);

CREATE TABLE medication_records (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    record_date date NOT NULL,
    scheduled_medications jsonb DEFAULT '[]'::jsonb NOT NULL,
    prn_medications jsonb DEFAULT '[]'::jsonb NOT NULL,
    infusions jsonb DEFAULT '[]'::jsonb NOT NULL,
    completion_status character varying(16) DEFAULT 'pending'::character varying,
    completion_percentage integer DEFAULT 0,
    primary_nurse character varying(66),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    facility_id character varying(64),
    is_active boolean DEFAULT true NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT medication_records_completion_percentage_check CHECK (((completion_percentage >= 0) AND (completion_percentage <= 100))),
    CONSTRAINT medication_records_completion_status_check CHECK (((completion_status)::text = ANY ((ARRAY['pending'::character varying, 'partial'::character varying, 'complete'::character varying])::text[])))
);

CREATE TABLE medication_reminders (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    prescription_id character varying(64),
    medication_name character varying(256) NOT NULL,
    dosage character varying(64),
    scheduled_time time without time zone NOT NULL,
    days_of_week jsonb DEFAULT '["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]'::jsonb NOT NULL,
    reminder_type character varying(32) DEFAULT 'push'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    snooze_minutes integer DEFAULT 10,
    max_snoozes integer DEFAULT 3,
    escalation_contact character varying(128),
    start_date date NOT NULL,
    end_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT medication_reminders_reminder_type_check CHECK (((reminder_type)::text = ANY ((ARRAY['push'::character varying, 'sms'::character varying, 'email'::character varying, 'all'::character varying])::text[])))
);

CREATE TABLE message_attachments (
    id text NOT NULL,
    message_id text NOT NULL,
    uploaded_by text NOT NULL,
    patient_id character varying(64),
    filename text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 text NOT NULL,
    ipfs_hash text NOT NULL,
    metadata_hash text NOT NULL,
    scan_status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT message_attachments_content_type_check CHECK ((content_type = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text]))),
    CONSTRAINT message_attachments_filename_check CHECK (((length(filename) >= 1) AND (length(filename) <= 200))),
    CONSTRAINT message_attachments_scan_status_check CHECK ((scan_status = ANY (ARRAY['clean'::text, 'not_scanned'::text]))),
    CONSTRAINT message_attachments_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT message_attachments_size_bytes_check CHECK (((size_bytes > 0) AND (size_bytes <= 10485760)))
);

CREATE TABLE messages (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE national_id_manual_reviews (
    id text NOT NULL,
    country text NOT NULL,
    national_id_hash text NOT NULL,
    status text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    decided_by text,
    evidence_reference text,
    CONSTRAINT national_id_manual_reviews_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

CREATE TABLE nfc_tags (
    id character varying(64) NOT NULL,
    tag_uid character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    tag_type character varying(32) DEFAULT 'NTAG216'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    pin_hash character varying(128),
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    last_used_at timestamp with time zone,
    use_count integer DEFAULT 0,
    issued_by character varying(66),
    status character varying(16) DEFAULT 'Active'::character varying NOT NULL,
    CONSTRAINT nfc_tags_status_check CHECK (((status)::text = ANY ((ARRAY['Active'::character varying, 'Suspended'::character varying, 'Revoked'::character varying, 'Expired'::character varying])::text[])))
);

CREATE TABLE note_templates (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE notification_reads (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE nursing_care_plans (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    plan_name character varying(128) NOT NULL,
    care_level character varying(32),
    nursing_diagnoses jsonb DEFAULT '[]'::jsonb NOT NULL,
    goals jsonb DEFAULT '[]'::jsonb NOT NULL,
    interventions jsonb DEFAULT '[]'::jsonb NOT NULL,
    evaluation_notes text,
    status character varying(16) DEFAULT 'active'::character varying,
    start_date date NOT NULL,
    target_end_date date,
    actual_end_date date,
    created_by character varying(66) NOT NULL,
    updated_by character varying(66),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    facility_id character varying(64),
    is_active boolean DEFAULT true NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT nursing_care_plans_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'completed'::character varying, 'discontinued'::character varying])::text[])))
);

CREATE TABLE obstetric_emergencies (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    assessed_by character varying(66) NOT NULL,
    assessment_datetime timestamp with time zone DEFAULT now() NOT NULL,
    gestational_age_weeks integer NOT NULL,
    gestational_age_days integer DEFAULT 0,
    gravida integer NOT NULL,
    para integer NOT NULL,
    abortions integer DEFAULT 0,
    living_children integer DEFAULT 0,
    lmp_date date,
    edd_date date,
    prenatal_care boolean DEFAULT true NOT NULL,
    prenatal_care_provider character varying(128),
    pregnancy_complications jsonb DEFAULT '[]'::jsonb,
    chief_complaint text NOT NULL,
    contractions boolean DEFAULT false NOT NULL,
    contraction_frequency_min integer,
    contraction_duration_sec integer,
    rupture_of_membranes boolean DEFAULT false NOT NULL,
    rom_time timestamp with time zone,
    fluid_color character varying(64),
    vaginal_bleeding boolean DEFAULT false NOT NULL,
    bleeding_amount character varying(32),
    cervical_exam_performed boolean DEFAULT false NOT NULL,
    dilation_cm integer,
    effacement_percent integer,
    station integer,
    presentation character varying(64),
    fetal_heart_rate integer,
    fetal_heart_variability character varying(32),
    fetal_decelerations character varying(64),
    uterine_tenderness boolean DEFAULT false NOT NULL,
    fundal_height_cm integer,
    fetal_movement character varying(32),
    emergency_type character varying(64),
    placenta_previa boolean DEFAULT false NOT NULL,
    placental_abruption boolean DEFAULT false NOT NULL,
    cord_prolapse boolean DEFAULT false NOT NULL,
    eclampsia boolean DEFAULT false NOT NULL,
    preeclampsia_severe boolean DEFAULT false NOT NULL,
    blood_pressure_systolic integer,
    blood_pressure_diastolic integer,
    proteinuria character varying(32),
    magnesium_sulfate_given boolean DEFAULT false NOT NULL,
    delivery_imminent boolean DEFAULT false NOT NULL,
    ob_notified boolean DEFAULT false NOT NULL,
    ob_physician_id character varying(66),
    nicu_notified boolean DEFAULT false NOT NULL,
    or_notified boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE operative_notes (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    pre_op_assessment_id character varying(64),
    procedure_name character varying(256) NOT NULL,
    procedure_codes jsonb DEFAULT '[]'::jsonb,
    preoperative_diagnosis text NOT NULL,
    postoperative_diagnosis text NOT NULL,
    surgeon_id character varying(66) NOT NULL,
    assistant_surgeons jsonb DEFAULT '[]'::jsonb,
    anesthesiologist_id character varying(66),
    anesthesia_type character varying(64) NOT NULL,
    scrub_nurse_id character varying(66),
    circulating_nurse_id character varying(66),
    start_time timestamp with time zone,
    end_time timestamp with time zone,
    incision_time timestamp with time zone,
    closure_time timestamp with time zone,
    estimated_blood_loss_ml integer,
    fluids_given_ml integer,
    blood_products_given jsonb DEFAULT '[]'::jsonb,
    specimens_collected jsonb DEFAULT '[]'::jsonb,
    implants_used jsonb DEFAULT '[]'::jsonb,
    drains_placed jsonb DEFAULT '[]'::jsonb,
    operative_findings text,
    procedure_description text NOT NULL,
    complications text,
    disposition character varying(64),
    post_op_orders text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    record_json jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE order_sets (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE organization_assignments (
    id text NOT NULL,
    professional_identity_id text NOT NULL,
    organization_id text NOT NULL,
    facility_id text,
    role text NOT NULL,
    department text,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_until timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL
);

CREATE TABLE organization_keys (
    id text NOT NULL,
    organization_id text NOT NULL,
    facility_id text,
    key_id text NOT NULL,
    version integer NOT NULL,
    purpose text NOT NULL,
    algorithm text NOT NULL,
    public_key text NOT NULL,
    status text NOT NULL,
    proof_of_possession text NOT NULL,
    valid_from timestamp with time zone,
    valid_until timestamp with time zone,
    retired_at timestamp with time zone,
    revoked_at timestamp with time zone,
    replaced_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_keys_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'retiring'::text, 'retired'::text, 'revoked'::text, 'compromised'::text, 'destroyed'::text])))
);

CREATE TABLE organizations (
    id text NOT NULL,
    name text NOT NULL,
    organization_type text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    parent_organization_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    suspended_at timestamp with time zone
);

CREATE TABLE pathology_reports (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    specimen_id character varying(64),
    ordering_provider_id character varying(66) NOT NULL,
    pathologist_id character varying(66) NOT NULL,
    specimen_type character varying(128) NOT NULL,
    specimen_source character varying(128) NOT NULL,
    collection_date timestamp with time zone NOT NULL,
    received_date timestamp with time zone NOT NULL,
    report_date timestamp with time zone DEFAULT now() NOT NULL,
    clinical_history text,
    gross_description text NOT NULL,
    microscopic_description text NOT NULL,
    special_stains jsonb DEFAULT '[]'::jsonb,
    immunohistochemistry jsonb DEFAULT '[]'::jsonb,
    molecular_studies jsonb DEFAULT '[]'::jsonb,
    diagnosis text NOT NULL,
    staging character varying(64),
    tnm_classification jsonb DEFAULT '{}'::jsonb,
    margin_status character varying(64),
    lymph_node_status jsonb DEFAULT '{}'::jsonb,
    comments text,
    addendum text,
    addendum_datetime timestamp with time zone,
    addendum_by character varying(66),
    status character varying(32) DEFAULT 'preliminary'::character varying NOT NULL,
    synoptic_report jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    record_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT pathology_reports_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'preliminary'::character varying, 'final'::character varying, 'amended'::character varying, 'corrected'::character varying, 'received'::character varying, 'grossing'::character varying, 'processing'::character varying, 'embedding'::character varying, 'cutting'::character varying, 'staining'::character varying, 'prelim'::character varying, 'addendum'::character varying])::text[])))
);

CREATE TABLE patient_access_grants (
    id text NOT NULL,
    patient_id text NOT NULL,
    provider_id text NOT NULL,
    provider_name text NOT NULL,
    provider_role text NOT NULL,
    organization text NOT NULL,
    access_type text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    last_accessed timestamp with time zone,
    access_count integer DEFAULT 0 NOT NULL,
    source_request_id text,
    CONSTRAINT patient_access_grants_access_type_check CHECK ((access_type = ANY (ARRAY['full'::text, 'limited'::text, 'emergency'::text]))),
    CONSTRAINT patient_access_grants_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'revoked'::text])))
);

CREATE TABLE patient_access_requests (
    id text NOT NULL,
    patient_id text NOT NULL,
    provider_id text NOT NULL,
    provider_name text NOT NULL,
    provider_role text NOT NULL,
    organization text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    CONSTRAINT patient_access_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text])))
);

CREATE TABLE patient_demographics (
    patient_id character varying(64) NOT NULL,
    full_name character varying(200) NOT NULL,
    date_of_birth date NOT NULL,
    national_id character varying(64) NOT NULL,
    allergies jsonb DEFAULT '[]'::jsonb,
    current_medications jsonb DEFAULT '[]'::jsonb,
    chronic_conditions jsonb DEFAULT '[]'::jsonb,
    emergency_contact_name character varying(200),
    emergency_contact_phone character varying(20),
    languages jsonb DEFAULT '["English"]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE patient_mobile_devices (
    id text NOT NULL,
    patient_id text NOT NULL,
    device_label text NOT NULL,
    platform text NOT NULL,
    public_key text NOT NULL,
    attestation_data jsonb,
    status text DEFAULT 'active'::text NOT NULL,
    last_seen_at timestamp with time zone,
    last_synchronised_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revocation_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT patient_mobile_devices_platform_check CHECK ((platform = ANY (ARRAY['android'::text, 'ios'::text]))),
    CONSTRAINT patient_mobile_devices_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text, 'reinstalled'::text])))
);

CREATE TABLE patient_profiles (
    id text NOT NULL,
    person_id text NOT NULL,
    medical_id text,
    legacy_patient_id text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE patients (
    id character varying(64) NOT NULL,
    health_id character varying(32) NOT NULL,
    national_id_hash character varying(64) NOT NULL,
    national_id_type character varying(32) NOT NULL,
    first_name_encrypted bytea,
    last_name_encrypted bytea,
    date_of_birth_encrypted bytea,
    gender character varying(16),
    blood_type character varying(8),
    phone_encrypted bytea,
    email_encrypted bytea,
    address_encrypted bytea,
    emergency_contact_name_encrypted bytea,
    emergency_contact_phone_encrypted bytea,
    emergency_contact_relationship character varying(64),
    organ_donor boolean DEFAULT false,
    dnr_status boolean DEFAULT false,
    primary_provider_id character varying(66),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    registered_by character varying(66),
    is_verified boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    profile_extras_encrypted bytea,
    dnr_verified_by character varying(64),
    dnr_verified_at timestamp with time zone,
    dnr_document_ref character varying(256),
    key_version integer DEFAULT 1 NOT NULL,
    name_search_tokens text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT patients_blood_type_check CHECK (((blood_type)::text = ANY ((ARRAY['A+'::character varying, 'A-'::character varying, 'B+'::character varying, 'B-'::character varying, 'AB+'::character varying, 'AB-'::character varying, 'O+'::character varying, 'O-'::character varying, 'Unknown'::character varying])::text[]))),
    CONSTRAINT patients_national_id_type_check CHECK (((national_id_type)::text = ANY ((ARRAY['FaydaID'::character varying, 'GhanaCard'::character varying, 'NIN'::character varying, 'SmartID'::character varying])::text[])))
);

CREATE TABLE pediatric_assessments (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    assessed_by character varying(66) NOT NULL,
    assessment_datetime timestamp with time zone DEFAULT now() NOT NULL,
    age_months integer,
    weight_kg numeric(5,2),
    weight_estimated boolean,
    length_cm numeric(5,1),
    head_circumference_cm numeric(4,1),
    broselow_color character varying(32),
    chief_complaint text NOT NULL,
    history_source character varying(64),
    immunizations_up_to_date boolean,
    last_immunization_date date,
    developmental_milestones jsonb,
    developmental_concerns text,
    birth_history jsonb,
    feeding_pattern character varying(128),
    last_feed_time timestamp with time zone,
    wet_diapers_24hr integer,
    activity_level character varying(64),
    pediatric_triangle jsonb,
    appearance_score character varying(32),
    work_of_breathing character varying(32),
    circulation_to_skin character varying(32),
    pain_scale_type character varying(32),
    pain_score integer,
    fontanelle_status character varying(32),
    capillary_refill_seconds numeric(3,1),
    skin_turgor character varying(32),
    mucous_membranes character varying(32),
    parent_guardian_present boolean,
    parent_guardian_name character varying(128),
    parent_guardian_relationship character varying(64),
    child_protective_concerns boolean,
    cps_notified boolean,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE persons (
    id text NOT NULL,
    legal_identity_reference text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid
);

CREATE TABLE pharmacy_decisions (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE physician_orders (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    ordering_provider_id character varying(66) NOT NULL,
    order_datetime timestamp with time zone DEFAULT now() NOT NULL,
    order_type character varying(64) NOT NULL,
    priority character varying(16) DEFAULT 'routine'::character varying NOT NULL,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    order_details jsonb NOT NULL,
    indication text,
    diagnosis_codes jsonb DEFAULT '[]'::jsonb,
    start_datetime timestamp with time zone,
    end_datetime timestamp with time zone,
    frequency character varying(64),
    duration text,
    special_instructions text,
    requires_cosign boolean DEFAULT false NOT NULL,
    cosigned_by character varying(66),
    cosigned_at timestamp with time zone,
    verified_by character varying(66),
    verified_at timestamp with time zone,
    executed_by character varying(66),
    executed_at timestamp with time zone,
    discontinued_by character varying(66),
    discontinued_at timestamp with time zone,
    discontinue_reason text,
    linked_order_id character varying(64),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT physician_orders_order_type_check CHECK (((order_type)::text = ANY ((ARRAY['medication'::character varying, 'lab'::character varying, 'imaging'::character varying, 'procedure'::character varying, 'consult'::character varying, 'nursing'::character varying, 'diet'::character varying, 'activity'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT physician_orders_priority_check CHECK (((priority)::text = ANY ((ARRAY['stat'::character varying, 'asap'::character varying, 'urgent'::character varying, 'routine'::character varying, 'prn'::character varying])::text[]))),
    CONSTRAINT physician_orders_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'active'::character varying, 'completed'::character varying, 'discontinued'::character varying, 'cancelled'::character varying, 'on_hold'::character varying])::text[])))
);

CREATE TABLE post_op_notes (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    operative_note_id character varying(64),
    post_op_day integer DEFAULT 0 NOT NULL,
    note_date timestamp with time zone DEFAULT now() NOT NULL,
    provider_id character varying(66) NOT NULL,
    pain_level integer,
    pain_management text,
    vital_signs jsonb DEFAULT '{}'::jsonb,
    wound_assessment jsonb DEFAULT '{}'::jsonb,
    drain_output jsonb DEFAULT '[]'::jsonb,
    diet_status character varying(64),
    ambulation_status character varying(64),
    voiding_status character varying(64),
    bowel_function character varying(64),
    lab_results_reviewed jsonb DEFAULT '[]'::jsonb,
    complications text,
    plan text,
    discharge_criteria_met boolean DEFAULT false NOT NULL,
    estimated_discharge_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    record_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT post_op_notes_pain_level_check CHECK (((pain_level >= 0) AND (pain_level <= 10)))
);

CREATE TABLE pre_op_assessments (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    procedure_name character varying(256) NOT NULL,
    procedure_code character varying(32),
    scheduled_date timestamp with time zone,
    surgeon_id character varying(66) NOT NULL,
    anesthesiologist_id character varying(66),
    asa_classification character varying(8),
    mallampati_score integer,
    airway_assessment jsonb DEFAULT '{}'::jsonb,
    cardiac_assessment jsonb DEFAULT '{}'::jsonb,
    pulmonary_assessment jsonb DEFAULT '{}'::jsonb,
    renal_assessment jsonb DEFAULT '{}'::jsonb,
    hepatic_assessment jsonb DEFAULT '{}'::jsonb,
    medications_reviewed jsonb DEFAULT '[]'::jsonb,
    allergies_confirmed boolean DEFAULT false NOT NULL,
    npo_status character varying(64),
    labs_reviewed jsonb DEFAULT '[]'::jsonb,
    ekg_reviewed boolean DEFAULT false,
    chest_xray_reviewed boolean DEFAULT false,
    consent_signed boolean DEFAULT false NOT NULL,
    blood_type_confirmed boolean DEFAULT false,
    risk_score numeric(5,2),
    assessment_notes text,
    assessed_by character varying(66) NOT NULL,
    assessed_at timestamp with time zone DEFAULT now() NOT NULL,
    cleared_for_surgery boolean DEFAULT false NOT NULL,
    clearance_conditions text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    record_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT pre_op_assessments_asa_classification_check CHECK (((asa_classification)::text = ANY ((ARRAY['I'::character varying, 'II'::character varying, 'III'::character varying, 'IV'::character varying, 'V'::character varying, 'VI'::character varying, 'I-E'::character varying, 'II-E'::character varying, 'III-E'::character varying, 'IV-E'::character varying, 'V-E'::character varying])::text[]))),
    CONSTRAINT pre_op_assessments_mallampati_score_check CHECK (((mallampati_score >= 1) AND (mallampati_score <= 4)))
);

CREATE TABLE prescription_refill_requests (
    id text NOT NULL,
    prescription_id text NOT NULL,
    patient_id character varying(64) NOT NULL,
    prescriber_id text NOT NULL,
    medication_name text NOT NULL,
    requested_by text NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    patient_note text,
    decided_by text,
    decided_at timestamp with time zone,
    denial_reason text,
    new_prescription_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prescription_refill_requests_denial_reason_check CHECK (((denial_reason IS NULL) OR (length(denial_reason) <= 500))),
    CONSTRAINT prescription_refill_requests_medication_name_check CHECK (((length(medication_name) >= 1) AND (length(medication_name) <= 256))),
    CONSTRAINT prescription_refill_requests_patient_note_check CHECK (((patient_note IS NULL) OR (length(patient_note) <= 500))),
    CONSTRAINT prescription_refill_requests_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'approved'::text, 'denied'::text, 'cancelled'::text]))),
    CONSTRAINT refill_approval_has_prescription CHECK (((status <> 'approved'::text) OR (new_prescription_id IS NOT NULL))),
    CONSTRAINT refill_closed_has_decider CHECK (((status = 'requested'::text) OR ((decided_by IS NOT NULL) AND (decided_at IS NOT NULL)))),
    CONSTRAINT refill_denial_has_reason CHECK (((status <> 'denied'::text) OR (length(btrim(COALESCE(denial_reason, ''::text))) > 0)))
);

CREATE TABLE prescription_verification_events (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE processing_restrictions (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    entity_type character varying(100) NOT NULL,
    reason text NOT NULL,
    policy_id character varying(64),
    approval_token character varying(64),
    restricted_by character varying(64) NOT NULL,
    restricted_at timestamp with time zone DEFAULT now() NOT NULL,
    lifted_by character varying(64),
    lifted_at timestamp with time zone,
    lift_reason text
);

CREATE TABLE professional_identities (
    id text NOT NULL,
    person_id text NOT NULL,
    professional_registration text,
    profession text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE progress_notes (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    note_type character varying(64) NOT NULL,
    subjective text,
    objective text,
    assessment text,
    plan_content text,
    addendum text,
    cosigned_by character varying(66),
    cosigned_at timestamp with time zone,
    visit_type character varying(32),
    encounter_id character varying(64),
    created_by character varying(66) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    facility_id character varying(64),
    status character varying(32) DEFAULT 'draft'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT progress_notes_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'final'::character varying, 'amended'::character varying, 'deleted'::character varying])::text[])))
);

CREATE TABLE protected_mobile_record_sessions (
    id text NOT NULL,
    patient_id text NOT NULL,
    device_id text NOT NULL,
    record_id text NOT NULL,
    encrypted_content_reference text NOT NULL,
    watermark_text text,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    revoke_reason text,
    status text DEFAULT 'active'::text NOT NULL,
    export_allowed boolean DEFAULT false NOT NULL,
    offline_allowed boolean DEFAULT false NOT NULL,
    CONSTRAINT protected_mobile_record_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'revoked'::text])))
);

CREATE TABLE provider_schedules (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE psychiatric_assessments (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    assessed_by character varying(66) NOT NULL,
    assessment_datetime timestamp with time zone DEFAULT now() NOT NULL,
    chief_complaint text NOT NULL,
    presenting_symptoms jsonb DEFAULT '[]'::jsonb NOT NULL,
    psychiatric_history text,
    previous_hospitalizations jsonb DEFAULT '[]'::jsonb,
    current_medications jsonb DEFAULT '[]'::jsonb,
    substance_use jsonb,
    suicidal_ideation boolean,
    suicidal_plan boolean,
    suicidal_intent boolean,
    suicidal_means_access boolean,
    homicidal_ideation boolean,
    homicidal_target character varying(256),
    safety_plan text,
    mental_status_exam jsonb NOT NULL,
    appearance character varying(256),
    behavior character varying(256),
    speech character varying(256),
    mood character varying(128),
    affect character varying(128),
    thought_process character varying(256),
    thought_content text,
    perceptions text,
    cognition character varying(256),
    insight character varying(128),
    judgment character varying(128),
    risk_level character varying(32),
    disposition character varying(64),
    involuntary_hold boolean,
    hold_type character varying(64),
    sitter_required boolean,
    one_to_one_observation boolean,
    psychiatry_consulted boolean,
    psychiatrist_id character varying(66),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT psychiatric_assessments_risk_level_check CHECK (((risk_level)::text = ANY ((ARRAY['low'::character varying, 'moderate'::character varying, 'high'::character varying, 'imminent'::character varying])::text[])))
);

CREATE TABLE radiology_orders (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    ordering_provider_id character varying(66) NOT NULL,
    modality character varying(32) NOT NULL,
    study_type character varying(128) NOT NULL,
    body_part character varying(128) NOT NULL,
    laterality character varying(16),
    priority character varying(32) DEFAULT 'routine'::character varying NOT NULL,
    status character varying(32) DEFAULT 'ordered'::character varying NOT NULL,
    clinical_indication text NOT NULL,
    diagnosis_codes jsonb DEFAULT '[]'::jsonb,
    contrast_required boolean DEFAULT false,
    contrast_type character varying(64),
    sedation_required boolean DEFAULT false,
    patient_prep_instructions text,
    special_instructions text,
    scheduled_datetime timestamp with time zone,
    completed_datetime timestamp with time zone,
    performing_technologist_id character varying(66),
    accession_number character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    record_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT radiology_orders_laterality_check CHECK (((laterality)::text = ANY ((ARRAY['left'::character varying, 'right'::character varying, 'bilateral'::character varying, 'na'::character varying])::text[]))),
    CONSTRAINT radiology_orders_modality_check CHECK (((modality)::text = ANY ((ARRAY['xray'::character varying, 'ct'::character varying, 'mri'::character varying, 'ultrasound'::character varying, 'pet'::character varying, 'nuclear'::character varying, 'fluoroscopy'::character varying, 'mammography'::character varying, 'dexa'::character varying, 'angiography'::character varying])::text[]))),
    CONSTRAINT radiology_orders_priority_check CHECK (((priority)::text = ANY ((ARRAY['routine'::character varying, 'urgent'::character varying, 'stat'::character varying, 'asap'::character varying, 'scheduled'::character varying, 'prn'::character varying])::text[]))),
    CONSTRAINT radiology_orders_status_check CHECK (((status)::text = ANY ((ARRAY['ordered'::character varying, 'scheduled'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'preliminary'::character varying, 'final'::character varying, 'cancelled'::character varying])::text[])))
);

CREATE TABLE radiology_reports (
    id character varying(64) NOT NULL,
    order_id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    radiologist_id character varying(66) NOT NULL,
    study_datetime timestamp with time zone,
    report_datetime timestamp with time zone DEFAULT now() NOT NULL,
    comparison_studies text,
    technique text,
    findings text NOT NULL,
    impression text NOT NULL,
    recommendations text,
    critical_finding boolean DEFAULT false NOT NULL,
    critical_finding_communicated boolean DEFAULT false,
    communicated_to character varying(66),
    communicated_at timestamp with time zone,
    communication_method character varying(32),
    addendum text,
    addendum_datetime timestamp with time zone,
    addendum_by character varying(66),
    status character varying(32) DEFAULT 'preliminary'::character varying NOT NULL,
    image_count integer,
    pacs_study_uid character varying(128),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    record_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT radiology_reports_status_check CHECK (((status)::text = ANY ((ARRAY['preliminary'::character varying, 'final'::character varying, 'amended'::character varying, 'corrected'::character varying, 'addendum'::character varying])::text[])))
);

CREATE TABLE record_crypto_metadata (
    record_id text NOT NULL,
    patient_id text NOT NULL,
    origin_organization_id text NOT NULL,
    origin_facility_id text,
    crypto_profile text NOT NULL,
    content_algorithm text NOT NULL,
    nonce bytea NOT NULL,
    aad_version integer DEFAULT 1 NOT NULL,
    ciphertext_uri text NOT NULL,
    ciphertext_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE research_export_runs (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE retention_approvals (
    token character varying(64) NOT NULL,
    assessment_digest character(64) NOT NULL,
    assessed_on date NOT NULL,
    due_count integer NOT NULL,
    requested_by character varying(64) NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    approved_by character varying(64),
    approved_at timestamp with time zone,
    executed_by character varying(64),
    executed_at timestamp with time zone,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    rejection_reason text
);

CREATE TABLE retention_job_runs (
    id character varying(64) NOT NULL,
    policy_id character varying(64),
    job_type character varying(50) NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    entity_type character varying(100) NOT NULL,
    date_threshold date NOT NULL,
    status character varying(50) DEFAULT 'running'::character varying,
    records_evaluated integer DEFAULT 0,
    records_archived integer DEFAULT 0,
    records_deleted integer DEFAULT 0,
    records_skipped integer DEFAULT 0,
    error_count integer DEFAULT 0,
    error_details jsonb DEFAULT '[]'::jsonb,
    run_by character varying(64),
    dry_run boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE satisfaction_surveys (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE scanner_settings (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE security_alerts (
    id text NOT NULL,
    kind text NOT NULL,
    severity text NOT NULL,
    actor text,
    message text NOT NULL,
    notify_deadline timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE sepsis_assessments (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    temperature numeric(4,1),
    heart_rate integer,
    respiratory_rate integer,
    wbc_count numeric(6,2),
    sirs_criteria_met integer DEFAULT 0,
    altered_mental_status boolean DEFAULT false,
    systolic_bp integer,
    qsofa_score integer,
    sofa_score integer,
    sofa_components jsonb,
    sepsis_level character varying(32),
    suspected_source character varying(64),
    confirmed_source character varying(64),
    lactate_value numeric(4,2),
    procalcitonin numeric(6,2),
    blood_cultures_drawn boolean DEFAULT false,
    antibiotics_given boolean DEFAULT false,
    antibiotic_time timestamp with time zone,
    fluid_bolus_given boolean DEFAULT false,
    fluid_volume_ml integer,
    vasopressors_started boolean DEFAULT false,
    disposition character varying(64),
    assessment_time timestamp with time zone DEFAULT now() NOT NULL,
    performed_by character varying(66) NOT NULL,
    facility_id character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sepsis_assessments_qsofa_score_check CHECK (((qsofa_score >= 0) AND (qsofa_score <= 3))),
    CONSTRAINT sepsis_assessments_sepsis_level_check CHECK (((sepsis_level)::text = ANY ((ARRAY['SIRS'::character varying, 'Sepsis'::character varying, 'SevereSepsis'::character varying, 'SepticShock'::character varying])::text[])))
);

CREATE TABLE shift_handoffs (
    id character varying(128) NOT NULL,
    patient_id character varying(64) NOT NULL,
    outgoing_provider_id character varying(66) NOT NULL,
    incoming_provider_id character varying(66) NOT NULL,
    handoff_datetime timestamp with time zone DEFAULT now() NOT NULL,
    handoff_type character varying(32) NOT NULL,
    location_from character varying(128),
    location_to character varying(128),
    situation text NOT NULL,
    background text NOT NULL,
    assessment text NOT NULL,
    recommendation text NOT NULL,
    pending_tasks jsonb DEFAULT '[]'::jsonb NOT NULL,
    pending_results jsonb DEFAULT '[]'::jsonb,
    pending_consults jsonb DEFAULT '[]'::jsonb,
    critical_values jsonb DEFAULT '[]'::jsonb,
    code_status character varying(32),
    isolation_precautions jsonb DEFAULT '[]'::jsonb,
    fall_risk_level character varying(16),
    skin_integrity_issues jsonb DEFAULT '[]'::jsonb,
    iv_access jsonb DEFAULT '[]'::jsonb,
    drains_tubes jsonb DEFAULT '[]'::jsonb,
    family_concerns text,
    anticipated_disposition character varying(64),
    contingency_plans text,
    questions_asked jsonb DEFAULT '[]'::jsonb,
    read_back_confirmed boolean DEFAULT false NOT NULL,
    acknowledged_by_incoming boolean DEFAULT false NOT NULL,
    acknowledged_at timestamp with time zone,
    handoff_tool_used character varying(32) DEFAULT 'sbar'::character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT shift_handoffs_handoff_type_check CHECK (((handoff_type)::text = ANY ((ARRAY['shift_change'::character varying, 'transfer'::character varying, 'procedure'::character varying, 'break_coverage'::character varying, 'escalation'::character varying])::text[])))
);

CREATE TABLE sms_opt_outs (
    phone_number character varying(32) NOT NULL,
    opted_out_at timestamp with time zone DEFAULT now(),
    source character varying(50),
    reason text
);

CREATE TABLE soap_note_records (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE soap_notes (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    subjective text NOT NULL,
    objective text NOT NULL,
    assessment text NOT NULL,
    plan text NOT NULL,
    encounter_type character varying(64),
    visit_date timestamp with time zone DEFAULT now() NOT NULL,
    icd10_codes jsonb DEFAULT '[]'::jsonb,
    addenda jsonb DEFAULT '[]'::jsonb,
    is_signed boolean DEFAULT false,
    signed_at timestamp with time zone,
    signed_by character varying(66),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(66) NOT NULL,
    facility_id character varying(64)
);

CREATE TABLE specimen_collections (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    submission_id character varying(64) NOT NULL,
    specimen_type character varying(64) NOT NULL,
    collection_site character varying(128),
    collection_method character varying(64),
    collector_id character varying(66) NOT NULL,
    collected_at timestamp with time zone DEFAULT now() NOT NULL,
    received_at timestamp with time zone,
    received_by character varying(66),
    container_type character varying(64),
    volume_ml numeric(8,2),
    temperature_c numeric(5,2),
    condition character varying(32) DEFAULT 'acceptable'::character varying,
    barcode character varying(64),
    storage_location character varying(128),
    chain_of_custody jsonb DEFAULT '[]'::jsonb,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT specimen_collections_condition_check CHECK (((condition)::text = ANY ((ARRAY['acceptable'::character varying, 'hemolyzed'::character varying, 'lipemic'::character varying, 'icteric'::character varying, 'clotted'::character varying, 'insufficient'::character varying])::text[])))
);

CREATE TABLE specimen_recollection_requests (
    id character varying(64) NOT NULL,
    rejection_id character varying(64) NOT NULL,
    original_specimen_id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    ordering_provider_id character varying(64),
    requested_by character varying(64) NOT NULL,
    reason text NOT NULL,
    status character varying(32) DEFAULT 'requested'::character varying NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    replacement_specimen_id character varying(64),
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancellation_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recollection_cancellation_is_whole CHECK (((((status)::text = 'cancelled'::text) AND (cancelled_at IS NOT NULL) AND (cancellation_reason IS NOT NULL)) OR (((status)::text <> 'cancelled'::text) AND (cancelled_at IS NULL) AND (cancellation_reason IS NULL)))),
    CONSTRAINT recollection_completion_is_whole CHECK (((((status)::text = 'collected'::text) AND (replacement_specimen_id IS NOT NULL) AND (completed_at IS NOT NULL)) OR (((status)::text <> 'collected'::text) AND (replacement_specimen_id IS NULL) AND (completed_at IS NULL)))),
    CONSTRAINT specimen_recollection_requests_status_check CHECK (((status)::text = ANY ((ARRAY['requested'::character varying, 'collected'::character varying, 'cancelled'::character varying])::text[])))
);

CREATE TABLE specimen_rejections (
    id character varying(64) NOT NULL,
    specimen_id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    rejection_reason character varying(128) NOT NULL,
    rejection_category character varying(64) NOT NULL,
    detailed_notes text,
    rejected_by character varying(66) NOT NULL,
    rejected_at timestamp with time zone DEFAULT now() NOT NULL,
    recollection_required boolean DEFAULT true NOT NULL,
    recollection_scheduled timestamp with time zone,
    notified_ordering_provider boolean DEFAULT false NOT NULL,
    notification_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT specimen_rejections_rejection_category_check CHECK (((rejection_category)::text = ANY ((ARRAY['collection_error'::character varying, 'transport_error'::character varying, 'labeling_error'::character varying, 'specimen_quality'::character varying, 'container_issue'::character varying, 'other'::character varying])::text[])))
);

CREATE TABLE splint_cast_records (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    injury_type character varying(128) NOT NULL,
    injury_location character varying(128) NOT NULL,
    laterality character varying(16),
    fracture_type character varying(64),
    immobilization_type character varying(32) NOT NULL,
    material character varying(64) NOT NULL,
    "position" character varying(64),
    padding_type character varying(64),
    neurovascular_check_pre jsonb DEFAULT '{}'::jsonb,
    neurovascular_check_post jsonb DEFAULT '{}'::jsonb,
    xray_pre boolean DEFAULT false,
    xray_post boolean DEFAULT false,
    reduction_performed boolean DEFAULT false,
    reduction_technique character varying(128),
    anesthesia_type character varying(64),
    complications text,
    weight_bearing_status character varying(64),
    elevation_instructions boolean DEFAULT true,
    ice_instructions boolean DEFAULT true,
    follow_up_date date,
    follow_up_provider character varying(64),
    removal_date date,
    applied_by character varying(66) NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT splint_cast_records_immobilization_type_check CHECK (((immobilization_type)::text = ANY ((ARRAY['splint'::character varying, 'cast'::character varying, 'brace'::character varying, 'sling'::character varying, 'boot'::character varying])::text[]))),
    CONSTRAINT splint_cast_records_laterality_check CHECK (((laterality)::text = ANY ((ARRAY['left'::character varying, 'right'::character varying, 'bilateral'::character varying])::text[])))
);

CREATE TABLE stroke_assessments (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    symptom_onset_time timestamp with time zone,
    last_known_well timestamp with time zone,
    onset_witnessed boolean DEFAULT false,
    nihss_score integer,
    nihss_components jsonb,
    facial_droop boolean,
    arm_weakness boolean,
    speech_difficulty boolean,
    stroke_type character varying(32),
    ct_performed boolean DEFAULT false,
    ct_time timestamp with time zone,
    ct_findings text,
    large_vessel_occlusion boolean,
    tpa_candidate boolean DEFAULT false,
    tpa_given boolean DEFAULT false,
    tpa_time timestamp with time zone,
    thrombectomy_candidate boolean DEFAULT false,
    bp_systolic integer,
    bp_diastolic integer,
    blood_glucose double precision,
    disposition character varying(64),
    assessment_time timestamp with time zone DEFAULT now() NOT NULL,
    performed_by character varying(66) NOT NULL,
    facility_id character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stroke_assessments_nihss_score_check CHECK (((nihss_score >= 0) AND (nihss_score <= 42))),
    CONSTRAINT stroke_assessments_stroke_type_check CHECK (((stroke_type)::text = ANY ((ARRAY['Ischemic'::character varying, 'Hemorrhagic'::character varying, 'TIA'::character varying, 'Unknown'::character varying])::text[])))
);

CREATE TABLE symptom_entries (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE symptom_sessions (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE sync_conflicts (
    id character varying(64) NOT NULL,
    sync_operation_id character varying(64),
    entity_type character varying(100) NOT NULL,
    entity_id character varying(64) NOT NULL,
    patient_id character varying(64),
    conflict_type character varying(50) NOT NULL,
    field_name character varying(100),
    local_value text,
    remote_value text,
    local_timestamp timestamp with time zone,
    remote_timestamp timestamp with time zone,
    local_version integer,
    remote_version integer,
    status character varying(50) DEFAULT 'pending'::character varying,
    resolution_strategy character varying(50),
    resolved_value text,
    resolved_by character varying(64),
    resolved_at timestamp with time zone,
    resolution_notes text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE sync_devices (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE sync_queue_items (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE telehealth_recordings (
    id text NOT NULL,
    session_id text NOT NULL,
    patient_id character varying(64) NOT NULL,
    provider_id text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 text NOT NULL,
    ipfs_hash text NOT NULL,
    metadata_hash text NOT NULL,
    provider_consented_at timestamp with time zone NOT NULL,
    patient_consented_at timestamp with time zone NOT NULL,
    recording_started_at timestamp with time zone NOT NULL,
    retention_entity_type text DEFAULT 'clinical_record'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT telehealth_recording_consent_precedes_start CHECK (((provider_consented_at <= recording_started_at) AND (patient_consented_at <= recording_started_at))),
    CONSTRAINT telehealth_recordings_content_type_check CHECK ((content_type = ANY (ARRAY['video/mp4'::text, 'video/webm'::text]))),
    CONSTRAINT telehealth_recordings_retention_entity_type_check CHECK ((retention_entity_type = ANY (ARRAY['clinical_record'::text, 'clinical_record_minor'::text]))),
    CONSTRAINT telehealth_recordings_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT telehealth_recordings_size_bytes_check CHECK (((size_bytes > 0) AND (size_bytes <= 268435456)))
);

CREATE TABLE telehealth_session_records (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE toxicology_assessments (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    assessed_by character varying(66) NOT NULL,
    assessment_datetime timestamp with time zone DEFAULT now() NOT NULL,
    exposure_type character varying(64) NOT NULL,
    intentionality character varying(32) NOT NULL,
    substances jsonb DEFAULT '[]'::jsonb NOT NULL,
    time_of_exposure timestamp with time zone,
    amount_if_known text,
    route_of_exposure character varying(64),
    symptoms jsonb DEFAULT '[]'::jsonb NOT NULL,
    vital_signs_on_arrival jsonb,
    mental_status character varying(128),
    pupil_size character varying(32),
    pupil_reactivity character varying(32),
    skin_findings text,
    toxidrome character varying(64),
    decontamination_performed boolean DEFAULT false NOT NULL,
    decontamination_type character varying(128),
    antidote_given boolean DEFAULT false NOT NULL,
    antidote_name character varying(128),
    antidote_dose character varying(64),
    activated_charcoal boolean DEFAULT false NOT NULL,
    whole_bowel_irrigation boolean DEFAULT false NOT NULL,
    enhanced_elimination boolean DEFAULT false NOT NULL,
    elimination_method character varying(128),
    poison_control_called boolean DEFAULT false NOT NULL,
    poison_control_case_number character varying(64),
    lab_results jsonb,
    drug_screen_results jsonb,
    serum_levels jsonb,
    disposition character varying(64),
    icu_admission boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT toxicology_assessments_exposure_type_check CHECK (((exposure_type)::text = ANY ((ARRAY['ingestion'::character varying, 'inhalation'::character varying, 'injection'::character varying, 'dermal'::character varying, 'ocular'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT toxicology_assessments_intentionality_check CHECK (((intentionality)::text = ANY ((ARRAY['accidental'::character varying, 'intentional'::character varying, 'therapeutic_error'::character varying, 'unknown'::character varying])::text[])))
);

CREATE TABLE transfusion_event_records (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE trauma_assessments (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    trauma_type character varying(64) NOT NULL,
    mechanism_of_injury text NOT NULL,
    trauma_level integer,
    airway_status character varying(64),
    breathing_status character varying(64),
    circulation_status character varying(64),
    disability_status character varying(64),
    exposure_notes text,
    gcs_score integer,
    iss_score integer,
    rts_score numeric(4,2),
    injuries jsonb DEFAULT '[]'::jsonb,
    interventions jsonb DEFAULT '[]'::jsonb,
    disposition character varying(64),
    additional_notes text,
    assessment_time timestamp with time zone DEFAULT now() NOT NULL,
    performed_by character varying(66) NOT NULL,
    facility_id character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trauma_assessments_gcs_score_check CHECK (((gcs_score >= 3) AND (gcs_score <= 15))),
    CONSTRAINT trauma_assessments_trauma_level_check CHECK (((trauma_level >= 1) AND (trauma_level <= 3)))
);

CREATE TABLE triage_assessments (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    esi_level integer NOT NULL,
    chief_complaint text NOT NULL,
    heart_rate integer,
    respiratory_rate integer,
    blood_pressure_systolic integer,
    blood_pressure_diastolic integer,
    temperature numeric(4,1),
    oxygen_saturation integer,
    pain_scale integer,
    gcs_score integer,
    blood_glucose double precision,
    weight numeric(5,1),
    is_critical boolean DEFAULT false,
    requires_isolation boolean DEFAULT false,
    disposition character varying(64),
    assigned_bed character varying(32),
    triage_time timestamp with time zone DEFAULT now() NOT NULL,
    seen_by_provider_at timestamp with time zone,
    performed_by character varying(66) NOT NULL,
    facility_id character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    CONSTRAINT triage_assessments_esi_level_check CHECK (((esi_level >= 1) AND (esi_level <= 5))),
    CONSTRAINT triage_assessments_gcs_score_check CHECK (((gcs_score >= 3) AND (gcs_score <= 15))),
    CONSTRAINT triage_assessments_pain_scale_check CHECK (((pain_scale >= 0) AND (pain_scale <= 10)))
);

CREATE TABLE used_emergency_tokens (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE user_avatars (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE user_mfa (
    secret_encrypted bytea NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid NOT NULL,
    last_used_step bigint
);

CREATE TABLE user_profiles (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid,
    first_name character varying(100),
    last_name character varying(100),
    date_of_birth date,
    phone character varying(20),
    address_line1 character varying(200),
    address_line2 character varying(200),
    city character varying(100),
    state character varying(100),
    postal_code character varying(20),
    country character varying(100) DEFAULT 'South Africa'::character varying,
    license_number character varying(50),
    specialty character varying(100),
    department character varying(100),
    preferences jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    contact_encrypted bytea,
    contact_key_version integer DEFAULT 1 NOT NULL
);

CREATE TABLE user_setting_records (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE users (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    email character varying(255),
    password_hash character varying(255),
    role character varying(20) NOT NULL,
    name character varying(200),
    username character varying(100),
    linked_patient_id character varying(50),
    is_active boolean DEFAULT true,
    email_verified boolean DEFAULT false,
    last_login_at timestamp with time zone,
    login_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by character varying(66),
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    login_id character varying(64),
    credential_verifier text,
    credential_updated_at timestamp with time zone,
    id_text text GENERATED ALWAYS AS ((id)::text) STORED,
    CONSTRAINT users_credential_needs_handle CHECK (((credential_verifier IS NULL) OR (login_id IS NOT NULL) OR (email IS NOT NULL))),
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['Patient'::character varying, 'Doctor'::character varying, 'Nurse'::character varying, 'Admin'::character varying, 'LabTechnician'::character varying, 'Pharmacist'::character varying, 'Receptionist'::character varying, 'Paramedic'::character varying])::text[]))),
    CONSTRAINT users_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying, 'suspended'::character varying, 'pending'::character varying])::text[]))),
    CONSTRAINT users_status_is_active_agree CHECK ((is_active = ((status)::text = 'active'::text)))
);

CREATE VIEW v_active_cds_alerts AS
 SELECT id,
    patient_id,
    provider_id,
    alert_datetime,
    alert_type,
    alert_category,
    severity,
    alert_title,
    alert_message,
    recommendation,
    related_order_id,
    related_medication_id,
    (EXTRACT(epoch FROM (now() - alert_datetime)) / (60)::numeric) AS minutes_since_alert
   FROM cds_alerts ca
  WHERE ((status)::text = 'active'::text)
  ORDER BY
        CASE severity
            WHEN 'critical'::text THEN 1
            WHEN 'warning'::text THEN 2
            ELSE 3
        END, alert_datetime DESC;

CREATE VIEW v_active_consents AS
 SELECT id,
    patient_id,
    consent_type,
    consent_given,
    consent_datetime,
    expiration_datetime,
    scope_description,
    data_types_covered,
    purpose,
    recipient_organization,
    collection_method,
    witness_name,
    witness_signature,
    collector_id,
    collector_name,
    revoked,
    revoked_datetime,
    revocation_reason,
    revoked_by,
    document_url,
    document_ipfs_hash,
    regulatory_requirement,
    version,
    created_at,
    updated_at
   FROM consent_records
  WHERE ((revoked = false) AND ((expiration_datetime IS NULL) OR (expiration_datetime > now())));

CREATE VIEW v_active_insurance AS
 SELECT id,
    patient_id,
    insurance_type,
    payer_name,
    plan_name,
    policy_number,
    subscriber_id,
    effective_date,
    termination_date,
    copay_amount,
    deductible_amount,
    deductible_met,
    verification_status,
    last_verified_date,
        CASE
            WHEN ((termination_date IS NOT NULL) AND (termination_date < (CURRENT_DATE + '30 days'::interval))) THEN true
            ELSE false
        END AS expiring_soon
   FROM insurance_records ir
  WHERE ((is_active = true) AND ((termination_date IS NULL) OR (termination_date >= CURRENT_DATE)))
  ORDER BY
        CASE insurance_type
            WHEN 'primary'::text THEN 1
            WHEN 'secondary'::text THEN 2
            WHEN 'tertiary'::text THEN 3
            ELSE 4
        END;

CREATE VIEW v_active_nursing_care_plans AS
 SELECT ncp.patient_id,
    p.health_id,
    ncp.plan_name,
    ncp.care_level,
    ncp.status,
    ncp.start_date,
    ncp.target_end_date,
    u.name AS created_by_name,
    ncp.created_at
   FROM ((nursing_care_plans ncp
     JOIN patients p ON (((ncp.patient_id)::text = (p.id)::text)))
     LEFT JOIN users u ON (((ncp.created_by)::text = u.id_text)))
  WHERE (((ncp.status)::text = 'active'::text) AND (ncp.is_active = true))
  ORDER BY ncp.start_date DESC;

CREATE VIEW v_active_users AS
 SELECT u.id,
    u.email,
    u.role,
    u.name,
    u.username,
    u.is_active,
    u.created_at,
    u.last_login_at,
    u.login_count,
    p.first_name,
    p.last_name,
    p.specialty,
    p.department,
    p.phone,
    p.license_number
   FROM (users u
     LEFT JOIN user_profiles p ON ((u.id = p.user_id)))
  WHERE (u.is_active = true);

CREATE VIEW v_critical_patients AS
 SELECT p.id AS patient_id,
    p.health_id,
    'Triage'::text AS source,
    t.esi_level AS severity,
    t.chief_complaint AS reason,
    t.triage_time AS event_time
   FROM (triage_assessments t
     JOIN patients p ON (((t.patient_id)::text = (p.id)::text)))
  WHERE ((t.is_critical = true) AND (t.triage_time > (now() - '24:00:00'::interval)))
UNION ALL
 SELECT p.id AS patient_id,
    p.health_id,
    'Sepsis'::text AS source,
        CASE s.sepsis_level
            WHEN 'SepticShock'::text THEN 1
            WHEN 'SevereSepsis'::text THEN 2
            ELSE 3
        END AS severity,
    s.sepsis_level AS reason,
    s.assessment_time AS event_time
   FROM (sepsis_assessments s
     JOIN patients p ON (((s.patient_id)::text = (p.id)::text)))
  WHERE (((s.sepsis_level)::text = ANY ((ARRAY['SepticShock'::character varying, 'SevereSepsis'::character varying])::text[])) AND (s.assessment_time > (now() - '24:00:00'::interval)))
UNION ALL
 SELECT p.id AS patient_id,
    p.health_id,
    'Stroke'::text AS source,
    1 AS severity,
    s.stroke_type AS reason,
    s.assessment_time AS event_time
   FROM (stroke_assessments s
     JOIN patients p ON (((s.patient_id)::text = (p.id)::text)))
  WHERE ((s.tpa_candidate = true) AND (s.assessment_time > (now() - '24:00:00'::interval)))
  ORDER BY 4, 6 DESC;

CREATE VIEW v_ed_dashboard AS
 SELECT t.id AS triage_id,
    t.patient_id,
    p.health_id,
    t.esi_level,
    t.chief_complaint,
    t.is_critical,
    t.assigned_bed,
    t.triage_time,
    t.disposition,
    u.name AS triage_nurse
   FROM ((triage_assessments t
     JOIN patients p ON (((t.patient_id)::text = (p.id)::text)))
     JOIN users u ON (((t.performed_by)::text = u.id_text)))
  WHERE (t.triage_time > (now() - '24:00:00'::interval))
  ORDER BY t.esi_level, t.triage_time;

CREATE VIEW v_healthcare_providers AS
 SELECT id,
    email,
    role,
    name,
    username,
    is_active,
    created_at,
    last_login_at,
    login_count,
    first_name,
    last_name,
    specialty,
    department,
    phone,
    license_number
   FROM v_active_users
  WHERE ((role)::text = ANY (ARRAY['Doctor'::text, 'Nurse'::text, 'LabTechnician'::text, 'Pharmacist'::text]));

CREATE VIEW v_high_fall_risk_patients AS
 SELECT fra.patient_id,
    p.health_id,
    fra.total_score,
    fra.risk_level,
    fra.assessed_at,
    fra.next_assessment_due,
    u.name AS assessed_by_name,
    fra.interventions
   FROM ((fall_risk_assessments fra
     JOIN patients p ON (((fra.patient_id)::text = (p.id)::text)))
     LEFT JOIN users u ON (((fra.assessed_by)::text = u.id_text)))
  WHERE (((fra.risk_level)::text = ANY (ARRAY['moderate'::text, 'high'::text])) AND (fra.assessed_at = ( SELECT max(fra2.assessed_at) AS max
           FROM fall_risk_assessments fra2
          WHERE ((fra2.patient_id)::text = (fra.patient_id)::text))))
  ORDER BY fra.total_score DESC;

CREATE VIEW v_high_risk_patients AS
 SELECT p.id AS patient_id,
    p.health_id,
    'psychiatric'::text AS risk_type,
    pa.risk_level,
    pa.assessment_datetime AS last_assessment,
    pa.assessed_by
   FROM (patients p
     JOIN psychiatric_assessments pa ON (((p.id)::text = (pa.patient_id)::text)))
  WHERE (((pa.risk_level)::text = ANY (ARRAY[('high'::character varying)::text, ('imminent'::character varying)::text])) AND (pa.assessment_datetime = ( SELECT max(psychiatric_assessments.assessment_datetime) AS max
           FROM psychiatric_assessments
          WHERE ((psychiatric_assessments.patient_id)::text = (p.id)::text))))
UNION ALL
 SELECT p.id AS patient_id,
    p.health_id,
    'burn'::text AS risk_type,
        CASE
            WHEN (ba.tbsa_percentage >= (20)::numeric) THEN 'high'::text
            ELSE 'moderate'::text
        END AS risk_level,
    ba.assessment_datetime AS last_assessment,
    ba.assessed_by
   FROM (patients p
     JOIN burn_assessments ba ON (((p.id)::text = (ba.patient_id)::text)))
  WHERE ((ba.tbsa_percentage >= (10)::numeric) AND (ba.assessment_datetime = ( SELECT max(burn_assessments.assessment_datetime) AS max
           FROM burn_assessments
          WHERE ((burn_assessments.patient_id)::text = (p.id)::text))));

CREATE VIEW v_mci_active AS
 SELECT incident_id,
    incident_name,
    incident_datetime,
    incident_type,
    activation_level,
    count(DISTINCT patient_id) AS patient_count,
    sum(
        CASE
            WHEN ((triage_category)::text = 'red'::text) THEN 1
            ELSE 0
        END) AS red_count,
    sum(
        CASE
            WHEN ((triage_category)::text = 'yellow'::text) THEN 1
            ELSE 0
        END) AS yellow_count,
    sum(
        CASE
            WHEN ((triage_category)::text = 'green'::text) THEN 1
            ELSE 0
        END) AS green_count,
    sum(
        CASE
            WHEN ((triage_category)::text = 'black'::text) THEN 1
            ELSE 0
        END) AS black_count
   FROM mci_records
  WHERE ((activation_level)::text <> 'deactivated'::text)
  GROUP BY incident_id, incident_name, incident_datetime, incident_type, activation_level
  ORDER BY incident_datetime DESC;

CREATE VIEW v_medication_adherence_summary AS
 SELECT al.patient_id,
    p.health_id,
    al.medication_name,
    count(*) AS total_doses,
    count(*) FILTER (WHERE ((al.action_taken)::text = 'taken'::text)) AS taken_count,
    count(*) FILTER (WHERE ((al.action_taken)::text = 'skipped'::text)) AS skipped_count,
    count(*) FILTER (WHERE ((al.action_taken)::text = 'missed'::text)) AS missed_count,
    round(((100.0 * (count(*) FILTER (WHERE ((al.action_taken)::text = 'taken'::text)))::numeric) / (NULLIF(count(*), 0))::numeric), 1) AS adherence_rate
   FROM (adherence_logs al
     JOIN patients p ON (((al.patient_id)::text = (p.id)::text)))
  WHERE (al.scheduled_time >= (now() - '30 days'::interval))
  GROUP BY al.patient_id, p.health_id, al.medication_name
  ORDER BY (round(((100.0 * (count(*) FILTER (WHERE ((al.action_taken)::text = 'taken'::text)))::numeric) / (NULLIF(count(*), 0))::numeric), 1));

CREATE VIEW v_pending_labs AS
 SELECT ls.id,
    ls.patient_id,
    p.health_id,
    ls.priority,
    ls.status,
    ls.order_date,
    ls.expected_completion,
    u.name AS ordering_provider,
    jsonb_array_length(ls.tests_ordered) AS test_count,
        CASE
            WHEN ((ls.priority)::text = 'stat'::text) THEN 1
            WHEN ((ls.priority)::text = 'asap'::text) THEN 2
            WHEN ((ls.priority)::text = 'urgent'::text) THEN 3
            ELSE 4
        END AS priority_order
   FROM ((lab_submissions ls
     JOIN patients p ON (((ls.patient_id)::text = (p.id)::text)))
     LEFT JOIN users u ON (((ls.ordering_provider_id)::text = u.id_text)))
  WHERE ((ls.status)::text = ANY (ARRAY['pending'::text, 'collected'::text, 'in_progress'::text]))
  ORDER BY
        CASE
            WHEN ((ls.priority)::text = 'stat'::text) THEN 1
            WHEN ((ls.priority)::text = 'asap'::text) THEN 2
            WHEN ((ls.priority)::text = 'urgent'::text) THEN 3
            ELSE 4
        END, ls.order_date;

CREATE VIEW v_pending_orders AS
 SELECT po.id,
    po.patient_id,
    p.health_id,
    po.ordering_provider_id,
    u.name AS ordering_provider,
    po.order_type,
    po.priority,
    po.order_datetime,
    po.order_details,
    (EXTRACT(epoch FROM (now() - po.order_datetime)) / (3600)::numeric) AS hours_pending
   FROM ((physician_orders po
     JOIN patients p ON (((po.patient_id)::text = (p.id)::text)))
     LEFT JOIN users u ON (((po.ordering_provider_id)::text = u.id_text)))
  WHERE ((po.status)::text = 'pending'::text)
  ORDER BY
        CASE po.priority
            WHEN 'stat'::text THEN 1
            WHEN 'asap'::text THEN 2
            WHEN 'urgent'::text THEN 3
            ELSE 4
        END, po.order_datetime;

CREATE VIEW v_pending_radiology AS
 SELECT ro.id,
    ro.patient_id,
    p.health_id,
    ro.modality,
    ro.study_type,
    ro.body_part,
    ro.priority,
    ro.status,
    ro.scheduled_datetime,
    u.name AS ordering_provider
   FROM ((radiology_orders ro
     JOIN patients p ON (((ro.patient_id)::text = (p.id)::text)))
     LEFT JOIN users u ON (((ro.ordering_provider_id)::text = u.id_text)))
  WHERE ((ro.status)::text = ANY (ARRAY['ordered'::text, 'scheduled'::text, 'in_progress'::text]))
  ORDER BY
        CASE ro.priority
            WHEN 'stat'::text THEN 1
            WHEN 'asap'::text THEN 2
            WHEN 'urgent'::text THEN 3
            ELSE 4
        END, ro.scheduled_datetime;

CREATE VIEW v_pending_sync_conflicts AS
 SELECT id,
    sync_operation_id,
    entity_type,
    entity_id,
    patient_id,
    conflict_type,
    field_name,
    local_value,
    remote_value,
    local_timestamp,
    remote_timestamp,
    local_version,
    remote_version,
    status,
    resolution_strategy,
    resolved_value,
    resolved_by,
    resolved_at,
    resolution_notes,
    created_at
   FROM sync_conflicts
  WHERE ((status)::text = 'pending'::text)
  ORDER BY created_at;

CREATE VIEW v_role_summary AS
 SELECT role,
    count(*) AS count,
    max(last_login_at) AS last_active
   FROM users
  WHERE (is_active = true)
  GROUP BY role
  ORDER BY (count(*)) DESC;

CREATE VIEW v_surgical_schedule AS
 SELECT po.id,
    po.patient_id,
    p.health_id,
    po.procedure_name,
    po.scheduled_date,
    s.name AS surgeon_name,
    a.name AS anesthesiologist_name,
    po.asa_classification,
    po.cleared_for_surgery,
    po.consent_signed
   FROM (((pre_op_assessments po
     JOIN patients p ON (((po.patient_id)::text = (p.id)::text)))
     LEFT JOIN users s ON (((po.surgeon_id)::text = s.id_text)))
     LEFT JOIN users a ON (((po.anesthesiologist_id)::text = a.id_text)))
  WHERE (po.scheduled_date >= CURRENT_DATE)
  ORDER BY po.scheduled_date;

CREATE VIEW v_todays_appointments AS
 SELECT a.id,
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
   FROM ((appointments a
     JOIN patients p ON (((a.patient_id)::text = (p.id)::text)))
     JOIN users u ON (((a.provider_id)::text = u.id_text)))
  WHERE (date(a.scheduled_datetime) = CURRENT_DATE)
  ORDER BY a.scheduled_datetime;

CREATE VIEW v_unacknowledged_critical_values AS
 SELECT cv.id,
    cv.patient_id,
    p.health_id,
    cv.test_name,
    cv.value,
    cv.unit,
    cv.severity,
    cv.created_at,
    (EXTRACT(epoch FROM (now() - cv.created_at)) / (60)::numeric) AS minutes_since_detection
   FROM (critical_values cv
     JOIN patients p ON (((cv.patient_id)::text = (p.id)::text)))
  WHERE (cv.acknowledged_at IS NULL)
  ORDER BY
        CASE cv.severity
            WHEN 'panic'::text THEN 1
            WHEN 'critical'::text THEN 2
            ELSE 3
        END, cv.created_at;

CREATE TABLE wound_assessments (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    wound_id character varying(64) NOT NULL,
    wound_location character varying(128) NOT NULL,
    wound_type character varying(32) NOT NULL,
    length_cm numeric(5,2),
    width_cm numeric(5,2),
    depth_cm numeric(5,2),
    tissue_type character varying(32),
    drainage_amount character varying(16),
    drainage_type character varying(32),
    periwound_condition character varying(32),
    pain_level integer,
    treatment_applied text,
    dressing_type character varying(64),
    notes text,
    photo_taken boolean DEFAULT false,
    assessed_by character varying(66) NOT NULL,
    assessed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    facility_id character varying(64),
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT wound_assessments_pain_level_check CHECK (((pain_level >= 0) AND (pain_level <= 10)))
);

CREATE VIEW v_wound_care_alerts AS
 SELECT wa.patient_id,
    p.health_id,
    wa.wound_id,
    wa.wound_location,
    wa.wound_type,
    wa.drainage_amount,
    wa.pain_level,
    wa.assessed_at,
    wa.notes,
    u.name AS assessed_by_name
   FROM ((wound_assessments wa
     JOIN patients p ON (((wa.patient_id)::text = (p.id)::text)))
     LEFT JOIN users u ON (((wa.assessed_by)::text = u.id_text)))
  WHERE ((((wa.drainage_amount)::text = ANY (ARRAY['moderate'::text, 'heavy'::text])) OR (wa.pain_level >= 7) OR ((wa.periwound_condition)::text <> 'intact'::text)) AND (wa.assessed_at >= (now() - '24:00:00'::interval)))
  ORDER BY wa.assessed_at DESC;

CREATE TABLE vital_signs (
    id character varying(64) NOT NULL,
    patient_id character varying(64) NOT NULL,
    heart_rate integer,
    respiratory_rate integer,
    blood_pressure_systolic integer,
    blood_pressure_diastolic integer,
    mean_arterial_pressure integer,
    temperature double precision,
    temperature_site character varying(16),
    oxygen_saturation integer,
    oxygen_delivery character varying(32),
    fio2 integer,
    pain_scale integer,
    gcs_score integer,
    gcs_eye integer,
    gcs_verbal integer,
    gcs_motor integer,
    blood_glucose double precision,
    weight_kg double precision,
    height_cm double precision,
    bmi double precision,
    "position" character varying(32),
    activity_level character varying(32),
    is_critical boolean DEFAULT false,
    critical_values jsonb DEFAULT '[]'::jsonb,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    recorded_by character varying(66) NOT NULL,
    facility_id character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    CONSTRAINT vital_signs_gcs_eye_check CHECK (((gcs_eye >= 1) AND (gcs_eye <= 4))),
    CONSTRAINT vital_signs_gcs_motor_check CHECK (((gcs_motor >= 1) AND (gcs_motor <= 6))),
    CONSTRAINT vital_signs_gcs_score_check CHECK (((gcs_score >= 3) AND (gcs_score <= 15))),
    CONSTRAINT vital_signs_gcs_verbal_check CHECK (((gcs_verbal >= 1) AND (gcs_verbal <= 5))),
    CONSTRAINT vital_signs_pain_scale_check CHECK (((pain_scale >= 0) AND (pain_scale <= 10)))
);

CREATE TABLE wearable_alert_records (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE wearable_alert_rules (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE wearable_device_records (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE wearable_reading_records (
    id text NOT NULL,
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY access_logs ALTER COLUMN seal_seq SET DEFAULT nextval('audit_seal_seq'::regclass);

ALTER TABLE ONLY audit_seal_batches ALTER COLUMN id SET DEFAULT nextval('audit_seal_batches_id_seq'::regclass);

ALTER TABLE ONLY auth_security_events ALTER COLUMN id SET DEFAULT nextval('auth_security_events_id_seq'::regclass);

ALTER TABLE ONLY access_contexts
    ADD CONSTRAINT access_contexts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY access_logs
    ADD CONSTRAINT access_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY actor_column_registry
    ADD CONSTRAINT actor_column_registry_pkey PRIMARY KEY (table_name, column_name);

ALTER TABLE ONLY adherence_logs
    ADD CONSTRAINT adherence_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ama_discharges
    ADD CONSTRAINT ama_discharges_pkey PRIMARY KEY (id);

ALTER TABLE ONLY anesthesia_records
    ADD CONSTRAINT anesthesia_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY audit_seal_batch_members
    ADD CONSTRAINT audit_seal_batch_members_pkey PRIMARY KEY (batch_id, leaf_index);

ALTER TABLE ONLY audit_seal_batch_members
    ADD CONSTRAINT audit_seal_batch_members_source_unique UNIQUE (source, source_id);

ALTER TABLE ONLY audit_seal_batches
    ADD CONSTRAINT audit_seal_batches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY auth_login_sessions
    ADD CONSTRAINT auth_login_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY auth_security_events
    ADD CONSTRAINT auth_security_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY auth_sessions
    ADD CONSTRAINT auth_sessions_refresh_jti_key UNIQUE (refresh_jti);

ALTER TABLE ONLY auth_sessions
    ADD CONSTRAINT auth_sessions_refresh_token_hash_key UNIQUE (refresh_token_hash);

ALTER TABLE ONLY auth_transaction_challenges
    ADD CONSTRAINT auth_transaction_challenges_pkey PRIMARY KEY (id);

ALTER TABLE ONLY autopsy_reports
    ADD CONSTRAINT autopsy_reports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY backup_canaries
    ADD CONSTRAINT backup_canaries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY barcode_scans
    ADD CONSTRAINT barcode_scans_pkey PRIMARY KEY (id);

ALTER TABLE ONLY blood_type_screen_records
    ADD CONSTRAINT blood_type_screen_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY blood_units
    ADD CONSTRAINT blood_units_pkey PRIMARY KEY (id);

ALTER TABLE ONLY blood_units
    ADD CONSTRAINT blood_units_unit_number_key UNIQUE (unit_number);

ALTER TABLE ONLY break_glass_grants
    ADD CONSTRAINT break_glass_grants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY burn_assessments
    ADD CONSTRAINT burn_assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY cardiac_events
    ADD CONSTRAINT cardiac_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY care_relationships
    ADD CONSTRAINT care_relationship_once_per_source UNIQUE (source, source_id, clinician_id);

ALTER TABLE ONLY care_relationships
    ADD CONSTRAINT care_relationships_pkey PRIMARY KEY (id);

ALTER TABLE ONLY cds_alerts
    ADD CONSTRAINT cds_alerts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY cds_audit_entries
    ADD CONSTRAINT cds_audit_entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY cds_rules
    ADD CONSTRAINT cds_rules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY cds_threshold_configs
    ADD CONSTRAINT cds_threshold_configs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY chain_of_custody
    ADD CONSTRAINT chain_of_custody_pkey PRIMARY KEY (id);

ALTER TABLE ONLY claim_eob_documents
    ADD CONSTRAINT claim_eob_documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY code_blue_records
    ADD CONSTRAINT code_blue_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY consent_records
    ADD CONSTRAINT consent_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY consultation_notes
    ADD CONSTRAINT consultation_notes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY credential_grants
    ADD CONSTRAINT credential_grants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY critical_values
    ADD CONSTRAINT critical_values_pkey PRIMARY KEY (id);

ALTER TABLE ONLY data_retention_policies
    ADD CONSTRAINT data_retention_policies_pkey PRIMARY KEY (id);

ALTER TABLE ONLY death_certificate_records
    ADD CONSTRAINT death_certificate_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY deletion_register
    ADD CONSTRAINT deletion_register_pkey PRIMARY KEY (id);

ALTER TABLE ONLY device_keys
    ADD CONSTRAINT device_keys_device_id_key_id_version_key UNIQUE (device_id, key_id, version);

ALTER TABLE ONLY device_keys
    ADD CONSTRAINT device_keys_pkey PRIMARY KEY (id);

ALTER TABLE ONLY device_tokens
    ADD CONSTRAINT device_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY device_tokens
    ADD CONSTRAINT device_tokens_user_id_token_key UNIQUE (user_id, token);

ALTER TABLE ONLY discharge_instructions
    ADD CONSTRAINT discharge_instructions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY discharge_summaries
    ADD CONSTRAINT discharge_summaries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY dispense_events
    ADD CONSTRAINT dispense_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY drug_interaction_checks
    ADD CONSTRAINT drug_interaction_checks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY e_prescription_v2_records
    ADD CONSTRAINT e_prescription_v2_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY eligibility_checks
    ADD CONSTRAINT eligibility_checks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY emergency_access_grants
    ADD CONSTRAINT emergency_access_grants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY emergency_capsule_access_log
    ADD CONSTRAINT emergency_capsule_access_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY emergency_capsules
    ADD CONSTRAINT emergency_capsules_pkey PRIMARY KEY (patient_id, version);

ALTER TABLE ONLY ems_handoffs
    ADD CONSTRAINT ems_handoffs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY encrypted_document_blobs
    ADD CONSTRAINT encrypted_document_blobs_pkey PRIMARY KEY (content_hash);

ALTER TABLE ONLY ep_cardiac_events
    ADD CONSTRAINT ep_cardiac_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ep_code_blue_records
    ADD CONSTRAINT ep_code_blue_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ep_sepsis_assessments
    ADD CONSTRAINT ep_sepsis_assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ep_stroke_assessments
    ADD CONSTRAINT ep_stroke_assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ep_trauma_assessments
    ADD CONSTRAINT ep_trauma_assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY facilities
    ADD CONSTRAINT facilities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY fall_risk_assessments
    ADD CONSTRAINT fall_risk_assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY family_groups
    ADD CONSTRAINT family_groups_pkey PRIMARY KEY (id);

ALTER TABLE ONLY family_history_records
    ADD CONSTRAINT family_history_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY gcs_assessments
    ADD CONSTRAINT gcs_assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY governance_decisions
    ADD CONSTRAINT governance_decisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY guardian_relationships
    ADD CONSTRAINT guardian_relationships_pkey PRIMARY KEY (id);

ALTER TABLE ONLY history_physicals
    ADD CONSTRAINT history_physicals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY idempotency_operations
    ADD CONSTRAINT idempotency_operations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY idempotency_operations
    ADD CONSTRAINT idempotency_operations_unique_operation UNIQUE (subject, method, route, idempotency_key);

ALTER TABLE ONLY immunization_records
    ADD CONSTRAINT immunization_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY incident_reports
    ADD CONSTRAINT incident_reports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY insurance_cards
    ADD CONSTRAINT insurance_cards_pkey PRIMARY KEY (id);

ALTER TABLE ONLY insurance_claims
    ADD CONSTRAINT insurance_claims_pkey PRIMARY KEY (id);

ALTER TABLE ONLY insurance_records
    ADD CONSTRAINT insurance_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY intubation_records
    ADD CONSTRAINT intubation_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY io_records
    ADD CONSTRAINT io_records_patient_id_record_date_shift_key UNIQUE (patient_id, record_date, shift);

ALTER TABLE ONLY io_records
    ADD CONSTRAINT io_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY iv_assessments
    ADD CONSTRAINT iv_assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY key_envelopes
    ADD CONSTRAINT key_envelopes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY key_usage_index
    ADD CONSTRAINT key_usage_index_pkey PRIMARY KEY (key_id, resource_type, resource_id);

ALTER TABLE ONLY lab_calibrations
    ADD CONSTRAINT lab_calibrations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY lab_qc_records
    ADD CONSTRAINT lab_qc_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY lab_result_submissions
    ADD CONSTRAINT lab_result_submissions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY lab_submissions
    ADD CONSTRAINT lab_submissions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY laceration_repairs
    ADD CONSTRAINT laceration_repairs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY language_preferences
    ADD CONSTRAINT language_preferences_pkey PRIMARY KEY (id);

ALTER TABLE ONLY legal_holds
    ADD CONSTRAINT legal_holds_pkey PRIMARY KEY (id);

ALTER TABLE ONLY login_contexts
    ADD CONSTRAINT login_contexts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY managed_devices
    ADD CONSTRAINT managed_devices_hardware_fingerprint_key UNIQUE (hardware_fingerprint);

ALTER TABLE ONLY managed_devices
    ADD CONSTRAINT managed_devices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY mci_records
    ADD CONSTRAINT mci_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY medical_id_issuances
    ADD CONSTRAINT medical_id_issuances_patient_id_key UNIQUE (patient_id);

ALTER TABLE ONLY medical_id_issuances
    ADD CONSTRAINT medical_id_issuances_pkey PRIMARY KEY (medical_id);

ALTER TABLE ONLY medical_records
    ADD CONSTRAINT medical_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY medication_records
    ADD CONSTRAINT medication_records_patient_id_record_date_key UNIQUE (patient_id, record_date);

ALTER TABLE ONLY medication_records
    ADD CONSTRAINT medication_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY medication_reminders
    ADD CONSTRAINT medication_reminders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY message_attachments
    ADD CONSTRAINT message_attachments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY national_id_manual_reviews
    ADD CONSTRAINT national_id_manual_reviews_country_national_id_hash_key UNIQUE (country, national_id_hash);

ALTER TABLE ONLY national_id_manual_reviews
    ADD CONSTRAINT national_id_manual_reviews_pkey PRIMARY KEY (id);

ALTER TABLE ONLY nfc_tags
    ADD CONSTRAINT nfc_tags_pkey PRIMARY KEY (id);

ALTER TABLE ONLY nfc_tags
    ADD CONSTRAINT nfc_tags_tag_uid_key UNIQUE (tag_uid);

ALTER TABLE ONLY note_templates
    ADD CONSTRAINT note_templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY notification_reads
    ADD CONSTRAINT notification_reads_pkey PRIMARY KEY (id);

ALTER TABLE ONLY nursing_care_plans
    ADD CONSTRAINT nursing_care_plans_pkey PRIMARY KEY (id);

ALTER TABLE ONLY obstetric_emergencies
    ADD CONSTRAINT obstetric_emergencies_pkey PRIMARY KEY (id);

ALTER TABLE ONLY operative_notes
    ADD CONSTRAINT operative_notes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY order_sets
    ADD CONSTRAINT order_sets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY organization_assignments
    ADD CONSTRAINT organization_assignments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY organization_keys
    ADD CONSTRAINT organization_keys_organization_id_key_id_version_key UNIQUE (organization_id, key_id, version);

ALTER TABLE ONLY organization_keys
    ADD CONSTRAINT organization_keys_pkey PRIMARY KEY (id);

ALTER TABLE ONLY organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY pathology_reports
    ADD CONSTRAINT pathology_reports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY patient_access_grants
    ADD CONSTRAINT patient_access_grants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY patient_access_requests
    ADD CONSTRAINT patient_access_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY patient_demographics
    ADD CONSTRAINT patient_demographics_pkey PRIMARY KEY (patient_id);

ALTER TABLE ONLY patient_mobile_devices
    ADD CONSTRAINT patient_mobile_devices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY patient_profiles
    ADD CONSTRAINT patient_profiles_legacy_patient_id_key UNIQUE (legacy_patient_id);

ALTER TABLE ONLY patient_profiles
    ADD CONSTRAINT patient_profiles_medical_id_key UNIQUE (medical_id);

ALTER TABLE ONLY patient_profiles
    ADD CONSTRAINT patient_profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY patients
    ADD CONSTRAINT patients_health_id_key UNIQUE (health_id);

ALTER TABLE ONLY patients
    ADD CONSTRAINT patients_pkey PRIMARY KEY (id);

ALTER TABLE ONLY pediatric_assessments
    ADD CONSTRAINT pediatric_assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY persons
    ADD CONSTRAINT persons_pkey PRIMARY KEY (id);

ALTER TABLE ONLY persons
    ADD CONSTRAINT persons_user_id_key UNIQUE (user_id);

ALTER TABLE ONLY pharmacy_decisions
    ADD CONSTRAINT pharmacy_decisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY physician_orders
    ADD CONSTRAINT physician_orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY post_op_notes
    ADD CONSTRAINT post_op_notes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY pre_op_assessments
    ADD CONSTRAINT pre_op_assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY prescription_refill_requests
    ADD CONSTRAINT prescription_refill_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY prescription_verification_events
    ADD CONSTRAINT prescription_verification_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY processing_restrictions
    ADD CONSTRAINT processing_restrictions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY professional_identities
    ADD CONSTRAINT professional_identities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY progress_notes
    ADD CONSTRAINT progress_notes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY protected_mobile_record_sessions
    ADD CONSTRAINT protected_mobile_record_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY provider_schedules
    ADD CONSTRAINT provider_schedules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY psychiatric_assessments
    ADD CONSTRAINT psychiatric_assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY radiology_orders
    ADD CONSTRAINT radiology_orders_accession_number_key UNIQUE (accession_number);

ALTER TABLE ONLY radiology_orders
    ADD CONSTRAINT radiology_orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY radiology_reports
    ADD CONSTRAINT radiology_reports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY record_crypto_metadata
    ADD CONSTRAINT record_crypto_metadata_pkey PRIMARY KEY (record_id);

ALTER TABLE ONLY research_export_runs
    ADD CONSTRAINT research_export_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY retention_approvals
    ADD CONSTRAINT retention_approvals_pkey PRIMARY KEY (token);

ALTER TABLE ONLY retention_job_runs
    ADD CONSTRAINT retention_job_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY satisfaction_surveys
    ADD CONSTRAINT satisfaction_surveys_pkey PRIMARY KEY (id);

ALTER TABLE ONLY scanner_settings
    ADD CONSTRAINT scanner_settings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY security_alerts
    ADD CONSTRAINT security_alerts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY sepsis_assessments
    ADD CONSTRAINT sepsis_assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY shift_handoffs
    ADD CONSTRAINT shift_handoffs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY sms_opt_outs
    ADD CONSTRAINT sms_opt_outs_pkey PRIMARY KEY (phone_number);

ALTER TABLE ONLY soap_note_records
    ADD CONSTRAINT soap_note_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY soap_notes
    ADD CONSTRAINT soap_notes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY specimen_collections
    ADD CONSTRAINT specimen_collections_barcode_key UNIQUE (barcode);

ALTER TABLE ONLY specimen_collections
    ADD CONSTRAINT specimen_collections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY specimen_recollection_requests
    ADD CONSTRAINT specimen_recollection_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY specimen_rejections
    ADD CONSTRAINT specimen_rejections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY splint_cast_records
    ADD CONSTRAINT splint_cast_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY stroke_assessments
    ADD CONSTRAINT stroke_assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY symptom_entries
    ADD CONSTRAINT symptom_entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY symptom_sessions
    ADD CONSTRAINT symptom_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY sync_conflicts
    ADD CONSTRAINT sync_conflicts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY sync_devices
    ADD CONSTRAINT sync_devices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY sync_queue_items
    ADD CONSTRAINT sync_queue_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY telehealth_recordings
    ADD CONSTRAINT telehealth_recordings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY telehealth_session_records
    ADD CONSTRAINT telehealth_session_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY toxicology_assessments
    ADD CONSTRAINT toxicology_assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY transfusion_event_records
    ADD CONSTRAINT transfusion_event_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY trauma_assessments
    ADD CONSTRAINT trauma_assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY triage_assessments
    ADD CONSTRAINT triage_assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY used_emergency_tokens
    ADD CONSTRAINT used_emergency_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY user_avatars
    ADD CONSTRAINT user_avatars_pkey PRIMARY KEY (id);

ALTER TABLE ONLY user_mfa
    ADD CONSTRAINT user_mfa_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY user_profiles
    ADD CONSTRAINT user_profiles_user_id_key UNIQUE (user_id);

ALTER TABLE ONLY user_setting_records
    ADD CONSTRAINT user_setting_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY users
    ADD CONSTRAINT users_id_text_key UNIQUE (id_text);

ALTER TABLE ONLY users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY vital_signs
    ADD CONSTRAINT vital_signs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY wearable_alert_records
    ADD CONSTRAINT wearable_alert_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY wearable_alert_rules
    ADD CONSTRAINT wearable_alert_rules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY wearable_device_records
    ADD CONSTRAINT wearable_device_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY wearable_reading_records
    ADD CONSTRAINT wearable_reading_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY wound_assessments
    ADD CONSTRAINT wound_assessments_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX credential_grants_one_live ON credential_grants USING btree (user_id, purpose) WHERE ((consumed_at IS NULL) AND (revoked_at IS NULL));

CREATE INDEX idx_access_contexts_clinician ON access_contexts USING btree (clinician_id, patient_id, expires_at);

CREATE INDEX idx_access_logs_accessor ON access_logs USING btree (accessor_id);

CREATE INDEX idx_access_logs_action ON access_logs USING btree (action);

CREATE INDEX idx_access_logs_emergency ON access_logs USING btree (is_emergency_access) WHERE (is_emergency_access = true);

CREATE INDEX idx_access_logs_patient ON access_logs USING btree (patient_id);

CREATE INDEX idx_access_logs_patient_grant_usage ON access_logs USING btree (patient_id, authority_id, accessed_at DESC) WHERE ((authority_type = 'patient_grant'::text) AND (authority_id IS NOT NULL));

CREATE UNIQUE INDEX idx_access_logs_seal_seq ON access_logs USING btree (seal_seq);

CREATE INDEX idx_access_logs_time ON access_logs USING btree (accessed_at DESC);

CREATE INDEX idx_adherence_action ON adherence_logs USING btree (action_taken);

CREATE INDEX idx_adherence_patient ON adherence_logs USING btree (patient_id);

CREATE INDEX idx_adherence_patient_date ON adherence_logs USING btree (patient_id, scheduled_time);

CREATE INDEX idx_adherence_prescription ON adherence_logs USING btree (prescription_id);

CREATE INDEX idx_adherence_reminder ON adherence_logs USING btree (reminder_id);

CREATE INDEX idx_adherence_scheduled ON adherence_logs USING btree (scheduled_time DESC);

CREATE INDEX idx_ama_discharges_date ON ama_discharges USING btree (discharge_datetime DESC);

CREATE INDEX idx_ama_discharges_encounter ON ama_discharges USING btree (encounter_id);

CREATE INDEX idx_ama_discharges_patient ON ama_discharges USING btree (patient_id);

CREATE INDEX idx_ama_discharges_unsigned ON ama_discharges USING btree (patient_signature_at) WHERE (patient_signature_at IS NULL);

CREATE INDEX idx_anesthesia_operative ON anesthesia_records USING btree (operative_note_id);

CREATE INDEX idx_anesthesia_patient ON anesthesia_records USING btree (patient_id);

CREATE INDEX idx_anesthesia_provider ON anesthesia_records USING btree (anesthesiologist_id);

CREATE INDEX idx_anesthesia_type ON anesthesia_records USING btree (anesthesia_type);

CREATE INDEX idx_appointments_datetime ON appointments USING btree (scheduled_datetime);

CREATE INDEX idx_appointments_patient ON appointments USING btree (patient_id);

CREATE INDEX idx_appointments_provider ON appointments USING btree (provider_id);

CREATE INDEX idx_appointments_provider_date ON appointments USING btree (provider_id, scheduled_datetime);

CREATE INDEX idx_appointments_status ON appointments USING btree (status);

CREATE INDEX idx_assignments_organization ON organization_assignments USING btree (organization_id, status);

CREATE UNIQUE INDEX idx_audit_events_seal_seq ON audit_events USING btree (seal_seq);

CREATE INDEX idx_audit_events_type_aggregate ON audit_events USING btree (event_type, aggregate_id);

CREATE UNIQUE INDEX idx_audit_seal_batches_hash ON audit_seal_batches USING btree (batch_hash) WHERE (batch_hash IS NOT NULL);

CREATE INDEX idx_audit_seal_batches_pending ON audit_seal_batches USING btree (id) WHERE (status = 'pending'::text);

CREATE UNIQUE INDEX idx_audit_seal_batches_prev_hash ON audit_seal_batches USING btree (prev_batch_hash) WHERE (prev_batch_hash IS NOT NULL);

CREATE INDEX idx_audit_seal_batches_unexported ON audit_seal_batches USING btree (id) WHERE (status = 'sealed'::text);

CREATE INDEX idx_auth_login_sessions_user_active ON auth_login_sessions USING btree (user_id) WHERE (revoked_at IS NULL);

CREATE INDEX idx_auth_security_events_dedup ON auth_security_events USING btree (event_type, user_id, occurred_at DESC);

CREATE INDEX idx_auth_security_events_recent ON auth_security_events USING btree (occurred_at DESC);

CREATE INDEX idx_auth_sessions_login_session ON auth_sessions USING btree (login_session_id);

CREATE INDEX idx_auth_sessions_user_active ON auth_sessions USING btree (user_id, expires_at) WHERE (revoked_at IS NULL);

CREATE INDEX idx_auth_txn_challenges_expiry ON auth_transaction_challenges USING btree (expires_at) WHERE (consumed_at IS NULL);

CREATE INDEX idx_auth_txn_challenges_session ON auth_transaction_challenges USING btree (login_session_id, created_at DESC);

CREATE INDEX idx_autopsy_reports_owner ON autopsy_reports USING btree (owner_id);

CREATE INDEX idx_barcode_scans_owner ON barcode_scans USING btree (owner_id);

CREATE INDEX idx_barcode_scans_value ON barcode_scans USING btree (((data ->> 'barcode_value'::text)));

CREATE INDEX idx_blood_type_screen_records_owner ON blood_type_screen_records USING btree (owner_id);

CREATE INDEX idx_blood_units_reserved_patient ON blood_units USING btree (reserved_for_patient_id) WHERE (status = 'reserved'::text);

CREATE INDEX idx_blood_units_stock ON blood_units USING btree (product_type, abo, rh, expires_on) WHERE (status = 'available'::text);

CREATE INDEX idx_break_glass_patient_clinician ON break_glass_grants USING btree (patient_id, clinician_id, expires_at);

CREATE INDEX idx_burn_assessments_datetime ON burn_assessments USING btree (assessment_datetime DESC);

CREATE INDEX idx_burn_assessments_patient ON burn_assessments USING btree (patient_id);

CREATE INDEX idx_burn_assessments_tbsa ON burn_assessments USING btree (tbsa_percentage);

CREATE INDEX idx_cardiac_patient ON cardiac_events USING btree (patient_id);

CREATE INDEX idx_cardiac_stemi ON cardiac_events USING btree (event_type) WHERE ((event_type)::text = 'STEMI'::text);

CREATE INDEX idx_cardiac_time ON cardiac_events USING btree (event_time DESC);

CREATE INDEX idx_cardiac_type ON cardiac_events USING btree (event_type);

CREATE INDEX idx_care_relationships_patient_clinician ON care_relationships USING btree (patient_id, clinician_id, ends_at);

CREATE INDEX idx_cds_alerts_active ON cds_alerts USING btree (status) WHERE ((status)::text = 'active'::text);

CREATE INDEX idx_cds_alerts_datetime ON cds_alerts USING btree (alert_datetime);

CREATE INDEX idx_cds_alerts_patient ON cds_alerts USING btree (patient_id);

CREATE INDEX idx_cds_alerts_provider ON cds_alerts USING btree (provider_id);

CREATE INDEX idx_cds_alerts_severity ON cds_alerts USING btree (severity);

CREATE INDEX idx_cds_alerts_status ON cds_alerts USING btree (status);

CREATE INDEX idx_cds_alerts_type ON cds_alerts USING btree (alert_type);

CREATE INDEX idx_cds_audit_entries_owner ON cds_audit_entries USING btree (owner_id);

CREATE INDEX idx_cds_rules_owner ON cds_rules USING btree (owner_id);

CREATE INDEX idx_cds_rules_status ON cds_rules USING btree (((data ->> 'status'::text)));

CREATE INDEX idx_cds_threshold_configs_owner ON cds_threshold_configs USING btree (owner_id);

CREATE INDEX idx_chain_custody_case ON chain_of_custody USING btree (case_number);

CREATE INDEX idx_chain_custody_custodian ON chain_of_custody USING btree (current_custodian_id);

CREATE INDEX idx_chain_custody_patient ON chain_of_custody USING btree (patient_id);

CREATE INDEX idx_chain_custody_status ON chain_of_custody USING btree (status);

CREATE INDEX idx_chain_custody_type ON chain_of_custody USING btree (evidence_type);

CREATE INDEX idx_claim_eob_documents_claim ON claim_eob_documents USING btree (claim_id, created_at DESC);

CREATE INDEX idx_code_blue_outcome ON code_blue_records USING btree (outcome);

CREATE INDEX idx_code_blue_patient ON code_blue_records USING btree (patient_id);

CREATE INDEX idx_code_blue_time ON code_blue_records USING btree (event_time DESC);

CREATE INDEX idx_consent_active ON consent_records USING btree (patient_id, consent_type) WHERE (revoked = false);

CREATE INDEX idx_consent_emergency_basis ON consent_records USING btree (emergency_basis) WHERE ((emergency_basis)::text <> 'none'::text);

CREATE INDEX idx_consent_patient ON consent_records USING btree (patient_id);

CREATE INDEX idx_consent_records_mature_child ON consent_records USING btree (patient_id, consent_datetime DESC) WHERE ((consent_giver_capacity)::text = 'child_over_12_mature'::text);

CREATE INDEX idx_consent_s11_basis ON consent_records USING btree (popia_section_11_basis);

CREATE INDEX idx_consent_status ON consent_records USING btree (consent_status);

CREATE INDEX idx_consent_type ON consent_records USING btree (consent_type);

CREATE INDEX idx_consultation_notes_consulting ON consultation_notes USING btree (consulting_provider);

CREATE INDEX idx_consultation_notes_patient ON consultation_notes USING btree (patient_id);

CREATE INDEX idx_consultation_notes_requesting ON consultation_notes USING btree (requesting_provider);

CREATE INDEX idx_consultation_notes_status ON consultation_notes USING btree (status);

CREATE INDEX idx_consultation_notes_type ON consultation_notes USING btree (consultation_type);

CREATE INDEX idx_consultation_notes_urgency ON consultation_notes USING btree (urgency);

CREATE INDEX idx_credential_grants_user ON credential_grants USING btree (user_id, created_at DESC);

CREATE INDEX idx_critical_values_acknowledged ON critical_values USING btree (acknowledged_at);

CREATE INDEX idx_critical_values_created ON critical_values USING btree (created_at DESC);

CREATE INDEX idx_critical_values_patient ON critical_values USING btree (patient_id);

CREATE INDEX idx_critical_values_severity ON critical_values USING btree (severity);

CREATE INDEX idx_death_certificate_records_owner ON death_certificate_records USING btree (owner_id);

CREATE INDEX idx_deletion_register_executed ON deletion_register USING btree (executed_at DESC);

CREATE INDEX idx_deletion_register_patient ON deletion_register USING btree (patient_id, executed_at DESC);

CREATE INDEX idx_device_keys_active ON device_keys USING btree (device_id, status, version DESC);

CREATE INDEX idx_device_tokens_user_id ON device_tokens USING btree (user_id);

CREATE INDEX idx_discharge_instructions_date ON discharge_instructions USING btree (visit_date DESC);

CREATE INDEX idx_discharge_instructions_patient ON discharge_instructions USING btree (patient_id);

CREATE INDEX idx_discharge_instructions_summary ON discharge_instructions USING btree (discharge_summary_id);

CREATE INDEX idx_discharge_summaries_attending ON discharge_summaries USING btree (attending_physician_id);

CREATE INDEX idx_discharge_summaries_date ON discharge_summaries USING btree (discharge_datetime DESC);

CREATE INDEX idx_discharge_summaries_encounter ON discharge_summaries USING btree (encounter_id);

CREATE INDEX idx_discharge_summaries_patient ON discharge_summaries USING btree (patient_id);

CREATE INDEX idx_dispense_events_owner ON dispense_events USING btree (owner_id);

CREATE INDEX idx_dispense_events_prescription ON dispense_events USING btree (((data ->> 'prescription_id'::text)));

CREATE INDEX idx_drug_interaction_checks_owner ON drug_interaction_checks USING btree (owner_id);

CREATE INDEX idx_e_prescription_v2_records_owner ON e_prescription_v2_records USING btree (owner_id);

CREATE INDEX idx_eligibility_checks_owner ON eligibility_checks USING btree (owner_id);

CREATE INDEX idx_emergency_capsule_access_patient ON emergency_capsule_access_log USING btree (patient_id, accessed_at DESC);

CREATE INDEX idx_emergency_capsule_access_unverified ON emergency_capsule_access_log USING btree (accessed_at DESC) WHERE (commitment_verified = false);

CREATE INDEX idx_emergency_capsules_current ON emergency_capsules USING btree (patient_id, version DESC) WHERE (revoked_at IS NULL);

CREATE INDEX idx_emergency_grants_device_active ON emergency_access_grants USING btree (device_id, expires_at) WHERE (status = 'active'::text);

CREATE INDEX idx_emergency_grants_patient_active ON emergency_access_grants USING btree (patient_id, expires_at) WHERE (status = 'active'::text);

CREATE INDEX idx_ems_handoffs_agency ON ems_handoffs USING btree (ems_agency);

CREATE INDEX idx_ems_handoffs_alerts ON ems_handoffs USING btree (trauma_alert, stroke_alert, stemi_alert, sepsis_alert);

CREATE INDEX idx_ems_handoffs_datetime ON ems_handoffs USING btree (handoff_datetime DESC);

CREATE INDEX idx_ems_handoffs_patient ON ems_handoffs USING btree (patient_id);

CREATE INDEX idx_ems_handoffs_receiving ON ems_handoffs USING btree (receiving_provider_id);

CREATE INDEX idx_ep_cardiac_created ON ep_cardiac_events USING btree (created_at DESC);

CREATE INDEX idx_ep_cardiac_patient ON ep_cardiac_events USING btree (patient_id);

CREATE INDEX idx_ep_code_blue_created ON ep_code_blue_records USING btree (created_at DESC);

CREATE INDEX idx_ep_code_blue_patient ON ep_code_blue_records USING btree (patient_id);

CREATE INDEX idx_ep_sepsis_created ON ep_sepsis_assessments USING btree (created_at DESC);

CREATE INDEX idx_ep_sepsis_patient ON ep_sepsis_assessments USING btree (patient_id);

CREATE INDEX idx_ep_stroke_created ON ep_stroke_assessments USING btree (created_at DESC);

CREATE INDEX idx_ep_stroke_patient ON ep_stroke_assessments USING btree (patient_id);

CREATE INDEX idx_ep_trauma_created ON ep_trauma_assessments USING btree (created_at DESC);

CREATE INDEX idx_ep_trauma_patient ON ep_trauma_assessments USING btree (patient_id);

CREATE INDEX idx_fall_risk_assessments_assessed_at ON fall_risk_assessments USING btree (assessed_at DESC);

CREATE INDEX idx_fall_risk_assessments_assessed_by ON fall_risk_assessments USING btree (assessed_by);

CREATE INDEX idx_fall_risk_assessments_due ON fall_risk_assessments USING btree (next_assessment_due);

CREATE INDEX idx_fall_risk_assessments_patient ON fall_risk_assessments USING btree (patient_id);

CREATE INDEX idx_fall_risk_assessments_risk_level ON fall_risk_assessments USING btree (risk_level);

CREATE INDEX idx_fall_risk_assessments_total_score ON fall_risk_assessments USING btree (total_score DESC);

CREATE INDEX idx_family_groups_owner ON family_groups USING btree (owner_id);

CREATE INDEX idx_family_history_records_owner ON family_history_records USING btree (owner_id);

CREATE INDEX idx_gcs_assessments_assessed_at ON gcs_assessments USING btree (assessed_at DESC);

CREATE INDEX idx_gcs_assessments_assessed_by ON gcs_assessments USING btree (assessed_by);

CREATE INDEX idx_gcs_assessments_patient ON gcs_assessments USING btree (patient_id);

CREATE INDEX idx_gcs_assessments_total_score ON gcs_assessments USING btree (total_score);

CREATE INDEX idx_governance_decisions_subject ON governance_decisions USING btree (subject_type, subject_id, status);

CREATE INDEX idx_guardian_disputed ON guardian_relationships USING btree (ward_patient_id) WHERE dispute_flag;

CREATE INDEX idx_guardian_relationships_guardian_user ON guardian_relationships USING btree (guardian_user_id) WHERE active;

CREATE INDEX idx_guardian_relationships_ward ON guardian_relationships USING btree (ward_patient_id) WHERE active;

CREATE INDEX idx_guardian_reverification_due ON guardian_relationships USING btree (next_reverification_due) WHERE (active AND (next_reverification_due IS NOT NULL));

CREATE INDEX idx_history_physicals_exam_type ON history_physicals USING btree (exam_type);

CREATE INDEX idx_history_physicals_patient ON history_physicals USING btree (patient_id);

CREATE INDEX idx_history_physicals_performed_at ON history_physicals USING btree (performed_at DESC);

CREATE INDEX idx_history_physicals_performed_by ON history_physicals USING btree (performed_by);

CREATE INDEX idx_idempotency_operations_expiry ON idempotency_operations USING btree (expires_at);

CREATE INDEX idx_immunization_date ON immunization_records USING btree (administration_date);

CREATE INDEX idx_immunization_patient ON immunization_records USING btree (patient_id);

CREATE INDEX idx_immunization_vaccine ON immunization_records USING btree (vaccine_type);

CREATE INDEX idx_incident_reports_datetime ON incident_reports USING btree (incident_datetime DESC);

CREATE INDEX idx_incident_reports_patient ON incident_reports USING btree (patient_id);

CREATE INDEX idx_incident_reports_reporter ON incident_reports USING btree (reporter_id);

CREATE INDEX idx_incident_reports_severity ON incident_reports USING btree (severity);

CREATE INDEX idx_incident_reports_status ON incident_reports USING btree (investigation_status);

CREATE INDEX idx_incident_reports_type ON incident_reports USING btree (incident_type);

CREATE INDEX idx_insurance_active ON insurance_records USING btree (is_active) WHERE (is_active = true);

CREATE INDEX idx_insurance_cards_owner ON insurance_cards USING btree (owner_id);

CREATE INDEX idx_insurance_claims_owner ON insurance_claims USING btree (owner_id);

CREATE INDEX idx_insurance_patient ON insurance_records USING btree (patient_id);

CREATE INDEX idx_insurance_payer ON insurance_records USING btree (payer_name);

CREATE INDEX idx_insurance_policy ON insurance_records USING btree (policy_number);

CREATE INDEX idx_insurance_subscriber ON insurance_records USING btree (subscriber_id);

CREATE INDEX idx_insurance_type ON insurance_records USING btree (insurance_type);

CREATE INDEX idx_intubation_intubator ON intubation_records USING btree (intubator_id);

CREATE INDEX idx_intubation_patient ON intubation_records USING btree (patient_id);

CREATE INDEX idx_intubation_performed ON intubation_records USING btree (performed_at DESC);

CREATE INDEX idx_intubation_urgency ON intubation_records USING btree (urgency);

CREATE INDEX idx_io_records_date ON io_records USING btree (record_date DESC);

CREATE INDEX idx_io_records_net_balance ON io_records USING btree (net_balance);

CREATE INDEX idx_io_records_patient ON io_records USING btree (patient_id);

CREATE INDEX idx_io_records_recorded_by ON io_records USING btree (recorded_by);

CREATE INDEX idx_io_records_shift ON io_records USING btree (shift);

CREATE INDEX idx_iv_assessments_assessed_at ON iv_assessments USING btree (assessed_at DESC);

CREATE INDEX idx_iv_assessments_assessed_by ON iv_assessments USING btree (assessed_by);

CREATE INDEX idx_iv_assessments_location ON iv_assessments USING btree (site_location);

CREATE INDEX idx_iv_assessments_patency ON iv_assessments USING btree (patency);

CREATE INDEX idx_iv_assessments_patient ON iv_assessments USING btree (patient_id);

CREATE INDEX idx_iv_assessments_site_id ON iv_assessments USING btree (site_id);

CREATE INDEX idx_key_envelopes_record ON key_envelopes USING btree (record_id, status);

CREATE INDEX idx_key_usage_active ON key_usage_index USING btree (key_id, active);

CREATE INDEX idx_lab_calibrations_owner ON lab_calibrations USING btree (owner_id);

CREATE INDEX idx_lab_calibrations_performed_at ON lab_calibrations USING btree (((data ->> 'performed_at'::text)));

CREATE INDEX idx_lab_qc_instrument ON lab_qc_records USING btree (instrument_id);

CREATE INDEX idx_lab_qc_passed ON lab_qc_records USING btree (passed);

CREATE INDEX idx_lab_qc_performed ON lab_qc_records USING btree (performed_at DESC);

CREATE INDEX idx_lab_qc_test ON lab_qc_records USING btree (test_code);

CREATE INDEX idx_lab_result_submissions_owner ON lab_result_submissions USING btree (owner_id);

CREATE INDEX idx_lab_submissions_date ON lab_submissions USING btree (order_date DESC);

CREATE INDEX idx_lab_submissions_patient ON lab_submissions USING btree (patient_id);

CREATE INDEX idx_lab_submissions_priority ON lab_submissions USING btree (priority);

CREATE INDEX idx_lab_submissions_provider ON lab_submissions USING btree (ordering_provider_id);

CREATE INDEX idx_lab_submissions_status ON lab_submissions USING btree (status);

CREATE INDEX idx_laceration_location ON laceration_repairs USING btree (location);

CREATE INDEX idx_laceration_patient ON laceration_repairs USING btree (patient_id);

CREATE INDEX idx_laceration_performed ON laceration_repairs USING btree (performed_at DESC);

CREATE INDEX idx_language_preferences_owner ON language_preferences USING btree (owner_id);

CREATE INDEX idx_legal_holds_entity ON legal_holds USING btree (entity_type) WHERE (released_at IS NULL);

CREATE INDEX idx_legal_holds_patient ON legal_holds USING btree (patient_id) WHERE (released_at IS NULL);

CREATE INDEX idx_login_contexts_user_expiry ON login_contexts USING btree (user_id, expires_at);

CREATE INDEX idx_managed_devices_rotation_due ON managed_devices USING btree (organization_id, next_rotation_at) WHERE (revoked_at IS NULL);

CREATE INDEX idx_mci_records_datetime ON mci_records USING btree (incident_datetime DESC);

CREATE INDEX idx_mci_records_incident ON mci_records USING btree (incident_id);

CREATE INDEX idx_mci_records_patient ON mci_records USING btree (patient_id);

CREATE INDEX idx_mci_records_tag ON mci_records USING btree (triage_tag_number);

CREATE INDEX idx_mci_records_triage ON mci_records USING btree (triage_category);

CREATE INDEX idx_medical_records_category ON medical_records USING btree (category);

CREATE INDEX idx_medical_records_created ON medical_records USING btree (created_at DESC);

CREATE INDEX idx_medical_records_date ON medical_records USING btree (record_date DESC);

CREATE INDEX idx_medical_records_ipfs ON medical_records USING btree (ipfs_content_hash) WHERE (ipfs_content_hash IS NOT NULL);

CREATE INDEX idx_medical_records_patient ON medical_records USING btree (patient_id);

CREATE INDEX idx_medical_records_type ON medical_records USING btree (record_type);

CREATE INDEX idx_medication_records_date ON medication_records USING btree (record_date DESC);

CREATE INDEX idx_medication_records_nurse ON medication_records USING btree (primary_nurse);

CREATE INDEX idx_medication_records_patient ON medication_records USING btree (patient_id);

CREATE INDEX idx_medication_records_status ON medication_records USING btree (completion_status);

CREATE INDEX idx_message_attachments_message ON message_attachments USING btree (message_id, created_at);

CREATE INDEX idx_messages_owner ON messages USING btree (owner_id);

CREATE INDEX idx_national_id_manual_reviews_pending ON national_id_manual_reviews USING btree (requested_at) WHERE (status = 'pending'::text);

CREATE INDEX idx_nfc_tags_active ON nfc_tags USING btree (is_active) WHERE (is_active = true);

CREATE INDEX idx_nfc_tags_patient ON nfc_tags USING btree (patient_id);

CREATE INDEX idx_nfc_tags_uid ON nfc_tags USING btree (tag_uid);

CREATE INDEX idx_note_templates_owner ON note_templates USING btree (owner_id);

CREATE INDEX idx_nursing_care_plans_care_level ON nursing_care_plans USING btree (care_level);

CREATE INDEX idx_nursing_care_plans_created_by ON nursing_care_plans USING btree (created_by);

CREATE INDEX idx_nursing_care_plans_patient ON nursing_care_plans USING btree (patient_id);

CREATE INDEX idx_nursing_care_plans_start_date ON nursing_care_plans USING btree (start_date DESC);

CREATE INDEX idx_nursing_care_plans_status ON nursing_care_plans USING btree (status);

CREATE INDEX idx_ob_emergencies_gestational ON obstetric_emergencies USING btree (gestational_age_weeks);

CREATE INDEX idx_ob_emergencies_patient ON obstetric_emergencies USING btree (patient_id);

CREATE INDEX idx_ob_emergencies_type ON obstetric_emergencies USING btree (emergency_type);

CREATE INDEX idx_operative_patient ON operative_notes USING btree (patient_id);

CREATE INDEX idx_operative_procedure ON operative_notes USING btree (procedure_name);

CREATE INDEX idx_operative_start ON operative_notes USING btree (start_time DESC);

CREATE INDEX idx_operative_surgeon ON operative_notes USING btree (surgeon_id);

CREATE INDEX idx_order_sets_owner ON order_sets USING btree (owner_id);

CREATE INDEX idx_order_sets_status ON order_sets USING btree (((data ->> 'status'::text)));

CREATE INDEX idx_organization_keys_active ON organization_keys USING btree (organization_id, purpose, status, version DESC);

CREATE INDEX idx_pathology_pathologist ON pathology_reports USING btree (pathologist_id);

CREATE INDEX idx_pathology_patient ON pathology_reports USING btree (patient_id);

CREATE INDEX idx_pathology_report_date ON pathology_reports USING btree (report_date DESC);

CREATE INDEX idx_pathology_specimen_type ON pathology_reports USING btree (specimen_type);

CREATE INDEX idx_pathology_status ON pathology_reports USING btree (status);

CREATE INDEX idx_patient_access_grants_expiring ON patient_access_grants USING btree (expires_at) WHERE ((status = 'active'::text) AND (expires_at IS NOT NULL));

CREATE INDEX idx_patient_access_grants_patient ON patient_access_grants USING btree (patient_id, granted_at DESC);

CREATE INDEX idx_patient_access_requests_patient ON patient_access_requests USING btree (patient_id, requested_at DESC);

CREATE INDEX idx_patient_mobile_devices_patient ON patient_mobile_devices USING btree (patient_id, status);

CREATE INDEX idx_patient_profiles_person ON patient_profiles USING btree (person_id);

CREATE INDEX idx_patients_created ON patients USING btree (created_at DESC);

CREATE INDEX idx_patients_health_id ON patients USING btree (health_id);

CREATE INDEX idx_patients_name_search_tokens ON patients USING gin (name_search_tokens) WHERE (is_active = true);

CREATE INDEX idx_patients_national_id_hash ON patients USING btree (national_id_hash);

CREATE INDEX idx_patients_primary_provider ON patients USING btree (primary_provider_id);

CREATE INDEX idx_peds_assessments_age ON pediatric_assessments USING btree (age_months);

CREATE INDEX idx_peds_assessments_cps ON pediatric_assessments USING btree (child_protective_concerns) WHERE (child_protective_concerns = true);

CREATE INDEX idx_peds_assessments_patient ON pediatric_assessments USING btree (patient_id);

CREATE INDEX idx_pharmacy_decisions_decision ON pharmacy_decisions USING btree (((data ->> 'decision'::text)));

CREATE INDEX idx_pharmacy_decisions_owner ON pharmacy_decisions USING btree (owner_id);

CREATE INDEX idx_pharmacy_decisions_prescriber ON pharmacy_decisions USING btree (((data ->> 'prescriber_id'::text)));

CREATE INDEX idx_physician_orders_patient ON physician_orders USING btree (patient_id);

CREATE INDEX idx_physician_orders_priority ON physician_orders USING btree (priority) WHERE ((priority)::text = ANY ((ARRAY['stat'::character varying, 'asap'::character varying])::text[]));

CREATE INDEX idx_physician_orders_provider ON physician_orders USING btree (ordering_provider_id);

CREATE INDEX idx_physician_orders_status ON physician_orders USING btree (status);

CREATE INDEX idx_physician_orders_type ON physician_orders USING btree (order_type);

CREATE INDEX idx_postop_date ON post_op_notes USING btree (note_date DESC);

CREATE INDEX idx_postop_day ON post_op_notes USING btree (post_op_day);

CREATE INDEX idx_postop_operative ON post_op_notes USING btree (operative_note_id);

CREATE INDEX idx_postop_patient ON post_op_notes USING btree (patient_id);

CREATE INDEX idx_preop_cleared ON pre_op_assessments USING btree (cleared_for_surgery);

CREATE INDEX idx_preop_patient ON pre_op_assessments USING btree (patient_id);

CREATE INDEX idx_preop_scheduled ON pre_op_assessments USING btree (scheduled_date);

CREATE INDEX idx_preop_surgeon ON pre_op_assessments USING btree (surgeon_id);

CREATE INDEX idx_prescription_refill_requests_open_by_prescriber ON prescription_refill_requests USING btree (prescriber_id, created_at) WHERE (status = 'requested'::text);

CREATE INDEX idx_prescription_refill_requests_patient ON prescription_refill_requests USING btree (patient_id, created_at DESC);

CREATE INDEX idx_prescription_verification_events_owner ON prescription_verification_events USING btree (owner_id);

CREATE INDEX idx_prescription_verification_events_prescription ON prescription_verification_events USING btree (((data ->> 'prescription_id'::text)));

CREATE INDEX idx_processing_restrictions_active ON processing_restrictions USING btree (patient_id) WHERE (lifted_at IS NULL);

CREATE INDEX idx_professional_identities_person ON professional_identities USING btree (person_id);

CREATE INDEX idx_profiles_department ON user_profiles USING btree (department) WHERE (department IS NOT NULL);

CREATE INDEX idx_profiles_specialty ON user_profiles USING btree (specialty) WHERE (specialty IS NOT NULL);

CREATE INDEX idx_profiles_user ON user_profiles USING btree (user_id);

CREATE INDEX idx_progress_notes_created_at ON progress_notes USING btree (created_at DESC);

CREATE INDEX idx_progress_notes_created_by ON progress_notes USING btree (created_by);

CREATE INDEX idx_progress_notes_encounter ON progress_notes USING btree (encounter_id);

CREATE INDEX idx_progress_notes_patient ON progress_notes USING btree (patient_id);

CREATE INDEX idx_progress_notes_type ON progress_notes USING btree (note_type);

CREATE INDEX idx_protected_mobile_record_sessions_active ON protected_mobile_record_sessions USING btree (device_id, expires_at) WHERE (status = 'active'::text);

CREATE INDEX idx_provider_schedules_owner ON provider_schedules USING btree (owner_id);

CREATE INDEX idx_psych_assessments_patient ON psychiatric_assessments USING btree (patient_id);

CREATE INDEX idx_psych_assessments_risk ON psychiatric_assessments USING btree (risk_level);

CREATE INDEX idx_psych_assessments_suicidal ON psychiatric_assessments USING btree (suicidal_ideation) WHERE (suicidal_ideation = true);

CREATE INDEX idx_radiology_orders_accession ON radiology_orders USING btree (accession_number);

CREATE INDEX idx_radiology_orders_modality ON radiology_orders USING btree (modality);

CREATE INDEX idx_radiology_orders_patient ON radiology_orders USING btree (patient_id);

CREATE INDEX idx_radiology_orders_provider ON radiology_orders USING btree (ordering_provider_id);

CREATE INDEX idx_radiology_orders_scheduled ON radiology_orders USING btree (scheduled_datetime);

CREATE INDEX idx_radiology_orders_status ON radiology_orders USING btree (status);

CREATE INDEX idx_radiology_reports_critical ON radiology_reports USING btree (critical_finding);

CREATE INDEX idx_radiology_reports_datetime ON radiology_reports USING btree (report_datetime DESC);

CREATE INDEX idx_radiology_reports_order ON radiology_reports USING btree (order_id);

CREATE INDEX idx_radiology_reports_patient ON radiology_reports USING btree (patient_id);

CREATE INDEX idx_radiology_reports_radiologist ON radiology_reports USING btree (radiologist_id);

CREATE INDEX idx_radiology_reports_status ON radiology_reports USING btree (status);

CREATE UNIQUE INDEX idx_recollection_one_open_per_rejection ON specimen_recollection_requests USING btree (rejection_id) WHERE ((status)::text = 'requested'::text);

CREATE INDEX idx_recollection_patient ON specimen_recollection_requests USING btree (patient_id);

CREATE INDEX idx_recollection_requested_at ON specimen_recollection_requests USING btree (requested_at DESC);

CREATE INDEX idx_recollection_status ON specimen_recollection_requests USING btree (status);

CREATE INDEX idx_rejection_category ON specimen_rejections USING btree (rejection_category);

CREATE INDEX idx_rejection_date ON specimen_rejections USING btree (rejected_at DESC);

CREATE INDEX idx_rejection_patient ON specimen_rejections USING btree (patient_id);

CREATE INDEX idx_rejection_specimen ON specimen_rejections USING btree (specimen_id);

CREATE INDEX idx_reminder_active ON medication_reminders USING btree (is_active);

CREATE INDEX idx_reminder_patient ON medication_reminders USING btree (patient_id);

CREATE INDEX idx_reminder_prescription ON medication_reminders USING btree (prescription_id);

CREATE INDEX idx_reminder_time ON medication_reminders USING btree (scheduled_time);

CREATE INDEX idx_research_export_runs_created ON research_export_runs USING btree (created_at DESC);

CREATE INDEX idx_retention_approvals_open ON retention_approvals USING btree (requested_at DESC) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying])::text[]));

CREATE INDEX idx_retention_jobs_policy ON retention_job_runs USING btree (policy_id);

CREATE INDEX idx_retention_jobs_status ON retention_job_runs USING btree (status);

CREATE INDEX idx_retention_policies_active ON data_retention_policies USING btree (is_active);

CREATE INDEX idx_retention_policies_entity ON data_retention_policies USING btree (entity_type);

CREATE INDEX idx_satisfaction_surveys_owner ON satisfaction_surveys USING btree (owner_id);

CREATE UNIQUE INDEX idx_scanner_settings_owner ON scanner_settings USING btree (owner_id);

CREATE INDEX idx_security_alerts_created_at ON security_alerts USING btree (created_at DESC);

CREATE INDEX idx_sepsis_level ON sepsis_assessments USING btree (sepsis_level);

CREATE INDEX idx_sepsis_patient ON sepsis_assessments USING btree (patient_id);

CREATE INDEX idx_sepsis_shock ON sepsis_assessments USING btree (sepsis_level) WHERE ((sepsis_level)::text = 'SepticShock'::text);

CREATE INDEX idx_sepsis_time ON sepsis_assessments USING btree (assessment_time DESC);

CREATE INDEX idx_shift_handoffs_datetime ON shift_handoffs USING btree (handoff_datetime DESC);

CREATE INDEX idx_shift_handoffs_incoming ON shift_handoffs USING btree (incoming_provider_id);

CREATE INDEX idx_shift_handoffs_outgoing ON shift_handoffs USING btree (outgoing_provider_id);

CREATE INDEX idx_shift_handoffs_patient ON shift_handoffs USING btree (patient_id);

CREATE INDEX idx_sms_opt_outs_phone ON sms_opt_outs USING btree (phone_number);

CREATE INDEX idx_soap_created_by ON soap_notes USING btree (created_by);

CREATE INDEX idx_soap_date ON soap_notes USING btree (visit_date DESC);

CREATE INDEX idx_soap_note_records_owner ON soap_note_records USING btree (owner_id);

CREATE INDEX idx_soap_patient ON soap_notes USING btree (patient_id);

CREATE INDEX idx_soap_signed ON soap_notes USING btree (is_signed);

CREATE INDEX idx_specimen_barcode ON specimen_collections USING btree (barcode);

CREATE INDEX idx_specimen_collected ON specimen_collections USING btree (collected_at DESC);

CREATE INDEX idx_specimen_patient ON specimen_collections USING btree (patient_id);

CREATE INDEX idx_specimen_submission ON specimen_collections USING btree (submission_id);

CREATE INDEX idx_splint_applied ON splint_cast_records USING btree (applied_at DESC);

CREATE INDEX idx_splint_location ON splint_cast_records USING btree (injury_location);

CREATE INDEX idx_splint_patient ON splint_cast_records USING btree (patient_id);

CREATE INDEX idx_splint_type ON splint_cast_records USING btree (immobilization_type);

CREATE INDEX idx_stroke_nihss ON stroke_assessments USING btree (nihss_score);

CREATE INDEX idx_stroke_patient ON stroke_assessments USING btree (patient_id);

CREATE INDEX idx_stroke_time ON stroke_assessments USING btree (assessment_time DESC);

CREATE INDEX idx_stroke_type ON stroke_assessments USING btree (stroke_type);

CREATE INDEX idx_symptom_entries_owner ON symptom_entries USING btree (owner_id);

CREATE INDEX idx_symptom_sessions_owner ON symptom_sessions USING btree (owner_id);

CREATE INDEX idx_sync_conflicts_entity ON sync_conflicts USING btree (entity_type, entity_id);

CREATE INDEX idx_sync_conflicts_op ON sync_conflicts USING btree (sync_operation_id);

CREATE INDEX idx_sync_conflicts_status ON sync_conflicts USING btree (status);

CREATE INDEX idx_sync_devices_owner ON sync_devices USING btree (owner_id);

CREATE INDEX idx_sync_queue_items_owner ON sync_queue_items USING btree (owner_id);

CREATE INDEX idx_telehealth_recordings_session ON telehealth_recordings USING btree (session_id, created_at DESC);

CREATE INDEX idx_telehealth_session_records_owner ON telehealth_session_records USING btree (owner_id);

CREATE INDEX idx_tox_assessments_exposure ON toxicology_assessments USING btree (exposure_type);

CREATE INDEX idx_tox_assessments_intentional ON toxicology_assessments USING btree (intentionality);

CREATE INDEX idx_tox_assessments_patient ON toxicology_assessments USING btree (patient_id);

CREATE INDEX idx_transfusion_event_records_owner ON transfusion_event_records USING btree (owner_id);

CREATE INDEX idx_trauma_level ON trauma_assessments USING btree (trauma_level);

CREATE INDEX idx_trauma_patient ON trauma_assessments USING btree (patient_id);

CREATE INDEX idx_trauma_time ON trauma_assessments USING btree (assessment_time DESC);

CREATE INDEX idx_trauma_type ON trauma_assessments USING btree (trauma_type);

CREATE INDEX idx_triage_critical ON triage_assessments USING btree (is_critical) WHERE (is_critical = true);

CREATE INDEX idx_triage_esi ON triage_assessments USING btree (esi_level);

CREATE INDEX idx_triage_patient ON triage_assessments USING btree (patient_id);

CREATE INDEX idx_triage_time ON triage_assessments USING btree (triage_time DESC);

CREATE INDEX idx_used_emergency_tokens_owner ON used_emergency_tokens USING btree (owner_id);

CREATE UNIQUE INDEX idx_user_avatars_owner ON user_avatars USING btree (owner_id);

CREATE INDEX idx_user_setting_records_owner ON user_setting_records USING btree (owner_id);

CREATE INDEX idx_users_active ON users USING btree (is_active) WHERE (is_active = true);

CREATE INDEX idx_users_created ON users USING btree (created_at DESC);

CREATE INDEX idx_users_email ON users USING btree (email) WHERE (email IS NOT NULL);

CREATE INDEX idx_users_role ON users USING btree (role);

CREATE INDEX idx_users_status ON users USING btree (status);

CREATE INDEX idx_users_username ON users USING btree (username) WHERE (username IS NOT NULL);

CREATE INDEX idx_vitals_critical ON vital_signs USING btree (is_critical) WHERE (is_critical = true);

CREATE INDEX idx_vitals_patient ON vital_signs USING btree (patient_id);

CREATE INDEX idx_vitals_patient_time ON vital_signs USING btree (patient_id, recorded_at DESC);

CREATE INDEX idx_vitals_time ON vital_signs USING btree (recorded_at DESC);

CREATE INDEX idx_wearable_alert_records_owner ON wearable_alert_records USING btree (owner_id);

CREATE INDEX idx_wearable_alert_rules_owner ON wearable_alert_rules USING btree (owner_id);

CREATE INDEX idx_wearable_device_records_owner ON wearable_device_records USING btree (owner_id);

CREATE INDEX idx_wearable_reading_records_owner ON wearable_reading_records USING btree (owner_id);

CREATE INDEX idx_wound_assessments_assessed_at ON wound_assessments USING btree (assessed_at DESC);

CREATE INDEX idx_wound_assessments_assessed_by ON wound_assessments USING btree (assessed_by);

CREATE INDEX idx_wound_assessments_location ON wound_assessments USING btree (wound_location);

CREATE INDEX idx_wound_assessments_patient ON wound_assessments USING btree (patient_id);

CREATE INDEX idx_wound_assessments_type ON wound_assessments USING btree (wound_type);

CREATE INDEX idx_wound_assessments_wound_id ON wound_assessments USING btree (wound_id);

CREATE UNIQUE INDEX uq_patient_access_grants_source_request ON patient_access_grants USING btree (source_request_id) WHERE (source_request_id IS NOT NULL);

CREATE UNIQUE INDEX uq_patient_access_requests_pending_provider ON patient_access_requests USING btree (patient_id, provider_id) WHERE (status = 'pending'::text);

CREATE UNIQUE INDEX uq_prescription_refill_one_open_request ON prescription_refill_requests USING btree (prescription_id) WHERE (status = 'requested'::text);

CREATE UNIQUE INDEX uq_prescription_verification_one_open_request ON prescription_verification_events USING btree (((data ->> 'prescription_id'::text))) WHERE (((data ->> 'event_type'::text) = 'verification_requested'::text) AND (COALESCE(((data ->> 'closed'::text))::boolean, false) = false));

CREATE UNIQUE INDEX users_email_lower_key ON users USING btree (lower((email)::text)) WHERE (email IS NOT NULL);

CREATE UNIQUE INDEX users_login_id_lower_key ON users USING btree (lower((login_id)::text)) WHERE (login_id IS NOT NULL);

CREATE TRIGGER medical_id_issuances_immutable BEFORE DELETE OR UPDATE ON medical_id_issuances FOR EACH ROW EXECUTE FUNCTION prevent_medical_id_reuse();

CREATE TRIGGER patients_freeze_health_id BEFORE UPDATE OF health_id ON patients FOR EACH ROW EXECUTE FUNCTION freeze_patient_health_id();

CREATE TRIGGER patients_register_medical_id AFTER INSERT ON patients FOR EACH ROW EXECUTE FUNCTION register_medical_id();

CREATE TRIGGER trg_ama_discharges_updated_at BEFORE UPDATE ON ama_discharges FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_burn_assessments_updated_at BEFORE UPDATE ON burn_assessments FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_cds_alerts_updated_at BEFORE UPDATE ON cds_alerts FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_chain_custody_updated_at BEFORE UPDATE ON chain_of_custody FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_consent_records_updated_at BEFORE UPDATE ON consent_records FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_data_retention_policies_updated_at BEFORE UPDATE ON data_retention_policies FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_discharge_instructions_updated_at BEFORE UPDATE ON discharge_instructions FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_discharge_summaries_updated_at BEFORE UPDATE ON discharge_summaries FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_ems_handoffs_updated_at BEFORE UPDATE ON ems_handoffs FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_immunization_records_updated_at BEFORE UPDATE ON immunization_records FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_incident_reports_updated_at BEFORE UPDATE ON incident_reports FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_insurance_records_updated_at BEFORE UPDATE ON insurance_records FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_mci_records_updated_at BEFORE UPDATE ON mci_records FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_obstetric_emergencies_updated_at BEFORE UPDATE ON obstetric_emergencies FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_pediatric_assessments_updated_at BEFORE UPDATE ON pediatric_assessments FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_physician_orders_updated_at BEFORE UPDATE ON physician_orders FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_psychiatric_assessments_updated_at BEFORE UPDATE ON psychiatric_assessments FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_retention_job_runs_updated_at BEFORE UPDATE ON retention_job_runs FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_shift_handoffs_updated_at BEFORE UPDATE ON shift_handoffs FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER trg_sync_conflicts_updated_at BEFORE UPDATE ON sync_conflicts FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_toxicology_assessments_updated_at BEFORE UPDATE ON toxicology_assessments FOR EACH ROW EXECUTE FUNCTION update_phase4_timestamp();

CREATE TRIGGER update_anesthesia_records_updated_at BEFORE UPDATE ON anesthesia_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cardiac_events_updated_at BEFORE UPDATE ON cardiac_events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_code_blue_records_updated_at BEFORE UPDATE ON code_blue_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_consultation_notes_updated_at BEFORE UPDATE ON consultation_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_fall_risk_assessments_updated_at BEFORE UPDATE ON fall_risk_assessments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_gcs_assessments_updated_at BEFORE UPDATE ON gcs_assessments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_history_physicals_updated_at BEFORE UPDATE ON history_physicals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_intubation_records_updated_at BEFORE UPDATE ON intubation_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_io_records_updated_at BEFORE UPDATE ON io_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_iv_assessments_updated_at BEFORE UPDATE ON iv_assessments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lab_submissions_updated_at BEFORE UPDATE ON lab_submissions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_laceration_repairs_updated_at BEFORE UPDATE ON laceration_repairs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_medical_records_updated_at BEFORE UPDATE ON medical_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_medication_records_updated_at BEFORE UPDATE ON medication_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_medication_reminders_updated_at BEFORE UPDATE ON medication_reminders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_nursing_care_plans_updated_at BEFORE UPDATE ON nursing_care_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_operative_notes_updated_at BEFORE UPDATE ON operative_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pathology_reports_updated_at BEFORE UPDATE ON pathology_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_patients_updated_at BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_post_op_notes_updated_at BEFORE UPDATE ON post_op_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pre_op_assessments_updated_at BEFORE UPDATE ON pre_op_assessments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_progress_notes_updated_at BEFORE UPDATE ON progress_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_radiology_orders_updated_at BEFORE UPDATE ON radiology_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_radiology_reports_updated_at BEFORE UPDATE ON radiology_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sepsis_assessments_updated_at BEFORE UPDATE ON sepsis_assessments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_soap_notes_updated_at BEFORE UPDATE ON soap_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_specimen_collections_updated_at BEFORE UPDATE ON specimen_collections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_splint_cast_records_updated_at BEFORE UPDATE ON splint_cast_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_stroke_assessments_updated_at BEFORE UPDATE ON stroke_assessments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trauma_assessments_updated_at BEFORE UPDATE ON trauma_assessments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_triage_assessments_updated_at BEFORE UPDATE ON triage_assessments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_wound_assessments_updated_at BEFORE UPDATE ON wound_assessments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE ONLY access_contexts
    ADD CONSTRAINT access_contexts_clinician_fkey FOREIGN KEY (clinician_id) REFERENCES users(id_text);

ALTER TABLE ONLY access_contexts
    ADD CONSTRAINT access_contexts_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY access_logs
    ADD CONSTRAINT access_logs_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY adherence_logs
    ADD CONSTRAINT adherence_logs_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY adherence_logs
    ADD CONSTRAINT adherence_logs_reminder_id_fkey FOREIGN KEY (reminder_id) REFERENCES medication_reminders(id);

ALTER TABLE ONLY ama_discharges
    ADD CONSTRAINT ama_discharges_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY anesthesia_records
    ADD CONSTRAINT anesthesia_records_operative_note_id_fkey FOREIGN KEY (operative_note_id) REFERENCES operative_notes(id);

ALTER TABLE ONLY anesthesia_records
    ADD CONSTRAINT anesthesia_records_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY appointments
    ADD CONSTRAINT appointments_parent_appointment_id_fkey FOREIGN KEY (parent_appointment_id) REFERENCES appointments(id);

ALTER TABLE ONLY appointments
    ADD CONSTRAINT appointments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY appointments
    ADD CONSTRAINT appointments_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES users(id_text);

ALTER TABLE ONLY audit_seal_batch_members
    ADD CONSTRAINT audit_seal_batch_members_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES audit_seal_batches(id) ON DELETE RESTRICT;

ALTER TABLE ONLY auth_login_sessions
    ADD CONSTRAINT auth_login_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE ONLY auth_security_events
    ADD CONSTRAINT auth_security_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE ONLY auth_sessions
    ADD CONSTRAINT auth_sessions_login_session_fk FOREIGN KEY (login_session_id) REFERENCES auth_login_sessions(id);

ALTER TABLE ONLY auth_sessions
    ADD CONSTRAINT auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE ONLY auth_transaction_challenges
    ADD CONSTRAINT auth_transaction_challenges_login_session_id_fkey FOREIGN KEY (login_session_id) REFERENCES auth_login_sessions(id);

ALTER TABLE ONLY auth_transaction_challenges
    ADD CONSTRAINT auth_transaction_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE ONLY blood_units
    ADD CONSTRAINT blood_units_issued_to_patient_id_fkey FOREIGN KEY (issued_to_patient_id) REFERENCES patients(id) ON DELETE RESTRICT;

ALTER TABLE ONLY blood_units
    ADD CONSTRAINT blood_units_reserved_for_patient_id_fkey FOREIGN KEY (reserved_for_patient_id) REFERENCES patients(id) ON DELETE SET NULL;

ALTER TABLE ONLY break_glass_grants
    ADD CONSTRAINT break_glass_grants_clinician_fkey FOREIGN KEY (clinician_id) REFERENCES users(id_text);

ALTER TABLE ONLY break_glass_grants
    ADD CONSTRAINT break_glass_grants_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY burn_assessments
    ADD CONSTRAINT burn_assessments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY cardiac_events
    ADD CONSTRAINT cardiac_events_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY care_relationships
    ADD CONSTRAINT care_relationships_clinician_fkey FOREIGN KEY (clinician_id) REFERENCES users(id_text);

ALTER TABLE ONLY care_relationships
    ADD CONSTRAINT care_relationships_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY chain_of_custody
    ADD CONSTRAINT chain_of_custody_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY claim_eob_documents
    ADD CONSTRAINT claim_eob_documents_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY code_blue_records
    ADD CONSTRAINT code_blue_records_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY consent_records
    ADD CONSTRAINT consent_records_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY consultation_notes
    ADD CONSTRAINT consultation_notes_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY credential_grants
    ADD CONSTRAINT credential_grants_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES users(id);

ALTER TABLE ONLY credential_grants
    ADD CONSTRAINT credential_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE ONLY critical_values
    ADD CONSTRAINT critical_values_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY deletion_register
    ADD CONSTRAINT deletion_register_approval_token_fkey FOREIGN KEY (approval_token) REFERENCES retention_approvals(token);

ALTER TABLE ONLY device_keys
    ADD CONSTRAINT device_keys_device_id_fkey FOREIGN KEY (device_id) REFERENCES managed_devices(id);

ALTER TABLE ONLY device_keys
    ADD CONSTRAINT device_keys_replaced_by_fkey FOREIGN KEY (replaced_by) REFERENCES device_keys(id);

ALTER TABLE ONLY discharge_instructions
    ADD CONSTRAINT discharge_instructions_discharge_summary_id_fkey FOREIGN KEY (discharge_summary_id) REFERENCES discharge_summaries(id);

ALTER TABLE ONLY discharge_instructions
    ADD CONSTRAINT discharge_instructions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY discharge_summaries
    ADD CONSTRAINT discharge_summaries_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY emergency_access_grants
    ADD CONSTRAINT emergency_access_grants_device_id_fkey FOREIGN KEY (device_id) REFERENCES managed_devices(id);

ALTER TABLE ONLY emergency_access_grants
    ADD CONSTRAINT emergency_access_grants_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id);

ALTER TABLE ONLY emergency_access_grants
    ADD CONSTRAINT emergency_access_grants_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id);

ALTER TABLE ONLY ems_handoffs
    ADD CONSTRAINT ems_handoffs_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY facilities
    ADD CONSTRAINT facilities_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id);

ALTER TABLE ONLY fall_risk_assessments
    ADD CONSTRAINT fall_risk_assessments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY consent_records
    ADD CONSTRAINT fk_consent_guardian_authority FOREIGN KEY (guardian_authority_evidence_id) REFERENCES guardian_relationships(id) ON DELETE SET NULL NOT VALID;

ALTER TABLE ONLY guardian_relationships
    ADD CONSTRAINT fk_guardian_supersedes FOREIGN KEY (supersedes_relationship_id) REFERENCES guardian_relationships(id) ON DELETE SET NULL NOT VALID;

ALTER TABLE ONLY gcs_assessments
    ADD CONSTRAINT gcs_assessments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY history_physicals
    ADD CONSTRAINT history_physicals_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY immunization_records
    ADD CONSTRAINT immunization_records_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY incident_reports
    ADD CONSTRAINT incident_reports_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY intubation_records
    ADD CONSTRAINT intubation_records_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY io_records
    ADD CONSTRAINT io_records_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY iv_assessments
    ADD CONSTRAINT iv_assessments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY key_envelopes
    ADD CONSTRAINT key_envelopes_recipient_key_id_fkey FOREIGN KEY (recipient_key_id) REFERENCES organization_keys(id);

ALTER TABLE ONLY key_envelopes
    ADD CONSTRAINT key_envelopes_record_id_fkey FOREIGN KEY (record_id) REFERENCES record_crypto_metadata(record_id);

ALTER TABLE ONLY key_envelopes
    ADD CONSTRAINT key_envelopes_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES key_envelopes(id);

ALTER TABLE ONLY key_usage_index
    ADD CONSTRAINT key_usage_index_envelope_id_fkey FOREIGN KEY (envelope_id) REFERENCES key_envelopes(id);

ALTER TABLE ONLY key_usage_index
    ADD CONSTRAINT key_usage_index_key_id_fkey FOREIGN KEY (key_id) REFERENCES organization_keys(id);

ALTER TABLE ONLY lab_submissions
    ADD CONSTRAINT lab_submissions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY laceration_repairs
    ADD CONSTRAINT laceration_repairs_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY login_contexts
    ADD CONSTRAINT login_contexts_device_id_fkey FOREIGN KEY (device_id) REFERENCES managed_devices(id);

ALTER TABLE ONLY login_contexts
    ADD CONSTRAINT login_contexts_organization_assignment_id_fkey FOREIGN KEY (organization_assignment_id) REFERENCES organization_assignments(id);

ALTER TABLE ONLY login_contexts
    ADD CONSTRAINT login_contexts_patient_profile_id_fkey FOREIGN KEY (patient_profile_id) REFERENCES patient_profiles(id);

ALTER TABLE ONLY login_contexts
    ADD CONSTRAINT login_contexts_person_id_fkey FOREIGN KEY (person_id) REFERENCES persons(id);

ALTER TABLE ONLY login_contexts
    ADD CONSTRAINT login_contexts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE ONLY managed_devices
    ADD CONSTRAINT managed_devices_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id);

ALTER TABLE ONLY managed_devices
    ADD CONSTRAINT managed_devices_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id);

ALTER TABLE ONLY mci_records
    ADD CONSTRAINT mci_records_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY medical_records
    ADD CONSTRAINT medical_records_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY medication_records
    ADD CONSTRAINT medication_records_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY medication_reminders
    ADD CONSTRAINT medication_reminders_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY message_attachments
    ADD CONSTRAINT message_attachments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY nfc_tags
    ADD CONSTRAINT nfc_tags_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY nursing_care_plans
    ADD CONSTRAINT nursing_care_plans_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY obstetric_emergencies
    ADD CONSTRAINT obstetric_emergencies_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY operative_notes
    ADD CONSTRAINT operative_notes_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY operative_notes
    ADD CONSTRAINT operative_notes_pre_op_assessment_id_fkey FOREIGN KEY (pre_op_assessment_id) REFERENCES pre_op_assessments(id);

ALTER TABLE ONLY organization_assignments
    ADD CONSTRAINT organization_assignments_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id);

ALTER TABLE ONLY organization_assignments
    ADD CONSTRAINT organization_assignments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id);

ALTER TABLE ONLY organization_assignments
    ADD CONSTRAINT organization_assignments_professional_identity_id_fkey FOREIGN KEY (professional_identity_id) REFERENCES professional_identities(id);

ALTER TABLE ONLY organization_keys
    ADD CONSTRAINT organization_keys_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id);

ALTER TABLE ONLY organization_keys
    ADD CONSTRAINT organization_keys_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id);

ALTER TABLE ONLY organization_keys
    ADD CONSTRAINT organization_keys_replaced_by_fkey FOREIGN KEY (replaced_by) REFERENCES organization_keys(id);

ALTER TABLE ONLY organizations
    ADD CONSTRAINT organizations_parent_organization_id_fkey FOREIGN KEY (parent_organization_id) REFERENCES organizations(id);

ALTER TABLE ONLY pathology_reports
    ADD CONSTRAINT pathology_reports_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY pathology_reports
    ADD CONSTRAINT pathology_reports_specimen_id_fkey FOREIGN KEY (specimen_id) REFERENCES specimen_collections(id);

ALTER TABLE ONLY patient_access_grants
    ADD CONSTRAINT patient_access_grants_provider_fkey FOREIGN KEY (provider_id) REFERENCES users(id_text);

ALTER TABLE ONLY patient_access_grants
    ADD CONSTRAINT patient_access_grants_source_request_id_fkey FOREIGN KEY (source_request_id) REFERENCES patient_access_requests(id);

ALTER TABLE ONLY patient_access_requests
    ADD CONSTRAINT patient_access_requests_provider_fkey FOREIGN KEY (provider_id) REFERENCES users(id_text);

ALTER TABLE ONLY patient_demographics
    ADD CONSTRAINT patient_demographics_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY patient_profiles
    ADD CONSTRAINT patient_profiles_person_id_fkey FOREIGN KEY (person_id) REFERENCES persons(id);

ALTER TABLE ONLY pediatric_assessments
    ADD CONSTRAINT pediatric_assessments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY persons
    ADD CONSTRAINT persons_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE ONLY physician_orders
    ADD CONSTRAINT physician_orders_linked_order_id_fkey FOREIGN KEY (linked_order_id) REFERENCES physician_orders(id);

ALTER TABLE ONLY physician_orders
    ADD CONSTRAINT physician_orders_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY post_op_notes
    ADD CONSTRAINT post_op_notes_operative_note_id_fkey FOREIGN KEY (operative_note_id) REFERENCES operative_notes(id);

ALTER TABLE ONLY post_op_notes
    ADD CONSTRAINT post_op_notes_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY pre_op_assessments
    ADD CONSTRAINT pre_op_assessments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY prescription_refill_requests
    ADD CONSTRAINT prescription_refill_requests_new_prescription_id_fkey FOREIGN KEY (new_prescription_id) REFERENCES e_prescription_v2_records(id) ON DELETE RESTRICT;

ALTER TABLE ONLY prescription_refill_requests
    ADD CONSTRAINT prescription_refill_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY prescription_refill_requests
    ADD CONSTRAINT prescription_refill_requests_prescription_id_fkey FOREIGN KEY (prescription_id) REFERENCES e_prescription_v2_records(id) ON DELETE RESTRICT;

ALTER TABLE ONLY processing_restrictions
    ADD CONSTRAINT processing_restrictions_approval_token_fkey FOREIGN KEY (approval_token) REFERENCES retention_approvals(token);

ALTER TABLE ONLY professional_identities
    ADD CONSTRAINT professional_identities_person_id_fkey FOREIGN KEY (person_id) REFERENCES persons(id);

ALTER TABLE ONLY progress_notes
    ADD CONSTRAINT progress_notes_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY protected_mobile_record_sessions
    ADD CONSTRAINT protected_mobile_record_sessions_device_id_fkey FOREIGN KEY (device_id) REFERENCES patient_mobile_devices(id);

ALTER TABLE ONLY psychiatric_assessments
    ADD CONSTRAINT psychiatric_assessments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY radiology_orders
    ADD CONSTRAINT radiology_orders_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY radiology_reports
    ADD CONSTRAINT radiology_reports_order_id_fkey FOREIGN KEY (order_id) REFERENCES radiology_orders(id);

ALTER TABLE ONLY radiology_reports
    ADD CONSTRAINT radiology_reports_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY record_crypto_metadata
    ADD CONSTRAINT record_crypto_metadata_origin_facility_id_fkey FOREIGN KEY (origin_facility_id) REFERENCES facilities(id);

ALTER TABLE ONLY record_crypto_metadata
    ADD CONSTRAINT record_crypto_metadata_origin_organization_id_fkey FOREIGN KEY (origin_organization_id) REFERENCES organizations(id);

ALTER TABLE ONLY retention_job_runs
    ADD CONSTRAINT retention_job_runs_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES data_retention_policies(id);

ALTER TABLE ONLY sepsis_assessments
    ADD CONSTRAINT sepsis_assessments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY shift_handoffs
    ADD CONSTRAINT shift_handoffs_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY soap_notes
    ADD CONSTRAINT soap_notes_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY specimen_collections
    ADD CONSTRAINT specimen_collections_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY specimen_collections
    ADD CONSTRAINT specimen_collections_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES lab_submissions(id);

ALTER TABLE ONLY specimen_recollection_requests
    ADD CONSTRAINT specimen_recollection_requests_original_specimen_id_fkey FOREIGN KEY (original_specimen_id) REFERENCES specimen_collections(id);

ALTER TABLE ONLY specimen_recollection_requests
    ADD CONSTRAINT specimen_recollection_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY specimen_recollection_requests
    ADD CONSTRAINT specimen_recollection_requests_rejection_id_fkey FOREIGN KEY (rejection_id) REFERENCES specimen_rejections(id);

ALTER TABLE ONLY specimen_recollection_requests
    ADD CONSTRAINT specimen_recollection_requests_replacement_specimen_id_fkey FOREIGN KEY (replacement_specimen_id) REFERENCES specimen_collections(id);

ALTER TABLE ONLY specimen_rejections
    ADD CONSTRAINT specimen_rejections_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY specimen_rejections
    ADD CONSTRAINT specimen_rejections_specimen_id_fkey FOREIGN KEY (specimen_id) REFERENCES specimen_collections(id);

ALTER TABLE ONLY splint_cast_records
    ADD CONSTRAINT splint_cast_records_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY stroke_assessments
    ADD CONSTRAINT stroke_assessments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY telehealth_recordings
    ADD CONSTRAINT telehealth_recordings_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY toxicology_assessments
    ADD CONSTRAINT toxicology_assessments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE ONLY trauma_assessments
    ADD CONSTRAINT trauma_assessments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY triage_assessments
    ADD CONSTRAINT triage_assessments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY user_mfa
    ADD CONSTRAINT user_mfa_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY user_profiles
    ADD CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY users
    ADD CONSTRAINT users_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id_text);

ALTER TABLE ONLY vital_signs
    ADD CONSTRAINT vital_signs_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE ONLY wound_assessments
    ADD CONSTRAINT wound_assessments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

-- Reference rows

INSERT INTO actor_column_registry (table_name, column_name, kind, sealed, fk, note) VALUES
	('audit_events', 'payload', 'sealed', true, NULL, 'hashed into audit leaves'),
	('audit_events', 'aggregate_id', 'sealed', true, NULL, 'hashed into audit leaves'),
	('emergency_capsules', 'capsule_encrypted', 'sealed', true, NULL, 'capsule commitment covers the verifier ids inside'),
	('key_envelopes', 'recipient_id', 'sealed', true, NULL, 'wrapped keys are bound to the recipient; no writer yet'),
	('auth_login_sessions', 'user_id', 'session', false, NULL, NULL),
	('auth_sessions', 'user_id', 'session', false, NULL, NULL),
	('auth_transaction_challenges', 'user_id', 'session', false, NULL, NULL),
	('auth_security_events', 'user_id', 'session', false, NULL, NULL),
	('login_contexts', 'user_id', 'session', false, NULL, NULL),
	('user_mfa', 'user_id', 'uuid_fk', false, NULL, NULL),
	('persons', 'user_id', 'uuid_fk', false, NULL, NULL),
	('user_profiles', 'user_id', 'uuid_fk', false, NULL, NULL),
	('appointments', 'provider_id', 'user', false, 'users.id_text', NULL),
	('care_relationships', 'clinician_id', 'user', false, 'users.id_text', NULL),
	('access_contexts', 'clinician_id', 'user', false, 'users.id_text', NULL),
	('patient_access_grants', 'provider_id', 'user', false, 'users.id_text', NULL),
	('patient_access_requests', 'provider_id', 'user', false, 'users.id_text', NULL),
	('break_glass_grants', 'clinician_id', 'user', false, 'users.id_text', NULL),
	('users', 'created_by', 'user', false, 'users.id_text', NULL),
	('emergency_capsules', 'created_by', 'user', false, NULL, NULL),
	('guardian_relationships', 'guardian_user_id', 'user', false, NULL, NULL),
	('appointments', 'created_by', 'mixed', false, NULL, NULL),
	('emergency_capsule_access_log', 'accessed_by', 'mixed', false, NULL, NULL),
	('patients', 'registered_by', 'mixed', false, NULL, NULL),
	('ama_discharges', 'attending_physician_id', 'mixed', false, NULL, NULL),
	('ama_discharges', 'signatures_collected_by', 'mixed', false, NULL, NULL),
	('anesthesia_records', 'anesthesiologist_id', 'mixed', false, NULL, NULL),
	('anesthesia_records', 'crna_id', 'mixed', false, NULL, NULL),
	('appointments', 'cancelled_by', 'mixed', false, NULL, NULL),
	('burn_assessments', 'assessed_by', 'mixed', false, NULL, NULL),
	('cardiac_events', 'performed_by', 'mixed', false, NULL, NULL),
	('cds_alerts', 'provider_id', 'mixed', false, NULL, NULL),
	('cds_alerts', 'acknowledged_by', 'mixed', false, NULL, NULL),
	('chain_of_custody', 'collected_by', 'mixed', false, NULL, NULL),
	('chain_of_custody', 'collection_witnessed_by', 'mixed', false, NULL, NULL),
	('chain_of_custody', 'current_custodian_id', 'mixed', false, NULL, NULL),
	('chain_of_custody', 'release_authorized_by', 'mixed', false, NULL, NULL),
	('chain_of_custody', 'destruction_witnessed_by', 'mixed', false, NULL, NULL),
	('claim_eob_documents', 'uploaded_by', 'mixed', false, NULL, NULL),
	('code_blue_records', 'created_by', 'mixed', false, NULL, NULL),
	('consent_records', 'collector_id', 'mixed', false, NULL, NULL),
	('consent_records', 'revoked_by', 'mixed', false, NULL, NULL),
	('consent_records', 'consent_given_by', 'mixed', false, NULL, NULL),
	('consent_records', 'child_maturity_assessed_by', 'mixed', false, NULL, NULL),
	('consultation_notes', 'requesting_provider', 'mixed', false, NULL, NULL),
	('consultation_notes', 'consulting_provider', 'mixed', false, NULL, NULL),
	('critical_values', 'notified_provider_id', 'mixed', false, NULL, NULL),
	('critical_values', 'acknowledged_by', 'mixed', false, NULL, NULL),
	('critical_values', 'reported_by', 'mixed', false, NULL, NULL),
	('data_retention_policies', 'reviewed_by', 'mixed', false, NULL, NULL),
	('deletion_register', 'executed_by', 'mixed', false, NULL, NULL),
	('device_tokens', 'user_id', 'mixed', false, NULL, NULL),
	('discharge_instructions', 'provided_by', 'mixed', false, NULL, NULL),
	('discharge_summaries', 'attending_physician_id', 'mixed', false, NULL, NULL),
	('discharge_summaries', 'dictated_by', 'mixed', false, NULL, NULL),
	('discharge_summaries', 'transcribed_by', 'mixed', false, NULL, NULL),
	('discharge_summaries', 'signed_by', 'mixed', false, NULL, NULL),
	('discharge_summaries', 'addendum_by', 'mixed', false, NULL, NULL),
	('emergency_access_grants', 'requesting_person_id', 'mixed', false, NULL, NULL),
	('emergency_capsules', 'revoked_by', 'mixed', false, NULL, NULL),
	('ems_handoffs', 'receiving_provider_id', 'mixed', false, NULL, NULL),
	('ems_handoffs', 'report_received_by', 'mixed', false, NULL, NULL),
	('fall_risk_assessments', 'assessed_by', 'mixed', false, NULL, NULL),
	('gcs_assessments', 'assessed_by', 'mixed', false, NULL, NULL),
	('guardian_relationships', 'verified_by', 'mixed', false, NULL, NULL),
	('history_physicals', 'performed_by', 'mixed', false, NULL, NULL),
	('idempotency_operations', 'subject', 'mixed', false, NULL, NULL),
	('immunization_records', 'administered_by', 'mixed', false, NULL, NULL),
	('incident_reports', 'reporter_id', 'mixed', false, NULL, NULL),
	('incident_reports', 'patient_notified_by', 'mixed', false, NULL, NULL),
	('incident_reports', 'follow_up_assigned_to', 'mixed', false, NULL, NULL),
	('incident_reports', 'reviewed_by', 'mixed', false, NULL, NULL),
	('insurance_records', 'last_verified_by', 'mixed', false, NULL, NULL),
	('intubation_records', 'intubator_id', 'mixed', false, NULL, NULL),
	('intubation_records', 'assistant_id', 'mixed', false, NULL, NULL),
	('io_records', 'recorded_by', 'mixed', false, NULL, NULL),
	('io_records', 'verified_by', 'mixed', false, NULL, NULL),
	('iv_assessments', 'assessed_by', 'mixed', false, NULL, NULL),
	('lab_qc_records', 'performed_by', 'mixed', false, NULL, NULL),
	('lab_qc_records', 'reviewed_by', 'mixed', false, NULL, NULL),
	('lab_submissions', 'ordering_provider_id', 'mixed', false, NULL, NULL),
	('laceration_repairs', 'performed_by', 'mixed', false, NULL, NULL),
	('legal_holds', 'applied_by', 'mixed', false, NULL, NULL),
	('legal_holds', 'released_by', 'mixed', false, NULL, NULL),
	('mci_records', 'created_by', 'mixed', false, NULL, NULL),
	('medical_records', 'created_by', 'mixed', false, NULL, NULL),
	('medical_records', 'last_modified_by', 'mixed', false, NULL, NULL),
	('medication_records', 'primary_nurse', 'mixed', false, NULL, NULL),
	('message_attachments', 'uploaded_by', 'mixed', false, NULL, NULL),
	('national_id_manual_reviews', 'decided_by', 'mixed', false, NULL, NULL),
	('nfc_tags', 'issued_by', 'mixed', false, NULL, NULL),
	('nursing_care_plans', 'created_by', 'mixed', false, NULL, NULL),
	('nursing_care_plans', 'updated_by', 'mixed', false, NULL, NULL),
	('obstetric_emergencies', 'assessed_by', 'mixed', false, NULL, NULL),
	('obstetric_emergencies', 'ob_physician_id', 'mixed', false, NULL, NULL),
	('operative_notes', 'surgeon_id', 'mixed', false, NULL, NULL),
	('operative_notes', 'anesthesiologist_id', 'mixed', false, NULL, NULL),
	('operative_notes', 'scrub_nurse_id', 'mixed', false, NULL, NULL),
	('operative_notes', 'circulating_nurse_id', 'mixed', false, NULL, NULL),
	('pathology_reports', 'ordering_provider_id', 'mixed', false, NULL, NULL),
	('pathology_reports', 'pathologist_id', 'mixed', false, NULL, NULL),
	('pathology_reports', 'addendum_by', 'mixed', false, NULL, NULL),
	('patients', 'primary_provider_id', 'mixed', false, NULL, NULL),
	('patients', 'dnr_verified_by', 'mixed', false, NULL, NULL),
	('pediatric_assessments', 'assessed_by', 'mixed', false, NULL, NULL),
	('access_logs', 'accessor_id', 'sealed', true, NULL, 'hashed into audit leaves'),
	('patients', 'profile_extras_encrypted', 'sealed', true, NULL, 'opaque application-layer blob'),
	('physician_orders', 'ordering_provider_id', 'mixed', false, NULL, NULL),
	('physician_orders', 'cosigned_by', 'mixed', false, NULL, NULL),
	('physician_orders', 'verified_by', 'mixed', false, NULL, NULL),
	('physician_orders', 'executed_by', 'mixed', false, NULL, NULL),
	('physician_orders', 'discontinued_by', 'mixed', false, NULL, NULL),
	('post_op_notes', 'provider_id', 'mixed', false, NULL, NULL),
	('pre_op_assessments', 'surgeon_id', 'mixed', false, NULL, NULL),
	('pre_op_assessments', 'anesthesiologist_id', 'mixed', false, NULL, NULL),
	('pre_op_assessments', 'assessed_by', 'mixed', false, NULL, NULL),
	('prescription_refill_requests', 'prescriber_id', 'mixed', false, NULL, NULL),
	('prescription_refill_requests', 'requested_by', 'mixed', false, NULL, NULL),
	('prescription_refill_requests', 'decided_by', 'mixed', false, NULL, NULL),
	('processing_restrictions', 'restricted_by', 'mixed', false, NULL, NULL),
	('processing_restrictions', 'lifted_by', 'mixed', false, NULL, NULL),
	('progress_notes', 'cosigned_by', 'mixed', false, NULL, NULL),
	('progress_notes', 'created_by', 'mixed', false, NULL, NULL),
	('psychiatric_assessments', 'assessed_by', 'mixed', false, NULL, NULL),
	('psychiatric_assessments', 'psychiatrist_id', 'mixed', false, NULL, NULL),
	('radiology_orders', 'ordering_provider_id', 'mixed', false, NULL, NULL),
	('radiology_orders', 'performing_technologist_id', 'mixed', false, NULL, NULL),
	('radiology_reports', 'radiologist_id', 'mixed', false, NULL, NULL),
	('radiology_reports', 'addendum_by', 'mixed', false, NULL, NULL),
	('blood_units', 'received_by', 'mixed', false, NULL, NULL),
	('retention_approvals', 'requested_by', 'mixed', false, NULL, NULL),
	('retention_approvals', 'approved_by', 'mixed', false, NULL, NULL),
	('retention_approvals', 'executed_by', 'mixed', false, NULL, NULL),
	('retention_job_runs', 'run_by', 'mixed', false, NULL, NULL),
	('security_alerts', 'actor', 'mixed', false, NULL, NULL),
	('sepsis_assessments', 'performed_by', 'mixed', false, NULL, NULL),
	('shift_handoffs', 'outgoing_provider_id', 'mixed', false, NULL, NULL),
	('shift_handoffs', 'incoming_provider_id', 'mixed', false, NULL, NULL),
	('soap_notes', 'signed_by', 'mixed', false, NULL, NULL),
	('soap_notes', 'created_by', 'mixed', false, NULL, NULL),
	('specimen_collections', 'collector_id', 'mixed', false, NULL, NULL),
	('specimen_collections', 'received_by', 'mixed', false, NULL, NULL),
	('specimen_recollection_requests', 'ordering_provider_id', 'mixed', false, NULL, NULL),
	('specimen_recollection_requests', 'requested_by', 'mixed', false, NULL, NULL),
	('specimen_rejections', 'rejected_by', 'mixed', false, NULL, NULL),
	('splint_cast_records', 'applied_by', 'mixed', false, NULL, NULL),
	('stroke_assessments', 'performed_by', 'mixed', false, NULL, NULL),
	('sync_conflicts', 'resolved_by', 'mixed', false, NULL, NULL),
	('telehealth_recordings', 'provider_id', 'mixed', false, NULL, NULL),
	('toxicology_assessments', 'assessed_by', 'mixed', false, NULL, NULL),
	('trauma_assessments', 'performed_by', 'mixed', false, NULL, NULL),
	('triage_assessments', 'performed_by', 'mixed', false, NULL, NULL),
	('vital_signs', 'recorded_by', 'mixed', false, NULL, NULL),
	('wound_assessments', 'assessed_by', 'mixed', false, NULL, NULL),
	('language_preferences', 'owner_id', 'mixed', false, NULL, NULL),
	('eligibility_checks', 'owner_id', 'mixed', false, NULL, NULL),
	('satisfaction_surveys', 'owner_id', 'mixed', false, NULL, NULL),
	('symptom_sessions', 'owner_id', 'mixed', false, NULL, NULL),
	('family_groups', 'owner_id', 'mixed', false, NULL, NULL),
	('insurance_claims', 'owner_id', 'mixed', false, NULL, NULL),
	('autopsy_reports', 'owner_id', 'mixed', false, NULL, NULL),
	('sync_queue_items', 'owner_id', 'mixed', false, NULL, NULL),
	('wearable_device_records', 'owner_id', 'mixed', false, NULL, NULL),
	('wearable_reading_records', 'owner_id', 'mixed', false, NULL, NULL),
	('wearable_alert_records', 'owner_id', 'mixed', false, NULL, NULL),
	('wearable_alert_rules', 'owner_id', 'mixed', false, NULL, NULL),
	('telehealth_session_records', 'owner_id', 'mixed', false, NULL, NULL),
	('e_prescription_v2_records', 'owner_id', 'mixed', false, NULL, NULL),
	('drug_interaction_checks', 'owner_id', 'mixed', false, NULL, NULL),
	('lab_result_submissions', 'owner_id', 'mixed', false, NULL, NULL),
	('soap_note_records', 'owner_id', 'mixed', false, NULL, NULL),
	('insurance_cards', 'owner_id', 'mixed', false, NULL, NULL),
	('cds_threshold_configs', 'owner_id', 'mixed', false, NULL, NULL),
	('cds_audit_entries', 'owner_id', 'mixed', false, NULL, NULL),
	('sync_devices', 'owner_id', 'mixed', false, NULL, NULL),
	('messages', 'owner_id', 'mixed', false, NULL, NULL),
	('symptom_entries', 'owner_id', 'mixed', false, NULL, NULL),
	('barcode_scans', 'owner_id', 'mixed', false, NULL, NULL),
	('blood_type_screen_records', 'owner_id', 'mixed', false, NULL, NULL),
	('transfusion_event_records', 'owner_id', 'mixed', false, NULL, NULL),
	('death_certificate_records', 'owner_id', 'mixed', false, NULL, NULL),
	('family_history_records', 'owner_id', 'mixed', false, NULL, NULL),
	('user_setting_records', 'owner_id', 'mixed', false, NULL, NULL),
	('used_emergency_tokens', 'owner_id', 'mixed', false, NULL, NULL),
	('dispense_events', 'owner_id', 'mixed', false, NULL, NULL),
	('prescription_verification_events', 'owner_id', 'mixed', false, NULL, NULL),
	('provider_schedules', 'owner_id', 'mixed', false, NULL, NULL),
	('note_templates', 'owner_id', 'mixed', false, NULL, NULL),
	('lab_calibrations', 'owner_id', 'mixed', false, NULL, NULL),
	('order_sets', 'owner_id', 'mixed', false, NULL, NULL),
	('cds_rules', 'owner_id', 'mixed', false, NULL, NULL),
	('notification_reads', 'owner_id', 'mixed', false, NULL, NULL),
	('pharmacy_decisions', 'owner_id', 'mixed', false, NULL, NULL),
	('scanner_settings', 'owner_id', 'mixed', false, NULL, NULL),
	('user_avatars', 'owner_id', 'mixed', false, NULL, NULL),
	('research_export_runs', 'owner_id', 'mixed', false, NULL, NULL),
	('language_preferences', 'id', 'record_id', false, NULL, NULL),
	('eligibility_checks', 'id', 'record_id', false, NULL, NULL),
	('satisfaction_surveys', 'id', 'record_id', false, NULL, NULL),
	('symptom_sessions', 'id', 'record_id', false, NULL, NULL);
INSERT INTO actor_column_registry (table_name, column_name, kind, sealed, fk, note) VALUES
	('family_groups', 'id', 'record_id', false, NULL, NULL),
	('insurance_claims', 'id', 'record_id', false, NULL, NULL),
	('autopsy_reports', 'id', 'record_id', false, NULL, NULL),
	('sync_queue_items', 'id', 'record_id', false, NULL, NULL),
	('wearable_device_records', 'id', 'record_id', false, NULL, NULL),
	('wearable_reading_records', 'id', 'record_id', false, NULL, NULL),
	('wearable_alert_records', 'id', 'record_id', false, NULL, NULL),
	('wearable_alert_rules', 'id', 'record_id', false, NULL, NULL),
	('telehealth_session_records', 'id', 'record_id', false, NULL, NULL),
	('e_prescription_v2_records', 'id', 'record_id', false, NULL, NULL),
	('drug_interaction_checks', 'id', 'record_id', false, NULL, NULL),
	('lab_result_submissions', 'id', 'record_id', false, NULL, NULL),
	('soap_note_records', 'id', 'record_id', false, NULL, NULL),
	('insurance_cards', 'id', 'record_id', false, NULL, NULL),
	('cds_threshold_configs', 'id', 'record_id', false, NULL, NULL),
	('cds_audit_entries', 'id', 'record_id', false, NULL, NULL),
	('sync_devices', 'id', 'record_id', false, NULL, NULL),
	('messages', 'id', 'record_id', false, NULL, NULL),
	('symptom_entries', 'id', 'record_id', false, NULL, NULL),
	('barcode_scans', 'id', 'record_id', false, NULL, NULL),
	('blood_type_screen_records', 'id', 'record_id', false, NULL, NULL),
	('transfusion_event_records', 'id', 'record_id', false, NULL, NULL),
	('death_certificate_records', 'id', 'record_id', false, NULL, NULL),
	('family_history_records', 'id', 'record_id', false, NULL, NULL),
	('user_setting_records', 'id', 'record_id', false, NULL, NULL),
	('used_emergency_tokens', 'id', 'record_id', false, NULL, NULL),
	('dispense_events', 'id', 'record_id', false, NULL, NULL),
	('prescription_verification_events', 'id', 'record_id', false, NULL, NULL),
	('provider_schedules', 'id', 'record_id', false, NULL, NULL),
	('note_templates', 'id', 'record_id', false, NULL, NULL),
	('lab_calibrations', 'id', 'record_id', false, NULL, NULL),
	('order_sets', 'id', 'record_id', false, NULL, NULL),
	('cds_rules', 'id', 'record_id', false, NULL, NULL),
	('notification_reads', 'id', 'record_id', false, NULL, NULL),
	('pharmacy_decisions', 'id', 'record_id', false, NULL, NULL),
	('scanner_settings', 'id', 'record_id', false, NULL, NULL),
	('user_avatars', 'id', 'record_id', false, NULL, NULL),
	('research_export_runs', 'id', 'record_id', false, NULL, NULL),
	('user_profiles', 'preferences', 'jsonb', false, NULL, NULL),
	('code_blue_records', 'medications_given', 'jsonb', false, NULL, NULL),
	('code_blue_records', 'airways_interventions', 'jsonb', false, NULL, NULL),
	('code_blue_records', 'team_members', 'jsonb', false, NULL, NULL),
	('sepsis_assessments', 'sofa_components', 'jsonb', false, NULL, NULL),
	('cardiac_events', 'associated_symptoms', 'jsonb', false, NULL, NULL),
	('cardiac_events', 'affected_leads', 'jsonb', false, NULL, NULL),
	('gcs_assessments', 'pupil_assessment', 'jsonb', false, NULL, NULL),
	('nursing_care_plans', 'nursing_diagnoses', 'jsonb', false, NULL, NULL),
	('nursing_care_plans', 'goals', 'jsonb', false, NULL, NULL),
	('nursing_care_plans', 'interventions', 'jsonb', false, NULL, NULL),
	('nursing_care_plans', 'data', 'jsonb', false, NULL, NULL),
	('progress_notes', 'data', 'jsonb', false, NULL, NULL),
	('iv_assessments', 'current_infusions', 'jsonb', false, NULL, NULL),
	('iv_assessments', 'data', 'jsonb', false, NULL, NULL),
	('io_records', 'intake_items', 'jsonb', false, NULL, NULL),
	('io_records', 'output_items', 'jsonb', false, NULL, NULL),
	('io_records', 'data', 'jsonb', false, NULL, NULL),
	('wound_assessments', 'data', 'jsonb', false, NULL, NULL),
	('fall_risk_assessments', 'additional_factors', 'jsonb', false, NULL, NULL),
	('fall_risk_assessments', 'interventions', 'jsonb', false, NULL, NULL),
	('fall_risk_assessments', 'environmental_hazards', 'jsonb', false, NULL, NULL),
	('fall_risk_assessments', 'medications', 'jsonb', false, NULL, NULL),
	('fall_risk_assessments', 'data', 'jsonb', false, NULL, NULL),
	('lab_qc_records', 'data', 'jsonb', false, NULL, NULL),
	('specimen_collections', 'chain_of_custody', 'jsonb', false, NULL, NULL),
	('specimen_collections', 'data', 'jsonb', false, NULL, NULL),
	('intubation_records', 'induction_agents', 'jsonb', false, NULL, NULL),
	('intubation_records', 'adjuncts_used', 'jsonb', false, NULL, NULL),
	('intubation_records', 'difficult_airway_features', 'jsonb', false, NULL, NULL),
	('intubation_records', 'complications', 'jsonb', false, NULL, NULL),
	('intubation_records', 'verification_methods', 'jsonb', false, NULL, NULL),
	('intubation_records', 'post_intubation_vitals', 'jsonb', false, NULL, NULL),
	('intubation_records', 'data', 'jsonb', false, NULL, NULL),
	('laceration_repairs', 'data', 'jsonb', false, NULL, NULL),
	('radiology_orders', 'diagnosis_codes', 'jsonb', false, NULL, NULL),
	('radiology_orders', 'record_json', 'jsonb', false, NULL, NULL),
	('medication_reminders', 'days_of_week', 'jsonb', false, NULL, NULL),
	('medication_reminders', 'data', 'jsonb', false, NULL, NULL),
	('adherence_logs', 'side_effects_reported', 'jsonb', false, NULL, NULL),
	('adherence_logs', 'location', 'jsonb', false, NULL, NULL),
	('burn_assessments', 'burn_depth', 'jsonb', false, NULL, NULL),
	('burn_assessments', 'affected_areas', 'jsonb', false, NULL, NULL),
	('burn_assessments', 'circumferential_locations', 'jsonb', false, NULL, NULL),
	('burn_assessments', 'associated_injuries', 'jsonb', false, NULL, NULL),
	('burn_assessments', 'interventions', 'jsonb', false, NULL, NULL),
	('burn_assessments', 'data', 'jsonb', false, NULL, NULL),
	('pediatric_assessments', 'developmental_milestones', 'jsonb', false, NULL, NULL),
	('pediatric_assessments', 'birth_history', 'jsonb', false, NULL, NULL),
	('pediatric_assessments', 'pediatric_triangle', 'jsonb', false, NULL, NULL),
	('pediatric_assessments', 'data', 'jsonb', false, NULL, NULL),
	('obstetric_emergencies', 'pregnancy_complications', 'jsonb', false, NULL, NULL),
	('obstetric_emergencies', 'data', 'jsonb', false, NULL, NULL),
	('appointments', 'data', 'jsonb', false, NULL, NULL),
	('discharge_instructions', 'medications_list', 'jsonb', false, NULL, NULL),
	('discharge_instructions', 'new_medications', 'jsonb', false, NULL, NULL),
	('discharge_instructions', 'stopped_medications', 'jsonb', false, NULL, NULL),
	('discharge_instructions', 'changed_medications', 'jsonb', false, NULL, NULL),
	('discharge_instructions', 'activity_restrictions', 'jsonb', false, NULL, NULL),
	('discharge_instructions', 'follow_up_appointments', 'jsonb', false, NULL, NULL),
	('discharge_instructions', 'contact_numbers', 'jsonb', false, NULL, NULL),
	('discharge_instructions', 'patient_education_materials', 'jsonb', false, NULL, NULL),
	('discharge_instructions', 'equipment_needed', 'jsonb', false, NULL, NULL),
	('discharge_instructions', 'data', 'jsonb', false, NULL, NULL),
	('shift_handoffs', 'pending_tasks', 'jsonb', false, NULL, NULL),
	('shift_handoffs', 'pending_results', 'jsonb', false, NULL, NULL),
	('shift_handoffs', 'pending_consults', 'jsonb', false, NULL, NULL),
	('shift_handoffs', 'critical_values', 'jsonb', false, NULL, NULL),
	('shift_handoffs', 'isolation_precautions', 'jsonb', false, NULL, NULL),
	('shift_handoffs', 'skin_integrity_issues', 'jsonb', false, NULL, NULL),
	('shift_handoffs', 'iv_access', 'jsonb', false, NULL, NULL),
	('shift_handoffs', 'drains_tubes', 'jsonb', false, NULL, NULL),
	('shift_handoffs', 'questions_asked', 'jsonb', false, NULL, NULL),
	('shift_handoffs', 'data', 'jsonb', false, NULL, NULL),
	('ama_discharges', 'risks_explained', 'jsonb', false, NULL, NULL),
	('ama_discharges', 'alternatives_offered', 'jsonb', false, NULL, NULL),
	('ama_discharges', 'prescriptions_given', 'jsonb', false, NULL, NULL),
	('ama_discharges', 'data', 'jsonb', false, NULL, NULL),
	('ems_handoffs', 'crew_members', 'jsonb', false, NULL, NULL),
	('ems_handoffs', 'vital_signs_on_scene', 'jsonb', false, NULL, NULL),
	('ems_handoffs', 'vital_signs_transport', 'jsonb', false, NULL, NULL),
	('ems_handoffs', 'vital_signs_arrival', 'jsonb', false, NULL, NULL),
	('ems_handoffs', 'interventions_performed', 'jsonb', false, NULL, NULL),
	('ems_handoffs', 'medications_given', 'jsonb', false, NULL, NULL),
	('ems_handoffs', 'iv_details', 'jsonb', false, NULL, NULL),
	('ems_handoffs', 'patient_belongings', 'jsonb', false, NULL, NULL),
	('ems_handoffs', 'data', 'jsonb', false, NULL, NULL),
	('cds_alerts', 'trigger_data', 'jsonb', false, NULL, NULL),
	('immunization_records', 'data', 'jsonb', false, NULL, NULL),
	('retention_job_runs', 'error_details', 'jsonb', false, NULL, NULL),
	('data_retention_policies', 'applies_to_status', 'jsonb', false, NULL, NULL),
	('data_retention_policies', 'exceptions', 'jsonb', false, NULL, NULL),
	('patient_demographics', 'allergies', 'jsonb', false, NULL, NULL),
	('patient_demographics', 'current_medications', 'jsonb', false, NULL, NULL),
	('patient_demographics', 'chronic_conditions', 'jsonb', false, NULL, NULL),
	('patient_demographics', 'languages', 'jsonb', false, NULL, NULL),
	('consent_records', 'data_types_covered', 'jsonb', false, NULL, NULL),
	('trauma_assessments', 'injuries', 'jsonb', false, NULL, NULL),
	('trauma_assessments', 'interventions', 'jsonb', false, NULL, NULL),
	('stroke_assessments', 'nihss_components', 'jsonb', false, NULL, NULL),
	('soap_notes', 'icd10_codes', 'jsonb', false, NULL, NULL),
	('soap_notes', 'addenda', 'jsonb', false, NULL, NULL),
	('language_preferences', 'data', 'jsonb', false, NULL, NULL),
	('eligibility_checks', 'data', 'jsonb', false, NULL, NULL),
	('satisfaction_surveys', 'data', 'jsonb', false, NULL, NULL),
	('symptom_sessions', 'data', 'jsonb', false, NULL, NULL),
	('family_groups', 'data', 'jsonb', false, NULL, NULL),
	('insurance_claims', 'data', 'jsonb', false, NULL, NULL),
	('autopsy_reports', 'data', 'jsonb', false, NULL, NULL),
	('sync_queue_items', 'data', 'jsonb', false, NULL, NULL),
	('wearable_device_records', 'data', 'jsonb', false, NULL, NULL),
	('wearable_reading_records', 'data', 'jsonb', false, NULL, NULL),
	('wearable_alert_records', 'data', 'jsonb', false, NULL, NULL),
	('wearable_alert_rules', 'data', 'jsonb', false, NULL, NULL),
	('telehealth_session_records', 'data', 'jsonb', false, NULL, NULL),
	('drug_interaction_checks', 'data', 'jsonb', false, NULL, NULL),
	('lab_result_submissions', 'data', 'jsonb', false, NULL, NULL),
	('e_prescription_v2_records', 'data', 'jsonb', false, NULL, NULL),
	('soap_note_records', 'data', 'jsonb', false, NULL, NULL),
	('insurance_cards', 'data', 'jsonb', false, NULL, NULL),
	('insurance_records', 'coverage_details', 'jsonb', false, NULL, NULL),
	('ep_code_blue_records', 'record_json', 'jsonb', false, NULL, NULL),
	('ep_trauma_assessments', 'record_json', 'jsonb', false, NULL, NULL),
	('ep_stroke_assessments', 'record_json', 'jsonb', false, NULL, NULL),
	('ep_cardiac_events', 'record_json', 'jsonb', false, NULL, NULL),
	('ep_sepsis_assessments', 'record_json', 'jsonb', false, NULL, NULL),
	('cds_threshold_configs', 'data', 'jsonb', false, NULL, NULL),
	('cds_audit_entries', 'data', 'jsonb', false, NULL, NULL),
	('sync_devices', 'data', 'jsonb', false, NULL, NULL),
	('facilities', 'location', 'jsonb', false, NULL, NULL),
	('device_keys', 'attestation_data', 'jsonb', false, NULL, NULL),
	('emergency_access_grants', 'scopes', 'jsonb', false, NULL, NULL),
	('patient_mobile_devices', 'attestation_data', 'jsonb', false, NULL, NULL),
	('governance_decisions', 'approved_by', 'jsonb', false, NULL, NULL),
	('messages', 'data', 'jsonb', false, NULL, NULL),
	('symptom_entries', 'data', 'jsonb', false, NULL, NULL),
	('barcode_scans', 'data', 'jsonb', false, NULL, NULL),
	('medication_records', 'scheduled_medications', 'jsonb', false, NULL, NULL),
	('medication_records', 'prn_medications', 'jsonb', false, NULL, NULL),
	('medication_records', 'infusions', 'jsonb', false, NULL, NULL),
	('medication_records', 'data', 'jsonb', false, NULL, NULL),
	('critical_values', 'data', 'jsonb', false, NULL, NULL),
	('pathology_reports', 'special_stains', 'jsonb', false, NULL, NULL),
	('pathology_reports', 'immunohistochemistry', 'jsonb', false, NULL, NULL),
	('pathology_reports', 'molecular_studies', 'jsonb', false, NULL, NULL),
	('pathology_reports', 'tnm_classification', 'jsonb', false, NULL, NULL),
	('pathology_reports', 'lymph_node_status', 'jsonb', false, NULL, NULL),
	('pathology_reports', 'synoptic_report', 'jsonb', false, NULL, NULL),
	('pathology_reports', 'record_json', 'jsonb', false, NULL, NULL),
	('chain_of_custody', 'transfers', 'jsonb', false, NULL, NULL),
	('chain_of_custody', 'photo_references', 'jsonb', false, NULL, NULL),
	('chain_of_custody', 'data', 'jsonb', false, NULL, NULL),
	('pre_op_assessments', 'airway_assessment', 'jsonb', false, NULL, NULL),
	('pre_op_assessments', 'cardiac_assessment', 'jsonb', false, NULL, NULL),
	('pre_op_assessments', 'pulmonary_assessment', 'jsonb', false, NULL, NULL),
	('pre_op_assessments', 'renal_assessment', 'jsonb', false, NULL, NULL),
	('pre_op_assessments', 'hepatic_assessment', 'jsonb', false, NULL, NULL),
	('pre_op_assessments', 'medications_reviewed', 'jsonb', false, NULL, NULL),
	('pre_op_assessments', 'labs_reviewed', 'jsonb', false, NULL, NULL),
	('pre_op_assessments', 'record_json', 'jsonb', false, NULL, NULL),
	('operative_notes', 'procedure_codes', 'jsonb', false, NULL, NULL),
	('operative_notes', 'assistant_surgeons', 'jsonb', false, NULL, NULL);
INSERT INTO actor_column_registry (table_name, column_name, kind, sealed, fk, note) VALUES
	('operative_notes', 'blood_products_given', 'jsonb', false, NULL, NULL),
	('operative_notes', 'specimens_collected', 'jsonb', false, NULL, NULL),
	('operative_notes', 'implants_used', 'jsonb', false, NULL, NULL),
	('operative_notes', 'drains_placed', 'jsonb', false, NULL, NULL),
	('operative_notes', 'record_json', 'jsonb', false, NULL, NULL),
	('post_op_notes', 'vital_signs', 'jsonb', false, NULL, NULL),
	('post_op_notes', 'wound_assessment', 'jsonb', false, NULL, NULL),
	('post_op_notes', 'drain_output', 'jsonb', false, NULL, NULL),
	('post_op_notes', 'lab_results_reviewed', 'jsonb', false, NULL, NULL),
	('post_op_notes', 'record_json', 'jsonb', false, NULL, NULL),
	('anesthesia_records', 'airway_management', 'jsonb', false, NULL, NULL),
	('anesthesia_records', 'induction_agents', 'jsonb', false, NULL, NULL),
	('anesthesia_records', 'maintenance_agents', 'jsonb', false, NULL, NULL),
	('anesthesia_records', 'neuromuscular_blockers', 'jsonb', false, NULL, NULL),
	('anesthesia_records', 'reversal_agents', 'jsonb', false, NULL, NULL),
	('anesthesia_records', 'vasopressors', 'jsonb', false, NULL, NULL),
	('anesthesia_records', 'intraop_fluids', 'jsonb', false, NULL, NULL),
	('anesthesia_records', 'blood_products', 'jsonb', false, NULL, NULL),
	('anesthesia_records', 'monitoring', 'jsonb', false, NULL, NULL),
	('anesthesia_records', 'vital_signs_timeline', 'jsonb', false, NULL, NULL),
	('anesthesia_records', 'events', 'jsonb', false, NULL, NULL),
	('anesthesia_records', 'record_json', 'jsonb', false, NULL, NULL),
	('radiology_reports', 'record_json', 'jsonb', false, NULL, NULL),
	('blood_type_screen_records', 'data', 'jsonb', false, NULL, NULL),
	('transfusion_event_records', 'data', 'jsonb', false, NULL, NULL),
	('death_certificate_records', 'data', 'jsonb', false, NULL, NULL),
	('family_history_records', 'data', 'jsonb', false, NULL, NULL),
	('user_setting_records', 'data', 'jsonb', false, NULL, NULL),
	('used_emergency_tokens', 'data', 'jsonb', false, NULL, NULL),
	('vital_signs', 'critical_values', 'jsonb', false, NULL, NULL),
	('history_physicals', 'review_of_systems', 'jsonb', false, NULL, NULL),
	('history_physicals', 'physical_exam', 'jsonb', false, NULL, NULL),
	('history_physicals', 'vital_signs', 'jsonb', false, NULL, NULL),
	('history_physicals', 'data', 'jsonb', false, NULL, NULL),
	('consultation_notes', 'data', 'jsonb', false, NULL, NULL),
	('discharge_summaries', 'admission_diagnosis', 'jsonb', false, NULL, NULL),
	('discharge_summaries', 'discharge_diagnosis', 'jsonb', false, NULL, NULL),
	('discharge_summaries', 'secondary_diagnoses', 'jsonb', false, NULL, NULL),
	('discharge_summaries', 'procedures_performed', 'jsonb', false, NULL, NULL),
	('discharge_summaries', 'discharge_medications', 'jsonb', false, NULL, NULL),
	('discharge_summaries', 'follow_up_appointments', 'jsonb', false, NULL, NULL),
	('discharge_summaries', 'pending_results', 'jsonb', false, NULL, NULL),
	('discharge_summaries', 'pending_studies', 'jsonb', false, NULL, NULL),
	('discharge_summaries', 'specialist_follow_up', 'jsonb', false, NULL, NULL),
	('discharge_summaries', 'durable_medical_equipment', 'jsonb', false, NULL, NULL),
	('discharge_summaries', 'home_health_orders', 'jsonb', false, NULL, NULL),
	('discharge_summaries', 'physical_therapy_orders', 'jsonb', false, NULL, NULL),
	('discharge_summaries', 'data', 'jsonb', false, NULL, NULL),
	('incident_reports', 'witnesses', 'jsonb', false, NULL, NULL),
	('incident_reports', 'contributing_factors', 'jsonb', false, NULL, NULL),
	('incident_reports', 'corrective_actions', 'jsonb', false, NULL, NULL),
	('incident_reports', 'reported_to_agencies', 'jsonb', false, NULL, NULL),
	('incident_reports', 'data', 'jsonb', false, NULL, NULL),
	('lab_submissions', 'tests_ordered', 'jsonb', false, NULL, NULL),
	('lab_submissions', 'diagnosis_codes', 'jsonb', false, NULL, NULL),
	('mci_records', 'injuries', 'jsonb', false, NULL, NULL),
	('mci_records', 'treatments_provided', 'jsonb', false, NULL, NULL),
	('mci_records', 'data', 'jsonb', false, NULL, NULL),
	('physician_orders', 'order_details', 'jsonb', false, NULL, NULL),
	('physician_orders', 'diagnosis_codes', 'jsonb', false, NULL, NULL),
	('physician_orders', 'data', 'jsonb', false, NULL, NULL),
	('psychiatric_assessments', 'presenting_symptoms', 'jsonb', false, NULL, NULL),
	('psychiatric_assessments', 'previous_hospitalizations', 'jsonb', false, NULL, NULL),
	('psychiatric_assessments', 'current_medications', 'jsonb', false, NULL, NULL),
	('psychiatric_assessments', 'substance_use', 'jsonb', false, NULL, NULL),
	('psychiatric_assessments', 'mental_status_exam', 'jsonb', false, NULL, NULL),
	('psychiatric_assessments', 'data', 'jsonb', false, NULL, NULL),
	('specimen_rejections', 'data', 'jsonb', false, NULL, NULL),
	('splint_cast_records', 'neurovascular_check_pre', 'jsonb', false, NULL, NULL),
	('splint_cast_records', 'neurovascular_check_post', 'jsonb', false, NULL, NULL),
	('splint_cast_records', 'data', 'jsonb', false, NULL, NULL),
	('toxicology_assessments', 'substances', 'jsonb', false, NULL, NULL),
	('toxicology_assessments', 'symptoms', 'jsonb', false, NULL, NULL),
	('toxicology_assessments', 'vital_signs_on_arrival', 'jsonb', false, NULL, NULL),
	('toxicology_assessments', 'lab_results', 'jsonb', false, NULL, NULL),
	('toxicology_assessments', 'drug_screen_results', 'jsonb', false, NULL, NULL),
	('toxicology_assessments', 'serum_levels', 'jsonb', false, NULL, NULL),
	('toxicology_assessments', 'data', 'jsonb', false, NULL, NULL),
	('dispense_events', 'data', 'jsonb', false, NULL, NULL),
	('prescription_verification_events', 'data', 'jsonb', false, NULL, NULL),
	('provider_schedules', 'data', 'jsonb', false, NULL, NULL),
	('note_templates', 'data', 'jsonb', false, NULL, NULL),
	('lab_calibrations', 'data', 'jsonb', false, NULL, NULL),
	('order_sets', 'data', 'jsonb', false, NULL, NULL),
	('cds_rules', 'data', 'jsonb', false, NULL, NULL),
	('notification_reads', 'data', 'jsonb', false, NULL, NULL),
	('pharmacy_decisions', 'data', 'jsonb', false, NULL, NULL),
	('scanner_settings', 'data', 'jsonb', false, NULL, NULL),
	('user_avatars', 'data', 'jsonb', false, NULL, NULL),
	('research_export_runs', 'data', 'jsonb', false, NULL, NULL),
	('credential_grants', 'user_id', 'uuid_fk', false, 'users.id', NULL),
	('credential_grants', 'issued_by', 'uuid_fk', false, 'users.id', NULL);

INSERT INTO data_retention_policies (id, policy_name, entity_type, retention_period_days, retention_period_type, archive_after_days, delete_after_days, applies_to_status, department, exceptions, legal_hold_override, regulatory_basis, review_frequency_days, last_reviewed_date, reviewed_by, is_active, effective_date, end_date, created_at, updated_at, retention_rule_kind, retention_period_years, minimum_age_years, legal_source) VALUES
	('RET-CLINICAL-ORDINARY', 'Ordinary clinical records', 'clinical_record', 2190, 'from_last_access', NULL, NULL, NULL, NULL, NULL, true, 'POPIA / NDoH', 365, NULL, NULL, false, '2026-10-18', NULL, '2026-10-18 13:22:11.864547+00', '2026-10-18 13:22:11.864547+00', 'years_from_last_entry', 6, NULL, 'NDoH guideline: 6 years from last entry'),
	('RET-CLINICAL-MINOR', 'Minor patient records', 'clinical_record_minor', 2190, 'from_last_access', NULL, NULL, NULL, NULL, NULL, true, 'POPIA / NDoH / Children''s Act', 365, NULL, NULL, false, '2026-10-18', NULL, '2026-10-18 13:22:11.864547+00', '2026-10-18 13:22:11.864547+00', 'later_of_age_or_years_from_last_entry', 6, 21, 'NDoH guideline: later of 21st birthday or 6 years after last entry'),
	('RET-OBSTETRIC', 'Obstetric records', 'obstetric_record', 2190, 'from_last_access', NULL, NULL, NULL, NULL, NULL, true, 'POPIA / NDoH', 365, NULL, NULL, false, '2026-10-18', NULL, '2026-10-18 13:22:11.864547+00', '2026-10-18 13:22:11.864547+00', 'later_of_age_or_years_from_last_entry', 6, 21, 'NDoH guideline: later of child reaching 21 or 6-year dormancy'),
	('RET-INCAPACITY', 'Patients legally incapable / State patients', 'incapacity_record', 0, 'from_creation', NULL, NULL, NULL, NULL, NULL, true, 'POPIA / NDoH', 365, NULL, NULL, false, '2026-10-18', NULL, '2026-10-18 13:22:11.864547+00', '2026-10-18 13:22:11.864547+00', 'lifetime', NULL, NULL, 'NDoH guideline: retain for lifetime'),
	('RET-OCCUPATIONAL', 'Occupational health & safety incidents', 'occupational_incident', 7300, 'from_creation', NULL, NULL, NULL, NULL, NULL, true, 'OHSA / POPIA', 365, NULL, NULL, false, '2026-10-18', NULL, '2026-10-18 13:22:11.864547+00', '2026-10-18 13:22:11.864547+00', 'years_from_event', 20, NULL, 'NDoH guideline: 20 years'),
	('RET-LONG-LATENCY', 'Long-latency occupational exposure', 'occupational_exposure', 9125, 'from_creation', NULL, NULL, NULL, NULL, NULL, true, 'OHSA / POPIA', 365, NULL, NULL, false, '2026-10-18', NULL, '2026-10-18 13:22:11.864547+00', '2026-10-18 13:22:11.864547+00', 'years_from_event', 25, NULL, 'NDoH guideline: at least 25 years'),
	('RET-TRIAL', 'Clinical trial records', 'clinical_trial_record', 5475, 'from_creation', NULL, NULL, NULL, NULL, NULL, true, 'GCP / POPIA', 365, NULL, NULL, false, '2026-10-18', NULL, '2026-10-18 13:22:11.864547+00', '2026-10-18 13:22:11.864547+00', 'years_from_event', 15, NULL, 'NDoH guideline: 15 years after completion'),
	('RET-FORENSIC', 'Clinical forensic records', 'forensic_record', 9125, 'from_creation', NULL, NULL, NULL, NULL, NULL, true, 'POPIA / NDoH', 365, NULL, NULL, false, '2026-10-18', NULL, '2026-10-18 13:22:11.864547+00', '2026-10-18 13:22:11.864547+00', 'years_from_event', 25, NULL, 'NDoH guideline: at least 25 years'),
	('RET-AUDIT-EMERGENCY', 'Emergency-access audit events', 'emergency_access_log', 2190, 'from_creation', NULL, NULL, NULL, NULL, NULL, true, 'POPIA s17', 365, NULL, NULL, false, '2026-10-18', NULL, '2026-10-18 13:22:11.864547+00', '2026-10-18 13:22:11.864547+00', 'years_from_event', 6, NULL, 'Internal baseline: same period as the associated clinical record'),
	('RET-SECURITY-TELEMETRY', 'General security telemetry', 'security_telemetry', 730, 'from_creation', NULL, NULL, NULL, NULL, NULL, true, 'POPIA s19', 365, NULL, NULL, false, '2026-10-18', NULL, '2026-10-18 13:22:11.864547+00', '2026-10-18 13:22:11.864547+00', 'years_from_event', 2, NULL, 'Internal baseline: 12-24 months unless attached to an investigation');

INSERT INTO organizations (id, name, organization_type, status, parent_organization_id, created_at, suspended_at) VALUES
	('legacy-organization', 'MediChain legacy deployment', 'healthcare_provider', 'inactive', NULL, '2026-10-18 13:22:17.253838+00', NULL);

INSERT INTO facilities (id, organization_id, name, facility_type, status, location, created_at) VALUES
	('legacy-facility', 'legacy-organization', 'MediChain legacy facility', 'healthcare', 'active', NULL, '2026-10-18 13:22:17.253838+00');

SELECT pg_catalog.setval('audit_seal_batches_id_seq', 1, false);

SELECT pg_catalog.setval('audit_seal_seq', 1, false);

SELECT pg_catalog.setval('auth_security_events_id_seq', 1, false);
