-- =============================================================================
-- access_logs.action: the lab-review and prescription lifecycle events
-- =============================================================================
-- `lab_review_approve` and `lab_review_reject` have been written by
-- `/api/lab/review` since that endpoint existed, and have NEVER been accepted
-- by this constraint. Nobody noticed because the handler discarded the insert
-- with `let _ =`: on PostgreSQL every lab-review audit row was rejected, the
-- error was thrown away, and the reviewer was told the result was "approved and
-- added to patient records". The in-memory backend enforces no CHECK
-- constraints, so every test passed.
--
-- It surfaced on 2026-08-26 only because the handler was changed to treat its
-- audit write as an obligation rather than a side effect. The 503 that appeared
-- was not a regression; it was the first time the failure had ever been
-- visible.
--
-- `prescription_signed` and `prescription_transmitted` are new in the same
-- pass: signing and transmitting a prescription were previously not audited at
-- all.
--
-- WHY THE EXISTING GUARD TEST DID NOT CATCH THIS
--
-- `test_pg_access_log_accepts_every_action_the_handlers_write` hand-mirrors the
-- vocabulary in this constraint and proves the database accepts each entry. So
-- it proves list == constraint. The invariant that actually matters is
-- constraint ⊇ { values the handlers write }, and a value absent from both the
-- list and the constraint satisfies the test perfectly while failing in
-- production.
--
-- `scripts/check-audit-action-vocabulary.py` now derives the left-hand side
-- from the handler source instead of from a copy of this file, and fails when a
-- written value has no matching constraint entry. A hand-maintained mirror of
-- the thing under test cannot detect an omission common to both.
--
-- One value here is computed, not literal: `format!("lab_review_{}", action)`
-- in `api/src/handlers/lab.rs`, where `action` is already validated to be
-- exactly "approve" or "reject" before it is used. The gate understands that
-- one form specifically rather than pretending all format strings are opaque.
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

        -- Lab review. Written as `lab_review_{action}` where `action` is
        -- validated to "approve" or "reject" before the audit row is built.
        'lab_review_approve', 'lab_review_reject',

        -- Clinical documentation
        'create_soap_note', 'create_operative_note', 'create_pre_op',
        'create_post_op', 'create_anesthesia', 'create_pathology',
        'create_radiology_order', 'create_radiology_report',
        'create_transfusion', 'create_e_prescription',
        'create_death_certificate', 'create_autopsy_request',
        'create_autopsy_report',

        -- Prescription lifecycle. The two moments a clinician takes personal
        -- responsibility for a controlled instruction.
        'prescription_signed', 'prescription_transmitted',

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
