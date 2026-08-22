//! `clinical_endpoints::medical_id::emergency_views` — emergency-only and lock-screen
//! Medical ID views (reduced-auth first-responder access).
//!
//! Split out of the former single-file `medical_id.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `medical_id/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

/// Every allergy known for a patient, merged from the allergies repository and
/// the patient's own encrypted profile.
///
/// Patient registration writes allergies into the profile's `emergency_info`
/// and **never** into the allergies repository. Both first-responder views read
/// only the repository, so every allergy captured at registration was invisible
/// on the card whose entire purpose is to stop a responder administering
/// something that will harm the patient. Merged by allergen name, repository
/// entries winning (a clinician-entered record carries a real severity
/// assessment; a registration entry does not).
async fn merged_allergies(
    data: &web::Data<AppState>,
    patient: &crate::repositories::traits::PatientEntity,
    patient_id: &str,
) -> Vec<crate::repositories::traits::AllergyEntity> {
    let mut allergies = data
        .repositories
        .allergies
        .get_by_patient(patient_id)
        .await
        .unwrap_or_default();

    if let Some(profile) = crate::patient_entity_to_profile(patient, &data.encryption_keyring) {
        let known: std::collections::HashSet<String> = allergies
            .iter()
            .map(|a| a.allergen.to_lowercase())
            .collect();
        let now = Utc::now();
        for a in profile.emergency_info.allergies {
            if known.contains(&a.name.to_lowercase()) {
                continue;
            }
            allergies.push(crate::repositories::traits::AllergyEntity {
                id: format!("ALG-PROFILE-{}-{}", patient_id, a.name.to_lowercase()),
                patient_id: patient_id.to_string(),
                allergen: a.name,
                allergen_type: "unspecified".to_string(),
                reaction: a.reaction,
                severity: a.severity.to_string(),
                onset_date: None,
                last_occurrence: None,
                verified: false,
                verified_by: None,
                verified_at: a.verified_at,
                source: Some("patient_registration".to_string()),
                created_at: now,
                updated_at: now,
                created_by: "registration".to_string(),
                is_active: true,
            });
        }
    }
    allergies
}

/// The active, verified primary guardian's contact info for a ward, if any —
/// surfaced to first responders and on the lock screen so emergency access
/// shows a *verified* guardian (name + phone from their own account) rather
/// than only the free-text `emergency_contact_*` fields typed in at
/// registration. Prefers a parent/legal guardian over other relationship
/// types (e.g. power of attorney) when a ward has more than one. Returns
/// `Value::Null` when no active guardian relationship exists, so callers
/// fall back to the pre-existing free-text emergency contact.
async fn primary_guardian_contact_json(
    data: &web::Data<AppState>,
    patient_id: &str,
) -> serde_json::Value {
    let now = chrono::Utc::now();
    let mut relationships = data
        .repositories
        .guardian_relationships
        .get_by_ward(patient_id)
        .await
        .unwrap_or_default();
    relationships.retain(|r| r.active && r.expires_at.map(|e| e > now).unwrap_or(true));
    relationships.sort_by_key(|r| {
        if r.relationship_type == "parent_or_guardian" {
            0
        } else {
            1
        }
    });

    let Some(primary) = relationships.into_iter().next() else {
        return serde_json::Value::Null;
    };
    let contact = get_user(data, &primary.guardian_wallet);
    serde_json::json!({
        "name": contact.as_ref().map(|u| u.name.clone()),
        "phone": contact.as_ref().and_then(|u| u.phone.clone()),
        "relationship": primary.relationship_type,
        "verified": true
    })
}

/// The contact a responder should actually call.
///
/// A verified guardian outranks a self-declared contact — the guardian
/// relationship is one the system checked, and for a minor it is the legally
/// answerable person. When no guardian exists this falls back to the first
/// emergency contact the patient recorded at registration, which is the case
/// the guardian-only lookup used to drop: those patients showed an emergency
/// card with nobody to call, even though they had supplied next of kin.
///
/// `verified` distinguishes the two, so a client never presents a self-declared
/// number as though the system had confirmed it.
async fn primary_emergency_contact_json(
    data: &web::Data<AppState>,
    patient_id: &str,
    profile: &Option<crate::PatientProfile>,
) -> serde_json::Value {
    let guardian = primary_guardian_contact_json(data, patient_id).await;
    if !guardian.is_null() {
        return guardian;
    }

    profile
        .as_ref()
        .and_then(|p| p.emergency_info.emergency_contacts.first())
        .map(|c| {
            serde_json::json!({
                "name": c.name,
                "phone": c.phone,
                "relationship": c.relationship,
                "verified": false
            })
        })
        .unwrap_or(serde_json::Value::Null)
}

/// Get emergency-only view (minimal data for first responders)
/// This endpoint can be accessed without full authentication for emergency scenarios
#[get("/api/medical-id/{patient_id}/emergency")]
pub async fn get_emergency_medical_id(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // Emergency access is granted only on a *verifiable, time-limited* proof
    // (C2). A raw NFC hash is no longer accepted directly here (Horizon
    // HZ-001): `tag_uid` never rotates for the card's lifetime, so a value
    // captured once from a query-string log would otherwise replay forever.
    // A card tap now exchanges its hash for a short-lived token first, via
    // `POST /api/emergency/nfc-token`, then presents that token here — same
    // number of round-trips as before once you count the exchange call, but
    // what could leak from *this* endpoint's own query string now expires in
    // ~2 minutes instead of never.
    let token = http_req
        .headers()
        .get(actix_web::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim);
    let consumed = match token {
        Some(token) => super::emergency_access::consume_emergency_token(&data, token, &patient_id)
            .await
            .ok(),
        None => None,
    };
    let emergency_claims = match consumed {
        Some(claims)
            if data
                .device_lifecycle
                .can_access(&claims.device_id, Utc::now()) =>
        {
            claims
        }
        _ => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Emergency access requires a valid one-time Bearer token from an approved device."
                    .to_string(),
                code: "EMERGENCY_ACCESS_DENIED".to_string(),
            });
        }
    };

    // Get patient from repository
    let patient = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(p) => p,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            })
        }
    };
    let patient_chain_account = patient.wallet_address.clone();

    // `connection_info()` borrows the request's internal `RefCell`. Bind the
    // owned address directly so the `Ref` is released at the end of this
    // statement rather than living across the audit `await` below, where a
    // re-entrant borrow would panic at runtime.
    let ip_address = http_req
        .connection_info()
        .realip_remote_addr()
        .map(str::to_string);
    let user_agent = http_req
        .headers()
        .get(actix_web::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let log_entry = crate::repositories::AccessLogEntity {
        id: uuid::Uuid::new_v4().to_string(),
        accessor_id: emergency_claims.sub.clone(),
        accessor_role: "FirstResponder".to_string(),
        patient_id: Some(patient_id.clone()),
        resource_type: "emergency_medical_id".to_string(),
        resource_id: Some(patient_id.clone()),
        action: "view".to_string(),
        access_reason: Some(emergency_claims.reason_code.clone()),
        is_emergency_access: true,
        ip_address,
        user_agent,
        blockchain_tx_hash: None,
        accessed_at: chrono::Utc::now(),
        facility_id: data
            .device_lifecycle
            .get(&emergency_claims.device_id)
            .and_then(|device| device.facility_id),
    };
    let access_id = log_entry.id.clone();
    if let Err(error) = data
        .repositories
        .record_access_atomic(&patient_id, log_entry)
        .await
    {
        log::error!("Emergency access audit persistence failed: {}", error);
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Emergency access is temporarily unavailable because the audit trail could not be recorded."
                .to_string(),
            code: "AUDIT_PERSISTENCE_REQUIRED".to_string(),
        });
    }
    if crate::blockchain::blockchain_enabled() && patient_chain_account.is_none() {
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Emergency access was recorded, but the patient has no blockchain wallet for the required chain audit."
                .to_string(),
            code: "PATIENT_WALLET_REQUIRED".to_string(),
        });
    }
    let chain_anchor = match crate::audit_outbox::anchor_access_or_queue(
        &data,
        "emergency_access",
        &access_id,
        patient_chain_account.as_deref().unwrap_or_default(),
        &emergency_claims.sub,
        "EMERGENCY_ACCESS",
    )
    .await
    {
        Ok(outcome) => outcome,
        Err(error) => {
            log::error!("Emergency chain audit could not be finalized or queued: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Emergency access was recorded, but its required chain audit could not be queued."
                    .to_string(),
                code: "CHAIN_AUDIT_UNAVAILABLE".to_string(),
            });
        }
    };

    let allergies = merged_allergies(&data, &patient, &patient_id).await;

    // DNR STATUS - LEGAL REQUIREMENT
    // Only emit the authoritative "DO NOT RESUSCITATE" flag when the advance
    // directive is verified (status + verified_by + verified_at). An unverified
    // DNR yields an explicit "unverified" variant so responders default to full
    // resuscitation rather than withholding care on an unproven flag.
    // (Computed before the json! macro: a block expression cannot be a json! value.)
    let dnr_verified = dnr_is_verified(
        patient.dnr_status,
        &patient.dnr_verified_by,
        &patient.dnr_verified_at,
    );
    let dnr_status_json = match (patient.dnr_status, dnr_verified) {
        (true, true) => serde_json::json!({
            "status": "ACTIVE",
            "verified": true,
            "verified_by": patient.dnr_verified_by,
            "verified_at": patient.dnr_verified_at.map(|t| t.to_rfc3339()),
            "document_ref": patient.dnr_document_ref,
            "warning": "DO NOT RESUSCITATE — verified advance directive",
            "verify_directive": false
        }),
        (true, false) => serde_json::json!({
            "status": "UNVERIFIED",
            "verified": false,
            "verified_by": null,
            "verified_at": null,
            "document_ref": patient.dnr_document_ref,
            "warning": "DNR on file but UNVERIFIED — verify advance directive before acting; assume full resuscitation",
            "verify_directive": true
        }),
        (false, _) => serde_json::json!({
            "status": "NOT_ON_FILE",
            "verified": false,
            "verified_by": null,
            "verified_at": null,
            "document_ref": null,
            "warning": null
        }),
    };

    let emergency_profile = crate::patient_entity_to_profile(&patient, &data.encryption_keyring);
    let guardian_contact =
        primary_emergency_contact_json(&data, &patient_id, &emergency_profile).await;

    // Real chronic conditions and current medications, read off the decrypted
    // profile. Returns `(conditions, medications)`.
    let (emergency_conditions, emergency_medications) =
        crate::clinical_endpoints::patient_conditions_and_meds(&data, &patient_id).await;

    // Emergency view - ONLY critical information
    let emergency_data = serde_json::json!({
        "type": "EMERGENCY_MEDICAL_ID",
        "warning": "EMERGENCY ACCESS - ALL ACCESS IS LOGGED",

        // CRITICAL LIFE-SAVING INFO ONLY
        "patient": {
            "name": "Patient", // Name is encrypted
            "dob": "Redacted", // DOB is encrypted
        },

        "blood_type": {
            "value": patient.blood_type.clone().unwrap_or_else(|| "Unknown".to_string()),
            "compatible_donors": match patient.blood_type.as_deref() {
                Some("A+") => vec!["A+", "A-", "O+", "O-"],
                Some("A-") => vec!["A-", "O-"],
                Some("B+") => vec!["B+", "B-", "O+", "O-"],
                Some("B-") => vec!["B-", "O-"],
                Some("AB+") => vec!["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
                Some("AB-") => vec!["A-", "B-", "AB-", "O-"],
                Some("O+") => vec!["O+", "O-"],
                Some("O-") => vec!["O-"],
                _ => vec!["O-"],
            }
        },

        // CRITICAL ALLERGIES - LIFE THREATENING
        // EVERY known allergy, with the severe ones flagged — not just the
        // severe ones.
        //
        // This filtered to Severe/Moderate/LifeThreatening, which silently
        // dropped anything recorded as Mild or Unknown. Registration records
        // bare allergen names with no assessment, so those are exactly the
        // entries that got hidden: a patient registered with a penicillin
        // allergy presented an EMPTY allergy list to a responder. A recorded
        // severity describes one past reaction; it is not a promise about the
        // next one, and anaphylaxis on re-exposure does not care what the last
        // episode looked like. Withholding a known allergen from an emergency
        // card is never the safer default.
        "critical_allergies": allergies.iter()
            .map(|a| {
                let sev = a.severity.to_uppercase();
                serde_json::json!({
                    "allergen": a.allergen.to_uppercase(),
                    "severity": sev,
                    "reaction": a.reaction,
                    // Lets a client emphasise the confirmed-dangerous ones
                    // without hiding the rest.
                    "critical": matches!(sev.as_str(), "SEVERE" | "MODERATE" | "LIFETHREATENING"),
                    "severity_assessed": !matches!(sev.as_str(), "UNKNOWN" | ""),
                })
            })
            .collect::<Vec<_>>(),

        // DNR STATUS - LEGAL REQUIREMENT (computed above; gated on verification)
        "dnr_status": dnr_status_json,

        // ORGAN DONOR
        "organ_donor": patient.organ_donor,

        // CRITICAL MEDICATIONS / CONDITIONS
        //
        // These returned hardcoded empty vectors, deferred to a "Phase 2
        // repository". On a paramedic-facing emergency card an empty
        // `conditions` array does not read as "not retrieved" — it reads as "no known
        // conditions", which is the most dangerous thing this screen could say
        // if the patient is diabetic, epileptic or anticoagulated. The data was
        // already reachable: `patient_conditions_and_meds` (used by the CDS
        // wiring) reads exactly these two lists off the decrypted profile.
        "medications": emergency_medications,
        "conditions": emergency_conditions,

        // PRIMARY EMERGENCY CONTACT — verified guardian when one exists,
        // otherwise null (the free-text emergency_contact_* fields aren't
        // wired to this repository yet, unchanged from before this pass).
        "emergency_contact": guardian_contact,

        // LANGUAGE (for communication).
        //
        // Hardcoded to "en" for every patient. In a deployment spanning isiZulu,
        // Sesotho, Afrikaans, Amharic and Twi, telling a responder that an
        // unresponsive patient speaks English is worse than telling them
        // nothing: it stops them looking for an interpreter. Null when the
        // patient recorded no preference.
        "primary_language": emergency_profile
            .as_ref()
            .and_then(|p| p.preferences.display_language.clone()),

        // ACCESS LOG WARNING
        "access_logged": true,
        "access_timestamp": chrono::Utc::now().to_rfc3339(),
        "chain_audit_status": chain_anchor.status,
        "blockchain_tx_hash": chain_anchor.transaction_hash
    });

    HttpResponse::Ok().json(emergency_data)
}

/// Get Medical ID in lock screen format (minimal, high-contrast)
#[get("/api/medical-id/{patient_id}/lockscreen")]
pub async fn get_lockscreen_medical_id(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let device_id = match http_req
        .headers()
        .get("X-Device-Id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => value.to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "A device-bound lockscreen capability is required".to_string(),
                code: "DEVICE_BINDING_REQUIRED".to_string(),
            });
        }
    };
    let token = http_req
        .headers()
        .get(actix_web::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim);
    let capability_ok = token
        .and_then(|token| {
            crate::mobile_records::verify_lockscreen_token(token, &patient_id, &device_id).ok()
        })
        .is_some();
    let device_ok = data
        .mobile_records
        .get_device_durable(&device_id)
        .await
        .ok()
        .flatten()
        .is_some_and(|device| {
            device.patient_id == patient_id
                && device.status == crate::mobile_records::MobileDeviceStatus::Active
        });
    if !capability_ok || !device_ok {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "The lockscreen capability is invalid, expired, revoked, or belongs to another device."
                .to_string(),
            code: "DEVICE_BINDING_REQUIRED".to_string(),
        });
    }

    // Get patient from repository
    let patient = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(p) => p,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            })
        }
    };
    let lockscreen_enabled = crate::patient_entity_to_profile(&patient, &data.encryption_keyring)
        .is_some_and(|profile| profile.preferences.show_when_locked);
    if !lockscreen_enabled {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "The patient has disabled lockscreen Medical ID access".to_string(),
            code: "LOCKSCREEN_ACCESS_DISABLED".to_string(),
        });
    }
    let patient_chain_account = patient.wallet_address.clone();

    // See `get_emergency_medical_id`: the `connection_info()` borrow must not
    // outlive this statement, or it spans the audit `await` below.
    let ip_address = http_req
        .connection_info()
        .realip_remote_addr()
        .map(str::to_string);
    let log_entry = crate::repositories::AccessLogEntity {
        id: uuid::Uuid::new_v4().to_string(),
        accessor_id: format!("device:{device_id}"),
        accessor_role: "PatientDevice".to_string(),
        patient_id: Some(patient_id.clone()),
        resource_type: "lockscreen_view".to_string(),
        resource_id: Some(patient_id.clone()),
        action: "view".to_string(),
        access_reason: Some("Device-bound patient lockscreen".to_string()),
        is_emergency_access: false,
        ip_address,
        user_agent: http_req
            .headers()
            .get(actix_web::http::header::USER_AGENT)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string),
        blockchain_tx_hash: None,
        accessed_at: chrono::Utc::now(),
        facility_id: None,
    };
    let access_id = log_entry.id.clone();
    if let Err(error) = data
        .repositories
        .record_access_atomic(&patient_id, log_entry)
        .await
    {
        log::error!("Lockscreen access audit persistence failed: {}", error);
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Lockscreen access is temporarily unavailable because the audit trail could not be recorded."
                .to_string(),
            code: "AUDIT_PERSISTENCE_REQUIRED".to_string(),
        });
    }
    if crate::blockchain::blockchain_enabled() && patient_chain_account.is_none() {
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Lockscreen access was recorded, but the patient has no blockchain wallet for the required chain audit."
                .to_string(),
            code: "PATIENT_WALLET_REQUIRED".to_string(),
        });
    }
    let accessor_id = format!("device:{device_id}");
    let chain_anchor = match crate::audit_outbox::anchor_access_or_queue(
        &data,
        "lockscreen_access",
        &access_id,
        patient_chain_account.as_deref().unwrap_or_default(),
        &accessor_id,
        "READ",
    )
    .await
    {
        Ok(outcome) => outcome,
        Err(error) => {
            log::error!("Lockscreen chain audit could not be finalized or queued: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Lockscreen access was recorded, but its required chain audit could not be queued."
                    .to_string(),
                code: "CHAIN_AUDIT_UNAVAILABLE".to_string(),
            });
        }
    };

    let allergies = merged_allergies(&data, &patient, &patient_id).await;

    // LINE 3: DNR Warning (if applicable). Computed before the json! macro
    // because a block expression cannot be a json! value.
    // Authoritative "DO NOT RESUSCITATE" line is shown ONLY when the advance
    // directive is verified. An unverified DNR shows a distinct amber caution
    // so the lock screen never instructs withholding care on an unproven flag.
    let dnr_verified = dnr_is_verified(
        patient.dnr_status,
        &patient.dnr_verified_by,
        &patient.dnr_verified_at,
    );
    let dnr_line = match (patient.dnr_status, dnr_verified) {
        (true, true) => Some(serde_json::json!({
            "text": "DNR - DO NOT RESUSCITATE",
            "verified": true,
            "verified_by": patient.dnr_verified_by,
            "verified_at": patient.dnr_verified_at.map(|t| t.to_rfc3339()),
            "document_ref": patient.dnr_document_ref,
            "font_size": "18px",
            "color": "#FCA5A5",
            "background": "#7F1D1D"
        })),
        (true, false) => Some(serde_json::json!({
            "text": "DNR ON FILE — UNVERIFIED · ASSUME FULL RESUSCITATION",
            "verified": false,
            "verified_by": null,
            "verified_at": null,
            "document_ref": patient.dnr_document_ref,
            "font_size": "16px",
            "color": "#FDE68A",
            "background": "#78350F"
        })),
        (false, _) => None,
    };

    // Lock screen format - maximum simplicity, high contrast
    let lockscreen_profile = crate::patient_entity_to_profile(&patient, &data.encryption_keyring);
    let lockscreen_contact =
        primary_emergency_contact_json(&data, &patient_id, &lockscreen_profile).await;

    let lockscreen_data = serde_json::json!({
        "format": "lockscreen",
        "design": {
            "background": "#1F2937", // Dark gray
            "text": "#FFFFFF",
            "accent": match patient.blood_type.as_deref() {
                Some("O-") => "#DC2626",
                _ => "#3B82F6"
            }
        },

        // LINE 1: Blood Type (LARGEST)
        "blood_type": {
            "value": patient.blood_type.clone().unwrap_or_else(|| "Unknown".to_string()),
            "font_size": "48px",
            "background": "#DC2626",
            "text_color": "#FFFFFF"
        },

        // LINE 2: Allergies.
        //
        // This listed only Severe/LifeThreatening allergens and otherwise
        // printed the literal words "No Critical Allergies" — an affirmative
        // claim, on a lock screen a responder reads in seconds, that was FALSE
        // for any patient whose allergies were recorded without a severity
        // assessment (which is every allergy captured at registration). It now
        // lists every known allergen and only says "None on file" when the list
        // is genuinely empty. "Nothing recorded" and "nothing to worry about"
        // are different statements and must not render identically.
        "allergies_line": {
            "text": if allergies.is_empty() {
                "No allergies on file".to_string()
            } else {
                format!("ALLERGIC: {}",
                    allergies.iter()
                        .map(|a| a.allergen.to_uppercase())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            },
            "font_size": "20px",
            "color": if allergies.is_empty() { "#9CA3AF" } else { "#FCA5A5" }
        },

        // LINE 3: DNR Warning (computed above; gated on verification)
        "dnr_line": dnr_line,

        // LINE 4: Name.
        //
        // This printed the literal "Patient". The lock screen is the patient's
        // own handset showing their own medical ID to whoever picks it up, and
        // a responder's first job is to confirm the card belongs to the person
        // in front of them — a card that cannot name its holder cannot be
        // matched, and the Medical ID card view already decrypts this. `null`
        // when the profile cannot be read, so a client shows "name unavailable"
        // rather than a name that is not the patient's.
        "name": {
            "value": lockscreen_profile.as_ref().map(|p| p.full_name.clone()),
            "font_size": "24px"
        },

        // LINE 5: Emergency Contact Button — the patient's own recorded contacts,
        // falling back to a verified guardian. This was the guardian alone, so a
        // patient who had named next of kin at registration but had no guardian
        // relationship on file showed a lock screen with nobody to call.
        "emergency_contact": lockscreen_contact,

        // QR Code (small, bottom corner)
        "qr_url": format!("/api/medical-id/{}/qr", patient_id),
        "chain_audit_status": chain_anchor.status,
        "blockchain_tx_hash": chain_anchor.transaction_hash
    });

    HttpResponse::Ok().json(lockscreen_data)
}

#[cfg(test)]
mod hz_001_regression_tests {
    use super::*;
    use actix_web::test;

    fn test_patient(id: &str) -> crate::PatientProfile {
        let now = chrono::Utc::now();
        crate::PatientProfile {
            patient_id: id.to_string(),
            full_name: "Test Patient".to_string(),
            date_of_birth: "1980-01-01".to_string(),
            time_of_birth: None,
            national_id: format!("NID-{id}"),
            gender: None,
            phone: "+27000000000".to_string(),
            emergency_info: crate::EmergencyInfo {
                patient_id: id.to_string(),
                blood_type: crate::BloodType::OPositive,
                allergies: Vec::new(),
                current_medications: Vec::new(),
                chronic_conditions: Vec::new(),
                emergency_contacts: Vec::new(),
                organ_donor: false,
                dnr_status: false,
                dnr_verified_by: None,
                dnr_verified_at: None,
                dnr_document_ref: None,
                languages: vec!["en".to_string()],
                last_updated: now,
            },
            address: None,
            insurance: None,
            primary_doctor: None,
            community_health_worker: None,
            preferences: crate::PatientPreferences {
                show_when_locked: true,
                ..crate::PatientPreferences::default()
            },
            advanced_directives: Vec::new(),
            family_notifications: None,
            created_at: now,
            last_updated: now,
        }
    }

    fn active_device(state: &crate::AppState, fingerprint: &str) -> String {
        let device = state
            .device_lifecycle
            .enroll(
                "org-1".into(),
                None,
                "ED tablet".into(),
                "tablet".into(),
                fingerprint.into(),
                None,
            )
            .unwrap();
        state
            .device_lifecycle
            .rotate(&device.id, "key-1".into(), Utc::now())
            .unwrap();
        device.id
    }

    /// HZ-001 regression: a bare `nfc_hash` query parameter — the exact request
    /// shape that previously granted indefinite-replay access directly — must
    /// no longer be accepted by the PHI-releasing endpoint at all.
    #[actix_web::test]
    async fn raw_nfc_hash_query_param_is_rejected() {
        let state = crate::AppState::new();
        let patient_id = "PAT-HZ001-1";
        state
            .repositories
            .patients
            .create(crate::patient_profile_to_entity(
                &test_patient(patient_id),
                &state.encryption_keyring,
            ))
            .await
            .unwrap();
        state
            .repositories
            .nfc_tags
            .create(crate::repositories::traits::NfcTagEntity {
                id: "tag-1".to_string(),
                tag_uid: "static-card-hash".to_string(),
                patient_id: patient_id.to_string(),
                tag_type: "emergency".to_string(),
                is_active: true,
                pin_hash: None,
                issued_at: chrono::Utc::now(),
                expires_at: None,
                last_used_at: None,
                use_count: 0,
                issued_by: None,
            })
            .await
            .unwrap();

        let app_state = web::Data::new(state);
        let app = actix_web::App::new()
            .app_data(app_state.clone())
            .service(get_emergency_medical_id);
        let app = test::init_service(app).await;

        // Old behavior would have accepted this and returned 200.
        let req = test::TestRequest::get()
            .uri(&format!(
                "/api/medical-id/{patient_id}/emergency?nfc_hash=static-card-hash"
            ))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    /// A token obtained via the exchange endpoint is accepted, and expired
    /// tokens are rejected — proving the replacement path actually works, not
    /// just that the old one was removed.
    #[actix_web::test]
    async fn exchanged_token_grants_access_and_expires() {
        let state = crate::AppState::new();
        let patient_id = "PAT-HZ001-2";
        state
            .repositories
            .patients
            .create(crate::patient_profile_to_entity(
                &test_patient(patient_id),
                &state.encryption_keyring,
            ))
            .await
            .unwrap();

        let device_id = active_device(&state, "fingerprint-hz001-2");

        let valid_token = super::super::emergency_access::issue_emergency_token(
            patient_id,
            "responder-wallet",
            &device_id,
            "trauma",
            120,
        )
        .unwrap();
        let expired_token = super::super::emergency_access::issue_emergency_token(
            patient_id,
            "responder-wallet",
            &device_id,
            "trauma",
            -10,
        )
        .unwrap();

        let app_state = web::Data::new(state);
        let app = actix_web::App::new()
            .app_data(app_state.clone())
            .service(get_emergency_medical_id);
        let app = test::init_service(app).await;

        let ok_req = test::TestRequest::get()
            .uri(&format!("/api/medical-id/{patient_id}/emergency"))
            .insert_header(("Authorization", format!("Bearer {valid_token}")))
            .to_request();
        let ok_resp = test::call_service(&app, ok_req).await;
        assert!(ok_resp.status().is_success());

        let expired_req = test::TestRequest::get()
            .uri(&format!("/api/medical-id/{patient_id}/emergency"))
            .insert_header(("Authorization", format!("Bearer {expired_token}")))
            .to_request();
        let expired_resp = test::call_service(&app, expired_req).await;
        assert_eq!(
            expired_resp.status(),
            actix_web::http::StatusCode::UNAUTHORIZED
        );
    }

    #[actix_web::test]
    async fn lockscreen_requires_matching_active_patient_device() {
        let state = crate::AppState::new();
        let patient_id = "PAT-LOCK-1";
        state
            .repositories
            .patients
            .create(crate::patient_profile_to_entity(
                &test_patient(patient_id),
                &state.encryption_keyring,
            ))
            .await
            .unwrap();
        let device = state
            .mobile_records
            .register_device(
                patient_id.into(),
                "Patient phone".into(),
                crate::mobile_records::MobilePlatform::Android,
                "public-key".into(),
            )
            .unwrap();
        let token = crate::mobile_records::issue_lockscreen_token(patient_id, &device.id).unwrap();
        let app = test::init_service(
            actix_web::App::new()
                .app_data(web::Data::new(state))
                .service(get_lockscreen_medical_id),
        )
        .await;

        let unbound = test::TestRequest::get()
            .uri(&format!("/api/medical-id/{patient_id}/lockscreen"))
            .to_request();
        assert_eq!(
            test::call_service(&app, unbound).await.status(),
            actix_web::http::StatusCode::UNAUTHORIZED
        );

        let wrong_device = test::TestRequest::get()
            .uri(&format!("/api/medical-id/{patient_id}/lockscreen"))
            .insert_header(("Authorization", format!("Bearer {token}")))
            .insert_header(("X-Device-Id", "another-device"))
            .to_request();
        assert_eq!(
            test::call_service(&app, wrong_device).await.status(),
            actix_web::http::StatusCode::UNAUTHORIZED
        );

        let valid = test::TestRequest::get()
            .uri(&format!("/api/medical-id/{patient_id}/lockscreen"))
            .insert_header(("Authorization", format!("Bearer {token}")))
            .insert_header(("X-Device-Id", device.id))
            .to_request();
        assert!(test::call_service(&app, valid).await.status().is_success());
    }

    #[actix_web::test]
    async fn patient_can_disable_lockscreen_medical_id() {
        let state = crate::AppState::new();
        let patient_id = "PAT-LOCK-DISABLED";
        let mut patient = test_patient(patient_id);
        patient.preferences.show_when_locked = false;
        state
            .repositories
            .patients
            .create(crate::patient_profile_to_entity(
                &patient,
                &state.encryption_keyring,
            ))
            .await
            .unwrap();
        let device = state
            .mobile_records
            .register_device(
                patient_id.into(),
                "Patient phone".into(),
                crate::mobile_records::MobilePlatform::Android,
                "public-key-disabled".into(),
            )
            .unwrap();
        let token = crate::mobile_records::issue_lockscreen_token(patient_id, &device.id).unwrap();
        let app = test::init_service(
            actix_web::App::new()
                .app_data(web::Data::new(state))
                .service(get_lockscreen_medical_id),
        )
        .await;
        let request = test::TestRequest::get()
            .uri(&format!("/api/medical-id/{patient_id}/lockscreen"))
            .insert_header(("Authorization", format!("Bearer {token}")))
            .insert_header(("X-Device-Id", device.id))
            .to_request();

        assert_eq!(
            test::call_service(&app, request).await.status(),
            actix_web::http::StatusCode::FORBIDDEN
        );
    }

    #[actix_web::test]
    async fn revoked_device_cannot_use_existing_lockscreen_token() {
        let state = crate::AppState::new();
        let patient_id = "PAT-LOCK-2";
        state
            .repositories
            .patients
            .create(crate::patient_profile_to_entity(
                &test_patient(patient_id),
                &state.encryption_keyring,
            ))
            .await
            .unwrap();
        let device = state
            .mobile_records
            .register_device(
                patient_id.into(),
                "Lost phone".into(),
                crate::mobile_records::MobilePlatform::Ios,
                "public-key-2".into(),
            )
            .unwrap();
        let token = crate::mobile_records::issue_lockscreen_token(patient_id, &device.id).unwrap();
        state
            .mobile_records
            .revoke_device(&device.id, "lost".into(), Utc::now())
            .unwrap();
        let app = test::init_service(
            actix_web::App::new()
                .app_data(web::Data::new(state))
                .service(get_lockscreen_medical_id),
        )
        .await;
        let request = test::TestRequest::get()
            .uri(&format!("/api/medical-id/{patient_id}/lockscreen"))
            .insert_header(("Authorization", format!("Bearer {token}")))
            .insert_header(("X-Device-Id", device.id))
            .to_request();
        assert_eq!(
            test::call_service(&app, request).await.status(),
            actix_web::http::StatusCode::UNAUTHORIZED
        );
    }
}
