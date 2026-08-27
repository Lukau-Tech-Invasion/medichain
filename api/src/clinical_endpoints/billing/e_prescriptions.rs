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

    let prescription_id = format!("RX-{}", uuid::Uuid::new_v4());
    let now = chrono::Utc::now().timestamp();
    let expires_at = now + (365 * 24 * 60 * 60); // 1 year

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
    let repos = data.repositories.clone();
    tokio::spawn(async move {
        crate::notifications::notify_prescription(
            &repos,
            &patient_id_for_notify,
            &medication_name_for_notify,
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
/// Signing and transmitting a prescription are the two points at which a
/// clinician takes personal responsibility for a controlled instruction, and
/// neither was audited at all. A failure here is returned to the caller rather
/// than logged, for the same reason the transition itself is: an unattributable
/// signature is not a signature.
async fn audit_prescription_event(
    data: &web::Data<crate::AppState>,
    prescription: &crate::clinical::EPrescription,
    actor: &str,
    actor_role: &str,
    event: &str,
) -> Result<(), crate::repositories::traits::RepositoryError> {
    data.repositories
        .access_logs
        .create(
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
            .into(),
        )
        .await
        .map(|_| ())
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
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct SignPrescriptionRequest {
    pub signature_method: String,
    pub attestation: String,
    pub password: Option<String>,
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

    let mut prescription: crate::clinical::EPrescription = match data
        .repositories
        .e_prescriptions_v2
        .get_by_id(&prescription_id)
        .await
        .ok()
        .flatten()
        .and_then(|rec| serde_json::from_value(rec.data).ok())
    {
        Some(p) => p,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Prescription not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
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
        .e_prescriptions_v2
        .replace_if_field_eq(
            &prescription_id,
            "status",
            &previous_status,
            prescription_record(&prescription, &prescription_id),
        )
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

    if let Err(e) = audit_prescription_event(
        &data,
        &prescription,
        &current_user_id,
        &current_user.role.to_string(),
        "prescription_signed",
    )
    .await
    {
        log::error!("E-prescription signing audit failed for {prescription_id}: {e}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Signature could not be audited".to_string(),
            code: "AUDIT_UNAVAILABLE".to_string(),
        });
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

    let mut prescription: crate::clinical::EPrescription = match data
        .repositories
        .e_prescriptions_v2
        .get_by_id(&prescription_id)
        .await
        .ok()
        .flatten()
        .and_then(|rec| serde_json::from_value(rec.data).ok())
    {
        Some(p) => p,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Prescription not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
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
        .e_prescriptions_v2
        .replace_if_field_eq(
            &prescription_id,
            "status",
            &status_token(&crate::clinical::PrescriptionStatus::Signed),
            prescription_record(&prescription, &prescription_id),
        )
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

    if let Err(e) = audit_prescription_event(
        &data,
        &prescription,
        &current_user_id,
        &current_user.role.to_string(),
        "prescription_transmitted",
    )
    .await
    {
        log::error!("E-prescription transmission audit failed for {prescription_id}: {e}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Transmission could not be audited".to_string(),
            code: "AUDIT_UNAVAILABLE".to_string(),
        });
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
) -> Result<(), HttpResponse> {
    prescription.status = to;
    match data
        .repositories
        .e_prescriptions_v2
        .replace_if_field_eq(
            prescription_id,
            "status",
            &status_token(&from),
            prescription_record(prescription, prescription_id),
        )
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
    if let Err(resp) = transition_status(
        &data,
        &mut prescription,
        &prescription_id,
        crate::clinical::PrescriptionStatus::Transmitted,
        crate::clinical::PrescriptionStatus::Received,
    )
    .await
    {
        return resp;
    }
    if let Err(e) = audit_prescription_event(
        &data,
        &prescription,
        &current_user.wallet_address,
        &current_user.role.to_string(),
        "prescription_received",
    )
    .await
    {
        log::error!("Dispensing audit failed for {prescription_id}: {e}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "The dispensing step could not be audited".to_string(),
            code: "AUDIT_UNAVAILABLE".to_string(),
        });
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
    )
    .await
    {
        return resp;
    }
    if let Err(e) = audit_prescription_event(
        &data,
        &prescription,
        &current_user.wallet_address,
        &current_user.role.to_string(),
        "prescription_fill_started",
    )
    .await
    {
        log::error!("Dispensing audit failed for {prescription_id}: {e}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "The dispensing step could not be audited".to_string(),
            code: "AUDIT_UNAVAILABLE".to_string(),
        });
    }
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "prescription_id": prescription_id,
        "status": status_token(&prescription.status),
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

    // Guarded on the QUANTITY, not the status: the status is unchanged across a
    // partial fill, so guarding on it would let two concurrent fills both
    // succeed and hand out more than was prescribed.
    match data
        .repositories
        .e_prescriptions_v2
        .replace_if_field_eq(
            &prescription_id,
            "dispensed_quantity",
            &already.to_string(),
            prescription_record(&prescription, &prescription_id),
        )
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

    // The event history. Written after the quantity is committed, and never
    // deleted -- a correction adds an entry rather than removing one.
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
    if let Err(e) = data.repositories.dispense_events.create(event).await {
        log::error!("Dispense event history write failed for {prescription_id}: {e}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "The dispense was recorded but its history entry was not; \
                    do not hand over further medicine until this is resolved"
                .to_string(),
            code: "DISPENSE_HISTORY_FAILED".to_string(),
        });
    }

    if let Err(e) = audit_prescription_event(
        &data,
        &prescription,
        &current_user.wallet_address,
        &current_user.role.to_string(),
        if new_total == prescribed {
            "prescription_dispensed"
        } else {
            "prescription_partial_fill"
        },
    )
    .await
    {
        log::error!("Dispensing audit failed for {prescription_id}: {e}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "The dispensing step could not be audited".to_string(),
            code: "AUDIT_UNAVAILABLE".to_string(),
        });
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

    // Same quantity guard as dispensing, for the same reason.
    match data
        .repositories
        .e_prescriptions_v2
        .replace_if_field_eq(
            &prescription_id,
            "dispensed_quantity",
            &already.to_string(),
            prescription_record(&prescription, &prescription_id),
        )
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
                error: "The reversal could not be recorded".to_string(),
                code: "PRESCRIPTION_PERSISTENCE_FAILED".to_string(),
            });
        }
    }

    // Mark the original rather than deleting it, and add the correction.
    let now = Utc::now();
    let mut marked = original.clone();
    marked.data["reversed"] = serde_json::Value::Bool(true);
    marked.updated_at = now;
    if let Err(e) = data.repositories.dispense_events.create(marked).await {
        log::error!("Marking the reversed dispense failed: {e}");
    }
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
    if let Err(e) = data.repositories.dispense_events.create(correction).await {
        log::error!("Dispense correction history write failed: {e}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "The reversal was applied but its history entry was not".to_string(),
            code: "DISPENSE_HISTORY_FAILED".to_string(),
        });
    }

    if let Err(e) = audit_prescription_event(
        &data,
        &prescription,
        &current_user.wallet_address,
        &current_user.role.to_string(),
        "prescription_dispense_reversed",
    )
    .await
    {
        log::error!("Dispensing audit failed for {prescription_id}: {e}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "The dispensing step could not be audited".to_string(),
            code: "AUDIT_UNAVAILABLE".to_string(),
        });
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

    let prescription: crate::clinical::EPrescription = match data
        .repositories
        .e_prescriptions_v2
        .get_by_id(&prescription_id)
        .await
        .ok()
        .flatten()
        .and_then(|rec| serde_json::from_value(rec.data).ok())
    {
        Some(p) => p,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Prescription not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
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

    let records = data
        .repositories
        .e_prescriptions_v2
        .get_by_owner(&patient_id)
        .await
        .unwrap_or_default();
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
}
