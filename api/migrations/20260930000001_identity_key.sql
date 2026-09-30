-- M1: `users.id` (UUID) becomes the only identifier of a user (ADR-0010, phase B).
--
-- Until now every actor column, session row and JWT `sub` carried the user's SS58
-- wallet address. After this migration they carry `users.id::text`; the wallet
-- string survives only in `legacy_wallet_identities`, so historical rows that
-- must never be rewritten (sealed / hashed) still resolve to a person.
--
-- Order matters and is deliberate:
--   1. structure the mapping needs (id_text, nullable wallet, legacy table)
--   2. the registry of every column that can hold an actor
--   3. an orphan report -- the migration STOPS on a value it cannot explain
--   4. an unregistered-column scan -- the migration STOPS if a wallet is found
--      in a column nobody declared
--   5. the remap (text columns, then JSONB values)
--   6. session-table reset and re-key; user_mfa / persons / login_contexts /
--      guardian_relationships re-key
--   7. views, foreign keys
--
-- NEVER rewritten (registry kind 'sealed'): access_logs.accessor_id,
-- audit_events.payload / aggregate_id, emergency_capsules.capsule_encrypted.
-- Their leaves and commitments hash those strings; rewriting one would break
-- verification of everything sealed before this migration.
--
-- Checked and safe to rewrite (the planner's "could not determine" items):
--   * governance_decisions.proposal_hash  = SHA3(proposal text), no actor in it
--   * consent_records.witness_signature   = a free-text mark, not a signature
--   * medical-record content digest / registration digest live only inside
--     sealed audit_events payloads and are never recomputed from row columns
--
-- All dynamic SQL uses current_schema() so the same file runs in a test schema.

-- ---------------------------------------------------------------------------
-- 1. structure
-- ---------------------------------------------------------------------------

-- A text mirror of the key, so a TEXT actor column can carry a real foreign key.
-- (Validated on PostgreSQL 16: a STORED generated column may be referenced.)
ALTER TABLE users ADD COLUMN id_text TEXT GENERATED ALWAYS AS (id::text) STORED;
ALTER TABLE users ADD CONSTRAINT users_id_text_key UNIQUE (id_text);

-- The wallet is now a legacy credential: accounts created from here on have none.
ALTER TABLE users ALTER COLUMN wallet_address DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS valid_wallet;

CREATE TABLE legacy_wallet_identities (
    wallet_address TEXT PRIMARY KEY,
    user_id        UUID NOT NULL REFERENCES users(id),
    kind           TEXT NOT NULL CHECK (kind IN ('wallet', 'system', 'patient_record')),
    mapped_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_legacy_wallet_identities_user ON legacy_wallet_identities (user_id);

INSERT INTO legacy_wallet_identities (wallet_address, user_id, kind)
SELECT wallet_address, id, 'wallet' FROM users WHERE wallet_address IS NOT NULL;

-- Every key a person is known by, current or historical.
CREATE VIEW actor_directory AS
    SELECT id_text AS actor_key, id AS user_id, false AS legacy FROM users
    UNION ALL
    SELECT wallet_address AS actor_key, user_id, true AS legacy FROM legacy_wallet_identities;

-- ---------------------------------------------------------------------------
-- 2. the registry
-- ---------------------------------------------------------------------------
--   user     strict: always a user's id; the remap refuses an unexplained value
--   mixed    a user's id, or something else (a patient id, a name); remapped
--            where it is a known wallet, otherwise left alone and reported
--   jsonb    JSON document; string VALUES equal to a known wallet are replaced
--   record_id  the row's own id is the owner's key (one row per user)
--   sealed   never rewritten
--   legacy   a wallet-era column that phase C drops; not remapped
--   session  session-scoped; rows deleted, column re-keyed to user_id
--   uuid_fk  already a uuid key to users(id); nothing to remap
CREATE TABLE actor_column_registry (
    table_name  TEXT NOT NULL,
    column_name TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN
                    ('user', 'mixed', 'jsonb', 'record_id', 'sealed', 'legacy', 'session', 'uuid_fk')),
    sealed      BOOLEAN NOT NULL DEFAULT false,
    fk          TEXT,
    note        TEXT,
    PRIMARY KEY (table_name, column_name),
    CHECK (sealed = (kind = 'sealed'))
);

-- Rename first so the registry can use the final names.
ALTER TABLE guardian_relationships RENAME COLUMN guardian_wallet TO guardian_user_id;
ALTER INDEX idx_guardian_relationships_guardian RENAME TO idx_guardian_relationships_guardian_user;

INSERT INTO actor_column_registry (table_name, column_name, kind, sealed, note) VALUES
    ('access_logs', 'accessor_id', 'sealed', true, 'hashed into audit leaves; legacy wallets resolve via actor_directory'),
    ('audit_events', 'payload', 'sealed', true, 'hashed into audit leaves'),
    ('audit_events', 'aggregate_id', 'sealed', true, 'hashed into audit leaves'),
    ('emergency_capsules', 'capsule_encrypted', 'sealed', true, 'capsule commitment covers the verifier ids inside'),
    ('key_envelopes', 'recipient_id', 'sealed', true, 'wrapped keys are bound to the recipient; no writer yet'),
    ('patients', 'profile_extras_encrypted', 'sealed', true, 'opaque application-layer blob; historical wallet strings inside resolve via actor_directory');

INSERT INTO actor_column_registry (table_name, column_name, kind, note) VALUES
    ('users', 'wallet_address', 'legacy', 'dropped by phase C'),
    ('patients', 'wallet_address', 'legacy', 'unused; dropped by phase C'),
    ('auth_challenges', 'wallet_address', 'legacy', 'wallet sign-in challenge; removed with wallet sign-in'),
    ('auth_login_sessions', 'user_id', 'session', NULL),
    ('auth_sessions', 'user_id', 'session', NULL),
    ('auth_transaction_challenges', 'user_id', 'session', NULL),
    ('auth_security_events', 'user_id', 'session', NULL),
    ('login_contexts', 'user_id', 'session', NULL),
    ('user_mfa', 'user_id', 'uuid_fk', NULL),
    ('persons', 'user_id', 'uuid_fk', NULL),
    ('user_profiles', 'user_id', 'uuid_fk', NULL);

-- Strict: the foreign-keyed columns plus the two whose value is always a user.
INSERT INTO actor_column_registry (table_name, column_name, kind, fk) VALUES
    ('appointments', 'provider_id', 'user', 'users.id_text'),
    ('care_relationships', 'clinician_id', 'user', 'users.id_text'),
    ('access_contexts', 'clinician_id', 'user', 'users.id_text'),
    ('patient_access_grants', 'provider_id', 'user', 'users.id_text'),
    ('patient_access_requests', 'provider_id', 'user', 'users.id_text'),
    ('break_glass_grants', 'clinician_id', 'user', 'users.id_text'),
    ('users', 'created_by', 'user', 'users.id_text'),
        ('emergency_capsules', 'created_by', 'user', NULL),
            ('guardian_relationships', 'guardian_user_id', 'user', NULL);

-- Lenient: an actor, but a writer may have stored a name or another id.
INSERT INTO actor_column_registry (table_name, column_name, kind) VALUES
    ('appointments', 'created_by', 'mixed'),
    ('emergency_capsule_access_log', 'accessed_by', 'mixed'),
    ('patients', 'registered_by', 'mixed'),
    ('ama_discharges', 'attending_physician_id', 'mixed'),
    ('ama_discharges', 'signatures_collected_by', 'mixed'),
    ('anesthesia_records', 'anesthesiologist_id', 'mixed'),
    ('anesthesia_records', 'crna_id', 'mixed'),
    ('appointments', 'cancelled_by', 'mixed'),
    ('burn_assessments', 'assessed_by', 'mixed'),
    ('cardiac_events', 'performed_by', 'mixed'),
    ('cds_alerts', 'provider_id', 'mixed'),
    ('cds_alerts', 'acknowledged_by', 'mixed'),
    ('chain_of_custody', 'collected_by', 'mixed'),
    ('chain_of_custody', 'collection_witnessed_by', 'mixed'),
    ('chain_of_custody', 'current_custodian_id', 'mixed'),
    ('chain_of_custody', 'release_authorized_by', 'mixed'),
    ('chain_of_custody', 'destruction_witnessed_by', 'mixed'),
    ('claim_eob_documents', 'uploaded_by', 'mixed'),
    ('code_blue_records', 'created_by', 'mixed'),
    ('consent_records', 'collector_id', 'mixed'),
    ('consent_records', 'revoked_by', 'mixed'),
    ('consent_records', 'consent_given_by', 'mixed'),
    ('consent_records', 'child_maturity_assessed_by', 'mixed'),
    ('consultation_notes', 'requesting_provider', 'mixed'),
    ('consultation_notes', 'consulting_provider', 'mixed'),
    ('critical_values', 'notified_provider_id', 'mixed'),
    ('critical_values', 'acknowledged_by', 'mixed'),
    ('critical_values', 'reported_by', 'mixed'),
    ('data_retention_policies', 'reviewed_by', 'mixed'),
    ('deletion_register', 'executed_by', 'mixed'),
    ('device_tokens', 'user_id', 'mixed'),
    ('discharge_instructions', 'provided_by', 'mixed'),
    ('discharge_summaries', 'attending_physician_id', 'mixed'),
    ('discharge_summaries', 'dictated_by', 'mixed'),
    ('discharge_summaries', 'transcribed_by', 'mixed'),
    ('discharge_summaries', 'signed_by', 'mixed'),
    ('discharge_summaries', 'addendum_by', 'mixed'),
    ('emergency_access_grants', 'requesting_person_id', 'mixed'),
    ('emergency_capsules', 'revoked_by', 'mixed'),
    ('ems_handoffs', 'receiving_provider_id', 'mixed'),
    ('ems_handoffs', 'report_received_by', 'mixed'),
    ('fall_risk_assessments', 'assessed_by', 'mixed'),
    ('gcs_assessments', 'assessed_by', 'mixed'),
    ('guardian_relationships', 'verified_by', 'mixed'),
    ('history_physicals', 'performed_by', 'mixed'),
    ('idempotency_operations', 'subject', 'mixed'),
    ('immunization_records', 'administered_by', 'mixed'),
    ('incident_reports', 'reporter_id', 'mixed'),
    ('incident_reports', 'patient_notified_by', 'mixed'),
    ('incident_reports', 'follow_up_assigned_to', 'mixed'),
    ('incident_reports', 'reviewed_by', 'mixed'),
    ('insurance_records', 'last_verified_by', 'mixed'),
    ('intubation_records', 'intubator_id', 'mixed'),
    ('intubation_records', 'assistant_id', 'mixed'),
    ('io_records', 'recorded_by', 'mixed'),
    ('io_records', 'verified_by', 'mixed'),
    ('iv_assessments', 'assessed_by', 'mixed'),
    ('lab_qc_records', 'performed_by', 'mixed'),
    ('lab_qc_records', 'reviewed_by', 'mixed'),
    ('lab_submissions', 'ordering_provider_id', 'mixed'),
    ('laceration_repairs', 'performed_by', 'mixed'),
    ('legal_holds', 'applied_by', 'mixed'),
    ('legal_holds', 'released_by', 'mixed'),
    ('mci_records', 'created_by', 'mixed'),
    ('medical_records', 'created_by', 'mixed'),
    ('medical_records', 'last_modified_by', 'mixed'),
    ('medication_records', 'primary_nurse', 'mixed'),
    ('message_attachments', 'uploaded_by', 'mixed'),
    ('national_id_manual_reviews', 'decided_by', 'mixed'),
    ('nfc_tags', 'issued_by', 'mixed'),
    ('nursing_care_plans', 'created_by', 'mixed'),
    ('nursing_care_plans', 'updated_by', 'mixed'),
    ('obstetric_emergencies', 'assessed_by', 'mixed'),
    ('obstetric_emergencies', 'ob_physician_id', 'mixed'),
    ('operative_notes', 'surgeon_id', 'mixed'),
    ('operative_notes', 'anesthesiologist_id', 'mixed'),
    ('operative_notes', 'scrub_nurse_id', 'mixed'),
    ('operative_notes', 'circulating_nurse_id', 'mixed'),
    ('pathology_reports', 'ordering_provider_id', 'mixed'),
    ('pathology_reports', 'pathologist_id', 'mixed'),
    ('pathology_reports', 'addendum_by', 'mixed'),
    ('patients', 'primary_provider_id', 'mixed'),
    ('patients', 'dnr_verified_by', 'mixed'),
    ('pediatric_assessments', 'assessed_by', 'mixed'),
    ('physician_orders', 'ordering_provider_id', 'mixed'),
    ('physician_orders', 'cosigned_by', 'mixed'),
    ('physician_orders', 'verified_by', 'mixed'),
    ('physician_orders', 'executed_by', 'mixed'),
    ('physician_orders', 'discontinued_by', 'mixed'),
    ('post_op_notes', 'provider_id', 'mixed'),
    ('pre_op_assessments', 'surgeon_id', 'mixed'),
    ('pre_op_assessments', 'anesthesiologist_id', 'mixed'),
    ('pre_op_assessments', 'assessed_by', 'mixed'),
    ('prescription_refill_requests', 'prescriber_id', 'mixed'),
    ('prescription_refill_requests', 'requested_by', 'mixed'),
    ('prescription_refill_requests', 'decided_by', 'mixed'),
    ('processing_restrictions', 'restricted_by', 'mixed'),
    ('processing_restrictions', 'lifted_by', 'mixed'),
    ('progress_notes', 'cosigned_by', 'mixed'),
    ('progress_notes', 'created_by', 'mixed'),
    ('psychiatric_assessments', 'assessed_by', 'mixed'),
    ('psychiatric_assessments', 'psychiatrist_id', 'mixed'),
    ('radiology_orders', 'ordering_provider_id', 'mixed'),
    ('radiology_orders', 'performing_technologist_id', 'mixed'),
    ('radiology_reports', 'radiologist_id', 'mixed'),
    ('radiology_reports', 'addendum_by', 'mixed'),
    ('blood_units', 'received_by', 'mixed'),
    ('retention_approvals', 'requested_by', 'mixed'),
    ('retention_approvals', 'approved_by', 'mixed'),
    ('retention_approvals', 'executed_by', 'mixed'),
    ('retention_job_runs', 'run_by', 'mixed'),
    ('security_alerts', 'actor', 'mixed'),
    ('sepsis_assessments', 'performed_by', 'mixed'),
    ('shift_handoffs', 'outgoing_provider_id', 'mixed'),
    ('shift_handoffs', 'incoming_provider_id', 'mixed'),
    ('soap_notes', 'signed_by', 'mixed'),
    ('soap_notes', 'created_by', 'mixed'),
    ('specimen_collections', 'collector_id', 'mixed'),
    ('specimen_collections', 'received_by', 'mixed'),
    ('specimen_recollection_requests', 'ordering_provider_id', 'mixed'),
    ('specimen_recollection_requests', 'requested_by', 'mixed'),
    ('specimen_rejections', 'rejected_by', 'mixed'),
    ('splint_cast_records', 'applied_by', 'mixed'),
    ('stroke_assessments', 'performed_by', 'mixed'),
    ('sync_conflicts', 'resolved_by', 'mixed'),
    ('telehealth_recordings', 'provider_id', 'mixed'),
    ('toxicology_assessments', 'assessed_by', 'mixed'),
    ('trauma_assessments', 'performed_by', 'mixed'),
    ('triage_assessments', 'performed_by', 'mixed'),
    ('vital_signs', 'recorded_by', 'mixed'),
    ('wound_assessments', 'assessed_by', 'mixed');

-- Every JSON-record table names its owner in `owner_id` (a patient for clinical
-- records, a user for per-user settings, messages and templates) and some key
-- their one-per-user row by that same value in `id`.
INSERT INTO actor_column_registry (table_name, column_name, kind)
SELECT c.table_name, 'owner_id', 'mixed'
FROM information_schema.columns c
JOIN information_schema.tables t
  ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
WHERE c.table_schema = current_schema() AND c.column_name = 'owner_id'
ON CONFLICT DO NOTHING;

INSERT INTO actor_column_registry (table_name, column_name, kind)
SELECT c.table_name, 'id', 'record_id'
FROM information_schema.columns c
JOIN information_schema.columns o
  ON o.table_schema = c.table_schema AND o.table_name = c.table_name AND o.column_name = 'owner_id'
WHERE c.table_schema = current_schema() AND c.column_name = 'id'
  AND c.data_type IN ('text', 'character varying')
ON CONFLICT DO NOTHING;

-- Every JSONB column may carry an actor string somewhere inside it, so all of
-- them are declared. A JSONB column added later must be declared too (the
-- registry test fails until it is).
INSERT INTO actor_column_registry (table_name, column_name, kind)
SELECT c.table_name, c.column_name, 'jsonb'
FROM information_schema.columns c
JOIN information_schema.tables t
  ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
WHERE c.table_schema = current_schema() AND c.data_type = 'jsonb'
ON CONFLICT DO NOTHING;

-- A registry row that names no column is a typo, not a policy.
DO $$
DECLARE r RECORD; missing TEXT := '';
BEGIN
    FOR r IN
        SELECT g.table_name, g.column_name FROM actor_column_registry g
        WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = current_schema()
              AND c.table_name = g.table_name AND c.column_name = g.column_name)
          AND g.kind NOT IN ('session', 'uuid_fk')
    LOOP
        missing := missing || format(' %s.%s', r.table_name, r.column_name);
    END LOOP;
    IF missing <> '' THEN
        RAISE EXCEPTION 'actor_column_registry names columns that do not exist:%', missing;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. the key map and the orphan report
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _idmap (
    old_key TEXT PRIMARY KEY,
    new_key TEXT NOT NULL,
    kind    TEXT NOT NULL
) ON COMMIT DROP;
INSERT INTO _idmap SELECT wallet_address, id_text, 'wallet' FROM users WHERE wallet_address IS NOT NULL;

-- Foreign keys that pointed at the wallet must go before the values change.
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_provider_id_fkey;

CREATE TEMP TABLE _orphans (tbl TEXT, col TEXT, val TEXT, n BIGINT) ON COMMIT DROP;
CREATE TEMP TABLE _lenient_orphans (tbl TEXT, col TEXT, val TEXT, n BIGINT) ON COMMIT DROP;

DO $$
DECLARE
    r RECORD;
    sch TEXT := current_schema();
    unexplained TEXT;
BEGIN
    -- Only text-typed columns can hold a wallet. (A schema built from the
    -- migrations alone still has some actor columns as uuid, which cannot.)
    FOR r IN SELECT g.table_name AS t, g.column_name AS c, g.kind
             FROM actor_column_registry g
             JOIN information_schema.columns ic
               ON ic.table_schema = sch AND ic.table_name = g.table_name AND ic.column_name = g.column_name
             WHERE g.kind IN ('user', 'mixed') AND ic.data_type IN ('text', 'character varying', 'character')
             ORDER BY 1, 2 LOOP
        EXECUTE format(
            'INSERT INTO %s SELECT %L, %L, %I::text, count(*) FROM %I.%I
              WHERE %I IS NOT NULL AND btrim(%I::text) <> ''''
                AND %I::text NOT IN (SELECT old_key FROM _idmap)
                AND %I::text NOT IN (SELECT id_text FROM users)
              GROUP BY 3',
            CASE WHEN r.kind = 'user' THEN '_orphans' ELSE '_lenient_orphans' END,
            r.t, r.c, r.c, sch, r.t, r.c, r.c, r.c, r.c);
    END LOOP;

    -- Values that ARE explainable: the system sentinels, and a patient record id
    -- standing for the one user linked to that patient.
    IF EXISTS (SELECT 1 FROM _orphans WHERE val IN ('SYSTEM', 'DEMO_SYSTEM'))
       OR EXISTS (SELECT 1 FROM _lenient_orphans WHERE val IN ('SYSTEM', 'DEMO_SYSTEM')) THEN
        INSERT INTO users (id, wallet_address, role, name, status, is_active)
        VALUES ('00000000-0000-0000-0000-000000000001', NULL, 'Admin', 'System', 'inactive', false)
        ON CONFLICT (id) DO NOTHING;
        INSERT INTO _idmap VALUES
            ('SYSTEM', '00000000-0000-0000-0000-000000000001', 'system'),
            ('DEMO_SYSTEM', '00000000-0000-0000-0000-000000000001', 'system')
        ON CONFLICT DO NOTHING;
    END IF;

    INSERT INTO _idmap (old_key, new_key, kind)
    SELECT o.val, min(u.id_text), 'patient_record'
    FROM (SELECT DISTINCT val FROM _orphans WHERE val LIKE 'PAT-%') o
    JOIN users u ON u.linked_patient_id = o.val
    GROUP BY o.val HAVING count(*) = 1
    ON CONFLICT DO NOTHING;

    INSERT INTO legacy_wallet_identities (wallet_address, user_id, kind)
    SELECT old_key, new_key::uuid, kind FROM _idmap WHERE kind <> 'wallet'
    ON CONFLICT DO NOTHING;

    DELETE FROM _orphans WHERE val IN (SELECT old_key FROM _idmap);

    IF EXISTS (SELECT 1 FROM _orphans) THEN
        SELECT string_agg(format('%s.%s=%L (%s rows)', tbl, col, val, n), '; ')
          INTO unexplained FROM (SELECT * FROM _orphans ORDER BY tbl, col, n DESC LIMIT 25) s;
        RAISE EXCEPTION 'identity migration stopped: actor values that name no user: %', unexplained;
    END IF;
END $$;

-- Wallets sitting in a column nobody registered would be silently left behind.
DO $$
DECLARE
    r RECORD;
    sch TEXT := current_schema();
    hits BIGINT;
    found TEXT := '';
BEGIN
    FOR r IN
        SELECT c.table_name AS t, c.column_name AS c
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = sch
          AND c.data_type IN ('text', 'character varying', 'character')
          AND (c.character_maximum_length IS NULL OR c.character_maximum_length >= 44)
          AND c.table_name NOT IN ('actor_column_registry', 'legacy_wallet_identities', '_sqlx_migrations')
          -- re-keyed to user_id below, rows deleted or migrated with checks of their own
          AND NOT (c.column_name = 'wallet_address' AND c.table_name IN
                   ('auth_login_sessions', 'auth_sessions', 'auth_transaction_challenges',
                    'auth_security_events', 'login_contexts', 'user_mfa', 'persons'))
          AND NOT EXISTS (SELECT 1 FROM actor_column_registry g
                          WHERE g.table_name = c.table_name AND g.column_name = c.column_name)
    LOOP
        EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I IN (SELECT old_key FROM _idmap WHERE kind = ''wallet'')',
                       sch, r.t, r.c) INTO hits;
        IF hits > 0 THEN
            found := found || format(' %s.%s(%s)', r.t, r.c, hits);
        END IF;
    END LOOP;
    IF found <> '' THEN
        RAISE EXCEPTION 'identity migration stopped: wallet addresses found in columns missing from actor_column_registry:%', found;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. the remap
-- ---------------------------------------------------------------------------
-- Replace string VALUES that equal a known key, at any depth. Bounded by the
-- depth of a stored document; not application code.
CREATE FUNCTION pg_temp.remap_json(doc JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE AS $f$
DECLARE
    replacement TEXT;
    result JSONB;
BEGIN
    CASE jsonb_typeof(doc)
        WHEN 'string' THEN
            SELECT new_key INTO replacement FROM _idmap WHERE old_key = doc #>> '{}';
            RETURN CASE WHEN replacement IS NULL THEN doc ELSE to_jsonb(replacement) END;
        WHEN 'object' THEN
            SELECT COALESCE(jsonb_object_agg(k, pg_temp.remap_json(v)), '{}'::jsonb)
              INTO result FROM jsonb_each(doc) AS e(k, v);
            RETURN result;
        WHEN 'array' THEN
            SELECT COALESCE(jsonb_agg(pg_temp.remap_json(v) ORDER BY ord), '[]'::jsonb)
              INTO result FROM jsonb_array_elements(doc) WITH ORDINALITY AS a(v, ord);
            RETURN result;
        ELSE
            RETURN doc;
    END CASE;
END $f$;

DO $$
DECLARE
    r RECORD;
    sch TEXT := current_schema();
    shape CONSTANT TEXT := '"([1-9A-HJ-NP-Za-km-z]{46,48}|SYSTEM|DEMO_SYSTEM)"';
BEGIN
    FOR r IN SELECT g.table_name AS t, g.column_name AS c, g.kind
             FROM actor_column_registry g
             JOIN information_schema.columns ic
               ON ic.table_schema = sch AND ic.table_name = g.table_name AND ic.column_name = g.column_name
             WHERE g.kind IN ('user', 'mixed', 'record_id', 'jsonb')
               AND ic.data_type IN ('text', 'character varying', 'character', 'jsonb')
             ORDER BY 1, 2 LOOP
        -- The audit-timestamp triggers must not treat a re-key as an edit.
        EXECUTE format('ALTER TABLE %I.%I DISABLE TRIGGER USER', sch, r.t);
        IF r.kind = 'jsonb' THEN
            EXECUTE format('UPDATE %I.%I SET %I = pg_temp.remap_json(%I) WHERE %I::text ~ %L',
                           sch, r.t, r.c, r.c, r.c, shape);
        ELSE
            EXECUTE format('UPDATE %I.%I x SET %I = m.new_key FROM _idmap m WHERE x.%I = m.old_key',
                           sch, r.t, r.c, r.c);
        END IF;
        EXECUTE format('ALTER TABLE %I.%I ENABLE TRIGGER USER', sch, r.t);
    END LOOP;
END $$;

-- One profile picture per user, keyed AVA-<owner>: the record key follows its owner.
UPDATE user_avatars SET id = 'AVA-' || owner_id
WHERE id LIKE 'AVA-%' AND id <> 'AVA-' || owner_id;

-- Values in a lenient column that name no user: not an error (a name is not an
-- orphan) but never silent either.
CREATE TABLE identity_remap_notes AS
    SELECT tbl AS table_name, col AS column_name, val AS value, n AS row_count, now() AS noted_at
    FROM _lenient_orphans
    WHERE val NOT IN (SELECT old_key FROM _idmap);
COMMENT ON TABLE identity_remap_notes IS
    'Non-user values left as they were in lenient actor columns by the 20260930 identity migration.';

-- ---------------------------------------------------------------------------
-- 5. session tables: reset and re-key to user_id
-- ---------------------------------------------------------------------------
DELETE FROM auth_transaction_challenges;
DELETE FROM auth_sessions;
DELETE FROM auth_login_sessions;
DELETE FROM auth_challenges;
DELETE FROM auth_security_events;
DELETE FROM login_contexts;

ALTER TABLE auth_login_sessions DROP COLUMN wallet_address;
ALTER TABLE auth_login_sessions ADD COLUMN user_id UUID NOT NULL REFERENCES users(id);
CREATE INDEX idx_auth_login_sessions_user_active ON auth_login_sessions (user_id) WHERE revoked_at IS NULL;

ALTER TABLE auth_sessions DROP COLUMN wallet_address;
ALTER TABLE auth_sessions ADD COLUMN user_id UUID NOT NULL REFERENCES users(id);
CREATE INDEX idx_auth_sessions_user_active ON auth_sessions (user_id, expires_at) WHERE revoked_at IS NULL;

ALTER TABLE auth_transaction_challenges DROP COLUMN wallet_address;
ALTER TABLE auth_transaction_challenges ADD COLUMN user_id UUID NOT NULL REFERENCES users(id);

DROP INDEX IF EXISTS idx_auth_security_events_dedup;
ALTER TABLE auth_security_events DROP COLUMN wallet_address;
ALTER TABLE auth_security_events ADD COLUMN user_id UUID REFERENCES users(id);
CREATE INDEX idx_auth_security_events_dedup ON auth_security_events (event_type, user_id, occurred_at DESC);

ALTER TABLE login_contexts DROP COLUMN wallet_address;
ALTER TABLE login_contexts ADD COLUMN user_id UUID NOT NULL REFERENCES users(id);
CREATE INDEX idx_login_contexts_user_expiry ON login_contexts (user_id, expires_at);

-- ---------------------------------------------------------------------------
-- 6. per-user tables keyed by wallet
-- ---------------------------------------------------------------------------
-- TOTP enrolments keep their secrets (encrypted with the application key, not
-- bound to the wallet), so no one has to re-enrol.
ALTER TABLE user_mfa ADD COLUMN user_id UUID;
UPDATE user_mfa m SET user_id = u.id FROM users u WHERE u.wallet_address = m.wallet_address;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM user_mfa WHERE user_id IS NULL) THEN
        RAISE EXCEPTION 'identity migration stopped: user_mfa rows whose wallet names no user';
    END IF;
END $$;
ALTER TABLE user_mfa DROP COLUMN wallet_address;
ALTER TABLE user_mfa ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE user_mfa ADD PRIMARY KEY (user_id);
ALTER TABLE user_mfa ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE persons ADD COLUMN user_id UUID;
UPDATE persons p SET user_id = u.id FROM users u WHERE u.wallet_address = p.wallet_address;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM persons WHERE wallet_address IS NOT NULL AND user_id IS NULL) THEN
        RAISE EXCEPTION 'identity migration stopped: persons rows whose wallet names no user';
    END IF;
END $$;
ALTER TABLE persons DROP COLUMN wallet_address;
ALTER TABLE persons ADD CONSTRAINT persons_user_id_key UNIQUE (user_id);
ALTER TABLE persons ADD FOREIGN KEY (user_id) REFERENCES users(id);

-- ---------------------------------------------------------------------------
-- 7. views: join on the key the columns now hold
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_healthcare_providers;
DROP VIEW IF EXISTS v_active_users;
DROP VIEW IF EXISTS v_active_nursing_care_plans;
DROP VIEW IF EXISTS v_ed_dashboard;
DROP VIEW IF EXISTS v_high_fall_risk_patients;
DROP VIEW IF EXISTS v_pending_labs;
DROP VIEW IF EXISTS v_pending_orders;
DROP VIEW IF EXISTS v_pending_radiology;
DROP VIEW IF EXISTS v_surgical_schedule;
DROP VIEW IF EXISTS v_todays_appointments;
DROP VIEW IF EXISTS v_wound_care_alerts;

CREATE VIEW v_active_users AS
SELECT u.id, u.email, u.role, u.name, u.username, u.is_active, u.created_at,
       u.last_login_at, u.login_count, p.first_name, p.last_name, p.specialty,
       p.department, p.phone, p.license_number
FROM users u
LEFT JOIN user_profiles p ON u.id = p.user_id
WHERE u.is_active = true;

CREATE VIEW v_healthcare_providers AS
SELECT id, email, role, name, username, is_active, created_at, last_login_at,
       login_count, first_name, last_name, specialty, department, phone, license_number
FROM v_active_users
WHERE role::text = ANY (ARRAY['Doctor', 'Nurse', 'LabTechnician', 'Pharmacist']);

CREATE VIEW v_active_nursing_care_plans AS
SELECT ncp.patient_id, p.health_id, ncp.plan_name, ncp.care_level, ncp.status,
       ncp.start_date, ncp.target_end_date, u.name AS created_by_name, ncp.created_at
FROM nursing_care_plans ncp
JOIN patients p ON ncp.patient_id::text = p.id::text
LEFT JOIN users u ON ncp.created_by::text = u.id_text
WHERE ncp.status::text = 'active' AND ncp.is_active = true
ORDER BY ncp.start_date DESC;

CREATE VIEW v_ed_dashboard AS
SELECT t.id AS triage_id, t.patient_id, p.health_id, t.esi_level, t.chief_complaint,
       t.is_critical, t.assigned_bed, t.triage_time, t.disposition, u.name AS triage_nurse
FROM triage_assessments t
JOIN patients p ON t.patient_id::text = p.id::text
JOIN users u ON t.performed_by::text = u.id_text
WHERE t.triage_time > now() - INTERVAL '24 hours'
ORDER BY t.esi_level, t.triage_time;

CREATE VIEW v_high_fall_risk_patients AS
SELECT fra.patient_id, p.health_id, fra.total_score, fra.risk_level, fra.assessed_at,
       fra.next_assessment_due, u.name AS assessed_by_name, fra.interventions
FROM fall_risk_assessments fra
JOIN patients p ON fra.patient_id::text = p.id::text
LEFT JOIN users u ON fra.assessed_by::text = u.id_text
WHERE fra.risk_level::text = ANY (ARRAY['moderate', 'high'])
  AND fra.assessed_at = (SELECT max(fra2.assessed_at) FROM fall_risk_assessments fra2
                         WHERE fra2.patient_id::text = fra.patient_id::text)
ORDER BY fra.total_score DESC;

CREATE VIEW v_pending_labs AS
SELECT ls.id, ls.patient_id, p.health_id, ls.priority, ls.status, ls.order_date,
       ls.expected_completion, u.name AS ordering_provider,
       jsonb_array_length(ls.tests_ordered) AS test_count,
       CASE WHEN ls.priority::text = 'stat' THEN 1
            WHEN ls.priority::text = 'asap' THEN 2
            WHEN ls.priority::text = 'urgent' THEN 3
            ELSE 4 END AS priority_order
FROM lab_submissions ls
JOIN patients p ON ls.patient_id::text = p.id::text
LEFT JOIN users u ON ls.ordering_provider_id::text = u.id_text
WHERE ls.status::text = ANY (ARRAY['pending', 'collected', 'in_progress'])
ORDER BY CASE WHEN ls.priority::text = 'stat' THEN 1
              WHEN ls.priority::text = 'asap' THEN 2
              WHEN ls.priority::text = 'urgent' THEN 3
              ELSE 4 END, ls.order_date;

CREATE VIEW v_pending_orders AS
SELECT po.id, po.patient_id, p.health_id, po.ordering_provider_id,
       u.name AS ordering_provider, po.order_type, po.priority, po.order_datetime,
       po.order_details,
       EXTRACT(epoch FROM now() - po.order_datetime) / 3600::numeric AS hours_pending
FROM physician_orders po
JOIN patients p ON po.patient_id::text = p.id::text
LEFT JOIN users u ON po.ordering_provider_id::text = u.id_text
WHERE po.status::text = 'pending'
ORDER BY CASE po.priority WHEN 'stat' THEN 1 WHEN 'asap' THEN 2 WHEN 'urgent' THEN 3 ELSE 4 END,
         po.order_datetime;

CREATE VIEW v_pending_radiology AS
SELECT ro.id, ro.patient_id, p.health_id, ro.modality, ro.study_type, ro.body_part,
       ro.priority, ro.status, ro.scheduled_datetime, u.name AS ordering_provider
FROM radiology_orders ro
JOIN patients p ON ro.patient_id::text = p.id::text
LEFT JOIN users u ON ro.ordering_provider_id::text = u.id_text
WHERE ro.status::text = ANY (ARRAY['ordered', 'scheduled', 'in_progress'])
ORDER BY CASE ro.priority WHEN 'stat' THEN 1 WHEN 'asap' THEN 2 WHEN 'urgent' THEN 3 ELSE 4 END,
         ro.scheduled_datetime;

CREATE VIEW v_surgical_schedule AS
SELECT po.id, po.patient_id, p.health_id, po.procedure_name, po.scheduled_date,
       s.name AS surgeon_name, a.name AS anesthesiologist_name, po.asa_classification,
       po.cleared_for_surgery, po.consent_signed
FROM pre_op_assessments po
JOIN patients p ON po.patient_id::text = p.id::text
LEFT JOIN users s ON po.surgeon_id::text = s.id_text
LEFT JOIN users a ON po.anesthesiologist_id::text = a.id_text
WHERE po.scheduled_date >= CURRENT_DATE
ORDER BY po.scheduled_date;

CREATE VIEW v_todays_appointments AS
SELECT a.id, a.patient_id, p.health_id, a.provider_id, u.name AS provider_name,
       a.appointment_type, a.scheduled_datetime, a.duration_minutes, a.status,
       a.location, a.room, a.reason_for_visit, a.visit_type
FROM appointments a
JOIN patients p ON a.patient_id::text = p.id::text
JOIN users u ON a.provider_id::text = u.id_text
WHERE date(a.scheduled_datetime) = CURRENT_DATE
ORDER BY a.scheduled_datetime;

CREATE VIEW v_wound_care_alerts AS
SELECT wa.patient_id, p.health_id, wa.wound_id, wa.wound_location, wa.wound_type,
       wa.drainage_amount, wa.pain_level, wa.assessed_at, wa.notes, u.name AS assessed_by_name
FROM wound_assessments wa
JOIN patients p ON wa.patient_id::text = p.id::text
LEFT JOIN users u ON wa.assessed_by::text = u.id_text
WHERE (wa.drainage_amount::text = ANY (ARRAY['moderate', 'heavy'])
       OR wa.pain_level >= 7
       OR wa.periwound_condition::text <> 'intact')
  AND wa.assessed_at >= now() - INTERVAL '24 hours'
ORDER BY wa.assessed_at DESC;

-- ---------------------------------------------------------------------------
-- 8. foreign keys, tranche 1: the columns whose value is always a user
-- ---------------------------------------------------------------------------
ALTER TABLE appointments ADD CONSTRAINT appointments_provider_id_fkey
    FOREIGN KEY (provider_id) REFERENCES users(id_text);
ALTER TABLE care_relationships ADD CONSTRAINT care_relationships_clinician_fkey
    FOREIGN KEY (clinician_id) REFERENCES users(id_text);
ALTER TABLE access_contexts ADD CONSTRAINT access_contexts_clinician_fkey
    FOREIGN KEY (clinician_id) REFERENCES users(id_text);
ALTER TABLE patient_access_grants ADD CONSTRAINT patient_access_grants_provider_fkey
    FOREIGN KEY (provider_id) REFERENCES users(id_text);
ALTER TABLE patient_access_requests ADD CONSTRAINT patient_access_requests_provider_fkey
    FOREIGN KEY (provider_id) REFERENCES users(id_text);
ALTER TABLE break_glass_grants ADD CONSTRAINT break_glass_grants_clinician_fkey
    FOREIGN KEY (clinician_id) REFERENCES users(id_text);
ALTER TABLE users ADD CONSTRAINT users_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id_text);
