-- A staff profile picture.
--
-- Settings offered "Change avatar" with no upload behind it.
--
-- Deliberately its own table rather than a column on `users`: an avatar is not
-- an identity attribute, and a column there would be serialised into every
-- user list, every provider directory and every embedded actor the API
-- returns. It is also not clinical, so it does not belong in IPFS, which here
-- holds encrypted medical documents behind a consent check -- routing a
-- profile picture through that path would put it behind a medical-records
-- gate.
--
-- `owner_id` is the clinician's wallet, one row each. The image lives in
-- `data` as a bounded `data:` URI; the handler enforces an image media type
-- and a size ceiling, because without one a single profile carries a megabyte
-- into every response that reads it.
CREATE TABLE IF NOT EXISTS user_avatars (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_avatars_owner
    ON user_avatars (owner_id);
