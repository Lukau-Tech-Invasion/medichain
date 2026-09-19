use super::*;

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ManualReviewCase {
    id: String,
    country: String,
    status: String,
    requested_at: chrono::DateTime<Utc>,
    decided_at: Option<chrono::DateTime<Utc>>,
    decided_by: Option<String>,
    evidence_reference: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ManualReviewDecision {
    pub approved: bool,
    /// Immutable reference to the facility's reviewed identity evidence. The
    /// evidence itself is not placed in the application database by this API.
    pub evidence_reference: String,
}

/// Persist a privacy-minimised manual-review work item, or fail rather than
/// tell a registrant that an unactionable review has been created.
async fn create_manual_review(
    data: &web::Data<AppState>,
    result: &crate::national_id::VerificationResult,
) -> Result<String, ()> {
    let pool = data.db_pool.as_ref().ok_or(())?;
    let id = Uuid::new_v4().to_string();
    let hash = crate::support::hash_national_id(&result.id_number);
    let inserted = sqlx::query_scalar::<_, String>(
        "INSERT INTO national_id_manual_reviews \
         (id, country, national_id_hash, status) VALUES ($1, $2, $3, 'pending') \
         ON CONFLICT (country, national_id_hash) DO UPDATE SET requested_at = NOW() \
         WHERE national_id_manual_reviews.status = 'pending' \
         RETURNING id",
    )
    .bind(&id)
    .bind(result.country.to_string())
    .bind(hash)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        log::error!("national-ID manual review persistence failed: {error}");
    })?;
    inserted.ok_or(())
}

/// Map an explicit verification outcome to its HTTP success status.
fn verification_status(
    result: &crate::national_id::VerificationResult,
) -> actix_web::http::StatusCode {
    if result.verification_method == crate::national_id::VerificationMethod::ManualReviewRequired {
        actix_web::http::StatusCode::ACCEPTED
    } else {
        actix_web::http::StatusCode::OK
    }
}

/// Verify a national ID number against the appropriate government API.
///
/// A country without a configured live verifier returns an explicit manual
/// review requirement. It never produces synthetic identity details.
///
/// Registration staff only. This was once public on the reasoning that it
/// stored nothing, but a manual-review outcome writes a row to the
/// administrators' identity-review queue — an anonymous caller could fill that
/// queue — and a live verifier spends the deployment's government-register
/// credentials on every request. Its one caller is patient registration.
///
/// POST /api/national-id/verify
/// Body: { "id_number": "FAN123456", "country": "Ethiopia" }
#[post("/api/national-id/verify")]
pub async fn verify_national_id(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<crate::national_id::VerifyIdRequest>,
) -> impl Responder {
    if let Err(response) = crate::support::require_clinical_staff(&data, &http_req) {
        return response;
    }
    let country = crate::national_id::Country::from_str(&req.country);

    if country == crate::national_id::Country::Unknown {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: format!("Unsupported country: {}", req.country),
            code: "UNSUPPORTED_COUNTRY".to_string(),
        });
    }

    match data
        .national_id_service
        .verify(&req.id_number, &country)
        .await
    {
        Ok(result)
            if result.verification_method
                == crate::national_id::VerificationMethod::ManualReviewRequired =>
        {
            match create_manual_review(&data, &result).await {
                Ok(review_id) => HttpResponse::Accepted().json(serde_json::json!({
                    "success": true,
                    "review_id": review_id,
                    "result": result
                })),
                Err(()) => HttpResponse::ServiceUnavailable().json(ErrorResponse {
                    success: false,
                    error: "Identity review storage is unavailable".to_string(),
                    code: "MANUAL_REVIEW_STORAGE_REQUIRED".to_string(),
                }),
            }
        }
        Ok(result) => HttpResponse::build(verification_status(&result)).json(serde_json::json!({
            "success": true,
            "result": result
        })),
        Err(_) => HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Identity verification is temporarily unavailable".to_string(),
            code: "VERIFICATION_UNAVAILABLE".to_string(),
        }),
    }
}

/// List pending/manual national-ID cases without exposing the submitted ID.
#[get("/api/admin/national-id-reviews")]
pub async fn list_national_id_manual_reviews(
    data: web::Data<AppState>,
    req: HttpRequest,
) -> impl Responder {
    if let Err(response) = require_admin(&data, &req) {
        return response;
    }
    let Some(pool) = data.db_pool.as_ref() else {
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Identity review storage is unavailable".to_string(),
            code: "MANUAL_REVIEW_STORAGE_REQUIRED".to_string(),
        });
    };
    match sqlx::query_as::<_, ManualReviewCase>(
        "SELECT id, country, status, requested_at, decided_at, decided_by, evidence_reference \
         FROM national_id_manual_reviews ORDER BY requested_at ASC LIMIT 200",
    )
    .fetch_all(pool)
    .await
    {
        Ok(reviews) => {
            HttpResponse::Ok().json(serde_json::json!({"success": true, "reviews": reviews}))
        }
        Err(error) => {
            log::error!("national-ID manual review listing failed: {error}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Identity review storage is unavailable".to_string(),
                code: "MANUAL_REVIEW_STORAGE_REQUIRED".to_string(),
            })
        }
    }
}

/// Record an administrator's evidenced manual identity-review decision.
#[post("/api/admin/national-id-reviews/{review_id}/decision")]
pub async fn decide_national_id_manual_review(
    data: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<ManualReviewDecision>,
) -> impl Responder {
    if let Err(response) = require_admin(&data, &req) {
        return response;
    }
    // `require_admin` has established the authenticated subject; resolve it
    // again only to stamp the decision's accountable actor, never from body.
    let Some(admin_id) = get_current_user_id(&req) else {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Authentication required".to_string(),
            code: "UNAUTHORIZED".to_string(),
        });
    };
    if body.evidence_reference.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "An identity-evidence reference is required".to_string(),
            code: "EVIDENCE_REFERENCE_REQUIRED".to_string(),
        });
    }
    let Some(pool) = data.db_pool.as_ref() else {
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Identity review storage is unavailable".to_string(),
            code: "MANUAL_REVIEW_STORAGE_REQUIRED".to_string(),
        });
    };
    let status = if body.approved {
        "approved"
    } else {
        "rejected"
    };
    let result = sqlx::query(
        "UPDATE national_id_manual_reviews SET status = $2, decided_at = NOW(), decided_by = $3, \
         evidence_reference = $4 WHERE id = $1 AND status = 'pending'",
    )
    .bind(path.into_inner())
    .bind(status)
    .bind(admin_id)
    .bind(body.evidence_reference.trim())
    .execute(pool)
    .await;
    match result {
        Ok(result) if result.rows_affected() == 1 => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "status": status,
        })),
        Ok(_) => HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: "Review was not found or has already been decided".to_string(),
            code: "REVIEW_NOT_PENDING".to_string(),
        }),
        Err(error) => {
            log::error!("national-ID manual review decision persistence failed: {error}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Identity review storage is unavailable".to_string(),
                code: "MANUAL_REVIEW_STORAGE_REQUIRED".to_string(),
            })
        }
    }
}

/// Simulate NFC tap - generates NFC tag data and QR code
#[post("/api/simulate-nfc-tap")]
pub async fn simulate_nfc_tap(
    data: web::Data<AppState>,
    req: web::Json<SimulateNfcTapRequest>,
) -> impl Responder {
    // HZ-019: this endpoint fabricates a patient's NFC card hash — the credential
    // the emergency-token exchange accepts — from a patient ID alone, with no
    // physical card. That is a testing convenience and a production
    // credential-forgery primitive. Gate it to demo mode: outside IS_DEMO=true it
    // returns 403 and computes nothing, so it cannot be chained into
    // unauthenticated emergency-PHI disclosure on a real deployment.
    if let Err(resp) = crate::support::require_demo_mode() {
        return resp;
    }

    // Check if patient exists via repository (was: in-memory data.patients HashMap)
    if data
        .repositories
        .patients
        .get_by_id(&req.patient_id)
        .await
        .is_err()
    {
        return HttpResponse::NotFound().json(SimulateNfcTapResponse {
            success: false,
            nfc_tag_id: String::new(),
            tag_data: NfcTagData {
                tag_id: String::new(),
                patient_id: String::new(),
                hash: String::new(),
                created_at: Utc::now(),
            },
            qr_code_base64: None,
            message: "Patient not found.".to_string(),
        });
    }

    // Find existing NFC tag for patient via repository
    let existing_tag = match data
        .repositories
        .nfc_tags
        .get_active_by_patient(&req.patient_id)
        .await
    {
        Ok(opt) => opt.map(NfcTagData::from),
        Err(e) => {
            log::error!("NFC lookup failed: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "NFC lookup failed".to_string(),
                code: "REPO_ERROR".to_string(),
            });
        }
    };

    let tag_data = match existing_tag {
        Some(tag) => tag,
        None => {
            // Create new tag
            let nfc_tag_id = format!(
                "NFC-{}",
                Uuid::new_v4()
                    .to_string()
                    .split('-')
                    .next()
                    .unwrap_or("000")
            );
            let hash = generate_nfc_hash(&req.patient_id, &nfc_tag_id);
            let tag = NfcTagData {
                tag_id: nfc_tag_id,
                patient_id: req.patient_id.clone(),
                hash,
                created_at: Utc::now(),
            };
            if let Err(e) = data.repositories.nfc_tags.create(tag.clone().into()).await {
                log::error!("NFC tag create failed: {}", e);
                return HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Failed to register NFC tag".to_string(),
                    code: "REPO_ERROR".to_string(),
                });
            }
            tag
        }
    };

    // Generate QR code containing the NFC tag ID
    let qr_data = serde_json::json!({
        "type": "medichain_nfc",
        "tag_id": tag_data.tag_id,
        "hash": &tag_data.hash[..16], // First 16 chars of hash for verification
    });
    let qr_code = generate_qr_code_base64(&qr_data.to_string());

    log::info!("NFC tap simulated");

    HttpResponse::Ok().json(SimulateNfcTapResponse {
        success: true,
        nfc_tag_id: tag_data.tag_id.clone(),
        tag_data,
        qr_code_base64: qr_code,
        message: "NFC tap simulated. Use the tag_id for emergency access.".to_string(),
    })
}

#[cfg(test)]
mod verification_access_tests {
    use super::*;
    use actix_web::test;

    /// It was public on the reasoning that it stored nothing; a manual-review
    /// outcome now writes to the administrators' queue, so an anonymous caller
    /// must not reach it at all.
    #[actix_web::test]
    async fn an_anonymous_caller_cannot_verify_or_queue_a_review() {
        let app = test::init_service(
            actix_web::App::new()
                .app_data(web::Data::new(crate::AppState::new()))
                .service(verify_national_id),
        )
        .await;

        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/national-id/verify")
                .set_json(
                    serde_json::json!({ "id_number": "8001015009087", "country": "South Africa" }),
                )
                .to_request(),
        )
        .await;

        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }
}
