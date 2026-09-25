-- A clinician's barcode scanner preferences, and where they last cleared their
-- scan history.
--
-- The scanner settings panel rendered five toggles whose `enabled` values were
-- literals in the JSX. Nothing read them, nothing stored them, and the scan
-- path honoured none of them — including "Save history", which claims to
-- govern whether a durable record is written. Pressing a toggle moved a
-- graphic and changed nothing about the system.
--
-- `owner_id` is the clinician's wallet: these are one person's preferences and
-- there is no patient in them, so the row is caller-scoped by design.
--
-- `history_cleared_at` is how "Clear history" works. ADR-0005 defers
-- irreversible deletion, and a barcode scan is an audit record of a clinician
-- handling a specimen or a medication — the last thing that should vanish
-- because somebody tidied their screen. So the scans stay and the clinician's
-- VIEW resets: the history read returns scans after this instant. The record
-- of what was scanned, and when, survives for the people who need to ask.
CREATE TABLE IF NOT EXISTS scanner_settings (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One settings row per clinician. The unique index is the authority on that,
-- not a prior SELECT, so two tabs saving at once cannot create two rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scanner_settings_owner
    ON scanner_settings (owner_id);
