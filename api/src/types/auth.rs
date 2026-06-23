use super::*;

// ============================================================================
// Wallet-Based Authentication Request/Response Types
// ============================================================================

/// Request to register a new user with their wallet address
#[derive(Debug, Deserialize)]
pub struct WalletRegisterRequest {
    /// SS58 encoded wallet address
    pub wallet_address: String,
    /// Full name
    pub name: String,
    /// Optional username for display
    pub username: Option<String>,
    /// Role (only Admin can register healthcare providers)
    pub role: String,
}

/// Response for wallet registration
#[derive(Debug, Serialize)]
pub struct WalletRegisterResponse {
    pub success: bool,
    pub wallet_address: String,
    pub role: String,
    pub message: String,
}

/// Request to verify/login with wallet
#[derive(Debug, Deserialize)]
pub struct WalletLoginRequest {
    /// SS58 encoded wallet address
    pub wallet_address: String,
}

/// Request body for POST /api/auth/session
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct SessionCreateRequest {
    /// SS58 encoded wallet address
    pub wallet_address: String,
    /// Optional signature over the challenge (for future verification)
    pub signature: Option<String>,
    /// Optional challenge string that was signed
    pub challenge: Option<String>,
}

/// Response for POST /api/auth/session
#[derive(Debug, Serialize)]
pub struct SessionCreateResponse {
    pub success: bool,
    pub token: String,
    pub expires_at: i64,
    pub wallet_address: String,
}

/// Response for GET /api/auth/verify
#[derive(Debug, Serialize)]
pub struct SessionVerifyResponse {
    pub success: bool,
    pub wallet_address: String,
    pub expires_at: i64,
}

/// Response for wallet login
#[derive(Debug, Serialize)]
pub struct WalletLoginResponse {
    pub success: bool,
    pub user: Option<WalletUserInfo>,
    pub message: String,
}

/// User info returned on login
#[derive(Debug, Serialize)]
pub struct WalletUserInfo {
    pub wallet_address: String,
    pub name: String,
    pub username: Option<String>,
    pub role: String,
    pub linked_patient_id: Option<String>,
}

// ============================================================================
// RBAC Request/Response Types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct AssignRoleRequest {
    /// Wallet address of the user to assign role to
    pub wallet_address: String,
    /// Full name of the user
    pub name: String,
    /// Optional username
    pub username: Option<String>,
    /// Role to assign
    pub role: String,
}

#[derive(Debug, Serialize)]
pub struct AssignRoleResponse {
    pub success: bool,
    pub wallet_address: String,
    pub role: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct RevokeRoleRequest {
    pub wallet_address: String,
}

#[derive(Debug, Serialize)]
pub struct RevokeRoleResponse {
    pub success: bool,
    pub wallet_address: String,
    pub message: String,
}

/// Standard error body returned by every failing handler.
///
/// Phase 9.5: this struct keeps its existing fields so the ~1000 construction
/// sites compile unchanged, but it serializes to the **canonical error envelope**
/// `{ "error": { "code": <code>, "message": <message> } }` via a hand-written
/// `Serialize` impl that delegates to
/// [`crate::middleware::error_handling::error_envelope_json`] (the single source
/// of truth for the error shape). The legacy top-level `success`/`error`/`code`
/// fields are no longer emitted on the wire.
#[derive(Debug)]
pub struct ErrorResponse {
    /// Retained only so the ~1000 existing `ErrorResponse { success: false, .. }`
    /// construction sites keep compiling; it is no longer emitted on the wire
    /// (Phase 9.5 canonical envelope drops the top-level `success` flag).
    #[allow(dead_code)]
    pub success: bool,
    pub error: String,
    pub code: String,
}

impl serde::Serialize for ErrorResponse {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        crate::middleware::error_handling::error_envelope_json(&self.code, &self.error, None)
            .serialize(serializer)
    }
}
