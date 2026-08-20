//! `clinical_endpoints::assessment::specialty_population` — Phase 6 specialty-population
//! handlers (pediatrics, obstetrics).
//!
//! Split out of the former single-file `assessment.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `assessment/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// PHASE 6: SPECIALTY POPULATION ENDPOINTS
// ============================================================================

/// Create pediatric assessment
#[post("/api/clinical/peds")]
pub async fn create_peds(
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
    let assessment_id = format!("PED-{}", uuid::Uuid::new_v4().simple());
    let entity = PediatricAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: body
            .get("patient_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        // Who performed the assessment is the authenticated caller, not a
        // value the client asserts — the pages were sending a literal
        // "Current Doctor" placeholder, which is what ended up on the record.
        assessed_by: current_user.wallet_address.clone(),
        assessment_datetime: body
            .get("assessment_datetime")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc))
            .unwrap_or(now),
        age_months: body.get("age_months").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
        weight_kg: body
            .get("weight_kg")
            .and_then(|v| v.as_f64())
            .and_then(rust_decimal::Decimal::from_f64_retain),
        weight_estimated: body
            .get("weight_estimated")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        length_cm: body
            .get("length_cm")
            .and_then(|v| v.as_f64())
            .and_then(rust_decimal::Decimal::from_f64_retain),
        head_circumference_cm: body
            .get("head_circumference_cm")
            .and_then(|v| v.as_f64())
            .and_then(rust_decimal::Decimal::from_f64_retain),
        broselow_color: body
            .get("broselow_color")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        chief_complaint: body
            .get("chief_complaint")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        history_source: body
            .get("history_source")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        immunizations_up_to_date: body
            .get("immunizations_up_to_date")
            .and_then(|v| v.as_bool()),
        last_immunization_date: body
            .get("last_immunization_date")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()),
        developmental_milestones: body.get("developmental_milestones").cloned(),
        developmental_concerns: body
            .get("developmental_concerns")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        birth_history: body.get("birth_history").cloned(),
        feeding_pattern: body
            .get("feeding_pattern")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        last_feed_time: body
            .get("last_feed_time")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
        wet_diapers_24hr: body
            .get("wet_diapers_24hr")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        activity_level: body
            .get("activity_level")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        pediatric_triangle: body.get("pediatric_triangle").cloned(),
        appearance_score: body
            .get("appearance_score")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        work_of_breathing: body
            .get("work_of_breathing")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        circulation_to_skin: body
            .get("circulation_to_skin")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        pain_scale_type: body
            .get("pain_scale_type")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        pain_score: body
            .get("pain_score")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        fontanelle_status: body
            .get("fontanelle_status")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        capillary_refill_seconds: body
            .get("capillary_refill_seconds")
            .and_then(|v| v.as_f64())
            .and_then(rust_decimal::Decimal::from_f64_retain),
        skin_turgor: body
            .get("skin_turgor")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        mucous_membranes: body
            .get("mucous_membranes")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        parent_guardian_present: body
            .get("parent_guardian_present")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        parent_guardian_name: body
            .get("parent_guardian_name")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        parent_guardian_relationship: body
            .get("parent_guardian_relationship")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        child_protective_concerns: body
            .get("child_protective_concerns")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        cps_notified: body
            .get("cps_notified")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        notes: body
            .get("notes")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        created_at: now,
        updated_at: now,
        data: body.clone(),
    };

    match data.repositories.pediatric_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
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

    match data
        .repositories
        .pediatric_assessments
        .get_by_id(&assessment_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Pediatric assessment not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
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
    let assessment_id = format!("OBE-{}", uuid::Uuid::new_v4().simple());
    let entity = ObstetricEmergencyEntity {
        id: assessment_id.clone(),
        patient_id: body
            .get("patient_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        // Who performed the assessment is the authenticated caller, not a
        // value the client asserts — the pages were sending a literal
        // "Current Doctor" placeholder, which is what ended up on the record.
        assessed_by: current_user.wallet_address.clone(),
        assessment_datetime: body
            .get("assessment_datetime")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc))
            .unwrap_or(now),
        gestational_age_weeks: body
            .get("gestational_age_weeks")
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32,
        gestational_age_days: body
            .get("gestational_age_days")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        gravida: body.get("gravida").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
        para: body.get("para").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
        abortions: body
            .get("abortions")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        living_children: body
            .get("living_children")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        lmp_date: body
            .get("lmp_date")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()),
        edd_date: body
            .get("edd_date")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()),
        prenatal_care: body
            .get("prenatal_care")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        prenatal_care_provider: body
            .get("prenatal_care_provider")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        pregnancy_complications: body.get("pregnancy_complications").cloned(),
        chief_complaint: body
            .get("chief_complaint")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        contractions: body
            .get("contractions")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        contraction_frequency_min: body
            .get("contraction_frequency_min")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        contraction_duration_sec: body
            .get("contraction_duration_sec")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        rupture_of_membranes: body
            .get("rupture_of_membranes")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        rom_time: body
            .get("rom_time")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
        fluid_color: body
            .get("fluid_color")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        vaginal_bleeding: body
            .get("vaginal_bleeding")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        bleeding_amount: body
            .get("bleeding_amount")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        cervical_exam_performed: body
            .get("cervical_exam_performed")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        dilation_cm: body
            .get("dilation_cm")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        effacement_percent: body
            .get("effacement_percent")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        station: body
            .get("station")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        presentation: body
            .get("presentation")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        fetal_heart_rate: body
            .get("fetal_heart_rate")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        fetal_heart_variability: body
            .get("fetal_heart_variability")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        fetal_decelerations: body
            .get("fetal_decelerations")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        uterine_tenderness: body
            .get("uterine_tenderness")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        fundal_height_cm: body
            .get("fundal_height_cm")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        fetal_movement: body
            .get("fetal_movement")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        emergency_type: body
            .get("emergency_type")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        placenta_previa: body
            .get("placenta_previa")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        placental_abruption: body
            .get("placental_abruption")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        cord_prolapse: body
            .get("cord_prolapse")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        eclampsia: body
            .get("eclampsia")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        preeclampsia_severe: body
            .get("preeclampsia_severe")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        blood_pressure_systolic: body
            .get("blood_pressure_systolic")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        blood_pressure_diastolic: body
            .get("blood_pressure_diastolic")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        proteinuria: body
            .get("proteinuria")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        magnesium_sulfate_given: body
            .get("magnesium_sulfate_given")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        delivery_imminent: body
            .get("delivery_imminent")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        ob_notified: body
            .get("ob_notified")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        ob_physician_id: body
            .get("ob_physician_id")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        nicu_notified: body
            .get("nicu_notified")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        or_notified: body
            .get("or_notified")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        notes: body
            .get("notes")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        created_at: now,
        updated_at: now,
        data: body.clone(),
    };

    match data.repositories.obstetric_emergencies.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id
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

    match data
        .repositories
        .obstetric_emergencies
        .get_by_id(&assessment_id)
        .await
    {
        Ok(entity) => HttpResponse::Ok().json(entity.data),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Obstetric emergency not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}
