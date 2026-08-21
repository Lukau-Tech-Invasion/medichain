-- VitalSignsEntity uses f64 for these measured values. PostgreSQL NUMERIC
-- cannot be decoded into f64 by sqlx in RETURNING/SELECT queries.
ALTER TABLE vital_signs ALTER COLUMN temperature TYPE DOUBLE PRECISION USING temperature::double precision;
ALTER TABLE vital_signs ALTER COLUMN weight_kg TYPE DOUBLE PRECISION USING weight_kg::double precision;
ALTER TABLE vital_signs ALTER COLUMN height_cm TYPE DOUBLE PRECISION USING height_cm::double precision;
ALTER TABLE vital_signs ALTER COLUMN bmi TYPE DOUBLE PRECISION USING bmi::double precision;
