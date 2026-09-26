-- =============================================================================
-- Blood-unit stock inventory (WP7.5)
-- =============================================================================
-- One row per physical blood unit. The blood bank page used to track orders
-- and transfusions but no stock at all, so nothing said which units existed,
-- which were near expiry, or which had gone to which patient.
--
-- The database enforces the rules a handler bug must never break:
--   * unit numbers are unique;
--   * a unit cannot be issued (or reserved) after its expiry date;
--   * a reserved unit names its patient and crossmatch; an issued unit names
--     its patient and the transfusion record it went to;
--   * product, ABO, Rh and status are closed sets.
--
-- No backfill: no inventory existed before this migration.
-- =============================================================================

CREATE TABLE IF NOT EXISTS blood_units (
    id                       TEXT PRIMARY KEY,
    unit_number              TEXT NOT NULL UNIQUE CHECK (unit_number ~ '^[A-Z0-9-]{5,32}$'),
    product_type             TEXT NOT NULL
                             CHECK (product_type IN ('PackedRBC', 'FFP', 'Platelets',
                                                     'Cryoprecipitate', 'WholeBlood')),
    abo                      TEXT NOT NULL CHECK (abo IN ('A', 'B', 'AB', 'O')),
    rh                       TEXT NOT NULL CHECK (rh IN ('positive', 'negative')),
    collected_on             DATE NOT NULL,
    expires_on               DATE NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'available'
                             CHECK (status IN ('available', 'reserved', 'issued',
                                               'expired', 'discarded')),
    location                 TEXT NOT NULL CHECK (length(location) BETWEEN 1 AND 120),
    reserved_for_patient_id  VARCHAR(64) REFERENCES patients (id) ON DELETE SET NULL,
    crossmatch_reference     TEXT CHECK (crossmatch_reference IS NULL
                                         OR length(crossmatch_reference) BETWEEN 1 AND 64),
    reserved_at              TIMESTAMPTZ,
    issued_to_patient_id     VARCHAR(64) REFERENCES patients (id) ON DELETE RESTRICT,
    transfusion_id           TEXT,
    issued_at                TIMESTAMPTZ,
    discard_reason           TEXT CHECK (discard_reason IS NULL
                                         OR length(discard_reason) BETWEEN 5 AND 500),
    received_by              TEXT NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT blood_unit_expiry_after_collection CHECK (expires_on >= collected_on),
    -- An expired unit can never be issued: the issue date must be on or
    -- before the expiry date, whatever the handler thought.
    CONSTRAINT blood_unit_not_issued_expired CHECK (
        status <> 'issued' OR (issued_at IS NOT NULL AND issued_at::date <= expires_on)
    ),
    CONSTRAINT blood_unit_not_reserved_expired CHECK (
        status <> 'reserved' OR (reserved_at IS NOT NULL AND reserved_at::date <= expires_on)
    ),
    CONSTRAINT blood_unit_reserved_names_patient CHECK (
        status <> 'reserved'
        OR (reserved_for_patient_id IS NOT NULL AND crossmatch_reference IS NOT NULL)
    ),
    CONSTRAINT blood_unit_issued_names_transfusion CHECK (
        status <> 'issued' OR (issued_to_patient_id IS NOT NULL AND transfusion_id IS NOT NULL)
    ),
    CONSTRAINT blood_unit_discard_has_reason CHECK (
        status <> 'discarded' OR discard_reason IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_blood_units_stock
    ON blood_units (product_type, abo, rh, expires_on)
    WHERE status = 'available';
CREATE INDEX IF NOT EXISTS idx_blood_units_reserved_patient
    ON blood_units (reserved_for_patient_id) WHERE status = 'reserved';

-- =============================================================================
-- access_logs.action: the five blood-unit acts. Restated in full.
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
        'blood_unit_discarded'
    )
);
