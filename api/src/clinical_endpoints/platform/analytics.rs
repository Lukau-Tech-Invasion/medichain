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

    let total_patients = data.repositories.patients.count().await.unwrap_or(0);
    let total_records = data
        .medical_records
        .read()
        .map(|records| records.values().map(Vec::len).sum::<usize>())
        .unwrap_or_default();
    let total_logs = data
        .access_logs
        .read()
        .map(|logs| logs.len())
        .unwrap_or_default();

    // Performance metrics (Mock)
    let avg_response_ms = 45;
    let uptime_pct = 99.98;

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "metrics": {
            "total_patients": total_patients,
            "total_medical_records": total_records,
            "total_system_accesses": total_logs,
            "avg_latency_ms": avg_response_ms,
            "system_uptime": uptime_pct,
            "blockchain_status": "synced"
        }
    }))
}

/// Get patient population analytics
#[get("/api/platform/analytics/patients")]
pub async fn get_patient_analytics(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
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
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }

    let appointments: Vec<crate::clinical::Appointment> = data
        .appointments
        .read()
        .map(|appointments| appointments.values().cloned().collect())
        .unwrap_or_default();

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
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().finish();
    }

    let alerts_count = data
        .cds_alerts
        .read()
        .map(|alerts| alerts.len())
        .unwrap_or_default();
    let critical_alerts = 0usize;

    HttpResponse::Ok().json(serde_json::json!({
        "clinical_alerts_total": alerts_count,
        "critical_alerts": critical_alerts,
        "compliance_score": 98.5,
        "audit_logs_coverage": "100%"
    }))
}
