-- A pharmacist's decision about dispensing against a known allergy, and the
-- queries they raise with the prescriber.
--
-- The pharmacist dashboard showed an allergy alert beside two buttons —
-- "Reject" and "Contact MD" — and neither had an endpoint. A pharmacist
-- refusing to dispense is a clinical act somebody must be able to answer for:
-- the prescriber needs to know their order was not filled and why, and the
-- patient needs to know a medicine they were prescribed did not reach them.
-- Neither could happen while the refusal existed only as a pressed button.
--
-- `owner_id` is the PATIENT the decision concerns, not the pharmacist. That is
-- what makes the patient-scoped read possible (rule 10): the person the record
-- is about can find it without knowing its id. The deciding pharmacist is in
-- `data.decided_by`.
--
-- `decision` is the guard column for conditional transitions and is indexed.
CREATE TABLE IF NOT EXISTS pharmacy_decisions (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_decisions_owner
    ON pharmacy_decisions (owner_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_decisions_decision
    ON pharmacy_decisions ((data ->> 'decision'));
-- The prescriber's inbox view: "which of my orders did a pharmacist stop?"
CREATE INDEX IF NOT EXISTS idx_pharmacy_decisions_prescriber
    ON pharmacy_decisions ((data ->> 'prescriber_id'));
