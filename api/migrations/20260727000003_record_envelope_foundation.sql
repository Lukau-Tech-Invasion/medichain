-- Phase 3: additive envelope-encryption metadata. Existing ciphertext and
-- ENCRYPTION_KEYS reads remain supported while records migrate gradually.
CREATE TABLE IF NOT EXISTS record_crypto_metadata (
    record_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    origin_organization_id TEXT NOT NULL REFERENCES organizations(id),
    origin_facility_id TEXT REFERENCES facilities(id),
    crypto_profile TEXT NOT NULL,
    content_algorithm TEXT NOT NULL,
    nonce BYTEA NOT NULL,
    aad_version INTEGER NOT NULL DEFAULT 1,
    ciphertext_uri TEXT NOT NULL,
    ciphertext_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS key_envelopes (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL REFERENCES record_crypto_metadata(record_id),
    recipient_type TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    recipient_key_id TEXT NOT NULL REFERENCES organization_keys(id),
    wrapping_algorithm TEXT NOT NULL,
    wrapped_dek BYTEA NOT NULL,
    access_grant_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    superseded_by TEXT REFERENCES key_envelopes(id)
);
CREATE TABLE IF NOT EXISTS key_usage_index (
    key_id TEXT NOT NULL REFERENCES organization_keys(id),
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    envelope_id TEXT REFERENCES key_envelopes(id),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (key_id, resource_type, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_key_envelopes_record ON key_envelopes(record_id, status);
CREATE INDEX IF NOT EXISTS idx_key_usage_active ON key_usage_index(key_id, active);
