-- Phase 6.3: key rotation. Records which ENCRYPTION_KEYS version a patient row's
-- PHI (first/last name, DOB, phone, email, address, emergency contact,
-- profile_extras) was encrypted under, so a rotated keyring can still decrypt
-- older rows while new writes move to the current version (lazy rotation).
ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS key_version INTEGER NOT NULL DEFAULT 1;
