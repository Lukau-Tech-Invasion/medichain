-- C1: Emergency-protocol persistence
--
-- The repository entities for Code Blue, Trauma, Stroke, Cardiac, and Sepsis
-- carry unsigned-integer fields (u8/u32 — e.g. GCS, NIHSS, qSOFA, door-to-balloon
-- minutes) that have no native PostgreSQL column type. To persist them losslessly
-- without a brittle column-by-column mapping, each record is serialized to JSONB
-- in `record_json`. `id` and `patient_id` are kept as first-class columns so
-- lookups by id and pagination by patient stay index-backed.
--
-- These tables are intentionally distinct from the typed phase-1 tables
-- (code_blue_records, trauma_assessments, ...) so the change is additive and does
-- not disturb the existing reporting views built on those tables.

CREATE TABLE IF NOT EXISTS ep_code_blue_records (
    id          TEXT PRIMARY KEY,
    patient_id  TEXT NOT NULL,
    record_json JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ep_code_blue_patient ON ep_code_blue_records (patient_id);
CREATE INDEX IF NOT EXISTS idx_ep_code_blue_created ON ep_code_blue_records (created_at DESC);

CREATE TABLE IF NOT EXISTS ep_trauma_assessments (
    id          TEXT PRIMARY KEY,
    patient_id  TEXT NOT NULL,
    record_json JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ep_trauma_patient ON ep_trauma_assessments (patient_id);
CREATE INDEX IF NOT EXISTS idx_ep_trauma_created ON ep_trauma_assessments (created_at DESC);

CREATE TABLE IF NOT EXISTS ep_stroke_assessments (
    id          TEXT PRIMARY KEY,
    patient_id  TEXT NOT NULL,
    record_json JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ep_stroke_patient ON ep_stroke_assessments (patient_id);
CREATE INDEX IF NOT EXISTS idx_ep_stroke_created ON ep_stroke_assessments (created_at DESC);

CREATE TABLE IF NOT EXISTS ep_cardiac_events (
    id          TEXT PRIMARY KEY,
    patient_id  TEXT NOT NULL,
    record_json JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ep_cardiac_patient ON ep_cardiac_events (patient_id);
CREATE INDEX IF NOT EXISTS idx_ep_cardiac_created ON ep_cardiac_events (created_at DESC);

CREATE TABLE IF NOT EXISTS ep_sepsis_assessments (
    id          TEXT PRIMARY KEY,
    patient_id  TEXT NOT NULL,
    record_json JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ep_sepsis_patient ON ep_sepsis_assessments (patient_id);
CREATE INDEX IF NOT EXISTS idx_ep_sepsis_created ON ep_sepsis_assessments (created_at DESC);

COMMENT ON TABLE ep_code_blue_records IS 'Code Blue resuscitation records (JSONB-persisted repository entities)';
COMMENT ON TABLE ep_trauma_assessments IS 'Trauma assessments (JSONB-persisted repository entities)';
COMMENT ON TABLE ep_stroke_assessments IS 'Stroke assessments (JSONB-persisted repository entities)';
COMMENT ON TABLE ep_cardiac_events IS 'Cardiac events (JSONB-persisted repository entities)';
COMMENT ON TABLE ep_sepsis_assessments IS 'Sepsis assessments (JSONB-persisted repository entities)';
