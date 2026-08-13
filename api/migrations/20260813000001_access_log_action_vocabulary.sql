-- =============================================================================
-- access_logs.action: widen the CHECK to the vocabulary the handlers write
-- =============================================================================
-- `access_logs.action` was created in 20260123000001 with a seven-value
-- PascalCase CRUD enum:
--
--     CHECK (action IN ('View','Create','Update','Delete','Export','Print',
--                       'EmergencyAccess'))
--
-- The handlers since evolved to record *which operation happened* rather than a
-- CRUD category, and now write ~35 snake_case values. Exactly one of them
-- ('View') satisfied the old constraint, so on PostgreSQL almost every audit
-- insert was rejected with
--
--     new row for relation "access_logs" violates check constraint
--     "access_logs_action_check"
--
-- The in-memory backend has no constraint, which is why this never showed up
-- there. It matters because the audit path deliberately fails closed: when the
-- access log cannot be written the request is refused, so on a PostgreSQL
-- deployment this turned into
--
--     503 AUDIT_PERSISTENCE_REQUIRED
--
-- on emergency card reads, patient lockscreen reads and encrypted record
-- uploads. Failing closed is the correct behaviour for a medical audit trail;
-- the defect was that the schema and the handlers disagreed about the
-- vocabulary. Surfaced by the synthetic end-to-end suite once it began
-- exercising the emergency-token and lockscreen paths.
--
-- The legacy PascalCase values are retained so rows written before this
-- migration remain valid.
--
-- KNOWN GAP, deliberately not closed here: `action` is not always a literal.
-- `POST /api/telehealth/sessions/{id}/events` writes `body.event_type`, an
-- unvalidated caller-supplied String, straight into this column. No enumerated
-- constraint can be complete while that is true — an unexpected event_type will
-- still be rejected and fail that audit write. Fixing it means validating
-- event_type at the API boundary (returning 400 rather than failing an audit
-- later), which is a change to that endpoint's contract and is left as a
-- separate decision.
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

        -- Telehealth session lifecycle (note: hyphenated, unlike the rest)
        'telehealth', 'recording-started', 'recording-stopped'
    )
);
