-- "My patients" for the doctor's Today view (UX plan WP 3.1) reads a
-- clinician's active relationships. The only index leads with patient_id, so
-- that read was a full scan of every relationship in the system.
CREATE INDEX IF NOT EXISTS idx_care_relationships_clinician_active
    ON care_relationships (clinician_id, starts_at DESC)
    WHERE clinician_id IS NOT NULL;
