use super::*;

use crate::pagination::{paginate_cursor, CursorQuery, Cursorable};

impl Cursorable for PatientProfile {
    fn cursor_ts(&self) -> i64 {
        self.last_updated.timestamp_millis()
    }
    fn cursor_id(&self) -> String {
        self.patient_id.clone()
    }
}

/// Why an existing patient row's encrypted profile could not be read.
///
/// `patient_entity_to_profile` collapses every cause into `None`, which is fine
/// for control flow but useless in a log. This distinguishes them so an
/// operator can tell a key-management problem (recoverable: load the right
/// `ENCRYPTION_KEYS`) from genuinely absent data.
fn unreadable_reason(
    entity: &crate::repositories::traits::PatientEntity,
    keyring: &crate::encryption_keyring::EncryptionKeyring,
) -> &'static str {
    if entity.profile_extras_encrypted.is_none() {
        "no encrypted profile blob stored on the row"
    } else if keyring.get(entity.key_version as u32).is_none() {
        "no encryption key held for the row's key_version"
    } else {
        "the profile blob did not decrypt or parse"
    }
}

/// One row of the patient roster, readable or not.
///
/// A patient whose PHI cannot be decrypted must still appear: the alternative
/// — silently dropping it — makes a record that exists indistinguishable from
/// one that was never created, which in a clinical roster is a safety problem,
/// not a cosmetic one. Unreadable rows carry only the columns that are stored
/// in clear (id, blood type, flags) plus `content_available: false`.
#[derive(Clone)]
struct RosterRow {
    ts: i64,
    id: String,
    value: serde_json::Value,
}

impl Cursorable for RosterRow {
    fn cursor_ts(&self) -> i64 {
        self.ts
    }
    fn cursor_id(&self) -> String {
        self.id.clone()
    }
}

/// Everything about a patient that is stored unencrypted, for a row whose
/// profile blob could not be read.
fn unreadable_roster_row(
    entity: &crate::repositories::traits::PatientEntity,
    reason: &'static str,
) -> RosterRow {
    RosterRow {
        ts: entity.updated_at.timestamp_millis(),
        id: entity.id.clone(),
        value: serde_json::json!({
            "patient_id": entity.id,
            "health_id": entity.health_id,
            "gender": entity.gender,
            "national_id_type": entity.national_id_type,
            "organ_donor": entity.organ_donor,
            "dnr_status": entity.dnr_status,
            "is_active": entity.is_active,
            "created_at": entity.created_at,
            "last_updated": entity.updated_at,
            "emergency_info": { "blood_type": entity.blood_type },
            // The contract for a degraded row. Clients must render these
            // distinctly rather than showing blank fields as though the record
            // were empty.
            "content_available": false,
            "content_unavailable_reason": reason,
        }),
    }
}

/// Get all registered patients (paginated)
/// Requires authentication: Only healthcare providers can list all patients
/// Query params: ?limit=20&cursor=<opaque>
#[get("/api/patients")]
pub async fn list_patients(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<CursorQuery>,
) -> impl Responder {
    // RBAC: Require authentication
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Authentication required to list patients".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Only healthcare providers can list all patients
    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can list patients".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // List patients via repository.
    // Decrypts each profile blob; capped at 1000 for this cursor pass.
    let entities = match data
        .repositories
        .patients
        .list(crate::repositories::Pagination::new(0, 1000))
        .await
    {
        Ok(result) => result.items,
        Err(e) => {
            log::error!("Patient list failed: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Internal server error".to_string(),
                code: "REPO_ERROR".to_string(),
            });
        }
    };

    // Every row is represented. This used to `filter_map` the undecryptable
    // ones away, so the roster silently under-reported — 71 stored patients
    // were served as 3, with no error and no log line, and the response still
    // advertised the full `total`. A clinician could not tell "not registered"
    // from "we hold this patient but cannot read them".
    let mut unreadable = 0usize;
    let mut rows: Vec<RosterRow> = Vec::with_capacity(entities.len());
    for entity in &entities {
        match patient_entity_to_profile(entity, &data.encryption_keyring) {
            Some(profile) => {
                let mut value = serde_json::to_value(&profile).unwrap_or(serde_json::Value::Null);
                if let Some(object) = value.as_object_mut() {
                    object.insert(
                        "content_available".to_string(),
                        serde_json::Value::Bool(true),
                    );
                }
                rows.push(RosterRow {
                    ts: profile.last_updated.timestamp_millis(),
                    id: profile.patient_id.clone(),
                    value,
                });
            }
            None => {
                let reason = unreadable_reason(entity, &data.encryption_keyring);
                log::error!(
                    "patient {} is stored but its profile is unreadable ({reason});                      listing it without PHI",
                    entity.id
                );
                unreadable += 1;
                rows.push(unreadable_roster_row(entity, reason));
            }
        }
    }

    // Sort: timestamp DESC, then ID ASC (stable tiebreaker)
    rows.sort_by(|a, b| b.ts.cmp(&a.ts).then_with(|| a.id.cmp(&b.id)));

    let total = rows.len();
    let (page, next_cursor) = paginate_cursor(&rows, query.cursor.as_deref(), query.limit);
    let page: Vec<serde_json::Value> = page.into_iter().map(|r| r.value).collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": page,
        "next_cursor": next_cursor,
        "total": total,
        // Loud on purpose: a non-zero count here means PHI this deployment
        // stores cannot be decrypted with the keys it currently holds.
        "unreadable_count": unreadable
    }))
}

/// Get a single patient by ID
#[get("/api/patients/{patient_id}")]
pub async fn get_patient_by_id(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // RBAC: Check if caller can access patient records
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Patients can only view their own records
    // Check by linked_patient_id for wallet-linked users, or by wallet_address for legacy patients
    let is_own_record = current_user.linked_patient_id.as_ref() == Some(&patient_id)
        || current_user.wallet_address == patient_id;
    if current_user.role == Role::Patient && !is_own_record {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Patients can only view their own records".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // Via repository (was: in-memory data.patients HashMap); decrypt profile blob.
    match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(entity) => match patient_entity_to_profile(&entity, &data.encryption_keyring) {
            Some(profile) => HttpResponse::Ok().json(profile),
            // The row exists; its PHI just cannot be decrypted with the keys
            // this process holds. Reporting that as `PATIENT_NOT_FOUND` told
            // the caller the patient was never registered, which is false and
            // clinically misleading. Unlike the list — which must stay usable
            // and so degrades the row — there is nothing safe to return here,
            // so this fails loudly instead.
            None => {
                let reason = unreadable_reason(&entity, &data.encryption_keyring);
                log::error!("patient profile is unreadable ({reason})");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: format!(
                        "Patient {patient_id} is registered but their stored record could not be decrypted"
                    ),
                    code: "PATIENT_PROFILE_UNREADABLE".to_string(),
                })
            }
        },
        Err(_) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Patient {} not found", patient_id),
            code: "PATIENT_NOT_FOUND".to_string(),
        }),
    }
}

/// Update patient request body
#[derive(Debug, Deserialize)]
pub struct UpdatePatientRequest {
    pub allergies: Option<Vec<String>>,
    pub current_medications: Option<Vec<String>>,
    pub chronic_conditions: Option<Vec<String>>,
    pub organ_donor: Option<bool>,
    pub dnr_status: Option<bool>,
    /// Mark/clear the DNR advance directive as verified. When `Some(true)`, the
    /// acting provider is recorded as `dnr_verified_by` with the current time as
    /// `dnr_verified_at`. `Some(false)` clears the verification metadata.
    pub dnr_verified: Option<bool>,
    /// Optional reference to the advance-directive document backing the DNR.
    pub dnr_document_ref: Option<String>,
    pub emergency_contact_name: Option<String>,
    pub emergency_contact_phone: Option<String>,
    pub emergency_contact_relationship: Option<String>,
}

/// Update patient response
#[derive(Debug, Serialize)]
pub struct UpdatePatientResponse {
    pub success: bool,
    pub patient_id: String,
    pub updated_by: String,
    pub message: String,
}

/// Update a patient's medical information (Doctor/Nurse only)
#[put("/api/patients/{patient_id}")]
pub async fn update_patient(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<UpdatePatientRequest>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // RBAC: Check if caller can edit medical records
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error:
                    "Missing X-User-Id header. Only doctors and nurses can update patient records."
                        .to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // CRITICAL: Only Doctor, Nurse, or Admin can edit records
    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Only doctors and nurses can update medical records. Your role: {}",
                current_user.role
            ),
            code: "NOT_HEALTHCARE_PROVIDER".to_string(),
        });
    }

    // Update patient record via repository (was: in-memory data.patients HashMap)
    let entity = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(e) => e,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    };
    let mut patient = match patient_entity_to_profile(&entity, &data.encryption_keyring) {
        Some(p) => p,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    };

    // Update fields if provided
    if let Some(allergies) = &req.allergies {
        // Convert string allergies to Allergy structs with Mild severity
        patient.emergency_info.allergies = allergies
            .iter()
            .map(|name| Allergy {
                name: name.clone(),
                severity: AllergySeverity::Mild,
                reaction: None,
                verified_at: Some(Utc::now()),
            })
            .collect();
    }
    if let Some(meds) = &req.current_medications {
        patient.emergency_info.current_medications = meds.clone();
    }
    if let Some(conditions) = &req.chronic_conditions {
        patient.emergency_info.chronic_conditions = conditions.clone();
    }
    if let Some(organ_donor) = req.organ_donor {
        patient.emergency_info.organ_donor = organ_donor;
    }
    if let Some(dnr) = req.dnr_status {
        patient.emergency_info.dnr_status = dnr;
    }
    // DNR verification: only a provider who can edit records (gated above) may
    // attest to the advance directive. Bind the verifier to the authenticated
    // caller — never trust a client-supplied "verified_by".
    if let Some(verified) = req.dnr_verified {
        if verified {
            patient.emergency_info.dnr_verified_by = Some(current_user_id.clone());
            patient.emergency_info.dnr_verified_at = Some(Utc::now());
        } else {
            patient.emergency_info.dnr_verified_by = None;
            patient.emergency_info.dnr_verified_at = None;
        }
    }
    if let Some(doc_ref) = &req.dnr_document_ref {
        patient.emergency_info.dnr_document_ref = Some(doc_ref.clone());
    }

    // Update emergency contact if any field provided
    if req.emergency_contact_name.is_some()
        || req.emergency_contact_phone.is_some()
        || req.emergency_contact_relationship.is_some()
    {
        if let Some(contact) = patient.emergency_info.emergency_contacts.get_mut(0) {
            if let Some(name) = &req.emergency_contact_name {
                contact.name = name.clone();
            }
            if let Some(phone) = &req.emergency_contact_phone {
                contact.phone = phone.clone();
            }
            if let Some(rel) = &req.emergency_contact_relationship {
                contact.relationship = rel.clone();
            }
        }
    }

    patient.emergency_info.last_updated = Utc::now();
    patient.last_updated = Utc::now();

    // Persist via repository, preserving entity-only fields not in PatientProfile.
    let mut updated_entity = patient_profile_to_entity(&patient, &data.encryption_keyring);
    updated_entity.health_id = entity.health_id.clone();
    updated_entity.gender = entity.gender.clone();
    updated_entity.wallet_address = entity.wallet_address.clone();
    updated_entity.is_verified = entity.is_verified;
    updated_entity.registered_by = entity.registered_by.clone();
    updated_entity.primary_provider_id = entity.primary_provider_id.clone();
    updated_entity.created_at = entity.created_at;
    if let Err(e) = data.repositories.patients.update(updated_entity).await {
        log::error!("Patient update persistence failed: {}", e);
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Failed to persist patient update".to_string(),
            code: "REPO_ERROR".to_string(),
        });
    }

    log::info!(
        "Patient {} updated by provider {}",
        patient_id,
        current_user_id
    );

    HttpResponse::Ok().json(UpdatePatientResponse {
        success: true,
        patient_id,
        updated_by: current_user_id,
        message: "Patient record updated successfully".to_string(),
    })
}

/// Add emergency contact request
#[derive(Debug, Deserialize)]
pub struct AddEmergencyContactRequest {
    pub name: String,
    pub phone: String,
    pub relationship: String,
}

/// Add emergency contact (Patient can manage their own contacts)
#[post("/api/patients/{patient_id}/emergency-contacts")]
pub async fn add_emergency_contact(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<AddEmergencyContactRequest>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // Get current user
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Patients can only manage their own emergency contacts
    // Healthcare providers can manage any patient's contacts
    let is_own_record =
        crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id);
    let is_provider = current_user.role.can_edit_medical_records();

    if !is_own_record && !is_provider {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "You can only manage your own emergency contacts".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // Validate input
    if req.name.trim().is_empty()
        || req.phone.trim().is_empty()
        || req.relationship.trim().is_empty()
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Name, phone, and relationship are required".to_string(),
            code: "INVALID_INPUT".to_string(),
        });
    }

    // Add emergency contact via repository (was: in-memory data.patients HashMap)
    let entity = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(e) => e,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    };
    let mut patient = match patient_entity_to_profile(&entity, &data.encryption_keyring) {
        Some(p) => p,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    };

    // Determine next priority based on existing contacts
    let next_priority = patient.emergency_info.emergency_contacts.len() as u8 + 1;

    let new_contact = EmergencyContact {
        name: req.name.clone(),
        phone: req.phone.clone(),
        relationship: req.relationship.clone(),
        priority: next_priority,
        can_make_medical_decisions: false,
        language: None,
    };

    patient
        .emergency_info
        .emergency_contacts
        .push(new_contact.clone());
    patient.emergency_info.last_updated = Utc::now();
    patient.last_updated = Utc::now();

    // Persist via repository, preserving entity-only fields not in PatientProfile.
    let mut updated_entity = patient_profile_to_entity(&patient, &data.encryption_keyring);
    updated_entity.health_id = entity.health_id.clone();
    updated_entity.gender = entity.gender.clone();
    updated_entity.wallet_address = entity.wallet_address.clone();
    updated_entity.is_verified = entity.is_verified;
    updated_entity.registered_by = entity.registered_by.clone();
    updated_entity.primary_provider_id = entity.primary_provider_id.clone();
    updated_entity.created_at = entity.created_at;
    if let Err(e) = data.repositories.patients.update(updated_entity).await {
        log::error!("Emergency contact persistence failed: {}", e);
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Failed to persist emergency contact".to_string(),
            code: "REPO_ERROR".to_string(),
        });
    }

    log::info!(
        "Emergency contact added to patient {} by {}",
        patient_id,
        current_user_id
    );

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "contact": new_contact,
        "message": "Emergency contact added successfully"
    }))
}
