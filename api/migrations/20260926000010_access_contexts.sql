-- =============================================================================
-- Server-issued chart access contexts (WP10)
-- =============================================================================
-- A clinician opening a patient's chart declares why. The reason used to
-- travel as a self-declared header on every read; now the declaration is made
-- once, to the server, which checks the clinician's authority (care
-- relationship, patient grant or break-glass, WP9) and records the reason
-- against it. Reads then cite the context's id, and the disclosure row takes
-- the reason from here.
-- =============================================================================

CREATE TABLE IF NOT EXISTS access_contexts (
    id              TEXT PRIMARY KEY,
    patient_id      VARCHAR(64) NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    clinician_id    TEXT NOT NULL,
    reason          TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 140),
    authority_type  TEXT NOT NULL CHECK (authority_type IN (
                        'guardian', 'admin', 'patient_grant', 'care_relationship', 'break_glass'
                    )),
    authority_id    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    -- A context lasts one working shift at most, whatever the client asks.
    CONSTRAINT access_context_is_bounded CHECK (
        expires_at > created_at AND expires_at <= created_at + INTERVAL '12 hours'
    )
);

CREATE INDEX IF NOT EXISTS idx_access_contexts_clinician
    ON access_contexts (clinician_id, patient_id, expires_at);
