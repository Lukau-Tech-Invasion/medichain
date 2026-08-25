//! Phase 1 endpoints for explicitly switching between work and personal health,
//! extended for guardian "choose profile" switching into a ward's identity.

use super::*;
use crate::federation_identity::{ContextType, LoginContext};
use crate::repositories::traits::{GuardianPermission, GuardianRelationshipType};
use crate::security::jwt;

#[derive(Debug, Deserialize)]
pub struct ContextSwitchRequest {
    pub context: ContextType,
    /// Switch into a ward's medical identity instead of the caller's own —
    /// the "choose profile" flow for a guardian managing multiple children.
    /// Ignored for `ContextType::Professional`. Requires the caller to be
    /// that patient, an Admin, or hold an active guardian relationship
    /// granting `ViewRecords` over this patient — checked before any context
    /// is issued (see `support::caller_may_access_patient`).
    #[serde(default)]
    pub target_patient_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ContextSwitchResponse {
    pub success: bool,
    pub access_token: String,
    pub token_type: String,
    pub expires_in: i64,
    pub context: LoginContext,
}

/// Enter a professional work context for the authenticated wallet.
#[post("/api/identity/context/work")]
pub async fn enter_work_context(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    issue_context(&data, &req, ContextType::Professional, None).await
}

/// Enter the personal patient context for the authenticated wallet.
#[post("/api/identity/context/patient")]
pub async fn enter_patient_context(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    issue_context(&data, &req, ContextType::Patient, None).await
}

/// Replace the active authorization context. A new token is always issued;
/// clients must discard the previous token and its context-specific caches.
#[post("/api/identity/context/switch")]
pub async fn switch_identity_context(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<ContextSwitchRequest>,
) -> impl Responder {
    issue_context(&data, &req, body.context, body.target_patient_id.clone()).await
}

async fn issue_context(
    data: &web::Data<AppState>,
    req: &HttpRequest,
    context_type: ContextType,
    target_patient_id: Option<String>,
) -> HttpResponse {
    let wallet = match get_current_user_id(req) {
        Some(wallet) => wallet,
        None => return unauthorized_missing_user(),
    };
    let user = match get_user(data, &wallet) {
        Some(user) => user,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Wallet not registered".to_string(),
                code: "WALLET_NOT_REGISTERED".to_string(),
            })
        }
    };

    if let (ContextType::Patient, Some(target)) = (context_type, target_patient_id.as_deref()) {
        if !crate::support::caller_may_access_patient(
            data,
            &user,
            target,
            GuardianPermission::ViewRecords,
        )
        .await
        {
            return HttpResponse::Forbidden().json(ErrorResponse {
                success: false,
                error: "No active guardian relationship grants access to this medical identity"
                    .to_string(),
                code: "GUARDIAN_ACCESS_DENIED".to_string(),
            });
        }
    }

    data.identity_contexts.register_legacy_user(
        &wallet,
        user.linked_patient_id.as_deref(),
        &user.role.to_string(),
    );
    let context = match context_type {
        ContextType::Patient => data
            .identity_contexts
            .issue_patient_context(&wallet, target_patient_id.as_deref()),
        ContextType::Professional => data.identity_contexts.issue_work_context(&wallet),
    };
    let context = match context {
        Ok(context) => context,
        Err(message) => {
            return HttpResponse::Forbidden().json(ErrorResponse {
                success: false,
                error: message.to_string(),
                code: "IDENTITY_CONTEXT_UNAVAILABLE".to_string(),
            })
        }
    };
    let claims = get_current_claims(req);
    let mfa = claims.as_ref().map(|claims| claims.mfa).unwrap_or(false);
    // Switching context does not start a new login, so the token keeps the same
    // `sid`. Losing it here would silently detach the caller from their session's
    // revocation and step-up state.
    let login_session_id = claims.and_then(|claims| claims.sid.clone());
    match jwt::issue_context_access_token(&context, mfa, login_session_id.as_deref()) {
        Ok(access_token) => HttpResponse::Ok().json(ContextSwitchResponse {
            success: true,
            access_token,
            token_type: "Bearer".to_string(),
            expires_in: jwt::ACCESS_TOKEN_TTL_SECS,
            context,
        }),
        Err(error) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: format!("Failed to issue context token: {error}"),
            code: "CONTEXT_TOKEN_ISSUE_FAILED".to_string(),
        }),
    }
}

/// One entry in `GET /api/identity/my-medical-identities` — a medical
/// identity the caller may switch their session into, either their own or a
/// ward they hold an active guardian relationship for.
#[derive(Debug, Serialize)]
pub struct MedicalIdentitySummary {
    pub patient_id: String,
    pub relationship: &'static str,
    pub full_name: Option<String>,
    pub date_of_birth: Option<String>,
    pub permissions: Vec<String>,
}

/// The API a "choose profile" UI consumes: the caller's own linked medical
/// identity (if any) plus every ward they currently hold an active,
/// unexpired guardian relationship for.
#[get("/api/identity/my-medical-identities")]
pub async fn list_my_medical_identities(
    data: web::Data<AppState>,
    req: HttpRequest,
) -> impl Responder {
    let wallet = match get_current_user_id(&req) {
        Some(wallet) => wallet,
        None => return unauthorized_missing_user(),
    };
    let user = match get_user(&data, &wallet) {
        Some(user) => user,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Wallet not registered".to_string(),
                code: "WALLET_NOT_REGISTERED".to_string(),
            })
        }
    };

    let mut identities = Vec::new();

    if let Some(own_patient_id) = &user.linked_patient_id {
        let (full_name, date_of_birth) = patient_display_fields(&data, own_patient_id).await;
        identities.push(MedicalIdentitySummary {
            patient_id: own_patient_id.clone(),
            relationship: "self",
            full_name,
            date_of_birth,
            permissions: vec!["all".to_string()],
        });
    }

    let now = chrono::Utc::now();
    let relationships = data
        .repositories
        .guardian_relationships
        .get_by_guardian(&wallet)
        .await
        .unwrap_or_default();
    for relationship in relationships
        .iter()
        .filter(|r| r.active && r.expires_at.map(|e| e > now).unwrap_or(true))
    {
        let (full_name, date_of_birth) =
            patient_display_fields(&data, &relationship.ward_patient_id).await;
        identities.push(MedicalIdentitySummary {
            patient_id: relationship.ward_patient_id.clone(),
            relationship: relationship_type_label(&relationship.relationship_type),
            full_name,
            date_of_birth,
            permissions: relationship.permissions.clone(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({ "identities": identities }))
}

fn relationship_type_label(relationship_type: &str) -> &'static str {
    GuardianRelationshipType::parse(relationship_type)
        .map(|t| t.as_str())
        .unwrap_or("guardian")
}

/// Best-effort display fields for a "choose profile" list, decrypted the same
/// way `patient_entity_to_profile` already does for existing patient-detail
/// responses. Missing/unreadable patient records degrade to `None` rather
/// than failing the whole list.
async fn patient_display_fields(
    data: &web::Data<AppState>,
    patient_id: &str,
) -> (Option<String>, Option<String>) {
    let entity = match data.repositories.patients.get_by_id(patient_id).await {
        Ok(entity) => entity,
        Err(_) => return (None, None),
    };
    match crate::types::patient_entity_to_profile(&entity, &data.encryption_keyring) {
        Some(profile) => (Some(profile.full_name), Some(profile.date_of_birth)),
        None => (None, None),
    }
}
