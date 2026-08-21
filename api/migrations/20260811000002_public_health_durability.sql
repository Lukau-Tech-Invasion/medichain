-- Durable storage for the last of the process-memory clinical maps.
--
-- These seven were the remainder of the `AppState` durability backlog measured
-- by `scripts/check-state-durability.py`. Each handler returned HTTP 201 and
-- then lost the record on restart.
--
-- WHY JSON RECORDS RATHER THAN THE TYPED TABLES
--
-- `blood_type_screens`, `transfusion_records` and `e_prescriptions` already
-- have typed tables and repositories, but their columns cannot accept what the
-- API types actually carry. `transfusion_records` alone requires
-- `crossmatch_id`, `administering_nurse_id`, `verifying_nurse_id`,
-- `bedside_verification_time`, `patient_identification_method` and
-- `pre_transfusion_vitals` as NOT NULL, none of which the `BloodTransfusion`
-- handler type supplies — every insert would have failed. Forcing the API type
-- into those columns would mean inventing values for clinical fields, which is
-- worse than not storing them.
--
-- So these follow the "Round 6: shape-mismatch domains" precedent already set
-- in `repositories/postgres/phase7.rs`: lossless JSON persistence under a
-- distinct table name, leaving the typed tables untouched for the day a writer
-- can populate them honestly. `owner_id` holds the patient (or wallet, where
-- the record is not patient-scoped) so per-owner lookups use the index.

CREATE TABLE IF NOT EXISTS blood_type_screen_records (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blood_type_screen_records_owner
    ON blood_type_screen_records (owner_id);

CREATE TABLE IF NOT EXISTS transfusion_event_records (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transfusion_event_records_owner
    ON transfusion_event_records (owner_id);

CREATE TABLE IF NOT EXISTS e_prescription_records (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_e_prescription_records_owner
    ON e_prescription_records (owner_id);

CREATE TABLE IF NOT EXISTS death_certificate_records (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_death_certificate_records_owner
    ON death_certificate_records (owner_id);

CREATE TABLE IF NOT EXISTS family_history_records (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_family_history_records_owner
    ON family_history_records (owner_id);

CREATE TABLE IF NOT EXISTS user_setting_records (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_setting_records_owner
    ON user_setting_records (owner_id);

-- Durability here is a SECURITY property, not retention. `used_emergency_tokens`
-- is the spent-token set backing one-time emergency access: clearing it on
-- restart makes an already-redeemed emergency token replayable against PHI.
-- `owner_id` holds the patient the token was bound to; `data` records when it
-- was spent and by which responder, so a replay attempt is also auditable.
CREATE TABLE IF NOT EXISTS used_emergency_tokens (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_used_emergency_tokens_owner
    ON used_emergency_tokens (owner_id);
