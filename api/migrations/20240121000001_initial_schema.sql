-- MediChain Initial Database Schema
-- This migration creates the users, profiles, and sessions tables
-- with demo data for hackathon judges

-- ============================================================================
-- Enable Extensions
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- USERS TABLE
-- Primary user storage with wallet-based authentication
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Wallet Authentication (Primary - SS58 format)
    wallet_address VARCHAR(66) UNIQUE NOT NULL,
    
    -- Optional Email Authentication
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),
    
    -- User Information
    role VARCHAR(20) NOT NULL CHECK (role IN (
        'Patient', 'Doctor', 'Nurse', 'Admin', 
        'LabTechnician', 'Pharmacist', 'Receptionist'
    )),
    name VARCHAR(200),
    username VARCHAR(100),
    
    -- Blockchain Integration
    blockchain_address VARCHAR(66),
    blockchain_tx_hash VARCHAR(66),
    
    -- Patient Link (for Patient role users)
    linked_patient_id VARCHAR(50),
    
    -- Status & Metadata
    is_active BOOLEAN DEFAULT TRUE,
    email_verified BOOLEAN DEFAULT FALSE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    login_count INTEGER DEFAULT 0,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(66),  -- wallet address of creator
    
    -- Constraints
    CONSTRAINT valid_wallet CHECK (LENGTH(wallet_address) >= 45 AND wallet_address LIKE '5%')
);

-- ============================================================================
-- USER PROFILES TABLE
-- Extended user information (separate for query efficiency)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    
    -- Personal Information
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    date_of_birth DATE,
    phone VARCHAR(20),
    
    -- Address
    address_line1 VARCHAR(200),
    address_line2 VARCHAR(200),
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'South Africa',
    
    -- Professional Info (for healthcare workers)
    license_number VARCHAR(50),
    specialty VARCHAR(100),
    department VARCHAR(100),
    
    -- Preferences (JSON for flexibility)
    preferences JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- SESSIONS TABLE
-- Tracks active user sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    
    -- Session Data
    token VARCHAR(500) UNIQUE NOT NULL,
    device_info VARCHAR(500),
    ip_address VARCHAR(45),  -- Supports IPv6
    
    -- Lifecycle
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_expiry CHECK (expires_at > created_at)
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Users table indexes
CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL;

-- User profiles indexes
CREATE INDEX IF NOT EXISTS idx_profiles_user ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_specialty ON user_profiles(specialty) WHERE specialty IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_department ON user_profiles(department) WHERE department IS NOT NULL;

-- Sessions indexes
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
-- Note: Partial index on active sessions removed - CURRENT_TIMESTAMP is not IMMUTABLE

-- ============================================================================
-- TRIGGERS FOR AUTO-UPDATE TIMESTAMPS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at 
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to clean expired sessions (call periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to update login tracking
CREATE OR REPLACE FUNCTION update_login_info(p_wallet_address VARCHAR)
RETURNS VOID AS $$
BEGIN
    UPDATE users 
    SET 
        last_login_at = CURRENT_TIMESTAMP,
        login_count = login_count + 1
    WHERE wallet_address = p_wallet_address;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- DEMO DATA FOR JUDGES
-- Pre-populated accounts for easy testing
-- ============================================================================

-- Admin accounts
INSERT INTO users (wallet_address, role, name, username, is_active) VALUES
    ('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', 'Admin', 'System Administrator', 'admin', TRUE),
    ('5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y', 'Admin', 'Judge Admin', 'judge', TRUE)
ON CONFLICT (wallet_address) DO NOTHING;

-- Doctors
INSERT INTO users (wallet_address, role, name, username, is_active) VALUES
    ('5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', 'Doctor', 'Dr. Thabo Mbeki', 'dr.mbeki', TRUE),
    ('5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy', 'Doctor', 'Dr. Naledi Khumalo', 'dr.khumalo', TRUE),
    ('5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw', 'Doctor', 'Dr. Sipho Nkosi', 'dr.nkosi', TRUE)
ON CONFLICT (wallet_address) DO NOTHING;

-- Nurses
INSERT INTO users (wallet_address, role, name, username, is_active) VALUES
    ('5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL', 'Nurse', 'Nurse Zanele Dlamini', 'nurse.dlamini', TRUE),
    ('5GNJqTPyNqANBkUVMN1LPPrxXnFouWXoe2wNSmmEoLctxiZY', 'Nurse', 'Nurse Thembi Molefe', 'nurse.molefe', TRUE)
ON CONFLICT (wallet_address) DO NOTHING;

-- Lab Technicians
INSERT INTO users (wallet_address, role, name, username, is_active) VALUES
    ('5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFc', 'LabTechnician', 'Lab Tech Mpho Mokoena', 'lab.mokoena', TRUE)
ON CONFLICT (wallet_address) DO NOTHING;

-- Pharmacists
INSERT INTO users (wallet_address, role, name, username, is_active) VALUES
    ('5Ew3MyB15VprZrjQVkpQFj8okmc9xLDSEdNhqMMS5cXsqxoW', 'Pharmacist', 'Pharm. Lerato Sithole', 'pharm.sithole', TRUE)
ON CONFLICT (wallet_address) DO NOTHING;

-- Patients
INSERT INTO users (wallet_address, role, name, username, is_active) VALUES
    ('5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z', 'Patient', 'Mandla Zulu', 'patient.zulu', TRUE),
    ('5GNJqTPyNqANBkUVMN1LPPrxXnFouWXoe2wNSmmEoLctxiZZ', 'Patient', 'Lindiwe Mkhize', 'patient.mkhize', TRUE),
    ('5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFZ', 'Patient', 'Bongani Ndaba', 'patient.ndaba', TRUE)
ON CONFLICT (wallet_address) DO NOTHING;

-- Insert profiles for healthcare workers
INSERT INTO user_profiles (user_id, first_name, last_name, specialty, department, license_number, country)
SELECT id, 'System', 'Administrator', NULL, 'Administration', NULL, 'South Africa'
FROM users WHERE wallet_address = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_profiles (user_id, first_name, last_name, specialty, department, license_number, country)
SELECT id, 'Thabo', 'Mbeki', 'General Practice', 'Emergency', 'MP-12345', 'South Africa'
FROM users WHERE wallet_address = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_profiles (user_id, first_name, last_name, specialty, department, license_number, country)
SELECT id, 'Naledi', 'Khumalo', 'Cardiology', 'Cardiology', 'MP-23456', 'South Africa'
FROM users WHERE wallet_address = '5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_profiles (user_id, first_name, last_name, specialty, department, license_number, country)
SELECT id, 'Sipho', 'Nkosi', 'Pediatrics', 'Pediatrics', 'MP-34567', 'South Africa'
FROM users WHERE wallet_address = '5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_profiles (user_id, first_name, last_name, specialty, department, license_number, country)
SELECT id, 'Zanele', 'Dlamini', 'Emergency Care', 'Emergency', 'RN-45678', 'South Africa'
FROM users WHERE wallet_address = '5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_profiles (user_id, first_name, last_name, specialty, department, license_number, country)
SELECT id, 'Thembi', 'Molefe', 'ICU', 'Intensive Care', 'RN-56789', 'South Africa'
FROM users WHERE wallet_address = '5GNJqTPyNqANBkUVMN1LPPrxXnFouWXoe2wNSmmEoLctxiZY'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_profiles (user_id, first_name, last_name, specialty, department, license_number, country)
SELECT id, 'Mpho', 'Mokoena', 'Clinical Pathology', 'Laboratory', 'LT-67890', 'South Africa'
FROM users WHERE wallet_address = '5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFc'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_profiles (user_id, first_name, last_name, specialty, department, license_number, country)
SELECT id, 'Lerato', 'Sithole', 'Clinical Pharmacy', 'Pharmacy', 'PH-78901', 'South Africa'
FROM users WHERE wallet_address = '5Ew3MyB15VprZrjQVkpQFj8okmc9xLDSEdNhqMMS5cXsqxoW'
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- Active users with profile info
CREATE OR REPLACE VIEW v_active_users AS
SELECT 
    u.id,
    u.wallet_address,
    u.email,
    u.role,
    u.name,
    u.username,
    u.is_active,
    u.created_at,
    u.last_login_at,
    u.login_count,
    p.first_name,
    p.last_name,
    p.specialty,
    p.department,
    p.phone,
    p.license_number
FROM users u
LEFT JOIN user_profiles p ON u.id = p.user_id
WHERE u.is_active = TRUE;

-- Healthcare providers only
CREATE OR REPLACE VIEW v_healthcare_providers AS
SELECT * FROM v_active_users
WHERE role IN ('Doctor', 'Nurse', 'LabTechnician', 'Pharmacist');

-- Staff summary by role
CREATE OR REPLACE VIEW v_role_summary AS
SELECT 
    role,
    COUNT(*) as count,
    MAX(last_login_at) as last_active
FROM users
WHERE is_active = TRUE
GROUP BY role
ORDER BY count DESC;
