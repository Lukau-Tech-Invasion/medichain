//! The sealed audit stream (ADR-0010): hash-chained, Ed25519-signed batches of
//! audit rows, exported to a write-once sink.
//!
//! This module is the pure part: how a batch is hashed and signed, how a chain
//! of batches is checked, how the signing key and the checkpoint sink are
//! configured, and the sinks themselves. The database job that builds batches
//! is `audit_batching`; the leaf and Merkle encodings are `audit_merkle`.
//!
//! A batch's hash covers its own header **and the previous batch's hash**, so
//! editing, deleting or reordering any batch breaks every hash after it. The
//! signature over that hash, and the exported copy of it, are what a database
//! administrator cannot quietly redo: the key is not in the database, and the
//! sink is meant to be write-once.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use medichain_crypto::seal::{verify_signature, SealSigner};
use serde::Serialize;
use sha3::{Digest, Sha3_256};

use crate::audit_merkle::{decode_digest, Digest32};

/// Domain prefix of a batch hash. The version changes if the encoding does.
const BATCH_DOMAIN: &[u8] = b"medichain.audit.batch.v1\0";
/// Environment variable holding the Ed25519 seed (64 hex characters).
pub const SIGNING_KEY_VAR: &str = "AUDIT_SEAL_SIGNING_KEY";
/// Environment variable selecting the checkpoint sink.
pub const SINK_VAR: &str = "AUDIT_CHECKPOINT_SINK";
/// Environment variable naming the directory of the `filesystem` sink.
pub const SINK_DIR_VAR: &str = "AUDIT_CHECKPOINT_DIR";

// ---------------------------------------------------------------------------
// Batch hash
// ---------------------------------------------------------------------------

/// The fields a batch hash covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BatchHeader {
    pub id: i64,
    pub first_seq: i64,
    pub last_seq: i64,
    pub leaf_count: i32,
    pub merkle_root: Digest32,
    pub prev_batch_hash: Option<Digest32>,
}

/// Append a digest as a `u32` length and its bytes.
fn push_digest(buffer: &mut Vec<u8>, digest: &Digest32) {
    buffer.extend_from_slice(&(digest.len() as u32).to_be_bytes());
    buffer.extend_from_slice(digest);
}

/// The batch hash: SHA3-256 over the domain prefix and the header fields,
/// integers fixed-width big-endian and digests length-prefixed, the previous
/// hash behind a presence byte so "first batch" and "previous hash of zeros"
/// can never encode alike.
pub fn batch_hash(header: &BatchHeader) -> Digest32 {
    let mut buffer = Vec::with_capacity(128);
    buffer.extend_from_slice(BATCH_DOMAIN);
    buffer.extend_from_slice(&header.id.to_be_bytes());
    buffer.extend_from_slice(&header.first_seq.to_be_bytes());
    buffer.extend_from_slice(&header.last_seq.to_be_bytes());
    buffer.extend_from_slice(&header.leaf_count.to_be_bytes());
    push_digest(&mut buffer, &header.merkle_root);
    match &header.prev_batch_hash {
        None => buffer.push(0),
        Some(previous) => {
            buffer.push(1);
            push_digest(&mut buffer, previous);
        }
    }
    Sha3_256::digest(&buffer).into()
}

// ---------------------------------------------------------------------------
// Stored batches and their verification
// ---------------------------------------------------------------------------

/// A batch as it is stored, hex fields undecoded.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct StoredBatch {
    pub id: i64,
    pub first_seq: i64,
    pub last_seq: i64,
    pub leaf_count: i32,
    pub merkle_root: String,
    pub prev_batch_hash: Option<String>,
    pub batch_hash: Option<String>,
    pub signature: Option<String>,
    pub signing_key_id: Option<String>,
    pub status: String,
    pub sealed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub exported_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl StoredBatch {
    /// The header this batch's hash must cover, or `None` if a stored digest is
    /// not valid hex of the right length.
    fn header(&self) -> Option<BatchHeader> {
        Some(BatchHeader {
            id: self.id,
            first_seq: self.first_seq,
            last_seq: self.last_seq,
            leaf_count: self.leaf_count,
            merkle_root: decode_digest(&self.merkle_root)?,
            prev_batch_hash: match &self.prev_batch_hash {
                None => None,
                Some(text) => Some(decode_digest(text)?),
            },
        })
    }
}

/// What checking a sealed batch found.
#[derive(Debug, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum SignatureStatus {
    /// The hash is right, the batch links to its predecessor, and the
    /// signature verifies under the configured key.
    Valid,
    /// The hash, the link to the previous batch, or the signature is wrong, or
    /// the batch was signed by a key this instance does not hold.
    Invalid,
    /// Sealed without a signature (demo deployments with no signing key).
    Unsigned,
}

/// The public half of the configured signing key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SealVerifier {
    pub key_id: String,
    pub public_key: [u8; 32],
}

impl SealVerifier {
    /// The verifier for `signer`.
    pub fn for_signer(signer: &SealSigner) -> Self {
        Self {
            key_id: signer.key_id(),
            public_key: signer.public_key(),
        }
    }
}

/// Whether the signature on `stored` verifies under `verifier`.
fn signature_verifies(
    stored: &StoredBatch,
    hash: &Digest32,
    verifier: Option<&SealVerifier>,
) -> bool {
    let (Some(signature), Some(key_id), Some(verifier)) =
        (&stored.signature, &stored.signing_key_id, verifier)
    else {
        return false;
    };
    let Some(bytes) = medichain_crypto::from_hex(signature)
        .ok()
        .and_then(|raw| <[u8; 64]>::try_from(raw).ok())
    else {
        return false;
    };
    *key_id == verifier.key_id && verify_signature(&verifier.public_key, hash, &bytes)
}

/// Check one sealed batch. `actual_prev` is the hash of the batch that really
/// precedes it in storage (`None` for the first). Returns `None` for a batch
/// that is not sealed yet.
pub fn check_batch(
    stored: &StoredBatch,
    actual_prev: Option<&str>,
    verifier: Option<&SealVerifier>,
) -> Option<SignatureStatus> {
    let stored_hash = stored.batch_hash.as_deref()?;
    let recomputed = stored
        .header()
        .map(|header| hex::encode(batch_hash(&header)));
    let hash_ok = recomputed.as_deref() == Some(stored_hash);
    let link_ok = stored.prev_batch_hash.as_deref() == actual_prev;
    if !hash_ok || !link_ok {
        return Some(SignatureStatus::Invalid);
    }
    if stored.signature.is_none() {
        return Some(SignatureStatus::Unsigned);
    }
    let hash = decode_digest(stored_hash)?;
    Some(if signature_verifies(stored, &hash, verifier) {
        SignatureStatus::Valid
    } else {
        SignatureStatus::Invalid
    })
}

/// Check every sealed batch in `batches`, which must be in storage order (id
/// ascending), against the batch before it. Unsealed batches are skipped.
pub fn verify_chain(
    batches: &[StoredBatch],
    verifier: Option<&SealVerifier>,
) -> Vec<(i64, SignatureStatus)> {
    let mut previous: Option<&str> = None;
    let mut results = Vec::with_capacity(batches.len());
    for batch in batches {
        if let Some(status) = check_batch(batch, previous, verifier) {
            results.push((batch.id, status));
            previous = batch.batch_hash.as_deref();
        }
    }
    results
}

// ---------------------------------------------------------------------------
// Checkpoint export
// ---------------------------------------------------------------------------

/// The exported form of a sealed batch. Field order is fixed so the same batch
/// always serialises to the same bytes: re-exporting is a byte-for-byte no-op,
/// and a differing file is therefore a real conflict.
#[derive(Debug, Serialize)]
struct Checkpoint<'a> {
    format: &'static str,
    batch_id: i64,
    first_seq: i64,
    last_seq: i64,
    leaf_count: i32,
    merkle_root: &'a str,
    prev_batch_hash: Option<&'a str>,
    batch_hash: &'a str,
    signature: Option<&'a str>,
    signing_key_id: Option<&'a str>,
    sealed_at: String,
}

/// The checkpoint bytes of a sealed batch, or `None` for one that is not
/// sealed.
pub fn checkpoint_bytes(batch: &StoredBatch) -> Option<Vec<u8>> {
    let checkpoint = Checkpoint {
        format: "medichain.audit.checkpoint.v1",
        batch_id: batch.id,
        first_seq: batch.first_seq,
        last_seq: batch.last_seq,
        leaf_count: batch.leaf_count,
        merkle_root: &batch.merkle_root,
        prev_batch_hash: batch.prev_batch_hash.as_deref(),
        batch_hash: batch.batch_hash.as_deref()?,
        signature: batch.signature.as_deref(),
        signing_key_id: batch.signing_key_id.as_deref(),
        sealed_at: batch
            .sealed_at?
            .to_rfc3339_opts(chrono::SecondsFormat::Micros, true),
    };
    serde_json::to_vec_pretty(&checkpoint).ok()
}

/// Which sink is configured.
#[derive(Debug, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum SinkKind {
    None,
    Filesystem,
    /// An S3 bucket under Object Lock (`crate::audit_s3_sink`).
    S3,
}

/// Why a checkpoint could not be exported.
#[derive(Debug, thiserror::Error)]
pub enum SinkError {
    /// The sink already holds a different checkpoint under this name. Never
    /// overwritten: a changed checkpoint is exactly what the sink is for.
    #[error("checkpoint {0} already exists with different content")]
    Conflict(String),
    #[error("checkpoint sink failed: {0}")]
    Io(String),
}

/// Where sealed batches go. Implementations must never replace an existing,
/// different checkpoint, and must accept the same bytes again as a no-op.
#[async_trait]
pub trait CheckpointSink: Send + Sync {
    fn kind(&self) -> SinkKind;

    /// Store `body` as the checkpoint of `batch_id`; returns a reference to it.
    async fn put(&self, batch_id: i64, body: &[u8]) -> Result<String, SinkError>;
}

/// No sink: batches are sealed and stay `sealed`. Demo only.
pub struct NoSink;

#[async_trait]
impl CheckpointSink for NoSink {
    fn kind(&self) -> SinkKind {
        SinkKind::None
    }

    async fn put(&self, _batch_id: i64, _body: &[u8]) -> Result<String, SinkError> {
        Err(SinkError::Io(
            "no checkpoint sink is configured".to_string(),
        ))
    }
}

/// A sink that always fails, for proving that no request depends on export.
#[cfg(test)]
pub struct FailingSink;

#[cfg(test)]
#[async_trait]
impl CheckpointSink for FailingSink {
    fn kind(&self) -> SinkKind {
        SinkKind::Filesystem
    }

    async fn put(&self, _batch_id: i64, _body: &[u8]) -> Result<String, SinkError> {
        Err(SinkError::Io("sink is down".to_string()))
    }
}

/// One JSON file per batch in a directory.
pub struct FilesystemSink {
    dir: PathBuf,
}

impl FilesystemSink {
    /// A sink over `dir`, which must be absolute.
    pub fn new(dir: PathBuf) -> Result<Self, String> {
        if !dir.is_absolute() {
            return Err(format!("{SINK_DIR_VAR} must be an absolute path"));
        }
        Ok(Self { dir })
    }

    /// Create the directory if it is missing.
    pub fn ensure_dir(&self) -> Result<(), String> {
        std::fs::create_dir_all(&self.dir)
            .map_err(|error| format!("cannot create {SINK_DIR_VAR}: {error}"))
    }
}

/// Compare an existing checkpoint file with `body`.
async fn same_or_conflict(path: &Path, body: &[u8]) -> Result<String, SinkError> {
    let existing = tokio::fs::read(path)
        .await
        .map_err(|error| SinkError::Io(error.to_string()))?;
    if existing == body {
        Ok(path.display().to_string())
    } else {
        Err(SinkError::Conflict(path.display().to_string()))
    }
}

/// Write `body` to a fresh temporary file beside `target` and flush it.
async fn write_temp(temp: &Path, body: &[u8]) -> std::io::Result<()> {
    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temp)
        .await?;
    file.write_all(body).await?;
    file.sync_all().await
}

#[async_trait]
impl CheckpointSink for FilesystemSink {
    fn kind(&self) -> SinkKind {
        SinkKind::Filesystem
    }

    /// Atomic and never overwriting: the bytes go to a temporary file, which is
    /// then hard-linked to `<batch_id>.json` -- a link fails if the name exists,
    /// where a rename would replace it.
    async fn put(&self, batch_id: i64, body: &[u8]) -> Result<String, SinkError> {
        let target = self.dir.join(format!("{batch_id}.json"));
        if tokio::fs::try_exists(&target)
            .await
            .map_err(|error| SinkError::Io(error.to_string()))?
        {
            return same_or_conflict(&target, body).await;
        }
        let temp = self
            .dir
            .join(format!(".{batch_id}.{}.tmp", uuid::Uuid::new_v4()));
        write_temp(&temp, body)
            .await
            .map_err(|error| SinkError::Io(error.to_string()))?;
        let linked = tokio::fs::hard_link(&temp, &target).await;
        let _ = tokio::fs::remove_file(&temp).await;
        match linked {
            Ok(()) => Ok(target.display().to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                same_or_conflict(&target, body).await
            }
            Err(error) => Err(SinkError::Io(error.to_string())),
        }
    }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// The instance's sealing key and checkpoint sink.
#[derive(Clone)]
pub struct SealRuntime {
    pub signer: Option<Arc<SealSigner>>,
    pub sink: Arc<dyn CheckpointSink>,
    /// The last `audit_seal` summary and when it was computed. Health is polled
    /// by every open screen and the summary scans the audit tables, so it is
    /// recomputed at most every `SUMMARY_TTL`.
    pub summary_cache: Arc<std::sync::Mutex<Option<(std::time::Instant, serde_json::Value)>>>,
}

impl SealRuntime {
    /// No signing key, no sink: what tests and the in-memory profile use.
    pub fn unsigned_without_sink() -> Self {
        Self::new(None, Arc::new(NoSink))
    }

    /// A runtime over `signer` and `sink`.
    pub fn new(signer: Option<Arc<SealSigner>>, sink: Arc<dyn CheckpointSink>) -> Self {
        Self {
            signer,
            sink,
            summary_cache: Arc::new(std::sync::Mutex::new(None)),
        }
    }

    /// The public half of the signing key, if there is one.
    pub fn verifier(&self) -> Option<SealVerifier> {
        self.signer.as_deref().map(SealVerifier::for_signer)
    }

    /// `ed25519` when batches are signed, `unsigned` when not.
    pub fn signing_label(&self) -> &'static str {
        if self.signer.is_some() {
            "ed25519"
        } else {
            "unsigned"
        }
    }

    /// Read and validate the configuration from the process environment.
    pub fn from_env(is_demo: bool) -> Result<Self, String> {
        Self::from_lookup(|name| std::env::var(name).ok(), is_demo)
    }

    /// Read and validate the configuration through `lookup`.
    ///
    /// Outside demo mode a signing key and a sink other than `none` are both
    /// required. In demo mode either may be missing -- batches are then sealed
    /// unsigned, or left `sealed` -- but a value that is present must be valid.
    pub fn from_lookup(
        lookup: impl Fn(&str) -> Option<String>,
        is_demo: bool,
    ) -> Result<Self, String> {
        let value = |name: &str| lookup(name).filter(|text| !text.trim().is_empty());
        let signer = match value(SIGNING_KEY_VAR) {
            Some(seed) => Some(Arc::new(SealSigner::from_seed_hex(&seed).map_err(
                |_| format!("{SIGNING_KEY_VAR} must be 64 hex characters (an Ed25519 seed)"),
            )?)),
            None if is_demo => None,
            None => return Err(format!("{SIGNING_KEY_VAR} is required outside demo mode")),
        };
        let sink: Arc<dyn CheckpointSink> = match value(SINK_VAR).as_deref() {
            Some("filesystem") => {
                let dir = value(SINK_DIR_VAR).ok_or_else(|| {
                    format!("{SINK_DIR_VAR} is required with {SINK_VAR}=filesystem")
                })?;
                let sink = FilesystemSink::new(PathBuf::from(dir))?;
                sink.ensure_dir()?;
                Arc::new(sink)
            }
            Some("s3") => Arc::new(crate::audit_s3_sink::S3Sink::from_lookup(&lookup)?),
            Some("none") | None if is_demo => Arc::new(NoSink),
            Some("none") | None => {
                return Err(format!(
                    "{SINK_VAR}=filesystem or s3 is required outside demo mode; \
                     the audit checkpoint sink cannot be none in production"
                ))
            }
            Some(other) => {
                return Err(format!(
                    "{SINK_VAR} must be none, filesystem or s3, not {other:?}"
                ))
            }
        };
        Ok(Self::new(signer, sink))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEED: &str = "0707070707070707070707070707070707070707070707070707070707070707";

    fn signer() -> SealSigner {
        SealSigner::from_seed_hex(SEED).unwrap()
    }

    /// A stored, sealed, signed chain of `count` batches.
    fn chain(count: usize, signer: Option<&SealSigner>) -> Vec<StoredBatch> {
        let mut batches: Vec<StoredBatch> = Vec::new();
        for index in 0..count {
            let id = (index as i64 + 1) * 10;
            let header = BatchHeader {
                id,
                first_seq: index as i64 * 100 + 1,
                last_seq: index as i64 * 100 + 50,
                leaf_count: 50,
                merkle_root: [index as u8 + 1; 32],
                prev_batch_hash: batches
                    .last()
                    .and_then(|batch| batch.batch_hash.as_deref())
                    .and_then(decode_digest),
            };
            let hash = batch_hash(&header);
            batches.push(StoredBatch {
                id,
                first_seq: header.first_seq,
                last_seq: header.last_seq,
                leaf_count: header.leaf_count,
                merkle_root: hex::encode(header.merkle_root),
                prev_batch_hash: header.prev_batch_hash.map(hex::encode),
                batch_hash: Some(hex::encode(hash)),
                signature: signer.map(|s| hex::encode(s.sign(&hash))),
                signing_key_id: signer.map(SealSigner::key_id),
                status: "sealed".into(),
                sealed_at: chrono::DateTime::from_timestamp(1_790_000_000, 0),
                exported_at: None,
            });
        }
        batches
    }

    fn statuses(batches: &[StoredBatch], signer: Option<&SealSigner>) -> Vec<SignatureStatus> {
        let verifier = signer.map(SealVerifier::for_signer);
        verify_chain(batches, verifier.as_ref())
            .into_iter()
            .map(|(_, status)| status)
            .collect()
    }

    #[test]
    fn an_untouched_signed_chain_is_valid_end_to_end() {
        let signer = signer();
        let batches = chain(4, Some(&signer));
        assert_eq!(
            statuses(&batches, Some(&signer)),
            vec![SignatureStatus::Valid; 4]
        );
    }

    #[test]
    fn a_tampered_middle_batch_fails_and_only_that_batch() {
        let signer = signer();
        let mut batches = chain(4, Some(&signer));
        batches[1].merkle_root = hex::encode([0xEE; 32]);
        let found = statuses(&batches, Some(&signer));
        assert_eq!(found[1], SignatureStatus::Invalid);
        assert_eq!(found[0], SignatureStatus::Valid);
        assert_eq!(found[2], SignatureStatus::Valid, "its own link is intact");
    }

    #[test]
    fn a_tampered_middle_batch_with_a_recomputed_hash_breaks_the_next_link() {
        let signer = signer();
        let mut batches = chain(4, Some(&signer));
        batches[1].merkle_root = hex::encode([0xEE; 32]);
        let header = batches[1].header().unwrap();
        batches[1].batch_hash = Some(hex::encode(batch_hash(&header)));
        let found = statuses(&batches, Some(&signer));
        assert_eq!(
            found[1],
            SignatureStatus::Invalid,
            "the signature no longer matches"
        );
        assert_eq!(
            found[2],
            SignatureStatus::Invalid,
            "the next batch names the old hash"
        );
    }

    #[test]
    fn a_deleted_batch_breaks_the_link_after_it() {
        let signer = signer();
        let mut batches = chain(4, Some(&signer));
        batches.remove(1);
        let found = statuses(&batches, Some(&signer));
        assert_eq!(found[0], SignatureStatus::Valid);
        assert_eq!(found[1], SignatureStatus::Invalid);
        assert_eq!(found[2], SignatureStatus::Valid);
    }

    #[test]
    fn a_deleted_first_batch_is_detected_by_the_second() {
        let signer = signer();
        let mut batches = chain(3, Some(&signer));
        batches.remove(0);
        assert_eq!(
            statuses(&batches, Some(&signer))[0],
            SignatureStatus::Invalid
        );
    }

    #[test]
    fn reordered_batches_fail() {
        let signer = signer();
        let mut batches = chain(4, Some(&signer));
        batches.swap(1, 2);
        let found = statuses(&batches, Some(&signer));
        assert!(found.contains(&SignatureStatus::Invalid));
        assert_ne!(found, vec![SignatureStatus::Valid; 4]);
    }

    #[test]
    fn a_signature_from_another_key_is_invalid() {
        let signer = signer();
        let other = SealSigner::from_seed_hex(&"09".repeat(32)).unwrap();
        let batches = chain(2, Some(&other));
        assert_eq!(
            statuses(&batches, Some(&signer)),
            vec![SignatureStatus::Invalid; 2]
        );
    }

    #[test]
    fn a_corrupted_signature_is_invalid() {
        let signer = signer();
        let mut batches = chain(2, Some(&signer));
        batches[0].signature = Some("00".repeat(64));
        assert_eq!(
            statuses(&batches, Some(&signer))[0],
            SignatureStatus::Invalid
        );
    }

    #[test]
    fn a_batch_sealed_without_a_key_reads_unsigned_and_is_still_chain_checked() {
        let batches = chain(3, None);
        assert_eq!(statuses(&batches, None), vec![SignatureStatus::Unsigned; 3]);
        let mut edited = batches;
        edited[1].last_seq += 1;
        assert_eq!(statuses(&edited, None)[1], SignatureStatus::Invalid);
    }

    #[test]
    fn a_signed_batch_cannot_be_verified_without_a_key() {
        let signer = signer();
        let batches = chain(1, Some(&signer));
        assert_eq!(statuses(&batches, None), vec![SignatureStatus::Invalid]);
    }

    #[test]
    fn an_unsealed_batch_is_not_checked() {
        let mut batches = chain(2, None);
        batches[1].batch_hash = None;
        assert_eq!(verify_chain(&batches, None).len(), 1);
    }

    #[test]
    fn the_first_batch_and_a_zero_previous_hash_do_not_hash_alike() {
        let header = BatchHeader {
            id: 1,
            first_seq: 1,
            last_seq: 2,
            leaf_count: 2,
            merkle_root: [3; 32],
            prev_batch_hash: None,
        };
        let with_zero = BatchHeader {
            prev_batch_hash: Some([0; 32]),
            ..header
        };
        assert_ne!(batch_hash(&header), batch_hash(&with_zero));
    }

    #[test]
    fn a_checkpoint_serialises_identically_every_time() {
        let batch = &chain(1, Some(&signer()))[0];
        assert_eq!(checkpoint_bytes(batch), checkpoint_bytes(batch));
        let text = String::from_utf8(checkpoint_bytes(batch).unwrap()).unwrap();
        assert!(text.contains("\"batch_hash\""));
        assert!(text.contains("\"signing_key_id\""));
    }

    #[test]
    fn an_unsealed_batch_has_no_checkpoint() {
        let mut batch = chain(1, None).remove(0);
        batch.batch_hash = None;
        assert!(checkpoint_bytes(&batch).is_none());
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("medichain-seal-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn the_filesystem_sink_writes_the_checkpoint_and_a_repeat_is_a_no_op() {
        let dir = temp_dir("idempotent");
        let sink = FilesystemSink::new(dir.clone()).unwrap();
        let first = sink.put(7, b"{\"a\":1}").await.unwrap();
        let second = sink.put(7, b"{\"a\":1}").await.unwrap();
        assert_eq!(first, second);
        assert_eq!(std::fs::read(dir.join("7.json")).unwrap(), b"{\"a\":1}");
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "no temporary file is left behind");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn the_filesystem_sink_refuses_to_overwrite_a_different_checkpoint() {
        let dir = temp_dir("conflict");
        let sink = FilesystemSink::new(dir.clone()).unwrap();
        sink.put(7, b"original").await.unwrap();
        let result = sink.put(7, b"changed").await;
        assert!(matches!(result, Err(SinkError::Conflict(_))));
        assert_eq!(std::fs::read(dir.join("7.json")).unwrap(), b"original");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_filesystem_sink_needs_an_absolute_directory() {
        assert!(FilesystemSink::new(PathBuf::from("relative/dir")).is_err());
    }

    fn lookup<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| {
            pairs
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| value.to_string())
        }
    }

    #[test]
    fn production_requires_a_signing_key_and_a_real_sink() {
        let dir = std::env::temp_dir().display().to_string();
        assert!(SealRuntime::from_lookup(lookup(&[]), false).is_err());
        let seed_only = [(SIGNING_KEY_VAR, SEED)];
        assert!(SealRuntime::from_lookup(lookup(&seed_only), false).is_err());
        let sink_none = [(SIGNING_KEY_VAR, SEED), (SINK_VAR, "none")];
        assert!(SealRuntime::from_lookup(lookup(&sink_none), false).is_err());
        let no_dir = [(SIGNING_KEY_VAR, SEED), (SINK_VAR, "filesystem")];
        assert!(SealRuntime::from_lookup(lookup(&no_dir), false).is_err());
        let full = [
            (SIGNING_KEY_VAR, SEED),
            (SINK_VAR, "filesystem"),
            (SINK_DIR_VAR, dir.as_str()),
        ];
        let runtime = SealRuntime::from_lookup(lookup(&full), false).unwrap();
        assert_eq!(runtime.signing_label(), "ed25519");
        assert_eq!(runtime.sink.kind(), SinkKind::Filesystem);
    }

    #[test]
    fn demo_may_run_unsigned_and_without_a_sink() {
        let runtime = SealRuntime::from_lookup(lookup(&[]), true).unwrap();
        assert_eq!(runtime.signing_label(), "unsigned");
        assert_eq!(runtime.sink.kind(), SinkKind::None);
    }

    #[test]
    fn a_malformed_key_or_unknown_sink_is_refused_even_in_demo() {
        let bad_key = [(SIGNING_KEY_VAR, "not-hex")];
        assert!(SealRuntime::from_lookup(lookup(&bad_key), true).is_err());
        let bad_sink = [(SINK_VAR, "s3")];
        assert!(SealRuntime::from_lookup(lookup(&bad_sink), true).is_err());
    }
}
