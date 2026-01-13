# MediChain Server Startup Guide

## Quick Start

### Option 1: From Ubuntu Terminal (Recommended)
1. Open **Ubuntu-22.04** from Windows Start Menu
2. Enter your Ubuntu password if prompted
3. Run:
   ```bash
   cd "/mnt/c/Users/Admin/OneDrive/Documents/New folder/MEDICHAIN DEVELOPMENT/medichain"
   ./target/release/medichain-api
   ```

### Option 2: Using the Shell Script
1. Open **Ubuntu-22.04** terminal
2. Run:
   ```bash
   cd "/mnt/c/Users/Admin/OneDrive/Documents/New folder/MEDICHAIN DEVELOPMENT/medichain"
   chmod +x start-server.sh
   ./start-server.sh
   ```

### Option 3: From PowerShell (if Ubuntu session is already active)
```powershell
.\start-server.ps1
```

---

## Server Endpoints

Once running, the server is available at:

| Endpoint | URL |
|----------|-----|
| **API Base** | http://127.0.0.1:8080 |
| **Health Check** | http://127.0.0.1:8080/health |
| **Demo Data** | http://127.0.0.1:8080/api/demo |

---

## Frontend Apps

After the API server is running, start the frontends:

### Doctor Portal (Port 5173)
```bash
cd client/doctor-portal
npm install
npm run dev
```

### Patient App (Port 5174)
```bash
cd client/patient-app
npm install
npm run dev
```

---

## Troubleshooting

### "Permission denied" error
```bash
chmod +x ./target/release/medichain-api
chmod +x ./start-server.sh
```

### WSL not finding Ubuntu
Check available distributions:
```powershell
wsl --list
```

### Port already in use
Kill existing process:
```bash
lsof -ti:8080 | xargs kill -9
```

---

## Authentication

MediChain uses **wallet-based blockchain authentication** with SS58 addresses. 

Users authenticate by connecting their blockchain wallet and signing an authentication challenge. The wallet's SS58 address is then used as the user identifier for all API requests.

**Example API Request:**
```bash
curl -H "X-User-Id: 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" \
     localhost:8080/api/patients
```

> **Note:** Legacy demo user IDs are deprecated. Register new users via the blockchain with their wallet addresses.

---

© 2025 Trustware. All rights reserved.
