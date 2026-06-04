-- Phase 7 (Round 4): generic JSON-record feature domains
--
-- These feature domains previously lived only in volatile AppState HashMaps and
-- were lost on server restart. Each is now persisted through the shared
-- `JsonRecordRepository` over a uniform schema: a queryable `id` + `owner_id`,
-- the full domain payload in `data` (JSONB), and timestamps.
--
-- Tables:
--   language_preferences  — one row per user (id = user_id), owner_id = user_id
--   eligibility_checks    — id = check_id, owner_id = patient_id
--   satisfaction_surveys  — id = survey_id, owner_id = patient_id
--   symptom_sessions      — id = session_id, owner_id = patient_id
--   family_groups         — id = group_id, owner_id = owner/patient_id
--   insurance_claims      — id = claim_id, owner_id = patient_id
--   autopsy_requests      — id = request_id, owner_id = deceased/patient_id
--   autopsy_reports       — id = report_id, owner_id = deceased/patient_id
--   sync_queue_items      — id = item_id, owner_id = device_id

CREATE TABLE IF NOT EXISTS language_preferences (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_language_preferences_owner ON language_preferences (owner_id);

CREATE TABLE IF NOT EXISTS eligibility_checks (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eligibility_checks_owner ON eligibility_checks (owner_id);

CREATE TABLE IF NOT EXISTS satisfaction_surveys (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_satisfaction_surveys_owner ON satisfaction_surveys (owner_id);

CREATE TABLE IF NOT EXISTS symptom_sessions (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_symptom_sessions_owner ON symptom_sessions (owner_id);

CREATE TABLE IF NOT EXISTS family_groups (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_family_groups_owner ON family_groups (owner_id);

CREATE TABLE IF NOT EXISTS insurance_claims (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_owner ON insurance_claims (owner_id);

CREATE TABLE IF NOT EXISTS autopsy_requests (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_autopsy_requests_owner ON autopsy_requests (owner_id);

CREATE TABLE IF NOT EXISTS autopsy_reports (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_autopsy_reports_owner ON autopsy_reports (owner_id);

CREATE TABLE IF NOT EXISTS sync_queue_items (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sync_queue_items_owner ON sync_queue_items (owner_id);