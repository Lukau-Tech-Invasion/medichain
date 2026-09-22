-- =============================================================================
-- access_logs.action: safety records given real server transitions
-- =============================================================================
-- The 2026-09-19 sweep found screens whose safety-critical actions changed only
-- the browser's state: acknowledging a critical value, transferring specimen
-- custody, finalising a pathology report, and more. Each now has an endpoint
-- that writes a durable audit row with one of the actions below; without them
-- here, PostgreSQL rejects that row after the record itself has changed.
--
-- Restated in full, as PostgreSQL has no "add a value to a CHECK" and a partial
-- redefinition silently drops everything omitted.
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
        'specimen_recollection_cancelled',

        -- Pharmacy dispensing (SCR-013). The prescription lifecycle used to
        -- stop at 'prescription_transmitted', leaving four declared states
        -- unreachable. Receiving, starting, dispensing, partially filling and
        -- correcting a dispense are five separate answerable questions about
        -- who did what to a controlled substance.
        'prescription_received',
        'prescription_fill_started',
        'prescription_dispensed',
        'prescription_partial_fill',
        'prescription_dispense_reversed',
        'prescription_verification_requested',
        'prescription_verification_approved',
        'prescription_verification_rejected',
        'prescription_verification_expired',
        'prescription_verification_revoked',

        -- Patient-generated data, withdrawn by its author. A retraction is
        -- not a deletion: the entry and who withdrew it stay readable, and the
        -- act itself is an answerable question about a clinical record.
        'retract_symptom',

        -- Safety records that had no server transition (2026-09-19 sweep).
        -- Each is a clinical act somebody must answer for: telling a
        -- clinician about a critical value and hearing it read back, or
        -- withdrawing a notification raised in error.
        'critical_value_acknowledged',
        'critical_value_cancelled',
        -- A specimen changing hands: the link a chain of custody is made of.
        'custody_transferred'
    )
);
