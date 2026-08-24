//! Patient self-service profile management.
//!
//! Deliberately separate from `patient_admin`: the fields here are demographic
//! and administrative — where the patient lives, how to reach them, who pays —
//! and the patient is the authoritative source for all of them. Clinical fields
//! (blood type, allergies, chronic conditions, DNR status) stay in
//! `patient_admin::update_patient` behind `can_edit_medical_records`, because a
//! self-declared blood type must never be recorded as verified clinical fact.
//!
//! Both handlers here also accept a healthcare provider acting on the patient's
//! behalf, which is how a receptionist or nurse captures these details during an
//! in-person visit for a patient who has no device of their own.

use super::*;

/// Demographic and administrative fields a patient may maintain themselves.
///
/// Every field is optional and an absent field is left unchanged, so a client
/// can submit one section of the profile without resending the rest.
#[derive(Debug, Deserialize)]
pub struct UpdateDemographicsRequest {
    pub phone: Option<String>,
    pub gender: Option<String>,
    pub address: Option<Address>,
    pub insurance: Option<InsuranceInfo>,
    pub languages: Option<Vec<String>>,
}

/// The full replacement set of emergency contacts.
///
/// Replacing the whole list rather than mutating one entry by index keeps the
/// operation idempotent and avoids the classic bug where a concurrent delete
/// shifts the indices out from under a subsequent edit.
#[derive(Debug, Deserialize)]
pub struct ReplaceEmergencyContactsRequest {
    pub contacts: Vec<EmergencyContactInput>,
}

/// One emergency contact as submitted by a client.
///
/// `priority` is assigned by the server from list order, so stored values are
/// always a dense 1..=n sequence whatever the client sends.
#[derive(Debug, Deserialize)]
pub struct EmergencyContactInput {
    pub name: String,
    pub phone: String,
    pub relationship: String,
    #[serde(default)]
    pub can_make_medical_decisions: bool,
    #[serde(default)]
    pub language: Option<String>,
}

/// How many emergency contacts one patient may store.
///
/// Bounded per the project's NASA Power of 10 rule against unbounded growth;
/// high enough that no realistic family hits it.
const MAX_EMERGENCY_CONTACTS: usize = 10;

/// A decrypted profile together with the entity row it was read from.
///
/// Saving needs both: the entity carries columns that `PatientProfile` does not
/// model and which must survive a round trip.
type LoadedPatient = (PatientProfile, crate::repositories::traits::PatientEntity);

fn patient_not_found() -> HttpResponse {
    HttpResponse::NotFound().json(ErrorResponse {
        success: false,
        error: "Patient not found".to_string(),
        code: "PATIENT_NOT_FOUND".to_string(),
    })
}

/// Authorize the caller against `patient_id` and load the decrypted profile.
async fn authorize_and_load(
    data: &web::Data<AppState>,
    http_req: &HttpRequest,
    patient_id: &str,
) -> Result<LoadedPatient, HttpResponse> {
    let caller_id = get_current_user_id(http_req).ok_or_else(|| {
        HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Missing X-User-Id header".to_string(),
            code: "UNAUTHORIZED".to_string(),
        })
    })?;
    let caller = get_user(data, &caller_id).ok_or_else(|| {
        HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "User not found".to_string(),
            code: "USER_NOT_FOUND".to_string(),
        })
    })?;

    let owns = crate::support::caller_owns_patient_record(data, &caller_id, patient_id);
    if !owns && !caller.role.can_edit_medical_records() {
        return Err(HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "You can only edit your own profile".to_string(),
            code: "FORBIDDEN".to_string(),
        }));
    }

    let entity = data
        .repositories
        .patients
        .get_by_id(patient_id)
        .await
        .map_err(|_| patient_not_found())?;
    let profile = patient_entity_to_profile(&entity, &data.encryption_keyring)
        .ok_or_else(patient_not_found)?;
    Ok((profile, entity))
}

/// Re-encrypt and persist a mutated profile, preserving entity-only columns.
async fn save_profile(
    data: &web::Data<AppState>,
    profile: &PatientProfile,
    original: &crate::repositories::traits::PatientEntity,
) -> Result<(), HttpResponse> {
    let mut updated = patient_profile_to_entity(profile, &data.encryption_keyring);
    updated.health_id = original.health_id.clone();
    updated.wallet_address = original.wallet_address.clone();
    updated.is_verified = original.is_verified;
    updated.registered_by = original.registered_by.clone();
    updated.primary_provider_id = original.primary_provider_id.clone();
    updated.created_at = original.created_at;
    data.repositories
        .patients
        .update(updated)
        .await
        .map(|_| ())
        .map_err(|e| {
            log::error!("patient profile persistence failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to save profile".to_string(),
                code: "REPO_ERROR".to_string(),
            })
        })
}

/// Apply the demographic patch, or return the validation failure.
fn apply_demographics(
    profile: &mut PatientProfile,
    req: &UpdateDemographicsRequest,
) -> Result<(), HttpResponse> {
    if let Some(phone) = &req.phone {
        if !phone.trim().is_empty() {
            profile.phone = phone.trim().to_string();
        }
    }
    if let Some(gender) = &req.gender {
        // An explicit empty string clears the field rather than storing "".
        profile.gender = Some(gender.trim())
            .filter(|g| !g.is_empty())
            .map(str::to_string);
    }
    if let Some(address) = &req.address {
        if address.city.trim().is_empty() || address.country.trim().is_empty() {
            return Err(HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Address requires at least a city and a country".to_string(),
                code: "INVALID_INPUT".to_string(),
            }));
        }
        profile.address = Some(address.clone());
    }
    if let Some(insurance) = &req.insurance {
        if insurance.provider.trim().is_empty() || insurance.policy_number.trim().is_empty() {
            return Err(HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Insurance requires a provider and a policy number".to_string(),
                code: "INVALID_INPUT".to_string(),
            }));
        }
        profile.insurance = Some(insurance.clone());
    }
    if let Some(languages) = &req.languages {
        profile.emergency_info.languages = languages
            .iter()
            .filter(|l| !l.trim().is_empty())
            .cloned()
            .collect();
    }
    profile.last_updated = Utc::now();
    Ok(())
}

/// Update the demographic and administrative parts of a patient's profile.
#[put("/api/patients/{patient_id}/demographics")]
pub async fn update_demographics(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<UpdateDemographicsRequest>,
) -> impl Responder {
    let patient_id = path.into_inner();
    let (mut profile, entity) = match authorize_and_load(&data, &http_req, &patient_id).await {
        Ok(loaded) => loaded,
        Err(response) => return response,
    };
    if let Err(response) = apply_demographics(&mut profile, &req) {
        return response;
    }
    if let Err(response) = save_profile(&data, &profile, &entity).await {
        return response;
    }
    log::info!("patient demographics updated");
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "profile": profile,
        "message": "Profile updated successfully"
    }))
}

/// Reject a contact list that is too long or has blank required fields.
fn validate_contacts(contacts: &[EmergencyContactInput]) -> Result<(), HttpResponse> {
    if contacts.len() > MAX_EMERGENCY_CONTACTS {
        return Err(HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: format!("At most {MAX_EMERGENCY_CONTACTS} emergency contacts are supported"),
            code: "TOO_MANY_CONTACTS".to_string(),
        }));
    }
    let blank = contacts.iter().any(|c| {
        c.name.trim().is_empty() || c.phone.trim().is_empty() || c.relationship.trim().is_empty()
    });
    if blank {
        return Err(HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Every contact needs a name, phone and relationship".to_string(),
            code: "INVALID_INPUT".to_string(),
        }));
    }
    Ok(())
}

/// Replace a patient's entire emergency contact list.
#[put("/api/patients/{patient_id}/emergency-contacts")]
pub async fn replace_emergency_contacts(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<ReplaceEmergencyContactsRequest>,
) -> impl Responder {
    let patient_id = path.into_inner();
    let (mut profile, entity) = match authorize_and_load(&data, &http_req, &patient_id).await {
        Ok(loaded) => loaded,
        Err(response) => return response,
    };
    if let Err(response) = validate_contacts(&req.contacts) {
        return response;
    }

    profile.emergency_info.emergency_contacts = req
        .contacts
        .iter()
        .enumerate()
        .map(|(index, c)| EmergencyContact {
            name: c.name.trim().to_string(),
            phone: c.phone.trim().to_string(),
            relationship: c.relationship.trim().to_string(),
            priority: (index + 1) as u8,
            can_make_medical_decisions: c.can_make_medical_decisions,
            language: c.language.clone(),
        })
        .collect();
    profile.emergency_info.last_updated = Utc::now();
    profile.last_updated = Utc::now();

    if let Err(response) = save_profile(&data, &profile, &entity).await {
        return response;
    }
    log::info!(
        "emergency contacts replaced for patient {patient_id} ({} contacts)",
        profile.emergency_info.emergency_contacts.len()
    );
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "contacts": profile.emergency_info.emergency_contacts,
        "message": "Emergency contacts updated successfully"
    }))
}
