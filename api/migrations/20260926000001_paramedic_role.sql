-- Give EMS staff a dedicated role without silently reclassifying Nurses.
-- An administrator must review existing EMS accounts and reassign them through
-- user management; every role change is audited by the API.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
    'Patient', 'Doctor', 'Nurse', 'Admin', 'LabTechnician',
    'Pharmacist', 'Receptionist', 'Paramedic'
));
