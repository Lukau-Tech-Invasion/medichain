-- An obstetric finding nobody recorded is NULL, not 0 or false (rules 9 and 12).
--
-- Gestational age, gravida and para were NOT NULL integers, and prenatal care,
-- contractions and rupture of membranes NOT NULL booleans with defaults
-- (prenatal care defaulting to true). The obstetric form now sends only what
-- was entered, and an absent value had nowhere to go but a zero or a default:
-- "0 weeks", "G0 P0", "no contractions", "membranes intact" for a patient
-- nobody examined. Existing rows keep the values they were written with.
ALTER TABLE obstetric_emergencies
    ALTER COLUMN gestational_age_weeks DROP NOT NULL,
    ALTER COLUMN gravida DROP NOT NULL,
    ALTER COLUMN para DROP NOT NULL,
    ALTER COLUMN prenatal_care DROP NOT NULL,
    ALTER COLUMN prenatal_care DROP DEFAULT,
    ALTER COLUMN contractions DROP NOT NULL,
    ALTER COLUMN contractions DROP DEFAULT,
    ALTER COLUMN rupture_of_membranes DROP NOT NULL,
    ALTER COLUMN rupture_of_membranes DROP DEFAULT;

-- Accelerations and the FHR category had no column: the form sent them, the
-- category was computed in the browser (rule 8), and neither was read back.
-- The category is now the server's (clinical_scoring::fhr_category).
ALTER TABLE obstetric_emergencies
    ADD COLUMN IF NOT EXISTS fetal_accelerations boolean,
    ADD COLUMN IF NOT EXISTS fhr_category character varying(8);
