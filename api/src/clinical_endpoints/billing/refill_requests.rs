//! `clinical_endpoints::billing::refill_requests` — prescription refill
//! requests (WP7.1).
//!
//! A patient asks for a refill of a prescription that still has refills left.
//! A doctor approves it, which takes one refill off the original and creates a
//! new, **unsigned** prescription linked to it (`refill_of`) that then goes
//! through the ordinary sign and transmit steps, or denies it with a reason the
//! patient reads. The patient may cancel while the request is open.
//!
//! Every state change is written together with its audit row (one database
//! transaction on PostgreSQL), and the database itself refuses a second open
//! request for the same prescription.

use super::e_prescriptions::{load_prescription, prescription_audit, prescription_record};
use super::*;
use crate::clinical::{EPrescription, PrescriptionStatus, SecondaryVerificationStatus};
use crate::repositories::refill_requests::{
    RefillApproval, RefillClosure, RefillRequestEntity, RefillRequestStatus,
};
use serde::Serialize;

/// Longest note a patient may attach to a request, in characters.
const MAX_PATIENT_NOTE_CHARS: usize = 500;
/// A denial reason must say something a patient can act on.
const MIN_DENIAL_REASON_CHARS: usize = 10;
/// Longest denial reason, in characters (matches the database CHECK).
const MAX_DENIAL_REASON_CHARS: usize = 500;
/// Notification preference keys a refill decision is delivered under.
const REFILL_NOTIFICATION_KEYS: &[&str] = &["recordUpdates", "pushNotifications"];

/// Audit actions for the four refill acts. Each maps to exactly one value in
/// the `access_logs.action` CHECK constraint.
#[derive(Debug, Clone, Copy)]
enum RefillAuditAction {
    Requested,
    Approved,
    Denied,
    Cancelled,
}

impl RefillAuditAction {
    /// The stored audit action string.
    fn as_str(self) -> &'static str {
        match self {
            Self::Requested => "refill_requested",
            Self::Approved => "refill_approved",
            Self::Denied => "refill_denied",
            Self::Cancelled => "refill_cancelled",
        }
    }
}

/// Body of `POST /api/e-prescriptions/{id}/refill-requests`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateRefillRequestBody {
    /// Optional note for the doctor ("running out on Friday").
    #[serde(default)]
    pub note: Option<String>,
}

/// Body of `POST /api/refill-requests/{id}/deny`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DenyRefillRequestBody {
    /// Why the refill was refused. The patient reads this.
    pub reason: String,
}

/// A refill request as the API returns it.
#[derive(Debug, Serialize)]
pub struct RefillRequestView {
    pub id: String,
    pub prescription_id: String,
    pub patient_id: String,
    pub medication_name: String,
    pub status: RefillRequestStatus,
    pub patient_note: Option<String>,
    pub denial_reason: Option<String>,
    pub decided_at: Option<chrono::DateTime<chrono::Utc>>,
    pub new_prescription_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Convert a stored row to its API shape.
///
/// Returns `None` (and logs) for a status the enum does not know: the CHECK
/// constraint makes that corruption, and guessing a status would mislead.
fn to_view(entity: RefillRequestEntity) -> Option<RefillRequestView> {
    let Some(status) = RefillRequestStatus::parse(&entity.status) else {
        log::error!(
            "Refill request {} has unknown status {:?}",
            entity.id,
            entity.status
        );
        return None;
    };
    Some(RefillRequestView {
        id: entity.id,
        prescription_id: entity.prescription_id,
        patient_id: entity.patient_id,
        medication_name: entity.medication_name,
        status,
        patient_note: entity.patient_note,
        denial_reason: entity.denial_reason,
        decided_at: entity.decided_at,
        new_prescription_id: entity.new_prescription_id,
        created_at: entity.created_at,
    })
}

/// A JSON error response with a stable code.
fn refill_error(
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
fn refill_unavailable(context: &str, error: impl std::fmt::Display) -> HttpResponse {
    log::error!("Refill requests: {context}: {error}");
    refill_error(
        HttpResponse::ServiceUnavailable(),
        "Refill requests are temporarily unavailable. Please try again shortly.",
        "REFILL_REQUESTS_UNAVAILABLE",
    )
}

/// Trim free text, drop control characters other than newlines, and enforce a
/// character limit. Returns `Ok(None)` for empty input, `Err(())` when too long.
fn clean_text(raw: Option<&str>, max_chars: usize) -> Result<Option<String>, ()> {
    let cleaned: String = raw
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.chars().count() > max_chars {
        return Err(());
    }
    Ok((!trimmed.is_empty()).then(|| trimmed.to_string()))
}

/// Why a prescription cannot be refilled right now, or `None` if it can.
///
/// Parameters: the prescription and the current Unix time. Returns a
/// patient-readable reason.
fn refill_blocker(prescription: &EPrescription, now: i64) -> Option<&'static str> {
    let active = matches!(
        prescription.status,
        PrescriptionStatus::Signed
            | PrescriptionStatus::Transmitted
            | PrescriptionStatus::Received
            | PrescriptionStatus::InProgress
            | PrescriptionStatus::Dispensed
            | PrescriptionStatus::PartialFill
    );
    if !active {
        return Some("This prescription is not active, so it cannot be refilled.");
    }
    if prescription.expires_at <= now {
        return Some("This prescription has expired. Please ask your doctor for a new one.");
    }
    if prescription.refills_remaining == 0 {
        return Some(
            "This prescription has no refills left. Please ask your doctor for a new one.",
        );
    }
    None
}

/// Build the audit row for a refill act on `prescription`.
fn refill_audit(
    prescription: &EPrescription,
    caller: &crate::User,
    action: RefillAuditAction,
) -> crate::repositories::traits::AccessLogEntity {
    let mut audit = prescription_audit(
        prescription,
        &caller.wallet_address,
        &caller.role.to_string(),
        action.as_str(),
    );
    audit.resource_id = Some(prescription.prescription_id.clone());
    audit
}

/// Tell the patient about a decision, without holding up the response.
fn notify_refill_decision(
    data: &web::Data<AppState>,
    patient_id: String,
    title: String,
    body: String,
) {
    let state = data.clone();
    tokio::spawn(async move {
        crate::notifications::notify_patient(
            &state,
            &patient_id,
            REFILL_NOTIFICATION_KEYS,
            &title,
            &body,
            "prescription",
        )
        .await;
    });
}

/// Build a new open request for `prescription` on behalf of `caller`.
fn new_request_entity(
    prescription: &EPrescription,
    caller: &crate::User,
    note: Option<String>,
) -> RefillRequestEntity {
    let now = chrono::Utc::now();
    RefillRequestEntity {
        id: format!("RFR-{}", uuid::Uuid::new_v4()),
        prescription_id: prescription.prescription_id.clone(),
        patient_id: prescription.patient_id.clone(),
        prescriber_id: prescription.prescriber_id.clone(),
        medication_name: prescription.medication.name.clone(),
        requested_by: caller.wallet_address.clone(),
        status: RefillRequestStatus::Requested.as_str().to_string(),
        patient_note: note,
        decided_by: None,
        decided_at: None,
        denial_reason: None,
        new_prescription_id: None,
        created_at: now,
        updated_at: now,
    }
}

/// Ask for a refill of one of the caller's own prescriptions.
///
/// Returns 201 with the request; 403 when the prescription is not the
/// caller's; 409 when a request is already open; 422 when the prescription
/// cannot be refilled; 400 for an over-long note; 503 on storage failure.
#[post("/api/e-prescriptions/{prescription_id}/refill-requests")]
pub async fn create_refill_request(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<CreateRefillRequestBody>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let prescription = match load_prescription(&data, &path.into_inner()).await {
        Ok(prescription) => prescription,
        Err(response) => return response,
    };
    // Patients only, and only for themselves. A guardian's path arrives with
    // the care-relationship model (WP9).
    if !crate::support::caller_owns_patient_record(
        &data,
        &caller.wallet_address,
        &prescription.patient_id,
    ) {
        return refill_error(
            HttpResponse::Forbidden(),
            "You can only request refills of your own prescriptions.",
            "NOT_YOUR_PRESCRIPTION",
        );
    }
    let Ok(note) = clean_text(body.note.as_deref(), MAX_PATIENT_NOTE_CHARS) else {
        return refill_error(
            HttpResponse::BadRequest(),
            "Please keep your note to 500 characters or fewer.",
            "REFILL_NOTE_TOO_LONG",
        );
    };
    if let Some(reason) = refill_blocker(&prescription, chrono::Utc::now().timestamp()) {
        return refill_error(
            HttpResponse::UnprocessableEntity(),
            reason,
            "REFILL_NOT_AVAILABLE",
        );
    }
    let request = new_request_entity(&prescription, &caller, note);
    let audit = refill_audit(&prescription, &caller, RefillAuditAction::Requested);
    match data
        .repositories
        .create_refill_request(request, audit)
        .await
    {
        Ok(stored) => match to_view(stored) {
            Some(view) => HttpResponse::Created()
                .json(serde_json::json!({ "success": true, "request": view })),
            None => refill_unavailable("created request unreadable", "unknown status"),
        },
        Err(crate::repositories::RepositoryError::Duplicate(_)) => refill_error(
            HttpResponse::Conflict(),
            "A refill for this prescription has already been requested.",
            "REFILL_ALREADY_REQUESTED",
        ),
        Err(error) => refill_unavailable("create", error),
    }
}

/// A patient's refill requests, newest first.
///
/// Readable by the patient and by healthcare providers (the same rule as the
/// patient's prescription list). Registered in `PHI_READ_ROUTES`, so a
/// provider's read appears on the patient's access history.
#[get("/api/patients/{patient_id}/refill-requests")]
pub async fn list_patient_refill_requests(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let patient_id = path.into_inner();
    let is_own =
        crate::support::caller_owns_patient_record(&data, &caller.wallet_address, &patient_id);
    if !is_own && !caller.role.is_healthcare_provider() {
        return refill_error(HttpResponse::Forbidden(), "Access denied", "FORBIDDEN");
    }
    match data
        .repositories
        .refill_requests
        .list_by_patient(&patient_id)
        .await
    {
        Ok(rows) => {
            let requests: Vec<_> = rows.into_iter().filter_map(to_view).collect();
            HttpResponse::Ok().json(serde_json::json!({ "success": true, "requests": requests }))
        }
        Err(error) => refill_unavailable("list by patient", error),
    }
}

/// Refill decisions are prescribing acts: only a Doctor may make them.
///
/// Parameters: the already-authenticated clinical caller. Returns `Err` with a
/// 403 for any other role.
fn ensure_doctor(caller: &crate::User) -> Result<(), HttpResponse> {
    if caller.role == crate::Role::Doctor {
        return Ok(());
    }
    Err(refill_error(
        HttpResponse::Forbidden(),
        "Only doctors can decide refill requests.",
        "PRESCRIBER_REQUIRED",
    ))
}

/// Open refill requests on the calling doctor's own prescriptions, oldest first.
#[get("/api/refill-requests/queue")]
pub async fn refill_request_queue(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if let Err(response) = ensure_doctor(&caller) {
        return response;
    }
    match data
        .repositories
        .refill_requests
        .list_open_by_prescriber(&caller.wallet_address)
        .await
    {
        Ok(rows) => {
            let requests: Vec<_> = rows.into_iter().filter_map(to_view).collect();
            HttpResponse::Ok().json(serde_json::json!({ "success": true, "requests": requests }))
        }
        Err(error) => refill_unavailable("queue", error),
    }
}

/// Load an open request by id: 404 if absent, 409 if already closed.
async fn load_open_request(
    data: &web::Data<AppState>,
    request_id: &str,
) -> Result<RefillRequestEntity, HttpResponse> {
    match data
        .repositories
        .refill_requests
        .get_by_id(request_id)
        .await
    {
        Ok(Some(request)) if request.status == RefillRequestStatus::Requested.as_str() => {
            Ok(request)
        }
        Ok(Some(_)) => Err(refill_error(
            HttpResponse::Conflict(),
            "This refill request has already been decided or cancelled.",
            "REFILL_ALREADY_CLOSED",
        )),
        Ok(None) => Err(refill_error(
            HttpResponse::NotFound(),
            "Refill request not found.",
            "REFILL_REQUEST_NOT_FOUND",
        )),
        Err(error) => Err(refill_unavailable("load request", error)),
    }
}

/// The new, unsigned prescription an approval creates.
///
/// A copy of the original's medicine and directions, prescribed by the
/// approving doctor, with no refills of its own, no signature, nothing
/// dispensed, and the original's expiry (a refill cannot outlive the
/// authorisation it came from). The dispensing-verification policy decision is
/// carried over with its evidence cleared.
fn refill_prescription(original: &EPrescription, approver: &crate::User) -> EPrescription {
    let mut refill = original.clone();
    refill.prescription_id = format!("RX-{}", uuid::Uuid::new_v4());
    refill.prescriber_id = approver.wallet_address.clone();
    refill.prescriber_name = approver.name.clone();
    refill.prescriber_npi = approver
        .license_number
        .clone()
        .filter(|n| !n.trim().is_empty());
    refill.status = PrescriptionStatus::Draft;
    refill.created_at = chrono::Utc::now().timestamp();
    (refill.signed_at, refill.signature) = (None, None);
    (refill.transmitted_at, refill.transmission_status) = (None, None);
    (refill.dispensed_quantity, refill.last_filled) = (0, None);
    (refill.refills_allowed, refill.refills_remaining) = (0, 0);
    let required = original.secondary_verification.required;
    refill.secondary_verification = crate::clinical::SecondaryDispensingVerification {
        required,
        status: if required {
            SecondaryVerificationStatus::Required
        } else {
            SecondaryVerificationStatus::NotRequired
        },
        policy_version: original.secondary_verification.policy_version.clone(),
        policy_rule_id: original.secondary_verification.policy_rule_id.clone(),
        verification_ttl_seconds: original.secondary_verification.verification_ttl_seconds,
        ..Default::default()
    };
    refill.refill_of = Some(original.prescription_id.clone());
    refill
}

/// Assemble every write an approval makes.
fn build_approval(
    request: &RefillRequestEntity,
    original: &EPrescription,
    approver: &crate::User,
) -> (RefillApproval, String) {
    let refill = refill_prescription(original, approver);
    let new_id = refill.prescription_id.clone();
    let mut decremented = original.clone();
    decremented.refills_remaining -= 1;
    let approval = RefillApproval {
        closure: RefillClosure {
            request_id: request.id.clone(),
            status: RefillRequestStatus::Approved,
            decided_by: approver.wallet_address.clone(),
            decided_at: chrono::Utc::now(),
            denial_reason: None,
            new_prescription_id: Some(new_id.clone()),
        },
        original_prescription_id: original.prescription_id.clone(),
        expected_refills_remaining: original.refills_remaining.to_string(),
        updated_original: prescription_record(&decremented, &original.prescription_id),
        new_prescription: prescription_record(&refill, &new_id),
        audit: refill_audit(original, approver, RefillAuditAction::Approved),
    };
    (approval, new_id)
}

/// Approve an open refill request (Doctor).
///
/// Returns 200 with the closed request and the new prescription's id, which
/// the doctor then signs as usual; 404/409 for a missing or closed request;
/// 422 if the original can no longer be refilled; 409 if it changed while the
/// decision was being made; 503 on storage failure.
#[post("/api/refill-requests/{request_id}/approve")]
pub async fn approve_refill_request(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let approver = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if let Err(response) = ensure_doctor(&approver) {
        return response;
    }
    let request = match load_open_request(&data, &path.into_inner()).await {
        Ok(request) => request,
        Err(response) => return response,
    };
    let original = match load_prescription(&data, &request.prescription_id).await {
        Ok(prescription) => prescription,
        Err(response) => return response,
    };
    if let Some(reason) = refill_blocker(&original, chrono::Utc::now().timestamp()) {
        return refill_error(
            HttpResponse::UnprocessableEntity(),
            reason,
            "REFILL_NOT_AVAILABLE",
        );
    }
    let (approval, new_id) = build_approval(&request, &original, &approver);
    match data.repositories.approve_refill_request(approval).await {
        Ok(Some(closed)) => {
            notify_refill_decision(
                &data,
                closed.patient_id.clone(),
                "Refill approved".into(),
                format!(
                    "Your refill of {} was approved. Your doctor will sign the new prescription.",
                    closed.medication_name
                ),
            );
            HttpResponse::Ok().json(serde_json::json!({ "success": true, "request": to_view(closed), "new_prescription_id": new_id }))
        }
        Ok(None) => refill_error(
            HttpResponse::Conflict(),
            "This request or prescription changed while you were deciding. Please reload.",
            "REFILL_CONFLICT",
        ),
        Err(error) => refill_unavailable("approve", error),
    }
}

/// Close an open request as denied or cancelled, with its audit row.
async fn close_request(
    data: &web::Data<AppState>,
    request: &RefillRequestEntity,
    caller: &crate::User,
    closure: RefillClosure,
    action: RefillAuditAction,
) -> Result<RefillRequestEntity, HttpResponse> {
    let prescription = load_prescription(data, &request.prescription_id).await?;
    let audit = refill_audit(&prescription, caller, action);
    match data.repositories.close_refill_request(closure, audit).await {
        Ok(Some(closed)) => Ok(closed),
        Ok(None) => Err(refill_error(
            HttpResponse::Conflict(),
            "This refill request has already been decided or cancelled.",
            "REFILL_ALREADY_CLOSED",
        )),
        Err(error) => Err(refill_unavailable("close", error)),
    }
}

/// Deny an open refill request with a reason the patient reads (Doctor).
///
/// Returns 200 with the closed request; 400 without a usable reason;
/// 404/409 for a missing or closed request; 503 on storage failure.
#[post("/api/refill-requests/{request_id}/deny")]
pub async fn deny_refill_request(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<DenyRefillRequestBody>,
) -> impl Responder {
    let doctor = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if let Err(response) = ensure_doctor(&doctor) {
        return response;
    }
    let reason = match clean_text(Some(&body.reason), MAX_DENIAL_REASON_CHARS) {
        Ok(Some(reason)) if reason.chars().count() >= MIN_DENIAL_REASON_CHARS => reason,
        _ => {
            return refill_error(
                HttpResponse::BadRequest(),
                "Give the patient a reason of 10 to 500 characters.",
                "DENIAL_REASON_REQUIRED",
            )
        }
    };
    let request = match load_open_request(&data, &path.into_inner()).await {
        Ok(request) => request,
        Err(response) => return response,
    };
    let closure = RefillClosure {
        request_id: request.id.clone(),
        status: RefillRequestStatus::Denied,
        decided_by: doctor.wallet_address.clone(),
        decided_at: chrono::Utc::now(),
        denial_reason: Some(reason.clone()),
        new_prescription_id: None,
    };
    match close_request(&data, &request, &doctor, closure, RefillAuditAction::Denied).await {
        Ok(closed) => {
            notify_refill_decision(
                &data,
                closed.patient_id.clone(),
                "Refill not approved".into(),
                format!(
                    "Your refill of {} was not approved: {reason}",
                    closed.medication_name
                ),
            );
            HttpResponse::Ok()
                .json(serde_json::json!({ "success": true, "request": to_view(closed) }))
        }
        Err(response) => response,
    }
}

/// Withdraw one of the caller's own open refill requests (patient).
///
/// Returns 200 with the closed request; 403 for someone else's request;
/// 404/409 for a missing or closed request; 503 on storage failure.
#[post("/api/refill-requests/{request_id}/cancel")]
pub async fn cancel_refill_request(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let request = match load_open_request(&data, &path.into_inner()).await {
        Ok(request) => request,
        Err(response) => return response,
    };
    if !crate::support::caller_owns_patient_record(
        &data,
        &caller.wallet_address,
        &request.patient_id,
    ) {
        return refill_error(
            HttpResponse::Forbidden(),
            "You can only cancel your own refill requests.",
            "NOT_YOUR_REQUEST",
        );
    }
    let closure = RefillClosure {
        request_id: request.id.clone(),
        status: RefillRequestStatus::Cancelled,
        decided_by: caller.wallet_address.clone(),
        decided_at: chrono::Utc::now(),
        denial_reason: None,
        new_prescription_id: None,
    };
    match close_request(
        &data,
        &request,
        &caller,
        closure,
        RefillAuditAction::Cancelled,
    )
    .await
    {
        Ok(closed) => HttpResponse::Ok()
            .json(serde_json::json!({ "success": true, "request": to_view(closed) })),
        Err(response) => response,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clinical::PrescriptionStatus;
    use crate::repositories::refill_requests::RefillRequestRepository;
    use crate::repositories::RepositoryResult;
    use actix_web::{test, App};

    const PATIENT_ID: &str = "PAT-RF";
    const PATIENT_WALLET: &str = "patient_rf";
    const PRESCRIBER: &str = "doctor_rf";
    const OTHER_DOCTOR: &str = "doctor_other";
    const NURSE: &str = "nurse_rf";
    const STRANGER: &str = "patient_stranger";

    /// A user with `role`; patients are linked to `linked`.
    fn user(wallet: &str, role: crate::Role, linked: Option<&str>) -> crate::User {
        let mut user = crate::test_fixtures::staff(wallet, role);
        user.linked_patient_id = linked.map(str::to_string);
        user
    }

    /// A signed prescription for the test patient with `refills` left.
    fn prescription(id: &str, refills: u8) -> EPrescription {
        let now = chrono::Utc::now().timestamp();
        EPrescription {
            prescription_id: id.into(),
            patient_id: PATIENT_ID.into(),
            prescriber_id: PRESCRIBER.into(),
            prescriber_name: "Dr Refill".into(),
            prescriber_npi: None,
            prescriber_dea: None,
            medication: crate::clinical::PrescribedMedication {
                rxcui: None,
                ndc: None,
                name: "Amlodipine".into(),
                generic_name: None,
                strength: "5mg".into(),
                form: "tablet".into(),
                quantity: 30,
                quantity_unit: "tablet".into(),
                days_supply: 30,
                directions: "one tablet daily".into(),
                daw_code: 0,
            },
            pharmacy: None,
            status: PrescriptionStatus::Dispensed,
            created_at: now,
            signed_at: Some(now),
            signature: None,
            transmitted_at: Some(now),
            transmission_status: None,
            is_controlled: false,
            dea_schedule: None,
            dispensed_quantity: 30,
            secondary_verification: Default::default(),
            refills_allowed: refills,
            refills_remaining: refills,
            last_filled: Some(now),
            expires_at: now + 86_400 * 180,
            pharmacy_notes: None,
            patient_instructions: "Take in the morning".into(),
            diagnosis_codes: Vec::new(),
            refill_of: None,
        }
    }

    /// App state with the cast of users and one stored prescription.
    async fn state_with(rx: EPrescription) -> web::Data<AppState> {
        let state = AppState::new();
        {
            let mut users = state.users.write().unwrap();
            for u in [
                user(PATIENT_WALLET, crate::Role::Patient, Some(PATIENT_ID)),
                user(STRANGER, crate::Role::Patient, Some("PAT-OTHER")),
                user(PRESCRIBER, crate::Role::Doctor, None),
                user(OTHER_DOCTOR, crate::Role::Doctor, None),
                user(NURSE, crate::Role::Nurse, None),
            ] {
                users.insert(u.wallet_address.clone(), u);
            }
        }
        let id = rx.prescription_id.clone();
        state
            .repositories
            .e_prescriptions_v2
            .create(prescription_record(&rx, &id))
            .await
            .unwrap();
        web::Data::new(state)
    }

    /// Send one request as `wallet` to an app with every refill route.
    async fn call(
        state: &web::Data<AppState>,
        request: test::TestRequest,
        wallet: &str,
    ) -> (u16, serde_json::Value) {
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(create_refill_request)
                .service(list_patient_refill_requests)
                .service(refill_request_queue)
                .service(approve_refill_request)
                .service(deny_refill_request)
                .service(cancel_refill_request),
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

    /// The patient asks for a refill of `rx_id`; returns status and body.
    async fn request_refill(
        state: &web::Data<AppState>,
        rx_id: &str,
        wallet: &str,
    ) -> (u16, serde_json::Value) {
        let uri = format!("/api/e-prescriptions/{rx_id}/refill-requests");
        call(
            state,
            test::TestRequest::post()
                .uri(&uri)
                .set_json(serde_json::json!({ "note": "Running out Friday" })),
            wallet,
        )
        .await
    }

    async fn stored_rx(state: &web::Data<AppState>, id: &str) -> EPrescription {
        let entity = state
            .repositories
            .e_prescriptions_v2
            .get_by_id(id)
            .await
            .unwrap()
            .unwrap();
        serde_json::from_value(entity.data).unwrap()
    }

    async fn audit_actions(state: &web::Data<AppState>) -> Vec<String> {
        let page = crate::repositories::Pagination::new(0, 100);
        let logs = state
            .repositories
            .access_logs
            .get_by_patient(PATIENT_ID, page)
            .await
            .unwrap();
        logs.items.into_iter().map(|log| log.action).collect()
    }

    #[actix_web::test]
    async fn a_patient_requests_a_refill_and_it_is_audited() {
        let state = state_with(prescription("RX-A", 2)).await;
        let (status, body) = request_refill(&state, "RX-A", PATIENT_WALLET).await;
        assert_eq!(status, 201, "{body}");
        assert_eq!(body["request"]["status"], "requested");
        assert_eq!(body["request"]["medication_name"], "Amlodipine");
        assert_eq!(body["request"]["patient_note"], "Running out Friday");
        assert_eq!(audit_actions(&state).await, ["refill_requested"]);
    }

    #[actix_web::test]
    async fn a_second_open_request_is_refused() {
        let state = state_with(prescription("RX-B", 2)).await;
        assert_eq!(request_refill(&state, "RX-B", PATIENT_WALLET).await.0, 201);
        let (status, body) = request_refill(&state, "RX-B", PATIENT_WALLET).await;
        assert_eq!(status, 409);
        assert_eq!(body["error"]["code"], "REFILL_ALREADY_REQUESTED");
    }

    #[actix_web::test]
    async fn someone_elses_prescription_is_forbidden() {
        let state = state_with(prescription("RX-C", 2)).await;
        let (status, body) = request_refill(&state, "RX-C", STRANGER).await;
        assert_eq!(status, 403);
        assert_eq!(body["error"]["code"], "NOT_YOUR_PRESCRIPTION");
        assert!(audit_actions(&state).await.is_empty());
    }

    #[actix_web::test]
    async fn no_refills_left_or_an_inactive_prescription_is_unprocessable() {
        let state = state_with(prescription("RX-D", 0)).await;
        assert_eq!(request_refill(&state, "RX-D", PATIENT_WALLET).await.0, 422);
        let mut draft = prescription("RX-E", 3);
        draft.status = PrescriptionStatus::Draft;
        let state = state_with(draft).await;
        let (status, body) = request_refill(&state, "RX-E", PATIENT_WALLET).await;
        assert_eq!(status, 422);
        assert_eq!(body["error"]["code"], "REFILL_NOT_AVAILABLE");
    }

    #[actix_web::test]
    async fn an_over_long_note_is_rejected() {
        let state = state_with(prescription("RX-F", 2)).await;
        let note = "x".repeat(MAX_PATIENT_NOTE_CHARS + 1);
        let request = test::TestRequest::post()
            .uri("/api/e-prescriptions/RX-F/refill-requests")
            .set_json(serde_json::json!({ "note": note }));
        assert_eq!(call(&state, request, PATIENT_WALLET).await.0, 400);
    }

    #[actix_web::test]
    async fn approval_decrements_the_original_and_creates_a_linked_unsigned_prescription() {
        let state = state_with(prescription("RX-G", 2)).await;
        let (_, created) = request_refill(&state, "RX-G", PATIENT_WALLET).await;
        let uri = format!(
            "/api/refill-requests/{}/approve",
            created["request"]["id"].as_str().unwrap()
        );
        let (status, body) = call(&state, test::TestRequest::post().uri(&uri), OTHER_DOCTOR).await;
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["request"]["status"], "approved");
        assert_eq!(stored_rx(&state, "RX-G").await.refills_remaining, 1);
        let new_rx = stored_rx(&state, body["new_prescription_id"].as_str().unwrap()).await;
        assert_eq!(new_rx.refill_of.as_deref(), Some("RX-G"));
        assert!(matches!(new_rx.status, PrescriptionStatus::Draft));
        assert!(new_rx.signature.is_none() && new_rx.refills_remaining == 0);
        assert_eq!(new_rx.prescriber_id, OTHER_DOCTOR);
        assert_eq!(audit_actions(&state).await.len(), 2);
    }

    #[actix_web::test]
    async fn only_a_doctor_can_decide() {
        let state = state_with(prescription("RX-H", 2)).await;
        let (_, created) = request_refill(&state, "RX-H", PATIENT_WALLET).await;
        let uri = format!(
            "/api/refill-requests/{}/approve",
            created["request"]["id"].as_str().unwrap()
        );
        let (status, body) = call(&state, test::TestRequest::post().uri(&uri), NURSE).await;
        assert_eq!(status, 403);
        assert_eq!(body["error"]["code"], "PRESCRIBER_REQUIRED");
        assert_eq!(
            call(&state, test::TestRequest::post().uri(&uri), PATIENT_WALLET)
                .await
                .0,
            403
        );
        assert_eq!(stored_rx(&state, "RX-H").await.refills_remaining, 2);
    }

    #[actix_web::test]
    async fn a_denial_needs_a_real_reason_and_the_patient_can_read_it() {
        let state = state_with(prescription("RX-I", 2)).await;
        let (_, created) = request_refill(&state, "RX-I", PATIENT_WALLET).await;
        let uri = format!(
            "/api/refill-requests/{}/deny",
            created["request"]["id"].as_str().unwrap()
        );
        let short = test::TestRequest::post()
            .uri(&uri)
            .set_json(serde_json::json!({ "reason": "  no  " }));
        assert_eq!(call(&state, short, PRESCRIBER).await.0, 400);
        let reason = "Blood pressure review needed before another month.";
        let real = test::TestRequest::post()
            .uri(&uri)
            .set_json(serde_json::json!({ "reason": reason }));
        assert_eq!(call(&state, real, PRESCRIBER).await.0, 200);
        let list =
            test::TestRequest::get().uri(&format!("/api/patients/{PATIENT_ID}/refill-requests"));
        let (_, body) = call(&state, list, PATIENT_WALLET).await;
        assert_eq!(body["requests"][0]["status"], "denied");
        assert_eq!(body["requests"][0]["denial_reason"], reason);
        assert_eq!(stored_rx(&state, "RX-I").await.refills_remaining, 2);
    }

    #[actix_web::test]
    async fn a_patient_cancels_their_own_open_request_only() {
        let state = state_with(prescription("RX-J", 2)).await;
        let (_, created) = request_refill(&state, "RX-J", PATIENT_WALLET).await;
        let uri = format!(
            "/api/refill-requests/{}/cancel",
            created["request"]["id"].as_str().unwrap()
        );
        assert_eq!(
            call(&state, test::TestRequest::post().uri(&uri), STRANGER)
                .await
                .0,
            403
        );
        assert_eq!(
            call(&state, test::TestRequest::post().uri(&uri), PATIENT_WALLET)
                .await
                .0,
            200
        );
        let (status, body) =
            call(&state, test::TestRequest::post().uri(&uri), PATIENT_WALLET).await;
        assert_eq!(status, 409);
        assert_eq!(body["error"]["code"], "REFILL_ALREADY_CLOSED");
        // A new request is possible once the old one is closed.
        assert_eq!(request_refill(&state, "RX-J", PATIENT_WALLET).await.0, 201);
    }

    #[actix_web::test]
    async fn the_queue_shows_a_doctor_only_open_requests_on_their_own_prescriptions() {
        let state = state_with(prescription("RX-K", 2)).await;
        request_refill(&state, "RX-K", PATIENT_WALLET).await;
        let queue = || test::TestRequest::get().uri("/api/refill-requests/queue");
        let (_, own) = call(&state, queue(), PRESCRIBER).await;
        assert_eq!(own["requests"].as_array().unwrap().len(), 1);
        let (_, other) = call(&state, queue(), OTHER_DOCTOR).await;
        assert!(other["requests"].as_array().unwrap().is_empty());
        assert_eq!(call(&state, queue(), NURSE).await.0, 403);
    }

    /// A refill store whose every call fails, to prove failures are reported.
    #[derive(Debug)]
    struct FailingStore;

    #[async_trait::async_trait]
    impl RefillRequestRepository for FailingStore {
        async fn create(&self, _: RefillRequestEntity) -> RepositoryResult<RefillRequestEntity> {
            Err(crate::repositories::RepositoryError::Database(
                "down".into(),
            ))
        }
        async fn get_by_id(&self, _: &str) -> RepositoryResult<Option<RefillRequestEntity>> {
            Err(crate::repositories::RepositoryError::Database(
                "down".into(),
            ))
        }
        async fn list_by_patient(&self, _: &str) -> RepositoryResult<Vec<RefillRequestEntity>> {
            Err(crate::repositories::RepositoryError::Database(
                "down".into(),
            ))
        }
        async fn list_open_by_prescriber(
            &self,
            _: &str,
        ) -> RepositoryResult<Vec<RefillRequestEntity>> {
            Err(crate::repositories::RepositoryError::Database(
                "down".into(),
            ))
        }
        async fn close_if_open(
            &self,
            _: &RefillClosure,
        ) -> RepositoryResult<Option<RefillRequestEntity>> {
            Err(crate::repositories::RepositoryError::Database(
                "down".into(),
            ))
        }
    }

    #[actix_web::test]
    async fn a_storage_failure_is_a_503_with_a_safe_message_never_an_empty_list() {
        let mut state = AppState::new();
        state.users.write().unwrap().insert(
            PATIENT_WALLET.into(),
            user(PATIENT_WALLET, crate::Role::Patient, Some(PATIENT_ID)),
        );
        state.repositories.refill_requests = std::sync::Arc::new(FailingStore);
        let rx = prescription("RX-L", 2);
        state
            .repositories
            .e_prescriptions_v2
            .create(prescription_record(&rx, "RX-L"))
            .await
            .unwrap();
        let state = web::Data::new(state);
        let (status, body) = request_refill(&state, "RX-L", PATIENT_WALLET).await;
        assert_eq!(status, 503);
        assert_eq!(body["error"]["code"], "REFILL_REQUESTS_UNAVAILABLE");
        assert!(
            !body.to_string().contains("down"),
            "the storage error must not leak"
        );
        let list =
            test::TestRequest::get().uri(&format!("/api/patients/{PATIENT_ID}/refill-requests"));
        assert_eq!(call(&state, list, PATIENT_WALLET).await.0, 503);
    }
}
