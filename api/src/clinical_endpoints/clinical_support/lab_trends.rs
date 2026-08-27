//! `clinical_endpoints::clinical_support::lab_trends` — Phase 28 (lab result trending).
//!
//! Split out of the former single-file `clinical_support.rs` (itself split from the
//! original 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `clinical_support/mod.rs`
//! so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// ============================================================================
// PHASE 28: LAB RESULT TRENDING
// ============================================================================

/// Compute descriptive statistics and trend direction for a slice of numeric lab values.
fn compute_lab_statistics(values: &[f64]) -> serde_json::Value {
    if values.is_empty() {
        return serde_json::json!({ "count": 0 });
    }
    let count = values.len() as f64;
    let mean = values.iter().sum::<f64>() / count;
    let variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / count;
    let std_dev = variance.sqrt();
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let min = sorted[0];
    let max = sorted[sorted.len() - 1];
    let median = if sorted.len().is_multiple_of(2) {
        (sorted[sorted.len() / 2 - 1] + sorted[sorted.len() / 2]) / 2.0
    } else {
        sorted[sorted.len() / 2]
    };
    // Trend direction: compare last 3 values to first 3 values
    let trend = if values.len() >= 6 {
        let first_avg = values[..3].iter().sum::<f64>() / 3.0;
        let last_avg = values[values.len() - 3..].iter().sum::<f64>() / 3.0;
        if last_avg > first_avg * 1.1 {
            "increasing"
        } else if last_avg < first_avg * 0.9 {
            "decreasing"
        } else {
            "stable"
        }
    } else {
        "insufficient_data"
    };

    serde_json::json!({
        "count": values.len(),
        "mean": (mean * 100.0).round() / 100.0,
        "std_dev": (std_dev * 100.0).round() / 100.0,
        "min": min,
        "max": max,
        "median": median,
        "trend": trend,
    })
}

/// Get lab trends for patient
#[get("/api/lab-trends/patient/{patient_id}")]
pub async fn get_lab_trends(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let patient_id = path.into_inner();

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

    let test_code = query.get("test_code").cloned();

    let matching_records: Vec<_> = data
        .repositories
        .lab_trend_results
        .get_by_owner(&patient_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|r| {
            serde_json::from_value::<crate::clinical::LabTrendResult>(r.data.clone())
                .map(|t| test_code.as_ref().is_none_or(|code| &t.loinc_code == code))
                .unwrap_or(false)
        })
        .collect();

    // Statistics reflect the full filtered history, not just the returned page.
    let all_trends: Vec<crate::clinical::LabTrendResult> = matching_records
        .iter()
        .filter_map(|r| serde_json::from_value(r.data.clone()).ok())
        .collect();

    let limit = query.get("limit").and_then(|l| l.parse::<usize>().ok());
    let (page_records, next_cursor) = crate::pagination::paginate_cursor(
        &matching_records,
        query.get("cursor").map(String::as_str),
        limit,
    );
    let trends: Vec<crate::clinical::LabTrendResult> = page_records
        .into_iter()
        .filter_map(|r| serde_json::from_value(r.data).ok())
        .collect();

    // Compute aggregate statistics across all data points in the full filtered set
    let all_values: Vec<f64> = all_trends
        .iter()
        .flat_map(|t| t.data_points.iter().map(|dp| dp.value))
        .collect();
    let statistics = compute_lab_statistics(&all_values);

    // Per-test statistics grouped by LOINC code (full filtered history)
    let mut per_test: std::collections::HashMap<String, Vec<f64>> =
        std::collections::HashMap::new();
    for trend in &all_trends {
        let vals = per_test.entry(trend.loinc_code.clone()).or_default();
        for dp in &trend.data_points {
            vals.push(dp.value);
        }
    }
    let per_test_statistics: std::collections::HashMap<String, serde_json::Value> = per_test
        .iter()
        .map(|(code, vals)| (code.clone(), compute_lab_statistics(vals)))
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "trends": trends,
        "count": trends.len(),
        "statistics": statistics,
        "per_test_statistics": per_test_statistics,
        "next_cursor": next_cursor
    }))
}

/// Request trend analysis
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct RequestLabTrendRequest {
    pub patient_id: String,
    pub test_codes: Vec<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

/// Request lab trend analysis
#[post("/api/lab-trends/analyze")]
pub async fn analyze_lab_trends(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<RequestLabTrendRequest>,
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
            error: "Only healthcare providers can request trend analysis".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let now = chrono::Utc::now().timestamp();
    let mut results: Vec<crate::clinical::LabTrendResult> = Vec::new();

    for test_code in &req.test_codes {
        // Generate data points first so we can compute real statistics
        let result_id = format!("LT-{}", uuid::Uuid::new_v4());
        let data_points = generate_sample_data_points(test_code, now);

        // Compute real statistics from the data points
        let point_values: Vec<f64> = data_points.iter().map(|dp| dp.value).collect();
        let stats = compute_lab_statistics(&point_values);

        // Derive trend direction and metrics from statistics
        let trend_str = stats["trend"].as_str().unwrap_or("stable");
        let trend_direction = match trend_str {
            "increasing" => crate::clinical::TrendDirection::Increasing,
            "decreasing" => crate::clinical::TrendDirection::Decreasing,
            _ => crate::clinical::TrendDirection::Stable,
        };
        let mean_val = stats["mean"].as_f64().unwrap_or(0.0);
        let min_val = stats["min"].as_f64().unwrap_or(0.0);
        let percent_change = if min_val != 0.0 {
            ((mean_val - min_val) / min_val * 100.0 * 100.0).round() / 100.0
        } else {
            0.0
        };
        let statistically_significant = stats["std_dev"].as_f64().unwrap_or(0.0) > mean_val * 0.1;
        let clinical_significance = match trend_str {
            "increasing" => format!(
                "Upward trend detected. Mean: {} (std dev: {}). Monitor closely.",
                stats["mean"], stats["std_dev"]
            ),
            "decreasing" => format!(
                "Downward trend detected. Mean: {} (std dev: {}). Review with clinician.",
                stats["mean"], stats["std_dev"]
            ),
            _ => format!(
                "Values stable. Mean: {} (std dev: {}). No significant change from baseline.",
                stats["mean"], stats["std_dev"]
            ),
        };

        let trend_result = crate::clinical::LabTrendResult {
            result_id: result_id.clone(),
            patient_id: req.patient_id.clone(),
            loinc_code: test_code.clone(),
            test_name: get_test_name(test_code),
            unit: get_test_unit(test_code),
            reference_range: Some(crate::clinical::ReferenceRange {
                low: Some(get_reference_low(test_code)),
                high: Some(get_reference_high(test_code)),
                critical_low: None,
                critical_high: None,
                unit: get_test_unit(test_code),
                age_specific: false,
                gender_specific: false,
            }),
            data_points,
            trend_analysis: crate::clinical::TrendAnalysis {
                direction: trend_direction,
                percent_change: Some(percent_change),
                rate_of_change: Some(stats["std_dev"].as_f64().unwrap_or(0.0)),
                rate_unit: Some("per_month".to_string()),
                statistically_significant,
                clinical_significance,
                prediction: None,
            },
            generated_at: now,
        };

        {
            // Persist via repository (was: in-memory data.lab_trends HashMap)
            let now_dt = chrono::Utc::now();
            let entity = crate::repositories::traits::JsonRecordEntity {
                id: result_id.clone(),
                owner_id: req.patient_id.clone(),
                data: serde_json::to_value(&trend_result).unwrap_or_default(),
                created_at: now_dt,
                updated_at: now_dt,
            };
            // This repository is the record's persistence. Discarding the result
            // returned success for something that was never stored.
            if let Err(error) = data.repositories.lab_trend_results.create(entity).await {
                log::error!("lab_trend_results persistence failed: {error}");
                return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                    success: false,
                    error: "The trend result could not be saved; please retry.".to_string(),
                    code: "LAB_TREND_RESULT_PERSISTENCE_FAILED".to_string(),
                });
            }
        }
        results.push(trend_result);
    }

    // Compute aggregate statistics across all results
    let all_values: Vec<f64> = results
        .iter()
        .flat_map(|r| r.data_points.iter().map(|dp| dp.value))
        .collect();
    let aggregate_statistics = compute_lab_statistics(&all_values);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": req.patient_id,
        "trends": results,
        "count": results.len(),
        "aggregate_statistics": aggregate_statistics
    }))
}

/// Get specific trend result
#[get("/api/lab-trends/{result_id}")]
pub async fn get_lab_trend_result(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let result_id = path.into_inner();

    let _current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let trend: crate::clinical::LabTrendResult = match data
        .repositories
        .lab_trend_results
        .get_by_id(&result_id)
        .await
        .ok()
        .flatten()
        .and_then(|rec| serde_json::from_value(rec.data).ok())
    {
        Some(t) => t,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Trend result not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "trend": trend
    }))
}

// Helper functions for lab trending
fn get_test_name(loinc_code: &str) -> String {
    match loinc_code {
        "2345-7" => "Glucose".to_string(),
        "2160-0" => "Creatinine".to_string(),
        "17861-6" => "Calcium".to_string(),
        "2951-2" => "Sodium".to_string(),
        "2823-3" => "Potassium".to_string(),
        "718-7" => "Hemoglobin".to_string(),
        "4548-4" => "Hemoglobin A1c".to_string(),
        "2093-3" => "Cholesterol".to_string(),
        _ => format!("Test {}", loinc_code),
    }
}

fn get_test_unit(loinc_code: &str) -> String {
    match loinc_code {
        "2345-7" => "mg/dL".to_string(),
        "2160-0" => "mg/dL".to_string(),
        "17861-6" => "mg/dL".to_string(),
        "2951-2" => "mEq/L".to_string(),
        "2823-3" => "mEq/L".to_string(),
        "718-7" => "g/dL".to_string(),
        "4548-4" => "%".to_string(),
        "2093-3" => "mg/dL".to_string(),
        _ => "units".to_string(),
    }
}

fn get_reference_low(loinc_code: &str) -> f64 {
    match loinc_code {
        "2345-7" => 70.0,
        "2160-0" => 0.7,
        "17861-6" => 8.5,
        "2951-2" => 136.0,
        "2823-3" => 3.5,
        "718-7" => 12.0,
        "4548-4" => 4.0,
        "2093-3" => 125.0,
        _ => 0.0,
    }
}

fn get_reference_high(loinc_code: &str) -> f64 {
    match loinc_code {
        "2345-7" => 100.0,
        "2160-0" => 1.3,
        "17861-6" => 10.5,
        "2951-2" => 145.0,
        "2823-3" => 5.0,
        "718-7" => 17.5,
        "4548-4" => 5.6,
        "2093-3" => 200.0,
        _ => 100.0,
    }
}

fn generate_sample_data_points(loinc_code: &str, now: i64) -> Vec<crate::clinical::LabDataPoint> {
    let base_value = match loinc_code {
        "2345-7" => 95.0,
        "2160-0" => 1.0,
        "718-7" => 14.5,
        "4548-4" => 5.4,
        _ => 50.0,
    };

    let day_seconds = 86400;
    let mut points = Vec::new();

    for i in 0..5 {
        let variation = (i as f64 * 0.02) - 0.04;
        points.push(crate::clinical::LabDataPoint {
            result_id: format!("LR-{}", uuid::Uuid::new_v4()),
            value: base_value * (1.0 + variation),
            collected_at: now - (i * 30 * day_seconds),
            status: crate::clinical::LabValueStatus::Normal,
            flag: None,
            performing_lab: "MediChain Central Lab".to_string(),
        });
    }

    points
}
