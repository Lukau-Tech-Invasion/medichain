-- Consciousness on the ACVPU scale, one of the seven NEWS2 parameters
-- (clinical_scoring::news2_score). Breathing support already has a column,
-- oxygen_delivery; NEWS2 reads 'room_air' and 'supplemental_oxygen' from it.
-- NULL means not recorded, never "alert" (rule 12).
ALTER TABLE vital_signs ADD COLUMN IF NOT EXISTS consciousness character varying(16);

ALTER TABLE vital_signs DROP CONSTRAINT IF EXISTS vital_signs_consciousness_check;
ALTER TABLE vital_signs ADD CONSTRAINT vital_signs_consciousness_check
    CHECK (consciousness IS NULL OR consciousness IN ('alert', 'new_confusion', 'voice', 'pain', 'unresponsive'));
