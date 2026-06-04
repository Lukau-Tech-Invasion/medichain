-- Phase 8 (Round 7): patient profile lossless persistence
--
-- The rich app-level `PatientProfile` (address struct, insurance, primary_doctor,
-- community_health_worker, preferences, advanced_directives, family_notifications,
-- structured emergency_info) has no home in the typed `patients` columns. Rather
-- than a lossy mapping, the full profile is serialized to JSON and encrypted with
-- ChaCha20-Poly1305 (same per-deployment key used for IPFS document encryption),
-- then stored here. Typed columns remain populated for lookup/search; this blob
-- is the lossless source of truth on read.
--
-- This is a real persisted column (not a #[sqlx(skip)] in-memory escape hatch),
-- so a PostgreSQL round-trip preserves the entire profile.

ALTER TABLE patients ADD COLUMN IF NOT EXISTS profile_extras_encrypted BYTEA;
