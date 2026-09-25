-- Fall-risk assessments: columns for the four fields the form has always
-- collected and the API has always dropped.
--
-- `FallRiskPage` submits `environmental_hazards`, `medications`, `recent_fall`
-- and `mobility` alongside the six Morse Fall Scale items. None of them had a
-- column, and `FallRiskAssessmentEntity.data` is `#[sqlx(skip)]`, so on
-- PostgreSQL every one of them was discarded on save while the request
-- returned 201.
--
-- They are not decoration. A Morse total answers "how likely is this patient to
-- fall"; these answer "why, and what has to change" — the psychoactive and
-- diuretic medications that raise the risk, the hazards in the bay that have to
-- be cleared, whether a fall has already happened this admission, and the
-- mobility status the prevention plan is built around. A falls assessment
-- without them records the score and loses the plan.

ALTER TABLE fall_risk_assessments
    ADD COLUMN IF NOT EXISTS environmental_hazards JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS medications           JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS recent_fall           BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS mobility              VARCHAR(64);

COMMENT ON COLUMN fall_risk_assessments.environmental_hazards IS
    'Hazards identified at the bedside (wet floor, clutter, poor lighting, bed height).';
COMMENT ON COLUMN fall_risk_assessments.medications IS
    'Fall-risk-increasing drugs the patient is on (sedatives, antihypertensives, diuretics).';
COMMENT ON COLUMN fall_risk_assessments.recent_fall IS
    'A fall already occurred during this admission.';
COMMENT ON COLUMN fall_risk_assessments.mobility IS
    'Mobility status the prevention plan is built around (independent, assisted, bedbound).';
