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
    if let Err(error) = data
        .audit_outbox
        .record_durable(
            data.db_pool.as_ref(),
            "registry_bulk_read".into(),
            "clinical_registry".into(),
            http_req.path().to_string(),
            serde_json::json!({ "accessor_id": user_id, "accessor_role": user.role.to_string() }),
            Utc::now(),
        )
        .await
    {
        log::error!("audit outbox write failed: {error}");
        return Err(HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Clinical registry audit is unavailable".to_string(),
            code: "AUDIT_UNAVAILABLE".to_string(),
        }));
    }
    Ok(())
}

/// List lab chain of custody records
/// Map a registry read failure to a response.
///
/// A registry whose repository has no `list_all` on the active storage backend
/// is **empty, not broken**. Returning 500 made the page look like a server
/// fault (`/api/platform/list/lab-qc` did exactly this), when the honest answer
/// is "there are no records here". Genuine failures still surface as 500.
fn registry_read_error(http_req: &HttpRequest, e: impl std::fmt::Display) -> HttpResponse {
    let msg = e.to_string();
    if msg.contains("not implemented") {
        log::warn!(
            "registry {} has no list_all on this storage backend; returning an empty list",
            http_req.path()
        );
        return HttpResponse::Ok().json(Vec::<serde_json::Value>::new());
    }
    log::error!("registry read failed on {}: {}", http_req.path(), msg);
    HttpResponse::InternalServerError().finish()
}

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
        Err(e) => registry_read_error(&http_req, e),
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
        Err(e) => registry_read_error(&http_req, e),
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
        Err(e) => registry_read_error(&http_req, e),
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
        Err(e) => registry_read_error(&http_req, e),
    }
}

/// List all radiology reports
///
/// This endpoint did not exist, so `listRadiology()` in the shared client hard-coded
/// `reports: { total: 0, items: [] }`. The radiology worklist could therefore show a
/// study as reported while the report itself was unreachable from any list view.
#[get("/api/platform/list/radiology-reports")]
pub async fn list_radiology_reports(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    match data.repositories.radiology_reports.list_all().await {
        Ok(list) => HttpResponse::Ok().json(list),
        Err(e) => registry_read_error(&http_req, e),
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
        Err(e) => registry_read_error(&http_req, e),
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
        Err(e) => registry_read_error(&http_req, e),
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
    // Deliberately `require_registered_caller`, NOT `require_clinical_staff`:
    // this is the patient's own record, so demanding a clinical role would lock
    // patients out of their own immunization history. The caller is still
    // resolved, so a forged header is refused; the data is then scoped to that
    // caller, which is what makes it safe.
    let current_user = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    let patient_id = current_user
        .linked_patient_id
        .clone()
        .unwrap_or(current_user.wallet_address);
    match data
        .repositories
        .immunization_records
        .get_by_patient(&patient_id)
        .await
    {
        Ok(records) => HttpResponse::Ok().json(serde_json::json!({ "immunizations": records })),
        Err(e) => registry_read_error(&http_req, e),
    }
}

/// List blood bank inventory and screens
#[get("/api/platform/list/blood-bank")]
pub async fn list_blood_bank(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    // Two stores held blood-bank records and this register read the wrong one.
    //
    // `create_blood_type_screen` writes to `blood_type_screen_records` (the
    // JSON store) and `create_transfusion` to `transfusion_event_records`;
    // this read `blood_type_screens`, a typed repository nothing on the ward
    // path writes to. So an order raised on `BloodBankPage` and a transfusion
    // documented against it were both invisible on the register that exists to
    // show them — the "correct implementation beside the wrong one that
    // everything calls" pattern, again.
    //
    // Both stores are read, and the typed one is kept so any laboratory caller
    // that does write to it is not dropped.
    let typed = data
        .repositories
        .blood_type_screens
        .list_all()
        .await
        .unwrap_or_default();
    let ordered = data
        .repositories
        .blood_type_screen_records
        .list_all()
        .await
        .unwrap_or_default();
    let transfusions = data
        .repositories
        .transfusion_event_records
        .list_all()
        .await
        .unwrap_or_default();

    let mut screens: Vec<serde_json::Value> = typed
        .into_iter()
        .map(|s| serde_json::to_value(s).unwrap_or_default())
        .collect();
    screens.extend(ordered.into_iter().map(|r| r.data));
    let transfusions: Vec<serde_json::Value> = transfusions.into_iter().map(|r| r.data).collect();

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
        // The transfusions given against those orders, which is the other half
        // of what a blood-bank register is for.
        "transfusions": transfusions,
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
        Err(e) => registry_read_error(&http_req, e),
    }
}

/// Every death certificate on the register.
///
/// `ADMIN_NAV` has offered `/death-certificate` since the navigation was
/// written, and `DeathCertificatePage` renders a list of filed certificates —
/// from local component state, because the only endpoint that existed was
/// `GET /api/surgical/death-certificate/{id}`. A certificate could be filed and
/// then found only by somebody who already knew its id, which is not a
/// register. Registrars, coroners and the family all arrive without one.
#[get("/api/platform/list/death-certificates")]
pub async fn list_death_certificates(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    match data.repositories.death_certificate_records.list_all().await {
        // The stored record, which is the certificate as it was filed.
        Ok(list) => HttpResponse::Ok().json(list.into_iter().map(|r| r.data).collect::<Vec<_>>()),
        Err(e) => registry_read_error(&http_req, e),
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
        Err(e) => registry_read_error(&http_req, e),
    }
}

/// List all consultation notes
#[get("/api/platform/list/consults")]
pub async fn list_consults(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    // Consults live in `consultation_notes`, which is where `create_consult`
    // writes them.
    //
    // This used to read `progress_notes` and filter for `note_type == "consult"`
    // — a table nothing writes a consult into — so the consult list was
    // permanently empty and a requested consult was invisible to the specialty
    // it was addressed to. `ConsultPage` reads this endpoint for both its
    // outstanding list and its answered list.
    match data.repositories.consultation_notes.list_all().await {
        Ok(items) => HttpResponse::Ok().json(
            items
                .into_iter()
                .map(|c| {
                    // The blob carries what the form filed and the response the
                    // specialist wrote; the columns carry the identifiers. Both
                    // are served so neither read path can disagree with the
                    // other about whether a consult was answered.
                    let mut value = c.data.clone();
                    if let Some(object) = value.as_object_mut() {
                        object.insert("consult_id".into(), serde_json::json!(c.id));
                        object.insert("patient_id".into(), serde_json::json!(c.patient_id));
                        object.insert("status".into(), serde_json::json!(c.status));
                        object.insert(
                            "consultation_type".into(),
                            serde_json::json!(c.consultation_type),
                        );
                        object.insert(
                            "requesting_provider".into(),
                            serde_json::json!(c.requesting_provider),
                        );
                        object.insert(
                            "consulting_provider".into(),
                            serde_json::json!(c.consulting_provider),
                        );
                        object.insert(
                            "clinical_question".into(),
                            serde_json::json!(c.clinical_question),
                        );
                        object.insert(
                            "examination_findings".into(),
                            serde_json::json!(c.examination_findings),
                        );
                        object.insert(
                            "recommendations".into(),
                            serde_json::json!(c.recommendations),
                        );
                        object.insert("completed_at".into(), serde_json::json!(c.completed_at));
                    }
                    value
                })
                .collect::<Vec<_>>(),
        ),
        Err(e) => registry_read_error(&http_req, e),
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
        Err(e) => registry_read_error(&http_req, e),
    }
}

/// Record vital signs
#[post("/api/platform/vitals")]
pub async fn record_vital_signs(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
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
        Err(e) => registry_read_error(&http_req, e),
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
        Err(e) => registry_read_error(&http_req, e),
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
        Err(e) => registry_read_error(&http_req, e),
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
        Err(e) => registry_read_error(&http_req, e),
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
        Err(e) => registry_read_error(&http_req, e),
    }
}

/// A patient's pediatric assessments, newest first.
///
/// Deliberately patient-scoped rather than a `/api/platform/list/peds`
/// registry. The pediatrics page needs one child's growth series, not every
/// child's — and an all-patients read here would add another unscoped bulk read
/// to a backlog the project is actively trying to shrink. `get_by_patient` is
/// already on the repository trait, so this needs no new storage surface.
#[get("/api/clinical/peds/patient/{patient_id}")]
pub async fn list_peds_for_patient(
    data: web::Data<AppState>,
    path: web::Path<String>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = require_registry_reader(&data, &http_req).await {
        return resp;
    }
    let patient_id = path.into_inner();
    match data
        .repositories
        .pediatric_assessments
        .get_by_patient(&patient_id, Pagination::new(0, 100))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "items": result.items,
        })),
        Err(e) => registry_read_error(&http_req, e),
    }
}

/// Workflow 2: what a nurse records must reach the patient's own card, and
/// nobody else's.
///
/// `GET /api/clinical/immunizations` is caller-scoped: it takes no id, because
/// the patient application's Medical History screen has none to give. That
/// makes two things worth pinning down, and neither is visible by reading the
/// handler:
///
///   1. The nurse files against a `PAT-` id and the patient asks with a wallet
///      address. `linked_patient_id` bridges them. If that resolution breaks, a
///      patient is told they have had no vaccinations — the answer that gets
///      one repeated.
///   2. Because the route serves "whoever is calling", a scoping mistake does
///      not 403; it silently returns somebody else's vaccination history.
#[cfg(test)]
mod patient_immunization_card_tests {
    use crate::{AppState, Role, User};
    use actix_web::{test, web, App};

    fn state_with_users(users: &[(Role, &str, Option<&str>)]) -> web::Data<AppState> {
        let state = AppState::new();
        for (role, wallet, linked) in users {
            let user = User {
                wallet_address: wallet.to_string(),
                username: None,
                name: "Test".to_string(),
                role: role.clone(),
                created_at: chrono::Utc::now(),
                created_by: None,
                linked_patient_id: linked.map(str::to_string),
                email: None,
                phone: None,
                department: None,
                specialty: None,
                license_number: None,
                status: "active".to_string(),
                last_login: None,
            };
            state
                .users
                .write()
                .unwrap()
                .insert(wallet.to_string(), user);
        }
        web::Data::new(state)
    }

    /// `ImmunizationPage.tsx` -> `createImmunization()`, field for field.
    fn dose(patient_id: &str, vaccine: &str) -> serde_json::Value {
        serde_json::json!({
            "patient_id": patient_id,
            "vaccine_name": vaccine,
            "cvx_code": "03",
            "manufacturer": "Test Biologicals",
            "lot_number": "LOT-1",
            "expiration_date": "2030-01-01",
            "administration_date": "2026-09-12T09:00:00Z",
            "dose_number": 1,
            "route": "Intramuscular",
            "site": "left-deltoid",
            "administered_by": "Test Nurse",
            "vis_date": "2026-09-12T09:00:00Z",
            "funding_source": "PublicVFC",
            "registry_reported": false,
        })
    }

    /// The whole round trip in one process: the nurse's write, then the
    /// patient's read. Testing the read alone would pass against a store the
    /// producer never reaches.
    async fn card_for(
        data: web::Data<AppState>,
        nurse: &str,
        doses: &[(&str, &str)],
        reader: &str,
    ) -> (u16, String) {
        let app = test::init_service(
            App::new()
                .app_data(data)
                .service(crate::clinical_endpoints::create_immunization)
                .service(super::list_my_immunizations),
        )
        .await;

        for (patient_id, vaccine) in doses {
            let req = test::TestRequest::post()
                .uri("/api/surgical/immunization")
                .insert_header(("X-User-Id", nurse.to_string()))
                .set_json(dose(patient_id, vaccine))
                .to_request();
            let resp = test::call_service(&app, req).await;
            assert!(
                resp.status().is_success(),
                "the nurse could not record a vaccination: {}",
                resp.status()
            );
        }

        let req = test::TestRequest::get()
            .uri("/api/clinical/immunizations")
            .insert_header(("X-User-Id", reader.to_string()))
            .to_request();
        let resp = test::call_service(&app, req).await;
        let status = resp.status().as_u16();
        let body = test::read_body(resp).await;
        (status, String::from_utf8_lossy(&body).to_string())
    }

    #[actix_rt::test]
    async fn a_patient_sees_the_vaccination_a_nurse_gave_them() {
        let data = state_with_users(&[
            (Role::Nurse, "5Nurse", None),
            (Role::Patient, "5PatientOne", Some("PAT-1")),
        ]);
        let (status, body) = card_for(
            data,
            "5Nurse",
            &[("PAT-1", "Measles-Rubella")],
            "5PatientOne",
        )
        .await;
        assert_eq!(status, 200);
        assert!(
            body.contains("Measles-Rubella"),
            "the patient's own vaccination was missing from their card: {body}"
        );
    }

    /// The failure mode this route has instead of a 403.
    #[actix_rt::test]
    async fn a_patients_card_carries_nobody_elses_doses() {
        let data = state_with_users(&[
            (Role::Nurse, "5Nurse", None),
            (Role::Patient, "5PatientOne", Some("PAT-1")),
            (Role::Patient, "5PatientTwo", Some("PAT-2")),
        ]);
        let (status, body) = card_for(
            data,
            "5Nurse",
            &[("PAT-1", "Measles-Rubella"), ("PAT-2", "Yellow fever")],
            "5PatientOne",
        )
        .await;
        assert_eq!(status, 200);
        assert!(body.contains("Measles-Rubella"), "own dose missing: {body}");
        assert!(
            !body.contains("Yellow fever"),
            "another patient's vaccination history was disclosed: {body}"
        );
    }

    /// A clinician's own card, not the deployment register. The staff account
    /// has no `linked_patient_id`, so the scope falls back to their wallet —
    /// which matches no record, rather than matching everything.
    #[actix_rt::test]
    async fn an_unlinked_staff_caller_gets_their_own_empty_card() {
        let data = state_with_users(&[
            (Role::Nurse, "5Nurse", None),
            (Role::Patient, "5PatientOne", Some("PAT-1")),
        ]);
        let (status, body) =
            card_for(data, "5Nurse", &[("PAT-1", "Measles-Rubella")], "5Nurse").await;
        assert_eq!(status, 200);
        assert!(
            !body.contains("Measles-Rubella"),
            "an unlinked caller was handed a patient's record: {body}"
        );
    }

    /// An unregistered wallet is not a caller. `require_registered_caller`
    /// resolves against the user store, so a forged header is refused before
    /// any scoping decision is made.
    #[actix_rt::test]
    async fn an_unknown_caller_is_refused() {
        let data = state_with_users(&[(Role::Nurse, "5Nurse", None)]);
        let app = test::init_service(
            App::new()
                .app_data(data)
                .service(super::list_my_immunizations),
        )
        .await;
        let req = test::TestRequest::get()
            .uri("/api/clinical/immunizations")
            .insert_header(("X-User-Id", "5NobodyAtAll"))
            .to_request();
        let status = test::call_service(&app, req).await.status().as_u16();
        assert!(status == 401 || status == 403, "got {status}");
    }
}
