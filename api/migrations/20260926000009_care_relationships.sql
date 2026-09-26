-- =============================================================================
-- Care relationships and break-glass (WP9)
-- =============================================================================
-- Who may open a patient's chart: the patient, their guardian, a clinician the
-- patient granted access to, a clinician in an active CARE RELATIONSHIP with
-- them, or a clinician who breaks the glass (reason required, time-limited,
-- patient told at once). Being clinical staff is no longer enough on its own.
--
-- Relationships are recorded automatically from the clinical workflow that
-- creates them:
--   encounter  - an appointment booked or checked in with the clinician, or a
--                telehealth session with them
--   referral   - a consult request naming the consulting clinician
--   admission  - reserved: MediChain has no admission records yet
--   patient_grant - reserved: patient grants are read from patient_access
--                directly rather than copied here
-- =============================================================================

CREATE TABLE IF NOT EXISTS care_relationships (
    id              TEXT PRIMARY KEY,
    patient_id      VARCHAR(64) NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    clinician_id    TEXT,
    facility_id     TEXT,
    source          TEXT NOT NULL
                    CHECK (source IN ('encounter', 'admission', 'referral', 'patient_grant')),
    source_id       TEXT NOT NULL,
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT care_relationship_names_someone
        CHECK (clinician_id IS NOT NULL OR facility_id IS NOT NULL),
    CONSTRAINT care_relationship_ends_after_start
        CHECK (ends_at IS NULL OR ends_at > starts_at),
    -- One relationship per workflow item and party: re-recording the same
    -- appointment refreshes it instead of stacking duplicates.
    CONSTRAINT care_relationship_once_per_source
        UNIQUE (source, source_id, clinician_id)
);

CREATE INDEX IF NOT EXISTS idx_care_relationships_patient_clinician
    ON care_relationships (patient_id, clinician_id, ends_at);

CREATE TABLE IF NOT EXISTS break_glass_grants (
    id              TEXT PRIMARY KEY,
    patient_id      VARCHAR(64) NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    clinician_id    TEXT NOT NULL,
    reason          TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 500),
    starts_at       TIMESTAMPTZ NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Time-limited by construction: never open-ended, never longer than
    -- twelve hours, whatever the application asks for.
    CONSTRAINT break_glass_is_time_limited CHECK (
        expires_at > starts_at AND expires_at <= starts_at + INTERVAL '12 hours'
    )
);

CREATE INDEX IF NOT EXISTS idx_break_glass_patient_clinician
    ON break_glass_grants (patient_id, clinician_id, expires_at);

-- What authorised each access, so the patient's history can say "via referral
-- from Dr X" or "emergency access". NULL on rows written before this.
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS authority_type TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS authority_id TEXT;
ALTER TABLE access_logs DROP CONSTRAINT IF EXISTS access_logs_authority_type_check;
ALTER TABLE access_logs ADD CONSTRAINT access_logs_authority_type_check CHECK (
    authority_type IS NULL OR authority_type IN (
        'self', 'guardian', 'admin', 'patient_grant', 'care_relationship',
        'break_glass', 'emergency_token'
    )
);

-- =============================================================================
-- access_logs.action: break_glass_opened. Restated in full.
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
        'telehealth_recording_viewed',

        -- Break-glass (WP9): a clinician with no care relationship opening a
        -- chart in an emergency. Always attributable, always told to the patient.
        'break_glass_opened'
    )
);
