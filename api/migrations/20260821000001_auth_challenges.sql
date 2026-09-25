-- Durable, single-use wallet authentication challenges.
CREATE TABLE IF NOT EXISTS auth_challenges (
    id UUID PRIMARY KEY,
    wallet_address VARCHAR(128) NOT NULL,
    nonce_hash CHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT auth_challenges_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_expiry ON auth_challenges (expires_at);
