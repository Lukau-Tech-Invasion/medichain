# MediChain 🏥

**Blockchain-Based National Health ID & Emergency Medical Records System**

[![Rust](https://img.shields.io/badge/Rust-1.75+-orange.svg)](https://www.rust-lang.org/)
[![Substrate](https://img.shields.io/badge/Substrate-38.0-blue.svg)](https://substrate.io/)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)
[![Hackathon](https://img.shields.io/badge/Rust%20Africa%20Hackathon-2026-green.svg)](https://rustafrica.dev)

**#RustAfricaHackathon**

> **Team:** Trustware (Keorapetswe Kgoatlha)  
> **Origin:** Rust Africa Hackathon 2026 (1st-place submission) — now evolving toward production.

© 2025 Trustware. All rights reserved.

---

## 🎯 Problem Statement

In Africa, millions lack accessible medical records during emergencies. First responders often have no patient history, leading to delayed treatment, medication errors, and preventable deaths. Traditional paper-based systems are easily lost, damaged, or inaccessible across healthcare facilities.

## 💡 Solution

MediChain provides a **blockchain-verified national health ID** with **NFC/QR emergency access**. Healthcare providers can instantly access critical patient information (blood type, allergies, conditions, medications) during emergencies, while patients maintain full control over who accesses their complete medical history.

---

## ✨ Key Features

### 🔐 Security & Privacy
- **Role-Based Access Control (RBAC)** — 6 roles: Admin, Doctor, Nurse, LabTechnician, Pharmacist, Patient
- **End-to-End Encryption** — ChaCha20-Poly1305 (256-bit) for all medical documents
- **Immutable Audit Trail** — Every access logged on blockchain with timestamps
- **Patient Consent Management** — Granular time-limited access grants
- **Signature Authentication** — Optional wallet signature verification (SEC-005)

### 🆔 Identity & Access
- **National Health ID** — Unique identifier format: `MCHI-XXXX-XXXX`
- **NFC Card Simulation** — Tap-to-access emergency info with SHA3-256 verification
- **QR Code Backup** — Base64-encoded emergency data when NFC unavailable
- **Emergency Access** — Time-limited (default 150 blocks ≈ 15 min), reason-logged access

### 📋 Medical Records (306 API Endpoints)
- **IPFS Storage** — Encrypted document storage with max 10MB per file
- **Blockchain Verification** — IPFS hash stored on-chain for tamper-proof integrity
- **Clinical Documentation** — 50+ medical record types across 35 phases
- **HL7 FHIR R4** — 10 FHIR resources (Patient, Observation, DiagnosticReport, etc.)

### 🌍 Africa-Focused
- **National ID Integration** — Fayda (Ethiopia), Ghana Card, NIN (Nigeria), Smart ID (South Africa), Huduma Namba (Kenya)
- **Multilingual Support** — English, Swahili, Amharic, Hausa, Yoruba, Zulu + translation API
- **Offline-First Design** — Sync queue and offline data download endpoints
- **Low-Resource Optimized** — Minimal data requirements, works on 2G networks

---

## 📊 Project Status

> Updated 2026-06-04. MediChain has progressed well past the hackathon prototype. The
> table below reflects what is **actually implemented and verified** in the codebase
> today. Remaining work is tracked in [`docs/NEXT_WEEK_TODO.md`](docs/NEXT_WEEK_TODO.md)
> and [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

### ✅ Implemented & working

| Area | Status |
|------|--------|
| **Blockchain** | Real `subxt` extrinsic submission (register patient, IPFS hash, emergency access); Substrate node + chain specs; `@polkadot/extension-dapp` wallet sign-in |
| **Persistence** | Dual storage (in-memory default + PostgreSQL via `MEDICHAIN_STORAGE=postgres`); 70+ tables; clinical domains migrated to repositories |
| **Authentication** | JWT (HS256 access 1h + refresh 7d) over wallet challenge-response, with `X-User-Id` legacy/demo fallback; **TOTP MFA** (RFC-6238) for ePHI step-up (HIPAA 2025) |
| **Real-time** | SSE (`/api/events`) wired into **both** apps (toasts, badges, live telehealth status) |
| **Offline** | IndexedDB read cache, offline write queue + sync-on-reconnect, last-write-wins conflict resolution UI |
| **Telehealth** | Jitsi JWT rooms, in-browser video (doctor + patient), recording w/ consent + audit, transcription hook, in-app mobile QR/redirect, self-host stack |
| **Clinical logic** | Drug-interaction screening (blocks contraindicated Rx), multi-symptom checker w/ ICD-10 + red-flags, 15+ CDS rules with alert-fatigue suppression |
| **Storage/crypto** | ChaCha20-Poly1305 encrypted IPFS, Argon2id KDF, SHA3-256 NFC hashing |
| **Security hardening** | TOCTOU-safe emergency access, incident-response playbook + breach detection, secrets gate, supply-chain (`cargo-deny` + SBOM) |
| **API design** | `/api/v1` versioning, idempotency keys, cursor pagination, canonical error envelope |
| **Observability** | Prometheus `/api/metrics`, structured JSON logging, Grafana dashboard + alert rules |
| **Transport** | TLS termination via Caddy reverse proxy + HSTS/security headers |
| **i18n** | Provider + language switcher + 4 locales (English, Swahili, Amharic, French) |
| **Testing** | Vitest unit/component + Playwright E2E (frontend); integration + property tests (backend); pre-commit hooks; CI/CD |

### 🔭 In progress / planned

See [`docs/NEXT_WEEK_TODO.md`](docs/NEXT_WEEK_TODO.md). Highlights: full i18n string extraction
across all pages, FCM push, remaining PostgreSQL round-trip fidelity, module-split &
dead-code cleanup, and a multi-agent codebase-cleanup pass.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                              │
│  ┌───────────────────┐    ┌───────────────────┐                 │
│  │   Doctor Portal   │    │    Patient App    │                 │
│  │   (React/Vite)    │    │   (React/Vite)    │                 │
│  │   74 pages        │    │   23 pages        │                 │
│  │   Port: 5173      │    │   Port: 5174      │                 │
│  └───────────────────┘    └───────────────────┘                 │
│                │                    │                            │
│                └──────┬─────────────┘                            │
│                       ▼                                          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                  Shared Library                             ││
│  │  • API Client (1,748 lines)  • TypeScript Types             ││
│  │  • Auth Store (Zustand)      • i18n Support                 ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API LAYER                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Actix-web REST API (Port: 8080)                ││
│  │                                                              ││
│  │  Core Modules:                                               ││
│  │  • main.rs (8,078 lines) — 67 endpoints                     ││
│  │  • clinical_endpoints.rs (16,405 lines) — 239 endpoints     ││
│  │  • clinical.rs (7,500+ lines) — 50+ medical types           ││
│  │  • ipfs.rs — Encrypted IPFS client                          ││
│  │  • nfc_simulator.rs — NFC card simulation                   ││
│  │                                                              ││
│  │  Middleware:                                                 ││
│  │  • Rate Limiting       • CORS (configurable)                ││
│  │  • Signature Auth      • Error Handling                     ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│  ┌─────────────────┐         │                                   │
│  │   PostgreSQL    │◄────────┘ (Optional — persistent storage)  │
│  │   Indexer       │           DATABASE_URL env var             │
│  └─────────────────┘                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      BLOCKCHAIN LAYER                            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │               Substrate Runtime (PoA Consensus)             ││
│  │                                                              ││
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ ││
│  │  │ Access Control  │  │ Patient Identity│  │Medical Records│ ││
│  │  │     Pallet      │  │     Pallet      │  │    Pallet    │ ││
│  │  │                 │  │                 │  │              │ ││
│  │  │ • 6 Roles       │  │ • National ID   │  │ • IPFS Hash  │ ││
│  │  │ • Access Grants │  │ • DNR Status    │  │ • Alerts     │ ││
│  │  │ • Audit Logs    │  │ • Organ Donor   │  │ • Blood Type │ ││
│  │  └─────────────────┘  └─────────────────┘  └──────────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       STORAGE LAYER                              │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │    RocksDB      │    │      IPFS       │                     │
│  │  (Blockchain    │    │  (Encrypted     │                     │
│  │   State)        │    │   Documents)    │                     │
│  └─────────────────┘    └─────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| **Rust** | 1.75+ | API server, blockchain pallets |
| **Node.js** | 18+ | Frontend apps |
| **PostgreSQL** | 14+ | Optional persistent storage |
| **IPFS** | Latest | Optional document storage |

### 1. Clone & Build

```bash
git clone https://github.com/trustware/medichain.git
cd medichain

# Build API server
cd api && cargo build --release
```

### 2. Run API Server

```bash
# Without PostgreSQL (in-memory storage)
cd api && cargo run --release

# With PostgreSQL (persistent storage)
export DATABASE_URL="postgres://user:pass@localhost/medichain"
cd api && cargo run --release
```

The server starts on **http://localhost:8080** and displays available endpoints.

### 3. Run Frontend Apps

```bash
# Terminal 1: Doctor Portal (http://localhost:5173)
cd client/doctor-portal
npm install && npm run dev

# Terminal 2: Patient App (http://localhost:5174)
cd client/patient-app
npm install && npm run dev
```

### Windows Quick Start

```powershell
# Run the API server via WSL
.\run-api.bat

# Or use PowerShell directly
.\start-server.ps1
```

---

## 🔑 Authentication

### Wallet-Based Authentication + JWT (Production)

MediChain authenticates with **SS58 wallet addresses** (48 characters starting with "5")
via a challenge-response that issues **JWT** tokens. **TOTP MFA** adds a second factor for
sensitive ePHI operations (HIPAA 2025).

```
Authentication Flow:
1. Frontend requests challenge → POST /api/auth/challenge
2. Wallet signs the challenge message
3. Submit signature → POST /api/auth/jwt  → { access_token (1h), refresh_token (7d) }
4. All API requests send  Authorization: Bearer <access_token>
   (the client auto-refreshes once on a 401 via POST /api/auth/jwt/refresh)
5. Step-up: POST /api/auth/mfa/challenge issues an mfa=true token for gated actions
```

> Legacy/demo clients may still send `X-User-Id: <wallet>` instead of a Bearer token —
> the backend accepts either, preferring a verified JWT.

**API Request Example:**
```bash
curl -H "Authorization: Bearer <jwt>" http://localhost:8080/api/patients
# or (demo/legacy):
curl -H "X-User-Id: 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" \
     http://localhost:8080/api/patients
```

### Demo Mode (Development)

For testing, use demo login:
```bash
# Create demo user
curl -X POST http://localhost:8080/api/auth/demo-login \
  -H "Content-Type: application/json" \
  -d '{"role": "Doctor", "name": "Dr. Demo"}'
```

---

## 📚 API Endpoints (306 Total)

### Core Endpoints (67 in main.rs)

| Category | Endpoints | Description |
|----------|-----------|-------------|
| **Health** | `/health`, `/health/db`, `/api/health/detailed` | System health checks |
| **Auth** | `/api/auth/challenge`, `/api/auth/login`, `/api/auth/register` | Wallet authentication |
| **Patients** | `/api/register`, `/api/patients`, `/api/patients/{id}` | Patient management |
| **Emergency** | `/api/emergency-access`, `/api/simulate-nfc-tap` | Emergency access flow |
| **NFC/QR** | `/api/nfc/generate`, `/api/nfc/tap`, `/api/nfc/verify-qr` | Card simulation |
| **IPFS** | `/api/records/upload`, `/api/records/download` | Encrypted document storage |
| **Roles** | `/api/roles/assign`, `/api/roles/revoke` | RBAC management |
| **Lab** | `/api/lab/submit`, `/api/lab/pending`, `/api/lab/review` | Lab workflow |

### Clinical Endpoints (239 in clinical_endpoints.rs)

| Phase | Category | Example Endpoints |
|-------|----------|-------------------|
| 1 | **Basic Clinical** | Triage (ESI), SOAP notes, SAMPLE history, GCS, Vitals |
| 2 | **Emergency Protocols** | Code Blue, Trauma, Stroke (NIHSS), Sepsis (qSOFA), EMS Handoff |
| 3 | **Nursing Documentation** | MAR, I/O records, Care Plans, Wound Assessment, Shift Handoff |
| 4 | **Specialty Emergency** | Burns, Psychiatric, Toxicology, Mass Casualty (MCI) |
| 5 | **Procedures** | Intubation, Laceration Repair, Splint/Cast |
| 6 | **Pediatric/Obstetric** | Pediatric Assessment, Obstetric Emergency |
| 7 | **Laboratory** | Specimen Collection, Chain of Custody, Lab QC, Critical Values |
| 8 | **Physician Documentation** | Orders, Discharge Summary, H&P, Consults, Progress Notes |
| 9 | **Surgical** | Pre-Op, Operative Note, Post-Op |
| 10 | **Anesthesia** | Anesthesia Record |
| 11-12 | **Radiology/Pathology** | Orders, Reports |
| 13-15 | **Immunization/Blood Bank** | Records, Transfusions |
| 16-17 | **E-Prescribing** | Electronic Prescriptions, Appointments |
| 18-19 | **Death/Satisfaction** | Death Certificates, Autopsy, Surveys |
| 20-24 | **Patient Engagement** | Medication Reminders, Drug Interactions, Family Accounts, Wearables |
| 25-26 | **AI/Telehealth** | Symptom Checker, Telehealth Sessions |
| 27-28 | **Clinical Decision** | CDS Alerts, Lab Trends |
| 29-31 | **Insurance/Analytics** | Claims, Eligibility, Dashboard Metrics |
| 32-35 | **Infrastructure** | Multi-language, Offline Sync, List/Queue endpoints |

### HL7 FHIR R4 Endpoints

| Resource | Endpoint |
|----------|----------|
| Patient | `GET /api/fhir/r4/Patient/{id}` |
| AllergyIntolerance | `GET /api/fhir/r4/AllergyIntolerance?patient={id}` |
| MedicationStatement | `GET /api/fhir/r4/MedicationStatement?patient={id}` |
| Condition | `GET /api/fhir/r4/Condition?patient={id}` |
| Observation | `GET /api/fhir/r4/Observation?patient={id}` |
| Encounter | `GET /api/fhir/r4/Encounter?patient={id}` |
| DiagnosticReport | `GET /api/fhir/r4/DiagnosticReport?patient={id}` |
| Procedure | `GET /api/fhir/r4/Procedure?patient={id}` |
| Immunization | `GET /api/fhir/r4/Immunization?patient={id}` |
| CapabilityStatement | `GET /api/fhir/r4/metadata` |

### Dashboard Endpoints (Role-Based)

| Role | Endpoint | Data Provided |
|------|----------|---------------|
| Patient | `/api/dashboard/patient` | Health summary, appointments, medications |
| Doctor | `/api/dashboard/doctor` | Patient list, pending labs, orders |
| Nurse | `/api/dashboard/nurse` | Tasks, vital signs due, MAR |
| Lab Tech | `/api/dashboard/lab` | Queue, QC status, critical values |
| Pharmacist | `/api/dashboard/pharmacist` | Rx queue, drug alerts |
| Admin | `/api/dashboard/admin` | System metrics, user management |

---

## 🔐 Role-Based Access Control (RBAC)

### Roles & Permissions

| Role | Can Register Patients | Can Edit Records | Can View Records | Can Assign Roles |
|------|----------------------|------------------|------------------|------------------|
| **Admin** | ✅ | ✅ | ✅ | ✅ |
| **Doctor** | ✅ | ✅ | ✅ | ❌ |
| **Nurse** | ✅ | ✅ | ✅ | ❌ |
| **LabTechnician** | ❌ | Lab results only | ✅ | ❌ |
| **Pharmacist** | ❌ | Dispense only | ✅ | ❌ |
| **Patient** | ❌ | ❌ | Own records only | ❌ |

### Key Access Rules

1. **Patients cannot self-register** — Must be registered by healthcare provider
2. **Emergency access is time-limited** — Default 150 blocks (~15 minutes at 6s/block)
3. **All access is logged** — Immutable audit trail on blockchain
4. **Maximum 10 active accesses per patient** — Bounded for safety

---

## 📁 Project Structure

```
medichain/
├── api/                           # Actix-web REST API (8,078 + 16,405 lines)
│   └── src/
│       ├── main.rs                # Core endpoints, RBAC, startup
│       ├── clinical_endpoints.rs  # 239 clinical endpoints
│       ├── clinical.rs            # 50+ medical record types
│       ├── ipfs.rs                # ChaCha20 encrypted IPFS client
│       ├── nfc_simulator.rs       # NFC card simulation (582 lines)
│       ├── db/                    # PostgreSQL connection & migrations
│       ├── models/                # Database models
│       ├── repositories/          # Data access layer
│       ├── services/              # Business logic
│       └── middleware/            # Rate limit, signature auth, errors
├── client/
│   ├── doctor-portal/             # Healthcare provider PWA
│   │   └── src/pages/             # 74 pages
│   ├── patient-app/               # Patient mobile-first PWA  
│   │   └── src/pages/             # 23 pages
│   └── shared/                    # Shared library
│       ├── api/                   # API client (1,748 lines)
│       ├── types/                 # TypeScript interfaces
│       ├── hooks/                 # React hooks (auth, sidebar)
│       ├── i18n/                  # Internationalization
│       └── config.ts              # Environment configuration
├── crypto/                        # ChaCha20-Poly1305 + Argon2id (725 lines)
├── pallets/
│   ├── access-control/            # RBAC pallet (515 lines)
│   ├── medical-records/           # Health records pallet (335 lines)
│   └── patient-identity/          # Patient registration (428 lines)
├── node/                          # Substrate node (PoA consensus)
├── runtime/                       # Substrate runtime configuration
├── docs/                          # Documentation
│   ├── api.md                     # API reference
│   ├── architecture.md            # System design
│   ├── database-schema.md         # Data models
│   ├── security.md                # Security practices
│   └── openapi.yaml               # OpenAPI specification
└── scripts/                       # Build & deployment tools
```

---

## 🧪 Testing

```bash
# Full test suite
./scripts/test-all.sh

# Individual checks
cargo fmt --all -- --check              # Format verification
cargo clippy --all-targets -- -D warnings  # Lint (zero warnings policy)
cargo test --all-features               # Unit tests

# Pallet-specific tests
cargo test -p pallet-access-control
cargo test -p pallet-medical-records
cargo test -p pallet-patient-identity

# Frontend tests
cd client/doctor-portal && npm test
```

---

## 🔒 Security

### NASA Power of 10 Compliance

MediChain follows **NASA Power of 10 Rules** for safety-critical software:

| Rule | Implementation |
|------|----------------|
| 1. No recursion | ✅ Iterative algorithms only |
| 2. Bounded loops | ✅ `MAX_ACTIVE_ACCESSES=10`, `MAX_ALLERGIES=10` |
| 3. No dynamic memory after init | ✅ Pre-allocated bounded collections |
| 4. Functions ≤60 lines | ✅ Enforced via `clippy.toml` |
| 5. ≥2 assertions per function | ✅ `ensure!` macro checks |
| 6. Minimal variable scope | ✅ Smallest scope declarations |
| 7. Check all return values | ✅ Result types, `?` operator |
| 8. Limited macros | ✅ Only frame/Substrate macros |
| 9. Limited pointer use | ✅ Rust ownership model |
| 10. Static analysis | ✅ `cargo clippy -- -D warnings` |

### Cryptographic Standards

| Purpose | Algorithm | Key Size | Notes |
|---------|-----------|----------|-------|
| Document Encryption | ChaCha20-Poly1305 | 256 bits | AEAD with authentication |
| Key Derivation | Argon2id | Variable | Memory-hard, timing-safe |
| Hashing | SHA3-256 / Blake2 | 256 bits | Card verification, ID hashing |
| Signing | Ed25519 | 256 bits | Wallet signatures |

### Security Features

- **Rate Limiting** — Configurable request throttling
- **Signature Authentication** — Optional wallet signature verification (set `REQUIRE_SIGNATURES=true`)
- **CORS Configuration** — Restrictive by default, configurable via `ALLOWED_ORIGINS`
- **Input Validation** — All inputs validated before processing
- **Secure Token Generation** — Cryptographic random for challenges

---

## 🌍 Supported National IDs

| Country | ID System | Code |
|---------|-----------|------|
| 🇪🇹 Ethiopia | Fayda Digital ID | `FaydaID` |
| 🇬🇭 Ghana | Ghana Card | `GhanaCard` |
| 🇳🇬 Nigeria | National Identification Number | `NIN` |
| 🇿🇦 South Africa | Smart ID Card | `SmartID` |
| 🇰🇪 Kenya | Huduma Namba | `KenyaHuduma` |

---

## 📋 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | (none) | PostgreSQL connection string |
| `ALLOWED_ORIGINS` | `localhost:5173,5174` | CORS allowed origins |
| `IS_DEMO` | `false` | Enable permissive CORS for demo |
| `REQUIRE_SIGNATURES` | `false` | Require wallet signatures |
| `DB_MAX_RETRIES` | `5` | Database connection retry attempts |
| `VITE_API_URL` | (auto-detect) | API URL for frontend |
| `VITE_SUBSTRATE_WS` | `ws://127.0.0.1:9944` | Substrate WebSocket |

---

## 🌍 Compliance

- **HIPAA** — Access controls, audit logs, minimum necessary access
- **GDPR** — Data minimization, right to access, accountability
- **Africa Data Protection** — Aligned with AU Convention on Cyber Security

---

## 📜 License

**Proprietary** — © 2025 Trustware. All rights reserved.

This software is developed for the Rust Africa Hackathon 2026 and is the intellectual property of Trustware. Unauthorized copying, modification, or distribution is prohibited.

---

## 👥 Team

**Trustware** — Building trust through technology

- **Keorapetswe Kgoatlha** — Full Stack Developer

---

## 🔗 Links

- **Documentation:** [docs/](docs/)
- **API Reference:** [docs/api.md](docs/api.md)
- **OpenAPI Spec:** [docs/openapi.yaml](docs/openapi.yaml)
- **Architecture:** [docs/architecture.md](docs/architecture.md)
- **Security:** [docs/security.md](docs/security.md)

---

<p align="center">
  <strong>🏥 MediChain — Saving Lives Through Secure Health Data 🚑</strong><br>
  <em>Built with ❤️ in Africa, for Africa</em>
</p>
