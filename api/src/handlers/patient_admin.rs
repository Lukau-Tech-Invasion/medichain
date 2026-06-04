use super::*;

/// Get all registered patients (paginated)
/// Requires authentication: Only healthcare providers can list all patients
/// Query params: ?page=1&limit=20
#[get("/api/patients")]
pub async fn list_patients(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<PaginationQuery>,
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

    // List patients via repository (was: in-memory data.patients HashMap).
    // Decrypts each profile blob; capped at one page (100) like other list endpoints.
    let entities = match data
        .repositories
        .patients
        .list(crate::repositories::Pagination::new(0, 100))
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
    let patient_list: Vec<PatientProfile> = entities
        .iter()
        .filter_map(|e| patient_entity_to_profile(e, &data.encryption_key))
        .collect();
    let (data, pagination) = paginate(&patient_list, query.page, query.limit);

    HttpResponse::Ok().json(PaginatedResponse { data, pagination })
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
        Ok(entity) => match patient_entity_to_profile(&entity, &data.encryption_key) {
            Some(profile) => HttpResponse::Ok().json(profile),
            None => HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Patient {} not found", patient_id),
                code: "PATIENT_NOT_FOUND".to_string(),
            }),
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
    let mut patient = match patient_entity_to_profile(&entity, &data.encryption_key) {
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
    let mut updated_entity = patient_profile_to_entity(&patient, &data.encryption_key);
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
    let is_own_record = current_user_id == patient_id;
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
    let mut patient = match patient_entity_to_profile(&entity, &data.encryption_key) {
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
    let mut updated_entity = patient_profile_to_entity(&patient, &data.encryption_key);
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

