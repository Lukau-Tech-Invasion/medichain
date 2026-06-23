//! Clinical Documentation API Endpoints (Phase 2-8)
//!
//! This module provides REST API endpoints for all clinical documentation types.
//! Uses generic CRUD pattern: clients submit complete structs from clinical.rs
//!
//! © 2025 Trustware. All rights reserved.

use crate::clinical;
pub use crate::clinical::*;
pub use crate::repositories::traits::*;
pub use crate::types::*;
pub use actix_web::{delete, get, post, web, HttpRequest, HttpResponse, Responder};
pub use chrono::Utc;
pub use serde::Deserialize;

// Internal helpers accessible to submodules
pub(crate) use crate::get_current_user_id;
pub(crate) use crate::get_user;
pub(crate) use crate::state::AppState;

// ---------------------------------------------------------------------------
// Domain submodules (split from the original 21K-line monolith — Phase 10.1).
// Each submodule does `use super::*;` to inherit the shared imports above and
// is glob-re-exported, so existing `crate::clinical_endpoints::<handler>` paths
// (route registrations in main.rs) remain unchanged.
// ---------------------------------------------------------------------------
mod assessment;
mod billing;
mod clinical_support;
mod emergency;
pub(crate) mod emergency_access;
mod engagement;
mod fhir;
mod insurance_pharmacy;
mod lab;
mod medical_id;
mod physician;
mod platform;
mod surgical;
mod workflow;

pub use assessment::*;
pub use billing::*;
pub use clinical_support::*;
pub use emergency::*;
pub use engagement::*;
pub use fhir::*;
pub use insurance_pharmacy::*;
pub use lab::*;
pub use medical_id::*;
pub use physician::*;
pub use platform::*;
pub use surgical::*;
pub use workflow::*;
