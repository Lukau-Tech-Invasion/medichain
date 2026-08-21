-- Staff credential login: a human-friendly identifier and the material needed
-- to reach the clinician's sr25519 key without the server ever holding it.
--
-- Why this exists
-- ---------------
-- Before this, the only production-viable way into the doctor portal was the
-- Polkadot browser extension; the alternative was typing a 48-character SS58
-- address into a box, which cannot produce the request signatures the API
-- requires and so failed on every call (docs/WORKFLOW_AUDIT.md, WF-001/WF-002).
--
-- The design keeps wallet signatures as the sole authority to act. A password
-- only gets the clinician *to* their key:
--
--   credential_verifier  Argon2id (PHC string) over a client-derived auth
--                        proof, NOT over the raw password. The client derives
--                        the proof and the keystore secret from the same
--                        password down two domain-separated paths, so the
--                        value the server stores cannot open the keystore.
--   encrypted_keystore   The sr25519 pair in Polkadot's encrypted-JSON format,
--                        sealed with the keystore secret. Opaque to the server
--                        by construction: it is stored and returned, never
--                        parsed or decrypted here.
--
-- Losing the password therefore loses the key. That is the intended trade —
-- the alternative is a server that can forge any clinician's signature — and
-- it is why recovery is re-provisioning by an administrator (a new keypair and
-- a re-issued on-chain role) rather than a password reset.
--
-- `username` is deliberately NOT reused as the login handle: it is already
-- non-unique in existing data (48 rows, 20 distinct values) because demo
-- seeding reuses names like 'demo_doctor'. Adding a unique constraint there
-- would fail on live data and would make an existing display field
-- security-relevant. `login_id` is new, so it is unique from the start.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS login_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS credential_verifier TEXT,
    ADD COLUMN IF NOT EXISTS encrypted_keystore TEXT,
    ADD COLUMN IF NOT EXISTS credential_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN users.login_id IS
    'Employee identifier the clinician types to sign in. Case-insensitively unique. Never a wallet address.';
COMMENT ON COLUMN users.credential_verifier IS
    'Argon2id PHC string over the client-derived auth proof. Cannot decrypt encrypted_keystore.';
COMMENT ON COLUMN users.encrypted_keystore IS
    'Polkadot encrypted-JSON sr25519 keystore. Opaque to the server; only the client can open it.';

-- Case-insensitive uniqueness. Partial, so the 48 existing wallet-only accounts
-- (all with login_id NULL) are unaffected and can be migrated one at a time.
CREATE UNIQUE INDEX IF NOT EXISTS users_login_id_lower_key
    ON users (lower(login_id))
    WHERE login_id IS NOT NULL;

-- Email is already UNIQUE, but not case-insensitively, so 'A@b.c' and 'a@b.c'
-- could both exist and make a login ambiguous. No rows have an email yet
-- (verified: count(email) = 0), so this cannot fail on existing data.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
    ON users (lower(email))
    WHERE email IS NOT NULL;

-- An account is credential-enabled only when it has both halves. A verifier
-- without a keystore would authenticate someone into a session with no signing
-- key — a login that appears to work and then fails every request, which is
-- precisely the failure mode this whole change exists to remove.
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_credential_pair_complete;
ALTER TABLE users
    ADD CONSTRAINT users_credential_pair_complete
    CHECK (
        (credential_verifier IS NULL AND encrypted_keystore IS NULL)
        OR (credential_verifier IS NOT NULL AND encrypted_keystore IS NOT NULL)
    );

-- Credentials are meaningless without a handle to present them against.
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_credential_needs_handle;
ALTER TABLE users
    ADD CONSTRAINT users_credential_needs_handle
    CHECK (
        credential_verifier IS NULL
        OR login_id IS NOT NULL
        OR email IS NOT NULL
    );
