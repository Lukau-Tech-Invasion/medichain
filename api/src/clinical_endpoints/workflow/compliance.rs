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

async fn anchor_consent_on_chain(
    data: &web::Data<AppState>,
    patient_account: Option<&str>,
    consent_id: &str,
    accessor_id: &str,
    access_type: &str,
) -> Result<(String, Option<String>), String> {
    if !crate::blockchain::blockchain_enabled() {
        return Ok(("disabled".to_string(), None));
    }
    let account = patient_account.ok_or("patient has no blockchain wallet")?;
    let outcome = crate::audit_outbox::anchor_access_or_queue(
        data,
        "consent",
        consent_id,
        account,
        accessor_id,
        access_type,
    )
    .await?;
    Ok((outcome.status, outcome.transaction_hash))
}

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

/// The lawful basis a consent record is written under.
///
/// POPIA wants the grounds evidenced, not a boolean, so these five travel
/// together: the four grounds and the evidence for the signer's authority.
struct ConsentAuthority {
    emergency_basis: EmergencyBasis,
    section_11_basis: PopiaSection11Basis,
    special_basis: SpecialInformationBasis,
    capacity: ConsentGiverCapacity,
    authority_evidence_id: Option<String>,
}

/// Work out what lawful basis this consent is recorded under, or refuse.
///
/// Separated from `sign_consent` so the legal determination reads as one thing.
/// Every default here is a claim about the law, and each is deliberate:
///
/// * `emergency_basis` defaults to none, and an override *without* a recorded
///   reason is rejected rather than defaulted — an unjustified emergency
///   override is unauditable, which is the one thing this record exists to
///   prevent.
/// * `section_11_basis` falls back to ordinary consent for callers that predate
///   the field, and says so in the log rather than silently inventing grounds.
/// * `capacity` is trusted when stated and otherwise inferred from how the
///   caller's access actually resolved, so a guardian-signed consent is
///   attributed to the guardian.
fn resolve_consent_authority(
    body: &SignConsentRequest,
    access: &crate::support::PatientAccessGrant,
    consent_type: &str,
    patient_id: &str,
) -> Result<ConsentAuthority, HttpResponse> {
    let emergency_basis = body.emergency_basis.unwrap_or(EmergencyBasis::None);
    if emergency_basis.requires_justification()
        && body
            .emergency_justification
            .as_ref()
            .map(|j| j.trim().is_empty())
            .unwrap_or(true)
    {
        return Err(HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "emergency_justification is required when emergency_basis is not 'none'"
                .to_string(),
            code: "EMERGENCY_JUSTIFICATION_REQUIRED".to_string(),
        }));
    }

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

    let capacity = body.consent_giver_capacity.unwrap_or(match access {
        crate::support::PatientAccessGrant::Guardian(_) => ConsentGiverCapacity::Guardian,
        _ => ConsentGiverCapacity::SelfCapacity,
    });

    Ok(ConsentAuthority {
        emergency_basis,
        section_11_basis,
        special_basis,
        capacity,
        authority_evidence_id: access.authority_evidence_id().map(|s| s.to_string()),
    })
}

/// The Children's Act §129 test on who may sign this consent, or `None` when
/// the signer may proceed.
///
/// Both halves of the mature-minor test are required. A claim of mature-minor
/// capacity used to be accepted on the caller's word alone — the enum value
/// existed and nothing checked it. The age is settled by the patient's date of
/// birth; the maturity finding is not something any amount of data can
/// establish, so a clinician must have recorded it.
///
/// And a child under 12 may not consent for themselves at all. Without that
/// check, a patient account belonging to a young child could self-sign consent
/// that no statute supports.
///
/// Lifted out of `sign_consent` because it is one legal question with one
/// answer, and reading it should not mean reading a request handler.
fn child_capacity_refusal(
    capacity: ConsentGiverCapacity,
    treatment_capacity: crate::support::TreatmentConsentCapacity,
    patient_age: Option<u32>,
    child_maturity_assessment: Option<&str>,
) -> Option<HttpResponse> {
    if capacity == ConsentGiverCapacity::ChildOver12Mature {
        if treatment_capacity != crate::support::TreatmentConsentCapacity::MatureChildEligible {
            return Some(HttpResponse::BadRequest().json(ErrorResponse {
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
            }));
        }
        if child_maturity_assessment
            .map(|a| a.trim().is_empty())
            .unwrap_or(true)
        {
            return Some(
                HttpResponse::BadRequest().json(ErrorResponse {
                    success: false,
                    error: "child_maturity_assessment is required when consent_giver_capacity is \
                        'child_over_12_mature': age alone does not establish capacity under \
                        Children's Act s129"
                        .to_string(),
                    code: "CHILD_MATURITY_ASSESSMENT_REQUIRED".to_string(),
                }),
            );
        }
    }

    if capacity == ConsentGiverCapacity::SelfCapacity
        && treatment_capacity == crate::support::TreatmentConsentCapacity::CompetentPersonRequired
    {
        return Some(HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: format!(
                "a patient under {} may not consent for themselves; a parent, guardian, or \
                 other competent person must consent on their behalf",
                crate::support::CHILD_SELF_CONSENT_MIN_AGE_YEARS
            ),
            code: "COMPETENT_PERSON_REQUIRED".to_string(),
        }));
    }

    None
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

    let ConsentAuthority {
        emergency_basis,
        section_11_basis,
        special_basis,
        capacity,
        authority_evidence_id,
    } = match resolve_consent_authority(&body, &access, &consent_type, &patient_id) {
        Ok(authority) => authority,
        Err(refusal) => return refusal,
    };

    let patient_chain_account = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(patient) => patient.wallet_address,
        Err(_) if crate::blockchain::blockchain_enabled() => {
            return HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: "Patient must have a wallet-bound record before consent can be anchored"
                    .to_string(),
                code: "PATIENT_WALLET_REQUIRED".to_string(),
            });
        }
        Err(_) => None,
    };
    if crate::blockchain::blockchain_enabled() && patient_chain_account.is_none() {
        return HttpResponse::Conflict().json(ErrorResponse {
            success: false,
            error: "Patient must have a wallet-bound record before consent can be anchored"
                .to_string(),
            code: "PATIENT_WALLET_REQUIRED".to_string(),
        });
    }

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

    if let Some(refusal) = child_capacity_refusal(
        capacity,
        treatment_capacity,
        patient_age,
        body.child_maturity_assessment.as_deref(),
    ) {
        return refusal;
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
        Ok(created) => {
            let access_type = if created.consent_status == ConsentStatus::Granted.as_str() {
                "CONSENT_GRANT"
            } else {
                "CONSENT_REFUSAL"
            };
            let (chain_status, chain_tx_hash) = match anchor_consent_on_chain(
                &data,
                patient_chain_account.as_deref(),
                &created.id,
                &current_user_id,
                access_type,
            )
            .await
            {
                Ok(result) => result,
                Err(error) => {
                    log::error!(
                        "Consent {} could not be durably queued: {}",
                        created.id,
                        error
                    );
                    return HttpResponse::ServiceUnavailable().json(serde_json::json!({
                        "success": false,
                        "consent_id": created.id,
                        "error": "Consent was saved, but its blockchain audit could not be recorded or queued",
                        "code": "CONSENT_CHAIN_AUDIT_UNAVAILABLE"
                    }));
                }
            };
            let pending = chain_status == "pending";
            let payload = serde_json::json!({
            "success": true,
            "consent_id": created.id,
            "chain_status": chain_status,
            "blockchain_tx_hash": chain_tx_hash,
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
            });
            if pending {
                HttpResponse::Accepted().json(payload)
            } else {
                HttpResponse::Created().json(payload)
            }
        }
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

#[derive(Debug, Deserialize)]
pub struct RevokeConsentRequest {
    pub reason: Option<String>,
}

/// Withdraw a previously granted consent.
///
/// The authenticated patient, an authorised guardian, or an administrator may
/// withdraw consent. The repository transition is one-time so a stale retry
/// cannot silently rewrite the original withdrawal evidence.
#[post("/api/consent/{id}/revoke")]
pub async fn revoke_consent(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<RevokeConsentRequest>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(resp) => return resp,
    };
    let consent_id = path.into_inner();
    let existing = match data
        .repositories
        .consent_records
        .get_by_id(&consent_id)
        .await
    {
        Ok(record) => record,
        Err(_) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Consent record not found".to_string(),
                code: "CONSENT_NOT_FOUND".to_string(),
            })
        }
    };

    let access = crate::support::resolve_patient_access(
        &data,
        &caller,
        &existing.patient_id,
        crate::repositories::traits::GuardianPermission::ConsentToDataProcessing,
    )
    .await;
    if !access.is_permitted() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Not permitted to revoke this consent".to_string(),
            code: "CONSENT_REVOKE_FORBIDDEN".to_string(),
        });
    }

    match data
        .repositories
        .consent_records
        .revoke(&consent_id, &caller.wallet_address, body.reason.as_deref())
        .await
    {
        Ok(revoked) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "consent_id": revoked.id,
            "status": revoked.consent_status,
            "revoked_at": revoked.revoked_datetime.map(|time| time.timestamp()),
        })),
        Err(crate::repositories::traits::RepositoryError::Validation(_)) => {
            HttpResponse::Conflict().json(ErrorResponse {
                success: false,
                error: "Consent is no longer active".to_string(),
                code: "CONSENT_NOT_ACTIVE".to_string(),
            })
        }
        Err(error) => {
            log::error!("Consent revocation persistence failed: {error}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Consent records are temporarily unavailable".to_string(),
                code: "CONSENT_REPOSITORY_UNAVAILABLE".to_string(),
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

    let records = match data
        .repositories
        .consent_records
        .get_by_patient(&patient_id)
        .await
    {
        Ok(records) => records,
        Err(error) => {
            log::error!(
                "Failed to load consents for patient {}: {}",
                patient_id,
                error
            );
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Consent records are temporarily unavailable".to_string(),
                code: "CONSENT_REPOSITORY_UNAVAILABLE".to_string(),
            });
        }
    };

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

    let barcode_value = match body
        .get("barcode_value")
        // `BarcodePage` posts `barcode`; this read `barcode_value` and
        // defaulted, so every scan was recorded with an empty barcode —
        // a scan record that cannot say what was scanned.
        .or_else(|| body.get("barcode"))
        .and_then(|b| b.as_str())
    {
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
    // Smith" — attaching fabricated patient names to a real scan. It was then
    // reduced to classifying the barcode's *kind* from its prefix and
    // reporting `resolved: false`, which was honest but not useful.
    //
    // The lookup it said did not exist does: `SpecimenCollectionRepository`
    // has `get_by_barcode`. A scan now resolves against the real specimen
    // register, and falls back to the prefix classification only when the
    // barcode is genuinely unknown — still reported as unresolved, never
    // guessed.
    let specimen = data
        .repositories
        .specimen_collections
        .get_by_barcode(barcode_value)
        .await
        .unwrap_or(None);

    let (entity_type, entity_info) = match specimen {
        Some(specimen) => (
            "specimen",
            serde_json::json!({
                "type": "specimen",
                "id": specimen.id,
                "resolved": true,
                "patient_id": specimen.patient_id,
                "specimen_type": specimen.specimen_type,
                "submission_id": specimen.submission_id,
                "collected_at": specimen.collected_at.to_rfc3339(),
                "collected_by": specimen.collector_id
            }),
        ),
        None => {
            // Kind inferred from the prefix; nothing else is asserted.
            let kind = if barcode_value.contains("SP") {
                "specimen"
            } else if barcode_value.contains("MED") {
                "medication"
            } else {
                "unknown"
            };
            (
                kind,
                serde_json::json!({
                    "type": kind,
                    "id": barcode_value,
                    "resolved": false,
                    "note": "No registered specimen matches this barcode; only the \
                             barcode kind is inferred."
                }),
            )
        }
    };

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
    // The "Save history" toggle governs this write, which is the only one of
    // the five scanner settings with teeth. While it was a literal in the JSX
    // the panel was claiming a guarantee the system was not making: a
    // clinician who turned it off was still having every scan recorded.
    let save_history = data
        .repositories
        .scanner_settings
        .get_by_owner(&current_user.wallet_address)
        .await
        .ok()
        .and_then(|rows| rows.into_iter().next())
        .and_then(|row| row.data.get("saveHistory").and_then(|v| v.as_bool()))
        // Absent settings mean the clinician has never opened the panel, and
        // the panel's own default is on.
        .unwrap_or(true);

    if save_history {
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
            // The scan is the custody evidence — if it cannot be recorded, say
            // so rather than reporting a successful scan that left no trace.
            log::error!("barcode scan persist failed: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Could not record the scan".to_string(),
                code: "SCAN_WRITE_FAILED".to_string(),
            });
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "barcode_value": barcode_value,
        "entity_info": entity_info,
        "location": location,
        "scanned_at": scanned_at.timestamp(),
        "history_saved": save_history
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
            log::error!("scan history load failed: {e}");
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Could not load scan history".to_string(),
                code: "SCAN_READ_FAILED".to_string(),
            });
        }
    };
    // "Clear history" moves a marker rather than deleting scans (ADR-0005), so
    // the read is what enacts it: entries recorded before the clinician last
    // cleared are not in their list, and are still in the database for anyone
    // asking who handled a specimen.
    let cleared_at: Option<chrono::DateTime<chrono::Utc>> = data
        .repositories
        .scanner_settings
        .get_by_owner(&current_user_id)
        .await
        .ok()
        .and_then(|rows| rows.into_iter().next())
        .and_then(|row| {
            row.data
                .get("historyClearedAt")
                .and_then(|v| v.as_str())
                .and_then(|raw| chrono::DateTime::parse_from_rfc3339(raw).ok())
                .map(|d| d.with_timezone(&chrono::Utc))
        });

    let mut scan_history: Vec<serde_json::Value> = records
        .into_iter()
        .filter(|r| match cleared_at {
            Some(cutoff) => r.created_at > cutoff,
            None => true,
        })
        .map(|r| r.data)
        .collect();
    scan_history.sort_by_key(|s| std::cmp::Reverse(s.get("scanned_at").and_then(|v| v.as_i64())));

    HttpResponse::Ok().json(scan_history)
}

// ============================================================================
// Scanner preferences
// ============================================================================

/// One clinician's barcode scanner preferences.
///
/// The settings panel rendered five toggles whose `enabled` values were
/// literals in the JSX: nothing read them, nothing stored them, and the scan
/// path honoured none of them. `save_history` is the one with teeth — it
/// governs whether `scan_barcode` writes a durable record at all — so a toggle
/// that did nothing was claiming a guarantee the system was not making.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannerSettings {
    /// Scan as soon as a code is in frame, rather than on a press.
    pub auto_scan: bool,
    pub vibrate: bool,
    pub sound: bool,
    /// Keep scanning after a hit, for a run of specimens.
    pub continuous: bool,
    /// Write a durable scan record. Off means the scan still happens and is
    /// still audited where a clinical workflow requires it; what stops is this
    /// clinician's personal history list.
    pub save_history: bool,
}

impl Default for ScannerSettings {
    /// The defaults the panel used to draw as literals, so a clinician who has
    /// never opened settings sees exactly what they saw before.
    fn default() -> Self {
        Self {
            auto_scan: true,
            vibrate: true,
            sound: true,
            continuous: false,
            save_history: true,
        }
    }
}

/// Read this clinician's scanner settings.
///
/// Caller-scoped: there is no patient in a scanner preference and the screen
/// has no id to send, which rule 10 names as the right shape for exactly this.
#[get("/api/barcode/settings")]
pub async fn get_scanner_settings(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    match data
        .repositories
        .scanner_settings
        .get_by_owner(&current_user_id)
        .await
    {
        Ok(rows) => {
            let stored = rows.into_iter().next();
            let settings = stored
                .as_ref()
                .and_then(|r| serde_json::from_value::<ScannerSettings>(r.data.clone()).ok())
                .unwrap_or_default();
            let history_cleared_at = stored
                .as_ref()
                .and_then(|r| r.data.get("historyClearedAt").cloned())
                .unwrap_or(serde_json::Value::Null);
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "settings": settings,
                "historyClearedAt": history_cleared_at,
            }))
        }
        Err(e) => {
            log::error!("scanner settings read failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Scanner settings could not be read".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Save this clinician's scanner settings.
#[actix_web::put("/api/barcode/settings")]
pub async fn update_scanner_settings(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<ScannerSettings>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };
    let settings = req.into_inner();
    let now = chrono::Utc::now();

    // The clear marker is part of the same row and must survive a settings
    // save, or changing the sound toggle would silently restore a history the
    // clinician had cleared.
    let existing = data
        .repositories
        .scanner_settings
        .get_by_owner(&current_user_id)
        .await
        .ok()
        .and_then(|rows| rows.into_iter().next());
    let cleared_at = existing
        .as_ref()
        .and_then(|r| r.data.get("historyClearedAt").cloned())
        .unwrap_or(serde_json::Value::Null);

    let id = existing
        .as_ref()
        .map(|r| r.id.clone())
        .unwrap_or_else(|| format!("SCN-{}", uuid::Uuid::new_v4().simple()));
    let mut blob = serde_json::to_value(&settings).unwrap_or_default();
    if let Some(object) = blob.as_object_mut() {
        object.insert("historyClearedAt".into(), cleared_at);
    }
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: current_user_id.clone(),
        data: blob,
        created_at: existing.as_ref().map(|r| r.created_at).unwrap_or(now),
        updated_at: now,
    };

    // `create` is insert-or-replace by id (see JsonRecordRepository), which is
    // the singleton-per-clinician shape this row has.
    match data.repositories.scanner_settings.create(entity).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "settings": settings,
        })),
        Err(e) => {
            log::error!("scanner settings save failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Scanner settings could not be saved".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

/// Clear this clinician's scan history view.
///
/// # Why this does not delete anything
///
/// A barcode scan is the record of a clinician handling a specimen or a
/// medication. It is evidence, and ADR-0005 defers irreversible deletion
/// across this system for that reason. So "Clear history" moves a marker: the
/// scans stay, and this clinician's list starts again from now. Somebody
/// asking "who scanned this specimen" still gets an answer.
#[post("/api/barcode/history/clear")]
pub async fn clear_scan_history(
    data: web::Data<AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };
    let now = chrono::Utc::now();

    let existing = data
        .repositories
        .scanner_settings
        .get_by_owner(&current_user_id)
        .await
        .ok()
        .and_then(|rows| rows.into_iter().next());

    let id = existing
        .as_ref()
        .map(|r| r.id.clone())
        .unwrap_or_else(|| format!("SCN-{}", uuid::Uuid::new_v4().simple()));
    let mut blob = existing
        .as_ref()
        .map(|r| r.data.clone())
        .unwrap_or_else(|| serde_json::to_value(ScannerSettings::default()).unwrap_or_default());
    if let Some(object) = blob.as_object_mut() {
        object.insert(
            "historyClearedAt".into(),
            serde_json::json!(now.to_rfc3339()),
        );
    }
    let entity = crate::repositories::traits::JsonRecordEntity {
        id: id.clone(),
        owner_id: current_user_id.clone(),
        data: blob,
        created_at: existing.as_ref().map(|r| r.created_at).unwrap_or(now),
        updated_at: now,
    };

    // `create` is insert-or-replace by id (see JsonRecordRepository), which is
    // the singleton-per-clinician shape this row has.
    match data.repositories.scanner_settings.create(entity).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "historyClearedAt": now.to_rfc3339(),
            "message": "Your scan list starts from now. The scans themselves are kept.",
        })),
        Err(e) => {
            log::error!("scan history clear failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Scan history could not be cleared".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
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

    // Documenting clinicians use templates; administrators list them to retire
    // one. Other roles have no use for a note template.
    if !(current_user.role.can_edit_medical_records() || current_user.role.is_admin()) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Built-ins first, flagged read-only, then every active template a
    // clinician in this facility has saved. A failed read of the latter is an
    // error, not a shorter list: "no shared templates" would be a claim.
    let mut templates = builtin_note_templates();
    for template in &mut templates {
        template["built_in"] = serde_json::json!(true);
    }
    match super::note_templates::active_custom_templates(&data).await {
        Ok(custom) => templates.extend(custom),
        Err(error) => {
            log::error!("note template registry read failed: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                success: false,
                error: "Saved note templates could not be read".to_string(),
                code: "TEMPLATES_UNAVAILABLE".to_string(),
            });
        }
    }

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
        .unwrap_or_default();
    let variables = body.get("variables").and_then(|v| v.as_object());

    let sections = match note_template_sections(&data, template_id).await {
        Ok(Some(sections)) => sections,
        Ok(None) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Unknown note template".to_string(),
                code: "TEMPLATE_NOT_FOUND".to_string(),
            })
        }
        Err(error) => {
            log::error!("note template read failed: {error}");
            return HttpResponse::ServiceUnavailable().finish();
        }
    };
    let rendered_sections = render_sections(&sections, variables);
    // `rendered_content` keeps the object shape earlier clients read;
    // `rendered_sections` is the one to display, because an object does not
    // keep the order the sections were written in.
    let rendered_content: serde_json::Map<String, serde_json::Value> = rendered_sections
        .iter()
        .map(|section| {
            (
                section["title"].as_str().unwrap_or_default().to_string(),
                section["content"].clone(),
            )
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "template_id": template_id,
        "rendered_content": rendered_content,
        "rendered_sections": rendered_sections,
        "timestamp": chrono::Utc::now().timestamp()
    }))
}

/// The ordered `(title, text)` sections of a built-in or an active
/// clinician-authored template; `None` when the id names neither.
async fn note_template_sections(
    data: &web::Data<AppState>,
    template_id: &str,
) -> RepositoryResult<Option<Vec<(String, String)>>> {
    if let Some(sections) = builtin_sections(template_id) {
        return Ok(Some(sections));
    }
    let Some(template) =
        super::note_templates::find_active_custom_template(data, template_id).await?
    else {
        return Ok(None);
    };
    let sections = template["sections"]
        .as_array()
        .map(|sections| {
            sections
                .iter()
                .map(|section| {
                    (
                        section["title"].as_str().unwrap_or_default().to_string(),
                        section["content"].as_str().unwrap_or_default().to_string(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(Some(sections))
}

/// Whether `template_id` names a built-in, read-only template.
pub(super) fn is_builtin_note_template(template_id: &str) -> bool {
    note_template_content(template_id).is_some()
}

/// A built-in template: sections in the order a clinician writes them.
struct BuiltinTemplate {
    id: &'static str,
    name: &'static str,
    category: &'static str,
    sections: &'static [(&'static str, &'static str)],
}

/// The built-in note templates: the one definition the registry listing, the
/// `content` object and the renderer all read.
///
/// There used to be two copies -- one for `GET /api/templates/notes`, one in
/// the renderer -- and they had already drifted: the renderer's copy wrote the
/// Rust escape `\\n` where the other wrote `\n`, so a rendered draft showed a
/// literal backslash-n where the listed template showed a line break.
///
/// A table of ordered pairs rather than `json!` objects, because a JSON object
/// here keeps no order: every built-in SOAP note was served as Assessment,
/// Objective, Plan, Subjective.
const BUILTIN_NOTE_TEMPLATES: [BuiltinTemplate; 6] = [
    BuiltinTemplate {
        id: "TPL-SOAP-ROUTINE",
        name: "Routine Follow-up SOAP",
        category: "SOAP",
        sections: &[
            ("subjective", "Patient presents for routine follow-up. Reports [SYMPTOMS]. Denies [NEGATIVE_SYMPTOMS]. Medications are being taken as prescribed."),
            ("objective", "VS: BP [BP], HR [HR], RR [RR], Temp [TEMP], SpO2 [SPO2]. General: Alert and oriented, no acute distress. [SYSTEM_EXAM]"),
            ("assessment", "1. [PRIMARY_DIAGNOSIS] - [STATUS]\n2. [SECONDARY_DIAGNOSIS] - [STATUS]"),
            ("plan", "1. Continue current medications\n2. [ADDITIONAL_ORDERS]\n3. Follow-up in [TIMEFRAME]"),
        ],
    },
    BuiltinTemplate {
        id: "TPL-SOAP-ED",
        name: "Emergency Department SOAP",
        category: "SOAP",
        sections: &[
            ("subjective", "Chief Complaint: [CC]\nHPI: [AGE] y/o [SEX] presents with [SYMPTOMS] x [DURATION]. Onset: [ONSET]. Quality: [QUALITY]. Severity: [SEVERITY]/10. Associated symptoms: [ASSOCIATED]. Denies: [PERTINENT_NEGATIVES]."),
            ("objective", "VS: BP [BP], HR [HR], RR [RR], Temp [TEMP], SpO2 [SPO2]\nGeneral: [GENERAL]\nHEENT: [HEENT]\nCardio: [CARDIO]\nPulm: [PULM]\nAbd: [ABD]\nExt: [EXT]\nNeuro: [NEURO]"),
            ("assessment", "1. [DIAGNOSIS] - [DIFFERENTIAL_CONSIDERATIONS]"),
            ("plan", "1. [WORKUP]\n2. [TREATMENT]\n3. [DISPOSITION]"),
        ],
    },
    BuiltinTemplate {
        id: "TPL-HP-ADMISSION",
        name: "Admission H&P",
        category: "H&P",
        sections: &[
            ("chief_complaint", "[CC]"),
            ("hpi", "[AGE] y/o [SEX] with PMH of [PMH] presenting with [SYMPTOMS]..."),
            ("pmh", "[PMH_LIST]"),
            ("psh", "[SURGICAL_HISTORY]"),
            ("medications", "[MEDICATION_LIST]"),
            ("allergies", "[ALLERGY_LIST]"),
            ("social_history", "Smoking: [SMOKING]\nAlcohol: [ALCOHOL]\nDrugs: [DRUGS]\nOccupation: [OCCUPATION]"),
            ("family_history", "[FAMILY_HISTORY]"),
            ("ros", "Constitutional: [CONST]\nCardiovascular: [CV]\nRespiratory: [RESP]\nGI: [GI]\nGU: [GU]\nMSK: [MSK]\nNeuro: [NEURO]\nPsych: [PSYCH]"),
            ("physical_exam", "[EXAM_FINDINGS]"),
            ("assessment_plan", "[ASSESSMENT_AND_PLAN]"),
        ],
    },
    BuiltinTemplate {
        id: "TPL-PROC-CENTRAL",
        name: "Central Line Procedure Note",
        category: "Procedure",
        sections: &[
            ("procedure", "Central Venous Catheter Placement"),
            ("indication", "[INDICATION]"),
            ("consent", "Informed consent obtained"),
            ("site", "[SITE] - [IJ/SC/FEMORAL]"),
            ("technique", "Sterile technique with full barrier precautions. Ultrasound-guided. Local anesthesia with [LIDOCAINE_DOSE]. [CATHETER_TYPE] catheter placed using Seldinger technique. [ATTEMPTS] attempt(s). Blood aspirated from all ports. Catheter secured at [CM] cm."),
            ("complications", "[NONE/COMPLICATIONS]"),
            ("post_procedure", "CXR ordered for placement confirmation"),
            ("attending", "[ATTENDING_NAME]"),
        ],
    },
    BuiltinTemplate {
        id: "TPL-PROC-LP",
        name: "Lumbar Puncture Procedure Note",
        category: "Procedure",
        sections: &[
            ("procedure", "Lumbar Puncture"),
            ("indication", "[INDICATION]"),
            ("consent", "Informed consent obtained"),
            ("position", "[LATERAL_DECUBITUS/SITTING]"),
            ("site", "[L3-L4/L4-L5]"),
            ("technique", "Sterile technique. Local anesthesia with [LIDOCAINE]. [NEEDLE_SIZE] spinal needle. Opening pressure: [OP] cm H2O. [VOLUME] mL CSF collected in [TUBES] tubes."),
            ("csf_appearance", "[CLEAR/CLOUDY/BLOODY/XANTHOCHROMIC]"),
            ("closing_pressure", "[CP] cm H2O"),
            ("complications", "[NONE/COMPLICATIONS]"),
            ("post_procedure", "Patient instructed to remain supine for [DURATION]"),
        ],
    },
    BuiltinTemplate {
        id: "TPL-DC-STANDARD",
        name: "Standard Discharge Summary",
        category: "Discharge",
        sections: &[
            ("admission_date", "[ADMIT_DATE]"),
            ("discharge_date", "[DC_DATE]"),
            ("admitting_diagnosis", "[ADMIT_DX]"),
            ("discharge_diagnoses", "[DC_DX_LIST]"),
            ("hospital_course", "[COURSE_SUMMARY]"),
            ("discharge_condition", "[STABLE/IMPROVED]"),
            ("discharge_medications", "[NEW_MED_LIST]"),
            ("follow_up_instructions", "[FOLLOW_UP_PLAN]"),
        ],
    },
];

fn find_builtin(template_id: &str) -> Option<&'static BuiltinTemplate> {
    BUILTIN_NOTE_TEMPLATES
        .iter()
        .find(|template| template.id == template_id)
}

/// The listing shape: `content` for clients that read the object, and an
/// ordered `sections` array (the same shape clinician templates use) for
/// clients that display them.
fn builtin_note_templates() -> Vec<serde_json::Value> {
    BUILTIN_NOTE_TEMPLATES
        .iter()
        .map(|template| {
            let sections: Vec<serde_json::Value> = template
                .sections
                .iter()
                .enumerate()
                .map(|(index, (title, text))| {
                    serde_json::json!({
                        "sectionId": format!("{}-{title}", template.id),
                        "title": title,
                        "content": text,
                        "required": false,
                        "order": index + 1,
                    })
                })
                .collect();
            serde_json::json!({
                "template_id": template.id,
                "name": template.name,
                "category": template.category,
                "content": builtin_content(template),
                "sections": sections,
            })
        })
        .collect()
}

fn builtin_content(template: &BuiltinTemplate) -> serde_json::Value {
    serde_json::Value::Object(
        template
            .sections
            .iter()
            .map(|(title, text)| (title.to_string(), serde_json::json!(text)))
            .collect(),
    )
}

/// The body of a built-in template. Server-owned, so a caller cannot select an
/// arbitrary document shape by merely naming an id.
fn note_template_content(template_id: &str) -> Option<serde_json::Value> {
    find_builtin(template_id).map(builtin_content)
}

/// A built-in template's sections as ordered `(title, text)` pairs.
fn builtin_sections(template_id: &str) -> Option<Vec<(String, String)>> {
    find_builtin(template_id).map(|template| {
        template
            .sections
            .iter()
            .map(|(title, text)| (title.to_string(), text.to_string()))
            .collect()
    })
}

/// Fill each section's `[KEY]` placeholders from explicit variables.
///
/// A placeholder with no string variable stays as written, so the clinician
/// sees what is still to be completed rather than a guessed value.
fn render_sections(
    sections: &[(String, String)],
    variables: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Vec<serde_json::Value> {
    let empty = serde_json::Map::new();
    let variables = variables.unwrap_or(&empty);
    sections
        .iter()
        .map(|(title, content)| {
            serde_json::json!({
                "title": title,
                "content": substitute_placeholders(content, variables),
            })
        })
        .collect()
}

/// The rendered text of the section titled `title`.
#[cfg(test)]
fn rendered(sections: &[serde_json::Value], title: &str) -> String {
    sections
        .iter()
        .find(|section| section["title"] == title)
        .and_then(|section| section["content"].as_str())
        .unwrap_or_default()
        .to_string()
}

/// Replace each `[KEY]` in one left-to-right pass.
///
/// One pass, not a `replace` per variable: repeated replacement would rewrite a
/// clinician's own value when it happens to contain another placeholder's name
/// (an entered `[BP]` becoming the blood pressure).
fn substitute_placeholders(
    text: &str,
    variables: &serde_json::Map<String, serde_json::Value>,
) -> String {
    let mut rendered = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        rendered.push_str(&rest[..open]);
        let after_open = &rest[open + 1..];
        let Some(close) = after_open.find(']') else {
            rest = &rest[open..];
            break;
        };
        let key = &after_open[..close];
        match variables.get(key).and_then(|value| value.as_str()) {
            Some(replacement) => rendered.push_str(replacement),
            None => rendered.push_str(&rest[open..open + close + 2]),
        }
        rest = &after_open[close + 1..];
    }
    rendered.push_str(rest);
    rendered
}

#[cfg(test)]
mod note_template_rendering_tests {
    use super::*;

    #[test]
    fn renders_only_explicit_variables_in_structured_template_content() {
        let variables = serde_json::json!({ "SYMPTOMS": "fatigue", "BP": "120/80" });
        let sections = render_sections(
            &builtin_sections("TPL-SOAP-ROUTINE").expect("built-in template"),
            variables.as_object(),
        );

        assert!(rendered(&sections, "subjective").contains("fatigue"));
        assert!(rendered(&sections, "objective").contains("120/80"));
        assert!(rendered(&sections, "assessment").contains("[PRIMARY_DIAGNOSIS]"));
    }

    #[test]
    fn rendered_line_breaks_are_line_breaks() {
        let sections = render_sections(&builtin_sections("TPL-SOAP-ROUTINE").unwrap(), None);
        let assessment = rendered(&sections, "assessment");

        assert!(assessment.contains('\n'));
        assert!(
            !assessment.contains("\\n"),
            "a literal backslash-n reached the draft"
        );
    }

    #[test]
    fn a_substituted_value_is_not_itself_substituted() {
        let variables =
            serde_json::json!({ "SYMPTOMS": "reports [BP] readings at home", "BP": "120/80" });
        let sections = render_sections(
            &builtin_sections("TPL-SOAP-ROUTINE").unwrap(),
            variables.as_object(),
        );

        assert!(rendered(&sections, "subjective").contains("reports [BP] readings at home"));
    }

    #[test]
    fn every_template_body_is_a_flat_object_of_strings() {
        for template in builtin_note_templates() {
            let content = template["content"].as_object().expect("object body");
            assert!(
                content.values().all(serde_json::Value::is_string),
                "{} has a non-string section",
                template["template_id"]
            );
        }
    }

    #[test]
    fn built_in_sections_keep_the_order_they_are_written_in() {
        let titles: Vec<String> = builtin_sections("TPL-SOAP-ROUTINE")
            .unwrap()
            .into_iter()
            .map(|(title, _)| title)
            .collect();
        assert_eq!(titles, ["subjective", "objective", "assessment", "plan"]);

        let listed = builtin_note_templates();
        let soap = &listed[0]["sections"];
        assert_eq!(soap[0]["title"], "subjective");
        assert_eq!(soap[3]["title"], "plan");
    }

    #[test]
    fn refuses_unknown_template_id() {
        assert!(note_template_content("TPL-UNKNOWN").is_none());
    }

    #[test]
    fn rendered_body_retains_every_listed_admission_template_section() {
        let content = note_template_content("TPL-HP-ADMISSION").expect("built-in template");
        let object = content.as_object().expect("structured template content");

        for section in [
            "chief_complaint",
            "hpi",
            "pmh",
            "psh",
            "medications",
            "allergies",
            "social_history",
            "family_history",
            "ros",
            "physical_exam",
            "assessment_plan",
        ] {
            assert!(object.contains_key(section), "missing {section}");
        }
    }
}

#[cfg(test)]
mod consent_endpoint_regression_tests {
    use super::*;
    use actix_web::test;

    fn active_patient_user(wallet: &str, patient_id: &str) -> User {
        User {
            wallet_address: wallet.to_string(),
            username: None,
            name: "Consent Test Patient".to_string(),
            role: Role::Patient,
            created_at: Utc::now(),
            created_by: None,
            linked_patient_id: Some(patient_id.to_string()),
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        }
    }

    #[actix_web::test]
    async fn patient_consent_endpoint_returns_zero_one_and_many_real_records() {
        for expected in [0usize, 1, 3] {
            let state = AppState::new();
            let patient_id = format!("PAT-CONSENT-{expected}");
            let wallet = format!("wallet-consent-{expected}");
            state
                .users
                .write()
                .unwrap()
                .insert(wallet.clone(), active_patient_user(&wallet, &patient_id));
            for index in 0..expected {
                let record = ConsentRecordEntity {
                    id: format!("CONS-{expected}-{index}"),
                    patient_id: patient_id.clone(),
                    consent_type: format!("TYPE-{index}"),
                    ..ConsentRecordEntity::default()
                };
                state
                    .repositories
                    .consent_records
                    .create(record)
                    .await
                    .unwrap();
            }
            let app = test::init_service(
                actix_web::App::new()
                    .app_data(web::Data::new(state))
                    .service(get_patient_consents),
            )
            .await;
            let request = test::TestRequest::get()
                .uri(&format!("/api/consent/patient/{patient_id}"))
                .insert_header(("X-User-Id", wallet))
                .to_request();
            let response: serde_json::Value = test::call_and_read_body_json(&app, request).await;
            assert_eq!(response["total"].as_u64(), Some(expected as u64));
            assert_eq!(response["consents"].as_array().unwrap().len(), expected);
        }
    }
}
