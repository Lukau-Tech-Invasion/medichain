-- Preserve clinician-entered observations; old readings have no recorded note.
ALTER TABLE vital_signs ADD COLUMN IF NOT EXISTS notes TEXT;
