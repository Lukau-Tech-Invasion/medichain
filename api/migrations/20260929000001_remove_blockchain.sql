-- =============================================================================
-- Remove the blockchain; seal the audit stream instead (ADR-0010)
-- =============================================================================
-- Forward-only. The chain columns are dropped, the anchoring tables become the
-- sealed audit stream, and the audit outbox becomes the audit event log.
--
-- Nothing that is hashed or committed is rewritten: access_logs rows, the
-- Merkle members and roots of batches that already exist, and capsule
-- commitments are untouched. The leaf encoding of an access-log row
-- (api/src/audit_merkle.rs) never covered blockchain_tx_hash, so dropping the
-- column changes no leaf.
--
-- `medical_records.on_chain_hash` is dropped, not renamed: nothing ever wrote
-- it (the API always stored NULL) and nothing reads it. The content digest the
-- record carries is `content_checksum`, which stays.
--
-- `users.wallet_address` stays until Phase B.
-- Clinical `chain_of_custody` (table and specimen column) is not a blockchain
-- term and is not touched.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Batches: audit_anchor_batches -> audit_seal_batches
-- ---------------------------------------------------------------------------
ALTER TABLE audit_anchor_batches RENAME TO audit_seal_batches;
ALTER SEQUENCE IF EXISTS audit_anchor_batches_id_seq RENAME TO audit_seal_batches_id_seq;
ALTER INDEX IF EXISTS audit_anchor_batches_pkey RENAME TO audit_seal_batches_pkey;
DROP INDEX IF EXISTS idx_audit_anchor_batches_pending;

-- The old status CHECK and the finalized-has-block CHECK both name 'finalized'.
DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'audit_seal_batches'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%finalized%'
    LOOP
        EXECUTE format('ALTER TABLE audit_seal_batches DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

-- A batch that was 'finalized' on a chain has nothing to keep of that: the
-- transaction and block are dropped below, and the batch is sealed like any
-- other.
UPDATE audit_seal_batches SET status = 'pending' WHERE status = 'finalized';

ALTER TABLE audit_seal_batches
    DROP COLUMN tx_hash,
    DROP COLUMN block_hash,
    DROP COLUMN block_number,
    DROP COLUMN finalized_at;

ALTER TABLE audit_seal_batches
    ADD COLUMN prev_batch_hash TEXT,
    ADD COLUMN batch_hash      TEXT,
    ADD COLUMN signature       TEXT,
    ADD COLUMN signing_key_id  TEXT,
    ADD COLUMN sealed_at       TIMESTAMPTZ,
    ADD COLUMN exported_at     TIMESTAMPTZ,
    ADD COLUMN export_ref      TEXT;

ALTER TABLE audit_seal_batches
    RENAME CONSTRAINT audit_anchor_batch_range TO audit_seal_batch_range;

ALTER TABLE audit_seal_batches
    ADD CONSTRAINT audit_seal_batch_status CHECK (status IN ('pending', 'sealed', 'exported')),
    ADD CONSTRAINT audit_seal_batch_prev_hash_format
        CHECK (prev_batch_hash IS NULL OR prev_batch_hash ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT audit_seal_batch_hash_format
        CHECK (batch_hash IS NULL OR batch_hash ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT audit_seal_batch_signature_format
        CHECK (signature IS NULL OR signature ~ '^[0-9a-f]{128}$'),
    -- A signature always names its key, and a key is never named without one.
    ADD CONSTRAINT audit_seal_batch_signature_has_key
        CHECK ((signature IS NULL) = (signing_key_id IS NULL)),
    -- A sealed or exported batch has its hash and its time; an exported one
    -- also says where it went.
    ADD CONSTRAINT audit_seal_batch_sealed_has_hash
        CHECK (status = 'pending' OR (batch_hash IS NOT NULL AND sealed_at IS NOT NULL)),
    ADD CONSTRAINT audit_seal_batch_exported_has_ref
        CHECK (status <> 'exported' OR (exported_at IS NOT NULL AND export_ref IS NOT NULL));

-- One successor per batch: a fork of the hash chain cannot be stored.
CREATE UNIQUE INDEX idx_audit_seal_batches_prev_hash
    ON audit_seal_batches (prev_batch_hash) WHERE prev_batch_hash IS NOT NULL;
CREATE UNIQUE INDEX idx_audit_seal_batches_hash
    ON audit_seal_batches (batch_hash) WHERE batch_hash IS NOT NULL;
CREATE INDEX idx_audit_seal_batches_pending
    ON audit_seal_batches (id) WHERE status = 'pending';
CREATE INDEX idx_audit_seal_batches_unexported
    ON audit_seal_batches (id) WHERE status = 'sealed';

-- ---------------------------------------------------------------------------
-- 2. Members: audit_anchor_batch_members -> audit_seal_batch_members
-- ---------------------------------------------------------------------------
ALTER TABLE audit_anchor_batch_members RENAME TO audit_seal_batch_members;
ALTER INDEX IF EXISTS audit_anchor_batch_members_pkey RENAME TO audit_seal_batch_members_pkey;
ALTER TABLE audit_seal_batch_members RENAME COLUMN access_log_id TO source_id;
ALTER TABLE audit_seal_batch_members ALTER COLUMN source_id TYPE TEXT;

-- Every existing member is an access-log row.
ALTER TABLE audit_seal_batch_members
    ADD COLUMN source TEXT NOT NULL DEFAULT 'access_log'
        CHECK (source IN ('access_log', 'audit_event'));
ALTER TABLE audit_seal_batch_members ALTER COLUMN source DROP DEFAULT;

-- The old UNIQUE was on access_log_id alone; a row belongs to one batch per
-- source, and an event id must not collide with a log id.
DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'audit_seal_batch_members'::regclass AND contype = 'u'
    LOOP
        EXECUTE format('ALTER TABLE audit_seal_batch_members DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;
ALTER TABLE audit_seal_batch_members
    ADD CONSTRAINT audit_seal_batch_members_source_unique UNIQUE (source, source_id);

-- ---------------------------------------------------------------------------
-- 3. access_logs: anchor_seq -> seal_seq; drop the transaction hash
-- ---------------------------------------------------------------------------
ALTER TABLE access_logs RENAME COLUMN anchor_seq TO seal_seq;
ALTER INDEX IF EXISTS idx_access_logs_anchor_seq RENAME TO idx_access_logs_seal_seq;
-- One counter orders every row that gets sealed, whichever table it is in.
ALTER SEQUENCE IF EXISTS access_logs_anchor_seq_seq RENAME TO audit_seal_seq;
ALTER TABLE access_logs DROP COLUMN blockchain_tx_hash;

-- ---------------------------------------------------------------------------
-- 4. audit_outbox_events -> audit_events
-- ---------------------------------------------------------------------------
ALTER TABLE audit_outbox_events RENAME TO audit_events;
ALTER INDEX IF EXISTS audit_outbox_events_pkey RENAME TO audit_events_pkey;
DROP INDEX IF EXISTS idx_audit_outbox_undelivered;

-- Chain delivery jobs are not audit facts. The 59 batch anchors are jobs for a
-- chain that was never enabled; a per-event anchor job that was never delivered
-- is the same. Real events (access requests, grants, identity claims, registry
-- reads, device revocations, directory searches) stay and are sealed.
DELETE FROM audit_events WHERE event_type = 'audit_batch_chain_anchor';
DELETE FROM audit_events
WHERE delivered_at IS NULL
  AND event_type IN (
      'chain_access_anchor', 'consent_chain_anchor', 'patient_registration_chain_anchor',
      'medical_record_chain_anchor', 'emergency_capsule_chain_anchor'
  );

ALTER TABLE audit_events
    DROP COLUMN delivered_at,
    DROP COLUMN delivery_attempts,
    DROP COLUMN last_error;

-- Same counter as access_logs.seal_seq, so a batch's first_seq/last_seq name one
-- total order across both sources.
ALTER TABLE audit_events
    ADD COLUMN seal_seq BIGINT NOT NULL DEFAULT nextval('audit_seal_seq');
CREATE UNIQUE INDEX idx_audit_events_seal_seq ON audit_events (seal_seq);
CREATE INDEX idx_audit_events_type_aggregate ON audit_events (event_type, aggregate_id);

-- ---------------------------------------------------------------------------
-- 5. Chain columns elsewhere
-- ---------------------------------------------------------------------------
ALTER TABLE emergency_capsules
    DROP COLUMN chain_tx_hash,
    DROP COLUMN chain_finalized;
ALTER TABLE emergency_access_grants DROP COLUMN blockchain_tx_hash;
ALTER TABLE medical_records
    DROP COLUMN blockchain_tx_hash,
    DROP COLUMN on_chain_hash;
ALTER TABLE patients DROP COLUMN blockchain_tx_hash;
ALTER TABLE users
    DROP COLUMN blockchain_address,
    DROP COLUMN blockchain_tx_hash;
