//! Specimen collection: record a collection, read one, list them.

use crate::clinical_endpoints::*;

/// Create specimen collection
/// What the specimen collection form actually submits.
///
/// The clinical `SpecimenCollection` type is a much larger structure than a
/// bedside collection screen fills in, and the handler previously populated only
/// the `data` blob via `..Default::default()` — leaving `specimen_type`,
/// `collector_id`, `submission_id` and `collected_at` empty even though all four
/// are NOT NULL. This DTO carries exactly what the form has and the handler fills
/// the typed columns from it.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct CreateSpecimenRequest {
    pub patient_id: String,
    pub specimen_type: String,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub tests_ordered: Option<String>,
    #[serde(default)]
    pub collection_site: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    /// Pre-collection safety checks the collector confirmed.
    #[serde(default)]
    pub checklist: Vec<String>,
}

#[post("/api/clinical/specimen")]
pub async fn create_specimen(
    data: web::Data<AppState>,
    req: web::Json<CreateSpecimenRequest>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_perform_laboratory_work() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    let record = req.into_inner();
    if record.patient_id.trim().is_empty() || record.specimen_type.trim().is_empty() {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "patient_id and specimen_type are required".to_string(),
            code: "VALIDATION_ERROR".to_string(),
        });
    }
    if data
        .repositories
        .patients
        .get_by_id(&record.patient_id)
        .await
        .is_err()
    {
        return HttpResponse::NotFound().json(ErrorResponse {
            error: format!("Patient '{}' not found", record.patient_id),
            code: "PATIENT_NOT_FOUND".to_string(),
        });
    }

    let now = Utc::now();
    let collection_id = format!("SPC-{}", uuid::Uuid::new_v4().simple());

    // `specimen_collections.submission_id` is a NOT NULL foreign key into
    // `lab_submissions`, so a collection cannot stand alone. Raise the submission
    // the collection implies, from the tests the collector listed — that keeps the
    // chain of custody intact and the specimen traceable to an order, rather than
    // weakening the constraint to let orphaned specimens exist.
    let submission_id = format!("LAB-{}", uuid::Uuid::new_v4().simple());
    let tests: Vec<String> = record
        .tests_ordered
        .as_deref()
        .unwrap_or_default()
        .split(',')
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    let submission = LabSubmissionEntity {
        id: submission_id.clone(),
        patient_id: record.patient_id.clone(),
        ordering_provider_id: current_user.id.clone(),
        order_date: now,
        priority: record
            .priority
            .clone()
            .unwrap_or_else(|| "routine".to_string()),
        status: "collected".to_string(),
        tests_ordered: serde_json::json!(tests),
        clinical_notes: record.notes.clone(),
        diagnosis_codes: None,
        fasting_required: false,
        collection_instructions: record.collection_site.clone(),
        expected_completion: None,
        created_at: now,
        updated_at: now,
    };
    if let Err(e) = data.repositories.lab_submissions.create(submission).await {
        log::error!("lab submission for specimen collection failed: {e}");
        return HttpResponse::InternalServerError().json(ErrorResponse {
            error: "Failed to raise the lab order for this collection".to_string(),
            code: "REPO_ERROR".to_string(),
        });
    }

    let entity = SpecimenCollectionEntity {
        id: collection_id.clone(),
        patient_id: record.patient_id.clone(),
        submission_id: submission_id.clone(),
        specimen_type: record.specimen_type.clone(),
        collection_site: record.collection_site.clone(),
        collection_method: None,
        collector_id: current_user.id.clone(),
        collected_at: now,
        received_at: None,
        received_by: None,
        container_type: None,
        volume_ml: None,
        temperature_c: None,
        condition: None,
        barcode: None,
        storage_location: None,
        chain_of_custody: Some(serde_json::json!([{
            "action": "collected",
            "by": current_user.id,
            "at": now.to_rfc3339(),
            "checklist": record.checklist,
        }])),
        notes: record.notes.clone(),
        created_at: now,
        updated_at: now,
        data: serde_json::to_value(&record).unwrap_or_default(),
    };

    match data.repositories.specimen_collections.create(entity).await {
        Ok(_) => HttpResponse::Created().json(serde_json::json!({
            "success": true,
            "collection_id": collection_id,
            "submission_id": submission_id
        })),
        Err(RepositoryError::Duplicate(msg)) => HttpResponse::Conflict().json(ErrorResponse {
            error: msg,
            code: "DUPLICATE".to_string(),
        }),
        Err(e) => {
            log::error!("specimen collection persistence failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Failed to save the specimen collection".to_string(),
                code: "REPO_ERROR".to_string(),
            })
        }
    }
}

#[get("/api/clinical/specimen/{collection_id}")]
pub async fn get_specimen(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let collection_id = path.into_inner();

    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    match data
        .repositories
        .specimen_collections
        .get_by_id(&collection_id)
        .await
    {
        Ok(entity) => {
            // The stored record, not `entity.data`. `data` is `#[sqlx(skip)]`
            // on every one of these entities, so on PostgreSQL it is always
            // `Value::Null` — this endpoint returned a literal `null` with a
            // 200 for every record ever saved. The typed columns are the record.
            HttpResponse::Ok().json(entity)
        }
        Err(RepositoryError::NotFound(_)) => HttpResponse::NotFound().json(ErrorResponse {
            error: "Specimen collection not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            error: e.to_string(),
            code: "INTERNAL_ERROR".to_string(),
        }),
    }
}

/// List all specimen collections
#[derive(serde::Serialize)]
struct ListedSpecimen {
    #[serde(flatten)]
    specimen: SpecimenCollectionEntity,
    rejected: bool,
}

/// Read recorded rejection IDs; an unavailable register cannot imply acceptance.
async fn specimen_rejected_ids(
    data: &AppState,
) -> Result<std::collections::HashSet<String>, HttpResponse> {
    match data.repositories.specimen_rejections.list_all().await {
        Ok(rows) => Ok(rows.into_iter().map(|row| row.specimen_id).collect()),
        Err(error) => {
            log::error!("failed to read specimen rejection status: {error}");
            Err(HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Specimen rejection status could not be loaded".to_string(),
                code: "REPO_ERROR".to_string(),
            }))
        }
    }
}

#[get("/api/clinical/specimens")]
pub async fn list_specimens(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user = match get_current_user(&data, &http_req) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                error: "Unauthorized".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    if !current_user.role.can_view_medical_records() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Access denied".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Return the typed persisted rows, not only their form blob. The page needs
    // the collection ID, collector and timestamps to distinguish a recorded
    // collection from an uncollected order. Do not turn a repository failure
    // into an empty worklist: an unavailable laboratory register is unknown,
    // not proof that the queue is clear.
    let rejected_ids = match specimen_rejected_ids(&data).await {
        Ok(ids) => ids,
        Err(response) => return response,
    };
    match data.repositories.specimen_collections.list_all().await {
        Ok(specimens) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "total": specimens.len(),
            "specimens": specimens.into_iter().map(|specimen| ListedSpecimen {
                rejected: rejected_ids.contains(&specimen.id),
                specimen,
            }).collect::<Vec<_>>(),
        })),
        Err(error) => {
            log::error!("failed to list specimen collections: {error}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                error: "Specimen collections could not be loaded".to_string(),
                code: "REPO_ERROR".to_string(),
            })
        }
    }
}

#[cfg(test)]
mod specimen_list_tests {
    use super::*;
    use crate::handlers::lab::specimen_rejections::create_specimen_rejection;
    use crate::test_fixtures::{register, seed_patient};
    use actix_web::{http::StatusCode, test, App};

    async fn state() -> web::Data<AppState> {
        let state = AppState::new();
        register(&state, "lab_tech", crate::Role::LabTechnician);
        seed_patient(&state, "PAT-SPECIMEN-1").await;
        web::Data::new(state)
    }

    #[actix_web::test]
    async fn specimen_list_retains_recorded_rejection_status() {
        let app = test::init_service(
            App::new()
                .app_data(state().await)
                .service(create_specimen)
                .service(create_specimen_rejection)
                .service(list_specimens),
        )
        .await;
        let created = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/clinical/specimen")
                .insert_header(crate::test_fixtures::as_user("lab_tech"))
                .set_json(serde_json::json!({
                    "patient_id": "PAT-SPECIMEN-1", "specimen_type": "blood",
                    "tests_ordered": "Synthetic CBC", "checklist": ["verify-id", "label"]
                }))
                .to_request(),
        )
        .await;
        assert_eq!(created.status(), StatusCode::CREATED);
        let created: serde_json::Value = test::read_body_json(created).await;
        let rejected = test::call_service(&app, test::TestRequest::post()
            .uri("/api/clinical/specimen-rejection")
            .insert_header(crate::test_fixtures::as_user("lab_tech"))
            .set_json(serde_json::json!({
                "specimen_id": created["collection_id"], "rejection_reason": "Synthetic damaged container",
                "rejection_category": "container_issue", "recollection_required": true
            })).to_request()).await;
        assert_eq!(rejected.status(), StatusCode::CREATED);
        let listed = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/clinical/specimens")
                .insert_header(crate::test_fixtures::as_user("lab_tech"))
                .to_request(),
        )
        .await;
        assert_eq!(listed.status(), StatusCode::OK);
        let body: serde_json::Value = test::read_body_json(listed).await;
        assert_eq!(body["specimens"][0]["rejected"], true);
        assert_eq!(body["specimens"][0]["id"], created["collection_id"]);
    }

    #[actix_web::test]
    async fn list_returns_typed_persisted_specimens_in_its_canonical_envelope() {
        let state = state().await;
        let app = test::init_service(
            App::new()
                .app_data(state)
                .service(create_specimen)
                .service(list_specimens),
        )
        .await;

        let created = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/clinical/specimen")
                .insert_header(crate::test_fixtures::as_user("lab_tech"))
                .set_json(serde_json::json!({
                    "patient_id": "PAT-SPECIMEN-1",
                    "specimen_type": "blood",
                    "priority": "stat",
                    "tests_ordered": "CBC",
                    "checklist": ["verify-id", "label"],
                }))
                .to_request(),
        )
        .await;
        assert_eq!(created.status(), StatusCode::CREATED);

        let listed = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/clinical/specimens")
                .insert_header(crate::test_fixtures::as_user("lab_tech"))
                .to_request(),
        )
        .await;
        assert_eq!(listed.status(), StatusCode::OK);
        let body: serde_json::Value = test::read_body_json(listed).await;
        assert_eq!(body["total"], 1);
        let specimen = &body["specimens"][0];
        assert!(specimen["id"]
            .as_str()
            .unwrap_or_default()
            .starts_with("SPC-"));
        assert_eq!(specimen["patient_id"], "PAT-SPECIMEN-1");
        assert_eq!(specimen["collector_id"], "lab_tech");
        assert_eq!(specimen["data"]["tests_ordered"], "CBC");
    }
}
