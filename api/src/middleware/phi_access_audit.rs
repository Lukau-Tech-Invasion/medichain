//! Patient-data disclosure audit: every successful read of a patient's data by
//! someone other than the patient leaves a durable access-log row.
//!
//! # Why a middleware and not 63 handler edits
//!
//! MediChain's promise to a patient is "you can see who read your record, when,
//! why and what they saw". Before this module only three of the 66 patient-scoped
//! `GET` routes wrote an access-log row; opening a patient's vitals, labs or notes
//! left no trace the patient could see. Editing every handler would fix today's
//! routes and silently miss tomorrow's. This is one chokepoint, driven by the
//! [`PHI_READ_ROUTES`] registry, and `scripts/check-phi-read-audit.py` fails the
//! build when a new patient-scoped `GET` is added without a registry entry.
//!
//! # Disclosure, not attempt
//!
//! The row is written **after** the handler succeeds and **before** the response
//! leaves the server. A denied (403) or failed (5xx) read never appears on the
//! patient's screen as "viewed" -- the patient would be told something false.
//! If the audit row cannot be persisted, the response is replaced with 503 and
//! the data is not released: disclosure without evidence is exactly what this
//! system exists to prevent (same contract as `support::require_durable_audit`).
//!
//! # Blockchain anchoring never blocks a read
//!
//! Anchoring submits an extrinsic and waits for finality, which takes seconds.
//! A chart screen issues ~20 reads, so anchoring inline would stall a clinician
//! for most of a minute per patient. The middleware only *queues* the anchor in
//! the durable audit outbox; the existing background worker submits it and
//! writes the transaction hash back onto the row (see `audit_outbox`). The
//! patient sees "anchor pending" and then "anchored".

use std::collections::HashMap;
use std::rc::Rc;
use std::sync::{Mutex, OnceLock};

use actix_web::{
    body::{EitherBody, MessageBody},
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    http::Method,
    web, Error, HttpRequest, HttpResponse,
};
use chrono::{NaiveDate, Utc};
use futures::future::{ok, LocalBoxFuture, Ready};

use crate::repositories::traits::AccessLogEntity;
use crate::state::AppState;

/// Stored `access_logs.action` for a disclosure recorded by this middleware.
/// Already permitted by the `access_logs.action` CHECK constraint.
const DISCLOSURE_ACTION: &str = "view";

/// Header a clinician client sends to declare why a chart was opened.
pub const ACCESS_REASON_HEADER: &str = "x-access-reason";

/// Reason recorded when the clinician did not declare one. The patient sees it,
/// which is the point: an unexplained read is itself information.
pub const REASON_NOT_STATED: &str = "Not stated";

/// Longest free-text reason kept, in characters. Long enough for a sentence,
/// short enough that the header cannot be used to stuff the audit table.
const MAX_REASON_CHARS: usize = 140;

/// How a patient-scoped route is audited.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditMode {
    /// This middleware writes the disclosure row.
    Middleware,
    /// The handler already writes a richer row (e.g. field-level emergency
    /// disclosure); the middleware must not add a duplicate.
    Handler,
}

/// One patient-scoped read route and how its disclosure is described.
#[derive(Debug, Clone, Copy)]
pub struct PhiReadRoute {
    /// Route pattern exactly as registered on the handler's GET attribute.
    pub pattern: &'static str,
    /// Path parameter that holds the patient record id.
    pub patient_param: &'static str,
    /// What the patient is told was viewed. Plain language, never an API path.
    pub category: &'static str,
    pub mode: AuditMode,
}

/// Shorthand for a middleware-audited route keyed by `{patient_id}`.
const fn route(pattern: &'static str, category: &'static str) -> PhiReadRoute {
    PhiReadRoute {
        pattern,
        patient_param: "patient_id",
        category,
        mode: AuditMode::Middleware,
    }
}

/// Shorthand for a route whose handler already writes its own disclosure row.
const fn handler_audited(pattern: &'static str, category: &'static str) -> PhiReadRoute {
    PhiReadRoute {
        pattern,
        patient_param: "patient_id",
        category,
        mode: AuditMode::Handler,
    }
}

/// Every patient-scoped `GET` route. `scripts/check-phi-read-audit.py` fails
/// the build if a route with a patient path parameter is missing from here.
pub const PHI_READ_ROUTES: &[PhiReadRoute] = &[
    route("/api/patients/{patient_id}", "Patient profile"),
    route("/api/access-logs/{patient_id}", "Record access history"),
    route(
        "/api/access/patient/{patient_id}/grants",
        "Access permissions",
    ),
    route(
        "/api/access/patient/{patient_id}/requests",
        "Access requests",
    ),
    route("/api/appointments/patient/{patient_id}", "Appointments"),
    route("/api/cds/patient/{patient_id}/alerts", "Clinical alerts"),
    route("/api/clinical/iv-sites/{patient_id}", "IV sites"),
    route(
        "/api/clinical/patient/{patient_id}/ama-discharges",
        "Discharge against advice",
    ),
    route(
        "/api/clinical/patient/{patient_id}/blood",
        "Blood transfusions",
    ),
    route(
        "/api/clinical/patient/{patient_id}/care-plans",
        "Care plans",
    ),
    route(
        "/api/clinical/patient/{patient_id}/consults",
        "Specialist consults",
    ),
    route(
        "/api/clinical/patient/{patient_id}/discharges",
        "Discharge summaries",
    ),
    route(
        "/api/clinical/patient/{patient_id}/ems-handoffs",
        "Ambulance handovers",
    ),
    route(
        "/api/clinical/patient/{patient_id}/gcs",
        "Consciousness scores",
    ),
    route(
        "/api/clinical/patient/{patient_id}/history-physicals",
        "History and physical exams",
    ),
    route(
        "/api/clinical/patient/{patient_id}/imaging",
        "Imaging reports",
    ),
    route(
        "/api/clinical/patient/{patient_id}/intake-output",
        "Fluid intake and output",
    ),
    route(
        "/api/clinical/patient/{patient_id}/pathology",
        "Pathology reports",
    ),
    route(
        "/api/clinical/patient/{patient_id}/pharmacy-decisions",
        "Pharmacy decisions",
    ),
    route(
        "/api/clinical/patient/{patient_id}/procedures",
        "Procedures",
    ),
    route(
        "/api/clinical/patient/{patient_id}/progress-notes",
        "Progress notes",
    ),
    route("/api/clinical/patient/{patient_id}/soap", "Clinical notes"),
    route(
        "/api/clinical/patient/{patient_id}/triage",
        "Triage assessments",
    ),
    route("/api/clinical/patient/{patient_id}/vitals", "Vital signs"),
    route(
        "/api/clinical/patient/{patient_id}/vitals/latest",
        "Vital signs",
    ),
    route("/api/clinical/patient/{patient_id}/wounds", "Wound care"),
    route(
        "/api/clinical/peds/patient/{patient_id}",
        "Paediatric records",
    ),
    route(
        "/api/clinical/psych/patient/{patient_id}",
        "Mental health assessments",
    ),
    route("/api/clinical/vitals/flowsheet/{patient_id}", "Vital signs"),
    route("/api/consent/patient/{patient_id}", "Consent records"),
    route("/api/e-prescriptions/patient/{patient_id}", "Prescriptions"),
    route(
        "/api/patients/{patient_id}/refill-requests",
        "Refill requests",
    ),
    route(
        "/api/emergency/cardiac/patient/{patient_id}",
        "Cardiac emergency records",
    ),
    route(
        "/api/emergency/code-blue/patient/{patient_id}",
        "Resuscitation records",
    ),
    route(
        "/api/emergency/fall-risk/patient/{patient_id}",
        "Fall-risk assessments",
    ),
    route(
        "/api/emergency/io/{patient_id}/{type}/{timestamp}",
        "Fluid intake and output",
    ),
    route(
        "/api/emergency/mar/{patient_id}/{medication_id}",
        "Medication administration",
    ),
    route(
        "/api/emergency/patient/{patient_id}",
        "Emergency department records",
    ),
    route(
        "/api/emergency/sepsis/patient/{patient_id}",
        "Sepsis assessments",
    ),
    route(
        "/api/emergency/stroke/patient/{patient_id}",
        "Stroke assessments",
    ),
    route(
        "/api/emergency/trauma/patient/{patient_id}",
        "Trauma assessments",
    ),
    route(
        "/api/fhir/r4/Patient/{patient_id}",
        "Health record export (FHIR)",
    ),
    PhiReadRoute {
        pattern: "/api/guardians/ward/{ward_patient_id}",
        patient_param: "ward_patient_id",
        category: "Guardian relationships",
        mode: AuditMode::Middleware,
    },
    route("/api/insurance/cards/{patient_id}", "Medical aid cards"),
    route(
        "/api/insurance/claims/patient/{patient_id}",
        "Medical aid claims",
    ),
    route(
        "/api/insurance/eligibility/{patient_id}",
        "Medical aid eligibility",
    ),
    route(
        "/api/interactions/history/{patient_id}",
        "Drug-interaction checks",
    ),
    route("/api/lab-trends/patient/{patient_id}", "Lab result trends"),
    route("/api/lab/patient/{patient_id}", "Lab results"),
    route("/api/medical-id/{patient_id}", "Medical ID"),
    route("/api/medical-id/{patient_id}/qr", "Medical ID"),
    route(
        "/api/medications/reminders/{patient_id}",
        "Medication reminders",
    ),
    route("/api/nfc/card/{patient_id}", "Emergency card"),
    route(
        "/api/patients/{patient_id}/emergency-capsule",
        "Emergency information",
    ),
    route(
        "/api/patients/{patient_id}/emergency-capsule/access-log",
        "Emergency access history",
    ),
    route(
        "/api/reminders/adherence/{patient_id}",
        "Medication adherence",
    ),
    route(
        "/api/reminders/medication/{patient_id}",
        "Medication reminders",
    ),
    route(
        "/api/surgical/operative-note/patient/{patient_id}",
        "Operation notes",
    ),
    route(
        "/api/surgical/post-op/patient/{patient_id}",
        "Post-operative records",
    ),
    route(
        "/api/surgical/pre-op/patient/{patient_id}",
        "Pre-operative records",
    ),
    route("/api/symptoms/history/{patient_id}", "Symptom history"),
    route("/api/symptoms/{patient_id}", "Symptoms"),
    route("/api/sync/download/{patient_id}", "Full record download"),
    route(
        "/api/telehealth/patient/{patient_id}/sessions",
        "Telehealth sessions",
    ),
    // Handlers below write a richer, field-level row themselves.
    handler_audited("/api/records/{patient_id}", "Medical records"),
    handler_audited(
        "/api/medical-id/{patient_id}/emergency",
        "Emergency information",
    ),
    handler_audited(
        "/api/medical-id/{patient_id}/lockscreen",
        "Emergency information",
    ),
];

/// Find the registry entry for a matched route pattern.
///
/// # Parameters
/// * `pattern` - the pattern actix matched (`HttpRequest::match_pattern`).
///
/// # Returns
/// The entry, or `None` when the route is not patient-scoped.
pub fn phi_route_for(pattern: &str) -> Option<&'static PhiReadRoute> {
    PHI_READ_ROUTES
        .iter()
        .find(|entry| entry.pattern == pattern)
}

/// Normalise the clinician's declared reason for display to the patient.
///
/// Known codes from the doctor portal map to fixed wording; anything else is
/// kept as free text with control characters removed and length capped.
///
/// # Parameters
/// * `raw` - the header value, if one was sent.
///
/// # Returns
/// A non-empty, printable reason, or [`REASON_NOT_STATED`].
pub fn normalise_access_reason(raw: Option<&str>) -> String {
    let trimmed = raw.map(str::trim).unwrap_or_default();
    let known = match trimmed.to_ascii_lowercase().as_str() {
        "treatment" => Some("Treatment"),
        "referral" => Some("Referral"),
        "emergency" => Some("Emergency"),
        "administrative" => Some("Administrative"),
        _ => None,
    };
    if let Some(label) = known {
        return label.to_string();
    }
    // Free text: printable characters only, so a header cannot inject line
    // breaks or terminal escapes into logs or the patient's screen.
    let cleaned: String = trimmed
        .chars()
        .filter(|character| !character.is_control())
        .take(MAX_REASON_CHARS)
        .collect();
    let cleaned = cleaned.trim().to_string();
    if cleaned.is_empty() {
        REASON_NOT_STATED.to_string()
    } else {
        cleaned
    }
}

/// Everything needed to write one disclosure row, gathered from the request.
struct Disclosure {
    patient_id: String,
    accessor_id: String,
    category: &'static str,
    pattern: String,
}

/// Decide whether this response is a third-party disclosure to audit.
///
/// # Parameters
/// * `req` - the routed request.
/// * `status_ok` - whether the handler produced a 2xx response.
/// * `data` - application state (to recognise the patient reading their own record).
///
/// # Returns
/// `Some(Disclosure)` only for a successful `GET` of a middleware-audited,
/// patient-scoped route by someone other than the patient.
fn disclosure_for(
    req: &HttpRequest,
    status_ok: bool,
    data: &web::Data<AppState>,
) -> Option<Disclosure> {
    if !status_ok || req.method() != Method::GET {
        return None;
    }
    let pattern = req.match_pattern()?;
    let rule = phi_route_for(&pattern)?;
    if rule.mode == AuditMode::Handler {
        return None;
    }
    let patient_id = req.match_info().get(rule.patient_param)?.to_string();
    // A route that succeeded without an identity is public; nothing to attribute.
    let accessor_id = crate::support::get_current_user_id(req)?;
    // Reading your own record is not something to alert yourself about.
    if crate::support::caller_owns_patient_record(data, &accessor_id, &patient_id) {
        return None;
    }
    Some(Disclosure {
        patient_id,
        accessor_id,
        category: rule.category,
        pattern,
    })
}

/// Build the access-log row for a disclosure.
///
/// # Parameters
/// * `req` - the request (reason header, client details).
/// * `data` - application state (accessor role and facility).
/// * `disclosure` - who read what about whom.
///
/// # Returns
/// A row ready to persist. An accessor unknown to the user store is recorded
/// with role "Unknown" rather than skipped: evidence of an unattributable read
/// is more important than a tidy table.
fn build_access_log(
    req: &HttpRequest,
    data: &web::Data<AppState>,
    disclosure: &Disclosure,
) -> AccessLogEntity {
    let accessor = crate::support::get_user(data, &disclosure.accessor_id);
    let reason_header = req
        .headers()
        .get(ACCESS_REASON_HEADER)
        .and_then(|value| value.to_str().ok());
    AccessLogEntity {
        id: uuid::Uuid::new_v4().to_string(),
        accessor_id: disclosure.accessor_id.clone(),
        accessor_role: accessor
            .as_ref()
            .map(|user| user.role.to_string())
            .unwrap_or_else(|| "Unknown".to_string()),
        patient_id: Some(disclosure.patient_id.clone()),
        resource_type: disclosure.category.to_string(),
        // The matched route is forensic evidence of exactly which read happened.
        resource_id: Some(disclosure.pattern.clone()),
        action: DISCLOSURE_ACTION.to_string(),
        access_reason: Some(normalise_access_reason(reason_header)),
        is_emergency_access: false,
        ip_address: req.peer_addr().map(|addr| addr.ip().to_string()),
        user_agent: req
            .headers()
            .get(actix_web::http::header::USER_AGENT)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string),
        blockchain_tx_hash: None,
        accessed_at: Utc::now(),
        facility_id: data
            .identity_contexts
            .facility_for_wallet(&disclosure.accessor_id),
    }
}

/// The 503 returned when a disclosure could not be evidenced.
fn audit_unavailable_response() -> HttpResponse {
    HttpResponse::ServiceUnavailable().json(serde_json::json!({
        "success": false,
        "error": "Patient information cannot be released because the required access record could not be saved. Please try again.",
        "code": "AUDIT_PERSISTENCE_UNAVAILABLE"
    }))
}

/// Last day each (accessor, patient) pair was notified, so a chart session of
/// ~20 reads becomes one "Dr X viewed your records" message a day, not twenty.
fn notification_ledger() -> &'static Mutex<HashMap<(String, String), NaiveDate>> {
    static LEDGER: OnceLock<Mutex<HashMap<(String, String), NaiveDate>>> = OnceLock::new();
    LEDGER.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Whether this accessor has not yet been announced to this patient today.
///
/// # Parameters
/// * `accessor_id`, `patient_id` - the pair being announced.
/// * `today` - the current date (injected for testing).
///
/// # Returns
/// `true` exactly once per pair per day; records the announcement as a side effect.
fn first_notice_today(accessor_id: &str, patient_id: &str, today: NaiveDate) -> bool {
    let Ok(mut ledger) = notification_ledger().lock() else {
        // A poisoned lock must not silence notifications; err toward telling.
        log::error!("PHI notification ledger lock poisoned; sending notice");
        return true;
    };
    let key = (accessor_id.to_string(), patient_id.to_string());
    if ledger.get(&key) == Some(&today) {
        return false;
    }
    ledger.insert(key, today);
    true
}

/// Tell the patient someone read their record (at most once per accessor per day).
///
/// # Parameters
/// * `data` - application state.
/// * `log` - the persisted disclosure row.
fn spawn_patient_notice(data: web::Data<AppState>, log: &AccessLogEntity) {
    let Some(patient_id) = log.patient_id.clone() else {
        return;
    };
    if !first_notice_today(&log.accessor_id, &patient_id, Utc::now().date_naive()) {
        return;
    }
    let body = format!(
        "{} viewed your {}.",
        log.accessor_role,
        log.resource_type.to_lowercase()
    );
    // Spawned: a push outage must never delay releasing a record to a clinician.
    tokio::spawn(async move {
        crate::notifications::notify_patient(
            &data,
            &patient_id,
            &["accessAlerts", "pushNotifications"],
            "Record Accessed",
            &body,
            "access_alert",
        )
        .await;
    });
}

/// Queue the disclosure for blockchain anchoring without waiting for the chain.
///
/// The background outbox worker submits the extrinsic and, on finality, writes
/// the transaction hash back onto the access-log row (`audit_outbox`).
///
/// # Parameters
/// * `data` - application state.
/// * `log` - the persisted disclosure row.
async fn queue_chain_anchor(data: &web::Data<AppState>, log: &AccessLogEntity) {
    if !crate::blockchain::blockchain_enabled() {
        return;
    }
    let Some(patient_id) = log.patient_id.as_deref() else {
        return;
    };
    let patient_account = match data.repositories.patients.get_by_id(patient_id).await {
        Ok(patient) => patient.wallet_address,
        Err(error) => {
            log::error!(
                "Chain anchor for access {} skipped: patient lookup failed: {error}",
                log.id
            );
            return;
        }
    };
    let Some(patient_account) = patient_account else {
        log::warn!(
            "Access {} not anchored: patient {patient_id} has no chain account",
            log.id
        );
        return;
    };
    let payload = serde_json::json!({
        "patient_account": patient_account,
        "audit_event_id": log.id,
        "access_log_id": log.id,
        "accessor_id": log.accessor_id,
        "access_type": "READ",
    });
    if let Err(error) = data
        .audit_outbox
        .record_durable(
            data.db_pool.as_ref(),
            "chain_access_anchor".to_string(),
            "access_log".to_string(),
            log.id.clone(),
            payload,
            Utc::now(),
        )
        .await
    {
        // The disclosure itself is already durable; only the anchor is missing.
        log::error!(
            "Chain anchor for access {} could not be queued: {error}",
            log.id
        );
    }
}

/// Persist the disclosure row; on success notify the patient and queue the anchor.
///
/// # Parameters
/// * `req` - the routed request.
/// * `data` - application state.
/// * `disclosure` - the read being recorded.
///
/// # Returns
/// `Ok(())` when the row is durable; `Err(())` when it is not (caller returns 503).
async fn record_disclosure(
    req: &HttpRequest,
    data: &web::Data<AppState>,
    disclosure: Disclosure,
) -> Result<(), ()> {
    let entry = build_access_log(req, data, &disclosure);
    match data.repositories.access_logs.create(entry).await {
        Ok(saved) => {
            spawn_patient_notice(data.clone(), &saved);
            queue_chain_anchor(data, &saved).await;
            Ok(())
        }
        Err(error) => {
            log::error!(
                "Disclosure audit for patient {} failed; response withheld: {error}",
                disclosure.patient_id
            );
            Err(())
        }
    }
}

/// Actix middleware factory. Register it as the innermost `wrap` so it sees the
/// matched route and the handler's final status.
pub struct PhiAccessAuditMiddleware;

impl<S, B> Transform<S, ServiceRequest> for PhiAccessAuditMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Transform = PhiAccessAuditService<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(PhiAccessAuditService {
            service: Rc::new(service),
        })
    }
}

/// The per-worker service created by [`PhiAccessAuditMiddleware`].
pub struct PhiAccessAuditService<S> {
    service: Rc<S>,
}

impl<S, B> Service<ServiceRequest> for PhiAccessAuditService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let service = Rc::clone(&self.service);
        Box::pin(async move {
            let response = service.call(req).await?;
            let Some(data) = response
                .request()
                .app_data::<web::Data<AppState>>()
                .cloned()
            else {
                return Ok(response.map_into_left_body());
            };
            let status_ok = response.status().is_success();
            let Some(disclosure) = disclosure_for(response.request(), status_ok, &data) else {
                return Ok(response.map_into_left_body());
            };
            let request = response.request().clone();
            if record_disclosure(&request, &data, disclosure).await.is_ok() {
                return Ok(response.map_into_left_body());
            }
            // The handler's bytes have not left the server yet: withhold them.
            let (request, _withheld) = response.into_parts();
            let blocked = audit_unavailable_response().map_into_right_body();
            Ok(ServiceResponse::new(request, blocked))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_reason_codes_get_fixed_wording() {
        assert_eq!(normalise_access_reason(Some("treatment")), "Treatment");
        assert_eq!(normalise_access_reason(Some(" REFERRAL ")), "Referral");
    }

    #[test]
    fn missing_or_blank_reason_is_reported_as_not_stated() {
        assert_eq!(normalise_access_reason(None), REASON_NOT_STATED);
        assert_eq!(normalise_access_reason(Some("   ")), REASON_NOT_STATED);
    }

    #[test]
    fn free_text_reason_is_stripped_of_control_characters_and_capped() {
        let reason = normalise_access_reason(Some("Follow-up\r\nvisit\u{1b}[31m"));
        assert!(!reason.chars().any(char::is_control));
        let long = "a".repeat(MAX_REASON_CHARS * 2);
        assert_eq!(normalise_access_reason(Some(&long)).len(), MAX_REASON_CHARS);
    }

    #[test]
    fn registry_patterns_are_unique_and_name_their_patient_parameter() {
        let mut seen = std::collections::HashSet::new();
        for entry in PHI_READ_ROUTES {
            assert!(
                seen.insert(entry.pattern),
                "duplicate registry entry {}",
                entry.pattern
            );
            let placeholder = format!("{{{}}}", entry.patient_param);
            assert!(
                entry.pattern.contains(&placeholder),
                "{} lacks {placeholder}",
                entry.pattern
            );
            assert!(!entry.category.is_empty() && !entry.category.starts_with('/'));
        }
    }

    /// End-to-end through the real vitals handler and this middleware.
    mod disclosure_flow {
        use super::super::*;
        use crate::repositories::traits::Pagination;
        use crate::types::Role;
        use actix_web::{test, App};

        const PATIENT_ID: &str = "PAT-PHI-AUDIT";
        const DOCTOR_WALLET: &str = "doctor-phi-audit";
        const PATIENT_WALLET: &str = "patient-phi-audit";
        const OTHER_PATIENT_WALLET: &str = "other-patient-phi-audit";

        /// Build a user with the given role and optional linked patient record.
        fn user(wallet: &str, role: Role, linked: Option<&str>) -> crate::User {
            crate::User {
                wallet_address: wallet.to_string(),
                username: None,
                name: format!("{role} {wallet}"),
                role,
                created_at: Utc::now(),
                created_by: None,
                linked_patient_id: linked.map(str::to_string),
                email: None,
                phone: None,
                department: None,
                specialty: None,
                license_number: None,
                status: "active".to_string(),
                last_login: None,
            }
        }

        /// App state with a doctor, the patient, and an unrelated patient.
        fn state() -> web::Data<AppState> {
            let state = AppState::new();
            {
                let mut users = state.users.write().expect("users lock");
                users.insert(
                    DOCTOR_WALLET.into(),
                    user(DOCTOR_WALLET, Role::Doctor, None),
                );
                users.insert(
                    PATIENT_WALLET.into(),
                    user(PATIENT_WALLET, Role::Patient, Some(PATIENT_ID)),
                );
                users.insert(
                    OTHER_PATIENT_WALLET.into(),
                    user(
                        OTHER_PATIENT_WALLET,
                        Role::Patient,
                        Some("PAT-SOMEONE-ELSE"),
                    ),
                );
            }
            web::Data::new(state)
        }

        /// Call GET vitals as `wallet` (optionally with a reason) and return the status.
        async fn read_vitals(
            data: &web::Data<AppState>,
            wallet: &str,
            reason: Option<&str>,
        ) -> u16 {
            let app = test::init_service(
                App::new()
                    .wrap(PhiAccessAuditMiddleware)
                    .app_data(data.clone())
                    .service(crate::handlers::get_patient_vitals),
            )
            .await;
            let mut request = test::TestRequest::get()
                .uri(&format!("/api/clinical/patient/{PATIENT_ID}/vitals"))
                .insert_header(("x-user-id", wallet));
            if let Some(reason) = reason {
                request = request.insert_header((ACCESS_REASON_HEADER, reason));
            }
            test::call_service(&app, request.to_request())
                .await
                .status()
                .as_u16()
        }

        /// Every access-log row recorded for the test patient.
        async fn rows(data: &web::Data<AppState>) -> Vec<AccessLogEntity> {
            data.repositories
                .access_logs
                .get_by_patient(PATIENT_ID, Pagination::new(0, 100))
                .await
                .expect("read access logs")
                .items
        }

        #[actix_web::test]
        async fn a_doctor_reading_vitals_leaves_one_row_with_who_why_and_what() {
            let data = state();
            assert_eq!(
                read_vitals(&data, DOCTOR_WALLET, Some("treatment")).await,
                200
            );
            let rows = rows(&data).await;
            assert_eq!(rows.len(), 1, "exactly one disclosure row");
            let row = &rows[0];
            assert_eq!(row.accessor_id, DOCTOR_WALLET);
            assert_eq!(row.accessor_role, "Doctor");
            assert_eq!(row.action, DISCLOSURE_ACTION);
            assert_eq!(row.resource_type, "Vital signs");
            assert_eq!(row.access_reason.as_deref(), Some("Treatment"));
            assert!(row.blockchain_tx_hash.is_none(), "never a fabricated hash");
        }

        #[actix_web::test]
        async fn a_read_without_a_declared_reason_says_so() {
            let data = state();
            assert_eq!(read_vitals(&data, DOCTOR_WALLET, None).await, 200);
            assert_eq!(
                rows(&data).await[0].access_reason.as_deref(),
                Some(REASON_NOT_STATED)
            );
        }

        #[actix_web::test]
        async fn a_patient_reading_their_own_vitals_is_not_logged_as_a_disclosure() {
            let data = state();
            assert_eq!(read_vitals(&data, PATIENT_WALLET, None).await, 200);
            assert!(rows(&data).await.is_empty());
        }

        #[actix_web::test]
        async fn a_denied_read_is_never_recorded_as_viewed() {
            let data = state();
            assert_eq!(read_vitals(&data, OTHER_PATIENT_WALLET, None).await, 403);
            assert!(
                rows(&data).await.is_empty(),
                "403 must not appear as 'viewed'"
            );
        }

        #[actix_web::test]
        async fn handler_audited_routes_are_not_duplicated() {
            let data = state();
            let app = test::init_service(
                App::new()
                    .wrap(PhiAccessAuditMiddleware)
                    .app_data(data.clone())
                    .route(
                        "/api/records/{patient_id}",
                        web::get().to(|| async { HttpResponse::Ok().finish() }),
                    ),
            )
            .await;
            let request = test::TestRequest::get()
                .uri(&format!("/api/records/{PATIENT_ID}"))
                .insert_header(("x-user-id", DOCTOR_WALLET))
                .to_request();
            assert_eq!(test::call_service(&app, request).await.status(), 200);
            assert!(rows(&data).await.is_empty());
        }
    }

    #[test]
    fn audit_failure_withholds_data_with_a_503() {
        assert_eq!(audit_unavailable_response().status(), 503);
    }

    #[test]
    fn patient_is_told_once_per_accessor_per_day() {
        let today = NaiveDate::from_ymd_opt(2026, 9, 26).expect("valid date");
        let tomorrow = today.succ_opt().expect("valid date");
        let accessor = "wallet-notice-test";
        let patient = "PAT-NOTICE-TEST";
        assert!(first_notice_today(accessor, patient, today));
        assert!(!first_notice_today(accessor, patient, today));
        assert!(first_notice_today(accessor, patient, tomorrow));
    }
}
