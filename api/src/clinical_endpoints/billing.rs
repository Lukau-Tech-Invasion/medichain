//! `clinical_endpoints::billing` — handlers split out of the original 21K-line monolith (Phase 10.1).
//!
//! Inherits shared imports/helpers from the parent via `use super::*`; glob-re-exported
//! by `mod.rs` so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

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
pub async fn create_esignature_prescription(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateEPrescriptionRequest>,
) -> impl Responder {
    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

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
pub async fn sign_e_prescription(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<SignPrescriptionRequest>,
) -> impl Responder {
    let prescription_id = path.into_inner();

    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

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

    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
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

    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
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
pub async fn get_patient_e_prescriptions(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

    let is_own = current_user_id == patient_id;
    if !is_own && !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let patient_prescriptions: Vec<crate::clinical::EPrescription> = data
        .repositories
        .e_prescriptions_v2
        .get_by_owner(&patient_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| serde_json::from_value::<crate::clinical::EPrescription>(r.data).ok())
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "prescriptions": patient_prescriptions,
        "count": patient_prescriptions.len()
    }))
}

// ============================================================================
// PHASE 30: INSURANCE CLAIM INTEGRATION
// ============================================================================

/// Create insurance claim request
#[derive(Debug, Deserialize)]
pub struct CreateInsuranceClaimRequest {
    pub patient_id: String,
    pub encounter_id: String,
    pub facility_id: String,
    pub claim_type: String,
    pub service_date: String,
    pub diagnosis_codes: Vec<DiagnosisCodeInput>,
    pub service_lines: Vec<ServiceLineInput>,
    pub payer_id: String,
    pub payer_name: String,
    pub member_id: String,
}

#[derive(Debug, Deserialize)]
pub struct DiagnosisCodeInput {
    pub code: String,
    pub description: String,
}

#[derive(Debug, Deserialize)]
pub struct ServiceLineInput {
    pub cpt_code: String,
    pub description: String,
    pub quantity: u8,
    pub unit_charge: f64,
    pub modifier: Option<String>,
}

/// Create a new insurance claim
#[post("/api/insurance/claims")]
pub async fn create_insurance_claim(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateInsuranceClaimRequest>,
) -> impl Responder {
    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can create insurance claims".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let claim_id = format!("CLM-{}", uuid::Uuid::new_v4());
    let now = chrono::Utc::now().timestamp();

    let claim_type = match req.claim_type.as_str() {
        "professional" => crate::clinical::ClaimType::Professional,
        "institutional" => crate::clinical::ClaimType::Institutional,
        "dental" => crate::clinical::ClaimType::Dental,
        "pharmacy" => crate::clinical::ClaimType::Pharmacy,
        _ => crate::clinical::ClaimType::Professional,
    };

    let diagnosis_codes: Vec<crate::clinical::ClaimDiagnosisCode> = req
        .diagnosis_codes
        .iter()
        .enumerate()
        .map(|(i, d)| crate::clinical::ClaimDiagnosisCode {
            sequence: (i + 1) as u8,
            code: d.code.clone(),
            code_type: "ICD-10-CM".to_string(),
            description: d.description.clone(),
        })
        .collect();

    let service_lines: Vec<crate::clinical::ServiceLine> = req
        .service_lines
        .iter()
        .enumerate()
        .map(|(i, s)| crate::clinical::ServiceLine {
            line_number: (i + 1) as u8,
            cpt_code: s.cpt_code.clone(),
            modifier: s.modifier.clone(),
            description: s.description.clone(),
            quantity: s.quantity,
            unit_charge: s.unit_charge,
            total_charge: s.unit_charge * s.quantity as f64,
            diagnosis_pointers: vec![1],
            place_of_service: "11".to_string(),
            rendering_provider_npi: "1234567890".to_string(),
        })
        .collect();

    let total_charge: f64 = service_lines.iter().map(|s| s.total_charge).sum();

    let claim = crate::clinical::InsuranceClaim {
        claim_id: claim_id.clone(),
        patient_id: req.patient_id.clone(),
        encounter_id: req.encounter_id.clone(),
        provider_id: current_user_id.clone(),
        facility_id: req.facility_id.clone(),
        insurance: crate::clinical::PatientInsurance {
            payer_id: req.payer_id.clone(),
            payer_name: req.payer_name.clone(),
            plan_name: "Standard Plan".to_string(),
            member_id: req.member_id.clone(),
            group_number: None,
            subscriber_name: "".to_string(),
            subscriber_dob: "".to_string(),
            relationship: "Self".to_string(),
            coverage_type: crate::clinical::CoverageType::Medical,
            priority: crate::clinical::InsurancePriority::Primary,
            effective_date: "2024-01-01".to_string(),
            termination_date: None,
            copay: Some(25.0),
            deductible: Some(500.0),
            deductible_met: Some(350.0),
            out_of_pocket_max: Some(5000.0),
            out_of_pocket_met: Some(1200.0),
        },
        claim_type,
        service_date: req.service_date.clone(),
        service_lines,
        diagnosis_codes,
        total_charge,
        status: crate::clinical::ClaimStatus::Draft,
        submitted_at: None,
        payer_claim_number: None,
        adjudicated_at: None,
        paid_amount: None,
        patient_responsibility: None,
        denied_reason: None,
        eob_received: false,
        created_at: now,
        last_updated: now,
    };

    {
        // Persist via repository (was: in-memory data.insurance_claims HashMap)
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: claim_id.clone(),
            owner_id: claim.patient_id.clone(),
            data: serde_json::to_value(&claim).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data.repositories.insurance_claims.create(entity).await;
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "claim_id": claim_id,
        "total_charge": total_charge,
        "status": "draft",
        "message": "Insurance claim created"
    }))
}

/// Submit insurance claim
#[post("/api/insurance/claims/{claim_id}/submit")]
pub async fn submit_insurance_claim(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let claim_id = path.into_inner();

    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let mut claim: crate::clinical::InsuranceClaim = match data
        .repositories
        .insurance_claims
        .get_by_id(&claim_id)
        .await
        .ok()
        .flatten()
        .and_then(|rec| serde_json::from_value(rec.data).ok())
    {
        Some(c) => c,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Claim not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    if claim.provider_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only the creating provider can submit this claim".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let now = chrono::Utc::now().timestamp();
    claim.submitted_at = Some(now);
    claim.status = crate::clinical::ClaimStatus::Submitted;
    claim.payer_claim_number = Some(format!(
        "PCN-{}",
        uuid::Uuid::new_v4().to_string()[..8].to_uppercase()
    ));
    claim.last_updated = now;

    // Persist the updated claim (upsert preserves original created_at)
    {
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: claim_id.clone(),
            owner_id: claim.patient_id.clone(),
            data: serde_json::to_value(&claim).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data.repositories.insurance_claims.create(entity).await;
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "claim_id": claim_id,
        "payer_claim_number": claim.payer_claim_number,
        "status": "submitted",
        "submitted_at": now,
        "message": "Claim submitted to payer"
    }))
}

/// Get claim status
#[get("/api/insurance/claims/{claim_id}")]
pub async fn get_insurance_claim(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let claim_id = path.into_inner();

    let _current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let claim: crate::clinical::InsuranceClaim = match data
        .repositories
        .insurance_claims
        .get_by_id(&claim_id)
        .await
        .ok()
        .flatten()
        .and_then(|rec| serde_json::from_value(rec.data).ok())
    {
        Some(c) => c,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Claim not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "claim": claim
    }))
}

/// Get patient's insurance claims
#[get("/api/insurance/claims/patient/{patient_id}")]
pub async fn get_patient_insurance_claims(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

    let is_own = current_user_id == patient_id;
    if !is_own && !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let patient_claims: Vec<crate::clinical::InsuranceClaim> = data
        .repositories
        .insurance_claims
        .get_by_owner(&patient_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| serde_json::from_value(r.data).ok())
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "claims": patient_claims,
        "count": patient_claims.len()
    }))
}

/// Check insurance eligibility
#[post("/api/insurance/eligibility")]
pub async fn check_insurance_eligibility(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<crate::clinical::EligibilityCheckRequest>,
) -> impl Responder {
    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let users = data.users.read().unwrap();
    let current_user = match users.get(&current_user_id) {
        Some(u) => u.clone(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };
    drop(users);

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can check eligibility".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let now = chrono::Utc::now().timestamp();
    let today = chrono::Utc::now().date_naive();
    let check_id = format!("EC-{}", uuid::Uuid::new_v4());

    // ── Step 1: verify patient exists ────────────────────────────────────────
    {
        if data
            .repositories
            .patients
            .get_by_id(&req.patient_id)
            .await
            .is_err()
        {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "NOT_FOUND".to_string(),
            });
        }
    }

    // ── Step 2: look up active insurance records via repository ──────────────
    let insurance_records = data
        .repositories
        .insurance_records
        .get_active_by_patient(&req.patient_id)
        .await
        .unwrap_or_default();

    // Use the first active record; fall back to the most-recently-created one
    // if none are flagged active by the repository filter.
    let insurance = insurance_records.into_iter().next();

    let response = match insurance {
        None => {
            // No insurance record on file
            serde_json::json!({
                "success": true,
                "check_id": check_id,
                "patient_id": req.patient_id,
                "checked_at": now,
                "eligible": false,
                "coverage_active": false,
                "plan_name": null,
                "member_id": req.member_id,
                "payer_id": req.payer_id,
                "message": "No insurance record on file",
                "benefits": null,
                "service_coverage": null
            })
        }
        Some(ins) => {
            // ── Step 3: check policy dates ──────────────────────────────────
            let effective_ok = ins.effective_date <= today;
            let not_terminated = ins.termination_date.map(|d| d >= today).unwrap_or(true);
            let policy_active = ins.is_active && effective_ok && not_terminated;

            // ── Step 4: determine service coverage by plan type ─────────────
            // Map plan type string to the set of covered service categories.
            let plan_type_lower = ins.plan_type.as_deref().unwrap_or("unknown").to_lowercase();

            // Services that require pre-authorisation regardless of plan type.
            let auth_required_services = [
                "mri",
                "ct scan",
                "ct",
                "surgery",
                "surgical",
                "specialist",
                "specialist referral",
                "referral",
            ];
            let service_lower = req.service_type.to_lowercase();
            let prior_auth_required = ins.prior_auth_required.unwrap_or(false)
                || auth_required_services
                    .iter()
                    .any(|s| service_lower.contains(s));

            // Determine whether this service type is covered.
            // HMO plans typically require referrals; PPO plans cover more services directly.
            let covered = if !policy_active {
                false
            } else {
                match plan_type_lower.as_str() {
                    "hmo" => {
                        // HMO covers primary care, preventive, emergency, lab, pharmacy.
                        // Specialist/surgery require referral but are still covered.
                        !service_lower.contains("out-of-network")
                            && !service_lower.contains("out of network")
                    }
                    "ppo" => {
                        // PPO covers everything except explicitly excluded services.
                        !service_lower.contains("cosmetic")
                            && !service_lower.contains("experimental")
                    }
                    "epo" => {
                        // EPO — like PPO but no out-of-network coverage.
                        !service_lower.contains("out-of-network")
                            && !service_lower.contains("out of network")
                            && !service_lower.contains("cosmetic")
                    }
                    "pos" => {
                        // Point-of-service: in-network services covered.
                        !service_lower.contains("cosmetic")
                    }
                    "medicare" | "medicaid" => {
                        // Government plans: broad coverage, some exclusions.
                        !service_lower.contains("cosmetic")
                            && !service_lower.contains("experimental")
                    }
                    _ => {
                        // Unknown/other plan types — default to covered if active.
                        true
                    }
                }
            };

            // ── Step 5: calculate remaining deductible ──────────────────────
            let deductible_total = ins
                .deductible_amount
                .map(|d| d.to_string().parse::<f64>().unwrap_or(0.0));
            let deductible_met_val = ins
                .deductible_met
                .map(|d| d.to_string().parse::<f64>().unwrap_or(0.0))
                .unwrap_or(0.0);
            let deductible_remaining = deductible_total.map(|total| {
                let remaining = total - deductible_met_val;
                if remaining < 0.0 {
                    0.0
                } else {
                    remaining
                }
            });

            let oop_max = ins
                .out_of_pocket_max
                .map(|d| d.to_string().parse::<f64>().unwrap_or(0.0));
            let oop_met_val = ins
                .out_of_pocket_met
                .map(|d| d.to_string().parse::<f64>().unwrap_or(0.0))
                .unwrap_or(0.0);
            let oop_remaining = oop_max.map(|max| {
                let remaining = max - oop_met_val;
                if remaining < 0.0 {
                    0.0
                } else {
                    remaining
                }
            });

            let copay = ins
                .copay_amount
                .map(|d| d.to_string().parse::<f64>().unwrap_or(0.0));
            let coinsurance = ins
                .coinsurance_percent
                .map(|d| d.to_string().parse::<f64>().unwrap_or(0.0) as u8);

            serde_json::json!({
                "success": true,
                "check_id": check_id,
                "patient_id": req.patient_id,
                "checked_at": now,
                "eligible": policy_active && covered,
                "coverage_active": policy_active,
                "plan_name": ins.plan_name.unwrap_or_else(|| ins.payer_name.clone()),
                "plan_type": ins.plan_type,
                "member_id": ins.subscriber_id,
                "payer_id": ins.payer_id,
                "payer_name": ins.payer_name,
                "policy_number": ins.policy_number,
                "group_number": ins.group_number,
                "effective_date": ins.effective_date.to_string(),
                "termination_date": ins.termination_date.map(|d| d.to_string()),
                "benefits": {
                    "copay": copay,
                    "deductible": deductible_total,
                    "deductible_met": deductible_met_val,
                    "deductible_remaining": deductible_remaining,
                    "coinsurance_percent": coinsurance,
                    "out_of_pocket_max": oop_max,
                    "out_of_pocket_met": oop_met_val,
                    "out_of_pocket_remaining": oop_remaining
                },
                "service_coverage": {
                    "service_type": req.service_type,
                    "covered": covered,
                    "authorization_required": prior_auth_required,
                    "prior_auth_phone": ins.prior_auth_phone
                }
            })
        }
    };

    // Store the eligibility check result (persisted via repository; was in-memory HashMap)
    {
        let eligibility = crate::clinical::EligibilityCheckResponse {
            check_id: check_id.clone(),
            patient_id: req.patient_id.clone(),
            checked_at: now,
            eligible: response["eligible"].as_bool().unwrap_or(false),
            coverage_active: response["coverage_active"].as_bool().unwrap_or(false),
            plan_name: response["plan_name"].as_str().unwrap_or("").to_string(),
            coverage_details: crate::clinical::CoverageDetails {
                effective_date: response["effective_date"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
                termination_date: response["termination_date"].as_str().map(|s| s.to_string()),
                copay: response["benefits"]["copay"].as_f64(),
                coinsurance_percent: response["benefits"]["coinsurance_percent"]
                    .as_u64()
                    .map(|v| v as u8),
                deductible: response["benefits"]["deductible"].as_f64(),
                deductible_remaining: response["benefits"]["deductible_remaining"].as_f64(),
                out_of_pocket_max: response["benefits"]["out_of_pocket_max"].as_f64(),
                out_of_pocket_remaining: response["benefits"]["out_of_pocket_remaining"].as_f64(),
                in_network: true,
                prior_auth_required: response["service_coverage"]["authorization_required"]
                    .as_bool()
                    .unwrap_or(false),
                referral_required: response["service_coverage"]["authorization_required"]
                    .as_bool()
                    .unwrap_or(false),
            },
            errors: Vec::new(),
        };
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: check_id.clone(),
            owner_id: req.patient_id.clone(),
            data: serde_json::to_value(&eligibility).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data.repositories.eligibility_checks.create(entity).await;
    }

    HttpResponse::Ok().json(response)
}
