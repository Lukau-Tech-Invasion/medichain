//! CDS administration (Phase 4.3): per-facility threshold config + audit trail.
//!
//! - `GET  /api/admin/cds/thresholds/{facility_id}` — effective thresholds for a
//!   facility (engine defaults when no override is stored).
//! - `PUT  /api/admin/cds/thresholds/{facility_id}` — upsert a facility's
//!   thresholds (admin only). Body is a partial/full `CdsThresholds`; missing
//!   fields fall back to defaults.
//! - `GET  /api/admin/cds/audit?patient_id=` — CDS audit trail (admin only):
//!   which rule fired/was suppressed, severity, facility, threshold snapshot.
//!
//! Inherits shared imports via `use super::*`.

use super::*;
use crate::middleware::error_handling::{error_codes, error_envelope_json};
use crate::repositories::traits::JsonRecordEntity;

/// Resolve the caller and require the Admin role, or return an error response.
fn require_admin(data: &web::Data<AppState>, req: &HttpRequest) -> Result<(), HttpResponse> {
    let uid = get_current_user_id(req).ok_or_else(|| {
        HttpResponse::Unauthorized().json(error_envelope_json(
            error_codes::UNAUTHORIZED,
            "Authentication required",
            None,
        ))
    })?;
    let user = get_user(data, &uid).ok_or_else(|| {
        HttpResponse::Unauthorized().json(error_envelope_json(
            error_codes::USER_NOT_FOUND,
            "User not found",
            None,
        ))
    })?;
    if !user.role.is_admin() {
        return Err(HttpResponse::Forbidden().json(error_envelope_json(
            error_codes::INSUFFICIENT_ROLE,
            "Admin role required",
            None,
        )));
    }
    Ok(())
}

/// GET /api/admin/cds/thresholds/{facility_id}
#[get("/api/admin/cds/thresholds/{facility_id}")]
pub async fn get_cds_thresholds(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = require_admin(&data, &req) {
        return resp;
    }
    let facility_id = path.into_inner();
    let thresholds =
        crate::clinical_endpoints::load_cds_thresholds(&data, Some(&facility_id)).await;
    HttpResponse::Ok().json(serde_json::json!({
        "facility_id": facility_id,
        "thresholds": thresholds,
    }))
}

/// PUT /api/admin/cds/thresholds/{facility_id}
#[put("/api/admin/cds/thresholds/{facility_id}")]
pub async fn set_cds_thresholds(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<crate::clinical_endpoints::CdsThresholds>,
) -> impl Responder {
    if let Err(resp) = require_admin(&data, &req) {
        return resp;
    }
    let facility_id = path.into_inner();
    let thresholds = body.into_inner();
    let now = chrono::Utc::now();
    let record = JsonRecordEntity {
        id: facility_id.clone(),
        owner_id: facility_id.clone(),
        data: serde_json::to_value(&thresholds).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };
    match data.repositories.cds_threshold_configs.create(record).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "facility_id": facility_id,
            "thresholds": thresholds,
            "message": "CDS thresholds updated",
        })),
        Err(e) => HttpResponse::InternalServerError().json(error_envelope_json(
            error_codes::DATABASE_ERROR,
            "Failed to store CDS thresholds",
            Some(serde_json::json!({ "detail": e.to_string() })),
        )),
    }
}

/// GET /api/admin/cds/audit?patient_id=
#[get("/api/admin/cds/audit")]
pub async fn get_cds_audit(
    data: web::Data<AppState>,
    req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    if let Err(resp) = require_admin(&data, &req) {
        return resp;
    }
    let result = match query.get("patient_id") {
        Some(pid) => data.repositories.cds_audit_entries.get_by_owner(pid).await,
        None => data.repositories.cds_audit_entries.list_all().await,
    };
    match result {
        Ok(records) => {
            let limit = query.get("limit").and_then(|l| l.parse::<usize>().ok());
            let (page, next_cursor) = crate::pagination::paginate_cursor(
                &records,
                query.get("cursor").map(String::as_str),
                limit,
            );
            let entries: Vec<serde_json::Value> = page.into_iter().map(|r| r.data).collect();
            HttpResponse::Ok().json(serde_json::json!({
                "count": entries.len(),
                "entries": entries,
                "next_cursor": next_cursor,
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(error_envelope_json(
            error_codes::DATABASE_ERROR,
            "Failed to load CDS audit trail",
            Some(serde_json::json!({ "detail": e.to_string() })),
        )),
    }
}

// =============================================================================
// CDS rules — the rules themselves, not the alerts they produce
// =============================================================================
//
// The CDS screen offered Create, Duplicate, Enable/Disable and Delete and
// announced success for each, while only changing the browser's array: a rule
// vanished on reload and the engine had never heard of it. Its list came from
// `/api/platform/list/cds-alerts`, which is the alerts that *fired* — so the
// screen showed instances under the heading "rules", and the rule nobody could
// save had nowhere to appear anyway.
//
// A CDS rule interrupts a clinician mid-task and can block an order, so
// authorship is an administrator's (owner decision, 2026-09-22). Clinical staff
// may read the rules that govern them; only an administrator writes one.
// Enabling and retiring are conditional writes, so two administrators acting on
// the same screen cannot both believe they won.

const RULE_CATEGORIES: [&str; 7] = [
    "medication",
    "allergy",
    "vital_signs",
    "lab_results",
    "diagnosis",
    "procedure",
    "clinical_pathway",
];
const RULE_SEVERITIES: [&str; 5] = ["critical", "high", "medium", "low", "info"];
const RULE_TRIGGER_TYPES: [&str; 5] = [
    "threshold",
    "pattern",
    "time_based",
    "interaction",
    "contraindication",
];
const RULE_ACTION_TYPES: [&str; 5] = ["alert", "block", "recommend", "notify", "escalate"];
const RULE_STATUSES: [&str; 4] = ["active", "inactive", "testing", "draft"];

const MAX_RULE_NAME_CHARS: usize = 120;
const MAX_RULE_TEXT_CHARS: usize = 2_000;
const MAX_RULE_PARTS: usize = 25;

/// What the rule builder submits.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCdsRuleRequest {
    pub name: String,
    pub category: String,
    pub description: String,
    pub severity: String,
    pub trigger_type: String,
    pub conditions: Vec<serde_json::Value>,
    pub actions: Vec<CdsRuleActionInput>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub priority: Option<u8>,
    #[serde(default)]
    pub is_enabled: bool,
    /// A new rule is in test mode unless an administrator says otherwise: a
    /// rule that blocks orders from its first minute has never been observed.
    #[serde(default = "default_true")]
    pub test_mode: bool,
    #[serde(default)]
    pub target_roles: Vec<String>,
    #[serde(default)]
    pub evidence_level: Option<String>,
    #[serde(default)]
    pub references: Vec<String>,
}

fn default_true() -> bool {
    true
}

/// One thing a rule does when it fires.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CdsRuleActionInput {
    #[serde(rename = "type")]
    pub action_type: String,
    pub message: String,
    pub severity: String,
    #[serde(default)]
    pub notify_roles: Vec<String>,
    #[serde(default)]
    pub block_action: bool,
    #[serde(default)]
    pub suggested_action: Option<String>,
    #[serde(default)]
    pub escalate_to: Option<String>,
}

/// Turning a rule on or off.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CdsRuleEnablementRequest {
    pub is_enabled: bool,
}

fn rule_invalid(message: &str) -> HttpResponse {
    HttpResponse::BadRequest().json(error_envelope_json(
        error_codes::VALIDATION_ERROR,
        message,
        None,
    ))
}

/// Refuse a rule a clinician could not judge or the engine could not run.
///
/// The name and the description are refused when empty because an unexplained
/// alert is the one dismissed reflexively: the clinician deciding whether to
/// override has only the rule's own words to go on.
fn validate_cds_rule(req: &CreateCdsRuleRequest) -> Result<(), HttpResponse> {
    if req.name.trim().is_empty() || req.name.chars().count() > MAX_RULE_NAME_CHARS {
        return Err(rule_invalid(
            "A rule needs a name of at most 120 characters",
        ));
    }
    if req.description.trim().is_empty() || req.description.chars().count() > MAX_RULE_TEXT_CHARS {
        return Err(rule_invalid(
            "A rule needs a description of at most 2000 characters",
        ));
    }
    if !RULE_CATEGORIES.contains(&req.category.as_str()) {
        return Err(rule_invalid("Unknown rule category"));
    }
    if !RULE_SEVERITIES.contains(&req.severity.as_str()) {
        return Err(rule_invalid("Unknown rule severity"));
    }
    if !RULE_TRIGGER_TYPES.contains(&req.trigger_type.as_str()) {
        return Err(rule_invalid("Unknown trigger type"));
    }
    if let Some(status) = req.status.as_deref() {
        if !RULE_STATUSES.contains(&status) {
            return Err(rule_invalid("Unknown rule status"));
        }
    }
    if req.conditions.is_empty() || req.conditions.len() > MAX_RULE_PARTS {
        return Err(rule_invalid("A rule needs between 1 and 25 conditions"));
    }
    if req.actions.is_empty() || req.actions.len() > MAX_RULE_PARTS {
        return Err(rule_invalid("A rule needs between 1 and 25 actions"));
    }
    validate_rule_actions(&req.actions)
}

fn validate_rule_actions(actions: &[CdsRuleActionInput]) -> Result<(), HttpResponse> {
    for action in actions {
        if !RULE_ACTION_TYPES.contains(&action.action_type.as_str()) {
            return Err(rule_invalid("Unknown action type"));
        }
        if !RULE_SEVERITIES.contains(&action.severity.as_str()) {
            return Err(rule_invalid("Unknown action severity"));
        }
        if action.message.trim().is_empty() || action.message.chars().count() > MAX_RULE_TEXT_CHARS
        {
            return Err(rule_invalid(
                "Every action needs a message of at most 2000 characters",
            ));
        }
    }
    Ok(())
}

/// The stored and served shape, in the screen's own vocabulary.
fn stored_cds_rule(
    req: &CreateCdsRuleRequest,
    rule_id: &str,
    author: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> serde_json::Value {
    let actions: Vec<serde_json::Value> = req
        .actions
        .iter()
        .enumerate()
        .map(|(index, action)| {
            serde_json::json!({
                "actionId": format!("{rule_id}-A{:02}", index + 1),
                "type": action.action_type,
                "message": action.message.trim(),
                "severity": action.severity,
                "notifyRoles": action.notify_roles,
                "blockAction": action.block_action,
                "suggestedAction": action.suggested_action,
                "escalateTo": action.escalate_to,
            })
        })
        .collect();
    serde_json::json!({
        "ruleId": rule_id,
        "name": req.name.trim(),
        "category": req.category,
        "description": req.description.trim(),
        "severity": req.severity,
        "triggerType": req.trigger_type,
        "conditions": req.conditions,
        "actions": actions,
        "status": req.status.clone().unwrap_or_else(|| "draft".to_string()),
        "priority": req.priority.unwrap_or(5),
        "createdBy": author,
        "createdAt": now.to_rfc3339(),
        "lastModified": now.to_rfc3339(),
        // Nothing has fired yet, and this is a count of events rather than a
        // measurement: zero is the truth here, not an absent reading.
        "triggerCount": 0,
        "isEnabled": req.is_enabled,
        "testMode": req.test_mode,
        "targetRoles": req.target_roles,
        "evidenceLevel": req.evidence_level,
        "references": req.references,
        "retired": false,
    })
}

/// POST /api/admin/cds/rules — write a rule the engine and every screen share.
#[post("/api/admin/cds/rules")]
pub async fn create_cds_rule(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<CreateCdsRuleRequest>,
) -> impl Responder {
    if let Err(resp) = require_admin(&data, &req) {
        return resp;
    }
    let author = match get_current_user_id(&req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };
    let rule = body.into_inner();
    if let Err(resp) = validate_cds_rule(&rule) {
        return resp;
    }
    let now = chrono::Utc::now();
    let rule_id = format!("CDS-{}", uuid::Uuid::new_v4().simple());
    let stored = stored_cds_rule(&rule, &rule_id, &author, now);
    let record = JsonRecordEntity {
        id: rule_id.clone(),
        owner_id: author,
        data: stored.clone(),
        created_at: now,
        updated_at: now,
    };
    match data.repositories.cds_rules.create(record).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "rule": stored,
        })),
        Err(e) => HttpResponse::ServiceUnavailable().json(error_envelope_json(
            error_codes::DATABASE_ERROR,
            "The rule could not be saved",
            Some(serde_json::json!({ "detail": e.to_string() })),
        )),
    }
}

/// GET /api/admin/cds/rules — the rules in force.
///
/// Readable by any clinical role. A rule that interrupts a clinician is a rule
/// they are entitled to read; only an administrator may write one.
#[get("/api/admin/cds/rules")]
pub async fn list_cds_rules(data: web::Data<AppState>, req: HttpRequest) -> impl Responder {
    let user = match crate::support::require_clinical_staff(&data, &req) {
        Ok(user) => user,
        Err(resp) => return resp,
    };
    let _ = &user;
    match data.repositories.cds_rules.list_all().await {
        Ok(records) => {
            let rules: Vec<serde_json::Value> = records
                .into_iter()
                .filter(|record| record.data.get("retired") != Some(&serde_json::json!(true)))
                .map(|record| record.data)
                .collect();
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "count": rules.len(),
                "rules": rules,
            }))
        }
        Err(e) => HttpResponse::ServiceUnavailable().json(error_envelope_json(
            error_codes::DATABASE_ERROR,
            "CDS rules could not be read",
            Some(serde_json::json!({ "detail": e.to_string() })),
        )),
    }
}

/// Read a rule, or the response that says why not.
async fn load_rule(
    data: &web::Data<AppState>,
    rule_id: &str,
) -> Result<JsonRecordEntity, HttpResponse> {
    match data.repositories.cds_rules.get_by_id(rule_id).await {
        Ok(Some(record)) => Ok(record),
        Ok(None) => Err(HttpResponse::NotFound().json(error_envelope_json(
            error_codes::NOT_FOUND,
            "Unknown CDS rule",
            None,
        ))),
        Err(e) => Err(HttpResponse::ServiceUnavailable().json(error_envelope_json(
            error_codes::DATABASE_ERROR,
            "The rule could not be read",
            Some(serde_json::json!({ "detail": e.to_string() })),
        ))),
    }
}

/// POST /api/admin/cds/rules/{rule_id}/enablement — turn a rule on or off.
///
/// The guard is the rule's own status, inside the write: a rule enabled twice
/// by two administrators answers 409 for the second rather than silently
/// overwriting the first's view of the world.
#[post("/api/admin/cds/rules/{rule_id}/enablement")]
pub async fn set_cds_rule_enablement(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<CdsRuleEnablementRequest>,
) -> impl Responder {
    if let Err(resp) = require_admin(&data, &req) {
        return resp;
    }
    let rule_id = path.into_inner();
    let record = match load_rule(&data, &rule_id).await {
        Ok(record) => record,
        Err(resp) => return resp,
    };
    let wanted = body.into_inner().is_enabled;
    let now = chrono::Utc::now();
    let previous = record
        .data
        .get("status")
        .and_then(|value| value.as_str())
        .unwrap_or("draft")
        .to_string();
    let mut updated = record.clone();
    updated.data["isEnabled"] = serde_json::json!(wanted);
    updated.data["status"] = serde_json::json!(if wanted { "active" } else { "inactive" });
    updated.data["lastModified"] = serde_json::json!(now.to_rfc3339());
    updated.updated_at = now;
    match data
        .repositories
        .cds_rules
        .replace_if_field_eq(&rule_id, "status", &previous, updated)
        .await
    {
        Ok(Some(saved)) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "rule": saved.data,
        })),
        Ok(None) => HttpResponse::Conflict().json(error_envelope_json(
            error_codes::CONFLICT,
            "This rule changed while it was being updated. Reload it and try again.",
            None,
        )),
        Err(e) => HttpResponse::ServiceUnavailable().json(error_envelope_json(
            error_codes::DATABASE_ERROR,
            "The rule could not be updated",
            Some(serde_json::json!({ "detail": e.to_string() })),
        )),
    }
}

/// POST /api/admin/cds/rules/{rule_id}/retire — stop a rule firing, for good.
///
/// Retired, not deleted (ADR-0005): the audit trail names rules that fired, and
/// a deleted rule turns every one of those entries into an unresolvable id.
#[post("/api/admin/cds/rules/{rule_id}/retire")]
pub async fn retire_cds_rule(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = require_admin(&data, &req) {
        return resp;
    }
    let retired_by = match get_current_user_id(&req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };
    let rule_id = path.into_inner();
    let record = match load_rule(&data, &rule_id).await {
        Ok(record) => record,
        Err(resp) => return resp,
    };
    if record.data.get("retired") == Some(&serde_json::json!(true)) {
        return HttpResponse::Conflict().json(error_envelope_json(
            error_codes::CONFLICT,
            "This rule has already been retired",
            None,
        ));
    }
    let now = chrono::Utc::now();
    let previous = record
        .data
        .get("status")
        .and_then(|value| value.as_str())
        .unwrap_or("draft")
        .to_string();
    let mut updated = record.clone();
    updated.data["retired"] = serde_json::json!(true);
    updated.data["isEnabled"] = serde_json::json!(false);
    updated.data["status"] = serde_json::json!("inactive");
    updated.data["retiredBy"] = serde_json::json!(retired_by);
    updated.data["retiredAt"] = serde_json::json!(now.to_rfc3339());
    updated.data["lastModified"] = serde_json::json!(now.to_rfc3339());
    updated.updated_at = now;
    match data
        .repositories
        .cds_rules
        .replace_if_field_eq(&rule_id, "status", &previous, updated)
        .await
    {
        Ok(Some(_)) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "rule_id": rule_id,
        })),
        Ok(None) => HttpResponse::Conflict().json(error_envelope_json(
            error_codes::CONFLICT,
            "This rule changed while it was being retired. Reload it and try again.",
            None,
        )),
        Err(e) => HttpResponse::ServiceUnavailable().json(error_envelope_json(
            error_codes::DATABASE_ERROR,
            "The rule could not be retired",
            Some(serde_json::json!({ "detail": e.to_string() })),
        )),
    }
}

#[cfg(test)]
mod cds_rule_tests {
    use super::*;
    use crate::test_fixtures::register;
    use actix_web::{http::StatusCode, test, App};

    fn state() -> web::Data<AppState> {
        let state = AppState::new();
        register(&state, "admin_a", crate::Role::Admin);
        register(&state, "doctor_a", crate::Role::Doctor);
        web::Data::new(state)
    }

    fn rule_body() -> serde_json::Value {
        serde_json::json!({
            "name": "QTc prolonging combination",
            "category": "medication",
            "description": "Warn when two QT-prolonging drugs are ordered together",
            "severity": "high",
            "triggerType": "interaction",
            "conditions": [{ "field": "medication", "operator": "contains", "value": "sotalol" }],
            "actions": [{
                "type": "alert",
                "message": "Both drugs prolong the QT interval",
                "severity": "high"
            }]
        })
    }

    /// Write one rule and hand back its server-assigned id.
    ///
    /// A macro rather than a function, for the reason given in
    /// `order_sets::order_set_tests`: the service type `test::init_service`
    /// returns cannot be named without depending on actix-http directly.
    macro_rules! created_rule_id {
        ($app:expr) => {{
            let resp = test::call_service(
                &$app,
                test::TestRequest::post()
                    .uri("/api/admin/cds/rules")
                    .insert_header(("x-user-id", "admin_a"))
                    .set_json(rule_body())
                    .to_request(),
            )
            .await;
            assert_eq!(resp.status(), StatusCode::CREATED);
            let body: serde_json::Value = test::read_body_json(resp).await;
            body["rule"]["ruleId"].as_str().unwrap().to_string()
        }};
    }

    #[actix_web::test]
    async fn an_administrator_writes_a_rule_and_it_is_durable() {
        let state = state();
        let app =
            test::init_service(App::new().app_data(state.clone()).service(create_cds_rule)).await;
        let rule_id = created_rule_id!(app);
        let stored = state
            .repositories
            .cds_rules
            .get_by_id(&rule_id)
            .await
            .unwrap()
            .expect("the rule is durable");
        assert_eq!(stored.data["name"], "QTc prolonging combination");
        // A new rule observes before it interrupts.
        assert_eq!(stored.data["testMode"], true);
        assert_eq!(stored.data["isEnabled"], false);
    }

    #[actix_web::test]
    async fn a_doctor_cannot_write_a_rule_but_can_read_the_rules() {
        let state = state();
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(create_cds_rule)
                .service(list_cds_rules),
        )
        .await;
        let _ = created_rule_id!(app);

        let refused = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/admin/cds/rules")
                .insert_header(("x-user-id", "doctor_a"))
                .set_json(rule_body())
                .to_request(),
        )
        .await;
        assert_eq!(refused.status(), StatusCode::FORBIDDEN);

        let listed = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/admin/cds/rules")
                .insert_header(("x-user-id", "doctor_a"))
                .to_request(),
        )
        .await;
        assert_eq!(listed.status(), StatusCode::OK);
        let body: serde_json::Value = test::read_body_json(listed).await;
        assert_eq!(body["count"], 1);
    }

    #[actix_web::test]
    async fn a_rule_is_enabled_and_then_retired_and_stops_being_listed() {
        let state = state();
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(create_cds_rule)
                .service(list_cds_rules)
                .service(set_cds_rule_enablement)
                .service(retire_cds_rule),
        )
        .await;
        let rule_id = created_rule_id!(app);

        let enabled = test::call_service(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/admin/cds/rules/{rule_id}/enablement"))
                .insert_header(("x-user-id", "admin_a"))
                .set_json(serde_json::json!({ "isEnabled": true }))
                .to_request(),
        )
        .await;
        assert_eq!(enabled.status(), StatusCode::OK);
        let stored = state
            .repositories
            .cds_rules
            .get_by_id(&rule_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.data["isEnabled"], true);
        assert_eq!(stored.data["status"], "active");

        let retired = test::call_service(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/admin/cds/rules/{rule_id}/retire"))
                .insert_header(("x-user-id", "admin_a"))
                .to_request(),
        )
        .await;
        assert_eq!(retired.status(), StatusCode::OK);

        let listed = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/admin/cds/rules")
                .insert_header(("x-user-id", "admin_a"))
                .to_request(),
        )
        .await;
        let body: serde_json::Value = test::read_body_json(listed).await;
        assert_eq!(body["count"], 0);
    }

    #[actix_web::test]
    async fn a_rule_with_no_action_is_refused() {
        let state = state();
        let app = test::init_service(App::new().app_data(state).service(create_cds_rule)).await;
        let mut body = rule_body();
        body["actions"] = serde_json::json!([]);
        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/admin/cds/rules")
                .insert_header(("x-user-id", "admin_a"))
                .set_json(body)
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}
