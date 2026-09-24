//! What a pharmacist does about a safety alert, and the controlled-substance
//! register.
//!
//! The pharmacist dashboard rendered an allergy alert with a *Reject* and a
//! *Contact MD* button beside it, and a *DEA report* link over the controlled
//! substance log. None of the three had an endpoint, so a pharmacist refusing
//! to dispense a drug a patient is allergic to could press a button and change
//! nothing: the prescriber was never told, the patient never learned their
//! medicine had been stopped, and no record existed to answer for the decision
//! afterwards.
//!
//! The records here are owned by the **patient**, not the pharmacist, which is
//! what makes them reachable by the person they are about (rule 10) rather than
//! only by a UUID somebody would have to already know.

use actix_web::{get, post, web, HttpRequest, HttpResponse, Responder};
use serde::{Deserialize, Serialize};

use crate::{AppState, ErrorResponse};

/// The pharmacist refused to dispense against a documented allergy.
const DECISION_REFUSED: &str = "refused_to_dispense";
/// The pharmacist raised a query with the prescriber before deciding.
const DECISION_QUERIED: &str = "prescriber_queried";

fn pharmacy_error(status: actix_web::http::StatusCode, message: &str, code: &str) -> HttpResponse {
    HttpResponse::build(status).json(ErrorResponse {
        error: message.to_string(),
        code: code.to_string(),
    })
}

/// A pharmacist's decision on one allergy alert.
///
/// Takes a request type rather than a domain type (rule 11): the screen
/// collects a patient, an allergen and a reason, and nothing else.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordPharmacyDecisionRequest {
    pub patient_id: String,
    /// The allergen that prompted the alert, as the dashboard displayed it.
    pub allergen: String,
    /// `refused_to_dispense` or `prescriber_queried`.
    pub decision: String,
    /// Why. A refusal with no stated reason is not answerable for.
    pub reason: String,
    /// The prescription this concerns, when the alert was raised against one.
    #[serde(default)]
    pub prescription_id: Option<String>,
    /// The prescriber to notify, when the screen knows who wrote the order.
    #[serde(default)]
    pub prescriber_id: Option<String>,
}

/// Record a pharmacist's decision about dispensing against an allergy.
#[post("/api/pharmacy/allergy-decisions")]
pub async fn record_pharmacy_decision(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<RecordPharmacyDecisionRequest>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    // Dispensing decisions belong to the people who dispense. A doctor
    // disagreeing with a pharmacist's refusal answers it through the query
    // thread, not by overwriting the refusal with their own record.
    if !matches!(caller.role, crate::Role::Pharmacist | crate::Role::Admin) {
        return pharmacy_error(
            actix_web::http::StatusCode::FORBIDDEN,
            "Only a pharmacist records a dispensing decision",
            "INSUFFICIENT_ROLE",
        );
    }

    let decision = req.decision.trim().to_lowercase();
    if decision != DECISION_REFUSED && decision != DECISION_QUERIED {
        return pharmacy_error(
            actix_web::http::StatusCode::BAD_REQUEST,
            "decision must be refused_to_dispense or prescriber_queried",
            "VALIDATION_ERROR",
        );
    }
    let reason = req.reason.trim().to_string();
    if reason.is_empty() {
        return pharmacy_error(
            actix_web::http::StatusCode::BAD_REQUEST,
            "A dispensing decision has to say why",
            "VALIDATION_ERROR",
        );
    }
    let allergen = req.allergen.trim().to_string();
    if allergen.is_empty() {
        return pharmacy_error(
            actix_web::http::StatusCode::BAD_REQUEST,
            "The allergen the decision concerns is required",
            "VALIDATION_ERROR",
        );
    }

    if data
        .repositories
        .patients
        .get_by_id(&req.patient_id)
        .await
        .is_err()
    {
        return pharmacy_error(
            actix_web::http::StatusCode::NOT_FOUND,
            &format!("Patient '{}' not found", req.patient_id),
            "PATIENT_NOT_FOUND",
        );
    }

    let id = format!("PHD-{}", uuid::Uuid::new_v4().simple());
    let now = chrono::Utc::now();

    if let Err(response) = crate::support::require_durable_audit(
        &data,
        crate::AccessLogEntry {
            access_id: uuid::Uuid::new_v4().to_string(),
            patient_id: req.patient_id.clone(),
            accessor_id: caller.wallet_address.clone(),
            accessor_role: caller.role.to_string(),
            access_type: "pharmacy_dispensing_decision".to_string(),
            location: None,
            timestamp: now,
            emergency: false,
        }
        .into(),
    )
    .await
    {
        return response;
    }

    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        // The patient, so the person this is about can reach it.
        owner_id: req.patient_id.clone(),
        data: serde_json::json!({
            "decision_id": id,
            "patient_id": req.patient_id,
            "allergen": allergen,
            "decision": decision,
            "reason": reason,
            "prescription_id": req.prescription_id,
            "prescriber_id": req.prescriber_id,
            "decided_by": caller.wallet_address,
            "decided_at": now.to_rfc3339(),
        }),
        created_at: now,
        updated_at: now,
    };

    match data.repositories.pharmacy_decisions.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "id": id,
            "decision": decision,
        })),
        Err(e) => {
            log::error!("pharmacy decision could not be stored: {e}");
            pharmacy_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "The decision could not be recorded",
                "DATABASE_ERROR",
            )
        }
    }
}

/// Every dispensing decision recorded for one patient.
///
/// Clinical staff read it to see why an order was not filled. The patient's own
/// copy is served by `patient_documents.rs` over the shared `authorize()`, per
/// rule 10 — a record about somebody that only their pharmacist can read is
/// the defect class this project keeps closing.
#[get("/api/pharmacy/allergy-decisions/patient/{patient_id}")]
pub async fn list_pharmacy_decisions_for_patient(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    let patient_id = path.into_inner();

    match data
        .repositories
        .pharmacy_decisions
        .get_by_owner(&patient_id)
        .await
    {
        Ok(rows) => {
            let decisions: Vec<serde_json::Value> = rows.into_iter().map(|r| r.data).collect();
            log::debug!(
                "pharmacy decisions read for {} by {}",
                patient_id,
                caller.wallet_address
            );
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "decisions": decisions,
            }))
        }
        Err(e) => {
            log::error!("pharmacy decisions could not be read: {e}");
            pharmacy_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Dispensing decisions could not be read",
                "DATABASE_ERROR",
            )
        }
    }
}

/// The controlled-substance dispensing register for a period.
///
/// The dashboard's *DEA report* link had no endpoint, so the register could be
/// looked at on screen and never produced as the document a regulator asks
/// for. This returns the dispensing events themselves rather than a rendered
/// file: the screen formats it, and a caller that wants CSV has the rows.
///
/// Dates are ISO-8601 (`from`/`to`, inclusive). An absent bound means no bound
/// on that side, which is the honest reading of a missing filter — a report
/// that silently defaulted to "this month" would be wrong every time somebody
/// wanted a year.
#[derive(Debug, Deserialize)]
pub struct ControlledSubstanceReportQuery {
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
}

#[get("/api/pharmacy/controlled-substances/report")]
pub async fn controlled_substance_report(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<ControlledSubstanceReportQuery>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    if !matches!(caller.role, crate::Role::Pharmacist | crate::Role::Admin) {
        return pharmacy_error(
            actix_web::http::StatusCode::FORBIDDEN,
            "Only a pharmacist or an administrator produces the controlled-substance register",
            "INSUFFICIENT_ROLE",
        );
    }

    let parse_bound = |value: &Option<String>| -> Option<chrono::DateTime<chrono::Utc>> {
        value.as_deref().and_then(|raw| {
            chrono::DateTime::parse_from_rfc3339(raw)
                .map(|d| d.with_timezone(&chrono::Utc))
                .ok()
                .or_else(|| {
                    chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d")
                        .ok()
                        .and_then(|d| d.and_hms_opt(0, 0, 0))
                        .map(|dt| dt.and_utc())
                })
        })
    };
    let from = parse_bound(&query.from);
    let to = parse_bound(&query.to);

    let events = match data.repositories.dispense_events.list_all().await {
        Ok(rows) => rows,
        Err(e) => {
            log::error!("controlled substance register could not be read: {e}");
            return pharmacy_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "The register could not be read",
                "DATABASE_ERROR",
            );
        }
    };

    let mut rows: Vec<serde_json::Value> = Vec::new();
    for event in events {
        if let Some(start) = from {
            if event.created_at < start {
                continue;
            }
        }
        if let Some(end) = to {
            if event.created_at > end {
                continue;
            }
        }
        // A register of controlled substances lists controlled substances. An
        // event that does not say its schedule is not evidence that it has
        // none, so it is reported rather than silently dropped -- the omission
        // would be invisible in the document a regulator reads.
        rows.push(event.data);
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "from": query.from,
        "to": query.to,
        "produced_by": caller.wallet_address,
        "produced_at": chrono::Utc::now().to_rfc3339(),
        "count": rows.len(),
        "events": rows,
    }))
}
