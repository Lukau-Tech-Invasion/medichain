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
        match patient_entity_to_profile(&entity, &data.encryption_key) {
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

    // Check if already reviewed
    if submission.status != LabResultStatus::Pending {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: format!("Lab submission already {}", submission.status),
            code: "ALREADY_REVIEWED".to_string(),
        });
    }

    let patient_id = submission.patient_id.clone();
    let submission_id = submission.id.clone();

    // Update status
    if action == "approve" {
        submission.status = LabResultStatus::Approved;
        submission.reviewed_by = Some(current_user_id.clone());
        submission.reviewed_at = Some(Utc::now());

        // On approval, create a visible medical record reference
        // Generate a simple content hash for the lab result data
        let lab_content = serde_json::to_string(&submission.results).unwrap_or_default();
        let content_checksum = hex::encode(medichain_crypto::sha256(lab_content.as_bytes()));

        // Create record reference
        let record_ref = MedicalRecordReference {
            content_hash: format!("lab-{}", submission.id),
            metadata_hash: format!("meta-{}", submission.id),
            record_type: "lab_result".to_string(),
            uploaded_at: Utc::now().timestamp(),
            content_checksum,
        };

        // Store in patient's medical records via repository
        {
            let entity: crate::repositories::traits::MedicalRecordEntity =
                (patient_id.clone(), record_ref).into();
            let mut entity = entity;
            entity.created_by = current_user_id.clone();
            entity.last_modified_by = current_user_id.clone();
            if let Err(e) = data.repositories.medical_records.create(entity).await {
                log::error!("Lab record persistence failed: {}", e);
            }
        }

        log::info!(
            "Lab submission {} approved by {} for patient {}",
            submission_id,
            current_user_id,
            patient_id
        );
    } else {
        submission.status = LabResultStatus::Rejected;
        submission.reviewed_by = Some(current_user_id.clone());
        submission.reviewed_at = Some(Utc::now());
        submission.rejection_reason = req.rejection_reason.clone();

        log::info!(
            "Lab submission {} rejected by {} for patient {}",
            submission_id,
            current_user_id,
            patient_id
        );
    }

    // Persist the reviewed submission (upsert preserves original created_at)
    {
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: submission.id.clone(),
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

    // Log access via repository
    let _ = data
        .repositories
        .access_logs
        .create(
            AccessLogEntry {
                access_id: secure_tokens::generate_access_id(),
                patient_id,
                accessor_id: current_user_id,
                accessor_role: current_user.role.to_string(),
                access_type: format!("lab_review_{}", action),
                location: None,
                timestamp: Utc::now(),
                emergency: false,
            }
            .into(),
        )
        .await;

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
    let is_own_records = current_user_id == patient_id;

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
