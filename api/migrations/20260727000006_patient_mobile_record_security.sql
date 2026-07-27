-- Phase 6: patient mobile-device registration and encrypted-record access.
-- No plaintext clinical content, private key, or decrypted cache is persisted.

CREATE TABLE IF NOT EXISTS patient_mobile_devices (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    device_label TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
    public_key TEXT NOT NULL,
    attestation_data JSONB,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'reinstalled')),
    last_seen_at TIMESTAMPTZ,
    last_synchronised_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revocation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS protected_mobile_record_sessions (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    device_id TEXT NOT NULL REFERENCES patient_mobile_devices(id),
    record_id TEXT NOT NULL,
    encrypted_content_reference TEXT NOT NULL,
    watermark_text TEXT,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoke_reason TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
    export_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    offline_allowed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_patient_mobile_devices_patient
    ON patient_mobile_devices (patient_id, status);
CREATE INDEX IF NOT EXISTS idx_protected_mobile_record_sessions_active
    ON protected_mobile_record_sessions (device_id, expires_at)
    WHERE status = 'active';
