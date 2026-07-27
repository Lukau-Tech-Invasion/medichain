//! Phase 1 endpoints for explicitly switching between work and personal health.

use super::*;
use crate::federation_identity::{ContextType, LoginContext};
use crate::security::jwt;

#[derive(Debug, Deserialize)]
pub struct ContextSwitchRequest {
    pub context: ContextType,
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
    issue_context(&data, &req, ContextType::Professional)
}

/// Enter the personal patient context for the authenticated wallet.
#[post("/api/identity/context/patient")]
pub async fn enter_patient_context(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    issue_context(&data, &req, ContextType::Patient)
}

/// Replace the active authorization context. A new token is always issued;
/// clients must discard the previous token and its context-specific caches.
#[post("/api/identity/context/switch")]
pub async fn switch_identity_context(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<ContextSwitchRequest>,
) -> impl Responder {
    issue_context(&data, &req, body.context)
}

fn issue_context(
    data: &web::Data<AppState>,
    req: &HttpRequest,
    context_type: ContextType,
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
    data.identity_contexts.register_legacy_user(
        &wallet,
        user.linked_patient_id.as_deref(),
        &user.role.to_string(),
    );
    let context = match context_type {
        ContextType::Patient => data.identity_contexts.issue_patient_context(&wallet),
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
    let mfa = get_current_claims(req)
        .map(|claims| claims.mfa)
        .unwrap_or(false);
    match jwt::issue_context_access_token(&context, mfa) {
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
