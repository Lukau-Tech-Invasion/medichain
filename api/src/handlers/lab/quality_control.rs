//! Laboratory quality control runs and instrument calibration.

use crate::clinical_endpoints::*;

/// What the QC form actually submits.
///
/// `LabQCPage.tsx` posts `instrument`, `analyte`, `observedValue`,
/// `expectedMean`, `expectedSD` and the Westgard rules that failed. This
/// handler read `instrument_id`, `test_name`, `measured_value`,
/// `expected_value` and `acceptable_range_low/high` from an untyped `Value`,
/// so every one of them fell through to its default. A run recorded on
/// 2026-09-10 read back as `instrument_id: ""`, `test_name: ""`,
/// `expected_value: "0"`, `measured_value: "0"` — a QC record that says the
/// control measured zero on an unnamed analyser.
///
/// That is worse than losing the record. Quality control exists so that patient
/// results are held when a control fails, and a stored run that passes by
/// arithmetic accident (0 within a range of 0 to 0) releases them.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateLabQcRequest {
    #[serde(rename = "testId", alias = "test_id", default)]
    pub test_id: Option<String>,
    /// The analyser. `instrument` on the form.
    #[serde(rename = "instrument", alias = "instrument_name", default)]
    pub instrument: String,
    /// What was measured. `analyte` on the form, `test_name` in the column.
    #[serde(rename = "analyte", alias = "test_name")]
    pub analyte: String,
    #[serde(rename = "level", alias = "qc_level", default)]
    pub level: String,
    #[serde(rename = "lotNumber", alias = "lot_number", default)]
    pub lot_number: Option<String>,
    #[serde(rename = "expiryDate", alias = "expiration_date", default)]
    pub expiry_date: Option<String>,
    /// What the control actually read.
    #[serde(rename = "observedValue", alias = "measured_value")]
    pub observed_value: f64,
    /// The target, and the spread that defines the acceptable window.
    #[serde(rename = "expectedMean", alias = "expected_value")]
    pub expected_mean: f64,
    #[serde(rename = "expectedSD", alias = "expected_sd", default)]
    pub expected_sd: f64,
    #[serde(default)]
    pub unit: String,
    // No `result` or `violatedRules`: the run is judged server-side by
    // `clinical_scoring::westgard_single_run`, never taken from the page.
    #[serde(rename = "performedBy", alias = "performed_by", default)]
    pub performed_by: Option<String>,
    #[serde(rename = "correctiveAction", alias = "corrective_action", default)]
    pub corrective_action: Option<String>,
    #[serde(default)]
    pub comments: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub time: Option<String>,
}

/// The control level as the `lab_qc_records` CHECK spells it.
///
/// `LabQCPage` offers "Level 1" / "Level 2" / "Level 3"; the constraint permits
/// `level1` / `level2` / `level3`. A space and two capitals were enough to make
/// every quality-control run a `500` on PostgreSQL — and QC is what decides
/// whether patient results are released.
fn canonical_qc_level(level: &str) -> String {
    let compact: String = level
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '_' && *c != '-')
        .collect::<String>()
        .to_ascii_lowercase();
    match compact.as_str() {
        "level1" | "1" | "low" => "level1".to_string(),
        "level2" | "2" | "normal" | "mid" => "level2".to_string(),
        "level3" | "3" | "high" => "level3".to_string(),
        // Unknown levels are refused by the constraint rather than silently
        // filed as level 1, which would claim a control was run at a
        // concentration it was not.
        other => other.to_string(),
    }
}

/// A calibration run establishes an instrument's measurement relationship; it
/// is not interchangeable with a QC control measurement.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLabCalibrationRequest {
    pub instrument: String,
    pub calibration_type: String,
    pub calibrator_lot: String,
    pub expiry_date: String,
    pub result: String,
    #[serde(default)]
    pub comments: Option<String>,
}

const CALIBRATION_TYPES: [&str; 3] = ["full", "verification", "linearity"];

const CALIBRATION_RESULTS: [&str; 2] = ["pass", "fail"];

fn calibration_error(error: &str, code: &str) -> HttpResponse {
    HttpResponse::BadRequest().json(ErrorResponse {
        error: error.to_string(),
        code: code.to_string(),
    })
}

/// Persist a traceable instrument calibration run.
///
/// IDs, operator identity and the performed time come from the authenticated
/// server context. The browser may describe the calibration, but cannot create
/// a historical-looking run or attribute it to another technician.
#[post("/api/clinical/lab-calibrations")]
pub async fn create_lab_calibration(
    data: web::Data<AppState>,
    req: web::Json<CreateLabCalibrationRequest>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(user) => user,
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
    if body.instrument.trim().is_empty() || body.calibrator_lot.trim().is_empty() {
        return calibration_error(
            "instrument and calibrator lot are required",
            "VALIDATION_ERROR",
        );
    }
    if !CALIBRATION_TYPES.contains(&body.calibration_type.as_str()) {
        return calibration_error("invalid calibration type", "VALIDATION_ERROR");
    }
    if !CALIBRATION_RESULTS.contains(&body.result.as_str()) {
        return calibration_error("invalid calibration result", "VALIDATION_ERROR");
    }
    let expiry_date = match chrono::NaiveDate::parse_from_str(&body.expiry_date, "%Y-%m-%d") {
        Ok(date) => date,
        Err(_) => return calibration_error("expiry date must use YYYY-MM-DD", "VALIDATION_ERROR"),
    };
    if expiry_date < Utc::now().date_naive() {
        return calibration_error("an expired calibrator cannot be used", "EXPIRED_CALIBRATOR");
    }

    let now = Utc::now();
    let calibration_id = format!("CAL-{}", uuid::Uuid::new_v4().simple());
    let entity = crate::repositories::JsonRecordEntity {
        id: calibration_id.clone(),
        owner_id: current_user.id.clone(),
        data: serde_json::json!({
            "calibration_id": calibration_id,
            "instrument": body.instrument.trim(),
            "calibration_type": body.calibration_type,
            "calibrator_lot": body.calibrator_lot.trim(),
            "expiry_date": expiry_date.format("%Y-%m-%d").to_string(),
            "result": body.result,
            "comments": body.comments.and_then(|comment| (!comment.trim().is_empty()).then_some(comment)),
            "performed_by": current_user.id,
            "performed_at": now.to_rfc3339(),
            "date": now.date_naive().format("%Y-%m-%d").to_string(),
            "time": now.format("%H:%M").to_string(),
        }),
        created_at: now,
        updated_at: now,
    };

    match data.repositories.lab_calibrations.create(entity).await {
        Ok(record) => HttpResponse::Created().json(serde_json::json!({
            "success": true, "calibration": record.data,
        })),
        Err(error) => {
            log::error!("laboratory calibration could not be stored: {error}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                error: "The calibration run could not be saved".to_string(),
                code: "INTERNAL_ERROR".to_string(),
            })
        }
    }
}

#[cfg(test)]
mod calibration_tests {
    use super::*;
    use crate::test_fixtures::register;
    use actix_web::{http::StatusCode, test, App};

    fn request(expiry_date: &str) -> serde_json::Value {
        serde_json::json!({
            "instrument": "Cobas e 411",
            "calibrationType": "full",
            "calibratorLot": "CAL-LOT-7",
            "expiryDate": expiry_date,
            "result": "pass",
            "comments": "Calibration accepted"
        })
    }

    async fn state() -> web::Data<AppState> {
        let state = AppState::new();
        register(&state, "lab_tech", crate::Role::LabTechnician);
        register(&state, "pharmacist", crate::Role::Pharmacist);
        web::Data::new(state)
    }

    #[actix_web::test]
    async fn calibration_is_server_attributed_and_durable() {
        let state = state().await;
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(create_lab_calibration),
        )
        .await;
        let response = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/clinical/lab-calibrations")
                .insert_header(crate::test_fixtures::as_user("lab_tech"))
                .set_json(request("2099-12-31"))
                .to_request(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::CREATED);
        let body: serde_json::Value = test::read_body_json(response).await;
        let calibration = &body["calibration"];
        assert!(calibration["calibration_id"]
            .as_str()
            .unwrap()
            .starts_with("CAL-"));
        assert_eq!(calibration["performed_by"], "lab_tech");
        assert_eq!(calibration["calibrator_lot"], "CAL-LOT-7");

        let records = state
            .repositories
            .lab_calibrations
            .list_all()
            .await
            .unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].data["result"], "pass");
    }

    #[actix_web::test]
    async fn expired_calibrator_and_non_laboratory_role_are_refused() {
        let state = state().await;
        let app =
            test::init_service(App::new().app_data(state).service(create_lab_calibration)).await;
        let expired = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/clinical/lab-calibrations")
                .insert_header(crate::test_fixtures::as_user("lab_tech"))
                .set_json(request("2000-01-01"))
                .to_request(),
        )
        .await;
        assert_eq!(expired.status(), StatusCode::BAD_REQUEST);

        let forbidden = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/clinical/lab-calibrations")
                .insert_header(crate::test_fixtures::as_user("pharmacist"))
                .set_json(request("2099-12-31"))
                .to_request(),
        )
        .await;
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
    }
}

/// Create lab QC record
#[post("/api/clinical/lab-qc")]
pub async fn create_lab_qc(
    data: web::Data<AppState>,
    req: web::Json<CreateLabQcRequest>,
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

    if body.analyte.trim().is_empty() || body.instrument.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "analyte and instrument are required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }

    // The run is judged here, by the rules in `clinical_scoring`, not taken
    // from the page. A zero or negative SD makes a z-score meaningless.
    let Some(run) = crate::clinical_scoring::westgard_single_run(
        body.observed_value,
        body.expected_mean,
        body.expected_sd,
    ) else {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "expectedSD must be a positive number".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    };

    let qc_id = format!("QC-{}", uuid::Uuid::new_v4().simple());
    let dec = |v: f64| rust_decimal::Decimal::from_f64_retain(v).unwrap_or_default();

    // The acceptable window is mean +/- 2 SD, the conventional Westgard limit.
    // Derived here rather than accepted from the client, for the same reason
    // every other clinical threshold is server-side: the window decides whether
    // patient results are released.
    let low = body.expected_mean - 2.0 * body.expected_sd;
    let high = body.expected_mean + 2.0 * body.expected_sd;

    // `passed` is the server's conclusion, not the page's claim: a run outside
    // the 2 SD window (a 1_2s warning or a 1_3s rejection) has not passed.
    let passed = run.result == crate::clinical_scoring::QcRunResult::Pass;

    let deviation = if body.expected_mean.abs() > f64::EPSILON {
        Some(dec((body.observed_value - body.expected_mean)
            / body.expected_mean
            * 100.0))
    } else {
        None
    };

    // A failed control with no corrective action is an audit finding rather
    // than a QC record, so the two are refused together.
    if !passed
        && body
            .corrective_action
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "a failed control requires a corrective action".to_string(),
            code: "CORRECTIVE_ACTION_REQUIRED".to_string(),
        });
    }

    let entity = LabQcRecordEntity {
        id: qc_id.clone(),
        instrument_id: body.instrument.clone(),
        instrument_name: body.instrument.clone(),
        qc_level: canonical_qc_level(&body.level),
        test_code: body.test_id.clone().unwrap_or_default(),
        test_name: body.analyte.clone(),
        expected_value: dec(body.expected_mean),
        measured_value: dec(body.observed_value),
        unit: body.unit.clone(),
        acceptable_range_low: dec(low),
        acceptable_range_high: dec(high),
        passed,
        deviation_percent: deviation,
        corrective_action: body.corrective_action.clone(),
        performed_by: current_user.id.clone(),
        reviewed_by: None,
        performed_at: now,
        reviewed_at: None,
        lot_number: body.lot_number.clone(),
        expiration_date: body
            .expiry_date
            .as_deref()
            .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()),
        created_at: now,
        data: serde_json::json!({
            "qc_id": qc_id,
            "instrument": body.instrument,
            "analyte": body.analyte,
            "level": body.level,
            "observed_value": body.observed_value,
            "expected_mean": body.expected_mean,
            "expected_sd": body.expected_sd,
            "acceptable_range_low": low,
            "acceptable_range_high": high,
            "unit": body.unit,
            "passed": passed,
            "result": run.result,
            "z_score": run.z_score,
            // Rule codes, not prose: "1_3s" and "1_2s" mean different things
            // about the analyser and lead to different actions. The page used
            // to send its own, already translated into the clerk's language.
            "violated_rules": run.violated_rules,
            "corrective_action": body.corrective_action,
            "comments": body.comments,
            "performed_by": current_user.id,
            "performed_at": now.to_rfc3339(),
        }),
    };

    match data.repositories.lab_qc_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "qc_id": qc_id,
            "passed": passed,
            "result": run.result,
            "z_score": run.z_score,
            "violated_rules": run.violated_rules,
            "acceptable_range_low": low,
            "acceptable_range_high": high
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => {
            log::error!("QC run could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                error: "The quality-control run could not be saved".to_string(),
                code: "INTERNAL_ERROR".to_string(),
            })
        }
    }
}

#[get("/api/clinical/lab-qc/{qc_id}")]
pub async fn get_lab_qc(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let qc_id = path.into_inner();

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

    match data.repositories.lab_qc_records.get_by_id(&qc_id).await {
        Ok(entity) => {
            // The stored record, not `entity.data`. `data` is `#[sqlx(skip)]`
            // on every one of these entities, so on PostgreSQL it is always
            // `Value::Null` — this endpoint returned a literal `null` with a
            // 200 for every record ever saved. The typed columns are the record.
            HttpResponse::Ok().json(entity)
        }
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            error: "Lab QC record not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[cfg(test)]
mod lab_qc_verdict_tests {
    use super::*;
    use crate::test_fixtures::register;
    use actix_web::{http::StatusCode, test, App};

    fn run(observed: f64, sd: f64) -> serde_json::Value {
        // What `LabQCPage` sends: no verdict of its own.
        serde_json::json!({
            "instrument": "Cobas c311",
            "analyte": "Potassium",
            "level": "Level 2",
            "observedValue": observed,
            "expectedMean": 5.0,
            "expectedSD": sd,
            "unit": "mmol/L",
            "correctiveAction": "Recalibrated, control repeated",
        })
    }

    /// The verdict is the server's, and the list serves it. The list used to
    /// be read for a `result` nobody stored, so a failed run showed as a pass.
    #[actix_web::test]
    async fn a_run_seven_sd_out_is_stored_and_answered_as_a_1_3s_failure() {
        let state = AppState::new();
        register(&state, "lab_tech", crate::Role::LabTechnician);
        let state = web::Data::new(state);
        let app =
            test::init_service(App::new().app_data(state.clone()).service(create_lab_qc)).await;

        let created: serde_json::Value = test::call_and_read_body_json(
            &app,
            test::TestRequest::post()
                .uri("/api/clinical/lab-qc")
                .insert_header(crate::test_fixtures::as_user("lab_tech"))
                .set_json(run(6.4, 0.2))
                .to_request(),
        )
        .await;
        assert_eq!(created["result"], "fail");
        assert_eq!(created["passed"], false);
        assert_eq!(created["violated_rules"], serde_json::json!(["1_3s"]));

        let stored = state.repositories.lab_qc_records.list_all().await.unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].data["result"], "fail");
        assert_eq!(
            stored[0].data["violated_rules"],
            serde_json::json!(["1_3s"])
        );
    }

    #[actix_web::test]
    async fn a_zero_sd_is_refused_rather_than_judged() {
        let state = AppState::new();
        register(&state, "lab_tech", crate::Role::LabTechnician);
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .service(create_lab_qc),
        )
        .await;
        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/clinical/lab-qc")
                .insert_header(crate::test_fixtures::as_user("lab_tech"))
                .set_json(run(5.0, 0.0))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}
