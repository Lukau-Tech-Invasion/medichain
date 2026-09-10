-- The `data` blob these entities carry has no column to live in.
--
-- 28 repository entities declare `#[sqlx(skip)] pub data: serde_json::Value`
-- and 70 GET handlers serve or read that blob. On PostgreSQL `sqlx(skip)` means
-- the field is never selected and never written, so the blob is **always**
-- `Value::Null` — while on the in-memory backend it holds exactly what the
-- handler put there. Every one of those endpoints therefore behaves one way in
-- development and another against a database, and the difference is invisible
-- from the response: `200 OK` with a `null` where the record should be.
--
-- Measured 2026-09-10: of those 28 tables, exactly ONE had a `data` column.
--
-- Concretely, this is why:
--
--   * a failed quality-control run stored its Westgard rules and its corrective
--     action and read back without either — the two things that make a failed
--     control actionable;
--   * a specimen collection stored the pre-collection safety checklist and the
--     collection site and read back with neither — the record that the right
--     blood came out of the right arm;
--   * an IV site assessment stored the site findings the VIP score is computed
--     from and read back without them.
--
-- This migration covers the tables whose blob carries content that exists
-- NOWHERE ELSE. The remaining entities in that list keep everything they need
-- in typed columns, and `docs/TECHNICAL_DEBT_REGISTER.md` records which and why,
-- so a future reader does not have to re-derive the distinction.
--
-- `DEFAULT '{}'` rather than NULL: a reader can tell an empty record from a
-- missing one, and every existing row predates the column.

ALTER TABLE lab_qc_records
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN lab_qc_records.data IS
    'The QC run as recorded, including the Westgard rules violated and the corrective action. The typed columns carry the measurement.';

ALTER TABLE specimen_collections
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN specimen_collections.data IS
    'The collection as the bedside form captured it, including the pre-collection safety checklist.';

ALTER TABLE iv_assessments
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN iv_assessments.data IS
    'The cannula and every bedside assessment charted against it, including the findings the VIP score is derived from.';

ALTER TABLE mci_records
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN mci_records.data IS
    'The incident and its casualties, each with the triage category that directs an ambulance.';

ALTER TABLE incident_reports
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN incident_reports.data IS
    'The safety report as filed, including the staff involved and the witnesses.';
