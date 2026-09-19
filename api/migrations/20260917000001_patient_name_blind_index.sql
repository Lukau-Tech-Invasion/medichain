-- Keyed SHA3 blind-index tokens, one digest per normalized patient-name word.
-- The plaintext name remains only in the existing application-layer encrypted
-- columns/profile blob. A GIN index serves `@>` equality-token lookups.
ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS name_search_tokens TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_patients_name_search_tokens
    ON patients USING GIN (name_search_tokens)
    WHERE is_active = TRUE;
