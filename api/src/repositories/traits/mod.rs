//! Repository trait definitions for MediChain data access.
//!
//! These traits define the contract for data persistence operations,
//! allowing for multiple backend implementations (memory, PostgreSQL).
//!
//! # Design Principles
//!
//! 1. **Async by default** - All operations are async for database compatibility
//! 2. **Result-based** - All operations return Result for error handling
//! 3. **Send + Sync** - Thread-safe for use with Actix-web
//! 4. **Bounded operations** - List operations return bounded results
//!
//! One module per domain; each holds its entities beside the trait that
//! persists them. Everything is re-exported here, so callers name
//! `repositories::traits::X` (or `repositories::X`) as before.

mod access_log;
mod cds;
mod clinical_notes;
mod common;
mod consent;
mod discharge;
mod emergency;
mod emergency_capsules;
mod ems;
mod guardian_relationships;
mod imaging;
mod immunization;
mod incident;
mod insurance;
mod json_record;
mod lab;
mod legal_holds;
mod medical_record;
mod medication_adherence;
mod nfc_tag;
mod notifications;
mod nursing;
mod patient;
mod patient_access;
mod retention;
mod retention_execution;
mod scheduling_orders;
mod specialty;
mod surgical;
mod sync;
mod triage;
mod vital_signs;

pub use access_log::*;
pub use cds::*;
pub use clinical_notes::*;
pub use common::*;
pub use consent::*;
pub use discharge::*;
pub use emergency::*;
pub use emergency_capsules::*;
pub use ems::*;
pub use guardian_relationships::*;
pub use imaging::*;
pub use immunization::*;
pub use incident::*;
pub use insurance::*;
pub use json_record::*;
pub use lab::*;
pub use legal_holds::*;
pub use medical_record::*;
pub use medication_adherence::*;
pub use nfc_tag::*;
pub use notifications::*;
pub use nursing::*;
pub use patient::*;
pub use patient_access::*;
pub use retention::*;
pub use retention_execution::*;
pub use scheduling_orders::*;
pub use specialty::*;
pub use surgical::*;
pub use sync::*;
pub use triage::*;
pub use vital_signs::*;
