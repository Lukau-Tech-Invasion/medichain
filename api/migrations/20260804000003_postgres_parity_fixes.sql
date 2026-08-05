-- Reconcile three PostgreSQL schema/entity disagreements (Horizon HZ-026).
--
-- Each of these made a feature that works on the in-memory backend fail on
-- PostgreSQL. They were invisible for the life of the project because every
-- end-to-end assertion ran against memory, which is a HashMap and enforces no
-- column widths, no type coercion and no CHECK constraints.

-- ---------------------------------------------------------------------------
-- 1. medication_records.data
--
-- `MedicationRecordEntity.data` is a real, bound column — unlike the `data`
-- field on IORecordEntity it carries no `#[sqlx(skip)]`, and the INSERT names
-- it explicitly. The table never had it, so every write failed with
--     column "data" of relation "medication_records" does not exist
-- This is where `append_mar_administration` stores the administrations array,
-- so on PostgreSQL a nurse marking a dose given produced an error rather than
-- a record.
-- ---------------------------------------------------------------------------
ALTER TABLE medication_records
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. io_records.recorded_by / verified_by
--
-- Typed `uuid` in the schema, but the entity fields are `String` and carry a
-- WALLET ADDRESS (SS58, e.g. "5FHneW46..."), which is not a uuid and never
-- will be. Postgres rejected the bind:
--     column "recorded_by" is of type uuid but expression is of type text
-- Widened to match what the application actually stores. 66 characters matches
-- the width already used for other wallet/actor columns in this schema
-- (patients.registered_by, patients.primary_provider_id).
-- ---------------------------------------------------------------------------
-- The columns carry FOREIGN KEYs to users(id), which is a uuid the application
-- does not use: the Rust `User` struct has no `id` field at all and is keyed
-- entirely by `wallet_address`. So the constraint referenced a column the code
-- never populates or reads, while the code wrote wallet addresses that could
-- not satisfy it. The FKs are dropped before the type change (Postgres cannot
-- re-implement an FK across a type change).
--
-- NOT re-pointed at users(wallet_address), even though that column IS unique
-- and it would technically work. This is not two bad columns — **97 foreign
-- keys in this schema reference users(id)**, so the same mismatch is waiting
-- behind every handler that writes an actor. Converting two of them here would
-- imply the pattern is fixed when it is not. Referential integrity for these
-- two actor columns is now application-enforced; the systemic divergence is
-- recorded in HZ-026 and needs a deliberate schema decision, not 97 unverified
-- ALTERs at the end of a session.
ALTER TABLE io_records DROP CONSTRAINT IF EXISTS io_records_recorded_by_fkey;
ALTER TABLE io_records DROP CONSTRAINT IF EXISTS io_records_verified_by_fkey;
ALTER TABLE io_records
    ALTER COLUMN recorded_by TYPE VARCHAR(66) USING recorded_by::text;
ALTER TABLE io_records
    ALTER COLUMN verified_by TYPE VARCHAR(66) USING verified_by::text;

-- ---------------------------------------------------------------------------
-- 3. users.valid_wallet
--
-- The constraint required `length >= 45 AND wallet_address LIKE '5%'` — i.e. a
-- real SS58 address. Patient registration auto-creates a Patient account whose
-- `wallet_address` is the PATIENT ID ("PAT-1a2b3c4d"), a documented placeholder
-- "until they link a wallet". That is 12 characters and starts with 'P', so
-- every auto-created patient account was rejected on PostgreSQL while being
-- accepted on memory.
--
-- The constraint is widened to admit exactly the two legitimate forms rather
-- than being dropped: a real SS58 wallet, or the explicit `PAT-` placeholder.
-- Anything else is still rejected, so the check keeps its value as a format
-- guard.
--
-- NOTE, deliberately recorded rather than silently enabled: because the
-- placeholder IS the patient id, and `X-User-Id` is the authentication header,
-- a patient id doubles as that patient's credential wherever signature
-- verification is off (IS_DEMO=true). This migration does not create that
-- property — the memory backend has always behaved this way — but it does make
-- PostgreSQL match it. The real fix is to stop minting an account before a
-- wallet exists, or to mark such accounts non-authenticatable until linked;
-- that is a product decision, not a schema one, and is tracked in HZ-026.
-- ---------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS valid_wallet;
ALTER TABLE users ADD CONSTRAINT valid_wallet CHECK (
    (length(wallet_address) >= 45 AND wallet_address LIKE '5%')
    OR wallet_address LIKE 'PAT-%'
);
