-- Ambulance run record (docs/FRONTEND_WORKFLOW_AND_MOTION_PLAN.md §3).
--
-- A run is what a crew does for one patient, from dispatch to the hospital
-- acknowledging receipt. Its timeline is a separate, append-only table: each
-- tap the crew makes (vitals, a medicine, leaving the scene) is one row, so a
-- record queued on a tablet without signal is sent later as an append that can
-- never conflict with anything (Kleppmann, DDIA p.192), and a resend under the
-- same operation key is refused by the idempotency guard rather than written
-- twice (DDIA p.566).
--
-- Both use the JSON-record shape the repository layer already serves
-- (`pg_json_repo!`), so the in-memory and PostgreSQL backends agree.

CREATE TABLE ems_runs (
    id text NOT NULL,
    -- The crew member who started the run (users.id).
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ems_runs_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_ems_runs_owner ON ems_runs USING btree (owner_id);
-- The receiving hospital's board reads runs by destination.
CREATE INDEX idx_ems_runs_destination ON ems_runs USING btree ((data ->> 'destination_facility_id'));
-- The patient's own read of their ambulance records (rule 10).
CREATE INDEX idx_ems_runs_patient ON ems_runs USING btree ((data ->> 'patient_id'));

CREATE TABLE ems_run_events (
    id text NOT NULL,
    -- The run this entry belongs to (ems_runs.id), not a person.
    owner_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ems_run_events_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_ems_run_events_owner ON ems_run_events USING btree (owner_id);

INSERT INTO actor_column_registry (table_name, column_name, kind, sealed, fk, note) VALUES
    ('ems_runs', 'id', 'record_id', false, NULL, NULL),
    ('ems_runs', 'owner_id', 'user', false, NULL, 'crew member who started the run'),
    ('ems_runs', 'data', 'jsonb', false, NULL, 'created_by, received_by name users; patient_id names a patient'),
    ('ems_run_events', 'id', 'record_id', false, NULL, NULL),
    ('ems_run_events', 'owner_id', 'record_id', false, NULL, 'ems_runs.id'),
    ('ems_run_events', 'data', 'jsonb', false, NULL, 'recorded_by names a user');
