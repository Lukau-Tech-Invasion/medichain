-- A shift handoff row is keyed by HO-<32 hex>-<patient ID>. The prior
-- VARCHAR(64) could not hold the key for a normal PAT-<UUID> identifier.
ALTER TABLE shift_handoffs ALTER COLUMN id TYPE VARCHAR(128);
