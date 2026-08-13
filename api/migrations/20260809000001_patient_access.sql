-- Patient-controlled standing access grants and provider access requests.
--
-- Supersedes the in-process `patient_access::PatientAccessStore` RwLock maps.
-- A consent decision is the patient's exercise of a legal right: it must
-- survive a restart, be auditable years later, and never silently vanish. An
-- HTTP 200 on "revoke Dr X's access" that a process restart undoes is a
-- consent failure, not a caching detail.
--
-- Distinct from `emergency_access_grants` (provider-initiated break-glass,
-- auto-expiring, no patient approval) — here the patient decides.

CREATE TABLE IF NOT EXISTS patient_access_requests (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    provider_role TEXT NOT NULL,
    organization TEXT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'denied'))
);

-- Both list endpoints read newest-first for one patient.
CREATE INDEX IF NOT EXISTS idx_patient_access_requests_patient
    ON patient_access_requests (patient_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS patient_access_grants (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    provider_role TEXT NOT NULL,
    organization TEXT NOT NULL,
    access_type TEXT NOT NULL
        CHECK (access_type IN ('full', 'limited', 'emergency')),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'expired', 'revoked')),
    last_accessed TIMESTAMPTZ,
    access_count INTEGER NOT NULL DEFAULT 0,
    -- Provenance: the request this grant was minted from. NULL is allowed so a
    -- grant can later be issued by a route that is not request-driven.
    source_request_id TEXT REFERENCES patient_access_requests (id)
);

CREATE INDEX IF NOT EXISTS idx_patient_access_grants_patient
    ON patient_access_grants (patient_id, granted_at DESC);

-- Defence in depth behind the conditional `status = 'pending'` UPDATE in
-- `approve_request`: even if two approvals were ever to race past the status
-- check, the database itself refuses to mint a second grant for one request.
CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_access_grants_source_request
    ON patient_access_grants (source_request_id)
    WHERE source_request_id IS NOT NULL;

-- Supports the lazy-expiry sweep applied when grants are listed.
CREATE INDEX IF NOT EXISTS idx_patient_access_grants_expiring
    ON patient_access_grants (expires_at)
    WHERE status = 'active' AND expires_at IS NOT NULL;
