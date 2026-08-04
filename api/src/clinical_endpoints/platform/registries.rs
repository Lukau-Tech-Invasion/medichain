use super::*;

// ============================================================================
// SYSTEM REGISTRIES & LISTS
// ============================================================================

/// Gate for the deployment-wide clinical registries below.
///
/// Every handler in this file previously guarded with
/// `if http_req.headers().get("X-User-Id").is_none() { 401 }` and then called
/// `list_all()`. `X-User-Id` is caller-supplied, so that check was satisfied by
/// any string: an unauthenticated caller could read every pathology report,
/// critical-value notification, blood-bank record and specimen chain of custody
/// in the deployment. This is the "authentication mistaken for authorization"
/// defect at its widest blast radius.
///
/// This gate does three things the header check did not:
///   1. **Resolves** the caller against the user store, so a forged or
///      unregistered identity is rejected rather than trusted.
///   2. Requires a clinical role — a patient account has no business reading a
///      ward-wide registry, and previously could.
///   3. **Audits** the read. These are bulk PHI reads and were leaving no trace;
///      an audit trail that records only writes cannot reconstruct a breach.
///
/// **Still open (SEC-12/SEC-16/SEC-18):** the underlying `list_all()` remains
/// deployment-wide. Real multi-hospital isolation needs organization/facility
/// ownership pushed *into the query*; filtering afterwards is not isolation.
/// This narrows who can call these endpoints, not what they return.
async fn require_registry_reader(
    data: &web::Data<AppState>,
    http_req: &HttpRequest,
) -> Result<(), HttpResponse> {
    let user_id = match get_current_user_id(http_req) {
        Some(id) => id,
        None => return Err(HttpResponse::Unauthorized().finish()),
    };
    let user = match get_user(data, &user_id) {
        Some(u) => u,
        None => {
            return Err(HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            }))
        }
    };
    if !user.role.can_view_medical_records() {
        return Err(HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Clinical registries are restricted to clinical staff".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        }));
    }
    let _ = data.audit_outbox.record(
        "registry_bulk_read".into(),
        "clinical_registry".into(),
        http_req.path().to_string(),
        serde_json::json!({ "accessor_id": user_id, "accessor_role": user.role.to_string() }),
        Utc::now(),
    );
    Ok(())
}

/// List lab chain of custody records
#[get("/api/platform/list/chain-of-custody")]
pub async fn list_chain_of_custody(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    match data.repositories.chain_of_custody.list_all().await {
        Ok(list) => HttpResponse::Ok().json(list),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List lab quality control logs
#[get("/api/platform/list/lab-qc")]
pub async fn list_lab_qc(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    match data.repositories.lab_qc_records.list_all().await {
        Ok(list) => HttpResponse::Ok().json(list),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List critical value notifications
#[get("/api/platform/list/critical-values")]
pub async fn list_critical_values(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    match data.repositories.critical_values.list_all().await {
        Ok(list) => HttpResponse::Ok().json(list),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List all radiology orders
#[get("/api/platform/list/radiology-orders")]
pub async fn list_radiology_orders(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    match data.repositories.radiology_orders.list_all().await {
        Ok(list) => HttpResponse::Ok().json(list),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List all pathology reports
#[get("/api/platform/list/pathology")]
pub async fn list_pathology(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    match data.repositories.pathology_reports.list_all().await {
        Ok(list) => HttpResponse::Ok().json(list),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List all immunization records
#[get("/api/platform/list/immunizations")]
pub async fn list_immunizations(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    match data.repositories.immunization_records.list_all().await {
        Ok(list) => HttpResponse::Ok().json(list),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// A patient's own immunization records (patient-app Medical History page).
///
/// Caller-scoped: returns the authenticated caller's immunizations, resolved via
/// their linked patient id (falling back to the caller id when that is itself a
/// patient id). Deliberately distinct from the all-patients
/// `/api/platform/list/immunizations` above — pointing a patient page at that
/// list would leak every patient's records (an IDOR), so the patient page gets
/// this owner-scoped route instead.
#[get("/api/clinical/immunizations")]
pub async fn list_my_immunizations(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };
    let patient_id = match get_user(&data, &current_user_id) {
        Some(user) => user.linked_patient_id.unwrap_or(current_user_id),
        None => return HttpResponse::Unauthorized().finish(),
    };
    match data
        .repositories
        .immunization_records
        .get_by_patient(&patient_id)
        .await
    {
        Ok(records) => HttpResponse::Ok().json(serde_json::json!({ "immunizations": records })),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List blood bank inventory and screens
#[get("/api/platform/list/blood-bank")]
pub async fn list_blood_bank(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    let screens = data
        .repositories
        .blood_type_screens
        .list_all()
        .await
        .unwrap_or_default();

    // Horizon HZ-023 class: `inventory` was a hardcoded literal — "O-Pos: 12
    // units, adequate", "A-Neg: 2 units, low" — returned regardless of what any
    // blood bank actually holds. Unit counts drive transfusion decisions and
    // whether to order in stock, so inventing them is a patient-safety hazard,
    // not cosmetic demo filler. There is no blood-unit inventory repository, so
    // the honest response is an empty list plus an explicit flag saying the
    // subsystem is not implemented — a caller can branch on that, but it cannot
    // be mistaken for real stock levels.
    HttpResponse::Ok().json(serde_json::json!({
        "screens": screens,
        "inventory": [],
        "inventory_available": false,
        "inventory_note": "Blood-unit inventory tracking is not implemented. \
                           This list is empty by design and must not be read as stock on hand."
    }))
}

/// List all autopsy requests
#[get("/api/platform/list/autopsy")]
pub async fn list_autopsy(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    match data.repositories.autopsy_requests.list_all().await {
        Ok(list) => HttpResponse::Ok().json(list),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List all autopsy reports
#[get("/api/platform/list/autopsy-reports")]
pub async fn list_autopsy_reports(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    match data.repositories.autopsy_reports.list_all().await {
        Ok(list) => HttpResponse::Ok().json(list),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List all consultation notes
#[get("/api/platform/list/consults")]
pub async fn list_consults(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    match data
        .repositories
        .progress_notes
        .list_all(Pagination::new(0, 100))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(
            result
                .items
                .into_iter()
                .filter(|n| n.note_type == "consult")
                .collect::<Vec<_>>(),
        ),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List clinical decision support alerts
#[get("/api/platform/list/cds-alerts")]
pub async fn list_cds_alerts(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    match data
        .repositories
        .cds_alerts
        .list_all(Pagination::new(0, 100))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Record vital signs
#[post("/api/platform/vitals")]
pub async fn record_vital_signs(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let patient_id = body
        .get("patient_id")
        .and_then(|v| v.as_str())
        .unwrap_or("UNKNOWN")
        .to_string();
    let now = chrono::Utc::now();
    let vitals = VitalSignsEntity {
        id: uuid::Uuid::new_v4().to_string(),
        patient_id,
        heart_rate: body
            .get("heart_rate")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        respiratory_rate: body
            .get("respiratory_rate")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        blood_pressure_systolic: body
            .get("systolic")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        blood_pressure_diastolic: body
            .get("diastolic")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        mean_arterial_pressure: None,
        temperature: body.get("temperature").and_then(|v| v.as_f64()),
        temperature_site: None,
        oxygen_saturation: body.get("spo2").and_then(|v| v.as_i64()).map(|v| v as i32),
        oxygen_delivery: None,
        fio2: None,
        pain_scale: body.get("pain").and_then(|v| v.as_i64()).map(|v| v as i32),
        gcs_score: None,
        gcs_eye: None,
        gcs_verbal: None,
        gcs_motor: None,
        blood_glucose: None,
        weight_kg: body.get("weight").and_then(|v| v.as_f64()),
        height_cm: body.get("height").and_then(|v| v.as_f64()),
        bmi: None,
        position: None,
        activity_level: None,
        is_critical: false,
        critical_values: None,
        recorded_at: now,
        recorded_by: current_user_id,
        facility_id: None,
        created_at: chrono::Utc::now(),
    };

    match data.repositories.vital_signs.create(vitals).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({"success": true})),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List all progress notes
#[get("/api/platform/list/progress-notes")]
pub async fn list_progress_notes(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    match data
        .repositories
        .progress_notes
        .list_all(Pagination::new(0, 100))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List all clinical incident reports
#[get("/api/platform/list/incidents")]
pub async fn list_incident_reports(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    match data
        .repositories
        .incident_reports
        .list_all(Pagination::new(0, 100))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List intake/output records
#[get("/api/platform/list/intake-output")]
pub async fn list_intake_output(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    match data
        .repositories
        .io_records
        .list_all(Pagination::new(0, 100))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List discharges Against Medical Advice (AMA)
#[get("/api/platform/list/ama-discharges")]
pub async fn list_ama_discharges(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    match data
        .repositories
        .ama_discharges
        .list_all(Pagination::new(0, 100))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}
