//! Sealing of the audit stream (WP8, ADR-0010), PostgreSQL only.
//!
//! A background job takes the rows that are in no batch yet, from both sources
//! -- `access_logs` and `audit_events` -- hashes each into a leaf
//! (`audit_merkle`), and stores one batch: its Merkle root, its members, the
//! hash of the previous batch, and an Ed25519 signature over the batch hash
//! (`audit_seal`). The batch and its seal are written in one transaction, so a
//! batch is never visible unsealed. A second step exports sealed batches, in id
//! order, to the configured checkpoint sink.
//!
//! Nothing on a request path waits for any of this. A request writes its own
//! audit row and returns; sealing and export run here, and a failure in either
//! is logged and retried, never surfaced to a clinician.
//!
//! The job holds a transaction-scoped PostgreSQL advisory lock, so two API
//! instances never build overlapping batches: the second simply skips a turn.

use std::collections::HashMap;

use medichain_crypto::seal::SealSigner;
use sqlx::{FromRow, PgPool};

use crate::audit_merkle::{decode_digest, event_leaf_hash, leaf_hash, merkle_root, Digest32};
use crate::audit_outbox::AuditEvent;
use crate::audit_seal::{
    batch_hash, checkpoint_bytes, verify_chain, BatchHeader, CheckpointSink, SealRuntime,
    SignatureStatus, SinkKind, StoredBatch,
};
use crate::repositories::traits::AccessLogEntity;

/// Most rows one batch takes; the rest wait for the next turn.
pub const MAX_BATCH_LEAVES: i64 = 1024;
/// Most sealed batches one export pass sends.
const MAX_EXPORT_BATCHES: i64 = 100;
/// Advisory-lock key of the batching job ("MCAUDITB" in ASCII).
const AUDIT_BATCH_LOCK_KEY: i64 = 0x4d43_4155_4449_5442;
/// Member source of an `access_logs` row.
pub const SOURCE_ACCESS_LOG: &str = "access_log";
/// Member source of an `audit_events` row.
pub const SOURCE_AUDIT_EVENT: &str = "audit_event";
/// How long a computed `audit_seal` summary is reused.
const SUMMARY_TTL: std::time::Duration = std::time::Duration::from_secs(15);
/// The seal status of something no batch holds yet.
pub const STATUS_PENDING: &str = "pending";

/// The columns an access-log row is hashed from, and its batching order.
const ROW_COLUMNS: &str = "id, accessor_id, accessor_role, patient_id, resource_type, \
    resource_id, action, access_reason, COALESCE(is_emergency_access, false) AS is_emergency_access, \
    ip_address, user_agent, accessed_at, facility_id, authority_type, authority_id";

/// The columns of a stored batch.
pub const BATCH_COLUMNS: &str = "id, first_seq, last_seq, leaf_count, merkle_root, \
    prev_batch_hash, batch_hash, signature, signing_key_id, status, sealed_at, exported_at";

/// A batch the job just built and sealed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuiltBatch {
    pub id: i64,
    pub merkle_root: String,
    pub first_seq: i64,
    pub last_seq: i64,
    pub leaf_count: i32,
    pub batch_hash: String,
    pub signed: bool,
}

/// One row waiting to be sealed.
struct SealLeaf {
    source: &'static str,
    id: String,
    seq: i64,
    hash: Digest32,
}

/// Access-log rows in no batch yet, oldest sequence first.
async fn unsealed_access_logs(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<Vec<SealLeaf>, sqlx::Error> {
    let sql = format!(
        "SELECT {ROW_COLUMNS}, seal_seq FROM access_logs a
         WHERE NOT EXISTS (
            SELECT 1 FROM audit_seal_batch_members m
            WHERE m.source = '{SOURCE_ACCESS_LOG}' AND m.source_id = a.id
         )
         ORDER BY seal_seq LIMIT $1"
    );
    let rows = sqlx::query(&sql)
        .bind(MAX_BATCH_LEAVES)
        .fetch_all(&mut **tx)
        .await?;
    rows.iter()
        .map(|row| {
            use sqlx::Row;
            let entity = AccessLogEntity::from_row(row)?;
            Ok(SealLeaf {
                source: SOURCE_ACCESS_LOG,
                seq: row.try_get("seal_seq")?,
                hash: leaf_hash(&entity),
                id: entity.id,
            })
        })
        .collect()
}

type EventRow = (
    String,
    String,
    String,
    String,
    String,
    serde_json::Value,
    chrono::DateTime<chrono::Utc>,
    i64,
);

/// Audit events in no batch yet, oldest sequence first.
async fn unsealed_audit_events(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<Vec<SealLeaf>, sqlx::Error> {
    let sql = format!(
        "SELECT id, event_type, aggregate_type, aggregate_id, payload_hash, payload,
                occurred_at, seal_seq
         FROM audit_events e
         WHERE NOT EXISTS (
            SELECT 1 FROM audit_seal_batch_members m
            WHERE m.source = '{SOURCE_AUDIT_EVENT}' AND m.source_id = e.id
         )
         ORDER BY seal_seq LIMIT $1"
    );
    let rows: Vec<EventRow> = sqlx::query_as(&sql)
        .bind(MAX_BATCH_LEAVES)
        .fetch_all(&mut **tx)
        .await?;
    Ok(rows
        .into_iter()
        .map(
            |(id, event_type, aggregate_type, aggregate_id, payload_hash, payload, at, seq)| {
                let event = AuditEvent {
                    id,
                    event_type,
                    aggregate_type,
                    aggregate_id,
                    payload_hash,
                    payload,
                    occurred_at: at,
                };
                SealLeaf {
                    source: SOURCE_AUDIT_EVENT,
                    seq,
                    hash: event_leaf_hash(&event),
                    id: event.id,
                }
            },
        )
        .collect())
}

/// Both sources in one total order (they share one sequence), at most one
/// batch's worth.
fn merge_leaves(mut logs: Vec<SealLeaf>, events: Vec<SealLeaf>) -> Vec<SealLeaf> {
    logs.extend(events);
    logs.sort_by_key(|leaf| leaf.seq);
    logs.truncate(MAX_BATCH_LEAVES as usize);
    logs
}

/// The hash of the sealed batch that precedes batch `id`, if any.
async fn previous_batch_hash(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id: i64,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT batch_hash FROM audit_seal_batches
         WHERE id < $1 AND batch_hash IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
}

/// A batch waiting for its seal: header fields as stored.
type UnsealedBatch = (i64, i64, i64, i32, String);

/// Seal one batch: link it to its predecessor, hash it, sign the hash, and mark
/// it `sealed`. Returns the batch hash (hex) and whether it was signed.
async fn seal_batch(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    batch: &UnsealedBatch,
    signer: Option<&SealSigner>,
) -> Result<(String, bool), String> {
    let (id, first_seq, last_seq, leaf_count, root) = batch;
    let previous = previous_batch_hash(tx, *id)
        .await
        .map_err(|error| error.to_string())?;
    let header = BatchHeader {
        id: *id,
        first_seq: *first_seq,
        last_seq: *last_seq,
        leaf_count: *leaf_count,
        merkle_root: decode_digest(root).ok_or("stored merkle root is not a digest")?,
        prev_batch_hash: match &previous {
            None => None,
            Some(text) => Some(decode_digest(text).ok_or("stored batch hash is not a digest")?),
        },
    };
    let hash = batch_hash(&header);
    let (signature, key_id) = signer
        .map(|signer| (hex::encode(signer.sign(&hash)), signer.key_id()))
        .unzip();
    sqlx::query(
        "UPDATE audit_seal_batches
         SET status = 'sealed', prev_batch_hash = $2, batch_hash = $3, signature = $4,
             signing_key_id = $5, sealed_at = NOW()
         WHERE id = $1 AND status = 'pending'",
    )
    .bind(id)
    .bind(&previous)
    .bind(hex::encode(hash))
    .bind(&signature)
    .bind(&key_id)
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;
    Ok((hex::encode(hash), signer.is_some()))
}

/// Seal every batch left `pending` -- those built before sealing existed --
/// in id order, so the chain runs through them.
async fn seal_pending_batches(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    signer: Option<&SealSigner>,
) -> Result<usize, String> {
    let pending: Vec<UnsealedBatch> = sqlx::query_as(
        "SELECT id, first_seq, last_seq, leaf_count, merkle_root FROM audit_seal_batches
         WHERE status = 'pending' ORDER BY id",
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;
    for batch in &pending {
        seal_batch(tx, batch, signer).await?;
    }
    Ok(pending.len())
}

/// Insert the batch row (`pending`, for the moment) and its members; returns
/// the batch id.
async fn insert_batch(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    leaves: &[SealLeaf],
    root: &str,
) -> Result<i64, sqlx::Error> {
    let first = leaves.first().map_or(0, |leaf| leaf.seq);
    let last = leaves.last().map_or(0, |leaf| leaf.seq);
    let batch_id: i64 = sqlx::query_scalar(
        "INSERT INTO audit_seal_batches (merkle_root, first_seq, last_seq, leaf_count)
         VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .bind(root)
    .bind(first)
    .bind(last)
    .bind(leaves.len() as i32)
    .fetch_one(&mut **tx)
    .await?;
    let sources: Vec<&str> = leaves.iter().map(|leaf| leaf.source).collect();
    let ids: Vec<&str> = leaves.iter().map(|leaf| leaf.id.as_str()).collect();
    let hashes: Vec<String> = leaves.iter().map(|leaf| hex::encode(leaf.hash)).collect();
    let indexes: Vec<i32> = (0..leaves.len() as i32).collect();
    sqlx::query(
        "INSERT INTO audit_seal_batch_members (batch_id, leaf_index, source, source_id, leaf_hash)
         SELECT $1, idx, src, member, leaf
         FROM UNNEST($2::int[], $3::text[], $4::text[], $5::text[]) AS t(idx, src, member, leaf)",
    )
    .bind(batch_id)
    .bind(indexes)
    .bind(sources)
    .bind(ids)
    .bind(hashes)
    .execute(&mut **tx)
    .await?;
    Ok(batch_id)
}

/// Seal what is waiting, if anything is and no other instance holds the job's
/// lock: first any legacy `pending` batches, then one new batch over the
/// unsealed rows of both sources. Returns the batch built, or `None`.
pub async fn build_next_batch(
    pool: &PgPool,
    signer: Option<&SealSigner>,
) -> Result<Option<BuiltBatch>, String> {
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
        .bind(AUDIT_BATCH_LOCK_KEY)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;
    if !locked {
        return Ok(None);
    }
    let legacy = seal_pending_batches(&mut tx, signer).await?;
    if legacy > 0 {
        log::info!("Sealed {legacy} audit batch(es) built before sealing existed");
    }
    let logs = unsealed_access_logs(&mut tx)
        .await
        .map_err(|error| error.to_string())?;
    let events = unsealed_audit_events(&mut tx)
        .await
        .map_err(|error| error.to_string())?;
    let leaves = merge_leaves(logs, events);
    let hashes: Vec<Digest32> = leaves.iter().map(|leaf| leaf.hash).collect();
    let Some(root) = merkle_root(&hashes).map(hex::encode) else {
        tx.commit().await.map_err(|error| error.to_string())?;
        return Ok(None);
    };
    let id = insert_batch(&mut tx, &leaves, &root)
        .await
        .map_err(|error| error.to_string())?;
    let first_seq = leaves.first().map_or(0, |leaf| leaf.seq);
    let last_seq = leaves.last().map_or(0, |leaf| leaf.seq);
    let leaf_count = leaves.len() as i32;
    let unsealed = (id, first_seq, last_seq, leaf_count, root.clone());
    let (batch_hash, signed) = seal_batch(&mut tx, &unsealed, signer).await?;
    tx.commit().await.map_err(|error| error.to_string())?;
    Ok(Some(BuiltBatch {
        id,
        merkle_root: root,
        first_seq,
        last_seq,
        leaf_count,
        batch_hash,
        signed,
    }))
}

/// What one export pass did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ExportOutcome {
    /// Batches now `exported`.
    pub exported: usize,
    /// Why the pass stopped early, if it did. Export order is id order, so one
    /// failure holds back everything after it.
    pub failure: Option<String>,
}

/// Send sealed batches, oldest first, to `sink` and mark each `exported`.
///
/// A batch whose checkpoint already exists identically is marked exported (the
/// sink accepts the same bytes again), which is what makes a crash between the
/// write and the mark harmless. A checkpoint that exists with different content
/// stops the pass: it is reported, and never overwritten.
pub async fn export_sealed_batches(
    pool: &PgPool,
    sink: &dyn CheckpointSink,
) -> Result<ExportOutcome, String> {
    let batches: Vec<StoredBatch> = sqlx::query_as(&format!(
        "SELECT {BATCH_COLUMNS} FROM audit_seal_batches
         WHERE status = 'sealed' ORDER BY id LIMIT $1"
    ))
    .bind(MAX_EXPORT_BATCHES)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;
    let mut outcome = ExportOutcome::default();
    for batch in &batches {
        let Some(body) = checkpoint_bytes(batch) else {
            outcome.failure = Some(format!("batch {} has no checkpoint form", batch.id));
            break;
        };
        let reference = match sink.put(batch.id, &body).await {
            Ok(reference) => reference,
            Err(error) => {
                outcome.failure = Some(format!("batch {}: {error}", batch.id));
                break;
            }
        };
        sqlx::query(
            "UPDATE audit_seal_batches SET status = 'exported', exported_at = NOW(), export_ref = $2
             WHERE id = $1 AND status = 'sealed'",
        )
        .bind(batch.id)
        .bind(reference)
        .execute(pool)
        .await
        .map_err(|error| error.to_string())?;
        outcome.exported += 1;
    }
    Ok(outcome)
}

/// One pass of the job: seal, then export. Logs and returns; never fails a
/// caller, because nothing on a request path calls it.
pub async fn run_seal_pass(pool: &PgPool, runtime: &SealRuntime) {
    match build_next_batch(pool, runtime.signer.as_deref()).await {
        Ok(Some(batch)) => log::info!(
            "Audit batch {} sealed: {} rows, root {}",
            batch.id,
            batch.leaf_count,
            batch.merkle_root
        ),
        Ok(None) => {}
        Err(error) => log::error!("Audit sealing failed: {error}"),
    }
    if runtime.sink.kind() == SinkKind::None {
        return;
    }
    let exported = crate::job_lock::run_exclusive(
        Some(pool),
        crate::job_lock::JobKey::AuditCheckpointExport,
        || export_sealed_batches(pool, runtime.sink.as_ref()),
    )
    .await;
    match exported {
        Some(Ok(outcome)) => {
            if outcome.exported > 0 {
                log::info!("Exported {} audit checkpoint(s)", outcome.exported);
            }
            if let Some(failure) = outcome.failure {
                log::error!("Audit checkpoint export stopped: {failure}");
            }
        }
        Some(Err(error)) => log::error!("Audit checkpoint export failed: {error}"),
        None => {}
    }
}

/// Check the whole stored chain -- every hash, link and signature -- and log
/// each batch that fails. Returns how many failed.
pub async fn check_stored_chain(
    pool: &PgPool,
    runtime: &SealRuntime,
) -> Result<usize, sqlx::Error> {
    let batches = load_batches(pool).await?;
    let verifier = runtime.verifier();
    let failed: Vec<i64> = verify_chain(&batches, verifier.as_ref())
        .into_iter()
        .filter(|(_, status)| *status == SignatureStatus::Invalid)
        .map(|(id, _)| id)
        .collect();
    for id in &failed {
        log::error!("Audit batch {id} FAILED verification: edited, out of chain, or badly signed");
    }
    Ok(failed.len())
}

/// Passes between whole-chain checks (one per minute, so hourly).
const CHAIN_CHECK_EVERY_PASSES: u64 = 60;

/// Run the sealing job every `interval`, logging (never swallowing) failures.
/// The stored chain is re-verified on the first pass and then hourly.
pub fn spawn_batching_job(pool: PgPool, interval: std::time::Duration, runtime: SealRuntime) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        let mut pass: u64 = 0;
        loop {
            ticker.tick().await;
            run_seal_pass(&pool, &runtime).await;
            if pass.is_multiple_of(CHAIN_CHECK_EVERY_PASSES) {
                if let Err(error) = check_stored_chain(&pool, &runtime).await {
                    log::error!("Audit chain check could not run: {error}");
                }
            }
            pass += 1;
        }
    });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/// Every stored batch, oldest first.
pub async fn load_batches(pool: &PgPool) -> Result<Vec<StoredBatch>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {BATCH_COLUMNS} FROM audit_seal_batches ORDER BY id"
    ))
    .fetch_all(pool)
    .await
}

/// The seal status of each member of `source` named in `ids`. A member no batch
/// holds is absent from the map; callers read that as [`STATUS_PENDING`].
pub async fn member_seal_statuses(
    pool: &PgPool,
    source: &str,
    ids: &[String],
) -> Result<HashMap<String, String>, sqlx::Error> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT m.source_id, b.status
         FROM audit_seal_batch_members m JOIN audit_seal_batches b ON b.id = m.batch_id
         WHERE m.source = $1 AND m.source_id = ANY($2)",
    )
    .bind(source)
    .bind(ids)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().collect())
}

/// The seal status of the audit events of `event_type` about each aggregate in
/// `aggregate_ids`, keyed by aggregate id. Absent means no event, or an event
/// no batch holds yet.
pub async fn event_seal_statuses(
    pool: &PgPool,
    event_type: &str,
    aggregate_ids: &[String],
) -> Result<HashMap<String, String>, sqlx::Error> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT e.aggregate_id, b.status
         FROM audit_events e
         JOIN audit_seal_batch_members m ON m.source = 'audit_event' AND m.source_id = e.id
         JOIN audit_seal_batches b ON b.id = m.batch_id
         WHERE e.event_type = $1 AND e.aggregate_id = ANY($2)",
    )
    .bind(event_type)
    .bind(aggregate_ids)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().collect())
}

/// [`member_seal_statuses`] that never fails a caller: seal status is
/// informational, so an unreadable answer is logged and read as pending.
pub async fn seal_statuses_or_pending(
    pool: Option<&PgPool>,
    source: &str,
    ids: &[String],
) -> HashMap<String, String> {
    let Some(pool) = pool else {
        return HashMap::new();
    };
    member_seal_statuses(pool, source, ids)
        .await
        .unwrap_or_else(|error| {
            log::warn!("seal status of {source} rows unreadable: {error}");
            HashMap::new()
        })
}

/// [`event_seal_statuses`] that never fails a caller; see
/// [`seal_statuses_or_pending`].
pub async fn event_statuses_or_pending(
    pool: Option<&PgPool>,
    event_type: &str,
    aggregate_ids: &[String],
) -> HashMap<String, String> {
    let Some(pool) = pool else {
        return HashMap::new();
    };
    event_seal_statuses(pool, event_type, aggregate_ids)
        .await
        .unwrap_or_else(|error| {
            log::warn!("seal status of {event_type} events unreadable: {error}");
            HashMap::new()
        })
}

/// Rows in no batch yet, both sources, and the times of the last seal and
/// export. Any of them `None` when it cannot be read.
async fn seal_counters(
    pool: &PgPool,
) -> Result<
    (
        i64,
        Option<chrono::DateTime<chrono::Utc>>,
        Option<chrono::DateTime<chrono::Utc>>,
    ),
    sqlx::Error,
> {
    sqlx::query_as(&format!(
        "SELECT
           (SELECT COUNT(*) FROM access_logs a WHERE NOT EXISTS (
               SELECT 1 FROM audit_seal_batch_members m
               WHERE m.source = '{SOURCE_ACCESS_LOG}' AND m.source_id = a.id))
         + (SELECT COUNT(*) FROM audit_events e WHERE NOT EXISTS (
               SELECT 1 FROM audit_seal_batch_members m
               WHERE m.source = '{SOURCE_AUDIT_EVENT}' AND m.source_id = e.id)),
           (SELECT MAX(sealed_at) FROM audit_seal_batches),
           (SELECT MAX(exported_at) FROM audit_seal_batches)"
    ))
    .fetch_one(pool)
    .await
}

/// The `audit_seal` block of health, dashboard, analytics and compliance
/// responses.
///
/// On the memory backend nothing is ever sealed, so every event and access-log
/// row held is unsealed and the two times are `null`. On PostgreSQL a value
/// that cannot be read is `null`, never zero: an unmeasured backlog is not an
/// empty one.
pub async fn audit_seal_summary(data: &crate::AppState) -> serde_json::Value {
    if let Ok(cache) = data.audit_seal.summary_cache.lock() {
        if let Some((at, value)) = cache.as_ref() {
            if at.elapsed() < SUMMARY_TTL {
                return value.clone();
            }
        }
    }
    let value = compute_audit_seal_summary(data).await;
    if let Ok(mut cache) = data.audit_seal.summary_cache.lock() {
        *cache = Some((std::time::Instant::now(), value.clone()));
    }
    value
}

/// [`audit_seal_summary`] without the cache.
pub async fn compute_audit_seal_summary(data: &crate::AppState) -> serde_json::Value {
    let (unsealed, last_sealed, last_exported) = match data.db_pool.as_ref() {
        Some(pool) => match seal_counters(pool).await {
            Ok((count, sealed, exported)) => (Some(count), sealed, exported),
            Err(error) => {
                log::warn!("audit seal summary unreadable: {error}");
                (None, None, None)
            }
        },
        None => {
            let logs = data.repositories.access_logs.count_sealed().await;
            (
                logs.ok().map(|(total, sealed)| {
                    (total - sealed) as i64 + data.audit_outbox.recorded().len() as i64
                }),
                None,
                None,
            )
        }
    };
    serde_json::json!({
        "unsealed_events": unsealed,
        "last_sealed_at": last_sealed,
        "last_exported_at": last_exported,
        "sink": data.audit_seal.sink.kind(),
        "signing": data.audit_seal.signing_label(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaf(source: &'static str, id: &str, seq: i64) -> SealLeaf {
        SealLeaf {
            source,
            id: id.into(),
            seq,
            hash: [0; 32],
        }
    }

    #[test]
    fn both_sources_merge_into_one_order_by_shared_sequence() {
        let logs = vec![
            leaf(SOURCE_ACCESS_LOG, "L1", 1),
            leaf(SOURCE_ACCESS_LOG, "L4", 4),
        ];
        let events = vec![
            leaf(SOURCE_AUDIT_EVENT, "E2", 2),
            leaf(SOURCE_AUDIT_EVENT, "E3", 3),
        ];
        let merged: Vec<_> = merge_leaves(logs, events)
            .into_iter()
            .map(|l| l.id)
            .collect();
        assert_eq!(merged, ["L1", "E2", "E3", "L4"]);
    }

    #[test]
    fn a_batch_never_exceeds_the_leaf_limit() {
        let logs = (0..MAX_BATCH_LEAVES)
            .map(|i| leaf(SOURCE_ACCESS_LOG, "L", i))
            .collect();
        let events = (0..10)
            .map(|i| leaf(SOURCE_AUDIT_EVENT, "E", MAX_BATCH_LEAVES + i))
            .collect();
        assert_eq!(merge_leaves(logs, events).len() as i64, MAX_BATCH_LEAVES);
    }
}

#[cfg(all(test, feature = "postgres"))]
mod pg_tests {
    use super::*;
    use crate::audit_seal::{FilesystemSink, SealVerifier};
    use crate::repositories::postgres::tests::get_test_pool;

    fn signer() -> SealSigner {
        SealSigner::from_seed_hex(&"0b".repeat(32)).unwrap()
    }

    async fn add_log(pool: &PgPool) -> String {
        let id = format!("LOG-SEAL-{}", uuid::Uuid::new_v4());
        sqlx::query(
            "INSERT INTO access_logs (id, accessor_id, accessor_role, patient_id, resource_type, action)
             VALUES ($1, 'doctor_seal', 'Doctor', NULL, 'patient', 'view')",
        )
        .bind(&id)
        .execute(pool)
        .await
        .unwrap();
        id
    }

    async fn add_event(pool: &PgPool, event_type: &str, aggregate: &str) -> String {
        let event = AuditEvent {
            id: uuid::Uuid::new_v4().to_string(),
            event_type: event_type.into(),
            aggregate_type: "test".into(),
            aggregate_id: aggregate.into(),
            payload_hash: "ab".repeat(32),
            payload: serde_json::json!({"k": 1}),
            occurred_at: chrono::Utc::now(),
        };
        crate::audit_outbox::insert_event(pool, &event)
            .await
            .unwrap();
        event.id
    }

    /// Three sealed batches, one row each; returns their ids.
    async fn three_batches(pool: &PgPool, signer: Option<&SealSigner>) -> Vec<i64> {
        let mut ids = Vec::new();
        for _ in 0..3 {
            add_log(pool).await;
            ids.push(build_next_batch(pool, signer).await.unwrap().unwrap().id);
        }
        ids
    }

    fn statuses(batches: &[StoredBatch], signer: Option<&SealSigner>) -> Vec<SignatureStatus> {
        let verifier = signer.map(SealVerifier::for_signer);
        verify_chain(batches, verifier.as_ref())
            .into_iter()
            .map(|(_, status)| status)
            .collect()
    }

    #[tokio::test]
    async fn access_logs_and_audit_events_are_sealed_into_one_signed_batch() {
        let pool = get_test_pool().await;
        let signer = signer();
        add_log(&pool).await;
        add_log(&pool).await;
        add_event(&pool, "emergency_capsule_published", "PAT-1:1").await;
        add_event(&pool, "patient_registered", "PAT-1").await;

        let batch = build_next_batch(&pool, Some(&signer))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(batch.leaf_count, 4);
        assert!(batch.signed);
        let sources: Vec<(String, i64)> = sqlx::query_as(
            "SELECT source, COUNT(*) FROM audit_seal_batch_members WHERE batch_id = $1
             GROUP BY source ORDER BY source",
        )
        .bind(batch.id)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            sources,
            vec![
                (SOURCE_ACCESS_LOG.to_string(), 2),
                (SOURCE_AUDIT_EVENT.to_string(), 2)
            ]
        );
        let stored = load_batches(&pool).await.unwrap();
        assert_eq!(stored[0].status, "sealed");
        assert_eq!(
            statuses(&stored, Some(&signer)),
            vec![SignatureStatus::Valid]
        );
        // Nothing left to seal.
        assert!(build_next_batch(&pool, Some(&signer))
            .await
            .unwrap()
            .is_none());
        pool.close().await;
    }

    #[tokio::test]
    async fn sealed_batches_link_each_to_the_hash_before_it() {
        let pool = get_test_pool().await;
        let signer = signer();
        three_batches(&pool, Some(&signer)).await;
        let stored = load_batches(&pool).await.unwrap();
        assert_eq!(stored[0].prev_batch_hash, None);
        assert_eq!(stored[1].prev_batch_hash, stored[0].batch_hash);
        assert_eq!(stored[2].prev_batch_hash, stored[1].batch_hash);
        assert_eq!(
            statuses(&stored, Some(&signer)),
            vec![SignatureStatus::Valid; 3]
        );
        pool.close().await;
    }

    #[tokio::test]
    async fn a_tampered_middle_batch_fails_verification() {
        let pool = get_test_pool().await;
        let signer = signer();
        let ids = three_batches(&pool, Some(&signer)).await;
        sqlx::query("UPDATE audit_seal_batches SET merkle_root = repeat('e', 64) WHERE id = $1")
            .bind(ids[1])
            .execute(&pool)
            .await
            .unwrap();
        let found = statuses(&load_batches(&pool).await.unwrap(), Some(&signer));
        assert_eq!(found[1], SignatureStatus::Invalid);
        assert_eq!(found[0], SignatureStatus::Valid);
        pool.close().await;
    }

    #[tokio::test]
    async fn a_deleted_batch_fails_verification_of_the_next() {
        let pool = get_test_pool().await;
        let signer = signer();
        let ids = three_batches(&pool, Some(&signer)).await;
        sqlx::query("DELETE FROM audit_seal_batch_members WHERE batch_id = $1")
            .bind(ids[1])
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM audit_seal_batches WHERE id = $1")
            .bind(ids[1])
            .execute(&pool)
            .await
            .unwrap();
        let found = statuses(&load_batches(&pool).await.unwrap(), Some(&signer));
        assert_eq!(
            found,
            vec![SignatureStatus::Valid, SignatureStatus::Invalid]
        );
        pool.close().await;
    }

    #[tokio::test]
    async fn reordered_batches_fail_verification() {
        let pool = get_test_pool().await;
        let signer = signer();
        three_batches(&pool, Some(&signer)).await;
        let mut stored = load_batches(&pool).await.unwrap();
        stored.swap(0, 2);
        assert!(statuses(&stored, Some(&signer)).contains(&SignatureStatus::Invalid));
        pool.close().await;
    }

    #[tokio::test]
    async fn without_a_key_batches_are_sealed_unsigned_and_still_chained() {
        let pool = get_test_pool().await;
        let ids = three_batches(&pool, None).await;
        let stored = load_batches(&pool).await.unwrap();
        assert!(stored.iter().all(|batch| batch.signature.is_none()));
        assert_eq!(statuses(&stored, None), vec![SignatureStatus::Unsigned; 3]);
        sqlx::query("UPDATE audit_seal_batches SET last_seq = last_seq + 1 WHERE id = $1")
            .bind(ids[2])
            .execute(&pool)
            .await
            .unwrap();
        let found = statuses(&load_batches(&pool).await.unwrap(), None);
        assert_eq!(found[2], SignatureStatus::Invalid);
        pool.close().await;
    }

    #[tokio::test]
    async fn batches_left_pending_by_the_old_job_are_sealed_in_id_order() {
        let pool = get_test_pool().await;
        let signer = signer();
        for _ in 0..2 {
            sqlx::query(
                "INSERT INTO audit_seal_batches (merkle_root, first_seq, last_seq, leaf_count)
                 VALUES (repeat('a', 64), 1, 2, 2)",
            )
            .execute(&pool)
            .await
            .unwrap();
        }
        // Nothing new to batch, but the legacy batches are sealed all the same.
        assert!(build_next_batch(&pool, Some(&signer))
            .await
            .unwrap()
            .is_none());
        let stored = load_batches(&pool).await.unwrap();
        assert!(stored.iter().all(|batch| batch.status == "sealed"));
        assert_eq!(stored[0].prev_batch_hash, None);
        assert_eq!(stored[1].prev_batch_hash, stored[0].batch_hash);
        assert_eq!(
            statuses(&stored, Some(&signer)),
            vec![SignatureStatus::Valid; 2]
        );
        pool.close().await;
    }

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("medichain-export-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn export_marks_batches_exported_in_id_order_and_a_repeat_changes_nothing() {
        let pool = get_test_pool().await;
        let signer = signer();
        let ids = three_batches(&pool, Some(&signer)).await;
        let dir = temp_dir();
        let sink = FilesystemSink::new(dir.clone()).unwrap();

        let outcome = export_sealed_batches(&pool, &sink).await.unwrap();
        assert_eq!(
            outcome,
            ExportOutcome {
                exported: 3,
                failure: None
            }
        );
        for id in &ids {
            assert!(dir.join(format!("{id}.json")).exists());
        }
        let stored = load_batches(&pool).await.unwrap();
        assert!(stored
            .iter()
            .all(|batch| batch.status == "exported" && batch.exported_at.is_some()));
        assert_eq!(
            export_sealed_batches(&pool, &sink).await.unwrap().exported,
            0
        );

        // A crash between the write and the mark leaves the file and a `sealed`
        // batch; the next pass accepts the identical file and marks it.
        sqlx::query(
            "UPDATE audit_seal_batches SET status = 'sealed', exported_at = NULL, export_ref = NULL
             WHERE id = $1",
        )
        .bind(ids[1])
        .execute(&pool)
        .await
        .unwrap();
        let again = export_sealed_batches(&pool, &sink).await.unwrap();
        assert_eq!(
            again,
            ExportOutcome {
                exported: 1,
                failure: None
            }
        );
        std::fs::remove_dir_all(dir).unwrap();
        pool.close().await;
    }

    #[tokio::test]
    async fn export_stops_at_a_differing_checkpoint_and_never_overwrites_it() {
        let pool = get_test_pool().await;
        let signer = signer();
        let ids = three_batches(&pool, Some(&signer)).await;
        let dir = temp_dir();
        std::fs::write(
            dir.join(format!("{}.json", ids[1])),
            b"someone else wrote this",
        )
        .unwrap();
        let sink = FilesystemSink::new(dir.clone()).unwrap();

        let outcome = export_sealed_batches(&pool, &sink).await.unwrap();
        assert_eq!(
            outcome.exported, 1,
            "the batch before the conflict is exported"
        );
        assert!(outcome.failure.unwrap().contains("different content"));
        assert_eq!(
            std::fs::read(dir.join(format!("{}.json", ids[1]))).unwrap(),
            b"someone else wrote this"
        );
        let stored = load_batches(&pool).await.unwrap();
        assert_eq!(stored[1].status, "sealed");
        assert_eq!(
            stored[2].status, "sealed",
            "order is kept: nothing after a failure is sent"
        );
        std::fs::remove_dir_all(dir).unwrap();
        pool.close().await;
    }

    #[tokio::test]
    async fn a_failing_sink_leaves_batches_sealed_and_the_pass_reports_it() {
        let pool = get_test_pool().await;
        let signer = signer();
        three_batches(&pool, Some(&signer)).await;
        let outcome = export_sealed_batches(&pool, &crate::audit_seal::FailingSink)
            .await
            .unwrap();
        assert_eq!(outcome.exported, 0);
        assert!(outcome.failure.unwrap().contains("sink is down"));
        let stored = load_batches(&pool).await.unwrap();
        assert!(stored.iter().all(|batch| batch.status == "sealed"));
        // Sealing itself is unaffected: the next batch still chains on.
        add_log(&pool).await;
        assert!(build_next_batch(&pool, Some(&signer))
            .await
            .unwrap()
            .is_some());
        pool.close().await;
    }

    #[tokio::test]
    async fn seal_statuses_read_pending_until_a_batch_holds_the_row() {
        let pool = get_test_pool().await;
        let signer = signer();
        let log_id = add_log(&pool).await;
        add_event(
            &pool,
            crate::audit_outbox::CAPSULE_PUBLISHED_EVENT,
            "PAT-9:1",
        )
        .await;
        let ids = vec![log_id.clone()];
        let aggregates = vec!["PAT-9:1".to_string()];

        assert!(member_seal_statuses(&pool, SOURCE_ACCESS_LOG, &ids)
            .await
            .unwrap()
            .is_empty());
        assert!(event_seal_statuses(
            &pool,
            crate::audit_outbox::CAPSULE_PUBLISHED_EVENT,
            &aggregates
        )
        .await
        .unwrap()
        .is_empty());

        build_next_batch(&pool, Some(&signer))
            .await
            .unwrap()
            .unwrap();
        let logs = member_seal_statuses(&pool, SOURCE_ACCESS_LOG, &ids)
            .await
            .unwrap();
        assert_eq!(logs.get(&log_id).map(String::as_str), Some("sealed"));
        let events = event_seal_statuses(
            &pool,
            crate::audit_outbox::CAPSULE_PUBLISHED_EVENT,
            &aggregates,
        )
        .await
        .unwrap();
        assert_eq!(events.get("PAT-9:1").map(String::as_str), Some("sealed"));
        pool.close().await;
    }
}
