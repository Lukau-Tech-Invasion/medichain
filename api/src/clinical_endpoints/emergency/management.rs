use super::*;

// ============================================================================
// ER MANAGEMENT & NURSING
// ============================================================================

/// Create MAR entry
#[post("/api/emergency/mar")]
pub async fn create_mar(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::MedicationAdministrationRecord>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let record = req.into_inner();
    let id = format!("MAR-{}-{}", record.patient_id, record.date);

    // CDS: administered meds + the patient's real conditions/medications can trigger
    // condition-only rules (e.g. NSAID-in-renal-impairment, anticoagulant+fall-risk)
    // that don't need a vitals/labs snapshot at all.
    {
        let (conditions, mut medications) =
            crate::clinical_endpoints::patient_conditions_and_meds(&data, &record.patient_id).await;
        medications.extend(record.scheduled_medications.iter().map(|m| m.name.clone()));
        medications.extend(record.prn_medications.iter().map(|m| m.name.clone()));
        medications.extend(record.infusions.iter().map(|m| m.name.clone()));
        crate::clinical_endpoints::run_and_persist_cds_alerts(
            &data,
            &record.patient_id,
            None,
            None,
            &conditions,
            &medications,
            None,
        )
        .await;
    }

    let entity =
        medication_record_entity(id.clone(), &record, current_user_id, json_value(&record));
    match data.repositories.medication_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get MAR entry
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_mar`'s authenticated-caller bar.
#[get("/api/emergency/mar/{patient_id}/{medication_id}")]
pub async fn get_mar(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<(String, String)>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let (patient_id, medication_id) = path.into_inner();
    // Composite ID lookup simulation
    let id = format!("{}:{}", patient_id, medication_id);
    match data.repositories.medication_records.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List all MAR entries
/// The medications a nurse is due to give, one row per prescribed drug.
///
/// This is the link between prescribing and administration, and it was missing:
/// the endpoint returned raw MAR records whose `scheduled_medications` arrays
/// were empty, and the page mapped each *record* as if it were a single
/// medication — so the eMAR grid showed rows with blank drug names and nothing
/// could ever be administered. Rows are now derived from transmitted
/// prescriptions for active patients.
///
/// `scheduled_times` is deliberately left empty rather than invented: an
/// e-prescription carries free-text directions, not a dosing schedule, and
/// fabricating administration times on a medication record would be worse than
/// showing none. Administering without one is recorded as PRN.
#[get("/api/emergency/mar/list")]
pub async fn list_mar(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let patients = data
        .repositories
        .patients
        .list(Pagination::new(0, 50))
        .await
        .map(|r| r.items)
        .unwrap_or_default();

    let mut rows: Vec<serde_json::Value> = Vec::new();
    for entity in &patients {
        let name = patient_entity_to_profile(entity, &data.encryption_keyring)
            .map(|p| p.full_name)
            .unwrap_or_else(|| entity.id.clone());

        let prescriptions = data
            .repositories
            .e_prescriptions_v2
            .list_all()
            .await
            .unwrap_or_default();

        for record in prescriptions {
            let v = &record.data;
            if v.get("patient_id").and_then(|x| x.as_str()) != Some(entity.id.as_str()) {
                continue;
            }
            // Only medication a pharmacy would actually be dispensing.
            let status = v.get("status").and_then(|x| x.as_str()).unwrap_or("");
            if !matches!(status, "Transmitted" | "Signed" | "Filled") {
                continue;
            }
            let med = v.get("medication").cloned().unwrap_or(serde_json::Value::Null);
            let text = |object: &serde_json::Value, key: &str| {
                object
                    .get(key)
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string()
            };
            rows.push(serde_json::json!({
                "med_id": record.id,
                "patient_id": entity.id,
                "patient_name": name,
                "medication_name": text(&med, "name"),
                "dose": text(&med, "strength"),
                "route": if text(&med, "form").eq_ignore_ascii_case("injection") { "IV" } else { "PO" },
                "frequency": text(&med, "directions"),
                "scheduled_times": [],
                "start_date": text(v, "created_at"),
                "indication": text(v, "patient_instructions"),
                "prescriber": text(v, "prescriber_name"),
                "priority": "routine",
            }));
        }
    }

    HttpResponse::Ok().json(rows)
}

/// Administer medication — appends the dose to the patient's MAR for today.
///
/// This used to acknowledge without persisting; see
/// [`super::append_mar_administration`] for why that mattered.
#[post("/api/emergency/administer-med")]
pub async fn administer_medication(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };
    let body = req.into_inner();
    let patient_id = match body.get("patient_id").and_then(|v| v.as_str()) {
        Some(p) if !p.trim().is_empty() => p.to_string(),
        _ => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "patient_id is required".to_string(),
                code: "MISSING_PATIENT_ID".to_string(),
            })
        }
    };
    if let Err(resp) = require_emergency_list_access(&data, &http_req, &patient_id) {
        return resp;
    }

    let administration = serde_json::json!({
        "administration_id": format!("ADM-{}", uuid::Uuid::new_v4()),
        "medication_id": body.get("medication_id").and_then(|v| v.as_str()),
        "medication_name": body.get("medication_name").or_else(|| body.get("medication")).and_then(|v| v.as_str()),
        "dose": body.get("dose").and_then(|v| v.as_str()),
        "route": body.get("route").and_then(|v| v.as_str()),
        "notes": body.get("notes").and_then(|v| v.as_str()),
        "administered_by": current_user_id,
        "administered_at": Utc::now().to_rfc3339(),
    });

    match super::append_mar_administration(&data, &patient_id, &current_user_id, administration)
        .await
    {
        Ok(record_id) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "record_id": record_id,
            "message": "Medication administered and recorded"
        })),
        Err(e) => {
            log::error!("MAR administration failed for {}: {}", patient_id, e);
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Could not record the administration".to_string(),
                code: "MAR_WRITE_FAILED".to_string(),
            })
        }
    }
}

/// Create I/O record
/// What the intake/output entry form submits.
///
/// The clinical `IntakeOutputRecord` is a whole shift's record with running
/// totals; the bedside form records one fluid event. Requiring the former is why
/// the entry form could not save. Amounts arrive in the unit the nurse chose and
/// are normalised to millilitres here, because the stored totals are in ml and a
/// mixed-unit column would make fluid balance meaningless.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateIoEntryRequest {
    #[serde(rename = "patientId", alias = "patient_id")]
    pub patient_id: String,
    #[serde(rename = "type")]
    pub direction: String,
    pub category: String,
    pub amount: f64,
    #[serde(default)]
    pub unit: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub shift: Option<String>,
}

#[post("/api/emergency/io")]
pub async fn create_io(
    data: web::Data<AppState>,
    req: web::Json<CreateIoEntryRequest>,
    http_req: HttpRequest,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(resp) => return resp,
    };

    let entry = req.into_inner();
    if entry.patient_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patientId is required".to_string(),
            code: "MISSING_PATIENT_ID".to_string(),
        });
    }
    // NaN must be rejected too, so this tests the valid range rather than
    // negating a comparison.
    if !entry.amount.is_finite() || entry.amount <= 0.0 {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "amount must be greater than zero".to_string(),
            code: "INVALID_AMOUNT".to_string(),
        });
    }
    if data
        .repositories
        .patients
        .get_by_id(&entry.patient_id)
        .await
        .is_err()
    {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Patient '{}' not found", entry.patient_id),
            code: "PATIENT_NOT_FOUND".to_string(),
        });
    }

    let amount_ml = match entry.unit.to_ascii_lowercase().as_str() {
        // A US fluid ounce is 29.5735 ml; ml and cc are equivalent.
        "oz" => (entry.amount * 29.5735).round() as i32,
        _ => entry.amount.round() as i32,
    };

    // The helper keys the record by shift, and recomputes the running totals and
    // net balance so fluid balance stays consistent with the events.
    let shift = entry.shift.clone().unwrap_or_else(|| {
        let hour = chrono::Timelike::hour(&Utc::now());
        if (7..19).contains(&hour) { "day".to_string() } else { "night".to_string() }
    });
    // Categories are stored prefixed by direction so intake and output cannot be
    // confused when the totals are recomputed.
    let category = format!("{}:{}", entry.direction, entry.category);

    match crate::clinical_endpoints::append_io_event(
        &data,
        &entry.patient_id,
        &shift,
        &caller.wallet_address,
        &category,
        amount_ml,
    )
    .await
    {
        Ok(id) => HttpResponse::Created().json(serde_json::json!({
            "id": id,
            "success": true,
            "amount_ml": amount_ml
        })),
        Err(e) => {
            log::error!("intake/output persistence failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to record the fluid entry".to_string(),
                code: "REPO_ERROR".to_string(),
            })
        }
    }
}

/// Get I/O record
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_io`'s authenticated-caller bar.
#[get("/api/emergency/io/{patient_id}/{type}/{timestamp}")]
pub async fn get_io(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<(String, String, String)>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let (patient_id, _, date) = path.into_inner();
    let id = format!("IO-{}-{}", patient_id, date);
    match data.repositories.io_records.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List all I/O records
#[get("/api/emergency/io/list")]
pub async fn list_io(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    match data
        .repositories
        .io_records
        .list_all(Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Record a fluid intake/output event against today's shift record.
///
/// This used to acknowledge without persisting; see [`super::append_io_event`].
#[post("/api/emergency/record-fluid")]
pub async fn record_fluid(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };
    let body = req.into_inner();
    let patient_id = match body.get("patient_id").and_then(|v| v.as_str()) {
        Some(p) if !p.trim().is_empty() => p.to_string(),
        _ => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "patient_id is required".to_string(),
                code: "MISSING_PATIENT_ID".to_string(),
            })
        }
    };
    if let Err(resp) = require_emergency_list_access(&data, &http_req, &patient_id) {
        return resp;
    }
    let amount_ml = match body
        .get("amount_ml")
        .or_else(|| body.get("amount"))
        .and_then(|v| v.as_i64())
    {
        Some(a) if a >= 0 => a as i32,
        _ => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "amount_ml is required and must be a non-negative number".to_string(),
                code: "INVALID_AMOUNT".to_string(),
            })
        }
    };
    let category = body
        .get("category")
        .or_else(|| body.get("type"))
        .and_then(|v| v.as_str())
        .unwrap_or("other")
        .to_string();
    let shift = body
        .get("shift")
        .and_then(|v| v.as_str())
        .unwrap_or("day")
        .to_string();

    match super::append_io_event(
        &data,
        &patient_id,
        &shift,
        &current_user_id,
        &category,
        amount_ml,
    )
    .await
    {
        Ok(record_id) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "record_id": record_id,
            "message": "Fluid intake/output recorded"
        })),
        Err(e) => {
            log::error!("I/O write failed for {}: {}", patient_id, e);
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Could not record the fluid event".to_string(),
                code: "IO_WRITE_FAILED".to_string(),
            })
        }
    }
}

/// Create nursing care plan
/// What the nursing care-plan form submits.
///
/// The clinical `NursingCarePlan` type models goals, outcomes and interventions
/// as structures the create form does not collect; it captures a patient, a
/// nursing diagnosis and a priority. Requiring the full structure is why the
/// form was never wired up to anything.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateCarePlanRequest {
    pub patient_id: String,
    pub diagnosis: String,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub goals: Vec<String>,
    #[serde(default)]
    pub interventions: Vec<String>,
}

#[post("/api/emergency/care-plan")]
pub async fn create_care_plan(
    data: web::Data<AppState>,
    req: web::Json<CreateCarePlanRequest>,
    http_req: HttpRequest,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(resp) => return resp,
    };

    let plan = req.into_inner();
    if plan.patient_id.trim().is_empty() || plan.diagnosis.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id and diagnosis are required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if data
        .repositories
        .patients
        .get_by_id(&plan.patient_id)
        .await
        .is_err()
    {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Patient '{}' not found", plan.patient_id),
            code: "PATIENT_NOT_FOUND".to_string(),
        });
    }

    let now = Utc::now();
    let id = format!("NCP-{}", uuid::Uuid::new_v4().simple());
    let entity = crate::repositories::traits::NursingCarePlanEntity {
        id: id.clone(),
        patient_id: plan.patient_id.clone(),
        plan_name: plan.diagnosis.trim().to_string(),
        care_level: Some(plan.priority.clone()).filter(|p| !p.is_empty()),
        nursing_diagnoses: serde_json::json!([plan.diagnosis.trim()]),
        goals: serde_json::json!(plan.goals),
        interventions: serde_json::json!(plan.interventions),
        evaluation_notes: None,
        status: Some("active".to_string()),
        start_date: now.date_naive(),
        target_end_date: None,
        actual_end_date: None,
        created_by: caller.wallet_address.clone(),
        updated_by: None,
        created_at: now,
        updated_at: now,
        facility_id: None,
        is_active: true,
        data: serde_json::to_value(&plan).unwrap_or_default(),
    };

    match data.repositories.nursing_care_plans.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => {
            log::error!("nursing care plan persistence failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to save the care plan".to_string(),
                code: "REPO_ERROR".to_string(),
            })
        }
    }
}

/// Get care plan
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_care_plan`'s authenticated-caller bar.
#[get("/api/emergency/care-plan/{id}")]
pub async fn get_care_plan(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.nursing_care_plans.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List all care plans
#[get("/api/emergency/care-plan/list")]
pub async fn list_care_plans(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    match data
        .repositories
        .nursing_care_plans
        .list_all(Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create wound assessment
/// What the wound-care form actually submits.
///
/// The clinical `WoundAssessment` models location, type, wound bed, drainage and
/// treatment as nested structures and enums; a bedside wound form captures a flat
/// set of measurements and one free-text note. Requiring the full structure meant
/// the form could not produce a valid body at all. This DTO is the boundary
/// between the two, and unlike the structured mapper it actually keeps the
/// measurements — those were being dropped on the floor.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateWoundRequest {
    pub patient_id: String,
    pub wound_type: String,
    pub location: String,
    #[serde(default)]
    pub length_cm: Option<f64>,
    #[serde(default)]
    pub width_cm: Option<f64>,
    #[serde(default)]
    pub depth_cm: Option<f64>,
    #[serde(default)]
    pub exudate: Option<String>,
    #[serde(default)]
    pub pain_level: Option<i32>,
    #[serde(default)]
    pub tissue_types: Vec<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[post("/api/emergency/wound")]
pub async fn create_wound(
    data: web::Data<AppState>,
    req: web::Json<CreateWoundRequest>,
    http_req: HttpRequest,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(resp) => return resp,
    };

    let assessment = req.into_inner();
    if assessment.patient_id.trim().is_empty() || assessment.location.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id and location are required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if let Some(pain) = assessment.pain_level {
        if !(0..=10).contains(&pain) {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "pain_level must be between 0 and 10".to_string(),
                code: "VALIDATION_ERROR".to_string(),
            });
        }
    }
    if data
        .repositories
        .patients
        .get_by_id(&assessment.patient_id)
        .await
        .is_err()
    {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Patient '{}' not found", assessment.patient_id),
            code: "PATIENT_NOT_FOUND".to_string(),
        });
    }

    let now = Utc::now();
    let id = format!("WND-{}", uuid::Uuid::new_v4().simple());
    let cm = |v: Option<f64>| {
        v.and_then(|n| rust_decimal::Decimal::from_f64_retain(n).map(|d| d.round_dp(1)))
    };
    let entity = WoundAssessmentEntity {
        id: id.clone(),
        patient_id: assessment.patient_id.clone(),
        wound_id: id.clone(),
        wound_location: assessment.location.clone(),
        wound_type: assessment.wound_type.clone(),
        length_cm: cm(assessment.length_cm),
        width_cm: cm(assessment.width_cm),
        depth_cm: cm(assessment.depth_cm),
        tissue_type: if assessment.tissue_types.is_empty() {
            None
        } else {
            Some(assessment.tissue_types.join(", "))
        },
        drainage_amount: assessment.exudate.clone(),
        drainage_type: None,
        periwound_condition: None,
        pain_level: assessment.pain_level,
        treatment_applied: None,
        dressing_type: None,
        notes: assessment.notes.clone(),
        photo_taken: Some(false),
        assessed_by: caller.wallet_address.clone(),
        assessed_at: now,
        created_at: now,
        updated_at: now,
        facility_id: None,
        data: serde_json::to_value(&assessment).unwrap_or_default(),
    };

    match data.repositories.wound_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => {
            log::error!("wound assessment persistence failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to save the wound assessment".to_string(),
                code: "REPO_ERROR".to_string(),
            })
        }
    }
}

/// Get wound assessment
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_wound`'s authenticated-caller bar.
#[get("/api/emergency/wound/{id}")]
pub async fn get_wound(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.wound_assessments.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List all wound assessments
#[get("/api/emergency/wound/list")]
pub async fn list_wound_assessments(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    match data
        .repositories
        .wound_assessments
        .list_all(Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create IV site assessment
#[post("/api/emergency/iv-site")]
pub async fn create_iv_site(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::IVSiteAssessment>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let assessment = req.into_inner();
    let id = assessment.assessment_id.clone();
    let entity = iv_assessment_entity(&assessment, json_value(&assessment));
    match data.repositories.iv_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get IV site assessment
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_iv_site`'s authenticated-caller bar.
#[get("/api/emergency/iv-site/{id}")]
pub async fn get_iv_site(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.iv_assessments.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List a patient's IV site assessments (provider or the patient themselves).
///
/// Connects the doctor-portal IVSitePage, which fetches by *patient* id — the
/// bare `/api/emergency/iv-site/{id}` route is by *assessment* id. Mirrors the
/// `list_patient_*` emergency routes; the repository already supports
/// `get_by_patient`.
#[get("/api/clinical/iv-sites/{patient_id}")]
pub async fn list_patient_iv_sites(
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
        .iv_assessments
        .get_by_patient(&patient_id, Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create shift handoff
#[post("/api/emergency/handoff")]
pub async fn create_shift_handoff(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::ShiftHandoff>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let handoff = req.into_inner();
    let id = handoff.handoff_id.clone();
    let entity = shift_handoff_entity(&handoff, json_value(&handoff));
    match data.repositories.shift_handoffs.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get shift handoff
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_shift_handoff`'s authenticated-caller bar.
#[get("/api/emergency/handoff/{id}")]
pub async fn get_shift_handoff(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.shift_handoffs.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List shift handoffs involving a provider for today.
///
/// Connects the doctor-portal ShiftHandoffPage, which fetches by the logged-in
/// provider's id (the bare `/api/emergency/handoff/{id}` route is by *handoff*
/// id). Today-scoped via the repository's `get_by_provider`; multi-day history
/// is tracked in the technical-debt register.
#[get("/api/clinical/shift-handoff/{provider_id}")]
pub async fn list_provider_handoffs(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let provider_id = path.into_inner();
    if let Err(resp) = require_emergency_list_access(&data, &http_req, &provider_id) {
        return resp;
    }
    match data
        .repositories
        .shift_handoffs
        .get_by_provider(&provider_id, Utc::now().date_naive())
        .await
    {
        Ok(handoffs) => HttpResponse::Ok().json(handoffs),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Create incident report
/// What the incident-report wizard actually submits.
///
/// The clinical `IncidentReport` type models contributing factors, preventive
/// measures and outcomes as structures the three-step form never collects, and
/// the previous mapper hardcoded `severity: "reported"` — discarding the
/// severity a reporter had chosen, on a patient-safety record. This DTO matches
/// the wizard and keeps what it captures.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateIncidentRequest {
    #[serde(rename = "type")]
    pub incident_type: String,
    pub severity: String,
    #[serde(rename = "dateTime")]
    pub date_time: String,
    pub location: String,
    #[serde(default)]
    pub department: String,
    pub description: String,
    #[serde(rename = "patientInvolved", default)]
    pub patient_involved: bool,
    #[serde(rename = "patientId", default)]
    pub patient_id: String,
    #[serde(rename = "staffInvolved", default)]
    pub staff_involved: Vec<String>,
    #[serde(default)]
    pub witnesses: Vec<String>,
    #[serde(rename = "immediateActions", default)]
    pub immediate_actions: String,
}

#[post("/api/emergency/incident")]
pub async fn create_incident(
    data: web::Data<AppState>,
    req: web::Json<CreateIncidentRequest>,
    http_req: HttpRequest,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(resp) => return resp,
    };

    let report = req.into_inner();
    if report.description.trim().is_empty() || report.location.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "description and location are required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }

    let now = Utc::now();
    let incident_at = chrono::DateTime::parse_from_rfc3339(&report.date_time)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or(now);

    // Only attach a patient when one was named AND exists, so a safety report is
    // never silently filed against a patient id that does not resolve.
    let patient_id = if report.patient_involved && !report.patient_id.trim().is_empty() {
        if data
            .repositories
            .patients
            .get_by_id(&report.patient_id)
            .await
            .is_err()
        {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Patient '{}' not found", report.patient_id),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
        Some(report.patient_id.clone())
    } else {
        None
    };

    let id = format!("INC-{}", uuid::Uuid::new_v4().simple());
    let entity = IncidentReportEntity {
        id: id.clone(),
        patient_id,
        reporter_id: caller.wallet_address.clone(),
        incident_datetime: incident_at,
        discovery_datetime: now,
        incident_type: report.incident_type.clone(),
        severity: report.severity.clone(),
        location: report.location.trim().to_string(),
        department: Some(report.department.clone()).filter(|d| !d.is_empty()),
        description: report.description.trim().to_string(),
        immediate_actions_taken: Some(report.immediate_actions.clone())
            .filter(|a| !a.trim().is_empty()),
        patient_outcome: None,
        patient_notified: false,
        patient_notified_by: None,
        family_notified: false,
        attending_notified: false,
        supervisor_notified: false,
        risk_management_notified: false,
        witnesses: Some(serde_json::json!(report.witnesses)),
        contributing_factors: None,
        root_cause: None,
        preventable: None,
        similar_incidents_prior: false,
        corrective_actions: Some(serde_json::json!(report.staff_involved)),
        follow_up_required: false,
        follow_up_assigned_to: None,
        follow_up_due_date: None,
        follow_up_completed: false,
        follow_up_completed_at: None,
        investigation_status: Some("open".to_string()),
        reviewed_by: None,
        reviewed_at: None,
        review_comments: None,
        regulatory_reportable: false,
        reported_to_agencies: None,
        confidential: true,
        created_at: now,
        updated_at: now,
        data: serde_json::to_value(&report).unwrap_or_default(),
    };

    match data.repositories.incident_reports.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => {
            log::error!("incident report persistence failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to save the incident report".to_string(),
                code: "REPO_ERROR".to_string(),
            })
        }
    }
}

/// Get incident report
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_incident`'s authenticated-caller bar.
#[get("/api/emergency/incident/{id}")]
pub async fn get_incident(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.incident_reports.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// Create fall risk assessment
#[post("/api/emergency/fall-risk")]
pub async fn create_fall_risk(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::FallRiskAssessment>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let assessment = req.into_inner();
    let id = assessment.assessment_id.clone();
    let entity = fall_risk_entity(&assessment, json_value(&assessment));
    match data.repositories.fall_risk_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Get fall risk assessment
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_fall_risk`'s authenticated-caller bar.
#[get("/api/emergency/fall-risk/{id}")]
pub async fn get_fall_risk(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.fall_risk_assessments.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

#[cfg(test)]
mod cds_wiring_tests {
    use super::*;
    use actix_web::test;

    fn test_patient(
        id: &str,
        conditions: Vec<String>,
        medications: Vec<String>,
    ) -> crate::PatientProfile {
        let now = chrono::Utc::now();
        crate::PatientProfile {
            patient_id: id.to_string(),
            full_name: "Test Patient".to_string(),
            date_of_birth: "1980-01-01".to_string(),
            time_of_birth: None,
            national_id: format!("NID-{id}"),
            gender: None,
            phone: "+27000000000".to_string(),
            emergency_info: crate::EmergencyInfo {
                patient_id: id.to_string(),
                blood_type: crate::BloodType::OPositive,
                allergies: Vec::new(),
                current_medications: medications,
                chronic_conditions: conditions,
                emergency_contacts: Vec::new(),
                organ_donor: false,
                dnr_status: false,
                dnr_verified_by: None,
                dnr_verified_at: None,
                dnr_document_ref: None,
                languages: vec!["en".to_string()],
                last_updated: now,
            },
            address: None,
            insurance: None,
            primary_doctor: None,
            community_health_worker: None,
            preferences: crate::PatientPreferences::default(),
            advanced_directives: Vec::new(),
            family_notifications: None,
            created_at: now,
            last_updated: now,
        }
    }

    /// Creating a MAR entry that administers an NSAID to a patient with a documented
    /// renal condition should trigger the CDS rules engine's "NSAID Use in Renal
    /// Impairment" rule — proving `create_mar` really merges the record's own
    /// medications into the CDS evaluation, not just the patient's stored list.
    #[actix_web::test]
    async fn create_mar_triggers_condition_and_medication_cds_rule() {
        let state = crate::AppState::new();

        // `create_mar` now RESOLVES the caller against the user store rather
        // than trusting the presence of an X-User-Id header, so the test has to
        // register the nurse it claims to be. Previously this passed with an id
        // belonging to nobody — which is precisely the weakness being removed,
        // and means this test was asserting CDS behaviour through an
        // unauthenticated request.
        state.users.write().unwrap().insert(
            "nurse_wallet".to_string(),
            crate::User {
                wallet_address: "nurse_wallet".to_string(),
                username: Some("testnurse".to_string()),
                name: "Test Nurse".to_string(),
                role: crate::Role::Nurse,
                created_at: Utc::now(),
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

        let patient_id = "PAT-CDS-MAR-1";
        let profile = test_patient(
            patient_id,
            vec!["Chronic Kidney Disease".to_string()],
            vec![],
        );
        state
            .repositories
            .patients
            .create(crate::patient_profile_to_entity(
                &profile,
                &state.encryption_keyring,
            ))
            .await
            .unwrap();

        let app_state = web::Data::new(state);
        let app = actix_web::App::new()
            .app_data(app_state.clone())
            .service(create_mar);
        let app = test::init_service(app).await;

        let req = test::TestRequest::post()
            .uri("/api/emergency/mar")
            .insert_header(("x-user-id", "nurse_wallet"))
            .set_json(serde_json::json!({
                "patient_id": patient_id,
                "date": "2026-07-22",
                "scheduled_medications": [{
                    "medication_id": "MED-1",
                    "name": "Ibuprofen",
                    "dose": "400mg",
                    "route": "Oral",
                    "frequency": "TID",
                    "scheduled_times": ["08:00"],
                    "administrations": [],
                    "instructions": null,
                    "allergies_verified": true
                }],
                "prn_medications": [],
                "infusions": []
            }))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let alerts = app_state
            .repositories
            .cds_alerts
            .get_by_patient(patient_id, true)
            .await
            .unwrap_or_default();
        assert!(
            alerts.iter().any(|a| a.alert_title.contains("NSAID")),
            "expected an NSAID-in-renal-impairment CDS alert, got: {:?}",
            alerts.iter().map(|a| &a.alert_title).collect::<Vec<_>>()
        );
    }
}
