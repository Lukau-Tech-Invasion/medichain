//! `clinical_endpoints::clinical_support::cds::handlers` — Phase 27 CDS alert HTTP
//! endpoints (create/list/get/respond).
//!
//! Split out of the former single-file `cds.rs` (itself split from `clinical_support.rs`,
//! itself split from the original 21K-line `clinical_endpoints.rs` monolith, Phase 10.1).
//! Inherits shared imports/helpers via `use super::*`; glob-re-exported by `cds/mod.rs`
//! so existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

/// Get single CDS alert
#[get("/api/cds/alerts/{alert_id}")]
pub async fn get_cds_alert(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let alert_id = path.into_inner();

    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let alert = match data.repositories.cds_alerts.get_by_id(&alert_id).await {
        Ok(e) => crate::clinical::CDSAlert::from(e),
        Err(crate::repositories::traits::RepositoryError::NotFound(_)) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: "Alert not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            log::error!("Failed to fetch CDS alert: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Failed to fetch alert".to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            });
        }
    };

    if alert.provider_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
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

fn parse_cds_action(action: &str) -> Option<crate::clinical::CDSActionTaken> {
    match action {
        "accepted" => Some(crate::clinical::CDSActionTaken::Accepted),
        "accepted_modified" => Some(crate::clinical::CDSActionTaken::AcceptedWithModification),
        "overridden" => Some(crate::clinical::CDSActionTaken::Overridden),
        "deferred" => Some(crate::clinical::CDSActionTaken::Deferred),
        "escalated" => Some(crate::clinical::CDSActionTaken::EscalatedToPharmacy),
        "patient_refused" => Some(crate::clinical::CDSActionTaken::PatientRefused),
        "not_applicable" => Some(crate::clinical::CDSActionTaken::NotApplicable),
        _ => None,
    }
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

    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let mut alert: crate::clinical::CDSAlert =
        match data.repositories.cds_alerts.get_by_id(&alert_id).await {
            Ok(e) => e.into(),
            Err(crate::repositories::traits::RepositoryError::NotFound(_)) => {
                return HttpResponse::NotFound().json(ErrorResponse {
                    error: "Alert not found".to_string(),
                    code: "NOT_FOUND".to_string(),
                })
            }
            Err(e) => {
                log::error!("Failed to fetch CDS alert: {}", e);
                return HttpResponse::InternalServerError().json(ErrorResponse {
                    error: "Failed to fetch alert".to_string(),
                    code: "REPOSITORY_ERROR".to_string(),
                });
            }
        };

    if alert.provider_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Only the assigned provider can respond".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let action_taken = match parse_cds_action(&req.action_taken) {
        Some(action) => action,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: "action_taken is invalid".to_string(),
                code: "INVALID_ACTION".to_string(),
            })
        }
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

#[cfg(test)]
mod action_tests {
    use super::parse_cds_action;
    use crate::clinical::CDSActionTaken;

    #[test]
    fn accepts_only_documented_response_actions() {
        assert_eq!(parse_cds_action("accepted"), Some(CDSActionTaken::Accepted));
        assert_eq!(
            parse_cds_action("accepted_modified"),
            Some(CDSActionTaken::AcceptedWithModification)
        );
        assert_eq!(
            parse_cds_action("not_applicable"),
            Some(CDSActionTaken::NotApplicable)
        );
    }

    #[test]
    fn rejects_unknown_response_action_instead_of_inventing_one() {
        assert_eq!(parse_cds_action("looks_fine"), None);
        assert_eq!(parse_cds_action(""), None);
    }
}

/// Get patient's CDS alert history
#[get("/api/cds/patient/{patient_id}/alerts")]
pub async fn get_patient_cds_alerts(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // Registered caller, NOT clinical-staff-only. `require_clinical_staff`
    // rejects a Patient with INSUFFICIENT_ROLE at the top of the handler, which
    // meant the self-or-provider check further down was unreachable for the one
    // role it existed to serve — the patient reading alerts about their own
    // care. The authorization decision belongs to that check, which denies
    // other patients. The write routes in this file keep the staff gate.
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let current_user = match require_known_user(&data, &current_user_id) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    // Providers, or the data subject reading their OWN alerts. This route is
    // what the patient app's notifications page calls; provider-only meant that
    // page 403'd for every patient looking at alerts raised about their own
    // care. A patient seeing alerts about themselves is also the POPIA default
    // (data-subject access), not an exception to it.
    //
    // Still closed to other patients: `caller_owns_patient_record` matches only
    // this caller's own `linked_patient_id`.
    let is_provider = current_user.role.is_healthcare_provider();
    let is_own = crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id);
    if !is_provider && !is_own {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Only healthcare providers or the patient themselves can view these CDS alerts"
                .to_string(),
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
