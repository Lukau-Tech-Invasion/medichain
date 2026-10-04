-- Encrypted document bytes are durable in PostgreSQL. Existing IPFS CIDs can
-- be copied here under their original identifier before the old node retires.
CREATE TABLE IF NOT EXISTS encrypted_document_blobs (
    content_hash TEXT PRIMARY KEY,
    encrypted_bytes BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT encrypted_document_blobs_nonempty CHECK (octet_length(encrypted_bytes) > 0)
);
