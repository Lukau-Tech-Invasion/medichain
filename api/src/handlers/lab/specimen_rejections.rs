//! Specimen rejection, the recollection it triggers, and notifying the ordering provider.

use crate::clinical_endpoints::*;

/// The categories `specimen_rejections.rejection_category` accepts.
const REJECTION_CATEGORIES: [&str; 6] = [
    "collection_error",
    "transport_error",
    "labeling_error",
    "specimen_quality",
    "container_issue",
    "other",
];

/// What a laboratory records when it refuses a specimen.
///
/// Deliberately not the patient, the author or the notification state. The
/// handler used to read all of them from the body: the patient a rejection was
/// filed against could differ from the specimen's own, `rejected_by` was
/// whatever the caller typed (and blank when they typed nothing), and a body
/// could say the ordering provider had already been notified -- which the
/// notify endpoint then refused to do, as ALREADY_NOTIFIED. The patient comes
/// from the specimen, the author from the session, and notification from
/// `POST /api/clinical/specimen-rejection/{id}/notify`.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateSpecimenRejectionRequest {
    pub specimen_id: String,
    pub rejection_reason: String,
    pub rejection_category: String,
    #[serde(default)]
    pub detailed_notes: Option<String>,
    /// Whether another sample is needed. Asking for one is its own action
    /// (`/recollect`); this records that the laboratory expects to.
    #[serde(default)]
    pub recollection_required: bool,
}

/// Reject a collected specimen.
#[post("/api/clinical/specimen-rejection")]
pub async fn create_specimen_rejection(
    data: web::Data<AppState>,
    req: web::Json<CreateSpecimenRejectionRequest>,
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

    if !current_user.role.can_perform_laboratory_work() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let request = req.into_inner();
    let specimen_id = request.specimen_id.trim().to_string();
    let reason = request.rejection_reason.trim().to_string();
    if specimen_id.is_empty() || reason.is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "A rejection names the specimen it rejects and why".to_string(),
            code: "MISSING_FIELD".to_string(),
        });
    }
    if !REJECTION_CATEGORIES.contains(&request.rejection_category.as_str()) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: format!(
                "rejection_category must be one of: {}",
                REJECTION_CATEGORIES.join(", ")
            ),
            code: "INVALID_CATEGORY".to_string(),
        });
    }

    let specimen = match data
        .repositories
        .specimen_collections
        .get_by_id(&specimen_id)
        .await
    {
        Ok(specimen) => specimen,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: format!(
                    "Specimen '{specimen_id}' has not been collected, so it cannot be rejected"
                ),
                code: "SPECIMEN_NOT_FOUND".to_string(),
            })
        }
    };

    // Server-generated: a client-supplied id lets one submission overwrite another.
    let rejection_id = format!("REJ-{}", uuid::Uuid::new_v4().simple());
    let now = chrono::Utc::now();
    let entity = SpecimenRejectionEntity {
        id: rejection_id.clone(),
        specimen_id,
        patient_id: specimen.patient_id,
        rejection_reason: reason,
        rejection_category: request.rejection_category.clone(),
        detailed_notes: request
            .detailed_notes
            .as_deref()
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .map(str::to_string),
        rejected_by: current_user.id.clone(),
        rejected_at: now,
        recollection_required: request.recollection_required,
        recollection_scheduled: None,
        notified_ordering_provider: false,
        notification_sent_at: None,
        created_at: now,
        data: serde_json::to_value(&request).unwrap_or_default(),
    };

    match data.repositories.specimen_rejections.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "rejection_id": rejection_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => {
            log::error!("specimen rejection could not be stored: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                error: "The rejection could not be recorded".to_string(),
                code: "INTERNAL_ERROR".to_string(),
            })
        }
    }
}

/// Tell the ordering provider that their specimen was rejected.
///
/// # Why this endpoint exists
///
/// The Laboratory Dashboard has carried a "Notify" button on every rejected
/// specimen since that panel was built, with no handler and nothing to call.
/// `SpecimenRejectionEntity` has carried `notified_ordering_provider` and
/// `notification_sent_at` for just as long, and nothing set them.
///
/// Nothing clinical had to be invented to finish it. Every piece already
/// existed:
///
///   * **Who to tell** is determined by the data, not by a policy choice.
///     `rejection.specimen_id` -> `SpecimenCollectionEntity.submission_id` ->
///     `LabSubmissionEntity.ordering_provider_id`. `POST /api/clinical/specimen`
///     writes both halves of that chain in one request, so it is always
///     present for a specimen this system collected.
///   * **How to tell them** is `notifications::notify_critical_alert`, which
///     already exists to push an alert to a *provider* about a *patient*.
///   * **What "told" means afterwards** is the two fields above.
///
/// # Role
///
/// The same set `/api/lab/submit` accepts: LabTechnician, Doctor, Nurse,
/// Admin. Deliberately not `can_edit_medical_records()`, which the sibling
/// rejection endpoints use — that excludes LabTechnician, and this control
/// lives on the Laboratory Dashboard, so the role that sees it could never use
/// it. Widening who may *reject* a specimen would be a clinical governance
/// decision; reusing an existing lab-domain predicate for who may pass on the
/// news is not.
///
/// # Exactly once
///
/// The transition is guarded inside the write, so two people pressing Notify
/// at the same moment send one notification between them. A repeat press is
/// answered `ALREADY_NOTIFIED` rather than silently sending again — a provider
/// receiving the same rejection twice has to work out whether it is one
/// specimen or two.
// ============================================================================
// Specimen recollection (SCR-009b)
// ============================================================================
//
// A rejected specimen stays rejected. When the laboratory needs another sample
// that is a NEW act, recorded in `specimen_recollection_requests` and pointing
// back at the rejection it answers, so the chain
//
//     rejected specimen -> recollection request -> replacement specimen
//
// stays navigable and the original failure remains permanently visible. Nothing
// here edits the rejection.
//
// Notify and Recollect stay separate. Telling the ordering provider a specimen
// failed and asking the patient to attend again are different acts, aimed at
// different people, with different consequences.

#[derive(Debug, serde::Deserialize)]
pub struct RequestRecollectionBody {
    /// Why another sample is needed. Free text, recorded verbatim.
    pub reason: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct CompleteRecollectionBody {
    /// The specimen that replaced the rejected one. A different collection, not
    /// an edit of the original.
    pub replacement_specimen_id: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct CancelRecollectionBody {
    pub reason: String,
}

/// Who may act on a recollection.
///
/// The same set the Notify workflow uses: the laboratory that rejected the
/// specimen, the clinicians responsible for the patient, and administrators.
fn may_handle_recollection(role: &crate::Role) -> bool {
    matches!(
        role,
        crate::Role::LabTechnician | crate::Role::Doctor | crate::Role::Nurse | crate::Role::Admin
    )
}

fn recollection_role_refused(role: &crate::Role) -> HttpResponse {
    HttpResponse::Forbidden().json(ErrorResponse {
        error: format!(
            "Role {role} cannot act on a specimen recollection. Required: LabTechnician, Doctor, Nurse, or Admin"
        ),
        code: "INSUFFICIENT_ROLE".to_string(),
    })
}

/// Writes the audit entry for a recollection transition.
///
/// An obligation, not a side effect -- the same stance the Notify handler
/// takes. Asking a patient to give another sample is a clinical instruction,
/// and one nobody can attribute afterwards is not one that happened.
async fn audit_recollection(
    data: &web::Data<AppState>,
    patient_id: &str,
    user: &crate::User,
    action: &str,
    at: chrono::DateTime<Utc>,
) -> Result<(), HttpResponse> {
    data.repositories
        .access_logs
        .create(
            AccessLogEntry {
                access_id: crate::middleware::secure_tokens::generate_access_id(),
                patient_id: patient_id.to_string(),
                accessor_id: user.id.clone(),
                accessor_role: user.role.to_string(),
                access_type: action.to_string(),
                location: None,
                timestamp: at,
                emergency: false,
            }
            .into(),
        )
        .await
        .map_err(|e| {
            log::error!("Recollection audit failed ({action}): {e}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The recollection could not be audited".to_string(),
                code: "AUDIT_UNAVAILABLE".to_string(),
            })
        })?;
    Ok(())
}

/// Request another sample after a rejection.
#[post("/api/clinical/specimen-rejection/{rejection_id}/recollect")]
pub async fn request_specimen_recollection(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<RequestRecollectionBody>,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    if !may_handle_recollection(&current_user.role) {
        return recollection_role_refused(&current_user.role);
    }

    let rejection_id = path.into_inner();
    let rejection = match data
        .repositories
        .specimen_rejections
        .get_by_id(&rejection_id)
        .await
    {
        Ok(r) => r,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: "Specimen rejection not found".to_string(),
                code: "REJECTION_NOT_FOUND".to_string(),
            })
        }
    };

    if body.reason.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "A reason is required to ask a patient for another sample".to_string(),
            code: "REASON_REQUIRED".to_string(),
        });
    }

    let now = Utc::now();
    // Best-effort: a recollection is still worth recording for a specimen whose
    // ordering provider cannot be resolved. Notify is the workflow that refuses
    // in that case, because a notification with no recipient is nothing.
    let ordering_provider = resolve_ordering_provider(&data, &rejection.specimen_id).await;

    let request = crate::repositories::traits::SpecimenRecollectionRequestEntity {
        id: format!("RECOL-{}", uuid::Uuid::new_v4()),
        rejection_id: rejection_id.clone(),
        original_specimen_id: rejection.specimen_id.clone(),
        patient_id: rejection.patient_id.clone(),
        ordering_provider_id: ordering_provider,
        requested_by: current_user.id.clone(),
        reason: body.reason.trim().to_string(),
        status: "requested".to_string(),
        requested_at: now,
        replacement_specimen_id: None,
        completed_at: None,
        cancelled_at: None,
        cancellation_reason: None,
        created_at: now,
        updated_at: now,
    };

    let opened = match data.repositories.specimen_recollections.open(request).await {
        Ok(Some(r)) => r,
        // Two technicians looking at the same rejected specimen will both press
        // this. The guard is a partial unique index, so the loser is told the
        // truth rather than the patient being asked twice.
        Ok(None) => {
            return HttpResponse::Conflict().json(ErrorResponse {
                error: "A recollection is already open for this rejection".to_string(),
                code: "RECOLLECTION_ALREADY_OPEN".to_string(),
            })
        }
        Err(e) => {
            log::error!("Recollection open failed for {rejection_id}: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The recollection request could not be recorded".to_string(),
                code: "RECOLLECTION_UNAVAILABLE".to_string(),
            });
        }
    };

    if let Err(resp) = audit_recollection(
        &data,
        &opened.patient_id,
        &current_user,
        "specimen_recollection_requested",
        now,
    )
    .await
    {
        return resp;
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "recollection": opened,
    }))
}

/// Record the replacement specimen and close the request.
#[post("/api/clinical/specimen-recollection/{recollection_id}/complete")]
pub async fn complete_specimen_recollection(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<CompleteRecollectionBody>,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    if !may_handle_recollection(&current_user.role) {
        return recollection_role_refused(&current_user.role);
    }

    let recollection_id = path.into_inner();
    let replacement = body.replacement_specimen_id.trim().to_string();
    if replacement.is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "The replacement specimen must be named".to_string(),
            code: "REPLACEMENT_REQUIRED".to_string(),
        });
    }

    // The replacement must be a different specimen. Naming the rejected one
    // would make the lineage a loop and quietly assert that the failed sample
    // replaced itself.
    let existing = match data
        .repositories
        .specimen_recollections
        .get_by_id(&recollection_id)
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: "Recollection request not found".to_string(),
                code: "RECOLLECTION_NOT_FOUND".to_string(),
            })
        }
        Err(e) => {
            log::error!("Recollection lookup failed for {recollection_id}: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The recollection could not be read".to_string(),
                code: "RECOLLECTION_UNAVAILABLE".to_string(),
            });
        }
    };
    if replacement == existing.original_specimen_id {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "The replacement cannot be the specimen that was rejected".to_string(),
            code: "REPLACEMENT_IS_ORIGINAL".to_string(),
        });
    }

    let now = Utc::now();
    let completed = match data
        .repositories
        .specimen_recollections
        .complete(&recollection_id, &replacement, now)
        .await
    {
        Ok(Some(r)) => r,
        // Guarded inside the write, so a retry cannot overwrite the first
        // replacement or revive a cancelled request.
        Ok(None) => {
            return HttpResponse::Conflict().json(ErrorResponse {
                error: "This recollection is no longer open".to_string(),
                code: "RECOLLECTION_NOT_OPEN".to_string(),
            })
        }
        Err(e) => {
            log::error!("Recollection completion failed for {recollection_id}: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The replacement could not be recorded".to_string(),
                code: "RECOLLECTION_UNAVAILABLE".to_string(),
            });
        }
    };

    if let Err(resp) = audit_recollection(
        &data,
        &completed.patient_id,
        &current_user,
        "specimen_recollection_completed",
        now,
    )
    .await
    {
        return resp;
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "recollection": completed,
    }))
}

/// Stop asking for another sample.
#[post("/api/clinical/specimen-recollection/{recollection_id}/cancel")]
pub async fn cancel_specimen_recollection(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<CancelRecollectionBody>,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    if !may_handle_recollection(&current_user.role) {
        return recollection_role_refused(&current_user.role);
    }
    if body.reason.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "A reason is required to cancel a recollection".to_string(),
            code: "REASON_REQUIRED".to_string(),
        });
    }

    let recollection_id = path.into_inner();
    let now = Utc::now();
    let cancelled = match data
        .repositories
        .specimen_recollections
        .cancel(&recollection_id, body.reason.trim(), now)
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) => {
            return HttpResponse::Conflict().json(ErrorResponse {
                error: "This recollection is no longer open".to_string(),
                code: "RECOLLECTION_NOT_OPEN".to_string(),
            })
        }
        Err(e) => {
            log::error!("Recollection cancellation failed for {recollection_id}: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The cancellation could not be recorded".to_string(),
                code: "RECOLLECTION_UNAVAILABLE".to_string(),
            });
        }
    };

    if let Err(resp) = audit_recollection(
        &data,
        &cancelled.patient_id,
        &current_user,
        "specimen_recollection_cancelled",
        now,
    )
    .await
    {
        return resp;
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "recollection": cancelled,
    }))
}

/// Every recollection ever raised for a rejection, newest first.
///
/// Cancelled and completed requests are included deliberately: the point of the
/// lineage is that the whole history stays visible, including attempts that
/// were abandoned.
#[get("/api/clinical/specimen-rejection/{rejection_id}/recollections")]
pub async fn list_recollections_for_rejection(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    if !may_handle_recollection(&current_user.role) {
        return recollection_role_refused(&current_user.role);
    }
    match data
        .repositories
        .specimen_recollections
        .list_for_rejection(&path.into_inner())
        .await
    {
        Ok(rows) => HttpResponse::Ok().json(serde_json::json!({ "recollections": rows })),
        Err(e) => {
            log::error!("Recollection list failed: {e}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "Recollections could not be read".to_string(),
                code: "RECOLLECTION_UNAVAILABLE".to_string(),
            })
        }
    }
}

#[post("/api/clinical/specimen-rejection/{rejection_id}/notify")]
pub async fn notify_rejection_ordering_provider(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let rejection_id = path.into_inner();

    let current_user = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    let may_notify = matches!(
        current_user.role,
        crate::Role::LabTechnician | crate::Role::Doctor | crate::Role::Nurse | crate::Role::Admin
    );
    if !may_notify {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: format!(
                "Role '{}' cannot notify an ordering provider. Required: LabTechnician, Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let rejection = match data
        .repositories
        .specimen_rejections
        .get_by_id(&rejection_id)
        .await
    {
        Ok(r) => r,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: "Specimen rejection not found".to_string(),
                code: "REJECTION_NOT_FOUND".to_string(),
            })
        }
    };

    // Resolve the ordering provider before committing anything. A notification
    // with nobody to send it to is not a notification, and marking the
    // rejection "notified" in that case would be a lie the panel then repeats.
    let ordering_provider =
        match resolve_ordering_provider(&data, &rejection.specimen_id).await {
            Some(p) => p,
            None => return HttpResponse::UnprocessableEntity().json(ErrorResponse {
                error:
                    "This specimen has no ordering provider on record, so there is nobody to notify"
                        .to_string(),
                code: "NO_ORDERING_PROVIDER".to_string(),
            }),
        };

    let now = Utc::now();
    let committed = match data
        .repositories
        .specimen_rejections
        .mark_provider_notified(&rejection_id, now)
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) => {
            return HttpResponse::Conflict().json(ErrorResponse {
                error: "The ordering provider has already been notified about this rejection"
                    .to_string(),
                code: "ALREADY_NOTIFIED".to_string(),
            })
        }
        Err(e) => {
            log::error!("Rejection notification transition failed for {rejection_id}: {e}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The notification could not be recorded".to_string(),
                code: "NOTIFICATION_UNAVAILABLE".to_string(),
            });
        }
    };

    // Audit before delivery, and treat it as an obligation. Telling a clinician
    // their specimen was rejected is a clinical communication; one nobody can
    // later attribute is not one that happened.
    if let Err(response) = crate::support::require_durable_audit(
        &data,
        AccessLogEntry {
            access_id: crate::middleware::secure_tokens::generate_access_id(),
            patient_id: rejection.patient_id.clone(),
            accessor_id: current_user.id.clone(),
            accessor_role: current_user.role.to_string(),
            access_type: "specimen_rejection_notified".to_string(),
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

    // Delivery last, and best-effort. The record says the provider was told
    // and the audit says who told them; a push gateway outage must not undo a
    // transition the lab has already acted on, and re-pressing Notify would
    // then be refused as a duplicate. Push failure is logged inside
    // `send_push_to_user`.
    {
        let repos = data.repositories.clone();
        let provider = ordering_provider.clone();
        let patient = rejection.patient_id.clone();
        let reason = rejection.rejection_reason.clone();
        tokio::spawn(async move {
            crate::notifications::notify_critical_alert(
                &repos,
                &provider,
                &patient,
                &format!("Specimen rejected: {reason}. A recollection may be required."),
            )
            .await;
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "rejection_id": rejection_id,
        "ordering_provider_id": ordering_provider,
        "notified_at": committed.notification_sent_at,
    }))
}

/// Who ordered the specimen this rejection refers to.
///
/// `SpecimenRejectionEntity` records the specimen, not the order, so the
/// provider is reached through the collection that produced it:
/// specimen -> submission -> ordering provider. Returns `None` when any link
/// is missing, which the caller treats as "nobody to notify" rather than
/// guessing.
async fn resolve_ordering_provider(
    data: &web::Data<crate::AppState>,
    specimen_id: &str,
) -> Option<String> {
    let collection = data
        .repositories
        .specimen_collections
        .get_by_id(specimen_id)
        .await
        .ok()?;

    let submission = data
        .repositories
        .lab_submissions
        .get_by_id(&collection.submission_id)
        .await
        .ok()?;

    let provider = submission.ordering_provider_id;
    if provider.trim().is_empty() {
        return None;
    }
    Some(provider)
}

#[get("/api/clinical/specimen-rejection/{rejection_id}")]
pub async fn get_specimen_rejection(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let rejection_id = path.into_inner();

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
        .specimen_rejections
        .get_by_id(&rejection_id)
        .await
    {
        // Serialise the ENTITY, not `entity.data`.
        //
        // `SpecimenRejectionEntity.data` is `#[sqlx(skip)]`, so on PostgreSQL it
        // is always `null` -- every rejection read returned a bare `null` body
        // with a 200, which reads as "no such rejection" to any caller that
        // checks the payload rather than the status. The typed columns carry the
        // record; `data` is a memory-backend convenience.
        //
        // The Laboratory Dashboard had the identical defect for its rejection
        // panel. Same field, same cause.
        Ok(entity) => HttpResponse::Ok().json(entity),
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            error: "Specimen rejection not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

#[cfg(test)]
mod rejection_notification_tests {
    use super::*;
    use actix_web::{test, App};

    fn user(user_id: &str, role: crate::Role) -> crate::User {
        crate::User {
            id: user_id.to_string(),
            username: None,
            name: format!("Test {user_id}"),
            role,
            created_at: Utc::now(),
            created_by: None,
            linked_patient_id: None,
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        }
    }

    /// A rejection whose specimen traces back to an ordering provider, which is
    /// the only case where there is somebody to notify.
    async fn state_with_chain(link_order: bool) -> crate::AppState {
        let state = crate::AppState::new();
        for (w, r) in [
            ("lab_tech", crate::Role::LabTechnician),
            ("pharm", crate::Role::Pharmacist),
        ] {
            state
                .users
                .write()
                .unwrap()
                .insert(w.to_string(), user(w, r));
        }

        let now = Utc::now();

        if link_order {
            state
                .repositories
                .lab_submissions
                .create(crate::repositories::traits::LabSubmissionEntity {
                    id: "SUB-1".to_string(),
                    patient_id: "PAT-N1".to_string(),
                    ordering_provider_id: "doctor_orderer".to_string(),
                    order_date: now,
                    priority: "routine".to_string(),
                    status: "collected".to_string(),
                    tests_ordered: serde_json::json!(["FBC"]),
                    clinical_notes: None,
                    diagnosis_codes: None,
                    fasting_required: false,
                    collection_instructions: None,
                    expected_completion: None,
                    created_at: now,
                    updated_at: now,
                })
                .await
                .expect("seed lab order");

            state
                .repositories
                .specimen_collections
                .create(crate::repositories::traits::SpecimenCollectionEntity {
                    id: "SPC-N1".to_string(),
                    patient_id: "PAT-N1".to_string(),
                    submission_id: "SUB-1".to_string(),
                    specimen_type: "blood".to_string(),
                    collection_site: None,
                    collection_method: None,
                    collector_id: "lab_tech".to_string(),
                    collected_at: now,
                    received_at: None,
                    received_by: None,
                    container_type: None,
                    volume_ml: None,
                    temperature_c: None,
                    condition: None,
                    barcode: None,
                    storage_location: None,
                    chain_of_custody: None,
                    notes: None,
                    created_at: now,
                    updated_at: now,
                    data: serde_json::Value::Null,
                })
                .await
                .expect("seed specimen collection");
        }

        state
            .repositories
            .specimen_rejections
            .create(crate::repositories::traits::SpecimenRejectionEntity {
                id: "REJ-N1".to_string(),
                specimen_id: "SPC-N1".to_string(),
                patient_id: "PAT-N1".to_string(),
                rejection_reason: "Haemolysed sample".to_string(),
                rejection_category: "collection_error".to_string(),
                detailed_notes: None,
                rejected_by: "lab_tech".to_string(),
                rejected_at: now,
                recollection_required: false,
                recollection_scheduled: None,
                notified_ordering_provider: false,
                notification_sent_at: None,
                created_at: now,
                data: serde_json::Value::Null,
            })
            .await
            .expect("seed rejection");

        state
    }

    fn notify_request(rejection_id: &str, actor: &str) -> test::TestRequest {
        test::TestRequest::post()
            .uri(&format!(
                "/api/clinical/specimen-rejection/{rejection_id}/notify"
            ))
            .insert_header(crate::test_fixtures::as_user(actor))
    }

    /// The whole point: the lab tells whoever ordered the specimen, and the
    /// record says so afterwards.
    #[actix_web::test]
    async fn notifying_records_the_provider_and_the_time() {
        let state = state_with_chain(true).await;
        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(notify_rejection_ordering_provider),
        )
        .await;

        let resp =
            test::call_service(&app, notify_request("REJ-N1", "lab_tech").to_request()).await;
        assert_eq!(resp.status(), 200);

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(
            body["ordering_provider_id"], "doctor_orderer",
            "the provider is resolved through specimen -> submission, got {body}"
        );

        let stored = app_state
            .repositories
            .specimen_rejections
            .get_by_id("REJ-N1")
            .await
            .expect("rejection still present");
        assert!(stored.notified_ordering_provider);
        assert!(stored.notification_sent_at.is_some());
    }

    /// Exactly once. A provider receiving the same rejection twice has to work
    /// out whether it is one specimen or two.
    #[actix_web::test]
    async fn a_second_notification_is_refused() {
        let state = state_with_chain(true).await;
        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(notify_rejection_ordering_provider),
        )
        .await;

        let first =
            test::call_service(&app, notify_request("REJ-N1", "lab_tech").to_request()).await;
        assert_eq!(first.status(), 200);

        let second =
            test::call_service(&app, notify_request("REJ-N1", "lab_tech").to_request()).await;
        assert_eq!(second.status(), 409);
        let body: serde_json::Value = test::read_body_json(second).await;
        assert_eq!(body["error"]["code"], "ALREADY_NOTIFIED");
    }

    /// No order, nobody to tell — and crucially the rejection must NOT be
    /// marked notified, or the panel would repeat a lie every time it loads.
    #[actix_web::test]
    async fn a_specimen_with_no_order_is_refused_and_left_unmarked() {
        let state = state_with_chain(false).await;
        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(notify_rejection_ordering_provider),
        )
        .await;

        let resp =
            test::call_service(&app, notify_request("REJ-N1", "lab_tech").to_request()).await;
        assert_eq!(resp.status(), 422);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["error"]["code"], "NO_ORDERING_PROVIDER");

        let stored = app_state
            .repositories
            .specimen_rejections
            .get_by_id("REJ-N1")
            .await
            .expect("rejection still present");
        assert!(
            !stored.notified_ordering_provider,
            "a refused notification must not claim the provider was told"
        );
    }

    /// A pharmacist has no part in lab specimen handling.
    #[actix_web::test]
    async fn a_pharmacist_cannot_notify() {
        let state = state_with_chain(true).await;
        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(notify_rejection_ordering_provider),
        )
        .await;

        let resp = test::call_service(&app, notify_request("REJ-N1", "pharm").to_request()).await;
        assert_eq!(resp.status(), 403);
        assert!(
            !app_state
                .repositories
                .specimen_rejections
                .get_by_id("REJ-N1")
                .await
                .unwrap()
                .notified_ordering_provider
        );
    }

    /// An unknown rejection is a 404, not a 500 and not a silent success.
    #[actix_web::test]
    async fn an_unknown_rejection_is_not_found() {
        let state = state_with_chain(true).await;
        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(notify_rejection_ordering_provider),
        )
        .await;

        let resp = test::call_service(
            &app,
            notify_request("REJ-DOES-NOT-EXIST", "lab_tech").to_request(),
        )
        .await;
        assert_eq!(resp.status(), 404);
    }

    /// The patient, the author and the notification state are the server's.
    #[actix_web::test]
    async fn a_rejection_is_filed_against_the_specimens_patient_by_the_caller() {
        let state = web::Data::new(state_with_chain(true).await);
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(create_specimen_rejection),
        )
        .await;
        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/clinical/specimen-rejection")
                .insert_header(crate::test_fixtures::as_user("lab_tech"))
                .set_json(serde_json::json!({
                    "specimen_id": "SPC-N1",
                    "rejection_reason": "Clotted",
                    "rejection_category": "specimen_quality",
                    "recollection_required": true,
                    // None of these is the caller's to say.
                    "patient_id": "PAT-SOMEONE-ELSE",
                    "rejected_by": "somebody_else",
                    "notified_ordering_provider": true
                }))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), 201);
        let body: serde_json::Value = test::read_body_json(resp).await;
        let id = body["rejection_id"].as_str().expect("id");
        let stored = state
            .repositories
            .specimen_rejections
            .get_by_id(id)
            .await
            .expect("stored");
        assert_eq!(stored.patient_id, "PAT-N1");
        assert_eq!(stored.rejected_by, "lab_tech");
        assert!(!stored.notified_ordering_provider);
        assert!(stored.recollection_required);
    }

    #[actix_web::test]
    async fn a_rejection_needs_a_known_category() {
        let state = web::Data::new(state_with_chain(true).await);
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(create_specimen_rejection),
        )
        .await;
        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/clinical/specimen-rejection")
                .insert_header(crate::test_fixtures::as_user("lab_tech"))
                .set_json(serde_json::json!({
                    "specimen_id": "SPC-N1",
                    "rejection_reason": "Clotted",
                    "rejection_category": "bad_vibes"
                }))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), 400);
    }
}
