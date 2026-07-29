-- Retention execution: approval tokens, processing restriction, deletion register.
--
-- Context: migration 20260729000003 activated retention EVALUATION. This adds
-- the execution half the 2026-07-28 legal review (§4) requires: "restriction
-- before deletion where required", "a deletion register containing minimal
-- non-clinical evidence", and "dry-run reports and approval before destructive
-- runs".
--
-- SCOPE -- WHAT THIS DOES NOT DO: no row here causes a clinical record to be
-- deleted. Execution marks records RESTRICTED (processing limited to storage)
-- and writes a register entry. Irreversible destruction, cascade across caches
-- and object storage, and cryptographic erasure remain unbuilt and are called
-- out as such in docs/PRODUCTION_READINESS_GATES.md §4. This is deliberate: a
-- restriction is recoverable if the policy set turns out to be wrong, and the
-- retention periods are still "subject to formal legal confirmation".

-- ---------------------------------------------------------------------------
-- Approvals
-- ---------------------------------------------------------------------------
-- A run is authorised against the EXACT contents of a dry-run report, not
-- against "whatever is due whenever this executes". Without that binding,
-- approving a report of 3 records could later execute against 3,000 -- the
-- approval would be real but meaningless.
CREATE TABLE IF NOT EXISTS retention_approvals (
    token VARCHAR(64) PRIMARY KEY,

    -- SHA3-256 over the assessment's decisive contents (date, policies, and the
    -- patient ids found due). Re-derived at execution time; a mismatch aborts.
    assessment_digest CHAR(64) NOT NULL,
    assessed_on DATE NOT NULL,

    -- Denormalised so a reviewer sees the size of what they are approving
    -- without re-running the assessment.
    due_count INTEGER NOT NULL,

    requested_by VARCHAR(64) NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Approval is a separate act from request: the same person may do both, but
    -- the two timestamps must exist independently for the record to show that
    -- a decision was taken.
    approved_by VARCHAR(64),
    approved_at TIMESTAMPTZ,

    executed_by VARCHAR(64),
    executed_at TIMESTAMPTZ,

    -- pending | approved | executed | rejected | expired
    status VARCHAR(32) NOT NULL DEFAULT 'pending',

    -- An approval that sits unused goes stale: the record set it describes
    -- drifts as new clinical entries land.
    expires_at TIMESTAMPTZ NOT NULL,

    rejection_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_retention_approvals_open
    ON retention_approvals (requested_at DESC)
    WHERE status IN ('pending', 'approved');

-- ---------------------------------------------------------------------------
-- Processing restrictions
-- ---------------------------------------------------------------------------
-- POPIA restriction: the record is retained but processing is limited. Modelled
-- as its own table rather than a flag on `patients` so that a restriction has
-- provenance (which approval, whose decision, when) and can be lifted without
-- losing the fact that it was in force.
CREATE TABLE IF NOT EXISTS processing_restrictions (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,

    reason TEXT NOT NULL,
    policy_id VARCHAR(64),
    approval_token VARCHAR(64) REFERENCES retention_approvals(token),

    restricted_by VARCHAR(64) NOT NULL,
    restricted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Lifting is recorded, not deleted: "processing was restricted between
    -- these dates" is the auditable fact.
    lifted_by VARCHAR(64),
    lifted_at TIMESTAMPTZ,
    lift_reason TEXT
);

-- The hot query is "is this patient currently restricted", asked on write paths.
CREATE INDEX IF NOT EXISTS idx_processing_restrictions_active
    ON processing_restrictions (patient_id)
    WHERE lifted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Deletion register
-- ---------------------------------------------------------------------------
-- Evidence that a retention decision was carried out. The review asked for
-- "minimal non-clinical evidence" -- so this table records WHICH record was
-- acted on and WHY, and deliberately carries no clinical payload. A register
-- that copied the record's contents in order to prove it was disposed of would
-- defeat the disposal.
CREATE TABLE IF NOT EXISTS deletion_register (
    id VARCHAR(64) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,

    -- 'restricted' today. 'deleted'/'de_identified' are reserved for when
    -- destructive execution is built and separately approved.
    action VARCHAR(32) NOT NULL,

    policy_id VARCHAR(64),
    policy_name VARCHAR(255),
    -- Why the record was due, in the evaluator's terms (rule kind + the date
    -- the period elapsed). Not the record's contents.
    basis TEXT NOT NULL,

    approval_token VARCHAR(64) REFERENCES retention_approvals(token),
    executed_by VARCHAR(64) NOT NULL,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deletion_register_patient
    ON deletion_register (patient_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_deletion_register_executed
    ON deletion_register (executed_at DESC);
