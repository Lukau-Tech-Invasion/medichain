-- =============================================================================
-- Prescription refill requests (WP7.1)
-- =============================================================================
-- A patient asks for a refill on a prescription that still has refills left;
-- a doctor approves (which decrements the original and creates a new,
-- unsigned prescription linked to it) or denies with a reason the patient
-- sees; the patient may cancel while the request is open.
--
-- Typed columns and CHECK constraints rather than a JSON record: the status
-- machine and the "one open request per prescription" rule are safety
-- properties, so the database enforces them even if a handler is wrong or two
-- API workers race.
--
-- No backfill: refill requests did not exist before this migration, so there
-- are no rows to convert.
-- =============================================================================

CREATE TABLE IF NOT EXISTS prescription_refill_requests (
    id                  TEXT PRIMARY KEY,
    -- The prescription being refilled. Prescriptions are JSON records in
    -- e_prescription_v2_records; RESTRICT so a request can never outlive it.
    prescription_id     TEXT NOT NULL
                        REFERENCES e_prescription_v2_records (id) ON DELETE RESTRICT,
    patient_id          VARCHAR(64) NOT NULL
                        REFERENCES patients (id) ON DELETE CASCADE,
    -- Copied from the prescription at request time, so the doctor's queue is
    -- one indexed read rather than a scan of every prescription's JSON.
    prescriber_id       TEXT NOT NULL,
    -- Snapshot of the medicine's name when the request was made, so a list of
    -- requests reads without decoding every prescription record.
    medication_name     TEXT NOT NULL CHECK (length(medication_name) BETWEEN 1 AND 256),
    requested_by        TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested', 'approved', 'denied', 'cancelled')),
    patient_note        TEXT CHECK (patient_note IS NULL OR length(patient_note) <= 500),
    decided_by          TEXT,
    decided_at          TIMESTAMPTZ,
    denial_reason       TEXT CHECK (denial_reason IS NULL OR length(denial_reason) <= 500),
    new_prescription_id TEXT REFERENCES e_prescription_v2_records (id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A refusal the patient cannot read the reason for is not allowed.
    CONSTRAINT refill_denial_has_reason CHECK (
        status <> 'denied' OR length(btrim(coalesce(denial_reason, ''))) > 0
    ),
    -- An approval always points at the prescription it produced.
    CONSTRAINT refill_approval_has_prescription CHECK (
        status <> 'approved' OR new_prescription_id IS NOT NULL
    ),
    -- Every closed request records who closed it and when.
    CONSTRAINT refill_closed_has_decider CHECK (
        status = 'requested' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
    )
);

-- One open request per prescription. Closed history stays and never blocks a
-- later request, mirroring uq_prescription_verification_one_open_request.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prescription_refill_one_open_request
    ON prescription_refill_requests (prescription_id)
    WHERE status = 'requested';

CREATE INDEX IF NOT EXISTS idx_prescription_refill_requests_patient
    ON prescription_refill_requests (patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prescription_refill_requests_open_by_prescriber
    ON prescription_refill_requests (prescriber_id, created_at)
    WHERE status = 'requested';

-- =============================================================================
-- access_logs.action: the four refill acts. Restated in full, as PostgreSQL
-- has no "add a value to a CHECK" and a partial redefinition silently drops
-- everything omitted.
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
        'refill_cancelled'
    )
);
