//! `clinical_endpoints::insurance_pharmacy::insurance` — insurance verification & eligibility.
//!
//! Split out of the former single-file `insurance_pharmacy.rs` (itself split from the
//! original 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `insurance_pharmacy/mod.rs`
//! so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// ============================================================================
// Insurance Verification API
// ============================================================================

/// Verify insurance coverage
#[post("/api/insurance/verify")]
pub async fn verify_insurance(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let patient_id = match body.get("patient_id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "patient_id is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            });
        }
    };

    // Get patient from repository
    let patient = data.repositories.patients.get_by_id(&patient_id).await.ok();

    match patient {
        Some(_patient) => {
            // Get insurance from repository
            let insurance_list = data
                .repositories
                .insurance_records
                .get_by_patient(&patient_id)
                .await
                .unwrap_or_default();

            match insurance_list.first() {
                Some(insurance) => {
                    // `coverage_active` was `is_active` alone, which reports a
                    // lapsed policy as live: the flag says nothing about whether
                    // today falls inside the policy's own effective/termination
                    // window. Shared with the eligibility endpoint so the two
                    // surfaces cannot disagree about the same policy.
                    let today = chrono::Utc::now().date_naive();
                    let coverage_active =
                        crate::clinical_endpoints::policy_in_force(insurance, today);

                    // The seven service benefits were hardcoded `true` and the
                    // amounts were the literals R500/R300/R150 and R5000/R2500 —
                    // for every patient, on every plan, regardless of the record
                    // this handler had already loaded. A clerk reading
                    // "mental_health: true" off this response would be quoting
                    // cover the payer never confirmed. Benefits now come from the
                    // payer-supplied `coverage_details` schedule and are `null`
                    // when the payer supplied none; the amounts come from the
                    // policy's real stored figures.
                    let service_benefits = insurance
                        .coverage_details
                        .as_ref()
                        .filter(|v| v.is_object())
                        .cloned();

                    HttpResponse::Ok().json(serde_json::json!({
                        "success": true,
                        "patient_id": patient_id,
                        "verification": {
                            "verified": true,
                            "verified_at": chrono::Utc::now().to_rfc3339(),
                            "coverage_active": coverage_active,
                            "provider": insurance.payer_name.clone(),
                            "policy_number": insurance.policy_number.clone(),
                            "group_number": insurance.group_number.clone(),
                            "coverage_type": insurance.plan_type.clone(),
                            "valid_from": insurance.effective_date.to_string(),
                            "valid_to": insurance.termination_date.map(|d| d.to_string()),
                            "benefits": service_benefits,
                            "benefits_source": if insurance.coverage_details.is_some() {
                                "payer_schedule"
                            } else {
                                "not_supplied_by_payer"
                            },
                            "financials": crate::clinical_endpoints::policy_financials(insurance),
                            "prior_auth_required": insurance.prior_auth_required,
                            "prior_auth_phone": insurance.prior_auth_phone.clone(),
                            "last_verified_date": insurance.last_verified_date.map(|d| d.to_string()),
                            "verification_status": insurance.verification_status.clone()
                        }
                    }))
                }
                None => HttpResponse::Ok().json(serde_json::json!({
                    "success": true,
                    "patient_id": patient_id,
                    "verification": {
                        "verified": true,
                        "verified_at": chrono::Utc::now().to_rfc3339(),
                        "coverage_active": false,
                        "message": "No insurance on file. Patient is self-pay."
                    }
                })),
            }
        }
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Patient not found".to_string(),
            code: "PATIENT_NOT_FOUND".to_string(),
        }),
    }
}

/// Get insurance eligibility for a service
// Not registered in routes.rs (2026-07-22): this duplicate-registered on the same
// path as the richer `check_insurance_eligibility` (billing/insurance_eligibility.rs)
// and was silently shadowing it. Flagged as a dead-code deletion candidate rather
// than removed, per this repo's "never delete without asking" rule.
#[allow(dead_code)]
#[post("/api/insurance/eligibility")]
pub async fn check_eligibility(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let patient_id = body
        .get("patient_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let service_code = body
        .get("service_code")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Get patient from repository
    let patient = data.repositories.patients.get_by_id(patient_id).await.ok();

    match patient {
        Some(_patient) => {
            // Get insurance from repository
            let insurance_list = data
                .repositories
                .insurance_records
                .get_by_patient(patient_id)
                .await
                .unwrap_or_default();
            let has_insurance = !insurance_list.is_empty();

            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "patient_id": patient_id,
                "service_code": service_code,
                "eligibility": {
                    "eligible": has_insurance,
                    "checked_at": chrono::Utc::now().to_rfc3339(),
                    "coverage_details": if has_insurance {
                        serde_json::json!({
                            "covered": true,
                            "requires_preauth": service_code.starts_with("99"),
                            "copay_applies": true,
                            "deductible_applies": true
                        })
                    } else {
                        serde_json::json!({
                            "covered": false,
                            "reason": "No active insurance coverage"
                        })
                    }
                }
            }))
        }
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Patient not found".to_string(),
            code: "PATIENT_NOT_FOUND".to_string(),
        }),
    }
}
