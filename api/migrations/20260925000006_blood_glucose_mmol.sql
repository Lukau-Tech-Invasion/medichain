-- Blood glucose moves to mmol/L, the unit South African laboratories and
-- meters report, and to a type that can hold one decimal (5.4 mmol/L).
--
-- The three columns were INTEGER, in mg/dL: the only unit the screens offered.
-- Existing values are therefore CONVERTED (18.016 mg/dL per mmol/L, one
-- decimal) rather than reinterpreted -- read as mmol/L, a stored 110 would be a
-- reading nobody survives. DOUBLE PRECISION follows 20260814000003, which moved
-- the neighbouring vital-sign columns for the same f64 mapping.

ALTER TABLE vital_signs
    ALTER COLUMN blood_glucose TYPE DOUBLE PRECISION
    USING round((blood_glucose / 18.016)::numeric, 1)::double precision;

ALTER TABLE triage_assessments
    ALTER COLUMN blood_glucose TYPE DOUBLE PRECISION
    USING round((blood_glucose / 18.016)::numeric, 1)::double precision;

ALTER TABLE stroke_assessments
    ALTER COLUMN blood_glucose TYPE DOUBLE PRECISION
    USING round((blood_glucose / 18.016)::numeric, 1)::double precision;
