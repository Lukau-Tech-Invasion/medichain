-- A health ID card must survive a restart.
--
-- `CardRegistry` is a pair of `RwLock<HashMap>` with no storage behind it, and
-- it is the only home a card has ever had. Every card issued by
-- `POST /api/nfc/generate` was therefore lost when the process stopped: the
-- physical card in the patient's wallet still exists, still carries its hash,
-- and taps to `CARD_NOT_FOUND` -- which reads exactly like a revoked card, at
-- the roadside, three seconds into an emergency.
--
-- A durable `nfc_tags` table has existed the whole time, with both a memory and
-- a PostgreSQL implementation, and two other handlers already write to it. The
-- card registry simply never did. (`dead-durable-variant-beside-live-volatile-one`
-- is a recurring shape here; this is the clearest instance of it.)
--
-- What that table could not express is *why* a card is unusable. `is_active` is
-- a boolean, and `CardStatus` distinguishes Active, Suspended, Revoked and
-- Expired -- a suspended card can be reinstated by an administrator, a revoked
-- one cannot, and collapsing them loses the difference permanently on the first
-- restart. So the status is stored as itself.
--
-- `is_active` is kept and stays authoritative for the two existing readers
-- (`handlers::emergency_access`, `medical_id::emergency_views`), which ask only
-- whether a tag may be used. `status` narrows that to the reason.
ALTER TABLE nfc_tags
    ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'Active';

ALTER TABLE nfc_tags
    DROP CONSTRAINT IF EXISTS nfc_tags_status_check;

ALTER TABLE nfc_tags
    ADD CONSTRAINT nfc_tags_status_check
    CHECK (status IN ('Active', 'Suspended', 'Revoked', 'Expired'));

COMMENT ON COLUMN nfc_tags.status IS
    'Why the card is or is not usable: Active, Suspended (reinstatable), Revoked (permanent) or Expired. is_active stays the fast predicate; this is the reason behind it.';
