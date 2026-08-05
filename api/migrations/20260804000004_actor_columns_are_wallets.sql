-- Actor columns hold WALLET ADDRESSES, not uuids (Horizon HZ-026, continued).
--
-- The schema types every actor reference (`*_by`, `*_provider_id`, `primary_nurse`,
-- `current_custodian_id`, …) as `uuid` with a foreign key to `users(id)`. The
-- application does not work that way and never has: the Rust `User` struct has
-- no `id` field at all and is keyed entirely by `wallet_address` (SS58). So the
-- code binds and expects strings.
--
-- On the in-memory backend this is invisible — a HashMap does not type-check.
-- On PostgreSQL it fails in both directions:
--   * WRITE: `column "primary_nurse" is of type uuid but expression is of type text`
--   * READ:  sqlx cannot decode a uuid column into a `String` field, so
--            `list_all()` returns a decode error and the handler 500s. That is
--            why the clinical registries (pathology, critical values, chain of
--            custody, radiology orders) all failed while their AUTH checks
--            passed — the failure was in the row decode, not authorization.
--
-- Scoped deliberately to the tables with FAILING end-to-end assertions rather
-- than every uuid column in the schema. 97 foreign keys reference `users(id)`,
-- so the same mismatch is latent elsewhere; converting all of them blind, at
-- once, without a test that exercises each is how a schema migration turns into
-- an outage. The remaining breadth is recorded in HZ-026 as a design decision
-- that still needs making: either the schema adopts wallet addresses as the
-- actor identity, or the application starts resolving wallets to user uuids.
-- Half-converting the schema is the one option that is worse than either.
--
-- 66 characters matches the width already used for wallet/actor columns
-- elsewhere in this schema (patients.registered_by, patients.primary_provider_id).

-- Two views depend on these columns and block the ALTER ("cannot alter type of
-- a column used by a view or rule"). They are dropped and recreated below.
--
-- `v_pending_radiology` joined `users u ON ro.ordering_provider_id = u.id` —
-- the same wrong identity model. Since the application writes wallet addresses
-- into `ordering_provider_id` and never populates `users.id`, that join matched
-- nothing: the view would have returned an empty result for every pending
-- radiology order regardless of the type change. It is recreated joining on
-- `users.wallet_address`, which is what the column actually holds.
DROP VIEW IF EXISTS v_pending_radiology;
DROP VIEW IF EXISTS v_unacknowledged_critical_values;

DO $$
DECLARE
    tbl  TEXT;
    col  TEXT;
    fk   TEXT;
BEGIN
    FOR tbl, col IN
        SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.data_type = 'uuid'
          AND c.column_name <> 'id'
          AND c.table_name IN (
              'medication_records',
              'pathology_reports',
              'critical_values',
              'chain_of_custody',
              'radiology_orders',
              'shift_handoffs'
          )
    LOOP
        -- A foreign key cannot survive the type change, so drop any that cover
        -- this column first. These referenced users(id), which the application
        -- never populates, so the constraint was guarding nothing it could use.
        FOR fk IN
            SELECT con.conname
            FROM pg_constraint con
            JOIN pg_attribute att
              ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
            WHERE con.contype = 'f'
              AND con.conrelid = format('public.%I', tbl)::regclass
              AND att.attname = col
        LOOP
            EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', tbl, fk);
        END LOOP;

        EXECUTE format(
            'ALTER TABLE public.%I ALTER COLUMN %I TYPE VARCHAR(66) USING %I::text',
            tbl, col, col);
    END LOOP;
END $$;

-- Recreate the views. `v_pending_radiology` now joins on wallet_address, which
-- is the identifier the application actually stores in ordering_provider_id.
CREATE OR REPLACE VIEW v_pending_radiology AS
SELECT ro.id,
       ro.patient_id,
       p.health_id,
       ro.modality,
       ro.study_type,
       ro.body_part,
       ro.priority,
       ro.status,
       ro.scheduled_datetime,
       u.name AS ordering_provider
FROM radiology_orders ro
JOIN patients p ON ro.patient_id::text = p.id::text
LEFT JOIN users u ON ro.ordering_provider_id::text = u.wallet_address::text
WHERE ro.status::text = ANY (ARRAY['ordered','scheduled','in_progress'])
ORDER BY (CASE ro.priority
              WHEN 'stat'   THEN 1
              WHEN 'asap'   THEN 2
              WHEN 'urgent' THEN 3
              ELSE 4
          END), ro.scheduled_datetime;

CREATE OR REPLACE VIEW v_unacknowledged_critical_values AS
SELECT cv.id,
       cv.patient_id,
       p.health_id,
       cv.test_name,
       cv.value,
       cv.unit,
       cv.severity,
       cv.created_at,
       EXTRACT(epoch FROM now() - cv.created_at) / 60::numeric AS minutes_since_detection
FROM critical_values cv
JOIN patients p ON cv.patient_id::text = p.id::text
WHERE cv.acknowledged_at IS NULL
ORDER BY (CASE cv.severity
              WHEN 'panic'    THEN 1
              WHEN 'critical' THEN 2
              ELSE 3
          END), cv.created_at;
