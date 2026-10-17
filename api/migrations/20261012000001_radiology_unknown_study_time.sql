-- An order timestamp is not an observed imaging acquisition timestamp.
-- Preserve all existing values; new reports may explicitly leave the observation unknown.
ALTER TABLE radiology_reports ALTER COLUMN study_datetime DROP NOT NULL;
