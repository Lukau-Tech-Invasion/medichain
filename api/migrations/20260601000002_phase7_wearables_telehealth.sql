-- Round 5: wearables + telehealth legacy shapes
--
-- These domains already had typed repositories (WearableDeviceRepository, etc.),
-- but the rich legacy structs (WearableDevice, WearableReading, WearableAlert,
-- WearableAlertRule, TelehealthSession) do not map cleanly onto those typed
-- entities. To persist them losslessly they use the shared JsonRecordRepository:
-- queryable `id` + `owner_id`, full payload in `data` (JSONB).
--
-- Tables:
--   wearable_device_records   — id = device_id,  owner_id = patient_id
--   wearable_reading_records  — id = reading_id, owner_id = patient_id
--   wearable_alert_records    — id = alert_id,   owner_id = patient_id
--   wearable_alert_rules      — id = rule_id,    owner_id = patient_id
--   telehealth_session_records— id = session_id, owner_id = patient_id

CREATE TABLE IF NOT EXISTS wearable_device_records (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wearable_device_records_owner ON wearable_device_records (owner_id);

CREATE TABLE IF NOT EXISTS wearable_reading_records (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wearable_reading_records_owner ON wearable_reading_records (owner_id);

CREATE TABLE IF NOT EXISTS wearable_alert_records (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wearable_alert_records_owner ON wearable_alert_records (owner_id);

CREATE TABLE IF NOT EXISTS wearable_alert_rules (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wearable_alert_rules_owner ON wearable_alert_rules (owner_id);

CREATE TABLE IF NOT EXISTS telehealth_session_records (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_telehealth_session_records_owner ON telehealth_session_records (owner_id);
