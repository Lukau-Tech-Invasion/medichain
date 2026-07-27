//! `clinical_endpoints::medical_id::emergency_views` — emergency-only and lock-screen
//! Medical ID views (reduced-auth first-responder access).
//!
//! Split out of the former single-file `medical_id.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `medical_id/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

/// Get emergency-only view (minimal data for first responders)
/// This endpoint can be accessed without full authentication for emergency scenarios
#[get("/api/medical-id/{patient_id}/emergency")]
pub async fn get_emergency_medical_id(
    data: web::Data<AppState>,
    path: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // Emergency access is granted only on a *verifiable* proof, never on the mere
    // presence of a query parameter (C2):
    //   - a time-limited, server-signed emergency token bound to THIS patient, or
    //   - an NFC card hash matching one of the patient's active registered tags.
    let token_ok = query
        .get("token")
        .map(|t| super::emergency_access::verify_emergency_token(t, &patient_id))
        .unwrap_or(false);

    let nfc_ok = match query.get("nfc_hash").filter(|h| !h.is_empty()) {
        Some(h) => match data.repositories.nfc_tags.get_by_patient(&patient_id).await {
            Ok(tags) => super::emergency_access::nfc_hash_matches(h, &tags),
            Err(_) => false,
        },
        None => false,
    };

    if !token_ok && !nfc_ok {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Emergency access requires a valid signed token or a matching NFC card hash"
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

        // CRITICAL MEDICATIONS
        "medications": Vec::<String>::new(), // TODO: Phase 2 repository

        // CRITICAL CONDITIONS
        "conditions": Vec::<String>::new(), // TODO: Phase 2 repository

        // PRIMARY EMERGENCY CONTACT
        "emergency_contact": serde_json::Value::Null, // TODO: Phase 2 repository

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
    // caller (X-User-Id / session) or a device-bound NFC card hash matching one
    // of the patient's active tags. An unbound request never sees PHI.
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

    let nfc_ok = match query.get("nfc_hash").filter(|h| !h.is_empty()) {
        Some(h) => match data.repositories.nfc_tags.get_by_patient(&patient_id).await {
            Ok(tags) => super::emergency_access::nfc_hash_matches(h, &tags),
            Err(_) => false,
        },
        None => false,
    };

    if current_user_id.is_none() && !nfc_ok {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Lock-screen access requires an authenticated identity or a matching NFC card"
                .to_string(),
            code: "IDENTITY_BINDING_REQUIRED".to_string(),
        });
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

        // LINE 5: Emergency Contact Button
        "emergency_contact": serde_json::Value::Null, // TODO: Phase 2 repository

        // QR Code (small, bottom corner)
        "qr_url": format!("/api/medical-id/{}/qr", patient_id)
    });

    // Log access
    if let Some(user_id) = current_user_id {
        let log_entry = crate::repositories::AccessLogEntity {
            id: uuid::Uuid::new_v4().to_string(),
            accessor_id: user_id,
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
    }

    HttpResponse::Ok().json(lockscreen_data)
}
