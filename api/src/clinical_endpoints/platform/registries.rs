use super::*;

// ============================================================================
// SYSTEM REGISTRIES & LISTS
// ============================================================================

/// List lab chain of custody records
#[get("/api/platform/list/chain-of-custody")]
pub async fn list_chain_of_custody(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    match data.repositories.chain_of_custody.list_all().await {
        Ok(list) => HttpResponse::Ok().json(list),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List lab quality control logs
#[get("/api/platform/list/lab-qc")]
pub async fn list_lab_qc(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
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
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
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
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    match data.repositories.radiology_orders.list_all().await {
        Ok(list) => HttpResponse::Ok().json(list),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List all pathology reports
#[get("/api/platform/list/pathology")]
pub async fn list_pathology(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
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
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    match data.repositories.immunization_records.list_all().await {
        Ok(list) => HttpResponse::Ok().json(list),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List blood bank inventory and screens
#[get("/api/platform/list/blood-bank")]
pub async fn list_blood_bank(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    let screens = data
        .repositories
        .blood_type_screens
        .list_all()
        .await
        .unwrap_or_default();
    let inventory = vec![
        serde_json::json!({"type": "O-Pos", "units": 12, "status": "adequate"}),
        serde_json::json!({"type": "A-Neg", "units": 2, "status": "low"}),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "screens": screens,
        "inventory": inventory
    }))
}

/// List all autopsy requests
#[get("/api/platform/list/autopsy")]
pub async fn list_autopsy(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    match data.repositories.autopsy_requests.list_all().await {
        Ok(list) => HttpResponse::Ok().json(list),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// List all consultation notes
#[get("/api/platform/list/consults")]
pub async fn list_consults(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
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
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
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
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
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
    _data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    // Mock incidents
    let incidents = vec![
        serde_json::json!({"id": "INC-001", "type": "fall", "severity": "minor", "at": chrono::Utc::now().timestamp() - 86400}),
    ];
    HttpResponse::Ok().json(incidents)
}

/// List intake/output records
#[get("/api/platform/list/intake-output")]
pub async fn list_intake_output(
    _data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    // Mock
    let io = vec![
        serde_json::json!({"id": "IO-001", "patient_id": "0xPATIENT1", "type": "intake", "volume_ml": 500, "at": chrono::Utc::now().timestamp() - 3600}),
    ];
    HttpResponse::Ok().json(io)
}

/// List discharges Against Medical Advice (AMA)
#[get("/api/platform/list/ama-discharges")]
pub async fn list_ama_discharges(
    _data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    // Mock
    let ama = vec![
        serde_json::json!({"id": "AMA-001", "patient_id": "0xPATIENT2", "reason": "family emergency", "at": chrono::Utc::now().timestamp() - 172800}),
    ];
    HttpResponse::Ok().json(ama)
}
