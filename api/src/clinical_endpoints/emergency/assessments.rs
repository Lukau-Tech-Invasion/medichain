use super::*;

// ============================================================================
// EMERGENCY ASSESSMENTS
// ============================================================================

/// Create trauma assessment
/// What `TraumaPage` submits.
///
/// Replaces `clinical::TraumaAssessment` on the wire, which required
/// `mechanism` (a `TraumaMechanism` enum), `gcs`, `trauma_level`,
/// `mtp_activated`, `disposition`, a `PrimarySurvey` struct and a
/// `SecondarySurvey` struct. The page sends `mechanism_of_injury` as free text
/// and folds its A/B/C/D/E primary survey into `notes`, so every submission was
/// rejected with `missing field `mechanism``.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateTraumaRequest {
    pub assessment_id: String,
    pub patient_id: String,
    #[serde(default)]
    pub trauma_type: String,
    /// Free text: the form's `<select>` values are not the stored enum's
    /// spellings and the vocabulary is not settled.
    #[serde(default)]
    pub mechanism_of_injury: String,
    #[serde(default)]
    pub injury_severity_score: Option<u32>,
    #[serde(default)]
    pub gcs_score: Option<u8>,
    #[serde(default)]
    pub injuries: Vec<serde_json::Value>,
    #[serde(default)]
    pub interventions: Vec<serde_json::Value>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub assessed_by: String,
    #[serde(default)]
    pub assessed_at: i64,
}

#[post("/api/emergency/trauma")]
pub async fn create_trauma(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateTraumaRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let assessment = req.into_inner();
    let id = assessment.assessment_id.clone();

    if let Err(response) = crate::support::require_durable_audit(
        &data,
        access_log_entity(
            current_user_id,
            "trauma_team",
            "create_trauma_assessment",
            Some(assessment.patient_id.clone()),
        ),
    )
    .await
    {
        return response;
    }

    let entity = trauma_entity(&assessment, json_value(&assessment));
    match data
        .repositories
        .trauma_assessments_repo
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get trauma assessment
///
/// HZ-009 audit: took an unused `_http_req` and returned the full clinical
/// assessment by bare `{id}` with no authentication at all. Now requires the
/// same authenticated-caller bar as `create_trauma` above.
#[get("/api/emergency/trauma/{id}")]
pub async fn get_trauma(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data
        .repositories
        .trauma_assessments_repo
        .get_by_id(&id)
        .await
    {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List a patient's trauma assessments (provider or the patient themselves).
///
/// Added to connect the doctor portal's Emergency Protocols page, which fetches
/// per-type lists by patient. The repository already supported `get_by_patient`
/// (the aggregate `get_patient_emergency_records` uses it); this exposes it as
/// its own route, mirroring `list_patient_code_blues`.
#[get("/api/emergency/trauma/patient/{patient_id}")]
pub async fn list_patient_trauma(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = require_emergency_list_access(&data, &http_req, &patient_id) {
        return resp;
    }
    match data
        .repositories
        .trauma_assessments_repo
        .get_by_patient(&patient_id, Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// What `StrokePage` submits.
///
/// Replaces `clinical::StrokeAssessment` on the wire, which required
/// `door_time`, an 11-component `NIHStrokeScale`, `nihss_total`,
/// `ct_findings`, `hemorrhage`, `lvo_suspected`, `tpa_eligible`,
/// `tpa_contraindications`, `tpa_given`, `thrombectomy_candidate`,
/// `neuro_ir_activated`, `bp_management` and `stroke_type`. The page collects
/// none of them, so every submission was rejected with
/// `missing field `door_time``.
///
/// The screen records the NIHSS **total**, which is how the scale is
/// administered at the bedside, and a FAST exam. Both are carried; neither is
/// derived from the other.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateStrokeRequest {
    pub assessment_id: String,
    pub patient_id: String,
    /// The page computes these from `<input type="datetime-local">` via
    /// `getTime() / 1000`, which is a JavaScript float. Accepted as `f64` so a
    /// fractional second is not a 400.
    #[serde(default)]
    pub last_known_well: Option<f64>,
    #[serde(default)]
    pub symptom_onset: Option<f64>,
    #[serde(default)]
    pub fast_exam: serde_json::Value,
    #[serde(default)]
    pub nihss_score: Option<u8>,
    #[serde(default)]
    pub blood_glucose: Option<f64>,
    #[serde(default)]
    pub ct_head_interpretation: Option<String>,
    /// `eligible` / `not_eligible` / `evaluating`. Three states on purpose --
    /// see `stroke_entity` for why "evaluating" must not collapse to `false`.
    #[serde(default)]
    pub tpa_eligibility: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub assessed_by: String,
    #[serde(default)]
    pub assessed_at: i64,
}

/// Create stroke assessment
#[post("/api/emergency/stroke")]
pub async fn create_stroke(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateStrokeRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let assessment = req.into_inner();
    let id = assessment.assessment_id.clone();

    if let Err(response) = crate::support::require_durable_audit(
        &data,
        access_log_entity(
            current_user_id,
            "stroke_team",
            "create_stroke_assessment",
            Some(assessment.patient_id.clone()),
        ),
    )
    .await
    {
        return response;
    }

    let entity = stroke_entity(&assessment, json_value(&assessment));
    match data
        .repositories
        .stroke_assessments_repo
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get stroke assessment
///
/// HZ-009 audit: took an unused `_http_req` and returned the full clinical
/// assessment by bare `{id}` with no authentication at all. Now requires the
/// same authenticated-caller bar as `create_stroke` above.
#[get("/api/emergency/stroke/{id}")]
pub async fn get_stroke(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data
        .repositories
        .stroke_assessments_repo
        .get_by_id(&id)
        .await
    {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List a patient's stroke assessments (provider or the patient themselves).
#[get("/api/emergency/stroke/patient/{patient_id}")]
pub async fn list_patient_stroke(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = require_emergency_list_access(&data, &http_req, &patient_id) {
        return resp;
    }
    match data
        .repositories
        .stroke_assessments_repo
        .get_by_patient(&patient_id, Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// The bedside observations qSOFA scores, plus the labs SOFA needs.
#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct SepsisVitalsInput {
    #[serde(default)]
    pub respiratory_rate: Option<i32>,
    #[serde(default, alias = "systolic_bp")]
    pub systolic_blood_pressure: Option<i32>,
    #[serde(default, alias = "gcs")]
    pub glasgow_coma_scale: Option<i32>,
    #[serde(default, alias = "map")]
    pub mean_arterial_pressure: Option<f64>,
}

/// What `SepsisPage` submits.
///
/// It used to be typed as `clinical::SepsisAssessment`, which wants
/// `assessment_id`, a `severity` enum and a `qsofa` **struct**. The page sends
/// `sepsis_id`, `classification` and a `qsofa_score` **number**, so every save
/// was rejected — the sepsis screen had never filed a record.
///
/// Neither score is accepted from the caller. qSOFA is three bedside
/// observations and SOFA is six organ systems, and both are computed here from
/// the measurements. `sofa_score` in particular used to arrive as a constant 0:
/// `SepsisPage._calculateSOFA` was never called, and the five inputs it read
/// had no controls, so every sepsis assessment on file records "no organ
/// dysfunction" on a septic patient.
#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct CreateSepsisRequest {
    pub patient_id: String,
    /// `sepsis` / `severe_sepsis` / `septic_shock`, free-form: the stored
    /// column is a string and the vocabulary is not settled.
    #[serde(default, alias = "classification")]
    pub severity: Option<String>,
    #[serde(default, alias = "infection_source")]
    pub suspected_source: Option<String>,
    #[serde(default)]
    pub vital_signs: SepsisVitalsInput,
    /// The measurements SOFA scores. Absent systems are not scored zero.
    #[serde(default)]
    pub sofa_inputs: crate::clinical_scoring::SofaInputs,
    #[serde(default)]
    pub labs: serde_json::Value,
    #[serde(default)]
    pub infection: serde_json::Value,
    #[serde(default)]
    pub bundle_completion: serde_json::Value,
    #[serde(default)]
    pub treatment: serde_json::Value,
    #[serde(default)]
    pub vasopressors_required: bool,
    #[serde(default)]
    pub icu_admission: bool,
    #[serde(default)]
    pub protocol_start_time: Option<String>,
    #[serde(default)]
    pub elapsed_minutes: Option<i64>,
    #[serde(default)]
    pub narrative: Option<String>,
}

/// Create sepsis assessment
#[post("/api/emergency/sepsis")]
pub async fn create_sepsis(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateSepsisRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let body = req.into_inner();
    if body.patient_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id is required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }

    // Server-generated: a client-supplied id lets one submission overwrite another.
    let id = format!("SEP-{}", uuid::Uuid::new_v4().simple());
    let now = Utc::now();

    // Both scores are derived here, from the measurements.
    let qsofa = crate::clinical_scoring::qsofa_score(
        body.vital_signs.respiratory_rate,
        body.vital_signs.systolic_blood_pressure,
        body.vital_signs.glasgow_coma_scale,
    );
    // The bedside GCS and MAP feed SOFA too, so a clinician does not enter them
    // twice — an explicit value in `sofa_inputs` still wins.
    let mut sofa_inputs = body.sofa_inputs;
    sofa_inputs.glasgow_coma_scale = sofa_inputs
        .glasgow_coma_scale
        .or(body.vital_signs.glasgow_coma_scale);
    sofa_inputs.mean_arterial_pressure = sofa_inputs
        .mean_arterial_pressure
        .or(body.vital_signs.mean_arterial_pressure);
    let sofa = crate::clinical_scoring::sofa_score(&sofa_inputs);

    if let Err(response) = crate::support::require_durable_audit(
        &data,
        access_log_entity(
            current_user_id.clone(),
            "sepsis_team",
            "create_sepsis_assessment",
            Some(body.patient_id.clone()),
        ),
    )
    .await
    {
        return response;
    }

    let mut record = serde_json::to_value(&body).unwrap_or_default();
    if let Some(obj) = record.as_object_mut() {
        obj.insert("assessment_id".to_string(), serde_json::json!(id));
        obj.insert(
            "qsofa".to_string(),
            // `qsofa` is `Copy`; `sofa` below is not, hence the asymmetry.
            serde_json::to_value(qsofa).unwrap_or_default(),
        );
        obj.insert(
            "sofa".to_string(),
            serde_json::to_value(&sofa).unwrap_or_default(),
        );
        obj.insert(
            "documented_by".to_string(),
            serde_json::json!(current_user_id),
        );
    }

    let entity = SepsisAssessmentEntity {
        id: id.clone(),
        patient_id: body.patient_id.clone(),
        severity: body
            .severity
            .clone()
            .unwrap_or_else(|| "sepsis".to_string()),
        suspected_source: body.suspected_source.clone().unwrap_or_default(),
        qsofa_score: qsofa.total,
        // `None` when nothing was measured. Storing 0 there would say every
        // organ was checked and every organ was working.
        sofa_score: (sofa.systems_measured > 0).then_some(sofa.total),
        vasopressors_required: body.vasopressors_required,
        icu_admission: body.icu_admission,
        assessed_by: current_user_id,
        assessed_at: now.timestamp(),
        data: record,
        created_at: now,
        updated_at: now,
    };

    match data
        .repositories
        .sepsis_assessments_repo
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "id": id,
            "success": true,
            "qsofa": qsofa,
            "sofa": sofa,
        })),
        Err(e) => {
            log::error!("sepsis assessment persistence failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to save the sepsis assessment".to_string(),
                code: "REPO_ERROR".to_string(),
            })
        }
    }
}

/// Get sepsis assessment
///
/// HZ-009 audit: took an unused `_http_req` and returned the full clinical
/// assessment by bare `{id}` with no authentication at all. Now requires the
/// same authenticated-caller bar as `create_sepsis` above.
#[get("/api/emergency/sepsis/{id}")]
pub async fn get_sepsis(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data
        .repositories
        .sepsis_assessments_repo
        .get_by_id(&id)
        .await
    {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List a patient's sepsis assessments (provider or the patient themselves).
#[get("/api/emergency/sepsis/patient/{patient_id}")]
pub async fn list_patient_sepsis(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = require_emergency_list_access(&data, &http_req, &patient_id) {
        return resp;
    }
    match data
        .repositories
        .sepsis_assessments_repo
        .get_by_patient(&patient_id, Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create EMS handoff
#[post("/api/emergency/ems-handoff")]
pub async fn create_ems_handoff(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<EMSHandoff>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let handoff = req.into_inner();
    let id = handoff.report_id.clone();

    if let Err(response) = crate::support::require_durable_audit(
        &data,
        access_log_entity(
            current_user_id,
            "ems",
            "create_ems_handoff",
            handoff.patient_id.clone(),
        ),
    )
    .await
    {
        return response;
    }

    let entity = ems_handoff_entity(&handoff, json_value(&handoff));
    match data.repositories.ems_handoffs.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get EMS handoff
///
/// HZ-009 audit: took an unused `_http_req` and returned the full clinical
/// handoff by bare `{id}` with no authentication at all. Now requires the
/// same authenticated-caller bar as `create_ems_handoff` above.
#[get("/api/emergency/ems-handoff/{id}")]
pub async fn get_ems_handoff(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.ems_handoffs.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// Aggregate emergency records for a patient
#[get("/api/emergency/patient/{patient_id}")]
pub async fn get_patient_emergency_records(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // HZ-019 IDOR follow-up: this previously checked only that SOME X-User-Id
    // header was present, so any authenticated account — including an unrelated
    // patient — could read any patient's emergency records. Apply the same
    // provider-or-self rule the clinical endpoints use (e.g. get_patient_vitals):
    // a healthcare provider, or the patient reading their own record. The
    // token-based break-glass path is separate (POST /api/emergency/nfc-token
    // then the medical-id endpoints).
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };
    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
    {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    let pagination = Pagination::new(0, 10);

    let code_blues = data
        .repositories
        .code_blue
        .get_by_patient(&patient_id, pagination.clone())
        .await
        .map(|r| r.items)
        .unwrap_or_default();
    let trauma = data
        .repositories
        .trauma_assessments_repo
        .get_by_patient(&patient_id, pagination.clone())
        .await
        .map(|r| r.items)
        .unwrap_or_default();
    let stroke = data
        .repositories
        .stroke_assessments_repo
        .get_by_patient(&patient_id, pagination.clone())
        .await
        .map(|r| r.items)
        .unwrap_or_default();
    let sepsis = data
        .repositories
        .sepsis_assessments_repo
        .get_by_patient(&patient_id, pagination)
        .await
        .map(|r| r.items)
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "code_blues": code_blues,
        "trauma_assessments": trauma,
        "stroke_assessments": stroke,
        "sepsis_assessments": sepsis
    }))
}
