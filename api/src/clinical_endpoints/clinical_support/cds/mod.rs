//! `clinical_endpoints::clinical_support::cds` — Phase 27 clinical decision support,
//! further split into the rules engine + shared helpers vs. the HTTP handlers.
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by the parent `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths
//! (route registrations in `main.rs`/`routes.rs`) remain unchanged.

pub use super::*;

mod engine;
mod handlers;

pub use engine::*;
pub use handlers::*;
