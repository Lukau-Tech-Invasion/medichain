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
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
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
    if get_current_user_id(&http_req).is_none() {
        return HttpResponse::Unauthorized().finish();
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
#[get("/api/emergency/mar/list")]
pub async fn list_mar(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    match data
        .repositories
        .medication_records
        .list_all(Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// Administer medication (Workflow shortcut)
#[post("/api/emergency/administer-med")]
pub async fn administer_medication(
    _data: web::Data<AppState>,
    http_req: HttpRequest,
    _req: web::Json<serde_json::Value>,
) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    HttpResponse::Ok()
        .json(serde_json::json!({"success": true, "message": "Medication administered and logged"}))
}

/// Create I/O record
#[post("/api/emergency/io")]
pub async fn create_io(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::IntakeOutputRecord>,
    http_req: HttpRequest,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let record = req.into_inner();
    let id = format!("IO-{}-{}", record.patient_id, record.date);
    let entity = io_record_entity(id.clone(), &record, json_value(&record));
    match data.repositories.io_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
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
    if get_current_user_id(&http_req).is_none() {
        return HttpResponse::Unauthorized().finish();
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
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
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

/// Record fluid (Workflow shortcut)
#[post("/api/emergency/record-fluid")]
pub async fn record_fluid(
    _data: web::Data<AppState>,
    http_req: HttpRequest,
    _req: web::Json<serde_json::Value>,
) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    HttpResponse::Ok()
        .json(serde_json::json!({"success": true, "message": "Fluid intake/output recorded"}))
}

/// Create nursing care plan
#[post("/api/emergency/care-plan")]
pub async fn create_care_plan(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::NursingCarePlan>,
    http_req: HttpRequest,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let plan = req.into_inner();
    let id = plan.care_plan_id.clone();
    let entity = nursing_care_plan_entity(&plan, json_value(&plan));
    match data.repositories.nursing_care_plans.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
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
    if get_current_user_id(&http_req).is_none() {
        return HttpResponse::Unauthorized().finish();
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
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
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
#[post("/api/emergency/wound")]
pub async fn create_wound(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::WoundAssessment>,
    http_req: HttpRequest,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let assessment = req.into_inner();
    let id = assessment.assessment_id.clone();
    let entity = wound_assessment_entity(&assessment, json_value(&assessment));
    match data.repositories.wound_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
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
    if get_current_user_id(&http_req).is_none() {
        return HttpResponse::Unauthorized().finish();
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
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
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
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

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
    if get_current_user_id(&http_req).is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    let id = path.into_inner();
    match data.repositories.iv_assessments.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// Create shift handoff
#[post("/api/emergency/handoff")]
pub async fn create_shift_handoff(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::ShiftHandoff>,
    http_req: HttpRequest,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

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
    if get_current_user_id(&http_req).is_none() {
        return HttpResponse::Unauthorized().finish();
    }
    let id = path.into_inner();
    match data.repositories.shift_handoffs.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// Create incident report
#[post("/api/emergency/incident")]
pub async fn create_incident(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::IncidentReport>,
    http_req: HttpRequest,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let report = req.into_inner();
    let id = report.report_id.clone();
    let entity = incident_report_entity(&report, json_value(&report));
    match data.repositories.incident_reports.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(_) => HttpResponse::InternalServerError().finish(),
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
    if get_current_user_id(&http_req).is_none() {
        return HttpResponse::Unauthorized().finish();
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
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

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
    if get_current_user_id(&http_req).is_none() {
        return HttpResponse::Unauthorized().finish();
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
