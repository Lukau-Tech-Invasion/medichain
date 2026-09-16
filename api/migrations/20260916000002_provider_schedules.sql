-- Provider working hours, so "available" means available.
--
-- NOTE FOR WHOEVER TOUCHES 20260916000001 NEXT: do not. sqlx checksums every
-- migration file, so editing one that has already been applied halts the entire
-- chain -- and a *comment* is enough. Renumbering a rule reference in that
-- file's header stopped this migration from ever running, and the only symptom
-- was `relation "provider_schedules" does not exist` at runtime, three steps
-- away from the cause. An applied migration is immutable, comments included.
--
-- `GET /api/appointments/slots/{provider}/{date}` offered the same ten slots
-- for every provider, because nothing stored when anyone actually works. Real
-- bookings were excluded, so it could not double-book — but it could offer
-- 09:00 with a surgeon who starts at 14:00, and the patient app rendered that
-- as availability. The response admitted it in `slots_source`, which was the
-- honest half of a feature that was not built.
--
-- One row per provider, keyed by wallet address, holding the weekly pattern and
-- the dated exceptions. JSONB rather than a `working_days` child table because
-- a schedule is read whole, written whole, and never queried by one of its
-- days — the same reasoning as the other `*_records` stores in phase 7.

CREATE TABLE IF NOT EXISTS provider_schedules (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_schedules_owner ON provider_schedules (owner_id);

COMMENT ON TABLE provider_schedules IS
    'A provider''s weekly working pattern and dated exceptions. Absent = the default clinic grid, which the slots endpoint reports as slots_source=default_clinic_hours.';
