-- Drop the tables whose code was removed on 2026-09-25 at the owner's request
-- ("delete what we don't use", after investigation -- CLAUDE.md rule 7).
--
-- Each had readers and no writer: no endpoint ever inserted a row, and every
-- one held 0 rows when measured on 2026-09-25.
--
-- * `allergies`: allergy screening, the Medical ID card and QR, the emergency
--   and lock-screen views and FHIR AllergyIntolerance all read it, so every
--   one of them reported no allergies for every patient. Allergies live on
--   the patient's encrypted profile, which registration and profile edits
--   write; every reader now reads that.
-- * `drug_interactions`: the pharmacy dashboard's interaction panel read it.
--   The checks prescribers run are filed in `drug_interaction_checks`, which
--   the panel now reads.
-- * `blood_type_screens`: the blood-bank register read it beside the JSON
--   store `create_blood_type_screen` actually writes.
-- * `e_prescription_records`: a JSON store with no reader and no writer.
--
-- `v_patient_summary` counted rows in `allergies` and is read by nothing in
-- the API, the clients or the scripts; over an empty table it could only ever
-- report zero allergies for everybody. It goes first, explicitly.

DROP VIEW IF EXISTS v_patient_summary;

DROP TABLE IF EXISTS allergies;
DROP TABLE IF EXISTS drug_interactions;
DROP TABLE IF EXISTS blood_type_screens;
DROP TABLE IF EXISTS e_prescription_records;
