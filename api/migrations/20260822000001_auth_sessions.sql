-- Durable rotating refresh sessions. The raw JWT is never stored: only a
-- one-way digest, its signed JTI, and lifecycle timestamps are retained.
CREATE TABLE IF NOT EXISTS auth_sessions (
    id UUID PRIMARY KEY,
    wallet_address VARCHAR(128) NOT NULL,
    refresh_token_hash CHAR(64) NOT NULL UNIQUE,
    refresh_jti UUID NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revocation_reason VARCHAR(64),
    CONSTRAINT auth_sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_wallet_active
    ON auth_sessions (wallet_address, expires_at)
    WHERE revoked_at IS NULL;
