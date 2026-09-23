//! `clinical_endpoints::billing::e_prescriptions` — Phase 29 e-prescription handlers.
//!
//! Split out of the former single-file `billing.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `billing/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// ============================================================================
// PHASE 29: PRESCRIPTION E-SIGNING
// ============================================================================

/// Create e-prescription request
#[derive(Debug, Deserialize)]
pub struct CreateEPrescriptionRequest {
    pub patient_id: String,
    pub medication_name: String,
    #[serde(default)]
    pub medication_code: Option<String>,
    #[serde(default)]
    pub policy_category: Option<String>,
    /// May only strengthen a matching deployment-supplied policy rule.
    #[serde(default)]
    pub force_secondary_verification: bool,
    pub generic_name: Option<String>,
    pub strength: String,
    pub form: String,
    pub quantity: u32,
    pub days_supply: u16,
    pub directions: String,
    pub refills_allowed: u8,
    pub is_controlled: bool,
    pub dea_schedule: Option<String>,
    pub pharmacy_ncpdp: String,
    pub pharmacy_name: String,
    pub diagnosis_codes: Vec<String>,
    pub patient_instructions: String,
    pub pharmacy_notes: Option<String>,
}

/// Create a new e-prescription (Phase 29 E-Signature)
#[post("/api/e-prescriptions")]
// The `users` RwLock guard is explicitly `drop()`-ed before this handler's await
// points; clippy's await_holding_lock doesn't recognize manual drops here.
#[allow(clippy::await_holding_lock)]
pub async fn create_esignature_prescription(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateEPrescriptionRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let current_user = match require_known_user(&data, &current_user_id) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    // Only doctors can prescribe
    if !matches!(current_user.role, crate::Role::Doctor) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only physicians can create prescriptions".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // A prescription for nobody. The live store held five with `patient_id: ""`
    // -- one marked Dispensed -- that sat in the pharmacist's queue under a
    // blank name, and were listed for no patient, so nobody could ever see
    // what had been dispensed against them.
    if let Err(resp) = require_known_patient(&data, &req.patient_id).await {
        return resp;
    }

    let prescription_id = format!("RX-{}", uuid::Uuid::new_v4());
    let now = chrono::Utc::now().timestamp();
    let expires_at = now + (365 * 24 * 60 * 60); // 1 year
    let verification_policy =
        match crate::dispensing_policy::decide(crate::dispensing_policy::PolicySubject {
            medication_code: req.medication_code.as_deref(),
            category: req.policy_category.as_deref(),
            medication_name: &req.medication_name,
            force_secondary_verification: req.force_secondary_verification,
        }) {
            Ok(decision) => decision,
            Err(error) => {
                log::error!("Dispensing policy evaluation failed: {error}");
                return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                    success: false,
                    error: "The approved dispensing policy could not be evaluated".to_string(),
                    code: "DISPENSING_POLICY_UNAVAILABLE".to_string(),
                });
            }
        };

    let prescription = crate::clinical::EPrescription {
        prescription_id: prescription_id.clone(),
        patient_id: req.patient_id.clone(),
        prescriber_id: current_user_id.clone(),
        prescriber_name: current_user.name.clone(),
        prescriber_npi: "1234567890".to_string(), // Demo NPI
        prescriber_dea: if req.is_controlled {
            Some("AA1234567".to_string())
        } else {
            None
        },
        medication: crate::clinical::PrescribedMedication {
            rxcui: None,
            ndc: None,
            name: req.medication_name.clone(),
            generic_name: req.generic_name.clone(),
            strength: req.strength.clone(),
            form: req.form.clone(),
            quantity: req.quantity,
            quantity_unit: "tablets".to_string(),
            days_supply: req.days_supply,
            directions: req.directions.clone(),
            daw_code: 0,
        },
        pharmacy: crate::clinical::EPharmacyInfo {
            ncpdp_id: req.pharmacy_ncpdp.clone(),
            npi: "9876543210".to_string(),
            name: req.pharmacy_name.clone(),
            address: "123 Pharmacy St".to_string(),
            city: "Medical City".to_string(),
            state: "SA".to_string(),
            zip: "12345".to_string(),
            phone: "(555) 123-4567".to_string(),
            fax: None,
            is_mail_order: false,
            is_24_hour: false,
            accepts_epcs: true,
        },
        status: crate::clinical::PrescriptionStatus::Draft,
        created_at: now,
        signed_at: None,
        signature: None,
        transmitted_at: None,
        transmission_status: None,
        is_controlled: req.is_controlled,
        dea_schedule: req.dea_schedule.clone(),
        dispensed_quantity: 0,
        secondary_verification: crate::clinical::SecondaryDispensingVerification {
            required: verification_policy.required,
            status: if verification_policy.required {
                crate::clinical::SecondaryVerificationStatus::Required
            } else {
                crate::clinical::SecondaryVerificationStatus::NotRequired
            },
            policy_version: verification_policy.version,
            policy_rule_id: verification_policy.rule_id,
            verification_ttl_seconds: verification_policy.ttl_seconds,
            ..Default::default()
        },
        refills_allowed: req.refills_allowed,
        refills_remaining: req.refills_allowed,
        last_filled: None,
        expires_at,
        pharmacy_notes: req.pharmacy_notes.clone(),
        patient_instructions: req.patient_instructions.clone(),
        diagnosis_codes: req.diagnosis_codes.clone(),
    };

    let patient_id_for_notify = req.patient_id.clone();
    let medication_name_for_notify = req.medication_name.clone();

    {
        // Persist via repository (was: in-memory data.e_prescriptions_v2 HashMap)
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: prescription_id.clone(),
            owner_id: prescription.patient_id.clone(),
            data: serde_json::to_value(&prescription).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        if let Err(e) = data.repositories.e_prescriptions_v2.create(entity).await {
            log::error!("E-prescription persistence failed for {prescription_id}: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "E-prescription could not be saved".to_string(),
                code: "PRESCRIPTION_PERSISTENCE_FAILED".to_string(),
            });
        }
    }

    // Fire-and-forget FCM push notification to the patient.
    let state = data.clone();
    tokio::spawn(async move {
        crate::notifications::notify_patient(
            &state,
            &patient_id_for_notify,
            &["recordUpdates", "pushNotifications"],
            "New Prescription",
            &format!(
                "A new prescription for {} has been issued. Please check MediChain.",
                medication_name_for_notify
            ),
            "prescription",
        )
        .await;
    });

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "prescription_id": prescription_id,
        "status": "draft",
        "message": "E-prescription created. Signature required before transmission."
    }))
}

/// The exact string `PrescriptionStatus` serialises to.
///
/// The transition guards compare against the *stored* JSON, so they must use
/// the serde representation. Deriving it means a future `rename_all` moves the
/// guards with it instead of silently disabling every transition.
fn status_token(status: &crate::clinical::PrescriptionStatus) -> String {
    serde_json::to_value(status)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

fn prescription_record(
    prescription: &crate::clinical::EPrescription,
    id: &str,
) -> crate::repositories::traits::JsonRecordEntity {
    let now = chrono::Utc::now();
    crate::repositories::traits::JsonRecordEntity {
        id: id.to_string(),
        owner_id: prescription.patient_id.clone(),
        data: serde_json::to_value(prescription).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    }
}

/// Record a prescription lifecycle transition in the durable access log.
///
fn prescription_audit(
    prescription: &crate::clinical::EPrescription,
    actor: &str,
    actor_role: &str,
    event: &str,
) -> crate::repositories::traits::AccessLogEntity {
    crate::AccessLogEntry {
        access_id: crate::middleware::secure_tokens::generate_access_id(),
        patient_id: prescription.patient_id.clone(),
        accessor_id: actor.to_string(),
        accessor_role: actor_role.to_string(),
        access_type: event.to_string(),
        location: None,
        timestamp: chrono::Utc::now(),
        emergency: false,
    }
    .into()
}

/// The client-observable facts an e-signature attests to.
///
/// These used to be the literals `"127.0.0.1"` and `"MediChain/1.0"`, written
/// into every signature regardless of where the request came from. A signature
/// record whose provenance fields are invented is worse than one that admits it
/// does not know: it reads as evidence in an audit and is not. When the peer
/// address or user agent is genuinely unavailable, that is what gets stored.
fn signature_provenance(http_req: &HttpRequest) -> (String, String) {
    const UNKNOWN: &str = "unavailable";
    let ip = http_req
        .connection_info()
        .realip_remote_addr()
        .map(str::to_string)
        .unwrap_or_else(|| UNKNOWN.to_string());
    let user_agent = http_req
        .headers()
        .get(actix_web::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.is_empty())
        .unwrap_or(UNKNOWN)
        .to_string();
    (ip, user_agent)
}

/// Sign e-prescription request
///
/// Carried an `Option<String> password` that no client sent and no handler
/// read. A password accepted over the wire for nothing is a liability rather
/// than spare capacity -- it reaches request logs and proxy traces having
/// bought nothing. Signing is authenticated by the session and attested by
/// `attestation`.
#[derive(Debug, Deserialize)]
pub struct SignPrescriptionRequest {
    pub signature_method: String,
    pub attestation: String,
}

/// Sign an e-prescription
#[post("/api/e-prescriptions/{prescription_id}/sign")]
// The `users` RwLock guard is explicitly `drop()`-ed before this handler's await
// points; clippy's await_holding_lock doesn't recognize manual drops here.
#[allow(clippy::await_holding_lock)]
pub async fn sign_e_prescription(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<SignPrescriptionRequest>,
) -> impl Responder {
    let prescription_id = path.into_inner();

    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let current_user = match require_known_user(&data, &current_user_id) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    let mut prescription = match load_prescription(&data, &prescription_id).await {
        Ok(prescription) => prescription,
        Err(response) => return response,
    };

    // Only prescriber can sign
    if prescription.prescriber_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only the prescriber can sign this prescription".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let now = chrono::Utc::now().timestamp();
    let signature_method = match req.signature_method.as_str() {
        "password" => crate::clinical::SignatureMethod::Password,
        "biometric" => crate::clinical::SignatureMethod::Biometric,
        "smartcard" => crate::clinical::SignatureMethod::SmartCard,
        "token" => crate::clinical::SignatureMethod::Token,
        "two_factor" => crate::clinical::SignatureMethod::TwoFactor,
        _ => crate::clinical::SignatureMethod::Password,
    };

    // Only an unsigned prescription may be signed.
    //
    // Without this, signing was reachable from *any* state: a transmitted
    // prescription could be re-signed, which replaced the existing signature
    // and walked `status` backwards from `Transmitted` to `Signed`. The
    // pharmacy had already been sent the instruction; the record then claimed
    // it had not been.
    let signable = matches!(
        prescription.status,
        crate::clinical::PrescriptionStatus::Draft | crate::clinical::PrescriptionStatus::Pending
    );
    if !signable {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: format!(
                "Prescription cannot be signed from state '{}'",
                status_token(&prescription.status)
            ),
            code: "NOT_SIGNABLE".to_string(),
        });
    }
    let previous_status = status_token(&prescription.status);

    let (ip_address, user_agent) = signature_provenance(&http_req);
    prescription.signature = Some(crate::clinical::ESignature {
        signature_id: format!("SIG-{}", uuid::Uuid::new_v4()),
        signer_id: current_user_id.clone(),
        signer_name: current_user.name.clone(),
        signer_credential: "MD".to_string(),
        signed_at: now,
        signature_method,
        ip_address,
        user_agent,
        certificate_thumbprint: None,
        attestation: req.attestation.clone(),
    });
    prescription.signed_at = Some(now);
    prescription.status = crate::clinical::PrescriptionStatus::Signed;

    // Atomic transition, guarded on the state read above. Two concurrent
    // signing requests would otherwise both commit, and the second would
    // overwrite the first clinician's signature with its own.
    match data
        .repositories
        .apply_prescription_mutation(crate::repositories::PrescriptionMutation {
            prescription_id: prescription_id.clone(),
            guard_field: "status".to_string(),
            expected_value: previous_status,
            record: prescription_record(&prescription, &prescription_id),
            events: Vec::new(),
            audit: prescription_audit(
                &prescription,
                &current_user_id,
                &current_user.role.to_string(),
                "prescription_signed",
            ),
        })
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Prescription was already signed or its state changed".to_string(),
                code: "NOT_SIGNABLE".to_string(),
            });
        }
        Err(e) => {
            log::error!("E-prescription signing failed for {prescription_id}: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Signature could not be saved".to_string(),
                code: "PRESCRIPTION_PERSISTENCE_FAILED".to_string(),
            });
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "prescription_id": prescription_id,
        "status": "signed",
        "signed_at": now,
        "message": "E-prescription signed successfully. Ready for transmission."
    }))
}

/// Transmit e-prescription to pharmacy
#[post("/api/e-prescriptions/{prescription_id}/transmit")]
pub async fn transmit_e_prescription(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let prescription_id = path.into_inner();

    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    let current_user_id = current_user.wallet_address.clone();

    let mut prescription = match load_prescription(&data, &prescription_id).await {
        Ok(prescription) => prescription,
        Err(response) => return response,
    };

    // Must be signed first
    if prescription.status != crate::clinical::PrescriptionStatus::Signed {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Prescription must be signed before transmission".to_string(),
            code: "NOT_SIGNED".to_string(),
        });
    }

    // Only prescriber can transmit
    if prescription.prescriber_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only the prescriber can transmit this prescription".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let now = chrono::Utc::now().timestamp();
    prescription.transmitted_at = Some(now);
    prescription.transmission_status = Some(crate::clinical::TransmissionStatus::Sent);
    prescription.status = crate::clinical::PrescriptionStatus::Transmitted;

    // Atomic transition out of `Signed`. The `status != Signed` check above is
    // a read; on its own it let two concurrent transmissions both succeed, and
    // a prescription sent twice is a prescription a pharmacy may dispense
    // twice. The guard is what makes transmission happen once.
    match data
        .repositories
        .apply_prescription_mutation(crate::repositories::PrescriptionMutation {
            prescription_id: prescription_id.clone(),
            guard_field: "status".to_string(),
            expected_value: status_token(&crate::clinical::PrescriptionStatus::Signed),
            record: prescription_record(&prescription, &prescription_id),
            events: Vec::new(),
            audit: prescription_audit(
                &prescription,
                &current_user_id,
                &current_user.role.to_string(),
                "prescription_transmitted",
            ),
        })
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Prescription is no longer awaiting transmission".to_string(),
                code: "ALREADY_TRANSMITTED".to_string(),
            });
        }
        Err(e) => {
            log::error!("E-prescription transmission failed for {prescription_id}: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Transmission could not be recorded".to_string(),
                code: "PRESCRIPTION_PERSISTENCE_FAILED".to_string(),
            });
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "prescription_id": prescription_id,
        "status": "transmitted",
        "transmitted_at": now,
        "pharmacy": prescription.pharmacy.name,
        "message": "E-prescription transmitted to pharmacy"
    }))
}

/// Get e-prescription details (Phase 29 E-Signature)
// ============================================================================
// Pharmacy dispensing (SCR-013)
// ============================================================================
//
// The prescription lifecycle used to stop at `Transmitted`. `Received`,
// `InProgress`, `Dispensed` and `PartialFill` were declared and unreachable,
// and a pharmacist could see a real transmitted prescription and do nothing
// with it.
//
// WHY QUANTITY IS THE CONCURRENCY GUARD
//
// `replace_if_field_eq` guards a transition on one field. For sign and transmit
// that field is `status`, because those happen once. Dispensing does not: a
// prescription may be filled in several parts, so `status` is `InProgress` or
// `PartialFill` before AND after, and guarding on it would let two pharmacists
// filling the same prescription at the same moment both succeed and hand out
// more than was prescribed.
//
// The guard is therefore `dispensed_quantity`: read the running total, write
// total + n only if it is still what was read. The loser of a race sees a
// mismatch and is told to retry against the new total. That is optimistic
// concurrency, and it makes over-dispensing impossible rather than unlikely.
//
// WHAT A REVERSAL IS
//
// Not a state regression. A correction is a new event that references the one
// it corrects, and the original stays. A dispense that never happened must not
// be erasable, because the question afterwards is not only "how much does the
// patient have" but "who said they had it".

#[derive(Debug, serde::Deserialize)]
pub struct DispenseBody {
    /// Units being handed over now. Must be positive and must not exceed what
    /// the prescription still owes.
    pub quantity: u32,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct ReverseDispenseBody {
    /// The dispense event being corrected.
    pub dispense_event_id: String,
    pub reason: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct VerificationDecisionBody {
    pub approve: bool,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct VerificationRevokeBody {
    pub reason: String,
}

/// Only a pharmacist dispenses. An administrator may correct.
fn may_dispense(role: &crate::Role) -> bool {
    matches!(role, crate::Role::Pharmacist)
}

fn may_reverse(role: &crate::Role) -> bool {
    matches!(role, crate::Role::Pharmacist | crate::Role::Admin)
}

fn dispense_role_refused(role: &crate::Role) -> HttpResponse {
    HttpResponse::Forbidden().json(ErrorResponse {
        success: false,
        error: format!("Role {role} cannot dispense. Required: Pharmacist"),
        code: "INSUFFICIENT_ROLE".to_string(),
    })
}

fn verification_status_token(status: &crate::clinical::SecondaryVerificationStatus) -> String {
    serde_json::to_value(status)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default()
}

async fn transition_verification(
    data: &web::Data<AppState>,
    prescription: &crate::clinical::EPrescription,
    expected: &crate::clinical::SecondaryVerificationStatus,
    events: Vec<crate::repositories::traits::JsonRecordEntity>,
    actor: &crate::User,
    audit_action: &str,
) -> Result<(), HttpResponse> {
    match data
        .repositories
        .apply_prescription_mutation(crate::repositories::PrescriptionMutation {
            prescription_id: prescription.prescription_id.clone(),
            guard_field: "secondary_verification.status".to_string(),
            expected_value: verification_status_token(expected),
            record: prescription_record(prescription, &prescription.prescription_id),
            events: events
                .into_iter()
                .map(|event| {
                    (
                        crate::repositories::PrescriptionEventTarget::Verification,
                        event,
                    )
                })
                .collect(),
            audit: prescription_audit(
                prescription,
                &actor.wallet_address,
                &actor.role.to_string(),
                audit_action,
            ),
        })
        .await
    {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err(HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: "The verification state changed; reload the prescription".to_string(),
            code: "VERIFICATION_RACE_DETECTED".to_string(),
        })),
        Err(error) => {
            log::error!("Secondary verification transition failed: {error}");
            Err(HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "The verification decision could not be saved".to_string(),
                code: "PRESCRIPTION_PERSISTENCE_FAILED".to_string(),
            }))
        }
    }
}

fn verification_event(
    prescription: &crate::clinical::EPrescription,
    event_id: String,
    event_type: &str,
    actor: &str,
    reason: Option<&str>,
    closed: bool,
) -> crate::repositories::traits::JsonRecordEntity {
    let now = Utc::now();
    crate::repositories::traits::JsonRecordEntity {
        id: event_id.clone(),
        owner_id: prescription.patient_id.clone(),
        data: serde_json::json!({
            "event_id": event_id,
            "event_type": event_type,
            "prescription_id": prescription.prescription_id,
            "patient_id": prescription.patient_id,
            "actor_id": actor,
            "reason": reason,
            "request_id": prescription.secondary_verification.request_id,
            "policy_version": prescription.secondary_verification.policy_version,
            "policy_rule_id": prescription.secondary_verification.policy_rule_id,
            "recorded_at": now.timestamp(),
            "closed": closed,
        }),
        created_at: now,
        updated_at: now,
    }
}

/// Loads a prescription, or the response explaining why it could not be.
async fn load_prescription(
    data: &web::Data<AppState>,
    prescription_id: &str,
) -> Result<crate::clinical::EPrescription, HttpResponse> {
    match data
        .repositories
        .e_prescriptions_v2
        .get_by_id(prescription_id)
        .await
    {
        Ok(Some(entity)) => serde_json::from_value(entity.data).map_err(|e| {
            log::error!("Prescription {prescription_id} could not be decoded: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "The prescription could not be read".to_string(),
                code: "PRESCRIPTION_DECODE_FAILED".to_string(),
            })
        }),
        Ok(None) => Err(HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Prescription not found".to_string(),
            code: "PRESCRIPTION_NOT_FOUND".to_string(),
        })),
        Err(e) => {
            log::error!("Prescription lookup failed for {prescription_id}: {e}");
            Err(HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "The prescription could not be read".to_string(),
                code: "PRESCRIPTION_UNAVAILABLE".to_string(),
            }))
        }
    }
}

/// Moves a prescription between two lifecycle states, guarded on the state it
/// is leaving so the transition happens exactly once.
async fn transition_status(
    data: &web::Data<AppState>,
    prescription: &mut crate::clinical::EPrescription,
    prescription_id: &str,
    from: crate::clinical::PrescriptionStatus,
    to: crate::clinical::PrescriptionStatus,
    actor: &crate::User,
    audit_action: &str,
) -> Result<(), HttpResponse> {
    prescription.status = to;
    match data
        .repositories
        .apply_prescription_mutation(crate::repositories::PrescriptionMutation {
            prescription_id: prescription_id.to_string(),
            guard_field: "status".to_string(),
            expected_value: status_token(&from),
            record: prescription_record(prescription, prescription_id),
            events: Vec::new(),
            audit: prescription_audit(
                prescription,
                &actor.wallet_address,
                &actor.role.to_string(),
                audit_action,
            ),
        })
        .await
    {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err(HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: format!("This prescription is no longer {}", status_token(&from)),
            code: "PRESCRIPTION_NOT_IN_EXPECTED_STATE".to_string(),
        })),
        Err(e) => {
            log::error!("Prescription transition failed for {prescription_id}: {e}");
            Err(HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "The transition could not be recorded".to_string(),
                code: "PRESCRIPTION_PERSISTENCE_FAILED".to_string(),
            }))
        }
    }
}

/// A pharmacy acknowledges a transmitted prescription.
#[post("/api/e-prescriptions/{prescription_id}/receive")]
pub async fn receive_prescription(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    if !may_dispense(&current_user.role) {
        return dispense_role_refused(&current_user.role);
    }
    let prescription_id = path.into_inner();
    let mut prescription = match load_prescription(&data, &prescription_id).await {
        Ok(p) => p,
        Err(resp) => return resp,
    };
    prescription.secondary_verification.first_pharmacist_id =
        Some(current_user.wallet_address.clone());
    if let Err(resp) = transition_status(
        &data,
        &mut prescription,
        &prescription_id,
        crate::clinical::PrescriptionStatus::Transmitted,
        crate::clinical::PrescriptionStatus::Received,
        &current_user,
        "prescription_received",
    )
    .await
    {
        return resp;
    }
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "prescription_id": prescription_id,
        "status": status_token(&prescription.status),
    }))
}

/// A pharmacist begins preparing the medicine.
#[post("/api/e-prescriptions/{prescription_id}/start")]
pub async fn start_prescription_fill(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    if !may_dispense(&current_user.role) {
        return dispense_role_refused(&current_user.role);
    }
    let prescription_id = path.into_inner();
    let mut prescription = match load_prescription(&data, &prescription_id).await {
        Ok(p) => p,
        Err(resp) => return resp,
    };
    if let Err(resp) = transition_status(
        &data,
        &mut prescription,
        &prescription_id,
        crate::clinical::PrescriptionStatus::Received,
        crate::clinical::PrescriptionStatus::InProgress,
        &current_user,
        "prescription_fill_started",
    )
    .await
    {
        return resp;
    }
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "prescription_id": prescription_id,
        "status": status_token(&prescription.status),
    }))
}

/// The first pharmacist requests a distinct second-person verification.
#[post("/api/e-prescriptions/{prescription_id}/verification/request")]
pub async fn request_secondary_verification(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if !may_dispense(&current_user.role) {
        return dispense_role_refused(&current_user.role);
    }
    let prescription_id = path.into_inner();
    let mut prescription = match load_prescription(&data, &prescription_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if !prescription.secondary_verification.required {
        return HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: "This prescription does not require secondary verification".to_string(),
            code: "VERIFICATION_NOT_REQUIRED".to_string(),
        });
    }
    if prescription
        .secondary_verification
        .first_pharmacist_id
        .as_deref()
        != Some(current_user.wallet_address.as_str())
    {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only the first pharmacist may request verification".to_string(),
            code: "VERIFICATION_REQUESTER_MISMATCH".to_string(),
        });
    }
    let expected = prescription.secondary_verification.status.clone();
    if !matches!(
        expected,
        crate::clinical::SecondaryVerificationStatus::Required
            | crate::clinical::SecondaryVerificationStatus::Rejected
            | crate::clinical::SecondaryVerificationStatus::Expired
            | crate::clinical::SecondaryVerificationStatus::Revoked
    ) {
        return verification_state_conflict(&expected);
    }
    let ttl = match prescription
        .secondary_verification
        .verification_ttl_seconds
        .filter(|seconds| *seconds > 0)
    {
        Some(value) => value,
        None => return verification_policy_missing(),
    };
    let now = Utc::now();
    let request_id = format!("RXV-{}", uuid::Uuid::new_v4());
    prescription.secondary_verification.status =
        crate::clinical::SecondaryVerificationStatus::Pending;
    prescription.secondary_verification.request_id = Some(request_id.clone());
    prescription.secondary_verification.requested_by = Some(current_user.wallet_address.clone());
    prescription.secondary_verification.requested_at = Some(now.timestamp());
    prescription.secondary_verification.expires_at =
        Some((now + chrono::Duration::seconds(ttl)).timestamp());
    prescription.secondary_verification.verified_by = None;
    prescription.secondary_verification.verified_at = None;
    prescription.secondary_verification.decision_reason = None;
    let event = verification_event(
        &prescription,
        request_id.clone(),
        "verification_requested",
        &current_user.wallet_address,
        None,
        false,
    );
    if let Err(response) = transition_verification(
        &data,
        &prescription,
        &expected,
        vec![event],
        &current_user,
        "prescription_verification_requested",
    )
    .await
    {
        return response;
    }
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "prescription_id": prescription_id,
        "request_id": request_id,
        "verification_status": "Pending",
        "expires_at": prescription.secondary_verification.expires_at,
    }))
}

fn verification_state_conflict(
    status: &crate::clinical::SecondaryVerificationStatus,
) -> HttpResponse {
    HttpResponse::Conflict().json(ErrorResponse {
        success: false,
        error: format!(
            "Verification cannot be requested while in state {}",
            verification_status_token(status)
        ),
        code: "VERIFICATION_STATE_CONFLICT".to_string(),
    })
}

fn verification_policy_missing() -> HttpResponse {
    HttpResponse::ServiceUnavailable().json(ErrorResponse {
        success: false,
        error: "The approved verification policy is incomplete".to_string(),
        code: "DISPENSING_POLICY_UNAVAILABLE".to_string(),
    })
}

async fn closed_verification_request(
    data: &web::Data<AppState>,
    request_id: &str,
    outcome: &str,
) -> Result<crate::repositories::traits::JsonRecordEntity, HttpResponse> {
    let mut request = match data
        .repositories
        .prescription_verification_events
        .get_by_id(request_id)
        .await
    {
        Ok(Some(value)) => value,
        Ok(None) => {
            return Err(HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: "The verification request history is missing".to_string(),
                code: "VERIFICATION_HISTORY_MISSING".to_string(),
            }))
        }
        Err(error) => {
            log::error!("Verification request history read failed: {error}");
            return Err(verification_policy_missing());
        }
    };
    request.data["closed"] = serde_json::Value::Bool(true);
    request.data["outcome"] = serde_json::Value::String(outcome.to_string());
    request.updated_at = Utc::now();
    Ok(request)
}

/// A distinct active pharmacist approves or rejects one pending request.
#[post("/api/e-prescriptions/{prescription_id}/verification/decide")]
pub async fn decide_secondary_verification(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<VerificationDecisionBody>,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if !may_dispense(&current_user.role) {
        return dispense_role_refused(&current_user.role);
    }
    let prescription_id = path.into_inner();
    let mut prescription = match load_prescription(&data, &prescription_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if prescription.secondary_verification.status
        != crate::clinical::SecondaryVerificationStatus::Pending
    {
        return verification_state_conflict(&prescription.secondary_verification.status);
    }
    if verifier_is_not_distinct(&prescription, &current_user.wallet_address) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "A distinct second pharmacist is required".to_string(),
            code: "SECOND_PHARMACIST_MUST_BE_DISTINCT".to_string(),
        });
    }
    if !body.approve
        && body
            .reason
            .as_deref()
            .is_none_or(|value| value.trim().is_empty())
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "A rejection reason is required".to_string(),
            code: "VERIFICATION_REASON_REQUIRED".to_string(),
        });
    }
    if prescription
        .secondary_verification
        .expires_at
        .is_none_or(|expiry| expiry <= Utc::now().timestamp())
    {
        return expire_secondary_verification(&data, prescription, &current_user).await;
    }
    let request_id = match prescription.secondary_verification.request_id.clone() {
        Some(value) => value,
        None => return verification_policy_missing(),
    };
    let now = Utc::now();
    let outcome = if body.approve { "approved" } else { "rejected" };
    prescription.secondary_verification.status = if body.approve {
        crate::clinical::SecondaryVerificationStatus::Verified
    } else {
        crate::clinical::SecondaryVerificationStatus::Rejected
    };
    prescription.secondary_verification.verified_by = Some(current_user.wallet_address.clone());
    prescription.secondary_verification.verified_at = Some(now.timestamp());
    prescription.secondary_verification.decision_reason =
        body.reason.as_deref().map(str::trim).map(str::to_string);
    let closed_request = match closed_verification_request(&data, &request_id, outcome).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let event_id = format!("RXV-DEC-{}", uuid::Uuid::new_v4());
    let event = verification_event(
        &prescription,
        event_id,
        if body.approve {
            "verification_approved"
        } else {
            "verification_rejected"
        },
        &current_user.wallet_address,
        body.reason.as_deref(),
        true,
    );
    let audit_action = if body.approve {
        "prescription_verification_approved"
    } else {
        "prescription_verification_rejected"
    };
    if let Err(response) = transition_verification(
        &data,
        &prescription,
        &crate::clinical::SecondaryVerificationStatus::Pending,
        vec![closed_request, event],
        &current_user,
        audit_action,
    )
    .await
    {
        return response;
    }
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "prescription_id": prescription_id,
        "request_id": request_id,
        "verification_status": verification_status_token(
            &prescription.secondary_verification.status
        ),
    }))
}

fn verifier_is_not_distinct(prescription: &crate::clinical::EPrescription, verifier: &str) -> bool {
    verifier == prescription.prescriber_id
        || prescription
            .secondary_verification
            .first_pharmacist_id
            .as_deref()
            == Some(verifier)
        || prescription.secondary_verification.requested_by.as_deref() == Some(verifier)
}

async fn expire_secondary_verification(
    data: &web::Data<AppState>,
    mut prescription: crate::clinical::EPrescription,
    actor: &crate::User,
) -> HttpResponse {
    prescription.secondary_verification.status =
        crate::clinical::SecondaryVerificationStatus::Expired;
    let mut events = vec![verification_event(
        &prescription,
        format!("RXV-EXP-{}", uuid::Uuid::new_v4()),
        "verification_expired",
        &actor.wallet_address,
        None,
        true,
    )];
    if let Some(request_id) = prescription.secondary_verification.request_id.as_deref() {
        match closed_verification_request(data, request_id, "expired").await {
            Ok(request) => events.push(request),
            Err(response) => return response,
        }
    }
    if let Err(response) = transition_verification(
        data,
        &prescription,
        &crate::clinical::SecondaryVerificationStatus::Pending,
        events,
        actor,
        "prescription_verification_expired",
    )
    .await
    {
        return response;
    }
    HttpResponse::Conflict().json(ErrorResponse {
        success: false,
        error: "The secondary verification request expired".to_string(),
        code: "VERIFICATION_EXPIRED".to_string(),
    })
}

/// Revoke a pending/approved check without erasing its prior decision.
#[post("/api/e-prescriptions/{prescription_id}/verification/revoke")]
pub async fn revoke_secondary_verification(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<VerificationRevokeBody>,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if !matches!(
        current_user.role,
        crate::Role::Pharmacist | crate::Role::Admin
    ) {
        return dispense_role_refused(&current_user.role);
    }
    if body.reason.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "A revocation reason is required".to_string(),
            code: "VERIFICATION_REASON_REQUIRED".to_string(),
        });
    }
    let prescription_id = path.into_inner();
    let mut prescription = match load_prescription(&data, &prescription_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let expected = prescription.secondary_verification.status.clone();
    if !matches!(
        expected,
        crate::clinical::SecondaryVerificationStatus::Pending
            | crate::clinical::SecondaryVerificationStatus::Verified
    ) {
        return verification_state_conflict(&expected);
    }
    let authorized_pharmacist = prescription.secondary_verification.requested_by.as_deref()
        == Some(current_user.wallet_address.as_str())
        || prescription.secondary_verification.verified_by.as_deref()
            == Some(current_user.wallet_address.as_str());
    if current_user.role != crate::Role::Admin && !authorized_pharmacist {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only a party to the verification or an administrator may revoke it".to_string(),
            code: "VERIFICATION_REVOCATION_FORBIDDEN".to_string(),
        });
    }
    prescription.secondary_verification.status =
        crate::clinical::SecondaryVerificationStatus::Revoked;
    prescription.secondary_verification.decision_reason = Some(body.reason.trim().to_string());
    let mut events = Vec::new();
    if let Some(request_id) = prescription.secondary_verification.request_id.as_deref() {
        match closed_verification_request(&data, request_id, "revoked").await {
            Ok(request) => events.push(request),
            Err(response) => return response,
        }
    }
    events.push(verification_event(
        &prescription,
        format!("RXV-REV-{}", uuid::Uuid::new_v4()),
        "verification_revoked",
        &current_user.wallet_address,
        Some(body.reason.trim()),
        true,
    ));
    if let Err(response) = transition_verification(
        &data,
        &prescription,
        &expected,
        events,
        &current_user,
        "prescription_verification_revoked",
    )
    .await
    {
        return response;
    }
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "prescription_id": prescription_id,
        "verification_status": "Revoked",
    }))
}

/// Hand over medicine, in whole or in part.
#[post("/api/e-prescriptions/{prescription_id}/dispense")]
pub async fn dispense_prescription(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<DispenseBody>,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    if !may_dispense(&current_user.role) {
        return dispense_role_refused(&current_user.role);
    }
    if body.quantity == 0 {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "A dispense must hand over at least one unit".to_string(),
            code: "QUANTITY_MUST_BE_POSITIVE".to_string(),
        });
    }

    let prescription_id = path.into_inner();
    let mut prescription = match load_prescription(&data, &prescription_id).await {
        Ok(p) => p,
        Err(resp) => return resp,
    };
    if prescription.secondary_verification.required
        && prescription.secondary_verification.status
            != crate::clinical::SecondaryVerificationStatus::Verified
    {
        return HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: "Secondary pharmacist verification is required before dispensing".to_string(),
            code: "SECONDARY_VERIFICATION_REQUIRED".to_string(),
        });
    }

    // Dispensing is only legal from a state a pharmacy has taken responsibility
    // for. A transmitted-but-unreceived prescription has not reached anybody,
    // and a cancelled or expired one must not be filled at all.
    let dispensable = matches!(
        prescription.status,
        crate::clinical::PrescriptionStatus::Received
            | crate::clinical::PrescriptionStatus::InProgress
            | crate::clinical::PrescriptionStatus::PartialFill
    );
    if !dispensable {
        return HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: format!(
                "A prescription in state {} cannot be dispensed",
                status_token(&prescription.status)
            ),
            code: "PRESCRIPTION_NOT_DISPENSABLE".to_string(),
        });
    }

    let prescribed = prescription.medication.quantity;
    let already = prescription.dispensed_quantity;
    let remaining = prescribed.saturating_sub(already);
    if body.quantity > remaining {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: format!(
                "This prescription has {remaining} {} remaining; {} was requested",
                prescription.medication.quantity_unit, body.quantity
            ),
            code: "QUANTITY_EXCEEDS_REMAINING".to_string(),
        });
    }

    let new_total = already + body.quantity;
    let now = Utc::now();
    // Complete when nothing is owed, partially filled otherwise.
    prescription.status = if new_total == prescribed {
        crate::clinical::PrescriptionStatus::Dispensed
    } else {
        crate::clinical::PrescriptionStatus::PartialFill
    };
    prescription.dispensed_quantity = new_total;
    prescription.last_filled = Some(now.timestamp());

    let event_id = format!("DISP-{}", uuid::Uuid::new_v4());
    let event = crate::repositories::traits::JsonRecordEntity {
        id: event_id.clone(),
        owner_id: prescription.patient_id.clone(),
        data: serde_json::json!({
            "dispense_event_id": event_id,
            "prescription_id": prescription_id,
            "patient_id": prescription.patient_id,
            "pharmacist_id": current_user.wallet_address,
            "quantity": body.quantity,
            "quantity_unit": prescription.medication.quantity_unit,
            "dispensed_total_after": new_total,
            "prescribed_quantity": prescribed,
            "notes": body.notes,
            "dispensed_at": now.timestamp(),
            "reversed": false,
        }),
        created_at: now,
        updated_at: now,
    };
    let audit_action = if new_total == prescribed {
        "prescription_dispensed"
    } else {
        "prescription_partial_fill"
    };
    match data
        .repositories
        .apply_prescription_mutation(crate::repositories::PrescriptionMutation {
            prescription_id: prescription_id.clone(),
            guard_field: "dispensed_quantity".to_string(),
            expected_value: already.to_string(),
            record: prescription_record(&prescription, &prescription_id),
            events: vec![(
                crate::repositories::PrescriptionEventTarget::Dispense,
                event,
            )],
            audit: prescription_audit(
                &prescription,
                &current_user.wallet_address,
                &current_user.role.to_string(),
                audit_action,
            ),
        })
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => {
            return HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: "Another fill was recorded while this one was being prepared; \
                        re-read the prescription and dispense the remainder"
                    .to_string(),
                code: "DISPENSE_RACE_DETECTED".to_string(),
            })
        }
        Err(e) => {
            log::error!("Dispense failed for {prescription_id}: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "The dispense could not be recorded".to_string(),
                code: "PRESCRIPTION_PERSISTENCE_FAILED".to_string(),
            });
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "prescription_id": prescription_id,
        "dispense_event_id": event_id,
        "status": status_token(&prescription.status),
        "dispensed_now": body.quantity,
        "dispensed_total": new_total,
        "prescribed_quantity": prescribed,
        "remaining": prescribed - new_total,
    }))
}

/// Correct a dispense that should not have been recorded.
///
/// The original event is kept and marked, and a correction entry is added. The
/// running total goes down so the patient can be given what they are owed, but
/// the history still says the first dispense happened and who recorded it.
#[post("/api/e-prescriptions/{prescription_id}/dispense/reverse")]
pub async fn reverse_dispense(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<ReverseDispenseBody>,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    if !may_reverse(&current_user.role) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!("Role {} cannot reverse a dispense", current_user.role),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }
    if body.reason.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "A reason is required to reverse a dispense".to_string(),
            code: "REASON_REQUIRED".to_string(),
        });
    }

    let prescription_id = path.into_inner();
    let original = match data
        .repositories
        .dispense_events
        .get_by_id(&body.dispense_event_id)
        .await
    {
        Ok(Some(e)) => e,
        Ok(None) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Dispense event not found".to_string(),
                code: "DISPENSE_EVENT_NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            log::error!("Dispense event lookup failed: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "The dispense event could not be read".to_string(),
                code: "PRESCRIPTION_UNAVAILABLE".to_string(),
            });
        }
    };
    if original.data["reversed"].as_bool().unwrap_or(false) {
        return HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: "This dispense has already been reversed".to_string(),
            code: "ALREADY_REVERSED".to_string(),
        });
    }
    if original.data["prescription_id"].as_str() != Some(prescription_id.as_str()) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "That dispense event belongs to a different prescription".to_string(),
            code: "DISPENSE_EVENT_MISMATCH".to_string(),
        });
    }

    let reversed_quantity = original.data["quantity"].as_u64().unwrap_or(0) as u32;
    let mut prescription = match load_prescription(&data, &prescription_id).await {
        Ok(p) => p,
        Err(resp) => return resp,
    };
    let already = prescription.dispensed_quantity;
    let new_total = already.saturating_sub(reversed_quantity);
    prescription.dispensed_quantity = new_total;
    prescription.status = if new_total == 0 {
        crate::clinical::PrescriptionStatus::InProgress
    } else {
        crate::clinical::PrescriptionStatus::PartialFill
    };

    // Mark the original rather than deleting it, and add the correction.
    let now = Utc::now();
    let mut marked = original.clone();
    marked.data["reversed"] = serde_json::Value::Bool(true);
    marked.updated_at = now;
    let correction_id = format!("DISP-REV-{}", uuid::Uuid::new_v4());
    let correction = crate::repositories::traits::JsonRecordEntity {
        id: correction_id.clone(),
        owner_id: prescription.patient_id.clone(),
        data: serde_json::json!({
            "dispense_event_id": correction_id,
            "reverses_event_id": body.dispense_event_id,
            "prescription_id": prescription_id,
            "patient_id": prescription.patient_id,
            "pharmacist_id": current_user.wallet_address,
            "quantity": reversed_quantity,
            "correction": true,
            "reason": body.reason.trim(),
            "dispensed_total_after": new_total,
            "recorded_at": now.timestamp(),
        }),
        created_at: now,
        updated_at: now,
    };
    match data
        .repositories
        .apply_prescription_mutation(crate::repositories::PrescriptionMutation {
            prescription_id: prescription_id.clone(),
            guard_field: "dispensed_quantity".to_string(),
            expected_value: already.to_string(),
            record: prescription_record(&prescription, &prescription_id),
            events: vec![
                (
                    crate::repositories::PrescriptionEventTarget::Dispense,
                    marked,
                ),
                (
                    crate::repositories::PrescriptionEventTarget::Dispense,
                    correction,
                ),
            ],
            audit: prescription_audit(
                &prescription,
                &current_user.wallet_address,
                &current_user.role.to_string(),
                "prescription_dispense_reversed",
            ),
        })
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => {
            return HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: "The dispensed total changed while this reversal was being prepared"
                    .to_string(),
                code: "DISPENSE_RACE_DETECTED".to_string(),
            })
        }
        Err(e) => {
            log::error!("Dispense reversal failed for {prescription_id}: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "The reversal and its audit history could not be recorded".to_string(),
                code: "PRESCRIPTION_PERSISTENCE_FAILED".to_string(),
            });
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "prescription_id": prescription_id,
        "reversed_event_id": body.dispense_event_id,
        "correction_event_id": correction_id,
        "dispensed_total": new_total,
        "status": status_token(&prescription.status),
    }))
}

/// The dispensing history for a prescription, corrections included.
#[get("/api/e-prescriptions/{prescription_id}/dispense-events")]
pub async fn list_dispense_events(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    if !matches!(
        current_user.role,
        crate::Role::Pharmacist | crate::Role::Doctor | crate::Role::Admin
    ) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!("Role {} cannot read dispensing history", current_user.role),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }
    let prescription_id = path.into_inner();
    match data.repositories.dispense_events.list_all().await {
        Ok(rows) => {
            let events: Vec<_> = rows
                .into_iter()
                .filter(|e| e.data["prescription_id"].as_str() == Some(prescription_id.as_str()))
                .map(|e| e.data)
                .collect();
            HttpResponse::Ok().json(serde_json::json!({ "dispense_events": events }))
        }
        Err(e) => {
            log::error!("Dispense history read failed: {e}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Dispensing history could not be read".to_string(),
                code: "PRESCRIPTION_UNAVAILABLE".to_string(),
            })
        }
    }
}

#[get("/api/e-prescriptions/{prescription_id}")]
pub async fn get_esignature_prescription(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let prescription_id = path.into_inner();

    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let prescription = match load_prescription(&data, &prescription_id).await {
        Ok(prescription) => prescription,
        Err(response) => return response,
    };

    // Patient or prescriber can view
    if prescription.patient_id != current_user_id && prescription.prescriber_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "prescription": prescription
    }))
}

/// Get patient's e-prescriptions
#[get("/api/e-prescriptions/patient/{patient_id}")]
// The `users` RwLock guard is explicitly `drop()`-ed before this handler's await
// points; clippy's await_holding_lock doesn't recognize manual drops here.
#[allow(clippy::await_holding_lock)]
pub async fn get_patient_e_prescriptions(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<crate::pagination::CursorQuery>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // Registered caller, NOT clinical-staff-only — a patient must be able to
    // read their own prescriptions. `require_clinical_staff` rejected them with
    // INSUFFICIENT_ROLE before the `is_own || is_provider` check below could
    // run, making that check dead code for patients. The prescribe/dispense
    // routes in this file keep the staff gate.
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let current_user = match require_known_user(&data, &current_user_id) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    let is_own = crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id);
    if !is_own && !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let records = match data
        .repositories
        .e_prescriptions_v2
        .get_by_owner(&patient_id)
        .await
    {
        Ok(records) => records,
        Err(error) => {
            log::error!("Patient prescription list failed: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Prescriptions are temporarily unavailable".to_string(),
                code: "PRESCRIPTIONS_UNAVAILABLE".to_string(),
            });
        }
    };
    let (page, next_cursor) =
        crate::pagination::paginate_cursor(&records, query.cursor.as_deref(), query.limit);
    let patient_prescriptions: Vec<crate::clinical::EPrescription> = page
        .into_iter()
        .filter_map(|r| serde_json::from_value::<crate::clinical::EPrescription>(r.data).ok())
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "prescriptions": patient_prescriptions,
        "count": patient_prescriptions.len(),
        "next_cursor": next_cursor
    }))
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    use actix_web::{test, App};

    fn prescriber() -> crate::User {
        crate::User {
            wallet_address: "doctor_rx".to_string(),
            username: None,
            name: "Dr Prescriber".to_string(),
            role: crate::Role::Doctor,
            created_at: chrono::Utc::now(),
            created_by: None,
            linked_patient_id: None,
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        }
    }

    fn pharmacist(wallet: &str) -> crate::User {
        crate::User {
            wallet_address: wallet.to_string(),
            username: None,
            name: format!("Pharmacist {wallet}"),
            role: crate::Role::Pharmacist,
            created_at: chrono::Utc::now(),
            created_by: None,
            linked_patient_id: None,
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: Some(format!("SAPC-{wallet}")),
            status: "active".to_string(),
            last_login: None,
        }
    }

    /// A prescription in a given state, stored the way the handlers read it.
    async fn state_with(id: &str, status: crate::clinical::PrescriptionStatus) -> crate::AppState {
        let state = crate::AppState::new();
        let user = prescriber();
        state
            .users
            .write()
            .unwrap()
            .insert(user.wallet_address.clone(), user);

        // Built from the real type, not hand-written JSON. A shape mismatch
        // here does not fail loudly: the handler's
        // `.and_then(|rec| serde_json::from_value(rec.data).ok())` turns a
        // deserialisation failure into 404 "Prescription not found", so a
        // wrong fixture reads as a missing record.
        let prescription = crate::clinical::EPrescription {
            prescription_id: id.to_string(),
            patient_id: "PAT-RX".to_string(),
            prescriber_id: "doctor_rx".to_string(),
            prescriber_name: "Dr Prescriber".to_string(),
            prescriber_npi: "1234567890".to_string(),
            prescriber_dea: None,
            medication: crate::clinical::PrescribedMedication {
                rxcui: None,
                ndc: None,
                name: "Amoxicillin".to_string(),
                generic_name: None,
                strength: "500mg".to_string(),
                form: "capsule".to_string(),
                quantity: 21,
                quantity_unit: "capsule".to_string(),
                days_supply: 7,
                directions: "one capsule three times a day".to_string(),
                daw_code: 0,
            },
            pharmacy: crate::clinical::EPharmacyInfo {
                ncpdp_id: "1234567".to_string(),
                npi: "9876543210".to_string(),
                name: "Test Pharmacy".to_string(),
                address: "1 Test Street".to_string(),
                city: "Testville".to_string(),
                state: "GP".to_string(),
                zip: "0001".to_string(),
                phone: "(555) 123-4567".to_string(),
                fax: None,
                is_mail_order: false,
                is_24_hour: false,
                accepts_epcs: true,
            },
            status,
            created_at: chrono::Utc::now().timestamp(),
            signed_at: None,
            signature: None,
            transmitted_at: None,
            transmission_status: None,
            is_controlled: false,
            dea_schedule: None,
            dispensed_quantity: 0,
            secondary_verification: Default::default(),
            refills_allowed: 0,
            refills_remaining: 0,
            last_filled: None,
            expires_at: chrono::Utc::now().timestamp() + 86_400,
            pharmacy_notes: None,
            patient_instructions: "Take with food".to_string(),
            diagnosis_codes: Vec::new(),
        };

        let now = chrono::Utc::now();
        state
            .repositories
            .e_prescriptions_v2
            .create(crate::repositories::traits::JsonRecordEntity {
                id: id.to_string(),
                owner_id: "PAT-RX".to_string(),
                data: serde_json::to_value(&prescription).expect("serialise fixture"),
                created_at: now,
                updated_at: now,
            })
            .await
            .expect("seed prescription");
        state
    }

    async fn require_secondary_verification(
        state: &crate::AppState,
        id: &str,
        status: crate::clinical::SecondaryVerificationStatus,
    ) {
        let stored = state
            .repositories
            .e_prescriptions_v2
            .get_by_id(id)
            .await
            .unwrap()
            .unwrap();
        let mut prescription: crate::clinical::EPrescription =
            serde_json::from_value(stored.data).unwrap();
        prescription.secondary_verification = crate::clinical::SecondaryDispensingVerification {
            required: true,
            status,
            policy_version: Some("test-policy-1".into()),
            policy_rule_id: Some("test-rule".into()),
            verification_ttl_seconds: Some(900),
            first_pharmacist_id: Some("pharmacist_a".into()),
            ..Default::default()
        };
        state
            .repositories
            .e_prescriptions_v2
            .create(prescription_record(&prescription, id))
            .await
            .unwrap();
        let mut users = state.users.write().unwrap();
        for wallet in ["pharmacist_a", "pharmacist_b", "pharmacist_c"] {
            users.insert(wallet.to_string(), pharmacist(wallet));
        }
    }

    async fn stored_status(state: &crate::AppState, id: &str) -> String {
        state
            .repositories
            .e_prescriptions_v2
            .get_by_id(id)
            .await
            .unwrap()
            .expect("prescription present")
            .data["status"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    }

    /// Signing a prescription that has already been sent to a pharmacy used to
    /// succeed: it replaced the signature and reset `status` from `Transmitted`
    /// back to `Signed`, so the record denied a transmission that had happened.
    #[actix_web::test]
    async fn a_transmitted_prescription_cannot_be_re_signed() {
        let state = state_with("RX-1", crate::clinical::PrescriptionStatus::Transmitted).await;
        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(sign_e_prescription),
        )
        .await;

        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/e-prescriptions/RX-1/sign")
                .insert_header(("x-user-id", "doctor_rx"))
                .set_json(serde_json::json!({
                    "signature_method": "password",
                    "attestation": "I attest"
                }))
                .to_request(),
        )
        .await;

        assert_eq!(resp.status(), 400);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["error"]["code"], "NOT_SIGNABLE");
        assert_eq!(stored_status(&app_state, "RX-1").await, "Transmitted");
    }

    /// The intended path still works, and the signature records where the
    /// request actually came from rather than a hardcoded loopback address.
    #[actix_web::test]
    async fn a_draft_can_be_signed_and_records_real_provenance() {
        let state = state_with("RX-2", crate::clinical::PrescriptionStatus::Draft).await;
        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(sign_e_prescription),
        )
        .await;

        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/e-prescriptions/RX-2/sign")
                .insert_header(("x-user-id", "doctor_rx"))
                .insert_header(("user-agent", "MediChainTest/9.9"))
                .set_json(serde_json::json!({
                    "signature_method": "password",
                    "attestation": "I attest"
                }))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), 200);
        assert_eq!(stored_status(&app_state, "RX-2").await, "Signed");

        let stored = app_state
            .repositories
            .e_prescriptions_v2
            .get_by_id("RX-2")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.data["signature"]["user_agent"], "MediChainTest/9.9");
        assert_ne!(
            stored.data["signature"]["ip_address"], "127.0.0.1",
            "the signature must not attest an invented peer address"
        );

        // Signing is a moment of personal clinical responsibility and must be
        // attributable afterwards.
        let logs = app_state
            .repositories
            .access_logs
            .get_by_patient(
                "PAT-RX",
                crate::repositories::traits::Pagination::new(0, 50),
            )
            .await
            .expect("access logs readable");
        assert!(
            logs.items.iter().any(|l| l.action == "prescription_signed"),
            "signing must be audited"
        );
    }

    /// A *sequential* second transmission is refused.
    ///
    /// This does not prove the concurrent case, and it passes with the atomic
    /// guard removed: the pre-existing `status != Signed` read already rejects
    /// a second call once the first has committed. The interleaving where both
    /// callers read `Signed` before either writes is proved against the shared
    /// `replace_if_field_eq` primitive — the same `pg_json_repo!` macro backs
    /// this table — in `repositories::postgres::tests`.
    ///
    /// The distinction matters clinically: a prescription transmitted twice is
    /// one a pharmacy may dispense twice.
    #[actix_web::test]
    async fn a_sequential_second_transmission_is_refused() {
        let state = state_with("RX-3", crate::clinical::PrescriptionStatus::Signed).await;
        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(transmit_e_prescription),
        )
        .await;

        let first = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/e-prescriptions/RX-3/transmit")
                .insert_header(("x-user-id", "doctor_rx"))
                .to_request(),
        )
        .await;
        assert_eq!(first.status(), 200);

        let second = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/e-prescriptions/RX-3/transmit")
                .insert_header(("x-user-id", "doctor_rx"))
                .to_request(),
        )
        .await;
        assert_eq!(second.status(), 400);
        assert_eq!(stored_status(&app_state, "RX-3").await, "Transmitted");
    }

    #[actix_web::test]
    async fn required_verification_blocks_direct_dispense_and_self_approval() {
        let state = state_with("RX-V1", crate::clinical::PrescriptionStatus::InProgress).await;
        require_secondary_verification(
            &state,
            "RX-V1",
            crate::clinical::SecondaryVerificationStatus::Required,
        )
        .await;
        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state)
                .service(request_secondary_verification)
                .service(decide_secondary_verification)
                .service(dispense_prescription),
        )
        .await;

        let blocked = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/e-prescriptions/RX-V1/dispense")
                .insert_header(("x-user-id", "pharmacist_a"))
                .set_json(serde_json::json!({ "quantity": 1 }))
                .to_request(),
        )
        .await;
        assert_eq!(blocked.status(), 409);

        let requested = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/e-prescriptions/RX-V1/verification/request")
                .insert_header(("x-user-id", "pharmacist_a"))
                .to_request(),
        )
        .await;
        assert_eq!(requested.status(), 200);

        let self_decision = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/e-prescriptions/RX-V1/verification/decide")
                .insert_header(("x-user-id", "pharmacist_a"))
                .set_json(serde_json::json!({ "approve": true }))
                .to_request(),
        )
        .await;
        assert_eq!(self_decision.status(), 403);
    }

    #[actix_web::test]
    async fn distinct_pharmacist_approval_enables_exactly_this_prescription() {
        let state = state_with("RX-V2", crate::clinical::PrescriptionStatus::InProgress).await;
        require_secondary_verification(
            &state,
            "RX-V2",
            crate::clinical::SecondaryVerificationStatus::Required,
        )
        .await;
        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(request_secondary_verification)
                .service(decide_secondary_verification)
                .service(dispense_prescription),
        )
        .await;
        let request = test::TestRequest::post()
            .uri("/api/e-prescriptions/RX-V2/verification/request")
            .insert_header(("x-user-id", "pharmacist_a"))
            .to_request();
        assert_eq!(test::call_service(&app, request).await.status(), 200);

        let approve = test::TestRequest::post()
            .uri("/api/e-prescriptions/RX-V2/verification/decide")
            .insert_header(("x-user-id", "pharmacist_b"))
            .set_json(serde_json::json!({ "approve": true }))
            .to_request();
        assert_eq!(test::call_service(&app, approve).await.status(), 200);

        let replay = test::TestRequest::post()
            .uri("/api/e-prescriptions/RX-V2/verification/decide")
            .insert_header(("x-user-id", "pharmacist_c"))
            .set_json(serde_json::json!({ "approve": true }))
            .to_request();
        assert_eq!(test::call_service(&app, replay).await.status(), 409);

        let dispense = test::TestRequest::post()
            .uri("/api/e-prescriptions/RX-V2/dispense")
            .insert_header(("x-user-id", "pharmacist_a"))
            .set_json(serde_json::json!({ "quantity": 1 }))
            .to_request();
        assert_eq!(test::call_service(&app, dispense).await.status(), 200);

        let events = app_state
            .repositories
            .prescription_verification_events
            .list_all()
            .await
            .unwrap();
        assert_eq!(events.len(), 2);
    }

    #[actix_web::test]
    async fn concurrent_second_pharmacists_cannot_both_approve() {
        let state = state_with("RX-V3", crate::clinical::PrescriptionStatus::InProgress).await;
        require_secondary_verification(
            &state,
            "RX-V3",
            crate::clinical::SecondaryVerificationStatus::Pending,
        )
        .await;
        let data = web::Data::new(state);
        let stored = load_prescription(&data, "RX-V3").await.unwrap();
        let mut first = stored.clone();
        first.secondary_verification.status =
            crate::clinical::SecondaryVerificationStatus::Verified;
        first.secondary_verification.verified_by = Some("pharmacist_b".into());
        let mut second = stored;
        second.secondary_verification.status =
            crate::clinical::SecondaryVerificationStatus::Verified;
        second.secondary_verification.verified_by = Some("pharmacist_c".into());
        let pharmacist_b = pharmacist("pharmacist_b");
        let pharmacist_c = pharmacist("pharmacist_c");

        let (left, right) = tokio::join!(
            transition_verification(
                &data,
                &first,
                &crate::clinical::SecondaryVerificationStatus::Pending,
                Vec::new(),
                &pharmacist_b,
                "prescription_verification_approved",
            ),
            transition_verification(
                &data,
                &second,
                &crate::clinical::SecondaryVerificationStatus::Pending,
                Vec::new(),
                &pharmacist_c,
                "prescription_verification_approved",
            )
        );
        assert_ne!(left.is_ok(), right.is_ok());
    }
}

/// A prescription must name a patient who exists. Five were stored for
/// `patient_id: ""`, reached the pharmacist's queue under a blank name, and
/// were listed for no patient.
#[cfg(test)]
mod patient_required_tests {
    use crate::test_fixtures::{register, seed_patient};
    use crate::{AppState, Role};
    use actix_web::{test, web, App};

    fn prescription_for(patient_id: &str) -> serde_json::Value {
        serde_json::json!({
            "patient_id": patient_id,
            "medication_name": "Amoxicillin",
            "generic_name": null,
            "strength": "500mg",
            "form": "capsule",
            "quantity": 21,
            "days_supply": 7,
            "directions": "One three times daily",
            "refills_allowed": 0,
            "is_controlled": false,
            "dea_schedule": null,
            "pharmacy_ncpdp": "SYN-001",
            "pharmacy_name": "Synthetic Pharmacy",
            "diagnosis_codes": [],
            "patient_instructions": "With food",
            "pharmacy_notes": null
        })
    }

    #[actix_rt::test]
    async fn a_prescription_names_a_registered_patient_or_is_refused() {
        let state = AppState::new();
        register(&state, "5Doctor", Role::Doctor);
        seed_patient(&state, "PAT-1").await;
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .service(super::create_esignature_prescription),
        )
        .await;

        let mut outcomes = Vec::new();
        for (patient_id, expected_code) in [
            ("", Some("MISSING_PATIENT_ID")),
            ("PAT-nobody", Some("PATIENT_NOT_FOUND")),
            ("PAT-1", None),
        ] {
            let req = test::TestRequest::post()
                .uri("/api/e-prescriptions")
                .insert_header(("X-User-Id", "5Doctor"))
                .set_json(prescription_for(patient_id))
                .to_request();
            let resp = test::call_service(&app, req).await;
            let status = resp.status().as_u16();
            let body: serde_json::Value = test::read_body_json(resp).await;
            let code = body["error"]["code"].as_str();
            outcomes.push((status, code.map(str::to_string)));
            assert_eq!(code, expected_code, "patient_id {patient_id:?}: {body}");
        }
        assert_eq!(outcomes[0].0, 400);
        assert_eq!(outcomes[1].0, 404);
        assert!(
            outcomes[2].0 < 300,
            "a real patient's prescription is created: {outcomes:?}"
        );
    }
}
