# MediChain Architecture

© 2025 Trustware. All rights reserved.

## Overview

MediChain is a safety-critical blockchain-based national health ID and medical records system built on the Substrate framework. The architecture follows NASA Power of 10 rules and Rust best practices for medical software.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ Doctor       │    │ Patient      │    │ Shared       │      │
│  │ Portal       │    │ App          │    │ Components   │      │
│  │ (Web)        │    │ (Mobile)     │    │              │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API LAYER                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  REST API Server                          │  │
│  │  • RBAC Authentication & Authorization                    │  │
│  │  • Rate Limiting                                          │  │
│  │  • Request Validation                                     │  │
│  │  • Audit Logging                                          │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     BLOCKCHAIN LAYER                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   MediChain Runtime                       │  │
│  │  ┌────────────────┐ ┌────────────────┐ ┌──────────────┐  │  │
│  │  │ Access Control │ │ Patient        │ │ Medical      │  │  │
│  │  │ Pallet         │ │ Identity       │ │ Records      │  │  │
│  │  │                │ │ Pallet         │ │ Pallet       │  │  │
│  │  │ • Role Mgmt    │ │ • Registration │ │ • Health     │  │  │
│  │  │ • RBAC         │ │ • National ID  │ │   Records    │  │  │
│  │  │ • Permissions  │ │ • Identity     │ │ • Alerts     │  │  │
│  │  └────────────────┘ └────────────────┘ └──────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   MediChain Node                          │  │
│  │  • Consensus (PoA/GRANDPA)                                │  │
│  │  • P2P Networking                                         │  │
│  │  • Storage                                                │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STORAGE LAYER                                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ On-Chain     │    │ IPFS         │    │ Off-Chain    │      │
│  │ Storage      │    │ (Medical     │    │ Indexer      │      │
│  │ (Metadata)   │    │ Documents)   │    │ (Analytics)  │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### Pallets

#### Access Control Pallet (`pallets/access-control`)

Central RBAC management for the entire system.

**Storage:**
```rust
#[pallet::storage]
pub type UserRoles<T> = StorageMap<_, Blake2_128Concat, T::AccountId, Role>;
```

**Extrinsics:**
- `assign_role(origin, account, role)` - Admin only
- `revoke_role(origin, account)` - Admin only

**Helper Functions:**
- `is_admin(account)` - Check if account is admin
- `is_healthcare_provider(account)` - Check if account can access patient data
- `can_edit_medical_records(account)` - Check if account can modify records

---

#### Patient Identity Pallet (`pallets/patient-identity`)

Manages patient registration and national health ID.

**Storage:**
```rust
#[pallet::storage]
pub type Patients<T> = StorageMap<_, Blake2_128Concat, PatientId, Patient>;

#[pallet::storage]
pub type NationalIdToPatient<T> = StorageMap<_, Blake2_128Concat, IdHash, PatientId>;
```

**Extrinsics:**
- `register_patient(origin, patient_info, id_type, id_hash)` - Healthcare provider only

---

#### Medical Records Pallet (`pallets/medical-records`)

Manages health records with IPFS integration.

**Storage:**
```rust
#[pallet::storage]
pub type HealthRecords<T> = StorageMap<_, Blake2_128Concat, PatientId, HealthRecord>;

#[pallet::storage]
pub type MedicalAlerts<T> = StorageMap<_, Blake2_128Concat, PatientId, Vec<Alert>>;
```

**Extrinsics:**
- `create_health_record(origin, patient_id, ipfs_hash)` - Healthcare provider only
- `add_alert(origin, patient_id, alert)` - Doctor/Nurse/Admin only
- `update_ipfs_hash(origin, patient_id, new_hash)` - Doctor/Nurse/Admin only

---

### Runtime (`runtime/`)

Composes all pallets into a unified blockchain runtime.

**Pallet Configuration:**
```rust
impl pallet_access_control::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
}

impl pallet_patient_identity::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type AccessControl = AccessControl;
}

impl pallet_medical_records::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type AccessControl = AccessControl;
}
```

---

### Node (`node/`)

Substrate node implementation with:
- Consensus mechanism (Proof of Authority)
- P2P networking
- RPC interface
- Block production

---

### Crypto (`crypto/`)

Cryptographic utilities:
- Hash functions (SHA-256, Blake2)
- Digital signatures (Ed25519)
- Encryption (ChaCha20-Poly1305)
- Key derivation (Argon2)

---

### Client Applications

#### Doctor Portal (`client/doctor-portal/`)
- Web-based interface for healthcare providers
- Patient registration
- Medical record management
- Emergency access controls

#### Patient App (`client/patient-app/`)
- Mobile application for patients
- View own records
- Manage access permissions
- Emergency contact info

#### Shared (`client/shared/`)
- Common components and utilities
- API client library
- Type definitions

---

## Data Flow

### Patient Registration Flow

```
Doctor Portal → API → Patient Identity Pallet → Blockchain
       │                      │
       │                      └── Store: Patient metadata
       │                      └── Store: National ID hash
       │
       └── Generate: National Health ID (MCHI-XXXX-XXXX)
```

### Medical Record Access Flow

```
Request → API RBAC Check → Pallet RBAC Check → Blockchain Storage
           │                    │                    │
           │                    │                    └── Return record
           │                    └── Log access
           └── Validate role
```

### Emergency Access Flow

```
Provider → API → Emergency Access Request → Time-Limited Grant
   │                       │                      │
   │                       └── Log reason         │
   │                                              │
   └── Access granted ←──────────────────────────┘
```

---

## Security Architecture

### 6-Layer Security Model

1. **Role-Based Access Control (RBAC)** - Blockchain pallet level
2. **National ID Hash** - SHA-256 hashed, never stored in plaintext
3. **Emergency Access** - Time-limited, logged immutably
4. **Audit Trail** - Every access logged on blockchain
5. **Encryption** - Medical documents encrypted on IPFS
6. **Rate Limiting** - API-level protection

### Cryptographic Standards

| Purpose | Algorithm | Key Size |
|---------|-----------|----------|
| Hashing | SHA-256 / Blake2 | 256 bits |
| Signing | Ed25519 | 256 bits |
| Encryption | ChaCha20-Poly1305 | 256 bits |
| Key Derivation | Argon2id | Variable |

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      PRODUCTION CLUSTER                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                │
│  │ Validator  │  │ Validator  │  │ Validator  │  (3+ nodes)    │
│  │ Node 1     │──│ Node 2     │──│ Node 3     │                │
│  └────────────┘  └────────────┘  └────────────┘                │
│         │              │              │                         │
│         └──────────────┼──────────────┘                         │
│                        │                                        │
│  ┌────────────────────────────────────────────────────────┐    │
│  │                    API Gateway                          │    │
│  │  • Load Balancing  • SSL Termination  • Rate Limiting  │    │
│  └────────────────────────────────────────────────────────┘    │
│                        │                                        │
│  ┌────────────────────────────────────────────────────────┐    │
│  │                    API Servers                          │    │
│  │  (Horizontally Scalable, Stateless)                    │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
medichain/
├── pallets/
│   ├── access-control/     # RBAC pallet
│   ├── patient-identity/   # Patient registration
│   └── medical-records/    # Health records
├── runtime/                # Substrate runtime
├── node/                   # Blockchain node
├── crypto/                 # Cryptographic utilities
├── api/                    # REST API server
├── client/
│   ├── doctor-portal/      # Healthcare provider web app
│   ├── patient-app/        # Patient mobile app
│   └── shared/             # Shared components
├── docs/
│   ├── api.md              # API documentation
│   ├── architecture.md     # This file
│   └── security.md         # Security documentation
├── scripts/                # Build and deployment scripts
└── tests/                  # Integration and E2E tests
```

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Blockchain | Substrate (Rust) |
| Consensus | Proof of Authority (GRANDPA) |
| API | Actix-web (Rust) |
| Storage | RocksDB (on-chain), IPFS (documents) |
| Client | React / React Native |
| Crypto | ring, ed25519-dalek |

---

## NASA Power of 10 Compliance

1. ✅ **Simple Control Flow** - No recursion, bounded loops
2. ✅ **Fixed Upper Bounds** - All loops have maximum iterations
3. ✅ **No Dynamic Memory** - After initialization
4. ✅ **Short Functions** - Max 60 lines per function
5. ✅ **Low Assertion Density** - 2+ assertions per function
6. ✅ **Minimal Variable Scope** - Variables declared at use site
7. ✅ **Return Value Checks** - All return values validated
8. ✅ **Limited Preprocessor** - Minimal macro usage
9. ✅ **Limited Pointer Use** - Reference-based where possible
10. ✅ **Compile-Time Checks** - Maximum static analysis
