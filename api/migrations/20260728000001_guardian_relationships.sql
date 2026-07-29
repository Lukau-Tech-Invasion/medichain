-- Persistent, permission-granular guardian relationships.
-- Supersedes the Horizon HZ-008 in-memory GuardianRegistry: a guardian's
-- relationship to a ward (parent, legal proxy, foster carer, power of
-- attorney) must survive restarts and can span years, so it cannot live only
-- in a process-lifetime RwLock. Permissions are granular (view records, sign
-- consent, book appointments, etc.) rather than a single boolean "is guardian"
-- flag, and relationships can be time-limited via expires_at (e.g. foster
-- care) without being revoked outright.

CREATE TABLE IF NOT EXISTS guardian_relationships (
    id TEXT PRIMARY KEY,
    guardian_wallet TEXT NOT NULL,
    ward_patient_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL
        CHECK (relationship_type IN ('parent_or_guardian', 'legal_proxy', 'power_of_attorney')),
    permissions TEXT[] NOT NULL DEFAULT '{}',
    verified_by TEXT NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_guardian_relationships_ward
    ON guardian_relationships (ward_patient_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_guardian_relationships_guardian
    ON guardian_relationships (guardian_wallet) WHERE active;
