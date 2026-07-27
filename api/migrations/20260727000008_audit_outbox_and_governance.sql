-- Phase 8: durable audit-outbox and governance decision contracts.
-- Payloads contain privacy-minimised event metadata and hashes only.

CREATE TABLE IF NOT EXISTS audit_outbox_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,
    delivery_attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);

CREATE TABLE IF NOT EXISTS governance_decisions (
    id TEXT PRIMARY KEY,
    decision_type TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    proposal_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected', 'executed', 'cancelled')),
    required_approvals INTEGER NOT NULL CHECK (required_approvals > 0),
    approved_by JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_audit_outbox_undelivered
    ON audit_outbox_events (occurred_at) WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_governance_decisions_subject
    ON governance_decisions (subject_type, subject_id, status);
