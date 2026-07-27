-- Phase 7: retention metadata for telehealth transcripts and recordings.
-- Raw media/text remains in approved encrypted object storage, not this table.

CREATE TABLE IF NOT EXISTS telehealth_retention_artifacts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    artifact_type TEXT NOT NULL CHECK (artifact_type IN ('caption', 'clinical_summary', 'full_transcript', 'recording')),
    encrypted_content_reference TEXT,
    content_hash TEXT,
    model_name TEXT,
    model_version TEXT,
    retention_until TIMESTAMPTZ,
    legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
    legal_hold_reason TEXT,
    legal_hold_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telehealth_retention_due
    ON telehealth_retention_artifacts (retention_until)
    WHERE deleted_at IS NULL AND legal_hold = FALSE;
