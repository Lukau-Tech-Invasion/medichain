use super::*;

/// The authenticated caller's own identity, in full — the response of
/// `GET /api/auth/me`.
///
/// This is the single source the frontends build their provider context from.
/// It exists because there was no such source: every screen reached into the
/// auth store, re-derived whichever attributes it needed, and turned anything
/// it lacked into a form field for the clinician to type — which is how the
/// appointment scheduler ended up asking a logged-in doctor to enter their own
/// account identifier. Any attribute a form might otherwise demand
/// belongs here.
///
/// Self-scoped by construction — it only ever describes the caller — so unlike
/// the public provider listing it may carry contact and credentialing details.
#[derive(Debug, Serialize)]
pub struct CurrentUserResponse {
    pub user_id: String,
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
    /// The user to assign the role to
    pub user_id: String,
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
    pub user_id: String,
    pub role: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct RevokeRoleRequest {
    pub user_id: String,
}

#[derive(Debug, Serialize)]
pub struct RevokeRoleResponse {
    pub success: bool,
    pub user_id: String,
    pub message: String,
}

/// Standard error body returned by every failing handler.
///
/// Serializes to the **canonical error envelope**
/// `{ "error": { "code": <code>, "message": <message> } }` via a hand-written
/// `Serialize` impl that delegates to
/// [`crate::middleware::error_handling::error_envelope_json`] (the single source
/// of truth for the error shape). The legacy top-level `success` flag, never
/// emitted since Phase 9.5, was removed from the struct and its 1,235
/// construction sites on 2026-09-24.
#[derive(Debug)]
pub struct ErrorResponse {
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
