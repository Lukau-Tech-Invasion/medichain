-- Two repositories persist the complete clinical payload in a `data` JSONB
-- column alongside the typed columns, exactly as the other 39 tables do, but the
-- column was never added to these two. Every INSERT therefore failed with:
--
--     column "data" of relation "nursing_care_plans" does not exist
--
-- so a nursing care plan or a consultation note could not be saved at all, while
-- the in-memory backend accepted both happily.
--
-- Found by cross-referencing every entity that declares a persisted
-- `data: serde_json::Value` field (excluding `#[sqlx(skip)]` ones) against the
-- columns that actually exist.
ALTER TABLE nursing_care_plans ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE consultation_notes ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
