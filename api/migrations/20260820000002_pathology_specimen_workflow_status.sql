-- `pathology_reports` holds two things with two different lifecycles, and the
-- CHECK constraint only knew about one of them.
--
-- A *report* moves pending → preliminary → final → amended/corrected, which is
-- what the constraint allowed. A *specimen* is accessioned long before any
-- report exists and moves through the laboratory:
--
--   received → grossing → processing → embedding → cutting → staining
--            → prelim → final → addendum
--
-- The pathology screen tracks specimens, so every accession it submitted was
-- rejected — the specimen could not be booked into the lab at all. Widened to
-- accept both vocabularies rather than forcing one, because both are real:
-- the lab needs the workflow states and the report needs the report states.
--
-- `prelim` and `addendum` are the spellings the screen uses; `preliminary` and
-- `amended` are the report spellings already in the table. Both are listed so
-- existing rows stay valid and new writes are not silently coerced.

ALTER TABLE pathology_reports DROP CONSTRAINT IF EXISTS pathology_reports_status_check;

-- Widened first: `processing` is 10 characters and the column was VARCHAR(16),
-- which fits, but leaves no room for a longer state and a silent truncation
-- here would corrupt a specimen's position in the workflow.
ALTER TABLE pathology_reports ALTER COLUMN status TYPE VARCHAR(32);

ALTER TABLE pathology_reports
    ADD CONSTRAINT pathology_reports_status_check
    CHECK (status IN (
        -- Report lifecycle (already present).
        'pending', 'preliminary', 'final', 'amended', 'corrected',
        -- Specimen lifecycle, as tracked by the pathology screen.
        'received', 'grossing', 'processing', 'embedding', 'cutting',
        'staining', 'prelim', 'addendum'
    ));
