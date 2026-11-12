//! Laboratory handlers: result submission and review, panel templates,
//! specimens, rejections and recollection, critical values, quality control
//! and chain of custody.

mod chain_of_custody;
mod critical_values;
mod panels;
mod quality_control;
mod specimen_rejections;
mod specimens;
mod submissions;

pub use chain_of_custody::*;
pub use critical_values::*;
pub use panels::*;
pub use quality_control::*;
pub use specimen_rejections::*;
pub use specimens::*;
pub use submissions::*;
