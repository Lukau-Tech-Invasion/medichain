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
        let _ = data.repositories.e_prescriptions_v2.create(entity).await;
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

    prescription.signature = Some(crate::clinical::ESignature {
        signature_id: format!("SIG-{}", uuid::Uuid::new_v4()),
        signer_id: current_user_id.clone(),
        signer_name: current_user.name.clone(),
        signer_credential: "MD".to_string(),
        signed_at: now,
        signature_method,
        ip_address: "127.0.0.1".to_string(),
        user_agent: "MediChain/1.0".to_string(),
        certificate_thumbprint: None,
        attestation: req.attestation.clone(),
    });
    prescription.signed_at = Some(now);
    prescription.status = crate::clinical::PrescriptionStatus::Signed;

    // Persist the signed prescription (upsert preserves original created_at)
    {
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: prescription_id.clone(),
            owner_id: prescription.patient_id.clone(),
            data: serde_json::to_value(&prescription).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data.repositories.e_prescriptions_v2.create(entity).await;
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

    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
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

    // Persist the transmitted prescription (upsert preserves original created_at)
    {
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: prescription_id.clone(),
            owner_id: prescription.patient_id.clone(),
            data: serde_json::to_value(&prescription).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data.repositories.e_prescriptions_v2.create(entity).await;
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

    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let current_user = match require_known_user(&data, &current_user_id) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    let is_own = current_user_id == patient_id;
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
