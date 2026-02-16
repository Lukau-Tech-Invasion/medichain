-- Demo Patients Data Migration
-- MediChain PostgreSQL - Demo Data Seeding
-- Created: January 26, 2026
-- Purpose: Seed demo patients for testing/demonstration

-- ============================================================================
-- DEMO PATIENTS
-- These patients are linked to the demo healthcare providers
-- ============================================================================

-- Patient 1: Thabo Mokoena - Cardiac patient with hypertension
INSERT INTO patients (
    id, health_id, national_id_hash, national_id_type,
    gender, blood_type, emergency_contact_relationship,
    organ_donor, dnr_status, is_verified, is_active
) VALUES (
    'PAT-001-DEMO', 'HID-10001', 'hash_nid_1001', 'SmartID',
    'Male', 'A+', 'Wife',
    TRUE, FALSE, TRUE, TRUE
) ON CONFLICT (id) DO NOTHING;

-- Patient 2: Nomvula Dlamini - Diabetic patient
INSERT INTO patients (
    id, health_id, national_id_hash, national_id_type,
    gender, blood_type, emergency_contact_relationship,
    organ_donor, dnr_status, is_verified, is_active
) VALUES (
    'PAT-002-DEMO', 'HID-10002', 'hash_nid_1002', 'SmartID',
    'Female', 'O-', 'Brother',
    TRUE, FALSE, TRUE, TRUE
) ON CONFLICT (id) DO NOTHING;

-- Patient 3: Sipho Nkosi - Asthma patient
INSERT INTO patients (
    id, health_id, national_id_hash, national_id_type,
    gender, blood_type, emergency_contact_relationship,
    organ_donor, dnr_status, is_verified, is_active
) VALUES (
    'PAT-003-DEMO', 'HID-10003', 'hash_nid_1003', 'SmartID',
    'Male', 'B+', 'Wife',
    FALSE, FALSE, TRUE, TRUE
) ON CONFLICT (id) DO NOTHING;

-- Patient 4: Lerato Khumalo - Young healthy patient with allergies
INSERT INTO patients (
    id, health_id, national_id_hash, national_id_type,
    gender, blood_type, emergency_contact_relationship,
    organ_donor, dnr_status, is_verified, is_active
) VALUES (
    'PAT-004-DEMO', 'HID-10004', 'hash_nid_1004', 'SmartID',
    'Female', 'AB+', 'Father',
    TRUE, FALSE, TRUE, TRUE
) ON CONFLICT (id) DO NOTHING;

-- Patient 5: Bongani Zulu - Elderly cardiac patient with DNR
INSERT INTO patients (
    id, health_id, national_id_hash, national_id_type,
    gender, blood_type, emergency_contact_relationship,
    organ_donor, dnr_status, is_verified, is_active
) VALUES (
    'PAT-005-DEMO', 'HID-10005', 'hash_nid_1005', 'SmartID',
    'Male', 'O+', 'Daughter',
    FALSE, TRUE, TRUE, TRUE
) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- DEMO PATIENT EXTENDED INFO
-- Store additional patient details in a simple lookup table
-- (Used by API to populate in-memory PatientProfile)
-- ============================================================================

CREATE TABLE IF NOT EXISTS patient_demographics (
    patient_id VARCHAR(64) PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
    full_name VARCHAR(200) NOT NULL,
    date_of_birth DATE NOT NULL,
    national_id VARCHAR(64) NOT NULL,
    
    -- Allergies (JSON array)
    allergies JSONB DEFAULT '[]',
    
    -- Current medications (JSON array)
    current_medications JSONB DEFAULT '[]',
    
    -- Chronic conditions (JSON array)
    chronic_conditions JSONB DEFAULT '[]',
    
    -- Emergency contact
    emergency_contact_name VARCHAR(200),
    emergency_contact_phone VARCHAR(20),
    
    -- Languages (JSON array)
    languages JSONB DEFAULT '["English"]',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert demographics for demo patients
INSERT INTO patient_demographics (
    patient_id, full_name, date_of_birth, national_id,
    allergies, current_medications, chronic_conditions,
    emergency_contact_name, emergency_contact_phone, languages
) VALUES
    -- Thabo Mokoena
    ('PAT-001-DEMO', 'Thabo Mokoena', '1985-03-15', 'NID-1001',
     '["Penicillin", "Peanuts"]'::JSONB,
     '["Lisinopril 10mg daily"]'::JSONB,
     '["Hypertension"]'::JSONB,
     'Zanele Mokoena', '+27-11-555-0101', '["English", "Zulu", "Sotho"]'::JSONB),
    
    -- Nomvula Dlamini
    ('PAT-002-DEMO', 'Nomvula Dlamini', '1990-07-22', 'NID-1002',
     '["Sulfa drugs"]'::JSONB,
     '["Metformin 500mg twice daily", "Atorvastatin 20mg daily"]'::JSONB,
     '["Type 2 Diabetes", "High Cholesterol"]'::JSONB,
     'Themba Dlamini', '+27-11-555-0102', '["English", "Zulu"]'::JSONB),
    
    -- Sipho Nkosi
    ('PAT-003-DEMO', 'Sipho Nkosi', '1978-11-08', 'NID-1003',
     '[]'::JSONB,
     '["Albuterol inhaler PRN"]'::JSONB,
     '["Asthma"]'::JSONB,
     'Lindiwe Nkosi', '+27-11-555-0103', '["English", "Zulu"]'::JSONB),
    
    -- Lerato Khumalo
    ('PAT-004-DEMO', 'Lerato Khumalo', '1995-01-30', 'NID-1004',
     '["Latex", "Ibuprofen"]'::JSONB,
     '[]'::JSONB,
     '[]'::JSONB,
     'David Khumalo', '+27-11-555-0104', '["English", "Sotho"]'::JSONB),
    
    -- Bongani Zulu
    ('PAT-005-DEMO', 'Bongani Zulu', '1962-05-18', 'NID-1005',
     '["Aspirin"]'::JSONB,
     '["Warfarin 5mg daily", "Digoxin 0.125mg daily", "Furosemide 40mg daily"]'::JSONB,
     '["Atrial Fibrillation", "Heart Failure"]'::JSONB,
     'Thandiwe Zulu', '+27-11-555-0105', '["English", "Zulu"]'::JSONB)
ON CONFLICT (patient_id) DO NOTHING;

-- ============================================================================
-- DEMO NFC TAGS
-- Each patient gets an NFC tag for emergency access
-- ============================================================================

INSERT INTO nfc_tags (id, tag_uid, patient_id, tag_type, is_active) VALUES
    ('NFC-001-DEMO', 'NFC-UID-10001', 'PAT-001-DEMO', 'NTAG216', TRUE),
    ('NFC-002-DEMO', 'NFC-UID-10002', 'PAT-002-DEMO', 'NTAG216', TRUE),
    ('NFC-003-DEMO', 'NFC-UID-10003', 'PAT-003-DEMO', 'NTAG216', TRUE),
    ('NFC-004-DEMO', 'NFC-UID-10004', 'PAT-004-DEMO', 'NTAG216', TRUE),
    ('NFC-005-DEMO', 'NFC-UID-10005', 'PAT-005-DEMO', 'NTAG216', TRUE)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- LINK PATIENT USERS TO PATIENT RECORDS
-- Update the demo Patient role users to link to patient records
-- ============================================================================

UPDATE users SET linked_patient_id = 'PAT-001-DEMO' 
WHERE wallet_address = '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z';

UPDATE users SET linked_patient_id = 'PAT-002-DEMO'
WHERE wallet_address = '5GNJqTPyNqANBkUVMN1LPPrxXnFouWXoe2wNSmmEoLctxiZZ';

UPDATE users SET linked_patient_id = 'PAT-003-DEMO'
WHERE wallet_address = '5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFZ';
