use super::*;

// ============================================================================
// PERI-OPERATIVE CARE
// ============================================================================

/// Airway findings from the pre-operative assessment.
#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
pub struct PreOpAirwayInput {
    /// Roman numeral I-IV as the form emits it.
    #[serde(default)]
    pub mallampati: Option<String>,
    #[serde(rename = "mouthOpening", default)]
    pub mouth_opening: Option<String>,
    #[serde(default)]
    pub thyromental: Option<String>,
    #[serde(rename = "neckMobility", default)]
    pub neck_mobility: Option<String>,
    #[serde(default)]
    pub dentition: Option<String>,
    #[serde(rename = "beardPresent", default)]
    pub beard_present: bool,
    #[serde(rename = "obeseNeck", default)]
    pub obese_neck: bool,
    #[serde(rename = "difficultyPredicted", default)]
    pub difficulty_predicted: bool,
}

/// Fasting status.
#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
pub struct PreOpNpoInput {
    #[serde(rename = "lastSolid", default)]
    pub last_solid: Option<String>,
    #[serde(rename = "lastClear", default)]
    pub last_clear: Option<String>,
    #[serde(default)]
    pub compliant: bool,
}

/// The three consents the theatre list checks for.
#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
pub struct PreOpConsentsInput {
    #[serde(rename = "surgicalConsent", default)]
    pub surgical: bool,
    #[serde(rename = "anesthesiaConsent", default)]
    pub anesthesia: bool,
    #[serde(rename = "bloodConsent", default)]
    pub blood: bool,
}

/// What `PreOpPage` submits.
///
/// It used to be typed as `clinical::PreOperativeAssessment`, whose `asa_class`
/// is an enum spelled `ASA1`..`ASA6` while the form's `<select>` emits Roman
/// numerals — so every submission was rejected with
/// `400 Json deserialize error: unknown variant "II"`, and the pre-operative
/// assessment screen had never filed a record. The same mismatch applied to
/// Mallampati, which the form sends as `"II"` against an `i32` column.
#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct CreatePreOpRequest {
    pub patient_id: String,
    #[serde(default)]
    pub scheduled_surgery: String,
    #[serde(default)]
    pub surgeon: Option<String>,
    #[serde(default)]
    pub scheduled_date: Option<String>,
    #[serde(default)]
    pub scheduled_time: Option<String>,
    /// Roman numeral I-VI as the form emits it.
    #[serde(default)]
    pub asa_class: Option<String>,
    #[serde(default)]
    pub asa_emergency: bool,
    #[serde(default)]
    pub anesthesia_type: Option<String>,
    #[serde(default)]
    pub airway_assessment: PreOpAirwayInput,
    #[serde(default)]
    pub npo_status: PreOpNpoInput,
    #[serde(default)]
    pub consents: PreOpConsentsInput,
    #[serde(default)]
    pub labs_reviewed: Vec<String>,
    #[serde(default)]
    pub allergies: Vec<String>,
    #[serde(default)]
    pub current_medications: Vec<String>,
    #[serde(default)]
    pub hold_medications: Vec<String>,
    #[serde(default)]
    pub medical_history: Vec<String>,
    #[serde(default)]
    pub preop_checklist: std::collections::BTreeMap<String, bool>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// Normalise an ASA class onto the vocabulary the column actually accepts.
///
/// `pre_op_assessments.asa_classification` has a CHECK constraint listing
/// `I`..`VI` plus `I-E`..`V-E`, and the form's `<select>` already emits Roman
/// numerals — so the schema and the form agreed all along and only the typed
/// `clinical::PreOperativeAssessment` (whose enum spells them `ASA1`..`ASA6`)
/// did not. `ASA1`-style input is accepted here so a caller written against
/// that enum is normalised rather than rejected.
///
/// `-E` marks an emergency case, which is how ASA itself denotes it: an ASA III
/// patient having an emergency laparotomy is ASA III-E, and the distinction is
/// a real one about peri-operative risk. There is no `VI-E` — ASA VI is a
/// declared brain-dead organ donor, for whom "emergency" means nothing — and
/// the CHECK constraint agrees, so VI never takes the suffix.
fn normalise_asa_class(roman: Option<&str>, emergency: bool) -> Option<String> {
    let n = match roman?.trim().to_ascii_uppercase().as_str() {
        "I" | "1" | "ASA1" => "I",
        "II" | "2" | "ASA2" => "II",
        "III" | "3" | "ASA3" => "III",
        "IV" | "4" | "ASA4" => "IV",
        "V" | "5" | "ASA5" => "V",
        "VI" | "6" | "ASA6" => "VI",
        _ => return None,
    };
    Some(if emergency && n != "VI" {
        format!("{n}-E")
    } else {
        n.to_string()
    })
}

/// Roman numeral Mallampati class to the integer the column holds.
fn mallampati_to_int(roman: Option<&str>) -> Option<i32> {
    match roman?.trim().to_ascii_uppercase().as_str() {
        "I" | "1" => Some(1),
        "II" | "2" => Some(2),
        "III" | "3" => Some(3),
        "IV" | "4" => Some(4),
        _ => None,
    }
}

/// Parse a `YYYY-MM-DD` date, optionally with an `HH:MM` time beside it.
fn parse_scheduled(
    date: Option<&str>,
    time: Option<&str>,
) -> Option<chrono::DateTime<chrono::Utc>> {
    let d = chrono::NaiveDate::parse_from_str(date?.trim(), "%Y-%m-%d").ok()?;
    let t = time
        .and_then(|s| chrono::NaiveTime::parse_from_str(s.trim(), "%H:%M").ok())
        .unwrap_or_default();
    Some(d.and_time(t).and_utc())
}

/// Create pre-operative assessment
#[post("/api/surgical/pre-op")]
pub async fn create_pre_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreatePreOpRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let body = req.into_inner();
    if body.patient_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "patient_id is required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }

    let owner_id = body.patient_id.clone();
    let now = chrono::Utc::now();

    if let Err(response) = crate::support::require_durable_audit(
        &data,
        crate::AccessLogEntry {
            access_id: uuid::Uuid::new_v4().to_string(),
            patient_id: owner_id.clone(),
            accessor_id: current_user_id.clone(),
            accessor_role: "doctor".to_string(),
            access_type: "create_pre_op".to_string(),
            location: None,
            timestamp: now,
            emergency: false,
        }
        .into(),
    )
    .await
    {
        return response;
    }

    let checklist_complete =
        !body.preop_checklist.is_empty() && body.preop_checklist.values().all(|done| *done);
    // Clearance is not a checkbox on this form, and inventing one would be a
    // clinical assertion nobody made. It follows the two things the form does
    // record: every checklist item done, and the surgical consent signed.
    let cleared_for_surgery = checklist_complete && body.consents.surgical;

    let entity = crate::repositories::traits::PreOpAssessmentEntity {
        // Server-generated: a client-supplied id lets one submission overwrite
        // another.
        id: format!("PREOP-{}", uuid::Uuid::new_v4().simple()),
        patient_id: owner_id.clone(),
        procedure_name: body.scheduled_surgery.clone(),
        procedure_code: None,
        scheduled_date: parse_scheduled(
            body.scheduled_date.as_deref(),
            body.scheduled_time.as_deref(),
        ),
        surgeon_id: body.surgeon.clone().unwrap_or_default(),
        anesthesiologist_id: None,
        asa_classification: normalise_asa_class(body.asa_class.as_deref(), body.asa_emergency),
        mallampati_score: mallampati_to_int(body.airway_assessment.mallampati.as_deref()),
        airway_assessment: serde_json::to_value(&body.airway_assessment).ok(),
        cardiac_assessment: None,
        pulmonary_assessment: None,
        renal_assessment: None,
        hepatic_assessment: None,
        medications_reviewed: Some(serde_json::json!({
            "current": body.current_medications,
            "hold": body.hold_medications,
        })),
        // An empty allergy list is "none known", which is a finding. It is only
        // "confirmed" once the band is on, which the checklist records.
        allergies_confirmed: body
            .preop_checklist
            .get("allergiesBandOn")
            .copied()
            .unwrap_or(false),
        npo_status: serde_json::to_value(&body.npo_status)
            .ok()
            .map(|v| v.to_string()),
        labs_reviewed: serde_json::to_value(&body.labs_reviewed).ok(),
        ekg_reviewed: Some(
            body.labs_reviewed
                .iter()
                .any(|l| l.eq_ignore_ascii_case("ecg") || l.eq_ignore_ascii_case("ekg")),
        ),
        chest_xray_reviewed: Some(
            body.labs_reviewed
                .iter()
                .any(|l| l.eq_ignore_ascii_case("cxr") || l.eq_ignore_ascii_case("chest x-ray")),
        ),
        consent_signed: body.consents.surgical,
        blood_type_confirmed: body.preop_checklist.get("hbVerified").copied(),
        risk_score: None,
        assessment_notes: body.notes.clone(),
        // The assessing clinician is whoever authenticated, not whoever the
        // body names.
        assessed_by: current_user_id.clone(),
        assessed_at: now,
        cleared_for_surgery,
        clearance_conditions: if cleared_for_surgery {
            None
        } else {
            Some("pre-operative checklist incomplete or surgical consent unsigned".to_string())
        },
        created_at: now,
        updated_at: now,
        // Lossless round trip: the typed columns above are a queryable
        // projection of this, so nothing the form collects is dropped.
        data: serde_json::to_value(&body).unwrap_or_default(),
    };

    let id = entity.id.clone();
    match data.repositories.pre_op_assessments.create(entity).await {
        Ok(stored) => HttpResponse::Created().json(serde_json::json!({
            "id": stored.id,
            "success": true,
            "asa_classification": stored.asa_classification,
            "cleared_for_surgery": stored.cleared_for_surgery,
        })),
        Err(e) => {
            log::error!("pre-op assessment {id} could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Pre-operative assessment could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get pre-operative assessment
#[get("/api/surgical/pre-op/{id}")]
pub async fn get_pre_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let id = path.into_inner();
    match data.repositories.pre_op_assessments.get_by_id(&id).await {
        Ok(entity) => match PreOperativeAssessment::try_from(entity) {
            Ok(assessment) => HttpResponse::Ok().json(assessment),
            Err(e) => {
                // The stored payload could not be read back. Half an assessment
                // is more dangerous than none, so this is an error, not a
                // partial response.
                log::error!("pre-op assessment stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    error: "Stored assessment could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Err(crate::repositories::RepositoryError::NotFound(_)) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("pre-op assessment lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// List a patient's pre-operative assessments (provider or the patient).
///
/// Reads the same store `create_pre_op` writes, so listing sees created
/// records. Added to connect the doctor portal's Pre-Op page, which fetched a
/// per-patient list from a route that did not exist.
#[get("/api/surgical/pre-op/patient/{patient_id}")]
pub async fn list_patient_pre_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = require_surgical_list_access(&data, &http_req, &patient_id) {
        return resp;
    }
    match data
        .repositories
        .pre_op_assessments
        .get_by_patient(&patient_id, crate::repositories::Pagination::new(0, 100))
        .await
    {
        Ok(page) => {
            // A row whose payload will not deserialize is reported, not
            // silently skipped: a pre-op list that quietly omits an assessment
            // reads as "this patient has none", which is the wrong answer.
            let mut items = Vec::with_capacity(page.items.len());
            for entity in page.items {
                match PreOperativeAssessment::try_from(entity) {
                    Ok(assessment) => items.push(assessment),
                    Err(e) => {
                        log::error!("pre-op assessment stored payload is unreadable: {e}");
                        return HttpResponse::InternalServerError().json(ErrorResponse {
                            error: "One or more stored assessments could not be read".to_string(),
                            code: "RECORD_UNREADABLE".to_string(),
                        });
                    }
                }
            }
            HttpResponse::Ok().json(items)
        }
        Err(e) => {
            log::error!("pre-op assessments could not be listed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create operative note
/// What `OperativeNotePage` submits.
///
/// The handler took `clinical::OperativeNote` -- 27 required snake_case fields
/// -- and the page sends camelCase. Nothing matched, so every note was refused
/// with `missing field note_id` and the page reported a generic save failure.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
// The page sends camelCase. `rename_all` is the accurate bridge: naming
// each spelling by hand is how the first version of this fix ended up
// aliasing `anesthesia_type` to itself, which accepts nothing new and
// silently drops what the form sent.
#[serde(rename_all = "camelCase")]
pub struct CreateOperativeNoteRequest {
    /// Assigned by the server on create; a value sent is ignored.
    #[serde(alias = "note_id", alias = "noteId", alias = "id", default)]
    pub id: String,
    #[serde(alias = "patient_id")]
    pub patient_id: String,
    #[serde(default, alias = "patient_name")]
    pub patient_name: Option<String>,
    #[serde(default)]
    pub surgeon: Option<String>,
    #[serde(default)]
    pub assistant: Option<String>,
    #[serde(default)]
    pub anesthesiologist: Option<String>,
    #[serde(default, alias = "scrub_nurse")]
    pub scrub_nurse: Option<String>,
    #[serde(default)]
    pub circulator: Option<String>,
    #[serde(default, alias = "procedure_date")]
    pub procedure_date: Option<String>,
    #[serde(default, alias = "pre_op_diagnosis")]
    pub pre_op_diagnosis: Option<String>,
    #[serde(default, alias = "post_op_diagnosis")]
    pub post_op_diagnosis: Option<String>,
    #[serde(default, alias = "procedurePerformed", alias = "procedure_name")]
    pub procedure_name: Option<String>,
    #[serde(default, alias = "cpt_codes")]
    pub cpt_codes: Option<String>,
    #[serde(default, alias = "anesthesia_type")]
    pub anesthesia_type: Option<String>,
    #[serde(default)]
    pub incision: Option<String>,
    #[serde(default)]
    pub findings: Option<String>,
    #[serde(default, alias = "procedure_details", alias = "procedure")]
    pub procedure: Option<String>,
    #[serde(default)]
    pub closure: Option<String>,
    #[serde(default)]
    pub drains: Option<String>,
    /// Estimated blood loss, millilitres.
    #[serde(default)]
    pub ebl: Option<i32>,
    #[serde(default, alias = "urine_output")]
    pub urine_output: Option<i32>,
    #[serde(default, alias = "fluid_in")]
    pub fluid_in: Option<i32>,
    #[serde(default)]
    pub specimens: serde_json::Value,
    #[serde(default, alias = "wound_class")]
    pub wound_class: Option<String>,
    #[serde(default)]
    pub implants: Option<String>,
    #[serde(default)]
    pub complications: Option<String>,
    #[serde(default)]
    pub disposition: Option<String>,
    #[serde(default, alias = "created_at")]
    pub created_at: Option<String>,
}

impl CreateOperativeNoteRequest {
    /// Project onto the storage entity. The typed columns are a queryable
    /// view; `record_json` keeps the submission itself.
    fn into_entity(self) -> crate::repositories::traits::OperativeNoteEntity {
        let data = serde_json::to_value(&self).unwrap_or(serde_json::Value::Null);
        let now = chrono::Utc::now();
        crate::repositories::traits::OperativeNoteEntity {
            id: self.id,
            patient_id: self.patient_id,
            procedure_name: self.procedure_name.unwrap_or_default(),
            procedure_codes: self.cpt_codes.map(serde_json::Value::from),
            preoperative_diagnosis: self.pre_op_diagnosis.unwrap_or_default(),
            postoperative_diagnosis: self.post_op_diagnosis.unwrap_or_default(),
            surgeon_id: self.surgeon.unwrap_or_default(),
            assistant_surgeons: self.assistant.map(serde_json::Value::from),
            anesthesiologist_id: self.anesthesiologist,
            anesthesia_type: self.anesthesia_type.unwrap_or_default(),
            scrub_nurse_id: self.scrub_nurse,
            circulating_nurse_id: self.circulator,
            // The form has no theatre clock. See migration 20260916000001.
            start_time: None,
            end_time: None,
            estimated_blood_loss_ml: self.ebl,
            fluids_given_ml: self.fluid_in,
            specimens_collected: Some(self.specimens),
            implants_used: self.implants.map(serde_json::Value::from),
            drains_placed: self.drains.map(serde_json::Value::from),
            operative_findings: self.findings,
            procedure_description: self.procedure.unwrap_or_default(),
            complications: self.complications,
            disposition: self.disposition,
            created_at: now,
            updated_at: now,
            data,
            ..Default::default()
        }
    }
}

#[post("/api/surgical/operative-note")]
pub async fn create_operative_note(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateOperativeNoteRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let mut note = req.into_inner();
    // Server-generated. The page sent `PREFIX-${Date.now()}`; on PostgreSQL a
    // collision was refused, in the in-memory backend it silently replaced the
    // other record. The id is the server's to assign either way.
    note.id = format!("NOTE-{}", uuid::Uuid::new_v4().simple());
    let owner_id = note.patient_id.clone();

    // Log access via repository
    if let Err(response) = crate::support::require_durable_audit(
        &data,
        crate::AccessLogEntry {
            access_id: uuid::Uuid::new_v4().to_string(),
            patient_id: owner_id.clone(),
            accessor_id: current_user_id,
            accessor_role: "surgeon".to_string(),
            access_type: "create_operative_note".to_string(),
            location: None,
            timestamp: chrono::Utc::now(),
            emergency: false,
        }
        .into(),
    )
    .await
    {
        return response;
    }

    // Persisted through the repository, so the note survives a restart.
    match data
        .repositories
        .operative_notes
        .create(note.into_entity())
        .await
    {
        Ok(stored) => {
            HttpResponse::Created().json(serde_json::json!({ "id": stored.id, "success": true }))
        }
        Err(e) => {
            log::error!("operative note could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Operative note could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get operative note
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_operative_note`'s authenticated-caller bar.
/// The document as it was submitted, or `None` if the row holds nothing usable.
///
/// These records are stored whole in `record_json` precisely so the round trip
/// loses nothing; the typed columns beside it are a queryable projection, not
/// the record. Reading through a Rust type instead would serve only the fields
/// that type happens to name -- and, when the writer's shape changes, nothing
/// at all.
fn stored_document(data: serde_json::Value) -> Option<serde_json::Value> {
    match data {
        serde_json::Value::Object(map) if !map.is_empty() => Some(serde_json::Value::Object(map)),
        _ => None,
    }
}

#[get("/api/surgical/operative-note/{id}")]
pub async fn get_operative_note(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.operative_notes.get_by_id(&id).await {
        Ok(entity) => match stored_document(entity.data) {
            Some(note) => HttpResponse::Ok().json(note),
            None => {
                // Half an operative note is more dangerous than none.
                log::error!("operative-note {id} has no readable stored document");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    error: "Stored operative note could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Err(crate::repositories::RepositoryError::NotFound(_)) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("operative-note lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// List a patient's operative notes (provider or the patient).
#[get("/api/surgical/operative-note/patient/{patient_id}")]
pub async fn list_patient_operative_notes(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = require_surgical_list_access(&data, &http_req, &patient_id) {
        return resp;
    }
    match data
        .repositories
        .operative_notes
        .get_by_patient(&patient_id, crate::repositories::Pagination::new(0, 100))
        .await
    {
        Ok(page) => {
            // An unreadable row is reported, not skipped: a list that quietly
            // omits a note reads as "this patient has none".
            let mut items = Vec::with_capacity(page.items.len());
            for entity in page.items {
                match stored_document(entity.data) {
                    Some(note) => items.push(note),
                    None => {
                        log::error!("an operative note has no readable stored document");
                        return HttpResponse::InternalServerError().json(ErrorResponse {
                            error: "One or more stored operative notes could not be read"
                                .to_string(),
                            code: "RECORD_UNREADABLE".to_string(),
                        });
                    }
                }
            }
            HttpResponse::Ok().json(items)
        }
        Err(e) => {
            log::error!("operative note list failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// What `PostOpPage` submits.
///
/// Replaces `clinical::PostOperativeNote` on the wire, which required
/// `note_id`, `note_time`, `condition`, `pain_score`, `pain_management`,
/// `diet`, `activity`, `dvt_prophylaxis` and a `WoundStatus` struct. The
/// recovery-room screen sends camelCase and collects a different set, so every
/// note was refused.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
// The page sends camelCase. `rename_all` is the accurate bridge: naming
// each spelling by hand is how the first version of this fix ended up
// aliasing `anesthesia_type` to itself, which accepts nothing new and
// silently drops what the form sent.
#[serde(rename_all = "camelCase")]
pub struct CreatePostOpNoteRequest {
    /// Assigned by the server on create; a value sent is ignored.
    #[serde(alias = "note_id", alias = "noteId", alias = "id", default)]
    pub id: String,
    #[serde(alias = "patient_id")]
    pub patient_id: String,
    #[serde(default, alias = "patient_name")]
    pub patient_name: Option<String>,
    #[serde(default, alias = "documented_by")]
    pub documented_by: Option<String>,
    #[serde(default, alias = "documented_at")]
    pub documented_at: Option<String>,
    #[serde(default)]
    pub procedure: Option<String>,
    #[serde(default)]
    pub surgeon: Option<String>,
    #[serde(default, alias = "anesthesia_type")]
    pub anesthesia_type: Option<String>,
    #[serde(default, alias = "arrival_time")]
    pub arrival_time: Option<String>,
    #[serde(default)]
    pub aldrete: serde_json::Value,
    /// The page's own spelling.
    #[serde(
        default,
        alias = "aldreteScore",
        alias = "aldrete_score",
        alias = "alderet_score"
    )]
    pub alderet_score: Option<i32>,
    /// Whether the total meets the recovery threshold. The server's
    /// conclusion, never read from a request.
    #[serde(default, skip_deserializing)]
    pub ready_for_discharge: Option<bool>,
    #[serde(default)]
    pub vitals: serde_json::Value,
    #[serde(default, alias = "pain_score")]
    pub pain_score: Option<i32>,
    #[serde(default, alias = "nausea_vomiting")]
    pub nausea_vomiting: Option<String>,
    #[serde(default)]
    pub bleeding: Option<String>,
    #[serde(default, alias = "urine_output")]
    pub urine_output: Option<String>,
    #[serde(default, alias = "fluid_intake")]
    pub fluid_intake: Option<String>,
    #[serde(default, alias = "oral_intake")]
    pub oral_intake: Option<String>,
    #[serde(default, alias = "iv_access")]
    pub iv_access: Option<String>,
    #[serde(default)]
    pub medications: serde_json::Value,
    #[serde(default, alias = "dressing_status")]
    pub dressing_status: Option<String>,
    #[serde(default)]
    pub drains: serde_json::Value,
    #[serde(default, alias = "discharge_criteria")]
    pub discharge_criteria: serde_json::Value,
    #[serde(default, alias = "discharge_time")]
    pub discharge_time: Option<String>,
    #[serde(default, alias = "discharge_disposition")]
    pub discharge_disposition: Option<String>,
    #[serde(default)]
    pub complications: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

impl CreatePostOpNoteRequest {
    fn into_entity(self) -> crate::repositories::traits::PostOpNoteEntity {
        let data = serde_json::to_value(&self).unwrap_or(serde_json::Value::Null);
        let now = chrono::Utc::now();
        // Read before the struct is taken apart below.
        let pain_management = self.medications_summary();
        crate::repositories::traits::PostOpNoteEntity {
            id: self.id,
            patient_id: self.patient_id,
            // The recovery screen documents the immediate post-anaesthetic
            // period; it has no link to an operative note and no day counter.
            operative_note_id: None,
            post_op_day: 0,
            note_date: now,
            provider_id: self.documented_by.unwrap_or_default(),
            pain_level: self.pain_score,
            pain_management,
            vital_signs: Some(self.vitals),
            wound_assessment: self.dressing_status.clone().map(serde_json::Value::from),
            drain_output: Some(self.drains),
            diet_status: self.oral_intake,
            ambulation_status: None,
            voiding_status: self.urine_output,
            bowel_function: None,
            lab_results_reviewed: None,
            complications: self.complications,
            plan: self.notes,
            // True when any criterion was ticked -- the server does not hold
            // the checklist, so it cannot say "every". Nothing reads this
            // column; the ticked criteria themselves are in `data`.
            discharge_criteria_met: self
                .discharge_criteria
                .as_array()
                .is_some_and(|items| !items.is_empty()),
            estimated_discharge_date: None,
            created_at: now,
            updated_at: now,
            data,
        }
    }

    fn medications_summary(&self) -> Option<String> {
        let items = self.medications.as_array()?;
        if items.is_empty() {
            return None;
        }
        Some(
            items
                .iter()
                .map(|item| item.as_str().unwrap_or_default().to_string())
                .collect::<Vec<_>>()
                .join("; "),
        )
    }
}

/// Create post-operative note
#[post("/api/surgical/post-op")]
pub async fn create_post_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreatePostOpNoteRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let mut note = req.into_inner();
    // Server-generated. The page sent `PREFIX-${Date.now()}`; on PostgreSQL a
    // collision was refused, in the in-memory backend it silently replaced the
    // other record. The id is the server's to assign either way.
    note.id = format!("NOTE-{}", uuid::Uuid::new_v4().simple());
    // The score and what it means are computed here (rule 8), and the author
    // is the caller: all three were taken from the page.
    let aldrete = crate::clinical_scoring::aldrete_score(&note.aldrete);
    note.alderet_score = aldrete.map(|a| a.total);
    note.ready_for_discharge = aldrete.map(|a| a.meets_discharge_threshold);
    note.documented_by = Some(current_user_id.clone());
    let owner_id = note.patient_id.clone();

    // Log access
    if let Err(response) = crate::support::require_durable_audit(
        &data,
        crate::AccessLogEntry {
            access_id: uuid::Uuid::new_v4().to_string(),
            patient_id: owner_id.clone(),
            accessor_id: current_user_id,
            accessor_role: "doctor".to_string(),
            access_type: "create_post_op".to_string(),
            location: None,
            timestamp: chrono::Utc::now(),
            emergency: false,
        }
        .into(),
    )
    .await
    {
        return response;
    }

    // Persisted through the repository, so the note survives a restart.
    match data
        .repositories
        .post_op_notes
        .create(note.into_entity())
        .await
    {
        Ok(stored) => {
            HttpResponse::Created().json(serde_json::json!({ "id": stored.id, "success": true }))
        }
        Err(e) => {
            log::error!("post-op note could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Post-operative note could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get post-operative note
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_post_op`'s authenticated-caller bar.
#[get("/api/surgical/post-op/{id}")]
pub async fn get_post_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.post_op_notes.get_by_id(&id).await {
        Ok(entity) => match stored_document(entity.data) {
            Some(note) => HttpResponse::Ok().json(note),
            None => {
                log::error!("post-op note {id} has no readable stored document");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    error: "Stored post-operative note could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Err(crate::repositories::RepositoryError::NotFound(_)) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("post-op note lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// List a patient's post-operative notes (provider or the patient).
#[get("/api/surgical/post-op/patient/{patient_id}")]
pub async fn list_patient_post_op(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    if let Err(resp) = require_surgical_list_access(&data, &http_req, &patient_id) {
        return resp;
    }
    match data
        .repositories
        .post_op_notes
        .get_by_patient(&patient_id, crate::repositories::Pagination::new(0, 100))
        .await
    {
        Ok(page) => {
            let mut items = Vec::with_capacity(page.items.len());
            for entity in page.items {
                match stored_document(entity.data) {
                    Some(note) => items.push(note),
                    None => {
                        log::error!("a post-op note has no readable stored document");
                        return HttpResponse::InternalServerError().json(ErrorResponse {
                            error: "One or more stored post-operative notes could not be read"
                                .to_string(),
                            code: "RECORD_UNREADABLE".to_string(),
                        });
                    }
                }
            }
            HttpResponse::Ok().json(items)
        }
        Err(e) => {
            log::error!("post-op note list failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}
