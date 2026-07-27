//! `clinical_endpoints::medical_id` — handlers split out of the original 21K-line
//! `clinical_endpoints.rs` monolith (Phase 10.1), further split into per-domain
//! sibling modules (core lookup / emergency views / preferences).
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by the parent `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths
//! (route registrations in `main.rs`/`routes.rs`) remain unchanged.

pub use super::*;

mod core;
mod emergency_views;
mod preferences;

pub use core::*;
pub use emergency_views::*;
pub use preferences::*;
