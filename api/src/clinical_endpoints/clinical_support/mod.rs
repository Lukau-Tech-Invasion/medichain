//! `clinical_endpoints::clinical_support` — handlers split out of the original 21K-line
//! `clinical_endpoints.rs` monolith (Phase 10.1), and further split from a single
//! 2.4K-line `clinical_support.rs` file into per-phase sibling modules (telehealth /
//! CDS / lab trending) so each stays under the ~300-line-per-file target where the
//! underlying handler groups allow it.
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by the parent `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths
//! (route registrations in `main.rs`/`routes.rs`) remain unchanged.

pub use super::*;

mod cds;
mod lab_trends;
mod telehealth;

pub use cds::*;
pub use lab_trends::*;
pub use telehealth::*;
