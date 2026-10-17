-- Unassessed anesthesia technique is unknown, not an empty string or general anesthesia.
-- Retain all existing rows and the accepted legacy values, plus the portal's
-- explicit spinal/epidural choices. SQL CHECK continues rejecting other values.
ALTER TABLE anesthesia_records ALTER COLUMN anesthesia_type DROP NOT NULL;
ALTER TABLE anesthesia_records DROP CONSTRAINT anesthesia_records_anesthesia_type_check;
ALTER TABLE anesthesia_records ADD CONSTRAINT anesthesia_records_anesthesia_type_check
    CHECK (anesthesia_type IN ('general', 'regional', 'local', 'sedation', 'combined', 'mac', 'spinal', 'epidural'));
