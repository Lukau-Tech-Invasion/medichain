//! Grant-bound emergency summary access for approved work devices.

use super::*;
use crate::emergency_grants::EmergencyGrantScope;
use crate::federation_identity::ContextType;

#[derive(Debug, Deserialize)]
pub struct GrantBoundEmergencyAccessRequest {
    /// What the responder holds: the tag id read from the patient's NFC card,
    /// or the patient id and possession proof scanned from their Medical ID QR.
    /// Exactly one of the two.
    pub nfc_tag_id: Option<String>,
    pub patient_id: Option<String>,
    pub qr_proof: Option<String>,
    pub device_id: String,
    pub work_context_id: String,
    pub reason_code: String,
    pub reason_text: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GrantBoundEmergencyAccessResponse {
    pub grant_id: String,
    pub expires_at: chrono::DateTime<Utc>,
    pub emergency_info: EmergencyInfo,

    /// Whether the DNR directive should actually be acted on, per the committed
    /// capsule: true only when a DNR is recorded, verified, and not revoked.
    ///
    /// This is deliberately separate from `emergency_info.dnr_status`, which is
    /// the bare recorded flag. An unverified or revoked directive reads as
    /// "resuscitate" here, because wrongly withholding resuscitation is not a
    /// recoverable error. `None` means no capsule was on file to interpret —
    /// which must not be read as "no DNR", only as "unknown".
    pub dnr_actionable: Option<bool>,

    /// Whether the stored capsule still matched its own commitment.
    /// `false` means the emergency data is being shown but its integrity could
    /// not be confirmed.
    pub commitment_verified: bool,
}

async fn persist_emergency_disclosure(
    data: &web::Data<AppState>,
    event: crate::deferred_emergency_audit::DeferredEmergencyAudit,
) -> Result<(), HttpResponse> {
    match crate::emergency_capsule::persist_access(data, event.disclosure.clone()).await {
        Ok(()) => return Ok(()),
        Err(error) => log::error!("{error}"),
    }
    let mode =
        crate::deferred_emergency_audit::EmergencyAuditMode::from_env().map_err(|error| {
            log::error!("Emergency audit policy configuration invalid: {error}");
            emergency_error(
                HttpResponse::ServiceUnavailable(),
                "Emergency access audit is unavailable",
                "AUDIT_POLICY_INVALID",
            )
        })?;
    if mode == crate::deferred_emergency_audit::EmergencyAuditMode::Deny {
        return Err(emergency_error(
            HttpResponse::ServiceUnavailable(),
            "Emergency access audit is unavailable",
            "AUDIT_PERSISTENCE_REQUIRED",
        ));
    }
    crate::deferred_emergency_audit::persist(event)
        .await
        .map_err(|error| {
            log::error!("Durable deferred emergency audit failed: {error}");
            emergency_error(
                HttpResponse::ServiceUnavailable(),
                "Emergency access audit is unavailable",
                "AUDIT_FALLBACK_UNAVAILABLE",
            )
        })
}

/// Return the minimum emergency summary only after validating a live work
/// context, approved device, and newly issued server-side emergency grant.
#[post("/api/emergency/access")]
pub async fn grant_bound_emergency_access(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<GrantBoundEmergencyAccessRequest>,
) -> impl Responder {
    let user_id = match get_current_user_id(&req) {
        Some(value) => value,
        None => {
            return emergency_error(
                HttpResponse::Unauthorized(),
                "Authentication required",
                "UNAUTHORIZED",
            )
        }
    };
    let context = match data
        .identity_contexts
        .active_context(&body.work_context_id, &user_id)
    {
        Some(value) if value.context_type == ContextType::Professional => value,
        _ => {
            return emergency_error(
                HttpResponse::Forbidden(),
                "An active professional work context is required",
                "WORK_CONTEXT_REQUIRED",
            )
        }
    };
    let organization_id = match context.organization_id.clone() {
        Some(value) => value,
        None => {
            return emergency_error(
                HttpResponse::Forbidden(),
                "Work context has no organisation binding",
                "ORGANIZATION_CONTEXT_REQUIRED",
            )
        }
    };
    let facility_id = context.facility_id.clone();
    let device = match data.device_lifecycle.get(&body.device_id) {
        Some(value) => value,
        None => {
            return emergency_error(
                HttpResponse::NotFound(),
                "Approved device not found",
                "DEVICE_NOT_FOUND",
            )
        }
    };
    if !data
        .device_lifecycle
        .can_access(&body.device_id, Utc::now())
    {
        return emergency_error(
            HttpResponse::Forbidden(),
            "Device is not approved for emergency access",
            "DEVICE_NOT_APPROVED",
        );
    }
    if device.organization_id != organization_id || device.facility_id != facility_id {
        return emergency_error(
            HttpResponse::Forbidden(),
            "Device does not match the active work context",
            "DEVICE_CONTEXT_MISMATCH",
        );
    }
    let (patient_id, presented) = match resolve_presented_patient(&data, &body).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let entity = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(value) => value,
        Err(_) => {
            return emergency_error(
                HttpResponse::NotFound(),
                "Patient record not found",
                "PATIENT_NOT_FOUND",
            )
        }
    };
    let emergency_info = match patient_entity_to_profile(&entity, &data.encryption_keyring) {
        Some(profile) => profile.emergency_info,
        None => {
            return emergency_error(
                HttpResponse::NotFound(),
                "Patient emergency summary not found",
                "EMERGENCY_SUMMARY_NOT_FOUND",
            )
        }
    };
    let grant = match data
        .emergency_grants
        .issue_with_audit(
            crate::emergency_grants::EmergencyGrantBinding {
                patient_id,
                person_id: user_id,
                organization_id,
                facility_id,
                device_id: body.device_id.clone(),
            },
            crate::emergency_grants::AuditedEmergencyGrantRequest {
                reason_code: body.reason_code.clone(),
                reason_text: body.reason_text.clone(),
                scopes: vec![
                    EmergencyGrantScope::EmergencySummary,
                    EmergencyGrantScope::DownloadProhibited,
                    EmergencyGrantScope::OfflineProhibited,
                ],
                event_type: "emergency_grant_issued".into(),
                payload: serde_json::json!({"device_id": body.device_id, "presented": presented}),
                now: Utc::now(),
            },
        )
        .await
    {
        Ok(value) => value,
        Err(error) => {
            return emergency_error(
                HttpResponse::BadRequest(),
                error,
                "EMERGENCY_GRANT_REJECTED",
            )
        }
    };
    let (grant, event) = grant;
    super::device_lifecycle::record_device_use(&data, &body.device_id).await;
    // The card's "last used" on the Health ID screen: `record_usage` existed
    // and nothing called it, so every card read as never used.
    if presented == "nfc_card" {
        if let Some(tag_id) = body.nfc_tag_id.as_deref().map(str::trim) {
            if let Err(error) = data.repositories.nfc_tags.record_usage(tag_id).await {
                log::warn!("NFC tag {tag_id} use not recorded: {error}");
            }
        }
    }
    if data.db_pool.is_none() && data.audit_outbox.record_prepared(event).is_err() {
        return emergency_error(
            HttpResponse::ServiceUnavailable(),
            "Emergency audit service is unavailable",
            "AUDIT_UNAVAILABLE",
        );
    }

    // HZ-003: record the break-glass disclosure at field granularity, and check
    // the off-chain capsule against its commitment. The generic audit row above
    // records that a grant was issued; it cannot answer "which of this
    // patient's emergency fields were actually shown, and was the copy intact".
    let verified = crate::emergency_capsule::load_current_verified(&data, &grant.patient_id).await;
    let (capsule_version, commitment_verified) = match &verified {
        Some(v) => (Some(v.version), v.commitment_verified),
        // No capsule on file. The emergency summary is still disclosed and
        // logged; `commitment_verified` is false because no capsule integrity
        // value existed to verify, not because verification failed.
        None => (None, false),
    };
    let fields_revealed = crate::emergency_capsule::emergency_summary_revealed_fields();
    let disclosure =
        crate::emergency_capsule::build_access_entry(crate::emergency_capsule::CapsuleDisclosure {
            patient_id: &grant.patient_id,
            accessed_by: &grant.requesting_person_id,
            capsule_version,
            grant_id: Some(grant.id.clone()),
            reason_code: &body.reason_code,
            reason_text: body.reason_text.clone(),
            fields_revealed,
            commitment_verified,
        });
    let deferred = crate::deferred_emergency_audit::DeferredEmergencyAudit {
        event_id: disclosure.id.clone(),
        disclosure,
        organization_id: grant.organization_id.clone(),
        facility_id: grant.facility_id.clone(),
        device_id: body.device_id.clone(),
        work_context_id: body.work_context_id.clone(),
        correlation_id: req
            .headers()
            .get("x-correlation-id")
            .and_then(|value| value.to_str().ok())
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        authorization: "active_professional_context_and_emergency_grant".to_string(),
        deferred_at: Utc::now(),
    };
    if let Err(response) = persist_emergency_disclosure(&data, deferred).await {
        return response;
    }

    HttpResponse::Ok().json(GrantBoundEmergencyAccessResponse {
        grant_id: grant.id,
        expires_at: grant.expires_at,
        emergency_info,
        dnr_actionable: verified.as_ref().map(|v| v.capsule.dnr_is_actionable()),
        commitment_verified,
    })
}

/// The patient whose card or QR the responder presented, and which it was.
///
/// Both bind access to holding something the patient carries: the NFC tag id
/// is looked up, and the QR's patient id must come with the server-minted
/// possession proof printed beside it. A patient id alone is refused, since
/// staff see patient ids in every chart URL.
async fn resolve_presented_patient(
    data: &web::Data<AppState>,
    body: &GrantBoundEmergencyAccessRequest,
) -> Result<(String, &'static str), HttpResponse> {
    let tag = body
        .nfc_tag_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    let qr_patient = body
        .patient_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    match (tag, qr_patient) {
        (Some(tag_id), None) => match data.repositories.nfc_tags.get_by_id(tag_id).await {
            Ok(tag) => Ok((tag.patient_id, "nfc_card")),
            Err(crate::repositories::traits::RepositoryError::NotFound(_)) => Err(emergency_error(
                HttpResponse::NotFound(),
                "NFC tag not found",
                "NFC_NOT_FOUND",
            )),
            Err(error) => {
                log::error!("Grant-bound NFC lookup failed: {error}");
                Err(emergency_error(
                    HttpResponse::InternalServerError(),
                    "Emergency lookup unavailable",
                    "EMERGENCY_LOOKUP_FAILED",
                ))
            }
        },
        (None, Some(patient_id)) => {
            let proof = body.qr_proof.as_deref().unwrap_or_default();
            if crate::clinical_endpoints::emergency_access::medical_id_qr_proof_matches(
                patient_id, proof,
            ) {
                Ok((patient_id.to_string(), "medical_id_qr"))
            } else {
                Err(emergency_error(
                    HttpResponse::Forbidden(),
                    "This Medical ID QR code is not valid for emergency access. Ask the patient to download a current one.",
                    "QR_PROOF_INVALID",
                ))
            }
        }
        _ => Err(emergency_error(
            HttpResponse::BadRequest(),
            "Present either the patient's NFC card or their Medical ID QR code",
            "EMERGENCY_SUBJECT_REQUIRED",
        )),
    }
}

fn emergency_error(
    mut builder: actix_web::HttpResponseBuilder,
    error: &str,
    code: &str,
) -> HttpResponse {
    builder.json(ErrorResponse {
        error: error.into(),
        code: code.into(),
    })
}

#[derive(Debug, Deserialize)]
pub struct NfcTokenExchangeRequest {
    pub patient_id: String,
    pub nfc_hash: String,
    pub device_id: String,
    pub reason_code: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NfcTokenExchangeResponse {
    pub token: String,
    pub expires_in_secs: i64,
}

/// Exchange a tapped NFC card hash for a short-lived signed emergency token
/// (Horizon HZ-001).
///
/// `nfc_hash` (the card's `tag_uid`) never rotates for the card's lifetime, so
/// accepting it directly as a PHI-release credential meant a value captured
/// once (e.g. via a proxy/access log, since it travelled as a URL query
/// parameter) could be replayed indefinitely. This endpoint keeps the "tap a
/// card, get emergency data fast" flow intact — no login required, matching
/// the reduced-auth posture of the emergency path — while the actual
/// PHI-releasing endpoints (`get_emergency_medical_id`, `get_lockscreen_medical_id`)
/// now only accept the exchanged, time-boxed `token`.
#[post("/api/emergency/nfc-token")]
pub async fn exchange_nfc_hash_for_token(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<NfcTokenExchangeRequest>,
) -> impl Responder {
    let responder = match get_current_user_id(&req).and_then(|id| get_user(&data, &id)) {
        // The token this endpoint mints is what opens the capsule, so only a
        // role that may break glass may be given one.
        Some(user) if user.role.may_break_glass() => user,
        _ => {
            return emergency_error(
                HttpResponse::Unauthorized(),
                "An authenticated healthcare responder is required",
                "RESPONDER_AUTH_REQUIRED",
            );
        }
    };
    if body.reason_code.trim().is_empty() {
        return emergency_error(
            HttpResponse::BadRequest(),
            "reason_code is required",
            "MISSING_REASON_CODE",
        );
    }
    if !data
        .device_lifecycle
        .can_access(&body.device_id, Utc::now())
    {
        return emergency_error(
            HttpResponse::Forbidden(),
            "An active approved device is required",
            "DEVICE_NOT_APPROVED",
        );
    }
    if body.nfc_hash.trim().is_empty() {
        return emergency_error(
            HttpResponse::BadRequest(),
            "nfc_hash is required",
            "MISSING_NFC_HASH",
        );
    }

    let tags = match data
        .repositories
        .nfc_tags
        .get_by_patient(&body.patient_id)
        .await
    {
        Ok(tags) => tags,
        Err(_) => {
            return emergency_error(
                HttpResponse::Unauthorized(),
                "Emergency access requires a matching NFC card hash",
                "EMERGENCY_ACCESS_DENIED",
            )
        }
    };

    if !crate::clinical_endpoints::emergency_access::nfc_hash_matches(&body.nfc_hash, &tags) {
        return emergency_error(
            HttpResponse::Unauthorized(),
            "Emergency access requires a matching NFC card hash",
            "EMERGENCY_ACCESS_DENIED",
        );
    }

    let token = match crate::clinical_endpoints::emergency_access::issue_emergency_token(
        &body.patient_id,
        &responder.id,
        &body.device_id,
        &body.reason_code,
        crate::clinical_endpoints::emergency_access::NFC_EXCHANGE_TOKEN_TTL_SECS,
    ) {
        Ok(token) => token,
        Err(error) => {
            log::error!("Emergency token issuance failed: {}", error);
            return emergency_error(
                HttpResponse::InternalServerError(),
                "Emergency token could not be issued",
                "TOKEN_ISSUE_FAILED",
            );
        }
    };

    HttpResponse::Ok().json(NfcTokenExchangeResponse {
        token,
        expires_in_secs: crate::clinical_endpoints::emergency_access::NFC_EXCHANGE_TOKEN_TTL_SECS,
    })
}

#[cfg(test)]
mod hz_001_exchange_tests {
    use super::*;
    use actix_web::test;

    async fn seed_tag(state: &AppState, patient_id: &str, tag_uid: &str) {
        state
            .repositories
            .nfc_tags
            .create(crate::repositories::traits::NfcTagEntity {
                id: "tag-1".to_string(),
                tag_uid: tag_uid.to_string(),
                patient_id: patient_id.to_string(),
                tag_type: "emergency".to_string(),
                is_active: true,
                pin_hash: None,
                issued_at: Utc::now(),
                expires_at: None,
                last_used_at: None,
                use_count: 0,
                issued_by: None,
                status: "Active".to_string(),
            })
            .await
            .unwrap();
    }

    fn seed_responder_and_device(state: &AppState) -> String {
        state.users.write().unwrap().insert(
            "responder-user".to_string(),
            User {
                id: "responder-user".to_string(),
                username: None,
                name: "Responder".to_string(),
                role: Role::Doctor,
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
            },
        );
        let device = state
            .device_lifecycle
            .enroll(
                "org-1".into(),
                None,
                "ED tablet".into(),
                "tablet".into(),
                "fingerprint-1".into(),
                None,
            )
            .unwrap();
        state
            .device_lifecycle
            .rotate(&device.id, "key-1".into(), Utc::now())
            .unwrap();
        device.id
    }

    #[actix_web::test]
    async fn matching_hash_yields_a_verifiable_token() {
        for role in [Role::Doctor, Role::Paramedic] {
            let state = AppState::new();
            seed_tag(&state, "PAT-EX-1", "correct-hash").await;
            let device_id = seed_responder_and_device(&state);
            state
                .users
                .write()
                .unwrap()
                .get_mut("responder-user")
                .unwrap()
                .role = role;
            let app_state = web::Data::new(state);
            let app = actix_web::App::new()
                .app_data(app_state.clone())
                .service(exchange_nfc_hash_for_token);
            let app = test::init_service(app).await;

            let req = test::TestRequest::post()
                .uri("/api/emergency/nfc-token")
                .insert_header(crate::test_fixtures::as_user("responder-user"))
                .set_json(serde_json::json!({
                    "patient_id": "PAT-EX-1",
                    "nfc_hash": "correct-hash",
                    "device_id": device_id,
                    "reason_code": "trauma"
                }))
                .to_request();
            let resp: NfcTokenExchangeResponse = test::call_and_read_body_json(&app, req).await;

            assert!(
                crate::clinical_endpoints::emergency_access::verify_emergency_token(
                    &resp.token,
                    "PAT-EX-1"
                )
                .is_ok(),
                "the issued token must verify for the patient it was issued for"
            );
        }
    }

    #[actix_web::test]
    async fn mismatched_hash_is_rejected() {
        let state = AppState::new();
        seed_tag(&state, "PAT-EX-2", "correct-hash").await;
        let device_id = seed_responder_and_device(&state);
        let app_state = web::Data::new(state);
        let app = actix_web::App::new()
            .app_data(app_state.clone())
            .service(exchange_nfc_hash_for_token);
        let app = test::init_service(app).await;

        let req = test::TestRequest::post()
            .uri("/api/emergency/nfc-token")
            .insert_header(crate::test_fixtures::as_user("responder-user"))
            .set_json(serde_json::json!({
                "patient_id": "PAT-EX-2",
                "nfc_hash": "wrong-hash",
                "device_id": device_id,
                "reason_code": "trauma"
            }))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }
}

#[cfg(test)]
mod presented_patient_tests {
    use super::*;

    fn request(
        nfc_tag_id: Option<&str>,
        patient_id: Option<&str>,
        qr_proof: Option<&str>,
    ) -> GrantBoundEmergencyAccessRequest {
        GrantBoundEmergencyAccessRequest {
            nfc_tag_id: nfc_tag_id.map(str::to_string),
            patient_id: patient_id.map(str::to_string),
            qr_proof: qr_proof.map(str::to_string),
            device_id: "device-1".to_string(),
            work_context_id: "context-1".to_string(),
            reason_code: "emergency_qr_access".to_string(),
            reason_text: None,
        }
    }

    async fn status_of(body: GrantBoundEmergencyAccessRequest) -> Result<String, u16> {
        let data = web::Data::new(AppState::new());
        resolve_presented_patient(&data, &body)
            .await
            .map(|(patient, presented)| format!("{patient}/{presented}"))
            .map_err(|response| response.status().as_u16())
    }

    #[actix_web::test]
    async fn a_scanned_medical_id_qr_with_its_proof_names_the_patient() {
        let proof = crate::clinical_endpoints::emergency_access::medical_id_qr_proof("PAT-1");
        let result = status_of(request(None, Some("PAT-1"), Some(&proof))).await;
        assert_eq!(result, Ok("PAT-1/medical_id_qr".to_string()));
    }

    #[actix_web::test]
    async fn a_patient_id_without_its_proof_is_refused() {
        let other = crate::clinical_endpoints::emergency_access::medical_id_qr_proof("PAT-2");
        assert_eq!(
            status_of(request(None, Some("PAT-1"), None)).await,
            Err(403)
        );
        assert_eq!(
            status_of(request(None, Some("PAT-1"), Some(&other))).await,
            Err(403)
        );
    }

    #[actix_web::test]
    async fn exactly_one_of_card_or_qr_is_presented() {
        let proof = crate::clinical_endpoints::emergency_access::medical_id_qr_proof("PAT-1");
        assert_eq!(status_of(request(None, None, None)).await, Err(400));
        assert_eq!(status_of(request(Some("  "), None, None)).await, Err(400));
        assert_eq!(
            status_of(request(Some("NFC-1"), Some("PAT-1"), Some(&proof))).await,
            Err(400)
        );
    }

    #[actix_web::test]
    async fn an_unknown_card_is_not_found() {
        assert_eq!(
            status_of(request(Some("NFC-UNKNOWN"), None, None)).await,
            Err(404)
        );
    }
}
