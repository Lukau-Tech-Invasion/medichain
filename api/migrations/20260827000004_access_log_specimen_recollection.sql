-- =============================================================================
-- access_logs.action: the specimen-recollection lifecycle (SCR-009b)
-- =============================================================================
-- A rejected specimen cannot be un-rejected. Obtaining another sample is a new
-- act with its own authority and outcome, recorded in
-- `specimen_recollection_requests` and audited here.
--
-- Three actions, not one, because they answer different questions after the
-- fact: who asked the patient to come back, who confirmed the replacement
-- arrived, and who decided to stop asking.
--
-- The constraint is restated in full rather than appended to, because
-- PostgreSQL has no "add a value to a CHECK" and a partial redefinition would
-- silently drop everything omitted. `scripts/check-audit-action-vocabulary.py`
-- derives what the handlers actually write from the Rust source and compares it
-- against this, so a value added to one and not the other fails the build
-- rather than a production insert.
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

        -- Specimen rejection: the lab telling the ordering provider their
        -- sample could not be used. A clinical communication, so attributable.
        'specimen_rejection_notified',

        -- Emergency assessments and crisis response
        'create_trauma_assessment', 'create_stroke_assessment',
        'create_sepsis_assessment', 'create_ems_handoff',
        'create_code_blue', 'create_cardiac_event',

        -- Telehealth. Hyphenated, unlike the rest, because these mirror the
        -- client's event names. Recording start/stop are written by the backend;
        -- the remainder arrive as `event_type` from JitsiMeetComponent.
        'telehealth', 'recording-started', 'recording-stopped',
        'conference-joined', 'conference-left',
        'participant-joined', 'participant-left', 'error',

        -- Specimen recollection (SCR-009b). Requesting another sample from a
        -- patient, recording the replacement, and abandoning the attempt are
        -- three separate clinical acts and are audited separately. They are
        -- distinct from 'specimen_rejection_notified', which tells the ordering
        -- provider the first specimen failed -- notifying somebody and asking a
        -- patient to attend again are not the same event.
        'specimen_recollection_requested',
        'specimen_recollection_completed',
        'specimen_recollection_cancelled'
    )
);
