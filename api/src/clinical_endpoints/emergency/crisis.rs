use super::*;

// ============================================================================
// ACUTE CRISIS EVENTS
// ============================================================================

/// What `CodeBluePage` submits.
///
/// The handler used to take `clinical::CodeBlueRecord` straight off the wire:
/// a full resuscitation record whose `team_members` is `Vec<CodeTeamMember>`
/// and whose `initial_rhythm`, `code_leader`, `witnessed` and `documented_at`
/// are all required. The page sends team members as a comma-separated list of
/// names and collects none of the rest, so every submission was rejected with
/// `invalid type: string "...", expected struct CodeTeamMember`.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateCodeBlueRequest {
    /// Assigned by the server on create; a value sent is ignored.
    #[serde(default)]
    pub event_id: String,
    pub patient_id: String,
    #[serde(default)]
    pub code_called_at: i64,
    #[serde(default)]
    pub code_called_by: String,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub primary_cause: Option<String>,
    #[serde(default)]
    pub outcome: String,
    #[serde(default)]
    pub narrative: Option<String>,
    /// Names, as typed. Structured `CodeTeamMember` records are what a roster
    /// integration would supply; this form asks for a line of names.
    #[serde(default)]
    pub team_members: Vec<String>,
    #[serde(default)]
    pub medications_administered: Vec<String>,
    #[serde(default)]
    pub shocks_delivered: u32,
    #[serde(default)]
    pub cpr_cycles: u32,
    /// Not on the form today; accepted so a monitor integration can supply them
    /// without another contract change.
    #[serde(default)]
    pub initial_rhythm: Option<String>,
    #[serde(default)]
    pub witnessed: Option<bool>,
    #[serde(default)]
    pub code_leader: Option<String>,
    #[serde(default)]
    pub team_arrived_at: Option<i64>,
}

/// Create code blue record
#[post("/api/emergency/code-blue")]
pub async fn create_code_blue(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateCodeBlueRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let mut record = req.into_inner();
    // Who called the code, and so who documents it, is the authenticated
    // caller -- not a field the page fills in (it sent `'unknown'` when it
    // had no user, and that was stored as the documenting clinician).
    record.code_called_by = current_user_id.clone();
    // Server-generated. The page sent `PREFIX-${Date.now()}`; on PostgreSQL a
    // collision was refused, in the in-memory backend it silently replaced the
    // other record. The id is the server's to assign either way.
    record.event_id = format!("CB-{}", uuid::Uuid::new_v4().simple());
    let id = record.event_id.clone();
    let owner_id = record.patient_id.clone();

    if let Err(response) = crate::support::require_durable_audit(
        &data,
        access_log_entity(
            current_user_id,
            "medical_team",
            "create_code_blue",
            Some(owner_id),
        ),
    )
    .await
    {
        return response;
    }

    let entity = code_blue_entity(&record, json_value(&record));
    match data.repositories.code_blue.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Get code blue record
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all
/// before returning the full record by bare `{id}`. Now matches
/// `create_code_blue`'s authenticated-caller bar.
#[get("/api/emergency/code-blue/{id}")]
pub async fn get_code_blue(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.code_blue.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List code blue records for a patient
///
/// HZ-009 audit: same unauthenticated-read gap as `get_code_blue` above.
#[get("/api/emergency/code-blue/patient/{patient_id}")]
pub async fn list_patient_code_blues(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // HZ-019 IDOR follow-up: previously authenticated-only, so an unrelated
    // patient could read this patient's code-blue records. A cross-patient sweep
    // masked it (the victim had no records); code inspection confirmed the gap.
    // Apply provider-or-self, matching the clinical endpoints.
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };
    match get_user(&data, &current_user_id) {
        Some(u)
            if u.role.is_healthcare_provider()
                || crate::support::caller_owns_patient_record(
                    &data,
                    &current_user_id,
                    &patient_id,
                ) => {}
        Some(_) => {
            return HttpResponse::Forbidden().json(ErrorResponse {
                success: false,
                error: "Access denied".to_string(),
                code: "ACCESS_DENIED".to_string(),
            })
        }
        None => return HttpResponse::Unauthorized().finish(),
    }

    let pagination = Pagination::new(0, 50);
    match data
        .repositories
        .code_blue
        .get_by_patient(&patient_id, pagination)
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// The five TIMI criteria that are clinical judgements rather than data the
/// server already holds.
///
/// Age and the cardiac marker are deliberately absent: the server derives the
/// first from the patient's date of birth and the second from the troponin
/// value in this same submission. Asking a clinician to retype either invites
/// the two to disagree with the record.
#[derive(Debug, Clone, Copy, Default, serde::Deserialize, serde::Serialize)]
pub struct TimiCriteriaInput {
    /// Three or more of: hypertension, hypercholesterolaemia, diabetes,
    /// current smoker, family history of premature CAD.
    #[serde(default)]
    pub three_or_more_cad_risk_factors: bool,
    /// Known coronary stenosis >= 50%.
    #[serde(default)]
    pub known_cad: bool,
    /// Aspirin taken in the seven days before presentation.
    #[serde(default)]
    pub aspirin_in_past_7_days: bool,
    /// Two or more anginal episodes in the preceding 24 hours.
    #[serde(default)]
    pub severe_angina: bool,
    /// ST deviation >= 0.5 mm on the presenting ECG.
    #[serde(default)]
    pub st_deviation: bool,
}

/// What `CardiacPage` submits.
///
/// The page used to post a typed `CardiacEvent`, which required `door_time`,
/// `ecg_findings`, `biomarkers`, `cath_lab_activated` and `pci_performed` —
/// five fields the form has no control for — and an `event_type` spelled
/// `STEMI` where the form's `<select>` emits `stemi`. Every save was rejected
/// with `400 Json deserialize error: unknown variant "stemi"`, so the cardiac
/// documentation screen had never successfully filed a record.
///
/// `timi_score` is **not** accepted. The page computed it in the browser and
/// got two of the seven criteria wrong: it counted "3+ CAD risk factors" from
/// a list containing either diabetes *or* hypertension — one factor, not
/// three — and read "severe angina (2+ episodes in 24h)" off a chest-pain
/// *character* dropdown, which describes quality, not frequency. Both errors
/// score the criterion when it is not met, and TIMI decides who goes for early
/// invasive management.
#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct CreateCardiacRequest {
    pub patient_id: String,
    /// Free-form on purpose: the form's `<select>` values are lowercase and the
    /// stored vocabulary is not settled. Normalised below.
    #[serde(default)]
    pub event_type: String,
    #[serde(default)]
    pub chief_complaint: Option<String>,
    #[serde(default)]
    pub symptom_onset: Option<String>,
    #[serde(default)]
    pub chest_pain_character: Option<String>,
    #[serde(default)]
    pub pain_radiation: Vec<String>,
    #[serde(default)]
    pub associated_symptoms: Vec<String>,
    #[serde(default)]
    pub vital_signs: serde_json::Value,
    /// Carries `troponin` and `bnp`. The troponin decides the TIMI marker
    /// criterion against the published assay threshold.
    #[serde(default)]
    pub lab_values: serde_json::Value,
    #[serde(default)]
    pub killip_class: Option<i32>,
    #[serde(default)]
    pub timi_criteria: TimiCriteriaInput,
    #[serde(default)]
    pub ecg_readings: Vec<serde_json::Value>,
    #[serde(default)]
    pub treatments: Vec<String>,
    #[serde(default)]
    pub disposition: Option<String>,
    #[serde(default)]
    pub narrative: Option<String>,
    #[serde(default)]
    pub timeline: Vec<serde_json::Value>,
    #[serde(default)]
    pub cath_lab_activated: bool,
    #[serde(default)]
    pub pci_performed: bool,
    #[serde(default)]
    pub door_to_balloon_minutes: Option<u32>,
}

/// Map the form's `<select>` values onto the stored vocabulary.
///
/// `cardiac_events.event_type` has a CHECK constraint listing the capitalised
/// spellings, so an unmapped value is a write that fails at the database rather
/// than at the boundary. Anything unrecognised becomes `Other`, which is
/// truthful — the record still says what happened in `chief_complaint` and the
/// narrative — rather than a rejection of an otherwise complete assessment.
fn normalise_cardiac_event_type(raw: &str) -> &'static str {
    match raw
        .trim()
        .to_ascii_lowercase()
        .replace(['-', ' '], "_")
        .as_str()
    {
        "stemi" => "STEMI",
        "nstemi" => "NSTEMI",
        "unstable_angina" | "unstableangina" => "UnstableAngina",
        "stable_angina" | "stableangina" => "StableAngina",
        "arrhythmia" | "dysrhythmia" => "Arrhythmia",
        "heart_failure" | "heartfailure" | "chf" => "HeartFailure",
        _ => "Other",
    }
}

/// Create cardiac event record
#[post("/api/emergency/cardiac")]
pub async fn create_cardiac(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateCardiacRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let body = req.into_inner();
    if body.patient_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id is required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }

    // Server-generated: a client-supplied id lets one submission overwrite another.
    let id = format!("CAR-{}", uuid::Uuid::new_v4().simple());
    let now = Utc::now();

    // Age >= 65 comes from the patient record, not from the request. The page
    // computed it as `thisYear - birthYear`, which is a year out for anyone who
    // has not had their birthday yet — and 64-turning-65 is exactly the
    // boundary the criterion is about.
    let age_65_or_over = match data.repositories.patients.get_by_id(&body.patient_id).await {
        Ok(patient) => crate::patient_entity_to_profile(&patient, &data.encryption_keyring)
            .and_then(|p| crate::clinical_scoring::years_since(&p.date_of_birth, now))
            .map(|years| years >= 65)
            .unwrap_or(false),
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            })
        }
    };

    let troponin = body
        .lab_values
        .get("troponin")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    let criteria = crate::clinical_scoring::TimiCriteria {
        age_65_or_over,
        three_or_more_cad_risk_factors: body.timi_criteria.three_or_more_cad_risk_factors,
        known_cad: body.timi_criteria.known_cad,
        aspirin_in_past_7_days: body.timi_criteria.aspirin_in_past_7_days,
        severe_angina: body.timi_criteria.severe_angina,
        st_deviation: body.timi_criteria.st_deviation,
        elevated_marker: troponin > crate::clinical_scoring::TIMI_TROPONIN_THRESHOLD_NG_ML,
    };
    let timi_score = crate::clinical_scoring::timi_score(&criteria);
    let timi_band = crate::clinical_scoring::timi_band(timi_score);
    let event_type = normalise_cardiac_event_type(&body.event_type);

    if let Err(response) = crate::support::require_durable_audit(
        &data,
        access_log_entity(
            current_user_id.clone(),
            "medical_team",
            "create_cardiac_event",
            Some(body.patient_id.clone()),
        ),
    )
    .await
    {
        return response;
    }

    // The stored blob is the submission plus what the server derived from it,
    // so a reader sees the score and the criteria it came from rather than a
    // number with no working shown.
    let mut record = serde_json::to_value(&body).unwrap_or_default();
    if let Some(obj) = record.as_object_mut() {
        obj.insert("event_id".to_string(), serde_json::json!(id));
        obj.insert("event_type".to_string(), serde_json::json!(event_type));
        obj.insert("timi_score".to_string(), serde_json::json!(timi_score));
        obj.insert("timi_band".to_string(), serde_json::json!(timi_band));
        obj.insert(
            "timi_criteria_scored".to_string(),
            serde_json::to_value(criteria).unwrap_or_default(),
        );
        obj.insert(
            "documented_by".to_string(),
            serde_json::json!(current_user_id),
        );
    }

    let entity = CardiacEventEntity {
        id: id.clone(),
        patient_id: body.patient_id.clone(),
        event_type: event_type.to_string(),
        cath_lab_activated: body.cath_lab_activated,
        pci_performed: body.pci_performed,
        door_to_balloon_minutes: body.door_to_balloon_minutes,
        documented_by: current_user_id,
        documented_at: now.timestamp(),
        data: record,
        created_at: now,
        updated_at: now,
    };

    match data.repositories.cardiac_events_repo.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "id": id,
            "success": true,
            "timi_score": timi_score,
            "timi_band": timi_band,
            "event_type": event_type,
        })),
        Err(e) => {
            log::error!("cardiac event persistence failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to save the cardiac event".to_string(),
                code: "REPO_ERROR".to_string(),
            })
        }
    }
}

/// Get cardiac event record
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all
/// before returning the full record by bare `{id}`. Now matches
/// `create_cardiac`'s authenticated-caller bar.
#[get("/api/emergency/cardiac/{id}")]
pub async fn get_cardiac(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.cardiac_events_repo.get_by_id(&id).await {
        Ok(record) => HttpResponse::Ok().json(record),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

/// List a patient's cardiac events (provider or the patient themselves).
///
/// Connects the Emergency Protocols page's cardiac tab; the repository already
/// supported `get_by_patient`.
#[get("/api/emergency/cardiac/patient/{patient_id}")]
pub async fn list_patient_cardiac(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = require_emergency_list_access(&data, &http_req, &patient_id) {
        return resp;
    }
    match data
        .repositories
        .cardiac_events_repo
        .get_by_patient(&patient_id, Pagination::new(0, 50))
        .await
    {
        Ok(result) => HttpResponse::Ok().json(result.items),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}
