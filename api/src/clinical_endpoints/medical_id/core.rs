//! `clinical_endpoints::medical_id::core` — shared helpers + core Medical ID lookup
//! (full record + QR code generation).
//!
//! Split out of the former single-file `medical_id.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `medical_id/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

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
pub(crate) fn dnr_is_verified(
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
    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
    {
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
    let allergies = data
        .repositories
        .allergies
        .get_by_patient(&patient_id)
        .await
        .unwrap_or_default();

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

    // Read from the patient's encrypted profile — the authoritative record that
    // registration writes and the first-responder card already uses for
    // allergies (see `merged_allergies`).
    //
    // These three were hardcoded to empty. On the Medical ID card that is not a
    // blank field, it is a statement to a paramedic that the patient has no
    // chronic conditions, is on no medication, and has nobody to contact — the
    // three things the card exists to tell them. `profile_unavailable` below
    // distinguishes "nothing recorded" from "we could not read it".
    let profile = crate::patient_entity_to_profile(&patient, &data.encryption_keyring);
    let profile_unavailable = profile.is_none();
    let emergency_contacts: Vec<serde_json::Value> = profile
        .as_ref()
        .map(|p| {
            p.emergency_info
                .emergency_contacts
                .iter()
                .map(|c| {
                    serde_json::json!({
                        "name": c.name,
                        "phone": c.phone,
                        "relationship": c.relationship
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let chronic_conditions: Vec<String> = profile
        .as_ref()
        .map(|p| p.emergency_info.chronic_conditions.clone())
        .unwrap_or_default();
    let current_medications: Vec<String> = profile
        .as_ref()
        .map(|p| p.emergency_info.current_medications.clone())
        .unwrap_or_default();

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
        // Decrypted from the profile rather than the former literals "Patient"
        // and "Redacted". A card that cannot name its holder cannot be matched
        // to the person in front of the responder.
        "name": profile.as_ref().map(|p| p.full_name.clone()),
        "date_of_birth": profile.as_ref().map(|p| p.date_of_birth.clone()),
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
        // The profile carries the real provider record; the fallback keeps the
        // identifier visible rather than inventing a phone number ("Redacted"
        // was printed as though it were one).
        "primary_doctor": profile
            .as_ref()
            .and_then(|p| p.primary_doctor.as_ref())
            .map(|d| serde_json::json!({ "name": d.name, "phone": d.phone }))
            .or_else(|| patient.primary_provider_id.as_ref().map(|d| serde_json::json!({
                "name": format!("Provider {}", d),
                "phone": serde_json::Value::Null
            }))),
        "community_health_worker": profile
            .as_ref()
            .and_then(|p| p.community_health_worker.as_ref())
            .map(|w| serde_json::json!({ "name": w.name, "phone": w.phone })),
        // Was hardcoded to English. In a multilingual deployment that is the
        // difference between a responder speaking to the patient and not.
        "languages": profile
            .as_ref()
            .and_then(|p| p.preferences.display_language.clone())
            .map(|l| vec![l])
            .unwrap_or_default(),
        // True when the encrypted profile could not be read, so a client can
        // show "record unavailable" instead of an empty, reassuring card.
        "profile_unavailable": profile_unavailable,
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
    if !current_user.role.is_healthcare_provider()
        && !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
    {
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
    let allergies = data
        .repositories
        .allergies
        .get_by_patient(&patient_id)
        .await
        .unwrap_or_default();

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
