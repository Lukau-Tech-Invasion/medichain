//! Shared data types for the MediChain API.
//!
//! Split out of `main.rs` (Phase 10.2). Re-exported at the crate root so that
//! existing `crate::<Type>` paths continue to resolve unchanged.

use crate::ipfs::MedicalRecordReference;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

mod auth;
mod conversions;
mod domain;
mod lab;
mod legal_basis;
mod records;
mod requests;

pub use auth::*;
pub use domain::*;
pub use lab::*;
pub use legal_basis::*;
pub use records::*;
pub use requests::*;
