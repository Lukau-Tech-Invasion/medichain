-- Retired. This version once marked the credentialless demo accounts that early
-- migrations seeded, so bootstrap could ignore them. Those migrations no longer
-- seed any account, so there is nothing to mark. Kept as a no-op so the version
-- history stays continuous for databases that already applied it.
SELECT 1;
