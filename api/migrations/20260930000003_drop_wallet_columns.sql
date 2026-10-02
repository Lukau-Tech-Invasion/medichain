-- M2: drop the wallet columns (ADR-0010, phase C).
--
-- By now every actor column, session and token carries `users.id`
-- (20260930000001), sign-in is a password proof or a one-time code
-- (20260930000002), and nothing reads or writes a wallet string. What remains is
-- the column that used to be the key, and the table that stored wallet sign-in
-- challenges.
--
-- NOT dropped, on purpose: `legacy_wallet_identities` and the `actor_directory`
-- view. Sealed access-log rows, audit leaves and capsule commitments still carry
-- the old strings and must never be rewritten, so the mapping that resolves them
-- to a person stays for as long as that history does.

-- Wallet sign-in challenges: nothing issues or consumes them any more.
DROP TABLE IF EXISTS auth_challenges;

-- The key that `users.id` replaced. Its unique constraint and indexes go with it.
ALTER TABLE users DROP COLUMN IF EXISTS wallet_address;

-- Unused since before the rename; patients are people with a `users` row.
ALTER TABLE patients DROP COLUMN IF EXISTS wallet_address;

-- The registry listed these three as `legacy` until this migration.
DELETE FROM actor_column_registry
 WHERE (table_name, column_name) IN
       (('users', 'wallet_address'),
        ('patients', 'wallet_address'),
        ('auth_challenges', 'wallet_address'));
