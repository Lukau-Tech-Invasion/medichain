-- Round 6: shape-mismatch domains
--
-- These had existing typed repositories/entities that model a *different* concept
-- than the legacy handler structs:
--   e_prescriptions_v2     — legacy `EPrescriptionV2` vs typed `EPrescriptionEntity`
--   drug_interaction_checks— legacy `DrugInteractionResult` (a check *session* with
--                            N interactions) vs typed `DrugInteractionEntity` (a single pair)
--   lab_trend_results      — legacy `LabTrendResult` (analysis w/ prediction) vs
--                            typed `LabTrendEntity` (summary row)
--   lab_result_submissions — legacy `LabResultSubmission` (review workflow) vs
--                            typed `LabSubmissionEntity` (order ticket)
--
-- To avoid lossy/ambiguous mapping they persist losslessly via JsonRecordRepository.

CREATE TABLE IF NOT EXISTS e_prescription_v2_records (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_e_prescription_v2_records_owner ON e_prescription_v2_records (owner_id);

CREATE TABLE IF NOT EXISTS drug_interaction_checks (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_drug_interaction_checks_owner ON drug_interaction_checks (owner_id);

CREATE TABLE IF NOT EXISTS lab_trend_results (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lab_trend_results_owner ON lab_trend_results (owner_id);

CREATE TABLE IF NOT EXISTS lab_result_submissions (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lab_result_submissions_owner ON lab_result_submissions (owner_id);
