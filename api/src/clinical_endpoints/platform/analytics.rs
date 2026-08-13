use super::*;

// ============================================================================
// SYSTEM ANALYTICS & METRICS
// ============================================================================

/// Analytics query parameters
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct AnalyticsQueryRequest {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub metric_type: Option<String>,
    pub patient_id: Option<String>,
}

/// Get high-level dashboard metrics for administrators
#[get("/api/platform/analytics/dashboard")]
pub async fn get_dashboard_metrics(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    _query: web::Query<AnalyticsQueryRequest>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => return HttpResponse::Unauthorized().finish(),
    };

    if !user.role.is_admin() {
        return HttpResponse::Forbidden().finish();
    }

    // Counted from the repositories, so the numbers survive a restart and
    // match what is actually stored. They previously came from process-memory
    // maps, which reported 0 after every deploy.
    let total_patients = data.repositories.patients.count().await.unwrap_or(0);
    let total_records = data.repositories.medical_records.count().await.unwrap_or(0);
    let total_logs = data
        .repositories
        .access_logs
        .list(crate::repositories::Pagination::new(0, 1))
        .await
        .map(|page| page.total)
        .unwrap_or(0);

    // `avg_latency_ms`, `system_uptime` and `blockchain_status` used to be the
    // literals 45, 99.98 and "synced" — an operations dashboard that reported
    // a healthy system no matter what was true, including while the chain was
    // unreachable. Latency and uptime need a metrics backend this deployment
    // does not have, so they are reported as null rather than invented; the
    // chain status is something we can actually answer.
    let blockchain_status = if !crate::blockchain::blockchain_enabled() {
        "disabled"
    } else if data
        .substrate_client
        .as_ref()
        .is_some_and(|client| client.is_ready())
    {
        "connected"
    } else {
        "unavailable"
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "metrics": {
            "total_patients": total_patients,
            "total_medical_records": total_records,
            "total_system_accesses": total_logs,
            "avg_latency_ms": serde_json::Value::Null,
            "system_uptime": serde_json::Value::Null,
            "blockchain_status": blockchain_status
        }
    }))
}

/// Get patient population analytics
#[get("/api/platform/analytics/patients")]
pub async fn get_patient_analytics(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let total_population = data.repositories.patients.count().await.unwrap_or(0);
    let gender_dist: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    HttpResponse::Ok().json(serde_json::json!({
        "gender_distribution": gender_dist,
        "total_population": total_population
    }))
}

/// Get appointment & volume analytics
#[get("/api/platform/analytics/appointments")]
pub async fn get_appointment_analytics(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let appointments: Vec<crate::clinical::Appointment> =
        crate::clinical_endpoints::fetch_all_appointments(&data).await;

    let mut status_counts = std::collections::HashMap::new();
    for a in &appointments {
        let entry = status_counts.entry(format!("{:?}", a.status)).or_insert(0);
        *entry += 1;
    }

    HttpResponse::Ok().json(serde_json::json!({
        "status_distribution": status_counts,
        "total_appointments": appointments.len()
    }))
}

/// Get quality and compliance metrics
#[get("/api/platform/analytics/quality")]
pub async fn get_quality_metrics(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    // Both counts come from one repository call so they cannot disagree.
    // `critical_alerts` was previously the literal `0` regardless of how many
    // critical alerts existed — the one number on this dashboard a clinician
    // would act on, hardcoded to "nothing wrong".
    let (alerts_count, critical_alerts) =
        match data.repositories.cds_alerts.count_by_severity().await {
            Ok(counts) => counts,
            Err(e) => {
                log::error!("quality metrics: CDS alert counts unavailable: {e}");
                return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                    success: false,
                    error: "Quality metrics are unavailable because alert counts could not be read"
                        .to_string(),
                    code: "METRICS_UNAVAILABLE".to_string(),
                });
            }
        };

    // `compliance_score: 98.5` and `audit_logs_coverage: "100%"` were literals.
    // A compliance score is a reviewed assessment, not something this endpoint
    // can compute, and claiming 100% audit coverage without measuring it is the
    // kind of assertion a POPIA audit would take at face value. Reported as
    // null until there is a real calculation behind them.
    HttpResponse::Ok().json(serde_json::json!({
        "clinical_alerts_total": alerts_count,
        "critical_alerts": critical_alerts,
        "compliance_score": serde_json::Value::Null,
        "audit_logs_coverage": serde_json::Value::Null
    }))
}
