# PostgreSQL Setup for MediChain

This guide explains how to set up persistent demo users using PostgreSQL for your hackathon submission.

## 🎯 Why PostgreSQL?

Without a database, the API uses **in-memory storage**. This means:
- ❌ All users and data are lost when the server restarts
- ❌ Judges have to re-create demo accounts each time
- ❌ Testing workflow is tedious and error-prone

With PostgreSQL:
- ✅ **12 pre-configured demo users** persist across restarts
- ✅ Judges can immediately test with real accounts
- ✅ Professional-grade infrastructure for hackathon demo

---

## 🚀 Quick Start (One Command)

For the fastest setup, use the quick-start script:

```batch
quick-start.bat
```

This automatically:
1. Starts PostgreSQL in Docker
2. Waits for the database to be ready
3. Starts the API server with demo users

---

## 🐳 Manual Setup (Docker)

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running

### Step 1: Start PostgreSQL
```bash
cd medichain
docker compose up -d postgres
```

This starts:
- **PostgreSQL 16** on port 5432
- **pgAdmin** on port 5050 (optional web UI)

### Step 2: Verify Database
```bash
docker compose ps
# Service should show "running"
```

### Step 3: Start the API
```bash
cd api
cargo run
```

You should see:
```
  🗄️  Connecting to PostgreSQL database...
  ✅ Database connection established
  📋 Running database migrations...
  ✅ Migrations completed
  👥 Loading demo users from database...
  ✅ Loaded 12 demo users
  🚀 Server ready!
```

---

## 🧪 Verify Setup

Run the integration test to verify everything works:

```bash
./scripts/test-postgres-integration.sh
```

Or use curl to test manually:
```bash
# Health check
curl http://localhost:8080/health

# Database health
curl http://localhost:8080/health/db

# List users (as admin)
curl -H "X-User-Id: 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" http://localhost:8080/api/users
```

---

## � Configuration

### Environment Variables (.env)

```bash
# Database Connection
DATABASE_URL=postgresql://medichain:medichain_dev_2024@localhost:5432/medichain

# Connection Pool Settings
DB_MAX_CONNECTIONS=20
DB_MIN_CONNECTIONS=5
DB_ACQUIRE_TIMEOUT_SECS=3
DB_IDLE_TIMEOUT_SECS=600
DB_MAX_LIFETIME_SECS=1800

# Connection Retry (for Docker startup timing)
DB_MAX_RETRIES=5

# API Settings
PORT=8080
HOST=127.0.0.1
RUST_LOG=info

# Security
JWT_SECRET=your-super-secret-key-change-in-production
```

### Fallback Mode

If `DATABASE_URL` is not set, the API runs in **in-memory mode**:
```
  ℹ️  No DATABASE_URL set - using in-memory storage
       Set DATABASE_URL for persistent demo users
```

---

## 📊 Database Management

### pgAdmin Web Interface
1. Open http://localhost:5050
2. Login: `admin@medichain.local` / `admin`
3. Add Server:
   - Host: `postgres` (container name)
   - Port: `5432`
   - Database: `medichain`
   - Username: `medichain`
   - Password: `medichain_dev_2024`

### Direct PostgreSQL Access
```bash
# Connect to database
docker compose exec postgres psql -U medichain -d medichain

# List users
SELECT wallet_address, username, role, name FROM users;

# Check user count
SELECT role, COUNT(*) FROM users GROUP BY role;
```

### View Active Sessions
```bash
docker compose exec postgres psql -U medichain -d medichain -c "SELECT * FROM v_active_users;"
```

---

## 🔄 Commands Reference

### Docker Commands
```bash
# Start services
docker compose up -d

# Stop services
docker compose down

# View logs
docker compose logs -f

# Reset database (deletes all data)
docker compose down -v
docker compose up -d
```

### API Health Check
```bash
# Basic health
curl http://localhost:8080/health

# Database health (shows connection status and user count)
curl http://localhost:8080/health/db
```

Expected response:
```json
{
  "status": "healthy",
  "database_connected": true,
  "users_loaded": 12,
  "demo_users_available": true,
  "message": "PostgreSQL connected - demo users persist across restarts"
}
```

---

## 🔐 Testing with Demo Users

### Using curl
```bash
# Login as admin
curl -X GET http://localhost:8080/api/auth/me \
  -H "X-User-Id: 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"

# Login as doctor
curl -X GET http://localhost:8080/api/auth/me \
  -H "X-User-Id: 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"

# List all users (as admin)
curl http://localhost:8080/api/users \
  -H "X-User-Id: 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
```

### Using the Doctor Portal
1. Start frontend: `cd client/doctor-portal && npm run dev`
2. Open http://localhost:5173
3. Enter wallet address: `5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty`
4. Access doctor dashboard with full functionality

---

## 🐛 Troubleshooting

### "Connection refused" Error
```bash
# Check if PostgreSQL is running
docker compose ps

# If not running, start it
docker compose up -d

# Wait for healthy status
docker ps --filter "name=medichain_postgres" --format "{{.Status}}"
# Should show: "Up X seconds (healthy)"
```

### "Database does not exist" Error
```bash
# Reset everything
docker compose down -v
docker compose up -d
```

### "Pool timed out" Error
The API has automatic retry logic with exponential backoff. If you see this:
```
Database connection attempt 1 failed: pool timed out...
```
This is normal during startup - the API will retry up to 5 times. If it continues to fail:

```bash
# Check database is accessible
docker exec medichain_postgres psql -U medichain -d medichain -c "SELECT 1"
```

### Migrations Fail
```bash
# Check migration status
docker compose exec postgres psql -U medichain -d medichain \
  -c "SELECT * FROM _sqlx_migrations ORDER BY installed_on;"

# Force re-run (WARNING: drops all data)
docker compose down -v
docker compose up -d
```

### WSL Users (Windows)
If running the API in WSL with Docker on Windows:

1. **Docker Desktop Settings:**
   - Docker Desktop → Settings → Resources → WSL Integration
   - Enable integration with your distro (e.g., Ubuntu-22.04)

2. **Use `localhost` for DATABASE_URL:**
   ```bash
   # Correct - WSL can reach Docker via localhost
   DATABASE_URL='postgresql://medichain:medichain_dev_2024@localhost:5432/medichain'
   
   # Wrong - 172.17.0.1 is not reachable from WSL
   # DATABASE_URL='postgresql://medichain:medichain_dev_2024@172.17.0.1:5432/medichain'
   ```

3. **Start API from WSL:**
   ```bash
   wsl -d Ubuntu-22.04 -- bash -c "cd '/path/to/medichain' && \
     DATABASE_URL='postgresql://medichain:medichain_dev_2024@localhost:5432/medichain' \
     ./target/release/medichain-api"
   ```

---

## 📁 File Structure

```
medichain/
├── docker-compose.yml          # PostgreSQL + pgAdmin containers
├── .env                        # Database credentials (not in git)
├── .env.example                # Template for .env
├── POSTGRES_SETUP.md           # This file
└── api/
    ├── src/
    │   ├── db/                 # Database connection pool
    │   ├── models/             # Database models (DbUser, etc.)
    │   └── services/           # User service with CRUD operations
    └── migrations/
        └── 20240121000001_initial_schema.sql  # Schema + demo data
```

---

## ✅ Verification Checklist

Before submitting for judging:

- [ ] `docker compose up -d` shows both services running
- [ ] `curl http://localhost:8080/health/db` shows `database_connected: true`
- [ ] `users_loaded: 12` in health check response
- [ ] Can login with admin wallet: `5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY`
- [ ] Doctor portal shows user info after login
- [ ] Server restart preserves all users

---

© 2025 Trustware. Rust Africa Hackathon 2026
