-- Appointments: store provider and actor identities as wallet addresses.
--
-- Why
-- ---
-- `appointments.provider_id`, `created_by` and `cancelled_by` were `uuid` with
-- foreign keys to `users(id)`. The application identifies providers by their
-- SS58 `wallet_address` everywhere — `AppointmentEntity` declares all three as
-- `String`, and `PgAppointmentRepository::create` binds them as text. Postgres
-- rejected every insert with:
--
--     operator does not exist: uuid = text
--
-- so **no appointment has ever been persisted on the PostgreSQL backend**;
-- `SELECT count(*) FROM appointments` was 0 (docs/WORKFLOW_AUDIT.md, WF-030).
-- Nothing caught it because the in-memory repository enforces no types and
-- there was no PostgreSQL test for booking. A test is added with this change.
--
-- Direction of the fix
-- --------------------
-- The columns move to the application's identifier, not the other way round.
-- Wallet address *is* the provider identity in this system: it is what the
-- signature middleware authenticates, what `resolve_attributed_provider`
-- returns, and what the access log records. Rewriting the application to carry
-- `users.id` would mean translating at every boundary and would leave the audit
-- log keyed differently from the clinical record.
--
-- VARCHAR(66) matches `users.wallet_address`.
--
-- Safe on existing data: the table is empty, so the casts below cannot fail.
-- They are written as an explicit `USING` cast anyway, so the migration is
-- still correct if a row appears before it runs.

-- `v_todays_appointments` joins `users u ON a.provider_id = u.id`, so it both
-- blocks the type change and encodes the same wrong assumption. Dropped and
-- recreated below against `wallet_address`. No application code reads it
-- (grepped across api/src and scripts) — the Today view in the portal goes
-- through the repository — but it is left in place rather than removed,
-- corrected, for whoever added it.
DROP VIEW IF EXISTS v_todays_appointments;

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_provider_id_fkey;
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_created_by_fkey;
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_cancelled_by_fkey;

ALTER TABLE appointments
    ALTER COLUMN provider_id TYPE VARCHAR(66) USING provider_id::text,
    ALTER COLUMN created_by  TYPE VARCHAR(66) USING created_by::text,
    ALTER COLUMN cancelled_by TYPE VARCHAR(66) USING cancelled_by::text;

COMMENT ON COLUMN appointments.provider_id IS
    'SS58 wallet address of the clinician the appointment is attributed to. Server-derived by resolve_attributed_provider; never taken from the request body.';
COMMENT ON COLUMN appointments.created_by IS
    'SS58 wallet address of whoever actually filed the booking. Differs from provider_id when an admin schedules for a colleague, or a patient books.';

-- Referential integrity on the provider only.
--
-- `provider_id` must name a real account: the handler already proves the
-- provider exists and is active, and this keeps that true if a future caller
-- bypasses it.
--
-- `created_by` and `cancelled_by` are deliberately left unconstrained. They are
-- audit fields recording who acted, and an audit record must survive the
-- removal of the account it names — a foreign key would either block the
-- deletion or cascade away the evidence.
ALTER TABLE appointments
    ADD CONSTRAINT appointments_provider_id_fkey
    FOREIGN KEY (provider_id) REFERENCES users(wallet_address);

-- Recreated with the join corrected to the identifier the column now holds.
CREATE VIEW v_todays_appointments AS
 SELECT a.id,
    a.patient_id,
    p.health_id,
    a.provider_id,
    u.name AS provider_name,
    a.appointment_type,
    a.scheduled_datetime,
    a.duration_minutes,
    a.status,
    a.location,
    a.room,
    a.reason_for_visit,
    a.visit_type
   FROM appointments a
     JOIN patients p ON a.patient_id::text = p.id::text
     JOIN users u ON a.provider_id = u.wallet_address
  WHERE date(a.scheduled_datetime) = CURRENT_DATE
  ORDER BY a.scheduled_datetime;

-- The status vocabulary must cover every value the domain enum can hold.
--
-- `AppointmentStatus` has nine variants; the original CHECK listed seven,
-- omitting `rescheduled` and `waitlisted`. A status the application can
-- legitimately produce but the database refuses is a latent 500 waiting for
-- whoever first reschedules an appointment. The writer now emits the snake_case
-- spellings via `appt_status_storage_str` (it previously emitted Rust `Debug`
-- output — "Scheduled", "CheckedIn" — which this constraint rejected outright,
-- the second reason no appointment had ever been stored).
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments
    ADD CONSTRAINT appointments_status_check
    CHECK (status IN (
        'scheduled', 'confirmed', 'checked_in', 'in_progress',
        'completed', 'cancelled', 'no_show', 'rescheduled', 'waitlisted'
    ));
