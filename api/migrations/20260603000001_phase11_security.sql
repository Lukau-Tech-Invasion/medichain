-- Phase 11 security hardening: persistent MFA enrollments + security alerts.
--
-- MFA secrets are stored ENCRYPTED (ChaCha20-Poly1305 via the app encryption key),
-- never in plaintext. Security alerts contain no PHI (only actor wallet + message).

CREATE TABLE IF NOT EXISTS user_mfa (
    wallet_address    TEXT PRIMARY KEY,
    -- Serialized EncryptedData (nonce || ciphertext) of the base32 TOTP secret.
    secret_encrypted  BYTEA       NOT NULL,
    enabled           BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_alerts (
    id              TEXT PRIMARY KEY,
    kind            TEXT        NOT NULL,
    severity        TEXT        NOT NULL,
    actor           TEXT,
    message         TEXT        NOT NULL,
    notify_deadline TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_alerts_created_at
    ON security_alerts (created_at DESC);

-- Insurance cards (Phase 13.4) — JSON-record domain (id + owner_id + JSONB data).
CREATE TABLE IF NOT EXISTS insurance_cards (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT        NOT NULL,
    data       JSONB       NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insurance_cards_owner
    ON insurance_cards (owner_id);
