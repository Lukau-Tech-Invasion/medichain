-- Activate data retention: per-record legal holds, richer policy rules, and a
-- seeded retention matrix.
--
-- Context: `data_retention_policies` and `retention_job_runs` have existed since
-- 20260123000006 with a complete repository layer -- and zero callers. Nothing
-- has ever read a policy or written a job run. The 2026-07-28 POPIA legal
-- review (docs/PRODUCTION_READINESS_GATES.md section 4) put it plainly: "a
-- retention policy without an operational deletion, restriction, and legal-hold
-- process does not enforce retention."
--
-- IMPORTANT -- SCOPE: this migration and the code that consumes it are
-- EVALUATION AND REPORTING ONLY. Nothing here deletes clinical data. The
-- retention job records what WOULD be due (`dry_run = true`) so the policy set
-- can be reviewed against real data before anything destructive is built.
-- Deletion execution is a deliberate, separate, later change.

-- ---------------------------------------------------------------------------
-- Legal holds
-- ---------------------------------------------------------------------------
-- The pre-existing `data_retention_policies.legal_hold_override` is a
-- POLICY-level boolean, which cannot express "this particular patient's records
-- are under litigation hold". A hold has to attach to records, not to a policy,
-- and it has to be auditable: who placed it, why, when, and when it was lifted.

CREATE TABLE IF NOT EXISTS legal_holds (
    id VARCHAR(64) PRIMARY KEY,
    -- Nullable: a hold may cover one patient, or an entire entity type
    -- (e.g. all occupational-health records pending a regulatory enquiry).
    patient_id VARCHAR(64),
    entity_type VARCHAR(100),

    reason TEXT NOT NULL,
    reference VARCHAR(255),          -- case/matter number

    applied_by VARCHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A released hold is retained, not deleted: the fact that records were held
    -- between two dates is itself part of the audit trail.
    released_by VARCHAR(64),
    released_at TIMESTAMPTZ,
    release_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A hold with neither a patient nor an entity type would apply to nothing
    -- and silently protect nothing.
    CONSTRAINT chk_legal_hold_scope
        CHECK (patient_id IS NOT NULL OR entity_type IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_legal_holds_patient
    ON legal_holds (patient_id) WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_legal_holds_entity
    ON legal_holds (entity_type) WHERE released_at IS NULL;

-- ---------------------------------------------------------------------------
-- Richer policy rules
-- ---------------------------------------------------------------------------
-- `retention_period_days` alone cannot express the review's matrix. "Later of
-- the 21st birthday or six years after the last clinical entry" is two rules
-- combined, and "lifetime" is not a number of days at all. Rather than encode
-- that in application code where it would be invisible to anyone reading the
-- policy table, the rule kind becomes explicit data.

ALTER TABLE data_retention_policies
    ADD COLUMN IF NOT EXISTS retention_rule_kind VARCHAR(64)
        NOT NULL DEFAULT 'years_from_last_entry',
    -- Retention periods in these guidelines are stated in YEARS ("6 years from
    -- last entry", "at least 25 years"). The pre-existing
    -- `retention_period_days` column cannot express that exactly -- 6 years is
    -- not a fixed number of days once leap years are involved, and rounding it
    -- would shift a legally-defined boundary by a day or two in either
    -- direction. Storing years lets the calculation land on the same calendar
    -- date the guideline means.
    ADD COLUMN IF NOT EXISTS retention_period_years INTEGER,
    -- Used by age-based rules (e.g. retain until the 21st birthday).
    ADD COLUMN IF NOT EXISTS minimum_age_years INTEGER,
    -- Human-readable citation for why this period applies.
    ADD COLUMN IF NOT EXISTS legal_source TEXT;

-- ---------------------------------------------------------------------------
-- Seed the retention matrix
-- ---------------------------------------------------------------------------
-- Source: National Department of Health guideline on filing, archiving and
-- disposal of patient records, as summarised in the 2026-07-28 legal review.
-- Marked NOT active: these periods are "subject to formal legal confirmation"
-- per the review, and activating an unconfirmed retention schedule is exactly
-- the kind of thing that should require a human to flip deliberately.

-- `retention_period_days` is still populated (approximately) because it is NOT
-- NULL on the existing table, but `retention_period_years` is the value the
-- evaluator actually uses.
INSERT INTO data_retention_policies (
    id, policy_name, entity_type, retention_period_days, retention_period_years,
    retention_period_type, retention_rule_kind, minimum_age_years, legal_source,
    regulatory_basis, is_active, effective_date
) VALUES
    ('RET-CLINICAL-ORDINARY', 'Ordinary clinical records', 'clinical_record',
     2190, 6, 'from_last_access', 'years_from_last_entry', NULL,
     'NDoH guideline: 6 years from last entry', 'POPIA / NDoH', FALSE, CURRENT_DATE),

    ('RET-CLINICAL-MINOR', 'Minor patient records', 'clinical_record_minor',
     2190, 6, 'from_last_access', 'later_of_age_or_years_from_last_entry', 21,
     'NDoH guideline: later of 21st birthday or 6 years after last entry',
     'POPIA / NDoH / Children''s Act', FALSE, CURRENT_DATE),

    ('RET-OBSTETRIC', 'Obstetric records', 'obstetric_record',
     2190, 6, 'from_last_access', 'later_of_age_or_years_from_last_entry', 21,
     'NDoH guideline: later of child reaching 21 or 6-year dormancy',
     'POPIA / NDoH', FALSE, CURRENT_DATE),

    ('RET-INCAPACITY', 'Patients legally incapable / State patients', 'incapacity_record',
     0, NULL, 'from_creation', 'lifetime', NULL,
     'NDoH guideline: retain for lifetime', 'POPIA / NDoH', FALSE, CURRENT_DATE),

    ('RET-OCCUPATIONAL', 'Occupational health & safety incidents', 'occupational_incident',
     7300, 20, 'from_creation', 'years_from_event', NULL,
     'NDoH guideline: 20 years', 'OHSA / POPIA', FALSE, CURRENT_DATE),

    ('RET-LONG-LATENCY', 'Long-latency occupational exposure', 'occupational_exposure',
     9125, 25, 'from_creation', 'years_from_event', NULL,
     'NDoH guideline: at least 25 years', 'OHSA / POPIA', FALSE, CURRENT_DATE),

    ('RET-TRIAL', 'Clinical trial records', 'clinical_trial_record',
     5475, 15, 'from_creation', 'years_from_event', NULL,
     'NDoH guideline: 15 years after completion', 'GCP / POPIA', FALSE, CURRENT_DATE),

    ('RET-FORENSIC', 'Clinical forensic records', 'forensic_record',
     9125, 25, 'from_creation', 'years_from_event', NULL,
     'NDoH guideline: at least 25 years', 'POPIA / NDoH', FALSE, CURRENT_DATE),

    ('RET-AUDIT-EMERGENCY', 'Emergency-access audit events', 'emergency_access_log',
     2190, 6, 'from_creation', 'years_from_event', NULL,
     'Internal baseline: same period as the associated clinical record',
     'POPIA s17', FALSE, CURRENT_DATE),

    ('RET-SECURITY-TELEMETRY', 'General security telemetry', 'security_telemetry',
     730, 2, 'from_creation', 'years_from_event', NULL,
     'Internal baseline: 12-24 months unless attached to an investigation',
     'POPIA s19', FALSE, CURRENT_DATE)
ON CONFLICT (id) DO NOTHING;
