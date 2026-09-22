-- Signatures on an against-medical-advice discharge.
--
-- The AMA screen offered a "Collect signatures" button and there was nowhere to
-- put one: `ama_discharges` carried `ama_form_signed` (a boolean), a witness
-- name and a witness signature, but nothing for the patient's own mark and no
-- record of when either was taken.
--
-- That gap matters more here than almost anywhere else in the record. An AMA
-- discharge is the document produced when a patient leaves against advice, and
-- it is the first thing a coroner or a malpractice review asks for. Its whole
-- evidential purpose is to show that the risks were explained and that the
-- patient, having capacity, accepted them. A boolean saying "signed" with no
-- signature behind it evidences nothing.
--
-- A refusal to sign is recorded, not treated as an absence: a patient who
-- declines to sign has still been counselled, and `ama_form_refused_reason`
-- already exists for that. These columns record the signature when there is
-- one and the time it was taken, so "not signed yet" and "refused to sign" stay
-- distinguishable from each other.

ALTER TABLE ama_discharges
    ADD COLUMN IF NOT EXISTS patient_signature TEXT,
    ADD COLUMN IF NOT EXISTS patient_signature_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS witness_signature_at TIMESTAMPTZ,
    -- Who collected them. The attending physician is already on the record;
    -- the person who actually witnessed the signing may be someone else.
    ADD COLUMN IF NOT EXISTS signatures_collected_by TEXT;

-- "Which AMA discharges are still unsigned?" is the question a ward asks at
-- the end of a shift, and it is the one this index serves.
CREATE INDEX IF NOT EXISTS idx_ama_discharges_unsigned
    ON ama_discharges (patient_signature_at)
    WHERE patient_signature_at IS NULL;
