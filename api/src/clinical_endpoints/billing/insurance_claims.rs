//! `clinical_endpoints::billing::insurance_claims` — Phase 30 insurance claim handlers.
//!
//! Split out of the former single-file `billing.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `billing/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

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
// The `users` RwLock guard is explicitly `drop()`-ed before this handler's await
// points; clippy's await_holding_lock doesn't recognize manual drops here.
#[allow(clippy::await_holding_lock)]
pub async fn create_insurance_claim(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateInsuranceClaimRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let current_user = match require_known_user(&data, &current_user_id) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

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
        // This repository is the record's persistence. Discarding the result
        // returned success for something that was never stored.
        if let Err(error) = data.repositories.insurance_claims.create(entity).await {
            log::error!("insurance_claims persistence failed: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "The claim could not be saved. Nothing was submitted; please retry."
                    .to_string(),
                code: "INSURANCE_CLAIM_PERSISTENCE_FAILED".to_string(),
            });
        }
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "claim_id": claim_id,
        "total_charge": total_charge,
        // Amounts are denominated in ZAR (African currency), not US dollars.
        "currency": "ZAR",
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

    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
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
        // This repository is the record's persistence. Discarding the result
        // returned success for something that was never stored.
        if let Err(error) = data.repositories.insurance_claims.create(entity).await {
            log::error!("insurance_claims persistence failed: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "The claim could not be saved. Nothing was submitted; please retry."
                    .to_string(),
                code: "INSURANCE_CLAIM_PERSISTENCE_FAILED".to_string(),
            });
        }
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

    let _current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
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
// The `users` RwLock guard is explicitly `drop()`-ed before this handler's await
// points; clippy's await_holding_lock doesn't recognize manual drops here.
#[allow(clippy::await_holding_lock)]
pub async fn get_patient_insurance_claims(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<crate::pagination::CursorQuery>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // Registered caller, NOT clinical-staff-only: a patient must be able to
    // read their own record here. The staff gate rejected them with
    // INSUFFICIENT_ROLE before the self-or-provider check below could run.
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
        .insurance_claims
        .get_by_owner(&patient_id)
        .await
        .unwrap_or_default();
    let (page, next_cursor) =
        crate::pagination::paginate_cursor(&records, query.cursor.as_deref(), query.limit);
    let patient_claims: Vec<crate::clinical::InsuranceClaim> = page
        .into_iter()
        .filter_map(|r| serde_json::from_value(r.data).ok())
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "claims": patient_claims,
        "count": patient_claims.len(),
        "next_cursor": next_cursor
    }))
}
