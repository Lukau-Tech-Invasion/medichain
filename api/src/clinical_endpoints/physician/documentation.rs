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

    let body = normalise_body_keys(req.into_inner());
    // `AMAPage` posts camelCase (`patientStatement`, `recommendedTreatment`,
    // `witnessName`); every lookup below is snake_case, so the discharge was
    // stored with an empty statement, no named treatment and no witness — the
    // three things the document exists to record.

    // Capacity is the precondition, not a field.
    //
    // A patient who lacks decision-making capacity cannot validly refuse
    // treatment, so an against-medical-advice discharge recorded without a
    // capacity determination is not a lawful AMA — it is a patient leaving. It
    // is also the first document a coroner or a malpractice review asks for.
    //
    // The column and this handler have always carried
    // `decision_making_capacity` and `capacity_assessment`; nothing sent them,
    // so every AMA discharge in the system recorded capacity as `false` with no
    // assessment behind it, which reads as "we discharged someone we had
    // decided could not consent".
    //
    // Enforced here rather than only in the form: the form is a client, and the
    // record's lawfulness is not a client's decision.
    // `AMAPage` calls these `hasCapacity` and `capacityBasis`, which
    // `normalise_body_keys` turns into `has_capacity` / `capacity_basis` — a
    // genuine name difference rather than a casing one, so both spellings are
    // read here.
    let has_capacity = body
        .get("decision_making_capacity")
        .or_else(|| body.get("has_capacity"))
        .and_then(|v| v.as_bool());
    let capacity_assessment = body
        .get("capacity_assessment")
        .or_else(|| body.get("capacity_basis"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|a| !a.is_empty());
    match (has_capacity, capacity_assessment) {
        (Some(true), Some(_)) => {}
        (Some(true), None) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "capacity_assessment is required: record how capacity was assessed,                         not only that it was"
                    .to_string(),
                code: "CAPACITY_ASSESSMENT_REQUIRED".to_string(),
            })
        }
        (Some(false), _) => {
            return HttpResponse::UnprocessableEntity().json(ErrorResponse {
                success: false,
                error: "A patient assessed as lacking decision-making capacity cannot be                         discharged against medical advice. Escalate rather than filing an                         AMA discharge."
                    .to_string(),
                code: "PATIENT_LACKS_CAPACITY".to_string(),
            })
        }
        (None, _) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "decision_making_capacity is required: an AMA discharge is only valid                         if the patient was assessed as able to refuse treatment"
                    .to_string(),
                code: "CAPACITY_DETERMINATION_REQUIRED".to_string(),
            })
        }
    }
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
        // Resolved above, under either spelling, and already validated: the
        // handler refuses the request outright when capacity was not assessed.
        decision_making_capacity: has_capacity.unwrap_or(false),
        capacity_assessment: capacity_assessment.map(str::to_string),
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
        Ok(entity) => {
            // The stored record, not `entity.data`. `data` is `#[sqlx(skip)]`
            // on every one of these entities, so on PostgreSQL it is always
            // `Value::Null` — this endpoint returned a literal `null` with a
            // 200 for every record ever saved. The typed columns are the record.
            HttpResponse::Ok().json(entity)
        }
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
            log::error!("consult response could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "The consultation response could not be saved".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// What the consult request form actually submits.
///
/// `ConsultPage.tsx` posts camelCase, and this handler used to read snake_case
/// out of an untyped `serde_json::Value` with `unwrap_or_default()` behind every
/// lookup. Nothing matched. `patient_id` therefore resolved to `""`, which on
/// PostgreSQL violated `consultation_notes_patient_id_fkey` and returned a 500 —
/// and on the in-memory backend *succeeded*, filing a consult attached to
/// nobody, with an empty specialty, an empty question and an empty requester.
///
/// A typed struct is the fix rather than adding camelCase lookups beside the
/// snake_case ones: serde then refuses a body it cannot read instead of
/// silently substituting a default, so the next rename fails loudly on the
/// first request rather than quietly for months.
///
/// `alias` keeps the snake_case spellings working. Several already exist in
/// stored `data` blobs and in the synthetic harness, and breaking them to fix a
/// different caller would trade one silent mismatch for another.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateConsultRequest {
    #[serde(rename = "patientId", alias = "patient_id")]
    pub patient_id: String,
    /// The specialty being asked, which is what `consultation_type` means.
    #[serde(rename = "specialty", alias = "consultation_type", default)]
    pub specialty: String,
    #[serde(rename = "requestedBy", alias = "requesting_provider", default)]
    pub requested_by: String,
    #[serde(rename = "consultingProvider", alias = "consulting_provider", default)]
    pub consulting_provider: String,
    #[serde(rename = "reason", alias = "reason_for_consultation", default)]
    pub reason: String,
    #[serde(rename = "clinicalQuestion", alias = "clinical_question", default)]
    pub clinical_question: Option<String>,
    #[serde(rename = "relevantHistory", alias = "pertinent_history", default)]
    pub relevant_history: Option<String>,
    #[serde(default)]
    pub urgency: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(rename = "requestedAt", alias = "requested_at", default)]
    pub requested_at: Option<String>,
    /// Context the specialist reads and the columns have no home for. Kept in
    /// the JSON blob rather than dropped: a consult answered without the
    /// medication list or the results that prompted it is answered blind.
    #[serde(rename = "currentMedications", default)]
    pub current_medications: Option<String>,
    #[serde(rename = "vitalSigns", default)]
    pub vital_signs: Option<String>,
    #[serde(rename = "labResults", default)]
    pub lab_results: Option<String>,
    #[serde(rename = "imagingResults", default)]
    pub imaging_results: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// Create consultation note
#[post("/api/clinical/consult")]
pub async fn create_consult(
    data: web::Data<AppState>,
    req: web::Json<CreateConsultRequest>,
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

    // A consult is a request *about a patient*. An empty or unknown patient id
    // used to reach the database and fail there as a foreign-key error, which
    // is a 500 for what is a client mistake.
    if body.patient_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id is required".to_string(),
            code: "MISSING_PATIENT_ID".to_string(),
        });
    }
    if data
        .repositories
        .patients
        .get_by_id(&body.patient_id)
        .await
        .is_err()
    {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Patient '{}' not found", body.patient_id),
            code: "PATIENT_NOT_FOUND".to_string(),
        });
    }
    // The question is the consult. Filing one without it produces a request the
    // specialist cannot answer and the requester cannot chase.
    let question = body
        .clinical_question
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty());
    if question.is_none() && body.reason.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "a consult needs a reason or a clinical question".to_string(),
            code: "MISSING_FIELD".to_string(),
        });
    }

    // Server-generated: a client-supplied id lets one submission overwrite another.
    let consult_id = format!("CON-{}", uuid::Uuid::new_v4().simple());
    // The requester is the authenticated caller, not a name the client asserts.
    let requesting_provider = if body.requested_by.trim().is_empty() {
        current_user.wallet_address.clone()
    } else {
        body.requested_by.clone()
    };
    let requested_at = body
        .requested_at
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&chrono::Utc))
        .unwrap_or(now);

    // `get_consult` and the platform list both serve `data`, so the blob has to
    // carry everything the columns do plus the context they have no home for.
    // Two read paths disagreeing about whether a consult was answered is a bug
    // this endpoint has already produced once.
    let blob = serde_json::json!({
        "consult_id": consult_id,
        "patient_id": body.patient_id,
        "specialty": body.specialty,
        "consultation_type": body.specialty,
        "urgency": body.urgency,
        "status": body.status.clone().unwrap_or_else(|| "requested".to_string()),
        "reason": body.reason,
        "clinical_question": body.clinical_question,
        "relevant_history": body.relevant_history,
        "current_medications": body.current_medications,
        "vital_signs": body.vital_signs,
        "lab_results": body.lab_results,
        "imaging_results": body.imaging_results,
        "notes": body.notes,
        "requested_by": requesting_provider,
        "requested_at": requested_at.to_rfc3339(),
    });

    let entity = ConsultationNoteEntity {
        id: consult_id.clone(),
        patient_id: body.patient_id.clone(),
        consultation_type: body.specialty.clone(),
        requesting_provider,
        consulting_provider: body.consulting_provider.clone(),
        reason_for_consultation: body.reason.clone(),
        clinical_question: body.clinical_question.clone(),
        pertinent_history: body.relevant_history.clone(),
        examination_findings: None,
        recommendations: String::new(),
        follow_up_plan: None,
        urgency: body.urgency.clone(),
        // `requested` is the state every new consult starts in, and the
        // `consultation_notes` CHECK constraint permits it.
        status: Some(
            body.status
                .clone()
                .unwrap_or_else(|| "requested".to_string()),
        ),
        requested_at,
        completed_at: None,
        created_at: now,
        updated_at: now,
        facility_id: None,
        is_active: true,
        data: blob,
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
        Err(e) => {
            log::error!("consult could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "The consultation request could not be saved".to_string(),
                code: "INTERNAL_ERROR".to_string(),
            })
        }
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
        Ok(entity) => {
            // The stored record, not `entity.data`. `data` is `#[sqlx(skip)]`
            // on every one of these entities, so on PostgreSQL it is always
            // `Value::Null` — this endpoint returned a literal `null` with a
            // 200 for every record ever saved. The typed columns are the record.
            HttpResponse::Ok().json(entity)
        }
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
        Ok(entity) => {
            // The stored record, not `entity.data`. `data` is `#[sqlx(skip)]`
            // on every one of these entities, so on PostgreSQL it is always
            // `Value::Null` — this endpoint returned a literal `null` with a
            // 200 for every record ever saved. The typed columns are the record.
            HttpResponse::Ok().json(entity)
        }
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

    /// Put a patient on the record so a consult can be filed about them.
    ///
    /// `create_consult` refuses a `patient_id` that does not resolve. Before it
    /// did, these tests filed consults about `"PAT-CONSULT-1"` — an id nothing
    /// had ever created — and passed, which is exactly the state the refusal
    /// exists to prevent: a consult request attached to nobody, discoverable by
    /// no query and belonging to no chart.
    async fn seed_patient(state: &AppState, patient_id: &str) {
        let now = chrono::Utc::now();
        state
            .repositories
            .patients
            .create(crate::repositories::traits::PatientEntity {
                id: patient_id.to_string(),
                health_id: format!("HID-{patient_id}"),
                national_id_hash: format!("hash-{patient_id}"),
                national_id_type: "FaydaID".to_string(),
                first_name_encrypted: None,
                last_name_encrypted: None,
                date_of_birth_encrypted: None,
                gender: Some("Female".to_string()),
                blood_type: Some("O+".to_string()),
                phone_encrypted: None,
                email_encrypted: None,
                address_encrypted: None,
                emergency_contact_name_encrypted: None,
                emergency_contact_phone_encrypted: None,
                emergency_contact_relationship: None,
                organ_donor: false,
                dnr_status: false,
                dnr_verified_by: None,
                dnr_verified_at: None,
                dnr_document_ref: None,
                primary_provider_id: None,
                wallet_address: None,
                created_at: now,
                updated_at: now,
                registered_by: None,
                is_verified: false,
                is_active: true,
                profile_extras_encrypted: None,
                key_version: 1,
            })
            .await
            .expect("seed patient");
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

        seed_patient(&app_state, "PAT-CONSULT-1").await;
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

        seed_patient(&app_state, "PAT-CONSULT-2").await;
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

        seed_patient(&app_state, "PAT-CONSULT-3").await;
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
