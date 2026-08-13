-- =============================================================================
-- H1 (issue #7) — make the logical user survive a restart intact
-- Horizon HZ-2026-MC1, Lane B. See
-- .horizon/evidence-private/HZ-H1-PERSISTENCE/inventory.md
-- =============================================================================
--
-- D-1: SUSPENSION DID NOT SURVIVE A RESTART.
--
-- `AppState::persist_user` collapsed a four-valued status
-- (active | inactive | suspended | pending) into the boolean `is_active` via
-- `is_active = user.status != "inactive"`. So `suspended` and `pending` both
-- persisted as is_active = TRUE, and `load_demo_users_from_db` mapped that back
-- to "active". An administrator could suspend an account, the API would restart,
-- and the account would be active again with no audit trace of the reversal.
--
-- The fix is to stop projecting a four-valued domain concept onto a boolean.
-- `is_active` is RETAINED and kept consistent with `status`, so existing
-- readers keep their current meaning:
--   * load_demo_users_from_db  filters `WHERE is_active = true`
--   * deactivate_user_in_db    sets `is_active = false` (role revocation)
-- Only accounts that are genuinely usable now carry is_active = TRUE.
-- =============================================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

-- Backfill from the only information the old schema retained. Rows with
-- is_active = false are 'inactive'; a suspended/pending row is indistinguishable
-- from an active one in the old encoding, so it necessarily backfills to
-- 'active'. That data loss already happened — this migration stops it recurring,
-- it cannot retroactively recover a distinction that was never stored.
UPDATE users SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users
    ADD CONSTRAINT users_status_check
    CHECK (status IN ('active', 'inactive', 'suspended', 'pending'));

-- `suspended` and `pending` accounts must not be loaded as usable, so the
-- invariant tying the two columns together is asserted in the database rather
-- than trusted to every future call site.
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_status_is_active_agree;
ALTER TABLE users
    ADD CONSTRAINT users_status_is_active_agree
    CHECK (is_active = (status = 'active'));

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

COMMENT ON COLUMN users.status IS
    'Account status: active | inactive | suspended | pending. Authoritative. '
    '`is_active` is a derived convenience flag constrained to (status = ''active''); '
    'writing one without the other violates users_status_is_active_agree.';

-- =============================================================================
-- D-2: professional profile fields were never persisted.
--
-- `phone` is deliberately NOT included. Horizon HZ-014 removed the only write
-- path into user_profiles and requires that first_name/last_name/date_of_birth/
-- phone/address_* be ENCRYPTED (as the equivalent patient fields already are)
-- before any new write path touches them. license_number/specialty/department
-- are professional attributes, not personal data, and sit outside that set — so
-- they may be persisted in the clear, and phone may not.
--
-- The columns already exist (20240121000001_initial_schema.sql). Nothing is
-- added here; this block documents why the write path added in this change is
-- limited to three of the four fields.
-- =============================================================================

COMMENT ON COLUMN user_profiles.license_number IS
    'Professional registration number. Written by AppState::persist_user. '
    'Not personal data under the HZ-014 classification, so stored in the clear.';
COMMENT ON COLUMN user_profiles.phone IS
    'PLAINTEXT PII — HZ-014. NOT written by any code path. Must be encrypted '
    'via EncryptionKeyring before any write path is connected.';
