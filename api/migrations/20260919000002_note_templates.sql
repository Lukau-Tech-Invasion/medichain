-- Clinician-authored note templates, shared across the facility.
--
-- The template screen's Create, Duplicate and Delete announced success and
-- changed only the browser's list: every template vanished on reload, and
-- using one was refused as unknown. `owner_id` is the author's wallet; the
-- template body, its ordered sections and its active/deactivated status are in
-- `data`. Rows are deactivated, never deleted (ADR-0005).
CREATE TABLE IF NOT EXISTS note_templates (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_note_templates_owner ON note_templates (owner_id);
