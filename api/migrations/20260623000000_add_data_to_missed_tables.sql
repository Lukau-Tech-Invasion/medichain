-- Add data JSONB column to tables that were missing it, causing data loss on #[sqlx(skip)] fields
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}';
ALTER TABLE medication_reminders ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}';
ALTER TABLE immunization_records ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}';
