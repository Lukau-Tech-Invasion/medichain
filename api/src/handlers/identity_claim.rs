//! Adulthood transition: a patient claims their own, already-existing
//! medical identity with a wallet of their own choosing.
//!
//! A newborn/minor's `MedicalIdentity` (`patient_id`) is created independently
//! of any account (see `handlers::general::register_patient`) and managed via
//! `GuardianRelationship`s until the patient is ready to control it directly.
//! This endpoint performs that one-time hand-off: it links the CALLER's own
//! wallet as `User.linked_patient_id` for an existing, unclaimed identity,
//! after the caller proves they are its subject. Per the architecture's core
//! invariant, there is **no data migration** — the medical identity, its
//! records, and its encryption-key versions (already independent of any
//! wallet — see `EncryptionKeyring`) are untouched. Existing guardian
//! relationships are also left active; the newly self-owning patient gets
//! the same revoke path Admin already has (see `handlers::rbac::revoke_guardian_relationship`),
//! so they can end a guardian's access themselves without disruption on day one.

use super::*;

#[derive(Debug, Deserialize)]
pub struct ClaimIdentityRequest {
    pub patient_id: String,
    /// Raw (unhashed) national ID — hashed here with the same keyed function
    /// used at registration time and compared against the stored digest.
    pub national_id: String,
    /// "YYYY-MM-DD", compared against the patient's decrypted date of birth.
    pub date_of_birth: String,
}

#[derive(Debug, Serialize)]
pub struct ClaimIdentityResponse {
    pub success: bool,
    pub patient_id: String,
    pub message: String,
}

/// Claim an existing, unclaimed medical identity for the caller's own wallet.
#[post("/api/identity/claim")]
pub async fn claim_medical_identity(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<ClaimIdentityRequest>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&req) {
        Some(id) => id,
        None => return unauthorized_missing_user(),
    };
    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Wallet not registered".to_string(),
                code: "WALLET_NOT_REGISTERED".to_string(),
            })
        }
    };

    if current_user.linked_patient_id.is_some() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "This account is already linked to a medical identity".to_string(),
            code: "ALREADY_LINKED".to_string(),
        });
    }

    // One claim, ever: reject if any account already claimed this identity.
    let already_claimed = data
        .users
        .read()
        .map(|users| {
            users.values().any(|u| {
                // Ignore the placeholder account that `register_patient`
                // auto-creates for every new patient. That account is keyed
                // by the patient_id itself (`wallet_address == patient_id`,
                // "placeholder until wallet is linked") and already carries
                // `linked_patient_id`, so counting it as a claim made this
                // endpoint return IDENTITY_ALREADY_CLAIMED for EVERY
                // patient — the wallet-linking flow could never succeed for
                // anyone. A real claim comes from a wallet that is not the
                // patient_id.
                u.linked_patient_id.as_deref() == Some(body.patient_id.as_str())
                    && u.wallet_address != body.patient_id
            })
        })
        .unwrap_or(false);
    if already_claimed {
        return HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: "This medical identity has already been claimed".to_string(),
            code: "IDENTITY_ALREADY_CLAIMED".to_string(),
        });
    }

    let patient = match data.repositories.patients.get_by_id(&body.patient_id).await {
        Ok(patient) => patient,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Medical identity not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    let national_id_matches =
        crate::support::hash_national_id(&body.national_id) == patient.national_id_hash;
    let date_of_birth_matches =
        crate::types::patient_entity_to_profile(&patient, &data.encryption_keyring)
            .map(|profile| profile.date_of_birth == body.date_of_birth)
            .unwrap_or(false);

    // Deliberately generic error: proof failure never reveals which of the
    // two checks (or whether the identity exists at all beyond this point)
    // was wrong, so this endpoint can't be used to probe a patient_id's PII.
    if !national_id_matches || !date_of_birth_matches {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Identity verification failed".to_string(),
            code: "CLAIM_VERIFICATION_FAILED".to_string(),
        });
    }

    match data.users.write() {
        Ok(mut users) => match users.get_mut(&current_user_id) {
            Some(user) => user.linked_patient_id = Some(body.patient_id.clone()),
            None => {
                return HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "User record disappeared during claim".to_string(),
                    code: "INTERNAL_ERROR".to_string(),
                })
            }
        },
        Err(_) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "User store is unavailable".to_string(),
                code: "INTERNAL_ERROR".to_string(),
            })
        }
    }

    let _ = data.audit_outbox.record(
        "medical_identity_claimed".into(),
        "patient".into(),
        body.patient_id.clone(),
        serde_json::json!({ "claimed_by": current_user_id }),
        Utc::now(),
    );

    HttpResponse::Ok().json(ClaimIdentityResponse {
        success: true,
        patient_id: body.patient_id.clone(),
        message: "Medical identity claimed. Existing guardian relationships remain active until you revoke them.".to_string(),
    })
}
