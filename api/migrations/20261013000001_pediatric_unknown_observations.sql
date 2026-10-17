-- Preserve historical records; missing new observations must stay unknown.
ALTER TABLE pediatric_assessments
    ALTER COLUMN age_months DROP NOT NULL,
    ALTER COLUMN age_months DROP DEFAULT,
    ALTER COLUMN weight_estimated DROP NOT NULL,
    ALTER COLUMN weight_estimated DROP DEFAULT,
    ALTER COLUMN parent_guardian_present DROP NOT NULL,
    ALTER COLUMN parent_guardian_present DROP DEFAULT,
    ALTER COLUMN child_protective_concerns DROP NOT NULL,
    ALTER COLUMN child_protective_concerns DROP DEFAULT,
    ALTER COLUMN cps_notified DROP NOT NULL,
    ALTER COLUMN cps_notified DROP DEFAULT;
