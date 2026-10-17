-- Handoff rows use a batch id plus patient id (up to 128 characters).
-- Preserve the exact resource identifier when recording an attributable receipt.
ALTER TABLE access_logs ALTER COLUMN resource_id TYPE VARCHAR(128);
