-- Make the peri-operative tables usable by the application (HZ-026, continued).
--
-- `clinical_endpoints/surgical/perioperative.rs` and `diagnostics.rs` keep
-- pre-operative assessments, operative notes, post-operative notes and
-- anaesthesia records in process-memory `AppState` maps. The repositories to
-- persist them were written but never wired up, and could not have worked if
-- they had been, for two reasons this migration fixes.
--
-- 1. ACTOR COLUMNS ARE uuid.
--    Same defect 20260804000004 fixed for six other tables and explicitly did
--    not fix here. The Rust `User` struct has no `id` field and is keyed
--    entirely by `wallet_address` (SS58), so the code binds strings:
--      WRITE: column "surgeon_id" is of type uuid but expression is of type text
--      READ:  sqlx cannot decode a uuid column into a String field
--
-- 2. THE PAYLOAD HAD NOWHERE TO GO.
--    The API types in `clinical.rs` carry fields these tables never modelled —
--    for `PreOperativeAssessment` that includes `site_verified` and
--    `site_marked`, the WHO Surgical Safety Checklist items that exist to
--    prevent wrong-site surgery, plus `blood_available`, `iv_access`,
--    `dvt_prophylaxis`, `medications_held`, `special_equipment` and
--    `checklist_complete`. The entities have a `data` field intended to carry
--    them, but it is marked `#[sqlx(skip)]` — written nowhere, read nowhere.
--    Wiring the handlers without this column would have round-tripped
--    perfectly in the memory backend and silently dropped wrong-site-surgery
--    safeguards against PostgreSQL.
--
--    `record_json` holds the complete API object; the typed columns above it
--    remain the queryable projection. This is the shape already proven by the
--    emergency-protocol tables (`ep_code_blue_records` and peers), whose
--    restart tests pass.

-- The view joins users on the columns being retyped, so it cannot survive the
-- ALTER. Recreated at the bottom against wallet_address, which is the
-- identifier the application actually stores.
DROP VIEW IF EXISTS v_surgical_schedule;

DO $$
DECLARE
    tbl  TEXT;
    col  TEXT;
    fk   TEXT;
BEGIN
    FOR tbl, col IN
        SELECT * FROM (VALUES
            ('pre_op_assessments', 'surgeon_id'),
            ('pre_op_assessments', 'anesthesiologist_id'),
            ('pre_op_assessments', 'assessed_by'),
            ('operative_notes',    'surgeon_id'),
            ('operative_notes',    'anesthesiologist_id'),
            ('operative_notes',    'scrub_nurse_id'),
            ('operative_notes',    'circulating_nurse_id'),
            ('post_op_notes',      'provider_id'),
            ('anesthesia_records', 'anesthesiologist_id'),
            ('anesthesia_records', 'crna_id')
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

-- 3. post_op_notes.operative_note_id WAS NOT NULL.
--    The `PostOperativeNote` API type carries no operative-note identifier, so
--    every insert would have violated this constraint — the feature could not
--    persist at all. The link is also not always true in practice: a patient
--    transferred in after surgery elsewhere has post-operative notes and no
--    operative note in this system. The foreign key is kept for when a link
--    IS supplied; only the NOT NULL goes.
ALTER TABLE post_op_notes ALTER COLUMN operative_note_id DROP NOT NULL;

-- Full-fidelity payload. NOT NULL with a default so existing rows stay valid
-- and a writer that forgets it fails loudly rather than storing nothing.
ALTER TABLE pre_op_assessments
    ADD COLUMN IF NOT EXISTS record_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE operative_notes
    ADD COLUMN IF NOT EXISTS record_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE post_op_notes
    ADD COLUMN IF NOT EXISTS record_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE anesthesia_records
    ADD COLUMN IF NOT EXISTS record_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Recreated joining on wallet_address rather than users(id).
CREATE OR REPLACE VIEW v_surgical_schedule AS
SELECT
    po.id,
    po.patient_id,
    p.health_id,
    po.procedure_name,
    po.scheduled_date,
    s.name AS surgeon_name,
    a.name AS anesthesiologist_name,
    po.asa_classification,
    po.cleared_for_surgery,
    po.consent_signed
FROM pre_op_assessments po
JOIN patients p ON po.patient_id::text = p.id::text
LEFT JOIN users s ON po.surgeon_id::text = s.wallet_address::text
LEFT JOIN users a ON po.anesthesiologist_id::text = a.wallet_address::text
WHERE po.scheduled_date >= CURRENT_DATE
ORDER BY po.scheduled_date;
