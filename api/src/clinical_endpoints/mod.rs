//! Clinical Documentation API Endpoints (Phase 2-8)
//!
//! This module provides REST API endpoints for all clinical documentation types.
//! Uses generic CRUD pattern: clients submit complete structs from clinical.rs
//!
//! © 2025 Trustware. All rights reserved.

use crate::clinical;
use crate::clinical::*;
use crate::repositories::traits::*;
use crate::{get_current_user_id, get_user, AppState, ErrorResponse};
use actix_web::{delete, get, post, web, HttpRequest, HttpResponse, Responder};
use chrono::Utc;
use serde::Deserialize;

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
