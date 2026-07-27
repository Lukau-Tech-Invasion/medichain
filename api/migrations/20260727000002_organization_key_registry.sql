-- Phase 2 public key directory. Contains public wrapping material only.
CREATE TABLE IF NOT EXISTS organization_keys (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    facility_id TEXT REFERENCES facilities(id),
    key_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    purpose TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    public_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','active','retiring','retired','revoked','compromised','destroyed')),
    proof_of_possession TEXT NOT NULL,
    valid_from TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,
    retired_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    replaced_by TEXT REFERENCES organization_keys(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, key_id, version)
);
CREATE INDEX IF NOT EXISTS idx_organization_keys_active ON organization_keys(organization_id, purpose, status, version DESC);
