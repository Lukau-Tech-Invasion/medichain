-- =============================================================================
-- Telehealth recordings (WP7.6)
-- =============================================================================
-- A consultation recording: produced by the video platform's recorder after
-- BOTH the assigned clinician and the patient consented in the app, delivered
-- to the API by the recorder's upload hook, encrypted into the IPFS document
-- pipeline. This row is the index; the bytes never sit here in the clear.
--
-- The consent timestamps are copied from the session at the moment of
-- storage, and the table refuses a recording whose consents are later than
-- the moment recording started: consent comes first, in the database too.
--
-- Recordings are clinical records. `retention_entity_type` names the policy in
-- data_retention_policies that governs them (the ordinary clinical record
-- period) so the retention job treats them like the rest of the chart.
-- =============================================================================

CREATE TABLE IF NOT EXISTS telehealth_recordings (
    id                      TEXT PRIMARY KEY,
    -- Sessions are JSON records in telehealth_session_records; the handler
    -- loads the session before storing anything.
    session_id              TEXT NOT NULL,
    patient_id              VARCHAR(64) NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    provider_id             TEXT NOT NULL,
    content_type            TEXT NOT NULL CHECK (content_type IN ('video/mp4', 'video/webm')),
    -- 256 MiB: MAX_RECORDING_BYTES in the API.
    size_bytes              BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 268435456),
    sha256                  TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    ipfs_hash               TEXT NOT NULL,
    metadata_hash           TEXT NOT NULL,
    provider_consented_at   TIMESTAMPTZ NOT NULL,
    patient_consented_at    TIMESTAMPTZ NOT NULL,
    recording_started_at    TIMESTAMPTZ NOT NULL,
    retention_entity_type   TEXT NOT NULL DEFAULT 'clinical_record'
                            CHECK (retention_entity_type IN ('clinical_record', 'clinical_record_minor')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT telehealth_recording_consent_precedes_start CHECK (
        provider_consented_at <= recording_started_at
        AND patient_consented_at <= recording_started_at
    )
);

CREATE INDEX IF NOT EXISTS idx_telehealth_recordings_session
    ON telehealth_recordings (session_id, created_at DESC);

-- =============================================================================
-- access_logs.action: the four recording acts. Restated in full.
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
        'create_death_certificate', 'file_death_certificate',
        'create_autopsy_request',
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
        'custody_transferred',

        -- Signing out a pathology report. A preliminary report becoming final
        -- is the moment a diagnosis is attributable to a named pathologist,
        -- and it is the transition the handler refuses to repeat.
        'update_pathology_report',

        -- A pharmacist refusing to dispense against a documented allergy, or
        -- raising the question with the prescriber first. Both are clinical
        -- acts with consequences for the patient -- a medicine that was
        -- prescribed did not reach them -- so both are answerable for.
        'pharmacy_dispensing_decision',

        -- Signatures collected on an against-medical-advice discharge. The
        -- signature IS the record: an AMA form without one does not evidence
        -- that the risks were explained and accepted.
        'ama_signatures_collected',

        -- Prescription refill requests (WP7.1). A patient asking for more of a
        -- medicine, a doctor granting or refusing it, and the patient
        -- withdrawing the ask are each an answerable act about a medicine.
        'refill_requested',
        'refill_approved',
        'refill_denied',
        'refill_cancelled',

        -- Message attachments (WP7.2). Attaching a file to a conversation and
        -- opening one are each a disclosure of what the file holds.
        'message_attachment_uploaded',
        'message_attachment_downloaded',

        -- Explanation-of-benefits documents (WP7.3). Filing a payer's EOB
        -- against a claim, and opening one, each disclose what it says about
        -- the patient's care and costs.
        'eob_uploaded',
        'eob_downloaded',

        -- Research / secondary-use export (WP7.4). Proposing, approving and
        -- running an export are governance acts with no patient_id. Each patient
        -- whose de-identified record went into a run gets their own row, so
        -- their access history can say so.
        'research_export_proposed',
        'research_export_approved',
        'research_export_executed',
        'research_export_included',

        -- Blood-unit inventory (WP7.5). Receiving a unit into stock, holding
        -- it against a patient after crossmatch, returning it to stock,
        -- issuing it for a transfusion, and discarding it are each a
        -- traceable act on a blood product.
        'blood_unit_received',
        'blood_unit_reserved',
        'blood_unit_released',
        'blood_unit_issued',
        'blood_unit_discarded',

        -- Telehealth recording (WP7.6). Each party's own consent, and its
        -- withdrawal, is an answerable act; so is storing a recording and
        -- viewing one, which discloses the consultation itself.
        'recording_consent_given',
        'recording_consent_withdrawn',
        'telehealth_recording_stored',
        'telehealth_recording_viewed'
    )
);
