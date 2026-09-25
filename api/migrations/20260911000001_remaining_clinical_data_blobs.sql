-- Close the `#[sqlx(skip)] data` class, rather than the part of it that hurt.
--
-- `20260910000006` gave a column to the six entities whose blob was the sole
-- home of clinical content. These twenty-one were left: each keeps everything
-- it strictly needs in typed columns, so nothing observable was lost, and the
-- register recorded them as debt rather than a defect.
--
-- That distinction does not survive contact with the next handler. The failure
-- mode is not "this column is missing" -- it is that on PostgreSQL the field is
-- never selected and never written while in memory it holds the whole record,
-- so a handler that starts putting something in the blob works perfectly in
-- development and silently discards it against a database. Nothing fails, no
-- test goes red, and the response is `200 OK` with a `null` where the content
-- should be. Six of these tables reached production in exactly that state.
--
-- So the class is closed by giving every one of them the column, not by
-- documenting which ones can currently survive without it.
--
-- `NOT NULL DEFAULT '{}'::jsonb` throughout, for the same reason as last time:
-- every existing row predates the column, and a reader must be able to tell an
-- empty record from a missing one.

-- Nursing -------------------------------------------------------------------
ALTER TABLE io_records
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN io_records.data IS
    'The intake/output entry as charted, including the fluid and the route it went in or out by.';

ALTER TABLE wound_assessments
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN wound_assessments.data IS
    'The wound as assessed at the bedside, including anything the typed columns have no field for.';

ALTER TABLE fall_risk_assessments
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN fall_risk_assessments.data IS
    'The scored assessment as recorded, including which tool was used and the answers it was scored from.';

-- Laboratory ----------------------------------------------------------------
ALTER TABLE critical_values
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN critical_values.data IS
    'The critical result and its notification trail: who was called, when, and what was read back.';

ALTER TABLE specimen_rejections
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN specimen_rejections.data IS
    'Why the specimen was rejected and what recollection was asked for.';

-- Surgical and procedural ---------------------------------------------------
ALTER TABLE intubation_records
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN intubation_records.data IS
    'The airway as secured, including the attempts, the grade of view and the confirmation method.';

ALTER TABLE laceration_repairs
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN laceration_repairs.data IS
    'The repair as performed, including the anaesthetic, the closure and the aftercare given.';

ALTER TABLE splint_cast_records
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN splint_cast_records.data IS
    'The device applied and the neurovascular checks recorded before and after.';

-- Blood bank and pharmacy ---------------------------------------------------
ALTER TABLE blood_type_screens
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN blood_type_screens.data IS
    'The type-and-screen as resulted, including antibody findings.';

ALTER TABLE transfusion_records
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN transfusion_records.data IS
    'The transfusion as given, including the bedside checks and the observations taken during it.';

ALTER TABLE e_prescriptions
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN e_prescriptions.data IS
    'The prescription as written, including the items and the directions on each.';

-- Specialty assessments -----------------------------------------------------
ALTER TABLE burn_assessments
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN burn_assessments.data IS
    'The burn as assessed, including the per-region body-surface working the total is derived from.';

ALTER TABLE psychiatric_assessments
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN psychiatric_assessments.data IS
    'The assessment as recorded, including the risk findings and the safety plan agreed.';

ALTER TABLE toxicology_assessments
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN toxicology_assessments.data IS
    'The exposure as recorded, including the substances, the route and the decontamination performed.';

ALTER TABLE pediatric_assessments
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN pediatric_assessments.data IS
    'The paediatric assessment as recorded, including the weight-based working behind any dose.';

ALTER TABLE obstetric_emergencies
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN obstetric_emergencies.data IS
    'The obstetric emergency as recorded, including the foetal findings and the interventions performed.';

-- Discharge, handover and administration ------------------------------------
ALTER TABLE discharge_instructions
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN discharge_instructions.data IS
    'The instructions as given to the patient, including warning signs and follow-up arrangements.';

ALTER TABLE ama_discharges
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN ama_discharges.data IS
    'The against-medical-advice discharge as documented, including the capacity determination it rests on.';

ALTER TABLE shift_handoffs
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN shift_handoffs.data IS
    'The handover as given, including the per-patient items the oncoming nurse is taking on.';

ALTER TABLE ems_handoffs
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN ems_handoffs.data IS
    'The pre-hospital handover as received, including the observations taken on scene and en route.';

ALTER TABLE chain_of_custody
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN chain_of_custody.data IS
    'The custody event as recorded. Evidential: an incomplete chain is not admissible, and the typed columns carry only the transfer.';
