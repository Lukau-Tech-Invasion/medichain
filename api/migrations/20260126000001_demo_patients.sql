-- Patient demographics lookup table
-- MediChain PostgreSQL
-- Created: January 26, 2026
--
-- This migration originally seeded synthetic demo patients, NFC tags and
-- patient-account links keyed by wallet address. It now seeds nothing: every
-- patient is registered through the API and receives an issued medical ID.

-- ============================================================================
-- PATIENT EXTENDED INFO
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
