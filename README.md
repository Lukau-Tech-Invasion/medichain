# MediChain 🏥

**Blockchain-Based National Health ID & Emergency Medical Records System**

[![Rust](https://img.shields.io/badge/Rust-1.75+-orange.svg)](https://www.rust-lang.org/)
[![Substrate](https://img.shields.io/badge/Substrate-38.0-blue.svg)](https://substrate.io/)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)
[![Hackathon](https://img.shields.io/badge/Rust%20Africa%20Hackathon-2026-green.svg)](https://rustafrica.dev)

> **Track:** Fintech & Inclusive Finance (Web3)  
> **Team:** Trustware  
> **Event:** Rust Africa Hackathon 2026 (January 4-18)

© 2025 Trustware. All rights reserved.

---

## 🎯 Problem Statement

In Africa, millions lack accessible medical records during emergencies. First responders often have no patient history, leading to delayed treatment, medication errors, and preventable deaths. Traditional paper-based systems are easily lost, damaged, or inaccessible across healthcare facilities.

## 💡 Solution

MediChain provides a **blockchain-verified national health ID** with **NFC/QR emergency access**. Healthcare providers can instantly access critical patient information (blood type, allergies, conditions, medications) during emergencies, while patients maintain full control over who accesses their complete medical history.

---

## ✨ Key Features

### 🔐 Security & Privacy
- **Role-Based Access Control (RBAC)** - Blockchain-enforced permissions
- **End-to-End Encryption** - ChaCha20-Poly1305 for medical documents
- **Immutable Audit Trail** - Every access logged on blockchain
- **Patient Consent Management** - Granular access control

### 🆔 Identity & Access
- **National Health ID** - Unique identifier (MCHI-XXXX-XXXX format)
- **NFC Card Simulation** - Tap-to-access emergency info
- **QR Code Backup** - Works when NFC unavailable
- **Emergency Access** - Time-limited, reason-logged access

### 📋 Medical Records
- **IPFS Storage** - Decentralized, encrypted document storage
- **Blockchain Verification** - Tamper-proof record integrity
- **Multi-Format Support** - Lab results, imaging, prescriptions
- **Cross-Facility Access** - Nationwide health record portability

### 🌍 Africa-Focused
- **National ID Integration** - Fayda (Ethiopia), Ghana Card, NIN (Nigeria), etc.
- **Multilingual Support** - English, Swahili, Amharic, Hausa, Yoruba, Zulu
- **Offline-First Design** - Works in low-connectivity areas
- **Low-Resource Optimized** - Minimal data requirements

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENT LAYER                            │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │  Doctor Portal  │  │  Patient App    │                   │
│  │  (React/Vite)   │  │  (React/Vite)   │                   │
│  │  Port: 5173     │  │  Port: 5174     │                   │
│  └─────────────────┘  └─────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      API LAYER                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Actix-web REST API (Port: 8080)            ││
│  │  • RBAC Authentication    • Rate Limiting               ││
│  │  • IPFS Integration       • NFC Simulation              ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   BLOCKCHAIN LAYER                           │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Substrate Runtime (PoA)                    ││
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐    ││
│  │  │Access Control│ │Patient       │ │Medical       │    ││
│  │  │Pallet        │ │Identity      │ │Records       │    ││
│  │  └──────────────┘ └──────────────┘ └──────────────┘    ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    STORAGE LAYER                             │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │  RocksDB        │  │  IPFS           │                   │
│  │  (Blockchain)   │  │  (Documents)    │                   │
│  └─────────────────┘  └─────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- **Rust 1.75+** with `wasm32-unknown-unknown` target
- **Node.js 18+** with npm or yarn
- **IPFS** (optional, for document storage)

### 1. Clone & Setup

```bash
git clone https://github.com/trustware/medichain.git
cd medichain

# Run setup script (installs Rust toolchain, dependencies)
./scripts/setup.sh
```

### 2. Build

```bash
# Build all Rust components
cargo build --workspace --release

# Build blockchain node
cd node && cargo build --release

# Build API server
cd ../api && cargo build --release
```

### 3. Run API Server

```bash
cd api
cargo run --release

# Server starts on http://localhost:8080
# Demo endpoint: http://localhost:8080/api/demo
```

### 4. Run Frontend Apps

```bash
# Terminal 1: Doctor Portal
cd client/doctor-portal
npm install
npm run dev
# Opens on http://localhost:5173

# Terminal 2: Patient App
cd client/patient-app
npm install
npm run dev
# Opens on http://localhost:5174
```

---

## 🔑 Authentication

### Wallet-Based Blockchain Authentication

MediChain uses **wallet-based blockchain authentication** with SS58 addresses. Users authenticate using their blockchain wallet credentials.

**Authentication Flow:**
1. User connects blockchain wallet (Polkadot.js, SubWallet, etc.)
2. Wallet signs authentication challenge
3. Server verifies signature and extracts SS58 address
4. Address is used as `X-User-Id` header for API requests

**Example:**
```bash
curl -H "X-User-Id: 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" \
     http://localhost:8080/api/patients
```

> **Note:** Legacy demo user IDs (e.g., `DOC-001`, `ADMIN-001`) are deprecated. Register users via the blockchain with their wallet addresses.

---

## 📚 API Endpoints

### Core Endpoints

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| GET | `/health` | No | API health check |
| GET | `/api/demo` | No | Demo information |
| POST | `/api/register` | Healthcare Provider | Register new patient |
| PUT | `/api/patients/{id}` | Doctor/Nurse/Admin | Update patient info |
| GET | `/api/my-records` | Patient | View own records |
| POST | `/api/emergency-access` | Healthcare Provider | Emergency access request |

### NFC/QR Endpoints

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| POST | `/api/nfc/generate` | Healthcare Provider | Generate NFC card |
| POST | `/api/nfc/tap` | Healthcare Provider | Simulate NFC tap |
| POST | `/api/nfc/verify-qr` | Healthcare Provider | Verify QR code |
| GET | `/api/nfc/card/{patient}` | Healthcare/Patient | Get card info |

### IPFS Medical Records

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| GET | `/api/ipfs/health` | No | IPFS connection status |
| POST | `/api/records/upload` | Doctor/Nurse/Admin | Upload encrypted record |
| POST | `/api/records/download` | Healthcare/Patient | Download decrypted record |
| GET | `/api/records/{patient}` | Healthcare/Patient | List patient records |

### Role Management

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| POST | `/api/roles/assign` | Admin | Assign role to user |
| DELETE | `/api/roles/revoke` | Admin | Revoke user role |
| GET | `/api/users` | Admin | List all users |

---

## 🧪 Testing

```bash
# Run all tests
./scripts/test-all.sh

# Or individually:
cargo fmt --all -- --check          # Format check
cargo clippy --all-targets -- -D warnings  # Linting
cargo test --all-features           # Unit tests
cargo audit                         # Security audit
cargo deny check                    # License check
cargo tarpaulin --workspace         # Code coverage
```

---

## 📁 Project Structure

```
medichain/
├── api/                    # REST API server (Actix-web)
│   └── src/
│       ├── main.rs         # Core API endpoints, RBAC
│       ├── clinical_endpoints.rs  # 150+ clinical endpoints
│       ├── clinical.rs     # Clinical types (7,500+ lines)
│       ├── ipfs.rs         # IPFS integration
│       └── nfc_simulator.rs # NFC card simulation
├── client/
│   ├── doctor-portal/      # Healthcare provider web app
│   │   └── src/pages/      # 72 pages (Emergency, Nursing, Surgical, etc.)
│   ├── patient-app/        # Patient mobile-first web app
│   │   └── src/pages/      # 23 pages (Dashboard, Records, Telehealth, etc.)
│   └── shared/             # Shared components & API client (1,577 lines)
├── crypto/                 # Cryptographic primitives
├── docs/                   # Documentation
│   ├── api.md              # API reference
│   ├── architecture.md     # System architecture
│   └── security.md         # Security documentation
├── node/                   # Substrate blockchain node
├── pallets/                # Substrate pallets
│   ├── access-control/     # RBAC pallet
│   ├── medical-records/    # Health records pallet
│   └── patient-identity/   # Patient registration pallet
├── runtime/                # Substrate runtime
├── scripts/                # Build & deployment scripts
└── tests/                  # Integration & E2E tests
```

---

## 🔒 Security

MediChain follows **NASA Power of 10 Rules** for safety-critical software:

1. ✅ Simple control flow (no recursion)
2. ✅ Fixed upper bounds on loops
3. ✅ No dynamic memory after initialization
4. ✅ Functions ≤60 lines
5. ✅ ≥2 assertions per function
6. ✅ Minimal variable scope
7. ✅ All return values checked
8. ✅ Limited preprocessor/macros
9. ✅ Limited pointer use
10. ✅ Maximum static analysis (clippy -D warnings)

### Cryptographic Standards

| Purpose | Algorithm | Key Size |
|---------|-----------|----------|
| Hashing | SHA-256 / Blake2 | 256 bits |
| Signing | Ed25519 | 256 bits |
| Encryption | ChaCha20-Poly1305 | 256 bits |
| Key Derivation | Argon2id | Variable |

---

## 🌍 Compliance

- **HIPAA** - Access controls, audit logs, minimum necessary access
- **GDPR** - Data minimization, right to access, accountability
- **Africa Data Protection** - Aligned with AU Convention on Cyber Security

---

## 📜 License

**Proprietary** - © 2025 Trustware. All rights reserved.

This software is developed for the Rust Africa Hackathon 2026 and is the intellectual property of Trustware. Unauthorized copying, modification, or distribution is prohibited.

---

## 👥 Team

**Trustware** - Building trust through technology

---

## 🔗 Links

- **Demo:** [Coming Soon]
- **Documentation:** [docs/](docs/)
- **API Reference:** [docs/api.md](docs/api.md)
- **Architecture:** [docs/architecture.md](docs/architecture.md)

---

<p align="center">
  <strong>🏥 MediChain - Saving Lives Through Secure Health Data 🚑</strong><br>
  <em>Built with ❤️ in Africa, for Africa</em>
</p>
