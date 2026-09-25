-- Durable laboratory instrument calibration runs.
--
-- Calibration establishes an instrument's measurement relationship; it is not
-- a QC control measurement and cannot safely be squeezed into lab_qc_records.
-- The document preserves the calibrator lot, expiry, result, operator and
-- server-assigned time so recalls remain traceable after application restart.
CREATE TABLE IF NOT EXISTS lab_calibrations (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lab_calibrations_owner
    ON lab_calibrations (owner_id);
CREATE INDEX IF NOT EXISTS idx_lab_calibrations_performed_at
    ON lab_calibrations ((data ->> 'performed_at'));
