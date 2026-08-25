use super::*;

// ============================================================================
// Lab Result Submission Endpoints (Approval Workflow)
// ============================================================================

/// Submit lab results for doctor approval
/// Requires: LabTechnician, Doctor, Nurse, or Admin role
#[post("/api/lab/submit")]
pub async fn submit_lab_results(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<SubmitLabResultRequest>,
) -> impl Responder {
    // RBAC: Check if caller can submit lab results
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // LabTechnician and healthcare providers can submit lab results
    let can_submit = matches!(
        current_user.role,
        Role::LabTechnician | Role::Doctor | Role::Nurse | Role::Admin
    );

    if !can_submit {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Role '{}' cannot submit lab results. Required: LabTechnician, Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Verify patient exists and get patient name
    let patient_name = {
        let entity = match data.repositories.patients.get_by_id(&req.patient_id).await {
            Ok(e) => e,
            Err(_) => {
                return HttpResponse::NotFound().json(ErrorResponse {
                    success: false,
                    error: format!("Patient '{}' not found", req.patient_id),
                    code: "PATIENT_NOT_FOUND".to_string(),
                });
            }
        };
        match patient_entity_to_profile(&entity, &data.encryption_keyring) {
            Some(p) => p.full_name,
            None => {
                return HttpResponse::NotFound().json(ErrorResponse {
                    success: false,
                    error: format!("Patient '{}' not found", req.patient_id),
                    code: "PATIENT_NOT_FOUND".to_string(),
                });
            }
        }
    };

    // Validate test results
    if req.results.is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "At least one test result is required".to_string(),
            code: "INVALID_REQUEST".to_string(),
        });
    }

    // Generate unique submission ID
    let submission_id = format!(
        "LAB-{}",
        Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );

    // Create lab submission
    let submission = LabResultSubmission {
        id: submission_id.clone(),
        patient_id: req.patient_id.clone(),
        patient_name,
        test_name: req.test_name.clone(),
        test_category: req.test_category.clone(),
        results: req.results.clone(),
        notes: req.notes.clone(),
        submitted_by: current_user_id.clone(),
        submitted_at: Utc::now(),
        status: LabResultStatus::Pending,
        reviewed_by: None,
        reviewed_at: None,
        rejection_reason: None,
        content_hash: None,
        metadata_hash: None,
    };

    // Store submission via repository (was: in-memory data.lab_submissions HashMap)
    {
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: submission_id.clone(),
            owner_id: submission.patient_id.clone(),
            data: serde_json::to_value(&submission).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data
            .repositories
            .lab_result_submissions
            .create(entity)
            .await;
    }

    // CDS: evaluate lab-based rules (hyperkalemia, AKI, etc.) on the numeric values.
    {
        let mut lab_values: std::collections::HashMap<String, f64> =
            std::collections::HashMap::new();
        for r in &req.results {
            if let Ok(v) = r.value.trim().parse::<f64>() {
                lab_values.insert(r.parameter.to_lowercase(), v);
            }
        }
        if !lab_values.is_empty() {
            let (conditions, meds) =
                crate::clinical_endpoints::patient_conditions_and_meds(&data, &req.patient_id)
                    .await;
            crate::clinical_endpoints::run_and_persist_cds_alerts(
                &data,
                &req.patient_id,
                None,
                Some(&lab_values),
                &conditions,
                &meds,
                req.facility_id.as_deref(),
            )
            .await;
        }
    }

    // Log access via repository
    let _ = data
        .repositories
        .access_logs
        .create(
            AccessLogEntry {
                access_id: secure_tokens::generate_access_id(),
                patient_id: req.patient_id.clone(),
                accessor_id: current_user_id,
                accessor_role: current_user.role.to_string(),
                access_type: "lab_submission".to_string(),
                location: None,
                timestamp: Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

    log::info!(
        "Lab results submitted: {} for patient {}",
        submission_id,
        req.patient_id
    );

    HttpResponse::Created().json(SubmitLabResultResponse {
        success: true,
        submission_id,
        message: "Lab results submitted successfully. Pending doctor approval.".to_string(),
    })
}

/// Get pending lab result submissions for review
/// Requires: Doctor, Nurse, or Admin role
#[get("/api/lab/pending")]
pub async fn get_pending_lab_results(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    // RBAC: Only doctors, nurses, and admins can review lab results
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Only Doctor, Nurse, or Admin can review
    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Role '{}' cannot review lab results. Required: Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get all pending submissions via repository
    let pending: Vec<LabResultSubmission> = data
        .repositories
        .lab_result_submissions
        .list_all()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| serde_json::from_value::<LabResultSubmission>(r.data).ok())
        .filter(|s| s.status == LabResultStatus::Pending)
        .collect();

    let total = pending.len();

    HttpResponse::Ok().json(PendingLabResultsResponse {
        submissions: pending,
        total,
    })
}

/// Get all lab result submissions (paginated, with optional status filter)
/// Requires: Doctor, Nurse, or Admin role
/// Query params: ?page=1&limit=20&status=pending
#[get("/api/lab/submissions")]
pub async fn get_all_lab_submissions(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    // RBAC: Only doctors, nurses, and admins can view lab submissions
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Only Doctor, Nurse, or Admin can view all submissions
    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Role '{}' cannot view lab submissions. Required: Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Get optional status filter and pagination
    let status_filter = query.get("status").map(|s| s.to_lowercase());
    let page: usize = query.get("page").and_then(|p| p.parse().ok()).unwrap_or(1);
    let limit: usize = query
        .get("limit")
        .and_then(|l| l.parse().ok())
        .unwrap_or(20);

    // Get submissions with optional filter via repository
    let filtered: Vec<LabResultSubmission> = data
        .repositories
        .lab_result_submissions
        .list_all()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| serde_json::from_value::<LabResultSubmission>(r.data).ok())
        .filter(|s| match &status_filter {
            Some(status) => s.status.to_string() == *status,
            None => true,
        })
        .collect();

    let (paginated_submissions, pagination) = paginate(&filtered, page, limit);

    HttpResponse::Ok().json(serde_json::json!({
        "submissions": paginated_submissions,
        "total": pagination.total_items,
        "pagination": pagination
    }))
}

/// Get a specific lab result submission by ID
/// Requires: Doctor, Nurse, Admin, or the submitting LabTechnician
#[get("/api/lab/submissions/{submission_id}")]
pub async fn get_lab_submission(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let submission_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    let submission: crate::LabResultSubmission = match data
        .repositories
        .lab_result_submissions
        .get_by_id(&submission_id)
        .await
        .ok()
        .flatten()
        .and_then(|rec| serde_json::from_value(rec.data).ok())
    {
        Some(s) => s,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Lab submission '{}' not found", submission_id),
                code: "SUBMISSION_NOT_FOUND".to_string(),
            });
        }
    };

    // Allow access if: healthcare provider OR the lab tech who submitted it
    let can_view = current_user.role.can_edit_medical_records()
        || (current_user.role == Role::LabTechnician && submission.submitted_by == current_user_id);

    if !can_view {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    HttpResponse::Ok().json(submission)
}

/// Serialise a submission into the shape the JSON-record table stores.
///
/// `created_at`/`updated_at` are placeholders: both backends preserve the
/// stored `created_at` and stamp `updated_at` themselves, so the values passed
/// here are never the ones persisted.
fn submission_record(
    submission: &crate::LabResultSubmission,
) -> crate::repositories::traits::JsonRecordEntity {
    let now = Utc::now();
    crate::repositories::traits::JsonRecordEntity {
        id: submission.id.clone(),
        owner_id: submission.patient_id.clone(),
        data: serde_json::to_value(submission).unwrap_or_default(),
        created_at: now,
        updated_at: now,
    }
}

/// The exact string `LabResultStatus` serialises to.
///
/// The guard compares against the *stored* JSON, so it must use the serde
/// representation and not `Display`, which is lowercase and would never match.
/// Deriving it here rather than writing the literal means a future
/// `#[serde(rename_all = ...)]` moves the guard with it instead of silently
/// disabling every transition.
fn status_token(status: &LabResultStatus) -> String {
    serde_json::to_value(status)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// Commit a review only while the stored submission is still `Pending`.
///
/// `Ok(None)` means somebody else reviewed it first. The guard reads the field
/// as it is serialised by `LabResultStatus`, which has no `rename_all`, so the
/// stored value is the capitalised variant name.
async fn replace_submission_if_pending(
    data: &web::Data<AppState>,
    submission: &crate::LabResultSubmission,
) -> Result<
    Option<crate::repositories::traits::JsonRecordEntity>,
    crate::repositories::traits::RepositoryError,
> {
    data.repositories
        .lab_result_submissions
        .replace_if_field_eq(
            &submission.id,
            "status",
            &status_token(&LabResultStatus::Pending),
            submission_record(submission),
        )
        .await
}

/// Undo a committed review whose obligations could not be met.
///
/// Guarded on the status this request itself wrote, so it can only revert its
/// own transition: if a concurrent request has since moved the submission on,
/// the guard fails and this does nothing rather than clobbering that decision.
///
/// A failure here is logged and not surfaced. The caller is already returning
/// an error, and the honest description of that state -- reviewed in storage,
/// obligations unmet -- is exactly what the log needs to carry for an operator.
async fn revert_submission_to_pending(
    data: &web::Data<AppState>,
    pending_snapshot: &crate::LabResultSubmission,
    committed_status: &str,
) {
    match data
        .repositories
        .lab_result_submissions
        .replace_if_field_eq(
            &pending_snapshot.id,
            "status",
            committed_status,
            submission_record(pending_snapshot),
        )
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => log::error!(
            "Lab review compensation for {} found status != {}; leaving it alone",
            pending_snapshot.id,
            committed_status
        ),
        Err(e) => log::error!(
            "Lab review compensation failed for {}: {} (submission remains reviewed with unmet obligations)",
            pending_snapshot.id,
            e
        ),
    }
}

/// Internal implementation for reviewing lab results
/// Used by both POST /api/lab/review and POST /api/lab/submissions/{id}/review
pub async fn review_lab_results_impl(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: ReviewLabResultRequest,
) -> HttpResponse {
    // RBAC: Only doctors, nurses, and admins can approve lab results
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Only Doctor, Nurse, or Admin can approve/reject
    if !current_user.role.can_edit_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: format!(
                "Role '{}' cannot review lab results. Required: Doctor, Nurse, or Admin",
                current_user.role
            ),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Validate action
    let action = req.action.to_lowercase();
    if action != "approve" && action != "reject" {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Invalid action. Must be 'approve' or 'reject'".to_string(),
            code: "INVALID_ACTION".to_string(),
        });
    }

    // Rejection requires a reason
    if action == "reject" && req.rejection_reason.is_none() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Rejection requires a reason".to_string(),
            code: "REJECTION_REASON_REQUIRED".to_string(),
        });
    }

    // Get and update submission (via repository)
    let mut submission: crate::LabResultSubmission = match data
        .repositories
        .lab_result_submissions
        .get_by_id(&req.submission_id)
        .await
        .ok()
        .flatten()
        .and_then(|rec| serde_json::from_value(rec.data).ok())
    {
        Some(s) => s,
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: format!("Lab submission '{}' not found", req.submission_id),
                code: "SUBMISSION_NOT_FOUND".to_string(),
            });
        }
    };

    // Check if already reviewed. This is a cheap early rejection for the
    // common case only -- it is NOT what makes the transition exactly-once.
    // Two concurrent reviews both pass here; the atomic guard below decides
    // between them.
    if submission.status != LabResultStatus::Pending {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: format!("Lab submission already {}", submission.status),
            code: "ALREADY_REVIEWED".to_string(),
        });
    }

    // Maker-checker: whoever submitted a result may not be the one who
    // approves it. Doctor, Nurse and Admin can *both* submit (`/api/lab/submit`
    // accepts all three) and review, so without this guard the four-eyes
    // property the review step exists to provide is satisfiable by one person
    // acting twice, and the approval authorises its own author's work.
    //
    // Retention approvals enforce the same rule inside their deciding UPDATE
    // (`requested_by <> $3`). Here a plain comparison is equivalent, because
    // `submitted_by` is written once at submission and never changes.
    if submission.submitted_by == current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "A lab result cannot be reviewed by the person who submitted it".to_string(),
            code: "SELF_REVIEW_FORBIDDEN".to_string(),
        });
    }

    let patient_id = submission.patient_id.clone();
    let submission_id = submission.id.clone();
    // Kept so a failed post-transition obligation can put the submission back
    // as it was, rather than leaving it reviewed with nothing to show for it.
    let pending_snapshot = submission.clone();

    // Decide the new state in memory first. Nothing is written until the
    // atomic transition below succeeds.
    if action == "approve" {
        submission.status = LabResultStatus::Approved;
    } else {
        submission.status = LabResultStatus::Rejected;
        submission.rejection_reason = req.rejection_reason.clone();
    }
    submission.reviewed_by = Some(current_user_id.clone());
    submission.reviewed_at = Some(Utc::now());

    // The transition. `replace_if_field_eq` writes only while the *stored*
    // status is still `Pending`, so of two concurrent reviews exactly one
    // commits and the other is told the submission was already reviewed.
    // The previous code read, checked, then wrote back unconditionally, so
    // both reviewers won and the later write silently overwrote the earlier
    // decision -- including overwriting an approval with a rejection.
    match replace_submission_if_pending(&data, &submission).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Lab submission was already reviewed".to_string(),
                code: "ALREADY_REVIEWED".to_string(),
            });
        }
        Err(e) => {
            log::error!("Lab review transition failed for {}: {}", submission_id, e);
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Lab review could not be recorded".to_string(),
                code: "LAB_REVIEW_UNAVAILABLE".to_string(),
            });
        }
    }

    // ---- Obligations that must hold for the decision to stand -------------
    //
    // What follows is part of the reviewed state, not a side effect of it.
    // Each failure reverts the transition rather than returning success:
    // "approved" with no patient-visible record, or with no audit entry, is a
    // worse outcome than a refused approval the reviewer can simply retry.

    if action == "approve" {
        let lab_content = serde_json::to_string(&submission.results).unwrap_or_default();
        let content_checksum = hex::encode(medichain_crypto::sha256(lab_content.as_bytes()));

        let record_ref = MedicalRecordReference {
            content_hash: format!("lab-{}", submission.id),
            metadata_hash: format!("meta-{}", submission.id),
            record_type: "lab_result".to_string(),
            uploaded_at: Utc::now().timestamp(),
            content_checksum,
        };

        let entity: crate::repositories::traits::MedicalRecordEntity =
            (patient_id.clone(), record_ref).into();
        let mut entity = entity;
        entity.created_by = current_user_id.clone();
        entity.last_modified_by = current_user_id.clone();

        // Previously this failure was logged and then ignored: the submission
        // was marked Approved, the caller was told "approved and added to
        // patient records", and no record existed. The reviewing clinician had
        // no way to learn that, and the chart was silently missing a result
        // somebody had signed off.
        if let Err(e) = data.repositories.medical_records.create(entity).await {
            log::error!("Lab record persistence failed for {}: {}", submission_id, e);
            revert_submission_to_pending(
                &data,
                &pending_snapshot,
                &status_token(&submission.status),
            )
            .await;
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Lab result could not be added to the patient record".to_string(),
                code: "LAB_RECORD_PERSISTENCE_FAILED".to_string(),
            });
        }
    }

    // Audit is an obligation for the same reason: a clinical sign-off nobody
    // can later attribute is not a reviewed result.
    if let Err(e) = data
        .repositories
        .access_logs
        .create(
            AccessLogEntry {
                access_id: secure_tokens::generate_access_id(),
                patient_id: patient_id.clone(),
                accessor_id: current_user_id.clone(),
                accessor_role: current_user.role.to_string(),
                access_type: format!("lab_review_{}", action),
                location: None,
                timestamp: Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await
    {
        log::error!("Lab review audit failed for {}: {}", submission_id, e);
        revert_submission_to_pending(&data, &pending_snapshot, &status_token(&submission.status))
            .await;
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Lab review could not be audited".to_string(),
            code: "AUDIT_UNAVAILABLE".to_string(),
        });
    }

    log::info!(
        "Lab submission {} {} by {} for patient {}",
        submission_id,
        submission.status,
        current_user_id,
        patient_id
    );

    if action == "approve" {
        // Notification, deliberately after the obligations and deliberately
        // best-effort: telling a patient their results are ready is not part
        // of the decision, and a push outage must not un-approve a result.
        let repos = data.repositories.clone();
        let recipient = patient_id.clone();
        let test_name = submission.test_name.clone();
        tokio::spawn(async move {
            let _ = crate::notifications::send_push_to_user(
                &repos,
                crate::notifications::PushNotification {
                    user_id: recipient,
                    title: "Lab Results Ready".to_string(),
                    body: format!("Your {} results are now available.", test_name),
                    data: Some([("type".to_string(), "lab_results_ready".to_string())].into()),
                },
            )
            .await;
        });
    }

    HttpResponse::Ok().json(ReviewLabResultResponse {
        success: true,
        submission_id,
        new_status: action.clone(),
        message: format!(
            "Lab submission {}",
            if action == "approve" {
                "approved and added to patient records"
            } else {
                "rejected"
            }
        ),
    })
}

/// Review (approve or reject) a lab result submission
/// Requires: Doctor, Nurse, or Admin role
#[post("/api/lab/review")]
pub async fn review_lab_results(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<ReviewLabResultRequest>,
) -> impl Responder {
    review_lab_results_impl(data, http_req, req.into_inner()).await
}

/// Alternative route: Review lab submission with ID in path
/// This endpoint provides RESTful path-based access to match frontend expectations
/// Requires: Doctor, Nurse, or Admin role
#[post("/api/lab/submissions/{submission_id}/review")]
pub async fn review_lab_submission_path(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<serde_json::Value>,
) -> impl Responder {
    let submission_id = path.into_inner();

    // Extract action and rejection_reason from request body
    let action = req
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let rejection_reason = req
        .get("rejection_reason")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Construct ReviewLabResultRequest
    let review_request = ReviewLabResultRequest {
        submission_id,
        action,
        rejection_reason,
    };

    // Call the shared implementation function
    review_lab_results_impl(data, http_req, review_request).await
}

/// Get lab submissions for a specific patient
/// Requires: Healthcare provider OR the patient themselves (approved only)
#[get("/api/lab/patient/{patient_id}")]
pub async fn get_patient_lab_submissions(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    let is_healthcare = current_user.role.is_healthcare_provider();
    let is_own_records =
        crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id);

    if !is_healthcare && !is_own_records {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "ACCESS_DENIED".to_string(),
        });
    }

    // Get patient's lab submissions
    let patient_submissions: Vec<LabResultSubmission> = data
        .repositories
        .lab_result_submissions
        .get_by_owner(&patient_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| serde_json::from_value::<LabResultSubmission>(r.data).ok())
        // Patients only see approved results
        .filter(|s| is_healthcare || s.status == LabResultStatus::Approved)
        .collect();

    let total = patient_submissions.len();

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "submissions": patient_submissions,
        "total": total
    }))
}

#[cfg(test)]
mod maker_checker_tests {
    use super::*;
    use actix_web::{test, App};

    fn user(wallet: &str, role: Role) -> User {
        User {
            wallet_address: wallet.to_string(),
            username: None,
            name: format!("Test {wallet}"),
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

    fn pending_submission(id: &str, patient_id: &str, submitted_by: &str) -> LabResultSubmission {
        LabResultSubmission {
            id: id.to_string(),
            patient_id: patient_id.to_string(),
            patient_name: "Test Patient".to_string(),
            test_name: "Complete Blood Count".to_string(),
            test_category: "Hematology".to_string(),
            results: vec![LabTestResult {
                parameter: "Hemoglobin".to_string(),
                value: "14.1".to_string(),
                unit: "g/dL".to_string(),
                reference_range: "12.0-17.5".to_string(),
                flag: None,
            }],
            notes: None,
            submitted_by: submitted_by.to_string(),
            submitted_at: Utc::now(),
            status: LabResultStatus::Pending,
            reviewed_by: None,
            reviewed_at: None,
            rejection_reason: None,
            content_hash: None,
            metadata_hash: None,
        }
    }

    /// Builds state holding one pending submission plus the given users.
    async fn state_with(submission: &LabResultSubmission, users: &[User]) -> crate::AppState {
        let state = crate::AppState::new();
        for u in users {
            state
                .users
                .write()
                .unwrap()
                .insert(u.wallet_address.clone(), u.clone());
        }
        let now = Utc::now();
        state
            .repositories
            .lab_result_submissions
            .create(crate::repositories::traits::JsonRecordEntity {
                id: submission.id.clone(),
                owner_id: submission.patient_id.clone(),
                data: serde_json::to_value(submission).unwrap(),
                created_at: now,
                updated_at: now,
            })
            .await
            .unwrap();
        state
    }

    async fn stored(state: &crate::AppState, id: &str) -> LabResultSubmission {
        let rec = state
            .repositories
            .lab_result_submissions
            .get_by_id(id)
            .await
            .unwrap()
            .expect("submission should still exist");
        serde_json::from_value(rec.data).unwrap()
    }

    /// The request is built as JSON rather than as `ReviewLabResultRequest`
    /// because that type is deserialize-only -- which is correct for an inbound
    /// DTO, so the test posts what a client actually posts.
    fn review_request(id: &str, action: &str) -> serde_json::Value {
        let mut body = serde_json::json!({ "submission_id": id, "action": action });
        if action == "reject" {
            body["rejection_reason"] = serde_json::json!("insufficient sample");
        }
        body
    }

    /// The four-eyes rule. A Doctor may submit *and* review lab results, so
    /// without an explicit guard one clinician can sign off their own work and
    /// the approval step certifies nothing.
    #[actix_web::test]
    async fn submitter_cannot_approve_their_own_submission() {
        let doctor = user("doctor_a", Role::Doctor);
        let submission = pending_submission("LAB-SELF-1", "PAT-1", "doctor_a");
        let state = state_with(&submission, &[doctor]).await;

        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(review_lab_results),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/lab/review")
            .insert_header(("x-user-id", "doctor_a"))
            .set_json(review_request("LAB-SELF-1", "approve"))
            .to_request();
        let resp = test::call_service(&app, req).await;

        assert_eq!(resp.status(), 403, "submitter must not be able to approve");
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["error"]["code"], "SELF_REVIEW_FORBIDDEN");

        // And the submission must be untouched, not merely the response refused.
        let after = stored(&app_state, "LAB-SELF-1").await;
        assert_eq!(after.status, LabResultStatus::Pending);
        assert!(after.reviewed_by.is_none());
    }

    /// A different clinician reviewing the same submission is the intended
    /// path and must still work.
    #[actix_web::test]
    async fn a_second_clinician_can_approve() {
        let tech = user("tech_a", Role::LabTechnician);
        let doctor = user("doctor_b", Role::Doctor);
        let submission = pending_submission("LAB-OK-1", "PAT-1", "tech_a");
        let state = state_with(&submission, &[tech, doctor]).await;

        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(review_lab_results),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/lab/review")
            .insert_header(("x-user-id", "doctor_b"))
            .set_json(review_request("LAB-OK-1", "approve"))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);

        let after = stored(&app_state, "LAB-OK-1").await;
        assert_eq!(after.status, LabResultStatus::Approved);
        assert_eq!(after.reviewed_by.as_deref(), Some("doctor_b"));

        // The approval's whole purpose is that the result reaches the chart.
        let records = app_state
            .repositories
            .medical_records
            // NOT `Pagination::default()`: that is `per_page: 0`, so `limit()`
            // is 0 and the query returns an empty page with a non-zero `total`.
            .get_by_patient("PAT-1", Pagination::new(0, 50))
            .await
            .expect("medical records should be readable");
        assert!(
            records
                .items
                .iter()
                .any(|r| r.ipfs_content_hash.as_deref() == Some("lab-LAB-OK-1")),
            "approved lab result should be a visible medical record"
        );
    }

    /// A *sequential* second review is refused and the first decision stands.
    ///
    /// This does NOT prove the concurrent case: the pre-existing early
    /// `status != Pending` check already rejects a sequential re-review, so
    /// this test passes even with the atomic guard removed. The interleaving
    /// where both reviewers read `Pending` before either writes is proved
    /// against the repository primitive itself, in
    /// `repositories::memory::phase7::tests` and the PostgreSQL suite.
    #[actix_web::test]
    async fn a_sequential_second_review_cannot_overwrite_the_first_decision() {
        let tech = user("tech_a", Role::LabTechnician);
        let doctor_b = user("doctor_b", Role::Doctor);
        let doctor_c = user("doctor_c", Role::Doctor);
        let submission = pending_submission("LAB-RACE-1", "PAT-1", "tech_a");
        let state = state_with(&submission, &[tech, doctor_b, doctor_c]).await;

        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(review_lab_results),
        )
        .await;

        let first = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/lab/review")
                .insert_header(("x-user-id", "doctor_b"))
                .set_json(review_request("LAB-RACE-1", "approve"))
                .to_request(),
        )
        .await;
        assert_eq!(first.status(), 200);

        let second = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/lab/review")
                .insert_header(("x-user-id", "doctor_c"))
                .set_json(review_request("LAB-RACE-1", "reject"))
                .to_request(),
        )
        .await;
        assert_eq!(second.status(), 400);

        let after = stored(&app_state, "LAB-RACE-1").await;
        assert_eq!(
            after.status,
            LabResultStatus::Approved,
            "the first decision must stand"
        );
        assert_eq!(after.reviewed_by.as_deref(), Some("doctor_b"));
    }

    /// A pharmacist has no business signing off lab results.
    #[actix_web::test]
    async fn pharmacist_cannot_review() {
        let tech = user("tech_a", Role::LabTechnician);
        let pharmacist = user("pharm_a", Role::Pharmacist);
        let submission = pending_submission("LAB-ROLE-1", "PAT-1", "tech_a");
        let state = state_with(&submission, &[tech, pharmacist]).await;

        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(review_lab_results),
        )
        .await;

        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/lab/review")
                .insert_header(("x-user-id", "pharm_a"))
                .set_json(review_request("LAB-ROLE-1", "approve"))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), 403);
        assert_eq!(
            stored(&app_state, "LAB-ROLE-1").await.status,
            LabResultStatus::Pending
        );
    }
}
