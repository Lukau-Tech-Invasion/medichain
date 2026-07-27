//! `clinical_endpoints::billing::insurance_eligibility` — insurance eligibility check handler.
//!
//! Split out of the former single-file `billing.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `billing/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

/// Response payload when the patient has no insurance record on file at all.
fn no_insurance_eligibility_response(
    check_id: &str,
    req: &crate::clinical::EligibilityCheckRequest,
    now: i64,
) -> serde_json::Value {
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

/// Whether a service type is covered under a plan type, given the policy is
/// active. HMO plans typically require referrals; PPO plans cover more
/// services directly; government plans (Medicare/Medicaid) have broad
/// coverage with some standard exclusions.
fn is_service_covered(plan_type_lower: &str, service_lower: &str) -> bool {
    match plan_type_lower {
        "hmo" | "epo" => {
            let no_oon = !service_lower.contains("out-of-network")
                && !service_lower.contains("out of network");
            if plan_type_lower == "epo" {
                no_oon && !service_lower.contains("cosmetic")
            } else {
                no_oon
            }
        }
        "ppo" | "medicare" | "medicaid" => {
            !service_lower.contains("cosmetic") && !service_lower.contains("experimental")
        }
        "pos" => !service_lower.contains("cosmetic"),
        // Unknown/other plan types — default to covered if active.
        _ => true,
    }
}

/// Builds the eligibility response for a patient with an active insurance
/// record: policy-date checks, plan-type coverage rules, and remaining
/// deductible/out-of-pocket calculations.
fn build_eligibility_response(
    check_id: &str,
    req: &crate::clinical::EligibilityCheckRequest,
    ins: crate::repositories::traits::InsuranceRecordEntity,
    today: chrono::NaiveDate,
    now: i64,
) -> serde_json::Value {
    let effective_ok = ins.effective_date <= today;
    let not_terminated = ins.termination_date.map(|d| d >= today).unwrap_or(true);
    let policy_active = ins.is_active && effective_ok && not_terminated;

    let plan_type_lower = ins.plan_type.as_deref().unwrap_or("unknown").to_lowercase();
    let service_lower = req.service_type.to_lowercase();

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
    let prior_auth_required = ins.prior_auth_required.unwrap_or(false)
        || auth_required_services
            .iter()
            .any(|s| service_lower.contains(s));

    let covered = policy_active && is_service_covered(&plan_type_lower, &service_lower);

    let deductible_total = ins
        .deductible_amount
        .map(|d| d.to_string().parse::<f64>().unwrap_or(0.0));
    let deductible_met_val = ins
        .deductible_met
        .map(|d| d.to_string().parse::<f64>().unwrap_or(0.0))
        .unwrap_or(0.0);
    let deductible_remaining = deductible_total.map(|total| (total - deductible_met_val).max(0.0));

    let oop_max = ins
        .out_of_pocket_max
        .map(|d| d.to_string().parse::<f64>().unwrap_or(0.0));
    let oop_met_val = ins
        .out_of_pocket_met
        .map(|d| d.to_string().parse::<f64>().unwrap_or(0.0))
        .unwrap_or(0.0);
    let oop_remaining = oop_max.map(|max| (max - oop_met_val).max(0.0));

    let copay = ins
        .copay_amount
        .map(|d| d.to_string().parse::<f64>().unwrap_or(0.0));
    let coinsurance = ins
        .coinsurance_percent
        .map(|d| d.to_string().parse::<f64>().unwrap_or(0.0) as u8);
    // Currency code so the frontend formats amounts in the African
    // denomination (default ZAR) rather than assuming US dollars.
    let currency = ins.currency.clone().unwrap_or_else(|| "ZAR".to_string());

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
            "currency": currency,
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

/// Persists the eligibility check result via the repository (was an
/// in-memory HashMap) so it survives a restart.
async fn persist_eligibility_check(
    data: &web::Data<crate::AppState>,
    check_id: &str,
    patient_id: &str,
    response: &serde_json::Value,
    now: i64,
) {
    let eligibility = crate::clinical::EligibilityCheckResponse {
        check_id: check_id.to_string(),
        patient_id: patient_id.to_string(),
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
        id: check_id.to_string(),
        owner_id: patient_id.to_string(),
        data: serde_json::to_value(&eligibility).unwrap_or_default(),
        created_at: now_dt,
        updated_at: now_dt,
    };
    let _ = data.repositories.eligibility_checks.create(entity).await;
}

/// Check insurance eligibility
#[post("/api/insurance/eligibility")]
pub async fn check_insurance_eligibility(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<crate::clinical::EligibilityCheckRequest>,
) -> impl Responder {
    let current_user_id = match require_x_user_id_header(&http_req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    let current_user = match require_known_user(&data, &current_user_id) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

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

    // Use the first active insurance record on file, if any.
    let insurance = data
        .repositories
        .insurance_records
        .get_active_by_patient(&req.patient_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .next();

    let response = match insurance {
        None => no_insurance_eligibility_response(&check_id, &req, now),
        Some(ins) => build_eligibility_response(&check_id, &req, ins, today, now),
    };

    persist_eligibility_check(&data, &check_id, &req.patient_id, &response, now).await;

    HttpResponse::Ok().json(response)
}
