//! `clinical_endpoints::assessment::specialized` — Phase 4 specialized assessment handlers
//! (burn, psych, tox, MCI).
//!
//! Split out of the former single-file `assessment.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `assessment/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// ============================================================================
// PHASE 4: SPECIALIZED ASSESSMENT ENDPOINTS
// ============================================================================

/// Create burn assessment
#[post("/api/clinical/burn")]
pub async fn create_burn(
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
    let assessment_id = format!("BRN-{}", uuid::Uuid::new_v4().simple());
    let entity = BurnAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: body.get("patient_id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        assessed_by: body.get("assessed_by").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        assessment_datetime: body.get("assessment_datetime").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)).unwrap_or(now),
        mechanism_of_injury: body.get("mechanism_of_injury").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        burn_agent: body.get("burn_agent").and_then(|v| v.as_str()).map(str::to_string),
        time_of_injury: body.get("time_of_injury").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)),
        tbsa_percentage: body.get("tbsa_percentage").and_then(|v| v.as_f64()).and_then(rust_decimal::Decimal::from_f64_retain).unwrap_or_default(),
        burn_depth: body.get("burn_depth").cloned().unwrap_or_else(|| serde_json::json!({})),
        affected_areas: body.get("affected_areas").cloned().unwrap_or_else(|| serde_json::json!({})),
        inhalation_injury: body.get("inhalation_injury").and_then(|v| v.as_bool()).unwrap_or(false),
        inhalation_symptoms: body.get("inhalation_symptoms").and_then(|v| v.as_str()).map(str::to_string),
        airway_status: body.get("airway_status").and_then(|v| v.as_str()).map(str::to_string),
        circumferential_burns: body.get("circumferential_burns").and_then(|v| v.as_bool()).unwrap_or(false),
        circumferential_locations: body.get("circumferential_locations").cloned(),
        escharotomy_needed: body.get("escharotomy_needed").and_then(|v| v.as_bool()).unwrap_or(false),
        escharotomy_performed: body.get("escharotomy_performed").and_then(|v| v.as_bool()).unwrap_or(false),
        fluid_resuscitation_started: body.get("fluid_resuscitation_started").and_then(|v| v.as_bool()).unwrap_or(false),
        parkland_formula_volume: body.get("parkland_formula_volume").and_then(|v| v.as_i64()).map(|v| v as i32),
        urine_output_goal: body.get("urine_output_goal").and_then(|v| v.as_i64()).map(|v| v as i32),
        pain_score: body.get("pain_score").and_then(|v| v.as_i64()).map(|v| v as i32),
        tetanus_status: body.get("tetanus_status").and_then(|v| v.as_str()).map(str::to_string),
        transfer_to_burn_center: body.get("transfer_to_burn_center").and_then(|v| v.as_bool()).unwrap_or(false),
        burn_center_notified: body.get("burn_center_notified").and_then(|v| v.as_bool()).unwrap_or(false),
        photos_taken: body.get("photos_taken").and_then(|v| v.as_bool()).unwrap_or(false),
        notes: body.get("notes").and_then(|v| v.as_str()).map(str::to_string),
        created_at: now,
        updated_at: now,
        data: body.clone(),
    };

    match data.repositories.burn_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
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

#[get("/api/clinical/burn/{assessment_id}")]
pub async fn get_burn(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

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
        .burn_assessments
        .get_by_id(&assessment_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Burn assessment not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create psychiatric assessment
#[post("/api/clinical/psych")]
pub async fn create_psych(
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
    let assessment_id = format!("PSY-{}", uuid::Uuid::new_v4().simple());
    let entity = PsychiatricAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: body.get("patient_id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        assessed_by: body.get("assessed_by").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        assessment_datetime: body.get("assessment_datetime").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)).unwrap_or(now),
        chief_complaint: body.get("chief_complaint").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        presenting_symptoms: body.get("presenting_symptoms").cloned().unwrap_or_else(|| serde_json::json!({})),
        psychiatric_history: body.get("psychiatric_history").and_then(|v| v.as_str()).map(str::to_string),
        previous_hospitalizations: body.get("previous_hospitalizations").cloned(),
        current_medications: body.get("current_medications").cloned(),
        substance_use: body.get("substance_use").cloned(),
        suicidal_ideation: body.get("suicidal_ideation").and_then(|v| v.as_bool()).unwrap_or(false),
        suicidal_plan: body.get("suicidal_plan").and_then(|v| v.as_bool()).unwrap_or(false),
        suicidal_intent: body.get("suicidal_intent").and_then(|v| v.as_bool()).unwrap_or(false),
        suicidal_means_access: body.get("suicidal_means_access").and_then(|v| v.as_bool()).unwrap_or(false),
        homicidal_ideation: body.get("homicidal_ideation").and_then(|v| v.as_bool()).unwrap_or(false),
        homicidal_target: body.get("homicidal_target").and_then(|v| v.as_str()).map(str::to_string),
        safety_plan: body.get("safety_plan").and_then(|v| v.as_str()).map(str::to_string),
        mental_status_exam: body.get("mental_status_exam").cloned().unwrap_or_else(|| serde_json::json!({})),
        appearance: body.get("appearance").and_then(|v| v.as_str()).map(str::to_string),
        behavior: body.get("behavior").and_then(|v| v.as_str()).map(str::to_string),
        speech: body.get("speech").and_then(|v| v.as_str()).map(str::to_string),
        mood: body.get("mood").and_then(|v| v.as_str()).map(str::to_string),
        affect: body.get("affect").and_then(|v| v.as_str()).map(str::to_string),
        thought_process: body.get("thought_process").and_then(|v| v.as_str()).map(str::to_string),
        thought_content: body.get("thought_content").and_then(|v| v.as_str()).map(str::to_string),
        perceptions: body.get("perceptions").and_then(|v| v.as_str()).map(str::to_string),
        cognition: body.get("cognition").and_then(|v| v.as_str()).map(str::to_string),
        insight: body.get("insight").and_then(|v| v.as_str()).map(str::to_string),
        judgment: body.get("judgment").and_then(|v| v.as_str()).map(str::to_string),
        risk_level: body.get("risk_level").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("low").to_string(),
        disposition: body.get("disposition").and_then(|v| v.as_str()).map(str::to_string),
        involuntary_hold: body.get("involuntary_hold").and_then(|v| v.as_bool()).unwrap_or(false),
        hold_type: body.get("hold_type").and_then(|v| v.as_str()).map(str::to_string),
        sitter_required: body.get("sitter_required").and_then(|v| v.as_bool()).unwrap_or(false),
        one_to_one_observation: body.get("one_to_one_observation").and_then(|v| v.as_bool()).unwrap_or(false),
        psychiatry_consulted: body.get("psychiatry_consulted").and_then(|v| v.as_bool()).unwrap_or(false),
        psychiatrist_id: body.get("psychiatrist_id").and_then(|v| v.as_str()).map(str::to_string),
        notes: body.get("notes").and_then(|v| v.as_str()).map(str::to_string),
        created_at: now,
        updated_at: now,
        data: body.clone(),
    };

    match data
        .repositories
        .psychiatric_assessments
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
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

#[get("/api/clinical/psych/{assessment_id}")]
pub async fn get_psych(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

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
        .psychiatric_assessments
        .get_by_id(&assessment_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Psychiatric assessment not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List psychiatric assessments for one patient.
#[get("/api/clinical/psych/patient/{patient_id}")]
pub async fn list_psych_for_patient(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => return HttpResponse::Unauthorized().finish(),
    };
    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().finish();
    }
    match data
        .repositories
        .psychiatric_assessments
        .get_by_patient(&path.into_inner(), crate::repositories::Pagination::new(0, 100))
        .await
    {
        Ok(page) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "count": page.items.len(),
            "assessments": page.items.into_iter().map(|item| item.data).collect::<Vec<_>>(),
        })),
        Err(e) => {
            log::error!("psychiatric assessment list failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create toxicology assessment
#[post("/api/clinical/tox")]
pub async fn create_tox(
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
    let assessment_id = format!("TOX-{}", uuid::Uuid::new_v4().simple());
    let entity = ToxicologyAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: body.get("patient_id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        assessed_by: body.get("assessed_by").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        assessment_datetime: body.get("assessment_datetime").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)).unwrap_or(now),
        exposure_type: body.get("exposure_type").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("ingestion").to_string(),
        intentionality: body.get("intentionality").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("accidental").to_string(),
        substances: body.get("substances").cloned().unwrap_or_else(|| serde_json::json!({})),
        time_of_exposure: body.get("time_of_exposure").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)),
        amount_if_known: body.get("amount_if_known").and_then(|v| v.as_str()).map(str::to_string),
        route_of_exposure: body.get("route_of_exposure").and_then(|v| v.as_str()).map(str::to_string),
        symptoms: body.get("symptoms").cloned().unwrap_or_else(|| serde_json::json!({})),
        vital_signs_on_arrival: body.get("vital_signs_on_arrival").cloned(),
        mental_status: body.get("mental_status").and_then(|v| v.as_str()).map(str::to_string),
        pupil_size: body.get("pupil_size").and_then(|v| v.as_str()).map(str::to_string),
        pupil_reactivity: body.get("pupil_reactivity").and_then(|v| v.as_str()).map(str::to_string),
        skin_findings: body.get("skin_findings").and_then(|v| v.as_str()).map(str::to_string),
        toxidrome: body.get("toxidrome").and_then(|v| v.as_str()).map(str::to_string),
        decontamination_performed: body.get("decontamination_performed").and_then(|v| v.as_bool()).unwrap_or(false),
        decontamination_type: body.get("decontamination_type").and_then(|v| v.as_str()).map(str::to_string),
        antidote_given: body.get("antidote_given").and_then(|v| v.as_bool()).unwrap_or(false),
        antidote_name: body.get("antidote_name").and_then(|v| v.as_str()).map(str::to_string),
        antidote_dose: body.get("antidote_dose").and_then(|v| v.as_str()).map(str::to_string),
        activated_charcoal: body.get("activated_charcoal").and_then(|v| v.as_bool()).unwrap_or(false),
        whole_bowel_irrigation: body.get("whole_bowel_irrigation").and_then(|v| v.as_bool()).unwrap_or(false),
        enhanced_elimination: body.get("enhanced_elimination").and_then(|v| v.as_bool()).unwrap_or(false),
        elimination_method: body.get("elimination_method").and_then(|v| v.as_str()).map(str::to_string),
        poison_control_called: body.get("poison_control_called").and_then(|v| v.as_bool()).unwrap_or(false),
        poison_control_case_number: body.get("poison_control_case_number").and_then(|v| v.as_str()).map(str::to_string),
        lab_results: body.get("lab_results").cloned(),
        drug_screen_results: body.get("drug_screen_results").cloned(),
        serum_levels: body.get("serum_levels").cloned(),
        disposition: body.get("disposition").and_then(|v| v.as_str()).map(str::to_string),
        icu_admission: body.get("icu_admission").and_then(|v| v.as_bool()).unwrap_or(false),
        notes: body.get("notes").and_then(|v| v.as_str()).map(str::to_string),
        created_at: now,
        updated_at: now,
        data: body.clone(),
    };

    match data
        .repositories
        .toxicology_assessments
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
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

#[get("/api/clinical/tox/{assessment_id}")]
pub async fn get_tox(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

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
        .toxicology_assessments
        .get_by_id(&assessment_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Toxicology assessment not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create mass casualty incident
#[post("/api/clinical/mci")]
pub async fn create_mci(
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
    let incident_id = format!("MCI-{}", uuid::Uuid::new_v4().simple());
    let entity = MciRecordEntity {
        id: incident_id.clone(),
        incident_id: body.get("incident_id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        incident_name: body.get("incident_name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        incident_datetime: body.get("incident_datetime").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)).unwrap_or(now),
        incident_location: body.get("incident_location").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        incident_type: body.get("incident_type").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("natural_disaster").to_string(),
        activation_level: body.get("activation_level").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("level_1").to_string(),
        incident_commander: body.get("incident_commander").and_then(|v| v.as_str()).map(str::to_string),
        medical_branch_director: body.get("medical_branch_director").and_then(|v| v.as_str()).map(str::to_string),
        hospital_incident_command_activated: body.get("hospital_incident_command_activated").and_then(|v| v.as_bool()).unwrap_or(false),
        patient_id: body.get("patient_id").and_then(|v| v.as_str()).map(str::to_string),
        triage_tag_number: body.get("triage_tag_number").and_then(|v| v.as_str()).map(str::to_string),
        triage_category: body.get("triage_category").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("red").to_string(),
        start_triage_category: body.get("start_triage_category").and_then(|v| v.as_str()).map(str::to_string),
        arrival_datetime: body.get("arrival_datetime").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)),
        arrival_mode: body.get("arrival_mode").and_then(|v| v.as_str()).map(str::to_string),
        ems_agency: body.get("ems_agency").and_then(|v| v.as_str()).map(str::to_string),
        treatment_area: body.get("treatment_area").and_then(|v| v.as_str()).map(str::to_string),
        injuries: body.get("injuries").cloned(),
        mechanism_of_injury: body.get("mechanism_of_injury").and_then(|v| v.as_str()).map(str::to_string),
        decontamination_required: body.get("decontamination_required").and_then(|v| v.as_bool()).unwrap_or(false),
        decontamination_completed: body.get("decontamination_completed").and_then(|v| v.as_bool()).unwrap_or(false),
        treatments_provided: body.get("treatments_provided").cloned(),
        disposition: body.get("disposition").and_then(|v| v.as_str()).map(str::to_string),
        disposition_datetime: body.get("disposition_datetime").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.with_timezone(&chrono::Utc)),
        destination: body.get("destination").and_then(|v| v.as_str()).map(str::to_string),
        family_notified: body.get("family_notified").and_then(|v| v.as_bool()).unwrap_or(false),
        family_reunification_completed: body.get("family_reunification_completed").and_then(|v| v.as_bool()).unwrap_or(false),
        patient_tracking_updated: body.get("patient_tracking_updated").and_then(|v| v.as_bool()).unwrap_or(false),
        media_release_authorized: body.get("media_release_authorized").and_then(|v| v.as_bool()).unwrap_or(false),
        special_circumstances: body.get("special_circumstances").and_then(|v| v.as_str()).map(str::to_string),
        created_by: body.get("created_by").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        created_at: now,
        updated_at: now,
        data: body.clone(),
    };

    match data.repositories.mci_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "incident_id": incident_id
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

#[get("/api/clinical/mci/{incident_id}")]
pub async fn get_mci(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let incident_id = path.into_inner();

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

    match data.repositories.mci_records.get_by_id(&incident_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "MCI record not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}
