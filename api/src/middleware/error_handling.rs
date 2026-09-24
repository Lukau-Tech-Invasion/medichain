//! Error Handling Utilities for MediChain API
//!
//! Provides consistent error handling patterns to replace `.unwrap()` calls
//! and improve API stability.
//!
//! © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.

/// Common error codes.
///
/// Handlers that adopted these use them as constants; much of the codebase
/// still writes the same codes as string literals (`"FORBIDDEN"`,
/// `"PATIENT_NOT_FOUND"`, ...). Only codes some handler reads from here are
/// kept: `FORBIDDEN`, `INVALID_INPUT` and `PATIENT_NOT_FOUND` were removed on
/// 2026-09-24 because every use of them was a literal.
pub mod error_codes {
    pub const UNAUTHORIZED: &str = "UNAUTHORIZED";
    pub const NOT_FOUND: &str = "NOT_FOUND";
    /// A conditional write whose guard no longer held: somebody else changed
    /// the record between the caller reading it and writing it back. The client
    /// reloads and retries; it is not an error in the request.
    pub const CONFLICT: &str = "CONFLICT";
    pub const VALIDATION_ERROR: &str = "VALIDATION_ERROR";
    pub const INTERNAL_ERROR: &str = "INTERNAL_ERROR";
    pub const DATABASE_ERROR: &str = "DATABASE_ERROR";
    pub const RATE_LIMIT_EXCEEDED: &str = "RATE_LIMIT_EXCEEDED";
    pub const INSUFFICIENT_ROLE: &str = "INSUFFICIENT_ROLE";
    pub const USER_NOT_FOUND: &str = "USER_NOT_FOUND";
    pub const ENCRYPTION_REQUIRED: &str = "ENCRYPTION_REQUIRED";
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

/// Secure token generation for access IDs and emergency tokens
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
pub mod validation {
    /// Maximum allowed string length for text fields
    pub const MAX_TEXT_LENGTH: usize = 10000;
    /// Maximum allowed string length for names
    pub const MAX_NAME_LENGTH: usize = 200;
    /// Maximum allowed string length for IDs
    pub const MAX_ID_LENGTH: usize = 100;
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
}

#[cfg(test)]
mod tests {
    use super::validation::*;
    use super::*;

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
}
