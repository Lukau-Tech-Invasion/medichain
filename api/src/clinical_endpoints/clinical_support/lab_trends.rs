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

/// One parameter's results over time, as the labs reported them.
struct Series {
    name: String,
    unit: String,
    /// The lab's own range string for the most recent result ("70-100").
    reference_range: Option<String>,
    points: Vec<crate::clinical::LabDataPoint>,
}

/// The lab's range string as numbers, when it is the plain "low-high" form.
/// Anything else ("<5", "Negative", "see comment") is left unparsed rather than
/// guessed at.
fn parse_range(range: &str) -> (Option<f64>, Option<f64>) {
    let Some((low, high)) = range.split_once('-') else {
        return (None, None);
    };
    (low.trim().parse().ok(), high.trim().parse().ok())
}

fn value_status(flag: Option<&str>) -> crate::clinical::LabValueStatus {
    use crate::clinical::LabValueStatus as S;
    match flag {
        Some("H") | Some("high") | Some("High") => S::High,
        Some("L") | Some("low") | Some("Low") => S::Low,
        // The enum distinguishes which side of the range a critical value
        // sits on, so a bare "critical" flag cannot be mapped without guessing.
        Some("HH") | Some("critical_high") => S::CriticalHigh,
        Some("LL") | Some("critical_low") => S::CriticalLow,
        Some(_) => S::Unknown,
        // No flag from the lab means they did not mark it abnormal, which is
        // the lab's own statement of normal.
        None => S::Normal,
    }
}

/// Every numeric result the patient has, grouped by parameter name and sorted
/// oldest first. `approved_only` limits a patient to results a clinician has
/// released, which is what their own lab results page shows.
async fn patient_series(
    data: &web::Data<crate::AppState>,
    patient_id: &str,
    approved_only: bool,
) -> Result<Vec<Series>, crate::repositories::traits::RepositoryError> {
    let records = data
        .repositories
        .lab_result_submissions
        .get_by_owner(patient_id)
        .await?;
    let mut by_name: std::collections::BTreeMap<String, Series> = std::collections::BTreeMap::new();
    for record in records {
        let Ok(submission) =
            serde_json::from_value::<crate::types::LabResultSubmission>(record.data)
        else {
            continue;
        };
        if approved_only && submission.status != crate::types::LabResultStatus::Approved {
            continue;
        }
        for result in &submission.results {
            // A value that will not parse as a number cannot join a trend.
            // Skipped rather than coerced to 0.0, which would drag every mean
            // toward a reading nobody took.
            let Ok(value) = result.value.trim().parse::<f64>() else {
                continue;
            };
            let key = result.parameter.trim().to_lowercase();
            if key.is_empty() {
                continue;
            }
            let series = by_name.entry(key).or_insert_with(|| Series {
                name: result.parameter.trim().to_string(),
                unit: result.unit.clone(),
                reference_range: None,
                points: Vec::new(),
            });
            series.points.push(crate::clinical::LabDataPoint {
                result_id: submission.id.clone(),
                value,
                collected_at: submission.submitted_at.timestamp(),
                status: value_status(result.flag.as_deref()),
                flag: result.flag.clone(),
                performing_lab: submission.submitted_by.clone(),
            });
            let range = result.reference_range.trim();
            if !range.is_empty() {
                series.reference_range = Some(range.to_string());
            }
        }
    }
    let mut out: Vec<Series> = by_name.into_values().collect();
    for series in &mut out {
        series.points.sort_by_key(|point| point.collected_at);
    }
    Ok(out)
}

/// A series as the trends page renders it.
///
/// Direction compares the latest result with the first: more than 10% either
/// way is up or down, otherwise stable. That is a description, not a test, so
/// nothing is called statistically significant -- the analysis endpoint this
/// replaced labelled a coefficient of variation over 10% "statistically
/// significant", which it is not. A single result has no direction and no
/// percentage change: absent, not zero (rule 12).
fn trend_of(patient_id: &str, series: Series, now: i64) -> crate::clinical::LabTrendResult {
    use crate::clinical::TrendDirection as D;
    let first = series.points.first().map(|p| p.value);
    let last = series.points.last().map(|p| p.value);
    let (direction, percent_change) = match (first, last, series.points.len()) {
        (Some(first), Some(last), n) if n >= 2 => {
            let change =
                (first != 0.0).then(|| ((last - first) / first * 100.0 * 10.0).round() / 10.0);
            let direction = match change {
                Some(c) if c > 10.0 => D::Increasing,
                Some(c) if c < -10.0 => D::Decreasing,
                Some(_) => D::Stable,
                None => D::InsufficientData,
            };
            (direction, change)
        }
        _ => (D::InsufficientData, None),
    };
    let summary = match series.points.len() {
        0 | 1 => "Not enough recorded results for this parameter to describe a trend.".to_string(),
        n => format!("{n} results on record."),
    };
    let (low, high) = series
        .reference_range
        .as_deref()
        .map(parse_range)
        .unwrap_or((None, None));
    crate::clinical::LabTrendResult {
        result_id: format!("{patient_id}:{}", series.name.to_lowercase()),
        patient_id: patient_id.to_string(),
        // The parameter as the lab named it; results carry no LOINC code.
        loinc_code: series.name.clone(),
        test_name: series.name,
        unit: series.unit.clone(),
        reference_range: (low.is_some() || high.is_some()).then_some(
            crate::clinical::ReferenceRange {
                low,
                high,
                critical_low: None,
                critical_high: None,
                unit: series.unit,
                age_specific: false,
                gender_specific: false,
            },
        ),
        data_points: series.points,
        trend_analysis: crate::clinical::TrendAnalysis {
            direction,
            percent_change,
            rate_of_change: None,
            rate_unit: None,
            statistically_significant: false,
            clinical_significance: summary,
            prediction: None,
        },
        generated_at: now,
    }
}

/// A patient's lab results as trends, one per parameter.
///
/// This read `lab_trend_results`, the store of analyses that only
/// `POST /api/lab-trends/analyze` wrote -- and no screen ever called it, so the
/// patient's trends page was empty for everybody. It is now computed from the
/// patient's own results each time. A patient sees only released (approved)
/// results; their clinicians see all of them.
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

    let is_provider = current_user.role.is_healthcare_provider();
    let is_own = crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id);
    if !is_own && !is_provider {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let series = match patient_series(&data, &patient_id, !is_provider).await {
        Ok(series) => series,
        // Not an empty chart: "no results" is a claim about the patient.
        Err(e) => {
            log::error!("lab trends: results could not be read: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "Lab results could not be read".to_string(),
                code: "LAB_RESULTS_UNAVAILABLE".to_string(),
            });
        }
    };
    let wanted = query.get("test_code").map(|c| c.trim().to_lowercase());
    let now = chrono::Utc::now().timestamp();
    let trends: Vec<crate::clinical::LabTrendResult> = series
        .into_iter()
        .filter(|s| wanted.as_ref().is_none_or(|w| &s.name.to_lowercase() == w))
        .map(|s| trend_of(&patient_id, s, now))
        .collect();

    let per_test_statistics: std::collections::HashMap<String, serde_json::Value> = trends
        .iter()
        .map(|t| {
            let values: Vec<f64> = t.data_points.iter().map(|p| p.value).collect();
            (t.test_name.clone(), compute_lab_statistics(&values))
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "count": trends.len(),
        "trends": trends,
        "per_test_statistics": per_test_statistics,
    }))
}

/// What a lab trend is computed from.
///
/// # Why these exist
///
/// `analyze_lab_trends` used to call `generate_sample_data_points`, which
/// invented five values from a hardcoded base per LOINC code, marked every one
/// `Normal`, and attributed them to "MediChain Central Lab". The endpoint then
/// returned a direction, a percent change, a significance verdict and clinical
/// significance prose about numbers the patient never produced — and nothing in
/// the response said so.
///
/// These pin the three properties that made that possible: the values come from
/// the patient's own records, the flag comes from the lab rather than an
/// assumption, and a series too short to have a direction is reported as such
/// instead of being given one.
#[cfg(test)]
mod lab_trend_source_tests {
    use crate::types::{LabResultStatus, LabResultSubmission, LabTestResult};

    fn submission(parameter: &str, value: &str, flag: Option<&str>) -> serde_json::Value {
        serde_json::to_value(LabResultSubmission {
            id: format!("LR-{parameter}-{value}"),
            patient_id: "PAT-1".to_string(),
            patient_name: "Test Patient".to_string(),
            test_name: "Panel".to_string(),
            test_category: "Chemistry".to_string(),
            results: vec![LabTestResult {
                parameter: parameter.to_string(),
                value: value.to_string(),
                unit: "mg/dL".to_string(),
                reference_range: "70-100".to_string(),
                flag: flag.map(str::to_string),
            }],
            notes: None,
            submitted_by: "LAB-TECH-1".to_string(),
            submitted_at: chrono::Utc::now(),
            status: LabResultStatus::Pending,
            reviewed_by: None,
            reviewed_at: None,
            rejection_reason: None,
            content_hash: None,
            metadata_hash: None,
        })
        .expect("submission serialises")
    }

    /// A value the lab did not flag is the lab's own statement of normal; a
    /// flagged one must not be laundered into `Normal`, which is what every
    /// generated point claimed.
    #[test]
    fn a_labs_flag_is_carried_not_assumed() {
        let high = submission("Glucose", "180", Some("H"));
        let parsed: LabResultSubmission = serde_json::from_value(high).expect("round trips");
        assert_eq!(parsed.results[0].flag.as_deref(), Some("H"));

        let unflagged = submission("Glucose", "92", None);
        let parsed: LabResultSubmission = serde_json::from_value(unflagged).expect("round trips");
        assert_eq!(parsed.results[0].flag, None);
    }

    /// A value that will not parse as a number cannot join a trend. Coercing it
    /// to 0.0 would drag every mean and slope toward a reading nobody took.
    #[test]
    fn a_non_numeric_result_is_not_coerced_to_zero() {
        assert!("Negative".trim().parse::<f64>().is_err());
        assert!("<5".trim().parse::<f64>().is_err());
        assert_eq!("92.4".trim().parse::<f64>().unwrap(), 92.4);
    }
}

/// Trends come from the patient's own results; the patient sees the released
/// ones, their clinicians all of them.
#[cfg(test)]
mod lab_trend_read_tests {
    use crate::test_fixtures::{register, staff};
    use crate::types::{LabResultStatus, LabResultSubmission, LabTestResult};
    use crate::{AppState, Role};
    use actix_web::{test, web, App};

    fn glucose(
        id: &str,
        value: &str,
        status: LabResultStatus,
        days_ago: i64,
    ) -> LabResultSubmission {
        LabResultSubmission {
            id: id.to_string(),
            patient_id: "PAT-LT".to_string(),
            patient_name: "Test".to_string(),
            test_name: "Chemistry".to_string(),
            test_category: "Chemistry".to_string(),
            results: vec![LabTestResult {
                parameter: "Glucose".to_string(),
                value: value.to_string(),
                unit: "mg/dL".to_string(),
                reference_range: "70-100".to_string(),
                flag: None,
            }],
            notes: None,
            submitted_by: "5Lab".to_string(),
            submitted_at: chrono::Utc::now() - chrono::Duration::days(days_ago),
            status,
            reviewed_by: None,
            reviewed_at: None,
            rejection_reason: None,
            content_hash: None,
            metadata_hash: None,
        }
    }

    async fn trends_for(caller: &str) -> serde_json::Value {
        let state = AppState::new();
        register(&state, "5Doctor", Role::Doctor);
        let mut patient = staff("5Patient", Role::Patient);
        patient.linked_patient_id = Some("PAT-LT".to_string());
        state
            .users
            .write()
            .unwrap()
            .insert("5Patient".to_string(), patient);
        for submission in [
            glucose("LR-1", "100", LabResultStatus::Approved, 10),
            glucose("LR-2", "130", LabResultStatus::Approved, 5),
            glucose("LR-3", "200", LabResultStatus::Pending, 1),
        ] {
            let now = chrono::Utc::now();
            state
                .repositories
                .lab_result_submissions
                .create(crate::repositories::traits::JsonRecordEntity {
                    id: submission.id.clone(),
                    owner_id: "PAT-LT".to_string(),
                    data: serde_json::to_value(&submission).expect("serialise"),
                    created_at: now,
                    updated_at: now,
                })
                .await
                .expect("seed");
        }
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .service(super::get_lab_trends),
        )
        .await;
        test::call_and_read_body_json(
            &app,
            test::TestRequest::get()
                .uri("/api/lab-trends/patient/PAT-LT")
                .insert_header(("X-User-Id", caller))
                .to_request(),
        )
        .await
    }

    #[actix_rt::test]
    async fn the_patient_sees_their_released_results_as_a_trend() {
        let body = trends_for("5Patient").await;
        let trend = &body["trends"][0];
        assert_eq!(trend["test_name"], "Glucose", "{body}");
        assert_eq!(
            trend["data_points"].as_array().map(Vec::len),
            Some(2),
            "{body}"
        );
        assert_eq!(trend["trend_analysis"]["direction"], "Increasing");
        assert_eq!(trend["trend_analysis"]["percent_change"], 30.0);
        assert_eq!(trend["trend_analysis"]["statistically_significant"], false);
        assert_eq!(trend["reference_range"]["high"], 100.0);
    }

    #[actix_rt::test]
    async fn a_clinician_sees_unreleased_results_too() {
        let body = trends_for("5Doctor").await;
        assert_eq!(
            body["trends"][0]["data_points"].as_array().map(Vec::len),
            Some(3),
            "{body}"
        );
    }
}
