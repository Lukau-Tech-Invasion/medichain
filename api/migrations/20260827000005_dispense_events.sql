-- Pharmacy dispensing events (SCR-013).
--
-- The prescription itself carries the running `dispensed_quantity`, because
-- that is what the concurrency guard compares against. This table is the
-- history: who handed over how much, when, and -- when a dispense is corrected
-- -- who corrected it and why.
--
-- APPEND-ONLY BY INTENT
--
-- A reversal marks the original and adds a correction entry. It does not delete
-- the original, because the question afterwards is not only "how much does the
-- patient have" but "who recorded that they had it". A dispensing record that
-- can be erased answers the second question wrongly.
CREATE TABLE IF NOT EXISTS dispense_events (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispense_events_owner
    ON dispense_events (owner_id);

-- The dispensing history for one prescription is the common read.
CREATE INDEX IF NOT EXISTS idx_dispense_events_prescription
    ON dispense_events ((data ->> 'prescription_id'));
