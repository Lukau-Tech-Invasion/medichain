-- Durable maker-checker history for policy-governed pharmacy dispensing.
--
-- The repository and handlers were introduced with the secondary dispensing
-- workflow, but the table itself was omitted from the migration. Memory-backed
-- tests therefore passed while a clean PostgreSQL schema failed on the first
-- verification request with `relation does not exist`.
CREATE TABLE IF NOT EXISTS prescription_verification_events (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prescription_verification_events_owner
    ON prescription_verification_events (owner_id);

CREATE INDEX IF NOT EXISTS idx_prescription_verification_events_prescription
    ON prescription_verification_events ((data ->> 'prescription_id'));

-- Concurrency belongs in the database as well as the handler. Two API workers
-- may both observe no pending request; only one may commit an open request for
-- a prescription. Closed history remains append-only and does not block a
-- later request after rejection, expiry, or revocation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prescription_verification_one_open_request
    ON prescription_verification_events ((data ->> 'prescription_id'))
    WHERE data ->> 'event_type' = 'verification_requested'
      AND COALESCE((data ->> 'closed')::BOOLEAN, FALSE) = FALSE;
