-- Drop the tables whose code was removed on 2026-09-23, with the owner's
-- approval (CLAUDE.md rule 7).
--
-- * Twenty-three typed tables superseded by JSON record stores. Their
--   repositories had no caller; every table held 0 rows when measured on
--   2026-09-12 and again on 2026-09-23. `20260912000001` had already marked
--   each one superseded with COMMENT ON TABLE.
-- * `sessions`: authentication moved to stateless JWTs and nothing read or
--   wrote it -- a table of PII-shaped columns kept for no purpose.
-- * `telehealth_retention_artifacts`: the storage for `telehealth_retention`,
--   a module no handler ever called; removed with it.
--
-- Five LIVE tables declared foreign keys into the superseded ones. Real
-- prescriptions, panels and sync operations are stored elsewhere, so each of
-- those constraints could only ever refuse a correct row: an adherence entry,
-- a medication reminder or a drug-interaction check naming a real
-- prescription id would fail on PostgreSQL. They are dropped first and
-- explicitly, rather than by CASCADE, so what changes is written down here.

ALTER TABLE adherence_logs DROP CONSTRAINT IF EXISTS adherence_logs_prescription_id_fkey;
ALTER TABLE medication_reminders DROP CONSTRAINT IF EXISTS medication_reminders_prescription_id_fkey;
ALTER TABLE drug_interactions DROP CONSTRAINT IF EXISTS drug_interactions_prescription_id_fkey;
ALTER TABLE critical_values DROP CONSTRAINT IF EXISTS critical_values_lab_panel_id_fkey;
ALTER TABLE sync_conflicts DROP CONSTRAINT IF EXISTS sync_conflicts_sync_operation_id_fkey;

-- Six reporting views selected from the superseded tables. Nothing in the API,
-- the clients or the scripts reads any of them, and over empty tables each
-- could only ever report nothing. (The DEA report reads `dispense_events`.)
DROP VIEW IF EXISTS v_active_wearables;
DROP VIEW IF EXISTS v_blood_products_status;
DROP VIEW IF EXISTS v_controlled_substances;
DROP VIEW IF EXISTS v_overdue_immunizations;
DROP VIEW IF EXISTS v_pending_telehealth;
DROP VIEW IF EXISTS v_transfusion_reactions;

-- Dependents before the tables they reference.
DROP TABLE IF EXISTS wearable_integration_logs;
DROP TABLE IF EXISTS wearable_alerts;
DROP TABLE IF EXISTS wearable_data;
DROP TABLE IF EXISTS wearable_devices;
DROP TABLE IF EXISTS telehealth_notes;
DROP TABLE IF EXISTS telehealth_sessions;
DROP TABLE IF EXISTS rpm_readings;
DROP TABLE IF EXISTS remote_patient_monitoring;
DROP TABLE IF EXISTS organ_donation_records;
DROP TABLE IF EXISTS death_records;
DROP TABLE IF EXISTS transfusion_records;
DROP TABLE IF EXISTS crossmatch_records;
DROP TABLE IF EXISTS sync_operations;
DROP TABLE IF EXISTS external_id_mappings;
DROP TABLE IF EXISTS e_prescriptions;
DROP TABLE IF EXISTS lab_panels;
DROP TABLE IF EXISTS lab_trends;
DROP TABLE IF EXISTS billing_codes;
DROP TABLE IF EXISTS compliance_reports;
DROP TABLE IF EXISTS family_medical_history;
DROP TABLE IF EXISTS genetic_test_results;
DROP TABLE IF EXISTS immunization_schedules;
DROP TABLE IF EXISTS vaccine_inventory;

DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS telehealth_retention_artifacts;
