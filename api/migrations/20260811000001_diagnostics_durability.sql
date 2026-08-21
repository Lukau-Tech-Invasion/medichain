-- Make the radiology and pathology tables usable by the application.
--
-- Continues 20260810000001, which did the same for the peri-operative tables.
-- `clinical_endpoints/surgical/diagnostics.rs` kept radiology orders, radiology
-- reports and pathology reports in process-memory `AppState` maps. As with the
-- peri-operative group the repositories existed but were never wired up, and
-- three separate schema defects would have stopped them working if they had
-- been.
--
-- 1. ACTOR COLUMNS ARE uuid.
--    The Rust `User` struct has no `id` field and is keyed entirely by
--    `wallet_address` (SS58), so the code binds strings:
--      WRITE: column "radiologist_id" is of type uuid but expression is of type text
--      READ:  sqlx cannot decode a uuid column into a String field
--    Identical to the defect 20260804000004 fixed for six tables and
--    20260810000001 fixed for the peri-operative four.
--
-- 2. THE PAYLOAD HAD NOWHERE TO GO.
--    `RadiologyOrderEntity`, `RadiologyReportEntity` and
--    `PathologyReportEntity` each carry a `data` field marked `#[sqlx(skip)]`
--    — written nowhere, read nowhere. The API types carry structure the flat
--    columns cannot hold: a radiology report's `impression` is a list and its
--    `critical_communicated` is a nested read-back record; a pathology report
--    carries special stains, immunohistochemistry, molecular studies and the
--    synoptic cancer-staging report as structured lists. Wiring the handlers
--    without this column would have round-tripped perfectly in the memory
--    backend and silently dropped cancer staging against PostgreSQL.
--
-- 3. THE CHECK CONSTRAINTS ARE NARROWER THAN THE API ENUMS.
--    Every value below is reachable from the existing Rust types, so an
--    ordinary request would have failed with a constraint violation:
--      radiology_orders.status    — `RadiologyOrderStatus` also has Preliminary, Final
--      radiology_orders.priority  — `OrderPriority` also has Scheduled, PRN
--      radiology_orders.modality  — `RadiologyStudyType` also has Angiography
--      radiology_reports.status   — `RadiologyReportStatus` also has Addendum
--      pathology_reports.status   — `PathologyStatus` also has Pending
--    The constraints are kept (they are worth having) and widened to exactly
--    the domain the Rust enums can produce, rather than dropped.

-- `v_pending_radiology` selects `ordering_provider_id`, so PostgreSQL refuses
-- to alter that column's type while the view exists ("cannot alter type of a
-- column used by a view or rule"). Dropped here and recreated unchanged at the
-- bottom — the same dance 20260810000001 did for `v_surgical_schedule`.
DROP VIEW IF EXISTS v_pending_radiology;

DO $$
DECLARE
    tbl  TEXT;
    col  TEXT;
    fk   TEXT;
BEGIN
    FOR tbl, col IN
        SELECT * FROM (VALUES
            ('radiology_orders',  'ordering_provider_id'),
            ('radiology_orders',  'performing_technologist_id'),
            ('radiology_reports', 'radiologist_id'),
            ('radiology_reports', 'communicated_to'),
            ('radiology_reports', 'addendum_by'),
            ('pathology_reports', 'ordering_provider_id'),
            ('pathology_reports', 'pathologist_id'),
            ('pathology_reports', 'addendum_by')
        ) AS t(tbl, col)
    LOOP
        -- Only act if the column is still uuid, so the migration is idempotent
        -- and safe to re-run against a partially migrated database.
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = tbl
              AND column_name = col
              AND data_type = 'uuid'
        ) THEN
            -- A foreign key cannot survive the type change. These referenced
            -- users(id), which the application never populates, so the
            -- constraint was guarding nothing it could use.
            FOR fk IN
                SELECT con.conname
                FROM pg_constraint con
                JOIN pg_attribute att
                  ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
                WHERE con.contype = 'f'
                  AND con.conrelid = format('%I.%I', current_schema(), tbl)::regclass
                  AND att.attname = col
            LOOP
                EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', tbl, fk);
            END LOOP;

            EXECUTE format(
                'ALTER TABLE %I ALTER COLUMN %I TYPE VARCHAR(66) USING %I::text',
                tbl, col, col);
        END IF;
    END LOOP;
END $$;

-- Full-fidelity payload. NOT NULL with a default so existing rows stay valid
-- and a writer that forgets it fails loudly rather than storing nothing.
ALTER TABLE radiology_orders
    ADD COLUMN IF NOT EXISTS record_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE radiology_reports
    ADD COLUMN IF NOT EXISTS record_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pathology_reports
    ADD COLUMN IF NOT EXISTS record_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- A pathology report in this system is not always tied to a row in
-- `specimen_collections` (an outside laboratory's specimen arrives with its own
-- accession), and the API type carries no such identifier. The column stays for
-- when a link IS supplied; only the foreign key that cannot be satisfied goes.
ALTER TABLE pathology_reports ALTER COLUMN specimen_id DROP NOT NULL;

-- Widen the status/priority/modality domains to match the Rust enums (3 above).
ALTER TABLE radiology_orders  DROP CONSTRAINT IF EXISTS radiology_orders_status_check;
ALTER TABLE radiology_orders  ADD  CONSTRAINT radiology_orders_status_check
    CHECK (status IN ('ordered', 'scheduled', 'in_progress', 'completed',
                      'preliminary', 'final', 'cancelled'));

ALTER TABLE radiology_orders  DROP CONSTRAINT IF EXISTS radiology_orders_priority_check;
ALTER TABLE radiology_orders  ADD  CONSTRAINT radiology_orders_priority_check
    CHECK (priority IN ('routine', 'urgent', 'stat', 'asap', 'scheduled', 'prn'));

ALTER TABLE radiology_orders  DROP CONSTRAINT IF EXISTS radiology_orders_modality_check;
ALTER TABLE radiology_orders  ADD  CONSTRAINT radiology_orders_modality_check
    CHECK (modality IN ('xray', 'ct', 'mri', 'ultrasound', 'pet', 'nuclear',
                        'fluoroscopy', 'mammography', 'dexa', 'angiography'));

ALTER TABLE radiology_reports DROP CONSTRAINT IF EXISTS radiology_reports_status_check;
ALTER TABLE radiology_reports ADD  CONSTRAINT radiology_reports_status_check
    CHECK (status IN ('preliminary', 'final', 'amended', 'corrected', 'addendum'));

ALTER TABLE pathology_reports DROP CONSTRAINT IF EXISTS pathology_reports_status_check;
ALTER TABLE pathology_reports ADD  CONSTRAINT pathology_reports_status_check
    CHECK (status IN ('pending', 'preliminary', 'final', 'amended', 'corrected'));

-- Recreated exactly as 20260804000004 defined it; the join already cast to
-- text, so it is unaffected by the column now being VARCHAR rather than uuid.
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
