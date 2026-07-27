-- Phase 5: first-class, server-enforced emergency-access grants.
-- The grant only records authority metadata; no clinical content is stored here.

CREATE TABLE IF NOT EXISTS emergency_access_grants (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    requesting_person_id TEXT NOT NULL,
    professional_identity_id TEXT,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    facility_id TEXT REFERENCES facilities(id),
    device_id TEXT NOT NULL REFERENCES managed_devices(id),
    reason_code TEXT NOT NULL,
    reason_text TEXT,
    scopes JSONB NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'expired', 'revoked')),
    local_audit_id TEXT,
    blockchain_tx_hash TEXT,
    created_from_card_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_emergency_grants_patient_active
    ON emergency_access_grants (patient_id, expires_at)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_emergency_grants_device_active
    ON emergency_access_grants (device_id, expires_at)
    WHERE status = 'active';
