-- Split a stable login session from the refresh-token generations beneath it.
--
-- `auth_sessions` conflated two lifetimes. Rotation revoked its row and inserted
-- a new one with a fresh UUID, so nothing survived a refresh -- there was no
-- identifier that meant "this login". An access token therefore could not carry
-- a session claim worth binding anything to: a ten-minute step-up elevation
-- would have died at the next token refresh, and a transaction-authorization
-- challenge issued before a rotation would have failed verification after it.
--
-- The generation model itself is deliberately kept. Revoking the predecessor and
-- inserting a successor is what proves, per AUTH-002, that two concurrent uses of
-- one refresh token yield exactly one valid successor. Rotating a single row in
-- place would have discarded that evidence to make the identifier convenient.
--
--     auth_login_sessions S          <- sid: stable for the whole login
--       |- auth_sessions G1  [rotated]
--       |- auth_sessions G2  [rotated]
--       `- auth_sessions G3  [active]
--
-- Class B elevation state lives on the parent, so rotation underneath it cannot
-- desynchronise it, and revoking the parent kills every generation at once.

CREATE TABLE IF NOT EXISTS auth_login_sessions (
    id UUID PRIMARY KEY,
    wallet_address VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_authenticated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Class B step-up. Held here rather than on a generation precisely so a
    -- refresh does not silently extend or drop an elevation.
    step_up_until TIMESTAMPTZ,
    step_up_method VARCHAR(64),

    revoked_at TIMESTAMPTZ,
    revocation_reason VARCHAR(64)
);

-- Logout-all revokes every parent for one wallet; this is the index it uses.
CREATE INDEX IF NOT EXISTS idx_auth_login_sessions_wallet_active
    ON auth_login_sessions (wallet_address)
    WHERE revoked_at IS NULL;

-- Each refresh generation now names the login it belongs to. Nullable only so
-- the column can be added to a populated table; the backfill below fills every
-- existing row and the NOT NULL is applied afterwards.
ALTER TABLE auth_sessions
    ADD COLUMN IF NOT EXISTS login_session_id UUID;

-- Backfill. Every historical `auth_sessions` row becomes its own single-generation
-- login: the old model gave no way to tell which rows once belonged together, and
-- inventing a grouping would fabricate session history that never existed. Revoked
-- generations produce revoked parents so a stale row cannot resurrect as an active
-- login.
INSERT INTO auth_login_sessions (
    id, wallet_address, created_at, last_authenticated_at, revoked_at, revocation_reason
)
SELECT
    s.id,
    s.wallet_address,
    s.created_at,
    COALESCE(s.last_used_at, s.created_at),
    s.revoked_at,
    s.revocation_reason
FROM auth_sessions s
WHERE s.login_session_id IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE auth_sessions
SET login_session_id = id
WHERE login_session_id IS NULL;

ALTER TABLE auth_sessions
    ALTER COLUMN login_session_id SET NOT NULL;

-- Deliberately NOT ON DELETE CASCADE: a login session is revoked, never deleted,
-- and its generations are the audit trail of that login.
ALTER TABLE auth_sessions
    DROP CONSTRAINT IF EXISTS auth_sessions_login_session_fk;
ALTER TABLE auth_sessions
    ADD CONSTRAINT auth_sessions_login_session_fk
    FOREIGN KEY (login_session_id) REFERENCES auth_login_sessions (id);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_login_session
    ON auth_sessions (login_session_id);
