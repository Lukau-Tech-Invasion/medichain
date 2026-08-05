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
#[get("/api/emergency/mar/list")]
pub async fn list_mar(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
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
#[post("/api/emergency/io")]
pub async fn create_io(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::IntakeOutputRecord>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

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
#[post("/api/emergency/care-plan")]
pub async fn create_care_plan(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::NursingCarePlan>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

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
#[post("/api/emergency/wound")]
pub async fn create_wound(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::WoundAssessment>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

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
#[post("/api/emergency/incident")]
pub async fn create_incident(
    data: web::Data<AppState>,
    req: web::Json<crate::clinical::IncidentReport>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

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
