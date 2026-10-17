-- Identity is users.id and the issued medical ID only. Remove what remains of
-- the pre-credential identity scheme:
--   * `update_login_info`, which updates a users column dropped in 20260930000003
--     and has no caller;
--   * the `actor_directory` view and `legacy_wallet_identities`, the mapping
--     from pre-migration actor keys to users;
--   * the five medical-ID issuances generated for the synthetic patients that
--     early migrations used to seed. Those patients no longer exist and are no
--     longer created, so the identifiers have nothing to protect from reuse.
--
-- A database whose mapping still holds rows has sealed history that needs it,
-- and stops here for a manual decision instead of losing those names.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM legacy_wallet_identities) THEN
        RAISE EXCEPTION 'legacy_wallet_identities is not empty; sealed history still resolves through it';
    END IF;
END $$;

DROP FUNCTION IF EXISTS update_login_info(VARCHAR);
DROP VIEW actor_directory;
DROP TABLE legacy_wallet_identities;

DELETE FROM actor_column_registry WHERE table_name = 'legacy_wallet_identities';
UPDATE actor_column_registry
SET note = 'hashed into audit leaves'
WHERE table_name = 'access_logs' AND column_name = 'accessor_id';
UPDATE actor_column_registry
SET note = 'opaque application-layer blob'
WHERE table_name = 'patients' AND column_name = 'profile_extras_encrypted';

ALTER TABLE medical_id_issuances DISABLE TRIGGER medical_id_issuances_immutable;
DELETE FROM medical_id_issuances m
WHERE (m.medical_id, m.patient_id) IN (
    ('MCHI-001-DEMO', 'PAT-001-DEMO'), ('MCHI-002-DEMO', 'PAT-002-DEMO'),
    ('MCHI-003-DEMO', 'PAT-003-DEMO'), ('MCHI-004-DEMO', 'PAT-004-DEMO'),
    ('MCHI-005-DEMO', 'PAT-005-DEMO')
)
  AND NOT EXISTS (SELECT 1 FROM patients p WHERE p.id = m.patient_id);
ALTER TABLE medical_id_issuances ENABLE TRIGGER medical_id_issuances_immutable;
