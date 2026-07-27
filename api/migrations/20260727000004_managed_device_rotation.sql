-- Phase 4: device credentials and rotation metadata. This extends the Phase 1
-- managed_devices table without changing or deleting existing sync-device data.

ALTER TABLE managed_devices
    ADD COLUMN IF NOT EXISTS current_key_id TEXT,
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_rotation_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS next_rotation_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS device_keys (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES managed_devices(id),
    key_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'retiring', 'retired', 'revoked', 'compromised')),
    valid_from TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,
    replaced_by TEXT REFERENCES device_keys(id),
    revoked_at TIMESTAMPTZ,
    attestation_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (device_id, key_id, version)
);

CREATE INDEX IF NOT EXISTS idx_managed_devices_rotation_due
    ON managed_devices (organization_id, next_rotation_at)
    WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_device_keys_active
    ON device_keys (device_id, status, version DESC);
