//! `clinical_endpoints::insurance_pharmacy` — handlers split out of the original 21K-line
//! `clinical_endpoints.rs` monolith (Phase 10.1), and further split from a single
//! 1.5K-line `insurance_pharmacy.rs` file into per-domain sibling modules (insurance /
//! medication reminders / drug database / drug-interaction checking).
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by the parent `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths
//! (route registrations in `main.rs`/`routes.rs`) remain unchanged.

pub use super::*;

mod drug_checking;
mod drug_database;
mod insurance;
mod medication_reminders;

pub use drug_checking::*;
pub use drug_database::*;
pub use insurance::*;
pub use medication_reminders::*;
