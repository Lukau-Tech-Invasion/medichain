-- Wards, who is rostered on them, and who is admitted to them (UX plan
-- Phase 5, owner decision D1 of 2026-10-30).
--
-- Nothing in the system said which patients a nurse is looking after: "My
-- Patients" on the nursing dashboard was the first 15 rows of the patients
-- table, and a nurse's only route to a chart was a care relationship created
-- by somebody else's appointment, or breaking the glass. A patient admitted to
-- a ward, and a nurse rostered on that ward for the current shift, is the
-- relationship hospitals actually run on; it is now a chart authority of its
-- own (`ward_assignment`), cited on the audit row by admission and assignment.

CREATE TABLE wards (
    id text PRIMARY KEY,
    facility_id text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    retired_at timestamp with time zone,
    CONSTRAINT wards_kind_check CHECK (kind = ANY (ARRAY['general'::text, 'emergency'::text, 'icu'::text, 'maternity'::text, 'paediatric'::text, 'surgical'::text, 'other'::text])),
    CONSTRAINT wards_name_length CHECK (char_length(name) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX wards_facility_name ON wards (facility_id, lower(name)) WHERE retired_at IS NULL;

CREATE TABLE ward_shift_assignments (
    id text PRIMARY KEY,
    ward_id text NOT NULL REFERENCES wards (id),
    clinician_id text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    assigned_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cancelled_at timestamp with time zone,
    cancelled_by text,
    CONSTRAINT ward_shift_ends_after_start CHECK (ends_at > starts_at),
    -- A shift, not a standing grant: at most 24 hours.
    CONSTRAINT ward_shift_bounded CHECK (ends_at - starts_at <= interval '24 hours')
);
CREATE INDEX idx_ward_shift_clinician_now ON ward_shift_assignments (clinician_id, ends_at) WHERE cancelled_at IS NULL;
CREATE INDEX idx_ward_shift_ward ON ward_shift_assignments (ward_id, starts_at DESC);

CREATE TABLE patient_admissions (
    id text PRIMARY KEY,
    patient_id character varying(64) NOT NULL,
    ward_id text NOT NULL REFERENCES wards (id),
    bed_label text,
    admitted_at timestamp with time zone NOT NULL,
    admitted_by text NOT NULL,
    discharged_at timestamp with time zone,
    discharged_by text,
    CONSTRAINT admission_discharge_after_admit CHECK (discharged_at IS NULL OR discharged_at >= admitted_at),
    CONSTRAINT admission_discharge_names_who CHECK ((discharged_at IS NULL) = (discharged_by IS NULL)),
    CONSTRAINT admission_bed_length CHECK (bed_label IS NULL OR char_length(bed_label) <= 40)
);
-- One open admission per patient.
CREATE UNIQUE INDEX patient_admissions_one_open ON patient_admissions (patient_id) WHERE discharged_at IS NULL;
CREATE INDEX idx_patient_admissions_ward_open ON patient_admissions (ward_id) WHERE discharged_at IS NULL;

-- The new authority, wherever an authority type is recorded.
ALTER TABLE access_logs DROP CONSTRAINT access_logs_authority_type_check;
ALTER TABLE access_logs ADD CONSTRAINT access_logs_authority_type_check CHECK (((authority_type IS NULL) OR (authority_type = ANY (ARRAY['self'::text, 'guardian'::text, 'admin'::text, 'patient_grant'::text, 'care_relationship'::text, 'break_glass'::text, 'emergency_token'::text, 'ward_assignment'::text]))));
ALTER TABLE access_contexts DROP CONSTRAINT access_contexts_authority_type_check;
ALTER TABLE access_contexts ADD CONSTRAINT access_contexts_authority_type_check CHECK ((authority_type = ANY (ARRAY['guardian'::text, 'admin'::text, 'patient_grant'::text, 'care_relationship'::text, 'break_glass'::text, 'ward_assignment'::text])));

INSERT INTO actor_column_registry (table_name, column_name, kind, sealed, fk, note) VALUES
    ('wards', 'id', 'record_id', false, NULL, NULL),
    ('wards', 'facility_id', 'record_id', false, NULL, 'facilities.id'),
    ('wards', 'created_by', 'user', false, NULL, 'administrator who created the ward'),
    ('ward_shift_assignments', 'id', 'record_id', false, NULL, NULL),
    ('ward_shift_assignments', 'ward_id', 'record_id', false, NULL, 'wards.id'),
    ('ward_shift_assignments', 'clinician_id', 'user', false, NULL, 'clinician rostered on the ward'),
    ('ward_shift_assignments', 'assigned_by', 'user', false, NULL, 'administrator who rostered them'),
    ('ward_shift_assignments', 'cancelled_by', 'user', false, NULL, NULL),
    ('patient_admissions', 'id', 'record_id', false, NULL, NULL),
    ('patient_admissions', 'patient_id', 'record_id', false, NULL, 'patients.id'),
    ('patient_admissions', 'ward_id', 'record_id', false, NULL, 'wards.id'),
    ('patient_admissions', 'admitted_by', 'user', false, NULL, NULL),
    ('patient_admissions', 'discharged_by', 'user', false, NULL, NULL);
