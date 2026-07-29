-- Off-chain emergency capsules and their on-chain commitments (Horizon HZ-003).
--
-- Context: `pallet-medical-records` no longer stores `blood_type` in the clear
-- and `pallet-patient-identity` no longer stores `organ_donor`/`dnr_status` at
-- all. What goes on-chain now is a 32-byte commitment plus a version. This is
-- where the committed-to values actually live.
--
-- The 2026-07-28 POPIA legal review (docs/PRODUCTION_READINESS_GATES.md §1)
-- required seven properties of the replacement. This schema supplies the
-- storage half of each:
--
--   * commitment/pointer on-chain only  -> `commitment`, `version`
--   * capsule held off-chain, encrypted -> `capsule_encrypted`, `key_version`
--   * no patient-controlled decrypt on
--     the emergency path                -> encrypted under the SERVER keyring,
--                                          so an authorised break-glass read
--                                          decrypts without the patient being
--                                          online or reachable
--   * every value versioned             -> (patient_id, version) primary key,
--                                          append-only
--   * every value revocable             -> `revoked_at` / `revoked_by`
--   * log who/why/when/which emergency/
--     which fields were revealed        -> `emergency_capsule_access_log`
--   * provenance for the values         -> carried inside the capsule payload
--                                          (see api/src/emergency_capsule.rs)

-- ---------------------------------------------------------------------------
-- Capsules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emergency_capsules (
    patient_id VARCHAR(64) NOT NULL,

    -- Strictly increasing per patient. The pallet rejects a commitment whose
    -- version is not greater than the one already on-chain, so a superseded
    -- capsule cannot be replayed as current.
    version INTEGER NOT NULL,

    -- Hex-encoded SHA3-256 over the domain-separated, length-prefixed capsule
    -- fields. This is the value published on-chain.
    commitment CHAR(64) NOT NULL,

    -- ChaCha20-Poly1305 under the server encryption keyring.
    capsule_encrypted BYTEA NOT NULL,
    key_version INTEGER NOT NULL,

    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Revocation is explicit rather than deletion. A revoked capsule must
    -- remain readable: "this DNR directive was in force between these two
    -- dates and was then withdrawn" is itself clinically and legally
    -- significant, and deleting the row would destroy that.
    revoked_at TIMESTAMPTZ,
    revoked_by VARCHAR(64),
    revocation_reason TEXT,

    -- Outcome of the on-chain commitment submission. `chain_finalized = false`
    -- with a hash present means a placeholder was recorded (blockchain
    -- disabled, node absent, or submission failed) -- NOT that the commitment
    -- is anchored. Callers must not read a hash alone as proof of anchoring.
    chain_tx_hash VARCHAR(128),
    chain_finalized BOOLEAN NOT NULL DEFAULT FALSE,

    PRIMARY KEY (patient_id, version)
);

-- The emergency read path looks up "newest live capsule for this patient" on
-- every break-glass access, and that path is the one with a 3-second budget.
CREATE INDEX IF NOT EXISTS idx_emergency_capsules_current
    ON emergency_capsules (patient_id, version DESC)
    WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Access log
-- ---------------------------------------------------------------------------
-- The review asked for "who accessed it, why, when, under which emergency, and
-- which fields were revealed". The last of those is the reason this is a
-- dedicated table rather than a generic audit row: field-level disclosure has
-- to be queryable to answer a data subject asking what was actually shown.
CREATE TABLE IF NOT EXISTS emergency_capsule_access_log (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL,

    -- Nullable: a read that found no capsule is still an access attempt worth
    -- recording, and recording it as version 0 would be a lie.
    capsule_version INTEGER,

    accessed_by VARCHAR(64) NOT NULL,

    -- Which break-glass grant authorised this read ("under which emergency").
    grant_id VARCHAR(64),
    reason_code VARCHAR(64) NOT NULL,
    reason_text TEXT,

    -- Field names actually returned to the caller, not the fields the capsule
    -- happens to contain.
    fields_revealed TEXT[] NOT NULL,

    -- Whether the off-chain capsule still matched its on-chain commitment at
    -- read time. FALSE means the copy was altered, replaced, or is a different
    -- version than the one committed -- all cases requiring investigation.
    -- Recorded per-access because a tamper that starts mid-campaign should be
    -- visible as the exact read where verification began failing.
    commitment_verified BOOLEAN NOT NULL,

    accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emergency_capsule_access_patient
    ON emergency_capsule_access_log (patient_id, accessed_at DESC);

-- Supports "show me every access where verification failed", which is the
-- query an investigation starts from.
CREATE INDEX IF NOT EXISTS idx_emergency_capsule_access_unverified
    ON emergency_capsule_access_log (accessed_at DESC)
    WHERE commitment_verified = FALSE;
