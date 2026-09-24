use super::*;

// ============================================================================
// PUBLIC HEALTH & ADMINISTRATION
// ============================================================================

/// Create immunization record
#[post("/api/surgical/immunization")]
pub async fn create_immunization(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<ImmunizationRecord>,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(resp) => return resp,
    };

    let mut record = req.into_inner();
    // Who gave the dose is the authenticated caller, not a field the caller
    // fills in. It was stored as sent, so any clinician could attribute a
    // vaccination to a colleague -- and the page's own fallback, when it had
    // no user, was the invented `USER-001`.
    record.administered_by = caller.wallet_address.clone();
    // The id is the primary key, so it is the server's to assign. A blank or
    // absent one used to be stored verbatim, so the second such record
    // collided and failed with an opaque 500.
    if record.record_id.trim().is_empty() {
        record.record_id = crate::middleware::error_handling::secure_tokens::generate_access_id()
            .replacen("ACC-", "IMM-", 1);
    }
    // Persisted through the typed repository, so it survives a restart.
    match data
        .repositories
        .immunization_records
        .create(record.into())
        .await
    {
        Ok(stored) => {
            HttpResponse::Created().json(serde_json::json!({ "id": stored.id, "success": true }))
        }
        Err(e) => {
            log::error!("immunization record could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Immunization record could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get immunization record
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_immunization`'s authenticated-caller bar.
#[get("/api/surgical/immunization/{id}")]
pub async fn get_immunization(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.immunization_records.get_by_id(&id).await {
        // Infallible, unlike the other clinical conversions: this entity has
        // typed columns for every field the API type carries, so there is no
        // payload to fail to deserialize.
        Ok(entity) => HttpResponse::Ok().json(ImmunizationRecord::from(entity)),
        Err(crate::repositories::RepositoryError::NotFound(_)) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("immunization-record lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create family history
#[post("/api/surgical/family-history")]
pub async fn create_family_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<FamilyMedicalHistory>,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(resp) => return resp,
    };

    let mut history = req.into_inner();
    let id = history.patient_id.clone();
    // Persisted through the repository, so it survives a restart. Keyed by
    // patient: a family history is one evolving record per patient rather than
    // a series, so a re-post replaces it.
    let now = chrono::Utc::now();
    // Who changed it, and when, are the server's to state. Both were stored as
    // the page sent them -- the author falling back to the invented `USER-001`
    // -- so the history could name anybody as having recorded it.
    history.updated_by = caller.wallet_address.clone();
    history.last_updated = now.timestamp_millis();
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: id.clone(),
        data: serde_json::to_value(&history).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };
    match data
        .repositories
        .family_history_records
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => {
            log::error!("family-history record could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Family history could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get family history
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_family_history`'s authenticated-caller bar.
#[get("/api/surgical/family-history/{id}")]
pub async fn get_family_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let id = path.into_inner();

    // The path key is the patient id. A registered identity alone is never
    // permission to read another patient's genetic history: allow the patient,
    // an authorised guardian/admin, or clinical staff with a current access
    // grant. Fail closed if the grant store cannot be consulted.
    let guardian_or_admin = crate::support::caller_may_access_patient(
        &data,
        &caller,
        &id,
        crate::repositories::traits::GuardianPermission::ViewRecords,
    )
    .await;
    let provider_grant = if caller.role.can_view_medical_records() {
        data.patient_access
            .provider_has_active_grant(&id, &caller.wallet_address, Utc::now())
            .await
            .unwrap_or(false)
    } else {
        false
    };
    if !guardian_or_admin && !provider_grant {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "You are not authorised to view this family history".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }
    match data
        .repositories
        .family_history_records
        .get_by_id(&id)
        .await
    {
        // A patient with nothing recorded has an EMPTY family history, not a
        // missing one. Answering 404 made the patient app's Medical History
        // page report a failed load for the ordinary case of "nobody has filled
        // this in yet" — indistinguishable, to the caller, from a broken route.
        Ok(Some(rec)) => match serde_json::from_value::<FamilyMedicalHistory>(rec.data) {
            Ok(history) => HttpResponse::Ok().json(history),
            Err(e) => {
                log::error!("family-history stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored family history could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Ok(None) => HttpResponse::Ok().json(serde_json::json!({
            "patient_id": id,
            "entries": [],
        })),
        Err(e) => {
            log::error!("family-history lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Get the authenticated patient's family history.
///
/// This endpoint deliberately takes no patient identifier. Patient-facing
/// clients must not be able to turn a URL parameter into another patient's
/// genetic and family-health information. Clinical staff that need a specific
/// record continue to use the explicitly authorised record endpoint above.
#[get("/api/clinical/family-history")]
pub async fn get_my_family_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let patient_id = caller
        .linked_patient_id
        .clone()
        .unwrap_or(caller.wallet_address);

    match data
        .repositories
        .family_history_records
        .get_by_id(&patient_id)
        .await
    {
        Ok(Some(record)) => match serde_json::from_value::<FamilyMedicalHistory>(record.data) {
            Ok(history) => HttpResponse::Ok().json(history),
            Err(error) => {
                log::error!("caller-scoped family-history payload is unreadable: {error}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored family history could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Ok(None) => HttpResponse::Ok().json(serde_json::json!({
            "patient_id": patient_id,
            "family_members": [],
            "genetic_conditions": [],
            "three_gen_complete": false,
            "last_updated": 0,
            "updated_by": "",
        })),
        Err(error) => {
            log::error!("caller-scoped family-history lookup failed: {error}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Family history could not be loaded".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// One condition category's affected relatives, to be assessed together.
#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct FamilyHistoryGroup {
    /// `cancer`, `cardiovascular`, ... — echoed back so the caller can match
    /// the assessment to the panel it belongs to.
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub relatives: Vec<crate::clinical_scoring::AffectedRelative>,
}

/// Assess a family history, one condition category at a time.
#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct AssessFamilyHistoryRequest {
    #[serde(default)]
    pub groups: Vec<FamilyHistoryGroup>,
}

/// Most categories a single request will assess.
///
/// Bounded because the handler loops over them, and the form offers eight.
const MAX_FAMILY_HISTORY_GROUPS: usize = 32;

/// Assess a family history for referral.
///
/// Stateless: it reads nothing and writes nothing. The relatives come from the
/// caller, which already holds them, and the answer comes back with the working
/// shown — the degree counts and how many were diagnosed early.
///
/// It exists so that `clinical_scoring::family_history_assessment` is the only
/// implementation of this scale. `FamilyHistoryPage` used to band hereditary
/// risk by counting affected relatives, 3 or more being "HIGH", and issue an
/// automatic "consider genetic counseling" recommendation from that count. A
/// mother and a sister with breast cancer at 40 counted 2; three second cousins
/// with type 2 diabetes counted 3.
///
/// Authenticated as a registered caller rather than clinical staff: a patient
/// reading their own family history sees the same assessment their clinician
/// does, and the request carries no identifiers — only relationships and ages.
#[post("/api/clinical/family-history/assess")]
pub async fn assess_family_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<AssessFamilyHistoryRequest>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_registered_caller(&data, &http_req) {
        return resp;
    }

    let body = req.into_inner();
    if body.groups.len() > MAX_FAMILY_HISTORY_GROUPS {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: format!("at most {MAX_FAMILY_HISTORY_GROUPS} categories per request"),
            code: "TOO_MANY_GROUPS".to_string(),
        });
    }

    let assessments: Vec<serde_json::Value> = body
        .groups
        .iter()
        .take(MAX_FAMILY_HISTORY_GROUPS)
        .map(|group| {
            let assessment = crate::clinical_scoring::family_history_assessment(&group.relatives);
            let mut value = serde_json::to_value(&assessment).unwrap_or_default();
            if let Some(obj) = value.as_object_mut() {
                obj.insert("category".to_string(), serde_json::json!(group.category));
            }
            value
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({ "assessments": assessments }))
}

/// Create blood type screen
/// What the blood-bank screen actually submits.
///
/// `BloodBankPage.tsx` raises a **blood product order** — product, units,
/// indication, priority, and the patient's blood type as already recorded. The
/// handler wanted the clinical `BloodTypeScreen`, which models a laboratory
/// type-and-screen: `test_id`, `abo_type`, `rh_type`, `antibody_screen`,
/// `expiration`, `verified_by`. The two share a patient and nothing else, so
/// every order was refused with `400 missing field 'test_id'` and the page's
/// Save button had never worked.
///
/// The order is what the ward raises and the bank fills, so it is what this
/// endpoint stores. The type-and-screen shape stays available for a laboratory
/// caller through the `alias`es below.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateBloodOrderRequest {
    #[serde(rename = "orderId", alias = "test_id", default)]
    pub order_id: Option<String>,
    #[serde(rename = "patientId", alias = "patient_id")]
    pub patient_id: String,
    #[serde(rename = "patientName", default)]
    pub patient_name: Option<String>,
    /// The patient's recorded ABO/Rh. `Unknown` is a real state and the reason
    /// a type-and-screen has to happen before the crossmatch.
    #[serde(rename = "bloodType", default)]
    pub blood_type: Option<String>,
    #[serde(rename = "orderDate", default)]
    pub order_date: Option<String>,
    #[serde(rename = "orderTime", default)]
    pub order_time: Option<String>,
    #[serde(rename = "orderedBy", alias = "performed_by", default)]
    pub ordered_by: Option<String>,
    /// packed_red_cells / platelets / fresh_frozen_plasma / cryoprecipitate.
    pub product: String,
    pub units: u32,
    /// Why the patient needs blood. A product order without one cannot be
    /// reviewed, and transfusion is the most-audited thing a ward does.
    pub indication: String,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

#[post("/api/surgical/blood-type")]
pub async fn create_blood_type_screen(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateBloodOrderRequest>,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(user) => user,
        Err(resp) => return resp,
    };

    let screen = req.into_inner();
    if screen.patient_id.trim().is_empty()
        || screen.product.trim().is_empty()
        || screen.indication.trim().is_empty()
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id, product and indication are required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if screen.units == 0 {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "an order for zero units is not an order".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if data
        .repositories
        .patients
        .get_by_id(&screen.patient_id)
        .await
        .is_err()
    {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Patient '{}' not found", screen.patient_id),
            code: "PATIENT_NOT_FOUND".to_string(),
        });
    }

    // Server-generated: a client-supplied id lets one order overwrite another.
    let id = format!("BB-{}", uuid::Uuid::new_v4().simple());
    // Persisted through the repository, so it survives a restart.
    let now = chrono::Utc::now();
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: screen.patient_id.clone(),
        data: serde_json::json!({
            "order_id": id,
            "client_order_id": screen.order_id,
            "patient_id": screen.patient_id,
            "patient_name": screen.patient_name,
            "blood_type": screen.blood_type,
            "product": screen.product,
            "units": screen.units,
            "indication": screen.indication,
            "priority": screen.priority.clone().unwrap_or_else(|| "routine".to_string()),
            "status": screen.status.clone().unwrap_or_else(|| "ordered".to_string()),
            "order_date": screen.order_date,
            "order_time": screen.order_time,
            // The orderer is the authenticated caller. A blood product order is
            // signed work, and a client-asserted name is not a signature.
            "ordered_by": caller.wallet_address,
            "created_at": now.to_rfc3339(),
        }),
        created_at: now,
        updated_at: now,
    };
    match data
        .repositories
        .blood_type_screen_records
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => {
            log::error!("blood-type screen could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Blood type screen could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get blood type screen
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_blood_type_screen`'s authenticated-caller bar.
#[get("/api/surgical/blood-type/{id}")]
pub async fn get_blood_type_screen(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data
        .repositories
        .blood_type_screen_records
        .get_by_id(&id)
        .await
    {
        Ok(Some(rec)) => match serde_json::from_value::<BloodTypeScreen>(rec.data) {
            Ok(screen) => HttpResponse::Ok().json(screen),
            Err(e) => {
                // A partial blood type screen is more dangerous than none.
                log::error!("blood-type screen stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored blood type screen could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Ok(None) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("blood-type screen lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create transfusion record
/// One set of observations either side of a transfusion.
///
/// Pre- and post-transfusion observations are how a reaction is detected and,
/// afterwards, how it is proven or excluded. They are the reason a transfusion
/// record exists at all, and the page collects them.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct TransfusionVitalsInput {
    #[serde(default)]
    pub bp: Option<String>,
    #[serde(default)]
    pub hr: Option<i32>,
    #[serde(default)]
    pub temp: Option<f64>,
    #[serde(default)]
    pub rr: Option<i32>,
}

/// What the ward records when a unit is given.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct TransfusionInfoInput {
    #[serde(rename = "startTime", default)]
    pub start_time: Option<String>,
    #[serde(rename = "endTime", default)]
    pub end_time: Option<String>,
    #[serde(rename = "administeredBy", default)]
    pub administered_by: Option<String>,
    /// The second person on the bedside check. A two-person check with one name
    /// recorded is a one-person check.
    #[serde(rename = "witnessedBy", default)]
    pub witnessed_by: Option<String>,
    #[serde(rename = "preVitals", default)]
    pub pre_vitals: Option<TransfusionVitalsInput>,
    #[serde(rename = "postVitals", default)]
    pub post_vitals: Option<TransfusionVitalsInput>,
    #[serde(default)]
    pub reactions: Vec<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// What the transfusion form actually submits.
///
/// `BloodBankPage.tsx` posts the order it is completing plus a nested
/// `transfusionInfo`. The handler wanted the clinical `TransfusionRecord`,
/// which requires `transfusion_id`, `unit_number`, `abo_rh`,
/// `consent_obtained`, `patient_verified`, `volume_ml` and `rate` — none of
/// which the ward screen collects. Every submission was refused.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateTransfusionRequest {
    #[serde(rename = "orderId", alias = "transfusion_id", default)]
    pub order_id: Option<String>,
    #[serde(rename = "patientId", alias = "patient_id")]
    pub patient_id: String,
    #[serde(rename = "bloodType", alias = "abo_rh", default)]
    pub blood_type: Option<String>,
    #[serde(default)]
    pub product: Option<String>,
    #[serde(default)]
    pub units: Option<u32>,
    #[serde(rename = "unitNumber", alias = "unit_number", default)]
    pub unit_number: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(rename = "transfusionInfo", default)]
    pub transfusion_info: Option<TransfusionInfoInput>,
}

#[post("/api/surgical/transfusion")]
pub async fn create_transfusion(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateTransfusionRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let record = req.into_inner();
    if record.patient_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "patient_id is required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    let info = record.transfusion_info.as_ref();
    // A completed transfusion with no pre-transfusion observations cannot
    // answer the one question asked after a reaction, so it is refused rather
    // than stored incomplete.
    let completed = record.status.as_deref() == Some("completed");
    if completed && info.and_then(|i| i.pre_vitals.as_ref()).is_none() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "pre-transfusion observations are required to complete a transfusion"
                .to_string(),
            code: "MISSING_PRE_VITALS".to_string(),
        });
    }
    let id = format!("TX-{}", uuid::Uuid::new_v4().simple());

    // Log access
    if let Err(response) = crate::support::require_durable_audit(
        &data,
        crate::AccessLogEntry {
            access_id: uuid::Uuid::new_v4().to_string(),
            patient_id: record.patient_id.clone(),
            accessor_id: current_user_id.clone(),
            accessor_role: "nurse".to_string(),
            access_type: "create_transfusion".to_string(),
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

    // Persisted through the repository, so it survives a restart.
    let now = chrono::Utc::now();
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: record.patient_id.clone(),
        // The record plus the two things it cannot assert about itself: the id
        // it was filed under, and who filed it.
        data: {
            let mut blob = serde_json::to_value(&record).unwrap_or_default();
            if let Some(object) = blob.as_object_mut() {
                object.insert("transfusion_id".into(), serde_json::json!(id));
                object.insert("recorded_by".into(), serde_json::json!(current_user_id));
                object.insert("recorded_at".into(), serde_json::json!(now.to_rfc3339()));
            }
            blob
        },
        created_at: now,
        updated_at: now,
    };
    match data
        .repositories
        .transfusion_event_records
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => {
            log::error!("transfusion record could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Transfusion record could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get transfusion record
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_transfusion`'s authenticated-caller bar.
#[get("/api/surgical/transfusion/{id}")]
pub async fn get_transfusion(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data
        .repositories
        .transfusion_event_records
        .get_by_id(&id)
        .await
    {
        Ok(Some(rec)) => match serde_json::from_value::<TransfusionRecord>(rec.data) {
            Ok(record) => HttpResponse::Ok().json(record),
            Err(e) => {
                // A partial transfusion record is more dangerous than none.
                log::error!("transfusion record stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored transfusion record could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Ok(None) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("transfusion-record lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create death certificate
/// What the death-certificate wizard actually submits.
///
/// `DeathCertificatePage.tsx` sends a **flat** certificate: `place_of_death` is
/// the free text a certifier types ("Ward 3", "Memorial General Hospital"),
/// `cause_of_death` is the immediate cause as a string, and `other_conditions`
/// is a list of underlying causes. The handler wanted the clinical
/// `DeathCertificate`, whose `place_of_death` is a `PlaceOfDeath` struct with a
/// facility type, address, city, state and country, and whose `cause_of_death`
/// is a `CauseOfDeath` structure. Every submission was refused with
/// `400 invalid type: string "Ward 3", expected struct PlaceOfDeath`, so no
/// certificate could ever be filed.
///
/// A death certificate is a legal instrument, so the fields it does carry are
/// required rather than defaulted: an unnamed decedent, an unstated cause or an
/// uncertified certifier makes the document void, and storing a void one is
/// worse than refusing it.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateDeathCertificateRequest {
    #[serde(default)]
    pub id: Option<String>,
    pub patient_id: String,
    pub deceased_name: String,
    #[serde(default)]
    pub date_of_birth: Option<String>,
    pub date_of_death: String,
    #[serde(default)]
    pub time_of_death: Option<String>,
    /// Free text, as the form collects it.
    pub place_of_death: String,
    /// natural / accident / suicide / homicide / undetermined / pending.
    pub manner_of_death: String,
    /// The immediate cause. Part I(a) of the certificate.
    pub cause_of_death: String,
    /// The underlying conditions leading to it, Part I(b) onward.
    #[serde(default)]
    pub other_conditions: Vec<String>,
    pub certifier_name: String,
    #[serde(default)]
    pub certifier_license: Option<String>,
    #[serde(default)]
    pub certifier_type: Option<String>,
    #[serde(default)]
    pub signature: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

#[post("/api/surgical/death-certificate")]
pub async fn create_death_certificate(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateDeathCertificateRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let certificate = req.into_inner();

    // The certificate has to name a real person. The page used to post the
    // literal string "DEMO_PATIENT" here, which is exactly the mistake this
    // check makes impossible: a certificate filed against an id that does not
    // resolve is a certificate for nobody.
    if data
        .repositories
        .patients
        .get_by_id(&certificate.patient_id)
        .await
        .is_err()
    {
        return HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Patient '{}' not found", certificate.patient_id),
            code: "PATIENT_NOT_FOUND".to_string(),
        });
    }
    for (field, value) in [
        ("deceased_name", certificate.deceased_name.trim()),
        ("date_of_death", certificate.date_of_death.trim()),
        ("place_of_death", certificate.place_of_death.trim()),
        ("cause_of_death", certificate.cause_of_death.trim()),
        ("certifier_name", certificate.certifier_name.trim()),
    ] {
        if value.is_empty() {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: format!("{field} is required on a death certificate"),
                code: "VALIDATION_ERROR".to_string(),
            });
        }
    }

    // Server-generated: a client-supplied id lets one certificate overwrite
    // another, and this is a document a registrar relies on being unique.
    let id = format!("DC-{}", uuid::Uuid::new_v4().simple());

    // Log access
    if let Err(response) = crate::support::require_durable_audit(
        &data,
        crate::AccessLogEntry {
            access_id: uuid::Uuid::new_v4().to_string(),
            patient_id: certificate.patient_id.clone(),
            accessor_id: current_user_id.clone(),
            accessor_role: "doctor".to_string(),
            access_type: "create_death_certificate".to_string(),
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

    // Persisted through the repository, so it survives a restart.
    let now = chrono::Utc::now();
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: certificate.patient_id.clone(),
        // The certificate plus the two things it cannot assert about itself:
        // the id it was filed under, and who filed it.
        data: {
            let mut blob = serde_json::to_value(&certificate).unwrap_or_default();
            if let Some(object) = blob.as_object_mut() {
                object.insert("certificate_id".into(), serde_json::json!(id));
                object.insert("filed_by".into(), serde_json::json!(current_user_id));
                object.insert("filed_at".into(), serde_json::json!(now.to_rfc3339()));
            }
            blob
        },
        created_at: now,
        updated_at: now,
    };
    match data
        .repositories
        .death_certificate_records
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => {
            log::error!("death certificate could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Death certificate could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

// ============================================================================
// Death certificate drafts
// ============================================================================

/// A certificate in progress.
///
/// `CreateDeathCertificateRequest` requires deceased name, date, place, cause
/// and certifier, because a filed certificate missing any of them is void and
/// storing a void one is worse than refusing it. That is right for filing and
/// wrong for drafting: a doctor completing a certificate over a shift has a
/// partial document long before it is a legal instrument, and the Settings
/// screen offered a "Save as draft" button that could not be wired to anything
/// because the only endpoint refused everything incomplete.
///
/// So a draft is a different thing with different rules, not a certificate with
/// the checks switched off. It requires only the patient it concerns, it is
/// stored with `status: "draft"`, and it is `POST /.../draft` — never reachable
/// by accident from the filing path.
#[derive(Debug, serde::Deserialize, serde::Serialize, Default)]
pub struct DraftDeathCertificateRequest {
    pub patient_id: String,
    #[serde(default)]
    pub deceased_name: Option<String>,
    #[serde(default)]
    pub date_of_birth: Option<String>,
    #[serde(default)]
    pub date_of_death: Option<String>,
    #[serde(default)]
    pub time_of_death: Option<String>,
    #[serde(default)]
    pub place_of_death: Option<String>,
    #[serde(default)]
    pub manner_of_death: Option<String>,
    #[serde(default)]
    pub cause_of_death: Option<String>,
    #[serde(default)]
    pub other_conditions: Vec<String>,
    #[serde(default)]
    pub certifier_name: Option<String>,
    #[serde(default)]
    pub certifier_license: Option<String>,
    #[serde(default)]
    pub certifier_type: Option<String>,
}

/// The states a certificate record can be in. A draft is editable and is not a
/// certificate; a filed one is a legal instrument and is not editable.
const DC_STATUS_DRAFT: &str = "draft";
const DC_STATUS_FILED: &str = "filed";

fn dc_error(status: actix_web::http::StatusCode, message: &str, code: &str) -> HttpResponse {
    HttpResponse::build(status).json(ErrorResponse {
        success: false,
        error: message.to_string(),
        code: code.to_string(),
    })
}

/// Build the stored blob for a draft, carrying the fields it cannot assert
/// about itself.
fn draft_blob(
    draft: &DraftDeathCertificateRequest,
    id: &str,
    author: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> serde_json::Value {
    let mut blob = serde_json::to_value(draft).unwrap_or_default();
    if let Some(object) = blob.as_object_mut() {
        object.insert("certificate_id".into(), serde_json::json!(id));
        object.insert("status".into(), serde_json::json!(DC_STATUS_DRAFT));
        object.insert("drafted_by".into(), serde_json::json!(author));
        object.insert("updated_at".into(), serde_json::json!(now.to_rfc3339()));
    }
    blob
}

/// Start a death certificate without filing it.
#[post("/api/surgical/death-certificate/draft")]
pub async fn draft_death_certificate(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<DraftDeathCertificateRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };
    let draft = req.into_inner();

    // Even a draft names the person it concerns. Without this a draft is a
    // note about nobody, and it cannot later be filed.
    if data
        .repositories
        .patients
        .get_by_id(&draft.patient_id)
        .await
        .is_err()
    {
        return dc_error(
            actix_web::http::StatusCode::NOT_FOUND,
            &format!("Patient '{}' not found", draft.patient_id),
            "PATIENT_NOT_FOUND",
        );
    }

    let id = format!("DC-{}", uuid::Uuid::new_v4().simple());
    let now = chrono::Utc::now();
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: draft.patient_id.clone(),
        data: draft_blob(&draft, &id, &current_user_id, now),
        created_at: now,
        updated_at: now,
    };
    match data
        .repositories
        .death_certificate_records
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created()
            .json(serde_json::json!({ "id": id, "status": DC_STATUS_DRAFT, "success": true })),
        Err(e) => {
            log::error!("death certificate draft could not be stored: {e}");
            dc_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Draft could not be stored",
                "DATABASE_ERROR",
            )
        }
    }
}

/// Revise a draft.
///
/// Conditional on the record still being a draft. A filed certificate is a
/// legal instrument and is not editable: the correction path for one of those
/// is an amended certificate, which is a different document with its own
/// number, not a silent overwrite of the original.
#[actix_web::put("/api/surgical/death-certificate/{id}")]
pub async fn update_death_certificate_draft(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<DraftDeathCertificateRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };
    let id = path.into_inner();
    let draft = req.into_inner();

    let existing = match data
        .repositories
        .death_certificate_records
        .get_by_id(&id)
        .await
    {
        Ok(Some(rec)) => rec,
        Ok(None) => {
            return dc_error(
                actix_web::http::StatusCode::NOT_FOUND,
                "No such death certificate",
                "NOT_FOUND",
            )
        }
        Err(e) => {
            log::error!("death certificate read failed: {e}");
            return dc_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Death certificate could not be read",
                "DATABASE_ERROR",
            );
        }
    };

    // The patient a certificate concerns is not an editable field: changing it
    // would turn one person's certificate into another's while keeping its
    // number and its audit trail.
    if existing.owner_id != draft.patient_id {
        return dc_error(
            actix_web::http::StatusCode::BAD_REQUEST,
            "A death certificate cannot be moved to a different patient",
            "PATIENT_IMMUTABLE",
        );
    }

    let now = chrono::Utc::now();
    let updated = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: existing.owner_id.clone(),
        data: draft_blob(&draft, &id, &current_user_id, now),
        created_at: existing.created_at,
        updated_at: now,
    };

    // Conditional write: if the record was filed between the read above and
    // this line, the update does not land.
    match data
        .repositories
        .death_certificate_records
        .replace_if_field_eq(&id, "status", DC_STATUS_DRAFT, updated)
        .await
    {
        Ok(Some(_)) => HttpResponse::Ok()
            .json(serde_json::json!({ "id": id, "status": DC_STATUS_DRAFT, "success": true })),
        Ok(None) => dc_error(
            actix_web::http::StatusCode::CONFLICT,
            "This certificate has been filed and can no longer be edited",
            "ALREADY_FILED",
        ),
        Err(e) => {
            log::error!("death certificate draft update failed: {e}");
            dc_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Draft could not be saved",
                "DATABASE_ERROR",
            )
        }
    }
}

/// File a draft as a certificate.
///
/// This is where the legal-instrument checks live, and they are the same ones
/// `create_death_certificate` applies: filing an incomplete certificate is the
/// thing the draft state exists to avoid, not a shortcut it provides.
#[post("/api/surgical/death-certificate/{id}/file")]
pub async fn file_death_certificate(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };
    let id = path.into_inner();

    let existing = match data
        .repositories
        .death_certificate_records
        .get_by_id(&id)
        .await
    {
        Ok(Some(rec)) => rec,
        Ok(None) => {
            return dc_error(
                actix_web::http::StatusCode::NOT_FOUND,
                "No such death certificate",
                "NOT_FOUND",
            )
        }
        Err(e) => {
            log::error!("death certificate read failed: {e}");
            return dc_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Death certificate could not be read",
                "DATABASE_ERROR",
            );
        }
    };

    let text = |field: &str| -> String {
        existing
            .data
            .get(field)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .trim()
            .to_string()
    };
    for field in [
        "deceased_name",
        "date_of_death",
        "place_of_death",
        "cause_of_death",
        "certifier_name",
    ] {
        if text(field).is_empty() {
            return dc_error(
                actix_web::http::StatusCode::BAD_REQUEST,
                &format!("{field} is required before a certificate can be filed"),
                "VALIDATION_ERROR",
            );
        }
    }

    let now = chrono::Utc::now();
    if let Err(response) = crate::support::require_durable_audit(
        &data,
        crate::AccessLogEntry {
            access_id: uuid::Uuid::new_v4().to_string(),
            patient_id: existing.owner_id.clone(),
            accessor_id: current_user_id.clone(),
            accessor_role: "doctor".to_string(),
            access_type: "create_death_certificate".to_string(),
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

    let mut blob = existing.data.clone();
    if let Some(object) = blob.as_object_mut() {
        object.insert("status".into(), serde_json::json!(DC_STATUS_FILED));
        object.insert("filed_by".into(), serde_json::json!(current_user_id));
        object.insert("filed_at".into(), serde_json::json!(now.to_rfc3339()));
    }
    let filed = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: existing.owner_id.clone(),
        data: blob,
        created_at: existing.created_at,
        updated_at: now,
    };

    match data
        .repositories
        .death_certificate_records
        .replace_if_field_eq(&id, "status", DC_STATUS_DRAFT, filed)
        .await
    {
        Ok(Some(_)) => HttpResponse::Ok()
            .json(serde_json::json!({ "id": id, "status": DC_STATUS_FILED, "success": true })),
        Ok(None) => dc_error(
            actix_web::http::StatusCode::CONFLICT,
            "This certificate has already been filed",
            "ALREADY_FILED",
        ),
        Err(e) => {
            log::error!("death certificate filing failed: {e}");
            dc_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Certificate could not be filed",
                "DATABASE_ERROR",
            )
        }
    }
}

/// Get death certificate
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_death_certificate`'s authenticated-caller bar.
#[get("/api/surgical/death-certificate/{id}")]
pub async fn get_death_certificate(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data
        .repositories
        .death_certificate_records
        .get_by_id(&id)
        .await
    {
        Ok(Some(rec)) => match serde_json::from_value::<DeathCertificate>(rec.data) {
            Ok(certificate) => HttpResponse::Ok().json(certificate),
            Err(e) => {
                log::error!("death-certificate stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored death certificate could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Ok(None) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("death-certificate lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create autopsy request
// Persisted via `data.repositories.autopsy_requests` (was: the legacy
// `data.autopsy_requests` HashMap, which the admin list view at
// `/api/platform/list/autopsy` never read from — creates were invisible to
// that list and lost on restart).
#[post("/api/surgical/autopsy")]
pub async fn create_autopsy_request(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<AutopsyRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let mut request = req.into_inner();
    // Server-generated. The store's create is an upsert on `id`, owner
    // included, so a client-chosen id let one request replace another --
    // another patient's among them.
    let id = format!("AUTREQ-{}", uuid::Uuid::new_v4().simple());
    request.request_id = id.clone();

    // Log access
    if let Err(response) = crate::support::require_durable_audit(
        &data,
        crate::AccessLogEntry {
            access_id: uuid::Uuid::new_v4().to_string(),
            patient_id: request.patient_id.clone(),
            accessor_id: current_user_id,
            accessor_role: "doctor".to_string(),
            access_type: "create_autopsy_request".to_string(),
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

    let now = chrono::Utc::now();
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: request.patient_id.clone(),
        data: serde_json::to_value(&request).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };
    match data.repositories.autopsy_requests.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Get autopsy request
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_autopsy_request`'s authenticated-caller bar.
#[get("/api/surgical/autopsy/{id}")]
pub async fn get_autopsy_request(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.autopsy_requests.get_by_id(&id).await {
        Ok(Some(rec)) => match serde_json::from_value::<AutopsyRequest>(rec.data) {
            Ok(request) => HttpResponse::Ok().json(request),
            Err(_) => HttpResponse::InternalServerError().finish(),
        },
        Ok(None) => HttpResponse::NotFound().finish(),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

/// What `AutopsyPage` submits.
///
/// The handler took `clinical::AutopsyReport` -- ten required snake_case
/// fields -- and the page sends camelCase. Nothing matched, so every report was
/// refused with `missing field report_id`.
///
/// Only the two identifiers are named here. Everything else is `flatten`ed and
/// stored exactly as submitted, which is what the JSON-blob repository behind
/// this endpoint holds anyway: a pathologist's report is prose and findings,
/// and projecting it through a fixed struct could only lose some of it.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateAutopsyReportRequest {
    /// Ignored on create: the server assigns the id.
    #[serde(alias = "autopsyId", alias = "autopsy_id", alias = "reportId", default)]
    pub report_id: String,
    #[serde(alias = "patientId")]
    pub patient_id: String,
    #[serde(flatten)]
    pub rest: serde_json::Value,
}

/// Create autopsy report
#[post("/api/surgical/autopsy/report")]
pub async fn create_autopsy_report(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateAutopsyReportRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let mut report = req.into_inner();
    // Server-generated. The page numbered reports from the length of its own
    // list, so every session's first report was `AUT-001` and the second
    // clinician to file one wrote over, or collided with, the first.
    let id = format!("AUT-{}", uuid::Uuid::new_v4().simple());
    report.report_id = id.clone();

    if let Err(response) = crate::support::require_durable_audit(
        &data,
        crate::AccessLogEntry {
            access_id: uuid::Uuid::new_v4().to_string(),
            patient_id: report.patient_id.clone(),
            accessor_id: current_user_id,
            accessor_role: "doctor".to_string(),
            access_type: "create_autopsy_report".to_string(),
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

    let now = chrono::Utc::now();
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: report.patient_id.clone(),
        data: serde_json::to_value(&report).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };
    match data.repositories.autopsy_reports.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Get autopsy report
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_autopsy_report`'s authenticated-caller bar.
#[get("/api/surgical/autopsy/report/{id}")]
pub async fn get_autopsy_report(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.autopsy_reports.get_by_id(&id).await {
        // The stored document, not a `clinical::AutopsyReport` rebuilt from it.
        // Reconstructing through that type served only the fields it happens to
        // name and, once the writer stopped using it, nothing at all -- a
        // report that saved and could not be read back.
        Ok(Some(rec)) if rec.data.is_object() => HttpResponse::Ok().json(rec.data),
        Ok(Some(rec)) => {
            log::error!(
                "autopsy report {id} has no readable stored document: {:?}",
                rec.data
            );
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Stored autopsy report could not be read".to_string(),
                code: "RECORD_UNREADABLE".to_string(),
            })
        }
        Ok(None) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("autopsy report lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Patient-facing satisfaction survey submission.
///
/// The patient identity is derived from the authenticated account. The client
/// cannot submit feedback under another patient's identifier.
#[derive(Debug, Deserialize)]
pub struct SubmitSatisfactionSurveyRequest {
    pub visit_id: Option<String>,
    pub visit_date: String,
    pub department: String,
    pub survey_type: SurveyType,
    #[serde(default)]
    pub responses: Vec<SurveyResponse>,
    pub overall_rating: u8,
    pub nps_score: u8,
    pub comments: Option<String>,
    pub anonymous: bool,
    pub follow_up_requested: bool,
    pub contact_method: Option<String>,
}

fn satisfaction_storage_unavailable(operation: &str) -> HttpResponse {
    log::error!("Satisfaction survey repository failed during {operation}");
    HttpResponse::ServiceUnavailable().json(ErrorResponse {
        success: false,
        error: "Satisfaction survey storage is temporarily unavailable".to_string(),
        code: "STORAGE_UNAVAILABLE".to_string(),
    })
}

fn satisfaction_patient_id(caller: User) -> Result<String, HttpResponse> {
    caller.linked_patient_id.ok_or_else(|| {
        HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "A linked patient identity is required".to_string(),
            code: "PATIENT_CONTEXT_REQUIRED".to_string(),
        })
    })
}

fn build_satisfaction_survey(
    patient_id: String,
    input: SubmitSatisfactionSurveyRequest,
) -> Result<(String, JsonRecordEntity), HttpResponse> {
    if !(1..=5).contains(&input.overall_rating) || input.nps_score > 10 {
        return Err(HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Overall rating must be 1-5 and NPS score must be 0-10".to_string(),
            code: "INVALID_SURVEY_RATING".to_string(),
        }));
    }
    let survey_id = format!("SURV-{}", uuid::Uuid::new_v4());
    let now = Utc::now();
    let survey = PatientSatisfactionSurvey {
        survey_id: survey_id.clone(),
        patient_id: patient_id.clone(),
        visit_id: input.visit_id.unwrap_or_default(),
        visit_date: input.visit_date,
        department: input.department,
        survey_type: input.survey_type,
        responses: input.responses,
        overall_rating: input.overall_rating,
        nps_score: input.nps_score,
        comments: input.comments.filter(|value| !value.trim().is_empty()),
        submitted_at: now.timestamp(),
        anonymous: input.anonymous,
        follow_up_requested: input.follow_up_requested,
        contact_method: input.contact_method,
    };
    let data = serde_json::to_value(survey)
        .map_err(|_| satisfaction_storage_unavailable("serialization"))?;
    Ok((
        survey_id.clone(),
        JsonRecordEntity {
            id: survey_id,
            owner_id: patient_id,
            data,
            created_at: now,
            updated_at: now,
        },
    ))
}

#[post("/api/clinical/satisfaction-survey")]
pub async fn create_satisfaction_survey(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<SubmitSatisfactionSurveyRequest>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let patient_id = match satisfaction_patient_id(caller) {
        Ok(patient_id) => patient_id,
        Err(response) => return response,
    };
    let (survey_id, record) = match build_satisfaction_survey(patient_id, req.into_inner()) {
        Ok(result) => result,
        Err(response) => return response,
    };

    match data.repositories.satisfaction_surveys.create(record).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "id": survey_id,
            "success": true
        })),
        Err(_) => satisfaction_storage_unavailable("create"),
    }
}

/// Get satisfaction survey
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_satisfaction_survey`'s authenticated-caller bar.
#[get("/api/surgical/satisfaction-survey/{id}")]
pub async fn get_satisfaction_survey(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.satisfaction_surveys.get_by_id(&id).await {
        Ok(Some(record)) => {
            match serde_json::from_value::<PatientSatisfactionSurvey>(record.data) {
                Ok(survey) => HttpResponse::Ok().json(survey),
                Err(_) => satisfaction_storage_unavailable("deserialization"),
            }
        }
        Ok(None) => HttpResponse::NotFound().finish(),
        Err(_) => satisfaction_storage_unavailable("read"),
    }
}
