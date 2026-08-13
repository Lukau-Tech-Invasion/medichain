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
    /// Work email used for account communication.
    pub email: Option<String>,
    /// Work contact number.
    pub phone: Option<String>,
    /// Facility department or service line.
    pub department: Option<String>,
    /// Professional specialty, for example Pediatrics or Radiology.
    pub specialty: Option<String>,
    /// Professional council or licence registration number.
    pub license_number: Option<String>,
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

/// User info returned on login.
///
/// Deliberately thin: this shape is also used to describe *other* people (the
/// admin bootstrap response, wallet lookup), so it carries no contact details.
/// For the caller's own identity see [`CurrentUserResponse`].
#[derive(Debug, Serialize)]
pub struct WalletUserInfo {
    pub wallet_address: String,
    pub name: String,
    pub username: Option<String>,
    pub role: String,
    pub linked_patient_id: Option<String>,
}

/// The authenticated caller's own identity, in full — the response of
/// `GET /api/auth/me`.
///
/// This is the single source the frontends build their provider context from.
/// It exists because there was no such source: every screen reached into the
/// auth store, re-derived whichever attributes it needed, and turned anything
/// it lacked into a form field for the clinician to type — which is how the
/// appointment scheduler ended up asking a logged-in doctor to enter their own
/// 48-character wallet address. Any attribute a form might otherwise demand
/// belongs here.
///
/// Self-scoped by construction — it only ever describes the caller — so unlike
/// [`WalletUserInfo`] it may carry contact and credentialing details.
#[derive(Debug, Serialize)]
pub struct CurrentUserResponse {
    pub wallet_address: String,
    pub name: String,
    pub username: Option<String>,
    pub role: String,
    pub linked_patient_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub department: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specialty: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license_number: Option<String>,
    pub status: String,
    pub permissions: UserPermissions,
}

/// Role-derived capabilities, computed server-side.
///
/// The doctor portal re-implemented this table client-side
/// (`isHealthcareProvider`, `canEditMedicalRecords`, `isAdmin` in
/// `authStore.ts`), so the client's notion of what a role may do could drift
/// from the server's. Deriving it from the same [`crate::Role`] methods the
/// handlers authorize with keeps one definition of the hierarchy.
///
/// These are **UI affordance hints only**. The server authorizes every request
/// independently and never reads these values back from a client.
#[derive(Debug, Serialize)]
pub struct UserPermissions {
    pub is_admin: bool,
    pub is_healthcare_provider: bool,
    pub can_view_medical_records: bool,
    pub can_edit_medical_records: bool,
}

impl From<&crate::Role> for UserPermissions {
    fn from(role: &crate::Role) -> Self {
        Self {
            is_admin: role.is_admin(),
            is_healthcare_provider: role.is_healthcare_provider(),
            can_view_medical_records: role.can_view_medical_records(),
            can_edit_medical_records: role.can_edit_medical_records(),
        }
    }
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
