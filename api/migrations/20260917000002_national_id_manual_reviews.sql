-- A manual-review case deliberately stores only a keyed identifier digest.
-- The submitted national ID and any government response containing PII are not
-- copied into the review queue.
CREATE TABLE IF NOT EXISTS national_id_manual_reviews (
    id TEXT PRIMARY KEY,
    country TEXT NOT NULL,
    national_id_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ,
    decided_by TEXT,
    evidence_reference TEXT,
    UNIQUE (country, national_id_hash)
);

CREATE INDEX IF NOT EXISTS idx_national_id_manual_reviews_pending
    ON national_id_manual_reviews (requested_at ASC)
    WHERE status = 'pending';
