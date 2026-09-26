-- =============================================================================
-- Merkle batch anchoring of the access audit (WP8)
-- =============================================================================
-- In place of one chain extrinsic per read, a background job takes the
-- access_logs rows not yet batched, hashes each canonical row into a leaf
-- (api/src/audit_merkle.rs), builds a Merkle tree, and queues its root in
-- audit_outbox_events for AccessControl::anchor_audit_batch.
--
-- `anchor_seq` orders rows for batching and is what a batch's from/to name.
-- A row whose insert commits late (a lower sequence number than a batch that
-- already ran) is not lost: the job selects rows with no membership, not rows
-- above a high-water mark, so a straggler joins the next batch.
--
-- Member rows hold only leaf hashes, never audit content, and deliberately
-- have no foreign key to access_logs: deleting one audit row under retention
-- must not make every other row's proof in that batch unverifiable.
-- =============================================================================

ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS anchor_seq BIGSERIAL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_logs_anchor_seq ON access_logs (anchor_seq);

CREATE TABLE IF NOT EXISTS audit_anchor_batches (
    id              BIGSERIAL PRIMARY KEY,
    merkle_root     TEXT NOT NULL CHECK (merkle_root ~ '^[0-9a-f]{64}$'),
    first_seq       BIGINT NOT NULL,
    last_seq        BIGINT NOT NULL,
    leaf_count      INTEGER NOT NULL CHECK (leaf_count > 0),
    -- pending: queued for the chain (or the chain is off); finalized: the
    -- root is in a finalized block, recorded only from that transaction.
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'finalized')),
    tx_hash         TEXT,
    block_hash      TEXT,
    block_number    BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finalized_at    TIMESTAMPTZ,
    CONSTRAINT audit_anchor_batch_range CHECK (first_seq <= last_seq),
    CONSTRAINT audit_anchor_batch_finalized_has_block CHECK (
        status <> 'finalized'
        OR (tx_hash IS NOT NULL AND block_hash IS NOT NULL AND finalized_at IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS audit_anchor_batch_members (
    batch_id        BIGINT NOT NULL REFERENCES audit_anchor_batches (id) ON DELETE RESTRICT,
    leaf_index      INTEGER NOT NULL CHECK (leaf_index >= 0),
    access_log_id   VARCHAR(64) NOT NULL UNIQUE,
    leaf_hash       TEXT NOT NULL CHECK (leaf_hash ~ '^[0-9a-f]{64}$'),
    PRIMARY KEY (batch_id, leaf_index)
);

CREATE INDEX IF NOT EXISTS idx_audit_anchor_batches_pending
    ON audit_anchor_batches (id) WHERE status = 'pending';
