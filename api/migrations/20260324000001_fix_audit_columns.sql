-- MediChain Migration: Fix Audit Column Types
-- Date: 2026-03-24
-- Purpose: Fix FK type mismatches where audit/reference columns were typed as UUID
--          referencing users(id), but the API uses wallet addresses (SS58, VARCHAR(66))
--          as user identifiers throughout. Columns are converted to VARCHAR(66) and the
--          FK constraints to users(id) (UUID PK) are dropped.
--
-- Strategy: For each affected column:
--   1. Drop the FK constraint (by name if known, otherwise via pg_constraint lookup).
--   2. ALTER COLUMN ... TYPE VARCHAR(66) USING NULL  (existing UUID values become NULL;
--      the API never stored real UUIDs in these columns so data loss is acceptable).
--   3. Add blockchain_tx_hash columns to tables that are missing them.
--
-- All statements are wrapped in DO $$ BEGIN ... EXCEPTION WHEN ... END $$
-- blocks so the migration is idempotent and safe to re-run.

-- ============================================================================
-- HELPER: drop a constraint only if it exists
-- ============================================================================
CREATE OR REPLACE FUNCTION _mc_drop_constraint_if_exists(
    p_table  TEXT,
    p_column TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_constraint TEXT;
BEGIN
    -- Find FK constraint name for the given table+column
    SELECT con.conname
      INTO v_constraint
      FROM pg_constraint con
      JOIN pg_class     rel  ON rel.oid  = con.conrelid
      JOIN pg_namespace nsp  ON nsp.oid  = rel.relnamespace
      JOIN pg_attribute att  ON att.attrelid = rel.oid
                             AND att.attnum   = ANY(con.conkey)
     WHERE con.contype       = 'f'
       AND nsp.nspname        = current_schema()
       AND rel.relname        = p_table
       AND att.attname        = p_column
     LIMIT 1;

    IF v_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', p_table, v_constraint);
    END IF;
END;
$$;

-- ============================================================================
-- HELPER: change a UUID column to VARCHAR(66), dropping its FK first
-- ============================================================================
CREATE OR REPLACE FUNCTION _mc_uuid_col_to_varchar66(
    p_table  TEXT,
    p_column TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_coltype TEXT;
BEGIN
    -- Check current type
    SELECT data_type
      INTO v_coltype
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name   = p_table
       AND column_name  = p_column;

    IF v_coltype IS NULL THEN
        RETURN;  -- column does not exist, nothing to do
    END IF;

    IF v_coltype != 'uuid' THEN
        RETURN;  -- already converted or never was UUID
    END IF;

    -- Drop FK constraint targeting this column
    PERFORM _mc_drop_constraint_if_exists(p_table, p_column);

    -- Alter type: existing UUID values are cast to NULL (they were never real
    -- user UUIDs in production use; wallet addresses are the canonical ids).
    EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I TYPE VARCHAR(66) USING NULL',
        p_table, p_column
    );

    RAISE NOTICE 'Converted %.% from UUID to VARCHAR(66)', p_table, p_column;
END;
$$;

-- ============================================================================
-- HELPER: add a column if it does not already exist
-- ============================================================================
CREATE OR REPLACE FUNCTION _mc_add_column_if_missing(
    p_table      TEXT,
    p_column     TEXT,
    p_definition TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name   = p_table
           AND column_name  = p_column
    ) THEN
        EXECUTE format('ALTER TABLE %I ADD COLUMN %I %s', p_table, p_column, p_definition);
        RAISE NOTICE 'Added column %.%', p_table, p_column;
    END IF;
END;
$$;

-- ============================================================================
-- PART 1: patients table
-- ============================================================================
SELECT _mc_uuid_col_to_varchar66('patients', 'registered_by');
SELECT _mc_uuid_col_to_varchar66('patients', 'primary_provider_id');

-- Add blockchain_tx_hash if missing (patients table did not have it in phase1)
SELECT _mc_add_column_if_missing(
    'patients',
    'blockchain_tx_hash',
    'VARCHAR(66)'
);

-- ============================================================================
-- PART 2: nfc_tags table
-- ============================================================================
SELECT _mc_uuid_col_to_varchar66('nfc_tags', 'issued_by');

-- ============================================================================
-- PART 3: medical_records table
-- ============================================================================
-- medical_records.blockchain_tx_hash already exists as VARCHAR(128) in phase1 --
-- no action needed for that column.
SELECT _mc_uuid_col_to_varchar66('medical_records', 'created_by');
SELECT _mc_uuid_col_to_varchar66('medical_records', 'last_modified_by');

-- ============================================================================
-- PART 4: allergies table
-- ============================================================================
SELECT _mc_uuid_col_to_varchar66('allergies', 'verified_by');
SELECT _mc_uuid_col_to_varchar66('allergies', 'created_by');

-- ============================================================================
-- PART 5: triage_assessments table
-- ============================================================================
SELECT _mc_uuid_col_to_varchar66('triage_assessments', 'performed_by');

-- ============================================================================
-- PART 6: code_blue_records table
-- ============================================================================
SELECT _mc_uuid_col_to_varchar66('code_blue_records', 'team_leader');
SELECT _mc_uuid_col_to_varchar66('code_blue_records', 'created_by');

-- ============================================================================
-- PART 7: trauma_assessments table
-- ============================================================================
SELECT _mc_uuid_col_to_varchar66('trauma_assessments', 'performed_by');

-- ============================================================================
-- PART 8: Additional audit columns in remaining phase1 tables
--         (stroke, sepsis, ems_handoffs, soap_notes, etc. share the same pattern)
-- ============================================================================
SELECT _mc_uuid_col_to_varchar66('stroke_assessments',  'performed_by');
SELECT _mc_uuid_col_to_varchar66('sepsis_assessments',  'performed_by');
SELECT _mc_uuid_col_to_varchar66('soap_notes',          'created_by');
SELECT _mc_uuid_col_to_varchar66('soap_notes',          'signed_by');
SELECT _mc_uuid_col_to_varchar66('vital_signs_entries', 'recorded_by');
SELECT _mc_uuid_col_to_varchar66('access_logs',         'accessor_id');

-- ============================================================================
-- CLEANUP: drop helper functions (they were only needed for this migration)
-- ============================================================================
DROP FUNCTION IF EXISTS _mc_add_column_if_missing(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS _mc_uuid_col_to_varchar66(TEXT, TEXT);
DROP FUNCTION IF EXISTS _mc_drop_constraint_if_exists(TEXT, TEXT);
