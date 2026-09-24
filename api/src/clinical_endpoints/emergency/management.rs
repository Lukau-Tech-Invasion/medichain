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

/// List the dose administrations already durably recorded in daily MARs.
///
/// The order-entry grid and administration history are different views: the
/// former is derived from active prescriptions; the latter must read the MAR
/// records written by `append_mar_administration`. Returning an empty local
/// array after reload made a persisted dose disappear from the nurse's history.
#[get("/api/emergency/mar/administrations")]
pub async fn list_mar_administrations(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let patient_filter = query.get("patient_id").map(String::as_str);
    let records = match data
        .repositories
        .medication_records
        .list_all(Pagination::new(0, 100))
        .await
    {
        Ok(result) => result.items,
        Err(error) => {
            log::error!("MAR administration history read failed: {error}");
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Medication administration history could not be loaded".to_string(),
                code: "MAR_HISTORY_READ_FAILED".to_string(),
            });
        }
    };
    let mut administrations = Vec::new();
    for record in records {
        if patient_filter.is_some_and(|id| id != record.patient_id) {
            continue;
        }
        let Some(events) = record
            .data
            .get("administrations")
            .and_then(serde_json::Value::as_array)
        else {
            continue;
        };
        for event in events {
            let mut item = event.clone();
            if let Some(object) = item.as_object_mut() {
                object.insert("patient_id".into(), serde_json::json!(record.patient_id));
                object.insert("record_date".into(), serde_json::json!(record.record_date));
            }
            administrations.push(item);
        }
    }
    administrations.sort_by(|left, right| {
        right
            .get("administered_at")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .cmp(
                left.get("administered_at")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(""),
            )
    });
    HttpResponse::Ok()
        .json(serde_json::json!({ "success": true, "administrations": administrations }))
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
    // Direction travels as its own field. Prefixing it onto the category
    // produced `"output:urine"`, which matched no arm of the routing table and
    // was therefore counted as intake — the fluid balance moved the wrong way
    // for every output this page ever charted.
    match crate::clinical_endpoints::append_io_event(
        &data,
        crate::clinical_endpoints::FluidEvent {
            patient_id: &entry.patient_id,
            shift: &shift,
            recorded_by: &caller.wallet_address,
            category: &entry.category,
            direction: Some(&entry.direction),
            label: Some(&entry.category),
            notes: Some(entry.notes.as_str()).filter(|n| !n.is_empty()),
            amount_ml,
        },
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
        super::FluidEvent {
            patient_id: &patient_id,
            shift: &shift,
            recorded_by: &current_user_id,
            category: &category,
            direction: body.get("direction").and_then(|v| v.as_str()),
            label: body.get("fluid_type").and_then(|v| v.as_str()),
            notes: body.get("notes").and_then(|v| v.as_str()),
            amount_ml,
        },
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
/// `CarePlanPage.tsx` builds a plan out of three cross-referenced lists —
/// `NursingDiagnosis[]`, `Goal[]` and `Intervention[]`, each an object with an
/// id, camelCase — and this struct wanted a single `diagnosis: String` with
/// `Vec<String>` goals. Every save was
/// `400 invalid type: map, expected a string`, so the page's Save button had
/// never once worked; the only care plan in the database was written by a
/// seeder.
///
/// A nursing care plan without its goals and interventions is a diagnosis list,
/// not a plan, so accepting the diagnoses alone would not have been a fix.
///
/// Both shapes are accepted. `Vec<String>` is what the synthetic harness and
/// the earlier API contract send, and breaking those to fix the page would
/// trade one silent mismatch for another.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(untagged)]
pub enum CarePlanItem {
    /// The page's shape: an object carrying its own text plus cross-references.
    Structured(serde_json::Map<String, serde_json::Value>),
    /// A bare line of text.
    Text(String),
}

impl CarePlanItem {
    /// The human-readable line this item contributes.
    ///
    /// A structured item is searched for the field that carries its text —
    /// `diagnosis`, `description` or `goal` depending on which list it came
    /// from — because that is what a nurse reads on the plan. An item whose
    /// text cannot be found is rendered as its JSON rather than dropped:
    /// losing a documented intervention is worse than showing it awkwardly.
    fn line(&self) -> String {
        match self {
            CarePlanItem::Text(t) => t.trim().to_string(),
            CarePlanItem::Structured(map) => {
                for key in ["diagnosis", "description", "goal", "intervention", "text"] {
                    if let Some(v) = map.get(key).and_then(|v| v.as_str()) {
                        if !v.trim().is_empty() {
                            return v.trim().to_string();
                        }
                    }
                }
                serde_json::Value::Object(map.clone()).to_string()
            }
        }
    }
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateCarePlanRequest {
    #[serde(rename = "patientId", alias = "patient_id")]
    pub patient_id: String,
    /// The page's list. A single `diagnosis` string is still accepted, because
    /// that is the shape the earlier contract and the synthetic harness use.
    #[serde(default)]
    pub diagnoses: Vec<CarePlanItem>,
    #[serde(default)]
    pub diagnosis: Option<String>,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub goals: Vec<CarePlanItem>,
    #[serde(default)]
    pub interventions: Vec<CarePlanItem>,
    #[serde(rename = "carePlanId", alias = "care_plan_id", default)]
    pub care_plan_id: Option<String>,
}

impl CreateCarePlanRequest {
    /// Every nursing diagnosis on the plan, whichever shape it arrived in.
    fn diagnosis_lines(&self) -> Vec<String> {
        let mut lines: Vec<String> = self
            .diagnoses
            .iter()
            .map(CarePlanItem::line)
            .filter(|l| !l.is_empty())
            .collect();
        if let Some(single) = self.diagnosis.as_deref().map(str::trim) {
            if !single.is_empty() && !lines.iter().any(|l| l == single) {
                lines.push(single.to_string());
            }
        }
        lines
    }
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
    let diagnoses = plan.diagnosis_lines();
    if plan.patient_id.trim().is_empty() || diagnoses.is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id and at least one nursing diagnosis are required".to_string(),
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
        // The plan is named for its first diagnosis, which is the one the
        // nurse listed as the priority problem.
        plan_name: diagnoses[0].clone(),
        care_level: Some(plan.priority.clone()).filter(|p| !p.is_empty()),
        nursing_diagnoses: serde_json::json!(diagnoses),
        // The structured items are stored whole, not flattened to their text:
        // a goal carries its target date and measurable outcome, and an
        // intervention carries its frequency and who is responsible. Those are
        // the parts a nurse acts on.
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
    pub assessments: Vec<IvAssessmentInput>,
    #[serde(rename = "discontinuedReason", default)]
    pub discontinued_reason: Option<String>,
}

/// One bedside look at a cannula site.
///
/// `phlebitisScore` is accepted but ignored — the page computed it in the
/// browser and posted it, and it is recomputed here from `conditions` by
/// `clinical_scoring::vip_score`. A site score decides whether the cannula
/// stays in, so it is not a number a client gets to assert.
#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
pub struct IvAssessmentInput {
    #[serde(default)]
    pub id: String,
    #[serde(rename = "assessedAt", default)]
    pub assessed_at: Option<String>,
    /// Site findings, from the form's fixed vocabulary
    /// (`clean-dry-intact`, `tenderness`, `redness`, `swelling`, `warmth`,
    /// `induration`, `drainage`).
    #[serde(default)]
    pub conditions: Vec<String>,
    #[serde(rename = "dressingType", default)]
    pub dressing_type: Option<String>,
    #[serde(rename = "dressingIntact", default)]
    pub dressing_intact: Option<bool>,
    #[serde(rename = "flushPatent", default)]
    pub flush_patent: Option<bool>,
    #[serde(rename = "bloodReturn", default)]
    pub blood_return: Option<bool>,
    #[serde(default)]
    pub infusing: Option<String>,
    /// Free text, not a number.
    ///
    /// `IVAssessment.infusionRate` is `string` in the page and the field invites
    /// "80 mL/hr" — a rate is a quantity *and* a unit, and nurses write both.
    /// Typing it `f64` here meant serde refused the body outright, so a nurse
    /// who filled the field lost the entire cannula record to
    /// `400 invalid type: string "80 mL/hr", expected f64`, with no indication
    /// which field caused it.
    #[serde(rename = "infusionRate", default)]
    pub infusion_rate: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(rename = "infiltrationGrade", default)]
    pub infiltration_grade: Option<i32>,
    #[serde(rename = "painLevel", default)]
    pub pain_level: Option<i32>,
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
    let mut saved: Vec<serde_json::Value> = Vec::with_capacity(record.sites.len());
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

        // The most recent look at the site is the one that describes it now.
        // Every field below was hardcoded `None`: the appearance, the phlebitis
        // grade, the infiltration grade, the pain score, the dressing status
        // and the notes were all collected by the form, posted, and dropped —
        // so a cannula with a stage-4 site read back as never assessed.
        let latest = site.assessments.last();
        let conditions: Vec<String> = latest.map(|a| a.conditions.clone()).unwrap_or_default();
        let phlebitis = latest.map(|_| crate::clinical_scoring::vip_score(&conditions));
        // The finding that set the score, for the queryable column.
        let worst_condition = phlebitis.and_then(|score| {
            conditions
                .iter()
                .find(|c| crate::clinical_scoring::vip_score(std::slice::from_ref(c)) == score)
                .map(String::as_str)
        });
        let dwell_hours = crate::clinical_scoring::catheter_dwell_limit_hours(&site.catheter_type);

        let entity = crate::repositories::traits::IVAssessmentEntity {
            id: id.clone(),
            patient_id: record.patient_id.clone(),
            site_id: site.id.clone(),
            site_location: location,
            catheter_type: Some(site.catheter_type.clone()).filter(|c| !c.is_empty()),
            catheter_gauge: Some(site.gauge.clone()).filter(|g| !g.is_empty()),
            insertion_date: Some(inserted),
            // `patent` / `sluggish` / `occluded` is the column's own CHECK-ed
            // vocabulary. A cannula that will not flush is occluded; "sluggish"
            // is a third observation this form does not collect.
            patency: latest
                .and_then(|a| a.flush_patent)
                .map(|p| if p { "patent" } else { "occluded" }.to_string()),
            // The single worst finding, not the joined list. The column is
            // VARCHAR(32) and a full list of findings overflows it; the
            // complete set is in `data`, and what belongs in a queryable column
            // is the one that decides what happens to the cannula.
            site_appearance: worst_condition.map(str::to_string),
            infiltration_grade: latest.and_then(|a| a.infiltration_grade),
            phlebitis_grade: phlebitis.map(i32::from),
            current_infusions: latest
                .and_then(|a| a.infusing.clone())
                .filter(|s| !s.trim().is_empty())
                .map(|s| serde_json::json!([s])),
            dressing_intact: latest.and_then(|a| a.dressing_intact),
            dressing_change_due: None,
            pain_level: latest.and_then(|a| a.pain_level),
            notes: latest
                .and_then(|a| a.notes.clone())
                .filter(|s| !s.trim().is_empty()),
            actions_taken: phlebitis
                .map(|score| crate::clinical_scoring::vip_action(score).to_string()),
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
        saved.push(serde_json::json!({
            "id": id,
            "site_id": site.id,
            // What the server scored, and what that score requires. The page
            // showed its own arithmetic and never learned whether the server
            // agreed - and the server was storing nothing at all.
            "phlebitis_score": phlebitis,
            "action": phlebitis.map(crate::clinical_scoring::vip_action),
            "dwell_limit_hours": dwell_hours,
        }));
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
    // A handoff covers a ward, and storage is one row per patient keyed
    // `{batch}-{patient_id}` — so `create_shift_handoff` returns the batch id
    // and this endpoint could not resolve it. Every client that followed the id
    // it had just been handed got a 404, which is not a handle to anything.
    //
    // A batch resolves to the handoff it names; a single row still resolves to
    // itself, so the existing per-row callers are unaffected.
    if let Ok(record) = data.repositories.shift_handoffs.get_by_id(&id).await {
        return HttpResponse::Ok().json(record);
    }
    match data.repositories.shift_handoffs.get_by_batch(&id).await {
        Ok(rows) => {
            if rows.is_empty() {
                return HttpResponse::NotFound().json(ErrorResponse {
                    success: false,
                    error: format!("No handoff found for '{id}'"),
                    code: "NOT_FOUND".to_string(),
                });
            }
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "handoff_id": id,
                "patients": rows,
            }))
        }
        Err(e) => {
            log::error!("handoff lookup failed for {id}: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "The handoff could not be read".to_string(),
                code: "REPO_ERROR".to_string(),
            })
        }
    }
}

/// How far back the handoff history may look, in days.
const MAX_HANDOFF_HISTORY_DAYS: u32 = 30;

#[derive(Debug, Deserialize)]
pub struct HandoffHistoryQuery {
    /// Days of history including today; 1 (the default) is today only.
    pub days: Option<u32>,
}

/// List shift handoffs involving a provider, newest first.
///
/// Connects the doctor-portal ShiftHandoffPage, which fetches by the logged-in
/// provider's id (the bare `/api/emergency/handoff/{id}` route is by *handoff*
/// id). `?days=N` widens the window from today to the last N days, capped at
/// 30; without it the answer is today's, as it always was.
#[get("/api/clinical/shift-handoff/{provider_id}")]
pub async fn list_provider_handoffs(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<HandoffHistoryQuery>,
) -> impl Responder {
    let provider_id = path.into_inner();
    if let Err(resp) = require_emergency_list_access(&data, &http_req, &provider_id) {
        return resp;
    }
    let days = query.days.unwrap_or(1).clamp(1, MAX_HANDOFF_HISTORY_DAYS);
    let since = Utc::now().date_naive() - chrono::Duration::days(i64::from(days - 1));
    match data
        .repositories
        .shift_handoffs
        .get_by_provider_since(&provider_id, since)
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

/// A vocabulary term as the database CHECK spells it.
///
/// The safety-report form writes `medication-error` and `near-miss`; the
/// constraints spell them `medication_error` and `near_miss`. Two spellings of
/// one word meant four of seven incident types and one of five severities could
/// not be filed at all — the insert failed the CHECK and the handler returned
/// `500 REPO_ERROR`, on PostgreSQL only, because the in-memory backend enforces
/// no constraints.
///
/// Normalising here rather than renaming the form's values keeps every stored
/// row and every existing caller working, and it is the separator that differs,
/// not the meaning.
fn canonical_term(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(['-', ' '], "_")
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
        incident_type: canonical_term(&report.incident_type),
        severity: canonical_term(&report.severity),
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

/// What `FallRiskPage` submits.
///
/// The page used to send the six Morse Fall Scale items nested under
/// `morse_scale` with camelCase keys, plus its own `total_score` and
/// `risk_level`. The handler read six *top-level* snake_case keys, found none
/// of them, and scored every assessment 0 — which bands as "low". A patient
/// scored 70 by the nurse at the bedside was filed as low risk, and low risk is
/// the band that gets no bed alarm, no hourly rounding and no signage.
///
/// The six items are the contract now, at the top level under the names the
/// database column set uses. `morse_scale` is accepted as an alias so a client
/// that has not been redeployed is scored correctly rather than silently at 0.
#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct MorseFallScaleItems {
    /// 0 or 25
    #[serde(default, alias = "fallHistory")]
    pub history_of_falling: i32,
    /// 0 or 15
    #[serde(default, alias = "secondaryDiagnosis")]
    pub secondary_diagnosis: i32,
    /// 0, 15 or 30
    #[serde(default, alias = "ambulatoryAid")]
    pub ambulatory_aid: i32,
    /// 0 or 20
    #[serde(default, alias = "ivTherapy")]
    pub iv_therapy: i32,
    /// 0, 10 or 20
    #[serde(default, alias = "gait")]
    pub gait_status: i32,
    /// 0 or 15
    #[serde(default, alias = "mentalStatus")]
    pub mental_status: i32,
}

impl MorseFallScaleItems {
    /// The Morse total *is* the sum of its six items. Nothing else is the total.
    fn total(&self) -> i32 {
        self.history_of_falling
            + self.secondary_diagnosis
            + self.ambulatory_aid
            + self.iv_therapy
            + self.gait_status
            + self.mental_status
    }
}

/// Create-fall-risk request body.
///
/// Deliberately does **not** carry `total_score` or `risk_level`. Both are
/// derived here from the six items, and in PostgreSQL they are
/// `GENERATED ALWAYS ... STORED` columns besides — a client cannot set them,
/// so accepting them would only let a caller believe it had.
#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct CreateFallRiskRequest {
    pub patient_id: String,
    /// The six scale items, flat. `morse_scale` is the legacy nesting.
    #[serde(default, flatten)]
    pub items: MorseFallScaleItems,
    #[serde(default)]
    pub morse_scale: Option<MorseFallScaleItems>,
    #[serde(default)]
    pub assessment_tool: Option<String>,
    #[serde(default)]
    pub additional_factors: Option<serde_json::Value>,
    #[serde(default)]
    pub interventions: Option<serde_json::Value>,
    #[serde(default)]
    pub environmental_hazards: Option<serde_json::Value>,
    #[serde(default)]
    pub medications: Option<serde_json::Value>,
    #[serde(default)]
    pub recent_fall: bool,
    #[serde(default)]
    pub mobility: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub assessed_at: Option<String>,
    #[serde(default)]
    pub next_assessment_due: Option<String>,
    #[serde(default)]
    pub facility_id: Option<String>,
}

/// Create fall risk assessment
#[post("/api/emergency/fall-risk")]
pub async fn create_fall_risk(
    data: web::Data<AppState>,
    req: web::Json<CreateFallRiskRequest>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    let body = req.into_inner();
    let now = chrono::Utc::now();
    // Server-generated: a client-supplied id lets one submission overwrite another.
    let id = format!("FRA-{}", uuid::Uuid::new_v4().simple());

    // Flat items win; the nested legacy shape is the fallback. A caller sending
    // both that disagree is a caller with a bug, and taking the flat one keeps
    // "what the current contract says" as the answer.
    let items = if body.items.total() > 0 {
        body.items
    } else {
        body.morse_scale.unwrap_or(body.items)
    };
    let morse_total = items.total();

    let parse_ts = |v: &Option<String>| {
        v.as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc))
    };

    let entity = FallRiskAssessmentEntity {
        id: id.clone(),
        patient_id: body.patient_id,
        assessment_tool: body.assessment_tool.or_else(|| Some("morse".to_string())),
        history_of_falling: Some(items.history_of_falling),
        secondary_diagnosis: Some(items.secondary_diagnosis),
        ambulatory_aid: Some(items.ambulatory_aid),
        iv_therapy: Some(items.iv_therapy),
        gait_status: Some(items.gait_status),
        mental_status: Some(items.mental_status),
        additional_factors: body.additional_factors,
        interventions: body.interventions,
        environmental_hazards: body.environmental_hazards,
        medications: body.medications,
        recent_fall: body.recent_fall,
        mobility: body.mobility,
        notes: body.notes,
        // The assessing clinician is whoever authenticated, not whoever the body
        // names. A body-supplied `assessed_by` lets one clinician file an
        // assessment under another's name.
        assessed_by: current_user.wallet_address,
        assessed_at: parse_ts(&body.assessed_at).unwrap_or(now),
        next_assessment_due: parse_ts(&body.next_assessment_due),
        created_at: now,
        updated_at: now,
        facility_id: body.facility_id,
        // The Morse Fall Scale total drives the risk band, so derive the band
        // from the score rather than trusting a separate field that can
        // disagree with it. On PostgreSQL both are generated columns and these
        // values are overwritten by the database with the same arithmetic; on
        // the in-memory backend they are what the record carries.
        total_score: Some(morse_total),
        risk_level: Some(morse_risk_band(morse_total).to_string()),
        data: serde_json::Value::Null,
    };
    match data.repositories.fall_risk_assessments.create(entity).await {
        Ok(saved) => HttpResponse::Created().json(serde_json::json!({
            "id": id,
            "success": true,
            // Return what was actually scored and stored. The page used to show
            // its own arithmetic and never learn whether the server agreed.
            // The stored values. `unwrap_or` is safe here and only here: this
            // row was just written with both set, so a None would mean the
            // database disagreed with the INSERT.
            "total_score": saved.total_score.unwrap_or(morse_total),
            "risk_level": saved
                .risk_level
                .unwrap_or_else(|| morse_risk_band(morse_total).to_string()),
        })),
        Err(e) => {
            log::error!("fall risk assessment persistence failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to save the fall risk assessment".to_string(),
                code: "REPO_ERROR".to_string(),
            })
        }
    }
}

/// A patient's fall-risk assessments, most recent first.
///
/// `FallRiskPage`'s History tab renders this list and could never populate it:
/// the repository has had `get_by_patient` all along and no route reached it,
/// so the tab was permanently empty and indistinguishable from a patient who
/// has never been assessed.
#[get("/api/emergency/fall-risk/patient/{patient_id}")]
pub async fn list_patient_fall_risk(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let patient_id = path.into_inner();
    match data
        .repositories
        .fall_risk_assessments
        // An explicit page size: `Pagination` has no `Default` precisely
        // because the derived one was `per_page: 0`, which returns nothing.
        .get_by_patient(&patient_id, Pagination::first_page(50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(e) => {
            log::error!("fall-risk history lookup failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to read the fall-risk history".to_string(),
                code: "REPO_ERROR".to_string(),
            })
        }
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
