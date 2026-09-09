//! `clinical_endpoints::assessment::specialized` — Phase 4 specialized assessment handlers
//! (burn, psych, tox, MCI).
//!
//! Split out of the former single-file `assessment.rs` (itself split from the original
//! 21K-line `clinical_endpoints.rs` monolith, Phase 10.1). Inherits shared
//! imports/helpers via `use super::*`; glob-re-exported by `assessment/mod.rs` so
//! existing `crate::clinical_endpoints::<handler>` paths stay unchanged.

use super::*;

// ============================================================================
// PHASE 4: SPECIALIZED ASSESSMENT ENDPOINTS
// ============================================================================

/// One charted body region on the burn diagram.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct BurnAreaInput {
    /// Lund-Browder region id (`head`, `right_forearm`, ...).
    #[serde(alias = "regionId")]
    pub region_id: String,
    /// How much of **this region** is burned, 0-100.
    ///
    /// Not a share of the whole body. The region's size at the patient's age is
    /// applied here, so the clinician charts "the front half of the left
    /// forearm" and never multiplies anything. It used to be a share of the
    /// whole body, which made the clinician do that multiplication against a
    /// denominator the page had already chosen wrongly for children.
    #[serde(default, alias = "fractionBurned", alias = "percentage")]
    pub percent_of_region: f64,
    /// Burn depth charted for the region.
    #[serde(default)]
    pub depth: Option<String>,
}

/// Inhalation-injury findings.
#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
pub struct InhalationInput {
    #[serde(default)]
    pub suspected: bool,
    #[serde(default, alias = "singedHairs")]
    pub singed_hairs: bool,
    #[serde(default, alias = "sootInAirway")]
    pub soot_in_airway: bool,
    #[serde(default)]
    pub hoarseness: bool,
    #[serde(default)]
    pub stridor: bool,
    #[serde(default, alias = "carbonMonoxide")]
    pub carbon_monoxide: bool,
}

impl InhalationInput {
    /// The signs actually observed, as a readable summary for the record.
    fn symptoms(&self) -> Option<String> {
        let mut found: Vec<&str> = Vec::with_capacity(5);
        if self.singed_hairs {
            found.push("singed nasal hairs");
        }
        if self.soot_in_airway {
            found.push("soot in airway");
        }
        if self.hoarseness {
            found.push("hoarseness");
        }
        if self.stridor {
            found.push("stridor");
        }
        if self.carbon_monoxide {
            found.push("carbon monoxide exposure");
        }
        if found.is_empty() {
            None
        } else {
            Some(found.join(", "))
        }
    }
}

/// Circumferential burn findings.
#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
pub struct CircumferentialInput {
    #[serde(default)]
    pub present: bool,
    #[serde(default)]
    pub locations: Vec<String>,
    #[serde(default, alias = "escharotomyNeeded")]
    pub escharotomy_needed: bool,
}

/// What `BurnPage` submits.
///
/// It carries **inputs only**. Total TBSA, the Parkland volumes, the urine
/// target and the severity band are computed here by
/// `crate::clinical_scoring`, not accepted from the caller.
///
/// The page used to compute all four in the browser and post them as
/// `total_bsa` and `parkland_fluid` — names this handler never read. It read
/// `tbsa_percentage` and `parkland_formula_volume`, found neither, and stored
/// `0.00` and `NULL`. Every burn assessment on file records a 0% burn with no
/// fluid order, and the 201 said it had worked.
#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct CreateBurnRequest {
    pub patient_id: String,
    /// Patient weight in kg. Without it there is no Parkland volume, because
    /// the formula is per-kilogram — so the handler stores none rather than
    /// inventing one from a default weight.
    #[serde(default)]
    pub weight: Option<f64>,
    /// The charted regions.
    #[serde(default, alias = "burn_areas")]
    pub areas: Vec<BurnAreaInput>,
    #[serde(default)]
    pub mechanism: Option<String>,
    #[serde(default, alias = "agent_source")]
    pub burn_agent: Option<String>,
    #[serde(default)]
    pub injury_time: Option<String>,
    #[serde(default)]
    pub inhalation_injury: InhalationInput,
    #[serde(default)]
    pub circumferential: CircumferentialInput,
    #[serde(default)]
    pub airway_status: Option<String>,
    #[serde(default)]
    pub escharotomy_performed: bool,
    #[serde(default)]
    pub associated_injuries: Vec<String>,
    #[serde(default)]
    pub interventions: Vec<String>,
    #[serde(default)]
    pub tetanus_status: Option<String>,
    #[serde(default)]
    pub pain_level: Option<i32>,
    #[serde(default)]
    pub fluid_start_time: Option<String>,
    #[serde(default)]
    pub urine_output: Option<f64>,
    #[serde(default)]
    pub burn_center_notified: bool,
    #[serde(default)]
    pub photos_taken: bool,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub assessment_datetime: Option<String>,
}

/// Parse an HH:MM wall-clock time against today's date, or an RFC3339 instant.
///
/// The burn form's "time of injury" and "fluid start time" are
/// `<input type="time">` values — `"14:30"`, with no date. RFC3339 parsing
/// rejected them outright, which threw away the one clock Parkland is timed
/// from: the formula runs from the moment of the burn, not from arrival.
fn parse_clinical_time(
    raw: &str,
    reference: chrono::DateTime<chrono::Utc>,
) -> Option<chrono::DateTime<chrono::Utc>> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(raw) {
        return Some(dt.with_timezone(&chrono::Utc));
    }
    let time = chrono::NaiveTime::parse_from_str(raw, "%H:%M")
        .or_else(|_| chrono::NaiveTime::parse_from_str(raw, "%H:%M:%S"))
        .ok()?;
    Some(reference.date_naive().and_time(time).and_utc())
}

/// Create burn assessment
#[post("/api/clinical/burn")]
pub async fn create_burn(
    data: web::Data<AppState>,
    req: web::Json<CreateBurnRequest>,
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
    if body.patient_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id is required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }

    let now = chrono::Utc::now();
    // Server-generated: a client-supplied id lets one submission overwrite another.
    let assessment_id = format!("BRN-{}", uuid::Uuid::new_v4().simple());

    // The Lund-Browder column, from the patient's date of birth.
    //
    // There is no safe default. Taking the adult column for an unknown age
    // charts a burned infant's head at 7% when it is 19%, and TBSA is what the
    // fluid order is computed from — so an unchartable patient is refused
    // rather than charted against the wrong denominator.
    let patient = match data.repositories.patients.get_by_id(&body.patient_id).await {
        Ok(entity) => entity,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            })
        }
    };
    let age_years = crate::patient_entity_to_profile(&patient, &data.encryption_keyring)
        .and_then(|profile| crate::clinical_scoring::years_since(&profile.date_of_birth, now));
    let Some(band) = age_years.and_then(crate::clinical_scoring::lund_browder_band) else {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "The patient's date of birth is needed to chart a burn: body                     proportions change with age, and the total drives the fluid order"
                .to_string(),
            code: "AGE_REQUIRED".to_string(),
        });
    };

    // Everything from here to the entity is derived, not accepted.
    let charted: Vec<(String, f64)> = body
        .areas
        .iter()
        .map(|a| (a.region_id.clone(), a.percent_of_region / 100.0))
        .collect();
    let tbsa = crate::clinical_scoring::lund_browder_tbsa(&charted, band);
    let fluid = body
        .weight
        .and_then(|w| crate::clinical_scoring::parkland_fluid(w, tbsa));
    let severity = crate::clinical_scoring::burn_severity(
        tbsa,
        body.inhalation_injury.suspected,
        body.circumferential.present,
    );
    // A major burn meets burn-centre referral criteria by definition, so the
    // flag follows the band rather than a separate checkbox that can disagree.
    let transfer_to_burn_center = severity == "major";

    let entity = BurnAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: body.patient_id.clone(),
        // The assessing clinician is whoever authenticated. A body-supplied
        // `assessed_by` lets one clinician file under another's name.
        assessed_by: current_user.wallet_address.clone(),
        assessment_datetime: body
            .assessment_datetime
            .as_deref()
            .and_then(|s| parse_clinical_time(s, now))
            .unwrap_or(now),
        mechanism_of_injury: body.mechanism.clone().unwrap_or_default(),
        burn_agent: body.burn_agent.clone(),
        time_of_injury: body
            .injury_time
            .as_deref()
            .and_then(|s| parse_clinical_time(s, now)),
        tbsa_percentage: rust_decimal::Decimal::from_f64_retain(tbsa).unwrap_or_default(),
        burn_depth: body
            .areas
            .iter()
            .map(|a| serde_json::json!({ "region_id": a.region_id, "depth": a.depth }))
            .collect::<Vec<_>>()
            .into(),
        affected_areas: serde_json::to_value(&body.areas).unwrap_or_else(|_| serde_json::json!([])),
        inhalation_injury: body.inhalation_injury.suspected,
        inhalation_symptoms: body.inhalation_injury.symptoms(),
        airway_status: body.airway_status.clone(),
        circumferential_burns: body.circumferential.present,
        circumferential_locations: Some(
            serde_json::to_value(&body.circumferential.locations)
                .unwrap_or_else(|_| serde_json::json!([])),
        ),
        escharotomy_needed: body.circumferential.escharotomy_needed,
        escharotomy_performed: body.escharotomy_performed,
        fluid_resuscitation_started: body.fluid_start_time.is_some(),
        parkland_formula_volume: fluid.as_ref().map(|f| f.total_24h_ml),
        urine_output_goal: fluid
            .as_ref()
            .map(|f| f.urine_output_target_ml_hr.round() as i32),
        pain_score: body.pain_level,
        tetanus_status: body.tetanus_status.clone(),
        transfer_to_burn_center,
        burn_center_notified: body.burn_center_notified,
        photos_taken: body.photos_taken,
        notes: body.notes.clone(),
        weight_kg: body.weight.and_then(rust_decimal::Decimal::from_f64_retain),
        severity: Some(severity.to_string()),
        parkland_first_8h_ml: fluid.as_ref().map(|f| f.first_8h_ml),
        parkland_next_16h_ml: fluid.as_ref().map(|f| f.next_16h_ml),
        associated_injuries: serde_json::to_value(&body.associated_injuries)
            .unwrap_or_else(|_| serde_json::json!([])),
        interventions: serde_json::to_value(&body.interventions)
            .unwrap_or_else(|_| serde_json::json!([])),
        fluid_start_time: body
            .fluid_start_time
            .as_deref()
            .and_then(|s| parse_clinical_time(s, now)),
        urine_output_ml_hr: body.urine_output.map(|v| v.round() as i32),
        created_at: now,
        updated_at: now,
        data: serde_json::to_value(&body).unwrap_or_default(),
    };

    match data.repositories.burn_assessments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "assessment_id": assessment_id,
            // The page showed its own arithmetic and never learned whether the
            // server agreed. It agrees by construction now, because there is one
            // calculation — but it still has to be told the answer, because the
            // answer is a fluid order.
            "total_bsa_percent": tbsa,
            // Which column the body was charted against, so the record and the
            // page agree on what "30%" meant.
            "lund_browder_band": band,
            "lund_browder_band_label":
                crate::clinical_scoring::LUND_BROWDER_BAND_LABELS[band],
            "patient_age_years": age_years,
            "severity": severity,
            "parkland_fluid": fluid,
            "transfer_to_burn_center": transfer_to_burn_center,
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => {
            log::error!("burn assessment persistence failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to save the burn assessment".to_string(),
                code: "INTERNAL_ERROR".to_string(),
            })
        }
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

    match data
        .repositories
        .burn_assessments
        .get_by_id(&assessment_id)
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
            success: false,
            error: "Burn assessment not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
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
    let assessment_id = format!("PSY-{}", uuid::Uuid::new_v4().simple());
    let entity = PsychiatricAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: body
            .get("patient_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        assessed_by: body
            .get("assessed_by")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        assessment_datetime: body
            .get("assessment_datetime")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc))
            .unwrap_or(now),
        chief_complaint: body
            .get("chief_complaint")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        presenting_symptoms: body
            .get("presenting_symptoms")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
        psychiatric_history: body
            .get("psychiatric_history")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        previous_hospitalizations: body.get("previous_hospitalizations").cloned(),
        current_medications: body.get("current_medications").cloned(),
        substance_use: body.get("substance_use").cloned(),
        suicidal_ideation: body
            .get("suicidal_ideation")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        suicidal_plan: body
            .get("suicidal_plan")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        suicidal_intent: body
            .get("suicidal_intent")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        suicidal_means_access: body
            .get("suicidal_means_access")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        homicidal_ideation: body
            .get("homicidal_ideation")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        homicidal_target: body
            .get("homicidal_target")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        safety_plan: body
            .get("safety_plan")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        mental_status_exam: body
            .get("mental_status_exam")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
        appearance: body
            .get("appearance")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        behavior: body
            .get("behavior")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        speech: body
            .get("speech")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        mood: body
            .get("mood")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        affect: body
            .get("affect")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        thought_process: body
            .get("thought_process")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        thought_content: body
            .get("thought_content")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        perceptions: body
            .get("perceptions")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        cognition: body
            .get("cognition")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        insight: body
            .get("insight")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        judgment: body
            .get("judgment")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        risk_level: body
            .get("risk_level")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("low")
            .to_string(),
        disposition: body
            .get("disposition")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        involuntary_hold: body
            .get("involuntary_hold")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        hold_type: body
            .get("hold_type")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        sitter_required: body
            .get("sitter_required")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        one_to_one_observation: body
            .get("one_to_one_observation")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        psychiatry_consulted: body
            .get("psychiatry_consulted")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        psychiatrist_id: body
            .get("psychiatrist_id")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        notes: body
            .get("notes")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        created_at: now,
        updated_at: now,
        data: body.clone(),
    };

    match data
        .repositories
        .psychiatric_assessments
        .create(entity)
        .await
    {
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

    match data
        .repositories
        .psychiatric_assessments
        .get_by_id(&assessment_id)
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
            success: false,
            error: "Psychiatric assessment not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List psychiatric assessments for one patient.
#[get("/api/clinical/psych/patient/{patient_id}")]
pub async fn list_psych_for_patient(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => return HttpResponse::Unauthorized().finish(),
    };
    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().finish();
    }
    match data
        .repositories
        .psychiatric_assessments
        .get_by_patient(
            &path.into_inner(),
            crate::repositories::Pagination::new(0, 100),
        )
        .await
    {
        Ok(page) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "count": page.items.len(),
            "assessments": page.items.into_iter().map(|item| item.data).collect::<Vec<_>>(),
        })),
        Err(e) => {
            log::error!("psychiatric assessment list failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create toxicology assessment
#[post("/api/clinical/tox")]
pub async fn create_tox(
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
    let assessment_id = format!("TOX-{}", uuid::Uuid::new_v4().simple());
    let entity = ToxicologyAssessmentEntity {
        id: assessment_id.clone(),
        patient_id: body
            .get("patient_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        assessed_by: body
            .get("assessed_by")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        assessment_datetime: body
            .get("assessment_datetime")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc))
            .unwrap_or(now),
        exposure_type: body
            .get("exposure_type")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("ingestion")
            .to_string(),
        intentionality: body
            .get("intentionality")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("accidental")
            .to_string(),
        substances: body
            .get("substances")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
        time_of_exposure: body
            .get("time_of_exposure")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
        amount_if_known: body
            .get("amount_if_known")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        route_of_exposure: body
            .get("route_of_exposure")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        symptoms: body
            .get("symptoms")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
        vital_signs_on_arrival: body.get("vital_signs_on_arrival").cloned(),
        mental_status: body
            .get("mental_status")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        pupil_size: body
            .get("pupil_size")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        pupil_reactivity: body
            .get("pupil_reactivity")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        skin_findings: body
            .get("skin_findings")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        toxidrome: body
            .get("toxidrome")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        decontamination_performed: body
            .get("decontamination_performed")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        decontamination_type: body
            .get("decontamination_type")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        antidote_given: body
            .get("antidote_given")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        antidote_name: body
            .get("antidote_name")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        antidote_dose: body
            .get("antidote_dose")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        activated_charcoal: body
            .get("activated_charcoal")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        whole_bowel_irrigation: body
            .get("whole_bowel_irrigation")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        enhanced_elimination: body
            .get("enhanced_elimination")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        elimination_method: body
            .get("elimination_method")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        poison_control_called: body
            .get("poison_control_called")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        poison_control_case_number: body
            .get("poison_control_case_number")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        lab_results: body.get("lab_results").cloned(),
        drug_screen_results: body.get("drug_screen_results").cloned(),
        serum_levels: body.get("serum_levels").cloned(),
        disposition: body
            .get("disposition")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        icu_admission: body
            .get("icu_admission")
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

    match data
        .repositories
        .toxicology_assessments
        .create(entity)
        .await
    {
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

    match data
        .repositories
        .toxicology_assessments
        .get_by_id(&assessment_id)
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
            success: false,
            error: "Toxicology assessment not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// The incident header of an MCI submission.
#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct MciIncidentInput {
    #[serde(default, alias = "incidentName")]
    pub incident_name: String,
    #[serde(default, alias = "incidentType")]
    pub incident_type: String,
    #[serde(default)]
    pub location: String,
    #[serde(default, alias = "startTime")]
    pub start_time: Option<String>,
    #[serde(default, alias = "commandPost")]
    pub command_post: Option<String>,
    #[serde(default, alias = "incidentCommander")]
    pub incident_commander: Option<String>,
    #[serde(default, alias = "contactNumber")]
    pub contact_number: Option<String>,
    #[serde(default, alias = "estimatedCasualties")]
    pub estimated_casualties: Option<i32>,
    #[serde(default, alias = "resourcesRequested")]
    pub resources_requested: Vec<String>,
    #[serde(default, alias = "activationLevel")]
    pub activation_level: Option<String>,
}

/// The START observations recorded for one casualty at the collection point.
#[derive(Debug, Default, Clone, serde::Deserialize, serde::Serialize)]
pub struct MciCasualtyVitals {
    /// Walked to the collection point unaided. START's **first** question.
    #[serde(default)]
    pub ambulatory: bool,
    /// Breaths per minute. Zero after an airway-opening attempt is expectant.
    #[serde(default, alias = "respiratoryRate")]
    pub respiratory_rate: Option<i32>,
    /// Radial pulse rate; 0 means no palpable radial pulse.
    #[serde(default)]
    pub pulse: Option<i32>,
    #[serde(default, alias = "capRefill")]
    pub cap_refill: Option<i32>,
    /// `alert`, `confused`, `unresponsive`.
    #[serde(default, alias = "mentalStatus")]
    pub mental_status: Option<String>,
}

/// One casualty on the incident's tracking board.
#[derive(Debug, Default, Clone, serde::Deserialize, serde::Serialize)]
pub struct MciCasualtyInput {
    #[serde(default, alias = "tagNumber")]
    pub tag_number: String,
    #[serde(default)]
    pub patient_id: Option<String>,
    #[serde(default)]
    pub age: Option<String>,
    #[serde(default)]
    pub gender: Option<String>,
    #[serde(default, alias = "chiefComplaint")]
    pub chief_complaint: Option<String>,
    #[serde(default)]
    pub injuries: Vec<String>,
    #[serde(default)]
    pub vitals: MciCasualtyVitals,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub destination: Option<String>,
    #[serde(default, alias = "triageTime")]
    pub triage_time: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    /// A responder's manual override of the computed category.
    ///
    /// START is a screen, not a diagnosis, and a responder standing over the
    /// casualty may see something the four observations do not capture. The
    /// override is honoured and both values are stored, so the board shows the
    /// decision that was made and the algorithm it departed from.
    #[serde(default, alias = "category")]
    pub triage_category_override: Option<String>,
}

/// What `MCIPage` submits: one incident and its casualty board.
///
/// The handler used to read flat top-level keys — `incident_name`,
/// `triage_category`, `triage_tag_number` — off a body that carries neither.
/// The page posts `{ mci_id, incident: {...}, patients: [...] }`, so every
/// field missed, and the row that got written was a nameless incident of type
/// `natural_disaster` with one `red` casualty who did not exist. The casualty
/// board — the entire point of an MCI record — was dropped, and the 201 said
/// otherwise.
#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct CreateMciRequest {
    #[serde(default)]
    pub incident: MciIncidentInput,
    #[serde(default, alias = "patients")]
    pub casualties: Vec<MciCasualtyInput>,
}

/// Maximum casualties accepted in one submission.
///
/// Bounded because the handler writes one row per casualty and an unbounded
/// list is an unbounded loop against the database. Larger incidents submit in
/// batches; 512 is well past any single hospital's surge capacity.
const MCI_MAX_CASUALTIES: usize = 512;

/// The START category for one casualty, from the observations recorded.
///
/// `mental_status` maps to START's "follows simple commands": `alert` does,
/// anything else does not. A casualty with no recorded respiratory rate and no
/// recorded mental status reaches `immediate` rather than `delayed`, which is
/// the safe direction — over-triage in a mass-casualty incident costs a
/// transport slot, under-triage costs the patient.
fn casualty_start_category(v: &MciCasualtyVitals) -> &'static str {
    let vitals = crate::clinical_scoring::StartVitals {
        ambulatory: v.ambulatory,
        // A recorded rate of 0 is "not breathing"; an unrecorded rate is not.
        breathing: v.respiratory_rate.map(|r| r > 0).unwrap_or(true),
        respiratory_rate: v.respiratory_rate,
        capillary_refill_secs: v.cap_refill,
        radial_pulse_present: v.pulse.map(|p| p > 0),
        follows_commands: v
            .mental_status
            .as_deref()
            .map(|s| s.eq_ignore_ascii_case("alert"))
            .unwrap_or(false),
    };
    crate::clinical_scoring::start_triage(&vitals)
}

/// START's categories, in the colours a triage tag uses.
///
/// `mci_records.triage_category` is a CHECK-constrained colour — red, yellow,
/// green, black, white — because a triage tag is a colour. The START category
/// name goes in `start_triage_category` beside it, so the record holds both the
/// tag that was hung on the casualty and the algorithm result behind it.
///
/// `expectant` and `deceased` both map to black: START distinguishes them, a
/// triage tag does not.
fn start_category_colour(category: &str) -> &'static str {
    match category {
        "minor" | "green" => "green",
        "delayed" | "yellow" => "yellow",
        "immediate" | "red" => "red",
        _ => "black",
    }
}

/// Map the incident-type list the form offers onto the vocabulary the column
/// accepts.
///
/// `mci_records.incident_type` is CHECK-constrained to eight values and the
/// form offers twelve human-readable ones ("Motor Vehicle Accident", "Crowd
/// Crush"). Unmapped input became a rejected write rather than a stored
/// incident; the incident's own name is kept verbatim in `incident_name`, so
/// nothing is lost by classifying it.
fn normalise_mci_incident_type(raw: &str) -> &'static str {
    match raw
        .trim()
        .to_ascii_lowercase()
        .replace(['-', '&'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("_")
        .as_str()
    {
        "motor_vehicle_accident" | "train_derailment" | "plane_crash" | "transportation" => {
            "transportation"
        }
        "mass_shooting" | "active_shooter" => "active_shooter",
        "terrorist_attack" | "terrorism" => "terrorism",
        "explosion" | "building_collapse" | "fire" | "industrial" => "industrial",
        "chemical_spill" | "hazmat" => "hazmat",
        "natural_disaster" => "natural_disaster",
        "pandemic" => "pandemic",
        _ => "other",
    }
}

/// The incident fields every row of an MCI submission repeats.
///
/// `mci_records` is one row per casualty, so an incident with four casualties
/// writes the same eight incident fields four times. Carrying them once here
/// keeps the two row builders below from drifting apart — the activation-only
/// row is the same entity with the casualty half left blank, and written out
/// twice that is thirty lines of duplication waiting to disagree.
struct MciIncidentHeader<'a> {
    incident_id: &'a str,
    incident_name: &'a str,
    incident_datetime: chrono::DateTime<chrono::Utc>,
    location: &'a str,
    incident_type: &'a str,
    activation_level: &'a str,
    commander: Option<&'a str>,
    created_by: &'a str,
    now: chrono::DateTime<chrono::Utc>,
}

impl MciIncidentHeader<'_> {
    /// The incident half of a row, with the casualty half left to the caller.
    fn base(&self, index: usize) -> MciRecordEntity {
        MciRecordEntity {
            id: format!("{}-{index:04}", self.incident_id),
            incident_id: self.incident_id.to_string(),
            incident_name: self.incident_name.to_string(),
            incident_datetime: self.incident_datetime,
            incident_location: self.location.to_string(),
            incident_type: self.incident_type.to_string(),
            activation_level: self.activation_level.to_string(),
            incident_commander: self.commander.map(str::to_string),
            medical_branch_director: None,
            hospital_incident_command_activated: true,
            patient_id: None,
            triage_tag_number: None,
            // The tag colour, which is what this column means and what its
            // CHECK constraint accepts. White is "not triaged".
            triage_category: "white".to_string(),
            start_triage_category: None,
            arrival_datetime: None,
            arrival_mode: None,
            ems_agency: None,
            treatment_area: None,
            injuries: None,
            mechanism_of_injury: None,
            decontamination_required: false,
            decontamination_completed: false,
            treatments_provided: None,
            disposition: None,
            disposition_datetime: None,
            destination: None,
            family_notified: false,
            family_reunification_completed: false,
            patient_tracking_updated: false,
            media_release_authorized: false,
            special_circumstances: None,
            created_by: self.created_by.to_string(),
            created_at: self.now,
            updated_at: self.now,
            data: serde_json::Value::Null,
        }
    }

    /// One tagged casualty.
    fn casualty_row(
        &self,
        index: usize,
        casualty: &MciCasualtyInput,
        computed: &str,
        applied: &str,
    ) -> MciRecordEntity {
        // The stored blob is the submission plus what the server derived, so a
        // reader sees the tag that was hung on the casualty and the algorithm
        // result behind it rather than a category with no working shown.
        let mut record = serde_json::to_value(casualty).unwrap_or_default();
        if let Some(obj) = record.as_object_mut() {
            obj.insert(
                "start_triage_computed".to_string(),
                serde_json::json!(computed),
            );
            obj.insert("triage_category".to_string(), serde_json::json!(applied));
            obj.insert(
                "incident_id".to_string(),
                serde_json::json!(self.incident_id),
            );
        }

        MciRecordEntity {
            patient_id: casualty.patient_id.clone(),
            triage_tag_number: Some(casualty.tag_number.clone()),
            triage_category: start_category_colour(applied).to_string(),
            start_triage_category: Some(computed.to_string()),
            arrival_datetime: casualty
                .triage_time
                .as_deref()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|d| d.with_timezone(&chrono::Utc)),
            treatment_area: casualty.location.clone(),
            injuries: Some(
                serde_json::to_value(&casualty.injuries).unwrap_or_else(|_| serde_json::json!([])),
            ),
            mechanism_of_injury: casualty.chief_complaint.clone(),
            destination: casualty.destination.clone(),
            patient_tracking_updated: true,
            special_circumstances: casualty.notes.clone(),
            data: record,
            ..self.base(index)
        }
    }

    /// The activation itself, when no casualty has been tagged yet.
    fn activation_only_row(&self, incident: &MciIncidentInput) -> MciRecordEntity {
        MciRecordEntity {
            data: serde_json::to_value(incident).unwrap_or_default(),
            ..self.base(0)
        }
    }
}

/// Create MCI record
#[post("/api/clinical/mci")]
pub async fn create_mci(
    data: web::Data<AppState>,
    req: web::Json<CreateMciRequest>,
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
    if body.casualties.len() > MCI_MAX_CASUALTIES {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: format!("at most {MCI_MAX_CASUALTIES} casualties per submission"),
            code: "TOO_MANY_CASUALTIES".to_string(),
        });
    }

    let now = chrono::Utc::now();
    // Server-generated: a client-supplied id lets one submission overwrite another.
    let incident_id = format!("MCI-{}", uuid::Uuid::new_v4().simple());
    let incident_datetime = body
        .incident
        .start_time
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&chrono::Utc))
        .unwrap_or(now);

    let incident_type = normalise_mci_incident_type(&body.incident.incident_type).to_string();
    let activation_level = body
        .incident
        .activation_level
        .clone()
        .unwrap_or_else(|| "level_1".to_string());

    // One row per casualty. An incident with no casualties recorded yet still
    // gets a row, so the activation itself is on file from the moment it is
    // declared rather than only once someone is tagged.
    let header = MciIncidentHeader {
        incident_id: &incident_id,
        incident_name: &body.incident.incident_name,
        incident_datetime,
        location: &body.incident.location,
        incident_type: &incident_type,
        activation_level: &activation_level,
        commander: body.incident.incident_commander.as_deref(),
        created_by: &current_user.wallet_address,
        now,
    };

    let mut rows: Vec<MciRecordEntity> = Vec::with_capacity(body.casualties.len().max(1));
    let mut category_counts = std::collections::BTreeMap::<String, i32>::new();
    let mut triaged: Vec<serde_json::Value> = Vec::with_capacity(body.casualties.len());

    for (index, casualty) in body.casualties.iter().enumerate().take(MCI_MAX_CASUALTIES) {
        let computed = casualty_start_category(&casualty.vitals);
        let applied = casualty
            .triage_category_override
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(computed);
        *category_counts.entry(applied.to_string()).or_insert(0) += 1;

        triaged.push(serde_json::json!({
            "tag_number": casualty.tag_number,
            "start_triage_computed": computed,
            "triage_category": applied,
            "colour": start_category_colour(applied),
        }));
        rows.push(header.casualty_row(index, casualty, computed, applied));
    }

    if rows.is_empty() {
        rows.push(header.activation_only_row(&body.incident));
    }

    let expected = rows.len();
    let mut stored = 0_usize;
    for row in rows {
        match data.repositories.mci_records.create(row).await {
            Ok(_) => stored += 1,
            Err(e) => {
                // A partially written casualty board is worse than a failed
                // submission only if the caller is told it succeeded. It is
                // told exactly how many rows landed.
                log::error!("MCI record persistence failed after {stored} rows: {e}");
                return HttpResponse::InternalServerError().json(serde_json::json!({
                    "success": false,
                    "error": "Failed to save the incident record",
                    "code": "INTERNAL_ERROR",
                    "incident_id": incident_id,
                    "casualties_expected": expected,
                    "casualties_stored": stored,
                }));
            }
        }
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "incident_id": incident_id,
        "casualties_stored": stored,
        // The board as the server triaged it. The page showed its own START
        // result and never learned whether the server agreed — and its copy
        // never asked START's first question, "can they walk", so every
        // walking-wounded casualty was triaged as if they could not.
        "triage": triaged,
        "category_counts": category_counts,
    }))
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
        Ok(entity) => {
            // The stored record, not `entity.data`. `data` is `#[sqlx(skip)]`
            // on every one of these entities, so on PostgreSQL it is always
            // `Value::Null` — this endpoint returned a literal `null` with a
            // 200 for every record ever saved. The typed columns are the record.
            HttpResponse::Ok().json(entity)
        }
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "MCI record not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}
