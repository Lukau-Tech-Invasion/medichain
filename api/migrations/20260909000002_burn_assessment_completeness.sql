-- Burn assessments: the inputs the fluid order is derived from, and the
-- derived values the server now computes.
--
-- `BurnPage` computed total TBSA, the Parkland volumes and the severity band in
-- the browser and posted them under names the handler did not read
-- (`total_bsa`, `parkland_fluid`, `weight`). The handler read `tbsa_percentage`
-- and `parkland_formula_volume`, found neither, and stored 0.00 and NULL. Every
-- burn assessment in the database records a 0% burn.
--
-- The scoring moved to `api/src/clinical_scoring.rs`. These columns are what it
-- needs to be reproducible: `weight_kg` is the input the Parkland volume is
-- computed from, and without it a stored volume cannot be checked against the
-- formula afterwards. The rest are the assessment content the form has always
-- collected and the schema had nowhere to put.

ALTER TABLE burn_assessments
    -- Parkland input. A fluid volume whose weight is not recorded cannot be
    -- audited, recalculated after a weight correction, or handed over.
    ADD COLUMN IF NOT EXISTS weight_kg              DECIMAL(6,2),
    -- Derived by `clinical_scoring::burn_severity`, stored because it drives
    -- referral: a major burn goes to a burn centre.
    ADD COLUMN IF NOT EXISTS severity               VARCHAR(16),
    -- The Parkland breakdown the bedside actually runs on. The 24h total alone
    -- ( `parkland_formula_volume` ) does not say what to set the pump to.
    ADD COLUMN IF NOT EXISTS parkland_first_8h_ml   INTEGER,
    ADD COLUMN IF NOT EXISTS parkland_next_16h_ml   INTEGER,
    ADD COLUMN IF NOT EXISTS associated_injuries    JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS interventions          JSONB NOT NULL DEFAULT '[]',
    -- When resuscitation was started. Parkland is timed from the burn, not from
    -- arrival, so both clocks have to be on the record.
    ADD COLUMN IF NOT EXISTS fluid_start_time       TIMESTAMPTZ,
    -- Measured output, against `urine_output_goal`. The pair is the titration.
    ADD COLUMN IF NOT EXISTS urine_output_ml_hr     INTEGER;

ALTER TABLE burn_assessments
    DROP CONSTRAINT IF EXISTS burn_assessments_severity_check;
ALTER TABLE burn_assessments
    ADD CONSTRAINT burn_assessments_severity_check
    CHECK (severity IS NULL OR severity IN ('minor', 'moderate', 'major'));

COMMENT ON COLUMN burn_assessments.weight_kg IS
    'Patient weight used for the Parkland calculation. Required for any stored fluid volume.';
COMMENT ON COLUMN burn_assessments.severity IS
    'minor / moderate / major, from clinical_scoring::burn_severity. Major at any TBSA if inhalation or circumferential.';
