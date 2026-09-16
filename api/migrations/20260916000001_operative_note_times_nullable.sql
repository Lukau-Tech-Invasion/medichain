-- The operative note could not be saved, and two NOT NULL columns were why.
--
-- `POST /api/surgical/operative-note` answered 400 for every submission
-- `OperativeNotePage` made. Fixing the request contract exposed the next layer:
-- `operative_notes.start_time` and `end_time` are NOT NULL, and the screen
-- records a procedure *date*, not theatre clock times. Nothing in the doctor
-- portal asks when the patient entered or left the operating room.
--
-- The alternative was to write the procedure date at midnight into both. That
-- is a fabricated operative duration on a surgical record -- the kind of number
-- an audit, a billing review or a morbidity meeting would read as measured.
-- Rule 11: an unmeasured thing is not a zero, and a time nobody recorded is not
-- 00:00.
--
-- Same reasoning, and the same shape, as 20260810000001, which relaxed
-- `post_op_notes.operative_note_id` because the API type carried no such link.
-- The columns stay, so a theatre-management integration that does record them
-- loses nothing.

ALTER TABLE operative_notes ALTER COLUMN start_time DROP NOT NULL;
ALTER TABLE operative_notes ALTER COLUMN end_time DROP NOT NULL;

COMMENT ON COLUMN operative_notes.start_time IS
    'Theatre start. NULL when the documenting screen records only a procedure date.';
COMMENT ON COLUMN operative_notes.end_time IS
    'Theatre end. NULL when the documenting screen records only a procedure date.';
