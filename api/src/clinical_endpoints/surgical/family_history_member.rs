//! Add one relative without replacing a patient's previously recorded history.
use super::*;

#[derive(Deserialize)]
pub struct AppendFamilyHistoryMember {
    pub patient_id: String,
    pub member: FamilyHistoryMember,
}

/// Persist one relative using bounded retries and an atomic stored-version guard.
/// Existing members and root metadata are retained; duplicate request IDs are not appended.
async fn append_member(
    repository: &dyn JsonRecordRepository,
    patient_id: &str,
    member: &FamilyHistoryMember,
    author: &str,
) -> RepositoryResult<serde_json::Value> {
    let value = serde_json::to_value(member)
        .map_err(|_| RepositoryError::Validation("Invalid member".into()))?;
    for _attempt in 0..3 {
        let stored = repository.get_by_id(patient_id).await?;
        let expected = stored
            .as_ref()
            .and_then(|row| row.data["last_updated"].as_i64());
        let now = Utc::now();
        let mut row = stored.clone().unwrap_or_else(|| JsonRecordEntity {
            id: patient_id.into(),
            owner_id: patient_id.into(),
            created_at: now,
            updated_at: now,
            data: serde_json::json!({ "patient_id": patient_id, "family_members": [],
                "genetic_conditions": [], "three_gen_complete": false }),
        });
        let members = row.data["family_members"].as_array_mut().ok_or_else(|| {
            RepositoryError::Validation("Stored family history requires review".into())
        })?;
        if members.len() > 200 {
            return Err(RepositoryError::Validation(
                "Stored family history member limit requires review".into(),
            ));
        }
        if let Some(previous) = members
            .iter()
            .find(|entry| entry["member_id"] == value["member_id"])
        {
            // Time belongs to the server; a retry by a different recorder is a conflict.
            let mut previous = previous.clone();
            let mut requested = value.clone();
            if let Some(object) = previous.as_object_mut() {
                object.remove("recorded_at");
            }
            if let Some(object) = requested.as_object_mut() {
                object.remove("recorded_at");
            }
            return if previous == requested {
                Ok(row.data)
            } else {
                Err(RepositoryError::Duplicate(
                    "This request identifier already belongs to a saved entry".into(),
                ))
            };
        }
        if members.len() >= 200 {
            return Err(RepositoryError::Validation(
                "Family history member limit reached".into(),
            ));
        }
        members.push(value.clone());
        row.data["updated_by"] = serde_json::json!(author);
        row.data["last_updated"] = serde_json::json!(now
            .timestamp_millis()
            .max(expected.unwrap_or(0).saturating_add(1)));
        row.updated_at = now;
        let saved = if stored.is_some() {
            let expected = expected.ok_or_else(|| {
                RepositoryError::Validation("Stored family history version requires review".into())
            })?;
            repository
                .replace_if_field_eq(patient_id, "last_updated", &expected.to_string(), row)
                .await?
        } else {
            repository.create_if_absent(row).await?
        };
        if let Some(saved) = saved {
            return Ok(saved.data);
        }
    }
    Err(RepositoryError::Duplicate(
        "Family history changed while saving; refresh and retry".into(),
    ))
}

/// Reject malformed or unbounded relative documentation before it reaches storage.
fn valid_member(request: &AppendFamilyHistoryMember) -> bool {
    let member = &request.member;
    !request.patient_id.trim().is_empty()
        && request.patient_id.len() <= 64
        && member
            .member_id
            .as_ref()
            .is_some_and(|id| !id.trim().is_empty() && id.len() <= 128)
        && member.conditions.len() <= 100
        && [&member.name, &member.notes, &member.cause_of_death]
            .iter()
            .all(|value| value.as_ref().is_none_or(|text| text.len() <= 10000))
        && member.conditions.iter().all(|condition| {
            !condition.condition.trim().is_empty()
                && condition.condition.len() <= 1000
                && condition
                    .notes
                    .as_ref()
                    .is_none_or(|text| text.len() <= 10000)
                && condition.category.as_ref().is_none_or(|category| {
                    matches!(
                        category.as_str(),
                        "cardiovascular"
                            | "cancer"
                            | "diabetes"
                            | "neurological"
                            | "psychiatric"
                            | "respiratory"
                            | "autoimmune"
                            | "genetic"
                            | "blood-disorder"
                            | "kidney-disease"
                            | "liver-disease"
                            | "other"
                    )
                })
                && condition.severity.as_ref().is_none_or(|severity| {
                    matches!(severity.as_str(), "mild" | "moderate" | "severe")
                })
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::memory::MemoryJsonRecordRepository;

    fn member(id: &str) -> FamilyHistoryMember {
        serde_json::from_value(serde_json::json!({ "member_id": id, "relationship": "HalfSister",
            "name": "Fictional Lerato", "notes": "Synthetic documentation only", "living": null,
            "consanguineous": null, "recorded_by": "DOC-QA", "recorded_at": 1,
            "conditions": [{"condition": "Fictional condition", "category": "diabetes", "severity": null,
                "age_at_diagnosis": 0, "notes": "Synthetic condition note"}] })).unwrap()
    }

    /// Appending retains older relatives and metadata; replay is idempotent and conflicts cannot overwrite.
    #[tokio::test]
    async fn family_member_append_preserves_history_unknowns_and_retry_identity() {
        let repository = MemoryJsonRecordRepository::new();
        let legacy = serde_json::json!({ "patient_id": "PAT-QA", "family_members": [{"relationship":"Mother", "living":true, "conditions":[]}],
            "genetic_conditions": [{"condition_name":"Existing synthetic entry"}], "three_gen_complete":true,
            "last_updated":12, "updated_by":"PREVIOUS", "extension":{"preserve":true} });
        let now = Utc::now();
        repository
            .create(JsonRecordEntity {
                id: "PAT-QA".into(),
                owner_id: "PAT-QA".into(),
                data: legacy.clone(),
                created_at: now,
                updated_at: now,
            })
            .await
            .unwrap();
        let added = member("FM-QA");
        let saved = append_member(&repository, "PAT-QA", &added, "DOC-QA")
            .await
            .unwrap();
        assert_eq!(saved["family_members"].as_array().unwrap().len(), 2);
        assert_eq!(saved["family_members"][0], legacy["family_members"][0]);
        for field in ["genetic_conditions", "three_gen_complete", "extension"] {
            assert_eq!(saved[field], legacy[field]);
        }
        assert!(saved["family_members"][1]["living"].is_null());
        assert!(saved["family_members"][1]["conditions"][0]["severity"].is_null());
        let mut replay = added.clone();
        replay.recorded_at = Some(99);
        assert_eq!(
            append_member(&repository, "PAT-QA", &replay, "DOC-QA")
                .await
                .unwrap(),
            saved
        );
        replay.name = Some("Changed draft".into());
        assert!(matches!(
            append_member(&repository, "PAT-QA", &replay, "DOC-QA").await,
            Err(RepositoryError::Duplicate(_))
        ));
        assert_eq!(
            repository.get_by_id("PAT-QA").await.unwrap().unwrap().data,
            saved
        );
    }

    /// Two initial PostgreSQL writers and a retry preserve both relatives across fresh readers.
    #[tokio::test]
    async fn family_member_postgres_concurrent_append_and_restart_preserve_every_relative() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let repository =
            crate::repositories::postgres::PgFamilyHistoryRecordRepository::new(pool.clone());
        let patient = format!("FAMILY-{}", uuid::Uuid::new_v4());
        let first = member("FIRST");
        let second = member("SECOND");
        let (one, two) = tokio::join!(
            append_member(&repository, &patient, &first, "DOC-QA"),
            append_member(&repository, &patient, &second, "DOC-QA")
        );
        one.unwrap();
        two.unwrap();
        let reader =
            crate::repositories::postgres::PgFamilyHistoryRecordRepository::new(pool.clone());
        let stored = reader.get_by_id(&patient).await.unwrap().unwrap();
        let members = stored.data["family_members"].as_array().unwrap();
        assert_eq!(members.len(), 2);
        assert!(members
            .iter()
            .any(|relative| relative["member_id"] == "FIRST"));
        assert!(members
            .iter()
            .any(|relative| relative["member_id"] == "SECOND"));
        assert_eq!(
            append_member(&repository, &patient, &first, "DOC-QA")
                .await
                .unwrap(),
            stored.data
        );
        pool.close().await;
    }

    /// Authentication/grants are required, and new metadata always names the authenticated recorder.
    #[actix_rt::test]
    async fn family_member_http_requires_grant_and_binds_recorder() {
        use actix_web::{test, App};
        let state = AppState::new();
        state.users.write().unwrap().insert(
            "5Doctor".into(),
            crate::User {
                id: "5Doctor".into(),
                username: None,
                name: "Synthetic Doctor".into(),
                role: crate::Role::Doctor,
                created_at: Utc::now(),
                created_by: None,
                linked_patient_id: None,
                email: None,
                phone: None,
                department: None,
                specialty: None,
                license_number: None,
                status: "active".into(),
                last_login: None,
            },
        );
        let data = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(data.clone())
                .service(append_family_history_member)
                .service(crate::clinical_endpoints::create_family_history),
        )
        .await;
        let body = serde_json::json!({ "patient_id":"PAT-QA", "member":member("MEMBER-HTTP") });
        let request = || {
            test::TestRequest::post()
                .uri("/api/surgical/family-history/member")
                .insert_header(crate::test_fixtures::as_user("5Doctor"))
                .set_json(&body)
                .to_request()
        };
        assert_eq!(
            test::call_service(&app, request()).await.status(),
            actix_web::http::StatusCode::FORBIDDEN
        );
        assert!(data
            .repositories
            .family_history_records
            .get_by_id("PAT-QA")
            .await
            .unwrap()
            .is_none());
        let now = Utc::now();
        let access = data
            .patient_access
            .create_request(
                "PAT-QA".into(),
                crate::patient_access::RequestingProvider {
                    provider_id: "5Doctor".into(),
                    provider_name: "Synthetic".into(),
                    provider_role: "Doctor".into(),
                    organization: "Synthetic QA".into(),
                    reason: "Synthetic test".into(),
                },
                now,
            )
            .await
            .unwrap();
        data.patient_access
            .approve_request(
                &access.id,
                crate::patient_access::AccessType::Limited,
                Some(now + chrono::Duration::hours(1)),
                now,
            )
            .await
            .unwrap();
        let response = test::call_service(&app, request()).await;
        assert_eq!(response.status(), actix_web::http::StatusCode::CREATED);
        let saved = data
            .repositories
            .family_history_records
            .get_by_id("PAT-QA")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(saved.data["family_members"][0]["recorded_by"], "5Doctor");
        assert_eq!(saved.data["updated_by"], "5Doctor");
        let legacy = serde_json::json!({ "patient_id":"PAT-INIT", "family_members":[member("CLIENT-ID")],
            "genetic_conditions":[], "three_gen_complete":false, "last_updated":0, "updated_by":"FORGED" });
        let initialize = || {
            test::TestRequest::post()
                .uri("/api/surgical/family-history")
                .insert_header(crate::test_fixtures::as_user("5Doctor"))
                .set_json(&legacy)
                .to_request()
        };
        assert_eq!(
            test::call_service(&app, initialize()).await.status(),
            actix_web::http::StatusCode::CREATED
        );
        let original = data
            .repositories
            .family_history_records
            .get_by_id("PAT-INIT")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(original.data["family_members"][0]["recorded_by"], "5Doctor");
        assert_ne!(original.data["family_members"][0]["member_id"], "CLIENT-ID");
        assert_eq!(
            test::call_service(&app, initialize()).await.status(),
            actix_web::http::StatusCode::CONFLICT
        );
        assert_eq!(
            data.repositories
                .family_history_records
                .get_by_id("PAT-INIT")
                .await
                .unwrap()
                .unwrap()
                .data,
            original.data
        );
    }
}

/// Add a relative as the authenticated clinical recorder; never overwrite another entry.
#[post("/api/surgical/family-history/member")]
pub async fn append_family_history_member(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    req: web::Json<AppendFamilyHistoryMember>,
) -> impl Responder {
    let caller = match crate::support::require_clinical_staff(&data, &http_req) {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let mut request = req.into_inner();
    if !valid_member(&request) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error: "Review the family member fields".into(),
            code: "INVALID_FAMILY_MEMBER".into(),
        });
    }
    let allowed = data
        .patient_access
        .provider_has_active_grant(&request.patient_id, &caller.id, Utc::now())
        .await
        .unwrap_or(false);
    if !allowed {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Access denied".into(),
            code: "ACCESS_DENIED".into(),
        });
    }
    request.member.recorded_by = Some(caller.id.clone());
    request.member.recorded_at = Some(Utc::now().timestamp_millis());
    match append_member(
        data.repositories.family_history_records.as_ref(),
        &request.patient_id,
        &request.member,
        &caller.id,
    )
    .await
    {
        Ok(history) => {
            HttpResponse::Created().json(serde_json::json!({ "success": true, "history": history }))
        }
        Err(RepositoryError::Duplicate(_)) => HttpResponse::Conflict().json(ErrorResponse {
            error:
                "Family history changed or this request is already saved. Refresh before retrying."
                    .into(),
            code: "FAMILY_HISTORY_CONFLICT".into(),
        }),
        Err(RepositoryError::Validation(_)) => HttpResponse::BadRequest().json(ErrorResponse {
            error: "Family history requires review before this entry can be added".into(),
            code: "INVALID_FAMILY_HISTORY".into(),
        }),
        Err(error) => {
            log::error!("Family history append failed: {error}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "Family history could not be saved. Your draft has been kept.".into(),
                code: "FAMILY_HISTORY_UNAVAILABLE".into(),
            })
        }
    }
}
