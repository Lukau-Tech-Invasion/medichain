-- History & Physical could never be saved at all.
--
-- Two independent schema/code disagreements made every submission fail:
--
--   1. `HistoryPhysicalEntity` carries a `data` JSONB field holding the complete
--      clinical payload, exactly as `progress_notes` does, but the table had no
--      such column — so the INSERT failed with
--      `column "data" of relation "history_physicals" does not exist`.
--
--   2. `performed_by` was a UUID constrained to `users.id`, while wallet
--      addresses are the canonical caller identity throughout the API. Every
--      other assessment table that records a clinician this way
--      (triage_assessments, trauma_assessments, sepsis_assessments,
--      stroke_assessments) already uses VARCHAR(66); history_physicals was the
--      outlier. This mirrors the same fix applied to vital_signs and
--      progress_notes in 20260814000002.
ALTER TABLE history_physicals ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE history_physicals DROP CONSTRAINT IF EXISTS history_physicals_performed_by_fkey;
ALTER TABLE history_physicals ALTER COLUMN performed_by TYPE VARCHAR(66) USING performed_by::text;
