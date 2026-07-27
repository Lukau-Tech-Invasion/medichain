//! `clinical_endpoints::physician` — handlers split out of the original 21K-line
//! `clinical_endpoints.rs` monolith (Phase 10.1), further split into per-domain
//! sibling modules (orders / discharge / documentation).
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by the parent `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths
//! (route registrations in `main.rs`/`routes.rs`) remain unchanged.

pub use super::*;

mod discharge;
mod documentation;
mod orders;

pub use discharge::*;
pub use documentation::*;
pub use orders::*;
