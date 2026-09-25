-- The Visual Infusion Phlebitis scale runs 0-5, not 0-4.
--
-- `iv_assessments.phlebitis_grade` was constrained to `BETWEEN 0 AND 4`, which
-- excludes the top of the scale: stage 5 is advanced thrombophlebitis — a
-- palpable venous cord with pyrexia and purulent discharge — and it is the one
-- stage where the answer is not "resite the cannula" but "resite it and treat
-- the patient".
--
-- Nothing hit the constraint before now because the grade was never written at
-- all: `create_iv_site` hardcoded `phlebitis_grade: None` while the form
-- collected the findings and posted them. The column has been empty since it
-- was created, so widening it cannot invalidate an existing row.

ALTER TABLE iv_assessments
    DROP CONSTRAINT IF EXISTS iv_assessments_phlebitis_grade_check;
ALTER TABLE iv_assessments
    ADD CONSTRAINT iv_assessments_phlebitis_grade_check
    CHECK (phlebitis_grade IS NULL OR phlebitis_grade BETWEEN 0 AND 5);

COMMENT ON COLUMN iv_assessments.phlebitis_grade IS
    'Visual Infusion Phlebitis score, 0-5. Computed by clinical_scoring::vip_score from the recorded site findings; never taken from the client.';
