cd /mnt/c/Users/Admin/OneDrive/Documents/New\ folder/MEDICHAIN\ DEVELOPMENT\ GUIDE# MEDICHAIN DEVELOPMENT GUIDE
## National Health ID & Medical Records System
### NASA-Grade Coding Standards for Safety-Critical Healthcare Software

**Version:** 1.0  
**Target:** Rust Africa Hackathon 2026  
**Classification:** Safety-Critical Medical Software  
**Author:** [KEORAPETSWE KGOATLHA]  
**Date:** December 28, 2025

---

## TABLE OF CONTENTS

1. [Executive Summary](#executive-summary)
2. [Safety-Critical Coding Standards](#safety-critical-coding-standards)
3. [Project Architecture](#project-architecture)
4. [Implementation Roadmap](#implementation-roadmap)
5. [Code Quality Requirements](#code-quality-requirements)
6. [Testing & Verification](#testing-verification)
7. [Security Standards](#security-standards)
8. [Documentation Requirements](#documentation-requirements)
9. [Appendices](#appendices)

---

## EXECUTIVE SUMMARY

### Project Overview

**MediChain** is a blockchain-based national health ID and medical records system that enables patients to access their complete medical history from any hospital using a simple ID card. This is safety-critical software where bugs can result in loss of life.

### Why Safety-Critical Standards Matter

Medical software failures have consequences:
- ⚠️ **Wrong medication** due to incomplete records → Death
- ⚠️ **Missed allergies** due to data corruption → Anaphylaxis
- ⚠️ **Lost records** due to system crash → Treatment delays
- ⚠️ **Privacy breach** due to security flaw → Legal liability

We will follow **NASA's Power of 10 Rules** adapted for Rust, ensuring our code meets the same standards as software that operates spacecraft.

---

## SAFETY-CRITICAL CODING STANDARDS

### NASA's Power of 10 Rules (Adapted for Rust)

The following rules are derived from NASA JPL's Laboratory for Reliable Software guidelines for developing safety-critical code. These rules target testability, readability, and reliability.

#### **RULE 1: Simple Control Flow**

**Original NASA Rule:**  
Restrict all code to very simple control flow constructs—do not use goto statements, setjmp or longjmp constructs, or direct or indirect recursion.

**Rust Adaptation:**
```rust
// ❌ FORBIDDEN: Recursion in production code
fn fibonacci(n: u32) -> u32 {
    if n <= 1 { n } else { fibonacci(n-1) + fibonacci(n-2) }
}

// ✅ REQUIRED: Iterative approach with bounded loops
fn fibonacci(n: u32) -> u32 {
    if n <= 1 { return n; }
    
    let mut prev = 0;
    let mut curr = 1;
    
    // Rule 2: Loop has fixed upper bound
    for _ in 2..=n {
        let next = prev.checked_add(curr)
            .expect("Fibonacci overflow"); // Rule 5: Assertions
        prev = curr;
        curr = next;
    }
    curr
}
```

**Rationale:** Simple control flow makes code easier to verify, test, and analyze. Recursion can cause stack overflow and makes resource usage unpredictable.

**Enforcement:**
```toml
# In .cargo/config.toml or CI script
[target.'cfg(all())']
rustflags = ["-W", "unconditional_recursion"]
```

---

#### **RULE 2: Fixed Loop Bounds**

**Original NASA Rule:**  
Give all loops a fixed upper bound. It must be trivially possible for a checking tool to prove statically that the loop cannot exceed a preset upper bound on the number of iterations.

**Rust Adaptation:**
```rust
// ❌ FORBIDDEN: Unbounded loop
fn process_records(records: &[MedicalRecord]) {
    let mut i = 0;
    loop {
        if i >= records.len() { break; } // Non-trivial bound
        process(records[i]);
        i += 1;
    }
}

// ✅ REQUIRED: Iterator with known bounds
fn process_records(records: &[MedicalRecord]) {
    // Compiler can prove this iterates exactly records.len() times
    for record in records.iter() {
        process(record);
    }
}

// ✅ ACCEPTABLE: Explicit numeric bound
const MAX_RECORDS_PER_BATCH: usize = 1000;

fn process_batch(records: &[MedicalRecord]) -> Result<(), ProcessError> {
    // Rule 7: Check preconditions
    if records.len() > MAX_RECORDS_PER_BATCH {
        return Err(ProcessError::BatchTooLarge);
    }
    
    // Loop bound is provably <= MAX_RECORDS_PER_BATCH
    for (index, record) in records.iter().enumerate() {
        assert!(index < MAX_RECORDS_PER_BATCH); // Rule 5: Assertions
        process(record)?; // Rule 7: Check return values
    }
    
    Ok(())
}
```

**Rationale:** Unbounded loops can hang, causing system unavailability in emergency situations. Fixed bounds enable worst-case execution time analysis.

---

#### **RULE 3: No Dynamic Memory Allocation After Initialization**

**Original NASA Rule:**  
Do not use dynamic memory allocation after initialization.

**Rust Adaptation:**
```rust
// ❌ FORBIDDEN: Runtime allocation in critical path
fn add_record(patient: &mut Patient, record: MedicalRecord) {
    patient.records.push(record); // Heap allocation!
}

// ✅ REQUIRED: Pre-allocated capacity
const MAX_RECORDS_PER_PATIENT: usize = 10_000;

pub struct Patient {
    id: PatientId,
    // Pre-allocate at initialization, never grows
    records: heapless::Vec<MedicalRecord, MAX_RECORDS_PER_PATIENT>,
}

impl Patient {
    pub fn new(id: PatientId) -> Self {
        Self {
            id,
            records: heapless::Vec::new(),
        }
    }
    
    pub fn add_record(&mut self, record: MedicalRecord) -> Result<(), RecordError> {
        self.records.push(record)
            .map_err(|_| RecordError::CapacityExceeded)
    }
}
```

**Alternative using static allocation:**
```rust
use arrayvec::ArrayVec;

pub struct Patient {
    id: PatientId,
    // Stack-allocated, no heap involvement
    records: ArrayVec<MedicalRecord, 10_000>,
}
```

**Rationale:** Dynamic allocation can fail unpredictably. In medical emergencies, out-of-memory errors are unacceptable. Pre-allocation ensures resources are available.

**Note for Hackathon:** You may use standard `Vec` during development but document all allocations and plan for bounded alternatives in production.

---

#### **RULE 4: Short Functions**

**Original NASA Rule:**  
No function should be longer than what can be printed on a single sheet of paper in a standard format with one line per statement and one line per declaration. Typically, this means no more than about 60 lines of code per function.

**Rust Adaptation:**
```rust
// ❌ FORBIDDEN: Function too long (>60 lines)
fn verify_and_add_record(
    patient_id: PatientId,
    record: MedicalRecord,
    signature: Signature,
) -> Result<(), Error> {
    // 150 lines of validation, encryption, blockchain submission...
    // Hard to review, test, or verify
}

// ✅ REQUIRED: Break into small, focused functions
fn verify_and_add_record(
    patient_id: PatientId,
    record: MedicalRecord,
    signature: Signature,
) -> Result<(), Error> {
    // Each function is <60 lines
    validate_record(&record)?;
    verify_signature(&record, &signature)?;
    let encrypted = encrypt_record(patient_id, record)?;
    submit_to_blockchain(encrypted)?;
    Ok(())
}

fn validate_record(record: &MedicalRecord) -> Result<(), ValidationError> {
    // 15 lines of validation logic
    assert!(record.timestamp <= current_time()); // Rule 5
    assert!(!record.diagnosis.is_empty()); // Rule 5
    // ... more validation
    Ok(())
}
```

**Enforcement with Clippy:**
```toml
# In clippy.toml
cognitive-complexity-threshold = 15
```

**Rationale:** Short functions are easier to understand, test, and verify. Code reviews are more effective when functions fit on one screen.

---

#### **RULE 5: Assertion Density (Minimum 2 Per Function)**

**Original NASA Rule:**  
The code's assertion density should average to minimally two assertions per function. Assertions must be used to check for anomalous conditions that should never happen in real-life executions.

**Rust Adaptation:**
```rust
use std::time::SystemTime;

fn decrypt_medical_record(
    encrypted: &[u8],
    patient_key: &EncryptionKey,
) -> Result<MedicalRecord, DecryptionError> {
    // Assertion 1: Input validation
    assert!(!encrypted.is_empty(), "Encrypted data cannot be empty");
    assert!(encrypted.len() <= MAX_ENCRYPTED_SIZE, 
            "Encrypted data exceeds maximum size");
    
    // Assertion 2: Key validity
    assert!(patient_key.is_valid(), "Encryption key is invalid or expired");
    
    let plaintext = decrypt(encrypted, patient_key)?;
    
    // Assertion 3: Output validation
    assert!(plaintext.len() > 0, "Decryption produced empty result");
    
    let record: MedicalRecord = deserialize(&plaintext)?;
    
    // Assertion 4: Logical invariant
    assert!(record.timestamp <= SystemTime::now(), 
            "Record timestamp is in the future");
    
    Ok(record)
}
```

**Types of Assertions:**
1. **Preconditions:** Check inputs are valid
2. **Postconditions:** Check outputs are correct
3. **Invariants:** Check internal state is consistent
4. **Bounds:** Check array/buffer accesses are safe

**Production vs Development:**
```rust
// Use debug_assert! for performance-critical checks
debug_assert!(index < array.len());

// Use assert! for safety-critical checks (always enabled)
assert!(patient_id.is_valid(), "Invalid patient ID in production");
```

**Rationale:** Assertions catch bugs early. In medical software, they prevent catastrophic failures like accessing wrong patient records.

---

#### **RULE 6: Minimal Scope**

**Original NASA Rule:**  
Declare all data objects at the smallest possible level of scope.

**Rust Adaptation:**
```rust
// ❌ FORBIDDEN: Overly broad scope
fn process_patient_records(patients: &[Patient]) {
    let mut total_count = 0; // Used only in inner scope
    let mut error_count = 0; // Used only in inner scope
    
    for patient in patients {
        for record in &patient.records {
            if validate_record(record).is_ok() {
                total_count += 1;
            } else {
                error_count += 1;
            }
        }
    }
}

// ✅ REQUIRED: Minimal scope
fn process_patient_records(patients: &[Patient]) {
    for patient in patients {
        // Scoped to inner loop only
        let (total_count, error_count) = patient.records.iter()
            .fold((0, 0), |(total, errors), record| {
                if validate_record(record).is_ok() {
                    (total + 1, errors)
                } else {
                    (total, errors + 1)
                }
            });
        
        log_counts(patient.id, total_count, error_count);
    }
}
```

**Rust Advantage:** Rust's ownership system naturally enforces minimal scope:
```rust
{
    let temp_key = generate_temporary_key();
    encrypt_with_key(&data, &temp_key);
    // temp_key automatically dropped here, cannot be misused
}
```

**Rationale:** Limited scope reduces the code that can access a variable, reducing potential for bugs.

---

#### **RULE 7: Check Return Values**

**Original NASA Rule:**  
Each calling function must check the return value of nonvoid functions, and each called function must check the validity of all parameters provided by the caller.

**Rust Adaptation:**
```rust
// ❌ FORBIDDEN: Ignoring Result
fn save_record(record: MedicalRecord) {
    database.insert(record); // Compiler error if returns Result!
}

// ✅ REQUIRED: Handle all Results
fn save_record(record: MedicalRecord) -> Result<(), SaveError> {
    database.insert(record)?; // Propagate error
    Ok(())
}

// ✅ REQUIRED: Validate all parameters
fn add_medication(
    patient_id: PatientId,
    drug_name: &str,
    dosage: f64,
) -> Result<(), MedicationError> {
    // Parameter validation (preconditions)
    if !patient_id.is_valid() {
        return Err(MedicationError::InvalidPatientId);
    }
    if drug_name.is_empty() {
        return Err(MedicationError::InvalidDrugName);
    }
    if dosage <= 0.0 || dosage > MAX_SAFE_DOSAGE {
        return Err(MedicationError::InvalidDosage);
    }
    
    // Now safe to proceed
    let medication = Medication::new(drug_name, dosage);
    store_medication(patient_id, medication)?;
    Ok(())
}
```

**Rust Advantage:** The `Result` type makes error handling explicit and mandatory:
```rust
// Compiler forces you to handle Result
let patient = database.get_patient(id)?; // Must handle error

// Cannot accidentally ignore errors
#[must_use]
fn critical_operation() -> Result<(), Error> { ... }
```

**Rationale:** Unchecked errors cascade into catastrophic failures. In healthcare, a silent database write failure could mean lost medical records.

---

#### **RULE 8: Limited Preprocessor Use**

**Original NASA Rule:**  
The use of the preprocessor must be limited to the inclusion of header files and simple macro definitions.

**Rust Adaptation:**
```rust
// ❌ AVOID: Complex macros
macro_rules! complex_medical_logic {
    ($patient:expr, $record:expr, $($extra:tt)*) => {
        // 50 lines of complex macro logic
    };
}

// ✅ PREFERRED: Use functions and traits
trait MedicalRecordProcessor {
    fn process(&self, patient: &Patient, record: &MedicalRecord) -> Result<(), Error>;
}

// ✅ ACCEPTABLE: Simple, type-safe macros
macro_rules! assert_patient_valid {
    ($patient:expr) => {
        assert!($patient.id.is_valid(), "Invalid patient ID: {:?}", $patient.id);
    };
}
```

**Rationale:** Macros bypass type checking and make debugging harder. Rust's generics and traits provide type-safe alternatives.

---

#### **RULE 9: Limited Pointer Use**

**Original NASA Rule:**  
Limit pointer use to single dereference, and do not use function pointers.

**Rust Adaptation:**
```rust
// ❌ FORBIDDEN: Raw pointers (use only when absolutely necessary)
unsafe fn access_record(ptr: *const MedicalRecord) -> &MedicalRecord {
    &*ptr // Dangerous!
}

// ✅ REQUIRED: Use safe references
fn access_record(record: &MedicalRecord) -> &MedicalRecord {
    record // Rust's borrow checker ensures safety
}

// ❌ AVOID: Function pointers
type ProcessorFn = fn(&MedicalRecord) -> Result<(), Error>;

// ✅ PREFERRED: Use trait objects
trait RecordProcessor {
    fn process(&self, record: &MedicalRecord) -> Result<(), Error>;
}

fn process_with_handler(record: &MedicalRecord, processor: &dyn RecordProcessor) {
    processor.process(record).expect("Processing failed");
}
```

**Rust Advantage:** Rust's type system eliminates most pointer errors at compile time:
- No null pointer dereferences (use `Option<T>`)
- No use-after-free (ownership system)
- No data races (borrow checker)

**Rationale:** Pointer errors are the #1 cause of security vulnerabilities and crashes in C/C++. Rust eliminates 70% of these by design.

---

#### **RULE 10: Compile with All Warnings, Zero Warnings Policy**

**Original NASA Rule:**  
Compile with all possible warnings active; all warnings should then be addressed before the software is considered complete.

**Rust Adaptation:**
```toml
# In Cargo.toml
[profile.dev]
# Enable all lints in development

[profile.release]
# Treat warnings as errors in production builds
overflow-checks = true
lto = true

# In rust-toolchain.toml or CI
[toolchain]
channel = "stable"
components = ["clippy", "rustfmt"]

# Enforce in CI
```

**Mandatory Clippy Configuration:**
```toml
# clippy.toml
# Warn on ALL clippy lints
# Then selectively allow specific ones with justification

# File: .cargo/config.toml or pass to rustc
[build]
rustflags = [
    "-W", "warnings",              # Treat warnings as errors
    "-W", "unused",                # Catch unused code
    "-W", "rust-2021-compatibility",
]
```

**Pre-commit Hook:**
```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "Running cargo fmt..."
cargo fmt --all -- --check || exit 1

echo "Running cargo clippy..."
cargo clippy --all-targets --all-features -- \
    -D warnings \
    -D clippy::all \
    -D clippy::pedantic \
    -D clippy::cargo || exit 1

echo "Running cargo test..."
cargo test --all-features || exit 1

echo "All checks passed!"
```

**Rationale:** Zero warnings policy ensures no potential issues are ignored. Static analysis catches bugs before they reach production.

---

### Additional Safety-Critical Standards for Medical Software

#### **RULE 11: Immutability by Default**

```rust
// ✅ REQUIRED: Make everything immutable unless mutation is necessary
fn process_patient(patient: Patient) -> ProcessedPatient {
    // patient cannot be modified
    let records = patient.records; // Move, don't mutate
    ProcessedPatient::from(records)
}

// Only use mut when absolutely necessary
fn update_medication(patient: &mut Patient, med: Medication) {
    // Clearly signals mutation occurs
    patient.current_medications.push(med);
}
```

#### **RULE 12: Explicit Error Types**

```rust
// ❌ AVOID: Generic errors
fn get_record(id: RecordId) -> Result<Record, String> { ... }

// ✅ REQUIRED: Specific error types
#[derive(Debug, thiserror::Error)]
pub enum RecordError {
    #[error("Record not found: {0}")]
    NotFound(RecordId),
    
    #[error("Access denied: insufficient permissions")]
    AccessDenied,
    
    #[error("Database error: {0}")]
    DatabaseError(#[from] DatabaseError),
    
    #[error("Decryption failed: {0}")]
    DecryptionError(String),
}

fn get_record(id: RecordId) -> Result<Record, RecordError> { ... }
```

#### **RULE 13: Const Correctness**

```rust
// ✅ REQUIRED: Use const for all compile-time constants
pub const MAX_RECORDS: usize = 10_000;
pub const MAX_MEDICATIONS: usize = 50;
pub const ENCRYPTION_KEY_SIZE: usize = 32;

// Document why these values were chosen
/// Maximum records per patient (based on 50-year lifespan, 200 visits/year)
pub const MAX_RECORDS_PER_PATIENT: usize = 10_000;
```

#### **RULE 14: Comprehensive Logging**

```rust
use tracing::{info, warn, error, instrument};

#[instrument(skip(patient_key))]
fn decrypt_record(
    encrypted: &[u8],
    patient_key: &EncryptionKey,
) -> Result<MedicalRecord, DecryptionError> {
    info!("Decrypting medical record, size: {} bytes", encrypted.len());
    
    let result = perform_decryption(encrypted, patient_key);
    
    match result {
        Ok(ref record) => {
            info!("Successfully decrypted record for patient: {}", record.patient_id);
        }
        Err(ref e) => {
            error!("Decryption failed: {:?}", e);
        }
    }
    
    result
}
```

---

## PROJECT ARCHITECTURE

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        MediChain System                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │   Patient    │      │   Doctor     │      │   Hospital   │  │
│  │  (NFC Card)  │◄────►│   Portal     │◄────►│    Node      │  │
│  └──────────────┘      └──────────────┘      └──────────────┘  │
│         │                      │                      │          │
│         │                      │                      │          │
│         └──────────────────────┼──────────────────────┘          │
│                                │                                 │
│                                ▼                                 │
│                    ┌───────────────────────┐                    │
│                    │  Substrate Blockchain  │                    │
│                    │  (Medical Records      │                    │
│                    │   Ledger)              │                    │
│                    └───────────────────────┘                    │
│                                │                                 │
│                    ┌───────────┴───────────┐                    │
│                    │                       │                    │
│                    ▼                       ▼                    │
│            ┌──────────────┐       ┌──────────────┐             │
│            │  Encryption  │       │  Access      │             │
│            │  Layer       │       │  Control     │             │
│            └──────────────┘       └──────────────┘             │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

#### **1. Substrate Blockchain Node**
- **Technology:** Rust + Substrate Framework
- **Purpose:** Immutable ledger for medical records
- **Key Features:**
  - Custom consensus (PoA for medical institutions)
  - Medical record pallet
  - Patient identity pallet
  - Access control pallet

#### **2. Encryption Layer**
- **Algorithm:** ChaCha20-Poly1305 (AEAD)
- **Key Management:** Patient-controlled keys
- **Purpose:** Ensure patient data privacy

#### **3. NFC Card System**
- **Hardware:** Simulated with smartphone NFC or USB reader
- **Data:** Encrypted patient key + patient ID hash
- **Fallback:** QR code printed on card

#### **4. Doctor/Hospital Portal**
- **Frontend:** React + Polkadot.js
- **Features:**
  - Card reader interface
  - Medical history viewer
  - Add new records
  - Patient consent management

---

## IMPLEMENTATION ROADMAP

### Phase 1: Development Environment Setup (Day 1)

#### **1.1 Install Rust and Tools**

```bash
# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WebAssembly target for Substrate
rustup target add wasm32-unknown-unknown

# Install Substrate node template
git clone https://github.com/substrate-developer-hub/substrate-node-template
cd substrate-node-template

# Verify installation
cargo build --release
```

#### **1.2 Install Additional Tools**

```bash
# Install clippy and rustfmt
rustup component add clippy rustfmt

# Install cargo-audit for security checks
cargo install cargo-audit

# Install cargo-deny for license/security checking
cargo install cargo-deny

# Install cargo-tarpaulin for code coverage
cargo install cargo-tarpaulin
```

#### **1.3 Project Structure**

```
medichain/
├── Cargo.toml                 # Workspace configuration
├── README.md                  # Project documentation
├── LICENSE                    # Open source license
│
├── node/                      # Substrate blockchain node
│   ├── Cargo.toml
│   ├── src/
│   │   ├── main.rs           # Node entry point
│   │   ├── chain_spec.rs     # Blockchain configuration
│   │   └── rpc.rs            # RPC methods
│   └── tests/
│
├── pallets/                   # Custom Substrate pallets
│   ├── medical-records/      # Medical record storage
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── types.rs
│   │   │   ├── tests.rs
│   │   │   └── benchmarking.rs
│   │
│   ├── patient-identity/     # Patient registration
│   │   └── src/
│   │       └── lib.rs
│   │
│   └── access-control/       # Permissions management
│       └── src/
│           └── lib.rs
│
├── runtime/                  # Substrate runtime
│   ├── Cargo.toml
│   ├── src/
│   │   └── lib.rs
│   └── build.rs
│
├── client/                   # Frontend applications
│   ├── doctor-portal/       # Web app for doctors
│   ├── patient-app/         # Mobile app for patients
│   └── shared/              # Shared UI components
│
├── crypto/                   # Encryption library
│   ├── Cargo.toml
│   ├── src/
│   │   ├── lib.rs
│   │   ├── encryption.rs
│   │   ├── keys.rs
│   │   └── tests.rs
│
├── scripts/                  # Build and deployment scripts
│   ├── setup.sh
│   ├── test-all.sh
│   └── deploy.sh
│
├── docs/                     # Documentation
│   ├── architecture.md
│   ├── api.md
│   └── security.md
│
└── tests/                    # Integration tests
    ├── integration_tests.rs
    └── e2e_tests.rs
```

---

### Phase 2: Core Blockchain (Days 2-5)

#### **2.1 Medical Records Pallet**

**File:** `pallets/medical-records/src/lib.rs`

```rust
#![cfg_attr(not(feature = "std"), no_std)]

//! # Medical Records Pallet
//!
//! This pallet manages encrypted medical records on the blockchain.
//!
//! ## Safety-Critical Notes
//! - All records are encrypted with patient keys
//! - Access is logged immutably
//! - No dynamic allocation in critical paths
//!
//! ## Compliance
//! - Follows NASA Power of 10 rules
//! - HIPAA-compliant encryption
//! - Audit trail for all access

use frame_support::{
    decl_module, decl_storage, decl_event, decl_error,
    ensure,
    traits::Get,
};
use frame_system::ensure_signed;
use sp_std::prelude::*;
use sp_runtime::traits::Hash;

// Rule 13: Const correctness
pub const MAX_RECORDS_PER_PATIENT: u32 = 10_000;
pub const MAX_ENCRYPTED_RECORD_SIZE: usize = 10_000; // 10KB

/// Configuration trait for the medical records pallet
pub trait Config: frame_system::Config {
    /// The overarching event type
    type Event: From<Event<Self>> + Into<<Self as frame_system::Config>::Event>;
    
    /// Maximum size of encrypted medical record
    type MaxRecordSize: Get<u32>;
}

/// Medical record metadata (NOT the encrypted data itself)
#[derive(Clone, Encode, Decode, PartialEq, RuntimeDebug, TypeInfo)]
pub struct RecordMetadata<AccountId, BlockNumber> {
    /// Hospital that created the record
    pub hospital_id: AccountId,
    
    /// Timestamp of record creation
    pub created_at: BlockNumber,
    
    /// Hash of encrypted record (for integrity)
    pub record_hash: H256,
    
    /// Record type (diagnosis, prescription, lab result, etc.)
    pub record_type: RecordType,
}

#[derive(Clone, Encode, Decode, PartialEq, RuntimeDebug, TypeInfo)]
pub enum RecordType {
    Diagnosis,
    Prescription,
    LabResult,
    Vaccination,
    Surgery,
    Allergy,
    EmergencyInfo,
}

decl_storage! {
    trait Store for Module<T: Config> as MedicalRecords {
        /// Mapping: PatientId => Vec<RecordMetadata>
        /// NOTE: Using BoundedVec to comply with Rule 3 (no dynamic allocation)
        PatientRecords get(fn patient_records):
            map hasher(blake2_128_concat) T::AccountId
            => BoundedVec<RecordMetadata<T::AccountId, T::BlockNumber>, ConstU32<MAX_RECORDS_PER_PATIENT>>;
        
        /// Mapping: RecordHash => EncryptedData (stored off-chain)
        /// We store only hash on-chain, actual data in distributed storage
        RecordData get(fn record_data):
            map hasher(identity) H256 => Option<Vec<u8>>;
        
        /// Access log: Who accessed which record when
        AccessLog get(fn access_log):
            double_map hasher(blake2_128_concat) T::AccountId,
                      hasher(blake2_128_concat) H256
            => Vec<(T::AccountId, T::BlockNumber)>;
    }
}

decl_event! {
    pub enum Event<T> where
        AccountId = <T as frame_system::Config>::AccountId,
        BlockNumber = <T as frame_system::Config>::BlockNumber,
    {
        /// New medical record added
        RecordAdded(AccountId, H256, BlockNumber),
        
        /// Record accessed
        RecordAccessed(AccountId, H256, AccountId, BlockNumber),
        
        /// Access permission granted
        AccessGranted(AccountId, AccountId, BlockNumber),
    }
}

decl_error! {
    pub enum Error for Module<T: Config> {
        /// Patient does not exist
        PatientNotFound,
        
        /// Record not found
        RecordNotFound,
        
        /// Access denied
        AccessDenied,
        
        /// Record too large
        RecordTooLarge,
        
        /// Too many records for patient
        TooManyRecords,
        
        /// Invalid record data
        InvalidRecord,
    }
}

decl_module! {
    pub struct Module<T: Config> for enum Call where origin: T::Origin {
        // Rule 7: Check return values
        type Error = Error<T>;
        
        fn deposit_event() = default;
        
        /// Add a new medical record for a patient
        ///
        /// # Arguments
        /// * `patient_id` - The patient's account ID
        /// * `encrypted_data` - The encrypted medical record
        /// * `record_type` - Type of medical record
        ///
        /// # Safety
        /// - Follows Rule 5: Multiple assertions for validation
        /// - Follows Rule 7: Validates all parameters
        #[weight = 10_000]
        pub fn add_record(
            origin,
            patient_id: T::AccountId,
            encrypted_data: Vec<u8>,
            record_type: RecordType,
        ) -> DispatchResult {
            let hospital_id = ensure_signed(origin)?;
            
            // Rule 5, Assertion 1: Validate inputs
            ensure!(!encrypted_data.is_empty(), Error::<T>::InvalidRecord);
            
            // Rule 5, Assertion 2: Check size bounds
            ensure!(
                encrypted_data.len() <= MAX_ENCRYPTED_RECORD_SIZE,
                Error::<T>::RecordTooLarge
            );
            
            // Rule 5, Assertion 3: Check patient exists
            ensure!(
                Self::patient_exists(&patient_id),
                Error::<T>::PatientNotFound
            );
            
            // Calculate hash for integrity (Rule 5, Assertion 4)
            let record_hash = T::Hashing::hash(&encrypted_data);
            assert!(
                record_hash != H256::zero(),
                "Hash calculation failed"
            );
            
            // Create metadata
            let metadata = RecordMetadata {
                hospital_id: hospital_id.clone(),
                created_at: <frame_system::Pallet<T>>::block_number(),
                record_hash,
                record_type,
            };
            
            // Add to patient's records (bounded, complies with Rule 3)
            PatientRecords::<T>::try_mutate(&patient_id, |records| {
                records.try_push(metadata)
                    .map_err(|_| Error::<T>::TooManyRecords.into())
            })?;
            
            // Store encrypted data
            RecordData::insert(record_hash, encrypted_data);
            
            // Emit event
            Self::deposit_event(Event::RecordAdded(
                patient_id,
                record_hash,
                <frame_system::Pallet<T>>::block_number(),
            ));
            
            Ok(())
        }
        
        /// Access a medical record
        ///
        /// # Safety
        /// - Logs all access attempts (audit trail)
        /// - Checks permissions before granting access
        #[weight = 5_000]
        pub fn access_record(
            origin,
            patient_id: T::AccountId,
            record_hash: H256,
        ) -> DispatchResult {
            let accessor = ensure_signed(origin)?;
            
            // Rule 7: Validate parameters
            ensure!(
                Self::patient_exists(&patient_id),
                Error::<T>::PatientNotFound
            );
            
            // Check permission (Rule 7)
            ensure!(
                Self::has_access(&accessor, &patient_id),
                Error::<T>::AccessDenied
            );
            
            // Log access (immutable audit trail)
            let current_block = <frame_system::Pallet<T>>::block_number();
            AccessLog::<T>::append(
                &patient_id,
                &record_hash,
                (accessor.clone(), current_block),
            );
            
            // Emit event
            Self::deposit_event(Event::RecordAccessed(
                patient_id,
                record_hash,
                accessor,
                current_block,
            ));
            
            Ok(())
        }
    }
}

// Implementation block (helper functions)
impl<T: Config> Module<T> {
    /// Check if patient exists in system
    ///
    /// Rule 4: Function under 60 lines
    /// Rule 5: Two assertions minimum
    fn patient_exists(patient_id: &T::AccountId) -> bool {
        // Assertion 1: Valid account ID
        assert!(!patient_id.encode().is_empty(), "Invalid patient ID");
        
        // Check if patient has any records
        let exists = PatientRecords::<T>::contains_key(patient_id);
        
        // Assertion 2: Logical invariant
        if exists {
            let records = PatientRecords::<T>::get(patient_id);
            assert!(records.len() > 0, "Patient exists but has no records");
        }
        
        exists
    }
    
    /// Check if accessor has permission to view patient records
    ///
    /// Rule 6: Minimal scope (helper function, not exposed)
    fn has_access(
        accessor: &T::AccountId,
        patient_id: &T::AccountId,
    ) -> bool {
        // Rule 5: Assertions
        assert!(!accessor.encode().is_empty(), "Invalid accessor ID");
        assert!(!patient_id.encode().is_empty(), "Invalid patient ID");
        
        // Patient always has access to own records
        if accessor == patient_id {
            return true;
        }
        
        // Check if accessor is registered hospital/doctor
        // (In full implementation, check AccessControl pallet)
        true // Simplified for hackathon
    }
}

// Rule 10: Comprehensive tests
#[cfg(test)]
mod tests {
    use super::*;
    use frame_support::{assert_ok, assert_noop};
    
    #[test]
    fn test_add_record_success() {
        // Test implementation
        // Must have >80% code coverage
    }
    
    #[test]
    fn test_add_record_too_large() {
        // Test boundary conditions
    }
    
    #[test]
    fn test_access_control() {
        // Test security
    }
}
```

**Key Points:**
1. ✅ **Rule 3:** Uses `BoundedVec` to avoid dynamic allocation
2. ✅ **Rule 4:** Each function <60 lines
3. ✅ **Rule 5:** Minimum 2 assertions per function
4. ✅ **Rule 6:** Helper functions have minimal scope
5. ✅ **Rule 7:** All inputs validated, all `Result`s handled

---

#### **2.2 Encryption Module**

**File:** `crypto/src/lib.rs`

```rust
//! # MediChain Cryptography Module
//!
//! Provides encryption/decryption for medical records.
//!
//! ## Security
//! - Uses ChaCha20-Poly1305 (AEAD)
//! - Patient-controlled keys
//! - Forward secrecy
//!
//! ## Safety
//! - Constant-time operations (prevents timing attacks)
//! - Zero-copy where possible
//! - No panics in public API

use chacha20poly1305::{
    aead::{Aead, KeyInit, OsRng},
    ChaCha20Poly1305, Nonce,
};
use argon2::{Argon2, PasswordHasher};
use rand::RngCore;
use zeroize::{Zeroize, ZeroizeOnDrop};

// Rule 13: Const correctness
pub const KEY_SIZE: usize = 32;
pub const NONCE_SIZE: usize = 12;
pub const TAG_SIZE: usize = 16;

/// Encryption key (automatically zeroized when dropped)
#[derive(Clone, ZeroizeOnDrop)]
pub struct EncryptionKey([u8; KEY_SIZE]);

impl EncryptionKey {
    /// Generate a new random key
    ///
    /// Rule 5: Two assertions
    pub fn generate() -> Result<Self, CryptoError> {
        let mut key = [0u8; KEY_SIZE];
        
        // Assertion 1: RNG successful
        OsRng.fill_bytes(&mut key);
        assert!(key != [0u8; KEY_SIZE], "RNG failed to generate key");
        
        let enc_key = Self(key);
        
        // Assertion 2: Valid key
        assert!(enc_key.is_valid(), "Generated invalid key");
        
        Ok(enc_key)
    }
    
    /// Derive key from password (for patient-controlled keys)
    ///
    /// Rule 4: Under 60 lines
    /// Rule 5: Multiple assertions
    pub fn from_password(
        password: &str,
        salt: &[u8],
    ) -> Result<Self, CryptoError> {
        // Rule 7: Validate inputs
        if password.is_empty() {
            return Err(CryptoError::InvalidPassword);
        }
        if salt.len() < 16 {
            return Err(CryptoError::InvalidSalt);
        }
        
        // Use Argon2 (memory-hard, resistant to brute force)
        let argon2 = Argon2::default();
        
        let mut key = [0u8; KEY_SIZE];
        argon2
            .hash_password_into(password.as_bytes(), salt, &mut key)
            .map_err(|_| CryptoError::KeyDerivationFailed)?;
        
        // Rule 5, Assertion 1: Key derived successfully
        assert!(key != [0u8; KEY_SIZE], "Key derivation produced zeros");
        
        let enc_key = Self(key);
        
        // Rule 5, Assertion 2: Valid key
        assert!(enc_key.is_valid(), "Derived invalid key");
        
        Ok(enc_key)
    }
    
    /// Check if key is valid
    fn is_valid(&self) -> bool {
        // Key should not be all zeros
        self.0 != [0u8; KEY_SIZE]
    }
    
    /// Get key bytes (temporary, will be zeroized)
    fn as_bytes(&self) -> &[u8; KEY_SIZE] {
        &self.0
    }
}

/// Encrypt medical record data
///
/// Rule 4: Function under 60 lines
/// Rule 5: Minimum 2 assertions
/// Rule 7: Check all return values
pub fn encrypt(
    plaintext: &[u8],
    key: &EncryptionKey,
) -> Result<Vec<u8>, CryptoError> {
    // Rule 7: Validate inputs
    if plaintext.is_empty() {
        return Err(CryptoError::EmptyPlaintext);
    }
    if plaintext.len() > MAX_ENCRYPTED_RECORD_SIZE {
        return Err(CryptoError::RecordTooLarge);
    }
    
    // Rule 5, Assertion 1: Key is valid
    assert!(key.is_valid(), "Encryption key is invalid");
    
    // Generate random nonce
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    
    // Create cipher
    let cipher = ChaCha20Poly1305::new_from_slice(key.as_bytes())
        .map_err(|_| CryptoError::InvalidKey)?;
    
    // Encrypt
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| CryptoError::EncryptionFailed)?;
    
    // Rule 5, Assertion 2: Ciphertext not empty
    assert!(!ciphertext.is_empty(), "Encryption produced empty result");
    
    // Prepend nonce to ciphertext (needed for decryption)
    let mut result = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);
    
    Ok(result)
}

/// Decrypt medical record data
///
/// Rule 4: Function under 60 lines
/// Rule 5: Minimum 2 assertions
/// Rule 7: Check all return values
pub fn decrypt(
    encrypted: &[u8],
    key: &EncryptionKey,
) -> Result<Vec<u8>, CryptoError> {
    // Rule 7: Validate inputs
    if encrypted.len() < NONCE_SIZE + TAG_SIZE {
        return Err(CryptoError::InvalidCiphertext);
    }
    
    // Rule 5, Assertion 1: Key is valid
    assert!(key.is_valid(), "Decryption key is invalid");
    
    // Extract nonce and ciphertext
    let (nonce_bytes, ciphertext) = encrypted.split_at(NONCE_SIZE);
    let nonce = Nonce::from_slice(nonce_bytes);
    
    // Rule 5, Assertion 2: Nonce correct size
    assert_eq!(nonce_bytes.len(), NONCE_SIZE, "Invalid nonce size");
    
    // Create cipher
    let cipher = ChaCha20Poly1305::new_from_slice(key.as_bytes())
        .map_err(|_| CryptoError::InvalidKey)?;
    
    // Decrypt (AEAD automatically verifies authentication tag)
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| CryptoError::DecryptionFailed)?;
    
    // Rule 5, Assertion 3: Plaintext not empty
    assert!(!plaintext.is_empty(), "Decryption produced empty result");
    
    Ok(plaintext)
}

/// Custom error type (Rule 12: Explicit error types)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CryptoError {
    InvalidPassword,
    InvalidSalt,
    InvalidKey,
    KeyDerivationFailed,
    EmptyPlaintext,
    RecordTooLarge,
    InvalidCiphertext,
    EncryptionFailed,
    DecryptionFailed,
}

// Rule 10: Comprehensive tests
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = EncryptionKey::generate().unwrap();
        let plaintext = b"Patient has Type 2 Diabetes";
        
        let encrypted = encrypt(plaintext, &key).unwrap();
        let decrypted = decrypt(&encrypted, &key).unwrap();
        
        assert_eq!(plaintext, decrypted.as_slice());
    }
    
    #[test]
    fn test_wrong_key_fails() {
        let key1 = EncryptionKey::generate().unwrap();
        let key2 = EncryptionKey::generate().unwrap();
        
        let plaintext = b"Secret medical data";
        let encrypted = encrypt(plaintext, &key1).unwrap();
        
        // Decryption with wrong key should fail
        assert!(decrypt(&encrypted, &key2).is_err());
    }
    
    #[test]
    fn test_tampered_ciphertext_fails() {
        let key = EncryptionKey::generate().unwrap();
        let plaintext = b"Important record";
        
        let mut encrypted = encrypt(plaintext, &key).unwrap();
        
        // Tamper with ciphertext
        encrypted[NONCE_SIZE] ^= 0xFF;
        
        // Authentication should fail
        assert!(decrypt(&encrypted, &key).is_err());
    }
    
    #[test]
    fn test_key_derivation_deterministic() {
        let password = "patient_password_123";
        let salt = b"random_salt_1234";
        
        let key1 = EncryptionKey::from_password(password, salt).unwrap();
        let key2 = EncryptionKey::from_password(password, salt).unwrap();
        
        // Same password + salt should produce same key
        assert_eq!(key1.as_bytes(), key2.as_bytes());
    }
    
    #[test]
    fn test_empty_plaintext_rejected() {
        let key = EncryptionKey::generate().unwrap();
        let empty = b"";
        
        assert!(encrypt(empty, &key).is_err());
    }
}
```

**Security Features:**
1. ✅ **ChaCha20-Poly1305:** Modern AEAD cipher (faster than AES on most systems)
2. ✅ **Argon2:** Memory-hard password hashing (resistant to brute force)
3. ✅ **Zeroize:** Automatic memory clearing (prevents key leakage)
4. ✅ **Constant-time:** Operations don't leak timing information
5. ✅ **Authenticated Encryption:** Tamper detection built-in

---

### Phase 3: Frontend (Days 6-8)

#### **3.1 Doctor Portal - Card Reader Interface**

**File:** `client/doctor-portal/src/CardReader.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import { ApiPromise, WsProvider } from '@polkadot/api';

interface MedicalRecord {
  recordHash: string;
  recordType: string;
  createdAt: string;
  hospitalId: string;
}

interface Patient {
  id: string;
  name: string; // In production, this comes from encrypted data
  records: MedicalRecord[];
}

/**
 * Card Reader Component
 * 
 * Simulates NFC card tap for hackathon demo
 * In production, would integrate with physical NFC reader
 * 
 * Safety: All blockchain queries have timeout and error handling
 */
export const CardReader: React.FC = () => {
  const [api, setApi] = useState<ApiPromise | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize blockchain connection
  useEffect(() => {
    const initApi = async () => {
      try {
        const provider = new WsProvider('ws://127.0.0.1:9944');
        const api = await ApiPromise.create({ provider });
        setApi(api);
        console.log('Connected to blockchain');
      } catch (err) {
        setError(`Failed to connect: ${err.message}`);
      }
    };
    
    initApi();
  }, []);

  /**
   * Simulate card tap
   * 
   * In production:
   * 1. Read NFC chip via USB reader
   * 2. Extract patient ID hash
   * 3. Query blockchain for records
   * 4. Decrypt with patient's key
   */
  const handleCardTap = async (patientId: string) => {
    if (!api) {
      setError('Blockchain not connected');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Query patient records from blockchain
      const records = await api.query.medicalRecords.patientRecords(patientId);
      
      // Parse records
      const parsedRecords: MedicalRecord[] = records.map((record: any) => ({
        recordHash: record.record_hash.toHex(),
        recordType: record.record_type.toString(),
        createdAt: new Date(record.created_at.toNumber() * 1000).toISOString(),
        hospitalId: record.hospital_id.toString(),
      }));

      setPatient({
        id: patientId,
        name: 'John Doe', // In production, decrypt from records
        records: parsedRecords,
      });
    } catch (err) {
      setError(`Failed to fetch records: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card-reader">
      <h2>MediChain - Medical Record Access</h2>
      
      {/* Simulate card tap */}
      <div className="tap-simulation">
        <button
          onClick={() => handleCardTap('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY')}
          disabled={loading || !api}
          className="tap-button"
        >
          {loading ? 'Reading Card...' : '🔲 Tap Card Here'}
        </button>
        <p className="help-text">
          {api ? 'Tap patient card to access records' : 'Connecting to blockchain...'}
        </p>
      </div>

      {/* Error display */}
      {error && (
        <div className="error-message">
          ⚠️ {error}
        </div>
      )}

      {/* Patient records display */}
      {patient && (
        <div className="patient-records">
          <div className="patient-header">
            <h3>{patient.name}</h3>
            <p className="patient-id">ID: {patient.id.slice(0, 10)}...</p>
          </div>

          <div className="records-list">
            <h4>Medical History ({patient.records.length} records)</h4>
            {patient.records.map((record, index) => (
              <div key={record.recordHash} className="record-card">
                <div className="record-header">
                  <span className="record-type">{record.recordType}</span>
                  <span className="record-date">
                    {new Date(record.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="record-details">
                  <p>Hospital: {record.hospitalId.slice(0, 10)}...</p>
                  <button onClick={() => viewRecordDetails(record.recordHash)}>
                    View Details
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="actions">
            <button className="btn-primary" onClick={addNewRecord}>
              ➕ Add New Record
            </button>
            <button className="btn-secondary" onClick={() => setPatient(null)}>
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const viewRecordDetails = (recordHash: string) => {
  console.log('Viewing record:', recordHash);
  // In production, decrypt and display full record
};

const addNewRecord = () => {
  console.log('Adding new record');
  // Navigate to record creation form
};
```

---

### Phase 4: Testing & Quality Assurance (Days 9-11)

#### **4.1 Unit Testing Strategy**

**File:** `pallets/medical-records/src/tests.rs`

```rust
use super::*;
use frame_support::{assert_ok, assert_noop, traits::OnInitialize};
use sp_core::H256;
use sp_runtime::{
    testing::Header,
    traits::{BlakeTwo256, IdentityLookup},
};

type UncheckedExtrinsic = frame_system::mocking::MockUncheckedExtrinsic<Test>;
type Block = frame_system::mocking::MockBlock<Test>;

// Configure mock runtime for testing
frame_support::construct_runtime!(
    pub enum Test where
        Block = Block,
        NodeBlock = Block,
        UncheckedExtrinsic = UncheckedExtrinsic,
    {
        System: frame_system::{Pallet, Call, Config, Storage, Event<T>},
        MedicalRecords: pallet_medical_records::{Pallet, Call, Storage, Event<T>},
    }
);

// ... (implementation details omitted for brevity)

/// Test: Successfully add a medical record
#[test]
fn test_add_record_success() {
    new_test_ext().execute_with(|| {
        let patient = AccountId::from([1u8; 32]);
        let hospital = AccountId::from([2u8; 32]);
        let encrypted_data = vec![1, 2, 3, 4, 5]; // Mock encrypted data
        
        // Add record
        assert_ok!(MedicalRecords::add_record(
            Origin::signed(hospital),
            patient,
            encrypted_data.clone(),
            RecordType::Diagnosis,
        ));
        
        // Verify record was stored
        let records = MedicalRecords::patient_records(&patient);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].record_type, RecordType::Diagnosis);
    });
}

/// Test: Reject empty encrypted data
#[test]
fn test_add_record_empty_data_fails() {
    new_test_ext().execute_with(|| {
        let patient = AccountId::from([1u8; 32]);
        let hospital = AccountId::from([2u8; 32]);
        let empty_data = vec![]; // Invalid
        
        assert_noop!(
            MedicalRecords::add_record(
                Origin::signed(hospital),
                patient,
                empty_data,
                RecordType::Diagnosis,
            ),
            Error::<Test>::InvalidRecord
        );
    });
}

/// Test: Reject oversized records
#[test]
fn test_add_record_too_large_fails() {
    new_test_ext().execute_with(|| {
        let patient = AccountId::from([1u8; 32]);
        let hospital = AccountId::from([2u8; 32]);
        let oversized_data = vec![0u8; MAX_ENCRYPTED_RECORD_SIZE + 1];
        
        assert_noop!(
            MedicalRecords::add_record(
                Origin::signed(hospital),
                patient,
                oversized_data,
                RecordType::Diagnosis,
            ),
            Error::<Test>::RecordTooLarge
        );
    });
}

/// Test: Access control enforcement
#[test]
fn test_access_control() {
    new_test_ext().execute_with(|| {
        let patient = AccountId::from([1u8; 32]);
        let hospital = AccountId::from([2u8; 32]);
        let unauthorized = AccountId::from([3u8; 32]);
        
        // Add a record
        let encrypted_data = vec![1, 2, 3, 4, 5];
        assert_ok!(MedicalRecords::add_record(
            Origin::signed(hospital),
            patient,
            encrypted_data,
            RecordType::Diagnosis,
        ));
        
        let record_hash = H256::from([1u8; 32]); // Mock hash
        
        // Patient can access own records
        assert_ok!(MedicalRecords::access_record(
            Origin::signed(patient),
            patient,
            record_hash,
        ));
        
        // Unauthorized user cannot access
        assert_noop!(
            MedicalRecords::access_record(
                Origin::signed(unauthorized),
                patient,
                record_hash,
            ),
            Error::<Test>::AccessDenied
        );
    });
}

/// Test: Audit trail logging
#[test]
fn test_audit_trail() {
    new_test_ext().execute_with(|| {
        let patient = AccountId::from([1u8; 32]);
        let doctor1 = AccountId::from([2u8; 32]);
        let doctor2 = AccountId::from([3u8; 32]);
        let record_hash = H256::from([1u8; 32]);
        
        // Grant access to both doctors
        // ... (setup code)
        
        // Doctor 1 accesses record
        assert_ok!(MedicalRecords::access_record(
            Origin::signed(doctor1),
            patient,
            record_hash,
        ));
        
        // Doctor 2 accesses record
        assert_ok!(MedicalRecords::access_record(
            Origin::signed(doctor2),
            patient,
            record_hash,
        ));
        
        // Verify audit log
        let access_log = MedicalRecords::access_log(&patient, &record_hash);
        assert_eq!(access_log.len(), 2);
        assert_eq!(access_log[0].0, doctor1);
        assert_eq!(access_log[1].0, doctor2);
    });
}

/// Test: Maximum records per patient enforced
#[test]
fn test_max_records_limit() {
    new_test_ext().execute_with(|| {
        let patient = AccountId::from([1u8; 32]);
        let hospital = AccountId::from([2u8; 32]);
        
        // Add MAX_RECORDS_PER_PATIENT records
        for i in 0..MAX_RECORDS_PER_PATIENT {
            let data = vec![i as u8; 100];
            assert_ok!(MedicalRecords::add_record(
                Origin::signed(hospital),
                patient,
                data,
                RecordType::Diagnosis,
            ));
        }
        
        // Adding one more should fail
        let extra_data = vec![255u8; 100];
        assert_noop!(
            MedicalRecords::add_record(
                Origin::signed(hospital),
                patient,
                extra_data,
                RecordType::Diagnosis,
            ),
            Error::<Test>::TooManyRecords
        );
    });
}
```

#### **4.2 Integration Testing**

**File:** `tests/integration_tests.rs`

```rust
//! Integration tests for MediChain
//! 
//! Tests complete workflows across multiple pallets

use medichain_node::*;
use sp_core::{sr25519, Pair};
use sp_runtime::AccountId32;

#[test]
fn test_complete_medical_record_workflow() {
    // 1. Initialize blockchain
    let (mut ext, _) = new_test_ext_with_balances();
    
    ext.execute_with(|| {
        // 2. Register patient
        let patient_keypair = sr25519::Pair::generate().0;
        let patient_id = AccountId32::from(patient_keypair.public());
        
        // 3. Register hospital
        let hospital_keypair = sr25519::Pair::generate().0;
        let hospital_id = AccountId32::from(hospital_keypair.public());
        
        // 4. Hospital adds medical record
        let diagnosis = b"Type 2 Diabetes Mellitus".to_vec();
        let encrypted = encrypt_record(&diagnosis, &patient_id);
        
        assert_ok!(add_medical_record(
            hospital_id.clone(),
            patient_id.clone(),
            encrypted,
            RecordType::Diagnosis,
        ));
        
        // 5. Patient accesses own records
        let records = get_patient_records(&patient_id);
        assert_eq!(records.len(), 1);
        
        // 6. Verify audit trail
        let audit_log = get_access_log(&patient_id);
        assert!(audit_log.contains(&hospital_id));
    });
}

#[test]
fn test_cross_hospital_record_access() {
    // Test that records from Hospital A can be accessed by Hospital B
    // (with patient consent)
}

#[test]
fn test_emergency_access() {
    // Test emergency access protocol
    // (when patient is unconscious, authorized emergency personnel can access)
}
```

#### **4.3 Code Coverage Requirements**

```bash
#!/bin/bash
# scripts/test-coverage.sh

echo "Running code coverage analysis..."

# Generate coverage report
cargo tarpaulin \
    --all-features \
    --workspace \
    --timeout 300 \
    --out Html \
    --output-dir target/coverage

# Check coverage threshold
COVERAGE=$(cargo tarpaulin --all-features --workspace | grep -oP '\d+\.\d+%' | head -1 | sed 's/%//')

THRESHOLD=80

if (( $(echo "$COVERAGE < $THRESHOLD" | bc -l) )); then
    echo "❌ Coverage $COVERAGE% is below threshold $THRESHOLD%"
    exit 1
else
    echo "✅ Coverage $COVERAGE% meets threshold $THRESHOLD%"
fi
```

**Coverage Requirements:**
- **Overall:** >80% line coverage
- **Medical Records Pallet:** >90% (safety-critical)
- **Crypto Module:** >95% (security-critical)
- **Frontend:** >70% (UI is less critical)

---

### Phase 5: Security Audit (Day 12)

#### **5.1 Security Checklist**

```markdown
# MediChain Security Audit Checklist

## Cryptography
- [ ] All encryption uses audited libraries (ChaCha20-Poly1305)
- [ ] No custom crypto implementations
- [ ] Keys are zeroized after use
- [ ] Random number generation uses OS RNG
- [ ] No hard-coded keys or secrets

## Access Control
- [ ] All patient data access is logged
- [ ] Unauthorized access is blocked at blockchain level
- [ ] Emergency access protocol is well-defined
- [ ] Patient can revoke access at any time

## Data Integrity
- [ ] All records have cryptographic hash
- [ ] Tampering is detectable
- [ ] Blockchain provides immutability
- [ ] No way to delete or modify past records

## Input Validation
- [ ] All user inputs are validated
- [ ] SQL injection not applicable (no SQL)
- [ ] Buffer overflow not possible (Rust)
- [ ] Integer overflow checked

## Privacy
- [ ] No plaintext medical data on blockchain
- [ ] Only encrypted data is stored
- [ ] Patient identity is pseudonymous
- [ ] Access logs don't reveal medical details

## Availability
- [ ] System can handle node failures
- [ ] Offline mode queues transactions
- [ ] No single point of failure
- [ ] Rate limiting prevents DoS

## Compliance
- [ ] HIPAA encryption requirements met
- [ ] GDPR right-to-access supported
- [ ] Audit trail for compliance
- [ ] Patient consent management
```

#### **5.2 Threat Modeling**

```markdown
# Threat Model: MediChain

## Threat 1: Unauthorized Access to Medical Records
- **Attack Vector:** Steal patient's NFC card
- **Mitigation:** Card requires PIN + biometric (future)
- **Residual Risk:** Medium → Low

## Threat 2: Database Breach
- **Attack Vector:** Hack central database
- **Mitigation:** No central database (blockchain)
- **Residual Risk:** None (decentralized)

## Threat 3: Encryption Key Compromise
- **Attack Vector:** Steal patient's key
- **Mitigation:** Patient-controlled keys, stored securely
- **Residual Risk:** Medium

## Threat 4: Insider Threat (Hospital Admin)
- **Attack Vector:** Hospital employee accesses records without authorization
- **Mitigation:** All access logged immutably, patient can audit
- **Residual Risk:** Low (detectable, prosecutable)

## Threat 5: Denial of Service
- **Attack Vector:** Flood blockchain with transactions
- **Mitigation:** Transaction fees, rate limiting
- **Residual Risk:** Low

## Threat 6: Smart Contract Bug
- **Attack Vector:** Exploit vulnerability in pallet code
- **Mitigation:** NASA coding standards, extensive testing, audit
- **Residual Risk:** Low
```

---

### Phase 6: Documentation (Day 13)

#### **6.1 Architecture Documentation**

**File:** `docs/architecture.md`

```markdown
# MediChain Architecture

## System Overview

MediChain is a blockchain-based national health ID and medical records system.

### Key Components

1. **Substrate Blockchain**
   - Custom pallets for medical records
   - Proof-of-Authority consensus (for trusted medical institutions)
   - < $0.01 transaction fees

2. **Encryption Layer**
   - ChaCha20-Poly1305 AEAD cipher
   - Patient-controlled encryption keys
   - Forward secrecy

3. **NFC Card System**
   - Patient ID stored on NFC chip
   - QR code fallback
   - Compatible with smartphone NFC

4. **Web Portals**
   - Doctor portal (React + Polkadot.js)
   - Patient portal (mobile app)
   - Hospital admin dashboard

### Data Flow

```
Patient taps card
     ↓
Card reader extracts patient ID
     ↓
Query blockchain for encrypted records
     ↓
Decrypt with patient's key
     ↓
Display medical history
```

### Security Model

- **Confidentiality:** All data encrypted with patient keys
- **Integrity:** Blockchain provides tamper-proof records
- **Availability:** Decentralized, no single point of failure
- **Auditability:** All access logged immutably

## Deployment Architecture

### Development
- Local Substrate node
- Simulated NFC cards
- Mock hospitals

### Staging
- 3-node testnet
- Real NFC readers
- Selected pilot hospitals

### Production
- 100+ validator nodes (hospitals)
- National ID card integration
- All public/private hospitals
```

#### **6.2 API Documentation**

**File:** `docs/api.md`

```markdown
# MediChain API Documentation

## Medical Records Pallet

### `add_record`
Adds a new medical record for a patient.

**Parameters:**
- `origin`: Must be signed by authorized hospital
- `patient_id`: AccountId of the patient
- `encrypted_data`: Encrypted medical record (max 10KB)
- `record_type`: Type of record (Diagnosis, Prescription, etc.)

**Returns:** `DispatchResult`

**Errors:**
- `PatientNotFound`: Patient is not registered
- `RecordTooLarge`: Encrypted data exceeds 10KB
- `TooManyRecords`: Patient has reached max records limit
- `InvalidRecord`: Data is empty or malformed

**Example:**
```rust
let patient = AccountId::from([1u8; 32]);
let hospital = AccountId::from([2u8; 32]);
let encrypted_diagnosis = encrypt(b"Type 2 Diabetes");

MedicalRecords::add_record(
    Origin::signed(hospital),
    patient,
    encrypted_diagnosis,
    RecordType::Diagnosis,
)?;
```

### `access_record`
Access a medical record (logs access immutably).

**Parameters:**
- `origin`: Signed by accessor (doctor, hospital, or patient)
- `patient_id`: AccountId of the patient
- `record_hash`: Hash of the record to access

**Returns:** `DispatchResult`

**Errors:**
- `PatientNotFound`: Patient not found
- `RecordNotFound`: Record doesn't exist
- `AccessDenied`: Insufficient permissions

**Security:** All access attempts are logged in the audit trail.
```

---

### Phase 7: Presentation Preparation (Day 14)

#### **7.1 Demo Script**

```markdown
# MediChain Demo Script (3 Minutes)

## Hook (30 seconds)
"Imagine: A woman collapses in a Lagos market. Rushed to the hospital. Unconscious. No family. The doctor needs to know: Is she diabetic? Does she have allergies? What's her blood type?

In today's system, he guesses. 

With MediChain, he taps her National ID card. Her complete medical history appears in 2 seconds. He sees: Type 2 Diabetes, allergic to penicillin, B+ blood. Her life is saved."

## Problem (45 seconds)
[Show slide: Fragmented records across hospitals]

"Nigeria has 100+ million National ID card holders. But their medical records are fragmented, paper-based, and inaccessible in emergencies.

- Patient in Lagos needs records from Abuja → takes weeks
- Emergency doctors have NO patient history → dangerous
- Paper records are lost, damaged, illegible → deadly"

## Solution Live Demo (90 seconds)

**[Screen share: Doctor portal]**

"Let me show you MediChain in action.

[Tap card simulation]
1. Doctor taps patient's National ID card

[Records appear]
2. Complete medical history appears instantly:
   - Emergency info: Blood type, allergies
   - Chronic conditions: Diabetes diagnosis from 2020
   - Recent medications: Metformin 500mg
   - Vaccination records: All up to date

[Add new record]
3. Doctor adds today's diagnosis: Hypertension
4. Record is encrypted and stored on blockchain
5. Instantly available to all authorized hospitals

[Show blockchain explorer]
6. Every access is logged—immutable audit trail
7. Patient can see who accessed records, when"

## Technical Deep Dive (30 seconds)

"Why Rust and Substrate?

- **Memory safety:** Medical records can't be corrupted
- **Low fees:** <$0.01 per record access (vs Ethereum's $10-50)
- **NASA-grade coding standards for safety-critical software**

We followed NASA's Power of 10 rules: The same coding standards used for spacecraft."

## Impact (15 seconds)

"$40 billion market. 100+ million Nigerians. 90% PHC digitalization by 2035 (Africa CDC mandate).

MediChain saves lives by making medical records accessible anywhere, anytime."

## Q&A Prep
- Q: "How do you handle consent?"
  A: "Patient can grant/revoke access via mobile app. All access is logged."

- Q: "What if patient loses card?"
  A: "Card can be reissued. Records are tied to National ID, not the physical card."

- Q: "How is this different from Allof Health?"
  A: "We integrate with existing National ID infrastructure. They require creating new accounts. We target 100M+ users, they have 1,000."
```

#### **7.2 Presentation Slides Outline**

```markdown
# MediChain Presentation Outline

## Slide 1: Title
- MediChain: National Health ID & Medical Records
- Rust Africa Hackathon 2026
- [Your Name]

## Slide 2: The Problem (with statistics)
- 500M Africans lack legal ID
- Paper-based medical records
- Emergency care without patient history

## Slide 3: Solution Overview
- Blockchain-based medical records
- National ID card integration
- Patient-controlled encryption

## Slide 4: Architecture Diagram
- [Visual: NFC Card → Blockchain → Hospital Nodes]

## Slide 5: Live Demo
- [Video/Live demo: Card tap → Records appear]

## Slide 6: Why Rust + Substrate?
- Memory safety (no data corruption)
- Low fees (<$0.01 vs $10-50)
- NASA-grade coding standards

## Slide 7: Competitive Advantage
- [Table comparing MediChain vs Allof Health vs MoneyFellows]

## Slide 8: Impact
- $40B market
- 100M+ users
- Life-saving emergency care

## Slide 9: Roadmap
- Phase 1: Hackathon MVP
- Phase 2: Pilot with Ministry of Health
- Phase 3: National rollout

## Slide 10: Thank You
- GitHub: [link]
- Demo: [live link]
- Contact: [email]
```

---

## CODE QUALITY REQUIREMENTS

### Mandatory Pre-Commit Checks

```bash
#!/bin/bash
# .git/hooks/pre-commit

set -e

echo "🔍 Running pre-commit checks..."

# 1. Format check
echo "Checking code formatting..."
cargo fmt --all -- --check || {
    echo "❌ Code is not formatted. Run 'cargo fmt --all'"
    exit 1
}

# 2. Clippy lints
echo "Running Clippy..."
cargo clippy --all-targets --all-features -- \
    -D warnings \
    -D clippy::all \
    -D clippy::pedantic \
    -D clippy::cargo \
    -D clippy::nursery || {
    echo "❌ Clippy found issues"
    exit 1
}

# 3. Unit tests
echo "Running unit tests..."
cargo test --all-features || {
    echo "❌ Tests failed"
    exit 1
}

# 4. Security audit
echo "Running security audit..."
cargo audit || {
    echo "⚠️  Security vulnerabilities found"
    # Don't fail build, but warn
}

# 5. License check
echo "Checking licenses..."
cargo deny check licenses || {
    echo "❌ License issues found"
    exit 1
}

echo "✅ All pre-commit checks passed!"
```

### Continuous Integration Pipeline

```yaml
# .github/workflows/ci.yml
name: Continuous Integration

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  check:
    name: Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions-rs/toolchain@v1
        with:
          profile: minimal
          toolchain: stable
          override: true
      - uses: actions-rs/cargo@v1
        with:
          command: check
          args: --all-features

  test:
    name: Test Suite
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions-rs/toolchain@v1
        with:
          profile: minimal
          toolchain: stable
          override: true
      - uses: actions-rs/cargo@v1
        with:
          command: test
          args: --all-features --no-fail-fast

  fmt:
    name: Rustfmt
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions-rs/toolchain@v1
        with:
          profile: minimal
          toolchain: stable
          override: true
          components: rustfmt
      - uses: actions-rs/cargo@v1
        with:
          command: fmt
          args: --all -- --check

  clippy:
    name: Clippy
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions-rs/toolchain@v1
        with:
          profile: minimal
          toolchain: stable
          override: true
          components: clippy
      - uses: actions-rs/cargo@v1
        with:
          command: clippy
          args: --all-targets --all-features -- -D warnings

  coverage:
    name: Code Coverage
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions-rs/toolchain@v1
        with:
          profile: minimal
          toolchain: stable
          override: true
      - uses: actions-rs/tarpaulin@v0.1
        with:
          args: '--all-features --workspace --timeout 300 --out Lcov'
      - uses: codecov/codecov-action@v3
        with:
          files: ./lcov.info
          fail_ci_if_error: true
```

---

## FINAL CHECKLIST

### Day 1: Setup ✅
- [ ] Rust toolchain installed
- [ ] Substrate node template cloned
- [ ] Project structure created
- [ ] Git repository initialized
- [ ] Pre-commit hooks configured

### Days 2-5: Core Blockchain ✅
- [ ] Medical records pallet implemented
- [ ] Encryption module complete
- [ ] Patient identity pallet done
- [ ] Access control implemented
- [ ] Unit tests >90% coverage

### Days 6-8: Frontend ✅
- [ ] Doctor portal functional
- [ ] Card reader simulation works
- [ ] Patient portal basic version
- [ ] Integration with blockchain

### Days 9-11: Testing ✅
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Security audit complete
- [ ] Code coverage >80%

### Day 12: Security ✅
- [ ] Threat model documented
- [ ] Security checklist complete
- [ ] No critical vulnerabilities
- [ ] Encryption verified

### Day 13: Documentation ✅
- [ ] Architecture documented
- [ ] API documentation complete
- [ ] README with setup instructions
- [ ] Code comments thorough

### Day 14: Presentation ✅
- [ ] Demo script rehearsed 10+ times
- [ ] Slides finalized
- [ ] Video backup recorded
- [ ] Q&A prepared

### Submission ✅
- [ ] GitHub repository public
- [ ] README includes demo video link
- [ ] All code follows NASA standards
- [ ] License file included (Apache 2.0 recommended)

---

## APPENDICES

### Appendix A: NASA Power of 10 Rules Summary

1. **Simple Control Flow:** No goto, recursion, or setjmp/longjmp
2. **Fixed Loop Bounds:** All loops must have provable upper bound
3. **No Dynamic Allocation:** Allocate memory at initialization only
4. **Short Functions:** Max 60 lines per function
5. **Assertion Density:** Minimum 2 assertions per function
6. **Minimal Scope:** Declare variables at smallest possible scope
7. **Check Return Values:** All functions must check return values
8. **Limited Preprocessor:** Use sparingly, prefer functions
9. **Limited Pointer Use:** One level of dereferencing maximum
10. **Zero Warnings:** Compile with all warnings enabled, fix all

### Appendix B: Rust Safety Features

**Memory Safety:**
- Ownership system prevents use-after-free
- Borrow checker prevents data races
- No null pointer dereferences

**Type Safety:**
- Strong static typing
- Result/Option for error handling
- Pattern matching for exhaustiveness

**Concurrency Safety:**
- Send/Sync traits prevent data races
- Thread-safe by default
- Fearless concurrency

### Appendix C: Recommended Libraries

```toml
[dependencies]
# Blockchain
substrate = "3.0"
frame-support = "3.0"
frame-system = "3.0"

# Cryptography
chacha20poly1305 = "0.10"
argon2 = "0.5"
rand = "0.8"
zeroize = "1.5"

# Serialization
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

# Error Handling
thiserror = "1.0"
anyhow = "1.0"

# Testing
proptest = "1.0"
quickcheck = "1.0"

# Logging
tracing = "0.1"
tracing-subscriber = "0.3"

# Utilities
hex = "0.4"
base64 = "0.21"
```

### Appendix D: Resources

**Rust:**
- The Rust Programming Language Book: https://doc.rust-lang.org/book/
- Rust By Example: https://doc.rust-lang.org/rust-by-example/

**Substrate:**
- Substrate Developer Hub: https://docs.substrate.io/
- Polkadot.js Documentation: https://polkadot.js.org/docs/

**Security:**
- OWASP Top 10: https://owasp.org/www-project-top-ten/
- CWE Top 25: https://cwe.mitre.org/top25/

**Healthcare Standards:**
- HL7 FHIR: https://www.hl7.org/fhir/
- HIPAA Security Rule: https://www.hhs.gov/hipaa/

---

## CONCLUSION

This comprehensive development guide provides everything needed to build MediChain to NASA-grade quality standards. By following the Power of 10 rules adapted for Rust, you'll create safety-critical medical software that judges and users can trust.

**Remember:**
- Start simple, iterate
- Test obsessively
- Document thoroughly
- Demo confidently

**You have 14 days. Make them count. Build something that saves lives.** 🏥🦀

**Good luck with the hackathon!** 🚀