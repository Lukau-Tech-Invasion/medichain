-- Class B step-up and Class C exact transaction authorization (ADR-0008).
--
-- Step-up state lives on `auth_login_sessions` (columns added with the parent
-- table in 20260825000001) rather than on a refresh generation, so a token
-- rotation underneath an elevation cannot desynchronise it.
--
-- Class C challenges are separate rows because they are per-transaction, not
-- per-session: the server generates one, binds it to the exact intended
-- mutation, and consumes it once.

CREATE TABLE IF NOT EXISTS auth_transaction_challenges (
    id UUID PRIMARY KEY,

    -- Bound to the login session, never to one access token. A token rotation
    -- while the wallet prompt is open must not invalidate an authorization the
    -- user has already approved -- a deliberate divergence from DPoP, which
    -- binds a proof to a particular access-token value.
    login_session_id UUID NOT NULL REFERENCES auth_login_sessions (id),
    wallet_address VARCHAR(128) NOT NULL,

    -- The exact intended mutation. Every one of these is covered by the signed
    -- message, so a signature for one action cannot authorize another.
    action VARCHAR(64) NOT NULL,
    method VARCHAR(8) NOT NULL,
    path TEXT NOT NULL,
    -- SHA-256 of the exact request body BYTES the client will transmit, never a
    -- re-serialisation of a parsed value.
    body_digest CHAR(64) NOT NULL,

    resource_id TEXT,
    -- The concurrency token, per resource class: a terminal status for
    -- state-machine rows ("pending"), or a stringified `xmin` for ordinary
    -- mutable rows. Ephemeral by construction -- it is only meaningful for the
    -- life of this challenge and is never a durable business version.
    expected_state TEXT,
    idempotency_key TEXT,

    -- Only the digest is stored, so a leaked table cannot replay a challenge.
    nonce_hash CHAR(64) NOT NULL,

    -- Which authenticator produced the eventual signature, recorded because a
    -- valid signature proves key possession and only an interactive
    -- authenticator evidences human intent.
    authenticator_type VARCHAR(32),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,

    CONSTRAINT auth_txn_challenge_expiry_after_creation CHECK (expires_at > created_at)
);

-- Rate budget: counts live and recently issued challenges for one session.
CREATE INDEX IF NOT EXISTS idx_auth_txn_challenges_session
    ON auth_transaction_challenges (login_session_id, created_at DESC);

-- Sweeping expired, unconsumed challenges.
CREATE INDEX IF NOT EXISTS idx_auth_txn_challenges_expiry
    ON auth_transaction_challenges (expires_at)
    WHERE consumed_at IS NULL;

-- Security events: rejected authorization proofs, kept apart from the business
-- audit trail. A rejected proof is often the only trace an attack leaves, and it
-- is exactly the event that otherwise goes unrecorded.
--
-- Deliberately holds no raw token, signature, request body or patient detail --
-- only the event kind and safe references.
CREATE TABLE IF NOT EXISTS auth_security_events (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(48) NOT NULL,
    wallet_address VARCHAR(128),
    login_session_id UUID,
    challenge_id UUID,
    action VARCHAR(64),
    detail VARCHAR(200),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_security_events_recent
    ON auth_security_events (occurred_at DESC);

-- Supports the per-subject dedup window that stops an attacker turning invalid
-- signatures into unbounded log volume.
CREATE INDEX IF NOT EXISTS idx_auth_security_events_dedup
    ON auth_security_events (event_type, wallet_address, occurred_at DESC);
