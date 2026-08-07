use super::*;

// ============================================================================
// CONSENT FORMS MANAGEMENT
// ============================================================================

/// Available consent form types
#[get("/api/consent/types")]
pub async fn get_consent_types(
    // Was `_data`. The list itself is static reference data, but the endpoint
    // still needs to know the caller is real rather than merely header-bearing.
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let _current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let consent_types = vec![
        serde_json::json!({
            "type_id": "CONSENT-TREATMENT",
            "name": "General Treatment Consent",
            "description": "Consent for general medical treatment and care",
            "required_for": ["admission", "outpatient"],
            "expires_after_days": 365
        }),
        serde_json::json!({
            "type_id": "CONSENT-SURGERY",
            "name": "Surgical Consent",
            "description": "Consent for surgical procedures",
            "required_for": ["surgery"],
            "expires_after_days": 30
        }),
        serde_json::json!({
            "type_id": "CONSENT-ANESTHESIA",
            "name": "Anesthesia Consent",
            "description": "Consent for anesthesia administration",
            "required_for": ["surgery"],
            "expires_after_days": 30
        }),
        serde_json::json!({
            "type_id": "CONSENT-BLOOD",
            "name": "Blood Transfusion Consent",
            "description": "Consent for blood product transfusion",
            "required_for": ["transfusion"],
            "expires_after_days": 30
        }),
        serde_json::json!({
            "type_id": "CONSENT-HIPAA",
            "name": "HIPAA Privacy Notice",
            "description": "Acknowledgment of privacy practices",
            "required_for": ["admission"],
            "expires_after_days": 365
        }),
        serde_json::json!({
            "type_id": "CONSENT-RESEARCH",
            "name": "Research Participation Consent",
            "description": "Consent for participation in clinical research",
            "required_for": ["research"],
            "expires_after_days": 365
        }),
        serde_json::json!({
            "type_id": "CONSENT-TELEMEDICINE",
            "name": "Telemedicine Consent",
            "description": "Consent for virtual/remote care",
            "required_for": ["telemedicine"],
            "expires_after_days": 365
        }),
        serde_json::json!({
            "type_id": "CONSENT-IMAGING",
            "name": "Imaging/Radiology Consent",
            "description": "Consent for diagnostic imaging procedures",
            "required_for": ["imaging"],
            "expires_after_days": 30
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "consent_types": consent_types,
        "total": consent_types.len()
    }))
}

/// How long a consent grant lasts when the caller doesn't specify.
///
/// Previously an unexplained inline `365`. Still a default rather than a
/// policy engine, but named so it can be found and changed deliberately.
const DEFAULT_CONSENT_VALIDITY_DAYS: i64 = 365;

/// Request body for `sign_consent`.
///
/// Replaces the previous untyped `serde_json::Value`, which silently accepted
/// anything and recorded a hardcoded affirmative consent regardless of what was
/// sent. Every lawful-basis field is `Option` so pre-migration callers (the
/// current frontend) keep working — absent values fall back to the ordinary
/// clinical-care grounds and are logged, so un-migrated callers stay findable
/// rather than becoming invisible.
#[derive(Debug, serde::Deserialize)]
pub struct SignConsentRequest {
    /// Accepts either `type_id` or `consent_type` — both spellings were in use.
    #[serde(alias = "consent_type")]
    pub type_id: Option<String>,
    pub patient_id: Option<String>,
    /// Whether consent was actually given. Absent means granted, matching the
    /// previous hardcoded behaviour of this endpoint.
    pub consent_given: Option<bool>,
    pub popia_section_11_basis: Option<PopiaSection11Basis>,
    pub special_information_basis: Option<SpecialInformationBasis>,
    pub child_information_basis: Option<ChildInformationBasis>,
    pub consent_giver_capacity: Option<ConsentGiverCapacity>,
    pub privacy_notice_version: Option<String>,
    pub emergency_basis: Option<EmergencyBasis>,
    pub emergency_justification: Option<String>,
    pub scope_description: Option<String>,
    pub purpose: Option<String>,
    pub expires_in_days: Option<i64>,
    /// Clinician's finding that a child of 12+ has sufficient maturity to
    /// consent to their own treatment. Required when `consent_giver_capacity`
    /// is `child_over_12_mature`.
    pub child_maturity_assessment: Option<String>,
}

/// Sign a consent form
///
/// Records the POPIA lawful basis for the processing, not merely a boolean.
/// See `crate::types::legal_basis` and `docs/PRODUCTION_READINESS_GATES.md` §2.
#[post("/api/consent/sign")]
pub async fn sign_consent(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<SignConsentRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            })
        }
    };

    let consent_type = body
        .type_id
        .clone()
        .unwrap_or_else(|| "UNKNOWN".to_string());
    let patient_id = body
        .patient_id
        .clone()
        .unwrap_or_else(|| current_user_id.clone());

    // Auth check: patient, Admin, or a guardian holding the GiveConsent
    // permission specifically (Horizon HZ-008 — previously only the patient's
    // own account or an Admin override could sign; there was no
    // representation of a minor/dependant/incapacitated patient's guardian at
    // all). A guardian with e.g. view-only access is *not* sufficient here —
    // the permission-granular repository lets this be checked precisely,
    // unlike the old boolean "is an active guardian" check.
    // `collector_id`/`collector_name` below already stamp the actual caller,
    // so a guardian-signed consent is attributed to the guardian, not
    // silently to the patient.
    //
    // Resolved (rather than merely checked) so a guardian-authorised consent
    // can cite *which* relationship authorised it — POPIA needs the authority
    // evidenced, not just the access permitted.
    let access = crate::support::resolve_patient_access(
        &data,
        &current_user,
        &patient_id,
        crate::repositories::traits::GuardianPermission::ConsentToDataProcessing,
    )
    .await;

    if !access.is_permitted() {
        return HttpResponse::Forbidden().finish();
    }

    // Recording new consent is new processing, so a retention restriction
    // blocks it. Placed after the access check so an unauthorised caller learns
    // nothing about whether the patient is restricted.
    if let Err(resp) = crate::support::ensure_not_restricted(&data, &patient_id).await {
        return resp;
    }

    let emergency_basis = body.emergency_basis.unwrap_or(EmergencyBasis::None);
    // An emergency override with no recorded reason is unauditable — this is
    // the one lawful-basis field that is rejected rather than defaulted.
    if emergency_basis.requires_justification()
        && body
            .emergency_justification
            .as_ref()
            .map(|j| j.trim().is_empty())
            .unwrap_or(true)
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "emergency_justification is required when emergency_basis is not 'none'"
                .to_string(),
            code: "EMERGENCY_JUSTIFICATION_REQUIRED".to_string(),
        });
    }

    // Fall back to the ordinary clinical-care grounds when a caller predates
    // this schema, and say so in the log rather than silently inventing a
    // lawful basis.
    let section_11_basis = body.popia_section_11_basis.unwrap_or_else(|| {
        log::warn!(
            "consent {} for patient {} recorded without an explicit POPIA s11 basis; \
             defaulting to 'consent'. Caller should be updated to send one.",
            consent_type,
            patient_id
        );
        PopiaSection11Basis::Consent
    });
    let special_basis = body
        .special_information_basis
        .unwrap_or(SpecialInformationBasis::S32Treatment);

    // Capacity: trust an explicit value, otherwise infer from how access was
    // actually resolved above.
    let capacity = body.consent_giver_capacity.unwrap_or(match &access {
        crate::support::PatientAccessGrant::Guardian(_) => ConsentGiverCapacity::Guardian,
        _ => ConsentGiverCapacity::SelfCapacity,
    });

    let authority_evidence_id = access.authority_evidence_id().map(|s| s.to_string());

    // A third-party capacity with no recorded guardian relationship is exactly
    // the gap the legal review flagged — refuse rather than record an
    // unevidenced claim of authority.
    if capacity.requires_authority_evidence() && authority_evidence_id.is_none() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: format!(
                "consent_giver_capacity '{}' requires a verified guardian relationship \
                 authorising this caller for this patient",
                capacity.as_str()
            ),
            code: "GUARDIAN_AUTHORITY_EVIDENCE_REQUIRED".to_string(),
        });
    }

    // Children's Act §129. The patient's age is resolved once and reused: it
    // decides both whether a claimed mature-minor capacity is real and which
    // child ground applies.
    let patient_age = crate::support::patient_age_years(&data, &patient_id).await;
    let treatment_capacity = crate::support::treatment_consent_capacity(patient_age);

    // A claim of mature-minor capacity used to be accepted on the caller's word
    // alone — the enum value existed and nothing checked it. Both halves of the
    // §129 test are now required: the age (verified here from the patient's
    // date of birth) and the maturity finding (which no amount of data can
    // establish, so it must be recorded by the clinician).
    if capacity == ConsentGiverCapacity::ChildOver12Mature {
        if treatment_capacity != crate::support::TreatmentConsentCapacity::MatureChildEligible {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: format!(
                    "consent_giver_capacity 'child_over_12_mature' is not available for this \
                     patient: Children's Act s129 requires an age of at least {} years, and \
                     the patient's recorded age is {}",
                    crate::support::CHILD_SELF_CONSENT_MIN_AGE_YEARS,
                    patient_age
                        .map(|a| a.to_string())
                        .unwrap_or_else(|| "indeterminable".to_string())
                ),
                code: "CHILD_SELF_CONSENT_AGE_NOT_MET".to_string(),
            });
        }
        if body
            .child_maturity_assessment
            .as_ref()
            .map(|a| a.trim().is_empty())
            .unwrap_or(true)
        {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "child_maturity_assessment is required when consent_giver_capacity is \
                        'child_over_12_mature': age alone does not establish capacity under \
                        Children's Act s129"
                    .to_string(),
                code: "CHILD_MATURITY_ASSESSMENT_REQUIRED".to_string(),
            });
        }
    }

    // A child under 12 cannot consent for themselves at all — a competent
    // person must. Without this, a patient account belonging to a young child
    // could self-sign consent that no statute supports.
    if capacity == ConsentGiverCapacity::SelfCapacity
        && treatment_capacity == crate::support::TreatmentConsentCapacity::CompetentPersonRequired
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: format!(
                "a patient under {} may not consent for themselves; a parent, guardian, or \
                 other competent person must consent on their behalf",
                crate::support::CHILD_SELF_CONSENT_MIN_AGE_YEARS
            ),
            code: "COMPETENT_PERSON_REQUIRED".to_string(),
        });
    }

    // POPIA ss.34-35 layer on top of the health-data authorisation for a
    // minor, so the child ground is derived from the patient's actual age
    // rather than trusted from the request.
    let child_basis = match body.child_information_basis {
        Some(explicit) => explicit,
        // A mature child consenting for themselves is NOT competent-person
        // consent — that value would assert a parent or guardian consented,
        // which is false. Recorded distinctly so the two never collapse.
        None if capacity == ConsentGiverCapacity::ChildOver12Mature => {
            ChildInformationBasis::S129MatureChildSelfConsent
        }
        None => match treatment_capacity {
            crate::support::TreatmentConsentCapacity::Adult => ChildInformationBasis::NotApplicable,
            // Unknown age (undecryptable or absent DOB): don't guess that the
            // subject is an adult — leaving it not_applicable would assert
            // something unverified. Log and treat as the safer child ground.
            crate::support::TreatmentConsentCapacity::AgeUnknown => {
                log::warn!(
                    "consent {} for patient {}: age indeterminable, applying s35 child \
                     ground conservatively",
                    consent_type,
                    patient_id
                );
                ChildInformationBasis::S35CompetentPersonConsent
            }
            _ => ChildInformationBasis::S35CompetentPersonConsent,
        },
    };

    let granted = body.consent_given.unwrap_or(true);
    let consent_status = if granted {
        ConsentStatus::Granted
    } else {
        ConsentStatus::Refused
    };

    let consent_id = format!(
        "CONS-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("000")
    );
    let now = chrono::Utc::now();
    let validity_days = body
        .expires_in_days
        .unwrap_or(DEFAULT_CONSENT_VALIDITY_DAYS);

    let entity = ConsentRecordEntity {
        id: consent_id,
        patient_id: patient_id.clone(),
        consent_type: consent_type.clone(),
        // Derived, never set independently — see ConsentStatus::as_legacy_bool.
        consent_given: consent_status.as_legacy_bool(),
        consent_datetime: now,
        expiration_datetime: Some(now + chrono::Duration::days(validity_days)),
        scope_description: body.scope_description.clone(),
        data_types_covered: None,
        purpose: body.purpose.clone(),
        recipient_organization: None,
        collection_method: Some("electronic_signature".to_string()),
        witness_name: None,
        witness_signature: None,
        collector_id: Some(current_user_id.clone()),
        collector_name: Some(current_user.name.clone()),
        revoked: Some(false),
        revoked_datetime: None,
        revocation_reason: None,
        revoked_by: None,
        document_url: None,
        document_ipfs_hash: None,
        regulatory_requirement: None,
        version: None,
        created_at: Some(now),
        updated_at: Some(now),
        popia_section_11_basis: section_11_basis.as_str().to_string(),
        special_information_basis: special_basis.as_str().to_string(),
        child_information_basis: child_basis.as_str().to_string(),
        // Consent is only "required" when it is the operative s11 ground.
        consent_required: matches!(section_11_basis, PopiaSection11Basis::Consent),
        consent_status: consent_status.as_str().to_string(),
        consent_given_by: Some(current_user_id.clone()),
        consent_giver_capacity: Some(capacity.as_str().to_string()),
        guardian_authority_evidence_id: authority_evidence_id,
        privacy_notice_version: body.privacy_notice_version.clone(),
        emergency_basis: emergency_basis.as_str().to_string(),
        emergency_justification: body.emergency_justification.clone(),
        child_maturity_assessment: body.child_maturity_assessment.clone(),
        // Attributed to the caller who signed, not to the child: the maturity
        // finding is the clinician's, and it has to be reviewable against a
        // named assessor.
        child_maturity_assessed_by: body
            .child_maturity_assessment
            .as_ref()
            .map(|_| current_user_id.clone()),
    };

    match data.repositories.consent_records.create(entity).await {
        Ok(created) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "consent_id": created.id,
            "consent": {
                "consent_id": created.id,
                "consent_type": created.consent_type,
                "patient_id": created.patient_id,
                "signed_at": created.consent_datetime.timestamp(),
                "expires_at": created.expiration_datetime.map(|d| d.timestamp()),
                "status": created.consent_status,
                "popia_section_11_basis": created.popia_section_11_basis,
                "special_information_basis": created.special_information_basis,
                "child_information_basis": created.child_information_basis,
                "consent_giver_capacity": created.consent_giver_capacity,
                "guardian_authority_evidence_id": created.guardian_authority_evidence_id,
                "emergency_basis": created.emergency_basis
            },
            "message": "Consent signed and recorded"
        })),
        Err(e) => {
            log::error!(
                "Failed to persist consent for patient {}: {}",
                patient_id,
                e
            );
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Failed to save consent".to_string(),
                code: "REPOSITORY_ERROR".to_string(),
            })
        }
    }
}

/// Get patient consents
#[get("/api/consent/patient/{patient_id}")]
pub async fn get_patient_consents(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let patient_id = path.into_inner();
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    // Horizon HZ-024: a "0xPROV" id prefix is not authorization — see the note
    // in `download_offline_data`. Resolve the role from the user store.
    let is_provider = crate::get_user(&data, &current_user_id)
        .is_some_and(|user| user.role.is_healthcare_provider());
    if !crate::support::caller_owns_patient_record(&data, &current_user_id, &patient_id)
        && !is_provider
    {
        return HttpResponse::Forbidden().finish();
    }

    let records = data
        .repositories
        .consent_records
        .get_by_patient(&patient_id)
        .await
        .unwrap_or_default();

    let consents: Vec<serde_json::Value> = records
        .iter()
        .filter(|c| !c.revoked.unwrap_or(false))
        .map(|c| {
            // Report the recorded lawful basis, not just "active". A consent
            // record whose whole purpose is to evidence *why* processing is
            // lawful is not much use if the API only ever says "active".
            let integrity = c.validate_lawful_basis();
            if let Err(problems) = &integrity {
                log::warn!(
                    "consent record {} has lawful-basis integrity problems: {}",
                    c.id,
                    problems.join("; ")
                );
            }

            serde_json::json!({
                "consent_id": c.id,
                "consent_type": c.consent_type,
                "signed_at": c.consent_datetime.timestamp(),
                "expires_at": c.expiration_datetime.map(|d| d.timestamp()),
                "status": c.consent_status,
                "popia_section_11_basis": c.popia_section_11_basis,
                "special_information_basis": c.special_information_basis,
                "child_information_basis": c.child_information_basis,
                "consent_giver_capacity": c.consent_giver_capacity,
                "guardian_authority_evidence_id": c.guardian_authority_evidence_id,
                "emergency_basis": c.emergency_basis,
                // Present only when something is wrong, so a clean record's
                // response shape is unchanged.
                "integrity_problems": integrity.err(),
            })
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "consents": consents,
        "total": consents.len()
    }))
}

// ============================================================================
// BARCODE/SAMPLE TRACKING (Simulation)
// ============================================================================

/// Generate a barcode for specimen tracking
#[post("/api/barcode/generate")]
pub async fn generate_barcode(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
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

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let entity_type = body
        .get("entity_type")
        .and_then(|e| e.as_str())
        .unwrap_or("specimen");
    let entity_id = body
        .get("entity_id")
        .and_then(|e| e.as_str())
        .unwrap_or("UNKNOWN");
    let patient_id = body.get("patient_id").and_then(|p| p.as_str());

    let barcode_id = format!(
        "BC-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .replace("-", "")
            .chars()
            .take(12)
            .collect::<String>()
            .to_uppercase()
    );

    // Generate barcode value (Code 128 compatible)
    let barcode_value = format!(
        "MC{}{:06}",
        match entity_type {
            "specimen" => "SP",
            "medication" => "MED",
            "patient" => "PAT",
            "equipment" => "EQ",
            _ => "XX",
        },
        chrono::Utc::now().timestamp() % 1000000
    );

    let barcode = serde_json::json!({
        "barcode_id": barcode_id,
        "barcode_value": barcode_value,
        "barcode_type": "CODE128",
        "entity_type": entity_type,
        "entity_id": entity_id,
        "patient_id": patient_id,
        "generated_by": current_user.wallet_address,
        "generated_at": chrono::Utc::now().timestamp(),
        "status": "active",
        "scan_count": 0
    });

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "barcode": barcode,
        "message": "Barcode generated successfully"
    }))
}

/// Scan a barcode and get entity information
#[post("/api/barcode/scan")]
pub async fn scan_barcode(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
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

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let barcode_value = match body.get("barcode_value").and_then(|b| b.as_str()) {
        Some(b) => b,
        None => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "barcode_value is required".to_string(),
                code: "MISSING_FIELD".to_string(),
            })
        }
    };

    let location = body.get("location").and_then(|l| l.as_str());

    // Horizon HZ-023: this used to invent an entity from the barcode's text —
    // a specimen "for John Doe", a medication "Amoxicillin 500mg for Jane
    // Smith" — attaching fabricated patient names to a real scan. The prefix
    // now classifies the barcode's *kind* only, which is all the value itself
    // can honestly tell us; anything more must come from a lookup that does
    // not yet exist, and is reported as unresolved rather than guessed.
    let entity_type = if barcode_value.contains("SP") {
        "specimen"
    } else if barcode_value.contains("MED") {
        "medication"
    } else {
        "unknown"
    };
    let entity_info = serde_json::json!({
        "type": entity_type,
        "id": barcode_value,
        "resolved": false,
        "note": "Barcode registry lookup is not implemented; only the barcode kind is inferred."
    });

    let scanned_at = chrono::Utc::now();
    let scan = serde_json::json!({
        "scan_id": format!("SCAN-{}", uuid::Uuid::new_v4()),
        "barcode_value": barcode_value,
        "entity_type": entity_type,
        "location": location,
        "scanned_by": current_user.wallet_address,
        "scanned_by_name": current_user.name,
        "scanned_by_role": current_user.role.to_string(),
        "scanned_at": scanned_at.timestamp(),
        "scanned_at_iso": scanned_at.to_rfc3339(),
    });
    if let Err(e) = data
        .repositories
        .barcode_scans
        .create(crate::repositories::traits::JsonRecordEntity {
            id: scan
                .get("scan_id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            owner_id: current_user.wallet_address.clone(),
            data: scan.clone(),
            created_at: scanned_at,
            updated_at: scanned_at,
        })
        .await
    {
        // The scan is the custody evidence — if it cannot be recorded, say so
        // rather than reporting a successful scan that left no trace.
        log::error!("barcode scan persist failed: {}", e);
        return HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: "Could not record the scan".to_string(),
            code: "SCAN_WRITE_FAILED".to_string(),
        });
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "barcode_value": barcode_value,
        "entity_info": entity_info,
        "location": location,
        "scanned_at": scanned_at.timestamp()
    }))
}

/// A barcode's chain of custody, assembled from the scans actually recorded.
///
/// Horizon HZ-023: this used to return an invented custody chain — steps
/// attributed to "Dr. Smith", "Nurse Jones" and "Lab Tech Brown", none of whom
/// performed them — for any barcode id. A chain of custody is a forensic and
/// legal artifact, so it is now built strictly from recorded scan events and an
/// unscanned barcode honestly returns an empty chain.
#[get("/api/barcode/{barcode_id}/history")]
pub async fn track_barcode(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => return HttpResponse::Unauthorized().finish(),
    };
    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }
    let barcode_id = path.into_inner();

    // Scans are owned by the scanning user, so a specimen's full chain spans
    // owners and must be assembled by barcode value across all of them.
    let all = match data.repositories.barcode_scans.list_all().await {
        Ok(r) => r,
        Err(e) => {
            log::error!("barcode history load failed: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Could not load barcode history".to_string(),
                code: "SCAN_READ_FAILED".to_string(),
            });
        }
    };
    let mut history: Vec<serde_json::Value> = all
        .into_iter()
        .map(|r| r.data)
        .filter(|d| d.get("barcode_value").and_then(|v| v.as_str()) == Some(barcode_id.as_str()))
        .collect();
    history.sort_by_key(|s| s.get("scanned_at").and_then(|v| v.as_i64()));

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "barcode_id": barcode_id,
        "history": history,
        "count": history.len()
    }))
}

/// Recent scans performed by the calling user.
///
/// Horizon HZ-023: previously a fixed invented list returned to everyone.
#[get("/api/barcode/scans/my")]
pub async fn get_barcode_scan_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let records = match data
        .repositories
        .barcode_scans
        .get_by_owner(&current_user_id)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            log::error!("scan history load failed for {}: {}", current_user_id, e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Could not load scan history".to_string(),
                code: "SCAN_READ_FAILED".to_string(),
            });
        }
    };
    let mut scan_history: Vec<serde_json::Value> = records.into_iter().map(|r| r.data).collect();
    scan_history.sort_by_key(|s| std::cmp::Reverse(s.get("scanned_at").and_then(|v| v.as_i64())));

    HttpResponse::Ok().json(scan_history)
}

// ============================================================================
// QUICK NOTE TEMPLATES
// ============================================================================

/// Get available note templates
#[get("/api/templates/notes")]
pub async fn get_note_templates(
    data: web::Data<AppState>,
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

    let templates = vec![
        // SOAP Note Templates
        serde_json::json!({
            "template_id": "TPL-SOAP-ROUTINE",
            "name": "Routine Follow-up SOAP",
            "category": "SOAP",
            "content": {
                "subjective": "Patient presents for routine follow-up. Reports [SYMPTOMS]. Denies [NEGATIVE_SYMPTOMS]. Medications are being taken as prescribed.",
                "objective": "VS: BP [BP], HR [HR], RR [RR], Temp [TEMP], SpO2 [SPO2]. General: Alert and oriented, no acute distress. [SYSTEM_EXAM]",
                "assessment": "1. [PRIMARY_DIAGNOSIS] - [STATUS]\n2. [SECONDARY_DIAGNOSIS] - [STATUS]",
                "plan": "1. Continue current medications\n2. [ADDITIONAL_ORDERS]\n3. Follow-up in [TIMEFRAME]"
            }
        }),
        serde_json::json!({
            "template_id": "TPL-SOAP-ED",
            "name": "Emergency Department SOAP",
            "category": "SOAP",
            "content": {
                "subjective": "Chief Complaint: [CC]\nHPI: [AGE] y/o [SEX] presents with [SYMPTOMS] x [DURATION]. Onset: [ONSET]. Quality: [QUALITY]. Severity: [SEVERITY]/10. Associated symptoms: [ASSOCIATED]. Denies: [PERTINENT_NEGATIVES].",
                "objective": "VS: BP [BP], HR [HR], RR [RR], Temp [TEMP], SpO2 [SPO2]\nGeneral: [GENERAL]\nHEENT: [HEENT]\nCardio: [CARDIO]\nPulm: [PULM]\nAbd: [ABD]\nExt: [EXT]\nNeuro: [NEURO]",
                "assessment": "1. [DIAGNOSIS] - [DIFFERENTIAL_CONSIDERATIONS]",
                "plan": "1. [WORKUP]\n2. [TREATMENT]\n3. [DISPOSITION]"
            }
        }),
        // H&P Templates
        serde_json::json!({
            "template_id": "TPL-HP-ADMISSION",
            "name": "Admission H&P",
            "category": "H&P",
            "content": {
                "chief_complaint": "[CC]",
                "hpi": "[AGE] y/o [SEX] with PMH of [PMH] presenting with [SYMPTOMS]...",
                "pmh": "[PMH_LIST]",
                "psh": "[SURGICAL_HISTORY]",
                "medications": "[MEDICATION_LIST]",
                "allergies": "[ALLERGY_LIST]",
                "social_history": "Smoking: [SMOKING]\nAlcohol: [ALCOHOL]\nDrugs: [DRUGS]\nOccupation: [OCCUPATION]",
                "family_history": "[FAMILY_HISTORY]",
                "ros": "Constitutional: [CONST]\nCardiovascular: [CV]\nRespiratory: [RESP]\nGI: [GI]\nGU: [GU]\nMSK: [MSK]\nNeuro: [NEURO]\nPsych: [PSYCH]",
                "physical_exam": "[EXAM_FINDINGS]",
                "assessment_plan": "[ASSESSMENT_AND_PLAN]"
            }
        }),
        // Procedure Notes
        serde_json::json!({
            "template_id": "TPL-PROC-CENTRAL",
            "name": "Central Line Procedure Note",
            "category": "Procedure",
            "content": {
                "procedure": "Central Venous Catheter Placement",
                "indication": "[INDICATION]",
                "consent": "Informed consent obtained",
                "site": "[SITE] - [IJ/SC/FEMORAL]",
                "technique": "Sterile technique with full barrier precautions. Ultrasound-guided. Local anesthesia with [LIDOCAINE_DOSE]. [CATHETER_TYPE] catheter placed using Seldinger technique. [ATTEMPTS] attempt(s). Blood aspirated from all ports. Catheter secured at [CM] cm.",
                "complications": "[NONE/COMPLICATIONS]",
                "post_procedure": "CXR ordered for placement confirmation",
                "attending": "[ATTENDING_NAME]"
            }
        }),
        serde_json::json!({
            "template_id": "TPL-PROC-LP",
            "name": "Lumbar Puncture Procedure Note",
            "category": "Procedure",
            "content": {
                "procedure": "Lumbar Puncture",
                "indication": "[INDICATION]",
                "consent": "Informed consent obtained",
                "position": "[LATERAL_DECUBITUS/SITTING]",
                "site": "[L3-L4/L4-L5]",
                "technique": "Sterile technique. Local anesthesia with [LIDOCAINE]. [NEEDLE_SIZE] spinal needle. Opening pressure: [OP] cm H2O. [VOLUME] mL CSF collected in [TUBES] tubes.",
                "csf_appearance": "[CLEAR/CLOUDY/BLOODY/XANTHOCHROMIC]",
                "closing_pressure": "[CP] cm H2O",
                "complications": "[NONE/COMPLICATIONS]",
                "post_procedure": "Patient instructed to remain supine for [DURATION]"
            }
        }),
        // Discharge Templates
        serde_json::json!({
            "template_id": "TPL-DC-STANDARD",
            "name": "Standard Discharge Summary",
            "category": "Discharge",
            "content": {
                "admission_date": "[ADMIT_DATE]",
                "discharge_date": "[DC_DATE]",
                "admitting_diagnosis": "[ADMIT_DX]",
                "discharge_diagnoses": "[DC_DX_LIST]",
                "hospital_course": "[COURSE_SUMMARY]",
                "discharge_condition": "[STABLE/IMPROVED]",
                "discharge_medications": "[NEW_MED_LIST]",
                "follow_up_instructions": "[FOLLOW_UP_PLAN]"
            }
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "templates": templates,
        "count": templates.len()
    }))
}

/// Use a template to generate a note
#[post("/api/templates/notes/use")]
pub async fn use_note_template(
    // Was `_data`. Clinical note templates are staff tooling, so this now
    // resolves the caller and requires a clinical role rather than accepting
    // any request that carries a header.
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    if let Err(resp) = crate::support::require_clinical_staff(&data, &http_req) {
        return resp;
    }

    let template_id = body
        .get("template_id")
        .and_then(|v| v.as_str())
        .unwrap_or("UNKNOWN");
    let variables = body.get("variables").and_then(|v| v.as_object());

    // Simple template variable replacement logic (Simulated)
    let generated_note = format!(
        "Generated note from template {} with {} variables filled.",
        template_id,
        variables.map(|v| v.len()).unwrap_or(0)
    );

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "template_id": template_id,
        "generated_note": generated_note,
        "timestamp": chrono::Utc::now().timestamp()
    }))
}
