-- The triage note the nurse types had nowhere to go.
--
-- `CreateTriageRequest` carries `notes`, `create_triage_assessment` validates
-- its length, and `TriageAssessmentEntity` has no column for it — so the note
-- was accepted, checked, and discarded on every triage assessment ever
-- recorded. The queue read `disposition` in its place, which is a different
-- clinical field that the create path always leaves NULL, so the note rendered
-- as empty even to the nurse who had just typed it.
--
-- A triage note is what the nurse writes when the coded fields cannot carry the
-- reason for the acuity: "walked in unaccompanied, states symptoms began 40
-- minutes ago", "smells of ketones", "refused observations". It is frequently
-- the only free text between arrival and being seen.
ALTER TABLE triage_assessments
    ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN triage_assessments.notes IS
    'Free-text triage note. Distinct from disposition, which records where the patient went.';
