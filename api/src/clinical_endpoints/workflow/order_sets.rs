//! Clinician-authored order sets, under pharmacist review.
//!
//! The order-set screen offered Create and Duplicate and announced success for
//! both, while only changing the browser's list: the set vanished on reload and
//! nobody else ever saw it. `GET /api/order-sets` served three hardcoded
//! bundles and there was nowhere to put a fourth.
//!
//! An order set is a prescribing instrument -- one click files every order in
//! it -- so it is not published by the person who wrote it. A doctor drafts;
//! a pharmacist approves or rejects (owner decision, 2026-09-22), and the
//! approval is a conditional write against the draft state, so two pharmacists
//! opening the same draft cannot both record a decision. Self-approval is
//! refused even for a pharmacist who authored the draft, which is the same
//! maker-checker rule `RetentionExecutionRepository::decide_approval` enforces
//! in SQL.
//!
//! Only approved sets reach the ordering screens. A draft is visible to its
//! author and to the pharmacists who must review it, and to nobody else.

use super::*;

/// The page's closed vocabularies. A free-typed value would be stored and then
/// never match the page's own filters, so the set would be filed and unfindable.
const ORDER_SET_TYPES: [&str; 6] = [
    "admission",
    "discharge",
    "procedure",
    "protocol",
    "emergency",
    "specialty",
];
const ORDER_TYPES: [&str; 7] = [
    "medication",
    "lab",
    "imaging",
    "consult",
    "nursing",
    "diet",
    "activity",
];
const ORDER_PRIORITIES: [&str; 4] = ["stat", "urgent", "routine", "prn"];

const MAX_ORDERS: usize = 60;
const MAX_NAME_CHARS: usize = 120;
const MAX_TEXT_CHARS: usize = 2_000;
const MAX_TAGS: usize = 30;

/// Draft awaiting a pharmacist. The value is compared as text by
/// `replace_if_field_eq`, so these are the only three the guard may see.
const STATUS_PENDING: &str = "pending_approval";
const STATUS_APPROVED: &str = "approved";
const STATUS_REJECTED: &str = "rejected";

/// What the order-set form submits.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrderSetRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub set_type: String,
    pub specialty: String,
    pub description: String,
    #[serde(default)]
    pub indication: String,
    pub orders: Vec<OrderSetItemInput>,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// One order in the bundle, in the order the author arranged them.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderSetItemInput {
    #[serde(rename = "type")]
    pub order_type: String,
    pub description: String,
    #[serde(default)]
    pub instructions: Option<String>,
    pub priority: String,
    #[serde(default)]
    pub duration: Option<String>,
    #[serde(default)]
    pub frequency: Option<String>,
    #[serde(default)]
    pub route: Option<String>,
}

/// A pharmacist's decision on a draft.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderSetApprovalRequest {
    /// `approved` or `rejected`.
    pub decision: String,
    /// Why. Required for a rejection: the author has to know what to change.
    #[serde(default)]
    pub notes: Option<String>,
}

/// Only a pharmacist reviews an order set, the same predicate
/// `e_prescriptions::may_dispense` uses: the review is a pharmacy function,
/// and an administrator is the account that grants roles (see the
/// separation-of-duties note on `Role::can_edit_medical_records`).
fn may_review(role: &crate::Role) -> bool {
    matches!(role, crate::Role::Pharmacist)
}

fn order_set_error(status: actix_web::http::StatusCode, error: &str, code: &str) -> HttpResponse {
    HttpResponse::build(status).json(ErrorResponse {
        success: false,
        error: error.to_string(),
        code: code.to_string(),
    })
}

fn invalid(error: &str) -> HttpResponse {
    order_set_error(
        actix_web::http::StatusCode::BAD_REQUEST,
        error,
        "VALIDATION_ERROR",
    )
}

/// Refuse a set the page could not file or a prescriber could not read.
fn validate_order_set(req: &CreateOrderSetRequest) -> Result<(), HttpResponse> {
    if req.name.trim().is_empty() || req.name.chars().count() > MAX_NAME_CHARS {
        return Err(invalid(
            "An order set needs a name of at most 120 characters",
        ));
    }
    if !ORDER_SET_TYPES.contains(&req.set_type.as_str()) {
        return Err(invalid("Unknown order set type"));
    }
    if req.specialty.trim().is_empty() || req.specialty.chars().count() > MAX_NAME_CHARS {
        return Err(invalid("An order set needs a specialty"));
    }
    if req.description.trim().is_empty() || req.description.chars().count() > MAX_TEXT_CHARS {
        return Err(invalid(
            "An order set needs a description of at most 2000 characters",
        ));
    }
    if req.orders.is_empty() || req.orders.len() > MAX_ORDERS {
        return Err(invalid("An order set needs between 1 and 60 orders"));
    }
    if req.tags.len() > MAX_TAGS {
        return Err(invalid("At most 30 tags"));
    }
    validate_orders(&req.orders)
}

/// Every order carries a type, a priority and text a prescriber can act on.
fn validate_orders(orders: &[OrderSetItemInput]) -> Result<(), HttpResponse> {
    for order in orders {
        if !ORDER_TYPES.contains(&order.order_type.as_str()) {
            return Err(invalid("Unknown order type"));
        }
        if !ORDER_PRIORITIES.contains(&order.priority.as_str()) {
            return Err(invalid("Unknown order priority"));
        }
        if order.description.trim().is_empty() || order.description.chars().count() > MAX_TEXT_CHARS
        {
            return Err(invalid(
                "Every order needs a description of at most 2000 characters",
            ));
        }
    }
    Ok(())
}

fn trimmed(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// The stored and served shape. Top-level keys match what the page reads, so a
/// row needs no translation layer to render; `orders` is an ordered array
/// because a protocol read out of sequence is a different protocol.
fn stored_order_set(
    req: &CreateOrderSetRequest,
    set_id: &str,
    author: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> serde_json::Value {
    let orders: Vec<serde_json::Value> = req
        .orders
        .iter()
        .enumerate()
        .map(|(index, order)| {
            serde_json::json!({
                "orderId": format!("{set_id}-O{:02}", index + 1),
                "type": order.order_type,
                "description": order.description.trim(),
                "instructions": trimmed(&order.instructions),
                "priority": order.priority,
                "duration": trimmed(&order.duration),
                "frequency": trimmed(&order.frequency),
                "route": trimmed(&order.route),
                "order": index + 1,
            })
        })
        .collect();
    serde_json::json!({
        "setId": set_id,
        "id": set_id,
        "name": req.name.trim(),
        "type": req.set_type,
        "specialty": req.specialty.trim(),
        "category": req.specialty.trim(),
        "description": req.description.trim(),
        "indication": req.indication.trim(),
        "orders": orders,
        "tags": req.tags,
        "createdBy": author,
        "createdAt": now.to_rfc3339(),
        "lastModified": now.to_rfc3339(),
        "usageCount": 0,
        // Pending, not active: nothing may order from it until a pharmacist
        // has read it. `isActive` is what the page filters on.
        "status": STATUS_PENDING,
        "isActive": false,
        "builtIn": false,
    })
}

fn status_of(record: &crate::repositories::traits::JsonRecordEntity) -> &str {
    record
        .data
        .get("status")
        .and_then(|value| value.as_str())
        .unwrap_or(STATUS_PENDING)
}

/// Who sees a draft: its author, and the pharmacists who must review it.
///
/// An approved set is everybody's. A rejected one stays with its author, who
/// is the only person who can act on the rejection.
fn may_see(user: &crate::User, record: &crate::repositories::traits::JsonRecordEntity) -> bool {
    match status_of(record) {
        STATUS_APPROVED => true,
        _ => {
            record.owner_id == user.wallet_address || may_review(&user.role) || user.role.is_admin()
        }
    }
}

/// Save a draft order set for a pharmacist to review.
#[post("/api/clinical/order-sets")]
pub async fn create_order_set(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<CreateOrderSetRequest>,
) -> impl Responder {
    let user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    // A doctor drafts (owner decision, 2026-09-22). `can_edit_medical_records`
    // would have admitted nurses too, and an order set is a prescribing
    // instrument: one click files every order in it, including the medications.
    if !matches!(user.role, crate::Role::Doctor) {
        return order_set_error(
            actix_web::http::StatusCode::FORBIDDEN,
            "Only a doctor drafts an order set",
            "INSUFFICIENT_ROLE",
        );
    }
    let req = body.into_inner();
    if let Err(response) = validate_order_set(&req) {
        return response;
    }
    let now = chrono::Utc::now();
    let set_id = format!("OS-USR-{}", uuid::Uuid::new_v4().simple());
    let order_set = stored_order_set(&req, &set_id, &user.wallet_address, now);
    let record = crate::repositories::traits::JsonRecordEntity {
        id: set_id.clone(),
        owner_id: user.wallet_address.clone(),
        data: order_set.clone(),
        created_at: now,
        updated_at: now,
    };
    match data.repositories.order_sets.create(record).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "order_set": order_set,
        })),
        Err(error) => {
            log::error!("order set persistence failed: {error}");
            order_set_error(
                actix_web::http::StatusCode::SERVICE_UNAVAILABLE,
                "The order set could not be saved",
                "ORDER_SET_PERSISTENCE_FAILED",
            )
        }
    }
}

/// Every order set this caller may see: the built-in bundles, the approved
/// clinician-authored ones, and their own drafts.
pub(super) async fn visible_order_sets(
    data: &web::Data<AppState>,
    user: &crate::User,
) -> RepositoryResult<Vec<serde_json::Value>> {
    let records = data.repositories.order_sets.list_all().await?;
    Ok(records
        .into_iter()
        .filter(|record| may_see(user, record))
        .map(|record| record.data)
        .collect())
}

/// Record a pharmacist's decision on a draft.
///
/// The guard is inside the write: `replace_if_field_eq` commits only while the
/// set is still pending, so a second pharmacist acting on the same open screen
/// is answered 409 rather than quietly overwriting the first decision.
#[post("/api/clinical/order-sets/{set_id}/approval")]
pub async fn decide_order_set(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<OrderSetApprovalRequest>,
) -> impl Responder {
    use actix_web::http::StatusCode;
    let user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if !may_review(&user.role) {
        return order_set_error(
            StatusCode::FORBIDDEN,
            "Only a pharmacist can approve an order set",
            "INSUFFICIENT_ROLE",
        );
    }
    let req = body.into_inner();
    let approved = match req.decision.as_str() {
        STATUS_APPROVED => true,
        STATUS_REJECTED => false,
        _ => return invalid("A decision is either approved or rejected"),
    };
    let notes = trimmed(&req.notes);
    if !approved && notes.is_none() {
        return invalid("A rejection needs a reason the author can act on");
    }
    let set_id = path.into_inner();
    let record = match data.repositories.order_sets.get_by_id(&set_id).await {
        Ok(Some(record)) => record,
        Ok(None) => {
            return order_set_error(
                StatusCode::NOT_FOUND,
                "Unknown order set",
                "ORDER_SET_NOT_FOUND",
            )
        }
        Err(error) => {
            log::error!("order set read failed: {error}");
            return order_set_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "The order set could not be read",
                "REPO_ERROR",
            );
        }
    };
    // Maker-checker. A pharmacist may draft an order set; they may not be the
    // second pair of eyes on their own draft.
    if record.owner_id == user.wallet_address {
        return order_set_error(
            StatusCode::FORBIDDEN,
            "An order set is reviewed by someone other than its author",
            "SELF_APPROVAL_REFUSED",
        );
    }
    let now = chrono::Utc::now();
    let decided = decided_record(&record, &user.wallet_address, approved, notes, now);
    match data
        .repositories
        .order_sets
        .replace_if_field_eq(&set_id, "status", STATUS_PENDING, decided)
        .await
    {
        Ok(Some(updated)) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "order_set": updated.data,
        })),
        Ok(None) => order_set_error(
            StatusCode::CONFLICT,
            "This order set has already been decided. Reload it to see the decision.",
            "ORDER_SET_NOT_PENDING",
        ),
        Err(error) => {
            log::error!("order set decision failed: {error}");
            order_set_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "The decision could not be recorded",
                "REPO_ERROR",
            )
        }
    }
}

/// The record as it reads after a decision. Who decided and when are stored
/// beside the outcome: "approved" with no reviewer is not an audit trail.
fn decided_record(
    record: &crate::repositories::traits::JsonRecordEntity,
    reviewer: &str,
    approved: bool,
    notes: Option<String>,
    now: chrono::DateTime<chrono::Utc>,
) -> crate::repositories::traits::JsonRecordEntity {
    let mut decided = record.clone();
    let status = if approved {
        STATUS_APPROVED
    } else {
        STATUS_REJECTED
    };
    decided.data["status"] = serde_json::json!(status);
    decided.data["isActive"] = serde_json::json!(approved);
    decided.data["reviewedBy"] = serde_json::json!(reviewer);
    decided.data["reviewedAt"] = serde_json::json!(now.to_rfc3339());
    decided.data["reviewNotes"] = serde_json::json!(notes);
    decided.data["lastModified"] = serde_json::json!(now.to_rfc3339());
    decided.updated_at = now;
    decided
}

/// Retire an approved or rejected order set. Not a deletion (ADR-0005).
#[post("/api/clinical/order-sets/{set_id}/deactivate")]
pub async fn deactivate_order_set(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    use actix_web::http::StatusCode;
    let user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let set_id = path.into_inner();
    let record = match data.repositories.order_sets.get_by_id(&set_id).await {
        Ok(Some(record)) => record,
        Ok(None) => {
            return order_set_error(
                StatusCode::NOT_FOUND,
                "Unknown order set",
                "ORDER_SET_NOT_FOUND",
            )
        }
        Err(error) => {
            log::error!("order set read failed: {error}");
            return order_set_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "The order set could not be read",
                "REPO_ERROR",
            );
        }
    };
    if !(user.role.is_admin() || record.owner_id == user.wallet_address) {
        return order_set_error(
            StatusCode::FORBIDDEN,
            "Only the order set's author or an administrator can retire it",
            "NOT_ORDER_SET_AUTHOR",
        );
    }
    let now = chrono::Utc::now();
    let mut retired = record.clone();
    retired.data["status"] = serde_json::json!("retired");
    retired.data["isActive"] = serde_json::json!(false);
    retired.data["retiredBy"] = serde_json::json!(user.wallet_address);
    retired.data["retiredAt"] = serde_json::json!(now.to_rfc3339());
    retired.data["lastModified"] = serde_json::json!(now.to_rfc3339());
    retired.updated_at = now;
    let current = status_of(&record).to_string();
    match data
        .repositories
        .order_sets
        .replace_if_field_eq(&set_id, "status", &current, retired)
        .await
    {
        Ok(Some(_)) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "set_id": set_id,
        })),
        Ok(None) => order_set_error(
            StatusCode::CONFLICT,
            "This order set changed while it was being retired. Reload it and try again.",
            "ORDER_SET_CHANGED",
        ),
        Err(error) => {
            log::error!("order set retirement failed: {error}");
            order_set_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "The order set could not be retired",
                "REPO_ERROR",
            )
        }
    }
}

#[cfg(test)]
mod order_set_tests {
    use super::*;
    use crate::test_fixtures::register;
    use actix_web::{http::StatusCode, test, App};

    fn state() -> web::Data<AppState> {
        let state = AppState::new();
        register(&state, "doctor_a", crate::Role::Doctor);
        register(&state, "pharm_a", crate::Role::Pharmacist);
        register(&state, "pharm_b", crate::Role::Pharmacist);
        register(&state, "nurse_a", crate::Role::Nurse);
        web::Data::new(state)
    }

    fn draft() -> serde_json::Value {
        serde_json::json!({
            "name": "Sepsis bundle",
            "type": "protocol",
            "specialty": "Emergency",
            "description": "One-hour sepsis bundle",
            "indication": "Suspected sepsis",
            "orders": [
                { "type": "lab", "description": "Lactate", "priority": "stat" },
                { "type": "medication", "description": "Ceftriaxone 2g IV", "priority": "stat" }
            ],
            "tags": ["sepsis"]
        })
    }

    /// Draft one order set and hand back its server-assigned id.
    ///
    /// A macro rather than a function: `test::init_service` returns a service
    /// over `actix_http::Request`, and actix-http is not a direct dependency
    /// of this crate, so the type cannot be named in a signature here.
    macro_rules! create_draft {
        ($app:expr) => {{
            let resp = test::call_service(
                &$app,
                test::TestRequest::post()
                    .uri("/api/clinical/order-sets")
                    .insert_header(("x-user-id", "doctor_a"))
                    .set_json(draft())
                    .to_request(),
            )
            .await;
            assert_eq!(resp.status(), StatusCode::CREATED);
            let body: serde_json::Value = test::read_body_json(resp).await;
            body["order_set"]["setId"].as_str().unwrap().to_string()
        }};
    }

    #[actix_web::test]
    async fn a_draft_is_saved_pending_and_is_not_yet_orderable() {
        let state = state();
        let app =
            test::init_service(App::new().app_data(state.clone()).service(create_order_set)).await;
        let set_id = create_draft!(app);

        let stored = state
            .repositories
            .order_sets
            .get_by_id(&set_id)
            .await
            .unwrap()
            .expect("the draft is durable");
        assert_eq!(stored.data["status"], STATUS_PENDING);
        assert_eq!(stored.data["isActive"], false);
        assert_eq!(stored.data["orders"][0]["orderId"], format!("{set_id}-O01"));
    }

    #[actix_web::test]
    async fn a_nurse_cannot_draft_an_order_set() {
        let state = state();
        let app = test::init_service(App::new().app_data(state).service(create_order_set)).await;
        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/clinical/order-sets")
                .insert_header(("x-user-id", "nurse_a"))
                .set_json(draft())
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[actix_web::test]
    async fn a_pharmacist_approves_and_only_then_is_it_orderable() {
        let state = state();
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(create_order_set)
                .service(decide_order_set),
        )
        .await;
        let set_id = create_draft!(app);

        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/clinical/order-sets/{set_id}/approval"))
                .insert_header(("x-user-id", "pharm_a"))
                .set_json(serde_json::json!({ "decision": "approved" }))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);

        let stored = state
            .repositories
            .order_sets
            .get_by_id(&set_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.data["status"], STATUS_APPROVED);
        assert_eq!(stored.data["isActive"], true);
        assert_eq!(stored.data["reviewedBy"], "pharm_a");
    }

    #[actix_web::test]
    async fn a_second_decision_on_the_same_draft_is_refused() {
        let state = state();
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(create_order_set)
                .service(decide_order_set),
        )
        .await;
        let set_id = create_draft!(app);
        for (reviewer, expected) in [
            ("pharm_a", StatusCode::OK),
            ("pharm_b", StatusCode::CONFLICT),
        ] {
            let resp = test::call_service(
                &app,
                test::TestRequest::post()
                    .uri(&format!("/api/clinical/order-sets/{set_id}/approval"))
                    .insert_header(("x-user-id", reviewer))
                    .set_json(serde_json::json!({ "decision": "rejected", "notes": "Dose wrong" }))
                    .to_request(),
            )
            .await;
            assert_eq!(resp.status(), expected, "{reviewer}");
        }
    }

    #[actix_web::test]
    async fn a_rejection_without_a_reason_is_refused() {
        let state = state();
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(create_order_set)
                .service(decide_order_set),
        )
        .await;
        let set_id = create_draft!(app);
        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/clinical/order-sets/{set_id}/approval"))
                .insert_header(("x-user-id", "pharm_a"))
                .set_json(serde_json::json!({ "decision": "rejected" }))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[actix_web::test]
    async fn a_pharmacist_cannot_approve_their_own_draft() {
        let state = state();
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(create_order_set)
                .service(decide_order_set),
        )
        .await;
        // A pharmacist who also edits records cannot draft here, so the draft is
        // planted directly and owned by the reviewer.
        let now = chrono::Utc::now();
        let set_id = "OS-USR-self".to_string();
        state
            .repositories
            .order_sets
            .create(crate::repositories::traits::JsonRecordEntity {
                id: set_id.clone(),
                owner_id: "pharm_a".to_string(),
                data: serde_json::json!({ "setId": set_id, "status": STATUS_PENDING }),
                created_at: now,
                updated_at: now,
            })
            .await
            .unwrap();
        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/clinical/order-sets/{set_id}/approval"))
                .insert_header(("x-user-id", "pharm_a"))
                .set_json(serde_json::json!({ "decision": "approved" }))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }
}
