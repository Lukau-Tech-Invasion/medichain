//! Merkle batching of the access audit (WP8), PostgreSQL only.
//!
//! A background job takes the `access_logs` rows that are in no batch yet,
//! hashes each canonical row (`audit_merkle`), stores the batch and its
//! members, and queues the root in `audit_outbox_events` — all in one
//! transaction. The outbox worker then anchors the root with one extrinsic
//! (`AccessControl::anchor_audit_batch`) and marks the batch finalized only
//! from the finalized block.
//!
//! The job holds a transaction-scoped PostgreSQL advisory lock, so two API
//! instances never build overlapping batches: the second simply skips a turn.

use sqlx::PgPool;

use crate::audit_merkle::{leaf_hash, merkle_root, Digest32};
use crate::repositories::traits::AccessLogEntity;

/// Most rows one batch takes; the rest wait for the next turn.
pub const MAX_BATCH_LEAVES: i64 = 1024;
/// Advisory-lock key of the batching job ("MCAUDITB" in ASCII).
const AUDIT_BATCH_LOCK_KEY: i64 = 0x4d43_4155_4449_5442;
/// Outbox event type the worker anchors a batch root under.
pub const AUDIT_BATCH_EVENT: &str = "audit_batch_chain_anchor";

/// The columns an access-log row is hashed from, and its batching order.
const ROW_COLUMNS: &str = "id, accessor_id, accessor_role, patient_id, resource_type, \
    resource_id, action, access_reason, COALESCE(is_emergency_access, false) AS is_emergency_access, \
    ip_address, user_agent, blockchain_tx_hash, accessed_at, facility_id";

/// A batch the job just built.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuiltBatch {
    pub id: i64,
    pub merkle_root: String,
    pub first_seq: i64,
    pub last_seq: i64,
    pub leaf_count: i32,
}

/// Rows not yet in any batch, oldest sequence first, with their sequence.
async fn unbatched_rows(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<Vec<(AccessLogEntity, i64)>, sqlx::Error> {
    let sql = format!(
        "SELECT {ROW_COLUMNS}, anchor_seq FROM access_logs a
         WHERE NOT EXISTS (
            SELECT 1 FROM audit_anchor_batch_members m WHERE m.access_log_id = a.id
         )
         ORDER BY anchor_seq LIMIT $1"
    );
    let rows = sqlx::query(&sql)
        .bind(MAX_BATCH_LEAVES)
        .fetch_all(&mut **tx)
        .await?;
    rows.iter()
        .map(|row| {
            use sqlx::{FromRow, Row};
            Ok((AccessLogEntity::from_row(row)?, row.try_get("anchor_seq")?))
        })
        .collect()
}

/// Insert the batch row and its members; returns the batch id.
async fn insert_batch(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    rows: &[(AccessLogEntity, i64)],
    leaves: &[Digest32],
    root: &str,
) -> Result<i64, sqlx::Error> {
    let first = rows.first().map_or(0, |(_, seq)| *seq);
    let last = rows.last().map_or(0, |(_, seq)| *seq);
    let batch_id: i64 = sqlx::query_scalar(
        "INSERT INTO audit_anchor_batches (merkle_root, first_seq, last_seq, leaf_count)
         VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .bind(root)
    .bind(first)
    .bind(last)
    .bind(rows.len() as i32)
    .fetch_one(&mut **tx)
    .await?;
    let ids: Vec<&str> = rows.iter().map(|(row, _)| row.id.as_str()).collect();
    let hashes: Vec<String> = leaves.iter().map(hex::encode).collect();
    let indexes: Vec<i32> = (0..rows.len() as i32).collect();
    sqlx::query(
        "INSERT INTO audit_anchor_batch_members (batch_id, leaf_index, access_log_id, leaf_hash)
         SELECT $1, idx, log_id, leaf FROM UNNEST($2::int[], $3::text[], $4::text[])
             AS t(idx, log_id, leaf)",
    )
    .bind(batch_id)
    .bind(indexes)
    .bind(ids)
    .bind(hashes)
    .execute(&mut **tx)
    .await?;
    Ok(batch_id)
}

/// Queue the batch root for the chain in the same transaction.
async fn queue_batch_anchor(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    batch: &BuiltBatch,
) -> Result<(), String> {
    let event = crate::audit_outbox::AuditOutbox::prepare_event(
        AUDIT_BATCH_EVENT.to_string(),
        "audit_anchor_batch".to_string(),
        batch.id.to_string(),
        serde_json::json!({
            "batch_id": batch.id,
            "merkle_root": batch.merkle_root,
            "first_seq": batch.first_seq,
            "last_seq": batch.last_seq,
            "leaf_count": batch.leaf_count,
        }),
        chrono::Utc::now(),
    )
    .map_err(str::to_string)?;
    sqlx::query(
        "INSERT INTO audit_outbox_events
            (id, event_type, aggregate_type, aggregate_id, payload_hash, payload, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(&event.id)
    .bind(&event.event_type)
    .bind(&event.aggregate_type)
    .bind(&event.aggregate_id)
    .bind(&event.payload_hash)
    .bind(&event.payload)
    .bind(event.occurred_at)
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

/// Build one batch from the unbatched rows, if there are any and no other
/// instance holds the job's lock. Returns the batch built, or `None`.
pub async fn build_next_batch(pool: &PgPool) -> Result<Option<BuiltBatch>, String> {
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
        .bind(AUDIT_BATCH_LOCK_KEY)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;
    if !locked {
        return Ok(None);
    }
    let rows = unbatched_rows(&mut tx)
        .await
        .map_err(|error| error.to_string())?;
    let leaves: Vec<Digest32> = rows.iter().map(|(row, _)| leaf_hash(row)).collect();
    let Some(root) = merkle_root(&leaves).map(hex::encode) else {
        return Ok(None);
    };
    let id = insert_batch(&mut tx, &rows, &leaves, &root)
        .await
        .map_err(|error| error.to_string())?;
    let batch = BuiltBatch {
        id,
        merkle_root: root,
        first_seq: rows.first().map_or(0, |(_, seq)| *seq),
        last_seq: rows.last().map_or(0, |(_, seq)| *seq),
        leaf_count: rows.len() as i32,
    };
    queue_batch_anchor(&mut tx, &batch).await?;
    tx.commit().await.map_err(|error| error.to_string())?;
    Ok(Some(batch))
}

/// Mark a batch finalized from its finalized chain transaction, inside the
/// outbox delivery transaction. The CHECK refuses a finalized batch without
/// a block.
pub async fn record_batch_finalized(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    payload: &serde_json::Value,
    result: &crate::blockchain::ChainTxResult,
    block_number: Option<u64>,
) -> Result<(), String> {
    let batch_id = payload
        .get("batch_id")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| "batch outbox payload is missing batch_id".to_string())?;
    let block_number = block_number.and_then(|number| i64::try_from(number).ok());
    sqlx::query(
        "UPDATE audit_anchor_batches SET status = 'finalized', tx_hash = $2, block_hash = $3,
            block_number = $4, finalized_at = NOW()
         WHERE id = $1 AND status = 'pending'",
    )
    .bind(batch_id)
    .bind(&result.hash)
    .bind(&result.finalized_block_hash)
    .bind(block_number)
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

/// Run the batching job every `interval`, logging (never swallowing) failures.
pub fn spawn_batching_job(pool: PgPool, interval: std::time::Duration) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        loop {
            ticker.tick().await;
            match build_next_batch(&pool).await {
                Ok(Some(batch)) => log::info!(
                    "Audit batch {} built: {} rows, root {}",
                    batch.id,
                    batch.leaf_count,
                    batch.merkle_root
                ),
                Ok(None) => {}
                Err(error) => log::error!("Audit batching failed: {error}"),
            }
        }
    });
}
