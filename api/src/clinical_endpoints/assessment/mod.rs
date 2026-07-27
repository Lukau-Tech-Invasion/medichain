//! `clinical_endpoints::assessment` — handlers split out of the original 21K-line
//! `clinical_endpoints.rs` monolith (Phase 10.1), further split into per-domain
//! sibling modules (specialized assessments / procedures / specialty population).
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by the parent `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths
//! (route registrations in `main.rs`/`routes.rs`) remain unchanged.

pub use super::*;

mod procedures;
mod specialized;
mod specialty_population;

pub use procedures::*;
pub use specialized::*;
pub use specialty_population::*;
