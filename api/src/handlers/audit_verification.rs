//! Verification a patient can run on their own record (WP8):
//! `GET /api/patients/{patient_id}/verify` (also `/api/v1/…`).
//!
//! Two answers, each from the strongest source available:
//!
//! - **Emergency capsule**: the stored capsule is compared with the commitment
//!   read from the chain's latest *finalized* state — never with the Postgres
//!   column that merely claims it was anchored. With the chain off or the
//!   commitment absent the answer is `unanchored`, not an error.
//! - **Access history**: each access-log row is re-hashed and proved into its
//!   Merkle batch's root. A row edited in the database after batching no
//!   longer proves (`mismatch`) and only that row is affected. A batch's
//!   anchor is `finalized` (with its block) only once the root is in a
//!   finalized block; until then it is `pending`.

use actix_web::{get, web, HttpRequest, HttpResponse, Responder};
use serde::Serialize;
use std::collections::HashMap;

use crate::audit_merkle::{
    decode_digest, inclusion_proof, leaf_hash, verify_proof, Digest32, ProofStep,
};
use crate::repositories::traits::AccessLogEntity;
use crate::state::AppState;
use crate::ErrorResponse;

/// Most recent access-log rows one verification covers.
const VERIFY_MAX_ROWS: i64 = 200;

/// Emergency capsule check against finalized chain state.
#[derive(Debug, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum CapsuleStatus {
    Match,
    Mismatch,
    Unanchored,
    /// The patient has no emergency capsule to check.
    None,
}

/// Whether a row still hashes into its batch.
#[derive(Debug, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum RowIntegrity {
    Intact,
    Mismatch,
    /// Not yet in a batch (the job runs every minute).
    Unbatched,
}

/// One access-log row's verification.
#[derive(Debug, Serialize)]
pub struct RowVerification {
    pub access_log_id: String,
    pub accessed_at: chrono::DateTime<chrono::Utc>,
    pub integrity: RowIntegrity,
    pub batch_id: Option<i64>,
    pub leaf_index: Option<i32>,
    pub merkle_root: Option<String>,
    pub proof: Vec<ProofStep>,
    /// `finalized` or `pending`; absent when unbatched.
    pub anchor_status: Option<String>,
    pub block_number: Option<i64>,
    pub tx_hash: Option<String>,
}

/// A batch as verification needs it: its root, anchor, and member leaves.
struct BatchView {
    merkle_root: String,
    status: String,
    block_number: Option<i64>,
    tx_hash: Option<String>,
    leaves: Vec<Digest32>,
}

/// A friendly error with a code; details are logged, never returned.
fn verify_error(
    mut builder: actix_web::HttpResponseBuilder,
    message: &str,
    code: &str,
) -> HttpResponse {
    builder.json(ErrorResponse {
        error: message.to_string(),
        code: code.to_string(),
    })
}

/// 503 for a storage failure.
fn unavailable(context: &str, error: impl std::fmt::Display) -> HttpResponse {
    log::error!("record verification: {context}: {error}");
    verify_error(
        HttpResponse::ServiceUnavailable(),
        "Verification is temporarily unavailable. Please try again shortly.",
        "VERIFICATION_UNAVAILABLE",
    )
}

/// The patient's most recent access-log rows, newest first.
async fn recent_rows(
    pool: &sqlx::PgPool,
    patient_id: &str,
) -> Result<Vec<AccessLogEntity>, sqlx::Error> {
    sqlx::query_as::<_, AccessLogEntity>(
        "SELECT id, accessor_id, accessor_role, patient_id, resource_type, resource_id, action,
                access_reason, COALESCE(is_emergency_access, false) AS is_emergency_access,
                ip_address, user_agent, blockchain_tx_hash, accessed_at, facility_id,
                authority_type, authority_id
         FROM access_logs WHERE patient_id = $1 ORDER BY accessed_at DESC LIMIT $2",
    )
    .bind(patient_id)
    .bind(VERIFY_MAX_ROWS)
    .fetch_all(pool)
    .await
}

/// Membership (batch, index) of each row id that has one.
async fn memberships(
    pool: &sqlx::PgPool,
    ids: &[String],
) -> Result<HashMap<String, (i64, i32)>, sqlx::Error> {
    let rows: Vec<(String, i64, i32)> = sqlx::query_as(
        "SELECT access_log_id, batch_id, leaf_index FROM audit_anchor_batch_members
         WHERE access_log_id = ANY($1)",
    )
    .bind(ids)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, batch, index)| (id, (batch, index)))
        .collect())
}

/// Load one batch with its member leaves in index order.
async fn load_batch(pool: &sqlx::PgPool, batch_id: i64) -> Result<BatchView, sqlx::Error> {
    let (merkle_root, status, block_number, tx_hash): (
        String,
        String,
        Option<i64>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT merkle_root, status, block_number, tx_hash FROM audit_anchor_batches WHERE id = $1",
    )
    .bind(batch_id)
    .fetch_one(pool)
    .await?;
    let hashes: Vec<String> = sqlx::query_scalar(
        "SELECT leaf_hash FROM audit_anchor_batch_members WHERE batch_id = $1 ORDER BY leaf_index",
    )
    .bind(batch_id)
    .fetch_all(pool)
    .await?;
    Ok(BatchView {
        merkle_root,
        status,
        block_number,
        tx_hash,
        // A malformed stored leaf becomes all-zero, which then fails to prove.
        leaves: hashes
            .iter()
            .map(|h| decode_digest(h).unwrap_or([0; 32]))
            .collect(),
    })
}

/// Verify one row against its batch, or report it unbatched.
fn verify_row(
    row: &AccessLogEntity,
    membership: Option<(i64, i32, &BatchView)>,
) -> RowVerification {
    let mut result = RowVerification {
        access_log_id: row.id.clone(),
        accessed_at: row.accessed_at,
        integrity: RowIntegrity::Unbatched,
        batch_id: None,
        leaf_index: None,
        merkle_root: None,
        proof: Vec::new(),
        anchor_status: None,
        block_number: None,
        tx_hash: None,
    };
    let Some((batch_id, index, batch)) = membership else {
        return result;
    };
    // The proof is built from the stored member leaves; the row's own leaf is
    // recomputed from the row as it is now.
    let proof = usize::try_from(index)
        .ok()
        .and_then(|i| inclusion_proof(&batch.leaves, i))
        .unwrap_or_default();
    let root = decode_digest(&batch.merkle_root);
    let intact = root.is_some_and(|root| verify_proof(&leaf_hash(row), &proof, &root));
    result.integrity = if intact {
        RowIntegrity::Intact
    } else {
        RowIntegrity::Mismatch
    };
    result.batch_id = Some(batch_id);
    result.leaf_index = Some(index);
    result.merkle_root = Some(batch.merkle_root.clone());
    result.proof = proof;
    result.anchor_status = Some(batch.status.clone());
    result.block_number = batch.block_number;
    result.tx_hash = batch.tx_hash.clone();
    result
}

/// Verify the patient's recent access history against its batches.
async fn verify_access_history(
    pool: &sqlx::PgPool,
    patient_id: &str,
) -> Result<Vec<RowVerification>, sqlx::Error> {
    let rows = recent_rows(pool, patient_id).await?;
    let ids: Vec<String> = rows.iter().map(|row| row.id.clone()).collect();
    let members = memberships(pool, &ids).await?;
    let mut batches: HashMap<i64, BatchView> = HashMap::new();
    for (batch_id, _) in members.values() {
        if !batches.contains_key(batch_id) {
            batches.insert(*batch_id, load_batch(pool, *batch_id).await?);
        }
    }
    Ok(rows
        .iter()
        .map(|row| {
            let membership = members
                .get(&row.id)
                .and_then(|(batch, index)| batches.get(batch).map(|view| (*batch, *index, view)));
            verify_row(row, membership)
        })
        .collect())
}

/// The patient's account bytes and the capsule state the chain's finalized
/// state holds for them, or `None` when the chain is off or cannot answer
/// (logged).
async fn finalized_chain_capsule(
    data: &AppState,
    wallet: &str,
) -> Option<([u8; 32], crate::blockchain::CapsuleChainState)> {
    if !crate::blockchain::blockchain_enabled() {
        return None;
    }
    let client = data.substrate_client.as_ref()?;
    let account: sp_core::crypto::AccountId32 = wallet.parse().ok()?;
    let head = match client.finalized_head().await {
        Ok(head) => head,
        Err(error) => {
            log::warn!("verification: finalized head unavailable: {error}");
            return None;
        }
    };
    let bytes: [u8; 32] = *account.as_ref();
    match crate::blockchain::read_capsule_at_finalized_block(client, bytes, &head).await {
        Ok(state) => Some((bytes, state)),
        Err(error) => {
            log::warn!("verification: capsule chain read failed: {error}");
            None
        }
    }
}

/// Compare the current capsule with the finalized chain state.
async fn verify_capsule(
    data: &web::Data<AppState>,
    patient_id: &str,
    wallet: Option<&str>,
) -> Result<CapsuleStatus, HttpResponse> {
    let stored = match data
        .repositories
        .emergency_capsules
        .current(patient_id)
        .await
    {
        Ok(Some(stored)) => stored,
        Ok(None) => return Ok(CapsuleStatus::None),
        Err(error) => return Err(unavailable("load capsule", error)),
    };
    // The stored ciphertext must still hash to its own commitment first.
    let intact = crate::emergency_capsule::load_current_verified(data, patient_id)
        .await
        .is_some_and(|verified| verified.commitment_verified);
    let Some(wallet) = wallet else {
        return Ok(CapsuleStatus::Unanchored);
    };
    let Some((account, chain)) = finalized_chain_capsule(data, wallet).await else {
        return Ok(CapsuleStatus::Unanchored);
    };
    // The record must be this patient's, at this version, with this digest.
    let same_patient = chain.patient == account;
    let same_version = i64::from(chain.emergency_capsule_version) == i64::from(stored.version);
    let same_commitment =
        decode_digest(&stored.commitment) == Some(chain.emergency_capsule_commitment);
    Ok(
        if intact && same_patient && same_version && same_commitment {
            CapsuleStatus::Match
        } else {
            CapsuleStatus::Mismatch
        },
    )
}

/// Whether `caller` may verify `patient_id`: the patient themselves, or an
/// administrator.
fn may_verify(data: &web::Data<AppState>, caller: &crate::User, patient_id: &str) -> bool {
    caller.role == crate::Role::Admin
        || crate::support::caller_owns_patient_record(data, &caller.wallet_address, patient_id)
}

/// Verify a patient's emergency capsule and access history.
///
/// Returns 200 with both answers; 403 for anyone but the patient or an
/// administrator; 404 for an unknown patient; 503 when verification storage
/// (PostgreSQL) is unavailable.
#[get("/api/patients/{patient_id}/verify")]
pub async fn verify_patient_record(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let patient_id = path.into_inner();
    if !may_verify(&data, &caller, &patient_id) {
        return verify_error(
            HttpResponse::Forbidden(),
            "Only the patient, or an administrator, can verify this record.",
            "FORBIDDEN",
        );
    }
    let Some(pool) = data.db_pool.as_ref() else {
        return unavailable("verify", "audit batching needs PostgreSQL");
    };
    let wallet = match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(patient) => patient.wallet_address,
        Err(crate::repositories::traits::RepositoryError::NotFound(_)) => {
            return verify_error(HttpResponse::NotFound(), "Patient not found.", "NOT_FOUND")
        }
        Err(error) => return unavailable("load patient", error),
    };
    let capsule = match verify_capsule(&data, &patient_id, wallet.as_deref()).await {
        Ok(status) => status,
        Err(response) => return response,
    };
    match verify_access_history(pool, &patient_id).await {
        Ok(access_logs) => HttpResponse::Ok().json(serde_json::json!({
            "patient_id": patient_id,
            "emergency_capsule": capsule,
            "access_logs": access_logs,
            "rows_checked_limit": VERIFY_MAX_ROWS,
        })),
        Err(error) => unavailable("verify access history", error),
    }
}

#[cfg(all(test, feature = "postgres"))]
mod pg_tests {
    use super::*;
    use actix_web::{test, App};

    const PATIENT_ID: &str = "PAT-VERIFY";
    const PATIENT: &str = "patient_verify";

    /// Three access rows for the test patient, returned by id.
    async fn seed_rows(pool: &sqlx::PgPool) -> Vec<String> {
        sqlx::query(
            "INSERT INTO patients (id, health_id, national_id_hash, national_id_type)
             VALUES ($1, $1, 'test-hash', 'SmartID') ON CONFLICT (id) DO NOTHING",
        )
        .bind(PATIENT_ID)
        .execute(pool)
        .await
        .unwrap();
        let mut ids = Vec::new();
        for _ in 0..3 {
            let id = format!("LOG-VERIFY-{}", uuid::Uuid::new_v4());
            sqlx::query(
                "INSERT INTO access_logs (id, accessor_id, accessor_role, patient_id, resource_type, action)
                 VALUES ($1, 'doctor_verify', 'Doctor', $2, 'patient', 'view')",
            )
            .bind(&id)
            .bind(PATIENT_ID)
            .execute(pool)
            .await
            .unwrap();
            ids.push(id);
        }
        ids
    }

    /// Tampering with one access row after batching makes verification report
    /// a mismatch for that row only (WP8 "done when").
    #[actix_web::test]
    async fn tampering_with_one_row_fails_only_that_row() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let ids = seed_rows(&pool).await;
        // Batch everything unbatched so far (other tests' rows included).
        while crate::audit_batching::build_next_batch(&pool)
            .await
            .unwrap()
            .is_some()
        {}
        sqlx::query("UPDATE access_logs SET action = 'emergency' WHERE id = $1")
            .bind(&ids[1])
            .execute(&pool)
            .await
            .unwrap();

        let mut state = crate::AppState::new();
        state.db_pool = Some(pool.clone());
        let mut patient = crate::test_fixtures::staff(PATIENT, crate::Role::Patient);
        patient.linked_patient_id = Some(PATIENT_ID.into());
        state.users.write().unwrap().insert(PATIENT.into(), patient);
        crate::test_fixtures::seed_patient(&state, PATIENT_ID).await;
        let state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(verify_patient_record),
        )
        .await;
        let request = test::TestRequest::get()
            .uri(&format!("/api/patients/{PATIENT_ID}/verify"))
            .insert_header(("x-user-id", PATIENT))
            .to_request();
        let response = test::call_service(&app, request).await;
        assert_eq!(response.status(), 200);
        let body: serde_json::Value = test::read_body_json(response).await;
        let integrity = |id: &str| {
            body["access_logs"]
                .as_array()
                .unwrap()
                .iter()
                .find(|row| row["access_log_id"] == id)
                .map(|row| row["integrity"].clone())
                .unwrap()
        };
        assert_eq!(integrity(&ids[0]), "intact");
        assert_eq!(integrity(&ids[1]), "mismatch");
        assert_eq!(integrity(&ids[2]), "intact");
        // Chain off in tests: the capsule answer is unanchored or none, never an error.
        assert!(matches!(
            body["emergency_capsule"].as_str(),
            Some("unanchored" | "none")
        ));
        pool.close().await;
    }
}
