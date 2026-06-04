-- Phase 8 (Round 7): SOAP clinical notes
--
-- The legacy `SOAPNote` handler struct (subjective/objective/assessment/plan +
-- addenda) had no repository. It persists losslessly via JsonRecordRepository,
-- consistent with the Round 4-6 JSON-record domains. `owner_id` holds the
-- patient_id so per-patient lookups use the owner index.

CREATE TABLE IF NOT EXISTS soap_note_records (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_soap_note_records_owner ON soap_note_records (owner_id);