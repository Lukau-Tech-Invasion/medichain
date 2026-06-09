//! Helper and utility functions shared across handlers.
//!
//! Split out of `main.rs` (Phase 10.2). Re-exported at the crate root.

use crate::state::AppState;
use crate::types::*;
use actix_web::{web, HttpRequest};
use chrono::Utc;
use sha3::{Digest, Sha3_256};

// ============================================================================
// Helper Functions
// ============================================================================

/// Get default supported languages for the system
pub fn get_default_supported_languages() -> Vec<crate::clinical::SupportedLanguage> {
    vec![
        crate::clinical::SupportedLanguage {
            code: "en".to_string(),
            name: "English".to_string(),
            native_name: "English".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "zu".to_string(),
            name: "Zulu".to_string(),
            native_name: "isiZulu".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "xh".to_string(),
            name: "Xhosa".to_string(),
            native_name: "isiXhosa".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "af".to_string(),
            name: "Afrikaans".to_string(),
            native_name: "Afrikaans".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "st".to_string(),
            name: "Sotho".to_string(),
            native_name: "Sesotho".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "tn".to_string(),
            name: "Tswana".to_string(),
            native_name: "Setswana".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "ts".to_string(),
            name: "Tsonga".to_string(),
            native_name: "Xitsonga".to_string(),
            rtl: false,
            medical_terminology_available: false,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "ss".to_string(),
            name: "Swati".to_string(),
            native_name: "siSwati".to_string(),
            rtl: false,
            medical_terminology_available: false,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "ve".to_string(),
            name: "Venda".to_string(),
            native_name: "Tshivenḓa".to_string(),
            rtl: false,
            medical_terminology_available: false,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "nr".to_string(),
            name: "Ndebele".to_string(),
            native_name: "isiNdebele".to_string(),
            rtl: false,
            medical_terminology_available: false,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "nso".to_string(),
            name: "Northern Sotho".to_string(),
            native_name: "Sepedi".to_string(),
            rtl: false,
            medical_terminology_available: false,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "ar".to_string(),
            name: "Arabic".to_string(),
            native_name: "العربية".to_string(),
            rtl: true,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "fr".to_string(),
            name: "French".to_string(),
            native_name: "Français".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "pt".to_string(),
            name: "Portuguese".to_string(),
            native_name: "Português".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
    ]
}

// ============================================================================
// Utility Functions
// ============================================================================

pub fn generate_nfc_hash(patient_id: &str, tag_id: &str) -> String {
    let mut hasher = Sha3_256::new();
    hasher.update(patient_id.as_bytes());
    hasher.update(tag_id.as_bytes());
    hasher.update(Utc::now().to_rfc3339().as_bytes());
    hex::encode(hasher.finalize())
}

pub fn parse_blood_type(s: &str) -> Result<BloodType, String> {
    match s.to_uppercase().as_str() {
        "A+" | "A_POSITIVE" | "APOSITIVE" => Ok(BloodType::APositive),
        "A-" | "A_NEGATIVE" | "ANEGATIVE" => Ok(BloodType::ANegative),
        "B+" | "B_POSITIVE" | "BPOSITIVE" => Ok(BloodType::BPositive),
        "B-" | "B_NEGATIVE" | "BNEGATIVE" => Ok(BloodType::BNegative),
        "AB+" | "AB_POSITIVE" | "ABPOSITIVE" => Ok(BloodType::ABPositive),
        "AB-" | "AB_NEGATIVE" | "ABNEGATIVE" => Ok(BloodType::ABNegative),
        "O+" | "O_POSITIVE" | "OPOSITIVE" => Ok(BloodType::OPositive),
        "O-" | "O_NEGATIVE" | "ONEGATIVE" => Ok(BloodType::ONegative),
        _ => Err(format!("Invalid blood type: {}", s)),
    }
}

pub fn parse_role(s: &str) -> Result<Role, String> {
    match s.to_lowercase().as_str() {
        "admin" => Ok(Role::Admin),
        "doctor" => Ok(Role::Doctor),
        "nurse" => Ok(Role::Nurse),
        "labtechnician" | "lab_technician" | "lab" => Ok(Role::LabTechnician),
        "pharmacist" => Ok(Role::Pharmacist),
        "patient" => Ok(Role::Patient),
        _ => Err(format!("Invalid role: {}. Valid roles: Admin, Doctor, Nurse, LabTechnician, Pharmacist, Patient", s)),
    }
}

/// Extract the authenticated wallet address from a request.
///
/// Resolution order (Phase 9.4, additive):
/// 1. A valid `Authorization: Bearer <jwt>` access token — the wallet is taken
///    from the verified `sub` claim (signature + expiry checked).
/// 2. The legacy `X-User-Id` header carrying the raw SS58 wallet address.
///
/// Keeping the `X-User-Id` fallback means every existing handler gains JWT
/// support without modification, and demo mode (no JWT) keeps working.
pub fn get_current_user_id(req: &HttpRequest) -> Option<String> {
    if let Some(claims) = get_current_claims(req) {
        return Some(claims.sub);
    }
    req.headers()
        .get("X-User-Id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

/// Extract and verify the JWT access-token claims from the `Authorization`
/// header, if present and valid. Returns `None` for missing/invalid/expired
/// tokens (callers then fall back to `X-User-Id`).
pub fn get_current_claims(req: &HttpRequest) -> Option<crate::security::jwt::Claims> {
    let header = req.headers().get("Authorization")?.to_str().ok()?;
    crate::security::jwt::bearer_access_subject(header)
}

/// Whether the current request was made with an MFA-satisfied JWT (Phase 11.3).
///
/// A request authenticated only by `X-User-Id` (no JWT) returns `false`, so
/// `require_mfa`-gated endpoints reject it.
pub fn request_has_mfa(req: &HttpRequest) -> bool {
    get_current_claims(req).map(|c| c.mfa).unwrap_or(false)
}

/// Get user by wallet address from app state.
///
/// RBAC invariant: a caller's ROLE is authoritative ONLY when read from this
/// server-side user store, keyed by the wallet address that `get_current_user_id`
/// resolved (a JWT `sub` claim or the signature-verified `X-User-Id`). Handlers
/// MUST derive authorization from `get_user(...).role` and MUST NEVER trust a
/// client-supplied role header (e.g. `X-User-Role`/`X-Provider-Role`), which is
/// spoofable. No handler in this codebase derives authorization from such a header.
pub fn get_user(data: &web::Data<AppState>, wallet_address: &str) -> Option<User> {
    data.users.read().ok()?.get(wallet_address).cloned()
}

/// Compute a consent/access expiry timestamp with overflow protection (Phase 12.2).
///
/// `granted_at_secs` is a unix timestamp; `duration_secs` is the grant lifetime.
/// Returns `None` instead of wrapping if the duration is too large to represent
/// (rather than producing a bogus past/wrapped expiry that could silently extend
/// or revoke access).
pub fn checked_consent_expiry(granted_at_secs: i64, duration_secs: u64) -> Option<i64> {
    i64::try_from(duration_secs)
        .ok()
        .and_then(|d| granted_at_secs.checked_add(d))
}

/// Validate SS58 wallet address format (basic validation)
pub fn is_valid_wallet_address(address: &str) -> bool {
    // SS58 addresses start with 5 and are typically 48 characters for Substrate
    address.len() >= 45 && address.len() <= 50 && address.starts_with('5')
}

pub fn generate_qr_code_base64(data: &str) -> Option<String> {
    use image::Luma;
    use qrcode::QrCode;

    let code = QrCode::new(data.as_bytes()).ok()?;
    let image = code.render::<Luma<u8>>().build();

    let mut buffer = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buffer);

    image::DynamicImage::ImageLuma8(image)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .ok()?;

    Some(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &buffer,
    ))
}
