-- The consultation status CHECK was narrower than the workflow it guards, and
-- narrower in a way that made the feature unusable on PostgreSQL.
--
-- The portal's consult lifecycle is
--   requested -> acknowledged -> in-progress -> completed | declined | cancelled
-- while the constraint allowed only
--   pending | in_progress | completed | cancelled
--
-- So four of the six statuses a clinician can actually produce were rejected —
-- including `requested`, which is what *every* new consult is created with.
-- Requesting a consult therefore failed with a check-constraint violation on
-- any Postgres deployment, while succeeding in the in-memory backend, which
-- enforces no constraints. The specialist response path could never be reached
-- because no consult could be filed in the first place.
--
-- `in-progress` vs `in_progress` is the same class of problem one character
-- wide: the portal writes the hyphenated spelling and the constraint listed the
-- underscored one.
--
-- Both spellings and both vocabularies are accepted here rather than one being
-- migrated away. `pending` and `in_progress` are the legacy values already in
-- the table, and rejecting them would make existing rows unupdatable; the
-- portal's spellings are what new writes use.

ALTER TABLE consultation_notes DROP CONSTRAINT IF EXISTS consultation_notes_status_check;

-- Widened first so the column can hold the longer spellings; `acknowledged`
-- is 12 characters and the column was VARCHAR(16), which is enough today but
-- leaves no room, and a silent truncation here would corrupt the status.
ALTER TABLE consultation_notes ALTER COLUMN status TYPE VARCHAR(32);

ALTER TABLE consultation_notes
    ADD CONSTRAINT consultation_notes_status_check
    CHECK (status IN (
        -- The portal's lifecycle.
        'requested', 'acknowledged', 'in-progress', 'completed', 'declined', 'cancelled',
        -- Legacy spellings already present in existing deployments.
        'pending', 'in_progress'
    ));
