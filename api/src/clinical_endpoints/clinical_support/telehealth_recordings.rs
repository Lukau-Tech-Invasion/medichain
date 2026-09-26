//! `clinical_endpoints::clinical_support::telehealth_recordings` — consented
//! consultation recording (WP7.6).
//!
//! Recording needs three things, and the API checks all three:
//!
//! 1. **The clinic has a recorder.** The video platform must be the self-hosted
//!    Jitsi stack with its recorder (Jibri) delivering files here, which is
//!    signalled by `MEDICHAIN_RECORDING_INGEST_TOKEN`. Without it every screen
//!    says "Recording is not set up for this clinic"; nothing pretends.
//! 2. **Both people consented, each for themselves.** The assigned clinician
//!    and the patient each give (or withdraw) their own consent here. Recording
//!    cannot start until both have; the patient withdrawing stops it, and a
//!    recording whose consent was withdrawn is not kept.
//! 3. **The recording is handled as a clinical record.** The recorder's upload
//!    hook sends the file; it is encrypted into the IPFS document pipeline,
//!    indexed with both consent times, kept under the clinical-record retention
//!    policy, and every viewing is audited as a disclosure before bytes leave.

use super::*;
use crate::clinical::TelehealthSession;
use crate::document_intake::{
    download_response, fetch_verified, intake_error, read_body_within, store_encrypted,
    ValidatedFile,
};
use crate::repositories::telehealth_recordings::{
    TelehealthRecordingEntity, RECORDING_RETENTION_ENTITY,
};
use serde::Serialize;

/// Environment variable holding the secret the recorder's upload hook sends.
pub const RECORDING_INGEST_TOKEN_ENV: &str = "MEDICHAIN_RECORDING_INGEST_TOKEN";
/// Shortest ingest secret accepted; a shorter one counts as not configured.
const MIN_INGEST_TOKEN_CHARS: usize = 32;
/// Header the recorder's upload hook carries the secret in.
const INGEST_TOKEN_HEADER: &str = "x-recording-ingest-token";
/// Largest recording accepted: 256 MiB (the table's CHECK agrees).
pub const MAX_RECORDING_BYTES: usize = 256 * 1024 * 1024;
/// Who stored a recording, in the audit trail: the recorder, not a person.
const RECORDING_SERVICE_ACTOR: &str = "recording-service";
/// The only video platform with a recorder MediChain can receive from.
const RECORDING_PROVIDER: &str = "jitsi";

/// The ingest secret, if one of usable length is configured.
fn ingest_token() -> Option<String> {
    std::env::var(RECORDING_INGEST_TOKEN_ENV)
        .ok()
        .map(|token| token.trim().to_string())
        .filter(|token| token.chars().count() >= MIN_INGEST_TOKEN_CHARS)
}

/// Whether this clinic can record: Jitsi video with a recorder wired to us.
pub(crate) fn recording_configured(data: &crate::AppState) -> bool {
    recording_configured_with(
        data.telehealth_service.active_provider_name(),
        ingest_token().is_some(),
    )
}

/// The rule behind [`recording_configured`], given the video provider's name
/// and whether a usable ingest secret is set.
fn recording_configured_with(provider_name: &str, has_ingest_token: bool) -> bool {
    provider_name == RECORDING_PROVIDER && has_ingest_token
}

/// Whether both the clinician and the patient currently consent.
pub(crate) fn both_consented(session: &TelehealthSession) -> bool {
    session.provider_recording_consent_at.is_some()
        && session.patient_recording_consent_at.is_some()
}

/// Constant-time equality of two secrets (compared as SHA-256 digests, so
/// the comparison's length never depends on the input).
fn secrets_match(presented: &str, expected: &str) -> bool {
    let (a, b) = (
        medichain_crypto::sha256(presented.as_bytes()),
        medichain_crypto::sha256(expected.as_bytes()),
    );
    a.iter()
        .zip(b.iter())
        .fold(0u8, |diff, (x, y)| diff | (x ^ y))
        == 0
}

/// Which side of the consultation a caller is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordingParty {
    Provider,
    Patient,
}

/// The caller's side of `session`, or `None` if they are not in it.
fn party_of(
    data: &web::Data<crate::AppState>,
    caller: &crate::User,
    session: &TelehealthSession,
) -> Option<RecordingParty> {
    if caller.wallet_address == session.provider_id {
        Some(RecordingParty::Provider)
    } else if crate::support::caller_owns_patient_record(
        data,
        &caller.wallet_address,
        &session.patient_id,
    ) {
        Some(RecordingParty::Patient)
    } else {
        None
    }
}

/// 503 for a storage failure; the underlying error is logged, never returned.
fn recording_unavailable(context: &str, error: impl std::fmt::Display) -> HttpResponse {
    log::error!("telehealth recording: {context}: {error}");
    intake_error(
        HttpResponse::ServiceUnavailable(),
        "Consultation recording is temporarily unavailable. Please try again shortly.",
        "RECORDING_UNAVAILABLE",
    )
}

/// Load a session: 404 if unknown, 503 if storage fails or it will not decode.
async fn load_session(
    data: &web::Data<crate::AppState>,
    session_id: &str,
) -> Result<TelehealthSession, HttpResponse> {
    let record = match data
        .repositories
        .telehealth_session_records
        .get_by_id(session_id)
        .await
    {
        Ok(Some(record)) => record,
        Ok(None) => {
            return Err(intake_error(
                HttpResponse::NotFound(),
                "Session not found.",
                "NOT_FOUND",
            ))
        }
        Err(error) => return Err(recording_unavailable("load session", error)),
    };
    serde_json::from_value(record.data).map_err(|error| recording_unavailable("decode", error))
}

/// Load a session and the caller's side of it; 403 for anyone not in it.
async fn load_as_party(
    data: &web::Data<crate::AppState>,
    caller: &crate::User,
    session_id: &str,
) -> Result<(TelehealthSession, RecordingParty), HttpResponse> {
    let session = load_session(data, session_id).await?;
    match party_of(data, caller, &session) {
        Some(party) => Ok((session, party)),
        None => Err(intake_error(
            HttpResponse::Forbidden(),
            "Only the clinician and the patient in this consultation can do this.",
            "FORBIDDEN",
        )),
    }
}

/// Save a session back to its JSON record. 503 on failure.
async fn save_session(
    data: &web::Data<crate::AppState>,
    session: &TelehealthSession,
) -> Result<(), HttpResponse> {
    let now = chrono::Utc::now();
    let payload =
        serde_json::to_value(session).map_err(|error| recording_unavailable("encode", error))?;
    data.repositories
        .telehealth_session_records
        .create(crate::repositories::traits::JsonRecordEntity {
            id: session.session_id.clone(),
            owner_id: session.patient_id.clone(),
            data: payload,
            created_at: now,
            updated_at: now,
        })
        .await
        .map(|_| ())
        .map_err(|error| recording_unavailable("save session", error))
}

/// The recording state of a consultation, as each participant sees it.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct RecordingStatusView {
    pub session_id: String,
    /// False means "Recording is not set up for this clinic".
    pub configured: bool,
    pub provider_consented: bool,
    pub patient_consented: bool,
    pub recording: bool,
    pub your_party: RecordingParty,
}

impl RecordingStatusView {
    /// Describe `session` for a caller on `party`'s side.
    fn of(data: &crate::AppState, session: &TelehealthSession, party: RecordingParty) -> Self {
        Self {
            session_id: session.session_id.clone(),
            configured: recording_configured(data),
            provider_consented: session.provider_recording_consent_at.is_some(),
            patient_consented: session.patient_recording_consent_at.is_some(),
            recording: session.recording_enabled,
            your_party: party,
        }
    }
}

/// An audit row about `patient_id`'s consultation recording.
fn recording_audit(
    accessor: (&str, &str),
    patient_id: &str,
    resource_id: &str,
    action: &str,
) -> crate::repositories::traits::AccessLogEntity {
    crate::repositories::traits::AccessLogEntity {
        id: crate::middleware::secure_tokens::generate_access_id(),
        accessor_id: accessor.0.to_string(),
        accessor_role: accessor.1.to_string(),
        patient_id: Some(patient_id.to_string()),
        resource_type: "telehealth_recording".to_string(),
        resource_id: Some(resource_id.to_string()),
        action: action.to_string(),
        access_reason: None,
        is_emergency_access: false,
        ip_address: None,
        user_agent: None,
        blockchain_tx_hash: None,
        accessed_at: chrono::Utc::now(),
        facility_id: None,
        authority_type: None,
        authority_id: None,
    }
}

/// Tell both participants' screens the recording state changed.
fn broadcast_recording_state(data: &web::Data<crate::AppState>, session: &TelehealthSession) {
    data.ws_manager.push_event(crate::websocket::PushEvent {
        event_type: "telehealth".to_string(),
        patient_id: Some(session.patient_id.clone()),
        payload: serde_json::json!({
            "session_id": session.session_id,
            "event": "recording-state",
            "recording": session.recording_enabled,
        }),
        timestamp: chrono::Utc::now().timestamp(),
    });
}

/// The recording state of a consultation (its clinician or patient).
///
/// Returns 200 with [`RecordingStatusView`]; 403 for anyone else; 404, 503.
#[get("/api/telehealth/sessions/{session_id}/recording-status")]
pub async fn get_recording_status(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    match load_as_party(&data, &caller, &path.into_inner()).await {
        Ok((session, party)) => {
            HttpResponse::Ok().json(RecordingStatusView::of(&data, &session, party))
        }
        Err(response) => response,
    }
}

/// Body of a consent change: the caller's own answer.
#[derive(Debug, Deserialize)]
pub struct RecordingConsentRequest {
    pub consent: bool,
}

/// Apply `party`'s consent answer to `session`. Returns whether it stopped a
/// running recording (withdrawal while recording).
fn apply_consent(session: &mut TelehealthSession, party: RecordingParty, consent: bool) -> bool {
    let stamp = consent.then(|| chrono::Utc::now().timestamp());
    match party {
        RecordingParty::Provider => session.provider_recording_consent_at = stamp,
        RecordingParty::Patient => session.patient_recording_consent_at = stamp,
    }
    session.recording_consent = both_consented(session);
    let stopped = session.recording_enabled && !session.recording_consent;
    if stopped {
        session.recording_enabled = false;
    }
    stopped
}

/// Give or withdraw the caller's own consent to recording.
///
/// Each side answers only for themselves. Withdrawing while recording stops
/// it, and the recorder's file for that call is then refused. Returns 200 with
/// the new [`RecordingStatusView`]; 403 for anyone not in the consultation.
#[post("/api/telehealth/sessions/{session_id}/recording-consent")]
pub async fn set_recording_consent(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<RecordingConsentRequest>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let (mut session, party) = match load_as_party(&data, &caller, &path.into_inner()).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    let stopped = apply_consent(&mut session, party, body.consent);
    if let Err(response) = save_session(&data, &session).await {
        return response;
    }
    let role = caller.role.to_string();
    let accessor = (caller.wallet_address.as_str(), role.as_str());
    let action = if body.consent {
        "recording_consent_given"
    } else {
        "recording_consent_withdrawn"
    };
    let mut audits = vec![recording_audit(
        accessor,
        &session.patient_id,
        &session.session_id,
        action,
    )];
    if stopped {
        audits.push(recording_audit(
            accessor,
            &session.patient_id,
            &session.session_id,
            "recording-stopped",
        ));
    }
    for audit in audits {
        if let Err(response) = crate::support::require_durable_audit(&data, audit).await {
            return response;
        }
    }
    broadcast_recording_state(&data, &session);
    HttpResponse::Ok().json(RecordingStatusView::of(&data, &session, party))
}

/// Whether a recorder's upload carries the configured secret. Without a
/// configured secret, recording is not set up: 503, never an open door.
fn check_ingest_token(http_req: &HttpRequest) -> Result<(), HttpResponse> {
    let Some(expected) = ingest_token() else {
        return Err(intake_error(
            HttpResponse::ServiceUnavailable(),
            "Recording is not set up for this clinic.",
            "RECORDING_NOT_CONFIGURED",
        ));
    };
    let presented = http_req
        .headers()
        .get(INGEST_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if secrets_match(presented, &expected) {
        Ok(())
    } else {
        Err(intake_error(
            HttpResponse::Unauthorized(),
            "The recording upload was not authorised.",
            "UNAUTHORIZED",
        ))
    }
}

/// The video type a recording really is (MP4 or WebM), provided it matches
/// the declared `Content-Type`. Otherwise a 415.
fn recording_type(http_req: &HttpRequest, bytes: &[u8]) -> Result<&'static str, HttpResponse> {
    const WEBM_MAGIC: [u8; 4] = [0x1A, 0x45, 0xDF, 0xA3];
    let sniffed = if bytes.get(4..8) == Some(b"ftyp".as_slice()) {
        Some("video/mp4")
    } else if bytes.starts_with(&WEBM_MAGIC) {
        Some("video/webm")
    } else {
        None
    };
    let declared = http_req
        .headers()
        .get(actix_web::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| {
            v.split(';')
                .next()
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase()
        });
    match sniffed {
        Some(actual) if declared.as_deref() == Some(actual) => Ok(actual),
        _ => Err(intake_error(
            HttpResponse::UnsupportedMediaType(),
            "Recordings must be MP4 or WebM video, and really be one.",
            "UNSUPPORTED_FILE_TYPE",
        )),
    }
}

/// The consent and start times a recording of `session` is stored with, or a
/// 409 when the session does not show both consents before the start.
fn consented_window(session: &TelehealthSession) -> Result<(i64, i64, i64), HttpResponse> {
    let refuse = || {
        intake_error(
            HttpResponse::Conflict(),
            "This consultation does not have both consents in place for the recording, so it was not kept.",
            "RECORDING_CONSENT_MISSING",
        )
    };
    let (Some(provider), Some(patient), Some(started)) = (
        session.provider_recording_consent_at,
        session.patient_recording_consent_at,
        session.recording_started_at,
    ) else {
        return Err(refuse());
    };
    if provider > started || patient > started {
        return Err(refuse());
    }
    Ok((provider, patient, started))
}

/// A Unix timestamp as a UTC time (the epoch for an out-of-range value, which
/// the consent-precedes-start CHECK then refuses).
fn at(seconds: i64) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::from_timestamp(seconds, 0).unwrap_or_default()
}

/// The download name of a recording: its session and its video type.
fn recording_filename(session_id: &str, content_type: &str) -> String {
    let extension = content_type.strip_prefix("video/").unwrap_or("video");
    format!("{session_id}.{extension}")
}

/// Encrypt a recording and describe the stored row.
async fn store_recording(
    data: &web::Data<crate::AppState>,
    session: &TelehealthSession,
    window: (i64, i64, i64),
    content_type: &'static str,
    bytes: Vec<u8>,
) -> Result<TelehealthRecordingEntity, HttpResponse> {
    let file = ValidatedFile {
        filename: recording_filename(&session.session_id, content_type),
        content_type,
        // Produced by the clinic's own recorder, not uploaded by a person.
        scan_status: "not_scanned",
        bytes,
    };
    let stored = store_encrypted(
        data,
        &file,
        Some(&session.patient_id),
        RECORDING_SERVICE_ACTOR,
        "telehealth_recording",
    )
    .await
    .map_err(|error| recording_unavailable("encrypted upload", error))?;
    Ok(TelehealthRecordingEntity {
        id: format!("REC-{}", uuid::Uuid::new_v4()),
        session_id: session.session_id.clone(),
        patient_id: session.patient_id.clone(),
        provider_id: session.provider_id.clone(),
        content_type: content_type.to_string(),
        size_bytes: stored.size_bytes,
        sha256: stored.sha256,
        ipfs_hash: stored.ipfs_hash,
        metadata_hash: stored.metadata_hash,
        provider_consented_at: at(window.0),
        patient_consented_at: at(window.1),
        recording_started_at: at(window.2),
        retention_entity_type: RECORDING_RETENTION_ENTITY.to_string(),
        created_at: chrono::Utc::now(),
    })
}

/// Receive a finished recording from the clinic's recorder (Jibri's upload
/// hook), authenticated by `MEDICHAIN_RECORDING_INGEST_TOKEN`.
///
/// Body: the video's raw bytes; `Content-Type` video/mp4 or video/webm.
/// Returns 201; 401 for a wrong secret; 503 when recording is not set up or
/// storage fails; 409 when the consultation lacks both consents; 413, 415.
#[post("/api/telehealth/sessions/{session_id}/recordings")]
pub async fn ingest_telehealth_recording(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    payload: web::Payload,
) -> impl Responder {
    if let Err(response) = check_ingest_token(&http_req) {
        return response;
    }
    let session = match load_session(&data, &path.into_inner()).await {
        Ok(session) => session,
        Err(response) => return response,
    };
    let window = match consented_window(&session) {
        Ok(window) => window,
        Err(response) => return response,
    };
    let bytes = match read_body_within(
        payload,
        MAX_RECORDING_BYTES,
        "Recordings can be at most 256 MB.",
    )
    .await
    {
        Ok(bytes) => bytes,
        Err(response) => return response,
    };
    let content_type = match recording_type(&http_req, &bytes) {
        Ok(content_type) => content_type,
        Err(response) => return response,
    };
    let row = match store_recording(&data, &session, window, content_type, bytes).await {
        Ok(row) => row,
        Err(response) => return response,
    };
    let audit = recording_audit(
        (RECORDING_SERVICE_ACTOR, "System"),
        &session.patient_id,
        &row.id,
        "telehealth_recording_stored",
    );
    match data
        .repositories
        .create_telehealth_recording(row, audit)
        .await
    {
        Ok(stored) => HttpResponse::Created().json(
            serde_json::json!({ "success": true, "recording": RecordingView::from(&stored) }),
        ),
        Err(error) => recording_unavailable("record recording", error),
    }
}

/// A recording as the API describes it (never the storage hashes).
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct RecordingView {
    pub id: String,
    pub session_id: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub recording_started_at: chrono::DateTime<chrono::Utc>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl From<&TelehealthRecordingEntity> for RecordingView {
    fn from(row: &TelehealthRecordingEntity) -> Self {
        Self {
            id: row.id.clone(),
            session_id: row.session_id.clone(),
            content_type: row.content_type.clone(),
            size_bytes: row.size_bytes,
            recording_started_at: row.recording_started_at,
            created_at: row.created_at,
        }
    }
}

/// The recordings of a consultation (its clinician or patient). Listing is
/// metadata only; opening one is the audited disclosure.
#[get("/api/telehealth/sessions/{session_id}/recordings")]
pub async fn list_telehealth_recordings(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let (session, _) = match load_as_party(&data, &caller, &path.into_inner()).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    match data
        .repositories
        .telehealth_recordings
        .list_for_session(&session.session_id)
        .await
    {
        Ok(rows) => HttpResponse::Ok().json(serde_json::json!({
            "recordings": rows.iter().map(RecordingView::from).collect::<Vec<_>>(),
        })),
        Err(error) => recording_unavailable("list recordings", error),
    }
}

/// Download a recording (the consultation's clinician or patient).
///
/// The bytes are fetched and verified first, the viewing audited as a
/// disclosure on the patient's record, and only then sent. 403, 404, 503.
#[get("/api/telehealth/recordings/{recording_id}")]
pub async fn download_telehealth_recording(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let row = match data
        .repositories
        .telehealth_recordings
        .get_by_id(&path.into_inner())
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            return intake_error(
                HttpResponse::NotFound(),
                "Recording not found.",
                "NOT_FOUND",
            )
        }
        Err(error) => return recording_unavailable("load recording", error),
    };
    if let Err(response) = load_as_party(&data, &caller, &row.session_id).await {
        return response;
    }
    let bytes = match fetch_verified(&data, &row.ipfs_hash, &row.metadata_hash, &row.sha256).await {
        Ok(bytes) => bytes,
        Err(error) => return recording_unavailable("encrypted download", error),
    };
    let role = caller.role.to_string();
    let audit = recording_audit(
        (&caller.wallet_address, &role),
        &row.patient_id,
        &row.id,
        "telehealth_recording_viewed",
    );
    if let Err(response) = crate::support::require_durable_audit(&data, audit).await {
        return response;
    }
    let filename = recording_filename(&row.session_id, &row.content_type);
    download_response(&filename, &row.content_type, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test, App};

    const PATIENT_ID: &str = "PAT-REC";
    const PATIENT: &str = "patient_rec";
    const DOCTOR: &str = "doctor_rec";
    const OTHER_DOCTOR: &str = "doctor_other";
    const TOKEN: &str = "test-recording-ingest-secret-of-usable-length";
    /// The first bytes of an MP4 file: a box size, then `ftyp`.
    const MP4: &[u8] = b"\x00\x00\x00\x18ftypmp42synthetic consultation video";

    /// Configure the recorder secret. Every test sets the same value, so
    /// tests running in parallel cannot disagree about it.
    fn configure_recorder() {
        std::env::set_var(RECORDING_INGEST_TOKEN_ENV, TOKEN);
    }

    /// State on Jitsi with a fake IPFS node, the two parties and a stranger,
    /// and one booked session. Returns the state and the session id.
    async fn state() -> (web::Data<crate::AppState>, String) {
        configure_recorder();
        let ipfs = crate::test_fixtures::fake_ipfs().await;
        let mut state = crate::AppState::new();
        state.ipfs_client = crate::ipfs::IpfsClient::new(ipfs.clone(), ipfs);
        state.telehealth_service = crate::telehealth::TelehealthService::with_provider(Box::new(
            crate::telehealth::JitsiProvider::new(),
        ));
        {
            let mut users = state.users.write().unwrap();
            let mut patient = crate::test_fixtures::staff(PATIENT, crate::Role::Patient);
            patient.linked_patient_id = Some(PATIENT_ID.into());
            users.insert(PATIENT.into(), patient);
            for doctor in [DOCTOR, OTHER_DOCTOR] {
                users.insert(
                    doctor.into(),
                    crate::test_fixtures::staff(doctor, crate::Role::Doctor),
                );
            }
        }
        crate::test_fixtures::seed_patient(&state, PATIENT_ID).await;
        let provisioned = provision_session(
            &state,
            SessionRequest {
                patient_id: PATIENT_ID,
                provider_id: DOCTOR,
                appointment_id: None,
                scheduled_start: chrono::Utc::now().timestamp(),
                session_type: crate::clinical::TelehealthType::VideoVisit,
                recording_enabled: false,
                duration_minutes: 30,
            },
        )
        .await
        .expect("provision session");
        (web::Data::new(state), provisioned.session.session_id)
    }

    async fn call(
        state: &web::Data<crate::AppState>,
        request: test::TestRequest,
    ) -> actix_web::dev::ServiceResponse {
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(get_recording_status)
                .service(set_recording_consent)
                .service(ingest_telehealth_recording)
                .service(list_telehealth_recordings)
                .service(download_telehealth_recording)
                .service(super::super::telehealth_recording),
        )
        .await;
        test::call_service(&app, request.to_request()).await
    }

    fn consent(session: &str, wallet: &str, consent: bool) -> test::TestRequest {
        test::TestRequest::post()
            .uri(&format!(
                "/api/telehealth/sessions/{session}/recording-consent"
            ))
            .insert_header(("x-user-id", wallet))
            .set_json(serde_json::json!({ "consent": consent }))
    }

    fn start(session: &str) -> test::TestRequest {
        test::TestRequest::post()
            .uri(&format!("/api/telehealth/sessions/{session}/recording"))
            .insert_header(("x-user-id", DOCTOR))
            .set_json(serde_json::json!({ "action": "start", "consent": true }))
    }

    fn ingest(session: &str, token: &str, content_type: &str, body: &[u8]) -> test::TestRequest {
        test::TestRequest::post()
            .uri(&format!("/api/telehealth/sessions/{session}/recordings"))
            .insert_header((INGEST_TOKEN_HEADER, token))
            .insert_header(("content-type", content_type))
            .set_payload(body.to_vec())
    }

    async fn status(
        state: &web::Data<crate::AppState>,
        session: &str,
        wallet: &str,
    ) -> serde_json::Value {
        let request = test::TestRequest::get()
            .uri(&format!(
                "/api/telehealth/sessions/{session}/recording-status"
            ))
            .insert_header(("x-user-id", wallet));
        test::read_body_json(call(state, request).await).await
    }

    /// Both consent, and recording starts.
    async fn record(state: &web::Data<crate::AppState>, session: &str) {
        assert_eq!(
            call(state, consent(session, DOCTOR, true)).await.status(),
            200
        );
        assert_eq!(
            call(state, consent(session, PATIENT, true)).await.status(),
            200
        );
        assert_eq!(call(state, start(session)).await.status(), 200);
    }

    #[actix_web::test]
    async fn recording_is_configured_only_with_jitsi_and_an_ingest_secret() {
        assert!(recording_configured_with("jitsi", true));
        assert!(!recording_configured_with("jitsi", false));
        assert!(!recording_configured_with("internal", true));
        assert!(!recording_configured_with("disabled", true));
    }

    #[actix_web::test]
    async fn recording_waits_for_each_party_to_consent_for_themselves() {
        let (state, session) = state().await;
        let before = status(&state, &session, PATIENT).await;
        assert_eq!(before["configured"], true);
        assert_eq!(before["your_party"], "patient");
        assert_eq!(
            call(&state, consent(&session, DOCTOR, true)).await.status(),
            200
        );
        // The clinician's own consent and a ticked box are not the patient's.
        assert_eq!(call(&state, start(&session)).await.status(), 409);
        assert_eq!(
            call(&state, consent(&session, PATIENT, true))
                .await
                .status(),
            200
        );
        assert_eq!(call(&state, start(&session)).await.status(), 200);
        let after = status(&state, &session, PATIENT).await;
        assert_eq!(after["recording"], true);
        assert_eq!(after["provider_consented"], true);
    }

    #[actix_web::test]
    async fn someone_outside_the_consultation_cannot_consent_or_look() {
        let (state, session) = state().await;
        assert_eq!(
            call(&state, consent(&session, OTHER_DOCTOR, true))
                .await
                .status(),
            403
        );
        let request = test::TestRequest::get()
            .uri(&format!(
                "/api/telehealth/sessions/{session}/recording-status"
            ))
            .insert_header(("x-user-id", OTHER_DOCTOR));
        assert_eq!(call(&state, request).await.status(), 403);
    }

    #[actix_web::test]
    async fn the_patient_withdrawing_stops_recording_and_the_file_is_not_kept() {
        let (state, session) = state().await;
        record(&state, &session).await;
        assert_eq!(
            call(&state, consent(&session, PATIENT, false))
                .await
                .status(),
            200
        );
        assert_eq!(status(&state, &session, DOCTOR).await["recording"], false);
        let response = call(&state, ingest(&session, TOKEN, "video/mp4", MP4)).await;
        assert_eq!(response.status(), 409);
    }

    #[actix_web::test]
    async fn a_recording_is_stored_encrypted_and_each_viewing_is_audited() {
        let (state, session) = state().await;
        record(&state, &session).await;
        let response = call(&state, ingest(&session, TOKEN, "video/mp4", MP4)).await;
        assert_eq!(response.status(), 201);
        let list = test::TestRequest::get()
            .uri(&format!("/api/telehealth/sessions/{session}/recordings"))
            .insert_header(("x-user-id", PATIENT));
        let listed: serde_json::Value = test::read_body_json(call(&state, list).await).await;
        let id = listed["recordings"][0]["id"].as_str().unwrap().to_string();
        let download = test::TestRequest::get()
            .uri(&format!("/api/telehealth/recordings/{id}"))
            .insert_header(("x-user-id", PATIENT));
        let response = call(&state, download).await;
        assert_eq!(response.status(), 200);
        assert_eq!(test::read_body(response).await.as_ref(), MP4);
        let logs = state
            .repositories
            .access_logs
            .get_by_patient(
                PATIENT_ID,
                crate::repositories::traits::Pagination::new(0, 100),
            )
            .await
            .unwrap();
        let viewed = logs
            .items
            .iter()
            .filter(|log| log.action == "telehealth_recording_viewed");
        assert_eq!(viewed.count(), 1);
        let other = test::TestRequest::get()
            .uri(&format!("/api/telehealth/recordings/{id}"))
            .insert_header(("x-user-id", OTHER_DOCTOR));
        assert_eq!(call(&state, other).await.status(), 403);
    }

    #[actix_web::test]
    async fn the_upload_needs_the_recorder_secret_and_a_real_video() {
        let (state, session) = state().await;
        record(&state, &session).await;
        let wrong = ingest(&session, "not-the-secret", "video/mp4", MP4);
        assert_eq!(call(&state, wrong).await.status(), 401);
        let pdf = ingest(&session, TOKEN, "video/mp4", b"%PDF-1.7 not a video");
        assert_eq!(call(&state, pdf).await.status(), 415);
    }
}
