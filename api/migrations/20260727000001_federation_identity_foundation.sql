-- Phase 1: additive federation identity foundation. Legacy users and patient
-- records remain valid while application code migrates to explicit contexts.

CREATE TABLE IF NOT EXISTS persons (
    id TEXT PRIMARY KEY,
    wallet_address TEXT UNIQUE,
    legal_identity_reference TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    organization_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    parent_organization_id TEXT REFERENCES organizations(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    suspended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS facilities (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    facility_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    location JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patient_profiles (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES persons(id),
    medical_id TEXT UNIQUE,
    legacy_patient_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS professional_identities (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES persons(id),
    professional_registration TEXT,
    profession TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_assignments (
    id TEXT PRIMARY KEY,
    professional_identity_id TEXT NOT NULL REFERENCES professional_identities(id),
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    facility_id TEXT REFERENCES facilities(id),
    role TEXT NOT NULL,
    department TEXT,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS managed_devices (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    facility_id TEXT REFERENCES facilities(id),
    device_name TEXT NOT NULL,
    device_type TEXT NOT NULL,
    hardware_fingerprint TEXT UNIQUE,
    platform TEXT,
    ownership TEXT,
    status TEXT NOT NULL DEFAULT 'enrolled',
    compliance_state TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revocation_reason TEXT
);

CREATE TABLE IF NOT EXISTS login_contexts (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES persons(id),
    wallet_address TEXT NOT NULL,
    context_type TEXT NOT NULL CHECK (context_type IN ('patient', 'professional')),
    patient_profile_id TEXT REFERENCES patient_profiles(id),
    organization_assignment_id TEXT REFERENCES organization_assignments(id),
    device_id TEXT REFERENCES managed_devices(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CHECK (
        (context_type = 'patient' AND patient_profile_id IS NOT NULL AND organization_assignment_id IS NULL)
        OR (context_type = 'professional' AND organization_assignment_id IS NOT NULL AND patient_profile_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_patient_profiles_person ON patient_profiles(person_id);
CREATE INDEX IF NOT EXISTS idx_professional_identities_person ON professional_identities(person_id);
CREATE INDEX IF NOT EXISTS idx_assignments_organization ON organization_assignments(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_login_contexts_wallet_expiry ON login_contexts(wallet_address, expires_at);
