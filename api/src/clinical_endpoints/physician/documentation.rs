//! `clinical_endpoints::physician::documentation` — Phase 8 documentation handlers
//! (AMA discharge, history & physical, consult notes, progress notes).
//!
//! Split out of the former single-file `physician.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `physician/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

/// Create AMA discharge
#[post("/api/clinical/ama")]
pub async fn create_ama(
    data: web::Data<AppState>,
    req: web::Json<clinical::AMADischarge>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let ama_id = record.ama_id.clone();
    let now = Utc::now();
    let entity = AmaDischargeEntity {
        id: ama_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.ama_discharges.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "ama_id": ama_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/ama/{ama_id}")]
pub async fn get_ama(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let ama_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.ama_discharges.get_by_id(&ama_id).await {
        Ok(ama) => HttpResponse::Ok().json(ama.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "AMA discharge not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// The body the History & Physical form actually submits.
///
/// The clinical `HistoryAndPhysical` type models the history sections as
/// structured lists and uses different names (`hpi` vs `history_of_present_illness`,
/// `exam_time: i64` vs an ISO `dateOfExam`, `performed_by` vs `provider`), and it
/// types `review_of_systems` / `physical_exam` as structs where the form captures
/// free text. Deserialising the form body straight into it rejected EVERY
/// submission with a 400, so this endpoint had never once succeeded and no H&P
/// could be recorded at all. This DTO is the anti-corruption layer between the
/// form and storage; every field defaults so a partially completed H&P can still
/// be saved as a draft.
#[derive(Debug, Deserialize, serde::Serialize)]
pub struct CreateHpRequest {
    #[serde(default)]
    pub hp_id: Option<String>,
    pub patient_id: String,
    #[serde(default)]
    pub patient_name: String,
    #[serde(default)]
    pub mrn: String,
    #[serde(rename = "dateOfExam", default)]
    pub date_of_exam: Option<String>,
    #[serde(default)]
    pub exam_type: String,
    pub chief_complaint: String,
    #[serde(default)]
    pub history_of_present_illness: String,
    #[serde(default)]
    pub past_medical_history: Vec<String>,
    #[serde(default)]
    pub past_surgical_history: Vec<String>,
    #[serde(default)]
    pub medications: Vec<String>,
    #[serde(default)]
    pub allergies: Vec<String>,
    #[serde(default)]
    pub family_history: Vec<String>,
    #[serde(default)]
    pub social_history: serde_json::Value,
    #[serde(default)]
    pub vital_signs: serde_json::Value,
    #[serde(default)]
    pub review_of_systems: serde_json::Value,
    #[serde(default)]
    pub physical_exam: serde_json::Value,
    #[serde(default)]
    pub assessment: String,
    #[serde(default)]
    pub plan: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub status: String,
}

/// Create history and physical
#[post("/api/clinical/hp")]
pub async fn create_hp(
    data: web::Data<AppState>,
    req: web::Json<CreateHpRequest>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let mut hp = req.into_inner();
    if hp.patient_id.trim().is_empty() || hp.chief_complaint.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id and chief_complaint are required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if data
        .repositories
        .patients
        .get_by_id(&hp.patient_id)
        .await
        .is_err()
    {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Patient '{}' not found", hp.patient_id),
            code: "PATIENT_NOT_FOUND".to_string(),
        });
    }

    let now = chrono::Utc::now();
    // The id and the recording clinician are server-assigned: a client-supplied
    // id would let one submission overwrite another's record.
    let hp_id = format!("HP-{}", uuid::Uuid::new_v4().simple());
    hp.hp_id = Some(hp_id.clone());
    hp.provider = current_user.wallet_address.clone();
    if hp.date_of_exam.is_none() {
        hp.date_of_exam = Some(now.to_rfc3339());
    }

    // Populate the typed columns as well as the payload blob: the table models
    // the clinical sections as real columns, and filling only `data` left every
    // NOT NULL column empty and the record unqueryable by content.
    let join = |items: &[String]| {
        if items.is_empty() {
            None
        } else {
            Some(items.join("\n"))
        }
    };
    let entity = HistoryPhysicalEntity {
        id: hp_id.clone(),
        patient_id: hp.patient_id.clone(),
        chief_complaint: hp.chief_complaint.clone(),
        history_present_illness: hp.history_of_present_illness.clone(),
        past_medical_history: join(&hp.past_medical_history),
        family_history: join(&hp.family_history),
        social_history: Some(hp.social_history.to_string()),
        medications: join(&hp.medications),
        allergies: join(&hp.allergies),
        review_of_systems: Some(hp.review_of_systems.clone()),
        physical_exam: hp.physical_exam.clone(),
        vital_signs: Some(hp.vital_signs.clone()),
        assessment: hp.assessment.clone(),
        plan_content: hp.plan.clone(),
        exam_type: Some(hp.exam_type.clone()),
        performed_by: current_user.wallet_address.clone(),
        performed_at: now,
        facility_id: None,
        is_active: true,
        data: serde_json::to_value(&hp).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };

    match data.repositories.history_physicals.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "hp_id": hp_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => {
            log::error!("history and physical persistence failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to save the history and physical".to_string(),
                code: "REPO_ERROR".to_string(),
            })
        }
    }
}

#[get("/api/clinical/hp/{hp_id}")]
pub async fn get_hp(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let hp_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.history_physicals.get_by_id(&hp_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "H&P not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List all history and physical exams
#[get("/api/clinical/hp")]
pub async fn list_hps(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let hp_list = data
        .repositories
        .history_physicals
        .list_all()
        .await
        .unwrap_or_default();

    // Return the stored document itself rather than the storage envelope. The
    // page reads `record.dateOfExam` and the clinical fields directly, which on
    // the envelope are all undefined — so every listed H&P showed today's date
    // and no content.
    let records: Vec<serde_json::Value> = hp_list
        .into_iter()
        .map(|entity| {
            let mut value = entity.data;
            if let Some(object) = value.as_object_mut() {
                object.insert("id".to_string(), serde_json::json!(entity.id));
                object.insert(
                    "created_at".to_string(),
                    serde_json::json!(entity.created_at.to_rfc3339()),
                );
            }
            value
        })
        .collect();

    HttpResponse::Ok().json(records)
}

/// Create consultation note
#[post("/api/clinical/consult")]
pub async fn create_consult(
    data: web::Data<AppState>,
    req: web::Json<clinical::ConsultationNote>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let consult = req.into_inner();
    let consult_id = consult.consult_id.clone();
    let now = chrono::Utc::now();
    let entity = ConsultationNoteEntity {
        id: consult_id.clone(),
        patient_id: consult.patient_id.clone(),
        data: serde_json::to_value(&consult).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.consultation_notes.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "consult_id": consult_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/consult/{consult_id}")]
pub async fn get_consult(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let consult_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .consultation_notes
        .get_by_id(&consult_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Consultation note not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create progress note
#[post("/api/clinical/progress-note")]
pub async fn create_progress_note(
    data: web::Data<AppState>,
    req: web::Json<clinical::ProgressNote>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let note = req.into_inner();
    let note_id = note.note_id.clone();
    let now = chrono::Utc::now();
    let entity = ProgressNoteEntity {
        id: note_id.clone(),
        patient_id: note.patient_id.clone(),
        note_type: "daily".to_string(),
        subjective: Some(note.subjective.clone()),
        objective: Some(note.exam.clone()),
        assessment: Some(
            note.assessment
                .iter()
                .map(|problem| problem.problem.as_str())
                .collect::<Vec<_>>()
                .join("\n"),
        ),
        plan_content: Some(note.plan.join("\n")),
        cosigned_by: note.cosigned_by.clone(),
        cosigned_at: note.cosigned_by.as_ref().map(|_| now),
        created_by: current_user.wallet_address.clone(),
        status: if note.cosigned_by.is_some() { "final" } else { "draft" }.to_string(),
        data: serde_json::to_value(&note).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.progress_notes.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "note_id": note_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/progress-note/{note_id}")]
pub async fn get_progress_note(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let note_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.progress_notes.get_by_id(&note_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Progress note not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}
