-- =============================================================================
-- access_logs.action: add the telehealth lifecycle events
-- =============================================================================
-- Migration 20260813000001 widened this constraint to the vocabulary the Rust
-- handlers write as literals. It missed the telehealth lifecycle events, because
-- those do not appear as literals in the backend at all: POST
-- /api/telehealth/sessions/{id}/event copies `body.event_type` — a client-
-- supplied string — straight into `access_logs.action`.
--
-- The values are defined by the caller, `JitsiMeetComponent`, which emits
-- conference-joined, conference-left, participant-joined, participant-left and
-- error. None of them satisfied the constraint, so every telehealth event from
-- the real frontend would have failed its audit insert on PostgreSQL. Nothing
-- caught it because no test exercises that endpoint.
--
-- The endpoint now validates `event_type` against `TELEHEALTH_EVENT_TYPES` and
-- returns 400 for anything else, so this list and that constant are the two
-- halves of one closed set. `test_pg_access_log_accepts_every_action_the_
-- handlers_write` fails if they drift apart.
--
-- Lesson worth keeping: the set of values a constrained column receives is not
-- always discoverable from the backend source. Where a column takes
-- caller-supplied input, the client is part of the schema's contract.
-- =============================================================================

ALTER TABLE access_logs DROP CONSTRAINT IF EXISTS access_logs_action_check;

ALTER TABLE access_logs ADD CONSTRAINT access_logs_action_check CHECK (
    action IN (
        -- Legacy CRUD vocabulary from 20260123000001. Kept so existing rows
        -- stay valid; new code should prefer the operation names below.
        'View', 'Create', 'Update', 'Delete', 'Export', 'Print',
        'EmergencyAccess',

        -- Generic operations
        'view', 'create', 'emergency', 'restricted',

        -- Records
        'upload_record', 'download_record', 'list_records',

        -- Identity and device-bound reads
        'view_medical_id', 'nfc_tap', 'nfc_self_verify', 'qr_verification',

        -- Patient-generated data
        'log_symptom', 'lab_submission', 'add_vital_signs',

        -- Clinical documentation
        'create_soap_note', 'create_operative_note', 'create_pre_op',
        'create_post_op', 'create_anesthesia', 'create_pathology',
        'create_radiology_order', 'create_radiology_report',
        'create_transfusion', 'create_e_prescription',
        'create_death_certificate', 'create_autopsy_request',
        'create_autopsy_report',

        -- Emergency assessments and crisis response
        'create_trauma_assessment', 'create_stroke_assessment',
        'create_sepsis_assessment', 'create_ems_handoff',
        'create_code_blue', 'create_cardiac_event',

        -- Telehealth. Hyphenated, unlike the rest, because these mirror the
        -- client's event names. Recording start/stop are written by the backend;
        -- the remainder arrive as `event_type` from JitsiMeetComponent.
        'telehealth', 'recording-started', 'recording-stopped',
        'conference-joined', 'conference-left',
        'participant-joined', 'participant-left', 'error'
    )
);
