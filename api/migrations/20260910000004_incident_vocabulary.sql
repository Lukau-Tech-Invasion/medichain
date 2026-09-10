-- Four of the seven incident types the form offers could not be filed.
--
-- `IncidentReportPage` offers `fall`, `medication-error`, `equipment-failure`,
-- `security`, `behavioral`, `exposure` and `other`; the CHECK permitted
-- `fall`, `medication_error`, `adverse_drug_reaction`, `equipment_failure`,
-- `security`, `violence`, `elopement` and `other`. Hyphen-versus-underscore
-- killed two of them and two more were absent from the constraint entirely, so
-- filing a medication error, an equipment failure, a behavioural incident or a
-- body-fluid exposure answered `500 REPO_ERROR`. Only `fall`, `security` and
-- `other` ever worked.
--
-- The separator is normalised in the handler (`create_incident`), because a
-- vocabulary that differs only by punctuation is a naming problem rather than a
-- clinical one. The two genuinely missing categories are added here:
--
--   * `exposure` — a needlestick or blood/body-fluid exposure. One of the most
--     frequently reported incidents in any hospital, and the one that starts a
--     post-exposure prophylaxis clock. There was no way to record it.
--   * `behavioral` — an incident arising from patient behaviour that is not
--     `violence`. Recording it as violence overstates what happened and is
--     unfair to the patient it is recorded against.
--
-- Nothing is removed: `adverse_drug_reaction`, `violence` and `elopement` stay,
-- and a form that grows to offer them will work without another migration.
ALTER TABLE incident_reports
    DROP CONSTRAINT IF EXISTS incident_reports_incident_type_check;

ALTER TABLE incident_reports
    ADD CONSTRAINT incident_reports_incident_type_check
    CHECK (incident_type IN (
        'fall',
        'medication_error',
        'adverse_drug_reaction',
        'equipment_failure',
        'security',
        'violence',
        'elopement',
        'exposure',
        'behavioral',
        'other'
    ));

-- `near-miss` was refused for the same punctuation reason. The handler
-- normalises it; `no_harm` stays for callers that distinguish the two.
COMMENT ON COLUMN incident_reports.incident_type IS
    'Normalised to underscores by create_incident. See 20260910000004 for why the vocabulary was widened.';
