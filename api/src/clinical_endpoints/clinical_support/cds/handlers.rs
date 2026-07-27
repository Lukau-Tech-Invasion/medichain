//! `clinical_endpoints::clinical_support::cds::handlers` — Phase 27 CDS alert HTTP
//! endpoints (create/list/get/respond).
//!
//! Split out of the former single-file `cds.rs` (itself split from `clinical_support.rs`,
//! itself split from the original 21K-line `clinical_endpoints.rs` monolith, Phase 10.1).
//! Inherits shared imports/helpers via `use super::*`; glob-re-exported by `cds/mod.rs`
//! so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

/// Create a new CDS alert
#[post("/api/cds/alerts")]
pub async fn create_cds_alert(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateCDSAlertRequest>,
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
            error: "Only healthcare providers can create CDS alerts".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let alert_type = match req.alert_type.as_str() {
        "drug_interaction" => crate::clinical::CDSAlertType::DrugInteraction,
        "drug_allergy" => crate::clinical::CDSAlertType::DrugAllergy,
        "duplicate_therapy" => crate::clinical::CDSAlertType::DuplicateTherapy,
        "dose_range" => crate::clinical::CDSAlertType::DoseRangeCheck,
        "preventive_care" => crate::clinical::CDSAlertType::PreventiveCare,
        "diagnostic_gap" => crate::clinical::CDSAlertType::DiagnosticGap,
        "lab_abnormal" => crate::clinical::CDSAlertType::LaboratoryAbnormal,
        "vital_abnormal" => crate::clinical::CDSAlertType::VitalSignAbnormal,
        "care_plan_deviation" => crate::clinical::CDSAlertType::CarePlanDeviation,
        "quality_measure" => crate::clinical::CDSAlertType::QualityMeasure,
        "cost_saving" => crate::clinical::CDSAlertType::CostSavingOpportunity,
        "best_practice" => crate::clinical::CDSAlertType::BestPracticeAdvisory,
        "order_set" => crate::clinical::CDSAlertType::OrderSet,
        _ => crate::clinical::CDSAlertType::BestPracticeAdvisory,
    };

    let severity = match req.severity.as_str() {
        "informational" => crate::clinical::CDSSeverity::Informational,
        "low" => crate::clinical::CDSSeverity::Low,
        "medium" => crate::clinical::CDSSeverity::Medium,
        "high" => crate::clinical::CDSSeverity::High,
        "critical" => crate::clinical::CDSSeverity::Critical,
        _ => crate::clinical::CDSSeverity::Medium,
    };

    let alert_id = format!("CDS-{}", uuid::Uuid::new_v4());
    let now = chrono::Utc::now().timestamp();

    let alert = crate::clinical::CDSAlert {
        alert_id: alert_id.clone(),
        patient_id: req.patient_id.clone(),
        provider_id: current_user_id.clone(),
        alert_type,
        severity,
        title: req.title.clone(),
        description: req.description.clone(),
        clinical_context: req.clinical_context.clone(),
        triggering_data: serde_json::json!({}),
        recommended_actions: Vec::new(),
        evidence: Vec::new(),
        guideline_reference: req.guideline_reference.clone(),
        created_at: now,
        expires_at: req.expires_at,
        status: crate::clinical::CDSAlertStatus::Active,
        response: None,
    };

    let entity: crate::repositories::traits::CdsAlertEntity = alert.into();
    if let Err(e) = data.repositories.cds_alerts.create(entity).await {
        log::error!("CDS alert persistence failed: {}", e);
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Failed to persist CDS alert".to_string(),
            code: "PERSISTENCE_ERROR".to_string(),
        });
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "alert_id": alert_id,
        "message": "CDS alert created successfully"
    }))
}

/// Get CDS alerts for provider
#[get("/api/cds/alerts")]
pub async fn get_cds_alerts(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
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
            error: "Only healthcare providers can view CDS alerts".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let patient_id = query.get("patient_id").cloned();
    let status_filter = query.get("status").cloned();

    // Repository can filter by patient; provider + status filtered in-memory.
    let entities = match patient_id.as_deref() {
        Some(pid) => match data
            .repositories
            .cds_alerts
            .get_by_patient(pid, false)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                log::error!("Failed to fetch CDS alerts by patient: {}", e);
                return HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Failed to fetch alerts".to_string(),
                    code: "REPOSITORY_ERROR".to_string(),
                });
            }
        },
        None => data
            .repositories
            .cds_alerts
            .get_unacknowledged(None)
            .await
            .unwrap_or_default(),
    };
    let filtered_alerts: Vec<crate::clinical::CDSAlert> = entities
        .into_iter()
        .map(crate::clinical::CDSAlert::from)
        .filter(|a| a.provider_id == current_user_id)
        .filter(|a| {
            status_filter
                .as_ref()
                .is_none_or(|s| format!("{:?}", a.status).to_lowercase() == s.to_lowercase())
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "alerts": filtered_alerts,
        "count": filtered_alerts.len()
    }))
}

/// Get single CDS alert
#[get("/api/cds/alerts/{alert_id}")]
pub async fn get_cds_alert(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let alert_id = path.into_inner();

    let current_user_id = match require_x_user_id_header(&http_req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    let alert = match data.repositories.cds_alerts.get_by_id(&alert_id).await {
        Ok(e) => crate::clinical::CDSAlert::from(e),
        Err(crate::repositories::traits::RepositoryError::NotFound(_)) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Alert not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            log::error!("Failed to fetch CDS alert: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to fetch alert".to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            });
        }
    };

    if alert.provider_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "alert": alert
    }))
}

/// Respond to CDS alert request
#[derive(Debug, Deserialize)]
pub struct RespondCDSAlertRequest {
    pub action_taken: String,
    pub override_reason: Option<String>,
    pub notes: Option<String>,
}

/// Respond to CDS alert
#[post("/api/cds/alerts/{alert_id}/respond")]
pub async fn respond_to_cds_alert(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<RespondCDSAlertRequest>,
) -> impl Responder {
    let alert_id = path.into_inner();

    let current_user_id = match require_x_user_id_header(&http_req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    let mut alert: crate::clinical::CDSAlert =
        match data.repositories.cds_alerts.get_by_id(&alert_id).await {
            Ok(e) => e.into(),
            Err(crate::repositories::traits::RepositoryError::NotFound(_)) => {
                return HttpResponse::NotFound().json(ErrorResponse {
                    success: false,
                    error: "Alert not found".to_string(),
                    code: "NOT_FOUND".to_string(),
                })
            }
            Err(e) => {
                log::error!("Failed to fetch CDS alert: {}", e);
                return HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Failed to fetch alert".to_string(),
                    code: "REPOSITORY_ERROR".to_string(),
                });
            }
        };

    if alert.provider_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only the assigned provider can respond".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let action_taken = match req.action_taken.as_str() {
        "accepted" => crate::clinical::CDSActionTaken::Accepted,
        "accepted_modified" => crate::clinical::CDSActionTaken::AcceptedWithModification,
        "overridden" => crate::clinical::CDSActionTaken::Overridden,
        "deferred" => crate::clinical::CDSActionTaken::Deferred,
        "escalated" => crate::clinical::CDSActionTaken::EscalatedToPharmacy,
        "patient_refused" => crate::clinical::CDSActionTaken::PatientRefused,
        "not_applicable" => crate::clinical::CDSActionTaken::NotApplicable,
        _ => crate::clinical::CDSActionTaken::NotApplicable,
    };

    let now = chrono::Utc::now().timestamp();
    let time_to_response = (now - alert.created_at) as u32;

    alert.response = Some(crate::clinical::CDSResponse {
        responded_at: now,
        responded_by: current_user_id.clone(),
        action_taken: action_taken.clone(),
        override_reason: req.override_reason.clone(),
        notes: req.notes.clone(),
        time_to_response_seconds: time_to_response,
    });

    // Update status based on action
    alert.status = match action_taken {
        crate::clinical::CDSActionTaken::Accepted
        | crate::clinical::CDSActionTaken::AcceptedWithModification => {
            crate::clinical::CDSAlertStatus::Accepted
        }
        crate::clinical::CDSActionTaken::Overridden => crate::clinical::CDSAlertStatus::Overridden,
        crate::clinical::CDSActionTaken::Deferred => crate::clinical::CDSAlertStatus::Deferred,
        _ => crate::clinical::CDSAlertStatus::Acknowledged,
    };

    let entity: crate::repositories::traits::CdsAlertEntity = alert.clone().into();
    if let Err(e) = data.repositories.cds_alerts.update(entity).await {
        log::error!("Failed to persist CDS alert response: {}", e);
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Failed to record response".to_string(),
            code: "PERSISTENCE_ERROR".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "alert_id": alert_id,
        "status": format!("{:?}", alert.status),
        "message": "CDS alert response recorded"
    }))
}

/// Get patient's CDS alert history
#[get("/api/cds/patient/{patient_id}/alerts")]
pub async fn get_patient_cds_alerts(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

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
            error: "Only healthcare providers can view patient CDS alerts".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let patient_alerts: Vec<crate::clinical::CDSAlert> = match data
        .repositories
        .cds_alerts
        .get_by_patient(&patient_id, false)
        .await
    {
        Ok(entities) => entities
            .into_iter()
            .map(crate::clinical::CDSAlert::from)
            .collect(),
        Err(e) => {
            log::error!("Failed to fetch patient CDS alerts: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to fetch alerts".to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            });
        }
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "alerts": patient_alerts,
        "count": patient_alerts.len()
    }))
}

#[cfg(test)]
mod cds_threshold_tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn custom_threshold_changes_firing() {
        let mut labs = HashMap::new();
        labs.insert("potassium".to_string(), 6.6_f64);

        // Default cut-off is 6.5 -> 6.6 trips the hyperkalemia rule.
        let def = CdsThresholds::default();
        let fired = evaluate_cds_rules("P1", None, Some(&labs), &[], &[], &def);
        assert!(fired.iter().any(|a| a.alert_id.contains("HYPERK")));

        // Raising the facility's cut-off to 7.0 suppresses the same value.
        let t = CdsThresholds {
            hyperkalemia_k: 7.0,
            ..CdsThresholds::default()
        };
        let not_fired = evaluate_cds_rules("P1", None, Some(&labs), &[], &[], &t);
        assert!(!not_fired.iter().any(|a| a.alert_id.contains("HYPERK")));
    }

    #[test]
    fn thresholds_partial_json_merges_with_defaults() {
        // A facility may override only some fields; the rest fall back to default.
        let partial = serde_json::json!({ "hyperkalemia_k": 7.0 });
        let t: CdsThresholds = serde_json::from_value(partial).unwrap();
        assert_eq!(t.hyperkalemia_k, 7.0);
        assert_eq!(t.qsofa_rr, CdsThresholds::default().qsofa_rr);
        assert_eq!(
            t.lactate_critical,
            CdsThresholds::default().lactate_critical
        );
    }
}
