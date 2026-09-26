use super::*;

use crate::pagination::{decode_cursor, encode_cursor_ms, CursorQuery, Cursorable, MAX_LIMIT};

impl Cursorable for PatientProfile {
    fn cursor_ts(&self) -> i64 {
        self.last_updated.timestamp_millis()
    }
    fn cursor_id(&self) -> String {
        self.patient_id.clone()
    }
}

/// Why an existing patient row's encrypted profile could not be read.
///
/// `patient_entity_to_profile` collapses every cause into `None`, which is fine
/// for control flow but useless in a log. This distinguishes them so an
/// operator can tell a key-management problem (recoverable: load the right
/// `ENCRYPTION_KEYS`) from genuinely absent data.
fn unreadable_reason(
    entity: &crate::repositories::traits::PatientEntity,
    keyring: &crate::encryption_keyring::EncryptionKeyring,
) -> &'static str {
    if entity.profile_extras_encrypted.is_none() {
        "no encrypted profile blob stored on the row"
    } else if keyring.get(entity.key_version as u32).is_none() {
        "no encryption key held for the row's key_version"
    } else {
        "the profile blob did not decrypt or parse"
    }
}

/// One row of the patient roster, readable or not.
///
/// A patient whose PHI cannot be decrypted must still appear: the alternative
/// — silently dropping it — makes a record that exists indistinguishable from
/// one that was never created, which in a clinical roster is a safety problem,
/// not a cosmetic one. Unreadable rows expose only the id and an explicit
/// availability marker; no clear-text clinical columns enter the directory.
#[derive(Clone)]
struct RosterRow {
    ts: i64,
    id: String,
    value: serde_json::Value,
}

impl Cursorable for RosterRow {
    fn cursor_ts(&self) -> i64 {
        self.ts
    }
    fn cursor_id(&self) -> String {
        self.id.clone()
    }
}

/// A readable patient as served: the decrypted profile plus the columns the
/// row stores beside it in clear.
///
/// `wallet_address` is a column on the patient row, not part of the encrypted
/// profile, so serialising `PatientProfile` alone left it out: a patient whose
/// wallet was bound at registration read back as having none. The row is the
/// one source of truth for it, so it is added here rather than copied into
/// the blob, where the two could drift.
fn readable_patient_json(
    profile: &PatientProfile,
    entity: &crate::repositories::traits::PatientEntity,
) -> serde_json::Value {
    let mut value = serde_json::to_value(profile).unwrap_or(serde_json::Value::Null);
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "wallet_address".to_string(),
            serde_json::json!(entity.wallet_address),
        );
        object.insert(
            "content_available".to_string(),
            serde_json::Value::Bool(true),
        );
    }
    value
}

/// Directory rows contain identifiers needed to select a chart, never clinical data.
fn directory_patient_json(profile: &PatientProfile, facility: Option<String>) -> serde_json::Value {
    serde_json::json!({
        "patient_id": profile.patient_id,
        "full_name": profile.full_name,
        "date_of_birth": profile.date_of_birth,
        "facility": facility,
        "content_available": true,
    })
}

/// A minimal directory placeholder for a row whose encrypted profile failed.
fn unreadable_roster_row(entity: &crate::repositories::traits::PatientEntity) -> RosterRow {
    RosterRow {
        ts: entity.updated_at.timestamp_millis(),
        id: entity.id.clone(),
        value: serde_json::json!({
            "patient_id": entity.id,
            "full_name": "",
            "date_of_birth": "",
            "facility": null,
            "content_available": false,
            "content_unavailable_reason": "Profile unavailable",
        }),
    }
}

/// Persist one organisation-level event before releasing a directory page.
async fn audit_directory_search(
    data: &web::Data<AppState>,
    actor: &User,
    purpose: &str,
    result_count: u64,
) -> Result<(), String> {
    let facility = data
        .identity_contexts
        .facility_for_wallet(&actor.wallet_address);
    data.audit_outbox
        .record_durable(
            data.db_pool.as_ref(),
            "patient_directory_search".to_string(),
            "organisation".to_string(),
            facility.clone().unwrap_or_else(|| "unassigned".to_string()),
            serde_json::json!({
                "actor_id": actor.wallet_address,
                "actor_role": actor.role.to_string(),
                "facility": facility,
                "purpose": purpose,
                "result_count": result_count,
            }),
            Utc::now(),
        )
        .await
        .map(|_| ())
}

/// Get all registered patients (paginated)
/// Requires authentication: Only healthcare providers can list all patients
/// Query params: ?limit=20&cursor=<opaque>&q=<name-or-identifier>
///
/// `q` is evaluated server-side. Names use keyed whole-token blind indexes;
/// identifiers retain their existing lookup behavior. No plaintext name is
/// stored or returned solely to make search work.
#[get("/api/patients")]
pub async fn list_patients(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<CursorQuery>,
) -> impl Responder {
    // RBAC: Require authentication
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "Authentication required to list patients".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Only healthcare providers can list all patients
    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Only healthcare providers can list patients".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let purpose = http_req
        .headers()
        .get(crate::middleware::phi_access_audit::ACCESS_REASON_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| crate::middleware::phi_access_audit::normalise_access_reason(Some(value)))
        .filter(|value| value != crate::middleware::phi_access_audit::REASON_NOT_STATED);
    let Some(purpose) = purpose else {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "A directory search purpose is required".to_string(),
            code: "DIRECTORY_PURPOSE_REQUIRED".to_string(),
        });
    };

    let requested_query = query.q.as_deref().map(str::trim).filter(|q| !q.is_empty());
    let cursor = match query.cursor.as_deref() {
        Some(encoded) => match decode_cursor(encoded).and_then(|(ts, id)| {
            chrono::DateTime::<Utc>::from_timestamp_millis(ts).map(|at| (at, id))
        }) {
            Some(cursor) => Some(cursor),
            None => {
                return HttpResponse::BadRequest().json(ErrorResponse {
                    error: "Invalid patient roster cursor".to_string(),
                    code: "INVALID_CURSOR".to_string(),
                });
            }
        },
        None => None,
    };
    let limit = query.limit.unwrap_or(50).clamp(1, MAX_LIMIT) as u32;
    let repository_result = match requested_query {
        Some(search_query) => {
            data.repositories
                .patients
                .search_keyset(search_query, cursor, limit)
                .await
        }
        None => data.repositories.patients.list_keyset(cursor, limit).await,
    };
    let (entities, total) = match repository_result {
        Ok(result) => (result.items, result.total),
        Err(e) => {
            log::error!("Patient list failed: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Internal server error".to_string(),
                code: "REPO_ERROR".to_string(),
            });
        }
    };

    // Every row is represented. This used to `filter_map` the undecryptable
    // ones away, so the roster silently under-reported — 71 stored patients
    // were served as 3, with no error and no log line, and the response still
    // advertised the full `total`. A clinician could not tell "not registered"
    // from "we hold this patient but cannot read them".
    let mut unreadable = 0usize;
    let mut rows: Vec<RosterRow> = Vec::with_capacity(entities.len());
    for entity in &entities {
        match patient_entity_to_profile(entity, &data.encryption_keyring) {
            Some(profile) => {
                rows.push(RosterRow {
                    ts: entity.updated_at.timestamp_millis(),
                    id: profile.patient_id.clone(),
                    value: directory_patient_json(
                        &profile,
                        entity.registered_by.as_deref().and_then(|registrar| {
                            data.identity_contexts.facility_for_wallet(registrar)
                        }),
                    ),
                });
            }
            None => {
                let reason = unreadable_reason(entity, &data.encryption_keyring);
                log::error!(
                    "patient {} is stored but its profile is unreadable ({reason});                      listing it without PHI",
                    entity.id
                );
                unreadable += 1;
                rows.push(unreadable_roster_row(entity));
            }
        }
    }

    let next_cursor = if rows.len() == limit as usize {
        rows.last().map(|row| encode_cursor_ms(row.ts, &row.id))
    } else {
        None
    };
    let page: Vec<serde_json::Value> = rows.into_iter().map(|row| row.value).collect();

    if let Err(error) = audit_directory_search(&data, &current_user, &purpose, total).await {
        log::error!("Patient directory audit failed: {error}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            error: "Patient directory is temporarily unavailable".to_string(),
            code: "DIRECTORY_AUDIT_UNAVAILABLE".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": page,
        "next_cursor": next_cursor,
        "total": total,
        // Loud on purpose: a non-zero count here means PHI this deployment
        // stores cannot be decrypted with the keys it currently holds.
        "unreadable_count": unreadable
    }))
}

/// Get a single patient by ID
#[get("/api/patients/{patient_id}")]
pub async fn get_patient_by_id(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // RBAC: Check if caller can access patient records
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Patients can only view their own records
    // Check by linked_patient_id for wallet-linked users, or by wallet_address for legacy patients
    let is_own_record = current_user.linked_patient_id.as_ref() == Some(&patient_id)
        || current_user.wallet_address == patient_id;
    if current_user.role == Role::Patient && !is_own_record {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Patients can only view their own records".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // Via repository (was: in-memory data.patients HashMap); decrypt profile blob.
    match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(entity) => match patient_entity_to_profile(&entity, &data.encryption_keyring) {
            Some(profile) => HttpResponse::Ok().json(readable_patient_json(&profile, &entity)),
            // The row exists; its PHI just cannot be decrypted with the keys
            // this process holds. Reporting that as `PATIENT_NOT_FOUND` told
            // the caller the patient was never registered, which is false and
            // clinically misleading. Unlike the list — which must stay usable
            // and so degrades the row — there is nothing safe to return here,
            // so this fails loudly instead.
            None => {
                let reason = unreadable_reason(&entity, &data.encryption_keyring);
                log::error!("patient profile is unreadable ({reason})");
                HttpResponse::InternalServerError().json(ErrorResponse {
                    error: format!(
                        "Patient {patient_id} is registered but their stored record could not be decrypted"
                    ),
                    code: "PATIENT_PROFILE_UNREADABLE".to_string(),
                })
            }
        },
        Err(_) => HttpResponse::NotFound().json(ErrorResponse {
            error: format!("Patient {} not found", patient_id),
            code: "PATIENT_NOT_FOUND".to_string(),
        }),
    }
}

/// Update patient request body
#[derive(Debug, Deserialize)]
pub struct UpdatePatientRequest {
    pub allergies: Option<Vec<String>>,
    pub current_medications: Option<Vec<String>>,
    pub chronic_conditions: Option<Vec<String>>,
    pub organ_donor: Option<bool>,
    pub dnr_status: Option<bool>,
    /// Mark/clear the DNR advance directive as verified. When `Some(true)`, the
    /// acting provider is recorded as `dnr_verified_by` with the current time as
    /// `dnr_verified_at`. `Some(false)` clears the verification metadata.
    pub dnr_verified: Option<bool>,
    /// Optional reference to the advance-directive document backing the DNR.
    pub dnr_document_ref: Option<String>,
    pub emergency_contact_name: Option<String>,
    pub emergency_contact_phone: Option<String>,
    pub emergency_contact_relationship: Option<String>,
}

/// Update patient response
#[derive(Debug, Serialize)]
pub struct UpdatePatientResponse {
    pub success: bool,
    pub patient_id: String,
    pub updated_by: String,
    pub message: String,
}

/// Update a patient's medical information (Doctor/Nurse only)
#[put("/api/patients/{patient_id}")]
pub async fn update_patient(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<UpdatePatientRequest>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // RBAC: Check if caller can edit medical records
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error:
                    "Missing X-User-Id header. Only doctors and nurses can update patient records."
                        .to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // CRITICAL: Only Doctor, Nurse, or Admin can edit records
    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: format!(
                "Only doctors and nurses can update medical records. Your role: {}",
                current_user.role
            ),
            code: "NOT_HEALTHCARE_PROVIDER".to_string(),
        });
    }

    // Update patient record via repository (was: in-memory data.patients HashMap)
    let entity = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(e) => e,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    };
    let mut patient = match patient_entity_to_profile(&entity, &data.encryption_keyring) {
        Some(p) => p,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: "Patient not found".to_string(),
                code: "PATIENT_NOT_FOUND".to_string(),
            });
        }
    };

    // Update fields if provided
    if let Some(allergies) = &req.allergies {
        // Convert string allergies to Allergy structs with Mild severity
        patient.emergency_info.allergies = allergies
            .iter()
            .map(|name| Allergy {
                name: name.clone(),
                severity: AllergySeverity::Mild,
                reaction: None,
                verified_at: Some(Utc::now()),
            })
            .collect();
    }
    if let Some(meds) = &req.current_medications {
        patient.emergency_info.current_medications = meds.clone();
    }
    if let Some(conditions) = &req.chronic_conditions {
        patient.emergency_info.chronic_conditions = conditions.clone();
    }
    if let Some(organ_donor) = req.organ_donor {
        patient.emergency_info.organ_donor = organ_donor;
    }
    if let Some(dnr) = req.dnr_status {
        patient.emergency_info.dnr_status = dnr;
    }
    // DNR verification: only a provider who can edit records (gated above) may
    // attest to the advance directive. Bind the verifier to the authenticated
    // caller — never trust a client-supplied "verified_by".
    if let Some(verified) = req.dnr_verified {
        if verified {
            patient.emergency_info.dnr_verified_by = Some(current_user_id.clone());
            patient.emergency_info.dnr_verified_at = Some(Utc::now());
        } else {
            patient.emergency_info.dnr_verified_by = None;
            patient.emergency_info.dnr_verified_at = None;
        }
    }
    if let Some(doc_ref) = &req.dnr_document_ref {
        patient.emergency_info.dnr_document_ref = Some(doc_ref.clone());
    }

    // Update emergency contact if any field provided
    if req.emergency_contact_name.is_some()
        || req.emergency_contact_phone.is_some()
        || req.emergency_contact_relationship.is_some()
    {
        if let Some(contact) = patient.emergency_info.emergency_contacts.get_mut(0) {
            if let Some(name) = &req.emergency_contact_name {
                contact.name = name.clone();
            }
            if let Some(phone) = &req.emergency_contact_phone {
                contact.phone = phone.clone();
            }
            if let Some(rel) = &req.emergency_contact_relationship {
                contact.relationship = rel.clone();
            }
        }
    }

    patient.emergency_info.last_updated = Utc::now();
    patient.last_updated = Utc::now();

    // Persist via repository, preserving entity-only fields not in PatientProfile.
    let mut updated_entity = patient_profile_to_entity(&patient, &data.encryption_keyring);
    updated_entity.health_id = entity.health_id.clone();
    updated_entity.gender = entity.gender.clone();
    updated_entity.wallet_address = entity.wallet_address.clone();
    updated_entity.is_verified = entity.is_verified;
    updated_entity.registered_by = entity.registered_by.clone();
    updated_entity.primary_provider_id = entity.primary_provider_id.clone();
    updated_entity.created_at = entity.created_at;
    if let Err(e) = data.repositories.patients.update(updated_entity).await {
        log::error!("Patient update persistence failed: {}", e);
        return HttpResponse::InternalServerError().json(ErrorResponse {
            error: "Failed to persist patient update".to_string(),
            code: "REPO_ERROR".to_string(),
        });
    }

    log::info!(
        "Patient {} updated by provider {}",
        patient_id,
        current_user_id
    );

    HttpResponse::Ok().json(UpdatePatientResponse {
        success: true,
        patient_id,
        updated_by: current_user_id,
        message: "Patient record updated successfully".to_string(),
    })
}
