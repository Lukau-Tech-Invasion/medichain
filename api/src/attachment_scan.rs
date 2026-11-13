//! Upload validation and malware-scan hook for message attachments (WP7.2).
//!
//! Two independent checks run on every uploaded file:
//!
//! 1. **What the bytes are.** The type is read from the file's magic bytes,
//!    not trusted from the extension or the declared `Content-Type`, and must
//!    be one of [`ALLOWED_ATTACHMENT_TYPES`] *and* agree with what the client
//!    declared.
//! 2. **Malware scan.** When `MEDICHAIN_CLAMD_ADDR` names a ClamAV daemon, the
//!    bytes are streamed to it with clamd's `INSTREAM` command (plain TCP, so
//!    no new dependency). Without one, the file is recorded as `not_scanned`
//!    and the UI says so; setting `MEDICHAIN_REQUIRE_ATTACHMENT_SCAN=true`
//!    refuses uploads instead. A configured scanner that errors or times out
//!    fails closed.

use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Largest attachment accepted, in bytes (10 MiB). Matches the IPFS
/// pipeline's own limit and the database CHECK.
pub const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;

/// The only types an attachment may be.
pub const ALLOWED_ATTACHMENT_TYPES: [&str; 3] = ["application/pdf", "image/jpeg", "image/png"];

/// How long a clamd scan may take before the upload is refused.
const SCAN_TIMEOUT: Duration = Duration::from_secs(30);
/// Chunk size streamed to clamd (it also enforces its own StreamMaxLength).
const CLAMD_CHUNK_BYTES: usize = 64 * 1024;
/// Longest clamd reply read back ("stream: <signature> FOUND").
const CLAMD_MAX_REPLY_BYTES: usize = 1024;

/// Detect an allowed type from the file's leading bytes.
///
/// Parameters: the file contents. Returns the MIME type, or `None` when the
/// bytes are not a PDF, JPEG or PNG whatever the name or header claims.
pub fn sniff_attachment_type(bytes: &[u8]) -> Option<&'static str> {
    const PDF: &[u8] = b"%PDF-";
    const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF];
    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    if bytes.starts_with(PDF) {
        Some("application/pdf")
    } else if bytes.starts_with(JPEG) {
        Some("image/jpeg")
    } else if bytes.starts_with(PNG) {
        Some("image/png")
    } else {
        None
    }
}

/// What the scan said about a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScanOutcome {
    /// A configured scanner found nothing.
    Clean,
    /// No scanner is configured; stored and labelled as not scanned.
    NotScanned,
    /// The scanner found something; the upload is refused.
    Infected(String),
}

impl ScanOutcome {
    /// The stored `scan_status` value for an accepted file.
    pub fn stored_status(&self) -> &'static str {
        match self {
            Self::Clean => "clean",
            _ => "not_scanned",
        }
    }
}

/// Why a scan could not produce an answer. The detail is for logs only.
#[derive(Debug)]
pub enum ScanError {
    /// Policy requires a scanner and none is configured.
    ScannerRequired,
    /// The configured scanner could not be reached or answered badly.
    Unavailable(String),
}

/// Whether an explicit env flag is `true`.
fn env_flag(name: &str) -> bool {
    std::env::var(name).is_ok_and(|v| v.trim().eq_ignore_ascii_case("true"))
}

/// Scan `bytes` with the configured scanner, if any.
///
/// Returns the outcome, or an error when a scan was required and could not
/// be completed: the caller refuses the upload rather than store it unscanned.
pub async fn scan_attachment(bytes: &[u8]) -> Result<ScanOutcome, ScanError> {
    let address = std::env::var("MEDICHAIN_CLAMD_ADDR")
        .ok()
        .filter(|a| !a.trim().is_empty());
    match address {
        Some(address) => tokio::time::timeout(SCAN_TIMEOUT, clamd_instream(address.trim(), bytes))
            .await
            .map_err(|_| ScanError::Unavailable("clamd scan timed out".into()))?,
        None if env_flag("MEDICHAIN_REQUIRE_ATTACHMENT_SCAN") => Err(ScanError::ScannerRequired),
        None => Ok(ScanOutcome::NotScanned),
    }
}

/// Stream `bytes` to clamd with `zINSTREAM` and interpret its reply.
async fn clamd_instream(address: &str, bytes: &[u8]) -> Result<ScanOutcome, ScanError> {
    let unavailable = |e: std::io::Error| ScanError::Unavailable(e.to_string());
    let mut stream = tokio::net::TcpStream::connect(address)
        .await
        .map_err(unavailable)?;
    stream
        .write_all(b"zINSTREAM\0")
        .await
        .map_err(unavailable)?;
    for chunk in bytes.chunks(CLAMD_CHUNK_BYTES) {
        // Each chunk is prefixed with its length as a 4-byte big-endian integer.
        let length =
            u32::try_from(chunk.len()).map_err(|e| ScanError::Unavailable(e.to_string()))?;
        stream
            .write_all(&length.to_be_bytes())
            .await
            .map_err(unavailable)?;
        stream.write_all(chunk).await.map_err(unavailable)?;
    }
    // A zero-length chunk ends the stream.
    stream
        .write_all(&0u32.to_be_bytes())
        .await
        .map_err(unavailable)?;
    let mut reply = Vec::with_capacity(CLAMD_MAX_REPLY_BYTES);
    (&mut stream)
        .take(CLAMD_MAX_REPLY_BYTES as u64)
        .read_to_end(&mut reply)
        .await
        .map_err(unavailable)?;
    interpret_clamd_reply(&String::from_utf8_lossy(&reply))
}

/// Read clamd's one-line answer: `stream: OK`, `stream: <sig> FOUND`, or an error.
fn interpret_clamd_reply(reply: &str) -> Result<ScanOutcome, ScanError> {
    let line = reply.trim_end_matches(['\0', '\n', '\r']).trim();
    if line.ends_with(": OK") {
        return Ok(ScanOutcome::Clean);
    }
    if let Some(found) = line.strip_suffix(" FOUND") {
        let signature = found.rsplit(": ").next().unwrap_or(found);
        return Ok(ScanOutcome::Infected(signature.to_string()));
    }
    Err(ScanError::Unavailable(format!(
        "unexpected clamd reply: {line}"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_type_comes_from_the_bytes_not_the_name() {
        assert_eq!(
            sniff_attachment_type(b"%PDF-1.7\n..."),
            Some("application/pdf")
        );
        assert_eq!(
            sniff_attachment_type(&[0xFF, 0xD8, 0xFF, 0xE0, 0]),
            Some("image/jpeg")
        );
        assert_eq!(
            sniff_attachment_type(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0]),
            Some("image/png")
        );
        // An executable renamed to .pdf, and HTML, are neither.
        assert_eq!(sniff_attachment_type(b"MZ\x90\x00"), None);
        assert_eq!(sniff_attachment_type(b"<html><script>"), None);
        assert_eq!(sniff_attachment_type(b""), None);
    }

    #[test]
    fn clamd_replies_are_read_strictly() {
        assert_eq!(
            interpret_clamd_reply("stream: OK\0").unwrap(),
            ScanOutcome::Clean
        );
        assert_eq!(
            interpret_clamd_reply("stream: Eicar-Test-Signature FOUND\0").unwrap(),
            ScanOutcome::Infected("Eicar-Test-Signature".into())
        );
        // Anything else is not an answer: the upload must fail closed.
        assert!(interpret_clamd_reply("INSTREAM size limit exceeded. ERROR\0").is_err());
        assert!(interpret_clamd_reply("").is_err());
    }

    #[tokio::test]
    async fn a_scan_against_a_listening_fake_clamd_reports_its_verdict() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap().to_string();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            let mut buffer = [0u8; 1024];
            // Read until the terminating zero-length chunk arrives.
            while !received.ends_with(&[0, 0, 0, 0]) {
                let n = socket.read(&mut buffer).await.unwrap();
                received.extend_from_slice(&buffer[..n]);
            }
            socket.write_all(b"stream: OK\0").await.unwrap();
        });
        let outcome = clamd_instream(&address, b"%PDF-1.7 small").await.unwrap();
        assert_eq!(outcome, ScanOutcome::Clean);
    }

    #[tokio::test]
    async fn an_unreachable_scanner_is_an_error_not_a_pass() {
        // Port 9 (discard) on loopback is not listening in the test sandbox.
        assert!(clamd_instream("127.0.0.1:9", b"%PDF-").await.is_err());
    }
}
