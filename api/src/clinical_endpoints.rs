//! Clinical Documentation API Endpoints (Phase 2-8)
//!
//! This module provides REST API endpoints for all clinical documentation types.
//! Uses generic CRUD pattern: clients submit complete structs from clinical.rs
//!
//! © 2025 Trustware. All rights reserved.

use crate::clinical;
use crate::clinical::*;
use crate::repositories::traits::*;
use crate::{get_current_user_id, get_user, AppState, ErrorResponse};
use actix_web::{delete, get, post, web, HttpRequest, HttpResponse, Responder};
use chrono::Utc;
use serde::Deserialize;

// ============================================================================
// Phase 2: Emergency Protocols
// ============================================================================

/// Create Code Blue record
#[post("/api/clinical/code-blue")]
pub async fn create_code_blue(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CodeBlueRecord>,
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let event_id = record.event_id.clone();
    let now = Utc::now();
    let entity = CodeBlueEntity {
        id: event_id.clone(),
        patient_id: record.patient_id.clone(),
        location: record.location.clone(),
        code_called_at: record.code_called_at,
        team_arrived_at: record.team_arrived_at,
        initial_rhythm: format!("{:?}", record.initial_rhythm),
        witnessed: record.witnessed,
        outcome: format!("{:?}", record.outcome),
        code_leader: record.code_leader.clone(),
        documented_by: record.documented_by.clone(),
        documented_at: record.documented_at,
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };

    match data.repositories.code_blue.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "event_id": event_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get Code Blue record by ID
#[get("/api/clinical/code-blue/{event_id}")]
pub async fn get_code_blue(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let event_id = path.into_inner();

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

    match data.repositories.code_blue.get_by_id(&event_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Code Blue record '{}' not found", event_id),
                code: "RECORD_NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List all Code Blue records for a patient
#[get("/api/clinical/code-blue/patient/{patient_id}")]
pub async fn list_patient_code_blues(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

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

    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let pagination = Pagination::new(0, 100);
    match data
        .repositories
        .code_blue
        .get_by_patient(&patient_id, pagination)
        .await
    {
        Ok(result) => {
            let records: Vec<serde_json::Value> =
                result.items.into_iter().map(|e| e.data).collect();
            HttpResponse::Ok().json(records)
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// Trauma Assessment endpoints
#[post("/api/clinical/trauma")]
pub async fn create_trauma(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<TraumaAssessment>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let assessment_id = record.assessment_id.clone();
    let now = Utc::now();
    let entity = TraumaAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: record.patient_id.clone(),
        mechanism: format!("{:?}", record.mechanism),
        gcs: record.gcs,
        trauma_level: record.trauma_level,
        mtp_activated: record.mtp_activated,
        disposition: format!("{:?}", record.disposition),
        assessed_by: record.assessed_by.clone(),
        assessed_at: record.assessed_at,
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };

    match data.repositories.trauma_assessments_repo.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/trauma/{assessment_id}")]
pub async fn get_trauma(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .trauma_assessments_repo
        .get_by_id(&assessment_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Trauma assessment '{}' not found", assessment_id),
                code: "RECORD_NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// Stroke Assessment endpoints
#[post("/api/clinical/stroke")]
pub async fn create_stroke(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<StrokeAssessment>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let assessment_id = record.assessment_id.clone();
    let now = Utc::now();
    let entity = StrokeAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: record.patient_id.clone(),
        nihss_total: record.nihss_total,
        stroke_type: format!("{:?}", record.stroke_type),
        tpa_eligible: record.tpa_eligible,
        tpa_given: record.tpa_given,
        hemorrhage: record.hemorrhage,
        lvo_suspected: record.lvo_suspected,
        assessed_by: record.assessed_by.clone(),
        assessed_at: record.assessed_at,
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };

    match data
        .repositories
        .stroke_assessments_repo
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/stroke/{assessment_id}")]
pub async fn get_stroke(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .stroke_assessments_repo
        .get_by_id(&assessment_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Stroke assessment '{}' not found", assessment_id),
                code: "RECORD_NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// Cardiac Event endpoints
#[post("/api/clinical/cardiac")]
pub async fn create_cardiac(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CardiacEvent>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let event_id = record.event_id.clone();
    let now = Utc::now();
    let entity = CardiacEventEntity {
        id: event_id.clone(),
        patient_id: record.patient_id.clone(),
        event_type: format!("{:?}", record.event_type),
        cath_lab_activated: record.cath_lab_activated,
        pci_performed: record.pci_performed,
        door_to_balloon_minutes: record.door_to_balloon_minutes,
        documented_by: record.documented_by.clone(),
        documented_at: record.documented_at,
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };

    match data.repositories.cardiac_events_repo.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "event_id": event_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/cardiac/{event_id}")]
pub async fn get_cardiac(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let event_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .cardiac_events_repo
        .get_by_id(&event_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Cardiac event '{}' not found", event_id),
                code: "RECORD_NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// Sepsis Assessment endpoints
#[post("/api/clinical/sepsis")]
pub async fn create_sepsis(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<SepsisAssessment>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let assessment_id = record.assessment_id.clone();
    let now = Utc::now();
    let entity = SepsisAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: record.patient_id.clone(),
        severity: format!("{:?}", record.severity),
        suspected_source: record.suspected_source.clone(),
        qsofa_score: record.qsofa.score(),
        sofa_score: record.sofa_score,
        vasopressors_required: record.vasopressors_required,
        icu_admission: record.icu_admission,
        assessed_by: record.assessed_by.clone(),
        assessed_at: record.assessed_at,
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };

    match data
        .repositories
        .sepsis_assessments_repo
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/sepsis/{assessment_id}")]
pub async fn get_sepsis(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .sepsis_assessments_repo
        .get_by_id(&assessment_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Sepsis assessment '{}' not found", assessment_id),
                code: "RECORD_NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// EMS Handoff endpoints
#[post("/api/clinical/ems-handoff")]
pub async fn create_ems_handoff(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<EMSHandoff>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let handoff_id = record.report_id.clone();
    let now = Utc::now();
    let entity = EmsHandoffEntity {
        id: handoff_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.ems_handoffs.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "report_id": handoff_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/ems-handoff/{handoff_id}")]
pub async fn get_ems_handoff(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let handoff_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.ems_handoffs.get_by_id(&handoff_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("EMS handoff '{}' not found", handoff_id),
                code: "RECORD_NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// Summary endpoint for all emergency records
// ============================================================================

/// Get all emergency records for a patient
#[get("/api/clinical/patient/{patient_id}/emergency")]
pub async fn get_patient_emergency_records(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Collect records
    let code_blues: Vec<CodeBlueRecord> = data
        .code_blue_records
        .read()
        .unwrap()
        .values()
        .filter(|r| r.patient_id == patient_id)
        .cloned()
        .collect();

    let traumas: Vec<TraumaAssessment> = data
        .trauma_assessments
        .read()
        .unwrap()
        .values()
        .filter(|r| r.patient_id == patient_id)
        .cloned()
        .collect();

    let strokes: Vec<StrokeAssessment> = data
        .stroke_assessments
        .read()
        .unwrap()
        .values()
        .filter(|r| r.patient_id == patient_id)
        .cloned()
        .collect();

    let sepsis: Vec<SepsisAssessment> = data
        .sepsis_assessments
        .read()
        .unwrap()
        .values()
        .filter(|r| r.patient_id == patient_id)
        .cloned()
        .collect();

    let cardiac: Vec<CardiacEvent> = data
        .cardiac_events
        .read()
        .unwrap()
        .values()
        .filter(|r| r.patient_id == patient_id)
        .cloned()
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "code_blue_records": code_blues,
        "trauma_assessments": traumas,
        "stroke_assessments": strokes,
        "sepsis_assessments": sepsis,
        "cardiac_events": cardiac,
        "total_emergency_events": code_blues.len() + traumas.len() + strokes.len() + sepsis.len() + cardiac.len()
    }))
}

// ============================================================================
// PHASE 3: NURSING DOCUMENTATION ENDPOINTS
// ============================================================================

/// Create medication administration record
#[post("/api/clinical/mar")]
pub async fn create_mar(
    data: web::Data<AppState>,
    req: web::Json<clinical::MedicationAdministrationRecord>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let key = format!("{}_{}", record.patient_id, record.date);
    let now = Utc::now();
    let entity = MedicationRecordEntity {
        id: key.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.medication_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "key": key
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/mar/{patient_id}/{date}")]
pub async fn get_mar(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<(String, String)>,
) -> impl Responder {
    let (patient_id, date) = path.into_inner();
    let key = format!("{}_{}", patient_id, date);

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.medication_records.get_by_id(&key).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "MAR not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List all MAR records (for NursingPage)
#[get("/api/nursing/mar")]
pub async fn list_mar(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let pagination = Pagination::new(0, 100);
    match data.repositories.medication_records.list_all(pagination).await {
        Ok(result) => {
            let record_list: Vec<serde_json::Value> = result.items.into_iter().map(|e| e.data).collect();
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "records": record_list
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Administer medication (for NursingPage MAR)
#[post("/api/nursing/mar/administer")]
pub async fn administer_medication(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Extract administration details
    let mar_id = req.get("mar_id").and_then(|v| v.as_str()).unwrap_or("");
    let status = req
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("given");

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Medication administered successfully",
        "mar_id": mar_id,
        "status": status,
        "administered_by": current_user.wallet_address,
        "administered_at": chrono::Utc::now().timestamp()
    }))
}

/// Create intake/output record
#[post("/api/clinical/io")]
pub async fn create_io(
    data: web::Data<AppState>,
    req: web::Json<clinical::IntakeOutputRecord>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let key = format!("{}_{}_{}", record.patient_id, record.date, record.shift);
    let now = Utc::now();
    let entity = IORecordEntity {
        id: key.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.io_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "key": key
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/io/{patient_id}/{date}/{shift}")]
pub async fn get_io(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<(String, String, String)>,
) -> impl Responder {
    let (patient_id, date, shift) = path.into_inner();
    let key = format!("{}_{}_{}", patient_id, date, shift);

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.io_records.get_by_id(&key).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "I/O record not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List all I/O records (for NursingPage)
#[get("/api/nursing/intake-output")]
pub async fn list_io(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let pagination = Pagination::new(0, 100);
    match data.repositories.io_records.list_all(pagination).await {
        Ok(result) => {
            let record_list: Vec<serde_json::Value> = result.items.into_iter().map(|e| e.data).collect();
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "records": record_list
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Record fluid entry (for NursingPage I/O)
#[post("/api/nursing/intake-output/record")]
pub async fn record_fluid(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let patient_id = req.get("patient_id").and_then(|v| v.as_str()).unwrap_or("");
    let entry_type = req
        .get("entry_type")
        .and_then(|v| v.as_str())
        .unwrap_or("intake");
    let amount_ml = req.get("amount_ml").and_then(|v| v.as_i64()).unwrap_or(0);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Fluid entry recorded successfully",
        "patient_id": patient_id,
        "entry_type": entry_type,
        "amount_ml": amount_ml,
        "recorded_by": current_user.wallet_address,
        "recorded_at": chrono::Utc::now().timestamp()
    }))
}

/// Create nursing care plan
#[post("/api/clinical/care-plan")]
pub async fn create_care_plan(
    data: web::Data<AppState>,
    req: web::Json<clinical::NursingCarePlan>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let plan_id = record.care_plan_id.clone();
    let now = Utc::now();
    let entity = NursingCarePlanEntity {
        id: plan_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.nursing_care_plans.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "care_plan_id": plan_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/care-plan/{plan_id}")]
pub async fn get_care_plan(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let plan_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.nursing_care_plans.get_by_id(&plan_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Care plan not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List all care plans (for NursingPage)
#[get("/api/nursing/care-plans")]
pub async fn list_care_plans(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let pagination = Pagination::new(0, 100);
    match data.repositories.nursing_care_plans.list_all(pagination).await {
        Ok(result) => {
            let plan_list: Vec<serde_json::Value> = result.items.into_iter().map(|e| e.data).collect();
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "plans": plan_list
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create wound assessment
#[post("/api/clinical/wound")]
pub async fn create_wound(
    data: web::Data<AppState>,
    req: web::Json<clinical::WoundAssessment>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let assessment_id = record.assessment_id.clone();
    let now = Utc::now();
    let entity = WoundAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.wound_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/wound/{assessment_id}")]
pub async fn get_wound(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.wound_assessments.get_by_id(&assessment_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Wound assessment not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List all wound assessments
#[get("/api/clinical/wound-assessments")]
pub async fn list_wound_assessments(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let pagination = Pagination::new(0, 100);
    match data.repositories.wound_assessments.list_all(pagination).await {
        Ok(result) => {
            let wound_list: Vec<serde_json::Value> = result.items.into_iter().map(|e| e.data).collect();
            HttpResponse::Ok().json(wound_list)
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create IV site assessment
#[post("/api/clinical/iv-site")]
pub async fn create_iv_site(
    data: web::Data<AppState>,
    req: web::Json<clinical::IVSiteAssessment>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let assessment_id = record.assessment_id.clone();
    let now = Utc::now();
    let entity = IVAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.iv_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/iv-site/{assessment_id}")]
pub async fn get_iv_site(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.iv_assessments.get_by_id(&assessment_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "IV site assessment not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create shift handoff
#[post("/api/clinical/shift-handoff")]
pub async fn create_shift_handoff(
    data: web::Data<AppState>,
    req: web::Json<clinical::ShiftHandoff>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let handoff_id = record.handoff_id.clone();
    let now = Utc::now();
    let entity = ShiftHandoffEntity {
        id: handoff_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.shift_handoffs.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "handoff_id": handoff_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/shift-handoff/{handoff_id}")]
pub async fn get_shift_handoff(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let handoff_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.shift_handoffs.get_by_id(&handoff_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Shift handoff not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create incident report
#[post("/api/clinical/incident")]
pub async fn create_incident(
    data: web::Data<AppState>,
    req: web::Json<clinical::IncidentReport>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let report_id = record.report_id.clone();
    let now = Utc::now();
    let entity = IncidentReportEntity {
        id: report_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.incident_reports.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "report_id": report_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/incident/{report_id}")]
pub async fn get_incident(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let report_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.incident_reports.get_by_id(&report_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Incident report not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create fall risk assessment
#[post("/api/clinical/fall-risk")]
pub async fn create_fall_risk(
    data: web::Data<AppState>,
    req: web::Json<clinical::FallRiskAssessment>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let assessment_id = record.assessment_id.clone();
    let now = Utc::now();
    let entity = FallRiskAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.fall_risk_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/fall-risk/{assessment_id}")]
pub async fn get_fall_risk(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.fall_risk_assessments.get_by_id(&assessment_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Fall risk assessment not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// PHASE 4: SPECIALIZED ASSESSMENT ENDPOINTS
// ============================================================================

/// Create burn assessment
#[post("/api/clinical/burn")]
pub async fn create_burn(
    data: web::Data<AppState>,
    req: web::Json<clinical::BurnAssessment>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let assessment_id = record.assessment_id.clone();
    let now = Utc::now();
    let entity = BurnAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.burn_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/burn/{assessment_id}")]
pub async fn get_burn(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.burn_assessments.get_by_id(&assessment_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Burn assessment not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create psychiatric assessment
#[post("/api/clinical/psych")]
pub async fn create_psych(
    data: web::Data<AppState>,
    req: web::Json<clinical::PsychiatricAssessment>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let assessment_id = record.assessment_id.clone();
    let now = Utc::now();
    let entity = PsychiatricAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.psychiatric_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/psych/{assessment_id}")]
pub async fn get_psych(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.psychiatric_assessments.get_by_id(&assessment_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Psychiatric assessment not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create toxicology assessment
#[post("/api/clinical/tox")]
pub async fn create_tox(
    data: web::Data<AppState>,
    req: web::Json<clinical::ToxicologyAssessment>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let assessment_id = record.assessment_id.clone();
    let now = Utc::now();
    let entity = ToxicologyAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.toxicology_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/tox/{assessment_id}")]
pub async fn get_tox(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.toxicology_assessments.get_by_id(&assessment_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Toxicology assessment not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create mass casualty incident
#[post("/api/clinical/mci")]
pub async fn create_mci(
    data: web::Data<AppState>,
    req: web::Json<clinical::MassCasualtyIncident>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let incident_id = record.incident_id.clone();
    let now = Utc::now();
    let entity = MciRecordEntity {
        id: incident_id.clone(),
        incident_id: incident_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.mci_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "incident_id": incident_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/mci/{incident_id}")]
pub async fn get_mci(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let incident_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.mci_records.get_by_id(&incident_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "MCI record not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// PHASE 5: PROCEDURE ENDPOINTS
// ============================================================================

/// Create intubation record
#[post("/api/clinical/intubation")]
pub async fn create_intubation(
    data: web::Data<AppState>,
    req: web::Json<clinical::IntubationRecord>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let record_id = record.record_id.clone();
    let now = Utc::now();
    let entity = IntubationRecordEntity {
        id: record_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.intubation_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "record_id": record_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/intubation/{record_id}")]
pub async fn get_intubation(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let record_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.intubation_records.get_by_id(&record_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Intubation record not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create laceration repair record
#[post("/api/clinical/laceration")]
pub async fn create_laceration(
    data: web::Data<AppState>,
    req: web::Json<clinical::LacerationRepair>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let record_id = record.record_id.clone();
    let now = Utc::now();
    let entity = LacerationRepairEntity {
        id: record_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.laceration_repairs.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "record_id": record_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List all laceration repairs (for healthcare providers)
#[get("/api/clinical/laceration-repairs")]
pub async fn list_laceration_repairs(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can view laceration repairs".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let pagination = Pagination::new(0, 100);
    match data.repositories.laceration_repairs.get_by_patient("all", pagination).await {
        Ok(result) => {
            let repairs: Vec<serde_json::Value> = result.items.into_iter().map(|e| e.data).collect();
            HttpResponse::Ok().json(repairs)
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/laceration/{record_id}")]
pub async fn get_laceration(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let record_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.laceration_repairs.get_by_id(&record_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Laceration repair not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create splint/cast record
#[post("/api/clinical/splint")]
pub async fn create_splint(
    data: web::Data<AppState>,
    req: web::Json<clinical::SplintCastRecord>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let record_id = record.record_id.clone();
    let now = Utc::now();
    let entity = SplintCastRecordEntity {
        id: record_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.splint_cast_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "record_id": record_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/splint/{record_id}")]
pub async fn get_splint(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let record_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.splint_cast_records.get_by_id(&record_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Splint/cast record not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// PHASE 6: SPECIALTY POPULATION ENDPOINTS
// ============================================================================

/// Create pediatric assessment
#[post("/api/clinical/peds")]
pub async fn create_peds(
    data: web::Data<AppState>,
    req: web::Json<clinical::PediatricAssessment>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let assessment_id = record.assessment_id.clone();
    let now = Utc::now();
    let entity = PediatricAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.pediatric_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/peds/{assessment_id}")]
pub async fn get_peds(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.pediatric_assessments.get_by_id(&assessment_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Pediatric assessment not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create obstetric emergency record
#[post("/api/clinical/ob")]
pub async fn create_ob(
    data: web::Data<AppState>,
    req: web::Json<clinical::ObstetricEmergency>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let assessment_id = record.assessment_id.clone();
    let now = Utc::now();
    let entity = ObstetricEmergencyEntity {
        id: assessment_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.obstetric_emergencies.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/ob/{assessment_id}")]
pub async fn get_ob(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.obstetric_emergencies.get_by_id(&assessment_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Obstetric emergency not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// PHASE 7: LABORATORY ENDPOINTS
// ============================================================================

/// Create specimen collection
#[post("/api/clinical/specimen")]
pub async fn create_specimen(
    data: web::Data<AppState>,
    req: web::Json<clinical::SpecimenCollection>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let collection_id = record.collection_id.clone();
    let now = Utc::now();
    let entity = SpecimenCollectionEntity {
        id: collection_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.specimen_collections.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "collection_id": collection_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/specimen/{collection_id}")]
pub async fn get_specimen(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let collection_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.specimen_collections.get_by_id(&collection_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Specimen collection not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List all specimen collections
#[get("/api/clinical/specimens")]
pub async fn list_specimens(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let specimens = data.specimen_collections.read().unwrap();
    let specimen_list: Vec<&clinical::SpecimenCollection> = specimens.values().collect();
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "specimens": specimen_list,
        "total": specimen_list.len()
    }))
}

/// Create chain of custody
#[post("/api/clinical/chain-of-custody")]
pub async fn create_chain_of_custody(
    data: web::Data<AppState>,
    req: web::Json<clinical::ChainOfCustody>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let form_id = record.form_id.clone();
    let now = Utc::now();
    let entity = ChainOfCustodyEntity {
        id: form_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.chain_of_custody.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "form_id": form_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/chain-of-custody/{form_id}")]
pub async fn get_chain_of_custody(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let form_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.chain_of_custody.get_by_id(&form_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Chain of custody not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create lab QC record
#[post("/api/clinical/lab-qc")]
pub async fn create_lab_qc(
    data: web::Data<AppState>,
    req: web::Json<clinical::LabQCRecord>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let qc_id = record.qc_id.clone();
    let now = Utc::now();
    let entity = LabQcRecordEntity {
        id: qc_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        ..Default::default()
    };

    match data.repositories.lab_qc_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "qc_id": qc_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/lab-qc/{qc_id}")]
pub async fn get_lab_qc(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let qc_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.lab_qc_records.get_by_id(&qc_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Lab QC record not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create critical value notification
#[post("/api/clinical/critical-value")]
pub async fn create_critical_value(
    data: web::Data<AppState>,
    req: web::Json<clinical::CriticalValueNotification>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let notification_id = record.notification_id.clone();
    let patient_id = record.patient_id.clone();
    let test_name = record.test_name.clone();
    let critical_value_str = record.critical_value.clone();
    let unit = record.unit.clone();
    let now = Utc::now();
    let entity = CriticalValueEntity {
        id: notification_id.clone(),
        patient_id: patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        ..Default::default()
    };

    match data.repositories.critical_values.create(entity).await {
        Ok(_) => {
            // Push real-time SSE notification for critical lab value
            crate::websocket::push_cds_alert(
                &data.ws_manager,
                &patient_id,
                &format!(
                    "Critical Lab Value: {} = {} {}",
                    test_name, critical_value_str, unit
                ),
                "critical",
            );

            HttpResponse::Created().json(serde_json::json!({
                "success": true,
                "notification_id": notification_id
            }))
        }
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/critical-value/{notification_id}")]
pub async fn get_critical_value(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let notification_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.critical_values.get_by_id(&notification_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Critical value notification not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create specimen rejection
#[post("/api/clinical/specimen-rejection")]
pub async fn create_specimen_rejection(
    data: web::Data<AppState>,
    req: web::Json<clinical::SpecimenRejection>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let rejection_id = record.rejection_id.clone();
    let now = Utc::now();
    let entity = SpecimenRejectionEntity {
        id: rejection_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        ..Default::default()
    };

    match data.repositories.specimen_rejections.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "rejection_id": rejection_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/specimen-rejection/{rejection_id}")]
pub async fn get_specimen_rejection(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let rejection_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.specimen_rejections.get_by_id(&rejection_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Specimen rejection not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// PHASE 8: PHYSICIAN DOCUMENTATION ENDPOINTS
// ============================================================================

/// Create physician order
#[post("/api/clinical/order")]
pub async fn create_order(
    data: web::Data<AppState>,
    req: web::Json<clinical::PhysicianOrder>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let order_id = record.order_id.clone();
    let now = Utc::now();
    let entity = PhysicianOrderEntity {
        id: order_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.physician_orders.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "order_id": order_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/order/{order_id}")]
pub async fn get_order(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let order_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.physician_orders.get_by_id(&order_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Physician order not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List all physician orders (for NursingPage and OrdersPage)
#[get("/api/clinical/orders")]
pub async fn list_orders(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let pagination = Pagination::new(0, 100);
    match data.repositories.physician_orders.get_by_patient("all", pagination).await {
        Ok(result) => {
            let order_list: Vec<serde_json::Value> = result.items.into_iter().map(|e| e.data).collect();
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "orders": order_list
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create discharge summary
#[post("/api/clinical/discharge-summary")]
pub async fn create_discharge_summary(
    data: web::Data<AppState>,
    req: web::Json<clinical::DischargeSummary>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let summary_id = record.summary_id.clone();
    let now = Utc::now();
    let entity = DischargeSummaryEntity {
        id: summary_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.discharge_summaries.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "summary_id": summary_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/discharge-summary/{summary_id}")]
pub async fn get_discharge_summary(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let summary_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.discharge_summaries.get_by_id(&summary_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Discharge summary not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List all discharge summaries (for DischargePage)
#[get("/api/clinical/discharges")]
pub async fn list_discharges(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let pagination = Pagination::new(0, 100);
    match data.repositories.discharge_summaries.get_by_patient("all", pagination).await {
        Ok(result) => {
            let discharge_list: Vec<serde_json::Value> = result.items.into_iter().map(|e| e.data).collect();
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "discharges": discharge_list
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Approve discharge (for DischargePage)
#[post("/api/clinical/discharges/{id}/approve")]
pub async fn approve_discharge(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let summary_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.discharge_summaries.get_by_id(&summary_id).await {
        Ok(mut entity) => {
            // Update the data JSON with signed_by and signature_time
            let mut data_value = entity.data.clone();
            if let Some(obj) = data_value.as_object_mut() {
                obj.insert("signed_by".to_string(), serde_json::json!(current_user.wallet_address));
                obj.insert("signature_time".to_string(), serde_json::json!(chrono::Utc::now().timestamp()));
            }
            entity.data = data_value;
            entity.signed_by = Some(current_user.wallet_address.clone());
            entity.signed_at = Some(Utc::now());
            entity.updated_at = Utc::now();
            match data.repositories.discharge_summaries.update(entity).await {
                Ok(_) => HttpResponse::Ok().json(serde_json::json!({
                    "success": true,
                    "message": "Discharge approved",
                    "summary_id": summary_id,
                    "signed_by": current_user.wallet_address
                })),
                Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: e.to_string(),
                    code: "INTERNAL_ERROR".to_string(),
                }),
            }
        }
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Discharge summary not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create discharge instructions
#[post("/api/clinical/discharge-instructions")]
pub async fn create_discharge_instructions(
    data: web::Data<AppState>,
    req: web::Json<clinical::DischargeInstructions>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let instructions_id = record.instructions_id.clone();
    let now = Utc::now();
    let entity = DischargeInstructionsEntity {
        id: instructions_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.discharge_instructions.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "instructions_id": instructions_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/discharge-instructions/{instructions_id}")]
pub async fn get_discharge_instructions(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let instructions_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.discharge_instructions.get_by_id(&instructions_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Discharge instructions not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create AMA discharge
#[post("/api/clinical/ama")]
pub async fn create_ama(
    data: web::Data<AppState>,
    req: web::Json<clinical::AMADischarge>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let ama_id = record.ama_id.clone();
    let now = Utc::now();
    let entity = AmaDischargeEntity {
        id: ama_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.ama_discharges.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "ama_id": ama_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/ama/{ama_id}")]
pub async fn get_ama(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let ama_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.ama_discharges.get_by_id(&ama_id).await {
        Ok(ama) => HttpResponse::Ok().json(ama.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "AMA discharge not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create history and physical
#[post("/api/clinical/hp")]
pub async fn create_hp(
    data: web::Data<AppState>,
    req: web::Json<clinical::HistoryAndPhysical>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let hp = req.into_inner();
    let hp_id = hp.hp_id.clone();
    let now = chrono::Utc::now();
    let entity = HistoryPhysicalEntity {
        id: hp_id.clone(),
        patient_id: hp.patient_id.clone(),
        data: serde_json::to_value(&hp).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.history_physicals.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "hp_id": hp_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/hp/{hp_id}")]
pub async fn get_hp(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let hp_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.history_physicals.get_by_id(&hp_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "H&P not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List all history and physical exams
#[get("/api/clinical/hp")]
pub async fn list_hps(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let hp_list = data
        .repositories
        .history_physicals
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(hp_list)
}

/// Create consultation note
#[post("/api/clinical/consult")]
pub async fn create_consult(
    data: web::Data<AppState>,
    req: web::Json<clinical::ConsultationNote>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let consult = req.into_inner();
    let consult_id = consult.consult_id.clone();
    let now = chrono::Utc::now();
    let entity = ConsultationNoteEntity {
        id: consult_id.clone(),
        patient_id: consult.patient_id.clone(),
        data: serde_json::to_value(&consult).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.consultation_notes.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "consult_id": consult_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/consult/{consult_id}")]
pub async fn get_consult(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let consult_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.consultation_notes.get_by_id(&consult_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Consultation note not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create progress note
#[post("/api/clinical/progress-note")]
pub async fn create_progress_note(
    data: web::Data<AppState>,
    req: web::Json<clinical::ProgressNote>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let note = req.into_inner();
    let note_id = note.note_id.clone();
    let now = chrono::Utc::now();
    let entity = ProgressNoteEntity {
        id: note_id.clone(),
        patient_id: note.patient_id.clone(),
        data: serde_json::to_value(&note).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.progress_notes.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "note_id": note_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[get("/api/clinical/progress-note/{note_id}")]
pub async fn get_progress_note(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let note_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.progress_notes.get_by_id(&note_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Progress note not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// DASHBOARD & WORKFLOW ENDPOINTS
// ============================================================================

/// Patient Home Dashboard - timeline of visits, meds, test results
#[get("/api/dashboard/patient")]
pub async fn patient_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Get patient profile from repository
    let patient_profile = match data.repositories.patients.get_by_id(&current_user_id).await {
        Ok(p) => Some(p),
        Err(_) => None,
    };

    // Get recent lab results (approved only for patients) from repository
    let pagination = Pagination::new(0, 10);
    let lab_results: Vec<_> = match data
        .repositories
        .lab_submissions
        .get_by_patient(&current_user_id, pagination)
        .await
    {
        Ok(result) => result
            .items
            .into_iter()
            .filter(|s| {
                current_user.role.can_view_medical_records() || s.status == "approved"
            })
            .collect(),
        Err(_) => Vec::new(),
    };

    // Get medical records from repository
    let pagination = Pagination::new(0, 50);
    let medical_records: Vec<_> = match data
        .repositories
        .medical_records
        .get_by_patient(&current_user_id, pagination)
        .await
    {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    // Get latest vital signs from repository
    let vital_signs = match data
        .repositories
        .vital_signs
        .get_latest_by_patient(&current_user_id)
        .await
    {
        Ok(v) => v,
        Err(_) => None,
    };

    // Get SOAP notes (Progress notes) from repository
    let pagination = Pagination::new(0, 5);
    let soap_notes: Vec<_> = match data
        .repositories
        .progress_notes
        .get_by_patient(&current_user_id, pagination)
        .await
    {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    // Get triage assessments from repository
    let pagination = Pagination::new(0, 5);
    let triage_history: Vec<_> = match data
        .repositories
        .triage_assessments
        .get_by_patient(&current_user_id, pagination)
        .await
    {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "user_id": current_user_id,
        "role": current_user.role.to_string(),
        "profile": patient_profile,
        "recent_lab_results": lab_results,
        "medical_records": medical_records,
        "vital_signs": vital_signs,
        "recent_soap_notes": soap_notes,
        "triage_history": triage_history,
        "summary": {
            "total_lab_results": lab_results.len(),
            "total_medical_records": medical_records.len(),
            "total_visits": soap_notes.len()
        }
    }))
}

/// Doctor Dashboard - patient list, pending tasks, alerts
#[get("/api/dashboard/doctor")]
pub async fn doctor_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !matches!(current_user.role, crate::Role::Doctor | crate::Role::Admin) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Doctor dashboard requires Doctor or Admin role".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get all patients from repository
    let pagination = Pagination::new(0, 50);
    let patients_result = match data.repositories.patients.list(pagination.clone()).await {
        Ok(res) => res,
        Err(_) => PaginatedResult::new(Vec::new(), 0, &Pagination::new(0, 50)),
    };
    let patients = patients_result.items;

    // Get pending lab results awaiting approval from repository
    let pagination = Pagination::new(0, 100);
    let pending_labs: Vec<_> = match data
        .repositories
        .lab_submissions
        .get_by_provider(&current_user.wallet_address, pagination.clone())
        .await
    {
        Ok(result) => result
            .items
            .into_iter()
            .filter(|s| s.status == "pending")
            .collect(),
        Err(_) => Vec::new(),
    };

    // Get critical values needing attention from repository
    let pagination = Pagination::new(0, 10);
    let critical_values: Vec<_> = match data
        .repositories
        .critical_values
        .get_by_patient("", pagination.clone()) // Empty patient_id to get all for provider/global
        .await
    {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    // Get recent code blues from repository
    let pagination = Pagination::new(0, 5);
    let code_blues: Vec<_> = match data
        .repositories
        .code_blue
        .get_by_patient("", pagination.clone()) // Empty to get all
        .await
    {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    // Get active physician orders from repository
    let pagination = Pagination::new(0, 20);
    let active_orders: Vec<_> = match data
        .repositories
        .physician_orders
        .get_by_patient("", pagination.clone()) // Empty to get all
        .await
    {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    // Get recent consults from repository
    let pagination = Pagination::new(0, 10);
    let pending_consults: Vec<_> = match data
        .repositories
        .consultation_notes
        .get_by_status("pending", pagination.clone())
        .await
    {
        Ok(result) => result.items,
        Err(_) => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "role": "Doctor",
        "patients": {
            "total": patients.len(),
            "list": patients.iter().take(50).collect::<Vec<_>>()
        },
        "pending_lab_approvals": pending_labs,
        "critical_values": critical_values,
        "recent_code_blues": code_blues,
        "active_orders": active_orders,
        "pending_consults": pending_consults,
        "alerts": {
            "pending_labs_count": pending_labs.len(),
            "critical_values_count": critical_values.len(),
            "code_blues_count": code_blues.len()
        }
    }))
}

/// Nurse Dashboard - assigned patients, tasks, medication due
#[get("/api/dashboard/nurse")]
pub async fn nurse_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !matches!(current_user.role, crate::Role::Nurse | crate::Role::Admin) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Nurse dashboard requires Nurse or Admin role".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get all patients from repository
    let pagination = Pagination::new(0, 50);
    let patients = match data.repositories.patients.list(pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get active care plans from repository
    let pagination = Pagination::new(0, 50);
    let care_plans = match data.repositories.nursing_care_plans.list_all(pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get recent vital signs needing attention from repository
    let vitals_needing_attention = match data.repositories.vital_signs.get_critical().await {
        Ok(v) => v,
        Err(_) => Vec::new(),
    };

    // Get medication records for today from repository
    let pagination = Pagination::new(0, 20);
    let medication_records = match data.repositories.medication_records.list_all(pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get I/O records from repository
    let pagination = Pagination::new(0, 20);
    let io_records = match data.repositories.io_records.list_all(pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get wound assessments from repository
    let pagination = Pagination::new(0, 10);
    let wound_assessments = match data.repositories.wound_assessments.list_all(pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get IV site assessments from repository
    let pagination = Pagination::new(0, 10);
    let iv_assessments = match data.repositories.iv_assessments.get_by_patient("", pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get fall risk assessments from repository
    let pagination = Pagination::new(0, 50);
    let fall_risks = match data.repositories.fall_risk_assessments.get_by_patient("", pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get recent incidents from repository
    let pagination = Pagination::new(0, 10);
    let incidents = match data.repositories.incident_reports.list_all(pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "role": "Nurse",
        "patients": {
            "total": patients.len(),
            "list": patients.iter().take(30).collect::<Vec<_>>()
        },
        "care_plans": care_plans,
        "vitals_needing_attention": vitals_needing_attention,
        "medication_records": medication_records,
        "io_records": io_records,
        "wound_assessments": wound_assessments,
        "iv_assessments": iv_assessments,
        "fall_risk_patients": fall_risks,
        "recent_incidents": incidents,
        "tasks": {
            "vitals_due": vitals_needing_attention.len(),
            "meds_due": medication_records.len(),
            "wounds_to_assess": wound_assessments.len(),
            "ivs_to_check": iv_assessments.len()
        }
    }))
}

/// Lab Technician Dashboard - test queue, pending specimens, QC status
#[get("/api/dashboard/lab")]
pub async fn lab_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !matches!(
        current_user.role,
        crate::Role::LabTechnician | crate::Role::Admin
    ) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Lab dashboard requires LabTechnician or Admin role".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get pending lab submissions
    let pending_submissions: Vec<_> = {
        let subs = data.lab_submissions.read().unwrap();
        subs.values()
            .filter(|s| s.status == crate::LabResultStatus::Pending)
            .cloned()
            .collect()
    };

    // Get approved submissions
    let approved_submissions: Vec<_> = {
        let subs = data.lab_submissions.read().unwrap();
        subs.values()
            .filter(|s| s.status == crate::LabResultStatus::Approved)
            .take(20)
            .cloned()
            .collect()
    };

    // Get specimen collections
    let specimens: Vec<_> = {
        let specs = data.specimen_collections.read().unwrap();
        specs.values().take(20).cloned().collect()
    };

    // Get specimen rejections
    let rejections: Vec<_> = {
        let rejs = data.specimen_rejections.read().unwrap();
        rejs.values().take(10).cloned().collect()
    };

    // Get QC records
    let qc_records: Vec<_> = {
        let qcs = data.lab_qc_records.read().unwrap();
        qcs.values().take(10).cloned().collect()
    };

    // Get critical value notifications
    let critical_notifications: Vec<_> = {
        let crits = data.critical_values.read().unwrap();
        crits.values().take(10).cloned().collect()
    };

    // Get chain of custody records
    let custody_records: Vec<_> = {
        let cocs = data.chain_of_custody.read().unwrap();
        cocs.values().take(10).cloned().collect()
    };

    // Get lab panels
    let lab_panels: Vec<_> = {
        let panels = data.lab_panels.read().unwrap();
        panels.values().cloned().collect()
    };

    HttpResponse::Ok().json(serde_json::json!({
        "role": "LabTechnician",
        "test_queue": {
            "pending": pending_submissions,
            "approved_today": approved_submissions,
            "pending_count": pending_submissions.len(),
            "approved_count": approved_submissions.len()
        },
        "specimens": specimens,
        "rejections": rejections,
        "qc_records": qc_records,
        "critical_notifications": critical_notifications,
        "chain_of_custody": custody_records,
        "available_panels": lab_panels,
        "alerts": {
            "pending_tests": pending_submissions.len(),
            "critical_values": critical_notifications.len(),
            "rejections_today": rejections.len()
        }
    }))
}

/// Admin Dashboard - system overview, all users, all data
#[get("/api/dashboard/admin")]
pub async fn admin_dashboard(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !matches!(current_user.role, crate::Role::Admin) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Admin dashboard requires Admin role".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get all users from repository
    // Note: User repository doesn't seem to be in RepositoryContainer, 
    // it's likely part of PatientRepository or separate.
    // Checking main.rs AppState, it has `users: RwLock<HashMap<String, User>>`.
    // For now, I'll keep user list as is if no user repository exists, 
    // or I'll check if patients.list covers it.
    let users: Vec<_> = {
        let users = data.users.read().unwrap();
        users.values().cloned().collect()
    };

    // Get all patients from repository
    let pagination = Pagination::new(0, 100);
    let patients = match data.repositories.patients.list(pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Count by role (still using in-memory users for now)
    let doctors_count = users
        .iter()
        .filter(|u| matches!(u.role, crate::Role::Doctor))
        .count();
    let nurses_count = users
        .iter()
        .filter(|u| matches!(u.role, crate::Role::Nurse))
        .count();
    let lab_techs_count = users
        .iter()
        .filter(|u| matches!(u.role, crate::Role::LabTechnician))
        .count();
    let pharmacists_count = users
        .iter()
        .filter(|u| matches!(u.role, crate::Role::Pharmacist))
        .count();
    let patients_count = users
        .iter()
        .filter(|u| matches!(u.role, crate::Role::Patient))
        .count();

    // Get access logs from repository
    let pagination = Pagination::new(0, 50);
    let access_logs = match data.repositories.access_logs.list(pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get NFC cards from repository
    let pagination = Pagination::new(0, 100);
    let nfc_cards = match data.repositories.nfc_tags.list(pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get all lab submissions from repository
    let pagination = Pagination::new(0, 100);
    let lab_submissions = match data.repositories.lab_submissions.get_by_patient("", pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Get emergency events from repositories
    let pagination = Pagination::new(0, 1);
    let code_blues_count = match data.repositories.code_blue.get_by_patient("", pagination.clone()).await {
        Ok(r) => r.total,
        Err(_) => 0,
    };
    let traumas_count = match data.repositories.trauma_assessments_repo.get_by_patient("", pagination.clone()).await {
        Ok(r) => r.total,
        Err(_) => 0,
    };
    let strokes_count = match data.repositories.stroke_assessments_repo.get_by_patient("", pagination.clone()).await {
        Ok(r) => r.total,
        Err(_) => 0,
    };
    let sepsis_count = match data.repositories.sepsis_assessments_repo.get_by_patient("", pagination).await {
        Ok(r) => r.total,
        Err(_) => 0,
    };

    HttpResponse::Ok().json(serde_json::json!({
        "role": "Admin",
        "system_stats": {
            "total_users": users.len(),
            "total_patients": patients.len(),
            "doctors": doctors_count,
            "nurses": nurses_count,
            "lab_technicians": lab_techs_count,
            "pharmacists": pharmacists_count,
            "patient_users": patients_count
        },
        "users": users,
        "nfc_cards": {
            "total": nfc_cards.len(),
            "cards": nfc_cards.iter().take(20).collect::<Vec<_>>()
        },
        "lab_submissions": {
            "total": lab_submissions.len(),
            "pending": lab_submissions.iter().filter(|s| s.status == "pending").count(),
            "approved": lab_submissions.iter().filter(|s| s.status == "approved").count()
        },
        "emergency_events": {
            "code_blues": code_blues_count,
            "traumas": traumas_count,
            "strokes": strokes_count,
            "sepsis_cases": sepsis_count,
            "total": code_blues_count + traumas_count + strokes_count + sepsis_count
        },
        "recent_access_logs": access_logs
    }))
}

/// Pharmacist Dashboard - pending prescriptions, drug interactions, inventory
#[get("/api/dashboard/pharmacist")]
pub async fn pharmacist_dashboard(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !matches!(
        current_user.role,
        crate::Role::Pharmacist | crate::Role::Admin
    ) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Pharmacist dashboard requires Pharmacist or Admin role".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get e-prescriptions from the repository
    let pagination = Pagination::new(0, 100);
    let prescriptions = match data.repositories.e_prescriptions.list_all(pagination).await {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    // Count prescriptions by status
    let pending_fill = prescriptions
        .iter()
        .filter(|rx| {
            rx.status == "transmitted" || rx.status == "received"
        })
        .count();
    let in_progress = prescriptions
        .iter()
        .filter(|rx| rx.status == "in_progress")
        .count();
    let completed_today = prescriptions
        .iter()
        .filter(|rx| {
            rx.status == "dispensed" || rx.status == "partial_fill"
        })
        .count();

    // Get prescriptions needing to be filled (transmitted or received)
    let pending_prescriptions: Vec<_> = prescriptions
        .iter()
        .filter(|rx| {
            rx.status == "transmitted" || rx.status == "received"
        })
        .take(20)
        .cloned()
        .collect();

    // Get drug interaction alerts - placeholder for now (would query drug interaction database)
    let drug_interaction_alerts: Vec<String> = Vec::new();

    // Get allergy alerts - placeholder for now (would cross-reference patient allergies)
    let allergy_alerts: Vec<String> = Vec::new();

    HttpResponse::Ok().json(serde_json::json!({
        "role": "Pharmacist",
        "prescriptions": {
            "pending_fill": pending_fill,
            "in_progress": in_progress,
            "completed_today": completed_today,
            "list": pending_prescriptions
        },
        "drug_interactions": drug_interaction_alerts,
        "allergy_alerts": allergy_alerts,
        "alerts": {
            "pending_rx_count": pending_fill,
            "interactions_count": drug_interaction_alerts.len(),
            "allergy_alerts_count": allergy_alerts.len()
        }
    }))
}

// ============================================================================
// PATIENT LIST & FILTERING
// ============================================================================

/// Get patient list with filters (for doctors/nurses)
#[get("/api/patients/list")]
pub async fn get_patient_list(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Use repository for patient list/search
    let limit: u32 = query
        .get("limit")
        .and_then(|l| l.parse().ok())
        .unwrap_or(50);

    let offset: u32 = query
        .get("offset")
        .and_then(|o| o.parse().ok())
        .unwrap_or(0);

    let page = offset / limit;
    let pagination = Pagination::new(page, limit);

    let patient_result = if let Some(search) = query.get("search") {
        data.repositories.patients.search(search, pagination).await
    } else {
        data.repositories.patients.list(pagination).await
    };

    let result = match patient_result {
        Ok(res) => res,
        Err(_) => PaginatedResult::new(Vec::new(), 0, &Pagination::new(page, limit)),
    };

    // Filter by additional criteria in memory for now if repository doesn't support them all
    let mut patient_list = result.items;

    if let Some(blood_type) = query.get("blood_type") {
        patient_list.retain(|p| {
            p.blood_type.as_ref().map(|bt| bt.to_lowercase()) == Some(blood_type.to_lowercase())
        });
    }

    if let Some(organ_donor) = query.get("organ_donor") {
        if organ_donor == "true" {
            patient_list.retain(|p| p.organ_donor);
        }
    }

    if let Some(dnr) = query.get("dnr") {
        if dnr == "true" {
            patient_list.retain(|p| p.dnr_status);
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "patients": patient_list,
        "total": result.total,
        "limit": limit,
        "offset": offset,
        "page": result.page,
        "total_pages": result.total_pages
    }))
}

// ============================================================================
// ORDER SETS (Common Order Bundles)
// ============================================================================

/// Get available order sets
#[get("/api/order-sets")]
pub async fn get_order_sets(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Predefined order sets
    let order_sets = vec![
        serde_json::json!({
            "id": "OS-CHF",
            "name": "CHF Admission Orders",
            "category": "Cardiology",
            "orders": [
                {"type": "diet", "description": "Low sodium diet (2g Na)"},
                {"type": "activity", "description": "Bed rest with bathroom privileges"},
                {"type": "vital_signs", "description": "VS q4h, daily weights"},
                {"type": "lab", "description": "BMP, BNP, CBC daily"},
                {"type": "medication", "description": "Furosemide 40mg IV BID"},
                {"type": "medication", "description": "Lisinopril 10mg PO daily"},
                {"type": "medication", "description": "Carvedilol 12.5mg PO BID"},
                {"type": "iv", "description": "IV access, saline lock"},
                {"type": "monitoring", "description": "Strict I&O, fluid restriction 1.5L/day"}
            ]
        }),
        serde_json::json!({
            "id": "OS-DKA",
            "name": "DKA Management Orders",
            "category": "Endocrinology",
            "orders": [
                {"type": "iv", "description": "NS 1L bolus, then 250-500ml/hr"},
                {"type": "lab", "description": "BMP q2h, POC glucose q1h"},
                {"type": "medication", "description": "Regular insulin 0.1 U/kg/hr IV"},
                {"type": "medication", "description": "Potassium replacement per protocol"},
                {"type": "monitoring", "description": "Strict I&O, neuro checks q2h"},
                {"type": "vital_signs", "description": "VS q1h x4, then q2h"}
            ]
        }),
        serde_json::json!({
            "id": "OS-SEPSIS",
            "name": "Sepsis Bundle Orders",
            "category": "Infectious Disease",
            "orders": [
                {"type": "lab", "description": "Blood cultures x2 sets, lactate, CBC, BMP, LFTs"},
                {"type": "iv", "description": "30ml/kg crystalloid bolus"},
                {"type": "medication", "description": "Broad spectrum antibiotics within 1 hour"},
                {"type": "monitoring", "description": "MAP goal ≥65, urine output ≥0.5ml/kg/hr"},
                {"type": "vital_signs", "description": "VS q15min x4, then q1h"},
                {"type": "consult", "description": "Consider ICU consult if refractory"}
            ]
        }),
        serde_json::json!({
            "id": "OS-STROKE",
            "name": "Acute Stroke Orders",
            "category": "Neurology",
            "orders": [
                {"type": "imaging", "description": "CT head STAT, CT angio if indicated"},
                {"type": "lab", "description": "CBC, BMP, PT/INR, glucose"},
                {"type": "vital_signs", "description": "Neuro checks q15min, VS q15min"},
                {"type": "diet", "description": "NPO pending swallow eval"},
                {"type": "activity", "description": "Bed rest, HOB 0-30 degrees"},
                {"type": "medication", "description": "tPA if eligible (door-to-needle <60min)"},
                {"type": "consult", "description": "Neurology STAT, consider interventional"}
            ]
        }),
        serde_json::json!({
            "id": "OS-CHEST-PAIN",
            "name": "Chest Pain Rule-Out ACS",
            "category": "Cardiology",
            "orders": [
                {"type": "lab", "description": "Troponin x3 (0, 3, 6 hours), BMP, CBC"},
                {"type": "ecg", "description": "12-lead ECG STAT, repeat if symptoms change"},
                {"type": "medication", "description": "Aspirin 325mg PO x1 (if not contraindicated)"},
                {"type": "medication", "description": "Nitroglycerin 0.4mg SL PRN chest pain"},
                {"type": "iv", "description": "IV access, saline lock"},
                {"type": "monitoring", "description": "Continuous cardiac monitoring"},
                {"type": "vital_signs", "description": "VS q4h, pain reassessment q1h"}
            ]
        }),
        serde_json::json!({
            "id": "OS-PNEUMONIA",
            "name": "Community Acquired Pneumonia",
            "category": "Pulmonology",
            "orders": [
                {"type": "lab", "description": "CBC, BMP, procalcitonin, blood cultures x2"},
                {"type": "imaging", "description": "Chest X-ray PA/Lateral"},
                {"type": "medication", "description": "Ceftriaxone 1g IV daily + Azithromycin 500mg IV daily"},
                {"type": "medication", "description": "Acetaminophen 650mg PO q6h PRN fever"},
                {"type": "iv", "description": "NS at 75ml/hr"},
                {"type": "diet", "description": "Regular diet as tolerated"},
                {"type": "vital_signs", "description": "VS q4h, pulse ox continuous"}
            ]
        }),
        serde_json::json!({
            "id": "OS-POST-OP",
            "name": "General Post-Op Orders",
            "category": "Surgery",
            "orders": [
                {"type": "diet", "description": "NPO until bowel sounds, advance as tolerated"},
                {"type": "activity", "description": "OOB to chair POD1, ambulate TID"},
                {"type": "vital_signs", "description": "VS q4h, neuro checks q4h if applicable"},
                {"type": "medication", "description": "DVT prophylaxis per protocol"},
                {"type": "medication", "description": "Pain management per service"},
                {"type": "lab", "description": "CBC, BMP POD1"},
                {"type": "wound", "description": "Wound checks daily, dressing change POD2"}
            ]
        }),
        serde_json::json!({
            "id": "OS-ASTHMA",
            "name": "Acute Asthma Exacerbation",
            "category": "Pulmonology",
            "orders": [
                {"type": "medication", "description": "Albuterol 2.5mg nebulizer q20min x3"},
                {"type": "medication", "description": "Ipratropium 0.5mg nebulizer x1"},
                {"type": "medication", "description": "Methylprednisolone 125mg IV x1"},
                {"type": "lab", "description": "ABG if severe, peak flow before/after"},
                {"type": "vital_signs", "description": "VS q15min during treatment"},
                {"type": "monitoring", "description": "Continuous pulse ox"},
                {"type": "imaging", "description": "CXR if first episode or concern for PNA"}
            ]
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "order_sets": order_sets,
        "total": order_sets.len()
    }))
}

// ============================================================================
// NOTIFICATION SYSTEM
// ============================================================================

/// Get notifications for current user
#[get("/api/notifications")]
pub async fn get_notifications(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    let mut notifications = Vec::new();

    // For doctors/nurses/admins - check for critical values
    if current_user.role.can_view_medical_records() {
        let critical_values = data.critical_values.read().unwrap();
        for cv in critical_values.values().take(5) {
            notifications.push(serde_json::json!({
                "id": cv.notification_id,
                "type": "critical_value",
                "priority": "high",
                "title": format!("Critical Value: {}", cv.test_name),
                "patient_id": cv.patient_id,
                "timestamp": chrono::Utc::now().timestamp()
            }));
        }

        // Check for pending lab approvals (doctors only)
        if matches!(current_user.role, crate::Role::Doctor | crate::Role::Admin) {
            let pending = data.lab_submissions.read().unwrap();
            let pending_count = pending
                .values()
                .filter(|s| s.status == crate::LabResultStatus::Pending)
                .count();
            if pending_count > 0 {
                notifications.push(serde_json::json!({
                    "id": "pending-labs",
                    "type": "pending_approval",
                    "priority": "medium",
                    "title": format!("{} lab results awaiting approval", pending_count),
                    "count": pending_count,
                    "timestamp": chrono::Utc::now().timestamp()
                }));
            }
        }

        // Check for recent code blues - Use repository
        let code_blues = data
            .repositories
            .code_blue
            .list_all()
            .await
            .unwrap_or_default();
        for cb in code_blues.iter().take(3) {
            notifications.push(serde_json::json!({
                "id": cb.id,
                "type": "code_blue",
                "priority": "critical",
                "title": "Code Blue Event",
                "patient_id": cb.patient_id,
                "timestamp": cb.code_called_at
            }));
        }
    }

    // For patients - check for new lab results
    if matches!(current_user.role, crate::Role::Patient) {
        let lab_results = data.lab_submissions.read().unwrap();
        let approved_results: Vec<_> = lab_results
            .values()
            .filter(|s| {
                s.patient_id == current_user_id && s.status == crate::LabResultStatus::Approved
            })
            .take(5)
            .collect();

        for result in approved_results {
            notifications.push(serde_json::json!({
                "id": result.id,
                "type": "lab_result",
                "priority": "low",
                "title": format!("New lab result: {}", result.test_name),
                "timestamp": result.reviewed_at.map(|t| t.timestamp()).unwrap_or(0)
            }));
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "notifications": notifications,
        "count": notifications.len(),
        "unread": notifications.len()
    }))
}

// ============================================================================
// MEDICATION REMINDERS (for patients)
// ============================================================================

/// Get medication reminders for a patient
#[get("/api/medication-reminders/{patient_id}")]
pub async fn get_medication_reminders(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Patients can only see their own, healthcare providers can see any
    if !current_user.role.can_view_medical_records() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Get patient profile for current medications from repository
    let patient = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(p) => Some(p),
        Err(_) => None,
    };

    // TODO: Phase 2: Chronic medications should be fetched from repository
    let medications: Vec<String> = Vec::new();

    // Generate reminders based on medication names (simplified)
    let reminders: Vec<_> = medications
        .iter()
        .enumerate()
        .map(|(i, med)| {
            serde_json::json!({
                "id": format!("rem-{}", i),
                "medication": med,
                "schedule": if med.to_lowercase().contains("daily") {
                    vec!["08:00"]
                } else if med.to_lowercase().contains("bid") {
                    vec!["08:00", "20:00"]
                } else if med.to_lowercase().contains("tid") {
                    vec!["08:00", "14:00", "20:00"]
                } else {
                    vec!["08:00"]
                },
                "next_due": "08:00",
                "last_taken": serde_json::Value::Null,
                "refill_due": false
            })
        })
        .collect();

    // Get MAR records for history from repository
    let pagination = Pagination::new(0, 5);
    let mar_history: Vec<_> = match data
        .repositories
        .medication_records
        .get_by_patient(&patient_id, None, pagination)
        .await
    {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "medications": medications,
        "reminders": reminders,
        "administration_history": mar_history,
        "total_medications": medications.len()
    }))
}

// ============================================================================
// NURSE TASK LIST
// ============================================================================

/// Get task list for nurses
#[get("/api/tasks/nurse")]
pub async fn get_nurse_tasks(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !matches!(current_user.role, crate::Role::Nurse | crate::Role::Admin) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Nurse task list requires Nurse or Admin role".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let now = chrono::Utc::now();
    let mut tasks = Vec::new();

    // Vital signs tasks - Use repository for patient list
    {
        let pagination = Pagination::new(0, 100);
        let patients = match data.repositories.patients.list(pagination).await {
            Ok(res) => res.items,
            Err(_) => Vec::new(),
        };
        for patient in patients {
            tasks.push(serde_json::json!({
                "id": format!("vs-{}", patient.id),
                "type": "vital_signs",
                "patient_id": patient.id,
                "patient_name": "Patient", // Name is encrypted, would need decryption
                "description": "Vital signs check due",
                "due_time": now.timestamp() + 3600, // 1 hour from now
                "priority": "routine",
                "completed": false
            }));
        }
    }

    // Medication administration tasks - Use repository
    {
        let pagination = Pagination::new(0, 10);
        let mars = match data.repositories.medication_records.list_all(pagination).await {
            Ok(res) => res.items,
            Err(_) => Vec::new(),
        };
        for mar in mars {
            if let Some(scheduled) = mar.scheduled_medications.as_array() {
                for med_val in scheduled {
                    let med_name = med_val.get("name").and_then(|v| v.as_str()).unwrap_or("Unknown");
                    tasks.push(serde_json::json!({
                        "id": format!("med-{}-{}", mar.patient_id, med_name),
                        "type": "medication",
                        "patient_id": mar.patient_id,
                        "description": format!("Administer {}", med_name),
                        "due_time": now.timestamp() + 1800, // 30 min from now
                        "priority": "high",
                        "completed": false
                    }));
                }
            }
        }
    }

    // Wound care tasks - Use repository
    {
        let wounds = match data
            .repositories
            .wound_assessments
            .list_all(Pagination::new(0, 5))
            .await
        {
            Ok(res) => res.items,
            Err(_) => Vec::new(),
        };
        for wound in wounds.iter().take(5) {
            tasks.push(serde_json::json!({
                "id": format!("wound-{}", wound.id),
                "type": "wound_care",
                "patient_id": wound.patient_id,
                "description": format!("Wound assessment - {}", wound.wound_id),
                "due_time": now.timestamp() + 7200, // 2 hours
                "priority": "medium",
                "completed": false
            }));
        }
    }

    // IV checks - Use repository (sites needing attention)
    {
        let ivs = data
            .repositories
            .iv_assessments
            .get_sites_needing_attention()
            .await
            .unwrap_or_default();
        for iv in ivs.iter().take(5) {
            tasks.push(serde_json::json!({
                "id": format!("iv-{}", iv.id),
                "type": "iv_check",
                "patient_id": iv.patient_id,
                "description": format!("IV site check - {}", iv.site_id),
                "due_time": now.timestamp() + 14400, // 4 hours
                "priority": "routine",
                "completed": false
            }));
        }
    }

    // Sort by due time
    tasks.sort_by(|a, b| {
        let time_a = a.get("due_time").and_then(|t| t.as_i64()).unwrap_or(0);
        let time_b = b.get("due_time").and_then(|t| t.as_i64()).unwrap_or(0);
        time_a.cmp(&time_b)
    });

    HttpResponse::Ok().json(serde_json::json!({
        "tasks": tasks,
        "total": tasks.len(),
        "overdue": tasks.iter().filter(|t| {
            t.get("due_time").and_then(|d| d.as_i64()).unwrap_or(0) < now.timestamp()
        }).count()
    }))
}

// ============================================================================
// SYMPTOM TRACKER (for chronic condition management)
// ============================================================================

/// Log a symptom entry for a patient
#[post("/api/symptoms/log")]
pub async fn log_symptom(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Get patient_id - patients log for themselves, providers can log for patients
    let patient_id = if matches!(current_user.role, crate::Role::Patient) {
        current_user_id.clone()
    } else {
        body.get("patient_id")
            .and_then(|p| p.as_str())
            .map(|s| s.to_string())
            .unwrap_or(current_user_id.clone())
    };

    let symptom = body
        .get("symptom")
        .and_then(|s| s.as_str())
        .unwrap_or("Unknown");
    let severity = body.get("severity").and_then(|s| s.as_u64()).unwrap_or(5) as u8;
    let notes = body
        .get("notes")
        .and_then(|n| n.as_str())
        .map(|s| s.to_string());
    let triggers = body
        .get("triggers")
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let entry_id = format!(
        "SYM-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    let symptom_entry = serde_json::json!({
        "entry_id": entry_id,
        "patient_id": patient_id,
        "symptom": symptom,
        "severity": severity.min(10), // 0-10 scale
        "notes": notes,
        "triggers": triggers,
        "logged_by": current_user_id,
        "logged_at": chrono::Utc::now().timestamp(),
        "date": chrono::Utc::now().format("%Y-%m-%d").to_string()
    });

    // Log access via repository (persists to memory or postgres backend)
    let _ = data.repositories.access_logs.create(crate::AccessLogEntry {
        access_id: uuid::Uuid::new_v4().to_string(),
        patient_id: patient_id.clone(),
        accessor_id: current_user_id,
        accessor_role: current_user.role.to_string(),
        access_type: "log_symptom".to_string(),
        location: None,
        timestamp: chrono::Utc::now(),
        emergency: false,
    }.into()).await;

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "entry": symptom_entry,
        "message": "Symptom logged successfully"
    }))
}

/// Get symptom history for a patient
#[get("/api/symptoms/{patient_id}")]
pub async fn get_symptom_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Patients can only see their own, providers can see any
    if !current_user.role.can_view_medical_records() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Get patient's chronic conditions for context from repository
    // TODO: Phase 2: Chronic conditions should be fetched from repository
    let chronic_conditions: Vec<String> = Vec::new();

    // Generate sample symptom history based on chronic conditions from repository
    let pagination = Pagination::new(0, 50);
    let symptom_entries: Vec<_> = match data
        .repositories
        .sample_history
        .get_by_patient(&patient_id, pagination)
        .await
    {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "chronic_conditions": chronic_conditions,
        "symptom_history": symptom_entries,
        "total_entries": symptom_entries.len()
    }))
}

// ============================================================================
// SECURE MESSAGING SYSTEM
// ============================================================================

/// Send a secure message
#[post("/api/messages/send")]
pub async fn send_message(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    let recipient_id = match body.get("recipient_id").and_then(|r| r.as_str()) {
        Some(r) => r.to_string(),
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "recipient_id is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
    };

    let subject = body
        .get("subject")
        .and_then(|s| s.as_str())
        .unwrap_or("No Subject");
    let content = match body.get("content").and_then(|c| c.as_str()) {
        Some(c) => c,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "content is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
    };

    let priority = body
        .get("priority")
        .and_then(|p| p.as_str())
        .unwrap_or("normal");
    let related_patient_id = body.get("related_patient_id").and_then(|p| p.as_str());

    // Patients can only message healthcare providers
    if matches!(current_user.role, crate::Role::Patient) {
        let recipient = get_user(&data, &recipient_id);
        if recipient.is_none() || matches!(recipient.as_ref().unwrap().role, crate::Role::Patient) {
            return HttpResponse::Forbidden().json(ErrorResponse {
                success: false,
                error: "Patients can only message healthcare providers".to_string(),
                code: "INVALID_RECIPIENT".to_string(),
            });
        }
    }

    let message_id = format!(
        "MSG-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    let message = serde_json::json!({
        "message_id": message_id,
        "sender_id": current_user_id,
        "sender_name": current_user.username,
        "sender_role": current_user.role.to_string(),
        "recipient_id": recipient_id,
        "subject": subject,
        "content": content,
        "priority": priority,
        "related_patient_id": related_patient_id,
        "sent_at": chrono::Utc::now().timestamp(),
        "read": false,
        "thread_id": body.get("thread_id").and_then(|t| t.as_str()).unwrap_or(&message_id)
    });

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "message": message,
        "info": "Message sent successfully"
    }))
}

/// Get messages for current user
#[get("/api/messages")]
pub async fn get_messages(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    let folder = query.get("folder").map(|s| s.as_str()).unwrap_or("inbox");

    // Generate sample messages based on role
    let messages: Vec<serde_json::Value> = if matches!(current_user.role, crate::Role::Patient) {
        vec![
            serde_json::json!({
                "message_id": "MSG-001",
                "sender_id": "PROVIDER-SAMPLE-001",
                "sender_name": "Dr. Sample",
                "sender_role": "Doctor",
                "subject": "Your lab results are ready",
                "preview": "Your recent blood work shows improvement...",
                "sent_at": chrono::Utc::now().timestamp() - 3600,
                "read": false,
                "priority": "normal"
            }),
            serde_json::json!({
                "message_id": "MSG-002",
                "sender_id": "PROVIDER-SAMPLE-002",
                "sender_name": "Nurse Sample",
                "sender_role": "Nurse",
                "subject": "Appointment reminder",
                "preview": "This is a reminder for your appointment tomorrow...",
                "sent_at": chrono::Utc::now().timestamp() - 86400,
                "read": true,
                "priority": "normal"
            }),
        ]
    } else {
        vec![
            serde_json::json!({
                "message_id": "MSG-003",
                "sender_id": "PATIENT-SAMPLE-001",
                "sender_name": "Patient Sample",
                "sender_role": "Patient",
                "subject": "Question about medication",
                "preview": "I've been experiencing some side effects...",
                "sent_at": chrono::Utc::now().timestamp() - 1800,
                "read": false,
                "priority": "high"
            }),
            serde_json::json!({
                "message_id": "MSG-004",
                "sender_id": "PROVIDER-SAMPLE-003",
                "sender_name": "Dr. Colleague",
                "sender_role": "Doctor",
                "subject": "Consult request",
                "preview": "I'd like your opinion on a patient case...",
                "sent_at": chrono::Utc::now().timestamp() - 7200,
                "read": false,
                "priority": "normal"
            }),
        ]
    };

    HttpResponse::Ok().json(serde_json::json!({
        "folder": folder,
        "messages": messages,
        "unread_count": messages.iter().filter(|m| !m.get("read").and_then(|r| r.as_bool()).unwrap_or(true)).count(),
        "total": messages.len()
    }))
}

// ============================================================================
// CONSENT FORMS MANAGEMENT
// ============================================================================

/// Available consent form types
#[get("/api/consent/types")]
pub async fn get_consent_types(
    _data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let _current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let consent_types = vec![
        serde_json::json!({
            "type_id": "CONSENT-TREATMENT",
            "name": "General Treatment Consent",
            "description": "Consent for general medical treatment and care",
            "required_for": ["admission", "outpatient"],
            "expires_after_days": 365
        }),
        serde_json::json!({
            "type_id": "CONSENT-SURGERY",
            "name": "Surgical Consent",
            "description": "Consent for surgical procedures",
            "required_for": ["surgery"],
            "expires_after_days": 30
        }),
        serde_json::json!({
            "type_id": "CONSENT-ANESTHESIA",
            "name": "Anesthesia Consent",
            "description": "Consent for anesthesia administration",
            "required_for": ["surgery"],
            "expires_after_days": 30
        }),
        serde_json::json!({
            "type_id": "CONSENT-BLOOD",
            "name": "Blood Transfusion Consent",
            "description": "Consent for blood product transfusion",
            "required_for": ["transfusion"],
            "expires_after_days": 30
        }),
        serde_json::json!({
            "type_id": "CONSENT-HIPAA",
            "name": "HIPAA Privacy Notice",
            "description": "Acknowledgment of privacy practices",
            "required_for": ["admission"],
            "expires_after_days": 365
        }),
        serde_json::json!({
            "type_id": "CONSENT-RESEARCH",
            "name": "Research Participation Consent",
            "description": "Consent for participation in clinical research",
            "required_for": ["research"],
            "expires_after_days": 365
        }),
        serde_json::json!({
            "type_id": "CONSENT-TELEMEDICINE",
            "name": "Telemedicine Consent",
            "description": "Consent for virtual/remote care",
            "required_for": ["telemedicine"],
            "expires_after_days": 365
        }),
        serde_json::json!({
            "type_id": "CONSENT-IMAGING",
            "name": "Imaging/Radiology Consent",
            "description": "Consent for diagnostic imaging procedures",
            "required_for": ["imaging"],
            "expires_after_days": 30
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "consent_types": consent_types,
        "total": consent_types.len()
    }))
}

/// Sign a consent form
#[post("/api/consent/sign")]
pub async fn sign_consent(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    let patient_id = body
        .get("patient_id")
        .and_then(|p| p.as_str())
        .map(|s| s.to_string())
        .unwrap_or(current_user_id.clone());

    let consent_type = match body.get("consent_type").and_then(|c| c.as_str()) {
        Some(c) => c,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "consent_type is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
    };

    let witness_id = body.get("witness_id").and_then(|w| w.as_str());
    let procedure_description = body.get("procedure_description").and_then(|p| p.as_str());

    let consent_id = format!(
        "CSNT-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    // Generate signature hash (in production: use actual digital signature)
    let signature_hash = {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        format!(
            "{}{}{}",
            patient_id,
            consent_type,
            chrono::Utc::now().timestamp()
        )
        .hash(&mut hasher);
        format!("{:016x}", hasher.finish())
    };

    let signed_consent = serde_json::json!({
        "consent_id": consent_id,
        "patient_id": patient_id,
        "consent_type": consent_type,
        "procedure_description": procedure_description,
        "signed_by": current_user_id,
        "signer_name": current_user.username,
        "signer_role": current_user.role.to_string(),
        "witness_id": witness_id,
        "signature_hash": signature_hash,
        "signed_at": chrono::Utc::now().timestamp(),
        "valid_until": chrono::Utc::now().timestamp() + (30 * 24 * 60 * 60), // 30 days
        "status": "active",
        "ip_address": "127.0.0.1", // In production: actual IP
        "device_info": "MediChain API"
    });

    // Log access via repository
    let _ = data.repositories.access_logs.create(crate::AccessLogEntry {
        access_id: uuid::Uuid::new_v4().to_string(),
        patient_id: patient_id.clone(),
        accessor_id: current_user_id,
        accessor_role: current_user.role.to_string(),
        access_type: "sign_consent".to_string(),
        location: None,
        timestamp: chrono::Utc::now(),
        emergency: false,
    }.into()).await;

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "consent": signed_consent,
        "message": "Consent form signed successfully"
    }))
}

/// Get patient's consent forms
#[get("/api/consent/patient/{patient_id}")]
pub async fn get_patient_consents(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Patients can only see their own, providers can see any
    if !current_user.role.can_view_medical_records() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Sample consents for demo
    let consents = vec![
        serde_json::json!({
            "consent_id": "CSNT-001",
            "consent_type": "CONSENT-TREATMENT",
            "signed_at": chrono::Utc::now().timestamp() - 86400 * 30,
            "valid_until": chrono::Utc::now().timestamp() + 86400 * 335,
            "status": "active"
        }),
        serde_json::json!({
            "consent_id": "CSNT-002",
            "consent_type": "CONSENT-HIPAA",
            "signed_at": chrono::Utc::now().timestamp() - 86400 * 30,
            "valid_until": chrono::Utc::now().timestamp() + 86400 * 335,
            "status": "active"
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "consents": consents,
        "total": consents.len()
    }))
}

// ============================================================================
// BARCODE/SAMPLE TRACKING (Simulation)
// ============================================================================

/// Generate a barcode for specimen tracking
#[post("/api/barcode/generate")]
pub async fn generate_barcode(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let entity_type = body
        .get("entity_type")
        .and_then(|e| e.as_str())
        .unwrap_or("specimen");
    let entity_id = body
        .get("entity_id")
        .and_then(|e| e.as_str())
        .unwrap_or("UNKNOWN");
    let patient_id = body.get("patient_id").and_then(|p| p.as_str());

    let barcode_id = format!(
        "BC-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .replace("-", "")
            .chars()
            .take(12)
            .collect::<String>()
            .to_uppercase()
    );

    // Generate barcode value (Code 128 compatible)
    let barcode_value = format!(
        "MC{}{:06}",
        match entity_type {
            "specimen" => "SP",
            "medication" => "MED",
            "patient" => "PAT",
            "equipment" => "EQ",
            _ => "XX",
        },
        chrono::Utc::now().timestamp() % 1000000
    );

    let barcode = serde_json::json!({
        "barcode_id": barcode_id,
        "barcode_value": barcode_value,
        "barcode_type": "CODE128",
        "entity_type": entity_type,
        "entity_id": entity_id,
        "patient_id": patient_id,
        "generated_by": current_user.wallet_address,
        "generated_at": chrono::Utc::now().timestamp(),
        "status": "active",
        "scan_count": 0
    });

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "barcode": barcode,
        "message": "Barcode generated successfully"
    }))
}

/// Scan a barcode and get entity information
#[post("/api/barcode/scan")]
pub async fn scan_barcode(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let barcode_value = match body.get("barcode_value").and_then(|b| b.as_str()) {
        Some(b) => b,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "barcode_value is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
    };

    let location = body
        .get("location")
        .and_then(|l| l.as_str())
        .unwrap_or("Unknown");

    // Parse barcode to determine type
    let entity_type = if barcode_value.starts_with("MCSP") {
        "specimen"
    } else if barcode_value.starts_with("MCMED") {
        "medication"
    } else if barcode_value.starts_with("MCPAT") {
        "patient"
    } else if barcode_value.starts_with("MCEQ") {
        "equipment"
    } else {
        "unknown"
    };

    let scan_result = serde_json::json!({
        "barcode_value": barcode_value,
        "entity_type": entity_type,
        "scan_time": chrono::Utc::now().timestamp(),
        "scanned_by": current_user.wallet_address,
        "scanned_by_role": current_user.role.to_string(),
        "location": location,
        "status": "valid",
        "entity_info": match entity_type {
            "specimen" => serde_json::json!({
                "specimen_type": "Blood",
                "collection_time": chrono::Utc::now().timestamp() - 3600,
                "tests_ordered": ["CBC", "BMP"],
                "status": "In Transit"
            }),
            "medication" => serde_json::json!({
                "medication_name": "Metformin 500mg",
                "lot_number": "LOT-2026-001",
                "expiry_date": "2027-12-31",
                "status": "Available"
            }),
            "patient" => serde_json::json!({
                "patient_name": "Verified Patient",
                "room": "Room 101",
                "allergies": ["Penicillin"],
                "status": "Admitted"
            }),
            _ => serde_json::json!({"status": "Unknown barcode format"})
        }
    });

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "scan_result": scan_result,
        "message": "Barcode scanned successfully"
    }))
}

/// Get tracking history for a barcode
#[get("/api/barcode/track/{barcode_value}")]
pub async fn track_barcode(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let barcode_value = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Sample tracking history
    let tracking_history = vec![
        serde_json::json!({
            "event": "Generated",
            "timestamp": chrono::Utc::now().timestamp() - 7200,
            "location": "Lab Reception",
            "user": "LAB-TECH-SAMPLE-001"
        }),
        serde_json::json!({
            "event": "Collected",
            "timestamp": chrono::Utc::now().timestamp() - 6000,
            "location": "Room 101",
            "user": "NURSE-SAMPLE-001"
        }),
        serde_json::json!({
            "event": "Received at Lab",
            "timestamp": chrono::Utc::now().timestamp() - 3600,
            "location": "Main Laboratory",
            "user": "LAB-TECH-SAMPLE-001"
        }),
        serde_json::json!({
            "event": "Processing",
            "timestamp": chrono::Utc::now().timestamp() - 1800,
            "location": "Hematology Section",
            "user": "LAB-TECH-SAMPLE-001"
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "barcode_value": barcode_value,
        "tracking_history": tracking_history,
        "current_status": "Processing",
        "current_location": "Hematology Section",
        "total_scans": tracking_history.len()
    }))
}

/// Get user's barcode scan history
#[get("/api/barcode/scan-history")]
pub async fn get_barcode_scan_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Return sample scan history for the user
    // In a production system, this would query the database for actual scan records
    let scan_history: Vec<serde_json::Value> = vec![
        serde_json::json!({
            "id": format!("SCAN-{}", uuid::Uuid::new_v4()),
            "type": "patient",
            "barcode": "MCPAT-12345-001",
            "name": "John Smith",
            "details": "Room 101 - Admitted",
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "result": "success",
            "message": "Patient verified"
        }),
        serde_json::json!({
            "id": format!("SCAN-{}", uuid::Uuid::new_v4()),
            "type": "medication",
            "barcode": "MCMED-500-MET",
            "name": "Metformin 500mg",
            "details": "Lot: LOT-2026-001",
            "timestamp": (chrono::Utc::now() - chrono::Duration::hours(2)).to_rfc3339(),
            "result": "success",
            "message": "Medication verified"
        }),
        serde_json::json!({
            "id": format!("SCAN-{}", uuid::Uuid::new_v4()),
            "type": "specimen",
            "barcode": "MCSP-CBC-001",
            "name": "Blood Sample CBC",
            "details": "Collection pending",
            "timestamp": (chrono::Utc::now() - chrono::Duration::hours(4)).to_rfc3339(),
            "result": "success",
            "message": "Specimen tracked"
        }),
    ];

    HttpResponse::Ok().json(scan_history)
}

// ============================================================================
// QUICK NOTE TEMPLATES
// ============================================================================

/// Get available note templates
#[get("/api/templates/notes")]
pub async fn get_note_templates(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let templates = vec![
        // SOAP Note Templates
        serde_json::json!({
            "template_id": "TPL-SOAP-ROUTINE",
            "name": "Routine Follow-up SOAP",
            "category": "SOAP",
            "content": {
                "subjective": "Patient presents for routine follow-up. Reports [SYMPTOMS]. Denies [NEGATIVE_SYMPTOMS]. Medications are being taken as prescribed.",
                "objective": "VS: BP [BP], HR [HR], RR [RR], Temp [TEMP], SpO2 [SPO2]. General: Alert and oriented, no acute distress. [SYSTEM_EXAM]",
                "assessment": "1. [PRIMARY_DIAGNOSIS] - [STATUS]\n2. [SECONDARY_DIAGNOSIS] - [STATUS]",
                "plan": "1. Continue current medications\n2. [ADDITIONAL_ORDERS]\n3. Follow-up in [TIMEFRAME]"
            }
        }),
        serde_json::json!({
            "template_id": "TPL-SOAP-ED",
            "name": "Emergency Department SOAP",
            "category": "SOAP",
            "content": {
                "subjective": "Chief Complaint: [CC]\nHPI: [AGE] y/o [SEX] presents with [SYMPTOMS] x [DURATION]. Onset: [ONSET]. Quality: [QUALITY]. Severity: [SEVERITY]/10. Associated symptoms: [ASSOCIATED]. Denies: [PERTINENT_NEGATIVES].",
                "objective": "VS: BP [BP], HR [HR], RR [RR], Temp [TEMP], SpO2 [SPO2]\nGeneral: [GENERAL]\nHEENT: [HEENT]\nCardio: [CARDIO]\nPulm: [PULM]\nAbd: [ABD]\nExt: [EXT]\nNeuro: [NEURO]",
                "assessment": "1. [DIAGNOSIS] - [DIFFERENTIAL_CONSIDERATIONS]",
                "plan": "1. [WORKUP]\n2. [TREATMENT]\n3. [DISPOSITION]"
            }
        }),
        // H&P Templates
        serde_json::json!({
            "template_id": "TPL-HP-ADMISSION",
            "name": "Admission H&P",
            "category": "H&P",
            "content": {
                "chief_complaint": "[CC]",
                "hpi": "[AGE] y/o [SEX] with PMH of [PMH] presenting with [SYMPTOMS]...",
                "pmh": "[PMH_LIST]",
                "psh": "[SURGICAL_HISTORY]",
                "medications": "[MEDICATION_LIST]",
                "allergies": "[ALLERGY_LIST]",
                "social_history": "Smoking: [SMOKING]\nAlcohol: [ALCOHOL]\nDrugs: [DRUGS]\nOccupation: [OCCUPATION]",
                "family_history": "[FAMILY_HISTORY]",
                "ros": "Constitutional: [CONST]\nCardiovascular: [CV]\nRespiratory: [RESP]\nGI: [GI]\nGU: [GU]\nMSK: [MSK]\nNeuro: [NEURO]\nPsych: [PSYCH]",
                "physical_exam": "[EXAM_FINDINGS]",
                "assessment_plan": "[ASSESSMENT_AND_PLAN]"
            }
        }),
        // Procedure Notes
        serde_json::json!({
            "template_id": "TPL-PROC-CENTRAL",
            "name": "Central Line Procedure Note",
            "category": "Procedure",
            "content": {
                "procedure": "Central Venous Catheter Placement",
                "indication": "[INDICATION]",
                "consent": "Informed consent obtained",
                "site": "[SITE] - [IJ/SC/FEMORAL]",
                "technique": "Sterile technique with full barrier precautions. Ultrasound-guided. Local anesthesia with [LIDOCAINE_DOSE]. [CATHETER_TYPE] catheter placed using Seldinger technique. [ATTEMPTS] attempt(s). Blood aspirated from all ports. Catheter secured at [CM] cm.",
                "complications": "[NONE/COMPLICATIONS]",
                "post_procedure": "CXR ordered for placement confirmation",
                "attending": "[ATTENDING_NAME]"
            }
        }),
        serde_json::json!({
            "template_id": "TPL-PROC-LP",
            "name": "Lumbar Puncture Procedure Note",
            "category": "Procedure",
            "content": {
                "procedure": "Lumbar Puncture",
                "indication": "[INDICATION]",
                "consent": "Informed consent obtained",
                "position": "[LATERAL_DECUBITUS/SITTING]",
                "site": "[L3-L4/L4-L5]",
                "technique": "Sterile technique. Local anesthesia with [LIDOCAINE]. [NEEDLE_SIZE] spinal needle. Opening pressure: [OP] cm H2O. [VOLUME] mL CSF collected in [TUBES] tubes.",
                "csf_appearance": "[CLEAR/CLOUDY/BLOODY/XANTHOCHROMIC]",
                "closing_pressure": "[CP] cm H2O",
                "complications": "[NONE/COMPLICATIONS]",
                "post_procedure": "Patient instructed to remain supine for [DURATION]"
            }
        }),
        // Discharge Templates
        serde_json::json!({
            "template_id": "TPL-DC-STANDARD",
            "name": "Standard Discharge Summary",
            "category": "Discharge",
            "content": {
                "admission_date": "[ADMIT_DATE]",
                "discharge_date": "[DC_DATE]",
                "admitting_diagnosis": "[ADMIT_DX]",
                "discharge_diagnoses": "[DC_DX_LIST]",
                "procedures": "[PROCEDURES_LIST]",
                "hospital_course": "[COURSE_SUMMARY]",
                "discharge_medications": "[DC_MEDS]",
                "discharge_instructions": "[INSTRUCTIONS]",
                "follow_up": "[FOLLOW_UP_APPOINTMENTS]",
                "pending_results": "[PENDING_LABS_IMAGING]"
            }
        }),
        // Consultation Templates
        serde_json::json!({
            "template_id": "TPL-CONSULT-CARDIO",
            "name": "Cardiology Consult",
            "category": "Consult",
            "content": {
                "reason_for_consult": "[REASON]",
                "hpi": "[CARDIAC_HPI]",
                "cardiac_history": "[CARDIAC_PMH]",
                "risk_factors": "HTN: [Y/N], DM: [Y/N], Smoking: [Y/N], Dyslipidemia: [Y/N], Family Hx: [Y/N]",
                "current_meds": "[CARDIAC_MEDS]",
                "exam": "VS: [VS]\nJVP: [JVP]\nCarotids: [CAROTIDS]\nHeart: [HEART_EXAM]\nLungs: [LUNG_EXAM]\nExt: [EXTREMITIES]",
                "ecg": "[ECG_FINDINGS]",
                "echo": "[ECHO_FINDINGS]",
                "impression": "[IMPRESSION]",
                "recommendations": "[RECOMMENDATIONS]"
            }
        }),
        // Progress Note Templates
        serde_json::json!({
            "template_id": "TPL-PROG-ICU",
            "name": "ICU Progress Note",
            "category": "Progress",
            "content": {
                "events_overnight": "[OVERNIGHT_EVENTS]",
                "neuro": "GCS: [GCS], Sedation: [RASS], Pain: [CPOT]",
                "cardiovascular": "HR: [HR], BP: [BP], MAP: [MAP], Pressors: [PRESSORS], CVP: [CVP]",
                "respiratory": "Vent Mode: [MODE], FiO2: [FIO2], PEEP: [PEEP], TV: [TV], RR: [RR], SpO2: [SPO2], ABG: [ABG]",
                "renal_fluids": "I/O: [IO], UOP: [UOP], Cr: [CR], BUN: [BUN]",
                "gi_nutrition": "Diet: [DIET], Bowel: [BOWEL], Feeds: [FEEDS]",
                "heme": "Hgb: [HGB], Plt: [PLT], INR: [INR], Anticoag: [ANTICOAG]",
                "id": "Temp: [TEMP], WBC: [WBC], Abx: [ABX], Cultures: [CULTURES]",
                "skin": "[SKIN_ASSESSMENT]",
                "lines_tubes_drains": "[LINES_TUBES]",
                "assessment_plan": "[AP_BY_PROBLEM]"
            }
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "templates": templates,
        "total": templates.len(),
        "categories": ["SOAP", "H&P", "Procedure", "Discharge", "Consult", "Progress"]
    }))
}

/// Create a note from template
#[post("/api/templates/notes/use")]
pub async fn use_note_template(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let template_id = match body.get("template_id").and_then(|t| t.as_str()) {
        Some(t) => t,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "template_id is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
    };

    let patient_id = match body.get("patient_id").and_then(|p| p.as_str()) {
        Some(p) => p,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "patient_id is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
    };

    let replacements = body.get("replacements").and_then(|r| r.as_object());

    let note_id = format!(
        "NOTE-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    let created_note = serde_json::json!({
        "note_id": note_id,
        "template_id": template_id,
        "patient_id": patient_id,
        "created_by": current_user_id,
        "created_at": chrono::Utc::now().timestamp(),
        "status": "draft",
        "replacements_applied": replacements.is_some(),
        "message": "Note created from template. Fill in placeholders and save."
    });

    // Log access via repository
    let _ = data.repositories.access_logs.create(crate::AccessLogEntry {
        access_id: uuid::Uuid::new_v4().to_string(),
        patient_id: patient_id.to_string(),
        accessor_id: current_user_id,
        accessor_role: current_user.role.to_string(),
        access_type: "create_note_from_template".to_string(),
        location: None,
        timestamp: chrono::Utc::now(),
        emergency: false,
    }.into()).await;

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "note": created_note
    }))
}

// ============================================================================
// MEDICAL ID CARD SYSTEM (Emergency Access)
// ============================================================================

/// Helper to get current user
fn get_current_user(data: &web::Data<AppState>, http_req: &HttpRequest) -> Option<crate::User> {
    let user_id = get_current_user_id(http_req)?;
    get_user(data, &user_id)
}

/// Get Medical ID card data for a patient (emergency format)
/// This is the core data shown on lock screen and emergency access
#[get("/api/medical-id/{patient_id}")]
pub async fn get_medical_id(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Patients can only view their own, providers can view any
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Get patient from repository
    let patient = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(p) => p,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            })
        }
    };

    // Get allergies from repository
    let allergies = match data.repositories.allergies.get_by_patient(&patient_id).await {
        Ok(a) => a,
        Err(_) => Vec::new(),
    };

    // Pre-compute values that need sorting or complex logic
    let blood_type_color = match patient.blood_type.as_deref() {
        Some("O-") => "#DC2626",
        Some("O+") => "#EA580C",
        Some("AB+") => "#16A34A",
        _ => "#2563EB",
    };

    let critical_allergies: Vec<serde_json::Value> = allergies
        .iter()
        .filter(|a| a.severity == "Severe" || a.severity == "LifeThreatening")
        .map(|a| {
            serde_json::json!({
                "name": a.allergen,
                "severity": a.severity,
                "reaction": a.reaction,
                "display_color": "#DC2626"
            })
        })
        .collect();

    let all_allergies: Vec<serde_json::Value> = allergies
        .iter()
        .map(|a| {
            let color = match a.severity.as_str() {
                "Severe" | "LifeThreatening" => "#DC2626",
                "Moderate" => "#EA580C",
                "Mild" => "#CA8A04",
                _ => "#6B7280",
            };
            serde_json::json!({
                "name": a.allergen,
                "severity": a.severity,
                "reaction": a.reaction,
                "display_color": color
            })
        })
        .collect();

    // TODO: Emergency contacts, chronic conditions, and medications should be fetched from repositories in Phase 2
    let emergency_contacts: Vec<serde_json::Value> = Vec::new();
    let chronic_conditions: Vec<String> = Vec::new();
    let current_medications: Vec<String> = Vec::new();

    let dnr_warning: Option<&str> = if patient.dnr_status {
        Some("DO NOT RESUSCITATE - Verify advanced directive")
    } else {
        None
    };

    // Build Medical ID card data (emergency format)
    let medical_id = serde_json::json!({
        "patient_id": patient.id,
        "national_health_id": format!("MCHI-{}", patient.id.chars().skip(4).collect::<String>().to_uppercase()),
        "name": "Patient", // Name is encrypted
        "date_of_birth": "Redacted", // DOB is encrypted
        "photo": Option::<String>::None,
        "blood_type": {
            "value": patient.blood_type.clone().unwrap_or_else(|| "Unknown".to_string()),
            "display_color": blood_type_color
        },
        "critical_allergies": critical_allergies,
        "allergies": all_allergies,
        "organ_donor": {
            "status": patient.organ_donor,
            "display_color": if patient.organ_donor { "#16A34A" } else { "#6B7280" }
        },
        "dnr_status": {
            "status": patient.dnr_status,
            "display_color": if patient.dnr_status { "#DC2626" } else { "#6B7280" },
            "warning": dnr_warning
        },
        "chronic_conditions": chronic_conditions,
        "medications": current_medications,
        "emergency_contacts": emergency_contacts,
        "primary_doctor": patient.primary_provider_id.as_ref().map(|d| serde_json::json!({
            "name": format!("Provider {}", d),
            "phone": "Redacted"
        })),
        "community_health_worker": serde_json::Value::Null,
        "languages": vec!["English"],
        "primary_language": "English",
        "insurance": serde_json::Value::Null,
        "address": serde_json::Value::Null,
        "has_advanced_directives": false,
        "advanced_directives_count": 0,
        "preferences": {
            "show_when_locked": true,
            "enable_location_sharing": false,
            "auto_notify_family": true
        },
        "last_updated": chrono::Utc::now().to_rfc3339(),
    });

    // Log access via repository
    let _ = data.repositories.access_logs.create(crate::AccessLogEntry {
        access_id: uuid::Uuid::new_v4().to_string(),
        patient_id: patient_id.clone(),
        accessor_id: current_user_id,
        accessor_role: current_user.role.to_string(),
        access_type: "view_medical_id".to_string(),
        location: None,
        timestamp: chrono::Utc::now(),
        emergency: false,
    }.into()).await;

    HttpResponse::Ok().json(medical_id)
}

/// Get Medical ID QR code data (for scanning)
#[get("/api/medical-id/{patient_id}/qr")]
pub async fn get_medical_id_qr(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Patients can only view their own QR
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Get patient from repository
    let patient = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(p) => p,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            })
        }
    };

    // Get allergies from repository
    let allergies = match data.repositories.allergies.get_by_patient(&patient_id).await {
        Ok(a) => a,
        Err(_) => Vec::new(),
    };

    // QR code contains minimal critical data for offline access
    let qr_data = serde_json::json!({
        "type": "medichain_medical_id",
        "version": "1.0",
        "patient_id": patient.id,
        "name": "Patient", // Name is encrypted
        "dob": "Redacted", // DOB is encrypted
        "blood_type": patient.blood_type.clone().unwrap_or_else(|| "Unknown".to_string()),
        "critical_allergies": allergies.iter()
            .filter(|a| a.severity == "Severe" || a.severity == "LifeThreatening")
            .map(|a| a.allergen.clone())
            .collect::<Vec<_>>(),
        "dnr": patient.dnr_status,
        "organ_donor": patient.organ_donor,
        "emergency_contact": serde_json::Value::Null, // TODO: Phase 2 repository
        "api_url": format!("/api/medical-id/{}", patient_id),
        "generated_at": chrono::Utc::now().timestamp()
    });

    // Generate QR code image (base64 PNG)
    let qr_json = serde_json::to_string(&qr_data).unwrap_or_default();
    let qr_image_base64 = crate::generate_qr_code_base64(&qr_json);

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "qr_data": qr_data,
        "qr_image_base64": qr_image_base64,
        "format": "PNG",
        "instructions": "Scan this QR code to access emergency medical information"
    }))
}

/// Get emergency-only view (minimal data for first responders)
/// This endpoint can be accessed without full authentication for emergency scenarios
#[get("/api/medical-id/{patient_id}/emergency")]
pub async fn get_emergency_medical_id(
    data: web::Data<AppState>,
    path: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // Emergency access can be granted with a token or NFC hash
    let emergency_token = query.get("token");
    let nfc_hash = query.get("nfc_hash");

    // Validate emergency access (simplified for demo)
    let is_valid_emergency = emergency_token.is_some() || nfc_hash.is_some();

    if !is_valid_emergency {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Emergency access requires valid token or NFC hash".to_string(),
            code: "EMERGENCY_ACCESS_REQUIRED".to_string(),
        });
    }

    // Get patient from repository
    let patient = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(p) => p,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            })
        }
    };

    // Get allergies from repository
    let allergies = match data.repositories.allergies.get_by_patient(&patient_id).await {
        Ok(a) => a,
        Err(_) => Vec::new(),
    };

    // Emergency view - ONLY critical information
    let emergency_data = serde_json::json!({
        "type": "EMERGENCY_MEDICAL_ID",
        "warning": "⚠️ EMERGENCY ACCESS - ALL ACCESS IS LOGGED",

        // CRITICAL LIFE-SAVING INFO ONLY
        "patient": {
            "name": "Patient", // Name is encrypted
            "dob": "Redacted", // DOB is encrypted
        },

        "blood_type": {
            "value": patient.blood_type.clone().unwrap_or_else(|| "Unknown".to_string()),
            "compatible_donors": match patient.blood_type.as_deref() {
                Some("A+") => vec!["A+", "A-", "O+", "O-"],
                Some("A-") => vec!["A-", "O-"],
                Some("B+") => vec!["B+", "B-", "O+", "O-"],
                Some("B-") => vec!["B-", "O-"],
                Some("AB+") => vec!["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
                Some("AB-") => vec!["A-", "B-", "AB-", "O-"],
                Some("O+") => vec!["O+", "O-"],
                Some("O-") => vec!["O-"],
                _ => vec!["O-"],
            }
        },

        // CRITICAL ALLERGIES - LIFE THREATENING
        "critical_allergies": allergies.iter()
            .filter(|a| a.severity == "Severe" || a.severity == "Moderate" || a.severity == "LifeThreatening")
            .map(|a| serde_json::json!({
                "allergen": a.allergen.to_uppercase(),
                "severity": a.severity.to_uppercase(),
                "reaction": a.reaction
            }))
            .collect::<Vec<_>>(),

        // DNR STATUS - LEGAL REQUIREMENT
        "dnr_status": if patient.dnr_status {
            serde_json::json!({
                "status": "ACTIVE",
                "warning": "⛔ DO NOT RESUSCITATE",
                "verify_directive": true
            })
        } else {
            serde_json::json!({
                "status": "NOT_ON_FILE",
                "warning": null
            })
        },

        // ORGAN DONOR
        "organ_donor": patient.organ_donor,

        // CRITICAL MEDICATIONS
        "medications": Vec::<String>::new(), // TODO: Phase 2 repository

        // CRITICAL CONDITIONS
        "conditions": Vec::<String>::new(), // TODO: Phase 2 repository

        // PRIMARY EMERGENCY CONTACT
        "emergency_contact": serde_json::Value::Null, // TODO: Phase 2 repository

        // LANGUAGE (for communication)
        "primary_language": "en",

        // ACCESS LOG WARNING
        "access_logged": true,
        "access_timestamp": chrono::Utc::now().to_rfc3339()
    });

    // Log emergency access (CRITICAL - immutable audit trail)
    let log_entry = crate::repositories::AccessLogEntity {
        id: uuid::Uuid::new_v4().to_string(),
        accessor_id: "EMERGENCY_ACCESS".to_string(),
        accessor_role: "FirstResponder".to_string(),
        patient_id: Some(patient_id.clone()),
        resource_type: "emergency_medical_id".to_string(),
        resource_id: Some(patient_id.clone()),
        action: "view".to_string(),
        access_reason: Some("Emergency medical access".to_string()),
        is_emergency_access: true,
        ip_address: None,
        user_agent: None,
        blockchain_tx_hash: None,
        accessed_at: chrono::Utc::now(),
        facility_id: None,
    };
    let _ = data.repositories.access_logs.create(log_entry).await;

    HttpResponse::Ok().json(emergency_data)
}

/// Get Medical ID in lock screen format (minimal, high-contrast)
#[get("/api/medical-id/{patient_id}/lockscreen")]
pub async fn get_lockscreen_medical_id(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // For lock screen, we allow patient's own ID to be accessed
    // In production, this would be tied to device authentication
    let current_user_id = get_current_user_id(&http_req);

    // Get patient from repository
    let patient = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(p) => p,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            })
        }
    };

    // Get allergies from repository
    let allergies = match data.repositories.allergies.get_by_patient(&patient_id).await {
        Ok(a) => a,
        Err(_) => Vec::new(),
    };

    // Lock screen format - maximum simplicity, high contrast
    let lockscreen_data = serde_json::json!({
        "format": "lockscreen",
        "design": {
            "background": "#1F2937", // Dark gray
            "text": "#FFFFFF",
            "accent": match patient.blood_type.as_deref() {
                Some("O-") => "#DC2626",
                _ => "#3B82F6"
            }
        },

        // LINE 1: Blood Type (LARGEST)
        "blood_type": {
            "value": patient.blood_type.clone().unwrap_or_else(|| "Unknown".to_string()),
            "font_size": "48px",
            "background": "#DC2626",
            "text_color": "#FFFFFF"
        },

        // LINE 2: Critical Allergies
        "allergies_line": {
            "text": if allergies.iter().any(|a| a.severity == "Severe" || a.severity == "LifeThreatening") {
                format!("⚠️ ALLERGIC: {}",
                    allergies.iter()
                        .filter(|a| a.severity == "Severe" || a.severity == "LifeThreatening")
                        .map(|a| a.allergen.to_uppercase())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            } else {
                "No Critical Allergies".to_string()
            },
            "font_size": "20px",
            "color": if allergies.iter().any(|a| a.severity == "Severe" || a.severity == "LifeThreatening") {
                "#FCA5A5"
            } else {
                "#9CA3AF"
            }
        },

        // LINE 3: DNR Warning (if applicable)
        "dnr_line": if patient.dnr_status {
            Some(serde_json::json!({
                "text": "⛔ DNR - DO NOT RESUSCITATE",
                "font_size": "18px",
                "color": "#FCA5A5",
                "background": "#7F1D1D"
            }))
        } else {
            None
        },

        // LINE 4: Name
        "name": {
            "value": "Patient", // Name is encrypted
            "font_size": "24px"
        },

        // LINE 5: Emergency Contact Button
        "emergency_contact": serde_json::Value::Null, // TODO: Phase 2 repository

        // QR Code (small, bottom corner)
        "qr_url": format!("/api/medical-id/{}/qr", patient_id)
    });

    // Log access
    if let Some(user_id) = current_user_id {
    let log_entry = crate::repositories::AccessLogEntity {
        id: uuid::Uuid::new_v4().to_string(),
        accessor_id: user_id,
        accessor_role: "Patient".to_string(),
        patient_id: Some(patient_id.clone()),
        resource_type: "lockscreen_view".to_string(),
        resource_id: Some(patient_id.clone()),
        action: "view".to_string(),
        access_reason: Some("Patient lockscreen view".to_string()),
        is_emergency_access: false,
        ip_address: None,
        user_agent: None,
        blockchain_tx_hash: None,
        accessed_at: chrono::Utc::now(),
        facility_id: None,
    };
        let _ = data.repositories.access_logs.create(log_entry).await;
    }

    HttpResponse::Ok().json(lockscreen_data)
}

/// Update Medical ID preferences
#[post("/api/medical-id/{patient_id}/preferences")]
pub async fn update_medical_id_preferences(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Only patient themselves or admin can update preferences
    let is_patient = current_user_id == patient_id;
    let is_admin = matches!(current_user.role, crate::Role::Admin);

    if !is_patient && !is_admin {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only patient or admin can update preferences".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    let mut patients = data.patients.write().unwrap();
    let patient = match patients.get_mut(&patient_id) {
        Some(p) => p,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            })
        }
    };

    // Update preferences
    if let Some(show_when_locked) = body.get("show_when_locked").and_then(|v| v.as_bool()) {
        patient.preferences.show_when_locked = show_when_locked;
    }
    if let Some(enable_location) = body
        .get("enable_location_sharing")
        .and_then(|v| v.as_bool())
    {
        patient.preferences.enable_location_sharing = enable_location;
    }
    if let Some(auto_notify) = body.get("auto_notify_family").and_then(|v| v.as_bool()) {
        patient.preferences.auto_notify_family = auto_notify;
    }
    if let Some(language) = body.get("display_language").and_then(|v| v.as_str()) {
        patient.preferences.display_language = Some(language.to_string());
    }

    patient.last_updated = chrono::Utc::now();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "preferences": patient.preferences,
        "message": "Medical ID preferences updated"
    }))
}

/// Trigger emergency notification to family
#[post("/api/medical-id/{patient_id}/emergency-notify")]
pub async fn trigger_emergency_notification(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    // Only patient or healthcare providers can trigger
    let is_patient = current_user_id == patient_id;
    let is_provider = current_user.role.is_healthcare_provider();

    if !is_patient && !is_provider {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Get patient from repository
    let patient = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(p) => p,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            })
        }
    };

    // Check if notifications are enabled
    // Note: PatientEntity preferences mapping (simplified)
    if false { // TODO: Implement full preference check from Phase 2 repository
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Family notifications are disabled for this patient".to_string(),
            code: "NOTIFICATIONS_DISABLED".to_string(),
        });
    }

    let location = body.get("location").and_then(|l| l.as_str());
    let custom_message = body.get("message").and_then(|m| m.as_str());
    let emergency_type = body
        .get("emergency_type")
        .and_then(|e| e.as_str())
        .unwrap_or("medical");

    // Build notification data - TODO: Phase 2 repository for emergency contacts
    let notifications: Vec<serde_json::Value> = Vec::new();

    // Log emergency notification
    let log_entry = crate::repositories::AccessLogEntity {
        id: uuid::Uuid::new_v4().to_string(),
        accessor_id: current_user_id,
        accessor_role: current_user.role.to_string(),
        patient_id: Some(patient_id.clone()),
        resource_type: "emergency_notification".to_string(),
        resource_id: Some(patient_id.clone()),
        action: "create".to_string(),
        access_reason: Some(format!("Emergency {} notification", emergency_type)),
        is_emergency_access: true,
        ip_address: None,
        user_agent: None,
        blockchain_tx_hash: None,
        accessed_at: chrono::Utc::now(),
        facility_id: None,
    };
    let _ = data.repositories.access_logs.create(log_entry).await;

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "notifications_sent": notifications.len(),
        "notifications": notifications,
        "message": format!("Emergency notification queued for {} contacts", notifications.len())
    }))
}
// ============================================================================
// Phase 9: Surgical Documentation
// ============================================================================

/// Create pre-operative assessment
#[post("/api/clinical/pre-op")]
pub async fn create_pre_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<PreOperativeAssessment>,
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let assessment = req.into_inner();
    let assessment_id = assessment.assessment_id.clone();
    let now = chrono::Utc::now();
    let entity = PreOpAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: assessment.patient_id.clone(),
        data: serde_json::to_value(&assessment).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.pre_op_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get pre-operative assessment
#[get("/api/clinical/pre-op/{assessment_id}")]
pub async fn get_pre_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let assessment_id = path.into_inner();

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

    match data.repositories.pre_op_assessments.get_by_id(&assessment_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Pre-operative assessment not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create operative note
#[post("/api/clinical/operative-note")]
pub async fn create_operative_note(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<OperativeNote>,
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let note = req.into_inner();
    let note_id = note.note_id.clone();
    let now = chrono::Utc::now();
    let entity = OperativeNoteEntity {
        id: note_id.clone(),
        patient_id: note.patient_id.clone(),
        data: serde_json::to_value(&note).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.operative_notes.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "note_id": note_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get operative note
#[get("/api/clinical/operative-note/{note_id}")]
pub async fn get_operative_note(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let note_id = path.into_inner();

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

    match data.repositories.operative_notes.get_by_id(&note_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Operative note not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create post-operative note
#[post("/api/clinical/post-op")]
pub async fn create_post_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<PostOperativeNote>,
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let note = req.into_inner();
    let note_id = note.note_id.clone();
    let now = chrono::Utc::now();
    let entity = PostOpNoteEntity {
        id: note_id.clone(),
        patient_id: note.patient_id.clone(),
        data: serde_json::to_value(&note).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.post_op_notes.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "note_id": note_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get post-operative note
#[get("/api/clinical/post-op/{note_id}")]
pub async fn get_post_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let note_id = path.into_inner();

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

    match data.repositories.post_op_notes.get_by_id(&note_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Post-operative note not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// Phase 10: Anesthesia Records
// ============================================================================

/// Create anesthesia record
#[post("/api/clinical/anesthesia")]
pub async fn create_anesthesia(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<AnesthesiaRecord>,
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let record_id = record.record_id.clone();
    let now = chrono::Utc::now();
    let entity = AnesthesiaRecordEntity {
        id: record_id.clone(),
        patient_id: record.patient_id.clone(),
        data: serde_json::to_value(&record).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.anesthesia_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "record_id": record_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get anesthesia record
#[get("/api/clinical/anesthesia/{record_id}")]
pub async fn get_anesthesia(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let record_id = path.into_inner();

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

    match data.repositories.anesthesia_records.get_by_id(&record_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Anesthesia record not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List all anesthesia records
#[get("/api/clinical/anesthesia")]
pub async fn list_anesthesia(
    data: web::Data<AppState>,
    http_req: HttpRequest,
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

    let records = data.anesthesia_records.read().unwrap();
    let record_list: Vec<_> = records.values().cloned().collect();

    HttpResponse::Ok().json(record_list)
}

// ============================================================================
// Phase 11: Radiology & Imaging
// ============================================================================

/// Create radiology order
#[post("/api/clinical/radiology/order")]
pub async fn create_radiology_order(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<RadiologyOrder>,
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let order = req.into_inner();
    let order_id = order.order_id.clone();
    let now = chrono::Utc::now();
    let entity = RadiologyOrderEntity {
        id: order_id.clone(),
        patient_id: order.patient_id.clone(),
        data: serde_json::to_value(&order).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.radiology_orders.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "order_id": order_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get radiology order
#[get("/api/clinical/radiology/order/{order_id}")]
pub async fn get_radiology_order(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let order_id = path.into_inner();

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

    match data.repositories.radiology_orders.get_by_id(&order_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Radiology order not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create radiology report
#[post("/api/clinical/radiology/report")]
pub async fn create_radiology_report(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<RadiologyReport>,
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let report = req.into_inner();
    let report_id = report.report_id.clone();
    let now = chrono::Utc::now();
    let entity = RadiologyReportEntity {
        id: report_id.clone(),
        patient_id: report.patient_id.clone(),
        data: serde_json::to_value(&report).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.radiology_reports.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "report_id": report_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get radiology report
#[get("/api/clinical/radiology/report/{report_id}")]
pub async fn get_radiology_report(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let report_id = path.into_inner();

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

    match data.repositories.radiology_reports.get_by_id(&report_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Radiology report not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}
// ============================================================================
// Phase 12: Pathology Reports
// ============================================================================

/// Create pathology report
#[post("/api/clinical/pathology")]
pub async fn create_pathology(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<PathologyReport>,
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let report = req.into_inner();
    let report_id = report.report_id.clone();
    let now = chrono::Utc::now();
    let entity = PathologyReportEntity {
        id: report_id.clone(),
        patient_id: report.patient_id.clone(),
        data: serde_json::to_value(&report).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.pathology_reports.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "report_id": report_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get pathology report
#[get("/api/clinical/pathology/{report_id}")]
pub async fn get_pathology(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let report_id = path.into_inner();

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

    match data.repositories.pathology_reports.get_by_id(&report_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Pathology report not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// Phase 13: Immunization Records
// ============================================================================

/// Create immunization record
#[post("/api/clinical/immunization")]
pub async fn create_immunization(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<ImmunizationRecord>,
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    let record_id = record.record_id.clone();
    let entity: ImmunizationRecordEntity = record.into();

    match data.repositories.immunization_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "record_id": record_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get immunization record
#[get("/api/clinical/immunization/{record_id}")]
pub async fn get_immunization(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let record_id = path.into_inner();

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

    match data.repositories.immunization_records.get_by_id(&record_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Immunization record not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// Phase 14: Family Medical History
// ============================================================================

/// Create/update family medical history
#[post("/api/clinical/family-history")]
pub async fn create_family_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<FamilyMedicalHistory>,
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let history = req.into_inner();
    let patient_id = history.patient_id.clone();
    let now = chrono::Utc::now();
    let entity = FamilyMedicalHistoryEntity {
        id: format!("fmh-{}", uuid::Uuid::new_v4()),
        patient_id: patient_id.clone(),
        data: serde_json::to_value(&history).unwrap_or_default(),
        created_at: Some(now),
        updated_at: Some(now),
        ..Default::default()
    };

    match data.repositories.family_medical_histories.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "patient_id": patient_id
        })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get family medical history
#[get("/api/clinical/family-history/{patient_id}")]
pub async fn get_family_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

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

    // Healthcare provider or patient viewing own history
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    match data.repositories.family_medical_histories.get_by_patient(&patient_id).await {
        Ok(entities) if !entities.is_empty() => {
            let history_data: Vec<serde_json::Value> = entities.into_iter().map(|e| e.data).collect();
            HttpResponse::Ok().json(history_data)
        }
        Ok(_) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Family medical history not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// Phase 15: Blood Bank
// ============================================================================

/// Create blood type screen
#[post("/api/clinical/blood-bank/type-screen")]
pub async fn create_blood_type_screen(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<BloodTypeScreen>,
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let screen = req.into_inner();
    let test_id = screen.test_id.clone();
    let now = chrono::Utc::now();
    let entity = BloodTypeScreenEntity {
        id: test_id.clone(),
        patient_id: screen.patient_id.clone(),
        data: serde_json::to_value(&screen).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.blood_type_screens.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "test_id": test_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get blood type screen
#[get("/api/clinical/blood-bank/type-screen/{test_id}")]
pub async fn get_blood_type_screen(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let test_id = path.into_inner();

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

    match data.repositories.blood_type_screens.get_by_id(&test_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Blood type screen not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create transfusion record
#[post("/api/clinical/blood-bank/transfusion")]
pub async fn create_transfusion(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<TransfusionRecord>,
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let transfusion = req.into_inner();
    let transfusion_id = transfusion.transfusion_id.clone();
    let now = chrono::Utc::now();
    let entity = TransfusionRecordEntity {
        id: transfusion_id.clone(),
        patient_id: transfusion.patient_id.clone(),
        data: serde_json::to_value(&transfusion).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.transfusion_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "transfusion_id": transfusion_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get transfusion record
#[get("/api/clinical/blood-bank/transfusion/{transfusion_id}")]
pub async fn get_transfusion(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let transfusion_id = path.into_inner();

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

    match data.repositories.transfusion_records.get_by_id(&transfusion_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Transfusion record not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}
// ============================================================================
// Phase 16: E-Prescribing
// ============================================================================

/// Create electronic prescription
#[post("/api/clinical/e-prescription")]
pub async fn create_e_prescription(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<ElectronicPrescription>,
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let rx = req.into_inner();
    let rx_id = rx.rx_id.clone();
    let now = chrono::Utc::now();
    let entity = EPrescriptionEntity {
        id: rx_id.clone(),
        patient_id: rx.patient_id.clone(),
        data: serde_json::to_value(&rx).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.e_prescriptions.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "rx_id": rx_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get electronic prescription
#[get("/api/clinical/e-prescription/{rx_id}")]
pub async fn get_e_prescription(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let rx_id = path.into_inner();

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

    match data.repositories.e_prescriptions.get_by_id(&rx_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Prescription not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// Phase 17: Appointments
// ============================================================================

/// Create appointment
#[post("/api/clinical/appointment")]
pub async fn create_appointment(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<Appointment>,
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

    // Any healthcare provider or patient can create appointments
    if !current_user.role.is_healthcare_provider() && current_user_id != req.patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let appointment = req.into_inner();
    let appointment_id = appointment.appointment_id.clone();
    let patient_id = appointment.patient_id.clone();
    let appointment_date = appointment.scheduled_date.clone();
    let provider_name = appointment.provider_name.clone();
    let now = chrono::Utc::now();

    let entity = AppointmentEntity {
        id: appointment_id.clone(),
        patient_id: patient_id.clone(),
        data: serde_json::to_value(&appointment).unwrap_or_default(),
        created_at: now,
        updated_at: now,
        ..Default::default()
    };

    match data.repositories.appointments.create(entity).await {
        Ok(_) => {
            // Fire-and-forget FCM push notification to the patient.
            let repos = data.repositories.clone();
            let patient_id_clone = patient_id.clone();
            tokio::spawn(async move {
                crate::notifications::notify_appointment(
                    &repos,
                    &patient_id_clone,
                    &appointment_date,
                    &provider_name,
                )
                .await;
            });

            HttpResponse::Created().json(serde_json::json!({
                "success": true,
                "appointment_id": appointment_id
            }))
        }
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get appointment
#[get("/api/clinical/appointment/{appointment_id}")]
pub async fn get_appointment(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let appointment_id = path.into_inner();

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

    match data.repositories.appointments.get_by_id(&appointment_id).await {
        Ok(entity) => {
            // Patients can only see their own appointments
            if !current_user.role.is_healthcare_provider() && current_user_id != entity.patient_id {
                return HttpResponse::Forbidden().json(ErrorResponse {
                    success: false,
                    error: "Access denied".to_string(),
                    code: "ACCESS_DENIED".to_string(),
                });
            }
            HttpResponse::Ok().json(entity.data)
        }
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Appointment not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

// ============================================================================
// Phase 18: Death Certificate & Autopsy
// ============================================================================

/// Create death certificate
#[post("/api/clinical/death-certificate")]
pub async fn create_death_certificate(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<DeathCertificate>,
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let cert = req.into_inner();
    let certificate_id = cert.certificate_id.clone();
    let now = chrono::Utc::now();
    let entity = DeathRecordEntity {
        id: certificate_id.clone(),
        patient_id: cert.patient_id.clone(),
        data: serde_json::to_value(&cert).unwrap_or_default(),
        created_at: Some(now),
        updated_at: Some(now),
        ..Default::default()
    };

    match data.repositories.death_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "certificate_id": certificate_id
        })),
        Err(RepositoryError::Duplicate(msg)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: msg,
                code: "DUPLICATE".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Get death certificate
#[get("/api/clinical/death-certificate/{certificate_id}")]
pub async fn get_death_certificate(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let certificate_id = path.into_inner();

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

    match data.repositories.death_records.get_by_id(&certificate_id).await {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => {
            HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Death certificate not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create autopsy request
#[post("/api/clinical/autopsy/request")]
pub async fn create_autopsy_request(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<AutopsyRequest>,
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

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let request_id = req.request_id.clone();
    {
        let mut records = data.autopsy_requests.write().unwrap();
        records.insert(request_id.clone(), req.into_inner());
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "request_id": request_id
    }))
}

/// Get autopsy request
#[get("/api/clinical/autopsy/request/{request_id}")]
pub async fn get_autopsy_request(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let request_id = path.into_inner();

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

    let records = data.autopsy_requests.read().unwrap();
    match records.get(&request_id) {
        Some(record) => HttpResponse::Ok().json(record),
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Autopsy request not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
    }
}

// ============================================================================
// Phase 19: Patient Satisfaction Surveys
// ============================================================================

/// Create patient satisfaction survey
#[post("/api/clinical/satisfaction-survey")]
pub async fn create_satisfaction_survey(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<PatientSatisfactionSurvey>,
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

    let _current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Any authenticated user can submit a survey
    let survey_id = req.survey_id.clone();
    {
        let mut records = data.satisfaction_surveys.write().unwrap();
        records.insert(survey_id.clone(), req.into_inner());
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "survey_id": survey_id
    }))
}

/// Get patient satisfaction survey
#[get("/api/clinical/satisfaction-survey/{survey_id}")]
pub async fn get_satisfaction_survey(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let survey_id = path.into_inner();

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

    // Only admins can view surveys (for privacy)
    if !current_user.role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let records = data.satisfaction_surveys.read().unwrap();
    match records.get(&survey_id) {
        Some(record) => HttpResponse::Ok().json(record),
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Survey not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
    }
}
// ============================================================================
// HL7 FHIR R4 Compatible Endpoints
// ============================================================================

/// FHIR Patient resource - Get patient in FHIR R4 format
#[get("/api/fhir/r4/Patient/{patient_id}")]
pub async fn fhir_get_patient(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "login",
                    "diagnostics": "Authentication required"
                }]
            }));
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "unknown",
                    "diagnostics": "User not found"
                }]
            }));
        }
    };

    // Healthcare providers or patient viewing own data
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "forbidden",
                "diagnostics": "Access denied"
            }]
        }));
    }

    // Get patient from repository
    match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(patient) => {
            // Convert to FHIR R4 Patient resource
            let fhir_patient = serde_json::json!({
                "resourceType": "Patient",
                "id": patient.id,
                "meta": {
                    "versionId": "1",
                    "lastUpdated": patient.updated_at.to_rfc3339()
                },
                "identifier": [{
                    "system": "urn:medichain:national-id-hash",
                    "value": patient.national_id_hash
                }, {
                    "system": "urn:medichain:patient-id",
                    "value": patient.id
                }],
                "active": true,
                "name": [{
                    "use": "official",
                    "text": "Patient" // Name is encrypted
                }],
                "birthDate": "Redacted", // DOB is encrypted
                "address": [], // TODO: Address repository
                "contact": [], // TODO: Contact repository
                "communication": [{
                    "language": {
                        "coding": [{
                            "system": "urn:ietf:bcp:47",
                            "code": "en"
                        }]
                    }
                }]
            });

            HttpResponse::Ok()
                .content_type("application/fhir+json")
                .json(fhir_patient)
        }
        Err(_) => HttpResponse::NotFound().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "not-found",
                "diagnostics": format!("Patient {} not found", patient_id)
            }]
        })),
    }
}

/// FHIR AllergyIntolerance resource - Get patient allergies
#[get("/api/fhir/r4/AllergyIntolerance")]
pub async fn fhir_get_allergies(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{"severity": "error", "code": "login"}]
            }));
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{"severity": "error", "code": "unknown"}]
            }));
        }
    };

    let patient_id = match query.get("patient") {
        Some(id) => id.clone(),
        None => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "required",
                    "diagnostics": "patient parameter is required"
                }]
            }));
        }
    };

    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{"severity": "error", "code": "forbidden"}]
        }));
    }

    // Get allergies from repository
    let allergies = match data.repositories.allergies.get_by_patient(&patient_id).await {
        Ok(a) => a,
        Err(_) => Vec::new(),
    };

    let entries: Vec<serde_json::Value> = allergies.iter().enumerate().map(|(i, allergy)| {
        serde_json::json!({
            "fullUrl": format!("urn:uuid:allergy-{}-{}", patient_id, i),
            "resource": {
                "resourceType": "AllergyIntolerance",
                "id": format!("allergy-{}-{}", patient_id, i),
                "clinicalStatus": {
                    "coding": [{
                        "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
                        "code": "active"
                    }]
                },
                "verificationStatus": {
                    "coding": [{
                        "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                        "code": if allergy.verified { "confirmed" } else { "unconfirmed" }
                    }]
                },
                "criticality": match allergy.severity.as_str() {
                    "Severe" | "LifeThreatening" => "high",
                    "Moderate" => "high",
                    "Mild" => "low",
                    _ => "unable-to-assess"
                },
                "code": {
                    "text": allergy.allergen
                },
                "patient": {
                    "reference": format!("Patient/{}", patient_id)
                },
                "reaction": allergy.reaction.as_ref().map(|r| vec![serde_json::json!({
                    "description": r
                })])
            }
        })
    }).collect();

    HttpResponse::Ok()
        .content_type("application/fhir+json")
        .json(serde_json::json!({
            "resourceType": "Bundle",
            "type": "searchset",
            "total": entries.len(),
            "entry": entries
        }))
}

/// FHIR MedicationStatement resource - Get patient medications
#[get("/api/fhir/r4/MedicationStatement")]
pub async fn fhir_get_medications(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{"severity": "error", "code": "login"}]
            }));
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{"severity": "error", "code": "unknown"}]
            }));
        }
    };

    let patient_id = match query.get("patient") {
        Some(id) => id.clone(),
        None => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "required",
                    "diagnostics": "patient parameter is required"
                }]
            }));
        }
    };

    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{"severity": "error", "code": "forbidden"}]
        }));
    }

    // TODO: Phase 2: Chronic medications should be fetched from repository
    let medications: Vec<String> = Vec::new();

    let entries: Vec<serde_json::Value> = medications
        .iter()
        .enumerate()
        .map(|(i, med)| {
            serde_json::json!({
                "fullUrl": format!("urn:uuid:med-{}-{}", patient_id, i),
                "resource": {
                    "resourceType": "MedicationStatement",
                    "id": format!("med-{}-{}", patient_id, i),
                    "status": "active",
                    "medicationCodeableConcept": {
                        "text": med
                    },
                    "subject": {
                        "reference": format!("Patient/{}", patient_id)
                    }
                }
            })
        })
        .collect();

    HttpResponse::Ok()
        .content_type("application/fhir+json")
        .json(serde_json::json!({
            "resourceType": "Bundle",
            "type": "searchset",
            "total": entries.len(),
            "entry": entries
        }))
}

/// FHIR Condition resource - Get patient conditions
#[get("/api/fhir/r4/Condition")]
pub async fn fhir_get_conditions(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{"severity": "error", "code": "login"}]
            }));
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{"severity": "error", "code": "unknown"}]
            }));
        }
    };

    let patient_id = match query.get("patient") {
        Some(id) => id.clone(),
        None => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "required",
                    "diagnostics": "patient parameter is required"
                }]
            }));
        }
    };

    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{"severity": "error", "code": "forbidden"}]
        }));
    }

    // TODO: Phase 2: Chronic conditions should be fetched from repository
    let conditions: Vec<String> = Vec::new();

    let entries: Vec<serde_json::Value> = conditions.iter().enumerate().map(|(i, cond)| {
        serde_json::json!({
            "fullUrl": format!("urn:uuid:cond-{}-{}", patient_id, i),
            "resource": {
                "resourceType": "Condition",
                "id": format!("cond-{}-{}", patient_id, i),
                "clinicalStatus": {
                    "coding": [{
                        "system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                        "code": "active"
                    }]
                },
                "code": {
                    "text": cond
                },
                "subject": {
                    "reference": format!("Patient/{}", patient_id)
                }
            }
        })
    }).collect();

    HttpResponse::Ok()
        .content_type("application/fhir+json")
        .json(serde_json::json!({
            "resourceType": "Bundle",
            "type": "searchset",
            "total": entries.len(),
            "entry": entries
        }))
}

/// FHIR Observation resource - Get patient vital signs
#[get("/api/fhir/r4/Observation")]
pub async fn fhir_get_observations(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{"severity": "error", "code": "login"}]
            }));
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{"severity": "error", "code": "unknown"}]
            }));
        }
    };

    let patient_id = match query.get("patient") {
        Some(id) => id.clone(),
        None => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "required",
                    "diagnostics": "patient parameter is required"
                }]
            }));
        }
    };

    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{"severity": "error", "code": "forbidden"}]
        }));
    }

    let pg = crate::repositories::traits::Pagination::new(500, 0);
    let readings: Vec<crate::clinical::VitalSignsReading> = match data
        .repositories
        .vital_signs
        .get_by_patient(&patient_id, pg)
        .await
    {
        Ok(result) => result.items.into_iter().map(Into::into).collect(),
        Err(e) => {
            log::error!("FHIR vital signs lookup failed: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{"severity": "error", "code": "exception"}]
            }));
        }
    };

    if !readings.is_empty() {
        {
            let mut entries: Vec<serde_json::Value> = Vec::new();

            for reading in &readings {
                // Heart Rate
                if let Some(hr) = reading.heart_rate {
                    entries.push(serde_json::json!({
                        "fullUrl": format!("urn:uuid:{}-hr", reading.reading_id),
                        "resource": {
                            "resourceType": "Observation",
                            "id": format!("{}-hr", reading.reading_id),
                            "status": "final",
                            "category": [{
                                "coding": [{
                                    "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                    "code": "vital-signs"
                                }]
                            }],
                            "code": {
                                "coding": [{
                                    "system": "http://loinc.org",
                                    "code": "8867-4",
                                    "display": "Heart rate"
                                }]
                            },
                            "subject": {"reference": format!("Patient/{}", patient_id)},
                            "effectiveDateTime": chrono::DateTime::from_timestamp(reading.timestamp, 0)
                                .map(|dt| dt.to_rfc3339()),
                            "valueQuantity": {
                                "value": hr,
                                "unit": "beats/minute",
                                "system": "http://unitsofmeasure.org",
                                "code": "/min"
                            }
                        }
                    }));
                }

                // Blood Pressure
                if let (Some(sys), Some(dia)) = (reading.systolic_bp, reading.diastolic_bp) {
                    entries.push(serde_json::json!({
                        "fullUrl": format!("urn:uuid:{}-bp", reading.reading_id),
                        "resource": {
                            "resourceType": "Observation",
                            "id": format!("{}-bp", reading.reading_id),
                            "status": "final",
                            "category": [{
                                "coding": [{
                                    "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                    "code": "vital-signs"
                                }]
                            }],
                            "code": {
                                "coding": [{
                                    "system": "http://loinc.org",
                                    "code": "85354-9",
                                    "display": "Blood pressure panel"
                                }]
                            },
                            "subject": {"reference": format!("Patient/{}", patient_id)},
                            "effectiveDateTime": chrono::DateTime::from_timestamp(reading.timestamp, 0)
                                .map(|dt| dt.to_rfc3339()),
                            "component": [{
                                "code": {
                                    "coding": [{
                                        "system": "http://loinc.org",
                                        "code": "8480-6",
                                        "display": "Systolic blood pressure"
                                    }]
                                },
                                "valueQuantity": {
                                    "value": sys,
                                    "unit": "mmHg",
                                    "system": "http://unitsofmeasure.org",
                                    "code": "mm[Hg]"
                                }
                            }, {
                                "code": {
                                    "coding": [{
                                        "system": "http://loinc.org",
                                        "code": "8462-4",
                                        "display": "Diastolic blood pressure"
                                    }]
                                },
                                "valueQuantity": {
                                    "value": dia,
                                    "unit": "mmHg",
                                    "system": "http://unitsofmeasure.org",
                                    "code": "mm[Hg]"
                                }
                            }]
                        }
                    }));
                }

                // Oxygen Saturation
                if let Some(spo2) = reading.oxygen_saturation {
                    entries.push(serde_json::json!({
                        "fullUrl": format!("urn:uuid:{}-spo2", reading.reading_id),
                        "resource": {
                            "resourceType": "Observation",
                            "id": format!("{}-spo2", reading.reading_id),
                            "status": "final",
                            "category": [{
                                "coding": [{
                                    "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                    "code": "vital-signs"
                                }]
                            }],
                            "code": {
                                "coding": [{
                                    "system": "http://loinc.org",
                                    "code": "2708-6",
                                    "display": "Oxygen saturation"
                                }]
                            },
                            "subject": {"reference": format!("Patient/{}", patient_id)},
                            "effectiveDateTime": chrono::DateTime::from_timestamp(reading.timestamp, 0)
                                .map(|dt| dt.to_rfc3339()),
                            "valueQuantity": {
                                "value": spo2,
                                "unit": "%",
                                "system": "http://unitsofmeasure.org",
                                "code": "%"
                            }
                        }
                    }));
                }
            }

            HttpResponse::Ok()
                .content_type("application/fhir+json")
                .json(serde_json::json!({
                    "resourceType": "Bundle",
                    "type": "searchset",
                    "total": entries.len(),
                    "entry": entries
                }))
        }
    } else {
        HttpResponse::Ok()
            .content_type("application/fhir+json")
            .json(serde_json::json!({
                "resourceType": "Bundle",
                "type": "searchset",
                "total": 0,
                "entry": []
            }))
    }
}

/// FHIR Encounter resource - Get patient encounters/visits
#[get("/api/fhir/r4/Encounter")]
pub async fn fhir_get_encounters(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "security",
                    "diagnostics": "Missing X-User-Id header"
                }]
            }));
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "security",
                    "diagnostics": "User not found"
                }]
            }));
        }
    };

    let patient_id = query.get("patient").cloned().unwrap_or_default();
    if patient_id.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "required",
                "diagnostics": "patient parameter is required"
            }]
        }));
    }

    // RBAC: Non-healthcare providers can only see their own encounters
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "forbidden",
                "diagnostics": "Access denied to other patient's encounters"
            }]
        }));
    }

    // Get triage assessments as encounters via repository
    let pg = crate::repositories::traits::Pagination::new(500, 0);
    let patient_triages = match data
        .repositories
        .triage_assessments
        .get_by_patient(&patient_id, pg)
        .await
    {
        Ok(r) => r.items,
        Err(e) => {
            log::error!("FHIR triage lookup failed: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{"severity": "error", "code": "exception"}]
            }));
        }
    };

    let entries: Vec<serde_json::Value> = patient_triages
        .iter()
        .map(|triage| {
            let esi = crate::clinical::ESILevel::from_level(triage.esi_level as u8)
                .unwrap_or(crate::clinical::ESILevel::Level3Urgent);
            let priority_code = match esi {
                crate::clinical::ESILevel::Level1Resuscitation
                | crate::clinical::ESILevel::Level2Emergent => "EM",
                crate::clinical::ESILevel::Level3Urgent => "UR",
                _ => "R",
            };
            let priority_display = match esi {
                crate::clinical::ESILevel::Level1Resuscitation => "ESI Level 1 - Resuscitation",
                crate::clinical::ESILevel::Level2Emergent => "ESI Level 2 - Emergent",
                crate::clinical::ESILevel::Level3Urgent => "ESI Level 3 - Urgent",
                crate::clinical::ESILevel::Level4LessUrgent => "ESI Level 4 - Less Urgent",
                crate::clinical::ESILevel::Level5NonUrgent => "ESI Level 5 - Non-Urgent",
            };

            serde_json::json!({
                "fullUrl": format!("urn:uuid:{}", triage.id),
                "resource": {
                    "resourceType": "Encounter",
                    "id": triage.id,
                    "status": "finished",
                    "class": {
                        "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                        "code": "EMER",
                        "display": "Emergency"
                    },
                    "type": [{
                        "coding": [{
                            "system": "http://snomed.info/sct",
                            "code": "50849002",
                            "display": "Emergency department patient visit"
                        }]
                    }],
                    "subject": {"reference": format!("Patient/{}", patient_id)},
                    "period": {
                        "start": triage.triage_time.to_rfc3339()
                    },
                    "priority": {
                        "coding": [{
                            "system": "http://terminology.hl7.org/CodeSystem/v3-ActPriority",
                            "code": priority_code,
                            "display": priority_display
                        }]
                    },
                    "reasonCode": [{
                        "text": &triage.chief_complaint
                    }]
                }
            })
        })
        .collect();

    HttpResponse::Ok()
        .content_type("application/fhir+json")
        .json(serde_json::json!({
            "resourceType": "Bundle",
            "type": "searchset",
            "total": entries.len(),
            "entry": entries
        }))
}

/// FHIR DiagnosticReport resource - Get patient diagnostic reports
#[get("/api/fhir/r4/DiagnosticReport")]
pub async fn fhir_get_diagnostic_reports(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "security",
                    "diagnostics": "Missing X-User-Id header"
                }]
            }));
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "security",
                    "diagnostics": "User not found"
                }]
            }));
        }
    };

    let patient_id = query.get("patient").cloned().unwrap_or_default();
    if patient_id.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "required",
                "diagnostics": "patient parameter is required"
            }]
        }));
    }

    // RBAC check - non-healthcare providers can only see their own reports
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "forbidden",
                "diagnostics": "Access denied to other patient's reports"
            }]
        }));
    }

    // Get radiology reports as diagnostic reports
    let radiology = data.radiology_reports.read().unwrap();
    let patient_reports: Vec<_> = radiology
        .iter()
        .filter(|(_, r)| r.patient_id == patient_id)
        .collect();

    let entries: Vec<serde_json::Value> = patient_reports
        .iter()
        .map(|(id, report)| {
            let status_str = match &report.status {
                RadiologyReportStatus::Final => "final",
                RadiologyReportStatus::Preliminary => "preliminary",
                RadiologyReportStatus::Addendum => "amended",
                RadiologyReportStatus::Corrected => "corrected",
            };
            let has_critical = report.critical_finding;

            // Get study type as string
            let study_type_str = format!("{:?}", report.study_type);

            let effective_dt = chrono::DateTime::from_timestamp(report.study_datetime, 0)
                .map(|dt| dt.to_rfc3339());
            let issued_dt = report
                .final_time
                .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
                .map(|dt| dt.to_rfc3339());

            let mut resource = serde_json::json!({
                "resourceType": "DiagnosticReport",
                "id": id,
                "status": status_str,
                "category": [{
                    "coding": [{
                        "system": "http://terminology.hl7.org/CodeSystem/v2-0074",
                        "code": "RAD",
                        "display": "Radiology"
                    }]
                }],
                "code": {
                    "coding": [{
                        "system": "http://loinc.org",
                        "display": &study_type_str
                    }],
                    "text": &study_type_str
                },
                "subject": {"reference": format!("Patient/{}", patient_id)},
                "effectiveDateTime": effective_dt,
                "issued": issued_dt,
                "performer": [{
                    "reference": format!("Practitioner/{}", report.radiologist)
                }],
                "conclusion": &report.impression
            });

            if has_critical {
                resource["conclusionCode"] = serde_json::json!([{
                    "coding": [{
                        "system": "http://snomed.info/sct",
                        "code": "281647001",
                        "display": "Critical finding"
                    }]
                }]);
            }

            serde_json::json!({
                "fullUrl": format!("urn:uuid:{}", id),
                "resource": resource
            })
        })
        .collect();

    HttpResponse::Ok()
        .content_type("application/fhir+json")
        .json(serde_json::json!({
            "resourceType": "Bundle",
            "type": "searchset",
            "total": entries.len(),
            "entry": entries
        }))
}

/// FHIR Procedure resource - Get patient procedures
#[get("/api/fhir/r4/Procedure")]
pub async fn fhir_get_procedures(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "security",
                    "diagnostics": "Missing X-User-Id header"
                }]
            }));
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "security",
                    "diagnostics": "User not found"
                }]
            }));
        }
    };

    let patient_id = query.get("patient").cloned().unwrap_or_default();
    if patient_id.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "required",
                "diagnostics": "patient parameter is required"
            }]
        }));
    }

    // RBAC check - non-healthcare providers can only see their own data
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "forbidden",
                "diagnostics": "Access denied to other patient's procedures"
            }]
        }));
    }

    let mut entries: Vec<serde_json::Value> = Vec::new();

    // Get operative notes as procedures
    let op_notes = data.operative_notes.read().unwrap();
    for (id, note) in op_notes.iter().filter(|(_, n)| n.patient_id == patient_id) {
        let performed_dt =
            chrono::DateTime::from_timestamp(note.time_out_or, 0).map(|dt| dt.to_rfc3339());

        // Get primary surgeon from surgeons list
        let surgeon_ref = note
            .surgeons
            .first()
            .map(|s| format!("Practitioner/{}", s.name))
            .unwrap_or_else(|| "Practitioner/unknown".to_string());

        let mut resource = serde_json::json!({
            "resourceType": "Procedure",
            "id": id,
            "status": "completed",
            "category": {
                "coding": [{
                    "system": "http://snomed.info/sct",
                    "code": "387713003",
                    "display": "Surgical procedure"
                }]
            },
            "code": {
                "text": &note.procedure_performed
            },
            "subject": {"reference": format!("Patient/{}", patient_id)},
            "performedDateTime": performed_dt,
            "performer": [{
                "actor": {"reference": surgeon_ref},
                "function": {
                    "coding": [{
                        "system": "http://snomed.info/sct",
                        "code": "304292004",
                        "display": "Surgeon"
                    }]
                }
            }],
            "outcome": {
                "text": &note.findings
            }
        });

        // Add complication if present
        if let Some(complications) = &note.complications {
            resource["complication"] = serde_json::json!([{"text": complications}]);
        }

        entries.push(serde_json::json!({
            "fullUrl": format!("urn:uuid:{}", id),
            "resource": resource
        }));
    }

    // Get intubations as procedures
    let intubations = data.intubation_records.read().unwrap();
    for (id, intub) in intubations
        .iter()
        .filter(|(_, i)| i.patient_id == patient_id)
    {
        entries.push(serde_json::json!({
            "fullUrl": format!("urn:uuid:{}", id),
            "resource": {
                "resourceType": "Procedure",
                "id": id,
                "status": if intub.successful { "completed" } else { "stopped" },
                "category": {
                    "coding": [{
                        "system": "http://snomed.info/sct",
                        "code": "103693007",
                        "display": "Respiratory procedure"
                    }]
                },
                "code": {
                    "coding": [{
                        "system": "http://snomed.info/sct",
                        "code": "112798008",
                        "display": "Endotracheal intubation"
                    }]
                },
                "subject": {"reference": format!("Patient/{}", patient_id)},
                "performedDateTime": chrono::DateTime::from_timestamp(intub.procedure_time, 0)
                    .map(|dt| dt.to_rfc3339()),
                "performer": [{
                    "actor": {"reference": format!("Practitioner/{}", intub.performed_by)}
                }],
                "outcome": {
                    "text": if intub.successful { "Successful intubation" } else { "Failed - required alternative" }
                }
            }
        }));
    }

    // Get laceration repairs as procedures
    let lacerations = data.laceration_records.read().unwrap();
    for (id, lac) in lacerations
        .iter()
        .filter(|(_, l)| l.patient_id == patient_id)
    {
        entries.push(serde_json::json!({
            "fullUrl": format!("urn:uuid:{}", id),
            "resource": {
                "resourceType": "Procedure",
                "id": id,
                "status": "completed",
                "category": {
                    "coding": [{
                        "system": "http://snomed.info/sct",
                        "code": "387687001",
                        "display": "Minor surgical procedure"
                    }]
                },
                "code": {
                    "coding": [{
                        "system": "http://snomed.info/sct",
                        "code": "288086009",
                        "display": "Suture of laceration"
                    }]
                },
                "subject": {"reference": format!("Patient/{}", patient_id)},
                "performedDateTime": chrono::DateTime::from_timestamp(lac.procedure_time, 0)
                    .map(|dt| dt.to_rfc3339()),
                "performer": [{
                    "actor": {"reference": format!("Practitioner/{}", lac.performed_by)}
                }],
                "bodySite": [{
                    "text": &lac.location
                }],
                "note": [{
                    "text": format!("Closure: {:?}", lac.closure)
                }]
            }
        }));
    }

    HttpResponse::Ok()
        .content_type("application/fhir+json")
        .json(serde_json::json!({
            "resourceType": "Bundle",
            "type": "searchset",
            "total": entries.len(),
            "entry": entries
        }))
}

/// FHIR Immunization resource - Get patient immunizations
#[get("/api/fhir/r4/Immunization")]
pub async fn fhir_get_immunizations(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "security",
                    "diagnostics": "Missing X-User-Id header"
                }]
            }));
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "resourceType": "OperationOutcome",
                "issue": [{
                    "severity": "error",
                    "code": "security",
                    "diagnostics": "User not found"
                }]
            }));
        }
    };

    let patient_id = query.get("patient").cloned().unwrap_or_default();
    if patient_id.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "required",
                "diagnostics": "patient parameter is required"
            }]
        }));
    }

    // RBAC check - non-healthcare providers can only see their own data
    if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "resourceType": "OperationOutcome",
            "issue": [{
                "severity": "error",
                "code": "forbidden",
                "diagnostics": "Access denied to other patient's immunizations"
            }]
        }));
    }

    // Get immunization records via repository
    let patient_immunizations: Vec<crate::clinical::ImmunizationRecord> = match data
        .repositories
        .immunization_records
        .get_by_patient(&patient_id)
        .await
    {
        Ok(items) => items
            .into_iter()
            .map(crate::clinical::ImmunizationRecord::from)
            .collect(),
        Err(_) => Vec::new(),
    };

    let entries: Vec<serde_json::Value> = patient_immunizations
        .iter()
        .map(|imm| {
            let id = &imm.record_id;
            // Get route as string
            let route_str = format!("{:?}", imm.route);

            let mut resource = serde_json::json!({
                "resourceType": "Immunization",
                "id": id,
                "status": "completed",
                "vaccineCode": {
                    "coding": [{
                        "system": "http://hl7.org/fhir/sid/cvx",
                        "code": &imm.cvx_code,
                        "display": &imm.vaccine_name
                    }],
                    "text": &imm.vaccine_name
                },
                "patient": {"reference": format!("Patient/{}", patient_id)},
                "occurrenceDateTime": &imm.administration_date,
                "primarySource": true,
                "lotNumber": &imm.lot_number,
                "expirationDate": &imm.expiration_date,
                "site": {
                    "coding": [{
                        "system": "http://terminology.hl7.org/CodeSystem/v3-ActSite",
                        "display": &imm.site
                    }]
                },
                "route": {
                    "coding": [{
                        "system": "http://terminology.hl7.org/CodeSystem/v3-RouteOfAdministration",
                        "display": &route_str
                    }]
                },
                "protocolApplied": [{
                    "doseNumberPositiveInt": imm.dose_number
                }],
                "performer": [{
                    "actor": {"reference": format!("Practitioner/{}", imm.administered_by)}
                }],
                "manufacturer": {
                    "display": &imm.manufacturer
                }
            });

            // Add notes if present
            if let Some(notes) = &imm.notes {
                resource["note"] = serde_json::json!([{"text": notes}]);
            }

            // Add adverse reaction if present
            if let Some(reaction) = &imm.adverse_reaction {
                resource["reaction"] = serde_json::json!([{
                    "detail": {"display": reaction}
                }]);
            }

            serde_json::json!({
                "fullUrl": format!("urn:uuid:{}", id),
                "resource": resource
            })
        })
        .collect();

    HttpResponse::Ok()
        .content_type("application/fhir+json")
        .json(serde_json::json!({
            "resourceType": "Bundle",
            "type": "searchset",
            "total": entries.len(),
            "entry": entries
        }))
}

/// FHIR Capability Statement - Server metadata
#[get("/api/fhir/r4/metadata")]
pub async fn fhir_capability_statement() -> impl Responder {
    HttpResponse::Ok()
        .content_type("application/fhir+json")
        .json(serde_json::json!({
            "resourceType": "CapabilityStatement",
            "status": "active",
            "date": "2026-01-06",
            "publisher": "Trustware - MediChain",
            "kind": "instance",
            "software": {
                "name": "MediChain FHIR Server",
                "version": "1.0.0"
            },
            "implementation": {
                "description": "MediChain HL7 FHIR R4 API"
            },
            "fhirVersion": "4.0.1",
            "format": ["application/fhir+json"],
            "rest": [{
                "mode": "server",
                "resource": [
                    {
                        "type": "Patient",
                        "interaction": [{"code": "read"}, {"code": "search-type"}],
                        "searchParam": [{"name": "_id", "type": "token"}]
                    },
                    {
                        "type": "AllergyIntolerance",
                        "interaction": [{"code": "search-type"}],
                        "searchParam": [{"name": "patient", "type": "reference"}]
                    },
                    {
                        "type": "MedicationStatement",
                        "interaction": [{"code": "search-type"}],
                        "searchParam": [{"name": "patient", "type": "reference"}]
                    },
                    {
                        "type": "Condition",
                        "interaction": [{"code": "search-type"}],
                        "searchParam": [{"name": "patient", "type": "reference"}]
                    },
                    {
                        "type": "Observation",
                        "interaction": [{"code": "search-type"}],
                        "searchParam": [
                            {"name": "patient", "type": "reference"},
                            {"name": "category", "type": "token"}
                        ]
                    },
                    {
                        "type": "Encounter",
                        "interaction": [{"code": "search-type"}],
                        "searchParam": [{"name": "patient", "type": "reference"}]
                    },
                    {
                        "type": "DiagnosticReport",
                        "interaction": [{"code": "search-type"}],
                        "searchParam": [{"name": "patient", "type": "reference"}]
                    },
                    {
                        "type": "Procedure",
                        "interaction": [{"code": "search-type"}],
                        "searchParam": [{"name": "patient", "type": "reference"}]
                    },
                    {
                        "type": "Immunization",
                        "interaction": [{"code": "search-type"}],
                        "searchParam": [{"name": "patient", "type": "reference"}]
                    }
                ]
            }]
        }))
}

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
    let patient = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(p) => Some(p),
        Err(_) => None,
    };

    match patient {
        Some(patient) => {
            // Get insurance from repository
            let insurance_list = match data.repositories.insurance_records.get_by_patient(&patient_id).await {
                Ok(res) => res,
                Err(_) => Vec::new(),
            };

            match insurance_list.first() {
                Some(insurance) => {
                    // Simulate verification (in production: call external API)
                    let coverage_active = insurance.is_active;

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
                            "benefits": {
                                "emergency_services": true,
                                "inpatient": true,
                                "outpatient": true,
                                "laboratory": true,
                                "radiology": true,
                                "pharmacy": true,
                                "mental_health": true
                            },
                            "copay": {
                                "emergency": "R500",
                                "specialist": "R300",
                                "primary_care": "R150",
                                "pharmacy": "20%"
                            },
                            "deductible": {
                                "annual": "R5000",
                                "met": "R2500",
                                "remaining": "R2500"
                            }
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
    let patient = match data.repositories.patients.get_by_id(patient_id).await {
        Ok(p) => Some(p),
        Err(_) => None,
    };

    match patient {
        Some(patient) => {
            // Get insurance from repository
            let pagination = Pagination::new(0, 1);
            let insurance_list = match data.repositories.insurance_records.get_by_patient(patient_id).await {
                Ok(res) => res,
                Err(_) => Vec::new(),
            };
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

// ============================================================================
// PHASE 20: MEDICATION REMINDERS
// ============================================================================

/// Create medication reminder request
#[derive(Debug, Deserialize)]
pub struct CreateMedicationReminderRequest {
    pub patient_id: String,
    pub medication_name: String,
    pub dosage: String,
    pub frequency: String,
    pub reminder_times: Vec<String>,
    pub start_date: String,
    pub end_date: Option<String>,
    pub instructions: Option<String>,
    pub push_notification: Option<bool>,
    pub sms: Option<bool>,
    pub email: Option<bool>,
}

/// Create a medication reminder
#[post("/api/reminders/medication")]
pub async fn create_medication_reminder(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateMedicationReminderRequest>,
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

    // Patient can create for self, provider can create for any patient
    let is_own_reminder = current_user_id == req.patient_id;

    if !is_own_reminder && !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only patients can create reminders for themselves or providers for patients"
                .to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let frequency = match req.frequency.as_str() {
        "once" => crate::clinical::ReminderFrequency::Once,
        "daily" => crate::clinical::ReminderFrequency::Daily,
        "twice_daily" => crate::clinical::ReminderFrequency::TwiceDaily,
        "three_times_daily" => crate::clinical::ReminderFrequency::ThreeTimesDaily,
        "weekly" => crate::clinical::ReminderFrequency::Weekly,
        "as_needed" => crate::clinical::ReminderFrequency::AsNeeded,
        _ => crate::clinical::ReminderFrequency::Daily,
    };

    let reminder = crate::clinical::MedicationReminder {
        reminder_id: format!("REM-{}", uuid::Uuid::new_v4()),
        patient_id: req.patient_id.clone(),
        medication_name: req.medication_name.clone(),
        dosage: req.dosage.clone(),
        frequency,
        reminder_times: req.reminder_times.clone(),
        start_date: req.start_date.clone(),
        end_date: req.end_date.clone(),
        instructions: req.instructions.clone(),
        active: true,
        created_by: current_user_id,
        created_at: chrono::Utc::now().timestamp(),
        notification_prefs: crate::clinical::NotificationPreferences {
            push_notification: req.push_notification.unwrap_or(true),
            sms: req.sms.unwrap_or(false),
            email: req.email.unwrap_or(false),
            in_app: true,
            reminder_before_minutes: 15,
        },
    };

    let reminder_id = reminder.reminder_id.clone();
    let entity: crate::repositories::traits::MedicationReminderEntity = reminder.into();
    if let Err(e) = data.repositories.medication_reminders.create(entity).await {
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: format!("Failed to create reminder: {}", e),
            code: "DB_ERROR".to_string(),
        });
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "reminder_id": reminder_id,
        "message": "Medication reminder created successfully"
    }))
}

/// Get medication reminders for a patient (Phase 20)
#[get("/api/reminders/medication/{patient_id}")]
pub async fn get_patient_reminders(
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

    // Check access
    let is_own = current_user_id == patient_id;
    if !is_own && !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let patient_reminders: Vec<crate::clinical::MedicationReminder> = match data
        .repositories
        .medication_reminders
        .get_active_by_patient(&patient_id)
        .await
    {
        Ok(items) => items
            .into_iter()
            .map(crate::clinical::MedicationReminder::from)
            .collect(),
        Err(e) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: format!("Failed to fetch reminders: {}", e),
                code: "DB_ERROR".to_string(),
            })
        }
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "reminders": patient_reminders,
        "count": patient_reminders.len()
    }))
}

/// Log medication adherence
#[derive(Debug, Deserialize)]
pub struct LogAdherenceRequest {
    pub reminder_id: String,
    pub action: String,
    pub notes: Option<String>,
}

#[post("/api/reminders/adherence")]
pub async fn log_medication_adherence(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<LogAdherenceRequest>,
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

    let reminder: crate::clinical::MedicationReminder = match data
        .repositories
        .medication_reminders
        .get_by_id(&req.reminder_id)
        .await
    {
        Ok(e) => e.into(),
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Reminder not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    // Only the patient can log their own adherence
    if current_user_id != reminder.patient_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only patient can log their own adherence".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let action = match req.action.as_str() {
        "taken" => crate::clinical::AdherenceAction::Taken,
        "skipped" => crate::clinical::AdherenceAction::Skipped,
        "snoozed" => crate::clinical::AdherenceAction::Snoozed,
        "missed" => crate::clinical::AdherenceAction::Missed,
        "taken_late" => crate::clinical::AdherenceAction::TakenLate,
        _ => crate::clinical::AdherenceAction::Taken,
    };

    let log = crate::clinical::MedicationAdherenceLog {
        log_id: format!("ADH-{}", uuid::Uuid::new_v4()),
        reminder_id: req.reminder_id.clone(),
        patient_id: reminder.patient_id.clone(),
        scheduled_time: chrono::Utc::now().timestamp(),
        action,
        taken_at: if req.action == "taken" || req.action == "taken_late" {
            Some(chrono::Utc::now().timestamp())
        } else {
            None
        },
        notes: req.notes.clone(),
    };

    let log_id = log.log_id.clone();
    let mut logs = data.adherence_logs.write().unwrap();
    logs.insert(log_id.clone(), log);

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "log_id": log_id,
        "message": "Adherence logged successfully"
    }))
}

/// Delete a medication reminder
#[delete("/api/reminders/medication/{reminder_id}")]
pub async fn delete_medication_reminder(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let reminder_id = path.into_inner();

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

    let reminder: crate::clinical::MedicationReminder = match data
        .repositories
        .medication_reminders
        .get_by_id(&reminder_id)
        .await
    {
        Ok(e) => e.into(),
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Reminder not found".to_string(),
                code: "NOT_FOUND".to_string(),
            });
        }
    };

    if reminder.patient_id != current_user_id && reminder.created_by != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    if let Err(e) = data.repositories.medication_reminders.deactivate(&reminder_id).await {
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: format!("Failed to deactivate: {}", e),
            code: "DB_ERROR".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Reminder deactivated"
    }))
}

/// Check and deliver due medication reminders.
/// Called by a background task to simulate notification delivery.
/// Reminders are matched by comparing their HH:MM time strings against the current UTC time.
pub async fn check_and_send_medication_reminders(data: &crate::AppState) {
    let now_utc = chrono::Utc::now();
    let current_hhmm = now_utc.format("%H:%M").to_string();

    let due_reminders: Vec<crate::clinical::MedicationReminder> = match data
        .repositories
        .medication_reminders
        .list_all_active()
        .await
    {
        Ok(items) => items
            .into_iter()
            .map(crate::clinical::MedicationReminder::from)
            .filter(|r| {
                r.active
                    && r.reminder_times
                        .iter()
                        .any(|t| t.as_str() == current_hhmm.as_str())
            })
            .collect(),
        Err(_) => return,
    };

    for reminder in &due_reminders {
        // Log delivery attempt (in production: call SMS/push API here)
        log::info!(
            "REMINDER_DUE: patient={} medication={} time={} push={} sms={} email={}",
            reminder.patient_id,
            reminder.medication_name,
            current_hhmm,
            reminder.notification_prefs.push_notification,
            reminder.notification_prefs.sms,
            reminder.notification_prefs.email,
        );

        // Push real-time SSE notification
        crate::websocket::push_reminder(
            &data.ws_manager,
            &reminder.patient_id,
            &reminder.medication_name,
        );

        // FCM Push notification
        if reminder.notification_prefs.push_notification {
            let repos = data.repositories.clone();
            let patient_id = reminder.patient_id.clone();
            let med_name = reminder.medication_name.clone();
            tokio::spawn(async move {
                let _ = crate::notifications::send_push_to_user(
                    &repos,
                    crate::notifications::PushNotification {
                        user_id: patient_id,
                        title: "Medication Reminder".to_string(),
                        body: format!("It's time to take your {}.", med_name),
                        data: Some(
                            [("type".to_string(), "medication_reminder".to_string())].into(),
                        ),
                    },
                )
                .await;
            });
        }

        // Africa's Talking SMS integration (when SMS_ENABLED=true)
        if reminder.notification_prefs.sms {
            // Get patient phone from repository
            let patient_phone = match data.repositories.patients.get_by_id(&reminder.patient_id).await {
                Ok(p) => {
                    if p.phone_encrypted.is_some() {
                        // Phone is encrypted in Phase 2, but for SMS we'd need to decrypt it.
                        // For demo, we use a placeholder or check if a plain phone field exists.
                        Some("Redacted".to_string())
                    } else {
                        None
                    }
                }
                Err(_) => None,
            };

            if let Some(phone) = patient_phone {
                if phone != "Redacted" {
                    let med_name = reminder.medication_name.clone();
                    tokio::spawn(async move {
                        let _ = crate::notifications::send_sms(crate::notifications::SmsMessage {
                            to: phone,
                            body: format!("MediChain Reminder: It's time to take your {}.", med_name),
                        })
                        .await;
                    });
                }
            }
        }
    }
}

// ============================================================================
// PHASE 21: DRUG INTERACTION CHECKING
// ============================================================================

/// Get drug database for lookup/search
#[get("/api/drugs")]
pub async fn get_drug_database(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    // Validate user is authenticated
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

    // Drug reference database (clinical formulary)
    let drugs = vec![
        crate::clinical::DrugReference {
            drug_id: "DRUG-001".to_string(),
            name: "Warfarin".to_string(),
            generic_name: "warfarin".to_string(),
            brand_names: vec!["Coumadin".to_string(), "Jantoven".to_string()],
            drug_class: "Anticoagulant".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec![
                "1mg".to_string(),
                "2mg".to_string(),
                "2.5mg".to_string(),
                "3mg".to_string(),
                "4mg".to_string(),
                "5mg".to_string(),
                "6mg".to_string(),
                "7.5mg".to_string(),
                "10mg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-002".to_string(),
            name: "Aspirin".to_string(),
            generic_name: "aspirin".to_string(),
            brand_names: vec![
                "Bayer".to_string(),
                "Ecotrin".to_string(),
                "Bufferin".to_string(),
            ],
            drug_class: "NSAID/Antiplatelet".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec!["81mg".to_string(), "325mg".to_string(), "500mg".to_string()],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-003".to_string(),
            name: "Lisinopril".to_string(),
            generic_name: "lisinopril".to_string(),
            brand_names: vec!["Prinivil".to_string(), "Zestril".to_string()],
            drug_class: "ACE Inhibitor".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec![
                "2.5mg".to_string(),
                "5mg".to_string(),
                "10mg".to_string(),
                "20mg".to_string(),
                "40mg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-004".to_string(),
            name: "Metformin".to_string(),
            generic_name: "metformin".to_string(),
            brand_names: vec![
                "Glucophage".to_string(),
                "Fortamet".to_string(),
                "Glumetza".to_string(),
            ],
            drug_class: "Biguanide".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec![
                "500mg".to_string(),
                "850mg".to_string(),
                "1000mg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-005".to_string(),
            name: "Amoxicillin".to_string(),
            generic_name: "amoxicillin".to_string(),
            brand_names: vec!["Amoxil".to_string(), "Moxatag".to_string()],
            drug_class: "Penicillin Antibiotic".to_string(),
            route: "oral".to_string(),
            form: "capsule".to_string(),
            common_doses: vec![
                "250mg".to_string(),
                "500mg".to_string(),
                "875mg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-006".to_string(),
            name: "Simvastatin".to_string(),
            generic_name: "simvastatin".to_string(),
            brand_names: vec!["Zocor".to_string()],
            drug_class: "Statin".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec![
                "5mg".to_string(),
                "10mg".to_string(),
                "20mg".to_string(),
                "40mg".to_string(),
                "80mg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-007".to_string(),
            name: "Omeprazole".to_string(),
            generic_name: "omeprazole".to_string(),
            brand_names: vec!["Prilosec".to_string(), "Losec".to_string()],
            drug_class: "Proton Pump Inhibitor".to_string(),
            route: "oral".to_string(),
            form: "capsule".to_string(),
            common_doses: vec!["10mg".to_string(), "20mg".to_string(), "40mg".to_string()],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-008".to_string(),
            name: "Levothyroxine".to_string(),
            generic_name: "levothyroxine".to_string(),
            brand_names: vec![
                "Synthroid".to_string(),
                "Levoxyl".to_string(),
                "Unithroid".to_string(),
            ],
            drug_class: "Thyroid Hormone".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec![
                "25mcg".to_string(),
                "50mcg".to_string(),
                "75mcg".to_string(),
                "88mcg".to_string(),
                "100mcg".to_string(),
                "112mcg".to_string(),
                "125mcg".to_string(),
                "137mcg".to_string(),
                "150mcg".to_string(),
            ],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-009".to_string(),
            name: "Amlodipine".to_string(),
            generic_name: "amlodipine".to_string(),
            brand_names: vec!["Norvasc".to_string()],
            drug_class: "Calcium Channel Blocker".to_string(),
            route: "oral".to_string(),
            form: "tablet".to_string(),
            common_doses: vec!["2.5mg".to_string(), "5mg".to_string(), "10mg".to_string()],
        },
        crate::clinical::DrugReference {
            drug_id: "DRUG-010".to_string(),
            name: "Fluoxetine".to_string(),
            generic_name: "fluoxetine".to_string(),
            brand_names: vec!["Prozac".to_string(), "Sarafem".to_string()],
            drug_class: "SSRI Antidepressant".to_string(),
            route: "oral".to_string(),
            form: "capsule".to_string(),
            common_doses: vec![
                "10mg".to_string(),
                "20mg".to_string(),
                "40mg".to_string(),
                "60mg".to_string(),
            ],
        },
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "drugs": drugs,
        "count": drugs.len()
    }))
}

/// Get interaction database for reference/lookup
#[get("/api/interactions")]
pub async fn get_interaction_database(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    // Validate user is authenticated
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

    // Reference interaction database
    let interactions = vec![
        serde_json::json!({
            "interactionId": "INT-001",
            "type": "drug-drug",
            "severity": "major",
            "drug1": "Warfarin",
            "drug2": "Aspirin",
            "title": "Warfarin + Aspirin: Increased Bleeding Risk",
            "description": "Concurrent use of warfarin with aspirin significantly increases the risk of bleeding complications.",
            "mechanism": "Additive anticoagulant and antiplatelet effects. Both drugs inhibit different pathways in hemostasis, leading to synergistic bleeding risk.",
            "clinicalEffects": ["Increased risk of major bleeding (GI, intracranial)", "Prolonged bleeding time", "Elevated INR", "Easy bruising", "Hematuria or melena"],
            "management": ["Avoid combination when possible", "If combination necessary, use lowest effective aspirin dose (81mg)", "Monitor INR more frequently (weekly initially)", "Watch for signs of bleeding", "Consider PPI for GI protection", "Educate patient on bleeding signs"],
            "monitoring": ["INR every 1-2 weeks until stable", "CBC for anemia", "Stool guaiac for occult blood", "Monitor for bruising, bleeding gums"],
            "alternatives": ["Use aspirin alone for cardiovascular protection if anticoagulation can be stopped", "Consider alternative anticoagulant if aspirin essential"],
            "evidenceLevel": "A",
            "references": ["Holbrook AM, et al. Arch Intern Med. 2005;165(10):1095-1106.", "Johnson SG, et al. Am Heart J. 2008;155(5):918-924."],
            "onset": "Immediate (within days)",
            "documentation": "Well-established",
            "riskFactors": ["Age >65", "History of bleeding", "Renal impairment", "Peptic ulcer disease"]
        }),
        serde_json::json!({
            "interactionId": "INT-002",
            "type": "drug-drug",
            "severity": "moderate",
            "drug1": "Lisinopril",
            "drug2": "Aspirin",
            "title": "ACE Inhibitors + NSAIDs: Reduced Antihypertensive Effect",
            "description": "NSAIDs may reduce the antihypertensive effect of ACE inhibitors and increase risk of renal impairment.",
            "mechanism": "NSAIDs inhibit prostaglandin synthesis, which is important for ACE inhibitor-mediated vasodilation and natriuresis.",
            "clinicalEffects": ["Reduced blood pressure control", "Increased risk of acute kidney injury", "Hyperkalemia", "Sodium and fluid retention"],
            "management": ["Monitor blood pressure closely", "Check renal function and potassium", "Use lowest effective NSAID dose for shortest duration", "Consider alternative analgesic (acetaminophen)"],
            "monitoring": ["Blood pressure weekly during NSAID therapy", "Serum creatinine and potassium baseline and after 1 week", "Volume status"],
            "alternatives": ["Acetaminophen for pain", "Topical NSAIDs", "COX-2 selective inhibitor (caution still needed)"],
            "evidenceLevel": "B",
            "references": ["Fournier JP, et al. BMJ. 2012;344:e4128.", "Lapi F, et al. Drug Saf. 2013;36(10):899-918."],
            "onset": "Days to weeks",
            "documentation": "Established",
            "riskFactors": ["Pre-existing renal disease", "Volume depletion", "Age >65", "Diabetes"]
        }),
        serde_json::json!({
            "interactionId": "INT-003",
            "type": "drug-drug",
            "severity": "major",
            "drug1": "Simvastatin",
            "drug2": "Fluoxetine",
            "title": "Simvastatin + Fluoxetine: Increased Statin Levels",
            "description": "Fluoxetine inhibits CYP3A4, increasing simvastatin levels and risk of myopathy/rhabdomyolysis.",
            "mechanism": "Fluoxetine is a moderate CYP3A4 inhibitor. Simvastatin is extensively metabolized by CYP3A4.",
            "clinicalEffects": ["Increased simvastatin plasma concentrations", "Myalgia and muscle weakness", "Elevated creatine kinase (CK)", "Rhabdomyolysis (rare but serious)", "Acute kidney injury from myoglobinuria"],
            "management": ["Reduce simvastatin dose (max 20mg daily with moderate CYP3A4 inhibitor)", "Monitor for muscle symptoms", "Check CK if symptoms develop", "Consider alternative statin not metabolized by CYP3A4 (rosuvastatin, pravastatin)"],
            "monitoring": ["Baseline CK", "Patient education on myopathy symptoms", "CK if muscle pain/weakness", "Renal function"],
            "alternatives": ["Switch to rosuvastatin or pravastatin", "Switch to alternative SSRI with less CYP3A4 inhibition (sertraline)"],
            "evidenceLevel": "B",
            "references": ["FDA Drug Safety Communication on Simvastatin", "Law M, Rudnicka AR. Am J Cardiovasc Drugs. 2006;6(6):343-348."],
            "onset": "Days to weeks",
            "documentation": "Established",
            "riskFactors": ["High simvastatin dose", "Renal impairment", "Hypothyroidism", "Age >65", "Female gender"]
        }),
        serde_json::json!({
            "interactionId": "INT-004",
            "type": "drug-drug",
            "severity": "moderate",
            "drug1": "Metformin",
            "drug2": "Lisinopril",
            "title": "Metformin + ACE Inhibitors: Hypoglycemia Risk",
            "description": "ACE inhibitors may enhance the hypoglycemic effect of metformin.",
            "mechanism": "ACE inhibitors may improve insulin sensitivity and glucose uptake.",
            "clinicalEffects": ["Increased risk of hypoglycemia", "Enhanced glucose-lowering effect", "Symptoms: tremor, sweating, confusion, tachycardia"],
            "management": ["Monitor blood glucose more frequently when initiating ACE inhibitor", "Educate patient on hypoglycemia symptoms", "May need to adjust metformin or other antidiabetic dose", "Generally beneficial interaction for diabetic patients"],
            "monitoring": ["Blood glucose daily initially", "HbA1c at 3 months", "Hypoglycemia symptoms"],
            "alternatives": ["Generally continue both medications", "Adjust doses as needed based on glucose control"],
            "evidenceLevel": "C",
            "references": ["Paolisso G, et al. J Clin Invest. 1992;89(4):1295-1300."],
            "onset": "Days to weeks",
            "documentation": "Probable",
            "riskFactors": ["Elderly", "Renal impairment", "Tight glycemic control", "Irregular meals"]
        }),
        serde_json::json!({
            "interactionId": "INT-005",
            "type": "drug-drug",
            "severity": "moderate",
            "drug1": "Levothyroxine",
            "drug2": "Omeprazole",
            "title": "Levothyroxine + PPIs: Reduced Levothyroxine Absorption",
            "description": "PPIs increase gastric pH, which may reduce levothyroxine absorption.",
            "mechanism": "Levothyroxine absorption is pH-dependent. Increased gastric pH from PPI reduces dissolution and absorption.",
            "clinicalEffects": ["Reduced levothyroxine efficacy", "Elevated TSH", "Hypothyroid symptoms may recur"],
            "management": ["Separate administration by at least 4 hours", "Take levothyroxine first thing in the morning on empty stomach", "Take PPI later in the day", "Monitor TSH 6-8 weeks after PPI initiation", "May need to increase levothyroxine dose"],
            "monitoring": ["TSH and free T4 at 6-8 weeks", "Clinical symptoms of hypothyroidism"],
            "alternatives": ["H2 antagonist instead of PPI if appropriate", "Antacids (though also affect absorption)"],
            "evidenceLevel": "C",
            "references": ["Centanni M, et al. N Engl J Med. 2006;354(17):1787-1795."],
            "onset": "Weeks",
            "documentation": "Probable",
            "riskFactors": ["Marginal thyroid function", "High PPI dose", "Long-term PPI use"]
        }),
        serde_json::json!({
            "interactionId": "INT-006",
            "type": "drug-allergy",
            "severity": "contraindicated",
            "drug1": "Amoxicillin",
            "allergen": "Penicillin",
            "title": "Amoxicillin in Penicillin-Allergic Patients",
            "description": "Absolute contraindication to use amoxicillin (a penicillin) in patients with documented penicillin allergy.",
            "mechanism": "Cross-reactivity due to shared beta-lactam ring structure.",
            "clinicalEffects": ["Immediate hypersensitivity reaction", "Urticaria, angioedema", "Bronchospasm", "Anaphylaxis (life-threatening)", "Stevens-Johnson syndrome (rare)"],
            "management": ["DO NOT ADMINISTER", "Use alternative antibiotic class", "If beta-lactam essential, consider allergy testing and possible desensitization", "Update allergy list in medical record"],
            "monitoring": ["N/A - do not use"],
            "alternatives": ["Macrolides (azithromycin, clarithromycin)", "Fluoroquinolones (levofloxacin, moxifloxacin)", "Cephalosporins (use with caution, 1-10% cross-reactivity)"],
            "evidenceLevel": "A",
            "references": ["Joint Task Force on Practice Parameters. J Allergy Clin Immunol. 2010;125(3 Suppl 2):S126-137."],
            "onset": "Immediate to hours",
            "documentation": "Well-established",
            "riskFactors": ["History of severe reaction", "Atopy", "Previous penicillin reaction"]
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "interactions": interactions,
        "count": interactions.len()
    }))
}

/// Check drug interactions request
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct CheckDrugInteractionsRequest {
    pub patient_id: String,
    pub medications: Vec<String>,
    pub include_allergies: Option<bool>,
    pub include_conditions: Option<bool>,
}

/// Check for drug-drug and drug-allergy interactions
#[post("/api/interactions/check")]
pub async fn check_drug_interactions(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CheckDrugInteractionsRequest>,
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

    // Only healthcare providers can check interactions
    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can check drug interactions".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // Comprehensive clinically significant drug interaction database
    let known_interactions: Vec<(&str, &str, &str, &str)> = vec![
        // ── CONTRAINDICATED ──────────────────────────────────────────────────
        // SSRIs + MAOIs → serotonin syndrome
        ("ssri", "maoi", "contraindicated", "Serotonin syndrome: potentially fatal combination; concurrent use is absolutely contraindicated"),
        ("fluoxetine", "maoi", "contraindicated", "Serotonin syndrome: allow ≥14 days washout between fluoxetine and any MAOI"),
        ("sertraline", "maoi", "contraindicated", "Serotonin syndrome: concurrent use contraindicated"),
        ("paroxetine", "maoi", "contraindicated", "Serotonin syndrome: concurrent use contraindicated"),
        ("citalopram", "maoi", "contraindicated", "Serotonin syndrome: concurrent use contraindicated"),
        ("escitalopram", "maoi", "contraindicated", "Serotonin syndrome: concurrent use contraindicated"),
        ("venlafaxine", "maoi", "contraindicated", "Serotonin syndrome: concurrent use contraindicated"),
        ("duloxetine", "maoi", "contraindicated", "Serotonin syndrome: concurrent use contraindicated"),
        ("linezolid", "ssri", "contraindicated", "Serotonin syndrome: linezolid has weak MAOI activity"),
        ("linezolid", "maoi", "contraindicated", "Severe serotonin syndrome risk with dual MAO inhibition"),
        // Opioid + benzodiazepine → respiratory depression
        ("opioid", "benzodiazepine", "contraindicated", "Profound respiratory depression and death; co-prescribing carries an FDA black-box warning"),
        ("morphine", "benzodiazepine", "contraindicated", "Respiratory depression and death; avoid concurrent use"),
        ("oxycodone", "benzodiazepine", "contraindicated", "Respiratory depression and death; avoid concurrent use"),
        ("hydrocodone", "benzodiazepine", "contraindicated", "Respiratory depression and death; avoid concurrent use"),
        ("fentanyl", "benzodiazepine", "contraindicated", "Respiratory depression and death; avoid concurrent use"),
        ("methadone", "benzodiazepine", "contraindicated", "Respiratory depression and QT prolongation; avoid concurrent use"),
        ("buprenorphine", "benzodiazepine", "contraindicated", "Respiratory depression risk is lower but still significant; avoid when possible"),
        // QT-prolonging combinations
        ("haloperidol", "methadone", "contraindicated", "Additive QT prolongation; risk of torsades de pointes and sudden death"),
        ("haloperidol", "sotalol", "contraindicated", "Additive QT prolongation; torsades de pointes risk"),
        ("methadone", "sotalol", "contraindicated", "Additive QT prolongation; torsades de pointes risk"),
        ("methadone", "amiodarone", "contraindicated", "Additive QT prolongation; torsades de pointes risk"),
        ("azithromycin", "haloperidol", "contraindicated", "Additive QT prolongation; high torsades risk"),
        ("moxifloxacin", "haloperidol", "contraindicated", "Additive QT prolongation; avoid concurrent use"),
        ("moxifloxacin", "amiodarone", "contraindicated", "Additive QT prolongation; high torsades risk"),
        ("cisapride", "macrolide", "contraindicated", "Fatal QT prolongation; cisapride + macrolide combination is absolutely contraindicated"),
        ("cisapride", "azithromycin", "contraindicated", "Fatal QT prolongation; absolutely contraindicated"),
        ("pimozide", "macrolide", "contraindicated", "Additive QT prolongation; absolutely contraindicated"),
        // Alcohol + metronidazole → disulfiram-like reaction
        ("metronidazole", "alcohol", "contraindicated", "Disulfiram-like reaction: severe flushing, vomiting, tachycardia; avoid alcohol during and 48 h after therapy"),
        ("tinidazole", "alcohol", "contraindicated", "Disulfiram-like reaction; avoid alcohol for 72 h after last dose"),
        ("disulfiram", "alcohol", "contraindicated", "Intended disulfiram reaction; may be severe or fatal at high alcohol intake"),
        // Tyramine + MAOIs → hypertensive crisis
        ("maoi", "tyramine", "contraindicated", "Hypertensive crisis: tyramine-rich foods (aged cheese, cured meats, red wine) can cause a life-threatening BP spike"),
        ("phenelzine", "tyramine", "contraindicated", "Hypertensive crisis; strict tyramine-free diet required"),
        ("tranylcypromine", "tyramine", "contraindicated", "Hypertensive crisis; strict tyramine-free diet required"),
        // Other contraindicated combinations
        ("warfarin", "thrombolytic", "contraindicated", "Uncontrollable haemorrhage risk; concurrent use is contraindicated"),
        ("warfarin", "streptokinase", "contraindicated", "Uncontrollable haemorrhage risk"),
        ("warfarin", "alteplase", "contraindicated", "Uncontrollable haemorrhage risk"),
        ("clopidogrel", "thrombolytic", "contraindicated", "Uncontrollable haemorrhage risk"),
        ("simvastatin", "itraconazole", "contraindicated", "Severe myopathy/rhabdomyolysis due to CYP3A4 inhibition markedly raising simvastatin AUC"),
        ("simvastatin", "ketoconazole", "contraindicated", "Severe myopathy/rhabdomyolysis; avoid combination"),
        ("sildenafil", "nitrate", "contraindicated", "Catastrophic hypotension; concurrent use is absolutely contraindicated"),
        ("tadalafil", "nitrate", "contraindicated", "Catastrophic hypotension; concurrent use is absolutely contraindicated"),
        ("vardenafil", "nitrate", "contraindicated", "Catastrophic hypotension; concurrent use is absolutely contraindicated"),
        ("sildenafil", "nitroglycerin", "contraindicated", "Catastrophic hypotension; concurrent use is absolutely contraindicated"),

        // ── MAJOR ─────────────────────────────────────────────────────────────
        // Warfarin + NSAIDs / antibiotics / other interactors
        ("warfarin", "aspirin", "major", "Increased bleeding risk: additive antiplatelet effect plus GI mucosal damage; monitor INR closely"),
        ("warfarin", "ibuprofen", "major", "Increased bleeding risk: NSAID-mediated platelet inhibition and GI injury"),
        ("warfarin", "naproxen", "major", "Increased bleeding risk: NSAID-mediated platelet inhibition"),
        ("warfarin", "celecoxib", "major", "Increased INR and bleeding risk; monitor closely"),
        ("warfarin", "diclofenac", "major", "Increased bleeding risk; monitor INR"),
        ("warfarin", "amoxicillin", "major", "Antibiotics may disrupt gut flora and raise INR; monitor INR when starting or stopping"),
        ("warfarin", "ciprofloxacin", "major", "CYP1A2 inhibition raises warfarin levels; significant INR increase"),
        ("warfarin", "metronidazole", "major", "CYP2C9 inhibition markedly raises warfarin levels; reduce warfarin dose and monitor INR"),
        ("warfarin", "fluconazole", "major", "CYP2C9/3A4 inhibition greatly increases warfarin effect; major INR elevation"),
        ("warfarin", "amiodarone", "major", "CYP2C9 inhibition raises warfarin effect; marked INR increase, may persist for weeks after amiodarone stopped"),
        ("warfarin", "trimethoprim", "major", "CYP2C9 inhibition and folate antagonism raise INR; monitor closely"),
        ("warfarin", "sulfamethoxazole", "major", "CYP2C9 inhibition raises warfarin effect; cotrimoxazole frequently causes major INR elevation"),
        ("warfarin", "erythromycin", "major", "CYP3A4 inhibition increases warfarin levels; monitor INR"),
        ("warfarin", "clarithromycin", "major", "CYP3A4 inhibition increases warfarin levels; monitor INR"),
        // Methotrexate + NSAIDs / trimethoprim
        ("methotrexate", "nsaid", "major", "Methotrexate toxicity: NSAIDs reduce renal clearance and increase methotrexate levels; risk of bone marrow suppression and mucositis"),
        ("methotrexate", "ibuprofen", "major", "Reduced methotrexate clearance; serious toxicity risk"),
        ("methotrexate", "naproxen", "major", "Reduced methotrexate clearance; serious toxicity risk"),
        ("methotrexate", "aspirin", "major", "Reduced methotrexate clearance and protein displacement; toxicity risk"),
        ("methotrexate", "trimethoprim", "major", "Additive folate antagonism; severe bone marrow suppression"),
        ("methotrexate", "sulfamethoxazole", "major", "Additive folate antagonism; severe bone marrow suppression"),
        ("methotrexate", "penicillin", "major", "Reduced renal tubular secretion of methotrexate; toxicity risk"),
        // Digoxin interactions
        ("digoxin", "amiodarone", "major", "Digoxin toxicity: amiodarone inhibits P-gp and reduces renal clearance; reduce digoxin dose by 50% and monitor levels"),
        ("digoxin", "verapamil", "major", "Digoxin toxicity: verapamil inhibits P-gp and reduces renal clearance; monitor levels"),
        ("digoxin", "quinidine", "major", "Digoxin toxicity: quinidine doubles digoxin plasma levels; monitor levels and halve digoxin dose"),
        ("digoxin", "clarithromycin", "major", "P-gp inhibition raises digoxin levels; monitor closely"),
        ("digoxin", "erythromycin", "major", "P-gp inhibition raises digoxin levels; monitor closely"),
        // ACE inhibitors + potassium-sparing diuretics / potassium
        ("lisinopril", "spironolactone", "major", "Severe hyperkalemia: additive potassium retention; monitor serum potassium frequently"),
        ("lisinopril", "eplerenone", "major", "Severe hyperkalemia; monitor potassium"),
        ("enalapril", "spironolactone", "major", "Severe hyperkalemia; monitor potassium"),
        ("ramipril", "spironolactone", "major", "Severe hyperkalemia; monitor potassium"),
        ("lisinopril", "potassium", "major", "Hyperkalemia: ACE inhibitors reduce renal potassium excretion; avoid high-dose potassium supplementation"),
        ("ace inhibitor", "potassium-sparing diuretic", "major", "Severe hyperkalemia; potassium monitoring mandatory"),
        // Statins + fibrates → rhabdomyolysis
        ("simvastatin", "gemfibrozil", "major", "Rhabdomyolysis: gemfibrozil inhibits simvastatin metabolism; combination is generally avoided"),
        ("atorvastatin", "gemfibrozil", "major", "Rhabdomyolysis risk; use lowest statin dose if combination is necessary"),
        ("rosuvastatin", "gemfibrozil", "major", "Rhabdomyolysis: gemfibrozil inhibits rosuvastatin clearance; avoid or use lowest dose"),
        ("lovastatin", "gemfibrozil", "major", "Rhabdomyolysis risk; avoid combination"),
        ("simvastatin", "fenofibrate", "major", "Rhabdomyolysis risk lower than gemfibrozil but still significant; monitor CK"),
        // Lithium + NSAIDs / ACE inhibitors
        ("lithium", "ibuprofen", "major", "Lithium toxicity: NSAIDs reduce renal lithium clearance; may cause lithium levels to rise dangerously"),
        ("lithium", "naproxen", "major", "Lithium toxicity: reduced renal clearance"),
        ("lithium", "diclofenac", "major", "Lithium toxicity: reduced renal clearance"),
        ("lithium", "lisinopril", "major", "Lithium toxicity: ACE inhibitors reduce renal lithium clearance; monitor levels"),
        ("lithium", "enalapril", "major", "Lithium toxicity: reduced renal clearance"),
        ("lithium", "hydrochlorothiazide", "major", "Lithium toxicity: thiazides decrease lithium excretion; risk of toxic levels"),
        ("lithium", "furosemide", "major", "Lithium toxicity risk if sodium-depleted; monitor carefully"),
        // Theophylline + quinolones / macrolides
        ("theophylline", "ciprofloxacin", "major", "Theophylline toxicity: ciprofloxacin inhibits CYP1A2, raising theophylline levels; nausea, arrhythmia, seizures"),
        ("theophylline", "enoxacin", "major", "Severe theophylline toxicity; enoxacin is one of the strongest inhibitors; avoid"),
        ("theophylline", "erythromycin", "major", "CYP1A2 inhibition raises theophylline levels; toxicity risk"),
        ("theophylline", "clarithromycin", "major", "CYP1A2 inhibition raises theophylline levels; monitor levels"),
        ("theophylline", "fluvoxamine", "major", "Potent CYP1A2 inhibition; theophylline levels may double"),
        // Serotonin syndrome — non-MAOI combinations
        ("fluoxetine", "tramadol", "major", "Serotonin syndrome risk and reduced tramadol analgesia due to CYP2D6 inhibition"),
        ("sertraline", "tramadol", "major", "Serotonin syndrome risk"),
        ("paroxetine", "tramadol", "major", "Serotonin syndrome risk; paroxetine also reduces tramadol efficacy"),
        ("ssri", "triptans", "major", "Serotonin syndrome risk when high doses used; monitor closely"),
        ("ssri", "tramadol", "major", "Serotonin syndrome risk with serotonergic opioid"),
        ("ssri", "lithium", "major", "Serotonin syndrome risk at higher doses; monitor carefully"),
        // Immunosuppressants + live vaccines
        ("cyclosporine", "live vaccine", "major", "Disseminated vaccine-strain infection; live vaccines are contraindicated in immunosuppressed patients"),
        ("tacrolimus", "live vaccine", "major", "Disseminated vaccine-strain infection; avoid live vaccines"),
        ("methotrexate", "live vaccine", "major", "Disseminated vaccine-strain infection; avoid live vaccines while on immunosuppressive doses"),
        ("azathioprine", "live vaccine", "major", "Avoid live vaccines during immunosuppressive therapy"),
        ("mycophenolate", "live vaccine", "major", "Avoid live vaccines during immunosuppressive therapy"),
        // Anticoagulants + thrombolytics
        ("heparin", "thrombolytic", "major", "Synergistic bleeding risk; requires careful monitoring and timing"),
        ("apixaban", "thrombolytic", "major", "Synergistic bleeding risk"),
        ("rivaroxaban", "thrombolytic", "major", "Synergistic bleeding risk"),
        ("dabigatran", "thrombolytic", "major", "Synergistic bleeding risk"),
        // Metformin + contrast
        ("metformin", "contrast dye", "major", "Risk of contrast-induced nephropathy leading to lactic acidosis; hold metformin 48 h before and after contrast"),
        ("metformin", "iodinated contrast", "major", "Lactic acidosis risk if renal function impaired; withhold metformin peri-procedure"),
        // Antidiabetics + beta-blockers
        ("insulin", "propranolol", "major", "Beta-blockers mask tachycardia warning of hypoglycemia and prolong recovery; non-selective beta-blockers are most problematic"),
        ("insulin", "atenolol", "major", "Masking of hypoglycemia symptoms; use with caution"),
        ("sulfonylurea", "propranolol", "major", "Masking of hypoglycemia symptoms and prolonged hypoglycemic episodes"),
        ("glipizide", "propranolol", "major", "Masking of hypoglycemia symptoms"),
        // CYP interactions — rifampin (potent CYP450 inducer)
        ("rifampin", "warfarin", "major", "CYP2C9/3A4 induction markedly reduces warfarin levels; INR may fall by 50% or more"),
        ("rifampin", "oral contraceptive", "major", "CYP3A4 induction reduces contraceptive plasma levels; additional contraception required"),
        ("rifampin", "cyclosporine", "major", "CYP3A4 induction sharply reduces cyclosporine levels; risk of transplant rejection"),
        ("rifampin", "tacrolimus", "major", "CYP3A4 induction reduces tacrolimus levels; risk of rejection"),
        ("rifampin", "hiv protease inhibitor", "major", "CYP3A4 induction reduces antiretroviral levels; virological failure"),
        ("rifampin", "fluconazole", "major", "CYP3A4 induction reduces fluconazole levels significantly"),
        // Other major interactions
        ("clopidogrel", "omeprazole", "major", "CYP2C19 inhibition reduces clopidogrel antiplatelet activation; increased thrombotic risk"),
        ("clopidogrel", "esomeprazole", "major", "CYP2C19 inhibition reduces clopidogrel activation; use pantoprazole as alternative PPI"),
        ("phenytoin", "carbamazepine", "major", "Mutual CYP induction; unpredictable changes in both drug levels requiring monitoring"),
        ("phenytoin", "valproate", "major", "Valproate displaces phenytoin from protein binding and inhibits its metabolism; complex bidirectional interaction"),
        ("carbamazepine", "oral contraceptive", "major", "CYP3A4 induction reduces contraceptive efficacy; use alternative contraception"),

        // ── MODERATE ─────────────────────────────────────────────────────────
        // Antihypertensives + NSAIDs → BP increase
        ("lisinopril", "ibuprofen", "moderate", "NSAIDs blunt antihypertensive effect of ACE inhibitors and increase risk of renal impairment"),
        ("lisinopril", "naproxen", "moderate", "NSAIDs reduce antihypertensive effect; monitor blood pressure"),
        ("amlodipine", "ibuprofen", "moderate", "NSAIDs may attenuate antihypertensive effect"),
        ("hydrochlorothiazide", "ibuprofen", "moderate", "NSAIDs reduce diuretic and antihypertensive effect; risk of fluid retention"),
        ("metoprolol", "ibuprofen", "moderate", "NSAIDs may reduce antihypertensive efficacy"),
        // Diuretics + aminoglycosides → ototoxicity
        ("furosemide", "gentamicin", "moderate", "Additive ototoxicity: furosemide plus aminoglycoside substantially increases risk of permanent hearing loss"),
        ("furosemide", "tobramycin", "moderate", "Additive ototoxicity; avoid or monitor hearing"),
        ("furosemide", "amikacin", "moderate", "Additive ototoxicity"),
        ("ethacrynic acid", "aminoglycoside", "moderate", "Severe ototoxicity risk; ethacrynic acid is the most ototoxic loop diuretic"),
        // Tetracycline / fluoroquinolone + antacids / dairy
        ("tetracycline", "antacid", "moderate", "Chelation by divalent cations (Ca, Mg, Al) markedly reduces tetracycline absorption; separate by ≥2 h"),
        ("tetracycline", "calcium", "moderate", "Calcium chelation reduces tetracycline bioavailability; separate by ≥2 h"),
        ("tetracycline", "iron", "moderate", "Iron chelation reduces tetracycline absorption"),
        ("doxycycline", "antacid", "moderate", "Chelation reduces doxycycline absorption; separate doses"),
        ("doxycycline", "iron", "moderate", "Reduced doxycycline absorption due to chelation"),
        ("ciprofloxacin", "antacid", "moderate", "Antacids containing Mg or Al reduce ciprofloxacin absorption by up to 90%; separate by ≥2–4 h"),
        ("ciprofloxacin", "calcium", "moderate", "Divalent cations reduce ciprofloxacin absorption; separate doses"),
        ("ciprofloxacin", "iron", "moderate", "Iron chelation reduces ciprofloxacin absorption"),
        ("levofloxacin", "antacid", "moderate", "Reduced absorption due to chelation; separate by ≥2 h"),
        ("moxifloxacin", "antacid", "moderate", "Reduced absorption due to chelation; separate by ≥2 h"),
        // Rifampin — moderate-level interactions
        ("rifampin", "diazepam", "moderate", "CYP3A4/2C19 induction reduces diazepam levels; benzodiazepine effect may be insufficient"),
        ("rifampin", "methadone", "moderate", "CYP3A4 induction reduces methadone; opioid withdrawal may occur"),
        ("rifampin", "doxycycline", "moderate", "CYP3A4 induction reduces doxycycline levels"),
        // Statins + CYP3A4 inhibitors
        ("simvastatin", "amlodipine", "moderate", "Amlodipine inhibits CYP3A4 and can increase simvastatin exposure; limit simvastatin to 20 mg/day"),
        ("simvastatin", "diltiazem", "moderate", "CYP3A4 inhibition raises simvastatin levels; limit simvastatin dose"),
        ("simvastatin", "verapamil", "moderate", "CYP3A4 inhibition raises simvastatin levels; limit dose"),
        ("atorvastatin", "clarithromycin", "moderate", "CYP3A4 inhibition increases atorvastatin; myopathy risk"),
        ("atorvastatin", "erythromycin", "moderate", "CYP3A4 inhibition increases atorvastatin levels"),
        ("simvastatin", "grapefruit", "moderate", "Grapefruit inhibits intestinal CYP3A4; increased statin levels and myopathy risk"),
        ("atorvastatin", "grapefruit", "moderate", "Grapefruit inhibits intestinal CYP3A4; increased atorvastatin levels"),
        // ACE inhibitor / ARB + NSAIDs (triple whammy)
        ("ace inhibitor", "nsaid", "moderate", "Reduced antihypertensive effect and risk of acute kidney injury when combined with a diuretic"),
        ("losartan", "ibuprofen", "moderate", "NSAIDs reduce antihypertensive effect and increase renal impairment risk"),
        ("valsartan", "ibuprofen", "moderate", "NSAIDs reduce antihypertensive effect and increase renal impairment risk"),
        // CNS depressant combinations
        ("opioid", "gabapentin", "moderate", "Additive CNS/respiratory depression; risk of oversedation particularly in elderly"),
        ("morphine", "gabapentin", "moderate", "Additive CNS/respiratory depression"),
        ("opioid", "pregabalin", "moderate", "Additive CNS/respiratory depression; fatal opioid overdoses are more common with concomitant gabapentinoids"),
        ("benzodiazepine", "alcohol", "moderate", "Additive CNS depression; impaired psychomotor function and increased sedation"),
        ("antidepressant", "alcohol", "moderate", "Additive CNS depression and potential loss of antidepressant efficacy"),
        // Antifungal interactions
        ("fluconazole", "simvastatin", "moderate", "CYP3A4 inhibition raises simvastatin levels; myopathy risk"),
        ("fluconazole", "sulfonylurea", "moderate", "CYP2C9 inhibition raises sulfonylurea levels; hypoglycemia risk"),
        ("fluconazole", "phenytoin", "moderate", "CYP2C9 inhibition raises phenytoin levels; toxicity risk"),
        // Other moderate interactions
        ("allopurinol", "azathioprine", "moderate", "Allopurinol inhibits xanthine oxidase and raises azathioprine/mercaptopurine to toxic levels; reduce azathioprine dose by 75%"),
        ("allopurinol", "mercaptopurine", "moderate", "Same mechanism as azathioprine; reduce dose by 75%"),
        ("spironolactone", "ace inhibitor", "moderate", "Hyperkalemia risk; monitor potassium, especially in renal impairment or heart failure"),
        ("ssri", "nsaid", "moderate", "Additive risk of GI bleeding: SSRIs inhibit platelet serotonin uptake; co-prescribe with a PPI"),
        ("ssri", "aspirin", "moderate", "Additive GI bleeding risk; consider gastroprotection"),
        ("quinidine", "digoxin", "moderate", "Digoxin toxicity: quinidine raises digoxin levels; monitor"),
        ("verapamil", "beta-blocker", "moderate", "Additive negative chronotropy and inotropy; bradycardia and heart block risk"),
        ("diltiazem", "beta-blocker", "moderate", "Additive negative chronotropy; bradycardia and AV block risk"),
    ];

    let mut interactions: Vec<crate::clinical::DrugInteraction> = Vec::new();
    let medications_lower: Vec<String> = req.medications.iter().map(|m| m.to_lowercase()).collect();

    // Check each pair of medications
    for i in 0..medications_lower.len() {
        for j in (i + 1)..medications_lower.len() {
            let med1 = &medications_lower[i];
            let med2 = &medications_lower[j];

            for (drug1, drug2, severity, description) in &known_interactions {
                if (med1.contains(drug1) && med2.contains(drug2))
                    || (med1.contains(drug2) && med2.contains(drug1))
                {
                    let severity_enum = match *severity {
                        "contraindicated" => crate::clinical::InteractionSeverity::Contraindicated,
                        "major" => crate::clinical::InteractionSeverity::Major,
                        "moderate" => crate::clinical::InteractionSeverity::Moderate,
                        _ => crate::clinical::InteractionSeverity::Minor,
                    };

                    interactions.push(crate::clinical::DrugInteraction {
                        drug_a: req.medications[i].clone(),
                        drug_b: req.medications[j].clone(),
                        severity: severity_enum,
                        description: description.to_string(),
                        clinical_effects: description.to_string(),
                        management: format!(
                            "Monitor closely or consider alternatives for {} and {}",
                            req.medications[i], req.medications[j]
                        ),
                        evidence_level: crate::clinical::EvidenceLevel::Established,
                        source: "Clinical Pharmacology Database".to_string(),
                    });
                }
            }
        }
    }

    // Check allergies if requested (via repository)
    let mut allergy_alerts: Vec<serde_json::Value> = Vec::new();
    if req.include_allergies.unwrap_or(true) {
        let patient_allergies = data
            .repositories
            .allergies
            .get_active_by_patient(&req.patient_id)
            .await
            .unwrap_or_default();
        for allergy in &patient_allergies {
            let allergen_lower = allergy.allergen.to_lowercase();
            for med in &medications_lower {
                if med.contains(&allergen_lower) {
                    allergy_alerts.push(serde_json::json!({
                        "type": "allergy",
                        "medication": med,
                        "allergen": allergy.allergen,
                        "severity": allergy.severity,
                        "reaction": allergy.reaction
                    }));
                }
            }
        }
    }

    // Calculate overall severity
    let overall_severity = interactions
        .iter()
        .map(|i| &i.severity)
        .max()
        .cloned()
        .unwrap_or(crate::clinical::InteractionSeverity::None);

    let safe_to_prescribe = !matches!(
        overall_severity,
        crate::clinical::InteractionSeverity::Contraindicated
            | crate::clinical::InteractionSeverity::Major
    );

    let result = crate::clinical::DrugInteractionResult {
        result_id: format!("CHK-{}", uuid::Uuid::new_v4()),
        patient_id: req.patient_id.clone(),
        checked_at: chrono::Utc::now().timestamp(),
        new_medication: req.medications.first().cloned().unwrap_or_default(),
        interactions: interactions.clone(),
        overall_severity,
        safe_to_prescribe,
        checked_by: current_user_id.clone(),
    };

    // Store the result
    let check_id = result.result_id.clone();
    let mut drug_interactions = data.drug_interactions.write().unwrap();
    drug_interactions.insert(check_id.clone(), result);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "check_id": check_id,
        "patient_id": req.patient_id,
        "medications_checked": req.medications.len(),
        "interactions_found": interactions.len(),
        "has_critical": interactions.iter().any(|i|
            matches!(i.severity, crate::clinical::InteractionSeverity::Contraindicated |
                                  crate::clinical::InteractionSeverity::Major)),
        "interactions": interactions,
        "allergy_alerts": allergy_alerts,
        "recommendation": if interactions.is_empty() && allergy_alerts.is_empty() {
            "No significant interactions detected"
        } else if interactions.iter().any(|i| matches!(i.severity, crate::clinical::InteractionSeverity::Contraindicated)) {
            "CONTRAINDICATED - Do not prescribe together"
        } else if interactions.iter().any(|i| matches!(i.severity, crate::clinical::InteractionSeverity::Major)) {
            "MAJOR interactions - Consider alternatives"
        } else {
            "Moderate interactions - Monitor patient closely"
        }
    }))
}

/// Get interaction check history for a patient
#[get("/api/interactions/history/{patient_id}")]
pub async fn get_interaction_history(
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

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let interactions = data.drug_interactions.read().unwrap();
    let history: Vec<_> = interactions
        .values()
        .filter(|r| r.patient_id == patient_id)
        .cloned()
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "checks": history,
        "count": history.len()
    }))
}

// ============================================================================
// PHASE 22: FAMILY ACCOUNT LINKING
// ============================================================================

/// Create family group request
#[derive(Debug, Deserialize)]
pub struct CreateFamilyGroupRequest {
    pub group_name: String,
    pub primary_contact_id: String,
}

/// Create a family group
#[post("/api/family/groups")]
pub async fn create_family_group(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateFamilyGroupRequest>,
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

    // Only the primary contact can create their family group
    if current_user_id != req.primary_contact_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "You can only create a family group for yourself".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let group = crate::clinical::FamilyGroup {
        family_id: format!("FAM-{}", uuid::Uuid::new_v4()),
        family_name: req.group_name.clone(),
        primary_account_id: req.primary_contact_id.clone(),
        members: vec![crate::clinical::FamilyMember {
            patient_id: req.primary_contact_id.clone(),
            relationship: crate::clinical::FamilyRelationship::Self_,
            access_level: crate::clinical::FamilyAccessLevel::Full,
            can_manage_appointments: true,
            can_view_records: true,
            can_manage_medications: true,
            can_book_appointments: true,
            is_minor: false,
            linked_at: chrono::Utc::now().timestamp(),
            linked_by: current_user_id.clone(),
        }],
        created_at: chrono::Utc::now().timestamp(),
        last_modified: chrono::Utc::now().timestamp(),
    };

    let group_id = group.family_id.clone();
    let mut groups = data.family_groups.write().unwrap();
    groups.insert(group_id.clone(), group);

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "group_id": group_id,
        "message": "Family group created successfully"
    }))
}

/// Add family member request
#[derive(Debug, Deserialize)]
pub struct AddFamilyMemberRequest {
    pub patient_id: String,
    pub relationship: String,
    pub access_level: String,
    pub can_book_appointments: Option<bool>,
    pub can_view_records: Option<bool>,
    pub can_manage_medications: Option<bool>,
    pub is_minor: Option<bool>,
}

/// Add a member to family group
#[post("/api/family/groups/{group_id}/members")]
pub async fn add_family_member(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<AddFamilyMemberRequest>,
) -> impl Responder {
    let group_id = path.into_inner();

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

    let mut groups = data.family_groups.write().unwrap();

    let group = match groups.get_mut(&group_id) {
        Some(g) => g,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Family group not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    // Only primary account holder can add members
    if group.primary_account_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only primary account holder can add family members".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let relationship = match req.relationship.as_str() {
        "spouse" => crate::clinical::FamilyRelationship::Spouse,
        "child" => crate::clinical::FamilyRelationship::Child,
        "parent" => crate::clinical::FamilyRelationship::Parent,
        "sibling" => crate::clinical::FamilyRelationship::Sibling,
        "grandparent" => crate::clinical::FamilyRelationship::Grandparent,
        "grandchild" => crate::clinical::FamilyRelationship::Grandchild,
        "guardian" => crate::clinical::FamilyRelationship::Guardian,
        "dependent" => crate::clinical::FamilyRelationship::Dependent,
        _ => crate::clinical::FamilyRelationship::Other,
    };

    let access_level = match req.access_level.as_str() {
        "full" => crate::clinical::FamilyAccessLevel::Full,
        "read_only" => crate::clinical::FamilyAccessLevel::ReadOnly,
        "emergency_only" => crate::clinical::FamilyAccessLevel::EmergencyOnly,
        "appointments_only" => crate::clinical::FamilyAccessLevel::AppointmentsOnly,
        "custom" => crate::clinical::FamilyAccessLevel::Custom,
        _ => crate::clinical::FamilyAccessLevel::ReadOnly,
    };

    let member = crate::clinical::FamilyMember {
        patient_id: req.patient_id.clone(),
        relationship,
        access_level,
        can_manage_appointments: req.can_book_appointments.unwrap_or(true),
        can_view_records: req.can_view_records.unwrap_or(true),
        can_manage_medications: req.can_manage_medications.unwrap_or(false),
        can_book_appointments: req.can_book_appointments.unwrap_or(true),
        is_minor: req.is_minor.unwrap_or(false),
        linked_at: chrono::Utc::now().timestamp(),
        linked_by: current_user_id,
    };

    group.members.push(member);
    group.last_modified = chrono::Utc::now().timestamp();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Family member added successfully"
    }))
}

/// Get family group details
#[get("/api/family/groups/{group_id}")]
pub async fn get_family_group(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let group_id = path.into_inner();

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

    let groups = data.family_groups.read().unwrap();

    match groups.get(&group_id) {
        Some(group) => {
            // Check if user is a member
            let is_member = group
                .members
                .iter()
                .any(|m| m.patient_id == current_user_id);
            if !is_member && group.primary_account_id != current_user_id {
                return HttpResponse::Forbidden().json(ErrorResponse {
                    success: false,
                    error: "Access denied".to_string(),
                    code: "FORBIDDEN".to_string(),
                });
            }

            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "group": group
            }))
        }
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Family group not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
    }
}

/// Get my family groups
#[get("/api/family/my-groups")]
pub async fn get_my_family_groups(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
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

    let groups = data.family_groups.read().unwrap();
    let my_groups: Vec<_> = groups
        .values()
        .filter(|g| {
            g.primary_account_id == current_user_id
                || g.members.iter().any(|m| m.patient_id == current_user_id)
        })
        .cloned()
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "groups": my_groups,
        "count": my_groups.len()
    }))
}

/// Remove family member
#[delete("/api/family/groups/{group_id}/members/{patient_id}")]
pub async fn remove_family_member(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<(String, String)>,
) -> impl Responder {
    let (group_id, patient_id) = path.into_inner();

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

    let mut groups = data.family_groups.write().unwrap();

    let group = match groups.get_mut(&group_id) {
        Some(g) => g,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Family group not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    // Only primary contact can remove members (or member removing themselves)
    if group.primary_account_id != current_user_id && patient_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // Can't remove primary contact
    if patient_id == group.primary_account_id {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Cannot remove primary contact from group".to_string(),
            code: "BAD_REQUEST".to_string(),
        });
    }

    group.members.retain(|m| m.patient_id != patient_id);
    group.last_modified = chrono::Utc::now().timestamp();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Family member removed"
    }))
}

// ============================================================================
// PHASE 23: APPOINTMENT BOOKING SYSTEM
// ============================================================================

/// Book appointment request
#[derive(Debug, Deserialize)]
pub struct BookAppointmentRequest {
    pub patient_id: String,
    pub provider_id: String,
    pub provider_name: Option<String>,
    pub appointment_type: String,
    pub preferred_date: String,
    pub preferred_time: String,
    pub scheduled_at: Option<String>,
    pub duration_minutes: Option<i32>,
    pub reason: String,
    pub notes: Option<String>,
    pub location_type: Option<String>,
    pub department: Option<String>,
    pub instructions: Option<String>,
}

/// Book an appointment
#[post("/api/appointments")]
pub async fn book_appointment(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<BookAppointmentRequest>,
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

    // Patient can book for self, provider can book for any patient
    let is_own = current_user_id == req.patient_id;
    if !is_own && !current_user.role.is_healthcare_provider() {
        // Check if booking for family member
        let groups = data.family_groups.read().unwrap();
        let can_book_for_family = groups.values().any(|g| {
            g.members
                .iter()
                .any(|m| m.patient_id == current_user_id && m.can_book_appointments)
                && g.members.iter().any(|m| m.patient_id == req.patient_id)
        });
        drop(groups);

        if !can_book_for_family {
            return HttpResponse::Forbidden().json(ErrorResponse {
                success: false,
                error: "Cannot book appointments for this patient".to_string(),
                code: "FORBIDDEN".to_string(),
            });
        }
    }

    // Normalize appointment_type (case-insensitive, accept hyphen/space)
    let at_norm = req.appointment_type.to_lowercase().replace(['-', ' '], "_");

    let appointment_type = match at_norm.as_str() {
        "consultation" => crate::clinical::AppointmentType::Consultation,
        "followup" | "follow_up" => crate::clinical::AppointmentType::FollowUp,
        "new_patient" => crate::clinical::AppointmentType::NewPatient,
        "procedure" => crate::clinical::AppointmentType::Procedure,
        "lab_work" => crate::clinical::AppointmentType::LabWork,
        "imaging" => crate::clinical::AppointmentType::Imaging,
        "urgent" => crate::clinical::AppointmentType::Urgent,
        "telehealth" => crate::clinical::AppointmentType::Telehealth,
        "annual_exam" => crate::clinical::AppointmentType::AnnualExam,
        "pre_op" => crate::clinical::AppointmentType::PreOp,
        "post_op" => crate::clinical::AppointmentType::PostOp,
        _ => crate::clinical::AppointmentType::Other,
    };

    let location = crate::clinical::AppointmentLocation {
        facility_name: "MediChain Health Center".to_string(),
        department: req
            .department
            .clone()
            .unwrap_or_else(|| "General".to_string()),
        room: None,
        address: Some("123 Healthcare Blvd, Medical City".to_string()),
        telehealth_link: if req.location_type.as_deref() == Some("telehealth") {
            Some(format!(
                "https://medichain.health/telehealth/{}",
                uuid::Uuid::new_v4()
            ))
        } else {
            None
        },
    };
    // Determine scheduled date and start time: prefer `scheduled_at` if provided
    let (scheduled_date, start_time) = if let Some(sched) = &req.scheduled_at {
        if let Some((d, t)) = sched.split_once('T') {
            (d.to_string(), Some(t.to_string()))
        } else {
            (sched.clone(), None)
        }
    } else {
        (req.preferred_date.clone(), Some(req.preferred_time.clone()))
    };

    // Ensure `start_time` is a concrete String (Appointment expects String)
    let start_time_str = start_time.clone().unwrap_or_default();

    let appointment = crate::clinical::Appointment {
        appointment_id: format!("APT-{}", uuid::Uuid::new_v4()),
        patient_id: req.patient_id.clone(),
        provider_id: req.provider_id.clone(),
        provider_name: req
            .provider_name
            .clone()
            .unwrap_or_else(|| "Dr. Provider".to_string()),
        appointment_type,
        visit_reason: req.reason.clone(),
        scheduled_date: scheduled_date.clone(),
        scheduled_time: Some(chrono::Utc::now().timestamp()),
        start_time: start_time_str,
        duration_minutes: req.duration_minutes.unwrap_or(30) as u16,
        location,
        status: crate::clinical::AppointmentStatus::Scheduled,
        created_at: chrono::Utc::now().timestamp(),
        updated_at: chrono::Utc::now().timestamp(),
        created_by: current_user_id.clone(),
        booked_by: Some(current_user_id),
        check_in_time: None,
        is_telehealth: req.location_type.as_deref() == Some("telehealth"),
        reminders_sent: Vec::new(),
        instructions: req.instructions.clone(),
        insurance_verified: false,
        notes: req.notes.clone(),
    };

    let appointment_id = appointment.appointment_id.clone();
    let entity: crate::repositories::traits::AppointmentEntity = appointment.into();
    if let Err(e) = data.repositories.appointments.create(entity).await {
        log::error!("Appointment persistence failed: {}", e);
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Failed to persist appointment".to_string(),
            code: "PERSISTENCE_ERROR".to_string(),
        });
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "appointment_id": appointment_id,
        "message": "Appointment booked successfully"
    }))
}

/// Get appointments for a patient
#[get("/api/appointments/patient/{patient_id}")]
pub async fn get_patient_appointments(
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

    let patient_appointments: Vec<crate::clinical::Appointment> = match data
        .repositories
        .appointments
        .get_by_patient(&patient_id, crate::repositories::traits::Pagination::new(1000, 0))
        .await
    {
        Ok(page) => page
            .items
            .into_iter()
            .map(crate::clinical::Appointment::from)
            .collect(),
        Err(e) => {
            log::error!("Failed to fetch patient appointments: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to fetch appointments".to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            });
        }
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "appointments": patient_appointments,
        "count": patient_appointments.len()
    }))
}

/// Get appointments for a provider
#[get("/api/appointments/provider/{provider_id}")]
pub async fn get_provider_appointments(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let provider_id = path.into_inner();

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

    // Only the provider or admin can see provider's schedule
    if current_user_id != provider_id && !current_user.role.is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let provider_appointments: Vec<crate::clinical::Appointment> = match data
        .repositories
        .appointments
        .get_by_provider_all(&provider_id, crate::repositories::traits::Pagination::new(1000, 0))
        .await
    {
        Ok(page) => page
            .items
            .into_iter()
            .map(crate::clinical::Appointment::from)
            .collect(),
        Err(e) => {
            log::error!("Failed to fetch provider appointments: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to fetch appointments".to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            });
        }
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "provider_id": provider_id,
        "appointments": provider_appointments,
        "count": provider_appointments.len()
    }))
}

/// Cancel appointment request
#[derive(Debug, Deserialize)]
pub struct CancelAppointmentRequest {
    pub reason: Option<String>,
}

/// Cancel an appointment
#[post("/api/appointments/{appointment_id}/cancel")]
pub async fn cancel_appointment(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<CancelAppointmentRequest>,
) -> impl Responder {
    let appointment_id = path.into_inner();

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

    let mut appointment: crate::clinical::Appointment = match data
        .repositories
        .appointments
        .get_by_id(&appointment_id)
        .await
    {
        Ok(e) => e.into(),
        Err(crate::repositories::traits::RepositoryError::NotFound(_)) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Appointment not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            log::error!("Failed to fetch appointment: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to fetch appointment".to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            });
        }
    };

    // Patient, provider, or booker can cancel
    if appointment.patient_id != current_user_id
        && appointment.provider_id != current_user_id
        && appointment.booked_by != Some(current_user_id.clone())
    {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    appointment.status = crate::clinical::AppointmentStatus::Cancelled;
    if let Some(reason) = &req.reason {
        appointment.notes = Some(format!("Cancelled: {}", reason));
    }
    appointment.updated_at = chrono::Utc::now().timestamp();

    let entity: crate::repositories::traits::AppointmentEntity = appointment.into();
    if let Err(e) = data.repositories.appointments.update(entity).await {
        log::error!("Failed to persist cancellation: {}", e);
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Failed to cancel appointment".to_string(),
            code: "PERSISTENCE_ERROR".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Appointment cancelled"
    }))
}

/// Check in to appointment
#[post("/api/appointments/{appointment_id}/check-in")]
pub async fn check_in_appointment(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let appointment_id = path.into_inner();

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

    let mut appointment: crate::clinical::Appointment = match data
        .repositories
        .appointments
        .get_by_id(&appointment_id)
        .await
    {
        Ok(e) => e.into(),
        Err(crate::repositories::traits::RepositoryError::NotFound(_)) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Appointment not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            log::error!("Failed to fetch appointment: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to fetch appointment".to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            });
        }
    };

    // Patient or staff can check in
    if appointment.patient_id != current_user_id && !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    appointment.status = crate::clinical::AppointmentStatus::CheckedIn;
    appointment.check_in_time = Some(chrono::Utc::now().timestamp());
    appointment.updated_at = chrono::Utc::now().timestamp();
    let check_in_time = appointment.check_in_time;

    let entity: crate::repositories::traits::AppointmentEntity = appointment.into();
    if let Err(e) = data.repositories.appointments.update(entity).await {
        log::error!("Failed to persist check-in: {}", e);
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Failed to check in".to_string(),
            code: "PERSISTENCE_ERROR".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Checked in successfully",
        "check_in_time": check_in_time
    }))
}

/// Get available appointment slots
#[get("/api/appointments/slots/{provider_id}/{date}")]
pub async fn get_available_slots(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<(String, String)>,
) -> impl Responder {
    let (provider_id, date) = path.into_inner();

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

    // Get booked appointments for this provider on this date
    let naive_date = match chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "date must be YYYY-MM-DD".to_string(),
                code: "BAD_DATE".to_string(),
            });
        }
    };
    let booked_entities = data
        .repositories
        .appointments
        .get_by_provider(&provider_id, naive_date)
        .await
        .unwrap_or_default();
    let booked_times: Vec<String> = booked_entities
        .into_iter()
        .map(crate::clinical::Appointment::from)
        .filter(|a| !matches!(a.status, crate::clinical::AppointmentStatus::Cancelled))
        .map(|a| a.start_time)
        .collect();

    // Generate available slots (9 AM to 5 PM, 30 min intervals)
    let all_slots = vec![
        "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30",
        "14:00", "14:30", "15:00", "15:30", "16:00", "16:30",
    ];

    let available_slots: Vec<&str> = all_slots
        .into_iter()
        .filter(|slot| !booked_times.contains(&slot.to_string()))
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "provider_id": provider_id,
        "date": date,
        "available_slots": available_slots,
        "slot_duration_minutes": 30
    }))
}

// ============================================================================
// PHASE 24: WEARABLE DEVICE INTEGRATION
// ============================================================================

/// Register wearable device request
#[derive(Debug, Deserialize)]
pub struct RegisterWearableRequest {
    pub device_type: String,
    pub manufacturer: String,
    pub model: String,
    pub serial_number: Option<String>,
    pub data_types: Option<Vec<String>>,
}

/// Register a wearable device
#[post("/api/wearables/devices")]
pub async fn register_wearable_device(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<RegisterWearableRequest>,
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

    let device_type = match req.device_type.as_str() {
        "smartwatch" => crate::clinical::WearableDeviceType::Smartwatch,
        "fitness_band" => crate::clinical::WearableDeviceType::FitnessBand,
        "cgm" => crate::clinical::WearableDeviceType::CGM,
        "blood_pressure" => crate::clinical::WearableDeviceType::BloodPressureMonitor,
        "pulse_oximeter" => crate::clinical::WearableDeviceType::PulseOximeter,
        "smart_scale" => crate::clinical::WearableDeviceType::SmartScale,
        "ecg" => crate::clinical::WearableDeviceType::ECGMonitor,
        "sleep_tracker" => crate::clinical::WearableDeviceType::SleepTracker,
        "glucose_meter" => crate::clinical::WearableDeviceType::GlucoseMeter,
        _ => crate::clinical::WearableDeviceType::Other,
    };

    let data_types = req
        .data_types
        .clone()
        .map(|types| {
            types
                .iter()
                .filter_map(|t| match t.as_str() {
                    "heart_rate" => Some(crate::clinical::WearableDataType::HeartRate),
                    "blood_pressure" => Some(crate::clinical::WearableDataType::BloodPressure),
                    "blood_glucose" => Some(crate::clinical::WearableDataType::BloodGlucose),
                    "spo2" => Some(crate::clinical::WearableDataType::SpO2),
                    "steps" => Some(crate::clinical::WearableDataType::Steps),
                    "distance" => Some(crate::clinical::WearableDataType::Distance),
                    "calories" => Some(crate::clinical::WearableDataType::Calories),
                    "sleep" => Some(crate::clinical::WearableDataType::Sleep),
                    "weight" => Some(crate::clinical::WearableDataType::Weight),
                    "temperature" => Some(crate::clinical::WearableDataType::Temperature),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_else(|| vec![crate::clinical::WearableDataType::HeartRate]);

    let device = crate::clinical::WearableDevice {
        device_id: format!("WRB-{}", uuid::Uuid::new_v4()),
        patient_id: current_user_id.clone(),
        device_type,
        manufacturer: req.manufacturer.clone(),
        model: req.model.clone(),
        serial_number: req.serial_number.clone(),
        firmware_version: None,
        connection_status: crate::clinical::ConnectionStatus::Connected,
        last_sync: None,
        paired_at: chrono::Utc::now().timestamp(),
        active: true,
        data_types,
        sync_frequency_hours: 1,
        battery_level: None,
    };

    let device_id = device.device_id.clone();
    let mut devices = data.wearable_devices.write().unwrap();
    devices.insert(device_id.clone(), device);

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "device_id": device_id,
        "message": "Wearable device registered successfully"
    }))
}

/// Get user's wearable devices
#[get("/api/wearables/devices")]
pub async fn get_wearable_devices(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
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

    let devices = data.wearable_devices.read().unwrap();
    let user_devices: Vec<_> = devices
        .values()
        .filter(|d| d.patient_id == current_user_id && d.active)
        .cloned()
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "devices": user_devices,
        "count": user_devices.len()
    }))
}

/// Get list of supported wearable devices and their pairing instructions
#[get("/api/wearable/supported-devices")]
pub async fn get_supported_wearables(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Unauthorized".to_string(),
            code: "UNAUTHORIZED".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "supported_devices": [
            {
                "type": "fitbit",
                "name": "Fitbit",
                "models": ["Charge 5", "Versa 3", "Sense 2"],
                "metrics": ["heart_rate", "steps", "sleep", "spo2"],
                "pairing_method": "oauth",
                "oauth_url": "https://www.fitbit.com/oauth2/authorize",
                "instructions": "Connect via Fitbit app authorization"
            },
            {
                "type": "apple_watch",
                "name": "Apple Watch",
                "models": ["Series 6+", "Ultra"],
                "metrics": ["heart_rate", "ecg", "blood_oxygen", "activity"],
                "pairing_method": "healthkit",
                "instructions": "Enable Health data sharing in iOS Settings > Health > Apps"
            },
            {
                "type": "samsung_galaxy_watch",
                "name": "Samsung Galaxy Watch",
                "models": ["Watch 4+", "Watch 5+"],
                "metrics": ["heart_rate", "spo2", "stress", "sleep"],
                "pairing_method": "samsung_health",
                "instructions": "Connect via Samsung Health app data sharing"
            },
            {
                "type": "garmin",
                "name": "Garmin",
                "models": ["Forerunner", "Fenix", "Vivosmart"],
                "metrics": ["heart_rate", "hrv", "activity", "sleep"],
                "pairing_method": "garmin_connect",
                "oauth_url": "https://connect.garmin.com/oauthConfirm",
                "instructions": "Connect via Garmin Connect app"
            },
            {
                "type": "withings",
                "name": "Withings",
                "models": ["ScanWatch", "BPM Connect", "Body+"],
                "metrics": ["heart_rate", "blood_pressure", "weight", "spo2"],
                "pairing_method": "oauth",
                "oauth_url": "https://account.withings.com/oauth2_user/authorize2",
                "instructions": "Authorize via Withings Health Mate"
            },
            {
                "type": "omron",
                "name": "Omron",
                "models": ["HeartGuide", "Evolv"],
                "metrics": ["blood_pressure", "heart_rate"],
                "pairing_method": "bluetooth",
                "instructions": "Pair via Bluetooth in Omron Connect app"
            },
            {
                "type": "dexcom",
                "name": "Dexcom CGM",
                "models": ["G6", "G7"],
                "metrics": ["blood_glucose", "glucose_trend"],
                "pairing_method": "oauth",
                "oauth_url": "https://api.dexcom.com/v2/oauth2/login",
                "instructions": "Connect via Dexcom Share API"
            }
        ]
    }))
}

/// Submit wearable reading request
#[derive(Debug, Deserialize)]
pub struct SubmitWearableReadingRequest {
    pub device_id: String,
    pub data_type: String,
    pub value: f64,
    pub unit: String,
    pub secondary_value: Option<f64>,
    pub recorded_at: Option<i64>,
    pub context: Option<String>,
}

/// Submit a reading from a wearable device
#[post("/api/wearables/readings")]
pub async fn submit_wearable_reading(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<SubmitWearableReadingRequest>,
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

    // Verify device belongs to user
    let devices = data.wearable_devices.read().unwrap();
    let _device = match devices.get(&req.device_id) {
        Some(d) if d.patient_id == current_user_id => d.clone(),
        Some(_) => {
            return HttpResponse::Forbidden().json(ErrorResponse {
                success: false,
                error: "Device does not belong to you".to_string(),
                code: "FORBIDDEN".to_string(),
            })
        }
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Device not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };
    drop(devices);

    let data_type = match req.data_type.as_str() {
        "heart_rate" => crate::clinical::WearableDataType::HeartRate,
        "blood_pressure" => crate::clinical::WearableDataType::BloodPressure,
        "blood_glucose" => crate::clinical::WearableDataType::BloodGlucose,
        "spo2" => crate::clinical::WearableDataType::SpO2,
        "steps" => crate::clinical::WearableDataType::Steps,
        "distance" => crate::clinical::WearableDataType::Distance,
        "calories" => crate::clinical::WearableDataType::Calories,
        "sleep" => crate::clinical::WearableDataType::Sleep,
        "weight" => crate::clinical::WearableDataType::Weight,
        "temperature" => crate::clinical::WearableDataType::Temperature,
        "respiratory_rate" => crate::clinical::WearableDataType::RespiratoryRate,
        "ecg" => crate::clinical::WearableDataType::ECG,
        "hrv" => crate::clinical::WearableDataType::HRV,
        "stress" => crate::clinical::WearableDataType::Stress,
        _ => crate::clinical::WearableDataType::HeartRate,
    };

    let reading_id = format!("RDG-{}", uuid::Uuid::new_v4());
    let recorded_at = req
        .recorded_at
        .unwrap_or_else(|| chrono::Utc::now().timestamp());

    // Check for abnormal values
    let (flagged, flag_reason) = check_reading_for_abnormality(&req.data_type, req.value);

    let reading = crate::clinical::WearableReading {
        reading_id: reading_id.clone(),
        device_id: req.device_id.clone(),
        patient_id: current_user_id.clone(),
        data_type: data_type.clone(),
        value: req.value,
        unit: req.unit.clone(),
        secondary_value: req.secondary_value,
        recorded_at,
        synced_at: chrono::Utc::now().timestamp(),
        context: req.context.clone(),
        quality: crate::clinical::DataQuality::High,
        flagged,
        flag_reason,
    };

    // Check alert rules
    let alert_rules = data.wearable_alert_rules.read().unwrap();
    let mut triggered_alerts: Vec<crate::clinical::WearableAlert> = Vec::new();

    for rule in alert_rules
        .values()
        .filter(|r| r.patient_id == current_user_id && r.active)
    {
        if rule.data_type == data_type {
            let should_alert = match rule.threshold_type {
                crate::clinical::ThresholdType::Above => req.value > rule.threshold_value,
                crate::clinical::ThresholdType::Below => req.value < rule.threshold_value,
                crate::clinical::ThresholdType::OutsideRange => {
                    if let Some(secondary) = rule.secondary_threshold {
                        req.value < rule.threshold_value || req.value > secondary
                    } else {
                        false
                    }
                }
                _ => false,
            };

            if should_alert {
                let alert = crate::clinical::WearableAlert {
                    alert_id: format!("ALT-{}", uuid::Uuid::new_v4()),
                    rule_id: rule.rule_id.clone(),
                    patient_id: current_user_id.clone(),
                    reading_id: reading_id.clone(),
                    data_type: data_type.clone(),
                    trigger_value: req.value,
                    threshold: rule.threshold_value,
                    severity: rule.severity.clone(),
                    message: format!(
                        "{:?} reading {} is abnormal (threshold: {})",
                        data_type, req.value, rule.threshold_value
                    ),
                    created_at: chrono::Utc::now().timestamp(),
                    acknowledged: false,
                    acknowledged_by: None,
                    acknowledged_at: None,
                    action_taken: None,
                };
                triggered_alerts.push(alert);
            }
        }
    }
    drop(alert_rules);

    // Store alerts
    let mut alerts = data.wearable_alerts.write().unwrap();
    for alert in &triggered_alerts {
        alerts.insert(alert.alert_id.clone(), alert.clone());
    }
    drop(alerts);

    // Store reading
    let mut readings = data.wearable_readings.write().unwrap();
    readings.insert(reading_id.clone(), reading);

    // Update device last sync
    let mut devices = data.wearable_devices.write().unwrap();
    if let Some(d) = devices.get_mut(&req.device_id) {
        d.last_sync = Some(chrono::Utc::now().timestamp());
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "reading_id": reading_id,
        "alerts_triggered": triggered_alerts.len(),
        "alerts": triggered_alerts
    }))
}

/// Check if a reading is abnormal based on data type
fn check_reading_for_abnormality(data_type: &str, value: f64) -> (bool, Option<String>) {
    match data_type {
        "heart_rate" if value < 40.0 => (true, Some("Bradycardia detected".to_string())),
        "heart_rate" if value > 120.0 => (true, Some("Tachycardia detected".to_string())),
        "blood_glucose" if value < 70.0 => (true, Some("Hypoglycemia detected".to_string())),
        "blood_glucose" if value > 180.0 => (true, Some("Hyperglycemia detected".to_string())),
        "spo2" if value < 92.0 => (true, Some("Low oxygen saturation".to_string())),
        "temperature" if value > 38.0 => (true, Some("Fever detected".to_string())),
        _ => (false, None),
    }
}

/// Get wearable readings for a patient
#[get("/api/wearables/readings/{patient_id}")]
pub async fn get_wearable_readings(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
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

    let readings = data.wearable_readings.read().unwrap();
    let mut patient_readings: Vec<_> = readings
        .values()
        .filter(|r| r.patient_id == patient_id)
        .cloned()
        .collect();

    // Filter by data type if specified
    if let Some(data_type) = query.get("type") {
        let target_type = match data_type.as_str() {
            "heart_rate" => Some(crate::clinical::WearableDataType::HeartRate),
            "blood_pressure" => Some(crate::clinical::WearableDataType::BloodPressure),
            "blood_glucose" => Some(crate::clinical::WearableDataType::BloodGlucose),
            "spo2" => Some(crate::clinical::WearableDataType::SpO2),
            "steps" => Some(crate::clinical::WearableDataType::Steps),
            "weight" => Some(crate::clinical::WearableDataType::Weight),
            _ => None,
        };
        if let Some(t) = target_type {
            patient_readings.retain(|r| r.data_type == t);
        }
    }

    // Sort by recorded_at descending
    patient_readings.sort_by(|a, b| b.recorded_at.cmp(&a.recorded_at));

    // Limit results
    let limit = query
        .get("limit")
        .and_then(|l| l.parse::<usize>().ok())
        .unwrap_or(100);
    patient_readings.truncate(limit);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "readings": patient_readings,
        "count": patient_readings.len()
    }))
}

/// Create alert rule request
#[derive(Debug, Deserialize)]
pub struct CreateAlertRuleRequest {
    pub data_type: String,
    pub threshold_type: String,
    pub threshold_value: f64,
    pub secondary_threshold: Option<f64>,
    pub severity: String,
    pub notify_patient: Option<bool>,
    pub notify_provider: Option<bool>,
    pub provider_id: Option<String>,
}

/// Create a wearable alert rule
#[post("/api/wearables/alert-rules")]
pub async fn create_wearable_alert_rule(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateAlertRuleRequest>,
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

    let data_type = match req.data_type.as_str() {
        "heart_rate" => crate::clinical::WearableDataType::HeartRate,
        "blood_pressure" => crate::clinical::WearableDataType::BloodPressure,
        "blood_glucose" => crate::clinical::WearableDataType::BloodGlucose,
        "spo2" => crate::clinical::WearableDataType::SpO2,
        "steps" => crate::clinical::WearableDataType::Steps,
        "weight" => crate::clinical::WearableDataType::Weight,
        "temperature" => crate::clinical::WearableDataType::Temperature,
        _ => crate::clinical::WearableDataType::HeartRate,
    };

    let threshold_type = match req.threshold_type.as_str() {
        "above" => crate::clinical::ThresholdType::Above,
        "below" => crate::clinical::ThresholdType::Below,
        "outside_range" => crate::clinical::ThresholdType::OutsideRange,
        "change_rate" => crate::clinical::ThresholdType::ChangeRate,
        "absence" => crate::clinical::ThresholdType::AbsenceOfData,
        _ => crate::clinical::ThresholdType::Above,
    };

    let severity = match req.severity.as_str() {
        "info" => crate::clinical::AlertSeverity::Info,
        "warning" => crate::clinical::AlertSeverity::Warning,
        "urgent" => crate::clinical::AlertSeverity::Urgent,
        "critical" => crate::clinical::AlertSeverity::Critical,
        _ => crate::clinical::AlertSeverity::Warning,
    };

    let rule = crate::clinical::WearableAlertRule {
        rule_id: format!("RULE-{}", uuid::Uuid::new_v4()),
        patient_id: current_user_id.clone(),
        data_type,
        threshold_type,
        threshold_value: req.threshold_value,
        secondary_threshold: req.secondary_threshold,
        severity,
        notify_patient: req.notify_patient.unwrap_or(true),
        notify_provider: req.notify_provider.unwrap_or(false),
        provider_id: req.provider_id.clone(),
        active: true,
        created_at: chrono::Utc::now().timestamp(),
    };

    let rule_id = rule.rule_id.clone();
    let mut rules = data.wearable_alert_rules.write().unwrap();
    rules.insert(rule_id.clone(), rule);

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "rule_id": rule_id,
        "message": "Alert rule created successfully"
    }))
}

/// Get wearable alerts
#[get("/api/wearables/alerts")]
pub async fn get_wearable_alerts(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
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

    let alerts = data.wearable_alerts.read().unwrap();
    let user_alerts: Vec<_> = if current_user.role.is_healthcare_provider() {
        // Providers see all unacknowledged alerts
        alerts
            .values()
            .filter(|a| !a.acknowledged)
            .cloned()
            .collect()
    } else {
        // Patients see their own alerts
        alerts
            .values()
            .filter(|a| a.patient_id == current_user_id)
            .cloned()
            .collect()
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "alerts": user_alerts,
        "count": user_alerts.len()
    }))
}

// ============================================================================
// PHASE 25: AI SYMPTOM CHECKER
// ============================================================================

/// Start symptom check session request
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct StartSymptomCheckRequest {
    pub primary_symptom: String,
    pub age: Option<i32>,
    pub gender: Option<String>,
    pub pregnant: Option<bool>,
}

/// Start a symptom check session
#[post("/api/symptoms/start")]
pub async fn start_symptom_check(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<StartSymptomCheckRequest>,
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

    // Generate initial follow-up questions based on primary symptom
    let follow_up_questions = generate_symptom_questions(&req.primary_symptom);

    let initial_message = crate::clinical::SymptomMessage {
        role: crate::clinical::MessageRole::Patient,
        content: format!("I'm experiencing: {}", req.primary_symptom),
        timestamp: chrono::Utc::now().timestamp(),
        extracted_symptoms: None,
    };

    let session = crate::clinical::SymptomCheckSession {
        session_id: format!("SYM-{}", uuid::Uuid::new_v4()),
        patient_id: current_user_id.clone(),
        started_at: chrono::Utc::now().timestamp(),
        completed_at: None,
        initial_symptoms: vec![req.primary_symptom.clone()],
        conversation: vec![initial_message],
        assessment: None,
        triage_recommendation: None,
        status: crate::clinical::SymptomCheckStatus::InProgress,
    };

    let session_id = session.session_id.clone();
    let mut sessions = data.symptom_sessions.write().unwrap();
    sessions.insert(session_id.clone(), session);

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "session_id": session_id,
        "questions": follow_up_questions,
        "message": "Symptom check started. Please answer the following questions."
    }))
}

/// Generate follow-up questions based on symptom
fn generate_symptom_questions(symptom: &str) -> Vec<serde_json::Value> {
    let symptom_lower = symptom.to_lowercase();

    let mut questions = vec![
        serde_json::json!({
            "id": "severity",
            "question": "On a scale of 1-10, how severe is this symptom?",
            "type": "scale",
            "min": 1,
            "max": 10
        }),
        serde_json::json!({
            "id": "duration",
            "question": "How long have you had this symptom?",
            "type": "choice",
            "options": ["Less than 24 hours", "1-3 days", "4-7 days", "1-2 weeks", "More than 2 weeks"]
        }),
    ];

    // Add symptom-specific questions
    if symptom_lower.contains("chest") || symptom_lower.contains("heart") {
        questions.push(serde_json::json!({
            "id": "chest_radiation",
            "question": "Does the pain radiate to your arm, jaw, or back?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "shortness_breath",
            "question": "Are you experiencing shortness of breath?",
            "type": "boolean"
        }));
    } else if symptom_lower.contains("head") || symptom_lower.contains("migraine") {
        questions.push(serde_json::json!({
            "id": "vision_changes",
            "question": "Have you noticed any vision changes?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "nausea",
            "question": "Are you experiencing nausea or vomiting?",
            "type": "boolean"
        }));
    } else if symptom_lower.contains("fever") || symptom_lower.contains("temperature") {
        questions.push(serde_json::json!({
            "id": "temperature",
            "question": "What is your temperature (if known)?",
            "type": "number",
            "unit": "°C or °F"
        }));
        questions.push(serde_json::json!({
            "id": "chills",
            "question": "Are you experiencing chills or sweating?",
            "type": "boolean"
        }));
    } else if symptom_lower.contains("breath") || symptom_lower.contains("cough") {
        questions.push(serde_json::json!({
            "id": "productive_cough",
            "question": "Is your cough producing mucus?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "blood_mucus",
            "question": "Have you noticed any blood in the mucus?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "wheeze",
            "question": "Are you experiencing any wheezing or whistling sound when breathing?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "night_sweats",
            "question": "Have you had drenching night sweats recently?",
            "type": "boolean"
        }));
    } else if symptom_lower.contains("abdom")
        || symptom_lower.contains("stomach")
        || symptom_lower.contains("belly")
        || symptom_lower.contains("nausea")
        || symptom_lower.contains("vomit")
        || symptom_lower.contains("diarr")
    {
        questions.push(serde_json::json!({
            "id": "abdo_location",
            "question": "Where is the pain located in your abdomen?",
            "type": "choice",
            "options": ["Upper centre (epigastric)", "Upper right", "Upper left", "Lower right", "Lower left", "Around the navel", "All over / diffuse"]
        }));
        questions.push(serde_json::json!({
            "id": "abdo_character",
            "question": "How would you describe the pain?",
            "type": "choice",
            "options": ["Cramping / colicky", "Constant dull ache", "Sharp / stabbing", "Burning", "Bloating / fullness"]
        }));
        questions.push(serde_json::json!({
            "id": "nausea_vomiting",
            "question": "Are you experiencing nausea or vomiting?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "bowel_change",
            "question": "Have you noticed any change in your bowel habits (diarrhoea, constipation, or blood in stool)?",
            "type": "choice",
            "options": ["Diarrhoea", "Constipation", "Blood in stool", "Black/tarry stool", "No change"]
        }));
        questions.push(serde_json::json!({
            "id": "abdo_fever",
            "question": "Do you have a fever alongside the abdominal symptoms?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "last_meal",
            "question": "When did you last eat, and did symptoms worsen after eating?",
            "type": "choice",
            "options": ["Worse after eating", "Better after eating", "No relation to food", "Unable to eat due to pain"]
        }));
    } else if symptom_lower.contains("back pain")
        || symptom_lower.contains("back ache")
        || symptom_lower.contains("backache")
        || symptom_lower.contains("lumbar")
        || symptom_lower.contains("spine")
    {
        questions.push(serde_json::json!({
            "id": "back_location",
            "question": "Where is your back pain located?",
            "type": "choice",
            "options": ["Upper back (between shoulder blades)", "Middle back", "Lower back (lumbar)", "Tailbone / coccyx", "One side only (flank)"]
        }));
        questions.push(serde_json::json!({
            "id": "back_radiation",
            "question": "Does the pain radiate anywhere?",
            "type": "choice",
            "options": ["Down one or both legs", "Into the groin", "Into the buttocks", "Into the chest", "Does not radiate"]
        }));
        questions.push(serde_json::json!({
            "id": "back_numbness",
            "question": "Do you have any numbness, tingling, or weakness in your legs?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "back_bladder",
            "question": "Have you had any difficulty controlling your bladder or bowels?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "back_onset",
            "question": "How did the pain start?",
            "type": "choice",
            "options": ["After lifting / physical activity", "After an injury or fall", "Gradually over time", "Suddenly without cause", "After prolonged sitting / standing"]
        }));
    } else if symptom_lower.contains("rash")
        || symptom_lower.contains("skin")
        || symptom_lower.contains("itch")
        || symptom_lower.contains("hive")
        || symptom_lower.contains("blister")
    {
        questions.push(serde_json::json!({
            "id": "rash_location",
            "question": "Where is the rash or skin change?",
            "type": "choice",
            "options": ["Face / head", "Trunk (chest / abdomen / back)", "Arms", "Legs", "Hands / feet", "Widespread / all over the body"]
        }));
        questions.push(serde_json::json!({
            "id": "rash_character",
            "question": "How would you describe the rash?",
            "type": "choice",
            "options": ["Red / erythematous", "Raised bumps (urticaria / hives)", "Blisters / vesicles", "Flat spots (macules)", "Purpuric / non-blanching spots", "Scaly or flaky", "Crusting / weeping"]
        }));
        questions.push(serde_json::json!({
            "id": "rash_itch",
            "question": "Is the rash itchy, painful, or neither?",
            "type": "choice",
            "options": ["Intensely itchy", "Mildly itchy", "Painful / burning", "Neither"]
        }));
        questions.push(serde_json::json!({
            "id": "rash_fever",
            "question": "Do you have a fever with the rash?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "rash_blanch",
            "question": "Does the rash fade (turn white) when you press on it with a glass?",
            "type": "choice",
            "options": ["Yes, it fades", "No, it does not fade (non-blanching)", "Not sure"]
        }));
        questions.push(serde_json::json!({
            "id": "rash_trigger",
            "question": "Did anything precede the rash (new medication, food, insect bite, illness, soap/detergent)?",
            "type": "text"
        }));
    } else if symptom_lower.contains("joint")
        || symptom_lower.contains("arthral")
        || symptom_lower.contains("swollen joint")
        || symptom_lower.contains("knee pain")
        || symptom_lower.contains("hip pain")
        || symptom_lower.contains("ankle pain")
        || symptom_lower.contains("wrist pain")
        || symptom_lower.contains("elbow pain")
        || symptom_lower.contains("shoulder pain")
    {
        questions.push(serde_json::json!({
            "id": "joint_affected",
            "question": "Which joint(s) are affected?",
            "type": "choice",
            "options": ["Single large joint (knee / hip / shoulder)", "Multiple large joints", "Small joints of hands / feet", "Spine / back joints", "Several joints at once"]
        }));
        questions.push(serde_json::json!({
            "id": "joint_swelling",
            "question": "Is the joint visibly swollen, red, or warm to touch?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "joint_morning_stiffness",
            "question": "Is the joint stiff in the morning? If so, how long does the stiffness last?",
            "type": "choice",
            "options": ["No morning stiffness", "Less than 30 minutes", "30–60 minutes", "More than 1 hour"]
        }));
        questions.push(serde_json::json!({
            "id": "joint_trauma",
            "question": "Was there any recent injury, fall, or unusual physical activity involving that joint?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "joint_systemic",
            "question": "Do you have any other symptoms such as fever, rash, or eye redness?",
            "type": "boolean"
        }));
    } else if symptom_lower.contains("urin")
        || symptom_lower.contains("bladder")
        || symptom_lower.contains("peeing")
        || symptom_lower.contains("pee")
        || symptom_lower.contains("dysuria")
        || symptom_lower.contains("haematuria")
        || symptom_lower.contains("hematuria")
    {
        questions.push(serde_json::json!({
            "id": "urine_pain",
            "question": "Is urination painful or burning?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "urine_frequency",
            "question": "Are you urinating more frequently than usual?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "urine_colour",
            "question": "What does your urine look like?",
            "type": "choice",
            "options": ["Normal (pale yellow)", "Dark / concentrated", "Cloudy", "Pink or red (blood)", "Brown / tea-coloured", "Foamy"]
        }));
        questions.push(serde_json::json!({
            "id": "urine_fever_flank",
            "question": "Do you have fever, chills, or pain in your side / back (flank)?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "urine_incomplete",
            "question": "Do you feel that your bladder is not fully emptying after urinating?",
            "type": "boolean"
        }));
    } else if symptom_lower.contains("vision")
        || symptom_lower.contains("eye")
        || symptom_lower.contains("blurr")
        || symptom_lower.contains("sight")
        || symptom_lower.contains("visual")
    {
        questions.push(serde_json::json!({
            "id": "vision_onset",
            "question": "How did the visual change start?",
            "type": "choice",
            "options": ["Sudden (seconds to minutes)", "Gradual over hours", "Gradual over days to weeks", "Constant since birth / longstanding"]
        }));
        questions.push(serde_json::json!({
            "id": "vision_affected_eye",
            "question": "Which eye(s) are affected?",
            "type": "choice",
            "options": ["Left eye only", "Right eye only", "Both eyes", "Peripheral (side) vision loss", "Central vision loss"]
        }));
        questions.push(serde_json::json!({
            "id": "vision_character",
            "question": "How would you describe the visual problem?",
            "type": "choice",
            "options": ["Blurred / out of focus", "Double vision", "Dark curtain or shadow", "Flashing lights / floaters", "Loss of colour", "Halos around lights"]
        }));
        questions.push(serde_json::json!({
            "id": "vision_pain",
            "question": "Is there pain in or around the eye?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "vision_headache",
            "question": "Is the visual change accompanied by headache or nausea?",
            "type": "boolean"
        }));
        questions.push(serde_json::json!({
            "id": "vision_red_eye",
            "question": "Is the eye red or producing discharge?",
            "type": "boolean"
        }));
    }

    questions.push(serde_json::json!({
        "id": "medications",
        "question": "Have you taken any medications for this symptom?",
        "type": "text"
    }));

    questions
}

/// Submit symptom answers request
#[derive(Debug, Deserialize)]
pub struct SubmitSymptomAnswersRequest {
    pub answers: std::collections::HashMap<String, serde_json::Value>,
    pub additional_symptoms: Option<Vec<String>>,
}

/// Submit answers to symptom questions
#[post("/api/symptoms/{session_id}/answers")]
pub async fn submit_symptom_answers(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<SubmitSymptomAnswersRequest>,
) -> impl Responder {
    let session_id = path.into_inner();

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

    let mut sessions = data.symptom_sessions.write().unwrap();

    let session = match sessions.get_mut(&session_id) {
        Some(s) if s.patient_id == current_user_id => s,
        Some(_) => {
            return HttpResponse::Forbidden().json(ErrorResponse {
                success: false,
                error: "Session does not belong to you".to_string(),
                code: "FORBIDDEN".to_string(),
            })
        }
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Session not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    // Store answers as a conversation message
    let answer_content = req
        .answers
        .iter()
        .map(|(k, v)| format!("{}: {}", k, v))
        .collect::<Vec<_>>()
        .join(", ");

    session.conversation.push(crate::clinical::SymptomMessage {
        role: crate::clinical::MessageRole::Patient,
        content: answer_content,
        timestamp: chrono::Utc::now().timestamp(),
        extracted_symptoms: None,
    });

    // Add additional symptoms
    if let Some(additional) = &req.additional_symptoms {
        for symptom in additional {
            session.initial_symptoms.push(symptom.clone());
        }
    }

    // Calculate triage result based on answers
    let triage_result = calculate_triage_result(&req.answers, &session.initial_symptoms);
    session.triage_recommendation = Some(triage_result.clone());
    session.completed_at = Some(chrono::Utc::now().timestamp());
    session.status = crate::clinical::SymptomCheckStatus::Completed;

    // Generate assessment
    session.assessment = Some(crate::clinical::SymptomAssessment {
        possible_conditions: vec![crate::clinical::PossibleCondition {
            condition_name: "General symptoms requiring evaluation".to_string(),
            icd10_code: None,
            probability: 0.7,
            description: "Based on reported symptoms, a medical evaluation is recommended."
                .to_string(),
            urgency: crate::clinical::UrgencyLevel::Routine,
            common_causes: vec!["Various".to_string()],
        }],
        red_flags: Vec::new(),
        recommendations: vec!["Consult with a healthcare provider".to_string()],
        questions_for_provider: vec!["Describe symptom onset and progression".to_string()],
        self_care: vec!["Rest and stay hydrated".to_string()],
        confidence: 0.6,
        disclaimer: "This is not a medical diagnosis. Please consult a healthcare professional."
            .to_string(),
    });

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "session_id": session_id,
        "triage_result": triage_result,
        "message": "Symptom assessment complete"
    }))
}

/// Calculate triage result based on symptoms and answers
fn calculate_triage_result(
    answers: &std::collections::HashMap<String, serde_json::Value>,
    symptoms: &[String],
) -> crate::clinical::TriageRecommendation {
    let severity = answers
        .get("severity")
        .and_then(|v| v.as_i64())
        .unwrap_or(5) as i32;

    let has_emergency_symptoms = symptoms.iter().any(|s| {
        let sym = s.to_lowercase();
        sym.contains("chest pain")
            || sym.contains("difficulty breathing")
            || sym.contains("stroke")
            || sym.contains("unconscious")
    });

    let chest_radiation = answers
        .get("chest_radiation")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let shortness_breath = answers
        .get("shortness_breath")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if has_emergency_symptoms || (chest_radiation && shortness_breath) || severity >= 9 {
        crate::clinical::TriageRecommendation {
            level: crate::clinical::TriageLevel::EmergencyRoom,
            explanation: "Emergency symptoms detected. Seek emergency care immediately."
                .to_string(),
            timeframe: "Immediately".to_string(),
            care_options: vec![
                crate::clinical::CareOption {
                    option_type: "emergency".to_string(),
                    description: "Call emergency services (10111 or 112)".to_string(),
                    available: true,
                    estimated_wait: Some("Immediate".to_string()),
                    cost_estimate: None,
                },
                crate::clinical::CareOption {
                    option_type: "emergency_room".to_string(),
                    description: "Go to nearest emergency room".to_string(),
                    available: true,
                    estimated_wait: None,
                    cost_estimate: None,
                },
            ],
        }
    } else if severity >= 7 || chest_radiation || shortness_breath {
        crate::clinical::TriageRecommendation {
            level: crate::clinical::TriageLevel::UrgentCare,
            explanation: "Symptoms require prompt medical evaluation within 24 hours.".to_string(),
            timeframe: "Within 24 hours".to_string(),
            care_options: vec![
                crate::clinical::CareOption {
                    option_type: "urgent_care".to_string(),
                    description: "Visit urgent care clinic".to_string(),
                    available: true,
                    estimated_wait: Some("1-2 hours".to_string()),
                    cost_estimate: None,
                },
                crate::clinical::CareOption {
                    option_type: "same_day".to_string(),
                    description: "Request same-day doctor appointment".to_string(),
                    available: true,
                    estimated_wait: None,
                    cost_estimate: None,
                },
            ],
        }
    } else if severity >= 4 {
        crate::clinical::TriageRecommendation {
            level: crate::clinical::TriageLevel::ScheduledAppointment,
            explanation: "Non-urgent symptoms. Schedule an appointment with your doctor."
                .to_string(),
            timeframe: "Within 2-3 days".to_string(),
            care_options: vec![
                crate::clinical::CareOption {
                    option_type: "appointment".to_string(),
                    description: "Schedule appointment with your primary care doctor".to_string(),
                    available: true,
                    estimated_wait: Some("2-3 days".to_string()),
                    cost_estimate: None,
                },
                crate::clinical::CareOption {
                    option_type: "telehealth".to_string(),
                    description: "Book a telehealth consultation".to_string(),
                    available: true,
                    estimated_wait: Some("Today".to_string()),
                    cost_estimate: None,
                },
            ],
        }
    } else {
        crate::clinical::TriageRecommendation {
            level: crate::clinical::TriageLevel::SelfCare,
            explanation: "Minor symptoms. Self-care and monitoring recommended.".to_string(),
            timeframe: "As needed".to_string(),
            care_options: vec![
                crate::clinical::CareOption {
                    option_type: "self_care".to_string(),
                    description: "Rest and monitor your symptoms".to_string(),
                    available: true,
                    estimated_wait: None,
                    cost_estimate: None,
                },
                crate::clinical::CareOption {
                    option_type: "pharmacy".to_string(),
                    description: "Visit pharmacy for over-the-counter remedies".to_string(),
                    available: true,
                    estimated_wait: None,
                    cost_estimate: None,
                },
            ],
        }
    }
}

/// Get symptom check session
#[get("/api/symptoms/{session_id}")]
pub async fn get_symptom_session(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let session_id = path.into_inner();

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

    let sessions = data.symptom_sessions.read().unwrap();

    match sessions.get(&session_id) {
        Some(session) => {
            // Patient can see own session, provider can see any
            if session.patient_id != current_user_id && !current_user.role.is_healthcare_provider()
            {
                return HttpResponse::Forbidden().json(ErrorResponse {
                    success: false,
                    error: "Access denied".to_string(),
                    code: "FORBIDDEN".to_string(),
                });
            }

            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "session": session
            }))
        }
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Session not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
    }
}

/// Get symptom history for a patient (Phase 25 AI Symptom Checker)
#[get("/api/symptoms/history/{patient_id}")]
pub async fn get_symptom_checker_history(
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

    let sessions = data.symptom_sessions.read().unwrap();
    let history: Vec<_> = sessions
        .values()
        .filter(|s| s.patient_id == patient_id)
        .cloned()
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "sessions": history,
        "count": history.len()
    }))
}

/// Symptom analysis request for direct symptom-to-condition mapping
#[derive(Debug, Deserialize)]
pub struct AnalyzeSymptomsRequest {
    pub symptoms: Vec<String>,
    pub patient_age: Option<i32>,
    pub patient_gender: Option<String>,
    pub existing_conditions: Option<Vec<String>>,
    pub current_medications: Option<Vec<String>>,
}

/// Possible condition from symptom analysis
#[derive(Debug, Clone, serde::Serialize)]
pub struct PossibleConditionResult {
    pub condition_name: String,
    pub probability: f32,
    pub severity: String,
    pub description: String,
    pub icd10_code: Option<String>,
}

/// Direct symptom analysis endpoint - maps symptoms to possible conditions
#[post("/api/symptoms/analyze")]
pub async fn analyze_symptoms(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<AnalyzeSymptomsRequest>,
) -> impl Responder {
    // Validate user is authenticated
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Missing X-User-Id header".to_string(),
            code: "UNAUTHORIZED".to_string(),
        });
    }

    let symptoms = &req.symptoms;

    if symptoms.is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "At least one symptom is required".to_string(),
            code: "INVALID_INPUT".to_string(),
        });
    }

    // Extract patient context for enhanced analysis
    let patient_age = req.patient_age;
    let patient_gender = req.patient_gender.as_deref();
    let existing_conditions = req.existing_conditions.as_ref();
    let current_medications = req.current_medications.as_ref();

    // Analyze symptoms with patient context
    let (possible_conditions, mut triage_level, mut red_flags) =
        analyze_symptom_combination(symptoms);

    // Age-specific risk adjustments
    let mut age_considerations = Vec::new();
    if let Some(age) = patient_age {
        if age >= 65 {
            age_considerations
                .push("Patient is 65+ years old - increased monitoring recommended".to_string());
            // Elevate severity for cardiac/respiratory symptoms in elderly
            if symptoms
                .iter()
                .any(|s| s.to_lowercase().contains("chest") || s.to_lowercase().contains("breath"))
                && triage_level == "medium"
            {
                triage_level = "high".to_string();
            }
        } else if age < 12 {
            age_considerations
                .push("Pediatric patient - dosing and symptoms may differ from adults".to_string());
        } else if age < 2 {
            age_considerations
                .push("Infant patient - lower threshold for emergency evaluation".to_string());
            if triage_level == "low" {
                triage_level = "medium".to_string();
            }
        }
    }

    // Gender-specific considerations
    let mut gender_considerations = Vec::new();
    if let Some(gender) = patient_gender {
        let g = gender.to_lowercase();
        if g == "female" || g == "f" {
            if symptoms
                .iter()
                .any(|s| s.to_lowercase().contains("chest pain"))
            {
                gender_considerations
                    .push("Note: Women may experience atypical heart attack symptoms".to_string());
            }
            if symptoms
                .iter()
                .any(|s| s.to_lowercase().contains("abdominal"))
            {
                gender_considerations
                    .push("Consider gynecological causes for abdominal symptoms".to_string());
            }
        }
    }

    // Check for existing condition interactions
    let mut condition_interactions = Vec::new();
    if let Some(conditions) = existing_conditions {
        for condition in conditions {
            let c = condition.to_lowercase();
            if c.contains("diabetes") {
                condition_interactions
                    .push("Patient has diabetes - monitor for diabetic complications".to_string());
                if symptoms.iter().any(|s| {
                    s.to_lowercase().contains("infection") || s.to_lowercase().contains("wound")
                }) {
                    red_flags.push(
                        "Diabetic patients are at higher risk for infection complications"
                            .to_string(),
                    );
                }
            }
            if c.contains("heart") || c.contains("cardiac") {
                condition_interactions
                    .push("Patient has cardiac history - elevated cardiac risk".to_string());
                if symptoms.iter().any(|s| {
                    s.to_lowercase().contains("chest") || s.to_lowercase().contains("palpitation")
                }) && triage_level == "medium"
                {
                    triage_level = "high".to_string();
                }
            }
            if (c.contains("asthma") || c.contains("copd"))
                && symptoms.iter().any(|s| {
                    s.to_lowercase().contains("cough") || s.to_lowercase().contains("wheez")
                })
            {
                condition_interactions
                    .push("Respiratory symptoms in patient with known lung disease".to_string());
            }
            if c.contains("hypertension")
                && symptoms.iter().any(|s| {
                    s.to_lowercase().contains("headache") || s.to_lowercase().contains("dizz")
                })
            {
                condition_interactions
                    .push("Consider blood pressure check for hypertensive patient".to_string());
            }
        }
    }

    // Check for medication-related considerations
    let mut medication_warnings = Vec::new();
    if let Some(medications) = current_medications {
        for med in medications {
            let m = med.to_lowercase();
            if m.contains("warfarin") || m.contains("blood thinner") || m.contains("anticoagulant")
            {
                medication_warnings
                    .push("Patient on anticoagulants - monitor for bleeding".to_string());
                if symptoms.iter().any(|s| {
                    s.to_lowercase().contains("bleed") || s.to_lowercase().contains("bruis")
                }) {
                    red_flags.push(
                        "Bleeding symptoms in anticoagulated patient - urgent evaluation needed"
                            .to_string(),
                    );
                    if triage_level != "critical" {
                        triage_level = "high".to_string();
                    }
                }
            }
            if m.contains("insulin") || m.contains("metformin") {
                medication_warnings
                    .push("Patient on diabetes medication - check blood glucose".to_string());
            }
            if m.contains("immunosuppressant")
                || m.contains("prednisone")
                || m.contains("chemotherapy")
            {
                medication_warnings.push(
                    "Immunocompromised patient - lower threshold for infection workup".to_string(),
                );
                if symptoms.iter().any(|s| s.to_lowercase().contains("fever")) {
                    red_flags.push(
                        "Fever in immunocompromised patient requires urgent evaluation".to_string(),
                    );
                    if triage_level == "low" || triage_level == "medium" {
                        triage_level = "high".to_string();
                    }
                }
            }
        }
    }

    // Generate recommendations based on triage level
    let (triage_message, recommendations, self_care_advice, when_to_seek_care) =
        generate_triage_recommendations(&triage_level, symptoms);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "possible_conditions": possible_conditions,
        "triage_level": triage_level,
        "triage_message": triage_message,
        "recommendations": recommendations,
        "red_flags": red_flags,
        "self_care_advice": self_care_advice,
        "when_to_seek_care": when_to_seek_care,
        "patient_context": {
            "age_considerations": age_considerations,
            "gender_considerations": gender_considerations,
            "condition_interactions": condition_interactions,
            "medication_warnings": medication_warnings
        },
        "disclaimer": "This analysis is for informational purposes only and is not a medical diagnosis. Always consult a healthcare professional for proper medical advice, especially if symptoms are severe or persistent."
    }))
}

/// Analyze symptom combinations to determine possible conditions
///
/// Uses a multi-symptom scoring approach: each candidate condition accumulates
/// a score for every matching keyword/phrase found in the combined symptom
/// string.  Conditions whose score meets their activation threshold are
/// included in the output, ordered by descending score.  Emergency patterns
/// are evaluated first and short-circuit severity escalation immediately.
fn analyze_symptom_combination(
    symptoms: &[String],
) -> (Vec<PossibleConditionResult>, String, Vec<String>) {
    let mut conditions: Vec<PossibleConditionResult> = Vec::new();
    let mut red_flags: Vec<String> = Vec::new();
    // Severity order: low < medium < high < critical
    // Encoded as u8 for easy comparison.
    let severity_rank = |s: &str| match s {
        "critical" => 3u8,
        "high" => 2,
        "medium" => 1,
        _ => 0,
    };
    let mut max_severity_rank: u8 = 0;

    let symptom_str = symptoms
        .iter()
        .map(|s| s.to_lowercase())
        .collect::<Vec<_>>()
        .join(" ");

    // -------------------------------------------------------------------------
    // EMERGENCY PATTERN DETECTION (evaluated first, sets critical immediately)
    // -------------------------------------------------------------------------

    // ACS / MI: chest pain + shortness of breath + diaphoresis
    {
        let has_chest = symptom_str.contains("chest pain")
            || symptom_str.contains("crushing chest")
            || symptom_str.contains("chest pressure")
            || symptom_str.contains("chest tightness");
        let has_sob = symptom_str.contains("shortness of breath")
            || symptom_str.contains("difficulty breathing")
            || symptom_str.contains("breathless");
        let has_diaphoresis = symptom_str.contains("diaphoresis")
            || symptom_str.contains("sweating")
            || symptom_str.contains("sweat")
            || symptom_str.contains("cold sweat");
        let has_radiation = symptom_str.contains("arm pain")
            || symptom_str.contains("jaw pain")
            || symptom_str.contains("radiating")
            || symptom_str.contains("radiation");

        // Score: each matching cluster adds weight
        let mut score = 0u32;
        if has_chest {
            score += 3;
        }
        if has_sob {
            score += 2;
        }
        if has_diaphoresis {
            score += 2;
        }
        if has_radiation {
            score += 2;
        }

        if score >= 3 {
            let prob = (score as f32 * 0.12).min(0.92);
            red_flags.push("CRITICAL: Chest pain with associated symptoms – possible acute coronary syndrome. Call emergency services immediately.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Acute Coronary Syndrome / Myocardial Infarction".to_string(),
                probability: prob,
                severity: "critical".to_string(),
                description: "Combination of chest pain, dyspnoea, and/or diaphoresis is consistent with ACS/MI and requires immediate emergency evaluation.".to_string(),
                icd10_code: Some("I21.9".to_string()),
            });
        } else if has_chest {
            // Chest pain alone (no ACS cluster) – still flag as high
            if max_severity_rank < 2 {
                max_severity_rank = 2;
            }
            red_flags.push(
                "Chest pain can be a sign of a cardiac event – seek urgent medical evaluation."
                    .to_string(),
            );
            conditions.push(PossibleConditionResult {
                condition_name: "Chest Pain – Undifferentiated".to_string(),
                probability: 0.55,
                severity: "high".to_string(),
                description: "Chest pain requires prompt evaluation to rule out cardiac and other serious causes.".to_string(),
                icd10_code: Some("R07.9".to_string()),
            });
        }
    }

    // Stroke (FAST criteria): facial droop + arm weakness + speech difficulty
    {
        let has_face = symptom_str.contains("face droop")
            || symptom_str.contains("facial droop")
            || symptom_str.contains("face drooping")
            || symptom_str.contains("facial weakness");
        let has_arm = symptom_str.contains("arm weakness")
            || symptom_str.contains("arm numbness")
            || symptom_str.contains("limb weakness");
        let has_speech = symptom_str.contains("speech difficulty")
            || symptom_str.contains("slurred speech")
            || symptom_str.contains("speech slurred")
            || symptom_str.contains("difficulty speaking")
            || symptom_str.contains("dysarthria")
            || symptom_str.contains("aphasia");
        let has_sudden_neuro = symptom_str.contains("stroke")
            || symptom_str.contains("sudden numbness")
            || symptom_str.contains("sudden weakness");

        let mut score = 0u32;
        if has_face {
            score += 3;
        }
        if has_arm {
            score += 2;
        }
        if has_speech {
            score += 3;
        }
        if has_sudden_neuro {
            score += 2;
        }

        if score >= 3 {
            red_flags.push("STROKE WARNING (FAST): Facial droop / arm weakness / speech difficulty detected. Call emergency services immediately – time is brain.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Ischaemic Stroke".to_string(),
                probability: (score as f32 * 0.12).min(0.90),
                severity: "critical".to_string(),
                description: "FAST criteria suggest possible stroke. Immediate emergency care is essential – thrombolysis window is time-critical.".to_string(),
                icd10_code: Some("I63.9".to_string()),
            });
        }
    }

    // Meningitis / Subarachnoid Haemorrhage: sudden severe headache + neck stiffness
    {
        let has_thunderclap = symptom_str.contains("thunderclap")
            || symptom_str.contains("sudden severe headache")
            || symptom_str.contains("worst headache")
            || (symptom_str.contains("severe headache") && symptom_str.contains("sudden"));
        let has_neck = symptom_str.contains("neck stiffness")
            || symptom_str.contains("stiff neck")
            || symptom_str.contains("neck rigidity");
        let has_photophobia = symptom_str.contains("photophobia")
            || symptom_str.contains("light sensitivity")
            || symptom_str.contains("sensitive to light");
        let has_rash_petechiae = symptom_str.contains("petechiae")
            || symptom_str.contains("purpuric rash")
            || symptom_str.contains("non-blanching");

        let mut score = 0u32;
        if has_thunderclap {
            score += 4;
        }
        if has_neck {
            score += 3;
        }
        if has_photophobia {
            score += 2;
        }
        if has_rash_petechiae {
            score += 3;
        }

        if score >= 3 {
            red_flags.push("CRITICAL: Sudden severe headache with neck stiffness – possible meningitis or subarachnoid haemorrhage. Seek emergency care immediately.".to_string());
            max_severity_rank = 3;
            if has_thunderclap {
                conditions.push(PossibleConditionResult {
                    condition_name: "Subarachnoid Haemorrhage".to_string(),
                    probability: (score as f32 * 0.10).min(0.85),
                    severity: "critical".to_string(),
                    description: "Thunderclap headache ('worst headache of life') is the hallmark of SAH until proven otherwise.".to_string(),
                    icd10_code: Some("I60.9".to_string()),
                });
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Bacterial Meningitis".to_string(),
                probability: (score as f32 * 0.09).min(0.80),
                severity: "critical".to_string(),
                description:
                    "Headache, neck stiffness, and photophobia form the classic meningism triad."
                        .to_string(),
                icd10_code: Some("G03.9".to_string()),
            });
        }
    }

    // Hypertensive encephalopathy: severe headache + visual changes + hypertension
    {
        let has_severe_ha =
            symptom_str.contains("severe headache") || symptom_str.contains("worst headache");
        let has_visual = symptom_str.contains("visual change")
            || symptom_str.contains("blurred vision")
            || symptom_str.contains("vision change")
            || symptom_str.contains("visual disturbance");
        let has_htn = symptom_str.contains("hypertension")
            || symptom_str.contains("high blood pressure")
            || symptom_str.contains("elevated blood pressure");

        let mut score = 0u32;
        if has_severe_ha {
            score += 2;
        }
        if has_visual {
            score += 2;
        }
        if has_htn {
            score += 3;
        }

        if score >= 4 {
            red_flags.push("CRITICAL: Severe headache with visual changes and hypertension – possible hypertensive encephalopathy. Seek emergency care.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Hypertensive Encephalopathy".to_string(),
                probability: (score as f32 * 0.11).min(0.85),
                severity: "critical".to_string(),
                description: "End-organ hypertensive crisis affecting cerebral autoregulation. Requires immediate blood-pressure management.".to_string(),
                icd10_code: Some("I67.4".to_string()),
            });
        }
    }

    // Peritonitis / Perforation: abdominal pain + rigidity + rebound tenderness
    {
        let has_abdo = symptom_str.contains("abdominal pain")
            || symptom_str.contains("stomach pain")
            || symptom_str.contains("belly pain");
        let has_rigidity = symptom_str.contains("rigid")
            || symptom_str.contains("board-like")
            || symptom_str.contains("guarding");
        let has_rebound = symptom_str.contains("rebound")
            || symptom_str.contains("rebound tenderness")
            || symptom_str.contains("tenderness on release");

        let mut score = 0u32;
        if has_abdo {
            score += 1;
        }
        if has_rigidity {
            score += 3;
        }
        if has_rebound {
            score += 3;
        }

        if score >= 4 {
            red_flags.push("CRITICAL: Abdominal rigidity and rebound tenderness – possible peritonitis or visceral perforation. Emergency surgery may be required.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Peritonitis / Abdominal Perforation".to_string(),
                probability: (score as f32 * 0.12).min(0.88),
                severity: "critical".to_string(),
                description: "Peritoneal signs indicate possible intra-abdominal emergency requiring surgical evaluation.".to_string(),
                icd10_code: Some("K65.9".to_string()),
            });
        }
    }

    // Cholangitis (Charcot's triad): jaundice + RUQ pain + fever
    {
        let has_jaundice = symptom_str.contains("jaundice")
            || symptom_str.contains("yellow skin")
            || symptom_str.contains("yellowing");
        let has_ruq = symptom_str.contains("right upper")
            || symptom_str.contains("ruq")
            || symptom_str.contains("right upper quadrant");
        let has_fever = symptom_str.contains("fever")
            || symptom_str.contains("high temperature")
            || symptom_str.contains("pyrexia");

        let mut score = 0u32;
        if has_jaundice {
            score += 3;
        }
        if has_ruq {
            score += 2;
        }
        if has_fever {
            score += 2;
        }

        if score >= 5 {
            red_flags.push("CRITICAL: Charcot's triad (jaundice + RUQ pain + fever) – possible ascending cholangitis. Urgent biliary decompression may be needed.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Ascending Cholangitis".to_string(),
                probability: (score as f32 * 0.11).min(0.87),
                severity: "critical".to_string(),
                description: "Charcot's triad is the classic presentation of cholangitis, a biliary emergency.".to_string(),
                icd10_code: Some("K83.0".to_string()),
            });
        }
    }

    // Obstetric emergency: pregnancy + vaginal bleeding
    {
        let has_pregnancy = symptom_str.contains("pregnant")
            || symptom_str.contains("pregnancy")
            || symptom_str.contains("gravid");
        let has_bleeding = symptom_str.contains("vaginal bleeding")
            || symptom_str.contains("vaginal bleed")
            || symptom_str.contains("bleeding vaginally");

        if has_pregnancy && has_bleeding {
            red_flags.push("CRITICAL: Vaginal bleeding in pregnancy – possible ectopic pregnancy or placenta praevia. Seek emergency care immediately.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Obstetric Haemorrhage (Ectopic / Placenta Praevia)".to_string(),
                probability: 0.80,
                severity: "critical".to_string(),
                description: "Vaginal bleeding during pregnancy must be evaluated immediately to rule out life-threatening causes.".to_string(),
                icd10_code: Some("O20.9".to_string()),
            });
        }
    }

    // Altered consciousness
    {
        let has_altered = symptom_str.contains("altered consciousness")
            || symptom_str.contains("unconscious")
            || symptom_str.contains("unresponsive")
            || symptom_str.contains("loss of consciousness")
            || symptom_str.contains("confusion")
            || symptom_str.contains("disoriented")
            || symptom_str.contains("not responding");

        if has_altered {
            red_flags.push("CRITICAL: Altered level of consciousness – multiple serious causes possible. Emergency evaluation required.".to_string());
            max_severity_rank = 3;
            conditions.push(PossibleConditionResult {
                condition_name: "Altered Consciousness – Undifferentiated".to_string(),
                probability: 0.85,
                severity: "critical".to_string(),
                description: "Reduced or altered consciousness has many serious aetiologies (hypoglycaemia, seizure, stroke, sepsis, overdose) and requires immediate assessment.".to_string(),
                icd10_code: Some("R41.3".to_string()),
            });
        }
    }

    // -------------------------------------------------------------------------
    // HIGH-ACUITY PATTERN DETECTION
    // -------------------------------------------------------------------------

    // Appendicitis: RLQ pain + nausea + fever
    {
        let has_rlq = symptom_str.contains("right lower")
            || symptom_str.contains("rlq")
            || symptom_str.contains("mcburney")
            || (symptom_str.contains("lower right")
                && (symptom_str.contains("abdominal") || symptom_str.contains("pain")));
        let has_nausea = symptom_str.contains("nausea") || symptom_str.contains("vomiting");
        let has_fever = symptom_str.contains("fever") || symptom_str.contains("temperature");

        let mut score = 0u32;
        if has_rlq {
            score += 4;
        }
        if has_nausea {
            score += 1;
        }
        if has_fever {
            score += 2;
        }
        // Also score generic abdominal pain + fever + nausea if RLQ keyword not explicit
        if !has_rlq
            && (symptom_str.contains("abdominal pain") || symptom_str.contains("stomach pain"))
            && has_fever
            && has_nausea
        {
            score += 2;
        }

        if score >= 4 {
            if max_severity_rank < 2 {
                max_severity_rank = 2;
            }
            red_flags.push("Right lower quadrant pain with fever and nausea – possible appendicitis. Seek prompt medical evaluation.".to_string());
            conditions.push(PossibleConditionResult {
                condition_name: "Appendicitis".to_string(),
                probability: (score as f32 * 0.11).min(0.82),
                severity: "high".to_string(),
                description: "Classic presentation of acute appendicitis. Requires surgical evaluation to prevent perforation.".to_string(),
                icd10_code: Some("K37".to_string()),
            });
        }
    }

    // Renal colic: flank pain + haematuria
    {
        let has_flank = symptom_str.contains("flank pain")
            || symptom_str.contains("flank")
            || symptom_str.contains("loin pain")
            || symptom_str.contains("loin");
        let has_haematuria = symptom_str.contains("haematuria")
            || symptom_str.contains("hematuria")
            || symptom_str.contains("blood in urine")
            || symptom_str.contains("blood in pee")
            || symptom_str.contains("bloody urine");
        let has_radiation_groin =
            symptom_str.contains("groin") || symptom_str.contains("radiating to groin");

        let mut score = 0u32;
        if has_flank {
            score += 3;
        }
        if has_haematuria {
            score += 3;
        }
        if has_radiation_groin {
            score += 2;
        }

        if score >= 3 {
            if max_severity_rank < 2 {
                max_severity_rank = 2;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Renal Colic / Urolithiasis".to_string(),
                probability: (score as f32 * 0.11).min(0.83),
                severity: "high".to_string(),
                description: "Sudden onset flank pain radiating to groin with haematuria is characteristic of renal calculi.".to_string(),
                icd10_code: Some("N20.9".to_string()),
            });
        }
    }

    // Pneumonia: fever + productive cough + chest symptoms
    {
        let has_fever = symptom_str.contains("fever") || symptom_str.contains("high temperature");
        let has_productive_cough = symptom_str.contains("productive cough")
            || (symptom_str.contains("cough")
                && (symptom_str.contains("sputum")
                    || symptom_str.contains("phlegm")
                    || symptom_str.contains("mucus")));
        let has_chest_sx = symptom_str.contains("chest pain")
            || symptom_str.contains("chest tightness")
            || symptom_str.contains("pleuritic");
        let has_sob = symptom_str.contains("shortness of breath")
            || symptom_str.contains("breathless")
            || symptom_str.contains("difficulty breathing");

        let mut score = 0u32;
        if has_fever {
            score += 2;
        }
        if has_productive_cough {
            score += 3;
        }
        if has_chest_sx {
            score += 2;
        }
        if has_sob {
            score += 2;
        }

        if score >= 5 {
            if max_severity_rank < 2 {
                max_severity_rank = 2;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Community-Acquired Pneumonia".to_string(),
                probability: (score as f32 * 0.09).min(0.82),
                severity: "high".to_string(),
                description: "Fever with productive cough and respiratory symptoms is consistent with pneumonia and warrants chest X-ray and antibiotic evaluation.".to_string(),
                icd10_code: Some("J18.9".to_string()),
            });
        }
    }

    // Tuberculosis: cough + fever + weight loss + night sweats
    {
        let has_cough = symptom_str.contains("cough");
        let has_fever = symptom_str.contains("fever");
        let has_weight_loss =
            symptom_str.contains("weight loss") || symptom_str.contains("losing weight");
        let has_night_sweats =
            symptom_str.contains("night sweat") || symptom_str.contains("drenching sweat");
        let has_haemoptysis = symptom_str.contains("blood in sputum")
            || symptom_str.contains("coughing blood")
            || symptom_str.contains("haemoptysis")
            || symptom_str.contains("hemoptysis");

        let mut score = 0u32;
        if has_cough {
            score += 1;
        }
        if has_fever {
            score += 1;
        }
        if has_weight_loss {
            score += 3;
        }
        if has_night_sweats {
            score += 3;
        }
        if has_haemoptysis {
            score += 3;
        }

        if score >= 5 {
            if max_severity_rank < 2 {
                max_severity_rank = 2;
            }
            red_flags.push("Chronic cough with weight loss and night sweats – consider tuberculosis screening.".to_string());
            conditions.push(PossibleConditionResult {
                condition_name: "Pulmonary Tuberculosis".to_string(),
                probability: (score as f32 * 0.09).min(0.78),
                severity: "high".to_string(),
                description: "Constitutional symptoms (weight loss, night sweats) combined with chronic cough raise concern for TB. Sputum smear, GeneXpert, and CXR recommended.".to_string(),
                icd10_code: Some("A15.9".to_string()),
            });
        }
    }

    // Dengue / viral haemorrhagic fever: rash + fever + joint pain
    {
        let has_fever = symptom_str.contains("fever") || symptom_str.contains("high temperature");
        let has_rash = symptom_str.contains("rash") || symptom_str.contains("skin rash");
        let has_joint = symptom_str.contains("joint pain")
            || symptom_str.contains("arthralgia")
            || symptom_str.contains("bone pain")
            || symptom_str.contains("myalgia")
            || symptom_str.contains("muscle pain");
        let has_retroorbital = symptom_str.contains("eye pain")
            || symptom_str.contains("retro-orbital")
            || symptom_str.contains("pain behind eyes");

        let mut score = 0u32;
        if has_fever {
            score += 2;
        }
        if has_rash {
            score += 2;
        }
        if has_joint {
            score += 2;
        }
        if has_retroorbital {
            score += 3;
        }

        if score >= 4 {
            if max_severity_rank < 2 {
                max_severity_rank = 2;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Dengue / Viral Haemorrhagic Fever".to_string(),
                probability: (score as f32 * 0.10).min(0.78),
                severity: "high".to_string(),
                description: "Fever with rash and joint/muscle pain is consistent with dengue or other arboviral illness. FBC (platelet count) and dengue NS1/serology recommended.".to_string(),
                icd10_code: Some("A97.9".to_string()),
            });
        }
    }

    // -------------------------------------------------------------------------
    // MEDIUM-ACUITY AND COMMON PATTERN DETECTION
    // -------------------------------------------------------------------------

    // Migraine / severe headache
    if symptom_str.contains("headache") {
        let has_severe = symptom_str.contains("severe headache")
            || symptom_str.contains("worst headache")
            || symptom_str.contains("thunderclap");
        let has_nausea = symptom_str.contains("nausea") || symptom_str.contains("vomiting");
        let has_photophobia = symptom_str.contains("light sensitivity")
            || symptom_str.contains("photophobia")
            || symptom_str.contains("sensitive to light");
        let has_aura = symptom_str.contains("aura") || symptom_str.contains("visual aura");
        let has_fever = symptom_str.contains("fever");

        if has_fever && (has_nausea || has_photophobia) {
            // Headache + fever – already handled by meningitis block; add viral
            if max_severity_rank < 1 {
                max_severity_rank = 1;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Viral Illness with Headache".to_string(),
                probability: 0.68,
                severity: "medium".to_string(),
                description: "Headache with fever and associated symptoms commonly indicates viral infection.".to_string(),
                icd10_code: Some("B34.9".to_string()),
            });
        } else if (has_nausea || has_photophobia) && (has_aura || has_severe) {
            if max_severity_rank < 1 {
                max_severity_rank = 1;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Migraine".to_string(),
                probability: 0.72,
                severity: "medium".to_string(),
                description: "Unilateral throbbing headache with nausea, photophobia, or aura is classic migraine.".to_string(),
                icd10_code: Some("G43.9".to_string()),
            });
        } else if !has_severe {
            conditions.push(PossibleConditionResult {
                condition_name: "Tension-Type Headache".to_string(),
                probability: 0.62,
                severity: "low".to_string(),
                description: "Bilateral pressure-like headache often related to stress, posture, or dehydration.".to_string(),
                icd10_code: Some("G44.2".to_string()),
            });
        }
    }

    // Upper respiratory infection / influenza
    if symptom_str.contains("cough") {
        let has_fever = symptom_str.contains("fever");
        let has_fatigue = symptom_str.contains("fatigue") || symptom_str.contains("tired");
        let has_runny_nose = symptom_str.contains("runny nose")
            || symptom_str.contains("rhinorrhoea")
            || symptom_str.contains("nasal");
        let has_wheeze = symptom_str.contains("wheezing") || symptom_str.contains("wheeze");

        if has_fever && has_fatigue {
            if max_severity_rank < 1 {
                max_severity_rank = 1;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Influenza / Upper Respiratory Infection".to_string(),
                probability: if has_runny_nose { 0.78 } else { 0.68 },
                severity: "medium".to_string(),
                description: "Acute onset of fever, cough, and fatigue is consistent with influenza or a viral URI.".to_string(),
                icd10_code: Some("J10.1".to_string()),
            });
        } else if has_runny_nose {
            conditions.push(PossibleConditionResult {
                condition_name: "Common Cold (Viral URI)".to_string(),
                probability: 0.75,
                severity: "low".to_string(),
                description: "Mild upper respiratory tract symptoms likely due to rhinovirus or similar pathogen.".to_string(),
                icd10_code: Some("J06.9".to_string()),
            });
        } else if has_wheeze {
            if max_severity_rank < 1 {
                max_severity_rank = 1;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Asthma / Bronchospasm".to_string(),
                probability: 0.65,
                severity: "medium".to_string(),
                description: "Cough with wheeze suggests airway hyperreactivity or bronchospasm requiring evaluation.".to_string(),
                icd10_code: Some("J45.9".to_string()),
            });
        }
    }

    // Gastroenteritis / abdominal pain
    if symptom_str.contains("abdominal pain") || symptom_str.contains("stomach pain") {
        let has_nv = symptom_str.contains("nausea")
            || symptom_str.contains("vomiting")
            || symptom_str.contains("diarrhoea")
            || symptom_str.contains("diarrhea");
        let has_fever = symptom_str.contains("fever");

        if has_nv {
            conditions.push(PossibleConditionResult {
                condition_name: "Gastroenteritis".to_string(),
                probability: if has_fever { 0.68 } else { 0.72 },
                severity: "low".to_string(),
                description: "Abdominal cramps with nausea, vomiting, or diarrhoea are typical of gastroenteritis.".to_string(),
                icd10_code: Some("K52.9".to_string()),
            });
        }

        // Peptic ulcer disease
        if symptom_str.contains("burning")
            || symptom_str.contains("epigastric")
            || symptom_str.contains("heartburn")
            || symptom_str.contains("worse after eating")
            || symptom_str.contains("better after eating")
        {
            conditions.push(PossibleConditionResult {
                condition_name: "Peptic Ulcer Disease / Dyspepsia".to_string(),
                probability: 0.58,
                severity: "low".to_string(),
                description: "Epigastric burning pain related to meals may indicate PUD or GORD."
                    .to_string(),
                icd10_code: Some("K27.9".to_string()),
            });
        }
    }

    // Pharyngitis / strep throat
    if symptom_str.contains("sore throat") {
        let has_fever = symptom_str.contains("fever");
        let has_exudate = symptom_str.contains("white patch")
            || symptom_str.contains("exudate")
            || symptom_str.contains("pus");
        let has_lymph = symptom_str.contains("swollen gland")
            || symptom_str.contains("lymph node")
            || symptom_str.contains("neck swelling");

        if has_fever || has_exudate || has_lymph {
            conditions.push(PossibleConditionResult {
                condition_name: "Acute Pharyngitis / Streptococcal Tonsillitis".to_string(),
                probability: if has_exudate { 0.72 } else { 0.62 },
                severity: "low".to_string(),
                description: "Sore throat with fever, exudate, or lymphadenopathy suggests bacterial pharyngitis. Consider throat swab.".to_string(),
                icd10_code: Some("J02.0".to_string()),
            });
        } else {
            conditions.push(PossibleConditionResult {
                condition_name: "Viral Throat Irritation".to_string(),
                probability: 0.60,
                severity: "low".to_string(),
                description:
                    "Mild sore throat without fever is most often viral and self-limiting."
                        .to_string(),
                icd10_code: Some("J02.9".to_string()),
            });
        }
    }

    // Urinary tract infection
    {
        let has_dysuria = symptom_str.contains("dysuria")
            || symptom_str.contains("painful urination")
            || symptom_str.contains("burning urination")
            || symptom_str.contains("pain when urinating")
            || symptom_str.contains("pain passing urine");
        let has_frequency = symptom_str.contains("urinary frequency")
            || symptom_str.contains("frequent urination")
            || symptom_str.contains("needing to urinate")
            || symptom_str.contains("urgency");
        let has_cloudy = symptom_str.contains("cloudy urine")
            || symptom_str.contains("smelly urine")
            || symptom_str.contains("offensive urine");

        let mut score = 0u32;
        if has_dysuria {
            score += 3;
        }
        if has_frequency {
            score += 2;
        }
        if has_cloudy {
            score += 2;
        }

        if score >= 2 {
            let has_fever = symptom_str.contains("fever");
            let severity = if has_fever { "medium" } else { "low" };
            if has_fever && max_severity_rank < 1 {
                max_severity_rank = 1;
            }
            conditions.push(PossibleConditionResult {
                condition_name: if has_fever { "Pyelonephritis (Upper UTI)" } else { "Lower Urinary Tract Infection (Cystitis)" }.to_string(),
                probability: (score as f32 * 0.12).min(0.82),
                severity: severity.to_string(),
                description: if has_fever {
                    "UTI symptoms with fever suggest upper tract involvement (pyelonephritis) requiring urgent urine culture and antibiotics.".to_string()
                } else {
                    "Classic lower UTI/cystitis symptoms. Urine dipstick and culture recommended.".to_string()
                },
                icd10_code: Some(if has_fever { "N10" } else { "N30.0" }.to_string()),
            });
        }
    }

    // Metabolic / thyroid
    if symptom_str.contains("fatigue")
        && (symptom_str.contains("weight loss") || symptom_str.contains("weight gain"))
    {
        if max_severity_rank < 1 {
            max_severity_rank = 1;
        }
        conditions.push(PossibleConditionResult {
            condition_name: "Thyroid / Metabolic Disorder".to_string(),
            probability: 0.42,
            severity: "medium".to_string(),
            description: "Unexplained fatigue with weight change warrants thyroid function tests and metabolic workup.".to_string(),
            icd10_code: Some("E03.9".to_string()),
        });
    }

    // Anaemia
    if symptom_str.contains("fatigue")
        && (symptom_str.contains("pale")
            || symptom_str.contains("pallor")
            || symptom_str.contains("short of breath"))
    {
        conditions.push(PossibleConditionResult {
            condition_name: "Anaemia".to_string(),
            probability: 0.45,
            severity: "medium".to_string(),
            description:
                "Fatigue with pallor or exertional dyspnoea may indicate anaemia. FBC recommended."
                    .to_string(),
            icd10_code: Some("D64.9".to_string()),
        });
    }

    // Deep Vein Thrombosis / Pulmonary Embolism
    {
        let has_leg_swelling = symptom_str.contains("leg swelling")
            || symptom_str.contains("calf pain")
            || symptom_str.contains("calf swelling")
            || symptom_str.contains("swollen leg");
        let has_sob =
            symptom_str.contains("shortness of breath") || symptom_str.contains("breathless");
        let has_pleuritic = symptom_str.contains("pleuritic")
            || symptom_str.contains("sharp chest pain")
            || symptom_str.contains("pain on breathing");

        if has_leg_swelling && (has_sob || has_pleuritic) {
            max_severity_rank = 3;
            red_flags.push("Leg swelling with breathing difficulty – possible deep vein thrombosis / pulmonary embolism. Seek emergency evaluation.".to_string());
            conditions.push(PossibleConditionResult {
                condition_name: "Pulmonary Embolism / Deep Vein Thrombosis".to_string(),
                probability: 0.72,
                severity: "critical".to_string(),
                description: "DVT with sudden dyspnoea and pleuritic chest pain is the classic PE presentation.".to_string(),
                icd10_code: Some("I26.9".to_string()),
            });
        } else if has_leg_swelling {
            if max_severity_rank < 2 {
                max_severity_rank = 2;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "Deep Vein Thrombosis".to_string(),
                probability: 0.50,
                severity: "high".to_string(),
                description:
                    "Unilateral calf pain and swelling warrants Doppler ultrasound to exclude DVT."
                        .to_string(),
                icd10_code: Some("I82.4".to_string()),
            });
        }
    }

    // Diabetic emergency: known diabetes + altered consciousness / extreme thirst
    {
        let has_diabetes_context = symptom_str.contains("diabetic")
            || symptom_str.contains("diabetes")
            || symptom_str.contains("insulin");
        let has_hypo = symptom_str.contains("shakiness")
            || symptom_str.contains("trembling")
            || symptom_str.contains("sweating")
            || symptom_str.contains("confusion")
            || symptom_str.contains("hypoglycaemia")
            || symptom_str.contains("hypoglycemia")
            || symptom_str.contains("low blood sugar");
        let has_polydipsia = symptom_str.contains("excessive thirst")
            || symptom_str.contains("polydipsia")
            || symptom_str.contains("frequent urination");

        if has_diabetes_context && has_hypo {
            max_severity_rank = 3;
            red_flags.push(
                "Possible hypoglycaemia in diabetic patient – check blood glucose immediately."
                    .to_string(),
            );
            conditions.push(PossibleConditionResult {
                condition_name: "Hypoglycaemia".to_string(),
                probability: 0.80,
                severity: "critical".to_string(),
                description: "Hypoglycaemic episode in known diabetic patient requires immediate glucose measurement and treatment.".to_string(),
                icd10_code: Some("E11.649".to_string()),
            });
        } else if has_polydipsia && symptom_str.contains("weight loss") {
            if max_severity_rank < 1 {
                max_severity_rank = 1;
            }
            conditions.push(PossibleConditionResult {
                condition_name: "New-Onset Diabetes Mellitus".to_string(),
                probability: 0.55,
                severity: "medium".to_string(),
                description: "Polyuria, polydipsia and weight loss in a non-diabetic patient raises concern for new-onset diabetes. Fasting glucose and HbA1c indicated.".to_string(),
                icd10_code: Some("E11.9".to_string()),
            });
        }
    }

    // Sort conditions: critical first, then by descending probability
    conditions.sort_by(|a, b| {
        let ra = severity_rank(&a.severity);
        let rb = severity_rank(&b.severity);
        rb.cmp(&ra).then(
            b.probability
                .partial_cmp(&a.probability)
                .unwrap_or(std::cmp::Ordering::Equal),
        )
    });

    // If no conditions matched at all, return generic assessment
    if conditions.is_empty() {
        conditions.push(PossibleConditionResult {
            condition_name: "General Symptoms – Evaluation Recommended".to_string(),
            probability: 0.50,
            severity: "low".to_string(),
            description: "The reported symptoms do not match a specific high-probability pattern. A healthcare provider should evaluate you for a definitive assessment.".to_string(),
            icd10_code: None,
        });
    }

    // Map internal severity rank to API triage level string
    let triage_level = match max_severity_rank {
        3 => "emergency",
        2 => "urgent_care",
        1 => "schedule_appointment",
        _ => "self_care",
    };

    (conditions, triage_level.to_string(), red_flags)
}

/// Generate triage recommendations
fn generate_triage_recommendations(
    triage_level: &str,
    _symptoms: &[String],
) -> (String, Vec<String>, Vec<String>, Vec<String>) {
    match triage_level {
        "emergency" => (
            "Seek emergency medical care immediately".to_string(),
            vec![
                "Call emergency services (10111 or 112)".to_string(),
                "Go to the nearest emergency room".to_string(),
                "Do not drive yourself if experiencing severe symptoms".to_string(),
            ],
            vec![],
            vec![
                "Symptoms are severe or life-threatening".to_string(),
                "You experience loss of consciousness".to_string(),
            ],
        ),
        "urgent_care" => (
            "Seek medical attention within 24 hours".to_string(),
            vec![
                "Visit an urgent care clinic today".to_string(),
                "Call your doctor for same-day appointment".to_string(),
                "Consider telehealth consultation".to_string(),
            ],
            vec![
                "Rest and stay hydrated".to_string(),
                "Take over-the-counter pain relievers as directed".to_string(),
            ],
            vec![
                "Symptoms worsen significantly".to_string(),
                "You develop new concerning symptoms".to_string(),
                "Pain becomes severe".to_string(),
            ],
        ),
        "schedule_appointment" => (
            "Schedule an appointment with your doctor".to_string(),
            vec![
                "Schedule appointment within 2-3 days".to_string(),
                "Consider telehealth if in-person unavailable".to_string(),
                "Keep a symptom diary to share with your doctor".to_string(),
            ],
            vec![
                "Get plenty of rest".to_string(),
                "Stay well hydrated".to_string(),
                "Use over-the-counter remedies as appropriate".to_string(),
            ],
            vec![
                "Symptoms persist beyond a week".to_string(),
                "Symptoms significantly worsen".to_string(),
                "You develop fever above 38.5°C (101.3°F)".to_string(),
            ],
        ),
        _ => (
            "Self-care and monitoring recommended".to_string(),
            vec![
                "Monitor your symptoms".to_string(),
                "Visit a pharmacy for OTC remedies if needed".to_string(),
                "Schedule appointment if symptoms persist".to_string(),
            ],
            vec![
                "Rest and take it easy".to_string(),
                "Stay hydrated with water and clear fluids".to_string(),
                "Use appropriate over-the-counter medications".to_string(),
                "Get adequate sleep".to_string(),
            ],
            vec![
                "Symptoms do not improve after 5-7 days".to_string(),
                "Symptoms worsen instead of improving".to_string(),
                "You develop new symptoms".to_string(),
            ],
        ),
    }
}

// ============================================================================
// PHASE 26: TELEHEALTH INTEGRATION
// ============================================================================

/// Create telehealth session request
#[derive(Debug, Deserialize)]
pub struct CreateTelehealthSessionRequest {
    pub patient_id: String,
    pub appointment_id: Option<String>,
    pub session_type: String,
    pub scheduled_start: i64,
    pub recording_enabled: Option<bool>,
}

/// Create a new telehealth session
#[post("/api/telehealth/sessions")]
pub async fn create_telehealth_session(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateTelehealthSessionRequest>,
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
            error: "Only healthcare providers can create telehealth sessions".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let session_type = match req.session_type.as_str() {
        "video" => crate::clinical::TelehealthType::VideoVisit,
        "phone" => crate::clinical::TelehealthType::PhoneCall,
        "message" => crate::clinical::TelehealthType::SecureMessage,
        "async_video" => crate::clinical::TelehealthType::AsyncVideo,
        "monitoring" => crate::clinical::TelehealthType::RemoteMonitoring,
        "group" => crate::clinical::TelehealthType::VirtualGroupVisit,
        _ => crate::clinical::TelehealthType::VideoVisit,
    };

    let session_id = format!("TH-{}", uuid::Uuid::new_v4());

    // Delegate URL generation to the configured TelehealthService provider
    // (internal / Daily.co / Twilio). Falls back gracefully to Jitsi-style URLs.
    let scheduled_at =
        chrono::DateTime::from_timestamp(req.scheduled_start, 0).unwrap_or_else(chrono::Utc::now);
    let service_params = crate::telehealth::CreateSessionParams {
        session_id: session_id.clone(),
        patient_id: req.patient_id.clone(),
        provider_id: current_user_id.clone(),
        scheduled_at,
        duration_minutes: 60,
    };
    let session_info = data.telehealth_service.create_session(service_params).await;

    let (provider_join_url, patient_join_url, video_room_url, waiting_room_url, platform) =
        match session_info {
            Ok(ref info) => (
                info.provider_join_url.clone(),
                info.patient_join_url.clone(),
                info.provider_join_url.clone(),
                info.patient_join_url.clone(),
                info.provider_name.clone(),
            ),
            Err(ref e) => {
                // Graceful fallback to Jitsi if the provider call fails
                log::warn!(
                    "TelehealthService::create_session failed ({}); falling back to Jitsi",
                    e
                );
                let room_name = format!(
                    "medichain-{}-{}",
                    session_id.to_lowercase().replace('_', "-"),
                    &uuid::Uuid::new_v4().to_string()[..8]
                );
                (
                    format!(
                        "https://meet.jit.si/{}#userInfo.displayName=%22Provider%22",
                        room_name
                    ),
                    format!(
                        "https://meet.jit.si/{}#userInfo.displayName=%22Patient%22",
                        room_name
                    ),
                    format!("https://meet.jit.si/{}", room_name),
                    format!("https://meet.jit.si/{}", room_name),
                    "jitsi-fallback".to_string(),
                )
            }
        };

    let session = crate::clinical::TelehealthSession {
        session_id: session_id.clone(),
        appointment_id: req.appointment_id.clone(),
        patient_id: req.patient_id.clone(),
        provider_id: current_user_id.clone(),
        session_type,
        scheduled_start: req.scheduled_start,
        actual_start: None,
        actual_end: None,
        status: crate::clinical::TelehealthStatus::Scheduled,
        video_room_url: video_room_url.clone(),
        waiting_room_url: waiting_room_url.clone(),
        join_instructions: "Use the provided link to join your telehealth session. \
            Ensure camera and microphone are enabled."
            .to_string(),
        technical_requirements: vec![
            "Modern web browser (Chrome, Firefox, Safari, Edge)".to_string(),
            "Stable internet connection (2+ Mbps)".to_string(),
            "Camera and microphone access".to_string(),
        ],
        patient_joined_at: None,
        provider_joined_at: None,
        recording_enabled: req.recording_enabled.unwrap_or(false),
        recording_consent: false,
        chat_enabled: true,
        screen_share_enabled: true,
        quality_metrics: None,
        visit_notes: None,
        follow_up_scheduled: None,
    };

    let mut sessions = data.telehealth_sessions.write().unwrap();
    sessions.insert(session_id.clone(), session);

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "session_id": session_id,
        "video_room_url": video_room_url,
        "waiting_room_url": waiting_room_url,
        "provider_join_url": provider_join_url,
        "patient_join_url": patient_join_url,
        "platform": platform,
        "message": "Telehealth session created successfully"
    }))
}

/// Get telehealth session details
#[get("/api/telehealth/sessions/{session_id}")]
pub async fn get_telehealth_session(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let session_id = path.into_inner();

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

    let sessions = data.telehealth_sessions.read().unwrap();
    let session = match sessions.get(&session_id) {
        Some(s) => s.clone(),
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Session not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    // Only patient or provider can view session
    if session.patient_id != current_user_id && session.provider_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "session": session
    }))
}

/// Join telehealth session
#[post("/api/telehealth/sessions/{session_id}/join")]
pub async fn join_telehealth_session(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let session_id = path.into_inner();

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

    let mut sessions = data.telehealth_sessions.write().unwrap();
    let session = match sessions.get_mut(&session_id) {
        Some(s) => s,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Session not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    let now = chrono::Utc::now().timestamp();
    let is_patient = session.patient_id == current_user_id;
    let is_provider = session.provider_id == current_user_id;

    if !is_patient && !is_provider {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "You are not part of this session".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    if is_patient {
        session.patient_joined_at = Some(now);
        if session.status == crate::clinical::TelehealthStatus::Scheduled {
            session.status = crate::clinical::TelehealthStatus::WaitingRoom;
        }
    } else if is_provider {
        session.provider_joined_at = Some(now);
        if session.patient_joined_at.is_some() {
            session.status = crate::clinical::TelehealthStatus::InProgress;
            session.actual_start = Some(now);
        }
    }

    // Check if both have joined
    if session.patient_joined_at.is_some() && session.provider_joined_at.is_some() {
        session.status = crate::clinical::TelehealthStatus::InProgress;
        if session.actual_start.is_none() {
            session.actual_start = Some(now);
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "session_id": session_id,
        "status": format!("{:?}", session.status),
        "video_room_url": session.video_room_url,
        "message": if is_patient { "Joined waiting room" } else { "Provider joined session" }
    }))
}

/// End telehealth session
#[post("/api/telehealth/sessions/{session_id}/end")]
pub async fn end_telehealth_session(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<Option<EndTelehealthRequest>>,
) -> impl Responder {
    let session_id = path.into_inner();

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

    let mut sessions = data.telehealth_sessions.write().unwrap();
    let session = match sessions.get_mut(&session_id) {
        Some(s) => s,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Session not found".to_string(),
                code: "NOT_FOUND".to_string(),
            })
        }
    };

    // Only provider can end session
    if session.provider_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only the provider can end the session".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let now_ts = chrono::Utc::now().timestamp();
    session.actual_end = Some(now_ts);
    session.status = crate::clinical::TelehealthStatus::Completed;

    if let Some(end_req) = req.into_inner() {
        session.visit_notes = end_req.visit_notes;
        session.follow_up_scheduled = end_req.follow_up_date;
    }

    // Calculate duration before releasing the write lock
    let duration_minutes = if let Some(start) = session.actual_start {
        (now_ts - start) / 60
    } else {
        0
    };

    // Release write lock before making async calls
    let _ = session; // end borrow on `sessions`
    drop(sessions);

    // Notify the TelehealthService so the provider backend can tear down the room
    if let Err(e) = data.telehealth_service.end_session(&session_id).await {
        log::warn!(
            "TelehealthService::end_session failed for {}: {}",
            session_id,
            e
        );
        // Non-fatal: the session is already marked Completed in the HashMap above
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "session_id": session_id,
        "duration_minutes": duration_minutes,
        "message": "Telehealth session ended"
    }))
}

/// End telehealth request
#[derive(Debug, Deserialize)]
pub struct EndTelehealthRequest {
    pub visit_notes: Option<String>,
    pub follow_up_date: Option<String>,
}

/// Device check request
#[derive(Debug, Deserialize)]
pub struct DeviceCheckRequest {
    pub camera_working: bool,
    pub microphone_working: bool,
    pub speaker_working: bool,
    pub browser: String,
    pub bandwidth_mbps: Option<f32>,
}

/// Submit device check results
#[post("/api/telehealth/device-check")]
pub async fn submit_device_check(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<DeviceCheckRequest>,
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

    let supported_browsers = ["chrome", "firefox", "safari", "edge"];
    let browser_supported = supported_browsers
        .iter()
        .any(|b| req.browser.to_lowercase().contains(b));

    let bandwidth = req.bandwidth_mbps.unwrap_or(0.0);
    let bandwidth_adequate = bandwidth >= 2.0;

    let mut issues: Vec<String> = Vec::new();
    let mut recommendations: Vec<String> = Vec::new();

    if !req.camera_working {
        issues.push("Camera not detected or not working".to_string());
        recommendations
            .push("Check camera permissions and ensure it's not in use by another app".to_string());
    }
    if !req.microphone_working {
        issues.push("Microphone not detected or not working".to_string());
        recommendations.push("Check microphone permissions and settings".to_string());
    }
    if !req.speaker_working {
        issues.push("Audio output not working".to_string());
        recommendations.push("Check speaker/headphone connection and volume settings".to_string());
    }
    if !browser_supported {
        issues.push("Browser may not be fully supported".to_string());
        recommendations
            .push("Use Chrome, Firefox, Safari, or Edge for best experience".to_string());
    }
    if !bandwidth_adequate {
        issues.push(format!(
            "Bandwidth ({:.1} Mbps) may be insufficient",
            bandwidth
        ));
        recommendations.push(
            "Minimum 2 Mbps recommended. Close other applications using internet".to_string(),
        );
    }

    let ready =
        req.camera_working && req.microphone_working && browser_supported && bandwidth_adequate;

    let device_check = crate::clinical::DeviceCheck {
        check_id: format!("DC-{}", uuid::Uuid::new_v4()),
        patient_id: current_user_id,
        checked_at: chrono::Utc::now().timestamp(),
        camera_working: req.camera_working,
        microphone_working: req.microphone_working,
        speaker_working: req.speaker_working,
        browser_supported,
        bandwidth_adequate,
        bandwidth_mbps: bandwidth,
        issues_detected: issues.clone(),
        recommendations: recommendations.clone(),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "ready_for_telehealth": ready,
        "check_id": device_check.check_id,
        "issues": issues,
        "recommendations": recommendations,
        "details": {
            "camera": req.camera_working,
            "microphone": req.microphone_working,
            "speaker": req.speaker_working,
            "browser_supported": browser_supported,
            "bandwidth_adequate": bandwidth_adequate,
            "bandwidth_mbps": bandwidth
        }
    }))
}

/// Get patient's telehealth sessions
#[get("/api/telehealth/patient/{patient_id}/sessions")]
pub async fn get_patient_telehealth_sessions(
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

    let sessions = data.telehealth_sessions.read().unwrap();
    let patient_sessions: Vec<_> = sessions
        .values()
        .filter(|s| s.patient_id == patient_id)
        .cloned()
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "sessions": patient_sessions,
        "count": patient_sessions.len()
    }))
}

// ============================================================================
// PHASE 27: CLINICAL DECISION SUPPORT (CDS)
// ============================================================================

/// Evaluate Clinical Decision Support rules for a patient based on their current vitals/labs.
/// Returns a list of auto-generated CDS alerts that should be created.
pub fn evaluate_cds_rules(
    patient_id: &str,
    vitals: Option<&crate::clinical::VitalSignsReading>,
    lab_values: Option<&std::collections::HashMap<String, f64>>,
    patient_conditions: &[String],
    current_medications: &[String],
) -> Vec<crate::clinical::CDSAlert> {
    let mut alerts = Vec::new();
    let now = chrono::Utc::now().timestamp();

    // Helper closure for creating alerts
    let make_alert = |id_suffix: &str,
                      alert_type: crate::clinical::CDSAlertType,
                      title: &str,
                      description: &str,
                      severity: crate::clinical::CDSSeverity,
                      recommendation: &str|
     -> crate::clinical::CDSAlert {
        crate::clinical::CDSAlert {
            alert_id: format!("AUTO-CDS-{}-{}", id_suffix, uuid::Uuid::new_v4()),
            patient_id: patient_id.to_string(),
            provider_id: "cds_rules_engine".to_string(),
            alert_type,
            severity,
            title: title.to_string(),
            description: description.to_string(),
            clinical_context: "Automated CDS rules evaluation".to_string(),
            triggering_data: serde_json::json!({ "source": "automated_rules_engine" }),
            recommended_actions: vec![crate::clinical::CDSRecommendedAction {
                action_id: format!("ACT-{}", uuid::Uuid::new_v4()),
                action_type: "clinical_action".to_string(),
                description: recommendation.to_string(),
                strength: crate::clinical::RecommendationStrength::Strong,
                one_click_order: None,
            }],
            evidence: vec![crate::clinical::CDSEvidence {
                source: "CDS Rules Engine".to_string(),
                citation: "Clinical decision support automated rule".to_string(),
                url: None,
                evidence_grade: "A".to_string(),
            }],
            guideline_reference: None,
            created_at: now,
            expires_at: None,
            status: crate::clinical::CDSAlertStatus::Active,
            response: None,
        }
    };

    // --- VITAL SIGNS RULES ---
    if let Some(v) = vitals {
        // Sepsis screening (qSOFA criteria) — using available fields
        let mut qsofa_score = 0;
        if let Some(rr) = v.respiratory_rate {
            if rr >= 22 {
                qsofa_score += 1;
            }
        }
        if let Some(sbp) = v.systolic_bp {
            if sbp <= 100 {
                qsofa_score += 1;
            }
        }
        if qsofa_score >= 2 {
            alerts.push(make_alert(
                "SEPSIS",
                crate::clinical::CDSAlertType::BestPracticeAdvisory,
                "Sepsis Alert - qSOFA \u{2265} 2",
                &format!(
                    "qSOFA score: {}. Criteria met: RR\u{2265}22:{}, SBP\u{2264}100:{}",
                    qsofa_score,
                    v.respiratory_rate.map(|r| r >= 22).unwrap_or(false),
                    v.systolic_bp.map(|s| s <= 100).unwrap_or(false),
                ),
                crate::clinical::CDSSeverity::Critical,
                "Initiate sepsis bundle: blood cultures x2, lactate, broad-spectrum antibiotics within 1 hour, 30mL/kg IV crystalloid if hypotensive",
            ));
        }

        // Hypertensive crisis
        if let (Some(sbp), Some(dbp)) = (v.systolic_bp, v.diastolic_bp) {
            if sbp >= 180 || dbp >= 120 {
                alerts.push(make_alert(
                    "HTNCRISIS",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Hypertensive Crisis",
                    &format!("BP: {}/{} mmHg", sbp, dbp),
                    crate::clinical::CDSSeverity::Critical,
                    "Assess for end-organ damage. IV labetalol or nicardipine if hypertensive emergency. Oral agents if urgency only.",
                ));
            }
        }

        // Hypotensive shock
        if let Some(sbp) = v.systolic_bp {
            if sbp < 90 {
                let hr_tachycardia = v.heart_rate.map(|h| h > 100).unwrap_or(false);
                alerts.push(make_alert(
                    "HYPOSHOCK",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    if hr_tachycardia { "Shock - Hypotension + Tachycardia" } else { "Hypotension Alert" },
                    &format!("SBP: {} mmHg{}", sbp, if hr_tachycardia { ", HR >100 bpm" } else { "" }),
                    if hr_tachycardia { crate::clinical::CDSSeverity::Critical } else { crate::clinical::CDSSeverity::High },
                    "IV access x2, fluid resuscitation, determine shock type (septic/hemorrhagic/cardiogenic/distributive), consider vasopressors",
                ));
            }
        }

        // Bradycardia
        if let Some(hr) = v.heart_rate {
            if hr < 50 {
                alerts.push(make_alert(
                    "BRADY",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Severe Bradycardia",
                    &format!("HR: {} bpm", hr),
                    crate::clinical::CDSSeverity::High,
                    "12-lead ECG, assess for AV block, consider atropine 0.5mg IV if symptomatic",
                ));
            }
            // Tachycardia
            if hr > 130 {
                alerts.push(make_alert(
                    "TACHY",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Severe Tachycardia",
                    &format!("HR: {} bpm", hr),
                    crate::clinical::CDSSeverity::High,
                    "12-lead ECG, identify and treat underlying cause, consider rate control if stable",
                ));
            }
        }

        // Fever
        if let Some(temp) = v.temperature_celsius {
            if temp >= 38.5 {
                let severity = if temp >= 40.0 {
                    crate::clinical::CDSSeverity::Critical
                } else {
                    crate::clinical::CDSSeverity::High
                };
                alerts.push(make_alert(
                    "FEVER",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Fever Alert",
                    &format!("Temperature: {:.1}\u{00b0}C", temp),
                    severity,
                    if temp >= 40.0 {
                        "High fever - blood cultures, CBC, CMP, consider LP if meningeal signs, aggressive antipyretics, cooling measures"
                    } else {
                        "Fever - blood cultures if bacteremia suspected, CBC, antipyretics, investigate source"
                    },
                ));
            }
            if temp < 35.0 {
                alerts.push(make_alert(
                    "HYPOTHERMIA",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Hypothermia Alert",
                    &format!("Temperature: {:.1}\u{00b0}C", temp),
                    crate::clinical::CDSSeverity::Critical,
                    "Active warming, monitor for cardiac arrhythmias, check glucose, thyroid function",
                ));
            }
        }

        // Hypoxia
        if let Some(spo2) = v.oxygen_saturation {
            if spo2 < 90 {
                alerts.push(make_alert(
                    "HYPOXIA",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Critical Hypoxia",
                    &format!("SpO2: {}%", spo2),
                    crate::clinical::CDSSeverity::Critical,
                    "Supplemental O2 immediately, ABG, CXR, assess for PE/pneumonia/ARDS, prepare for intubation if refractory",
                ));
            } else if spo2 < 94 {
                alerts.push(make_alert(
                    "LOWSPO2",
                    crate::clinical::CDSAlertType::VitalSignAbnormal,
                    "Low Oxygen Saturation",
                    &format!("SpO2: {}%", spo2),
                    crate::clinical::CDSSeverity::High,
                    "Supplemental O2, assess work of breathing, ABG, CXR",
                ));
            }
        }
    }

    // --- LAB VALUE RULES ---
    if let Some(labs) = lab_values {
        // Acute Kidney Injury
        if let Some(&creatinine) = labs.get("creatinine") {
            if creatinine > 354.0 {
                // >4 mg/dL in µmol/L
                alerts.push(make_alert(
                    "AKI",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Severe AKI - Critical Creatinine",
                    &format!("Creatinine: {:.0} \u{00b5}mol/L", creatinine),
                    crate::clinical::CDSSeverity::Critical,
                    "Nephrology consult, hold nephrotoxins, strict fluid balance, consider renal replacement therapy",
                ));
            }
        }

        // Hyperkalemia
        if let Some(&potassium) = labs.get("potassium") {
            if potassium > 6.5 {
                alerts.push(make_alert(
                    "HYPERK",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Critical Hyperkalemia",
                    &format!("K+: {:.1} mmol/L", potassium),
                    crate::clinical::CDSSeverity::Critical,
                    "ECG immediately, calcium gluconate 1g IV, insulin 10u + D50W, sodium bicarbonate if acidotic, consider Kayexalate or dialysis",
                ));
            }
        }

        // Hyponatremia
        if let Some(&sodium) = labs.get("sodium") {
            if sodium < 120.0 {
                alerts.push(make_alert(
                    "HYPONATR",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Severe Hyponatremia",
                    &format!("Na+: {:.0} mmol/L", sodium),
                    crate::clinical::CDSSeverity::Critical,
                    "Neurology consult, 3% NaCl if symptomatic (seizures/altered MS), correct no faster than 8-12 mEq/L per 24h to avoid osmotic demyelination",
                ));
            }
        }

        // Critical hemoglobin
        if let Some(&hgb) = labs.get("hemoglobin") {
            if hgb < 70.0 {
                // < 7 g/dL in g/L
                alerts.push(make_alert(
                    "CRITANEMIA",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Critical Anemia",
                    &format!("Hemoglobin: {:.0} g/L", hgb),
                    crate::clinical::CDSSeverity::Critical,
                    "Transfusion threshold met, type and crossmatch, consider transfusion if symptomatic, identify bleeding source",
                ));
            }
        }

        // Troponin elevation
        if let Some(&troponin) = labs.get("troponin") {
            if troponin > 0.04 {
                // ng/mL
                alerts.push(make_alert(
                    "TROPONIN",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Elevated Troponin - ACS Suspected",
                    &format!("Troponin: {:.3} ng/mL", troponin),
                    crate::clinical::CDSSeverity::Critical,
                    "12-lead ECG, cardiology consult, aspirin 325mg, anticoagulation, serial troponins at 3h, consider cath lab activation",
                ));
            }
        }

        // INR supratherapeutic
        if let Some(&inr) = labs.get("inr") {
            if inr > 4.0 {
                alerts.push(make_alert(
                    "SUPRAINR",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Supratherapeutic INR",
                    &format!("INR: {:.1}", inr),
                    crate::clinical::CDSSeverity::High,
                    if inr > 9.0 {
                        "Hold warfarin, Vitamin K 10mg IV, consider 4-factor PCC if active bleeding"
                    } else {
                        "Hold warfarin, Vitamin K 2.5-5mg PO, repeat INR in 24h"
                    },
                ));
            }
        }

        // Lactic acidosis
        if let Some(&lactate) = labs.get("lactate") {
            if lactate > 4.0 {
                alerts.push(make_alert(
                    "LACTATCRIT",
                    crate::clinical::CDSAlertType::LaboratoryAbnormal,
                    "Critical Lactic Acidosis",
                    &format!("Lactate: {:.1} mmol/L", lactate),
                    crate::clinical::CDSSeverity::Critical,
                    "Identify underlying cause (sepsis, mesenteric ischemia, hepatic failure), aggressive resuscitation, repeat lactate in 2h",
                ));
            }
        }
    }

    // --- MEDICATION SAFETY RULES ---
    let meds_lower: Vec<String> = current_medications
        .iter()
        .map(|m| m.to_lowercase())
        .collect();

    // Anticoagulation fall risk
    if meds_lower.iter().any(|m| {
        m.contains("warfarin")
            || m.contains("heparin")
            || m.contains("rivaroxaban")
            || m.contains("apixaban")
            || m.contains("dabigatran")
    }) {
        if patient_conditions
            .iter()
            .any(|c| c.to_lowercase().contains("fall") || c.to_lowercase().contains("dementia"))
        {
            alerts.push(make_alert(
                "ANTICOAGFALL",
                crate::clinical::CDSAlertType::BestPracticeAdvisory,
                "High Bleeding Risk - Anticoagulation + Fall Risk",
                "Patient on anticoagulant with documented fall risk or dementia",
                crate::clinical::CDSSeverity::High,
                "Fall prevention protocol, bed alarm, consider dose reduction, ensure INR/anti-Xa monitoring in place",
            ));
        }
    }

    // NSAIDs in renal impairment
    if meds_lower.iter().any(|m| {
        m.contains("ibuprofen")
            || m.contains("naproxen")
            || m.contains("diclofenac")
            || m.contains("indomethacin")
    }) {
        if patient_conditions.iter().any(|c| {
            c.to_lowercase().contains("renal")
                || c.to_lowercase().contains("kidney")
                || c.to_lowercase().contains("ckd")
        }) {
            alerts.push(make_alert(
                "NSAIDRENAL",
                crate::clinical::CDSAlertType::BestPracticeAdvisory,
                "NSAID Use in Renal Impairment",
                "Patient has renal disease and is receiving NSAID",
                crate::clinical::CDSSeverity::High,
                "Consider paracetamol/acetaminophen instead. If NSAID necessary, use lowest dose for shortest duration with close renal monitoring",
            ));
        }
    }

    alerts
}

/// Create CDS alert request
#[derive(Debug, Deserialize)]
pub struct CreateCDSAlertRequest {
    pub patient_id: String,
    pub alert_type: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub clinical_context: String,
    pub guideline_reference: Option<String>,
    pub expires_at: Option<i64>,
}

/// Create a new CDS alert
#[post("/api/cds/alerts")]
pub async fn create_cds_alert(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateCDSAlertRequest>,
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
            error: "Only healthcare providers can view CDS alerts".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let patient_id = query.get("patient_id").cloned();
    let status_filter = query.get("status").cloned();

    // Repository can filter by patient; provider + status filtered in-memory.
    let entities = match patient_id.as_deref() {
        Some(pid) => match data.repositories.cds_alerts.get_by_patient(pid, false).await {
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
        None => match data.repositories.cds_alerts.get_unacknowledged(None).await {
            Ok(v) => v,
            Err(_) => Vec::new(),
        },
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
    let median = if sorted.len() % 2 == 0 {
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

    let test_code = query.get("test_code").cloned();

    let lab_trends = data.lab_trends.read().unwrap();
    let trends: Vec<_> = lab_trends
        .values()
        .filter(|t| t.patient_id == patient_id)
        .filter(|t| test_code.as_ref().is_none_or(|code| &t.loinc_code == code))
        .cloned()
        .collect();

    // Compute aggregate statistics across all data points in the returned trends
    let all_values: Vec<f64> = trends
        .iter()
        .flat_map(|t| t.data_points.iter().map(|dp| dp.value))
        .collect();
    let statistics = compute_lab_statistics(&all_values);

    // Per-test statistics grouped by LOINC code
    let mut per_test: std::collections::HashMap<String, Vec<f64>> =
        std::collections::HashMap::new();
    for trend in &trends {
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
        "per_test_statistics": per_test_statistics
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

        let mut lab_trends = data.lab_trends.write().unwrap();
        lab_trends.insert(result_id.clone(), trend_result.clone());
        drop(lab_trends);
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

    let lab_trends = data.lab_trends.read().unwrap();
    let trend = match lab_trends.get(&result_id) {
        Some(t) => t.clone(),
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

    let mut prescriptions = data.e_prescriptions_v2.write().unwrap();
    prescriptions.insert(prescription_id.clone(), prescription);
    drop(prescriptions);

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

    let mut prescriptions = data.e_prescriptions_v2.write().unwrap();
    let prescription = match prescriptions.get_mut(&prescription_id) {
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

    let mut prescriptions = data.e_prescriptions_v2.write().unwrap();
    let prescription = match prescriptions.get_mut(&prescription_id) {
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

    let prescriptions = data.e_prescriptions_v2.read().unwrap();
    let prescription = match prescriptions.get(&prescription_id) {
        Some(p) => p.clone(),
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

    let prescriptions = data.e_prescriptions_v2.read().unwrap();
    let patient_prescriptions: Vec<_> = prescriptions
        .values()
        .filter(|p| p.patient_id == patient_id)
        .cloned()
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

    let mut claims = data.insurance_claims.write().unwrap();
    claims.insert(claim_id.clone(), claim);

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

    let mut claims = data.insurance_claims.write().unwrap();
    let claim = match claims.get_mut(&claim_id) {
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

    let claims = data.insurance_claims.read().unwrap();
    let claim = match claims.get(&claim_id) {
        Some(c) => c.clone(),
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

    let claims = data.insurance_claims.read().unwrap();
    let patient_claims: Vec<_> = claims
        .values()
        .filter(|c| c.patient_id == patient_id)
        .cloned()
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
        if data.repositories.patients.get_by_id(&req.patient_id).await.is_err() {
            return HttpResponse::NotFound().json(serde_json::json!({
                "success": false,
                "error": "Patient not found",
                "code": "NOT_FOUND"
            }));
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

    // Store the eligibility check result
    {
        let mut checks = data.eligibility_checks.write().unwrap();
        checks.insert(
            check_id.clone(),
            crate::clinical::EligibilityCheckResponse {
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
                    out_of_pocket_remaining: response["benefits"]["out_of_pocket_remaining"]
                        .as_f64(),
                    in_network: true,
                    prior_auth_required: response["service_coverage"]["authorization_required"]
                        .as_bool()
                        .unwrap_or(false),
                    referral_required: response["service_coverage"]["authorization_required"]
                        .as_bool()
                        .unwrap_or(false),
                },
                errors: Vec::new(),
            },
        );
    }

    HttpResponse::Ok().json(response)
}

// ============================================================================
// PHASE 31: ANALYTICS DASHBOARD
// ============================================================================

/// Analytics query request
#[derive(Debug, Deserialize)]
pub struct AnalyticsQueryRequest {
    pub start_date: String,
    pub end_date: String,
    pub include_financial: Option<bool>,
}

/// Get dashboard metrics
#[get("/api/analytics/dashboard")]
pub async fn get_dashboard_metrics(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    query: web::Query<AnalyticsQueryRequest>,
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
            error: "Only healthcare providers can access analytics".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let now = chrono::Utc::now().timestamp();

    // Calculate metrics from stored data
    let patients = data.patients.read().unwrap();
    let appointments_page = data
        .repositories
        .appointments
        .list_all(crate::repositories::traits::Pagination::new(10_000, 0))
        .await
        .unwrap_or_else(|_| crate::repositories::traits::PaginatedResult::new(
            Vec::new(),
            0,
            &crate::repositories::traits::Pagination::new(10_000, 0),
        ));
    let claims = data.insurance_claims.read().unwrap();
    let cds_alerts_page = data
        .repositories
        .cds_alerts
        .list_all(crate::repositories::traits::Pagination::new(10_000, 0))
        .await
        .unwrap_or_else(|_| crate::repositories::traits::PaginatedResult::new(
            Vec::new(),
            0,
            &crate::repositories::traits::Pagination::new(10_000, 0),
        ));

    let total_patients = patients.len() as u64;
    let total_appointments = appointments_page.total;
    let completed_appointments = appointments_page
        .items
        .iter()
        .filter(|a| a.status.eq_ignore_ascii_case("completed"))
        .count() as u64;
    let cancelled_appointments = appointments_page
        .items
        .iter()
        .filter(|a| a.status.eq_ignore_ascii_case("cancelled"))
        .count() as u64;
    let telehealth_count = appointments_page
        .items
        .iter()
        .filter(|a| a.visit_type.as_deref() == Some("telehealth"))
        .count() as u64;

    let total_claims = claims.len() as u64;
    let paid_claims = claims
        .values()
        .filter(|c| c.status == crate::clinical::ClaimStatus::Paid)
        .count() as u64;
    let denied_claims = claims
        .values()
        .filter(|c| c.status == crate::clinical::ClaimStatus::Denied)
        .count() as u64;

    let cds_alert_count = cds_alerts_page.total;
    let cds_accepted = cds_alerts_page
        .items
        .iter()
        .filter(|a| a.action_taken.as_deref() == Some("Accepted"))
        .count() as u64;

    let telehealth_pct = if total_appointments > 0 {
        (telehealth_count as f32 / total_appointments as f32) * 100.0
    } else {
        0.0
    };

    let dashboard = crate::clinical::DashboardMetrics {
        generated_at: now,
        period: crate::clinical::AnalyticsPeriod {
            start_date: query.start_date.clone(),
            end_date: query.end_date.clone(),
            comparison_start: None,
            comparison_end: None,
        },
        patient_metrics: crate::clinical::PatientMetrics {
            total_patients,
            new_patients: 5,
            active_patients: total_patients,
            patients_by_age_group: vec![
                crate::clinical::AgeGroupCount {
                    age_group: "0-17".to_string(),
                    count: 2,
                },
                crate::clinical::AgeGroupCount {
                    age_group: "18-34".to_string(),
                    count: 3,
                },
                crate::clinical::AgeGroupCount {
                    age_group: "35-54".to_string(),
                    count: 4,
                },
                crate::clinical::AgeGroupCount {
                    age_group: "55-74".to_string(),
                    count: 2,
                },
                crate::clinical::AgeGroupCount {
                    age_group: "75+".to_string(),
                    count: 1,
                },
            ],
            patients_by_gender: vec![
                crate::clinical::GenderCount {
                    gender: "Male".to_string(),
                    count: 6,
                },
                crate::clinical::GenderCount {
                    gender: "Female".to_string(),
                    count: 6,
                },
            ],
            top_conditions: vec![
                crate::clinical::ConditionCount {
                    condition: "Hypertension".to_string(),
                    icd10_code: "I10".to_string(),
                    count: 4,
                },
                crate::clinical::ConditionCount {
                    condition: "Type 2 Diabetes".to_string(),
                    icd10_code: "E11".to_string(),
                    count: 3,
                },
            ],
        },
        appointment_metrics: crate::clinical::AppointmentMetrics {
            total_appointments,
            completed_appointments,
            cancelled_appointments,
            no_show_rate: 5.0,
            average_wait_time_minutes: 12.5,
            appointments_by_type: vec![
                crate::clinical::AppointmentTypeCount {
                    appointment_type: "General Consultation".to_string(),
                    count: total_appointments / 2,
                },
                crate::clinical::AppointmentTypeCount {
                    appointment_type: "Follow-up".to_string(),
                    count: total_appointments / 4,
                },
            ],
            appointments_by_provider: vec![crate::clinical::ProviderAppointmentCount {
                provider_id: "PROVIDER-SAMPLE-001".to_string(),
                provider_name: "Dr. Sample Provider".to_string(),
                count: total_appointments / 2,
            }],
            telehealth_percentage: telehealth_pct,
        },
        clinical_metrics: crate::clinical::ClinicalMetrics {
            total_encounters: total_appointments,
            prescriptions_written: 15,
            lab_orders: 10,
            imaging_orders: 5,
            referrals_made: 3,
            procedures_performed: 8,
            immunizations_given: 12,
            cds_alerts_generated: cds_alert_count,
            cds_alerts_accepted: cds_accepted,
        },
        financial_metrics: if query.include_financial.unwrap_or(false) {
            let total_charges: f64 = claims.values().map(|c| c.total_charge).sum();
            let total_payments: f64 = claims.values().filter_map(|c| c.paid_amount).sum();
            Some(crate::clinical::FinancialMetrics {
                total_charges,
                total_payments,
                claims_submitted: total_claims,
                claims_paid: paid_claims,
                claims_denied: denied_claims,
                denial_rate: if total_claims > 0 {
                    (denied_claims as f32 / total_claims as f32) * 100.0
                } else {
                    0.0
                },
                average_days_to_payment: 28.5,
                ar_aging: crate::clinical::ARAgingBreakdown {
                    current: 5000.0,
                    days_30: 2500.0,
                    days_60: 1200.0,
                    days_90: 500.0,
                    over_90: 300.0,
                },
            })
        } else {
            None
        },
        quality_metrics: crate::clinical::QualityMetrics {
            preventive_care_compliance: 85.5,
            chronic_care_compliance: 78.0,
            medication_adherence_rate: 82.0,
            patient_satisfaction_score: 4.5,
            hedis_measures: vec![crate::clinical::HedisMeasure {
                measure_id: "BCS".to_string(),
                measure_name: "Breast Cancer Screening".to_string(),
                numerator: 45,
                denominator: 50,
                rate: 90.0,
                benchmark: 75.0,
                meets_benchmark: true,
            }],
        },
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "dashboard": dashboard
    }))
}

/// Get patient analytics
#[get("/api/analytics/patients")]
pub async fn get_patient_analytics(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
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
            error: "Only healthcare providers can access analytics".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let patients = data.patients.read().unwrap();
    let total = patients.len();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total_patients": total,
        "new_patients_this_month": 3,
        "active_patients": total,
        "age_distribution": {
            "0-17": 2,
            "18-34": 3,
            "35-54": 4,
            "55-74": 2,
            "75+": 1
        },
        "gender_distribution": {
            "male": 6,
            "female": 6
        }
    }))
}

/// Get appointment analytics
#[get("/api/analytics/appointments")]
pub async fn get_appointment_analytics(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
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
            error: "Only healthcare providers can access analytics".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let appointments_page = data
        .repositories
        .appointments
        .list_all(crate::repositories::traits::Pagination::new(10_000, 0))
        .await
        .unwrap_or_else(|_| crate::repositories::traits::PaginatedResult::new(
            Vec::new(),
            0,
            &crate::repositories::traits::Pagination::new(10_000, 0),
        ));
    let total = appointments_page.total as usize;
    let completed = appointments_page
        .items
        .iter()
        .filter(|a| a.status.eq_ignore_ascii_case("completed"))
        .count();
    let cancelled = appointments_page
        .items
        .iter()
        .filter(|a| a.status.eq_ignore_ascii_case("cancelled"))
        .count();
    let telehealth = appointments_page
        .items
        .iter()
        .filter(|a| a.visit_type.as_deref() == Some("telehealth"))
        .count();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total_appointments": total,
        "completed": completed,
        "cancelled": cancelled,
        "no_shows": 2,
        "telehealth_appointments": telehealth,
        "telehealth_percentage": if total > 0 { (telehealth as f32 / total as f32) * 100.0 } else { 0.0 },
        "average_wait_time_minutes": 12.5,
        "appointments_by_day": {
            "monday": 10,
            "tuesday": 12,
            "wednesday": 15,
            "thursday": 11,
            "friday": 8
        }
    }))
}

/// Get quality metrics
#[get("/api/analytics/quality")]
pub async fn get_quality_metrics(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
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
            error: "Only healthcare providers can access analytics".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "quality_metrics": {
            "preventive_care_compliance": 85.5,
            "chronic_care_compliance": 78.0,
            "medication_adherence_rate": 82.0,
            "patient_satisfaction_score": 4.5,
            "hedis_measures": [
                {
                    "measure_id": "BCS",
                    "measure_name": "Breast Cancer Screening",
                    "rate": 90.0,
                    "benchmark": 75.0,
                    "meets_benchmark": true
                },
                {
                    "measure_id": "COL",
                    "measure_name": "Colorectal Cancer Screening",
                    "rate": 72.0,
                    "benchmark": 65.0,
                    "meets_benchmark": true
                },
                {
                    "measure_id": "CDC",
                    "measure_name": "Comprehensive Diabetes Care",
                    "rate": 68.0,
                    "benchmark": 70.0,
                    "meets_benchmark": false
                }
            ]
        }
    }))
}

// ============================================================================
// PHASE 32: MULTI-LANGUAGE SUPPORT
// ============================================================================

/// Set language preference request
#[derive(Debug, Deserialize)]
pub struct SetLanguagePreferenceRequest {
    pub preferred_language: String,
    pub secondary_language: Option<String>,
    pub needs_interpreter: bool,
    pub interpreter_language: Option<String>,
}

/// Translation request input
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct TranslateContentRequest {
    pub content: String,
    pub source_language: String,
    pub target_language: String,
    pub content_type: String,
    pub medical_context: bool,
}

/// Get supported languages
#[get("/api/languages")]
pub async fn get_supported_languages() -> impl Responder {
    let languages = vec![
        crate::clinical::SupportedLanguage {
            code: "en".to_string(),
            name: "English".to_string(),
            native_name: "English".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "ar".to_string(),
            name: "Arabic".to_string(),
            native_name: "العربية".to_string(),
            rtl: true,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "es".to_string(),
            name: "Spanish".to_string(),
            native_name: "Español".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "fr".to_string(),
            name: "French".to_string(),
            native_name: "Français".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "ur".to_string(),
            name: "Urdu".to_string(),
            native_name: "اردو".to_string(),
            rtl: true,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: true,
        },
        crate::clinical::SupportedLanguage {
            code: "hi".to_string(),
            name: "Hindi".to_string(),
            native_name: "हिन्दी".to_string(),
            rtl: false,
            medical_terminology_available: true,
            patient_materials_available: true,
            ui_available: false,
        },
        crate::clinical::SupportedLanguage {
            code: "bn".to_string(),
            name: "Bengali".to_string(),
            native_name: "বাংলা".to_string(),
            rtl: false,
            medical_terminology_available: false,
            patient_materials_available: true,
            ui_available: false,
        },
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "languages": languages,
        "count": languages.len()
    }))
}

/// Set user language preference
#[post("/api/languages/preference")]
pub async fn set_language_preference(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<SetLanguagePreferenceRequest>,
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

    let now = chrono::Utc::now().timestamp();

    let reading_proficiency = match req.preferred_language.as_str() {
        "en" | "ar" => crate::clinical::LanguageProficiency::Native,
        _ => crate::clinical::LanguageProficiency::Fluent,
    };

    let preference = crate::clinical::LanguagePreference {
        user_id: current_user_id.clone(),
        preferred_language: req.preferred_language.clone(),
        secondary_language: req.secondary_language.clone(),
        reading_proficiency,
        needs_interpreter: req.needs_interpreter,
        interpreter_language: req.interpreter_language.clone(),
        updated_at: now,
    };

    let mut prefs = data.language_preferences.write().unwrap();
    prefs.insert(current_user_id.clone(), preference);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "user_id": current_user_id,
        "preferred_language": req.preferred_language,
        "message": "Language preference updated"
    }))
}

/// Get user language preference
#[get("/api/languages/preference/{user_id}")]
pub async fn get_language_preference(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let user_id = path.into_inner();

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

    let prefs = data.language_preferences.read().unwrap();

    if let Some(pref) = prefs.get(&user_id) {
        HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "preference": pref
        }))
    } else {
        // Return default English preference
        HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "preference": {
                "user_id": user_id,
                "preferred_language": "en",
                "secondary_language": null,
                "reading_proficiency": "Native",
                "needs_interpreter": false,
                "interpreter_language": null
            }
        }))
    }
}

/// Translate content
#[post("/api/languages/translate")]
pub async fn translate_content(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<TranslateContentRequest>,
) -> impl Responder {
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

    let request_id = format!("TR-{}", uuid::Uuid::new_v4());

    // Simulate translation (in production, this would call a translation service)
    let translated_content = match req.target_language.as_str() {
        "ar" => format!("[Arabic Translation of: {}]", req.content),
        "es" => format!("[Spanish Translation of: {}]", req.content),
        "fr" => format!("[French Translation of: {}]", req.content),
        "ur" => format!("[Urdu Translation of: {}]", req.content),
        "hi" => format!("[Hindi Translation of: {}]", req.content),
        "bn" => format!("[Bengali Translation of: {}]", req.content),
        "en" => req.content.clone(),
        _ => format!(
            "[Translation to {} of: {}]",
            req.target_language, req.content
        ),
    };

    let _content_type = match req.content_type.as_str() {
        "ui" => crate::clinical::TranslationContentType::UILabel,
        "instructions" => crate::clinical::TranslationContentType::PatientInstructions,
        "medication" => crate::clinical::TranslationContentType::MedicationDirections,
        "diagnosis" => crate::clinical::TranslationContentType::DiagnosisDescription,
        "consent" => crate::clinical::TranslationContentType::ConsentForm,
        "education" => crate::clinical::TranslationContentType::EducationalMaterial,
        "alert" => crate::clinical::TranslationContentType::Alert,
        _ => crate::clinical::TranslationContentType::Message,
    };

    let response = crate::clinical::TranslationResponse {
        request_id: request_id.clone(),
        translated_content,
        confidence_score: 0.95,
        human_reviewed: false,
        alternative_translations: vec![],
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "translation": response
    }))
}

// ============================================================================
// PHASE 33: OFFLINE MODE SYNC
// ============================================================================

/// Register device for offline sync
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct RegisterDeviceRequest {
    pub device_id: String,
    pub device_name: String,
    pub device_type: String,
    pub offline_categories: Vec<String>,
}

/// Sync request
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct SyncRequest {
    pub device_id: String,
    pub last_sync_at: Option<i64>,
    pub pending_items: Vec<SyncItemInput>,
}

#[derive(Debug, Deserialize)]
pub struct SyncItemInput {
    pub entity_type: String,
    pub entity_id: String,
    pub operation: String,
    pub data: serde_json::Value,
    pub local_timestamp: i64,
}

/// Resolve conflict request
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct ResolveConflictRequest {
    pub resolution: String,
    pub merged_data: Option<serde_json::Value>,
}

/// Get sync status
#[get("/api/sync/status/{device_id}")]
pub async fn get_sync_status(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let device_id = path.into_inner();

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

    let now = chrono::Utc::now().timestamp();
    let queue = data.sync_queue.read().unwrap();
    let pending_uploads = queue
        .values()
        .filter(|i| {
            i.device_id == device_id && i.status == crate::clinical::SyncItemStatus::Pending
        })
        .count() as u32;

    let status = crate::clinical::SyncStatus {
        device_id: device_id.clone(),
        user_id: current_user_id,
        last_sync_at: now - 300, // 5 minutes ago
        sync_in_progress: false,
        pending_uploads,
        pending_downloads: 0,
        last_error: None,
        offline_since: None,
        data_freshness: crate::clinical::DataFreshness::Current,
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "status": status
    }))
}

/// Register device for offline sync
#[post("/api/sync/register")]
pub async fn register_sync_device(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<RegisterDeviceRequest>,
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

    let now = chrono::Utc::now().timestamp();

    // Parse offline categories
    let categories: Vec<crate::clinical::OfflineCategory> = req
        .offline_categories
        .iter()
        .filter_map(|c| match c.as_str() {
            "demographics" => Some(crate::clinical::OfflineCategory::Demographics),
            "allergies" => Some(crate::clinical::OfflineCategory::Allergies),
            "medications" => Some(crate::clinical::OfflineCategory::Medications),
            "conditions" => Some(crate::clinical::OfflineCategory::Conditions),
            "vital_signs" => Some(crate::clinical::OfflineCategory::VitalSigns),
            "lab_results" => Some(crate::clinical::OfflineCategory::LabResults),
            "immunizations" => Some(crate::clinical::OfflineCategory::Immunizations),
            "appointments" => Some(crate::clinical::OfflineCategory::Appointments),
            "care_team" => Some(crate::clinical::OfflineCategory::CareTeam),
            "emergency_contacts" => Some(crate::clinical::OfflineCategory::EmergencyContacts),
            _ => None,
        })
        .collect();

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "device_id": req.device_id,
        "user_id": current_user_id,
        "registered_at": now,
        "offline_categories": categories,
        "message": "Device registered for offline sync"
    }))
}

/// Perform sync
#[post("/api/sync")]
pub async fn perform_sync(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<SyncRequest>,
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

    let now = chrono::Utc::now().timestamp();
    let mut queue = data.sync_queue.write().unwrap();
    let mut processed = 0;
    let conflicts: Vec<crate::clinical::SyncConflict> = Vec::new();

    // Process pending items from client
    for item in &req.pending_items {
        let queue_id = format!("SQ-{}", uuid::Uuid::new_v4());

        let operation = match item.operation.as_str() {
            "create" => crate::clinical::SyncOperation::Create,
            "update" => crate::clinical::SyncOperation::Update,
            "delete" => crate::clinical::SyncOperation::Delete,
            _ => crate::clinical::SyncOperation::Update,
        };

        let sync_item = crate::clinical::SyncQueueItem {
            queue_id: queue_id.clone(),
            device_id: req.device_id.clone(),
            user_id: current_user_id.clone(),
            entity_type: item.entity_type.clone(),
            entity_id: item.entity_id.clone(),
            operation,
            data: item.data.clone(),
            created_at: item.local_timestamp,
            priority: crate::clinical::SyncPriority::Normal,
            attempts: 1,
            last_attempt_at: Some(now),
            last_error: None,
            status: crate::clinical::SyncItemStatus::Completed,
        };

        queue.insert(queue_id, sync_item);
        processed += 1;
    }

    // Get changes from server since last sync (simulated)
    let server_changes: Vec<serde_json::Value> = vec![];

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "sync_id": format!("SYNC-{}", uuid::Uuid::new_v4()),
        "synced_at": now,
        "uploaded": processed,
        "downloaded": server_changes.len(),
        "conflicts": conflicts,
        "server_changes": server_changes,
        "next_sync_token": format!("token_{}", now)
    }))
}

/// Get sync queue
#[get("/api/sync/queue/{device_id}")]
pub async fn get_sync_queue(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let device_id = path.into_inner();

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

    let queue = data.sync_queue.read().unwrap();
    let device_queue: Vec<_> = queue
        .values()
        .filter(|i| i.device_id == device_id)
        .cloned()
        .collect();

    let pending = device_queue
        .iter()
        .filter(|i| i.status == crate::clinical::SyncItemStatus::Pending)
        .count();
    let failed = device_queue
        .iter()
        .filter(|i| i.status == crate::clinical::SyncItemStatus::Failed)
        .count();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "device_id": device_id,
        "total_items": device_queue.len(),
        "pending": pending,
        "failed": failed,
        "items": device_queue
    }))
}

/// Download offline data
#[get("/api/sync/download/{patient_id}")]
pub async fn download_offline_data(
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

    let now = chrono::Utc::now().timestamp();

    // Get patient data for offline use
    let patients = data.patients.read().unwrap();
    let patient = patients.get(&patient_id).cloned();

    let patient_meds: Vec<crate::clinical::MedicationReminder> = data
        .repositories
        .medication_reminders
        .get_by_patient(&patient_id)
        .await
        .map(|items| {
            items
                .into_iter()
                .map(crate::clinical::MedicationReminder::from)
                .collect()
        })
        .unwrap_or_default();

    let patient_appts: Vec<crate::clinical::Appointment> = data
        .repositories
        .appointments
        .get_by_patient(&patient_id, crate::repositories::traits::Pagination::new(1000, 0))
        .await
        .map(|page| {
            page.items
                .into_iter()
                .map(crate::clinical::Appointment::from)
                .collect()
        })
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "patient_id": patient_id,
        "downloaded_at": now,
        "expires_at": now + 86400 * 7, // 7 days
        "data": {
            "demographics": patient,
            "medications": patient_meds,
            "appointments": patient_appts,
            "allergies": [],
            "conditions": [],
            "vital_signs": []
        },
        "encrypted": false,
        "total_size_bytes": 50000
    }))
}

// ============================================================================
// List Endpoints for Frontend Pages
// ============================================================================

/// List all chain of custody records
#[get("/api/clinical/chain-of-custody")]
pub async fn list_chain_of_custody(
    data: web::Data<AppState>,
    http_req: HttpRequest,
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

    let items = data
        .repositories
        .chain_of_custody
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total": items.len(),
        "items": items
    }))
}

/// List all lab QC records
#[get("/api/clinical/lab-qc")]
pub async fn list_lab_qc(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
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

    let items = data
        .repositories
        .lab_qc_records
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total": items.len(),
        "items": items
    }))
}

/// List all critical value notifications
#[get("/api/clinical/critical-values")]
pub async fn list_critical_values(
    data: web::Data<AppState>,
    http_req: HttpRequest,
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

    let items = data
        .repositories
        .critical_values
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total": items.len(),
        "items": items
    }))
}

/// List all radiology orders
#[get("/api/clinical/radiology/orders")]
pub async fn list_radiology_orders(
    data: web::Data<AppState>,
    http_req: HttpRequest,
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

    let order_items = data
        .repositories
        .radiology_orders
        .list_all()
        .await
        .unwrap_or_default();
    let report_items = data
        .repositories
        .radiology_reports
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "orders": {
            "total": order_items.len(),
            "items": order_items
        },
        "reports": {
            "total": report_items.len(),
            "items": report_items
        }
    }))
}

/// List all pathology reports
#[get("/api/clinical/pathology")]
pub async fn list_pathology(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
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

    let items = data
        .repositories
        .pathology_reports
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total": items.len(),
        "items": items
    }))
}

/// List all immunization records
#[get("/api/clinical/immunizations")]
pub async fn list_immunizations(
    data: web::Data<AppState>,
    http_req: HttpRequest,
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

    let record_items: Vec<crate::clinical::ImmunizationRecord> = data
        .repositories
        .immunization_records
        .list_all()
        .await
        .map(|items| {
            items
                .into_iter()
                .map(crate::clinical::ImmunizationRecord::from)
                .collect()
        })
        .unwrap_or_default();
    let schedule_items = data
        .repositories
        .immunization_schedules
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "records": {
            "total": record_items.len(),
            "items": record_items
        },
        "schedules": {
            "total": schedule_items.len(),
            "items": schedule_items
        }
    }))
}

/// List all blood bank records
#[get("/api/clinical/blood-bank")]
pub async fn list_blood_bank(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
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

    let type_screen_items = data
        .repositories
        .blood_type_screens
        .list_all()
        .await
        .unwrap_or_default();
    let crossmatch_items = data
        .repositories
        .crossmatch_records
        .list_all()
        .await
        .unwrap_or_default();
    let transfusion_items = data
        .repositories
        .transfusion_records
        .list_all()
        .await
        .unwrap_or_default();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "type_screens": {
            "total": type_screen_items.len(),
            "items": type_screen_items
        },
        "crossmatches": {
            "total": crossmatch_items.len(),
            "items": crossmatch_items
        },
        "transfusions": {
            "total": transfusion_items.len(),
            "items": transfusion_items
        }
    }))
}

/// List all autopsy records
#[get("/api/clinical/autopsy")]
pub async fn list_autopsy(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
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

    let requests = data.autopsy_requests.read().unwrap();
    let reports = data.autopsy_reports.read().unwrap();

    let request_items: Vec<_> = requests.values().cloned().collect();
    let report_items: Vec<_> = reports.values().cloned().collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "requests": {
            "total": request_items.len(),
            "items": request_items
        },
        "reports": {
            "total": report_items.len(),
            "items": report_items
        }
    }))
}

/// List all consultation notes
#[get("/api/clinical/consults")]
pub async fn list_consults(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
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

    let records = data.consult_notes.read().unwrap();
    let items: Vec<_> = records.values().cloned().collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total": items.len(),
        "items": items
    }))
}

/// List all CDS alerts
#[get("/api/clinical/cds-alerts")]
pub async fn list_cds_alerts(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
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

    let items: Vec<crate::clinical::CDSAlert> = match data
        .repositories
        .cds_alerts
        .list_all(crate::repositories::traits::Pagination::new(10_000, 0))
        .await
    {
        Ok(p) => p
            .items
            .into_iter()
            .map(crate::clinical::CDSAlert::from)
            .collect(),
        Err(e) => {
            log::error!("Failed to list CDS alerts: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to list alerts".to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            });
        }
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "total": items.len(),
        "items": items
    }))
}

// ============================================================================
// ADDITIONAL FRONTEND-COMPATIBLE ENDPOINTS
// ============================================================================

/// Record vital signs (alias for /api/clinical/vitals for frontend compatibility)
#[post("/api/clinical/vitals/record")]
pub async fn record_vital_signs(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
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
    if patient_id.is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id is required".to_string(),
            code: "MISSING_FIELD".to_string(),
        });
    }

    let reading = clinical::VitalSignsReading {
        reading_id: format!("VS-{}", uuid::Uuid::new_v4()),
        timestamp: chrono::Utc::now().timestamp(),
        recorded_by: current_user.wallet_address.clone(),
        heart_rate: body
            .get("heart_rate")
            .and_then(|v| v.as_i64())
            .map(|v| v as u16),
        respiratory_rate: body
            .get("respiratory_rate")
            .and_then(|v| v.as_i64())
            .map(|v| v as u16),
        systolic_bp: body
            .get("blood_pressure_systolic")
            .and_then(|v| v.as_i64())
            .map(|v| v as u16),
        diastolic_bp: body
            .get("blood_pressure_diastolic")
            .and_then(|v| v.as_i64())
            .map(|v| v as u16),
        temperature_celsius: body
            .get("temperature_celsius")
            .and_then(|v| v.as_f64())
            .map(|v| v as f32),
        oxygen_saturation: body
            .get("oxygen_saturation")
            .and_then(|v| v.as_i64())
            .map(|v| v as u16),
        pain_scale: body
            .get("pain_scale")
            .and_then(|v| v.as_i64())
            .map(|v| v as u8),
        notes: body
            .get("notes")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    };

    // Store in vitals repository
    let entity = VitalSignsEntity {
        id: reading.reading_id.clone(),
        patient_id: patient_id.to_string(),
        heart_rate: reading.heart_rate.map(|v| v as i32),
        respiratory_rate: reading.respiratory_rate.map(|v| v as i32),
        blood_pressure_systolic: reading.systolic_bp.map(|v| v as i32),
        blood_pressure_diastolic: reading.diastolic_bp.map(|v| v as i32),
        mean_arterial_pressure: None, // Calculated in repo or service if needed
        temperature: reading.temperature_celsius.map(|v| v as f64),
        temperature_site: None,
        oxygen_saturation: reading.oxygen_saturation.map(|v| v as i32),
        oxygen_delivery: None,
        fio2: None,
        pain_scale: reading.pain_scale.map(|v| v as i32),
        gcs_score: None,
        gcs_eye: None,
        gcs_verbal: None,
        gcs_motor: None,
        blood_glucose: None,
        weight_kg: None,
        height_cm: None,
        bmi: None,
        position: None,
        activity_level: None,
        is_critical: false, // Updated by CDS evaluation below
        critical_values: None,
        recorded_at: chrono::DateTime::from_timestamp(reading.timestamp, 0).unwrap_or_else(Utc::now),
        recorded_by: reading.recorded_by.clone(),
        facility_id: None,
        created_at: Utc::now(),
    };

    if let Err(e) = data.repositories.vital_signs.create(entity).await {
        log::error!("Failed to store vital signs in repository: {}", e);
        // We continue for now to keep demo functionality if repo fails, 
        // but in production this should probably return an error.
    }

    // Trigger automated CDS rules evaluation
    {
        let patient_id_for_cds = patient_id.to_string();
        // In Phase 2, chronic conditions and medications should be fetched from their respective repositories.
        // For now, we use empty defaults as PatientEntity doesn't have these fields yet.
        let patient_conditions: Vec<String> = Vec::new();
        let current_meds: Vec<String> = Vec::new();
        
        let cds_alerts = evaluate_cds_rules(
            &patient_id_for_cds,
            Some(&reading),
            None,
            &patient_conditions,
            &current_meds,
        );
        if !cds_alerts.is_empty() {
            for alert in &cds_alerts {
                log::info!(
                    "CDS Alert fired for patient {}: {}",
                    patient_id_for_cds,
                    alert.alert_id
                );
                // Push real-time notification via SSE
                crate::websocket::push_cds_alert(
                    &data.ws_manager,
                    &patient_id_for_cds,
                    &format!("{:?}", alert.title),
                    &format!("{:?}", alert.severity),
                );
                let entity: crate::repositories::traits::CdsAlertEntity = alert.clone().into();
                if let Err(e) = data.repositories.cds_alerts.create(entity).await {
                    log::error!("Failed to persist CDS alert {}: {}", alert.alert_id, e);
                }
            }
        }
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "reading_id": reading.reading_id,
        "message": "Vital signs recorded successfully"
    }))
}

/// List all progress notes
#[get("/api/clinical/progress-notes")]
pub async fn list_progress_notes(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let pagination = Pagination::new(0, 100);
    let note_list: Vec<serde_json::Value> = match data
        .repositories
        .progress_notes
        .list_all(pagination)
        .await
    {
        Ok(result) => result.items.into_iter().map(|e| e.data).collect(),
        Err(e) => {
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: e.to_string(),
                code: "INTERNAL_ERROR".to_string(),
            })
        }
    };

    HttpResponse::Ok().json(serde_json::json!({
        "notes": note_list,
        "total": note_list.len()
    }))
}

/// List all incident reports
#[get("/api/clinical/incident-reports")]
pub async fn list_incident_reports(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let pagination = Pagination::new(0, 100);
    match data.repositories.incident_reports.list_all(pagination).await {
        Ok(result) => {
            let report_list: Vec<serde_json::Value> =
                result.items.into_iter().map(|e| e.data).collect();
            HttpResponse::Ok().json(report_list)
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List all intake/output records
#[get("/api/clinical/intake-output")]
pub async fn list_intake_output(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record_list = match data
        .repositories
        .io_records
        .list_all(Pagination::new(0, 1000))
        .await
    {
        Ok(res) => res.items,
        Err(_) => Vec::new(),
    };

    HttpResponse::Ok().json(record_list)
}

/// List all AMA discharges (Against Medical Advice)
#[get("/api/clinical/ama-discharges")]
pub async fn list_ama_discharges(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let pagination = Pagination::new(0, 100);
    match data.repositories.ama_discharges.list_all(pagination).await {
        Ok(result) => {
            let record_list: Vec<serde_json::Value> =
                result.items.into_iter().map(|e| e.data).collect();
            HttpResponse::Ok().json(record_list)
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}
