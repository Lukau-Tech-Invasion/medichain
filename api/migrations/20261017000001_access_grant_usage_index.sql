-- Patient-facing grant usage is derived from retained, explicitly linked audit rows.
CREATE INDEX IF NOT EXISTS idx_access_logs_patient_grant_usage
    ON access_logs (patient_id, authority_id, accessed_at DESC)
    WHERE authority_type = 'patient_grant' AND authority_id IS NOT NULL;
