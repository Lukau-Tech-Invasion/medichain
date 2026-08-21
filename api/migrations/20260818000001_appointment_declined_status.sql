-- A booked appointment now needs the *other* party's agreement before it counts
-- as Confirmed, and that party must be able to say no. `declined` is that "no":
-- terminal, distinct from `cancelled` (which either party may do at any point,
-- for any reason) because a decline specifically means "I did not agree to this
-- proposed time", which is a different clinical and audit fact.
--
-- The status writer emits the snake_case spellings from `appt_status_storage_str`,
-- so the constraint must list `declined` or every decline fails the CHECK.
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments
    ADD CONSTRAINT appointments_status_check
    CHECK (status IN (
        'scheduled', 'confirmed', 'checked_in', 'in_progress',
        'completed', 'cancelled', 'no_show', 'rescheduled', 'waitlisted',
        'declined'
    ));
