-- Horizon HZ-023: back three features with real storage.
--
-- Each of these endpoints previously returned hardcoded literals — invented
-- chronic conditions, an invented specimen chain of custody naming staff who
-- performed no such steps, and a fixed two-message inbox — identically in every
-- deployment mode. These tables let the handlers persist and read real data
-- instead. Shape matches the existing JSON-record convention (see
-- 20260722000001_sync_devices.sql), which `pg_json_repo!` expects verbatim.

-- Secure messages. `owner_id` is the RECIPIENT, so an inbox read is a single
-- indexed `get_by_owner`; the sender is carried inside `data` alongside the
-- thread id, subject, body, priority and read flag.
CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_owner ON messages (owner_id);

-- Patient-logged symptom diary entries. Distinct from `symptom_sessions`,
-- which holds symptom-CHECKER conversations: a diary entry is a self-reported
-- observation (symptom, severity, triggers), not a triage dialogue. Conflating
-- the two would mean presenting one as the other.
CREATE TABLE IF NOT EXISTS symptom_entries (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_symptom_entries_owner ON symptom_entries (owner_id);

-- Barcode scan events. `owner_id` is the user who scanned, which serves
-- "my recent scans"; the barcode value is indexed out of `data` so a specimen's
-- chain of custody is assembled from the scans actually recorded against it.
CREATE TABLE IF NOT EXISTS barcode_scans (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_barcode_scans_owner ON barcode_scans (owner_id);
CREATE INDEX IF NOT EXISTS idx_barcode_scans_value
    ON barcode_scans ((data ->> 'barcode_value'));
