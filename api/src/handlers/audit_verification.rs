//! Verification a patient can run on their own record (WP8, ADR-0010):
//! `GET /api/patients/{patient_id}/verify` (also `/api/v1/…`).
//!
//! Two answers, each from the sealed audit stream:
//!
//! - **Emergency capsule**: the commitment stored with the capsule is compared
//!   with the commitment sealed when that version was published -- the
//!   `emergency_capsule_published` audit event, proved into its batch. With no
//!   sealed event yet the answer is `unsealed`, not an error.
//! - **Access history**: each access-log row is re-hashed and proved into its
//!   Merkle batch's root. A row edited in the database after batching no
//!   longer proves (`mismatch`) and only that row is affected. Each batch's
//!   hash, its link to the batch before it and its Ed25519 signature are
//!   checked too: `signature` is `valid`, `invalid` or `unsigned`, and absent
//!   until the batch is sealed.
//!
//! On the memory backend nothing is ever batched: every row reports
//! `unbatched` and the capsule reports `unsealed`.

use actix_web::{get, web, HttpRequest, HttpResponse, Responder};
use serde::Serialize;
use sha3::{Digest, Sha3_256};
use std::collections::HashMap;

use crate::audit_merkle::{
    decode_digest, event_leaf_hash, inclusion_proof, leaf_hash, verify_proof, Digest32, ProofStep,
};
use crate::audit_outbox::AuditEvent;
use crate::audit_seal::{check_batch, SealVerifier, SignatureStatus, StoredBatch};
use crate::repositories::traits::AccessLogEntity;
use crate::state::AppState;
use crate::ErrorResponse;

/// Most recent access-log rows one verification covers.
const VERIFY_MAX_ROWS: i64 = 200;

/// Emergency capsule check against the sealed commitment.
#[derive(Debug, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum CapsuleStatus {
    Match,
    Mismatch,
    /// No sealed commitment exists for the current version yet.
    Unsealed,
    /// The patient has no emergency capsule to check.
    None,
}

/// Whether a row still hashes into its batch.
#[derive(Debug, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum RowIntegrity {
    Intact,
    Mismatch,
    /// Not yet in a batch (the job runs every minute), or on the memory backend.
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
    /// `pending`, `sealed` or `exported`; `null` when unbatched.
    pub seal_status: Option<String>,
    pub batch_hash: Option<String>,
    /// `null` until the batch is sealed.
    pub signature: Option<SignatureStatus>,
    pub sealed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub exported_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// A batch as verification needs it: the stored batch, the hash of the batch
/// that really precedes it, and its member leaves.
struct BatchView {
    stored: StoredBatch,
    actual_prev: Option<String>,
    leaves: Vec<Digest32>,
}

impl BatchView {
    /// The seal check of this batch; `None` while it is unsealed.
    fn seal_check(&self, verifier: Option<&SealVerifier>) -> Option<SignatureStatus> {
        check_batch(&self.stored, self.actual_prev.as_deref(), verifier)
    }

    /// Whether `leaf` at `index` proves into this batch's root.
    fn proves(&self, leaf: &Digest32, index: i32) -> (bool, Vec<ProofStep>) {
        let proof = usize::try_from(index)
            .ok()
            .and_then(|i| inclusion_proof(&self.leaves, i))
            .unwrap_or_default();
        let root = decode_digest(&self.stored.merkle_root);
        let intact = root.is_some_and(|root| verify_proof(leaf, &proof, &root));
        (intact, proof)
    }
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
                ip_address, user_agent, accessed_at, facility_id,
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
        "SELECT source_id, batch_id, leaf_index FROM audit_seal_batch_members
         WHERE source = 'access_log' AND source_id = ANY($1)",
    )
    .bind(ids)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, batch, index)| (id, (batch, index)))
        .collect())
}

/// Load one batch with its predecessor's hash and its member leaves in index
/// order.
async fn load_batch(pool: &sqlx::PgPool, batch_id: i64) -> Result<BatchView, sqlx::Error> {
    let stored: StoredBatch = sqlx::query_as(&format!(
        "SELECT {} FROM audit_seal_batches WHERE id = $1",
        crate::audit_batching::BATCH_COLUMNS
    ))
    .bind(batch_id)
    .fetch_one(pool)
    .await?;
    let actual_prev: Option<String> = sqlx::query_scalar(
        "SELECT batch_hash FROM audit_seal_batches
         WHERE id < $1 AND batch_hash IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
    .bind(batch_id)
    .fetch_optional(pool)
    .await?;
    let hashes: Vec<String> = sqlx::query_scalar(
        "SELECT leaf_hash FROM audit_seal_batch_members WHERE batch_id = $1 ORDER BY leaf_index",
    )
    .bind(batch_id)
    .fetch_all(pool)
    .await?;
    Ok(BatchView {
        stored,
        actual_prev,
        // A malformed stored leaf becomes all-zero, which then fails to prove.
        leaves: hashes
            .iter()
            .map(|h| decode_digest(h).unwrap_or([0; 32]))
            .collect(),
    })
}

/// A row no batch holds: nothing to prove yet.
fn unbatched(row: &AccessLogEntity) -> RowVerification {
    RowVerification {
        access_log_id: row.id.clone(),
        accessed_at: row.accessed_at,
        integrity: RowIntegrity::Unbatched,
        batch_id: None,
        leaf_index: None,
        merkle_root: None,
        proof: Vec::new(),
        seal_status: None,
        batch_hash: None,
        signature: None,
        sealed_at: None,
        exported_at: None,
    }
}

/// Verify one row against its batch, or report it unbatched.
fn verify_row(
    row: &AccessLogEntity,
    membership: Option<(i64, i32, &BatchView)>,
    verifier: Option<&SealVerifier>,
) -> RowVerification {
    let mut result = unbatched(row);
    let Some((batch_id, index, batch)) = membership else {
        return result;
    };
    // The proof is built from the stored member leaves; the row's own leaf is
    // recomputed from the row as it is now.
    let (intact, proof) = batch.proves(&leaf_hash(row), index);
    result.integrity = if intact {
        RowIntegrity::Intact
    } else {
        RowIntegrity::Mismatch
    };
    result.batch_id = Some(batch_id);
    result.leaf_index = Some(index);
    result.merkle_root = Some(batch.stored.merkle_root.clone());
    result.proof = proof;
    result.seal_status = Some(batch.stored.status.clone());
    result.batch_hash = batch.stored.batch_hash.clone();
    result.signature = batch.seal_check(verifier);
    result.sealed_at = batch.stored.sealed_at;
    result.exported_at = batch.stored.exported_at;
    result
}

/// Verify the patient's recent access history against its batches.
async fn verify_access_history(
    pool: &sqlx::PgPool,
    patient_id: &str,
    verifier: Option<&SealVerifier>,
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
            verify_row(row, membership, verifier)
        })
        .collect())
}

/// The memory backend's answer: the patient's rows, none of them batched.
async fn unbatched_history(
    data: &web::Data<AppState>,
    patient_id: &str,
) -> Result<Vec<RowVerification>, crate::repositories::traits::RepositoryError> {
    let page = data
        .repositories
        .access_logs
        .get_by_patient(
            patient_id,
            crate::repositories::traits::Pagination::new(0, VERIFY_MAX_ROWS as u32),
        )
        .await?;
    let mut rows = page.items;
    rows.sort_by_key(|row| std::cmp::Reverse(row.accessed_at));
    Ok(rows.iter().map(unbatched).collect())
}

/// The audit event that recorded a capsule version's commitment, with the batch
/// membership that seals it: `(event, batch id, leaf index)`. `None` while the
/// event is missing or no batch holds it.
async fn sealed_capsule_event(
    pool: &sqlx::PgPool,
    patient_id: &str,
    version: i32,
) -> Result<Option<(AuditEvent, i64, i32)>, sqlx::Error> {
    type Row = (
        String,
        String,
        String,
        String,
        String,
        serde_json::Value,
        chrono::DateTime<chrono::Utc>,
        i64,
        i32,
    );
    let row: Option<Row> = sqlx::query_as(
        "SELECT e.id, e.event_type, e.aggregate_type, e.aggregate_id, e.payload_hash, e.payload,
                e.occurred_at, m.batch_id, m.leaf_index
         FROM audit_events e
         JOIN audit_seal_batch_members m ON m.source = 'audit_event' AND m.source_id = e.id
         WHERE e.event_type = $1 AND e.aggregate_id = $2
         ORDER BY e.seal_seq DESC LIMIT 1",
    )
    .bind(crate::audit_outbox::CAPSULE_PUBLISHED_EVENT)
    .bind(crate::audit_outbox::capsule_aggregate_id(
        patient_id, version,
    ))
    .fetch_optional(pool)
    .await?;
    Ok(row.map(
        |(
            id,
            event_type,
            aggregate_type,
            aggregate_id,
            payload_hash,
            payload,
            at,
            batch,
            index,
        )| {
            (
                AuditEvent {
                    id,
                    event_type,
                    aggregate_type,
                    aggregate_id,
                    payload_hash,
                    payload,
                    occurred_at: at,
                },
                batch,
                index,
            )
        },
    ))
}

/// Whether an event's payload still hashes to the digest stored (and sealed)
/// with it.
fn payload_intact(event: &AuditEvent) -> bool {
    serde_json::to_vec(&event.payload)
        .map(|bytes| format!("{:x}", Sha3_256::digest(bytes)) == event.payload_hash)
        .unwrap_or(false)
}

/// Compare the stored capsule with the commitment sealed for its version.
async fn sealed_commitment_matches(
    pool: &sqlx::PgPool,
    stored: &crate::repositories::traits::EmergencyCapsuleEntity,
    intact: bool,
    verifier: Option<&SealVerifier>,
) -> Result<CapsuleStatus, sqlx::Error> {
    let Some((event, batch_id, index)) =
        sealed_capsule_event(pool, &stored.patient_id, stored.version).await?
    else {
        return Ok(CapsuleStatus::Unsealed);
    };
    let batch = load_batch(pool, batch_id).await?;
    // A batch still `pending` was built before sealing existed and holds no
    // capsule events; treat it, like a missing one, as not sealed.
    let Some(seal) = batch.seal_check(verifier) else {
        return Ok(CapsuleStatus::Unsealed);
    };
    let (event_proves, _) = batch.proves(&event_leaf_hash(&event), index);
    let sealed_commitment = event.payload.get("commitment").and_then(|v| v.as_str());
    let sealed_version = event.payload.get("version").and_then(|v| v.as_i64());
    let same = sealed_commitment == Some(stored.commitment.as_str())
        && sealed_version == Some(i64::from(stored.version));
    Ok(
        if intact
            && same
            && event_proves
            && payload_intact(&event)
            && seal != SignatureStatus::Invalid
        {
            CapsuleStatus::Match
        } else {
            CapsuleStatus::Mismatch
        },
    )
}

/// Compare the current capsule with its sealed commitment.
async fn verify_capsule(
    data: &web::Data<AppState>,
    patient_id: &str,
    verifier: Option<&SealVerifier>,
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
    let Some(pool) = data.db_pool.as_ref() else {
        return Ok(CapsuleStatus::Unsealed);
    };
    sealed_commitment_matches(pool, &stored, intact, verifier)
        .await
        .map_err(|error| unavailable("verify capsule", error))
}

/// The signing key's public half, as the response names it.
fn seal_key_json(verifier: Option<&SealVerifier>) -> serde_json::Value {
    match verifier {
        Some(verifier) => serde_json::json!({
            "key_id": verifier.key_id,
            "algorithm": "ed25519",
            "public_key": hex::encode(verifier.public_key),
        }),
        None => serde_json::Value::Null,
    }
}

/// Whether `caller` may verify `patient_id`: the patient themselves, or an
/// administrator.
fn may_verify(data: &web::Data<AppState>, caller: &crate::User, patient_id: &str) -> bool {
    caller.role == crate::Role::Admin
        || crate::support::caller_owns_patient_record(data, &caller.wallet_address, patient_id)
}

/// The access-history answer: batch-proven on PostgreSQL, unbatched in memory.
async fn access_history(
    data: &web::Data<AppState>,
    patient_id: &str,
    verifier: Option<&SealVerifier>,
) -> Result<Vec<RowVerification>, HttpResponse> {
    match data.db_pool.as_ref() {
        Some(pool) => verify_access_history(pool, patient_id, verifier)
            .await
            .map_err(|error| unavailable("verify access history", error)),
        None => unbatched_history(data, patient_id)
            .await
            .map_err(|error| unavailable("read access history", error)),
    }
}

/// Verify a patient's emergency capsule and access history.
///
/// Returns 200 with both answers; 403 for anyone but the patient or an
/// administrator; 404 for an unknown patient; 503 when verification storage
/// cannot be read.
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
    match data.repositories.patients.get_by_id(&patient_id).await {
        Ok(_) => {}
        Err(crate::repositories::traits::RepositoryError::NotFound(_)) => {
            return verify_error(HttpResponse::NotFound(), "Patient not found.", "NOT_FOUND")
        }
        Err(error) => return unavailable("load patient", error),
    }
    let verifier = data.audit_seal.verifier();
    let capsule = match verify_capsule(&data, &patient_id, verifier.as_ref()).await {
        Ok(status) => status,
        Err(response) => return response,
    };
    match access_history(&data, &patient_id, verifier.as_ref()).await {
        Ok(access_logs) => HttpResponse::Ok().json(serde_json::json!({
            "patient_id": patient_id,
            "emergency_capsule": capsule,
            "seal_key": seal_key_json(verifier.as_ref()),
            "access_logs": access_logs,
            "rows_checked_limit": VERIFY_MAX_ROWS,
        })),
        Err(response) => response,
    }
}

#[cfg(test)]
mod memory_tests {
    use super::*;
    use actix_web::{test, App};

    const PATIENT_ID: &str = "PAT-VERIFY-MEM";
    const PATIENT: &str = "patient_verify_mem";

    /// Without PostgreSQL nothing is batched: every row is `unbatched`, no seal
    /// fields are invented, and the capsule is `unsealed` rather than an error.
    #[actix_web::test]
    async fn on_the_memory_backend_every_row_is_unbatched() {
        let state = crate::AppState::new();
        let mut patient = crate::test_fixtures::staff(PATIENT, crate::Role::Patient);
        patient.linked_patient_id = Some(PATIENT_ID.into());
        state.users.write().unwrap().insert(PATIENT.into(), patient);
        crate::test_fixtures::seed_patient(&state, PATIENT_ID).await;
        state
            .repositories
            .access_logs
            .create(crate::repositories::traits::AccessLogEntity {
                id: "LOG-MEM-1".into(),
                accessor_id: "doctor".into(),
                accessor_role: "Doctor".into(),
                patient_id: Some(PATIENT_ID.into()),
                resource_type: "patient".into(),
                resource_id: None,
                action: "view".into(),
                access_reason: None,
                is_emergency_access: false,
                ip_address: None,
                user_agent: None,
                accessed_at: chrono::Utc::now(),
                facility_id: None,
                authority_type: None,
                authority_id: None,
            })
            .await
            .unwrap();
        let profile = crate::test_fixtures::patient_profile(PATIENT_ID, "Test Patient");
        let state = web::Data::new(state);
        crate::emergency_capsule::publish_capsule(&state, &profile.emergency_info, "DR")
            .await
            .unwrap();

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
        assert_eq!(body["emergency_capsule"], "unsealed");
        assert!(body["seal_key"].is_null());
        let row = &body["access_logs"][0];
        assert_eq!(row["integrity"], "unbatched");
        assert!(row["seal_status"].is_null());
        assert!(row["signature"].is_null());
        assert!(row["batch_hash"].is_null());
    }
}

#[cfg(all(test, feature = "postgres"))]
mod pg_tests {
    use super::*;
    use actix_web::{test, App};
    use medichain_crypto::seal::SealSigner;

    const PATIENT_ID: &str = "PAT-VERIFY";
    const PATIENT: &str = "patient_verify";

    fn signer() -> SealSigner {
        SealSigner::from_seed_hex(&"0c".repeat(32)).unwrap()
    }

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

    /// A state over `pool` whose signing key is `signer`, with the patient
    /// signed in.
    async fn state_with(pool: &sqlx::PgPool, signer: Option<SealSigner>) -> web::Data<AppState> {
        let mut state = crate::AppState::new();
        state.db_pool = Some(pool.clone());
        state.audit_seal = crate::audit_seal::SealRuntime::new(
            signer.map(std::sync::Arc::new),
            std::sync::Arc::new(crate::audit_seal::NoSink),
        );
        let mut patient = crate::test_fixtures::staff(PATIENT, crate::Role::Patient);
        patient.linked_patient_id = Some(PATIENT_ID.into());
        state.users.write().unwrap().insert(PATIENT.into(), patient);
        crate::test_fixtures::seed_patient(&state, PATIENT_ID).await;
        web::Data::new(state)
    }

    async fn verify(state: &web::Data<AppState>) -> serde_json::Value {
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
        test::read_body_json(response).await
    }

    fn row<'a>(body: &'a serde_json::Value, id: &str) -> &'a serde_json::Value {
        body["access_logs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["access_log_id"] == id)
            .unwrap()
    }

    /// Tampering with one access row after batching makes verification report
    /// a mismatch for that row only (WP8 "done when").
    #[actix_web::test]
    async fn tampering_with_one_row_fails_only_that_row() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let ids = seed_rows(&pool).await;
        let signer = signer();
        while crate::audit_batching::build_next_batch(&pool, Some(&signer))
            .await
            .unwrap()
            .is_some()
        {}
        sqlx::query("UPDATE access_logs SET action = 'emergency' WHERE id = $1")
            .bind(&ids[1])
            .execute(&pool)
            .await
            .unwrap();

        let state = state_with(&pool, Some(signer)).await;
        let body = verify(&state).await;
        assert_eq!(row(&body, &ids[0])["integrity"], "intact");
        assert_eq!(row(&body, &ids[1])["integrity"], "mismatch");
        assert_eq!(row(&body, &ids[2])["integrity"], "intact");
        // The batch itself is untouched, so its seal is still good.
        assert_eq!(row(&body, &ids[0])["signature"], "valid");
        assert_eq!(row(&body, &ids[0])["seal_status"], "sealed");
        assert_eq!(body["emergency_capsule"], "none");
        assert_eq!(body["seal_key"]["algorithm"], "ed25519");
        pool.close().await;
    }

    #[actix_web::test]
    async fn an_unbatched_row_has_no_seal_fields_and_a_demo_batch_reads_unsigned() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let ids = seed_rows(&pool).await;
        let state = state_with(&pool, None).await;

        let before = verify(&state).await;
        assert_eq!(row(&before, &ids[0])["integrity"], "unbatched");
        assert!(row(&before, &ids[0])["seal_status"].is_null());
        assert!(before["seal_key"].is_null());

        crate::audit_batching::build_next_batch(&pool, None)
            .await
            .unwrap();
        let after = verify(&state).await;
        assert_eq!(row(&after, &ids[0])["integrity"], "intact");
        assert_eq!(row(&after, &ids[0])["signature"], "unsigned");
        pool.close().await;
    }

    #[actix_web::test]
    async fn an_edited_batch_reads_invalid_for_every_row_it_holds() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let ids = seed_rows(&pool).await;
        let signer = signer();
        crate::audit_batching::build_next_batch(&pool, Some(&signer))
            .await
            .unwrap();
        sqlx::query("UPDATE audit_seal_batches SET first_seq = first_seq - 1")
            .execute(&pool)
            .await
            .unwrap();
        let state = state_with(&pool, Some(signer)).await;
        let body = verify(&state).await;
        assert_eq!(row(&body, &ids[0])["signature"], "invalid");
        pool.close().await;
    }

    /// The capsule answer follows the sealed commitment: `unsealed` until a
    /// batch holds the publication event, `match` once it does, and `mismatch`
    /// if the commitment stored with the capsule no longer agrees.
    #[actix_web::test]
    async fn the_capsule_is_unsealed_then_matches_then_mismatches_when_the_event_is_altered() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        seed_rows(&pool).await;
        let signer = signer();
        let state = state_with(&pool, Some(signer)).await;
        let profile = crate::test_fixtures::patient_profile(PATIENT_ID, "Test Patient");
        crate::emergency_capsule::publish_capsule(&state, &profile.emergency_info, "DR")
            .await
            .unwrap();

        assert_eq!(verify(&state).await["emergency_capsule"], "unsealed");

        let sealing = state.audit_seal.signer.clone();
        crate::audit_batching::build_next_batch(&pool, sealing.as_deref())
            .await
            .unwrap();
        assert_eq!(verify(&state).await["emergency_capsule"], "match");

        sqlx::query(
            "UPDATE audit_events SET payload = jsonb_set(payload, '{commitment}', to_jsonb(repeat('0', 64)))
             WHERE event_type = 'emergency_capsule_published'",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(verify(&state).await["emergency_capsule"], "mismatch");
        pool.close().await;
    }
}
