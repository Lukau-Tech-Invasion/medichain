//! Research / secondary-use export (WP7.4).
//!
//! An administrator proposes an export with a stated purpose; two *other*
//! administrators approve it (a durable governance decision, see
//! `governance.rs`); then it can be run exactly once. A run includes only
//! patients whose research consent is granted, unrevoked, unexpired and on
//! the current consent version, and releases only de-identified records (see
//! `research_export.rs`: keyed pseudonyms, age bands, no direct identifiers,
//! small-cell suppression). Every included patient gets an access-log row, so
//! their "Who viewed my records" history shows the export.

use super::*;
use crate::governance::{self, GovernanceError};
use crate::research_export::{
    age_band, configured_pseudonym_key, normalize_conditions, pseudonym, sex_category,
    suppress_small_cells, ResearchRecord, REQUIRED_EXPORT_APPROVALS, RESEARCH_CONSENT_TYPE,
    RESEARCH_CONSENT_VERSION, SMALL_CELL_THRESHOLD,
};

/// Shortest and longest purpose statement accepted, in characters.
const MIN_PURPOSE_CHARS: usize = 20;
const MAX_PURPOSE_CHARS: usize = 500;
/// Most consenting patients one export reads.
const MAX_EXPORT_PATIENTS: i64 = 50_000;
/// Governance decision type and subject type for an export.
const DECISION_TYPE: &str = "research_export";

/// Body of `POST /api/research/exports`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposeExportBody {
    /// Why this export is needed and who will receive it.
    pub purpose: String,
}

/// A JSON error with a stable code.
fn export_error(
    mut builder: actix_web::HttpResponseBuilder,
    message: &str,
    code: &str,
) -> HttpResponse {
    builder.json(ErrorResponse {
        error: message.to_string(),
        code: code.to_string(),
    })
}

/// 503 for a storage failure; the underlying error is logged, never returned.
fn export_unavailable(context: &str, error: impl std::fmt::Display) -> HttpResponse {
    log::error!("Research export: {context}: {error}");
    export_error(
        HttpResponse::ServiceUnavailable(),
        "Research exports are temporarily unavailable.",
        "RESEARCH_EXPORT_UNAVAILABLE",
    )
}

/// Map a governance refusal onto an HTTP answer.
fn governance_response(error: GovernanceError) -> HttpResponse {
    match error {
        GovernanceError::NotFound => export_error(
            HttpResponse::NotFound(),
            "Export not found.",
            "RESEARCH_EXPORT_NOT_FOUND",
        ),
        GovernanceError::Refused(message) => {
            export_error(HttpResponse::Conflict(), message, "RESEARCH_EXPORT_STATE")
        }
        GovernanceError::Storage(detail) => export_unavailable("governance", detail),
    }
}

/// An organisation-level audit row for an export act (no patient).
fn governance_audit(caller: &crate::User, run_id: &str, action: &str) -> AccessLogEntity {
    AccessLogEntity {
        id: secure_tokens::generate_access_id(),
        accessor_id: caller.wallet_address.clone(),
        accessor_role: caller.role.to_string(),
        patient_id: None,
        resource_type: "research_export".to_string(),
        resource_id: Some(run_id.to_string()),
        action: action.to_string(),
        access_reason: None,
        is_emergency_access: false,
        ip_address: None,
        user_agent: None,
        blockchain_tx_hash: None,
        accessed_at: Utc::now(),
        facility_id: None,
    }
}

/// The exact proposal text the approvers sign off on (hashed into the decision).
fn proposal_text(purpose: &str) -> String {
    serde_json::json!({
        "purpose": purpose,
        "consent_type": RESEARCH_CONSENT_TYPE,
        "consent_version": RESEARCH_CONSENT_VERSION,
        "small_cell_threshold": SMALL_CELL_THRESHOLD,
        "fields": ["pseudonym", "age_band", "sex", "conditions"],
    })
    .to_string()
}

/// Load an export run's JSON record: 404 if unknown.
async fn load_run(
    data: &web::Data<AppState>,
    run_id: &str,
) -> Result<JsonRecordEntity, HttpResponse> {
    match data
        .repositories
        .research_export_runs
        .get_by_id(run_id)
        .await
    {
        Ok(Some(run)) => Ok(run),
        Ok(None) => Err(export_error(
            HttpResponse::NotFound(),
            "Export not found.",
            "RESEARCH_EXPORT_NOT_FOUND",
        )),
        Err(error) => Err(export_unavailable("load run", error)),
    }
}

/// Save a run's JSON with `changes` merged in.
async fn update_run(
    data: &web::Data<AppState>,
    mut run: JsonRecordEntity,
    changes: serde_json::Value,
) -> Result<JsonRecordEntity, HttpResponse> {
    if let (Some(target), Some(source)) = (run.data.as_object_mut(), changes.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
    run.updated_at = Utc::now();
    data.repositories
        .research_export_runs
        .create(run)
        .await
        .map_err(|error| export_unavailable("save run", error))
}

/// Propose an export (administrators). Returns 201 with the run.
#[post("/api/research/exports")]
pub async fn propose_research_export(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<ProposeExportBody>,
) -> impl Responder {
    let caller = match require_administrator(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let purpose = body.purpose.trim();
    let length = purpose.chars().count();
    if !(MIN_PURPOSE_CHARS..=MAX_PURPOSE_CHARS).contains(&length)
        || purpose.chars().any(char::is_control)
    {
        return export_error(
            HttpResponse::BadRequest(),
            "State the purpose and recipient in 20 to 500 characters.",
            "PURPOSE_REQUIRED",
        );
    }
    let run_id = format!("REX-{}", Uuid::new_v4());
    let now = Utc::now();
    let decision = match governance::propose(
        &data,
        DECISION_TYPE,
        (DECISION_TYPE, &run_id),
        &proposal_text(purpose),
        REQUIRED_EXPORT_APPROVALS,
        now,
    )
    .await
    {
        Ok(decision) => decision,
        Err(error) => return governance_response(error),
    };
    let run = JsonRecordEntity {
        id: run_id.clone(),
        owner_id: caller.wallet_address.clone(),
        data: serde_json::json!({
            "id": run_id, "purpose": purpose, "proposed_by": caller.wallet_address,
            "decision_id": decision.id, "consent_version": RESEARCH_CONSENT_VERSION,
            "required_approvals": REQUIRED_EXPORT_APPROVALS, "status": "proposed",
            "created_at": now,
        }),
        created_at: now,
        updated_at: now,
    };
    if let Err(error) = data
        .repositories
        .research_export_runs
        .create(run.clone())
        .await
    {
        return export_unavailable("create run", error);
    }
    if let Err(response) = require_durable_audit(
        &data,
        governance_audit(&caller, &run_id, "research_export_proposed"),
    )
    .await
    {
        return response;
    }
    HttpResponse::Created().json(serde_json::json!({ "success": true, "export": run.data }))
}

/// Every export run with its governance state (administrators).
#[get("/api/research/exports")]
pub async fn list_research_exports(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(response) = require_administrator(&data, &http_req) {
        return response;
    }
    let runs = match data.repositories.research_export_runs.list_all().await {
        Ok(runs) => runs,
        Err(error) => return export_unavailable("list runs", error),
    };
    let mut exports = Vec::with_capacity(runs.len());
    for run in runs {
        let decision_id = run
            .data
            .get("decision_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let approved_by = match governance::get(&data, decision_id).await {
            Ok(decision) => decision.approved_by,
            Err(GovernanceError::NotFound) => Vec::new(),
            Err(error) => return governance_response(error),
        };
        let mut value = run.data;
        if let Some(object) = value.as_object_mut() {
            object.insert("approved_by".into(), serde_json::json!(approved_by));
        }
        exports.push(value);
    }
    exports.sort_by(|a, b| {
        b.get("created_at")
            .map(|v| v.to_string())
            .cmp(&a.get("created_at").map(|v| v.to_string()))
    });
    HttpResponse::Ok().json(serde_json::json!({ "success": true, "exports": exports, "configured": configured_pseudonym_key().is_some() }))
}

/// Approve an export (an administrator other than its proposer).
#[post("/api/research/exports/{run_id}/approve")]
pub async fn approve_research_export(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let caller = match require_administrator(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let run = match load_run(&data, &path.into_inner()).await {
        Ok(run) => run,
        Err(response) => return response,
    };
    if run.owner_id == caller.wallet_address {
        return export_error(
            HttpResponse::Forbidden(),
            "The proposer cannot approve their own export.",
            "SELF_APPROVAL_REFUSED",
        );
    }
    let decision_id = run
        .data
        .get("decision_id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let decision = match governance::approve(&data, &decision_id, &caller.wallet_address).await {
        Ok(decision) => decision,
        Err(error) => return governance_response(error),
    };
    let status = if decision.approved_by.len() >= decision.required_approvals {
        "approved"
    } else {
        "proposed"
    };
    let run_id = run.id.clone();
    let saved = match update_run(&data, run, serde_json::json!({ "status": status })).await {
        Ok(saved) => saved,
        Err(response) => return response,
    };
    if let Err(response) = require_durable_audit(
        &data,
        governance_audit(&caller, &run_id, "research_export_approved"),
    )
    .await
    {
        return response;
    }
    HttpResponse::Ok().json(serde_json::json!({ "success": true, "export": saved.data, "approved_by": decision.approved_by }))
}

/// Patients whose research consent is granted, unrevoked, unexpired and on
/// the current consent version. Returns their ids.
async fn consenting_patient_ids(data: &web::Data<AppState>) -> Result<Vec<String>, String> {
    if let Some(pool) = data.db_pool.as_ref() {
        return sqlx::query_scalar::<_, String>(
            "SELECT DISTINCT patient_id FROM consent_records
             WHERE consent_type = $1 AND consent_status = 'granted' AND version = $2
               AND COALESCE(revoked, false) = false
               AND (expiration_datetime IS NULL OR expiration_datetime > NOW())
             ORDER BY patient_id LIMIT $3",
        )
        .bind(RESEARCH_CONSENT_TYPE)
        .bind(RESEARCH_CONSENT_VERSION)
        .bind(MAX_EXPORT_PATIENTS)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string());
    }
    consenting_patient_ids_in_memory(data).await
}

/// The memory backend's version of [`consenting_patient_ids`].
async fn consenting_patient_ids_in_memory(
    data: &web::Data<AppState>,
) -> Result<Vec<String>, String> {
    let patients = data
        .repositories
        .patients
        .list(Pagination::new(0, MAX_EXPORT_PATIENTS as u32))
        .await
        .map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    for patient in patients.items {
        let consent = data
            .repositories
            .consent_records
            .get_active_by_type(&patient.id, RESEARCH_CONSENT_TYPE)
            .await
            .map_err(|e| e.to_string())?;
        if consent.is_some_and(|c| {
            c.consent_status == "granted" && c.version.as_deref() == Some(RESEARCH_CONSENT_VERSION)
        }) {
            ids.push(patient.id);
        }
    }
    Ok(ids)
}

/// Build the de-identified record for one patient, or `None` when the
/// profile cannot be read or has no usable date of birth.
async fn research_record(
    data: &web::Data<AppState>,
    key: &[u8],
    patient_id: &str,
    today: chrono::NaiveDate,
) -> Option<ResearchRecord> {
    let entity = data
        .repositories
        .patients
        .get_by_id(patient_id)
        .await
        .ok()?;
    let profile = patient_entity_to_profile(&entity, &data.encryption_keyring)?;
    Some(ResearchRecord {
        pseudonym: pseudonym(key, patient_id),
        age_band: age_band(&profile.date_of_birth, today)?,
        sex: sex_category(profile.gender.as_deref()),
        conditions: normalize_conditions(&profile.emergency_info.chronic_conditions),
    })
}

/// One access-log row per included patient, so each sees the export.
fn inclusion_rows(
    caller: &crate::User,
    run_id: &str,
    patient_ids: &[String],
) -> Vec<AccessLogEntity> {
    patient_ids
        .iter()
        .map(|patient_id| AccessLogEntity {
            patient_id: Some(patient_id.clone()),
            resource_type: "Research export (de-identified)".to_string(),
            access_reason: Some("Research (de-identified)".to_string()),
            ..governance_audit(caller, run_id, "research_export_included")
        })
        .collect()
}

/// Read every consenting patient and de-identify. Returns the released
/// records, the ids of patients whose records were released, and how many
/// records were withheld by small-cell suppression or had no usable data.
async fn build_dataset(
    data: &web::Data<AppState>,
    key: &[u8],
) -> Result<(Vec<ResearchRecord>, Vec<String>, usize), String> {
    let today = Utc::now().date_naive();
    let ids = consenting_patient_ids(data).await?;
    let mut by_pseudonym = std::collections::HashMap::new();
    let mut records = Vec::new();
    for id in &ids {
        if let Some(record) = research_record(data, key, id, today).await {
            by_pseudonym.insert(record.pseudonym.clone(), id.clone());
            records.push(record);
        }
    }
    let unusable = ids.len() - records.len();
    let (kept, withheld) = suppress_small_cells(records, SMALL_CELL_THRESHOLD);
    let released: Vec<String> = kept
        .iter()
        .filter_map(|r| by_pseudonym.get(&r.pseudonym).cloned())
        .collect();
    Ok((kept, released, withheld + unusable))
}

/// Run an approved export, once (administrators).
///
/// Returns 200 with the de-identified records; 503
/// `RESEARCH_EXPORT_NOT_CONFIGURED` without a pseudonymisation key; 409 when
/// the export is not fully approved or has already run.
#[post("/api/research/exports/{run_id}/execute")]
pub async fn execute_research_export(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let caller = match require_administrator(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let Some(key) = configured_pseudonym_key() else {
        return export_error(HttpResponse::ServiceUnavailable(), "Research export is not configured: no pseudonymisation key is set for this deployment.", "RESEARCH_EXPORT_NOT_CONFIGURED");
    };
    let run = match load_run(&data, &path.into_inner()).await {
        Ok(run) => run,
        Err(response) => return response,
    };
    let decision_id = run
        .data
        .get("decision_id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let (records, released, withheld) = match build_dataset(&data, &key).await {
        Ok(result) => result,
        Err(error) => return export_unavailable("build dataset", error),
    };
    // Claimed atomically: a second execute, on any instance, is refused here.
    if let Err(error) = governance::execute(&data, &decision_id, Utc::now()).await {
        return governance_response(error);
    }
    finish_export(&data, &caller, run, records, released, withheld).await
}

/// Record who was included, audit the run, save its summary, and release it.
async fn finish_export(
    data: &web::Data<AppState>,
    caller: &crate::User,
    run: JsonRecordEntity,
    records: Vec<ResearchRecord>,
    released: Vec<String>,
    withheld: usize,
) -> HttpResponse {
    for row in inclusion_rows(caller, &run.id, &released) {
        if let Err(response) = require_durable_audit(data, row).await {
            return response;
        }
    }
    let run_id = run.id.clone();
    let body = serde_json::to_vec(&records).unwrap_or_default();
    let summary = serde_json::json!({
        "status": "executed", "executed_by": caller.wallet_address, "executed_at": Utc::now(),
        "included_count": records.len(), "withheld_count": withheld,
        "output_sha256": hex::encode(medichain_crypto::sha256(&body)),
    });
    let saved = match update_run(data, run, summary).await {
        Ok(saved) => saved,
        Err(response) => return response,
    };
    if let Err(response) = require_durable_audit(
        data,
        governance_audit(caller, &run_id, "research_export_executed"),
    )
    .await
    {
        return response;
    }
    HttpResponse::Ok()
        .json(serde_json::json!({ "success": true, "export": saved.data, "records": records }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test, App};

    const ADMIN_A: &str = "admin_a";
    const ADMIN_B: &str = "admin_b";
    const ADMIN_C: &str = "admin_c";
    const DOCTOR: &str = "doctor_rex";
    const PURPOSE: &str = "Hypertension prevalence study for the provincial health department";

    /// A patient with a profile, and a signed-in patient account linked to it.
    async fn add_patient(
        state: &AppState,
        id: &str,
        born: &str,
        gender: &str,
        conditions: &[&str],
    ) {
        let mut profile = crate::test_fixtures::patient_profile(id, "Synthetic Person");
        profile.date_of_birth = born.into();
        profile.gender = Some(gender.into());
        profile.emergency_info.chronic_conditions =
            conditions.iter().map(|c| c.to_string()).collect();
        let entity = crate::patient_profile_to_entity(&profile, &state.encryption_keyring);
        state.repositories.patients.create(entity).await.unwrap();
        let mut user = crate::test_fixtures::staff(&format!("wallet_{id}"), crate::Role::Patient);
        user.linked_patient_id = Some(id.into());
        state
            .users
            .write()
            .unwrap()
            .insert(user.wallet_address.clone(), user);
    }

    async fn state() -> web::Data<AppState> {
        let state = AppState::new();
        for (wallet, role) in [
            (ADMIN_A, crate::Role::Admin),
            (ADMIN_B, crate::Role::Admin),
            (ADMIN_C, crate::Role::Admin),
            (DOCTOR, crate::Role::Doctor),
        ] {
            crate::test_fixtures::register(&state, wallet, role);
        }
        web::Data::new(state)
    }

    async fn call(
        state: &web::Data<AppState>,
        request: test::TestRequest,
        wallet: &str,
    ) -> (u16, serde_json::Value) {
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(propose_research_export)
                .service(list_research_exports)
                .service(approve_research_export)
                .service(execute_research_export)
                .service(crate::clinical_endpoints::sign_consent),
        )
        .await;
        let response = test::call_service(
            &app,
            request.insert_header(("x-user-id", wallet)).to_request(),
        )
        .await;
        let status = response.status().as_u16();
        let body = test::read_body(response).await;
        (
            status,
            serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null),
        )
    }

    /// The patient signs research consent through the real consent endpoint.
    async fn consent(state: &web::Data<AppState>, id: &str) {
        let body = serde_json::json!({
            "type_id": RESEARCH_CONSENT_TYPE, "patient_id": id, "consent_given": true,
            "popia_section_11_basis": "consent", "special_information_basis": "consent",
            "privacy_notice_version": "2026-09",
        });
        let (status, response) = call(
            state,
            test::TestRequest::post()
                .uri("/api/consent/sign")
                .set_json(body),
            &format!("wallet_{id}"),
        )
        .await;
        assert_eq!(status, 201, "{response}");
    }

    async fn propose(state: &web::Data<AppState>) -> String {
        let request = test::TestRequest::post()
            .uri("/api/research/exports")
            .set_json(serde_json::json!({ "purpose": PURPOSE }));
        let (status, body) = call(state, request, ADMIN_A).await;
        assert_eq!(status, 201, "{body}");
        body["export"]["id"].as_str().unwrap().to_string()
    }

    fn post(uri: String) -> test::TestRequest {
        test::TestRequest::post().uri(&uri)
    }

    #[actix_web::test]
    async fn only_administrators_propose_and_a_purpose_is_required() {
        let state = state().await;
        let short = test::TestRequest::post()
            .uri("/api/research/exports")
            .set_json(serde_json::json!({ "purpose": "study" }));
        assert_eq!(call(&state, short, ADMIN_A).await.0, 400);
        let request = test::TestRequest::post()
            .uri("/api/research/exports")
            .set_json(serde_json::json!({ "purpose": PURPOSE }));
        assert_eq!(call(&state, request, DOCTOR).await.0, 403);
    }

    #[actix_web::test]
    async fn two_distinct_approvers_other_than_the_proposer_are_needed() {
        let state = state().await;
        let id = propose(&state).await;
        let approve = format!("/api/research/exports/{id}/approve");
        assert_eq!(
            call(&state, post(approve.clone()), ADMIN_A).await.0,
            403,
            "no self-approval"
        );
        let (_, once) = call(&state, post(approve.clone()), ADMIN_B).await;
        assert_eq!(once["export"]["status"], "proposed");
        assert_eq!(
            call(&state, post(approve.clone()), ADMIN_B).await.0,
            409,
            "no double approval"
        );
        let (_, twice) = call(&state, post(approve), ADMIN_C).await;
        assert_eq!(twice["export"]["status"], "approved");
    }

    /// One test owns the pseudonymisation-key environment variable, so no
    /// parallel test can observe it half-set.
    #[actix_web::test]
    async fn an_export_runs_once_after_approval_releasing_only_de_identified_consenting_patients() {
        let state = state().await;
        for n in 0..5 {
            add_patient(
                &state,
                &format!("PAT-F{n}"),
                "1980-03-15",
                "female",
                &["Hypertension", "type 2 diabetes"],
            )
            .await;
            consent(&state, &format!("PAT-F{n}")).await;
        }
        add_patient(&state, "PAT-OLD", "1935-01-01", "male", &["TB history"]).await;
        consent(&state, "PAT-OLD").await; // consents, but is alone in the 80+ male group
        add_patient(&state, "PAT-NO", "1980-03-15", "female", &["Hypertension"]).await; // never consents

        let id = propose(&state).await;
        let execute = format!("/api/research/exports/{id}/execute");
        std::env::remove_var("MEDICHAIN_RESEARCH_PSEUDONYM_KEY");
        let (status, body) = call(&state, post(execute.clone()), ADMIN_A).await;
        assert_eq!(
            (status, body["error"]["code"].as_str()),
            (503, Some("RESEARCH_EXPORT_NOT_CONFIGURED"))
        );
        std::env::set_var("MEDICHAIN_RESEARCH_PSEUDONYM_KEY", "k".repeat(32));

        assert_eq!(
            call(&state, post(execute.clone()), ADMIN_A).await.0,
            409,
            "not approved yet"
        );
        call(
            &state,
            post(format!("/api/research/exports/{id}/approve")),
            ADMIN_B,
        )
        .await;
        call(
            &state,
            post(format!("/api/research/exports/{id}/approve")),
            ADMIN_C,
        )
        .await;

        let (status, body) = call(&state, post(execute.clone()), ADMIN_A).await;
        assert_eq!(status, 200, "{body}");
        let records = body["records"].as_array().unwrap();
        assert_eq!(
            records.len(),
            5,
            "the lone 80+ record is withheld, the non-consenting patient absent"
        );
        assert_eq!(body["export"]["withheld_count"], 1);
        let text = body["records"].to_string();
        assert!(
            !text.contains("PAT-") && !text.contains("Synthetic Person") && !text.contains("1980")
        );
        assert_eq!(records[0]["age_band"], "40-49");
        assert_eq!(
            records[0]["conditions"],
            serde_json::json!(["hypertension", "type 2 diabetes"])
        );

        assert_eq!(
            call(&state, post(execute), ADMIN_A).await.0,
            409,
            "runs exactly once"
        );
        let page = Pagination::new(0, 20);
        let history = state
            .repositories
            .access_logs
            .get_by_patient("PAT-F0", page)
            .await
            .unwrap();
        assert!(history
            .items
            .iter()
            .any(|l| l.action == "research_export_included"));
        let none = state
            .repositories
            .access_logs
            .get_by_patient("PAT-NO", Pagination::new(0, 20))
            .await
            .unwrap();
        assert!(none
            .items
            .iter()
            .all(|l| l.action != "research_export_included"));
        std::env::remove_var("MEDICHAIN_RESEARCH_PSEUDONYM_KEY");
    }
}
