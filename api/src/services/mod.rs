//! Services for MediChain API
//!
//! Contains business logic for authentication, user management, and blockchain sync.

pub mod user_service;

#[allow(unused_imports)]
pub use user_service::UserService;
