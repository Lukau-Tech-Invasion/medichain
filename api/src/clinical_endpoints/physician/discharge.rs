//! `clinical_endpoints::physician::discharge` — Phase 8 discharge handlers
//! (summary, list, approve, instructions).
//!
//! Split out of the former single-file `physician.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `physician/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

/// The stored columns of a discharge summary, under the names the page sends.
///
/// The handler used to read each column by its schema name, and the page used
/// different ones: `primary_diagnosis` never reached `principal_diagnosis`,
/// `discharge_condition` never reached `condition_at_discharge` -- which was
/// then stored as `stable` whatever the clinician chose -- and an admission
/// time nobody entered became the moment of discharge. The downloaded summary
/// is built from these columns, so it reported all three wrongly.
#[derive(Debug, serde::Deserialize)]
struct DischargeColumns {
    patient_id: String,
    #[serde(default)]
    encounter_id: Option<String>,
    #[serde(default)]
    admission_datetime: Option<String>,
    #[serde(default)]
    discharge_datetime: Option<String>,
    #[serde(default, alias = "primary_diagnosis")]
    principal_diagnosis: Option<String>,
    #[serde(default, alias = "discharge_condition")]
    condition_at_discharge: Option<String>,
    #[serde(default)]
    discharge_disposition: Option<String>,
}

const DISCHARGE_CONDITIONS: [&str; 5] = [
    "stable",
    "improved",
    "unchanged",
    "deteriorated",
    "deceased",
];
const DISCHARGE_DISPOSITIONS: [&str; 9] = [
    "home",
    "home_health",
    "snf",
    "rehab",
    "ltac",
    "hospice",
    "ama",
    "transfer",
    "expired",
];

/// What the schema stores, validated: nothing invented, nothing out of range.
struct ValidDischarge {
    columns: DischargeColumns,
    admission: Option<chrono::DateTime<chrono::Utc>>,
    discharge: chrono::DateTime<chrono::Utc>,
    condition: String,
    disposition: String,
}

fn discharge_invalid(message: &str) -> HttpResponse {
    HttpResponse::BadRequest().json(ErrorResponse {
        error: message.to_string(),
        code: "VALIDATION_ERROR".to_string(),
    })
}

fn parse_instant(
    value: &Option<String>,
    field: &str,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, HttpResponse> {
    match value
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        None => Ok(None),
        Some(text) => chrono::DateTime::parse_from_rfc3339(text)
            .map(|instant| Some(instant.with_timezone(&chrono::Utc)))
            .map_err(|_| discharge_invalid(&format!("{field} must be an RFC 3339 date and time"))),
    }
}

/// A condition and a disposition are clinical findings the clinician states;
/// an admission time is optional and absent when unknown. The summary is
/// written at discharge, so an unstated discharge time is the time of writing.
fn validate_discharge(
    body: &serde_json::Value,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<ValidDischarge, HttpResponse> {
    let columns: DischargeColumns = serde_json::from_value(body.clone())
        .map_err(|error| discharge_invalid(&format!("Invalid discharge summary: {error}")))?;
    if columns.patient_id.trim().is_empty() {
        return Err(discharge_invalid("Choose the patient"));
    }
    let condition = columns.condition_at_discharge.clone().unwrap_or_default();
    if !DISCHARGE_CONDITIONS.contains(&condition.as_str()) {
        return Err(discharge_invalid(
            "Choose the patient's condition at discharge",
        ));
    }
    let disposition = columns.discharge_disposition.clone().unwrap_or_default();
    if !DISCHARGE_DISPOSITIONS.contains(&disposition.as_str()) {
        return Err(discharge_invalid(
            "Choose where the patient is discharged to",
        ));
    }
    let admission = parse_instant(&columns.admission_datetime, "admission_datetime")?;
    let discharge =
        parse_instant(&columns.discharge_datetime, "discharge_datetime")?.unwrap_or(now);
    if admission.is_some_and(|admitted| admitted > discharge) {
        return Err(discharge_invalid("Admission cannot be after discharge"));
    }
    Ok(ValidDischarge {
        columns,
        admission,
        discharge,
        condition,
        disposition,
    })
}

/// Create discharge summary
#[post("/api/clinical/discharge-summary")]
pub async fn create_discharge_summary(
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
    let now = chrono::Utc::now();
    let valid = match validate_discharge(&body, now) {
        Ok(valid) => valid,
        Err(response) => return response,
    };
    // Server-generated: a client-supplied id lets one submission overwrite another.
    let summary_id = format!("DCS-{}", uuid::Uuid::new_v4().simple());
    let entity = DischargeSummaryEntity {
        id: summary_id.clone(),
        patient_id: valid.columns.patient_id.clone(),
        encounter_id: valid.columns.encounter_id.clone().unwrap_or_default(),
        // The author is whoever is signed in, never a name in the request.
        attending_physician_id: current_user.id.clone(),
        admission_datetime: valid.admission,
        discharge_datetime: valid.discharge,
        admission_diagnosis: body
            .get("admission_diagnosis")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
        discharge_diagnosis: body
            .get("discharge_diagnosis")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
        principal_diagnosis: valid.columns.principal_diagnosis.clone(),
        secondary_diagnoses: body.get("secondary_diagnoses").cloned(),
        procedures_performed: body.get("procedures_performed").cloned(),
        hospital_course: body
            .get("hospital_course")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        condition_at_discharge: valid.condition,
        discharge_disposition: valid.disposition,
        discharge_destination: body
            .get("discharge_destination")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        discharge_medications: body
            .get("discharge_medications")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
        medication_changes: body
            .get("medication_changes")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        follow_up_appointments: body.get("follow_up_appointments").cloned(),
        follow_up_instructions: body
            .get("follow_up_instructions")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        diet_instructions: body
            .get("diet_instructions")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        activity_restrictions: body
            .get("activity_restrictions")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        wound_care_instructions: body
            .get("wound_care_instructions")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        warning_signs: body
            .get("warning_signs")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        pending_results: body.get("pending_results").cloned(),
        pending_studies: body.get("pending_studies").cloned(),
        primary_care_notified: body
            .get("primary_care_notified")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        specialist_follow_up: body.get("specialist_follow_up").cloned(),
        durable_medical_equipment: body.get("durable_medical_equipment").cloned(),
        home_health_orders: body.get("home_health_orders").cloned(),
        physical_therapy_orders: body.get("physical_therapy_orders").cloned(),
        dictated_by: body
            .get("dictated_by")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        dictated_at: body
            .get("dictated_at")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
        transcribed_by: body
            .get("transcribed_by")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        signed_by: body
            .get("signed_by")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        signed_at: body
            .get("signed_at")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
        addendum: body
            .get("addendum")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        addendum_by: body
            .get("addendum_by")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        addendum_at: body
            .get("addendum_at")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
        created_at: now,
        updated_at: now,
        data: body.clone(),
    };

    match data.repositories.discharge_summaries.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "summary_id": summary_id
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
        .discharge_summaries
        .get_by_id(&summary_id)
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
            error: "Discharge summary not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
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

    // `get_by_patient("all", ...)` was a literal patient id.
    //
    // In memory that happened to behave like a wildcard; on PostgreSQL it is
    // `WHERE patient_id = 'all'`, which matches nothing — so the discharge list
    // was empty for every deployment that used a database, no matter how many
    // summaries had been written. A summary that is stored and cannot be listed
    // is a summary nobody signs.
    let pagination = Pagination::new(0, 100);
    match data
        .repositories
        .discharge_summaries
        .list_all(pagination)
        .await
    {
        Ok(result) => {
            // The stored records, not `e.data`. `data` is the payload the
            // screen composed, and the screen does not know the id -- that is
            // server-assigned. So every row in this list arrived without one,
            // React keyed the list on `undefined` and warned about duplicate
            // keys, and the approve and export actions had no id to act on.
            //
            // The single-record reads on this file already learned this
            // (`get_discharge_summary`, `get_discharge_instructions`); the list
            // was missed. The typed columns are the record.
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "discharges": result.items
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
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

    match data
        .repositories
        .discharge_summaries
        .get_by_id(&summary_id)
        .await
    {
        Ok(mut entity) => {
            // Update the data JSON with signed_by and signature_time
            let mut data_value = entity.data.clone();
            if let Some(obj) = data_value.as_object_mut() {
                obj.insert("signed_by".to_string(), serde_json::json!(current_user.id));
                obj.insert(
                    "signature_time".to_string(),
                    serde_json::json!(chrono::Utc::now().timestamp()),
                );
            }
            entity.data = data_value;
            entity.signed_by = Some(current_user.id.clone());
            entity.signed_at = Some(Utc::now());
            entity.updated_at = Utc::now();
            match data.repositories.discharge_summaries.update(entity).await {
                Ok(_) => HttpResponse::Ok().json(serde_json::json!({
                    "success": true,
                    "message": "Discharge approved",
                    "summary_id": summary_id,
                    "signed_by": current_user.id
                })),
                Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
                    error: e.to_string(),
                    code: "INTERNAL_ERROR".to_string(),
                }),
            }
        }
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            error: "Discharge summary not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// Create discharge instructions
#[post("/api/clinical/discharge-instructions")]
pub async fn create_discharge_instructions(
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
    let now = chrono::Utc::now();
    // Server-generated: a client-supplied id lets one submission overwrite another.
    let instructions_id = format!("DCI-{}", uuid::Uuid::new_v4().simple());
    let entity = DischargeInstructionsEntity {
        id: instructions_id.clone(),
        patient_id: body
            .get("patient_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        discharge_summary_id: body
            .get("discharge_summary_id")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        visit_date: body
            .get("visit_date")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
            .unwrap_or_else(|| now.date_naive()),
        diagnosis_summary: body
            .get("diagnosis_summary")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        medications_list: body
            .get("medications_list")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
        new_medications: body.get("new_medications").cloned(),
        stopped_medications: body.get("stopped_medications").cloned(),
        changed_medications: body.get("changed_medications").cloned(),
        diet_instructions: body
            .get("diet_instructions")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        activity_level: body
            .get("activity_level")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        activity_restrictions: body.get("activity_restrictions").cloned(),
        wound_care: body
            .get("wound_care")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        follow_up_appointments: body
            .get("follow_up_appointments")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
        return_precautions: body
            .get("return_precautions")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        emergency_instructions: body
            .get("emergency_instructions")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        contact_numbers: body
            .get("contact_numbers")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
        patient_education_materials: body.get("patient_education_materials").cloned(),
        language: body
            .get("language")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        reading_level: body
            .get("reading_level")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        special_instructions: body
            .get("special_instructions")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        equipment_needed: body.get("equipment_needed").cloned(),
        home_health_arranged: body
            .get("home_health_arranged")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        transportation_arranged: body
            .get("transportation_arranged")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        pharmacy_notified: body
            .get("pharmacy_notified")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        printed_at: body
            .get("printed_at")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
        emailed_at: body
            .get("emailed_at")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
        patient_portal_posted: body
            .get("patient_portal_posted")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        acknowledged_by_patient: body
            .get("acknowledged_by_patient")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        acknowledged_at: body
            .get("acknowledged_at")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
        witness_signature: body
            .get("witness_signature")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        provided_by: body
            .get("provided_by")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        created_at: now,
        updated_at: now,
        data: body.clone(),
    };

    match data
        .repositories
        .discharge_instructions
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "instructions_id": instructions_id
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
        .discharge_instructions
        .get_by_id(&instructions_id)
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
            error: "Discharge instructions not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}
