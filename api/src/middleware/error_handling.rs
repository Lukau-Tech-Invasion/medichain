//! Error Handling Utilities for MediChain API
//!
//! Provides consistent error handling patterns to replace `.unwrap()` calls
//! and improve API stability.
//!
//! © 2025-2026 Trustware. All rights reserved.

use actix_web::{http::StatusCode, HttpResponse};
use serde::Serialize;
use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

/// Standard API error response format
#[allow(dead_code)]
#[derive(Debug)]
pub struct ApiError {
    pub success: bool,
    pub error: String,
    pub code: String,
    pub details: Option<String>,
    pub request_id: Option<String>,
}

impl Serialize for ApiError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        // Phase 9.5: emit the canonical error envelope. `details` and
        // `request_id` (when present) are folded into the nested `details` object.
        let details = match (&self.details, &self.request_id) {
            (None, None) => None,
            (d, r) => {
                let mut obj = serde_json::Map::new();
                if let Some(d) = d {
                    obj.insert("details".to_string(), serde_json::Value::String(d.clone()));
                }
                if let Some(r) = r {
                    obj.insert("request_id".to_string(), serde_json::Value::String(r.clone()));
                }
                Some(serde_json::Value::Object(obj))
            }
        };
        error_envelope_json(&self.code, &self.error, details).serialize(serializer)
    }
}

#[allow(dead_code)]
impl ApiError {
    /// Create a new API error
    pub fn new(code: &str, error: &str) -> Self {
        Self {
            success: false,
            error: error.to_string(),
            code: code.to_string(),
            details: None,
            request_id: None,
        }
    }

    /// Add details to the error
    pub fn with_details(mut self, details: &str) -> Self {
        self.details = Some(details.to_string());
        self
    }

    /// Add request ID for tracing
    pub fn with_request_id(mut self, request_id: &str) -> Self {
        self.request_id = Some(request_id.to_string());
        self
    }

    /// Convert to HttpResponse with specified status code
    pub fn into_response(self, status: StatusCode) -> HttpResponse {
        HttpResponse::build(status).json(self)
    }

    /// Create a 400 Bad Request response
    pub fn bad_request(self) -> HttpResponse {
        self.into_response(StatusCode::BAD_REQUEST)
    }

    /// Create a 401 Unauthorized response
    pub fn unauthorized(self) -> HttpResponse {
        self.into_response(StatusCode::UNAUTHORIZED)
    }

    /// Create a 403 Forbidden response
    pub fn forbidden(self) -> HttpResponse {
        self.into_response(StatusCode::FORBIDDEN)
    }

    /// Create a 404 Not Found response
    pub fn not_found(self) -> HttpResponse {
        self.into_response(StatusCode::NOT_FOUND)
    }

    /// Create a 500 Internal Server Error response
    pub fn internal_error(self) -> HttpResponse {
        self.into_response(StatusCode::INTERNAL_SERVER_ERROR)
    }

    /// Create a 503 Service Unavailable response
    pub fn service_unavailable(self) -> HttpResponse {
        self.into_response(StatusCode::SERVICE_UNAVAILABLE)
    }
}

/// Common error codes
#[allow(dead_code)]
pub mod error_codes {
    pub const UNAUTHORIZED: &str = "UNAUTHORIZED";
    pub const FORBIDDEN: &str = "FORBIDDEN";
    pub const NOT_FOUND: &str = "NOT_FOUND";
    pub const VALIDATION_ERROR: &str = "VALIDATION_ERROR";
    pub const INTERNAL_ERROR: &str = "INTERNAL_ERROR";
    pub const LOCK_ERROR: &str = "LOCK_ERROR";
    pub const DATABASE_ERROR: &str = "DATABASE_ERROR";
    pub const RATE_LIMIT_EXCEEDED: &str = "RATE_LIMIT_EXCEEDED";
    pub const INVALID_INPUT: &str = "INVALID_INPUT";
    pub const DUPLICATE_ENTRY: &str = "DUPLICATE_ENTRY";
    pub const INSUFFICIENT_ROLE: &str = "INSUFFICIENT_ROLE";
    pub const USER_NOT_FOUND: &str = "USER_NOT_FOUND";
    pub const PATIENT_NOT_FOUND: &str = "PATIENT_NOT_FOUND";
}

/// Build the project-standard error envelope as a JSON value:
/// `{ "error": { "code": <code>, "message": <message>, "details": <details?> } }`.
///
/// This is the canonical error shape (Phase 9.5). New and refactored handlers
/// should emit failures through this helper instead of ad-hoc JSON so every
/// error response shares one machine-readable structure with stable codes
/// (see [`error_codes`]).
pub fn error_envelope_json(
    code: &str,
    message: &str,
    details: Option<serde_json::Value>,
) -> serde_json::Value {
    let mut err = serde_json::json!({ "code": code, "message": message });
    if let Some(detail) = details {
        err["details"] = detail;
    }
    serde_json::json!({ "error": err })
}

/// Extension trait for safe RwLock access
#[allow(dead_code)]
pub trait SafeRwLock<T> {
    /// Safely acquire a read lock, returning an error response on poison
    fn safe_read(&self) -> Result<RwLockReadGuard<'_, T>, HttpResponse>;

    /// Safely acquire a write lock, returning an error response on poison
    fn safe_write(&self) -> Result<RwLockWriteGuard<'_, T>, HttpResponse>;
}

impl<T> SafeRwLock<T> for RwLock<T> {
    fn safe_read(&self) -> Result<RwLockReadGuard<'_, T>, HttpResponse> {
        self.read().map_err(|e| {
            log::error!("RwLock read poison error: {}", e);
            ApiError::new(error_codes::LOCK_ERROR, "Internal server error")
                .with_details("Lock poisoned during read operation")
                .internal_error()
        })
    }

    fn safe_write(&self) -> Result<RwLockWriteGuard<'_, T>, HttpResponse> {
        self.write().map_err(|e| {
            log::error!("RwLock write poison error: {}", e);
            ApiError::new(error_codes::LOCK_ERROR, "Internal server error")
                .with_details("Lock poisoned during write operation")
                .internal_error()
        })
    }
}

/// Macro for safe lock acquisition with early return
///
/// Usage:
/// ```rust
/// let users = safe_read!(data.users)?;
/// ```
#[macro_export]
macro_rules! safe_read {
    ($lock:expr) => {
        $lock.read().map_err(|e| {
            log::error!("RwLock read poison error: {}", e);
            actix_web::HttpResponse::InternalServerError().json(
                $crate::middleware::error_handling::error_envelope_json(
                    $crate::middleware::error_handling::error_codes::LOCK_ERROR,
                    "Internal server error",
                    None,
                ),
            )
        })
    };
}

/// Macro for safe write lock acquisition with early return
#[macro_export]
macro_rules! safe_write {
    ($lock:expr) => {
        $lock.write().map_err(|e| {
            log::error!("RwLock write poison error: {}", e);
            actix_web::HttpResponse::InternalServerError().json(
                $crate::middleware::error_handling::error_envelope_json(
                    $crate::middleware::error_handling::error_codes::LOCK_ERROR,
                    "Internal server error",
                    None,
                ),
            )
        })
    };
}

/// Secure token generation for access IDs and emergency tokens
#[allow(dead_code)]
pub mod secure_tokens {
    use sha3::{Digest, Sha3_256};
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Generate a cryptographically strong access ID
    /// Format: ACC-{timestamp_hex}{random_hex} (32 chars total)
    pub fn generate_access_id() -> String {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let random_bytes: [u8; 16] = rand_bytes();

        let mut hasher = Sha3_256::new();
        hasher.update(timestamp.to_be_bytes());
        hasher.update(random_bytes);
        let hash = hasher.finalize();

        format!("ACC-{}", hex::encode(&hash[..12]))
    }

    /// Generate a secure emergency token
    /// Format: EMG-{timestamp_hex}{random_hex}{checksum} (40 chars total)
    pub fn generate_emergency_token() -> String {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let random_bytes: [u8; 16] = rand_bytes();

        let mut hasher = Sha3_256::new();
        hasher.update(b"MEDICHAIN_EMERGENCY_");
        hasher.update(timestamp.to_be_bytes());
        hasher.update(random_bytes);
        let hash = hasher.finalize();

        format!("EMG-{}", hex::encode(&hash[..16]))
    }

    /// Generate a secure NFC tag ID
    /// Format: NFC-{random_hex} (28 chars total)
    pub fn generate_nfc_tag_id() -> String {
        let random_bytes: [u8; 16] = rand_bytes();

        let mut hasher = Sha3_256::new();
        hasher.update(b"MEDICHAIN_NFC_");
        hasher.update(random_bytes);
        let hash = hasher.finalize();

        format!("NFC-{}", hex::encode(&hash[..12]))
    }

    /// Generate random bytes using UUID as entropy source
    fn rand_bytes() -> [u8; 16] {
        let uuid1 = uuid::Uuid::new_v4();
        let uuid2 = uuid::Uuid::new_v4();
        let mut result = [0u8; 16];
        let bytes1 = uuid1.as_bytes();
        let bytes2 = uuid2.as_bytes();
        for i in 0..8 {
            result[i] = bytes1[i] ^ bytes2[i + 8];
            result[i + 8] = bytes2[i] ^ bytes1[i + 8];
        }
        result
    }
}

/// Input validation helpers
#[allow(dead_code)]
pub mod validation {
    /// Maximum allowed string length for text fields
    pub const MAX_TEXT_LENGTH: usize = 10000;
    /// Maximum allowed string length for names
    pub const MAX_NAME_LENGTH: usize = 200;
    /// Maximum allowed string length for IDs
    pub const MAX_ID_LENGTH: usize = 100;
    /// Maximum age value
    pub const MAX_AGE: u8 = 150;
    /// Maximum reasonable weight in kg
    pub const MAX_WEIGHT_KG: f64 = 700.0;
    /// Maximum reasonable height in cm
    pub const MAX_HEIGHT_CM: f64 = 300.0;

    /// Validate string length is within bounds
    pub fn validate_string_length(
        value: &str,
        field_name: &str,
        max_length: usize,
    ) -> Result<(), String> {
        if value.len() > max_length {
            return Err(format!(
                "{} exceeds maximum length of {} characters",
                field_name, max_length
            ));
        }
        Ok(())
    }

    /// Validate optional string length
    pub fn validate_optional_string_length(
        value: &Option<String>,
        field_name: &str,
        max_length: usize,
    ) -> Result<(), String> {
        if let Some(v) = value {
            validate_string_length(v, field_name, max_length)?;
        }
        Ok(())
    }

    /// Validate age is reasonable
    pub fn validate_age(age: u8) -> Result<(), String> {
        if age > MAX_AGE {
            return Err(format!("Age {} exceeds maximum of {}", age, MAX_AGE));
        }
        Ok(())
    }

    /// Validate numeric range
    pub fn validate_range<T: PartialOrd + std::fmt::Display>(
        value: T,
        field_name: &str,
        min: T,
        max: T,
    ) -> Result<(), String> {
        if value < min || value > max {
            return Err(format!(
                "{} must be between {} and {}",
                field_name, min, max
            ));
        }
        Ok(())
    }

    /// Validate wallet address format (SS58)
    pub fn validate_wallet_address(address: &str) -> Result<(), String> {
        // SS58 addresses start with 5 and are 48 characters for substrate
        if address.is_empty() {
            return Err("Wallet address cannot be empty".to_string());
        }
        if address.len() < 32 || address.len() > 64 {
            return Err("Invalid wallet address length".to_string());
        }
        // Basic character validation
        if !address.chars().all(|c| c.is_alphanumeric()) {
            return Err("Wallet address contains invalid characters".to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::validation::*;
    use super::*;

    #[test]
    fn test_api_error_creation() {
        let error = ApiError::new("TEST_ERROR", "Test error message");
        assert!(!error.success);
        assert_eq!(error.code, "TEST_ERROR");
        assert_eq!(error.error, "Test error message");
    }

    #[test]
    fn test_error_envelope_shape() {
        // Canonical 9.5 shape: { "error": { code, message, details? } }
        let without = error_envelope_json(error_codes::NOT_FOUND, "missing", None);
        assert_eq!(without["error"]["code"], error_codes::NOT_FOUND);
        assert_eq!(without["error"]["message"], "missing");
        assert!(without["error"].get("details").is_none());

        let with = error_envelope_json(
            error_codes::RATE_LIMIT_EXCEEDED,
            "slow down",
            Some(serde_json::json!({ "retry_after_secs": 30 })),
        );
        assert_eq!(with["error"]["details"]["retry_after_secs"], 30);
    }

    #[test]
    fn test_string_validation() {
        assert!(validate_string_length("short", "field", 100).is_ok());
        assert!(validate_string_length("x".repeat(101).as_str(), "field", 100).is_err());
    }

    #[test]
    fn test_age_validation() {
        assert!(validate_age(25).is_ok());
        assert!(validate_age(150).is_ok());
        assert!(validate_age(151).is_err());
    }

    #[test]
    fn test_wallet_validation() {
        assert!(
            validate_wallet_address("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY").is_ok()
        );
        assert!(validate_wallet_address("").is_err());
        assert!(validate_wallet_address("short").is_err());
    }
}
