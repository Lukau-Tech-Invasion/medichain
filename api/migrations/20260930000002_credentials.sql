-- M3: credentials without keys (ADR-0010, phase C).
--
-- Signing in is an employee ID or username plus a password proof. The proof is
-- derived in the browser and only an Argon2id verifier over it is stored
-- (`users.credential_verifier`, unchanged). What this migration removes is the
-- half of the old design that existed to reach a signing key: the encrypted
-- key blob and the constraint that pairs it with the verifier.
--
-- What it adds:
--   * `credential_grants`  one-time activation / reset codes (keyed hash only)
--   * `user_mfa.last_used_step`  TOTP replay guard
--   * Class C challenges that are completed with a TOTP code or the password
--     instead of a signature, so `required_factor` / `verified_at` replace the
--     stored nonce digest.
--   * `step_up_method` is `totp` or `password`, nothing else.
--
-- Forward-only. Sessions and unconsumed challenges from before this migration
-- are not carried over where their meaning changed.

-- ---------------------------------------------------------------------------
-- 1. users: drop the key blob and the pairing constraint
-- ---------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_credential_pair_complete;
ALTER TABLE users DROP COLUMN IF EXISTS encrypted_keystore;

COMMENT ON COLUMN users.credential_verifier IS
    'Argon2id PHC string over the client-derived auth proof. NULL means the account cannot sign in until a one-time code is redeemed.';
COMMENT ON COLUMN users.login_id IS
    'What the person types to sign in: an employee ID for staff, the chosen username for a patient. One namespace, case-insensitively unique.';

-- ---------------------------------------------------------------------------
-- 2. one-time credential grants
-- ---------------------------------------------------------------------------
CREATE TABLE credential_grants (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id),
    purpose         TEXT NOT NULL CHECK (purpose IN ('activation', 'reset')),
    -- Keyed digest of the code (see `credentials::code_digest`). The code itself
    -- is shown once to the person who issued it and never stored.
    code_hash       CHAR(64) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    -- Spent by a successful redemption.
    consumed_at     TIMESTAMPTZ,
    -- Replaced by a newer grant for the same user and purpose.
    revoked_at      TIMESTAMPTZ,
    -- Wrong codes presented against this grant. At five it is dead.
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    issued_by       UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT credential_grants_expiry_after_creation CHECK (expires_at > created_at),
    CONSTRAINT credential_grants_spent_or_replaced CHECK (consumed_at IS NULL OR revoked_at IS NULL)
);

-- One live grant per user and purpose: issuing another revokes the first, so a
-- code a person lost is never a second way in.
CREATE UNIQUE INDEX credential_grants_one_live
    ON credential_grants (user_id, purpose)
    WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX idx_credential_grants_user ON credential_grants (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. TOTP replay guard
-- ---------------------------------------------------------------------------
-- The 30-second step of the last code accepted. A code from that step or an
-- earlier one is refused, so a code seen over a shoulder is worth nothing.
ALTER TABLE user_mfa ADD COLUMN last_used_step BIGINT;

-- ---------------------------------------------------------------------------
-- 4. step-up and Class C factors
-- ---------------------------------------------------------------------------
UPDATE auth_login_sessions
   SET step_up_method = NULL
 WHERE step_up_method IS NOT NULL AND step_up_method NOT IN ('totp', 'password');
ALTER TABLE auth_login_sessions
    ADD CONSTRAINT auth_login_sessions_step_up_method_check
    CHECK (step_up_method IS NULL OR step_up_method IN ('totp', 'password'));

-- A challenge is completed by a TOTP code or the password, never a signature:
-- the nonce digest that bound a signature is gone, and the factor the account
-- owes is recorded when the challenge is issued.
ALTER TABLE auth_transaction_challenges DROP COLUMN nonce_hash;
ALTER TABLE auth_transaction_challenges ADD COLUMN required_factor VARCHAR(16);
UPDATE auth_transaction_challenges SET required_factor = 'password' WHERE required_factor IS NULL;
ALTER TABLE auth_transaction_challenges
    ALTER COLUMN required_factor SET NOT NULL,
    ADD CONSTRAINT auth_txn_challenge_factor_check CHECK (required_factor IN ('totp', 'password'));

-- Verification and consumption are separate moments: the person proves the
-- factor once (`verified_at`), and the mutation it authorizes spends the
-- challenge (`consumed_at`) only if it is exactly the request that was bound.
ALTER TABLE auth_transaction_challenges ADD COLUMN verified_at TIMESTAMPTZ;

UPDATE auth_transaction_challenges
   SET authenticator_type = NULL
 WHERE authenticator_type IS NOT NULL AND authenticator_type NOT IN ('totp', 'password');
ALTER TABLE auth_transaction_challenges
    ADD CONSTRAINT auth_txn_challenge_authenticator_check
    CHECK (authenticator_type IS NULL OR authenticator_type IN ('totp', 'password'));

-- Rejected proofs are recorded under factor names, not signature names.
UPDATE auth_security_events SET event_type = 'FACTOR_REJECTED' WHERE event_type = 'SIGNATURE_SUBJECT_MISMATCH';
