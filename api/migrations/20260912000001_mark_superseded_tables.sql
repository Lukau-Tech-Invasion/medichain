-- Twenty-three tables that look like the record and are not.
--
-- Each has a typed repository in `api/src/repositories/traits.rs` with a real
-- schema behind it -- columns, CHECK constraints, foreign keys -- and **no
-- caller anywhere in the binary**. The handlers write to a
-- `JsonRecordRepository` instead, so the typed table stays empty while its JSON
-- counterpart holds everything. Verified 2026-09-12: all of them have 0 rows.
--
-- The hazard is not the wasted schema. It is that anyone reading this database
-- -- writing a report, planning a migration, answering "where do transfusions
-- live?" -- will find `transfusion_records`, see a sensible schema, and be
-- wrong. A comment is the only thing a schema reader is guaranteed to see.
--
-- This does NOT decide which direction wins. Both are defensible and the choice
-- belongs to the owner:
--
--   * migrate the handlers onto the typed repositories -- the better design,
--     because a JSONB blob enforces no CHECK constraint and this codebase has
--     repeatedly shipped defects that only PostgreSQL's constraints would have
--     caught (see 20260911000001 and the `reminder_type` entry in the debt
--     register); or
--   * remove the typed repositories and their tables, accepting the JSON stores
--     as the design.
--
-- Until then, the schema says what is true.

COMMENT ON TABLE billing_codes IS
    'SUPERSEDED AND EMPTY. No code path reads or writes this table. See docs/TECHNICAL_DEBT_REGISTER.md (2026-09-11, superseded typed repositories).';
COMMENT ON TABLE compliance_reports IS
    'SUPERSEDED AND EMPTY. No code path reads or writes this table. See docs/TECHNICAL_DEBT_REGISTER.md (2026-09-11, superseded typed repositories).';
COMMENT ON TABLE crossmatch_records IS
    'SUPERSEDED AND EMPTY. No code path reads or writes this table. See docs/TECHNICAL_DEBT_REGISTER.md (2026-09-11, superseded typed repositories).';
COMMENT ON TABLE death_records IS
    'SUPERSEDED AND EMPTY. Death certificates are stored as JSON records (repository `death_certificate_records`), not here.';
COMMENT ON TABLE e_prescriptions IS
    'SUPERSEDED AND EMPTY. Prescriptions are stored as JSON records (repositories `e_prescriptions_v2` and `e_prescription_records`), not here.';
COMMENT ON TABLE external_id_mappings IS
    'SUPERSEDED AND EMPTY. No code path reads or writes this table. See docs/TECHNICAL_DEBT_REGISTER.md (2026-09-11, superseded typed repositories).';
COMMENT ON TABLE genetic_test_results IS
    'SUPERSEDED AND EMPTY. No code path reads or writes this table. See docs/TECHNICAL_DEBT_REGISTER.md (2026-09-11, superseded typed repositories).';
COMMENT ON TABLE immunization_schedules IS
    'SUPERSEDED AND EMPTY. No code path reads or writes this table. See docs/TECHNICAL_DEBT_REGISTER.md (2026-09-11, superseded typed repositories).';
COMMENT ON TABLE lab_panels IS
    'SUPERSEDED AND EMPTY. No code path reads or writes this table. See docs/TECHNICAL_DEBT_REGISTER.md (2026-09-11, superseded typed repositories).';
COMMENT ON TABLE lab_trends IS
    'SUPERSEDED AND EMPTY. Lab trends are stored as JSON records (repository `lab_trend_results`), not here.';
COMMENT ON TABLE organ_donation_records IS
    'SUPERSEDED AND EMPTY. No code path reads or writes this table. Organ-donor status lives on the patient''s emergency capsule.';
COMMENT ON TABLE remote_patient_monitoring IS
    'SUPERSEDED AND EMPTY. No code path reads or writes this table. See docs/TECHNICAL_DEBT_REGISTER.md (2026-09-11, superseded typed repositories).';
COMMENT ON TABLE rpm_readings IS
    'SUPERSEDED AND EMPTY. Wearable readings are stored as JSON records (repository `wearable_reading_records`), not here.';
COMMENT ON TABLE sync_operations IS
    'SUPERSEDED AND EMPTY. Offline sync uses `sync_queue_items` and `sync_devices` (JSON record repositories), not this table.';
COMMENT ON TABLE telehealth_notes IS
    'SUPERSEDED AND EMPTY. No code path reads or writes this table. See docs/TECHNICAL_DEBT_REGISTER.md (2026-09-11, superseded typed repositories).';
COMMENT ON TABLE telehealth_sessions IS
    'SUPERSEDED AND EMPTY. Telehealth sessions are stored as JSON records (repository `telehealth_session_records`), not here.';
COMMENT ON TABLE transfusion_records IS
    'SUPERSEDED AND EMPTY. Transfusions are stored as JSON records (repository `transfusion_event_records`), not here.';
COMMENT ON TABLE vaccine_inventory IS
    'SUPERSEDED AND EMPTY. No code path reads or writes this table. See docs/TECHNICAL_DEBT_REGISTER.md (2026-09-11, superseded typed repositories).';
COMMENT ON TABLE wearable_alerts IS
    'SUPERSEDED AND EMPTY. Wearable alerts are stored as JSON records (repository `wearable_alert_records`), not here.';
COMMENT ON TABLE wearable_data IS
    'SUPERSEDED AND EMPTY. Wearable readings are stored as JSON records (repository `wearable_reading_records`), not here.';
COMMENT ON TABLE wearable_devices IS
    'SUPERSEDED AND EMPTY. Devices are stored as JSON records (repository `wearable_device_records`), not here.';
COMMENT ON TABLE wearable_integration_logs IS
    'SUPERSEDED AND EMPTY. No code path reads or writes this table. See docs/TECHNICAL_DEBT_REGISTER.md (2026-09-11, superseded typed repositories).';
