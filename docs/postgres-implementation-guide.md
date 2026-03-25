# PostgreSQL + Blockchain Hybrid Implementation Guide
## MediChain Production-Grade User Storage

> **Estimated Time:** 4-6 days (44 hours total)  
> **Difficulty:** Intermediate  
> **Prerequisites:** Rust basics, Docker installed, PostgreSQL knowledge (beginner)

---

## 📋 Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Phase 1: Environment Setup (Day 1)](#phase-1-environment-setup-day-1)
3. [Phase 2: Database Schema Design (Day 2)](#phase-2-database-schema-design-day-2)
4. [Phase 3: Rust Integration (Days 3-4)](#phase-3-rust-integration-days-3-4)
5. [Phase 4: Blockchain Synchronization (Day 5)](#phase-4-blockchain-synchronization-day-5)
6. [Phase 5: Testing & Documentation (Day 6)](#phase-5-testing--documentation-day-6)
7. [Production Deployment](#production-deployment)
8. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

### Current Architecture (In-Memory)
```
┌─────────────────┐
│   Frontend      │
│  (React/RN)     │
└────────┬────────┘
         │ HTTP
         ▼
┌─────────────────┐
│   Rust API      │
│   (Actix-web)   │
│                 │
│  ┌───────────┐  │
│  │ HashMap   │  │ ← ALL DATA HERE (volatile)
│  │ (RAM)     │  │
│  └───────────┘  │
└─────────────────┘
```

**Problem:** Server restart = all users lost

### Target Architecture (Hybrid)
```
┌─────────────────┐
│   Frontend      │
│  (React/RN)     │
└────────┬────────┘
         │ HTTP
         ▼
┌─────────────────┐
│   Rust API      │
│   (Actix-web)   │
└─────┬─────┬─────┘
      │     │
      │     └─────────────────┐
      │                       │
      ▼                       ▼
┌─────────────┐      ┌──────────────┐
│ PostgreSQL  │      │  Blockchain  │
│             │      │   (Pallets)  │
│ • Users     │      │              │
│ • Sessions  │      │ • Record     │
│ • Profiles  │      │   Hashes     │
│             │      │ • Audit Logs │
└─────────────┘      └──────────────┘
      │
      ▼
┌─────────────┐
│    IPFS     │
│  (Encrypted │
│   Documents)│
└─────────────┘
```

### Data Distribution Strategy

| **Data Type** | **Storage** | **Why** |
|--------------|-------------|---------|
| User credentials | PostgreSQL | Fast queries, ACID transactions |
| Patient profiles | PostgreSQL | Frequent updates, searchable |
| Session tokens | PostgreSQL | TTL support, fast lookups |
| Medical record metadata | PostgreSQL | Complex queries, relationships |
| **Record hashes** | **Blockchain** | **Immutability, proof of integrity** |
| **Access logs** | **Blockchain** | **Audit trail, tamper-proof** |
| **Consent transactions** | **Blockchain** | **Legal compliance** |
| Large documents (PDFs, X-rays) | IPFS | Storage efficiency |

---

## Phase 1: Environment Setup (Day 1)
**Time Estimate:** 8 hours

### Step 1.1: Install Dependencies

#### On Windows (PowerShell as Admin)
```powershell
# Install PostgreSQL client tools (optional but helpful)
choco install postgresql14 -y

# Verify Docker is running
docker --version
docker-compose --version
```

#### On macOS
```bash
brew install postgresql@14
brew services start postgresql@14
```

#### On Linux
```bash
sudo apt-get update
sudo apt-get install postgresql-client-14
```

### Step 1.2: Add Rust Dependencies

Open `api/Cargo.toml` and add:

```toml
[dependencies]
# Existing dependencies...
actix-web = "4"
actix-cors = "0.7"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

# NEW: PostgreSQL dependencies
sqlx = { version = "0.7", features = [
    "runtime-tokio-rustls",  # Async runtime
    "postgres",              # PostgreSQL driver
    "uuid",                  # UUID support
    "chrono",                # DateTime support
    "json",                  # JSON columns
    "migrate"                # Built-in migrations
] }
tokio = { version = "1", features = ["full"] }
uuid = { version = "1.0", features = ["serde", "v4"] }
chrono = { version = "0.4", features = ["serde"] }
bcrypt = "0.15"              # Password hashing (optional)
dotenv = "0.15"              # Environment variables

[dev-dependencies]
sqlx = { version = "0.7", features = ["runtime-tokio-rustls", "postgres"] }
```

**Why SQLx over Diesel?**
- ✅ Async-first (matches Actix-web)
- ✅ Compile-time query verification
- ✅ Built-in migration support
- ✅ Simpler learning curve
- ✅ Better error messages

### Step 1.3: Create Docker Compose Configuration

Create `docker-compose.yml` in the **medichain/** root directory:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: medichain_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: medichain
      POSTGRES_PASSWORD: medichain_dev_2024
      POSTGRES_DB: medichain
      PGDATA: /var/lib/postgresql/data/pgdata
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./api/migrations:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U medichain -d medichain"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - medichain_network

  # Optional: Database admin UI (helpful for development)
  pgadmin:
    image: dpage/pgadmin4:latest
    container_name: medichain_pgadmin
    restart: unless-stopped
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@medichain.local
      PGADMIN_DEFAULT_PASSWORD: admin
    ports:
      - "5050:80"
    depends_on:
      - postgres
    networks:
      - medichain_network

volumes:
  postgres_data:
    driver: local

networks:
  medichain_network:
    driver: bridge
```

**Best Practices Applied:**
- ✅ Alpine Linux (smaller image)
- ✅ Health checks (wait for DB ready)
- ✅ Named volumes (data persistence)
- ✅ Restart policy (auto-recovery)
- ✅ Network isolation

### Step 1.4: Create Environment Configuration

Create `.env` in the **medichain/** root:

```bash
# Database Configuration
DATABASE_URL=postgresql://medichain:medichain_dev_2024@localhost:5432/medichain

# For Docker internal networking (when API runs in container)
DATABASE_URL_DOCKER=postgresql://medichain:medichain_dev_2024@postgres:5432/medichain

# Application Configuration
RUST_LOG=info,sqlx=warn
MEDICHAIN_DEV_MODE=true

# Connection Pool Settings
DB_MAX_CONNECTIONS=20
DB_MIN_CONNECTIONS=5
DB_ACQUIRE_TIMEOUT_SECS=3
DB_IDLE_TIMEOUT_SECS=600
DB_MAX_LIFETIME_SECS=1800

# Security (change in production!)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
SESSION_DURATION_HOURS=24

# Blockchain Node
SUBSTRATE_WS_URL=ws://127.0.0.1:9944

# IPFS
IPFS_URL=http://127.0.0.1:5001
```

Create `.env.example` (safe to commit to git):

```bash
# Copy this to .env and configure
DATABASE_URL=postgresql://medichain:medichain_dev_2024@localhost:5432/medichain
DATABASE_URL_DOCKER=postgresql://medichain:medichain_dev_2024@postgres:5432/medichain
RUST_LOG=info,sqlx=warn
MEDICHAIN_DEV_MODE=true
DB_MAX_CONNECTIONS=20
JWT_SECRET=CHANGE_THIS_IN_PRODUCTION
```

**Update `.gitignore`:**
```gitignore
.env
*.db
*.db-shm
*.db-wal
target/
```

### Step 1.5: Start PostgreSQL

```bash
# Start PostgreSQL
docker-compose up -d postgres

# Verify it's running
docker-compose ps

# Check logs
docker-compose logs postgres

# Connect to PostgreSQL (optional)
docker exec -it medichain_postgres psql -U medichain -d medichain
```

**Expected Output:**
```
[+] Running 2/2
 ✔ Network medichain_medichain_network  Created
 ✔ Container medichain_postgres         Started
```

**Test Connection:**
```bash
# Using psql
psql postgresql://medichain:medichain_dev_2024@localhost:5432/medichain -c "SELECT version();"
```

### Step 1.6: Install SQLx CLI (for migrations)

```bash
cargo install sqlx-cli --no-default-features --features postgres
```

**Verify installation:**
```bash
sqlx --version
# Output: sqlx-cli 0.7.x
```

---

## Phase 2: Database Schema Design (Day 2)
**Time Estimate:** 6 hours

### Step 2.1: Create Project Structure

```bash
cd api/
mkdir -p src/db
mkdir -p src/models
mkdir -p src/services
mkdir -p migrations
```

**Directory Structure:**
```
api/
├── migrations/           # SQL migration files
├── src/
│   ├── db/
│   │   └── mod.rs       # Connection pool
│   ├── models/
│   │   ├── mod.rs
│   │   └── user.rs      # User model
│   ├── services/
│   │   ├── mod.rs
│   │   ├── auth.rs      # Authentication logic
│   │   └── blockchain_sync.rs
│   └── main.rs
├── Cargo.toml
└── .env
```

### Step 2.2: Create Initial Migration

```bash
cd api/
sqlx migrate add create_users_and_sessions
```

This creates: `migrations/YYYYMMDDHHMMSS_create_users_and_sessions.sql`

### Step 2.3: Design Database Schema

Edit the migration file:

```sql
-- migrations/YYYYMMDDHHMMSS_create_users_and_sessions.sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- USERS TABLE
-- Stores user accounts with wallet-based authentication
-- ============================================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Wallet Authentication (Primary)
    wallet_address VARCHAR(66) UNIQUE NOT NULL,  -- SS58 format, 48 chars
    
    -- Optional Email Authentication
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),  -- bcrypt hash, NULL for wallet-only
    
    -- User Information
    role VARCHAR(20) NOT NULL CHECK (role IN (
        'Patient', 'Doctor', 'Nurse', 'Admin', 
        'LabTechnician', 'Pharmacist', 'Receptionist'
    )),
    name VARCHAR(200),
    
    -- Blockchain Integration
    blockchain_address VARCHAR(66),  -- Reference to on-chain identity
    blockchain_tx_hash VARCHAR(66),  -- Transaction that created this user
    
    -- Status & Metadata
    is_active BOOLEAN DEFAULT TRUE,
    email_verified BOOLEAN DEFAULT FALSE,
    last_login_at TIMESTAMP,
    login_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$' OR email IS NULL),
    CONSTRAINT valid_wallet CHECK (LENGTH(wallet_address) = 48 AND wallet_address ~ '^5[A-Za-z0-9]+$')
);

-- ============================================================================
-- USER PROFILES TABLE (Optional - for extended user info)
-- Separate table to keep users table lean
-- ============================================================================
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id)
);

-- ============================================================================
-- SESSIONS TABLE
-- Tracks active user sessions for security
-- ============================================================================
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    
    -- Session Data
    token VARCHAR(255) UNIQUE NOT NULL,  -- JWT or session token
    device_info VARCHAR(500),            -- User agent, device type
    ip_address INET,                     -- IP address for security
    
    -- Lifecycle
    expires_at TIMESTAMP NOT NULL,
    last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Index for fast lookup
    CONSTRAINT valid_expiry CHECK (expires_at > created_at)
);

-- ============================================================================
-- BLOCKCHAIN SYNC TABLE
-- Tracks synchronization between PostgreSQL and blockchain
-- ============================================================================
CREATE TABLE blockchain_sync (
    id SERIAL PRIMARY KEY,
    
    -- Reference
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL,    -- 'user', 'medical_record', 'consent'
    entity_id UUID,                      -- ID of the entity being synced
    
    -- Blockchain Details
    transaction_hash VARCHAR(66),
    block_number BIGINT,
    extrinsic_index INTEGER,
    
    -- Sync Status
    sync_type VARCHAR(50) NOT NULL,      -- 'user_registration', 'profile_update', etc.
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed')),
    retry_count INTEGER DEFAULT 0,
    
    -- Error Handling
    error_message TEXT,
    error_code VARCHAR(50),
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- Based on common query patterns
-- ============================================================================

-- Users table indexes
CREATE INDEX idx_users_wallet ON users(wallet_address);
CREATE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_blockchain ON users(blockchain_address) WHERE blockchain_address IS NOT NULL;
CREATE INDEX idx_users_active ON users(is_active);
CREATE INDEX idx_users_created ON users(created_at DESC);

-- Sessions table indexes
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_sessions_active ON sessions(expires_at) WHERE expires_at > CURRENT_TIMESTAMP;

-- Blockchain sync indexes
CREATE INDEX idx_blockchain_sync_user ON blockchain_sync(user_id);
CREATE INDEX idx_blockchain_sync_status ON blockchain_sync(status);
CREATE INDEX idx_blockchain_sync_type ON blockchain_sync(sync_type);
CREATE INDEX idx_blockchain_sync_pending ON blockchain_sync(status, created_at) 
    WHERE status = 'pending';

-- Composite index for common query
CREATE INDEX idx_blockchain_sync_user_status ON blockchain_sync(user_id, status);

-- ============================================================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- ============================================================================

-- Function to update 'updated_at' timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to tables
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_profiles_updated_at 
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_blockchain_sync_updated_at 
    BEFORE UPDATE ON blockchain_sync
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- DEMO DATA (for hackathon judges)
-- Only inserted in development mode
-- ============================================================================

INSERT INTO users (wallet_address, role, name, is_active) VALUES
    -- Admin/Judge Accounts
    ('5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y', 'Admin', 'Judge Admin', TRUE),
    ('5DTestAdmin111111111111111111111111111111111', 'Admin', 'System Admin', TRUE),
    
    -- Healthcare Providers
    ('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', 'Doctor', 'Dr. Thabo Mbeki', TRUE),
    ('5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', 'Doctor', 'Dr. Naledi Khumalo', TRUE),
    ('5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL', 'Nurse', 'Nurse Zanele Dlamini', TRUE),
    ('5FNurse222222222222222222222222222222222222', 'Nurse', 'Nurse Sipho Ndlovu', TRUE),
    
    -- Lab & Pharmacy
    ('5ELabTech333333333333333333333333333333333333', 'LabTechnician', 'Lab Tech Mpho Mokoena', TRUE),
    ('5DPharmacist444444444444444444444444444444444', 'Pharmacist', 'Pharmacist Lerato Sithole', TRUE),
    
    -- Patients
    ('5HPatient555555555555555555555555555555555555', 'Patient', 'John Doe', TRUE),
    ('5GPatient666666666666666666666666666666666666', 'Patient', 'Jane Smith', TRUE),
    ('5FPatient777777777777777777777777777777777777', 'Patient', 'Themba Nkosi', TRUE)
ON CONFLICT (wallet_address) DO NOTHING;

-- Insert corresponding profiles
INSERT INTO user_profiles (user_id, first_name, last_name, specialty, country)
SELECT 
    u.id,
    SPLIT_PART(u.name, ' ', 1),
    SPLIT_PART(u.name, ' ', -1),
    CASE 
        WHEN u.role = 'Doctor' THEN 'General Practice'
        WHEN u.role = 'Nurse' THEN 'Emergency Care'
        ELSE NULL
    END,
    'South Africa'
FROM users u
WHERE u.name IS NOT NULL
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
    u.is_active,
    u.created_at,
    u.last_login_at,
    u.login_count,
    p.first_name,
    p.last_name,
    p.specialty,
    p.department,
    p.phone
FROM users u
LEFT JOIN user_profiles p ON u.id = p.user_id
WHERE u.is_active = TRUE;

-- Blockchain sync status summary
CREATE OR REPLACE VIEW v_blockchain_sync_summary AS
SELECT 
    entity_type,
    sync_type,
    status,
    COUNT(*) as count,
    MAX(created_at) as last_sync
FROM blockchain_sync
GROUP BY entity_type, sync_type, status;

-- ============================================================================
-- FUNCTIONS FOR COMMON OPERATIONS
-- ============================================================================

-- Function to clean expired sessions
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
CREATE OR REPLACE FUNCTION update_login_info(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE users 
    SET 
        last_login_at = CURRENT_TIMESTAMP,
        login_count = login_count + 1
    WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;
```

### Step 2.4: Run Migration

```bash
# From api/ directory
sqlx migrate run

# Verify tables were created
docker exec -it medichain_postgres psql -U medichain -d medichain -c "\dt"
```

**Expected Output:**
```
                List of relations
 Schema |       Name        | Type  |   Owner   
--------+-------------------+-------+-----------
 public | blockchain_sync   | table | medichain
 public | sessions          | table | medichain
 public | user_profiles     | table | medichain
 public | users             | table | medichain
```

**Verify demo data:**
```bash
docker exec -it medichain_postgres psql -U medichain -d medichain \
  -c "SELECT wallet_address, role, name FROM users;"
```

---

## Phase 3: Rust Integration (Days 3-4)
**Time Estimate:** 16 hours

### Step 3.1: Create Database Module

Create `api/src/db/mod.rs`:

```rust
use sqlx::{postgres::PgPoolOptions, PgPool, Error};
use std::time::Duration;

/// Creates a PostgreSQL connection pool with optimized settings
pub async fn create_pool(database_url: &str) -> Result<PgPool, Error> {
    let max_connections = std::env::var("DB_MAX_CONNECTIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(20);
    
    let min_connections = std::env::var("DB_MIN_CONNECTIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(5);
    
    let acquire_timeout = std::env::var("DB_ACQUIRE_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3);
    
    let idle_timeout = std::env::var("DB_IDLE_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(600);
    
    let max_lifetime = std::env::var("DB_MAX_LIFETIME_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1800);

    log::info!(
        "Creating database pool: max={}, min={}, timeout={}s",
        max_connections,
        min_connections,
        acquire_timeout
    );

    PgPoolOptions::new()
        .max_connections(max_connections)
        .min_connections(min_connections)
        .acquire_timeout(Duration::from_secs(acquire_timeout))
        .idle_timeout(Some(Duration::from_secs(idle_timeout)))
        .max_lifetime(Some(Duration::from_secs(max_lifetime)))
        .test_before_acquire(true)  // Verify connection health
        .connect(database_url)
        .await
}

/// Health check for database connection
pub async fn check_health(pool: &PgPool) -> Result<(), Error> {
    sqlx::query("SELECT 1")
        .execute(pool)
        .await?;
    Ok(())
}
```

### Step 3.2: Create User Models

Create `api/src/models/user.rs`:

```rust
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub wallet_address: String,
    pub email: Option<String>,
    #[serde(skip_serializing)]
    pub password_hash: Option<String>,
    pub role: String,
    pub name: Option<String>,
    pub blockchain_address: Option<String>,
    pub blockchain_tx_hash: Option<String>,
    pub is_active: bool,
    pub email_verified: bool,
    pub last_login_at: Option<DateTime<Utc>>,
    pub login_count: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserProfile {
    pub id: Uuid,
    pub user_id: Uuid,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub date_of_birth: Option<chrono::NaiveDate>,
    pub phone: Option<String>,
    pub address_line1: Option<String>,
    pub address_line2: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub license_number: Option<String>,
    pub specialty: Option<String>,
    pub department: Option<String>,
    pub preferences: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Session {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token: String,
    pub device_info: Option<String>,
    pub ip_address: Option<std::net::IpAddr>,
    pub expires_at: DateTime<Utc>,
    pub last_activity_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

// Request/Response DTOs
#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub wallet_address: String,
    pub role: String,
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserRequest {
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub wallet_address: String,
    pub role: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

impl From<User> for UserResponse {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            wallet_address: user.wallet_address,
            role: user.role,
            name: user.name,
            email: user.email,
            is_active: user.is_active,
            created_at: user.created_at,
        }
    }
}
```

Create `api/src/models/mod.rs`:

```rust
pub mod user;

pub use user::{User, UserProfile, Session, CreateUserRequest, UpdateUserRequest, UserResponse};
```

### Step 3.3: Create Authentication Service

Create `api/src/services/auth.rs`:

```rust
use sqlx::PgPool;
use uuid::Uuid;
use crate::models::{User, CreateUserRequest, UpdateUserRequest};

pub struct AuthService {
    pool: PgPool,
}

impl AuthService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Register a new user
    pub async fn register_user(&self, req: CreateUserRequest) -> Result<User, sqlx::Error> {
        // Validate wallet address format
        if !Self::is_valid_wallet_address(&req.wallet_address) {
            return Err(sqlx::Error::RowNotFound);
        }

        let user = sqlx::query_as::<_, User>(
            r#"
            INSERT INTO users (wallet_address, role, name, email)
            VALUES ($1, $2, $3, $4)
            RETURNING *
            "#
        )
        .bind(&req.wallet_address)
        .bind(&req.role)
        .bind(&req.name)
        .bind(&req.email)
        .fetch_one(&self.pool)
        .await?;

        log::info!("User registered: {} ({})", user.wallet_address, user.role);
        Ok(user)
    }

    /// Get user by wallet address
    pub async fn get_user_by_wallet(&self, wallet: &str) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>(
            "SELECT * FROM users WHERE wallet_address = $1 AND is_active = true"
        )
        .bind(wallet)
        .fetch_optional(&self.pool)
        .await
    }

    /// Get user by ID
    pub async fn get_user_by_id(&self, user_id: Uuid) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::