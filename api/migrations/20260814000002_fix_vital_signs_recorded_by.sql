-- Wallet addresses are the canonical caller identity throughout the API and
-- are not UUIDs. The original schema constrained recorded_by to users.id,
-- making every real browser submission fail after PostgreSQL was enabled.
ALTER TABLE vital_signs DROP CONSTRAINT IF EXISTS vital_signs_recorded_by_fkey;
ALTER TABLE vital_signs ALTER COLUMN recorded_by TYPE VARCHAR(66) USING recorded_by::text;

-- Progress-note repositories preserve the complete clinical payload in data,
-- and creator/cosigner identities use the same wallet-address convention.
ALTER TABLE progress_notes ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE progress_notes DROP CONSTRAINT IF EXISTS progress_notes_created_by_fkey;
ALTER TABLE progress_notes DROP CONSTRAINT IF EXISTS progress_notes_cosigned_by_fkey;
ALTER TABLE progress_notes ALTER COLUMN created_by TYPE VARCHAR(66) USING created_by::text;
ALTER TABLE progress_notes ALTER COLUMN cosigned_by TYPE VARCHAR(66) USING cosigned_by::text;
