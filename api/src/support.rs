//! Helper and utility functions shared across handlers.
//!
//! Split out of `main.rs` (Phase 10.2). Re-exported at the crate root.

use crate::state::AppState;
use crate::types::*;
use actix_web::{web, HttpRequest, HttpResponse};
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

/// Resolve the server key used to hash national ID numbers.
///
/// Order mirrors `clinical_endpoints::emergency_access::emergency_secret`:
/// `NATIONAL_ID_HASH_KEY`, with a dev-only fallback that `validate_production_secrets`
/// rejects in production. There is no equivalent of `SESSION_SECRET` to fall back to
/// here deliberately — this key protects a different, narrower thing (identity-digest
/// reversibility) and reusing an unrelated secret would tie its rotation to this one's.
fn national_id_hash_key() -> String {
    std::env::var("NATIONAL_ID_HASH_KEY")
        .unwrap_or_else(|_| "medichain-dev-national-id-key-change-in-production".to_string())
}

/// Hash a national ID number for storage/indexing (Horizon HZ-005).
///
/// National ID numbers are short, structured, and low-entropy relative to a
/// cryptographic key — a bare `SHA3-256(id)` digest (the prior construction) is
/// reversible by exhaustive search over the realistic ID space. This uses the
/// same secret-prefix construction already reviewed and justified in
/// `clinical_endpoints::emergency_access::mac_tag`: SHA3-256 (Keccak) is
/// length-extension resistant, so `SHA3-256(key || ":" || id)` is a secure keyed
/// digest without pulling in a separate HMAC dependency. Deterministic per input
/// (same ID + same key ⇒ same digest), so existing equality-based lookups (e.g.
/// `national_index`) keep working — the key, not the algorithm, is what makes the
/// digest non-reversible without server-side knowledge.
pub fn hash_national_id(id: &str) -> String {
    let mut hasher = Sha3_256::new();
    hasher.update(national_id_hash_key().as_bytes());
    hasher.update(b":");
    hasher.update(id.as_bytes());
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
        "labtechnician" | "lab_technician" | "lab-technician" | "lab" => Ok(Role::LabTechnician),
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

/// Whether `caller_wallet` is the data subject of `patient_id` — the patient
/// looking at their own record.
///
/// # Why this function exists
///
/// Twenty-six handlers open-coded this as `current_user_id != patient_id`,
/// which compares two **different identifier namespaces**: `current_user_id`
/// is an SS58 wallet address (`5FLSigC9…60Z`) and `patient_id` is a patient
/// record ID (`PAT-001-DEMO`). For a real patient account those are never
/// equal, so the guard was structurally incapable of granting self-access and
/// every one of those endpoints returned 403 to the patient whose data it was.
/// The doc comments above them described the intended behaviour, which was the
/// opposite of what the code did.
///
/// The link between the two namespaces is `User::linked_patient_id`, which is
/// exactly what `/api/auth/wallet/{address}` returns to the client.
///
/// The `caller_wallet == patient_id` arm is deliberate and load-bearing: some
/// fixtures (and the synthetic e2e harness) register a patient whose record ID
/// *is* the wallet address, and those callers must keep working. Collapsing
/// that case is also why the original bug went unnoticed for so long — with
/// such a fixture the broken comparison accidentally succeeds.
///
/// Fails closed: an unknown caller is not the data subject.
///
/// This answers *self-access only*. Guardian and admin access are a broader
/// question answered by [`resolve_patient_access`], which additionally consults
/// guardian relationships; handlers needing that should call it instead.
pub fn caller_owns_patient_record(
    data: &web::Data<AppState>,
    caller_wallet: &str,
    patient_id: &str,
) -> bool {
    if caller_wallet == patient_id {
        return true;
    }
    get_user(data, caller_wallet)
        .is_some_and(|u| u.linked_patient_id.as_deref() == Some(patient_id))
}

/// How a caller's access to a patient was granted.
///
/// Exists because "may they?" and "on what authority?" are different questions
/// and POPIA needs the second one answered: a consent record signed by a
/// guardian must cite the guardian relationship that authorised it
/// (`consent_records.guardian_authority_evidence_id`), which a bare boolean
/// cannot supply.
#[derive(Debug, Clone)]
pub enum PatientAccessGrant {
    /// The caller is the data subject.
    SelfAccess,
    /// Administrative override.
    Admin,
    /// A verified guardian relationship granting the requested permission.
    Guardian(Box<crate::repositories::traits::GuardianRelationshipEntity>),
    Denied,
}

impl PatientAccessGrant {
    pub fn is_permitted(&self) -> bool {
        !matches!(self, Self::Denied)
    }

    /// The guardian relationship id to cite as authority evidence, if access
    /// came via a guardian. `None` for self/admin access — there is no
    /// third-party authority to evidence in those cases.
    pub fn authority_evidence_id(&self) -> Option<&str> {
        match self {
            Self::Guardian(relationship) => Some(relationship.id.as_str()),
            _ => None,
        }
    }
}

/// Resolve *how* `caller` may exercise `permission` against
/// `target_patient_id` — self, Admin, an active unexpired guardian
/// relationship, or denied.
///
/// `caller_may_access_patient` is the boolean projection of this; both share
/// this one implementation so the authorization rule cannot drift between them.
pub async fn resolve_patient_access(
    data: &web::Data<AppState>,
    caller: &User,
    target_patient_id: &str,
    permission: crate::repositories::traits::GuardianPermission,
) -> PatientAccessGrant {
    if caller.linked_patient_id.as_deref() == Some(target_patient_id) {
        return PatientAccessGrant::SelfAccess;
    }
    if caller.role.is_admin() {
        return PatientAccessGrant::Admin;
    }
    let now = Utc::now();
    let relationship = data
        .repositories
        .guardian_relationships
        .get_by_ward(target_patient_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .find(|r| r.guardian_wallet == caller.wallet_address && r.grants(permission, now));

    match relationship {
        Some(r) => PatientAccessGrant::Guardian(Box::new(r)),
        None => PatientAccessGrant::Denied,
    }
}

/// Whether `caller` may exercise `permission` against `target_patient_id`:
/// they are the patient themselves (`linked_patient_id` matches), an Admin,
/// or hold an active, unexpired `GuardianRelationship` granting that specific
/// permission. Centralizes the self-or-admin-or-guardian check that used to
/// be reimplemented ad hoc per handler (e.g. `sign_consent`'s pre-existing
/// self/Admin/guardian check) into one place, and is the guardian-aware
/// equivalent of the `AuthorizedUser` scoping decision from Horizon HZ-010:
/// applied to the endpoints that need it now, not retrofitted everywhere.
pub async fn caller_may_access_patient(
    data: &web::Data<AppState>,
    caller: &User,
    target_patient_id: &str,
    permission: crate::repositories::traits::GuardianPermission,
) -> bool {
    resolve_patient_access(data, caller, target_patient_id, permission)
        .await
        .is_permitted()
}

/// The data subject's age in whole years, or `None` if unknown/undecryptable.
///
/// No server-side minor determination existed before this: the only `is_minor`
/// in the codebase was a client-supplied boolean on an unrelated family-group
/// feature, which is not something to make a POPIA §35 decision on. Reads the
/// encrypted `patients.date_of_birth_encrypted` column through the same
/// keyring path as `patient_entity_to_profile`.
pub async fn patient_age_years(data: &web::Data<AppState>, patient_id: &str) -> Option<u32> {
    let entity = data
        .repositories
        .patients
        .get_by_id(patient_id)
        .await
        .ok()?;
    let profile = crate::types::patient_entity_to_profile(&entity, &data.encryption_keyring)?;
    age_in_years(&profile.date_of_birth, Utc::now().date_naive())
}

/// Whole years between a `YYYY-MM-DD` date of birth and `today`.
///
/// Split out from `patient_age_years` so the boundary arithmetic is testable
/// without a repository or an encryption keyring — the off-by-one that matters
/// here (someone one day short of their birthday) is exactly the kind of bug
/// that decides whether a §35 child-information ground applies.
pub fn age_in_years(date_of_birth: &str, today: chrono::NaiveDate) -> Option<u32> {
    use chrono::Datelike;

    let dob = chrono::NaiveDate::parse_from_str(date_of_birth, "%Y-%m-%d").ok()?;
    if dob > today {
        return None;
    }
    // Subtract a year when this year's birthday hasn't happened yet, so
    // someone one day short of 18 is still 17.
    let had_birthday_this_year = (today.month(), today.day()) >= (dob.month(), dob.day());
    let years = today.year() - dob.year() - i32::from(!had_birthday_this_year);
    u32::try_from(years).ok()
}

/// POPIA §34–35 treat a "child" as under 18.
pub const MAJORITY_AGE_YEARS: u32 = 18;

/// Children's Act §129: a child of 12 or older with sufficient maturity may
/// consent to their own medical treatment. Maturity is a clinical judgement
/// that cannot be derived from a date of birth, so this reports only the age
/// half of the test — the caller must still record the maturity assessment.
pub const CHILD_SELF_CONSENT_MIN_AGE_YEARS: u32 = 12;

/// Whether the server is running in demo mode (`IS_DEMO=true`).
///
/// Demo mode relaxes controls that only make sense with real users and real
/// credentials — signature verification is off, demo secrets are permitted, and
/// simulation aids that would be dangerous in production are available. The same
/// boundary is used by `validate_production_secrets()` and the signature-auth
/// middleware; centralised here so "is this demo mode?" is answered one way.
pub fn is_demo_mode() -> bool {
    std::env::var("IS_DEMO").unwrap_or_else(|_| "false".to_string()) == "true"
}

/// Reject a request unless the server is in demo mode.
///
/// For endpoints that are testing/simulation aids only and must never be live in
/// a production deployment — e.g. `simulate_nfc_tap`, which fabricates a
/// patient's NFC card hash (the emergency credential) from a patient ID and so
/// would be a credential-forgery primitive outside demo (Horizon HZ-019).
pub fn require_demo_mode() -> Result<(), HttpResponse> {
    if is_demo_mode() {
        return Ok(());
    }
    Err(
        HttpResponse::Forbidden().json(crate::middleware::error_handling::error_envelope_json(
            "DEMO_ONLY_ENDPOINT",
            "This endpoint is a simulation aid available only when IS_DEMO=true. \
             It is disabled in this deployment.",
            None,
        )),
    )
}

/// Resolve the caller against the user store and return them.
///
/// The minimum correct replacement for a bare `get_current_user_id(&req)` on a
/// **patient-facing** endpoint. `X-User-Id` is caller-supplied and unverified,
/// so presence alone lets an unregistered caller act as anyone; resolving it
/// proves the account exists.
///
/// Use this — not [`require_clinical_staff`] — where patients legitimately act
/// for themselves (family groups, symptom checker, wearables, reminders, sync,
/// notification preferences). Requiring a clinical role there would lock
/// patients out of their own features.
///
/// It proves *who* the caller is, not *what they may touch*: endpoints scoped to
/// a specific patient still need [`resolve_patient_access`] or an ownership
/// check on top.
pub fn require_registered_caller(
    data: &web::Data<crate::AppState>,
    req: &HttpRequest,
) -> Result<crate::User, HttpResponse> {
    let user_id = get_current_user_id(req).ok_or_else(|| {
        HttpResponse::Unauthorized().json(crate::ErrorResponse {
            success: false,
            error: "Authentication required".to_string(),
            code: "UNAUTHORIZED".to_string(),
        })
    })?;
    get_user(data, &user_id).ok_or_else(|| {
        HttpResponse::Unauthorized().json(crate::ErrorResponse {
            success: false,
            error: "User not found".to_string(),
            code: "USER_NOT_FOUND".to_string(),
        })
    })
}

/// Resolve the caller and require that they are registered clinical staff.
///
/// The pervasive weak pattern in this codebase is
/// `get_current_user_id(&req)` (or a bare `X-User-Id` header check) followed by
/// the clinical work. `X-User-Id` is **caller-supplied and unverified at that
/// point**, so those handlers accept any string: an unregistered, unauthenticated
/// caller satisfies them. An external review counted this as the principal route
/// to a multi-hospital breach, and it is the same defect as HZ-024.
///
/// This helper is the minimum correct replacement — it *resolves* the identity
/// against the user store and checks a clinical role, so a forged header is
/// rejected and a patient account cannot reach staff-only endpoints.
///
/// It is deliberately **not** a full authorization decision: it says nothing
/// about which organization, facility or patient the caller may touch. Endpoints
/// handling a specific patient must additionally use
/// [`resolve_patient_access`]. Tenant scoping remains open (SEC-16/SEC-18).
pub fn require_clinical_staff(
    data: &web::Data<crate::AppState>,
    req: &HttpRequest,
) -> Result<crate::User, HttpResponse> {
    let user = require_registered_caller(data, req)?;
    if !user.role.can_view_medical_records() {
        return Err(HttpResponse::Forbidden().json(crate::ErrorResponse {
            success: false,
            error: "This endpoint is restricted to clinical staff".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        }));
    }
    Ok(user)
}

/// Who may lawfully consent to this patient's own medical treatment, on the
/// age half of the Children's Act §129 test.
///
/// Deliberately separate from POPIA §35 data-processing permission: the legal
/// review was explicit that the treatment-consent rule "must not be collapsed
/// into a generic guardian database permission". A mature 14-year-old may
/// consent to their own treatment while a competent person is still required
/// for some processing of their information.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TreatmentConsentCapacity {
    /// 18 or older — consents for themselves, no child ground applies.
    Adult,
    /// 12–17. May consent to their own treatment **if** sufficient maturity is
    /// assessed and recorded. Age alone is not sufficient.
    MatureChildEligible,
    /// Under 12 — a competent person must consent.
    CompetentPersonRequired,
    /// Date of birth absent or undecryptable.
    ///
    /// Treated as requiring a competent person rather than assumed adult:
    /// asserting capacity we cannot evidence is the failure that matters here.
    AgeUnknown,
}

/// Apply the age half of the Children's Act §129 treatment-consent test.
///
/// Pure and total so the boundary cases (exactly 12, exactly 18, unknown) are
/// testable without a repository — the same reason `age_in_years` is split out.
pub fn treatment_consent_capacity(age_years: Option<u32>) -> TreatmentConsentCapacity {
    match age_years {
        None => TreatmentConsentCapacity::AgeUnknown,
        Some(age) if age >= MAJORITY_AGE_YEARS => TreatmentConsentCapacity::Adult,
        Some(age) if age >= CHILD_SELF_CONSENT_MIN_AGE_YEARS => {
            TreatmentConsentCapacity::MatureChildEligible
        }
        Some(_) => TreatmentConsentCapacity::CompetentPersonRequired,
    }
}

/// Refuse new processing for a patient whose records are under a POPIA
/// processing restriction.
///
/// A restriction (see `crate::retention::execution`) limits processing to
/// storage. Reads for care and audit continue; what must stop is *new*
/// processing of a record whose retention period has elapsed.
///
/// Returns `Err` with a ready-to-return 403 when restricted.
///
/// # Scope of enforcement
///
/// This is a guard callers invoke, not a middleware every route passes through.
/// It is applied on the write paths that initiate new processing of an existing
/// patient's record. Universal enforcement belongs at the authorization
/// chokepoint (Horizon HZ-010), which is a separate, larger retrofit across
/// ~386 routes — until that lands, a write path that does not call this is not
/// covered. Tracked as outstanding rather than described as complete.
///
/// Fails **open** on a repository error, and says so loudly: a restriction
/// lookup failing must not deny care. The opposite choice would let a database
/// blip block treatment.
pub async fn ensure_not_restricted(
    data: &web::Data<AppState>,
    patient_id: &str,
) -> Result<(), HttpResponse> {
    match data
        .repositories
        .retention_execution
        .is_restricted(patient_id)
        .await
    {
        Ok(false) => Ok(()),
        Ok(true) => {
            Err(HttpResponse::Forbidden()
                .json(crate::middleware::error_handling::error_envelope_json(
                "PROCESSING_RESTRICTED",
                "This patient's records are under a POPIA processing restriction: the retention \
                 period has elapsed and processing is limited to storage. An administrator must \
                 lift the restriction before new processing.",
                None,
            )))
        }
        Err(e) => {
            log::error!(
                "processing-restriction check FAILED for {patient_id} ({e}); allowing the \
                 operation rather than denying care"
            );
            Ok(())
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    /// HZ-005 regression, run as one test (not three) to avoid cross-test races
    /// on the shared `NATIONAL_ID_HASH_KEY` env var — the same reason
    /// `blockchain.rs::test_operator_signer_fail_closed` does the same thing.
    #[test]
    fn hash_national_id_is_keyed_deterministic_and_not_bare_sha3() {
        let id = "8001015009087";

        // Depends on the key, not just the ID.
        std::env::set_var("NATIONAL_ID_HASH_KEY", "key-one");
        let with_key_one = hash_national_id(id);
        std::env::set_var("NATIONAL_ID_HASH_KEY", "key-two");
        let with_key_two = hash_national_id(id);
        assert_ne!(
            with_key_one, with_key_two,
            "same ID under two different keys must produce different digests"
        );

        // Deterministic per (key, id) — required so equality-based lookups
        // (e.g. `national_index`) keep working.
        std::env::set_var("NATIONAL_ID_HASH_KEY", "fixed-key");
        let first = hash_national_id(id);
        let second = hash_national_id(id);
        assert_eq!(first, second);

        // Never degrades to the bare, unkeyed construction the finding named.
        let bare = hex::encode(Sha3_256::digest(id.as_bytes()));
        assert_ne!(first, bare);

        std::env::remove_var("NATIONAL_ID_HASH_KEY");
    }

    // ------------------------------------------------------------------
    // Age calculation (POPIA ss.34-35 child determination)
    // ------------------------------------------------------------------

    fn d(y: i32, m: u32, day: u32) -> chrono::NaiveDate {
        chrono::NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    /// The day before an 18th birthday the data subject is still a child, and
    /// child-information protections still apply. An off-by-one here silently
    /// drops a POPIA s35 ground.
    #[test]
    fn age_is_still_seventeen_the_day_before_the_eighteenth_birthday() {
        assert_eq!(age_in_years("2008-06-15", d(2026, 6, 14)), Some(17));
        assert_eq!(age_in_years("2008-06-15", d(2026, 6, 15)), Some(18));
    }

    #[test]
    fn age_handles_leap_day_births() {
        // Born 29 Feb; in a non-leap year the birthday is treated as passed on 1 Mar.
        assert_eq!(age_in_years("2008-02-29", d(2026, 2, 28)), Some(17));
        assert_eq!(age_in_years("2008-02-29", d(2026, 3, 1)), Some(18));
    }

    #[test]
    fn age_rejects_future_and_malformed_dates() {
        // A future date of birth is not "age 0", it is bad data.
        assert_eq!(age_in_years("2030-01-01", d(2026, 1, 1)), None);
        assert_eq!(age_in_years("not-a-date", d(2026, 1, 1)), None);
        assert_eq!(age_in_years("", d(2026, 1, 1)), None);
    }

    #[test]
    fn child_self_consent_threshold_matches_childrens_act() {
        // Children's Act s129: 12 is the age half of the test.
        assert_eq!(CHILD_SELF_CONSENT_MIN_AGE_YEARS, 12);
        assert_eq!(MAJORITY_AGE_YEARS, 18);
    }

    /// The two boundaries decide which statute applies, so both are pinned
    /// explicitly: a day either side changes who may lawfully consent.
    #[test]
    fn treatment_consent_capacity_boundaries() {
        use TreatmentConsentCapacity::*;

        assert_eq!(
            treatment_consent_capacity(Some(11)),
            CompetentPersonRequired
        );
        assert_eq!(treatment_consent_capacity(Some(12)), MatureChildEligible);
        assert_eq!(treatment_consent_capacity(Some(17)), MatureChildEligible);
        assert_eq!(treatment_consent_capacity(Some(18)), Adult);
    }

    /// An unknown age must never resolve to "adult" — that would grant
    /// self-consent capacity on the strength of missing data.
    #[test]
    fn unknown_age_does_not_imply_adult_capacity() {
        assert_eq!(
            treatment_consent_capacity(None),
            TreatmentConsentCapacity::AgeUnknown
        );
        assert_ne!(
            treatment_consent_capacity(None),
            TreatmentConsentCapacity::Adult
        );
    }

    /// HZ-019: the demo gate must fail closed. `IS_DEMO` is process-global, so
    /// this test serialises against other env-touching tests via a shared lock
    /// and restores the prior value on exit.
    static DEMO_ENV_GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn require_demo_mode_fails_closed_outside_demo() {
        let _g = DEMO_ENV_GUARD.lock().unwrap_or_else(|e| e.into_inner());
        let original = std::env::var("IS_DEMO").ok();

        // Unset and explicitly-false must both be refused. Anything other than
        // exactly "true" is production, and the gate must deny.
        std::env::remove_var("IS_DEMO");
        assert!(
            require_demo_mode().is_err(),
            "unset IS_DEMO must be refused"
        );

        std::env::set_var("IS_DEMO", "false");
        assert!(require_demo_mode().is_err());

        std::env::set_var("IS_DEMO", "1");
        assert!(
            require_demo_mode().is_err(),
            "only the literal 'true' enables demo"
        );

        std::env::set_var("IS_DEMO", "true");
        assert!(require_demo_mode().is_ok());

        match original {
            Some(v) => std::env::set_var("IS_DEMO", v),
            None => std::env::remove_var("IS_DEMO"),
        }
    }
}
