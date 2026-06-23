//! `clinical_endpoints::medical_id` — handlers split out of the original 21K-line monolith (Phase 10.1).
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// ============================================================================
// MEDICAL ID CARD SYSTEM (Emergency Access)
// ============================================================================

/// Helper to get current user
pub fn get_current_user(data: &web::Data<AppState>, http_req: &HttpRequest) -> Option<crate::User> {
    let user_id = get_current_user_id(http_req)?;
    get_user(data, &user_id)
}

/// Whether a DNR is an *authoritative* (verified) advance directive.
///
/// Patient-safety invariant: a DNR is only treated as authoritative when the
/// status flag is set AND a provider has attested to the directive — i.e. both
/// `verified_by` (who) and `verified_at` (when) are present. A recorded-but-
/// unverified DNR returns `false`, so emergency payloads default to full
/// resuscitation rather than withholding care on an unproven flag.
fn dnr_is_verified(
    dnr_status: bool,
    verified_by: &Option<String>,
    verified_at: &Option<chrono::DateTime<chrono::Utc>>,
) -> bool {
    dnr_status && verified_by.is_some() && verified_at.is_some()
}

/// Get Medical ID card data for a patient (emergency format)
/// This is the core data shown on lock screen and emergency access
#[get("/api/medical-id/{patient_id}")]
pub async fn get_medical_id(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Patients can only view their own, providers can view any
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
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
    let allergies = match data
        .repositories
        .allergies
        .get_by_patient(&patient_id)
        .await
    {
        Ok(a) => a,
        Err(_) => Vec::new(),
    };

    // Pre-compute values that need sorting or complex logic
    let blood_type_color = match patient.blood_type.as_deref() {
        Some("O-") => "#DC2626",
        Some("O+") => "#EA580C",
        Some("AB+") => "#16A34A",
        _ => "#2563EB",
    };

    let critical_allergies: Vec<serde_json::Value> = allergies
        .iter()
        .filter(|a| a.severity == "Severe" || a.severity == "LifeThreatening")
        .map(|a| {
            serde_json::json!({
                "name": a.allergen,
                "severity": a.severity,
                "reaction": a.reaction,
                "display_color": "#DC2626"
            })
        })
        .collect();

    let all_allergies: Vec<serde_json::Value> = allergies
        .iter()
        .map(|a| {
            let color = match a.severity.as_str() {
                "Severe" | "LifeThreatening" => "#DC2626",
                "Moderate" => "#EA580C",
                "Mild" => "#CA8A04",
                _ => "#6B7280",
            };
            serde_json::json!({
                "name": a.allergen,
                "severity": a.severity,
                "reaction": a.reaction,
                "display_color": color
            })
        })
        .collect();

    // TODO: Emergency contacts, chronic conditions, and medications should be fetched from repositories in Phase 2
    let emergency_contacts: Vec<serde_json::Value> = Vec::new();
    let chronic_conditions: Vec<String> = Vec::new();
    let current_medications: Vec<String> = Vec::new();

    // DNR is only authoritative when status is set AND a provider verified the
    // advance directive (who + when). Unverified DNR must NOT drive a decision to
    // withhold resuscitation: assume full resuscitation until the directive is confirmed.
    let dnr_verified = dnr_is_verified(
        patient.dnr_status,
        &patient.dnr_verified_by,
        &patient.dnr_verified_at,
    );
    let dnr_warning: Option<&str> = match (patient.dnr_status, dnr_verified) {
        (true, true) => Some("DO NOT RESUSCITATE — verified advance directive on file"),
        (true, false) => Some(
            "DNR on file but UNVERIFIED — verify advance directive before acting; assume full resuscitation",
        ),
        (false, _) => None,
    };
    // Red only when verified; amber (recorded-but-unverified) or grey (none) otherwise.
    let dnr_display_color = match (patient.dnr_status, dnr_verified) {
        (true, true) => "#DC2626",
        (true, false) => "#D97706",
        (false, _) => "#6B7280",
    };

    // Build Medical ID card data (emergency format)
    let medical_id = serde_json::json!({
        "patient_id": patient.id,
        "national_health_id": format!("MCHI-{}", patient.id.chars().skip(4).collect::<String>().to_uppercase()),
        "name": "Patient", // Name is encrypted
        "date_of_birth": "Redacted", // DOB is encrypted
        "photo": Option::<String>::None,
        "blood_type": {
            "value": patient.blood_type.clone().unwrap_or_else(|| "Unknown".to_string()),
            "display_color": blood_type_color
        },
        "critical_allergies": critical_allergies,
        "allergies": all_allergies,
        "organ_donor": {
            "status": patient.organ_donor,
            "display_color": if patient.organ_donor { "#16A34A" } else { "#6B7280" }
        },
        "dnr_status": {
            "status": patient.dnr_status,
            "verified": dnr_verified,
            "verified_by": patient.dnr_verified_by,
            "verified_at": patient.dnr_verified_at.map(|t| t.to_rfc3339()),
            "document_ref": patient.dnr_document_ref,
            "display_color": dnr_display_color,
            "warning": dnr_warning
        },
        "chronic_conditions": chronic_conditions,
        "medications": current_medications,
        "emergency_contacts": emergency_contacts,
        "primary_doctor": patient.primary_provider_id.as_ref().map(|d| serde_json::json!({
            "name": format!("Provider {}", d),
            "phone": "Redacted"
        })),
        "community_health_worker": serde_json::Value::Null,
        "languages": vec!["English"],
        "primary_language": "English",
        "insurance": serde_json::Value::Null,
        "address": serde_json::Value::Null,
        "has_advanced_directives": false,
        "advanced_directives_count": 0,
        "preferences": {
            "show_when_locked": true,
            "enable_location_sharing": false,
            "auto_notify_family": true
        },
        "last_updated": chrono::Utc::now().to_rfc3339(),
    });

    // Log access via repository
    let _ = data
        .repositories
        .access_logs
        .create(
            crate::AccessLogEntry {
                access_id: uuid::Uuid::new_v4().to_string(),
                patient_id: patient_id.clone(),
                accessor_id: current_user_id,
                accessor_role: current_user.role.to_string(),
                access_type: "view_medical_id".to_string(),
                location: None,
                timestamp: chrono::Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    HttpResponse::Ok().json(medical_id)
}

/// Get Medical ID QR code data (for scanning)
#[get("/api/medical-id/{patient_id}/qr")]
pub async fn get_medical_id_qr(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Patients can only view their own QR
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
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
    let allergies = match data
        .repositories
        .allergies
        .get_by_patient(&patient_id)
        .await
    {
        Ok(a) => a,
        Err(_) => Vec::new(),
    };

    // QR code contains minimal critical data for offline access
    let qr_data = serde_json::json!({
        "type": "medichain_medical_id",
        "version": "1.0",
        "patient_id": patient.id,
        "name": "Patient", // Name is encrypted
        "dob": "Redacted", // DOB is encrypted
        "blood_type": patient.blood_type.clone().unwrap_or_else(|| "Unknown".to_string()),
        "critical_allergies": allergies.iter()
            .filter(|a| a.severity == "Severe" || a.severity == "LifeThreatening")
            .map(|a| a.allergen.clone())
            .collect::<Vec<_>>(),
        "dnr": patient.dnr_status,
        // Offline scanners must distinguish a verified directive from a recorded-but-unverified flag.
        "dnr_verified": dnr_is_verified(
            patient.dnr_status,
            &patient.dnr_verified_by,
            &patient.dnr_verified_at,
        ),
        "organ_donor": patient.organ_donor,
        "emergency_contact": serde_json::Value::Null, // TODO: Phase 2 repository
        "api_url": format!("/api/medical-id/{}", patient_id),
        "generated_at": chrono::Utc::now().timestamp()
    });

    // Generate QR code image (base64 PNG)
    let qr_json = serde_json::to_string(&qr_data).unwrap_or_default();
    let qr_image_base64 = crate::generate_qr_code_base64(&qr_json);

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "qr_data": qr_data,
        "qr_image_base64": qr_image_base64,
        "format": "PNG",
        "instructions": "Scan this QR code to access emergency medical information"
    }))
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
    let allergies = match data
        .repositories
        .allergies
        .get_by_patient(&patient_id)
        .await
    {
        Ok(a) => a,
        Err(_) => Vec::new(),
    };

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
    let allergies = match data
        .repositories
        .allergies
        .get_by_patient(&patient_id)
        .await
    {
        Ok(a) => a,
        Err(_) => Vec::new(),
    };

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

/// Update Medical ID preferences
#[post("/api/medical-id/{patient_id}/preferences")]
pub async fn update_medical_id_preferences(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Only patient themselves or admin can update preferences
    let is_patient = current_user_id == patient_id;
    let is_admin = matches!(current_user.role, crate::Role::Admin);

    if !is_patient && !is_admin {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only patient or admin can update preferences".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Via repository (was: in-memory data.patients HashMap); decrypt → mutate → persist.
    let entity = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(e) => e,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            })
        }
    };
    let mut patient = match crate::patient_entity_to_profile(&entity, &data.encryption_key) {
        Some(p) => p,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            })
        }
    };

    // Update preferences
    if let Some(show_when_locked) = body.get("show_when_locked").and_then(|v| v.as_bool()) {
        patient.preferences.show_when_locked = show_when_locked;
    }
    if let Some(enable_location) = body
        .get("enable_location_sharing")
        .and_then(|v| v.as_bool())
    {
        patient.preferences.enable_location_sharing = enable_location;
    }
    if let Some(auto_notify) = body.get("auto_notify_family").and_then(|v| v.as_bool()) {
        patient.preferences.auto_notify_family = auto_notify;
    }
    if let Some(language) = body.get("display_language").and_then(|v| v.as_str()) {
        patient.preferences.display_language = Some(language.to_string());
    }

    patient.last_updated = chrono::Utc::now();

    // Persist via repository, preserving entity-only fields not in PatientProfile.
    let mut updated_entity = crate::patient_profile_to_entity(&patient, &data.encryption_key);
    updated_entity.health_id = entity.health_id.clone();
    updated_entity.gender = entity.gender.clone();
    updated_entity.wallet_address = entity.wallet_address.clone();
    updated_entity.is_verified = entity.is_verified;
    updated_entity.registered_by = entity.registered_by.clone();
    updated_entity.primary_provider_id = entity.primary_provider_id.clone();
    updated_entity.created_at = entity.created_at;
    let _ = data.repositories.patients.update(updated_entity).await;

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "preferences": patient.preferences,
        "message": "Medical ID preferences updated"
    }))
}

/// Trigger emergency notification to family
#[post("/api/medical-id/{patient_id}/emergency-notify")]
pub async fn trigger_emergency_notification(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Only patient or healthcare providers can trigger
    let is_patient = current_user_id == patient_id;
    let is_provider = current_user.role.is_healthcare_provider();

    if !is_patient && !is_provider {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Get patient from repository
    let _patient = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(p) => p,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            })
        }
    };

    // Check if notifications are enabled
    // Note: PatientEntity preferences mapping (simplified)
    if false {
        // TODO: Implement full preference check from Phase 2 repository
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Family notifications are disabled for this patient".to_string(),
            code: "NOTIFICATIONS_DISABLED".to_string(),
        });
    }

    let _location = body.get("location").and_then(|l| l.as_str());
    let _custom_message = body.get("message").and_then(|m| m.as_str());
    let emergency_type = body
        .get("emergency_type")
        .and_then(|e| e.as_str())
        .unwrap_or("medical");

    // Build notification data - TODO: Phase 2 repository for emergency contacts
    let notifications: Vec<serde_json::Value> = Vec::new();

    // Log emergency notification
    let log_entry = crate::repositories::AccessLogEntity {
        id: uuid::Uuid::new_v4().to_string(),
        accessor_id: current_user_id,
        accessor_role: current_user.role.to_string(),
        patient_id: Some(patient_id.clone()),
        resource_type: "emergency_notification".to_string(),
        resource_id: Some(patient_id.clone()),
        action: "create".to_string(),
        access_reason: Some(format!("Emergency {} notification", emergency_type)),
        is_emergency_access: true,
        ip_address: None,
        user_agent: None,
        blockchain_tx_hash: None,
        accessed_at: chrono::Utc::now(),
        facility_id: None,
    };
    let _ = data.repositories.access_logs.create(log_entry).await;

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "notifications_sent": notifications.len(),
        "notifications": notifications,
        "message": format!("Emergency notification queued for {} contacts", notifications.len())
    }))
}

#[cfg(test)]
mod tests {
    use super::dnr_is_verified;
    use chrono::Utc;

    #[test]
    fn dnr_unverified_when_metadata_missing() {
        // status set, but no verifier/timestamp → NOT authoritative.
        assert!(!dnr_is_verified(true, &None, &None));
        // status set, only verified_by present → still NOT authoritative.
        assert!(!dnr_is_verified(true, &Some("doc-1".to_string()), &None));
        // status set, only verified_at present → still NOT authoritative.
        assert!(!dnr_is_verified(true, &None, &Some(Utc::now())));
    }

    #[test]
    fn dnr_verified_when_status_and_metadata_present() {
        assert!(dnr_is_verified(
            true,
            &Some("doc-1".to_string()),
            &Some(Utc::now())
        ));
    }

    #[test]
    fn dnr_not_verified_when_status_false_even_with_metadata() {
        // Defensive: no DNR on file means it can never read as a verified directive.
        assert!(!dnr_is_verified(
            false,
            &Some("doc-1".to_string()),
            &Some(Utc::now())
        ));
    }
}
