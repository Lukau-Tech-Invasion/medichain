//! User models for PostgreSQL database
//!
//! These models match the database schema and are used for SQLx queries.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// =============================================================================
// DATABASE MODELS (match PostgreSQL schema)
// =============================================================================

/// User stored in PostgreSQL database
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DbUser {
    pub id: Uuid,
    pub wallet_address: String,
    pub email: Option<String>,
    #[serde(skip_serializing)]
    pub password_hash: Option<String>,
    pub role: String,
    pub name: Option<String>,
    pub username: Option<String>,
    pub blockchain_address: Option<String>,
    pub blockchain_tx_hash: Option<String>,
    pub is_active: bool,
    pub email_verified: bool,
    pub last_login_at: Option<DateTime<Utc>>,
    pub login_count: i32,
    pub linked_patient_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub created_by: Option<String>,
}

/// User profile with extended information
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DbUserProfile {
    pub id: Uuid,
    pub user_id: Uuid,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub date_of_birth: Option<NaiveDate>,
    pub phone: Option<String>,
    pub address_line1: Option<String>,
    pub address_line2: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub license_number: Option<String>,
    pub specialty: Option<String>,
    pub department: Option<String>,
    pub preferences: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Session for authenticated users
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DbSession {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token: String,
    pub device_info: Option<String>,
    pub ip_address: Option<String>,
    pub expires_at: DateTime<Utc>,
    pub last_activity_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

// =============================================================================
// REQUEST/RESPONSE DTOs
// =============================================================================

/// Request to create a new user
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub wallet_address: String,
    pub role: String,
    pub name: Option<String>,
    pub username: Option<String>,
    pub email: Option<String>,
    pub linked_patient_id: Option<String>,
}

/// Request to update user information
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct UpdateUserRequest {
    pub name: Option<String>,
    pub username: Option<String>,
    pub email: Option<String>,
}

/// API response for user data (hides sensitive fields)
#[allow(dead_code)]
#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub wallet_address: String,
    pub role: String,
    pub name: Option<String>,
    pub username: Option<String>,
    pub email: Option<String>,
    pub is_active: bool,
    pub linked_patient_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
    pub login_count: i32,
}

impl From<DbUser> for UserResponse {
    fn from(user: DbUser) -> Self {
        Self {
            id: user.id,
            wallet_address: user.wallet_address,
            role: user.role,
            name: user.name,
            username: user.username,
            email: user.email,
            is_active: user.is_active,
            linked_patient_id: user.linked_patient_id,
            created_at: user.created_at,
            last_login_at: user.last_login_at,
            login_count: user.login_count,
        }
    }
}

/// User info combined with profile
#[allow(dead_code)]
#[derive(Debug, Serialize)]
pub struct UserWithProfile {
    #[serde(flatten)]
    pub user: UserResponse,
    pub profile: Option<DbUserProfile>,
}
