-- Staff contact details had nowhere safe to live.
--
-- `user_profiles.phone` is a plaintext `VARCHAR(20)`, and a staff mobile number
-- is personal information POPIA requires be protected. So `POST /api/auth/register`
-- and `PUT /api/users/{wallet}` both refused any non-empty phone outright with
-- `PHONE_STORAGE_UNAVAILABLE` — a correct refusal, and one that made the
-- administrator unable to record a way to contact the clinician they had just
-- onboarded.
--
-- Patients' contact details already go through `patients.profile_extras_encrypted`
-- with the `EncryptionKeyring`. This gives staff the same treatment: one
-- encrypted blob, one key version, and a keyring rotation story identical to the
-- patient one.
--
-- A blob rather than a per-column `phone_encrypted`, for the same reason the
-- patient side uses one: the set of contact fields worth protecting grows (a
-- second number, a next-of-kin, a pager), and each addition would otherwise be
-- another migration and another nullable column.
--
-- `contact_key_version` is NOT NULL DEFAULT 1 so an existing row is readable:
-- version 1 is the first key every deployment configures, and rows with no blob
-- ignore it entirely.
ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS contact_encrypted BYTEA,
    ADD COLUMN IF NOT EXISTS contact_key_version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN user_profiles.contact_encrypted IS
    'ChaCha20-Poly1305 sealed JSON of the staff member''s contact details. Encrypted under the keyring version in contact_key_version. NEVER write a contact detail to the plaintext phone column.';

COMMENT ON COLUMN user_profiles.phone IS
    'DEPRECATED and never written by the API. Plaintext, and therefore a POPIA hazard; contact details go in contact_encrypted. Retained only so existing rows are not destroyed.';
