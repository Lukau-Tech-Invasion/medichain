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
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let mut record = req.into_inner();
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
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let history = req.into_inner();
    let id = history.patient_id.clone();
    // Persisted through the repository, so it survives a restart. Keyed by
    // patient: a family history is one evolving record per patient rather than
    // a series, so a re-post replaces it.
    let now = chrono::Utc::now();
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
    // Registered caller, NOT clinical-staff-only: a patient must be able to
    // read their own record here. The staff gate rejected them with
    // INSUFFICIENT_ROLE before the self-or-provider check below could run.
    if let Err(resp) = crate::support::require_registered_caller(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
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

/// Create electronic prescription
#[post("/api/surgical/e-prescription")]
pub async fn create_e_prescription(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<ElectronicPrescription>,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    let current_user_id = caller.wallet_address.clone();

    let mut prescription = req.into_inner();

    // The whole `ElectronicPrescription` used to be persisted verbatim from the
    // request body, so the client chose its own `rx_id` (letting one call
    // overwrite an existing prescription) and named its own `prescriber`
    // (attributing a prescription to another clinician, while the access log
    // recorded the real caller — the record and the audit trail disagreed by
    // construction). See docs/WORKFLOW_AUDIT.md, WF-020.
    //
    // Both are now server-derived. `PrescriberInfo` identifies a clinician by
    // name and licence rather than wallet, so those are stamped from the
    // caller's own account record.
    prescription.rx_id = format!("RX-{}", uuid::Uuid::new_v4());
    prescription.prescriber.name = caller.name.clone();
    if let Some(licence) = caller.license_number.clone() {
        prescription.prescriber.state_license = licence;
    }
    let id = prescription.rx_id.clone();

    // Log access
    if let Err(response) = crate::support::require_durable_audit(
        &data,
        crate::AccessLogEntry {
            access_id: uuid::Uuid::new_v4().to_string(),
            patient_id: prescription.patient_id.clone(),
            accessor_id: current_user_id,
            // Was the literal "doctor" regardless of who called.
            accessor_role: caller.role.to_string(),
            access_type: "create_e_prescription".to_string(),
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
        owner_id: prescription.patient_id.clone(),
        data: serde_json::to_value(&prescription).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };
    match data
        .repositories
        .e_prescription_records
        .create(entity)
        .await
    {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => {
            log::error!("e-prescription could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "E-prescription could not be stored".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Get electronic prescription
///
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_e_prescription`'s authenticated-caller bar.
#[get("/api/surgical/e-prescription/{id}")]
pub async fn get_e_prescription(
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
        .e_prescription_records
        .get_by_id(&id)
        .await
    {
        Ok(Some(rec)) => match serde_json::from_value::<ElectronicPrescription>(rec.data) {
            Ok(prescription) => HttpResponse::Ok().json(prescription),
            Err(e) => {
                // A partial e-prescription is more dangerous than none.
                log::error!("e-prescription stored payload is unreadable: {e}");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Stored e-prescription could not be read".to_string(),
                    code: "RECORD_UNREADABLE".to_string(),
                })
            }
        },
        Ok(None) => HttpResponse::NotFound().finish(),
        Err(e) => {
            log::error!("e-prescription lookup failed: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

/// Create appointment
#[post("/api/surgical/appointment")]
pub async fn create_appointment(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<Appointment>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let appointment = req.into_inner();
    let id = appointment.appointment_id.clone();

    let entity: crate::repositories::traits::AppointmentEntity = appointment.into();
    match data.repositories.appointments.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({ "id": id, "success": true })),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e.to_string(),
            code: "DATABASE_ERROR".to_string(),
        }),
    }
}

/// Get surgical appointment.
///
/// This explicit handler name prevents it from colliding with the appointment
/// booking endpoint while preserving the established HTTP route.
/// HZ-009 audit: took an unused `_http_req` with no authentication at all.
/// Now matches `create_appointment`'s authenticated-caller bar.
#[get("/api/surgical/appointment/{id}")]
pub async fn get_surgical_appointment(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }
    let id = path.into_inner();
    match data.repositories.appointments.get_by_id(&id).await {
        Ok(entity) => {
            let appointment: Appointment = entity.into();
            HttpResponse::Ok().json(appointment)
        }
        Err(_) => HttpResponse::NotFound().finish(),
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

    let request = req.into_inner();
    let id = request.request_id.clone();

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

/// Create autopsy report
#[post("/api/surgical/autopsy/report")]
pub async fn create_autopsy_report(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<AutopsyReport>,
) -> impl Responder {
    let current_user_id = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let report = req.into_inner();
    let id = report.report_id.clone();

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
        Ok(Some(rec)) => match serde_json::from_value::<AutopsyReport>(rec.data) {
            Ok(report) => HttpResponse::Ok().json(report),
            Err(_) => HttpResponse::InternalServerError().finish(),
        },
        Ok(None) => HttpResponse::NotFound().finish(),
        Err(_) => HttpResponse::InternalServerError().finish(),
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
