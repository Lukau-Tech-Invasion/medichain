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
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let body = normalise_body_keys(req.into_inner());
    // The page posts camelCase and every lookup below is snake_case.
    // Without this the typed columns were written from nothing: an empty
    // patient id, zeroed counts and every flag false, returned as a 201.
    let patient_id = body
        .get("patient_id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if let Err(resp) = require_known_patient(&data, &patient_id).await {
        return resp;
    }
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
            // The page calls it `preOxygenation`.
            .or_else(|| body.get("preOxygenation"))
            .or_else(|| body.get("pre_oxygenation"))
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
            // The page calls it `cuffPressure`. An unrecorded cuff pressure is how a tube ends up over-inflated against the trachea.
            .or_else(|| body.get("cuffPressure"))
            .or_else(|| body.get("cuff_pressure"))
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
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Every intubation record in the deployment, for the ward worklist.
///
/// # Why this exists
///
/// `IntubationPage` kept its list in local React state: it posted the record, then did
/// `setRecords([newRecord, ...records])` and never read anything back. The
/// screen therefore showed what you typed **this session** and emptied on
/// reload, while the record sat in the database the whole time. There was no
/// read path to wire it to -- only `GET /api/clinical/intubation/{record_id}`,
/// keyed by an id the screen never displays.
///
/// Returns the stored records, not the submitted payload: the id is
/// server-assigned, so a screen that echoes its own submission has no id to
/// open a detail view with.
#[get("/api/clinical/intubation-records")]
pub async fn list_intubation_records(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Only healthcare providers can view intubation records".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.intubation_records.list_all().await {
        Ok(items) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "records": items,
        })),
        Err(e) => {
            log::error!("intubation record list failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                error: e.to_string(),
                code: "INTERNAL_ERROR".to_string(),
            })
        }
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
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
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
        Ok(entity) => {
            // The stored record, not `entity.data`. `data` is `#[sqlx(skip)]`
            // on every one of these entities, so on PostgreSQL it is always
            // `Value::Null` — this endpoint returned a literal `null` with a
            // 200 for every record ever saved. The typed columns are the record.
            HttpResponse::Ok().json(entity)
        }
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            error: "Intubation record not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
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
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let body = req.into_inner();

    // `patient_id`, `location` and `length_cm` are NOT NULL in the schema, and
    // every one of them was read with `unwrap_or_default()` -- so a submission
    // missing all three stored a repair on patient "" at site "" of length 0.
    // In memory that succeeds silently; on PostgreSQL `patient_id` is a foreign
    // key, so it fails as an opaque 500 for what is a client mistake.
    //
    // Length 0 is refused rather than stored: an unmeasured wound is not a
    // zero-centimetre wound, and a repair record whose length reads 0 is worse
    // than one that was never filed.
    let required_text = |key: &str| -> bool {
        body.get(key)
            .and_then(|v| v.as_str())
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false)
    };
    let length = body.get("length_cm").and_then(|v| v.as_f64());
    if !required_text("patient_id") || !required_text("location") {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "patient_id and location are required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if !matches!(length, Some(l) if l > 0.0) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "length_cm is required and must be greater than zero".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }

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
        // Stamped from the session, not read from the body. Repairing a wound
        // is an accountable clinical act, and `performed_by` was previously
        // whatever the caller claimed -- or an empty string when they claimed
        // nothing. The same reasoning as `create_radiology_order`'s
        // `require_actor_is_caller`.
        performed_by: current_user.wallet_address.clone(),
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
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
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
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Only healthcare providers can view laceration repairs".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // `get_by_patient("all", ...)` was a literal patient id.
    //
    // In memory that happened to behave like a wildcard; on PostgreSQL it is
    // `WHERE patient_id = 'all'`, which matches nothing -- so this list was
    // empty for every deployment that used a database, no matter how many
    // repairs had been documented. `list_discharges` carried the identical bug
    // and the identical comment; this one was missed.
    //
    // Verified 2026-09-15: a repair filed through `POST /api/clinical/laceration`
    // returned 201 and then did not appear here at all.
    match data.repositories.laceration_repairs.list_all().await {
        Ok(items) => {
            // The stored records, not `e.data`. `data` is the payload the
            // screen composed, and the screen does not know the id -- that is
            // server-assigned -- so every row came back without one, and the
            // detail view had nothing to open.
            HttpResponse::Ok().json(items)
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
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
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
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
        Ok(entity) => {
            // The stored record, not `entity.data`. `data` is `#[sqlx(skip)]`
            // on every one of these entities, so on PostgreSQL it is always
            // `Value::Null` — this endpoint returned a literal `null` with a
            // 200 for every record ever saved. The typed columns are the record.
            HttpResponse::Ok().json(entity)
        }
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            error: "Laceration repair not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
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
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let body = normalise_body_keys(req.into_inner());
    // The page posts camelCase and every lookup below is snake_case.
    // Without this the typed columns were written from nothing: an empty
    // patient id, zeroed counts and every flag false, returned as a 201.
    let patient_id = body
        .get("patient_id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if let Err(resp) = require_known_patient(&data, &patient_id).await {
        return resp;
    }
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
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Every splint or cast record in the deployment, for the ward worklist.
///
/// # Why this exists
///
/// `SplintPage` kept its list in local React state: it posted the record, then did
/// `setRecords([newRecord, ...records])` and never read anything back. The
/// screen therefore showed what you typed **this session** and emptied on
/// reload, while the record sat in the database the whole time. There was no
/// read path to wire it to -- only `GET /api/clinical/splint/{record_id}`,
/// keyed by an id the screen never displays.
///
/// Returns the stored records, not the submitted payload: the id is
/// server-assigned, so a screen that echoes its own submission has no id to
/// open a detail view with.
#[get("/api/clinical/splint-records")]
pub async fn list_splint_records(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Only healthcare providers can view splint or cast records".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data.repositories.splint_cast_records.list_all().await {
        Ok(items) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "records": items,
        })),
        Err(e) => {
            log::error!("splint or cast record list failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                error: e.to_string(),
                code: "INTERNAL_ERROR".to_string(),
            })
        }
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
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
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
        Ok(entity) => {
            // The stored record, not `entity.data`. `data` is `#[sqlx(skip)]`
            // on every one of these entities, so on PostgreSQL it is always
            // `Value::Null` — this endpoint returned a literal `null` with a
            // 200 for every record ever saved. The typed columns are the record.
            HttpResponse::Ok().json(entity)
        }
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            error: "Splint/cast record not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// A laceration repair has to reach the list a clinician actually opens.
///
/// Two bugs made this page look finished while doing nothing. The Save button
/// had no handler at all, and `list_laceration_repairs` asked the repository
/// for `get_by_patient("all", ...)` -- a literal patient id, which is a
/// wildcard in memory and matches nothing on PostgreSQL. So even once the
/// button worked, the repair would have been stored and then invisible.
///
/// These tests run the write and the read in one process, because testing the
/// read alone passes against a store the producer never reaches.
#[cfg(test)]
mod laceration_round_trip_tests {
    use crate::{AppState, Role, User};
    use actix_web::{test, web, App};

    fn state_with(role: Role, wallet: &str) -> web::Data<AppState> {
        let state = AppState::new();
        let user = User {
            wallet_address: wallet.to_string(),
            username: None,
            name: "Test".to_string(),
            role,
            created_at: chrono::Utc::now(),
            created_by: None,
            linked_patient_id: None,
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        };
        state
            .users
            .write()
            .unwrap()
            .insert(wallet.to_string(), user);
        web::Data::new(state)
    }

    /// `LacerationRepairPage`'s payload, field for field.
    fn repair(patient_id: &str, location: &str) -> serde_json::Value {
        serde_json::json!({
            "patient_id": patient_id,
            "location": location,
            "length_cm": 3.5,
            "closure_technique": "sutures",
            "wound_type": "laceration",
            "depth_category": "partial thickness",
            "tetanus_given": true,
            "antibiotics_prescribed": false,
            "suture_size": "4-0",
            "suture_material": "Nylon",
            "number_of_sutures": 6,
            "anesthetic_agent": "1% Lidocaine with epinephrine",
            "notes": "Irrigated with saline.",
            "performed_at": "2026-09-15T09:00:00Z",
        })
    }

    async fn post_then_list(
        data: web::Data<AppState>,
        wallet: &str,
        body: serde_json::Value,
    ) -> (u16, u16, String) {
        let app = test::init_service(
            App::new()
                .app_data(data)
                .service(super::create_laceration)
                .service(super::list_laceration_repairs),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/clinical/laceration")
            .insert_header(("X-User-Id", wallet.to_string()))
            .set_json(body)
            .to_request();
        let created = test::call_service(&app, req).await.status().as_u16();

        let req = test::TestRequest::get()
            .uri("/api/clinical/laceration-repairs")
            .insert_header(("X-User-Id", wallet.to_string()))
            .to_request();
        let resp = test::call_service(&app, req).await;
        let listed = resp.status().as_u16();
        let body = test::read_body(resp).await;
        (created, listed, String::from_utf8_lossy(&body).to_string())
    }

    /// The assertion the page needed: what the doctor saves, the list shows.
    #[actix_rt::test]
    async fn a_repair_appears_on_the_list_that_documented_it() {
        let data = state_with(Role::Doctor, "5Doctor");
        let (created, listed, body) =
            post_then_list(data, "5Doctor", repair("PAT-1", "Right forearm")).await;
        assert_eq!(created, 201, "the repair was not stored");
        assert_eq!(listed, 200);
        assert!(
            body.contains("Right forearm"),
            "a repair that is stored and cannot be listed is a repair nobody signs: {body}"
        );
        // The server-assigned id, which `.map(|e| e.data)` used to drop -- the
        // detail view has nothing to open without it.
        assert!(
            body.contains("\"id\":\"LAC-"),
            "no record id in the list: {body}"
        );
        // `performed_by` is stamped from the session, not taken from the body.
        assert!(
            body.contains("5Doctor"),
            "the performer was not recorded: {body}"
        );
    }

    /// An unmeasured wound is not a zero-centimetre wound.
    #[actix_rt::test]
    async fn a_repair_with_no_length_is_refused() {
        let data = state_with(Role::Doctor, "5Doctor");
        let mut body = repair("PAT-1", "Right forearm");
        body["length_cm"] = serde_json::json!(0);
        let (created, _, _) = post_then_list(data, "5Doctor", body).await;
        assert_eq!(created, 400);
    }

    /// `patient_id` and `location` are NOT NULL in the schema, and both were
    /// read with `unwrap_or_default()` -- a repair on patient "" at site "".
    #[actix_rt::test]
    async fn a_repair_with_no_patient_is_refused() {
        let data = state_with(Role::Doctor, "5Doctor");
        let (created, _, _) = post_then_list(data, "5Doctor", repair("", "Right forearm")).await;
        assert_eq!(created, 400);
    }

    #[actix_rt::test]
    async fn a_repair_with_no_site_is_refused() {
        let data = state_with(Role::Doctor, "5Doctor");
        let (created, _, _) = post_then_list(data, "5Doctor", repair("PAT-1", "   ")).await;
        assert_eq!(created, 400);
    }

    /// Documenting a procedure is editing the medical record.
    #[actix_rt::test]
    async fn a_patient_cannot_document_a_repair() {
        let data = state_with(Role::Patient, "5Patient");
        let (created, _, _) =
            post_then_list(data, "5Patient", repair("PAT-1", "Right forearm")).await;
        assert_eq!(created, 403);
    }
}

/// The ward worklists these pages render.
///
/// `IntubationPage` and `SplintPage` both posted their record and then did
/// `setRecords([newRecord, ...records])` -- local React state, never read back.
/// The screen showed this session's typing and emptied on reload, while every
/// record sat in the database reachable only by an id the screen never showed.
/// There was no list route to wire them to; these are it.
#[cfg(test)]
mod procedure_worklist_tests {
    use crate::{AppState, Role, User};
    use actix_web::{test, web, App};

    fn state_with(role: Role, wallet: &str) -> web::Data<AppState> {
        let state = AppState::new();
        let user = User {
            wallet_address: wallet.to_string(),
            username: None,
            name: "Test".to_string(),
            role,
            created_at: chrono::Utc::now(),
            created_by: None,
            linked_patient_id: None,
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        };
        state
            .users
            .write()
            .unwrap()
            .insert(wallet.to_string(), user);
        web::Data::new(state)
    }

    /// `IntubationPage`'s payload: camelCase and flat, as the screen sends it.
    fn intubation(patient_id: &str, indication: &str) -> serde_json::Value {
        serde_json::json!({
            "patientId": patient_id,
            "indication": indication,
            "airwayAssessment": { "mallampati": "II" },
            "preOxygenation": true,
            "rsiUsed": true,
            "medications": [{ "name": "Ketamine", "dose": "2mg/kg" }],
            "complications": [],
            "verification": { "etco2": true },
            "notes": "Grade 1 view.",
        })
    }

    /// `SplintPage`'s payload.
    fn splint(patient_id: &str, indication: &str) -> serde_json::Value {
        serde_json::json!({
            "patientId": patient_id,
            "type": "posterior",
            "material": "plaster",
            "bodyPart": "ankle",
            "side": "left",
            "indication": indication,
            "paddingAdequate": true,
            "edgesSmooth": true,
            "notes": "Neurovascularly intact after application.",
        })
    }

    /// Both handlers refuse an unknown patient with 404 `PATIENT_NOT_FOUND`,
    /// which is correct -- documenting a procedure on a patient who does not
    /// exist is a client mistake, not a database error -- so the worklist tests
    /// have to seed one.
    async fn seed_patient(data: &web::Data<AppState>, id: &str) {
        let patient = crate::repositories::traits::PatientEntity {
            id: id.to_string(),
            health_id: format!("HID-{id}"),
            national_id_hash: format!("hash-{id}"),
            national_id_type: "FaydaID".to_string(),
            first_name_encrypted: None,
            last_name_encrypted: None,
            date_of_birth_encrypted: None,
            gender: Some("Male".to_string()),
            blood_type: Some("O+".to_string()),
            phone_encrypted: None,
            email_encrypted: None,
            address_encrypted: None,
            emergency_contact_name_encrypted: None,
            emergency_contact_phone_encrypted: None,
            emergency_contact_relationship: None,
            organ_donor: false,
            dnr_status: false,
            dnr_verified_by: None,
            dnr_verified_at: None,
            dnr_document_ref: None,
            primary_provider_id: None,
            wallet_address: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            registered_by: None,
            is_verified: false,
            is_active: true,
            profile_extras_encrypted: None,
            name_search_tokens: Vec::new(),
            key_version: 1,
        };
        let _ = data.repositories.patients.create(patient).await;
    }

    async fn post_then_list(
        data: web::Data<AppState>,
        wallet: &str,
        post_uri: &str,
        list_uri: &str,
        body: serde_json::Value,
    ) -> (u16, u16, String) {
        seed_patient(&data, "PAT-1").await;
        let app = test::init_service(
            App::new()
                .app_data(data)
                .service(super::create_intubation)
                .service(super::create_splint)
                .service(super::list_intubation_records)
                .service(super::list_splint_records),
        )
        .await;

        let req = test::TestRequest::post()
            .uri(post_uri)
            .insert_header(("X-User-Id", wallet.to_string()))
            .set_json(body)
            .to_request();
        let created = test::call_service(&app, req).await.status().as_u16();

        let req = test::TestRequest::get()
            .uri(list_uri)
            .insert_header(("X-User-Id", wallet.to_string()))
            .to_request();
        let resp = test::call_service(&app, req).await;
        let listed = resp.status().as_u16();
        let body = test::read_body(resp).await;
        (created, listed, String::from_utf8_lossy(&body).to_string())
    }

    #[actix_rt::test]
    async fn an_intubation_appears_on_the_worklist_that_documented_it() {
        let data = state_with(Role::Doctor, "5Doctor");
        let (created, listed, body) = post_then_list(
            data,
            "5Doctor",
            "/api/clinical/intubation",
            "/api/clinical/intubation-records",
            intubation("PAT-1", "Airway protection after overdose"),
        )
        .await;
        assert_eq!(created, 201);
        assert_eq!(listed, 200);
        assert!(
            body.contains("Airway protection after overdose"),
            "the record did not come back: {body}"
        );
        // The server-assigned id: a screen echoing its own submission has
        // nothing to open a detail view with.
        assert!(body.contains("\"id\":\"INT-"), "no record id: {body}");
    }

    #[actix_rt::test]
    async fn a_splint_appears_on_the_worklist_that_documented_it() {
        let data = state_with(Role::Doctor, "5Doctor");
        let (created, listed, body) = post_then_list(
            data,
            "5Doctor",
            "/api/clinical/splint",
            "/api/clinical/splint-records",
            splint("PAT-1", "Distal fibula fracture"),
        )
        .await;
        assert_eq!(created, 201);
        assert_eq!(listed, 200);
        assert!(
            body.contains("Distal fibula fracture"),
            "not returned: {body}"
        );
        assert!(body.contains("\"id\":\"SPL-"), "no record id: {body}");
    }

    /// A patient must not be able to enumerate the ward's procedures.
    #[actix_rt::test]
    async fn a_patient_cannot_read_the_worklists() {
        for (post_uri, list_uri) in [
            (
                "/api/clinical/intubation",
                "/api/clinical/intubation-records",
            ),
            ("/api/clinical/splint", "/api/clinical/splint-records"),
        ] {
            let data = state_with(Role::Patient, "5Patient");
            let (_, listed, _) = post_then_list(
                data,
                "5Patient",
                post_uri,
                list_uri,
                intubation("PAT-1", "x"),
            )
            .await;
            assert_eq!(listed, 403, "{list_uri} was readable by a patient");
        }
    }
}
