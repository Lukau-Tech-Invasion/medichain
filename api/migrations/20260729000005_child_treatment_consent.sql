-- Children's Act §129 treatment consent by a mature child.
--
-- Context: `consent_giver_capacity` already accepted the value
-- 'child_over_12_mature' (migration 20260729000001), but nothing checked it
-- against the patient's actual age, and nothing recorded the maturity finding
-- that the capacity depends on. A claim of mature-minor capacity was therefore
-- accepted on the caller's word alone.
--
-- The 2026-07-28 legal review (docs/PRODUCTION_READINESS_GATES.md §3) is
-- explicit that the Children's Act treatment-consent rule "must not be
-- collapsed into a generic guardian database permission", and that child
-- participation must be "appropriate to age and maturity". Age is now verified
-- from the patient's date of birth in the handler; maturity cannot be derived
-- from data at all, so it is recorded here as an explicit clinical finding.

ALTER TABLE consent_records
    -- The clinician's maturity finding, in their words. Required by the
    -- handler whenever consent_giver_capacity = 'child_over_12_mature'.
    -- Free text rather than a boolean: "sufficient maturity and capacity" is a
    -- judgement that has to be defensible after the fact, and a checkbox is not.
    ADD COLUMN IF NOT EXISTS child_maturity_assessment TEXT,

    -- Who made that finding. A maturity assessment with no assessor is not
    -- reviewable, and §129 capacity turns on it.
    ADD COLUMN IF NOT EXISTS child_maturity_assessed_by VARCHAR(64);

-- Supports "show me every mature-minor self-consent" — the set a retrospective
-- clinical-governance review would ask for first.
CREATE INDEX IF NOT EXISTS idx_consent_records_mature_child
    ON consent_records (patient_id, consent_datetime DESC)
    WHERE consent_giver_capacity = 'child_over_12_mature';
