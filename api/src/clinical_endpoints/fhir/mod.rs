//! `clinical_endpoints::fhir` — handlers split out of the original 21K-line
//! `clinical_endpoints.rs` monolith (Phase 10.1), further split into per-resource-group
//! sibling modules (patient resources / clinical resources / procedures & meta).
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by the parent `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths
//! (route registrations in `main.rs`/`routes.rs`) remain unchanged.

pub use super::*;

mod clinical_resources;
mod patient_resources;
mod procedures_and_meta;

pub use clinical_resources::*;
pub use patient_resources::*;
pub use procedures_and_meta::*;
