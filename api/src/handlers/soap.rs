use super::*;

// ----------------------------------------------------------------------------
// SOAP Notes Endpoints
// ----------------------------------------------------------------------------

/// Request body for creating a SOAP note
#[derive(Debug, Deserialize)]
pub struct CreateSOAPNoteRequest {
    pub patient_id: String,
    pub encounter_type: String,
    pub subjective: crate::clinical::SubjectiveSection,
    pub objective: crate::clinical::ObjectiveSection,
    pub assessment: crate::clinical::AssessmentSection,
    pub plan: crate::clinical::PlanSection,
}

/// Create a new SOAP note
/// Requires: Doctor, Nurse, or Admin role
#[post("/api/clinical/soap")]
pub async fn create_soap_note(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateSOAPNoteRequest>,
) -> impl Responder {
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Role '{}' cannot create SOAP notes. Required: Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Input validation
    if let Err(e) =
        validation::validate_string_length(&req.patient_id, "patient_id", validation::MAX_ID_LENGTH)
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: e,
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if let Err(e) = validation::validate_string_length(
        &req.encounter_type,
        "encounter_type",
        validation::MAX_NAME_LENGTH,
    ) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: e,
            code: "VALIDATION_ERROR".to_string(),
        });
    }

    // Verify patient exists
    {
        if data
            .repositories
            .patients
            .get_by_id(&req.patient_id)
            .await
            .is_err()
        {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Patient '{}' not found", req.patient_id),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    }

    // Generate note ID
    let note_id = format!(
        "SOAP-{}",
        Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    // Create SOAP note
    let soap_note = SOAPNote {
        note_id: note_id.clone(),
        patient_id: req.patient_id.clone(),
        encounter_type: req.encounter_type.clone(),
        subjective: req.subjective.clone(),
        objective: req.objective.clone(),
        assessment: req.assessment.clone(),
        plan: req.plan.clone(),
        author_id: current_user_id.clone(),
        created_at: Utc::now().timestamp(),
        updated_at: None,
        status: "active".to_string(),
        addenda: vec![],
    };

    // Store note via repository (was: in-memory data.soap_notes HashMap)
    {
        let now_dt = Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: note_id.clone(),
            owner_id: soap_note.patient_id.clone(),
            data: serde_json::to_value(&soap_note).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data.repositories.soap_note_records.create(entity).await;
    }

    // Log access via repository
    let _ = data
        .repositories
        .access_logs
        .create(
            AccessLogEntry {
                access_id: secure_tokens::generate_access_id(),
                patient_id: req.patient_id.clone(),
                accessor_id: current_user_id,
                accessor_role: current_user.role.to_string(),
                access_type: "create_soap_note".to_string(),
                location: None,
                timestamp: Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    log::info!(
        "SOAP note {} created for patient {}",
        note_id,
        req.patient_id
    );

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "note_id": note_id,
        "message": "SOAP note created successfully"
    }))
}

/// Get a SOAP note by ID
#[get("/api/clinical/soap/{note_id}")]
pub async fn get_soap_note(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let note_id = path.into_inner();

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

    let entity = match data
        .repositories
        .soap_note_records
        .get_by_id(&note_id)
        .await
        .ok()
        .flatten()
    {
        Some(e) => e,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("SOAP note '{}' not found", note_id),
                code: "NOTE_NOT_FOUND".to_string(),
            });
        }
    };
    let note: SOAPNote = match serde_json::from_value(entity.data.clone()) {
        Ok(n) => n,
        Err(_) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to decode SOAP note".to_string(),
                code: "DECODE_ERROR".to_string(),
            });
        }
    };

    // Healthcare providers or patient viewing own records
    if !current_user.role.is_healthcare_provider() && current_user_id != note.patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    HttpResponse::Ok().json(note)
}

/// Get all SOAP notes for a patient
#[get("/api/clinical/patient/{patient_id}/soap")]
pub async fn get_patient_soap_notes(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

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

    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    let entities = data
        .repositories
        .soap_note_records
        .get_by_owner(&patient_id)
        .await
        .unwrap_or_default();
    let patient_notes: Vec<SOAPNote> = entities
        .iter()
        .filter_map(|e| serde_json::from_value(e.data.clone()).ok())
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "total": patient_notes.len(),
        "notes": patient_notes
    }))
}

/// Add an addendum to a SOAP note
#[post("/api/clinical/soap/{note_id}/addendum")]
pub async fn add_soap_addendum(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let note_id = path.into_inner();

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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can add addenda".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let content = match body.get("content").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Missing 'content' field".to_string(),
                code: "MISSING_FIELD".to_string(),
            });
        }
    };

    let mut entity = match data
        .repositories
        .soap_note_records
        .get_by_id(&note_id)
        .await
        .ok()
        .flatten()
    {
        Some(e) => e,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("SOAP note '{}' not found", note_id),
                code: "NOTE_NOT_FOUND".to_string(),
            });
        }
    };
    let mut note: SOAPNote = match serde_json::from_value(entity.data.clone()) {
        Ok(n) => n,
        Err(_) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to decode SOAP note".to_string(),
                code: "DECODE_ERROR".to_string(),
            });
        }
    };

    let addendum = crate::clinical::SOAPAddendum {
        addendum_id: format!(
            "ADD-{}",
            Uuid::new_v4()
                .to_string()
                .split('-')
                .next()
                .unwrap_or("000")
        ),
        content,
        author_id: current_user_id.clone(),
        created_at: Utc::now().timestamp(),
    };

    let addendum_id = addendum.addendum_id.clone();
    note.addenda.push(addendum);
    note.updated_at = Some(Utc::now().timestamp());

    // Persist the updated note back via repository (was: in-memory get_mut)
    entity.data = serde_json::to_value(&note).unwrap_or_default();
    entity.updated_at = Utc::now();
    let _ = data.repositories.soap_note_records.create(entity).await;

    log::info!("Addendum {} added to SOAP note {}", addendum_id, note_id);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "addendum_id": addendum_id,
        "message": "Addendum added successfully"
    }))
}
