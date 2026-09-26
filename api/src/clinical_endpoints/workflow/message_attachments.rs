//! `clinical_endpoints::workflow::message_attachments` — files on secure
//! messages (WP7.2).
//!
//! The sender attaches a file to a message they have already sent, so both
//! parties are known when it is stored. Every file is checked by its bytes
//! (PDF, JPEG or PNG only), capped in size, passed through the malware-scan
//! hook, and encrypted into the existing IPFS document pipeline. Only the two
//! people in the conversation may download it, and each download is audited
//! as a disclosure, attributed to the patient in the conversation when there
//! is one.

use super::*;
use crate::attachment_scan::{
    scan_attachment, sniff_attachment_type, ScanError, ScanOutcome, ALLOWED_ATTACHMENT_TYPES,
    MAX_ATTACHMENT_BYTES,
};
use crate::repositories::message_attachments::MessageAttachmentEntity;
use futures_util::StreamExt;
use serde::Serialize;

/// Most files one message may carry.
const MAX_ATTACHMENTS_PER_MESSAGE: usize = 5;
/// Longest stored filename, in characters.
const MAX_FILENAME_CHARS: usize = 120;
/// Name used when the client gives none that survives cleaning.
const FALLBACK_FILENAME: &str = "attachment";

/// Query string of the upload: the file's display name.
#[derive(Debug, Deserialize)]
pub struct AttachmentUploadQuery {
    #[serde(default)]
    pub filename: Option<String>,
}

/// An attachment as the API describes it (never the storage hashes).
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct AttachmentView {
    pub id: String,
    pub message_id: String,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: i64,
    /// `clean` or `not_scanned`; the UI labels unscanned files as such.
    pub scan_status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl From<&MessageAttachmentEntity> for AttachmentView {
    fn from(row: &MessageAttachmentEntity) -> Self {
        Self {
            id: row.id.clone(),
            message_id: row.message_id.clone(),
            filename: row.filename.clone(),
            content_type: row.content_type.clone(),
            size_bytes: row.size_bytes,
            scan_status: row.scan_status.clone(),
            created_at: row.created_at,
        }
    }
}

/// A JSON error with a stable code.
fn attachment_error(
    mut builder: actix_web::HttpResponseBuilder,
    message: &str,
    code: &str,
) -> HttpResponse {
    builder.json(ErrorResponse {
        error: message.to_string(),
        code: code.to_string(),
    })
}

/// 503 for a storage failure; the underlying error is logged, never returned.
fn attachment_unavailable(context: &str, error: impl std::fmt::Display) -> HttpResponse {
    log::error!("Message attachments: {context}: {error}");
    attachment_error(
        HttpResponse::ServiceUnavailable(),
        "Attachments are temporarily unavailable. Please try again shortly.",
        "ATTACHMENTS_UNAVAILABLE",
    )
}

/// Reduce a client-supplied filename to a safe display name.
///
/// Drops any path, keeps letters, digits, spaces and `._-()`, trims, and caps
/// the length. Parameters: the raw name. Returns a non-empty name.
fn clean_filename(raw: Option<&str>) -> String {
    let base = raw
        .unwrap_or_default()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default();
    let kept: String = base
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '.' | '_' | '-' | '(' | ')'))
        .take(MAX_FILENAME_CHARS)
        .collect();
    let trimmed = kept.trim().trim_start_matches('.').trim();
    if trimmed.is_empty() {
        FALLBACK_FILENAME.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Read the request body, refusing it as soon as it passes the size cap.
///
/// Returns the bytes, or a 413 / 400 response.
async fn read_capped_body(mut payload: web::Payload) -> Result<Vec<u8>, HttpResponse> {
    let mut bytes = Vec::new();
    while let Some(chunk) = payload.next().await {
        let chunk = chunk.map_err(|error| {
            log::warn!("attachment upload body could not be read: {error}");
            attachment_error(
                HttpResponse::BadRequest(),
                "The file could not be read.",
                "ATTACHMENT_UNREADABLE",
            )
        })?;
        if bytes.len() + chunk.len() > MAX_ATTACHMENT_BYTES {
            return Err(attachment_error(
                HttpResponse::PayloadTooLarge(),
                "Attachments can be at most 10 MB.",
                "ATTACHMENT_TOO_LARGE",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Err(attachment_error(
            HttpResponse::BadRequest(),
            "The file is empty.",
            "ATTACHMENT_EMPTY",
        ));
    }
    Ok(bytes)
}

/// The type the file really is, provided it is allowed and matches the
/// declared `Content-Type`. Otherwise a 415.
fn verified_type(http_req: &HttpRequest, bytes: &[u8]) -> Result<&'static str, HttpResponse> {
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
    match sniff_attachment_type(bytes) {
        Some(actual)
            if ALLOWED_ATTACHMENT_TYPES.contains(&actual)
                && declared.as_deref() == Some(actual) =>
        {
            Ok(actual)
        }
        _ => Err(attachment_error(
            HttpResponse::UnsupportedMediaType(),
            "Only PDF, JPEG and PNG files can be attached, and the file must really be one.",
            "UNSUPPORTED_ATTACHMENT_TYPE",
        )),
    }
}

/// Run the malware-scan hook and turn its answer into a stored status or a
/// refusal. A configured scanner that cannot answer refuses the upload.
async fn scanned_status(bytes: &[u8]) -> Result<&'static str, HttpResponse> {
    match scan_attachment(bytes).await {
        Ok(ScanOutcome::Infected(signature)) => {
            log::warn!("attachment refused by malware scan: {signature}");
            Err(attachment_error(
                HttpResponse::UnprocessableEntity(),
                "This file was flagged by the malware scanner and was not attached.",
                "ATTACHMENT_REJECTED",
            ))
        }
        Ok(outcome) => Ok(outcome.stored_status()),
        Err(ScanError::ScannerRequired) => Err(attachment_error(
            HttpResponse::ServiceUnavailable(),
            "Attachments need a malware scanner, and none is set up for this clinic.",
            "SCANNER_NOT_CONFIGURED",
        )),
        Err(ScanError::Unavailable(detail)) => Err(attachment_unavailable("malware scan", detail)),
    }
}

/// The two parties to a message and the patient among them, if any.
struct Conversation {
    sender_id: String,
    recipient_id: String,
    patient_id: Option<String>,
}

/// Load the sender's copy of `message_id` and work out who is in it.
///
/// The patient is the message's `related_patient_id`, else the linked record
/// of whichever party is a patient, kept only if that record exists (the
/// attachment row references it). Returns 404 when the message is unknown.
async fn load_conversation(
    data: &web::Data<AppState>,
    message_id: &str,
) -> Result<Conversation, HttpResponse> {
    let record = match data
        .repositories
        .messages
        .get_by_id(&format!("{message_id}:out"))
        .await
    {
        Ok(Some(record)) => record,
        Ok(None) => {
            return Err(attachment_error(
                HttpResponse::NotFound(),
                "Message not found.",
                "MESSAGE_NOT_FOUND",
            ))
        }
        Err(error) => return Err(attachment_unavailable("load message", error)),
    };
    let field = |name: &str| {
        record
            .data
            .get(name)
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };
    let (sender_id, recipient_id) = (
        field("sender_id").unwrap_or_default(),
        field("recipient_id").unwrap_or_default(),
    );
    let candidate = field("related_patient_id").or_else(|| {
        [&sender_id, &recipient_id]
            .into_iter()
            .filter_map(|wallet| crate::get_user(data, wallet))
            .find(|user| user.role == crate::Role::Patient)
            .and_then(|user| user.linked_patient_id)
    });
    let patient_id = match candidate {
        Some(id) => data
            .repositories
            .patients
            .get_by_id(&id)
            .await
            .ok()
            .map(|_| id),
        None => None,
    };
    Ok(Conversation {
        sender_id,
        recipient_id,
        patient_id,
    })
}

/// The audit row for an attachment act.
fn attachment_audit(
    caller: &crate::User,
    patient_id: Option<String>,
    attachment_id: &str,
    action: &str,
) -> crate::repositories::traits::AccessLogEntity {
    crate::repositories::traits::AccessLogEntity {
        id: crate::middleware::secure_tokens::generate_access_id(),
        accessor_id: caller.wallet_address.clone(),
        accessor_role: caller.role.to_string(),
        patient_id,
        resource_type: "message_attachment".to_string(),
        resource_id: Some(attachment_id.to_string()),
        action: action.to_string(),
        access_reason: None,
        is_emergency_access: false,
        ip_address: None,
        user_agent: None,
        blockchain_tx_hash: None,
        accessed_at: chrono::Utc::now(),
        facility_id: None,
    }
}

/// Refuse when the sender has not sent this message, or it is full.
async fn require_attachable(
    data: &web::Data<AppState>,
    caller: &crate::User,
    message_id: &str,
    conversation: &Conversation,
) -> Result<(), HttpResponse> {
    if conversation.sender_id != caller.wallet_address {
        return Err(attachment_error(
            HttpResponse::Forbidden(),
            "Only the sender can attach files to a message.",
            "NOT_MESSAGE_SENDER",
        ));
    }
    let existing = data
        .repositories
        .message_attachments
        .list_for_messages(&[message_id.to_string()])
        .await
        .map_err(|error| attachment_unavailable("count attachments", error))?;
    if existing.len() >= MAX_ATTACHMENTS_PER_MESSAGE {
        return Err(attachment_error(
            HttpResponse::Conflict(),
            "A message can carry at most 5 attachments.",
            "TOO_MANY_ATTACHMENTS",
        ));
    }
    Ok(())
}

/// A validated file, ready to be encrypted and stored.
struct ValidatedFile {
    filename: String,
    content_type: &'static str,
    scan_status: &'static str,
    bytes: Vec<u8>,
}

/// Encrypt the bytes into the IPFS pipeline and describe the stored file.
async fn store_encrypted(
    data: &web::Data<AppState>,
    caller: &crate::User,
    message_id: &str,
    conversation: &Conversation,
    file: ValidatedFile,
) -> Result<MessageAttachmentEntity, HttpResponse> {
    let ValidatedFile {
        filename,
        content_type,
        scan_status,
        bytes,
    } = file;
    let metadata = crate::ipfs::EncryptedMetadata {
        filename: filename.clone(),
        content_type: content_type.to_string(),
        uploaded_at: chrono::Utc::now().timestamp(),
        patient_id: conversation.patient_id.clone().unwrap_or_default(),
        uploaded_by: caller.wallet_address.clone(),
        record_type: "message_attachment".to_string(),
        key_version: String::new(),
    };
    let stored = data
        .ipfs_client
        .upload_encrypted(&bytes, metadata, &data.encryption_keyring)
        .await
        .map_err(|error| attachment_unavailable("encrypted upload", format!("{error:?}")))?;
    Ok(MessageAttachmentEntity {
        id: format!("ATT-{}", uuid::Uuid::new_v4()),
        message_id: message_id.to_string(),
        uploaded_by: caller.wallet_address.clone(),
        patient_id: conversation.patient_id.clone(),
        filename,
        content_type: content_type.to_string(),
        size_bytes: bytes.len() as i64,
        sha256: hex::encode(medichain_crypto::sha256(&bytes)),
        ipfs_hash: stored.ipfs_hash,
        metadata_hash: stored.metadata_hash,
        scan_status: scan_status.to_string(),
        created_at: chrono::Utc::now(),
    })
}

/// Attach a file to a message the caller sent.
///
/// The body is the file's raw bytes, `Content-Type` its type, `?filename=` its
/// name. Returns 201 with the attachment; 403 for someone else's message; 404
/// for an unknown message; 409 when it already has five; 413 over 10 MB; 415
/// when the bytes are not an allowed type; 422 when the scanner flags it; 503
/// when storage or a required scanner is unavailable.
#[post("/api/messages/{message_id}/attachments")]
pub async fn upload_message_attachment(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<AttachmentUploadQuery>,
    payload: web::Payload,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let message_id = path.into_inner();
    let conversation = match load_conversation(&data, &message_id).await {
        Ok(conversation) => conversation,
        Err(response) => return response,
    };
    if let Err(response) = require_attachable(&data, &caller, &message_id, &conversation).await {
        return response;
    }
    let bytes = match read_capped_body(payload).await {
        Ok(bytes) => bytes,
        Err(response) => return response,
    };
    let content_type = match verified_type(&http_req, &bytes) {
        Ok(content_type) => content_type,
        Err(response) => return response,
    };
    let scan_status = match scanned_status(&bytes).await {
        Ok(status) => status,
        Err(response) => return response,
    };
    let file = ValidatedFile {
        filename: clean_filename(query.filename.as_deref()),
        content_type,
        scan_status,
        bytes,
    };
    let row = match store_encrypted(&data, &caller, &message_id, &conversation, file).await {
        Ok(row) => row,
        Err(response) => return response,
    };
    let audit = attachment_audit(
        &caller,
        row.patient_id.clone(),
        &row.id,
        "message_attachment_uploaded",
    );
    match data
        .repositories
        .create_message_attachment(row, audit)
        .await
    {
        Ok(stored) => HttpResponse::Created().json(
            serde_json::json!({ "success": true, "attachment": AttachmentView::from(&stored) }),
        ),
        Err(error) => attachment_unavailable("record attachment", error),
    }
}

/// Fetch and decrypt an attachment's bytes, checking they are the bytes
/// that were stored. Returns them, or a 503 on storage or integrity failure.
async fn decrypted_bytes(
    data: &web::Data<AppState>,
    row: &MessageAttachmentEntity,
) -> Result<Vec<u8>, HttpResponse> {
    let downloaded = data
        .ipfs_client
        .download_decrypted(&row.ipfs_hash, &row.metadata_hash, &data.encryption_keyring)
        .await
        .map_err(|error| attachment_unavailable("encrypted download", format!("{error:?}")))?;
    if hex::encode(medichain_crypto::sha256(&downloaded.content)) != row.sha256 {
        return Err(attachment_unavailable(
            "integrity",
            format!("checksum mismatch on {}", row.id),
        ));
    }
    Ok(downloaded.content)
}

/// Download an attachment (the two people in the conversation only).
///
/// The bytes are fetched and verified first, then the disclosure is audited,
/// and only then sent: a failed audit sends nothing. Served as a download
/// with `nosniff` and `no-store`, never rendered inline by the API.
#[get("/api/messages/attachments/{attachment_id}")]
pub async fn download_message_attachment(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let row = match data
        .repositories
        .message_attachments
        .get_by_id(&path.into_inner())
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            return attachment_error(
                HttpResponse::NotFound(),
                "Attachment not found.",
                "ATTACHMENT_NOT_FOUND",
            )
        }
        Err(error) => return attachment_unavailable("load attachment", error),
    };
    let conversation = match load_conversation(&data, &row.message_id).await {
        Ok(conversation) => conversation,
        Err(response) => return response,
    };
    if caller.wallet_address != conversation.sender_id
        && caller.wallet_address != conversation.recipient_id
    {
        return attachment_error(
            HttpResponse::Forbidden(),
            "Only the people in this conversation can open its attachments.",
            "NOT_A_PARTICIPANT",
        );
    }
    let bytes = match decrypted_bytes(&data, &row).await {
        Ok(bytes) => bytes,
        Err(response) => return response,
    };
    let audit = attachment_audit(
        &caller,
        row.patient_id.clone(),
        &row.id,
        "message_attachment_downloaded",
    );
    if let Err(response) = crate::support::require_durable_audit(&data, audit).await {
        return response;
    }
    HttpResponse::Ok()
        .content_type(row.content_type.as_str())
        .insert_header((
            "Content-Disposition",
            format!("attachment; filename=\"{}\"", row.filename),
        ))
        .insert_header(("X-Content-Type-Options", "nosniff"))
        .insert_header(("Cache-Control", "no-store"))
        .body(bytes)
}

/// Attachment descriptions for a set of messages, grouped by message id.
///
/// Used by the message list. Returns the map, or a 503 on storage failure:
/// a list that silently dropped attachments would misreport what was sent.
pub(crate) async fn attachments_by_message(
    data: &web::Data<AppState>,
    message_ids: &[String],
) -> Result<std::collections::HashMap<String, Vec<AttachmentView>>, HttpResponse> {
    let rows = data
        .repositories
        .message_attachments
        .list_for_messages(message_ids)
        .await
        .map_err(|error| attachment_unavailable("list attachments", error))?;
    let mut grouped: std::collections::HashMap<String, Vec<AttachmentView>> =
        std::collections::HashMap::new();
    for row in &rows {
        grouped
            .entry(row.message_id.clone())
            .or_default()
            .push(AttachmentView::from(row));
    }
    Ok(grouped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filenames_lose_paths_and_markup() {
        assert_eq!(clean_filename(Some("../../etc/passwd")), "passwd");
        assert_eq!(
            clean_filename(Some("C:\\Users\\me\\scan (1).pdf")),
            "scan (1).pdf"
        );
        assert_eq!(
            clean_filename(Some("<script>x</script>.png")),
            "script.png" // the "/" in "</script>" is a path separator
        );
        assert_eq!(clean_filename(Some("report\"; x=1.pdf")), "report x1.pdf");
        assert_eq!(clean_filename(Some("...")), FALLBACK_FILENAME);
        assert_eq!(clean_filename(None), FALLBACK_FILENAME);
        assert_eq!(
            clean_filename(Some(&"a".repeat(500))).chars().count(),
            MAX_FILENAME_CHARS
        );
    }
}

#[cfg(test)]
mod handler_tests {
    use super::*;
    use actix_web::{test, App, HttpServer};
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    const PATIENT_ID: &str = "PAT-ATT";
    const PATIENT: &str = "patient_att";
    const DOCTOR: &str = "doctor_att";
    const OUTSIDER: &str = "nurse_outsider";
    const MESSAGE_ID: &str = "MSG-att00001";
    const PDF: &[u8] = b"%PDF-1.7\nsynthetic test document\n%%EOF";

    /// Store behind the fake IPFS node: content id -> bytes.
    type Blobs = Arc<Mutex<HashMap<String, Vec<u8>>>>;

    /// The file bytes inside a single-part multipart body.
    fn multipart_file(body: &[u8]) -> Vec<u8> {
        let start = body
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .map(|i| i + 4)
            .unwrap_or(0);
        let end = body
            .windows(4)
            .rposition(|w| w == b"\r\n--")
            .unwrap_or(body.len());
        body[start..end.max(start)].to_vec()
    }

    /// A minimal Kubo RPC stand-in: `add` stores, `cat` returns.
    async fn fake_ipfs() -> String {
        let blobs: Blobs = Arc::default();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let server = HttpServer::new(move || {
            let (add_blobs, cat_blobs) = (blobs.clone(), blobs.clone());
            App::new()
                .route(
                    "/api/v0/add",
                    web::post().to(move |body: web::Bytes| {
                        let blobs = add_blobs.clone();
                        async move {
                            let file = multipart_file(&body);
                            let cid = format!("b{}", hex::encode(medichain_crypto::sha256(&file)));
                            blobs.lock().unwrap().insert(cid.clone(), file);
                            HttpResponse::Ok().json(serde_json::json!({ "Hash": cid }))
                        }
                    }),
                )
                .route(
                    "/api/v0/cat",
                    web::post().to(move |q: web::Query<HashMap<String, String>>| {
                        let blobs = cat_blobs.clone();
                        async move {
                            match blobs
                                .lock()
                                .unwrap()
                                .get(q.get("arg").map(String::as_str).unwrap_or_default())
                            {
                                Some(bytes) => HttpResponse::Ok().body(bytes.clone()),
                                None => HttpResponse::InternalServerError().body("not found"),
                            }
                        }
                    }),
                )
        })
        .listen(listener)
        .unwrap()
        .run();
        actix_web::rt::spawn(server);
        address
    }

    /// State with a patient, their doctor, an outsider, and one sent message.
    async fn state(ipfs_url: &str) -> web::Data<AppState> {
        let mut state = AppState::new();
        state.ipfs_client =
            crate::ipfs::IpfsClient::new(ipfs_url.to_string(), ipfs_url.to_string());
        {
            let mut users = state.users.write().unwrap();
            let mut patient = crate::test_fixtures::staff(PATIENT, crate::Role::Patient);
            patient.linked_patient_id = Some(PATIENT_ID.into());
            users.insert(PATIENT.into(), patient);
            users.insert(
                DOCTOR.into(),
                crate::test_fixtures::staff(DOCTOR, crate::Role::Doctor),
            );
            users.insert(
                OUTSIDER.into(),
                crate::test_fixtures::staff(OUTSIDER, crate::Role::Nurse),
            );
        }
        crate::test_fixtures::seed_patient(&state, PATIENT_ID).await;
        let message = serde_json::json!({
            "message_id": MESSAGE_ID, "sender_id": PATIENT, "recipient_id": DOCTOR,
            "content": "My results", "sent_at": 1_790_000_000,
        });
        let now = chrono::Utc::now();
        for (suffix, owner) in [(":out", PATIENT), (":in", DOCTOR)] {
            state
                .repositories
                .messages
                .create(crate::repositories::traits::JsonRecordEntity {
                    id: format!("{MESSAGE_ID}{suffix}"),
                    owner_id: owner.into(),
                    data: message.clone(),
                    created_at: now,
                    updated_at: now,
                })
                .await
                .unwrap();
        }
        web::Data::new(state)
    }

    /// Send `request` as `wallet` to an app with both attachment routes.
    async fn call(
        state: &web::Data<AppState>,
        request: test::TestRequest,
        wallet: &str,
    ) -> actix_web::dev::ServiceResponse {
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(upload_message_attachment)
                .service(download_message_attachment),
        )
        .await;
        test::call_service(
            &app,
            request.insert_header(("x-user-id", wallet)).to_request(),
        )
        .await
    }

    fn upload(bytes: &[u8], content_type: &str) -> test::TestRequest {
        test::TestRequest::post()
            .uri(&format!(
                "/api/messages/{MESSAGE_ID}/attachments?filename=lab%20results.pdf"
            ))
            .insert_header(("content-type", content_type.to_string()))
            .set_payload(bytes.to_vec())
    }

    async fn actions(state: &web::Data<AppState>) -> Vec<String> {
        let page = crate::repositories::Pagination::new(0, 50);
        let logs = state
            .repositories
            .access_logs
            .get_by_patient(PATIENT_ID, page)
            .await
            .unwrap();
        logs.items.into_iter().map(|log| log.action).collect()
    }

    #[actix_web::test]
    async fn a_participant_uploads_and_the_other_downloads_the_same_bytes_audited() {
        let state = state(&fake_ipfs().await).await;
        let response = call(&state, upload(PDF, "application/pdf"), PATIENT).await;
        assert_eq!(response.status(), 201);
        let body: serde_json::Value = test::read_body_json(response).await;
        assert_eq!(body["attachment"]["filename"], "lab results.pdf");
        assert_eq!(body["attachment"]["scan_status"], "not_scanned");
        let id = body["attachment"]["id"].as_str().unwrap().to_string();

        let download = test::TestRequest::get().uri(&format!("/api/messages/attachments/{id}"));
        let response = call(&state, download, DOCTOR).await;
        assert_eq!(response.status(), 200);
        assert_eq!(
            response.headers().get("x-content-type-options").unwrap(),
            "nosniff"
        );
        assert!(response
            .headers()
            .get("content-disposition")
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("attachment;"));
        assert_eq!(test::read_body(response).await.as_ref(), PDF);
        let mut logged = actions(&state).await;
        logged.sort();
        assert_eq!(
            logged,
            [
                "message_attachment_downloaded",
                "message_attachment_uploaded"
            ]
        );
    }

    #[actix_web::test]
    async fn someone_outside_the_conversation_cannot_download() {
        let state = state(&fake_ipfs().await).await;
        let body: serde_json::Value =
            test::read_body_json(call(&state, upload(PDF, "application/pdf"), PATIENT).await).await;
        let id = body["attachment"]["id"].as_str().unwrap();
        let response = call(
            &state,
            test::TestRequest::get().uri(&format!("/api/messages/attachments/{id}")),
            OUTSIDER,
        )
        .await;
        assert_eq!(response.status(), 403);
        assert_eq!(
            actions(&state).await,
            ["message_attachment_uploaded"],
            "a refused read is not a disclosure"
        );
    }

    #[actix_web::test]
    async fn only_the_sender_can_attach() {
        let state = state(&fake_ipfs().await).await;
        assert_eq!(
            call(&state, upload(PDF, "application/pdf"), DOCTOR)
                .await
                .status(),
            403
        );
    }

    #[actix_web::test]
    async fn the_bytes_decide_the_type_not_the_header() {
        let state = state(&fake_ipfs().await).await;
        // An executable declared as a PDF, and a real PDF declared as a PNG.
        assert_eq!(
            call(
                &state,
                upload(b"MZ\x90\x00fake", "application/pdf"),
                PATIENT
            )
            .await
            .status(),
            415
        );
        assert_eq!(
            call(&state, upload(PDF, "image/png"), PATIENT)
                .await
                .status(),
            415
        );
    }

    #[actix_web::test]
    async fn an_oversized_file_is_refused() {
        let state = state(&fake_ipfs().await).await;
        let mut big = PDF.to_vec();
        big.resize(MAX_ATTACHMENT_BYTES + 1, b' ');
        assert_eq!(
            call(&state, upload(&big, "application/pdf"), PATIENT)
                .await
                .status(),
            413
        );
    }

    #[actix_web::test]
    async fn unreachable_storage_is_a_503_with_a_safe_message() {
        // Nothing listens on the discard port, so the encrypted upload fails.
        let state = state("http://127.0.0.1:9").await;
        let response = call(&state, upload(PDF, "application/pdf"), PATIENT).await;
        assert_eq!(response.status(), 503);
        let body: serde_json::Value = test::read_body_json(response).await;
        assert_eq!(body["error"]["code"], "ATTACHMENTS_UNAVAILABLE");
        assert!(actions(&state).await.is_empty());
    }
}
