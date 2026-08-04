//! `clinical_endpoints::medical_id::emergency_views` — emergency-only and lock-screen
//! Medical ID views (reduced-auth first-responder access).
//!
//! Split out of the former single-file `medical_id.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `medical_id/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

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

/// Get emergency-only view (minimal data for first responders)
/// This endpoint can be accessed without full authentication for emergency scenarios
#[get("/api/medical-id/{patient_id}/emergency")]
pub async fn get_emergency_medical_id(
    data: web::Data<AppState>,
    path: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
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
    let token_ok = query
        .get("token")
        .map(|t| super::emergency_access::verify_emergency_token(t, &patient_id))
        .unwrap_or(false);

    if !token_ok {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Emergency access requires a valid signed token. Exchange your NFC card hash \
                    via POST /api/emergency/nfc-token first."
                .to_string(),
            code: "EMERGENCY_ACCESS_DENIED".to_string(),
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

    // Get allergies from repository
    let allergies = data
        .repositories
        .allergies
        .get_by_patient(&patient_id)
        .await
        .unwrap_or_default();

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

    let guardian_contact = primary_guardian_contact_json(&data, &patient_id).await;

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
        "critical_allergies": allergies.iter()
            .filter(|a| a.severity == "Severe" || a.severity == "Moderate" || a.severity == "LifeThreatening")
            .map(|a| serde_json::json!({
                "allergen": a.allergen.to_uppercase(),
                "severity": a.severity.to_uppercase(),
                "reaction": a.reaction
            }))
            .collect::<Vec<_>>(),

        // DNR STATUS - LEGAL REQUIREMENT (computed above; gated on verification)
        "dnr_status": dnr_status_json,

        // ORGAN DONOR
        "organ_donor": patient.organ_donor,

        // CRITICAL MEDICATIONS / CONDITIONS
        //
        // These returned hardcoded empty vectors with a "Phase 2 repository"
        // TODO. On a paramedic-facing emergency card an empty `conditions`
        // array does not read as "not retrieved" — it reads as "no known
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

        // LANGUAGE (for communication)
        "primary_language": "en",

        // ACCESS LOG WARNING
        "access_logged": true,
        "access_timestamp": chrono::Utc::now().to_rfc3339()
    });

    // Log emergency access (CRITICAL - immutable audit trail)
    let log_entry = crate::repositories::AccessLogEntity {
        id: uuid::Uuid::new_v4().to_string(),
        accessor_id: "EMERGENCY_ACCESS".to_string(),
        accessor_role: "FirstResponder".to_string(),
        patient_id: Some(patient_id.clone()),
        resource_type: "emergency_medical_id".to_string(),
        resource_id: Some(patient_id.clone()),
        action: "view".to_string(),
        access_reason: Some("Emergency medical access".to_string()),
        is_emergency_access: true,
        ip_address: None,
        user_agent: None,
        blockchain_tx_hash: None,
        accessed_at: chrono::Utc::now(),
        facility_id: None,
    };
    let _ = data.repositories.access_logs.create(log_entry).await;

    // Fire-and-forget on-chain audit entry (non-fatal). HZ-002: this is the exact
    // audit path the code's own history describes as a legal-reliability fix
    // (C5/F-05, routine-vs-emergency routing in `audit_call_for`) — previously it
    // had no caller anywhere, so it never actually recorded emergency access.
    if let Some(ref client) = data.substrate_client {
        let client = client.clone();
        let patient_id_clone = patient_id.clone();
        tokio::spawn(async move {
            match client
                .log_access_on_chain("EMERGENCY_ACCESS", &patient_id_clone, "EMERGENCY_ACCESS")
                .await
            {
                Ok(result) => log::info!(
                    "Emergency access logged on chain: {} (finalized={})",
                    result.hash,
                    result.finalized
                ),
                Err(e) => log::warn!(
                    "Blockchain emergency-access logging failed (non-fatal): {}",
                    e
                ),
            }
        });
    }

    HttpResponse::Ok().json(emergency_data)
}

/// Get Medical ID in lock screen format (minimal, high-contrast)
#[get("/api/medical-id/{patient_id}/lockscreen")]
pub async fn get_lockscreen_medical_id(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // Lock-screen PHI is gated by a bound identity (C3): either an authenticated
    // caller (X-User-Id / session) or a short-lived signed emergency token
    // exchanged for an NFC card hash. An unbound request never sees PHI.
    // Horizon HZ-001: a raw `nfc_hash` is no longer accepted directly — see
    // `get_emergency_medical_id`'s doc comment above for why.
    let current_user_id = get_current_user_id(&http_req);

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

    let token_ok = query
        .get("token")
        .map(|t| super::emergency_access::verify_emergency_token(t, &patient_id))
        .unwrap_or(false);

    // Access requires a valid signed emergency token, OR an authenticated caller
    // who is either a healthcare provider or the patient themselves.
    //
    // HZ-019 IDOR follow-up: the prior check was `authenticated OR token`, which
    // let ANY authenticated account — including an unrelated patient — read this
    // patient's lock-screen PHI. Its sibling `/api/medical-id/{id}` already
    // enforced provider-or-self; lock-screen silently did not. A systematic
    // cross-patient sweep caught the divergence.
    if !token_ok {
        let authorized = match &current_user_id {
            Some(uid) => {
                *uid == patient_id
                    || get_user(&data, uid)
                        .map(|u| u.role.is_healthcare_provider())
                        .unwrap_or(false)
            }
            None => false,
        };
        if !authorized {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Lock-screen access requires a valid signed emergency token, or an \
                        authenticated healthcare provider, or the patient themselves. Exchange \
                        an NFC card hash via POST /api/emergency/nfc-token for token access."
                    .to_string(),
                code: "IDENTITY_BINDING_REQUIRED".to_string(),
            });
        }
    }

    // Get allergies from repository
    let allergies = data
        .repositories
        .allergies
        .get_by_patient(&patient_id)
        .await
        .unwrap_or_default();

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
    let guardian_contact = primary_guardian_contact_json(&data, &patient_id).await;

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

        // LINE 2: Critical Allergies
        "allergies_line": {
            "text": if allergies.iter().any(|a| a.severity == "Severe" || a.severity == "LifeThreatening") {
                format!("ALLERGIC: {}",
                    allergies.iter()
                        .filter(|a| a.severity == "Severe" || a.severity == "LifeThreatening")
                        .map(|a| a.allergen.to_uppercase())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            } else {
                "No Critical Allergies".to_string()
            },
            "font_size": "20px",
            "color": if allergies.iter().any(|a| a.severity == "Severe" || a.severity == "LifeThreatening") {
                "#FCA5A5"
            } else {
                "#9CA3AF"
            }
        },

        // LINE 3: DNR Warning (computed above; gated on verification)
        "dnr_line": dnr_line,

        // LINE 4: Name
        "name": {
            "value": "Patient", // Name is encrypted
            "font_size": "24px"
        },

        // LINE 5: Emergency Contact Button — verified guardian when one exists.
        "emergency_contact": guardian_contact,

        // QR Code (small, bottom corner)
        "qr_url": format!("/api/medical-id/{}/qr", patient_id)
    });

    // Log access
    if let Some(user_id) = current_user_id {
        let log_entry = crate::repositories::AccessLogEntity {
            id: uuid::Uuid::new_v4().to_string(),
            accessor_id: user_id.clone(),
            accessor_role: "Patient".to_string(),
            patient_id: Some(patient_id.clone()),
            resource_type: "lockscreen_view".to_string(),
            resource_id: Some(patient_id.clone()),
            action: "view".to_string(),
            access_reason: Some("Patient lockscreen view".to_string()),
            is_emergency_access: false,
            ip_address: None,
            user_agent: None,
            blockchain_tx_hash: None,
            accessed_at: chrono::Utc::now(),
            facility_id: None,
        };
        let _ = data.repositories.access_logs.create(log_entry).await;

        // Fire-and-forget on-chain audit entry (non-fatal), same HZ-002 remediation
        // as the emergency-view handler above.
        if let Some(ref client) = data.substrate_client {
            let client = client.clone();
            let patient_id_clone = patient_id.clone();
            tokio::spawn(async move {
                match client
                    .log_access_on_chain(&user_id, &patient_id_clone, "READ")
                    .await
                {
                    Ok(result) => log::info!(
                        "Lockscreen access logged on chain: {} (finalized={})",
                        result.hash,
                        result.finalized
                    ),
                    Err(e) => log::warn!(
                        "Blockchain lockscreen-access logging failed (non-fatal): {}",
                        e
                    ),
                }
            });
        }
    }

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
            preferences: crate::PatientPreferences::default(),
            advanced_directives: Vec::new(),
            family_notifications: None,
            created_at: now,
            last_updated: now,
        }
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

        let valid_token = super::super::emergency_access::issue_emergency_token(patient_id, 120);
        let expired_token = super::super::emergency_access::issue_emergency_token(patient_id, -10);

        let app_state = web::Data::new(state);
        let app = actix_web::App::new()
            .app_data(app_state.clone())
            .service(get_emergency_medical_id);
        let app = test::init_service(app).await;

        let ok_req = test::TestRequest::get()
            .uri(&format!(
                "/api/medical-id/{patient_id}/emergency?token={valid_token}"
            ))
            .to_request();
        let ok_resp = test::call_service(&app, ok_req).await;
        assert!(ok_resp.status().is_success());

        let expired_req = test::TestRequest::get()
            .uri(&format!(
                "/api/medical-id/{patient_id}/emergency?token={expired_token}"
            ))
            .to_request();
        let expired_resp = test::call_service(&app, expired_req).await;
        assert_eq!(
            expired_resp.status(),
            actix_web::http::StatusCode::UNAUTHORIZED
        );
    }
}
