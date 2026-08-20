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
    req: web::Json<serde_json::Value>,
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

    let body = req.into_inner();
    let now = chrono::Utc::now();
    // Server-generated: a client-supplied id lets one submission overwrite another.
    let ama_id = format!("AMA-{}", uuid::Uuid::new_v4().simple());
    let entity = AmaDischargeEntity {
        id: ama_id.clone(),
        patient_id: body
            .get("patient_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        encounter_id: body
            .get("encounter_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        discharge_datetime: body
            .get("discharge_datetime")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc))
            .unwrap_or(now),
        attending_physician_id: body
            .get("attending_physician_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        reason_for_leaving: body
            .get("reason_for_leaving")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        risks_explained: body
            .get("risks_explained")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
        specific_risks_discussed: body
            .get("specific_risks_discussed")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        patient_verbalized_understanding: body
            .get("patient_verbalized_understanding")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        decision_making_capacity: body
            .get("decision_making_capacity")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        capacity_assessment: body
            .get("capacity_assessment")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        alternatives_offered: body.get("alternatives_offered").cloned(),
        patient_refused_alternatives: body
            .get("patient_refused_alternatives")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        ama_form_signed: body
            .get("ama_form_signed")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        ama_form_refused_reason: body
            .get("ama_form_refused_reason")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        witness_present: body
            .get("witness_present")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        witness_name: body
            .get("witness_name")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        witness_signature: body
            .get("witness_signature")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        patient_given_prescriptions: body
            .get("patient_given_prescriptions")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        prescriptions_given: body.get("prescriptions_given").cloned(),
        follow_up_offered: body
            .get("follow_up_offered")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        follow_up_instructions: body
            .get("follow_up_instructions")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        patient_contact_info_verified: body
            .get("patient_contact_info_verified")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        emergency_contact_notified: body
            .get("emergency_contact_notified")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        belongings_returned: body
            .get("belongings_returned")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        security_escort: body
            .get("security_escort")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        police_notified: body
            .get("police_notified")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        social_work_notified: body
            .get("social_work_notified")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        documentation_complete: body
            .get("documentation_complete")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        physician_narrative: body
            .get("physician_narrative")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        nurse_notes: body
            .get("nurse_notes")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        created_at: now,
        updated_at: now,
        data: body.clone(),
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

/// Record a consultant's response to a consultation request.
///
/// A consult exists to get a specialist's assessment back to the requesting
/// clinician, and there was no endpoint to store one: the portal collected the
/// assessment, recommendations and follow-up, updated its own local array,
/// announced "Response submitted", and lost every word on reload. The request
/// persisted; the answer to it did not.
///
/// Completing a consult is deliberately separate from `create_consult` rather
/// than an arbitrary field update — it is a distinct clinical act by a
/// different clinician, and it is the point at which the note becomes part of
/// the record the requester relies on.
#[put("/api/clinical/consult/{id}/response")]
pub async fn respond_to_consult(
    data: web::Data<AppState>,
    path: web::Path<String>,
    req: web::Json<serde_json::Value>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let consult_id = path.into_inner();
    let body = req.into_inner();

    // An assessment and a recommendation are what a consult is for. Accepting a
    // response without them would file an empty answer as a completed consult,
    // and the requesting clinician would see it closed with nothing in it.
    let assessment = body
        .get("assessment")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let recommendations = body
        .get("recommendations")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let (Some(assessment), Some(recommendations)) = (assessment, recommendations) else {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "assessment and recommendations are required to complete a consult".to_string(),
            code: "MISSING_FIELD".to_string(),
        });
    };

    let mut entity = match data
        .repositories
        .consultation_notes
        .get_by_id(&consult_id)
        .await
    {
        Ok(e) => e,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Consultation not found".to_string(),
                code: "CONSULT_NOT_FOUND".to_string(),
            })
        }
    };

    // A completed consult is not re-openable by another response: the requester
    // may already have acted on the first one, so a silent overwrite would
    // change advice that has been relied upon.
    if entity.status.as_deref() == Some("completed") {
        return HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: "This consultation already has a response".to_string(),
            code: "CONSULT_ALREADY_ANSWERED".to_string(),
        });
    }

    let now = chrono::Utc::now();
    entity.examination_findings = Some(assessment.to_string());
    entity.recommendations = recommendations.to_string();
    entity.follow_up_plan = body
        .get("follow_up")
        .or_else(|| body.get("follow_up_plan"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    // The responder is taken from the authenticated caller, never from the
    // body: a consultant's name on a clinical opinion is an attribution, and a
    // client-supplied one would let anyone sign as anyone.
    entity.consulting_provider = current_user.wallet_address.clone();
    entity.status = Some("completed".to_string());
    entity.completed_at = Some(now);
    entity.updated_at = now;

    // `get_consult` serves `entity.data` — the JSON the request was filed with —
    // rather than the columns. Updating only the columns therefore left every
    // read showing the consult as still outstanding with no response on it,
    // even though the write had succeeded. Mirror the response into the blob so
    // the two read paths cannot disagree about whether a consult was answered.
    if let Some(stored) = entity.data.as_object_mut() {
        stored.insert("status".into(), serde_json::json!("completed"));
        stored.insert("examination_findings".into(), serde_json::json!(assessment));
        stored.insert("recommendations".into(), serde_json::json!(recommendations));
        stored.insert(
            "follow_up_plan".into(),
            serde_json::json!(entity.follow_up_plan),
        );
        stored.insert(
            "consulting_provider".into(),
            serde_json::json!(entity.consulting_provider),
        );
        stored.insert("completed_at".into(), serde_json::json!(now.to_rfc3339()));
    }

    match data.repositories.consultation_notes.update(entity).await {
        Ok(stored) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "consult_id": stored.id,
            "status": stored.status,
            "completed_at": stored.completed_at,
            "consulting_provider": stored.consulting_provider
        })),
        Err(e) => {
            log::error!("consult {consult_id} response could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "The consultation response could not be saved".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Create consultation note
#[post("/api/clinical/consult")]
pub async fn create_consult(
    data: web::Data<AppState>,
    req: web::Json<serde_json::Value>,
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

    let body = req.into_inner();
    let now = chrono::Utc::now();
    // Server-generated: a client-supplied id lets one submission overwrite another.
    let consult_id = format!("CON-{}", uuid::Uuid::new_v4().simple());
    let entity = ConsultationNoteEntity {
        id: consult_id.clone(),
        patient_id: body
            .get("patient_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        consultation_type: body
            .get("consultation_type")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        requesting_provider: body
            .get("requesting_provider")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        consulting_provider: body
            .get("consulting_provider")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        reason_for_consultation: body
            .get("reason_for_consultation")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        clinical_question: body
            .get("clinical_question")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        pertinent_history: body
            .get("pertinent_history")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        examination_findings: body
            .get("examination_findings")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        recommendations: body
            .get("recommendations")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        follow_up_plan: body
            .get("follow_up_plan")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        urgency: body
            .get("urgency")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        status: body
            .get("status")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        requested_at: body
            .get("requested_at")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc))
            .unwrap_or(now),
        completed_at: body
            .get("completed_at")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
        created_at: now,
        updated_at: now,
        facility_id: body
            .get("facility_id")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        is_active: true,
        data: body.clone(),
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
        status: if note.cosigned_by.is_some() {
            "final"
        } else {
            "draft"
        }
        .to_string(),
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

#[cfg(test)]
mod consult_response_tests {
    use super::*;
    use actix_web::test;

    fn register(state: &AppState, wallet: &str, role: crate::Role) {
        state.users.write().unwrap().insert(
            wallet.to_string(),
            crate::User {
                wallet_address: wallet.to_string(),
                username: Some(wallet.to_string()),
                name: "Test Clinician".to_string(),
                role,
                created_at: chrono::Utc::now(),
                created_by: None,
                linked_patient_id: None,
                email: None,
                phone: None,
                department: None,
                specialty: None,
                license_number: None,
                status: "active".to_string(),
                last_login: None,
            },
        );
    }

    /// Files a consult and yields its id.
    ///
    /// A macro rather than a function: `test::init_service` returns an opaque
    /// `impl Service` whose bounds mention types this crate does not depend on
    /// directly, so naming it in a signature is more trouble than expanding at
    /// the call site.
    macro_rules! create_consult_id {
        ($app:expr, $patient_id:expr) => {{
            let created: serde_json::Value = test::call_and_read_body_json(
                $app,
                test::TestRequest::post()
                    .uri("/api/clinical/consult")
                    .insert_header(("x-user-id", "doctor_wallet"))
                    .set_json(serde_json::json!({
                        "patient_id": $patient_id,
                        "consultation_type": "cardiology",
                        "requesting_provider": "doctor_wallet",
                        "reason_for_consultation": "Chest pain on exertion",
                        "status": "requested"
                    }))
                    .to_request(),
            )
            .await;
            created["consult_id"]
                .as_str()
                .expect("consult id")
                .to_string()
        }};
    }

    /// A consult exists to get a specialist opinion back to the clinician who
    /// asked for it. Before this endpoint existed the portal kept the response
    /// in local state and announced success, so the assessment survived exactly
    /// as long as the browser tab.
    ///
    /// The read-back matters as much as the write: `get_consult` serves
    /// `entity.data` rather than the columns, so an implementation that updated
    /// only the columns reported success while every reader still saw the
    /// consult as unanswered.
    #[actix_web::test]
    async fn responding_to_a_consult_persists_and_is_readable() {
        let state = crate::AppState::new();
        register(&state, "doctor_wallet", crate::Role::Doctor);
        let app_state = web::Data::new(state);

        let app = test::init_service(
            actix_web::App::new()
                .app_data(app_state.clone())
                .service(create_consult)
                .service(respond_to_consult)
                .service(get_consult),
        )
        .await;

        let consult_id = create_consult_id!(&app, "PAT-CONSULT-1");

        let resp = test::call_service(
            &app,
            test::TestRequest::put()
                .uri(&format!("/api/clinical/consult/{consult_id}/response"))
                .insert_header(("x-user-id", "doctor_wallet"))
                .set_json(serde_json::json!({
                    "assessment": "No acute ischaemia; troponin negative.",
                    "recommendations": "Outpatient stress test; aspirin 75mg daily.",
                    "follow_up": "Cardiology clinic in 2 weeks"
                }))
                .to_request(),
        )
        .await;
        assert!(resp.status().is_success(), "response should be accepted");

        // Read it back through the endpoint a clinician actually uses.
        let stored: serde_json::Value = test::call_and_read_body_json(
            &app,
            test::TestRequest::get()
                .uri(&format!("/api/clinical/consult/{consult_id}"))
                .insert_header(("x-user-id", "doctor_wallet"))
                .to_request(),
        )
        .await;

        assert_eq!(stored["status"], "completed");
        assert_eq!(
            stored["recommendations"],
            "Outpatient stress test; aspirin 75mg daily."
        );
        assert_eq!(
            stored["examination_findings"],
            "No acute ischaemia; troponin negative."
        );
        assert_eq!(stored["consulting_provider"], "doctor_wallet");
        assert!(stored["completed_at"].is_string());
    }

    /// An answered consult must not be silently overwritten: the requester may
    /// already have acted on the first opinion.
    #[actix_web::test]
    async fn a_second_response_is_refused() {
        let state = crate::AppState::new();
        register(&state, "doctor_wallet", crate::Role::Doctor);
        let app_state = web::Data::new(state);

        let app = test::init_service(
            actix_web::App::new()
                .app_data(app_state.clone())
                .service(create_consult)
                .service(respond_to_consult),
        )
        .await;

        let consult_id = create_consult_id!(&app, "PAT-CONSULT-2");
        let body = serde_json::json!({
            "assessment": "First opinion.",
            "recommendations": "First plan."
        });

        let first = test::call_service(
            &app,
            test::TestRequest::put()
                .uri(&format!("/api/clinical/consult/{consult_id}/response"))
                .insert_header(("x-user-id", "doctor_wallet"))
                .set_json(&body)
                .to_request(),
        )
        .await;
        assert!(first.status().is_success());

        let second = test::call_service(
            &app,
            test::TestRequest::put()
                .uri(&format!("/api/clinical/consult/{consult_id}/response"))
                .insert_header(("x-user-id", "doctor_wallet"))
                .set_json(&body)
                .to_request(),
        )
        .await;
        assert_eq!(second.status(), actix_web::http::StatusCode::CONFLICT);
    }

    /// A consult closed with nothing in it is worse than one left open: the
    /// requester sees it answered and stops waiting.
    #[actix_web::test]
    async fn an_empty_response_is_rejected() {
        let state = crate::AppState::new();
        register(&state, "doctor_wallet", crate::Role::Doctor);
        let app_state = web::Data::new(state);

        let app = test::init_service(
            actix_web::App::new()
                .app_data(app_state.clone())
                .service(create_consult)
                .service(respond_to_consult),
        )
        .await;

        let consult_id = create_consult_id!(&app, "PAT-CONSULT-3");

        let resp = test::call_service(
            &app,
            test::TestRequest::put()
                .uri(&format!("/api/clinical/consult/{consult_id}/response"))
                .insert_header(("x-user-id", "doctor_wallet"))
                .set_json(serde_json::json!({ "assessment": "   ", "recommendations": "" }))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::BAD_REQUEST);
    }
}
