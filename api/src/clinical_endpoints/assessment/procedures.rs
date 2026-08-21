//! `clinical_endpoints::assessment::procedures` — Phase 5 procedure handlers
//! (intubation, laceration repair, splint).
//!
//! Split out of the former single-file `assessment.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `assessment/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// ============================================================================
// PHASE 5: PROCEDURE ENDPOINTS
// ============================================================================

/// Create intubation record
#[post("/api/clinical/intubation")]
pub async fn create_intubation(
    data: web::Data<AppState>,
    req: web::Json<serde_json::Value>,
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

    let body = req.into_inner();
    let now = chrono::Utc::now();
    // Server-generated: a client-supplied id lets one submission overwrite another.
    let record_id = format!("INT-{}", uuid::Uuid::new_v4().simple());
    let entity = IntubationRecordEntity {
        id: record_id.clone(),
        patient_id: body
            .get("patient_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        indication: body
            .get("indication")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        urgency: body
            .get("urgency")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("emergent")
            .to_string(),
        intubator_id: body
            .get("intubator_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        assistant_id: body
            .get("assistant_id")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        pre_oxygenation: body
            .get("pre_oxygenation")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        pre_oxygenation_method: body
            .get("pre_oxygenation_method")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        induction_agents: body.get("induction_agents").cloned(),
        paralytic_agent: body
            .get("paralytic_agent")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        paralytic_dose: body
            .get("paralytic_dose")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        laryngoscope_type: body
            .get("laryngoscope_type")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        blade_size: body
            .get("blade_size")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        ett_size: body
            .get("ett_size")
            .and_then(|v| v.as_f64())
            .and_then(rust_decimal::Decimal::from_f64_retain)
            .unwrap_or_default(),
        ett_depth_cm: body
            .get("ett_depth_cm")
            .and_then(|v| v.as_f64())
            .and_then(rust_decimal::Decimal::from_f64_retain),
        cuff_pressure_cmh2o: body
            .get("cuff_pressure_cmh2o")
            .and_then(|v| v.as_f64())
            .and_then(rust_decimal::Decimal::from_f64_retain),
        attempts: body.get("attempts").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
        view_grade: body
            .get("view_grade")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        adjuncts_used: body.get("adjuncts_used").cloned(),
        difficult_airway: body
            .get("difficult_airway")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        difficult_airway_features: body.get("difficult_airway_features").cloned(),
        complications: body.get("complications").cloned(),
        verification_methods: body.get("verification_methods").cloned(),
        post_intubation_vitals: body.get("post_intubation_vitals").cloned(),
        performed_at: body
            .get("performed_at")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc))
            .unwrap_or(now),
        created_at: now,
        updated_at: now,
        data: body.clone(),
    };

    match data.repositories.intubation_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "record_id": record_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
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

    match data
        .repositories
        .intubation_records
        .get_by_id(&record_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Intubation record not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
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
    req: web::Json<serde_json::Value>,
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

    let body = req.into_inner();
    let now = chrono::Utc::now();
    // Server-generated: a client-supplied id lets one submission overwrite another.
    let record_id = format!("LAC-{}", uuid::Uuid::new_v4().simple());
    let entity = LacerationRepairEntity {
        id: record_id.clone(),
        patient_id: body
            .get("patient_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        location: body
            .get("location")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        length_cm: body
            .get("length_cm")
            .and_then(|v| v.as_f64())
            .and_then(rust_decimal::Decimal::from_f64_retain)
            .unwrap_or_default(),
        depth_cm: body
            .get("depth_cm")
            .and_then(|v| v.as_f64())
            .and_then(rust_decimal::Decimal::from_f64_retain),
        width_cm: body
            .get("width_cm")
            .and_then(|v| v.as_f64())
            .and_then(rust_decimal::Decimal::from_f64_retain),
        mechanism: body
            .get("mechanism")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        contamination_level: body
            .get("contamination_level")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        wound_age_hours: body
            .get("wound_age_hours")
            .and_then(|v| v.as_f64())
            .and_then(rust_decimal::Decimal::from_f64_retain),
        tetanus_status: body
            .get("tetanus_status")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        tetanus_given: body.get("tetanus_given").and_then(|v| v.as_bool()),
        anesthesia_type: body
            .get("anesthesia_type")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        anesthetic_agent: body
            .get("anesthetic_agent")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        anesthetic_volume_ml: body
            .get("anesthetic_volume_ml")
            .and_then(|v| v.as_f64())
            .and_then(rust_decimal::Decimal::from_f64_retain),
        irrigation_solution: body
            .get("irrigation_solution")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        irrigation_volume_ml: body
            .get("irrigation_volume_ml")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        debridement_performed: body
            .get("debridement_performed")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        closure_technique: body
            .get("closure_technique")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        suture_material: body
            .get("suture_material")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        suture_size: body
            .get("suture_size")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        number_of_sutures: body
            .get("number_of_sutures")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        deep_sutures_placed: body.get("deep_sutures_placed").and_then(|v| v.as_bool()),
        skin_adhesive_used: body.get("skin_adhesive_used").and_then(|v| v.as_bool()),
        steri_strips_applied: body.get("steri_strips_applied").and_then(|v| v.as_bool()),
        dressing_applied: body
            .get("dressing_applied")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        complications: body
            .get("complications")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        aftercare_instructions: body
            .get("aftercare_instructions")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        follow_up_date: body
            .get("follow_up_date")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()),
        suture_removal_date: body
            .get("suture_removal_date")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()),
        performed_by: body
            .get("performed_by")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        performed_at: body
            .get("performed_at")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc))
            .unwrap_or(now),
        created_at: now,
        updated_at: now,
        data: body.clone(),
    };

    match data.repositories.laceration_repairs.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "record_id": record_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
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
    match data
        .repositories
        .laceration_repairs
        .get_by_patient("all", pagination)
        .await
    {
        Ok(result) => {
            let repairs: Vec<serde_json::Value> =
                result.items.into_iter().map(|e| e.data).collect();
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

    match data
        .repositories
        .laceration_repairs
        .get_by_id(&record_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Laceration repair not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
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
    req: web::Json<serde_json::Value>,
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

    let body = req.into_inner();
    let now = chrono::Utc::now();
    // Server-generated: a client-supplied id lets one submission overwrite another.
    let record_id = format!("SPL-{}", uuid::Uuid::new_v4().simple());
    let entity = SplintCastRecordEntity {
        id: record_id.clone(),
        patient_id: body
            .get("patient_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        injury_type: body
            .get("injury_type")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        injury_location: body
            .get("injury_location")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        laterality: body
            .get("laterality")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        fracture_type: body
            .get("fracture_type")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        immobilization_type: body
            .get("immobilization_type")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("splint")
            .to_string(),
        material: body
            .get("material")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        position: body
            .get("position")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        padding_type: body
            .get("padding_type")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        neurovascular_check_pre: body.get("neurovascular_check_pre").cloned(),
        neurovascular_check_post: body.get("neurovascular_check_post").cloned(),
        xray_pre: body.get("xray_pre").and_then(|v| v.as_bool()),
        xray_post: body.get("xray_post").and_then(|v| v.as_bool()),
        reduction_performed: body.get("reduction_performed").and_then(|v| v.as_bool()),
        reduction_technique: body
            .get("reduction_technique")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        anesthesia_type: body
            .get("anesthesia_type")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        complications: body
            .get("complications")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        weight_bearing_status: body
            .get("weight_bearing_status")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        elevation_instructions: body.get("elevation_instructions").and_then(|v| v.as_bool()),
        ice_instructions: body.get("ice_instructions").and_then(|v| v.as_bool()),
        follow_up_date: body
            .get("follow_up_date")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()),
        follow_up_provider: body
            .get("follow_up_provider")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        removal_date: body
            .get("removal_date")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()),
        applied_by: body
            .get("applied_by")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        applied_at: body
            .get("applied_at")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc))
            .unwrap_or(now),
        created_at: now,
        updated_at: now,
        data: body.clone(),
    };

    match data.repositories.splint_cast_records.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "record_id": record_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
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

    match data
        .repositories
        .splint_cast_records
        .get_by_id(&record_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Splint/cast record not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}
