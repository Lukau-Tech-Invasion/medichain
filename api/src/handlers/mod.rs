//! REST endpoint handlers for the MediChain API.
//!
//! Split out of `main.rs` (Phase 10.2). Each submodule does `use super::*;` to
//! inherit the shared imports below; handlers are glob-re-exported so existing
//! `crate::<handler>` paths (route registration) keep resolving unchanged.

use crate::clinical::*;
use crate::ipfs::{EncryptedMetadata, IpfsError, MedicalRecordReference};
use crate::middleware::error_handling::{secure_tokens, validation};
use crate::middleware::signature_auth::generate_auth_challenge;
use crate::nfc_simulator::{NFCCard, NationalIdType, QRCodeData};
use crate::repositories::*;
use crate::state::AppState;
use crate::support::*;
use crate::types::*;
use actix_web::{delete, get, post, put, web, HttpRequest, HttpResponse, Responder};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha3::{Digest, Sha3_256};
use uuid::Uuid;

mod access_logs;
mod auth_challenge;
mod auth_jwt;
mod demo;
mod gcs;
mod general;
mod insurance_cards;
mod ipfs_records;
mod lab;
mod lab_panels;
mod national_id;
mod nfc;
mod patient_admin;
mod pdf_export;
mod rbac;
mod sample;
mod session;
mod soap;
mod triage;
mod vitals;
mod wallet_auth;

pub use access_logs::*;
pub use auth_challenge::*;
pub use auth_jwt::*;
pub use demo::*;
pub use gcs::*;
pub use general::*;
pub use insurance_cards::*;
pub use ipfs_records::*;
pub use lab::*;
pub use lab_panels::*;
pub use national_id::*;
pub use nfc::*;
pub use patient_admin::*;
pub use pdf_export::*;
pub use rbac::*;
pub use sample::*;
pub use session::*;
pub use soap::*;
pub use triage::*;
pub use vitals::*;
pub use wallet_auth::*;
