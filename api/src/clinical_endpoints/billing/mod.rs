//! `clinical_endpoints::billing` — handlers split out of the original 21K-line
//! `clinical_endpoints.rs` monolith (Phase 10.1), further split into per-domain
//! sibling modules (e-prescriptions / insurance claims / insurance eligibility).
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by the parent `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths
//! (route registrations in `main.rs`/`routes.rs`) remain unchanged.

pub use super::*;

mod e_prescriptions;
mod insurance_claims;
mod insurance_eligibility;

pub use e_prescriptions::*;
pub use insurance_claims::*;
pub use insurance_eligibility::*;
