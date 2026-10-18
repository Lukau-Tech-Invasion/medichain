-- An admission time nobody recorded is unknown, not the moment of discharge.
--
-- `create_discharge_summary` defaulted `admission_datetime` to now, and the
-- form never asked for it, so every summary claimed the patient was admitted at
-- the instant they were discharged; the downloaded summary printed that.
-- The handler now stores the time only when the clinician gives one.
--
-- Rows already written keep their stored value: which of them were defaulted
-- cannot be told apart from a real same-day admission, so nothing is rewritten.
ALTER TABLE discharge_summaries ALTER COLUMN admission_datetime DROP NOT NULL;
