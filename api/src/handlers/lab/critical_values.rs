//! Critical-value notifications: raise, read back, acknowledge, cancel.

use crate::clinical_endpoints::*;

/// What the critical-value form actually submits.
///
/// `CriticalValuePage.tsx` posts camelCase and names the measurement `analyte`;
/// this handler used to read `patient_id`, `test_name` and `test_code` out of an
/// untyped `Value` with `unwrap_or_default()` behind each lookup. Nothing
/// matched. The stored row carried an empty patient, an empty test name and an
/// empty reporter — and on PostgreSQL the empty patient violated
/// `critical_values_patient_id_fkey`, so raising a critical potassium answered
/// `500`.
///
/// A critical value exists to be *communicated*. Storing one whose patient and
/// analyte are blank is worse than refusing it, because the regulatory
/// obligation attached to the notification is then recorded as discharged.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateCriticalValueRequest {
    #[serde(rename = "patientId", alias = "patient_id")]
    pub patient_id: String,
    /// The measurement. `analyte` on the form, `test_name` in the column.
    #[serde(rename = "analyte", alias = "test_name")]
    pub analyte: String,
    #[serde(rename = "testCode", alias = "test_code", default)]
    pub test_code: Option<String>,
    pub value: f64,
    #[serde(default)]
    pub unit: String,
    /// `high` / `low` on the form; the column calls it severity.
    #[serde(rename = "criticalLevel", alias = "severity", default)]
    pub critical_level: Option<String>,
    // `thresholdExceeded` is not read. It was declared a number while the
    // page sent the words ("Critical High (>6)"), so every report from the
    // page was a 400; and which bound was crossed is the server's call
    // (rule 8), made from `clinical_scoring::CRITICAL_VALUE_THRESHOLDS`.
    #[serde(rename = "reportedBy", alias = "reported_by", default)]
    pub reported_by: Option<String>,
    #[serde(rename = "reportedAt", default)]
    pub reported_at: Option<String>,
    /// The clinician who must be told. Without it the notification has no
    /// addressee and cannot be chased.
    #[serde(rename = "orderingProvider", alias = "notified_provider_id", default)]
    pub ordering_provider: Option<String>,
    #[serde(rename = "notificationStatus", default)]
    pub notification_status: Option<String>,
    #[serde(rename = "labPanelId", alias = "lab_panel_id", default)]
    pub lab_panel_id: Option<String>,
    #[serde(rename = "patientName", default)]
    pub patient_name: Option<String>,
    #[serde(rename = "notificationId", default)]
    pub notification_id: Option<String>,
}

/// Create critical value notification
#[post("/api/clinical/critical-value")]
pub async fn create_critical_value(
    data: web::Data<AppState>,
    req: web::Json<CreateCriticalValueRequest>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_perform_laboratory_work() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let body = req.into_inner();
    let now = Utc::now();

    if body.patient_id.trim().is_empty() || body.analyte.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "patient_id and analyte are required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if data
        .repositories
        .patients
        .get_by_id(&body.patient_id)
        .await
        .is_err()
    {
        return HttpResponse::NotFound().json(ErrorResponse {
            error: format!("Patient '{}' not found", body.patient_id),
            code: "PATIENT_NOT_FOUND".to_string(),
        });
    }

    // Server-generated: a client-supplied id lets one submission overwrite another.
    let notification_id = format!("CRV-{}", uuid::Uuid::new_v4().simple());
    let patient_id = body.patient_id.clone();
    let test_name = body.analyte.clone();
    let unit = body.unit.clone();
    let critical_value_str = body.value.to_string();
    let decimal = |v: f64| rust_decimal::Decimal::from_f64_retain(v);

    // Which bound was crossed is decided here, from the facility's call list
    // (rule 8). An analyte on the list whose value crosses no bound is not a
    // critical value, and filing it as one would page a clinician for nothing.
    // An analyte the list does not cover keeps the laboratory's own level and
    // says so.
    let classification =
        crate::clinical_scoring::classify_critical_value(&body.analyte, body.value);
    let listed = crate::clinical_scoring::CRITICAL_VALUE_THRESHOLDS
        .iter()
        .any(|t| t.analyte.eq_ignore_ascii_case(body.analyte.trim()));
    if listed && classification.is_none() {
        return HttpResponse::UnprocessableEntity().json(ErrorResponse {
            error: format!(
                "{} {} crosses no critical bound on the facility's call list",
                body.analyte, body.value
            ),
            code: "NOT_A_CRITICAL_VALUE".to_string(),
        });
    }
    let level = classification
        .as_ref()
        .map(|c| c.level.to_string())
        .or_else(|| body.critical_level.as_deref().map(str::to_ascii_lowercase))
        .unwrap_or_else(|| "critical-high".to_string());
    let is_low = classification
        .as_ref()
        .map(|c| c.low)
        .unwrap_or_else(|| level.contains("low"));
    let threshold = classification.as_ref().and_then(|c| decimal(c.bound));
    let threshold_text = classification.as_ref().map(|c| c.threshold.clone());

    let entity = CriticalValueEntity {
        id: notification_id.clone(),
        patient_id: patient_id.clone(),
        lab_panel_id: body.lab_panel_id.clone(),
        test_code: body.test_code.clone().unwrap_or_default(),
        test_name: test_name.clone(),
        value: decimal(body.value).unwrap_or_default(),
        unit: unit.clone(),
        reference_low: None,
        reference_high: None,
        critical_low: if is_low { threshold } else { None },
        critical_high: if is_low { None } else { threshold },
        // `critical_values.severity` permits `critical` / `panic` / `alert`.
        // The form's `critical-high` and `critical-low` say which SIDE of the
        // range was crossed, which is a different axis and is already recorded
        // in `critical_low` / `critical_high` above. Sending the side as the
        // severity made every critical value a 500 on PostgreSQL.
        severity: match level.as_str() {
            "panic" => "panic".to_string(),
            "alert" | "warning" => "alert".to_string(),
            _ => "critical".to_string(),
        },
        notified_provider_id: body.ordering_provider.clone(),
        notification_method: body.notification_status.clone(),
        notified_at: body
            .reported_at
            .as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&Utc)),
        acknowledged_at: None,
        acknowledged_by: None,
        action_taken: None,
        // The reporter is the authenticated caller. A client-asserted name on a
        // notification that carries a legal duty to communicate is not evidence
        // of who communicated it.
        reported_by: current_user.id.clone(),
        created_at: now,
        data: serde_json::json!({
            "notification_id": notification_id,
            "patient_id": patient_id,
            "patient_name": body.patient_name,
            "analyte": test_name,
            "value": body.value,
            "unit": unit,
            "critical_level": level,
            "threshold_exceeded": threshold_text,
            "classified_by": if classification.is_some() { "facility_call_list" } else { "laboratory" },
            "ordering_provider": body.ordering_provider,
            "notification_status": body.notification_status.clone().unwrap_or_else(|| "pending".to_string()),
            "reported_by": current_user.id,
            "reported_at": now.to_rfc3339(),
        }),
    };

    match data.repositories.critical_values.create(entity).await {
        Ok(_) => {
            // Push real-time SSE notification for critical lab value
            crate::websocket::push_cds_alert(
                &data.ws_manager,
                &patient_id,
                &format!(
                    "Critical Lab Value: {} = {} {}",
                    test_name, critical_value_str, unit
                ),
                "critical",
            );

            HttpResponse::Created().json(serde_json::json!({
                "success": true,
                "notification_id": notification_id
            }))
        }
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => {
            log::error!("critical value could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                error: "The critical value could not be saved".to_string(),
                code: "INTERNAL_ERROR".to_string(),
            })
        }
    }
}

#[get("/api/clinical/critical-value/{notification_id}")]
pub async fn get_critical_value(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let notification_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .critical_values
        .get_by_id(&notification_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(critical_value_view(&entity)),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            error: "Critical value notification not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// A critical-value notification as the screens read it: every stored column,
/// plus the notification's own fields at the top level.
///
/// The registry returned the bare entity, so the page -- which reads
/// `notification_id`, `analyte`, `critical_level`, `notification_status` --
/// found none of them: every notification rendered with no id, no analyte and
/// no patient, and every one read as "critical-high". The columns stay for
/// readers that use them (the analytics feed reads `test_name`, `created_at`).
pub fn critical_value_view(entity: &CriticalValueEntity) -> serde_json::Value {
    let mut view = serde_json::to_value(entity).unwrap_or_default();
    let doc = &entity.data;
    let text = |key: &str| doc.get(key).cloned().unwrap_or(serde_json::Value::Null);
    let value: f64 = entity.value.to_string().parse().unwrap_or_default();
    let status = if let Some(action) = entity.action_taken.as_deref() {
        if action.starts_with("cancelled") {
            "cancelled"
        } else {
            "acknowledged"
        }
    } else {
        "pending"
    };
    let fields = serde_json::json!({
        "notification_id": entity.id,
        "analyte": entity.test_name,
        "value": value,
        "patient_name": text("patient_name"),
        "critical_level": text("critical_level"),
        "threshold_exceeded": text("threshold_exceeded"),
        "classified_by": text("classified_by"),
        "ordering_provider": text("ordering_provider"),
        "reported_at": text("reported_at"),
        "notification_status": status,
        "notified_provider": entity.notified_provider_id,
        "read_back_value": text("read_back_value"),
        "read_back_verified": text("read_back_verified"),
        "acknowledgment_notes": text("acknowledgment_notes"),
        "time_to_acknowledge": text("time_to_acknowledge"),
        "cancel_reason": text("cancel_reason"),
    });
    if let (Some(view), Some(fields)) = (view.as_object_mut(), fields.as_object()) {
        for (key, value) in fields {
            view.insert(key.clone(), value.clone());
        }
    }
    view
}

/// Whether a read-back names the value that was reported.
///
/// Every number in the read-back is compared with the stored value; the words
/// around it ("potassium six point nine" does not count, "K 6.9" does) are not
/// judged. This is the safety check the call exists for, so it is computed here
/// and stored, not taken from the page (rule 8).
fn read_back_matches(read_back: &str, reported: f64) -> bool {
    read_back
        .split(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-'))
        .filter_map(|token| token.trim_matches('.').parse::<f64>().ok())
        .any(|number| (number - reported).abs() <= 1e-9_f64.max(reported.abs() * 1e-9))
}

/// What the read-back form submits.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcknowledgeCriticalValueRequest {
    /// The clinician who took the call.
    pub notified_provider: String,
    /// `phone`, `in-person`, `secure-message` or `page`.
    pub notification_method: String,
    /// What the clinician read back.
    pub read_back_value: String,
    #[serde(default)]
    pub acknowledgment_notes: String,
}

const NOTIFICATION_METHODS: [&str; 4] = ["phone", "in-person", "secure-message", "page"];

fn cv_error(status: actix_web::http::StatusCode, error: &str, code: &str) -> HttpResponse {
    HttpResponse::build(status).json(ErrorResponse {
        error: error.to_string(),
        code: code.to_string(),
    })
}

/// Read an open notification for a transition, or answer why not.
async fn open_critical_value(
    data: &web::Data<AppState>,
    id: &str,
) -> Result<CriticalValueEntity, HttpResponse> {
    use actix_web::http::StatusCode;
    match data.repositories.critical_values.get_by_id(id).await {
        Ok(entity) if entity.acknowledged_at.is_some() => Err(cv_error(
            StatusCode::CONFLICT,
            "This notification has already been closed",
            "NOTIFICATION_CLOSED",
        )),
        Ok(entity) => Ok(entity),
        Err(RepositoryError::NotFound(_)) => Err(cv_error(
            StatusCode::NOT_FOUND,
            "Critical value notification not found",
            "NOT_FOUND",
        )),
        Err(error) => {
            log::error!("critical value read failed: {error}");
            Err(cv_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "The notification could not be read",
                "REPO_ERROR",
            ))
        }
    }
}

/// Store a closure and its audit row, answering with the closed record.
async fn close_critical_value(
    data: &web::Data<AppState>,
    user: &crate::User,
    entity: &CriticalValueEntity,
    closure: CriticalValueClosure,
    audit_action: &str,
) -> HttpResponse {
    use actix_web::http::StatusCode;
    let closed = match data
        .repositories
        .critical_values
        .close(&entity.id, closure)
        .await
    {
        Ok(Some(closed)) => closed,
        Ok(None) => {
            return cv_error(
                StatusCode::CONFLICT,
                "This notification has already been closed",
                "NOTIFICATION_CLOSED",
            )
        }
        Err(error) => {
            log::error!("critical value closure failed: {error}");
            return cv_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "The notification could not be updated",
                "REPO_ERROR",
            );
        }
    };
    let audit = AccessLogEntry {
        access_id: uuid::Uuid::new_v4().to_string(),
        patient_id: entity.patient_id.clone(),
        accessor_id: user.id.clone(),
        accessor_role: user.role.to_string(),
        access_type: audit_action.to_string(),
        location: None,
        timestamp: Utc::now(),
        emergency: false,
    };
    if let Err(response) = crate::support::require_durable_audit(data, audit.into()).await {
        return response;
    }
    HttpResponse::Ok().json(critical_value_view(&closed))
}

/// Record that a clinician was told of a critical value and read it back.
#[post("/api/clinical/critical-value/{notification_id}/acknowledge")]
pub async fn acknowledge_critical_value(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<AcknowledgeCriticalValueRequest>,
) -> impl Responder {
    use actix_web::http::StatusCode;
    let user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if !(user.role.can_perform_laboratory_work() || user.role.can_edit_medical_records()) {
        return cv_error(
            StatusCode::FORBIDDEN,
            "Only laboratory staff and treating clinicians document a critical-value call",
            "INSUFFICIENT_ROLE",
        );
    }
    let req = body.into_inner();
    if req.notified_provider.trim().is_empty() || req.read_back_value.trim().is_empty() {
        return cv_error(
            StatusCode::BAD_REQUEST,
            "Who was notified and what they read back are both required",
            "VALIDATION_ERROR",
        );
    }
    if !NOTIFICATION_METHODS.contains(&req.notification_method.as_str()) {
        return cv_error(
            StatusCode::BAD_REQUEST,
            "Unknown notification method",
            "VALIDATION_ERROR",
        );
    }
    let entity = match open_critical_value(&data, &path.into_inner()).await {
        Ok(entity) => entity,
        Err(response) => return response,
    };
    let now = Utc::now();
    let reported: f64 = entity.value.to_string().parse().unwrap_or_default();
    let verified = read_back_matches(&req.read_back_value, reported);
    let minutes = (now - entity.created_at).num_minutes();
    let mut document = entity.data.clone();
    if let Some(doc) = document.as_object_mut() {
        doc.insert("notification_status".into(), "acknowledged".into());
        doc.insert("read_back_value".into(), req.read_back_value.trim().into());
        doc.insert("read_back_verified".into(), verified.into());
        doc.insert(
            "acknowledgment_notes".into(),
            req.acknowledgment_notes.trim().into(),
        );
        doc.insert("time_to_acknowledge".into(), minutes.into());
    }
    let closure = CriticalValueClosure {
        closed_by: user.id.clone(),
        action_taken: format!(
            "acknowledged: read back {}",
            if verified {
                "correctly"
            } else {
                "with a discrepancy"
            }
        ),
        notified_provider_id: Some(req.notified_provider.trim().to_string()),
        notification_method: Some(req.notification_method),
        notified_at: Some(now),
        data: document,
    };
    close_critical_value(
        &data,
        &user,
        &entity,
        closure,
        "critical_value_acknowledged",
    )
    .await
}

/// Withdraw a notification that was raised in error. It is kept, marked.
#[post("/api/clinical/critical-value/{notification_id}/cancel")]
pub async fn cancel_critical_value(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    use actix_web::http::StatusCode;
    let user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if !(user.role.can_perform_laboratory_work() || user.role.is_admin()) {
        return cv_error(
            StatusCode::FORBIDDEN,
            "Only the laboratory or an administrator withdraws a critical-value notification",
            "INSUFFICIENT_ROLE",
        );
    }
    let reason = body
        .get("reason")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .unwrap_or_default()
        .to_string();
    if reason.is_empty() {
        return cv_error(
            StatusCode::BAD_REQUEST,
            "A reason is required to withdraw a critical-value notification",
            "VALIDATION_ERROR",
        );
    }
    let entity = match open_critical_value(&data, &path.into_inner()).await {
        Ok(entity) => entity,
        Err(response) => return response,
    };
    let mut document = entity.data.clone();
    if let Some(doc) = document.as_object_mut() {
        doc.insert("notification_status".into(), "cancelled".into());
        doc.insert("cancel_reason".into(), reason.clone().into());
    }
    let closure = CriticalValueClosure {
        closed_by: user.id.clone(),
        action_taken: format!("cancelled: {reason}"),
        notified_provider_id: None,
        notification_method: None,
        notified_at: None,
        data: document,
    };
    close_critical_value(&data, &user, &entity, closure, "critical_value_cancelled").await
}

#[cfg(test)]
mod critical_value_workflow_tests {
    use super::*;
    use crate::test_fixtures::{register, seed_patient};
    use actix_web::{http::StatusCode, test, App};

    async fn state() -> web::Data<AppState> {
        let state = AppState::new();
        register(&state, "lab_tech", crate::Role::LabTechnician);
        register(&state, "doctor", crate::Role::Doctor);
        register(&state, "pharmacist", crate::Role::Pharmacist);
        seed_patient(&state, "PAT-CV-1").await;
        web::Data::new(state)
    }

    macro_rules! app {
        ($state:expr) => {
            test::init_service(
                App::new()
                    .app_data($state.clone())
                    .service(create_critical_value)
                    .service(get_critical_value)
                    .service(acknowledge_critical_value)
                    .service(cancel_critical_value)
                    .service(crate::clinical_endpoints::list_critical_values),
            )
            .await
        };
    }

    /// The page's own payload, `thresholdExceeded` text and all.
    fn report(analyte: &str, value: f64) -> serde_json::Value {
        serde_json::json!({
            "notificationId": "CV-001", "patientId": "PAT-CV-1", "patientName": "Test Patient",
            "analyte": analyte, "value": value, "unit": "mmol/L",
            "criticalLevel": "critical-high", "thresholdExceeded": "Critical High (>6)",
            "reportedBy": "lab_tech", "reportedAt": "2026-09-19T10:00:00Z",
            "orderingProvider": "doctor", "notificationStatus": "pending"
        })
    }

    macro_rules! file {
        ($app:expr, $analyte:expr, $value:expr) => {{
            let resp = test::call_service(
                $app,
                test::TestRequest::post()
                    .uri("/api/clinical/critical-value")
                    .insert_header(crate::test_fixtures::as_user("lab_tech"))
                    .set_json(report($analyte, $value))
                    .to_request(),
            )
            .await;
            assert_eq!(resp.status(), StatusCode::CREATED);
            let body: serde_json::Value = test::read_body_json(resp).await;
            body["notification_id"].as_str().unwrap().to_string()
        }};
    }

    macro_rules! get {
        ($app:expr, $id:expr) => {{
            let view: serde_json::Value = test::call_and_read_body_json(
                $app,
                test::TestRequest::get()
                    .uri(&format!("/api/clinical/critical-value/{}", $id))
                    .insert_header(crate::test_fixtures::as_user("doctor"))
                    .to_request(),
            )
            .await;
            view
        }};
    }

    /// The page's report used to be a 400 (its threshold text against an f64),
    /// and the level was the page's guess. The server decides it now.
    #[actix_web::test]
    async fn the_server_classifies_a_report_and_the_screen_can_read_it() {
        let state = state().await;
        let app = app!(state);
        let id = file!(&app, "Potassium", 7.3);

        let view = get!(&app, id);
        assert_eq!(view["notification_id"], id.as_str());
        assert_eq!(view["analyte"], "Potassium");
        assert_eq!(view["value"], 7.3);
        assert_eq!(view["critical_level"], "panic");
        assert_eq!(view["threshold_exceeded"], "Panic High (>7)");
        assert_eq!(view["notification_status"], "pending");
    }

    #[actix_web::test]
    async fn a_listed_analyte_inside_its_bounds_is_not_filed_as_critical() {
        let state = state().await;
        let app = app!(state);
        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/clinical/critical-value")
                .insert_header(crate::test_fixtures::as_user("lab_tech"))
                .set_json(report("Potassium", 4.1))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    /// The read-back is judged on the server, stored, and the notification
    /// closes exactly once.
    #[actix_web::test]
    async fn an_acknowledgment_records_the_read_back_and_closes_once() {
        let state = state().await;
        let app = app!(state);
        let id = file!(&app, "Potassium", 6.4);
        let ack = |readback: &str| {
            test::TestRequest::post()
                .uri(&format!("/api/clinical/critical-value/{id}/acknowledge"))
                .insert_header(crate::test_fixtures::as_user("lab_tech"))
                .set_json(serde_json::json!({
                    "notifiedProvider": "Dr Mensah", "notificationMethod": "phone",
                    "readBackValue": readback, "acknowledgmentNotes": "Repeat K ordered"
                }))
                .to_request()
        };

        let first = test::call_service(&app, ack("K 6.4 mmol/L")).await;
        assert_eq!(first.status(), StatusCode::OK);
        let view = get!(&app, id);
        assert_eq!(view["notification_status"], "acknowledged");
        assert_eq!(view["read_back_verified"], true);
        assert_eq!(view["notified_provider"], "Dr Mensah");
        assert!(view["acknowledged_at"].is_string());

        let again = test::call_service(&app, ack("6.4")).await;
        assert_eq!(again.status(), StatusCode::CONFLICT);
    }

    #[actix_web::test]
    async fn a_wrong_read_back_is_stored_as_a_discrepancy() {
        let state = state().await;
        let app = app!(state);
        let id = file!(&app, "Sodium", 118.0);
        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/clinical/critical-value/{id}/acknowledge"))
                .insert_header(crate::test_fixtures::as_user("doctor"))
                .set_json(serde_json::json!({
                    "notifiedProvider": "Dr Mensah", "notificationMethod": "phone",
                    "readBackValue": "sodium 128"
                }))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(get!(&app, id)["read_back_verified"], false);
    }

    #[actix_web::test]
    async fn a_pharmacist_cannot_document_the_call_and_a_cancellation_needs_a_reason() {
        let state = state().await;
        let app = app!(state);
        let id = file!(&app, "Glucose", 1.7);
        let by_pharmacist = test::call_service(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/clinical/critical-value/{id}/acknowledge"))
                .insert_header(crate::test_fixtures::as_user("pharmacist"))
                .set_json(serde_json::json!({
                    "notifiedProvider": "x", "notificationMethod": "phone", "readBackValue": "1.7"
                }))
                .to_request(),
        )
        .await;
        assert_eq!(by_pharmacist.status(), StatusCode::FORBIDDEN);

        let cancel = |reason: &str| {
            test::TestRequest::post()
                .uri(&format!("/api/clinical/critical-value/{id}/cancel"))
                .insert_header(crate::test_fixtures::as_user("lab_tech"))
                .set_json(serde_json::json!({ "reason": reason }))
                .to_request()
        };
        assert_eq!(
            test::call_service(&app, cancel("  ")).await.status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            test::call_service(&app, cancel("Haemolysed sample"))
                .await
                .status(),
            StatusCode::OK
        );
        let view = get!(&app, id);
        assert_eq!(view["notification_status"], "cancelled");
        assert_eq!(view["cancel_reason"], "Haemolysed sample");
    }
}
