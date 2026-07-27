-- Phase 33: offline-sync device registry.
-- Uniform JSON-record shape (id, owner_id, data JSONB, created_at, updated_at),
-- same pattern as the other Phase-7 generic domains. id = device_id,
-- owner_id = the registering user's wallet address.

CREATE TABLE IF NOT EXISTS sync_devices (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sync_devices_owner ON sync_devices (owner_id);
