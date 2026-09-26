//! `clinical_endpoints::billing::eob_documents` — explanation-of-benefits
//! documents on insurance claims (WP7.3).
//!
//! An administrator files the payer's EOB (PDF, or a JPEG/PNG scan) against a
//! claim; the claim's patient can then read the list and download it. Uploads
//! go through `document_intake` (size cap, byte-level type check, malware-scan
//! hook, encryption); downloads are verified against the stored checksum and
//! audited as disclosures before any bytes leave. Claims are returned with
//! their EOB documents, and `eob_received` is true exactly when one exists.

use super::*;
use crate::document_intake::{
    download_response, fetch_verified, intake_error, store_encrypted, validate_upload,
};
use crate::repositories::eob_documents::EobDocumentEntity;
use serde::Serialize;

/// Query string of the upload: the file's display name.
#[derive(Debug, Deserialize)]
pub struct EobUploadQuery {
    #[serde(default)]
    pub filename: Option<String>,
}

/// An EOB document as the API describes it (never the storage hashes).
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct EobDocumentView {
    pub id: String,
    pub claim_id: String,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: i64,
    /// `clean` or `not_scanned`; the UI labels unscanned files as such.
    pub scan_status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl From<&EobDocumentEntity> for EobDocumentView {
    fn from(row: &EobDocumentEntity) -> Self {
        Self {
            id: row.id.clone(),
            claim_id: row.claim_id.clone(),
            filename: row.filename.clone(),
            content_type: row.content_type.clone(),
            size_bytes: row.size_bytes,
            scan_status: row.scan_status.clone(),
            created_at: row.created_at,
        }
    }
}

/// 503 for a storage failure; the underlying error is logged, never returned.
fn eob_unavailable(context: &str, error: impl std::fmt::Display) -> HttpResponse {
    log::error!("EOB documents: {context}: {error}");
    intake_error(
        HttpResponse::ServiceUnavailable(),
        "Explanation-of-benefits documents are temporarily unavailable. Please try again shortly.",
        "EOB_UNAVAILABLE",
    )
}

/// Load a claim by id: 404 if unknown, 503 if storage fails.
async fn load_claim(
    data: &web::Data<AppState>,
    claim_id: &str,
) -> Result<crate::clinical::InsuranceClaim, HttpResponse> {
    let record = match data.repositories.insurance_claims.get_by_id(claim_id).await {
        Ok(Some(record)) => record,
        Ok(None) => {
            return Err(intake_error(
                HttpResponse::NotFound(),
                "Claim not found.",
                "CLAIM_NOT_FOUND",
            ))
        }
        Err(error) => return Err(eob_unavailable("load claim", error)),
    };
    serde_json::from_value(record.data).map_err(|error| eob_unavailable("decode claim", error))
}

/// The audit row for an EOB act on `patient_id`'s claim.
fn eob_audit(
    caller: &crate::User,
    patient_id: &str,
    document_id: &str,
    action: &str,
) -> crate::repositories::traits::AccessLogEntity {
    crate::repositories::traits::AccessLogEntity {
        id: crate::middleware::secure_tokens::generate_access_id(),
        accessor_id: caller.wallet_address.clone(),
        accessor_role: caller.role.to_string(),
        patient_id: Some(patient_id.to_string()),
        resource_type: "eob_document".to_string(),
        resource_id: Some(document_id.to_string()),
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

/// Encrypt the validated EOB and describe the stored document.
async fn store_eob(
    data: &web::Data<AppState>,
    caller: &crate::User,
    claim: &crate::clinical::InsuranceClaim,
    file: crate::document_intake::ValidatedFile,
) -> Result<EobDocumentEntity, HttpResponse> {
    let stored = store_encrypted(
        data,
        &file,
        Some(&claim.patient_id),
        &caller.wallet_address,
        "explanation_of_benefits",
    )
    .await
    .map_err(|error| eob_unavailable("encrypted upload", error))?;
    Ok(EobDocumentEntity {
        id: format!("EOB-{}", uuid::Uuid::new_v4()),
        claim_id: claim.claim_id.clone(),
        patient_id: claim.patient_id.clone(),
        uploaded_by: caller.wallet_address.clone(),
        filename: file.filename,
        content_type: file.content_type.to_string(),
        size_bytes: stored.size_bytes,
        sha256: stored.sha256,
        ipfs_hash: stored.ipfs_hash,
        metadata_hash: stored.metadata_hash,
        scan_status: file.scan_status.to_string(),
        created_at: chrono::Utc::now(),
    })
}

/// File a payer's explanation of benefits against a claim (Admin).
///
/// Body: the file's raw bytes; `Content-Type` its type; `?filename=` its name.
/// Returns 201 with the document; 403 for any other role; 404 for an unknown
/// claim; 413/415/422 from intake; 503 when storage or a required scanner is
/// unavailable. The patient is told an EOB has arrived.
#[post("/api/insurance/claims/{claim_id}/eob")]
pub async fn upload_claim_eob(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<EobUploadQuery>,
    payload: web::Payload,
) -> impl Responder {
    let caller = match crate::support::require_administrator(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let claim = match load_claim(&data, &path.into_inner()).await {
        Ok(claim) => claim,
        Err(response) => return response,
    };
    let file = match validate_upload(&http_req, payload, query.filename.as_deref()).await {
        Ok(file) => file,
        Err(response) => return response,
    };
    let row = match store_eob(&data, &caller, &claim, file).await {
        Ok(row) => row,
        Err(response) => return response,
    };
    let audit = eob_audit(&caller, &claim.patient_id, &row.id, "eob_uploaded");
    match data.repositories.create_eob_document(row, audit).await {
        Ok(stored) => {
            notify_eob_received(&data, claim.patient_id.clone());
            HttpResponse::Created().json(
                serde_json::json!({ "success": true, "document": EobDocumentView::from(&stored) }),
            )
        }
        Err(error) => eob_unavailable("record document", error),
    }
}

/// Tell the patient an EOB is available, without holding up the response.
fn notify_eob_received(data: &web::Data<AppState>, patient_id: String) {
    let state = data.clone();
    tokio::spawn(async move {
        crate::notifications::notify_patient(
            &state,
            &patient_id,
            &["recordUpdates", "pushNotifications"],
            "Explanation of benefits received",
            "Your medical aid's explanation of benefits for a claim is now in MediChain.",
            "insurance",
        )
        .await;
    });
}

/// Whether `caller` may open EOB documents for `patient_id`: the patient
/// themselves, or an administrator.
fn may_read_eob(data: &web::Data<AppState>, caller: &crate::User, patient_id: &str) -> bool {
    caller.role == crate::Role::Admin
        || crate::support::caller_owns_patient_record(data, &caller.wallet_address, patient_id)
}

/// Download an EOB document (the claim's patient, or an administrator).
///
/// The bytes are fetched and verified first, the disclosure audited, and only
/// then sent as a download. Returns 403, 404 or 503 otherwise.
#[get("/api/insurance/claims/{claim_id}/eob/{document_id}")]
pub async fn download_claim_eob(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<(String, String)>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let (claim_id, document_id) = path.into_inner();
    let row = match data
        .repositories
        .eob_documents
        .get_by_id(&document_id)
        .await
    {
        Ok(Some(row)) if row.claim_id == claim_id => row,
        Ok(_) => {
            return intake_error(
                HttpResponse::NotFound(),
                "Document not found.",
                "EOB_NOT_FOUND",
            )
        }
        Err(error) => return eob_unavailable("load document", error),
    };
    if !may_read_eob(&data, &caller, &row.patient_id) {
        return intake_error(
            HttpResponse::Forbidden(),
            "Only the patient on this claim, or an administrator, can open its documents.",
            "FORBIDDEN",
        );
    }
    let bytes = match fetch_verified(&data, &row.ipfs_hash, &row.metadata_hash, &row.sha256).await {
        Ok(bytes) => bytes,
        Err(error) => return eob_unavailable("encrypted download", error),
    };
    let audit = eob_audit(&caller, &row.patient_id, &row.id, "eob_downloaded");
    if let Err(response) = crate::support::require_durable_audit(&data, audit).await {
        return response;
    }
    download_response(&row.filename, &row.content_type, bytes)
}

/// Serialise claims with their EOB documents, `eob_received` derived from them.
///
/// One read for all the claims. Returns the JSON values, or a 503 on storage
/// failure rather than claims that silently say "No EOB received yet".
pub(crate) async fn claims_with_eob(
    data: &web::Data<AppState>,
    claims: Vec<crate::clinical::InsuranceClaim>,
) -> Result<Vec<serde_json::Value>, HttpResponse> {
    let ids: Vec<String> = claims.iter().map(|claim| claim.claim_id.clone()).collect();
    let rows = data
        .repositories
        .eob_documents
        .list_for_claims(&ids)
        .await
        .map_err(|error| eob_unavailable("list documents", error))?;
    Ok(claims
        .into_iter()
        .map(|mut claim| {
            let documents: Vec<EobDocumentView> = rows
                .iter()
                .filter(|row| row.claim_id == claim.claim_id)
                .map(EobDocumentView::from)
                .collect();
            claim.eob_received = claim.eob_received || !documents.is_empty();
            let mut value = serde_json::to_value(&claim).unwrap_or(serde_json::Value::Null);
            if let Some(object) = value.as_object_mut() {
                object.insert("eob_documents".into(), serde_json::json!(documents));
            }
            value
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test, App};

    const PATIENT_ID: &str = "PAT-EOB";
    const PATIENT: &str = "patient_eob";
    const OTHER_PATIENT: &str = "patient_other";
    const ADMIN: &str = "admin_eob";
    const DOCTOR: &str = "doctor_eob";
    const CLAIM_ID: &str = "CLM-EOB-1";
    const EOB_PDF: &[u8] = b"%PDF-1.7\nsynthetic explanation of benefits\n%%EOF";

    /// A stored claim for the test patient, built from the real type so the
    /// fixture cannot drift from what the claim handler writes.
    fn claim() -> serde_json::Value {
        use crate::clinical::*;
        serde_json::to_value(InsuranceClaim {
            claim_id: CLAIM_ID.into(),
            patient_id: PATIENT_ID.into(),
            encounter_id: "ENC-1".into(),
            provider_id: DOCTOR.into(),
            facility_id: "FAC-1".into(),
            insurance: PatientInsurance {
                payer_id: "PAYER-1".into(),
                payer_name: "Synthetic Medical Aid".into(),
                plan_name: "Comprehensive".into(),
                member_id: "M-1".into(),
                group_number: None,
                subscriber_name: "Synthetic Subscriber".into(),
                subscriber_dob: "1980-01-01".into(),
                relationship: "self".into(),
                coverage_type: CoverageType::Medical,
                priority: InsurancePriority::Primary,
                effective_date: "2026-01-01".into(),
                termination_date: None,
                copay: None,
                deductible: None,
                deductible_met: None,
                out_of_pocket_max: None,
                out_of_pocket_met: None,
            },
            claim_type: ClaimType::Professional,
            service_date: "2026-09-01".into(),
            service_lines: Vec::new(),
            diagnosis_codes: Vec::new(),
            total_charge: 850.0,
            status: ClaimStatus::Submitted,
            submitted_at: None,
            payer_claim_number: None,
            adjudicated_at: None,
            paid_amount: None,
            patient_responsibility: None,
            denied_reason: None,
            eob_received: false,
            created_at: 1_790_000_000,
            last_updated: 1_790_000_000,
        })
        .unwrap()
    }

    async fn state(ipfs_url: &str) -> web::Data<AppState> {
        let mut state = AppState::new();
        state.ipfs_client = crate::ipfs::IpfsClient::new(ipfs_url.into(), ipfs_url.into());
        {
            let mut users = state.users.write().unwrap();
            let mut patient = crate::test_fixtures::staff(PATIENT, crate::Role::Patient);
            patient.linked_patient_id = Some(PATIENT_ID.into());
            users.insert(PATIENT.into(), patient);
            let mut other = crate::test_fixtures::staff(OTHER_PATIENT, crate::Role::Patient);
            other.linked_patient_id = Some("PAT-OTHER".into());
            users.insert(OTHER_PATIENT.into(), other);
            users.insert(
                ADMIN.into(),
                crate::test_fixtures::staff(ADMIN, crate::Role::Admin),
            );
            users.insert(
                DOCTOR.into(),
                crate::test_fixtures::staff(DOCTOR, crate::Role::Doctor),
            );
        }
        crate::test_fixtures::seed_patient(&state, PATIENT_ID).await;
        let now = chrono::Utc::now();
        state
            .repositories
            .insurance_claims
            .create(crate::repositories::traits::JsonRecordEntity {
                id: CLAIM_ID.into(),
                owner_id: PATIENT_ID.into(),
                data: claim(),
                created_at: now,
                updated_at: now,
            })
            .await
            .unwrap();
        web::Data::new(state)
    }

    async fn call(
        state: &web::Data<AppState>,
        request: test::TestRequest,
        wallet: &str,
    ) -> actix_web::dev::ServiceResponse {
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(upload_claim_eob)
                .service(download_claim_eob)
                .service(super::super::get_patient_insurance_claims),
        )
        .await;
        test::call_service(
            &app,
            request.insert_header(("x-user-id", wallet)).to_request(),
        )
        .await
    }

    fn upload() -> test::TestRequest {
        test::TestRequest::post()
            .uri(&format!(
                "/api/insurance/claims/{CLAIM_ID}/eob?filename=EOB%20Sept.pdf"
            ))
            .insert_header(("content-type", "application/pdf"))
            .set_payload(EOB_PDF.to_vec())
    }

    async fn claims_as(state: &web::Data<AppState>, wallet: &str) -> serde_json::Value {
        let list =
            test::TestRequest::get().uri(&format!("/api/insurance/claims/patient/{PATIENT_ID}"));
        test::read_body_json(call(state, list, wallet).await).await
    }

    #[actix_web::test]
    async fn before_an_eob_is_filed_the_claim_says_none_received() {
        let state = state(&crate::test_fixtures::fake_ipfs().await).await;
        let body = claims_as(&state, PATIENT).await;
        assert_eq!(body["claims"][0]["eob_received"], false);
        assert_eq!(body["claims"][0]["eob_documents"], serde_json::json!([]));
    }

    #[actix_web::test]
    async fn an_admin_files_an_eob_and_the_patient_downloads_the_same_bytes() {
        let state = state(&crate::test_fixtures::fake_ipfs().await).await;
        let response = call(&state, upload(), ADMIN).await;
        assert_eq!(response.status(), 201);
        let created: serde_json::Value = test::read_body_json(response).await;
        let id = created["document"]["id"].as_str().unwrap().to_string();

        let body = claims_as(&state, PATIENT).await;
        assert_eq!(body["claims"][0]["eob_received"], true);
        assert_eq!(
            body["claims"][0]["eob_documents"][0]["filename"],
            "EOB Sept.pdf"
        );

        let uri = format!("/api/insurance/claims/{CLAIM_ID}/eob/{id}");
        let response = call(&state, test::TestRequest::get().uri(&uri), PATIENT).await;
        assert_eq!(response.status(), 200);
        assert_eq!(test::read_body(response).await.as_ref(), EOB_PDF);
    }

    #[actix_web::test]
    async fn only_an_admin_can_file_and_only_the_patient_or_admin_can_read() {
        let state = state(&crate::test_fixtures::fake_ipfs().await).await;
        assert_eq!(call(&state, upload(), DOCTOR).await.status(), 403);
        assert_eq!(call(&state, upload(), PATIENT).await.status(), 403);
        let created: serde_json::Value =
            test::read_body_json(call(&state, upload(), ADMIN).await).await;
        let uri = format!(
            "/api/insurance/claims/{CLAIM_ID}/eob/{}",
            created["document"]["id"].as_str().unwrap()
        );
        assert_eq!(
            call(&state, test::TestRequest::get().uri(&uri), OTHER_PATIENT)
                .await
                .status(),
            403
        );
        assert_eq!(
            call(&state, test::TestRequest::get().uri(&uri), DOCTOR)
                .await
                .status(),
            403
        );
        assert_eq!(
            call(&state, test::TestRequest::get().uri(&uri), ADMIN)
                .await
                .status(),
            200
        );
    }

    #[actix_web::test]
    async fn an_unknown_claim_and_a_spoofed_type_are_refused() {
        let state = state(&crate::test_fixtures::fake_ipfs().await).await;
        let unknown = test::TestRequest::post()
            .uri("/api/insurance/claims/CLM-NOPE/eob")
            .insert_header(("content-type", "application/pdf"))
            .set_payload(EOB_PDF.to_vec());
        assert_eq!(call(&state, unknown, ADMIN).await.status(), 404);
        let spoofed = test::TestRequest::post()
            .uri(&format!("/api/insurance/claims/{CLAIM_ID}/eob"))
            .insert_header(("content-type", "application/pdf"))
            .set_payload(b"<html>not a pdf</html>".to_vec());
        assert_eq!(call(&state, spoofed, ADMIN).await.status(), 415);
    }

    #[actix_web::test]
    async fn unreachable_storage_is_a_503_and_nothing_is_recorded() {
        let state = state("http://127.0.0.1:9").await;
        let response = call(&state, upload(), ADMIN).await;
        assert_eq!(response.status(), 503);
        let body = claims_as(&state, PATIENT).await;
        assert_eq!(body["claims"][0]["eob_received"], false);
    }
}
