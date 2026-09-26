//! Intake and retrieval of encrypted documents uploaded as raw bytes: message
//! attachments (WP7.2) and explanation-of-benefits documents (WP7.3).
//!
//! One place for the rules every uploaded file meets, so a new document kind
//! cannot quietly skip one:
//!
//! - the body is read with a hard size cap, refused as soon as it passes it;
//! - the type is read from the bytes and must match the declared type;
//! - the malware-scan hook runs (see `attachment_scan`);
//! - the bytes are encrypted into the IPFS document pipeline, and on the way
//!   back are decrypted and checked against the stored SHA-256 before anyone
//!   receives them;
//! - downloads are served as attachments, never rendered by the API.

use actix_web::{web, HttpRequest, HttpResponse};
use futures_util::StreamExt;

use crate::attachment_scan::{
    scan_attachment, sniff_attachment_type, ScanError, ScanOutcome, ALLOWED_ATTACHMENT_TYPES,
    MAX_ATTACHMENT_BYTES,
};
use crate::state::AppState;
use crate::ErrorResponse;

/// Longest stored filename, in characters.
const MAX_FILENAME_CHARS: usize = 120;
/// Name used when the client gives none that survives cleaning.
const FALLBACK_FILENAME: &str = "document";

/// A JSON error with a stable code.
pub fn intake_error(
    mut builder: actix_web::HttpResponseBuilder,
    message: &str,
    code: &str,
) -> HttpResponse {
    builder.json(ErrorResponse {
        error: message.to_string(),
        code: code.to_string(),
    })
}

/// Reduce a client-supplied filename to a safe display name.
///
/// Drops any path, keeps letters, digits, spaces and `._-()`, trims, and caps
/// the length. Parameters: the raw name. Returns a non-empty name.
pub fn clean_filename(raw: Option<&str>) -> String {
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
pub async fn read_capped_body(payload: web::Payload) -> Result<Vec<u8>, HttpResponse> {
    read_body_within(payload, MAX_ATTACHMENT_BYTES, "Files can be at most 10 MB.").await
}

/// Read the request body, refusing it as soon as it passes `cap` bytes.
///
/// Parameters: the body, the cap, and the message a 413 carries. Returns the
/// bytes, or a 413 (too large) / 400 (unreadable or empty) response.
pub async fn read_body_within(
    mut payload: web::Payload,
    cap: usize,
    too_large_message: &str,
) -> Result<Vec<u8>, HttpResponse> {
    let mut bytes = Vec::new();
    while let Some(chunk) = payload.next().await {
        let chunk = chunk.map_err(|error| {
            log::warn!("document upload body could not be read: {error}");
            intake_error(
                HttpResponse::BadRequest(),
                "The file could not be read.",
                "FILE_UNREADABLE",
            )
        })?;
        if bytes.len() + chunk.len() > cap {
            return Err(intake_error(
                HttpResponse::PayloadTooLarge(),
                too_large_message,
                "FILE_TOO_LARGE",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Err(intake_error(
            HttpResponse::BadRequest(),
            "The file is empty.",
            "FILE_EMPTY",
        ));
    }
    Ok(bytes)
}

/// The type the file really is, provided it is allowed and matches the
/// declared `Content-Type`. Otherwise a 415.
pub fn verified_type(http_req: &HttpRequest, bytes: &[u8]) -> Result<&'static str, HttpResponse> {
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
        _ => Err(intake_error(
            HttpResponse::UnsupportedMediaType(),
            "Only PDF, JPEG and PNG files are accepted, and the file must really be one.",
            "UNSUPPORTED_FILE_TYPE",
        )),
    }
}

/// Run the malware-scan hook and turn its answer into a stored status or a
/// refusal. A configured scanner that cannot answer refuses the upload.
pub async fn scanned_status(bytes: &[u8]) -> Result<&'static str, HttpResponse> {
    match scan_attachment(bytes).await {
        Ok(ScanOutcome::Infected(signature)) => {
            log::warn!("upload refused by malware scan: {signature}");
            Err(intake_error(
                HttpResponse::UnprocessableEntity(),
                "This file was flagged by the malware scanner and was not stored.",
                "FILE_REJECTED",
            ))
        }
        Ok(outcome) => Ok(outcome.stored_status()),
        Err(ScanError::ScannerRequired) => Err(intake_error(
            HttpResponse::ServiceUnavailable(),
            "File uploads need a malware scanner, and none is set up for this clinic.",
            "SCANNER_NOT_CONFIGURED",
        )),
        Err(ScanError::Unavailable(detail)) => {
            log::error!("malware scan unavailable: {detail}");
            Err(intake_error(
                HttpResponse::ServiceUnavailable(),
                "The file could not be checked right now. Please try again shortly.",
                "SCANNER_UNAVAILABLE",
            ))
        }
    }
}

/// A validated upload: cleaned name, verified type and scan status.
pub struct ValidatedFile {
    pub filename: String,
    pub content_type: &'static str,
    pub scan_status: &'static str,
    pub bytes: Vec<u8>,
}

/// Read, type-check and scan an upload. Returns the file or the refusal.
pub async fn validate_upload(
    http_req: &HttpRequest,
    payload: web::Payload,
    filename: Option<&str>,
) -> Result<ValidatedFile, HttpResponse> {
    let bytes = read_capped_body(payload).await?;
    let content_type = verified_type(http_req, &bytes)?;
    let scan_status = scanned_status(&bytes).await?;
    Ok(ValidatedFile {
        filename: clean_filename(filename),
        content_type,
        scan_status,
        bytes,
    })
}

/// Where an encrypted document landed, and how to verify it on the way back.
pub struct StoredDocument {
    pub ipfs_hash: String,
    pub metadata_hash: String,
    pub sha256: String,
    pub size_bytes: i64,
}

/// Encrypt `file` into the IPFS pipeline.
///
/// Parameters: state, the file, and who and what it concerns (written into the
/// encrypted metadata). Returns where it was stored, or the storage error text
/// for the caller to log; callers answer 503.
pub async fn store_encrypted(
    data: &web::Data<AppState>,
    file: &ValidatedFile,
    patient_id: Option<&str>,
    uploaded_by: &str,
    record_type: &str,
) -> Result<StoredDocument, String> {
    let metadata = crate::ipfs::EncryptedMetadata {
        filename: file.filename.clone(),
        content_type: file.content_type.to_string(),
        uploaded_at: chrono::Utc::now().timestamp(),
        patient_id: patient_id.unwrap_or_default().to_string(),
        uploaded_by: uploaded_by.to_string(),
        record_type: record_type.to_string(),
        key_version: String::new(),
    };
    let stored = data
        .ipfs_client
        .upload_encrypted(&file.bytes, metadata, &data.encryption_keyring)
        .await
        .map_err(|error| format!("{error:?}"))?;
    Ok(StoredDocument {
        ipfs_hash: stored.ipfs_hash,
        metadata_hash: stored.metadata_hash,
        sha256: hex::encode(medichain_crypto::sha256(&file.bytes)),
        size_bytes: file.bytes.len() as i64,
    })
}

/// Fetch and decrypt a document, checking it is the bytes that were stored.
/// Returns the bytes, or the error text for the caller to log (answer 503).
pub async fn fetch_verified(
    data: &web::Data<AppState>,
    ipfs_hash: &str,
    metadata_hash: &str,
    expected_sha256: &str,
) -> Result<Vec<u8>, String> {
    let downloaded = data
        .ipfs_client
        .download_decrypted(ipfs_hash, metadata_hash, &data.encryption_keyring)
        .await
        .map_err(|error| format!("{error:?}"))?;
    if hex::encode(medichain_crypto::sha256(&downloaded.content)) != expected_sha256 {
        return Err(format!("checksum mismatch for {ipfs_hash}"));
    }
    Ok(downloaded.content)
}

/// Serve verified bytes as a download: never rendered inline, never cached.
pub fn download_response(filename: &str, content_type: &str, bytes: Vec<u8>) -> HttpResponse {
    HttpResponse::Ok()
        .content_type(content_type)
        .insert_header((
            "Content-Disposition",
            format!(
                "attachment; filename=\"{}\"",
                clean_filename(Some(filename))
            ),
        ))
        .insert_header(("X-Content-Type-Options", "nosniff"))
        .insert_header(("Cache-Control", "no-store"))
        .body(bytes)
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
        // The "/" in "</script>" is a path separator, so only "script>.png" remains.
        assert_eq!(clean_filename(Some("<script>x</script>.png")), "script.png");
        assert_eq!(clean_filename(Some("report\"; x=1.pdf")), "report x1.pdf");
        assert_eq!(clean_filename(Some("...")), FALLBACK_FILENAME);
        assert_eq!(clean_filename(None), FALLBACK_FILENAME);
        assert_eq!(
            clean_filename(Some(&"a".repeat(500))).chars().count(),
            MAX_FILENAME_CHARS
        );
    }
}
