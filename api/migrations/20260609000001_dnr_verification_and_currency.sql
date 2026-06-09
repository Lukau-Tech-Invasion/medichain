-- ============================================================================
-- MediChain: DNR verification metadata + African-currency denomination
-- Created: June 9, 2026
--
-- Additive migration (ADD COLUMN IF NOT EXISTS only). It does NOT drop, alter,
-- or rename any existing column, and is safe to run on an already-populated DB.
--
-- Part 1 (Task 1) — DNR advance-directive verification metadata.
--   A bare `dnr_status` boolean carries no proof. These NULLable columns let a
--   provider attach who verified the advance directive, when, and a document
--   reference. The API only treats DNR as authoritative when status is true AND
--   verified_by + verified_at are present (see clinical_endpoints::medical_id).
--
-- Part 2 (Task 3) — currency denomination.
--   Monetary amounts default to ZAR (South African Rand) rather than USD. The
--   existing DECIMAL amount columns are untouched; a sibling `currency` column
--   names the unit so values are no longer implicitly US dollars.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Part 1: DNR verification metadata on the patients table (stores dnr_status).
-- ----------------------------------------------------------------------------
ALTER TABLE patients ADD COLUMN IF NOT EXISTS dnr_verified_by VARCHAR(64);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS dnr_verified_at TIMESTAMPTZ;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS dnr_document_ref VARCHAR(256);

-- ----------------------------------------------------------------------------
-- Part 2: currency denomination (default ZAR) on monetary tables.
-- ----------------------------------------------------------------------------
ALTER TABLE insurance_records ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'ZAR';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'ZAR';
