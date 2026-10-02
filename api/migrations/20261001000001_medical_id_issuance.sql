-- An issued medical ID is distinct from an account ID, a patient record key,
-- and a national ID. Existing patient cards keep the number already displayed.
-- The registry is a non-reuse tombstone: deleting a patient row never deletes
-- its issued ID. The source patient row's health_id is frozen as well.

CREATE TABLE medical_id_issuances (
    medical_id VARCHAR(32) PRIMARY KEY,
    patient_id VARCHAR(64) NOT NULL UNIQUE,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO medical_id_issuances (medical_id, patient_id)
SELECT CASE
         WHEN health_id LIKE 'MCHI-%' THEN health_id
         WHEN id LIKE 'PAT-%' AND length(id) <= 31
           THEN 'MCHI-' || upper(substr(id, 5))
         ELSE 'MCHI-' || upper(substr(md5(id), 1, 26))
       END,
       id
FROM patients;

CREATE FUNCTION register_medical_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO medical_id_issuances (medical_id, patient_id)
    VALUES (CASE
              WHEN NEW.health_id LIKE 'MCHI-%' THEN NEW.health_id
              WHEN NEW.id LIKE 'PAT-%' AND length(NEW.id) <= 31
                THEN 'MCHI-' || upper(substr(NEW.id, 5))
              ELSE 'MCHI-' || upper(substr(md5(NEW.id), 1, 26))
            END,
            NEW.id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER patients_register_medical_id
AFTER INSERT ON patients
FOR EACH ROW EXECUTE FUNCTION register_medical_id();

CREATE FUNCTION freeze_patient_health_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.health_id IS DISTINCT FROM OLD.health_id THEN
        RAISE EXCEPTION 'issued patient health ID cannot be changed';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER patients_freeze_health_id
BEFORE UPDATE OF health_id ON patients
FOR EACH ROW EXECUTE FUNCTION freeze_patient_health_id();

CREATE FUNCTION prevent_medical_id_reuse() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'medical ID issuance is immutable';
END;
$$;

CREATE TRIGGER medical_id_issuances_immutable
BEFORE UPDATE OR DELETE ON medical_id_issuances
FOR EACH ROW EXECUTE FUNCTION prevent_medical_id_reuse();
