-- Phase 4.3: per-facility CDS thresholds + CDS audit trail
--
-- Both persist via the shared JsonRecordRepository pattern (id + owner_id +
-- JSONB data + timestamps), consistent with the Round 4-7 JSON-record domains.
--
--  * cds_threshold_configs: one row per facility (id = owner_id = facility_id),
--    data = serialized CdsThresholds. Absent facility => engine default applies.
--  * cds_audit_entries: one row per fired/suppressed CDS alert (owner_id =
--    patient_id), data = { rule_id, alert_title, severity, outcome, facility_id,
--    thresholds_snapshot, ... } for "which rule fired / what action was taken".

CREATE TABLE IF NOT EXISTS cds_threshold_configs (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cds_threshold_configs_owner ON cds_threshold_configs (owner_id);

CREATE TABLE IF NOT EXISTS cds_audit_entries (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cds_audit_entries_owner ON cds_audit_entries (owner_id);
