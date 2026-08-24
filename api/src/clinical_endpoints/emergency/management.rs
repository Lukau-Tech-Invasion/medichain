use super::*;

// ============================================================================
// ER MANAGEMENT & NURSING
// ============================================================================

/// Create MAR entry
/// What the MAR page submits: one patient's medication record for a date.
///
/// The clinical `MedicationAdministrationRecord` splits medication into
/// scheduled/PRN/infusion collections of a typed struct; the page sends one flat
/// `medications` list, so every save was rejected with 400. The CDS check below
/// still runs — it only needs the drug names, and losing it would mean a nurse
/// documenting an administration without the interaction and condition rules
/// firing.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateMarRequest {
    pub patient_id: String,
    #[serde(default)]
    pub date: String,
    /// The scheduled-medication list.
    ///
    /// `scheduled_medications` is the name the original typed request used and
    /// is still what the stored entity column is called, so it is accepted as
    /// an alias rather than dropped. Without it an existing caller's payload
    /// deserializes to an empty list *successfully*: the record saves, the
    /// medications vanish, and the CDS interaction rules never see a drug to
    /// check — a silent loss that reads as "no alerts" rather than as an error.
    #[serde(default, alias = "scheduled_medications")]
    pub medications: Vec<serde_json::Value>,
    #[serde(default)]
    pub prn_medications: Vec<serde_json::Value>,
    #[serde(default)]
    pub infusions: Vec<serde_json::Value>,
}

/// Drug names out of a loosely typed medication list, for the CDS rules.
fn medication_names(items: &[serde_json::Value]) -> Vec<String> {
    items
        .iter()
        .filter_map(|m| {
            m.get("medication_name")
                .or_else(|| m.get("medicationName"))
                .or_else(|| m.get("name"))
                .and_then(|n| n.as_str())
                .map(str::to_string)
        })
        .collect()
}

#[post("/api/emergency/mar")]
pub async fn create_mar(
    data: web::Data<AppState>,
    req: web::Json<CreateMarRequest>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let record = req.into_inner();
    if record.patient_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id is required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if data
        .repositories
        .patients
        .get_by_id(&record.patient_id)
        .await
        .is_err()
    {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Patient '{}' not found", record.patient_id),
            code: "PATIENT_NOT_FOUND".to_string(),
        });
    }

    let today = Utc::now().date_naive();
    let record_date = chrono::NaiveDate::parse_from_str(&record.date, "%Y-%m-%d").unwrap_or(today);
    let id = format!("MAR-{}-{}", record.patient_id, record_date);

    // CDS: administered meds plus the patient's real conditions/medications can
    // trigger condition-only rules (NSAID in renal impairment, anticoagulant with
    // fall risk) that need no vitals or labs snapshot at all.
    {
        let (conditions, mut medications) =
            crate::clinical_endpoints::patient_conditions_and_meds(&data, &record.patient_id).await;
        medications.extend(medication_names(&record.medications));
        medications.extend(medication_names(&record.prn_medications));
        medications.extend(medication_names(&record.infusions));
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

    let now = Utc::now();
    let entity = crate::repositories::traits::MedicationRecordEntity {
        id: id.clone(),
        patient_id: record.patient_id.clone(),
        record_date,
        scheduled_medications: serde_json::json!(record.medications),
        prn_medications: serde_json::json!(record.prn_medications),
        infusions: serde_json::json!(record.infusions),
        completion_status: None,
        completion_percentage: None,
        primary_nurse: Some(current_user_id.clone()),
        created_at: now,
        updated_at: now,
        facility_id: None,
        is_active: true,
        data: serde_json::to_value(&record).unwrap_or_default(),
    };

    // One MAR per patient per day: re-saving the sheet updates it rather than
    // failing on the primary key or duplicating the day's record.
    let existing = data
        .repositories
        .medication_records
        .get_by_id(&id)
        .await
        .is_ok();
    let outcome = if existing {
        data.repositories
            .medication_records
            .update(entity)
            .await
            .map(|_| ())
    } else {
        data.repositories
            .medication_records
            .create(entity)
            .await
            .map(|_| ())
    };
    match outcome {
        Ok(()) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => {
            log::error!("MAR persistence failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to save the medication record".to_string(),
                code: "REPO_ERROR".to_string(),
            })
        }
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
            let med = v
                .get("medication")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
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
            log::error!("MAR administration failed: {e}");
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
        if (7..19).contains(&hour) {
            "day".to_string()
        } else {
            "night".to_string()
        }
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
            log::error!("I/O write failed: {e}");
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
/// One cannulation site as the IV form records it.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct IvSiteInput {
    pub id: String,
    #[serde(default)]
    pub location: String,
    #[serde(rename = "locationDetail", default)]
    pub location_detail: String,
    #[serde(rename = "catheterType", default)]
    pub catheter_type: String,
    #[serde(default)]
    pub gauge: String,
    #[serde(rename = "insertedBy", default)]
    pub inserted_by: String,
    #[serde(rename = "insertedAt", default)]
    pub inserted_at: String,
    #[serde(rename = "isActive", default)]
    pub is_active: bool,
    #[serde(default)]
    pub assessments: Vec<serde_json::Value>,
    #[serde(rename = "discontinuedReason", default)]
    pub discontinued_reason: Option<String>,
}

/// What the IV site form submits: a patient and every site currently documented.
///
/// The clinical `IVSiteRecord` type could not be produced by this form, so every
/// save was rejected with 400 and the cannulation record was lost. Storage is one
/// row per site (`iv_assessments` has a NOT NULL `site_id`), so the submission
/// fans out — which is what lets a single site be tracked and discontinued later.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateIvSiteRequest {
    pub patient_id: String,
    #[serde(default)]
    pub sites: Vec<IvSiteInput>,
}

#[post("/api/emergency/iv-site")]
pub async fn create_iv_site(
    data: web::Data<AppState>,
    req: web::Json<CreateIvSiteRequest>,
    http_req: HttpRequest,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(resp) => return resp,
    };

    let record = req.into_inner();
    if record.patient_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id is required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if record.sites.is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "at least one IV site is required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if data
        .repositories
        .patients
        .get_by_id(&record.patient_id)
        .await
        .is_err()
    {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Patient '{}' not found", record.patient_id),
            code: "PATIENT_NOT_FOUND".to_string(),
        });
    }

    let now = Utc::now();
    let mut saved = Vec::new();
    for site in &record.sites {
        // The site keeps its client id so re-saving the same list updates rather
        // than duplicating rows for a cannula that is already documented.
        let id = format!("IV-{}-{}", record.patient_id, site.id);
        let inserted = chrono::DateTime::parse_from_rfc3339(&site.inserted_at)
            .map(|d| d.with_timezone(&Utc).date_naive())
            .unwrap_or_else(|_| now.date_naive());
        let location = if site.location_detail.trim().is_empty() {
            site.location.clone()
        } else {
            format!("{} ({})", site.location, site.location_detail.trim())
        };

        let entity = crate::repositories::traits::IVAssessmentEntity {
            id: id.clone(),
            patient_id: record.patient_id.clone(),
            site_id: site.id.clone(),
            site_location: location,
            catheter_type: Some(site.catheter_type.clone()).filter(|c| !c.is_empty()),
            catheter_gauge: Some(site.gauge.clone()).filter(|g| !g.is_empty()),
            insertion_date: Some(inserted),
            patency: None,
            site_appearance: None,
            infiltration_grade: None,
            phlebitis_grade: None,
            current_infusions: None,
            dressing_intact: None,
            dressing_change_due: None,
            pain_level: None,
            notes: None,
            actions_taken: None,
            site_discontinued: Some(!site.is_active),
            discontinuation_reason: site.discontinued_reason.clone(),
            assessed_by: caller.wallet_address.clone(),
            assessed_at: now,
            created_at: now,
            updated_at: now,
            facility_id: None,
            data: serde_json::to_value(site).unwrap_or_default(),
        };

        let existing = data
            .repositories
            .iv_assessments
            .get_by_id(&id)
            .await
            .is_ok();
        let outcome = if existing {
            data.repositories
                .iv_assessments
                .update(entity)
                .await
                .map(|_| ())
        } else {
            data.repositories
                .iv_assessments
                .create(entity)
                .await
                .map(|_| ())
        };
        if let Err(e) = outcome {
            log::error!("IV site persistence failed: {e}");
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to save the IV site record".to_string(),
                code: "REPO_ERROR".to_string(),
            });
        }
        saved.push(id);
    }

    HttpResponse::Created().json(serde_json::json!({ "success": true, "sites": saved }))
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
/// One patient's section of a shift handoff, as the SBAR form submits it.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct HandoffPatientInput {
    #[serde(rename = "patientId")]
    pub patient_id: String,
    #[serde(default)]
    pub room: String,
    #[serde(default)]
    pub diagnosis: String,
    #[serde(rename = "codeStatus", default)]
    pub code_status: String,
    #[serde(default)]
    pub isolation: Option<String>,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub sbar: HandoffSbar,
    #[serde(rename = "ivAccess", default)]
    pub iv_access: String,
    #[serde(default)]
    pub diet: String,
    #[serde(default)]
    pub activity: String,
    #[serde(rename = "pendingLabs", default)]
    pub pending_labs: String,
    #[serde(rename = "pendingTests", default)]
    pub pending_tests: String,
    #[serde(default)]
    pub medications: serde_json::Value,
    #[serde(rename = "safetyRisks", default)]
    pub safety_risks: Vec<String>,
    #[serde(rename = "pendingOrders", default)]
    pub pending_orders: String,
    #[serde(rename = "familyUpdates", default)]
    pub family_updates: String,
    #[serde(rename = "additionalNotes", default)]
    pub additional_notes: String,
}

#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct HandoffSbar {
    #[serde(default)]
    pub situation: String,
    #[serde(default)]
    pub background: String,
    #[serde(default)]
    pub assessment: String,
    #[serde(default)]
    pub recommendation: String,
}

/// What the shift handoff form submits: one handoff covering several patients.
///
/// The clinical `ShiftHandoff` type could not be produced by this form, so every
/// submission was rejected with 400 and a nurse's whole SBAR was lost on the
/// Submit click. Storage is per patient — `shift_handoffs` has a NOT NULL
/// `patient_id` — so one submission fans out to one row per patient handed over,
/// which is also what makes a handoff searchable by patient later.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateShiftHandoffRequest {
    #[serde(default)]
    pub shift_type: String,
    #[serde(default)]
    pub handoff_date: String,
    #[serde(default)]
    pub handoff_time: String,
    #[serde(default)]
    pub outgoing_nurse: String,
    pub incoming_nurse: String,
    #[serde(default)]
    pub unit: String,
    pub patients: Vec<HandoffPatientInput>,
}

#[post("/api/emergency/handoff")]
pub async fn create_shift_handoff(
    data: web::Data<AppState>,
    req: web::Json<CreateShiftHandoffRequest>,
    http_req: HttpRequest,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(resp) => return resp,
    };

    let handoff = req.into_inner();
    if handoff.incoming_nurse.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "incoming_nurse is required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if handoff.patients.is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "a handoff must cover at least one patient".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }

    // Handoff date and time are facility wall-clock, exactly like an appointment,
    // so they go through the same conversion rather than being read as UTC — a
    // handoff logged at 19:00 SAST must not be stored as 19:00Z.
    let when = if handoff.handoff_date.trim().is_empty() {
        Utc::now()
    } else {
        crate::types::appt_to_datetime(&handoff.handoff_date, &handoff.handoff_time)
    };

    let now = Utc::now();
    let batch = format!("HO-{}", uuid::Uuid::new_v4().simple());
    let mut created = Vec::new();

    for patient in &handoff.patients {
        if data
            .repositories
            .patients
            .get_by_id(&patient.patient_id)
            .await
            .is_err()
        {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Patient '{}' not found", patient.patient_id),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }

        let id = format!("{batch}-{}", patient.patient_id);
        let entity = crate::repositories::traits::ShiftHandoffEntity {
            id: id.clone(),
            patient_id: patient.patient_id.clone(),
            outgoing_provider_id: if handoff.outgoing_nurse.trim().is_empty() {
                caller.wallet_address.clone()
            } else {
                handoff.outgoing_nurse.clone()
            },
            incoming_provider_id: handoff.incoming_nurse.clone(),
            handoff_datetime: when,
            // `handoff_type` is the KIND of handoff the schema constrains
            // (shift_change / transfer / procedure / break_coverage /
            // escalation). The form's "day-to-evening" is the shift direction,
            // which is a different axis and is kept alongside the SBAR payload.
            handoff_type: "shift_change".to_string(),
            location_from: Some(handoff.unit.clone()).filter(|u| !u.is_empty()),
            location_to: Some(patient.room.clone()).filter(|r| !r.is_empty()),
            situation: patient.sbar.situation.clone(),
            background: patient.sbar.background.clone(),
            assessment: patient.sbar.assessment.clone(),
            recommendation: patient.sbar.recommendation.clone(),
            pending_tasks: serde_json::json!({
                "orders": patient.pending_orders,
                "labs": patient.pending_labs,
                "tests": patient.pending_tests,
            }),
            pending_results: Some(serde_json::json!(patient.pending_labs)),
            pending_consults: None,
            critical_values: None,
            code_status: Some(patient.code_status.clone()).filter(|c| !c.is_empty()),
            isolation_precautions: patient.isolation.clone().map(|i| serde_json::json!([i])),
            // The safety-risk chips carry the fall-risk flag; record it in its own
            // column so a fall risk is not buried inside a JSON blob.
            fall_risk_level: patient
                .safety_risks
                .iter()
                .find(|r| r.to_lowercase().contains("fall"))
                .map(|_| "at-risk".to_string()),
            skin_integrity_issues: Some(serde_json::json!(patient.safety_risks)),
            iv_access: Some(serde_json::json!(patient.iv_access)),
            drains_tubes: None,
            family_concerns: Some(patient.family_updates.clone()).filter(|f| !f.is_empty()),
            anticipated_disposition: Some(patient.diagnosis.clone()).filter(|d| !d.is_empty()),
            contingency_plans: Some(patient.additional_notes.clone()).filter(|n| !n.is_empty()),
            questions_asked: None,
            read_back_confirmed: false,
            acknowledged_by_incoming: false,
            acknowledged_at: None,
            handoff_tool_used: Some("SBAR".to_string()),
            created_at: now,
            updated_at: now,
            data: serde_json::json!({
                "shift_direction": handoff.shift_type,
                "unit": handoff.unit,
                "patient": patient,
            }),
        };

        if let Err(e) = data.repositories.shift_handoffs.create(entity).await {
            log::error!(
                "shift handoff persistence failed for {}: {e}",
                patient.patient_id
            );
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to save the handoff".to_string(),
                code: "REPO_ERROR".to_string(),
            });
        }
        created.push(id);
    }

    HttpResponse::Created().json(serde_json::json!({
        "id": batch,
        "success": true,
        "handoffs": created
    }))
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
    req: web::Json<serde_json::Value>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let body = req.into_inner();
    let now = chrono::Utc::now();
    // Server-generated: a client-supplied id lets one submission overwrite another.
    let id = format!("FRA-{}", uuid::Uuid::new_v4().simple());

    // Sum of the six Morse Fall Scale items. Absent items score 0, which is the
    // scale's own "not present" value, so a partial submission is scored as
    // filled in rather than rejected — but the total always reflects what was
    // actually recorded rather than what the client asserted.
    let morse_item = |key: &str| body.get(key).and_then(|v| v.as_i64()).unwrap_or(0);
    let morse_total = (morse_item("history_of_falling")
        + morse_item("secondary_diagnosis")
        + morse_item("ambulatory_aid")
        + morse_item("iv_therapy")
        + morse_item("gait_status")
        + morse_item("mental_status")) as i32;

    let entity = FallRiskAssessmentEntity {
        id: id.clone(),
        patient_id: body
            .get("patient_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        assessment_tool: body
            .get("assessment_tool")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        history_of_falling: body
            .get("history_of_falling")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        secondary_diagnosis: body
            .get("secondary_diagnosis")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        ambulatory_aid: body
            .get("ambulatory_aid")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        iv_therapy: body
            .get("iv_therapy")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        gait_status: body
            .get("gait_status")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        mental_status: body
            .get("mental_status")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        additional_factors: body.get("additional_factors").cloned(),
        interventions: body.get("interventions").cloned(),
        notes: body
            .get("notes")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        assessed_by: body
            .get("assessed_by")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        assessed_at: body
            .get("assessed_at")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc))
            .unwrap_or(now),
        next_assessment_due: body
            .get("next_assessment_due")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
        created_at: now,
        updated_at: now,
        facility_id: body
            .get("facility_id")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        data: body.clone(),
        // The Morse Fall Scale total drives the risk band, so derive the band
        // from the score rather than trusting a separate field that can
        // disagree with it.
        //
        // The score itself is derived too. It was read straight off the body
        // with `unwrap_or(0)`, so a submission carrying the six item scores but
        // no `total_score` — or a client that computed it wrongly — filed a
        // patient at 0, which bands as "low". A high-risk patient recorded as
        // low risk does not get the bed alarm, the hourly rounding or the
        // signage, and the assessment exists precisely to trigger those. The
        // Morse total *is* the sum of its six items, so any supplied total that
        // disagrees with them is wrong by definition.
        total_score: morse_total,
        risk_level: morse_risk_band(morse_total).to_string(),
    };
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
