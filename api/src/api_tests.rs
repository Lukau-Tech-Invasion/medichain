//! API integration tests. Registration workflows use an isolated schema in the
//! configured PostgreSQL database because account activation must be durable.

#[cfg(test)]
mod tests {
    use crate::{
        get_current_user_info, get_patient_by_id, get_settings, health_check, list_patients,
        register_patient, save_settings, AppState, Role, User,
    };
    use actix_web::{test, web, App};
    use chrono::Utc;
    use serde_json::json;

    const DOCTOR_ID: &str = "00000000-0000-4000-8000-000000000001";

    async fn setup_app_state() -> web::Data<AppState> {
        let state = AppState::new();

        // Setup a mock doctor
        let doctor = User {
            id: DOCTOR_ID.to_string(),
            username: Some("dr_smith".to_string()),
            name: "Dr. Smith".to_string(),
            role: Role::Doctor,
            created_at: Utc::now(),
            created_by: None,
            linked_patient_id: None,
            email: Some("smith@example.com".to_string()),
            phone: None,
            department: Some("Emergency".to_string()),
            specialty: Some("Emergency Medicine".to_string()),
            license_number: Some("DOC123".to_string()),
            status: "active".to_string(),
            last_login: None,
        };

        {
            let mut users = state.users.write().unwrap();
            users.insert(DOCTOR_ID.to_string(), doctor);
        }

        web::Data::new(state)
    }

    /// Seed audit cases that must remain distinct when counting use of a grant.
    async fn seed_grant_usage_logs(state: &web::Data<AppState>, grant_id: &str) {
        for (id, patient_id, authority_type, authority_id) in [
            (
                "usage-1",
                "PAT-USAGE",
                Some("patient_grant"),
                Some(grant_id),
            ),
            (
                "usage-2",
                "PAT-USAGE",
                Some("patient_grant"),
                Some(grant_id),
            ),
            (
                "other-patient",
                "PAT-OTHER",
                Some("patient_grant"),
                Some(grant_id),
            ),
            (
                "other-grant",
                "PAT-USAGE",
                Some("patient_grant"),
                Some("GRANT-OTHER"),
            ),
            (
                "other-authority",
                "PAT-USAGE",
                Some("care_relationship"),
                Some(grant_id),
            ),
            ("legacy", "PAT-USAGE", None, None),
        ] {
            state
                .repositories
                .access_logs
                .create(crate::repositories::AccessLogEntity {
                    id: id.into(),
                    accessor_id: DOCTOR_ID.into(),
                    accessor_role: "Doctor".into(),
                    patient_id: Some(patient_id.into()),
                    resource_type: "medical_record".into(),
                    resource_id: None,
                    action: "view".into(),
                    access_reason: Some("Treatment".into()),
                    is_emergency_access: false,
                    ip_address: None,
                    user_agent: None,
                    accessed_at: Utc::now(),
                    facility_id: None,
                    authority_type: authority_type.map(str::to_string),
                    authority_id: authority_id.map(str::to_string),
                })
                .await
                .unwrap();
        }
    }

    #[actix_rt::test]
    async fn test_access_grant_audit_usage() {
        let state = setup_app_state().await;
        state
            .users
            .write()
            .unwrap()
            .get_mut(DOCTOR_ID)
            .unwrap()
            .role = Role::Admin;
        let request = state
            .patient_access
            .create_request(
                "PAT-USAGE".into(),
                crate::patient_access::RequestingProvider {
                    provider_id: DOCTOR_ID.into(),
                    provider_name: "Synthetic clinician".into(),
                    provider_role: "Doctor".into(),
                    organization: "QA".into(),
                    reason: "Treatment".into(),
                },
                Utc::now(),
            )
            .await
            .unwrap();
        let (_, grant) = state
            .patient_access
            .approve_request(
                &request.id,
                crate::patient_access::AccessType::Limited,
                None,
                Utc::now(),
            )
            .await
            .unwrap();
        seed_grant_usage_logs(&state, &grant.id).await;
        let app = test::init_service(
            App::new()
                .app_data(state)
                .service(crate::handlers::list_patient_access_grants),
        )
        .await;
        let req = test::TestRequest::get()
            .uri("/api/access/patient/PAT-USAGE/grants")
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .to_request();
        let response = test::call_service(&app, req).await;
        assert_eq!(response.status(), 200);
        let body: serde_json::Value = test::read_body_json(response).await;
        assert_eq!(body["grants"][0]["accessCount"], 2);
        assert!(body["grants"][0]["lastAccessed"].is_string());
    }

    #[actix_rt::test]
    async fn test_pg_access_grant_audit_usage() {
        let state = setup_registration_state().await;
        for id in ["PAT-USAGE", "PAT-OTHER"] {
            state
                .repositories
                .patients
                .create(crate::repositories::postgres::tests::create_test_patient(
                    id,
                ))
                .await
                .unwrap();
        }
        seed_grant_usage_logs(&state, "GRANT-EXACT").await;
        let usage = state
            .repositories
            .access_logs
            .patient_grant_usage("PAT-USAGE")
            .await
            .unwrap();
        assert_eq!(usage.len(), 2);
        let exact = usage
            .iter()
            .find(|summary| summary.grant_id == "GRANT-EXACT")
            .unwrap();
        assert_eq!(exact.access_count, 2);
        let rows = state
            .repositories
            .access_logs
            .get_by_patient(
                "PAT-USAGE",
                crate::repositories::Pagination::first_page(100),
            )
            .await
            .unwrap();
        let latest = rows
            .items
            .iter()
            .filter(|row| {
                row.authority_type.as_deref() == Some("patient_grant")
                    && row.authority_id.as_deref() == Some("GRANT-EXACT")
            })
            .map(|row| row.accessed_at)
            .max()
            .unwrap();
        assert_eq!(exact.last_accessed, latest);
        assert!(state
            .repositories
            .access_logs
            .patient_grant_usage("PAT-ABSENT")
            .await
            .unwrap()
            .is_empty());
        state.db_pool.as_ref().unwrap().close().await;
        assert!(state
            .repositories
            .access_logs
            .patient_grant_usage("PAT-USAGE")
            .await
            .is_err());
    }

    /// Give registration tests persistent storage without creating another database.
    async fn setup_registration_state() -> web::Data<AppState> {
        let pool = crate::repositories::postgres::tests::create_test_pool().await;
        let mut state = AppState::new();
        state.repositories = crate::repositories::RepositoryContainer::new_postgres(pool.clone())
            .await
            .expect("PostgreSQL repositories for registration tests");
        state.db_pool = Some(pool);
        let seeded = setup_app_state().await;
        state
            .users
            .write()
            .unwrap()
            .extend(seeded.users.read().unwrap().clone());
        let doctor = state.users.read().unwrap()[DOCTOR_ID].clone();
        state
            .persist_user(&doctor)
            .await
            .expect("persist test clinician before registering patients");
        web::Data::new(state)
    }

    /// Registration payload with no measured blood group, shared by its
    /// success, authorization and storage-failure tests.
    fn untyped_registration_payload() -> serde_json::Value {
        json!({
            "full_name": "Untyped Patient",
            "date_of_birth": "1985-05-05",
            "national_id": "hash-untyped",
            "phone": "+27820000000",
            "allergies": [],
            "chronic_conditions": [],
            "current_medications": [],
            "emergency_contact_name": "Kin",
            "emergency_contact_phone": "+27820000001",
            "emergency_contact_relationship": "Sibling",
            "organ_donor": false,
            "dnr_status": false,
            "languages": ["en"]
        })
    }

    #[actix_rt::test]
    async fn test_health_check() {
        let app_state = setup_app_state().await;
        let app =
            test::init_service(App::new().app_data(app_state.clone()).service(health_check)).await;

        let req = test::TestRequest::get().uri("/health").to_request();
        let resp = test::call_service(&app, req).await;

        assert!(resp.status().is_success());
    }

    #[actix_rt::test]
    async fn test_get_me_authorized() {
        let app_state = setup_app_state().await;
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(get_current_user_info),
        )
        .await;

        let req = test::TestRequest::get()
            .uri("/api/auth/me")
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .to_request();
        let resp = test::call_service(&app, req).await;

        assert!(resp.status().is_success());
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["user_id"], DOCTOR_ID);
        assert_eq!(body["role"], "Doctor");
    }

    #[actix_rt::test]
    async fn test_get_me_unauthorized() {
        let app_state = setup_app_state().await;
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(get_current_user_info),
        )
        .await;

        let req = test::TestRequest::get().uri("/api/auth/me").to_request();
        let resp = test::call_service(&app, req).await;

        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    #[actix_rt::test]
    async fn test_patient_registration_and_retrieval() {
        let app_state = setup_registration_state().await;
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(register_patient)
                .service(get_patient_by_id),
        )
        .await;

        let registration_payload = json!({
            "full_name": "Test Patient",
            "date_of_birth": "1990-01-01",
            "national_id": "hash123",
            "phone": "+1234567890",
            "blood_type": "O+",
            "allergies": ["Peanuts"],
            "chronic_conditions": ["Asthma"],
            "current_medications": ["Albuterol"],
            "emergency_contact_name": "Jane Doe",
            "emergency_contact_phone": "+1987654321",
            "emergency_contact_relationship": "Spouse",
            "organ_donor": true,
            "dnr_status": false,
            "languages": ["en"]
        });

        // Register patient
        let req = test::TestRequest::post()
            .uri("/api/register")
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .set_json(&registration_payload)
            .to_request();
        let resp = test::call_service(&app, req).await;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = test::read_body(resp).await;
            panic!("Registration failed with status {}: {:?}", status, body);
        }

        let created: serde_json::Value = test::read_body_json(resp).await;
        let patient_id = created["patient_id"]
            .as_str()
            .expect("patient_id should be a string");

        // Retrieve patient
        let req = test::TestRequest::get()
            .uri(&format!("/api/patients/{}", patient_id))
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .to_request();
        let resp = test::call_service(&app, req).await;

        assert!(resp.status().is_success());
        let retrieved: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(retrieved["patient_id"], patient_id);
        assert_eq!(retrieved["full_name"], "Test Patient");
    }

    /// A patient nobody has typed registers as Unknown, not as a guessed
    /// group. Registration used to require one of the eight groups.
    #[actix_web::test]
    async fn a_patient_whose_blood_group_is_not_known_registers_as_unknown() {
        let app_state = setup_registration_state().await;
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(register_patient)
                .service(get_patient_by_id),
        )
        .await;
        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/register")
                .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
                .set_json(untyped_registration_payload())
                .to_request(),
        )
        .await;
        assert!(resp.status().is_success(), "{}", resp.status());
        let created: serde_json::Value = test::read_body_json(resp).await;
        let patient_id = created["patient_id"].as_str().expect("patient_id");

        let retrieved: serde_json::Value = test::call_and_read_body_json(
            &app,
            test::TestRequest::get()
                .uri(&format!("/api/patients/{patient_id}"))
                .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
                .to_request(),
        )
        .await;
        assert_eq!(
            retrieved["emergency_info"]["blood_type"], "Unknown",
            "{retrieved}"
        );
    }

    /// A patient cannot register another person, regardless of whether a
    /// blood group was supplied in the request.
    #[actix_web::test]
    async fn an_untyped_registration_by_a_patient_is_forbidden() {
        let app_state = setup_app_state().await;
        let mut patient = app_state.users.read().unwrap()[DOCTOR_ID].clone();
        patient.id = "patient_user".to_string();
        patient.role = Role::Patient;
        app_state
            .users
            .write()
            .unwrap()
            .insert("patient_user".to_string(), patient);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(register_patient),
        )
        .await;
        let response = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/register")
                .insert_header(crate::test_fixtures::as_user("patient_user"))
                .set_json(untyped_registration_payload())
                .to_request(),
        )
        .await;
        assert_eq!(response.status(), actix_web::http::StatusCode::FORBIDDEN);
    }

    /// A storage outage does not acknowledge an unpersisted patient and gives
    /// the client a stable, safe error code.
    #[actix_web::test]
    async fn an_untyped_registration_with_unavailable_storage_returns_503() {
        let seeded = setup_app_state().await;
        let mut state = AppState::new();
        let doctor = seeded.users.read().unwrap()[DOCTOR_ID].clone();
        state
            .users
            .write()
            .unwrap()
            .insert(DOCTOR_ID.to_string(), doctor);
        let pool = sqlx::postgres::PgPoolOptions::new()
            .acquire_timeout(std::time::Duration::from_millis(250))
            .connect_lazy_with(
                sqlx::postgres::PgConnectOptions::new()
                    .host("127.0.0.1")
                    .port(1)
                    .username("unavailable-test")
                    .database("unavailable"),
            );
        state.repositories.pool = Some(pool);
        let state = web::Data::new(state);
        let app =
            test::init_service(App::new().app_data(state.clone()).service(register_patient)).await;
        let response = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/register")
                .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
                .set_json(untyped_registration_payload())
                .to_request(),
        )
        .await;
        assert_eq!(
            response.status(),
            actix_web::http::StatusCode::SERVICE_UNAVAILABLE
        );
        let body: serde_json::Value = test::read_body_json(response).await;
        assert_eq!(
            body["error"]["code"], "PATIENT_REGISTRATION_UNAVAILABLE",
            "{body}"
        );
        let patients = state
            .repositories
            .patients
            .list(crate::repositories::traits::Pagination::first_page(10))
            .await
            .unwrap();
        assert_eq!(patients.total, 0, "503 must not leave a patient behind");
    }

    /// A lookup yields only directory fields and one organisation audit event.
    #[actix_web::test]
    async fn patient_directory_search_has_one_audit_and_no_patient_disclosures() {
        let state = setup_registration_state().await;
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .wrap(crate::middleware::phi_access_audit::PhiAccessAuditMiddleware)
                .service(register_patient)
                .service(list_patients),
        )
        .await;
        let registration = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/register")
                .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
                .set_json(untyped_registration_payload())
                .to_request(),
        )
        .await;
        assert!(registration.status().is_success());
        let created: serde_json::Value = test::read_body_json(registration).await;
        let patient_id = created["patient_id"].as_str().unwrap();

        let response = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/patients?q=Untyped")
                .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
                .insert_header(("x-access-reason", "Treatment"))
                .to_request(),
        )
        .await;
        assert!(response.status().is_success());
        let body: serde_json::Value = test::read_body_json(response).await;
        let rows = body["data"].as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["patient_id"], patient_id);
        assert_eq!(rows[0]["full_name"], "Untyped Patient");
        for forbidden in [
            "emergency_info",
            "national_id",
            "phone",
            "allergies",
            "medications",
        ] {
            assert!(rows[0].get(forbidden).is_none(), "{forbidden} leaked");
        }
        let events: Vec<_> = state
            .audit_outbox
            .recorded()
            .into_iter()
            .filter(|event| event.event_type == "patient_directory_search")
            .collect();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].aggregate_type, "organisation");
        assert_eq!(events[0].payload["actor_id"], DOCTOR_ID);
        assert_eq!(events[0].payload["purpose"], "Treatment");
        assert_eq!(events[0].payload["result_count"], 1);
        assert!(events[0].payload.get("patient_id").is_none());
        let logs = state
            .repositories
            .access_logs
            .list(crate::repositories::traits::Pagination::first_page(10))
            .await
            .unwrap();
        assert_eq!(logs.total, 0);
    }

    /// The directory is unavailable to patient accounts, even with a purpose.
    #[actix_web::test]
    async fn patient_role_cannot_search_the_directory() {
        let state = setup_app_state().await;
        let mut patient = state.users.read().unwrap()[DOCTOR_ID].clone();
        patient.id = "patient_user".to_string();
        patient.role = Role::Patient;
        state
            .users
            .write()
            .unwrap()
            .insert("patient_user".to_string(), patient);
        let app =
            test::init_service(App::new().app_data(state.clone()).service(list_patients)).await;
        let response = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/patients")
                .insert_header(crate::test_fixtures::as_user("patient_user"))
                .insert_header(("x-access-reason", "Treatment"))
                .to_request(),
        )
        .await;
        assert_eq!(response.status(), actix_web::http::StatusCode::FORBIDDEN);
        assert!(state.audit_outbox.recorded().is_empty());
    }

    /// A purpose must be declared by the caller; the server never invents one.
    #[actix_web::test]
    async fn directory_search_without_a_purpose_is_rejected() {
        let state = setup_app_state().await;
        let app =
            test::init_service(App::new().app_data(state.clone()).service(list_patients)).await;
        let response = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/patients")
                .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
                .to_request(),
        )
        .await;
        assert_eq!(response.status(), actix_web::http::StatusCode::BAD_REQUEST);
        assert!(state.audit_outbox.recorded().is_empty());

        let response = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/patients")
                .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
                .insert_header(("x-access-reason", "Not stated"))
                .to_request(),
        )
        .await;
        assert_eq!(response.status(), actix_web::http::StatusCode::BAD_REQUEST);
        assert!(state.audit_outbox.recorded().is_empty());
    }

    /// A failed durable audit blocks the directory response.
    #[actix_web::test]
    async fn directory_audit_storage_failure_returns_503() {
        let seeded = setup_app_state().await;
        let mut state = AppState::new();
        let doctor = seeded.users.read().unwrap()[DOCTOR_ID].clone();
        state
            .users
            .write()
            .unwrap()
            .insert(DOCTOR_ID.to_string(), doctor);
        state.db_pool = Some(
            sqlx::postgres::PgPoolOptions::new()
                .acquire_timeout(std::time::Duration::from_millis(250))
                .connect_lazy_with(
                    sqlx::postgres::PgConnectOptions::new()
                        .host("127.0.0.1")
                        .port(1)
                        .username("unavailable-test")
                        .database("unavailable"),
                ),
        );
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .service(list_patients),
        )
        .await;
        let response = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/patients")
                .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
                .insert_header(("x-access-reason", "Treatment"))
                .to_request(),
        )
        .await;
        assert_eq!(
            response.status(),
            actix_web::http::StatusCode::SERVICE_UNAVAILABLE
        );
    }

    // --- Phase 7.2: concurrent clinical endpoint load tests ---
    //
    // These exercise the in-memory `AppState` stores (`RwLock`-backed maps) under
    // concurrent access from multiple simultaneous requests against the same running
    // service, the way a busy ED shift would hit the API. They assert correctness
    // (no lost writes, no panics, no 5xx) under concurrency, and a generous latency
    // bound to catch gross regressions — not a full benchmark.

    fn registration_payload(seq: usize) -> serde_json::Value {
        json!({
            "full_name": format!("Load Test Patient {}", seq),
            "date_of_birth": "1990-01-01",
            "national_id": format!("load-test-hash-{}", seq),
            "phone": format!("+1000000{:04}", seq),
            "blood_type": "O+",
            "allergies": [],
            "chronic_conditions": [],
            "current_medications": [],
            "emergency_contact_name": "Load Test Contact",
            "emergency_contact_phone": "+19999999999",
            "emergency_contact_relationship": "Spouse",
            "organ_donor": false,
            "dnr_status": false,
            "languages": ["en"]
        })
    }

    #[actix_rt::test]
    async fn test_concurrent_patient_registration_load() {
        const CONCURRENCY: usize = 50;

        let app_state = setup_registration_state().await;
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(register_patient),
        )
        .await;

        let started = std::time::Instant::now();

        // Fire all registrations concurrently against the same running service —
        // exercises the write path (patients map + NFC tag map inserts) under
        // simultaneous RwLock writers.
        let responses = futures::future::join_all((0..CONCURRENCY).map(|i| {
            let app = &app;
            async move {
                let req = test::TestRequest::post()
                    .uri("/api/register")
                    .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
                    .set_json(registration_payload(i))
                    .to_request();
                test::call_service(app, req).await
            }
        }))
        .await;

        let elapsed = started.elapsed();

        let mut patient_ids = std::collections::HashSet::new();
        for (i, resp) in responses.into_iter().enumerate() {
            assert!(
                resp.status().is_success(),
                "registration {} failed with status {}",
                i,
                resp.status()
            );
            let body: serde_json::Value = test::read_body_json(resp).await;
            let patient_id = body["patient_id"]
                .as_str()
                .expect("patient_id should be a string")
                .to_string();
            assert!(
                patient_ids.insert(patient_id.clone()),
                "duplicate patient_id {} returned under concurrent registration \
                 (indicates a lost-update race in the in-memory store)",
                patient_id
            );
        }
        assert_eq!(
            patient_ids.len(),
            CONCURRENCY,
            "expected {} unique patients, got {} — some concurrent writes were lost",
            CONCURRENCY,
            patient_ids.len()
        );
        assert!(
            elapsed < std::time::Duration::from_secs(10),
            "{} concurrent registrations took {:?}, expected well under 10s",
            CONCURRENCY,
            elapsed
        );
    }

    #[actix_rt::test]
    async fn test_concurrent_patient_read_load() {
        const CONCURRENCY: usize = 100;

        let app_state = setup_registration_state().await;
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(register_patient)
                .service(get_patient_by_id),
        )
        .await;

        // Seed a single patient, then hammer it with concurrent reads — exercises
        // the read path (RwLock readers) under contention.
        let req = test::TestRequest::post()
            .uri("/api/register")
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .set_json(registration_payload(9999))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
        let created: serde_json::Value = test::read_body_json(resp).await;
        let patient_id = created["patient_id"]
            .as_str()
            .expect("patient_id should be a string")
            .to_string();

        let started = std::time::Instant::now();

        let responses = futures::future::join_all((0..CONCURRENCY).map(|_| {
            let app = &app;
            let patient_id = patient_id.clone();
            async move {
                let req = test::TestRequest::get()
                    .uri(&format!("/api/patients/{}", patient_id))
                    .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
                    .to_request();
                test::call_service(app, req).await
            }
        }))
        .await;

        let elapsed = started.elapsed();

        for (i, resp) in responses.into_iter().enumerate() {
            assert!(
                resp.status().is_success(),
                "concurrent read {} failed with status {}",
                i,
                resp.status()
            );
            let body: serde_json::Value = test::read_body_json(resp).await;
            assert_eq!(
                body["patient_id"], patient_id,
                "concurrent read {} returned inconsistent data",
                i
            );
        }
        assert!(
            elapsed < std::time::Duration::from_secs(10),
            "{} concurrent reads took {:?}, expected well under 10s",
            CONCURRENCY,
            elapsed
        );
    }

    /// A responder may use emergency workflows without gaining the full chart.
    #[actix_rt::test]
    async fn paramedic_cannot_open_patient_profile() {
        let app_state = setup_app_state().await;
        let mut paramedic = app_state.users.read().unwrap()[DOCTOR_ID].clone();
        paramedic.id = "paramedic_user".to_string();
        paramedic.role = Role::Paramedic;
        app_state
            .users
            .write()
            .unwrap()
            .insert(paramedic.id.clone(), paramedic);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(get_patient_by_id),
        )
        .await;
        let request = test::TestRequest::get()
            .uri("/api/patients/PAT-EXISTING")
            .insert_header(crate::test_fixtures::as_user("paramedic_user"))
            .to_request();
        let response = test::call_service(&app, request).await;
        assert_eq!(response.status(), actix_web::http::StatusCode::FORBIDDEN);
    }

    #[actix_rt::test]
    async fn settings_round_trip_through_memory_backend() {
        let app_state = setup_app_state().await;
        let app = test::init_service(
            App::new()
                .app_data(app_state)
                .service(get_settings)
                .service(save_settings),
        )
        .await;
        let expected = json!({
            "notifications": { "emergencyAlerts": false },
            "display": { "theme": "dark" }
        });

        let save_request = test::TestRequest::post()
            .uri("/api/settings")
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .set_json(&expected)
            .to_request();
        let save_response = test::call_service(&app, save_request).await;
        assert!(save_response.status().is_success());

        let get_request = test::TestRequest::get()
            .uri("/api/settings")
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .to_request();
        let get_response = test::call_service(&app, get_request).await;
        assert!(get_response.status().is_success());
        let actual: serde_json::Value = test::read_body_json(get_response).await;
        assert_eq!(actual, expected);
    }

    #[actix_rt::test]
    async fn settings_reject_non_object_payloads() {
        let app_state = setup_app_state().await;
        let app = test::init_service(App::new().app_data(app_state).service(save_settings)).await;
        let request = test::TestRequest::post()
            .uri("/api/settings")
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .set_json(json!(["not", "an", "object"]))
            .to_request();

        let response = test::call_service(&app, request).await;
        assert_eq!(response.status(), actix_web::http::StatusCode::BAD_REQUEST);
    }

    // =======================================================================
    // Interoperability and Medical-ID completeness
    //
    // The defect these cover is not "a field is missing" — it is that the
    // endpoints reported a CONFIDENT EMPTY value. An empty FHIR Condition
    // bundle tells an importing system the patient has no chronic conditions;
    // an empty `medications` array on the Medical ID tells a paramedic the
    // patient takes none. Both were hardcoded.
    // =======================================================================

    /// A patient carrying every field the old placeholders discarded.
    fn full_patient_payload() -> serde_json::Value {
        json!({
            "full_name": "Thandiwe Mokoena",
            "date_of_birth": "1984-03-19",
            "national_id": "hash-interop-1",
            "phone": "+27821234567",
            "blood_type": "A+",
            "allergies": ["Penicillin"],
            "chronic_conditions": ["Type 2 diabetes", "Hypertension"],
            "current_medications": ["Metformin 850mg", "Enalapril 10mg"],
            "emergency_contact_name": "Sipho Mokoena",
            "emergency_contact_phone": "+27829876543",
            "emergency_contact_relationship": "Brother",
            "organ_donor": true,
            "dnr_status": false,
            "languages": ["en"]
        })
    }

    #[actix_rt::test]
    async fn fhir_patient_carries_real_demographics_not_placeholders() {
        let app_state = setup_registration_state().await;
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(register_patient)
                .service(crate::clinical_endpoints::fhir_get_patient),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/register")
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .set_json(full_patient_payload())
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success(), "registration failed");
        let created: serde_json::Value = test::read_body_json(resp).await;
        let patient_id = created["patient_id"]
            .as_str()
            .expect("patient_id")
            .to_string();

        let req = test::TestRequest::get()
            .uri(&format!("/api/fhir/r4/Patient/{patient_id}"))
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
        let body: serde_json::Value = test::read_body_json(resp).await;

        // Was the literal "Patient".
        assert_eq!(
            body["name"][0]["text"], "Thandiwe Mokoena",
            "FHIR Patient still reports a placeholder name"
        );
        // Was the literal "Redacted", which is not a valid FHIR date at all.
        assert_eq!(
            body["birthDate"], "1984-03-19",
            "FHIR birthDate is missing or not a valid date"
        );
        // Was `[]` — a positive claim that the patient has no next of kin.
        let contact = &body["contact"][0];
        assert_eq!(contact["name"]["text"], "Sipho Mokoena");
        assert_eq!(contact["telecom"][0]["value"], "+27829876543");
        assert_eq!(contact["relationship"][0]["text"], "Brother");
    }

    /// The triage queue names each waiting patient. The page used to look names
    /// up in the first 50 patients and showed a bare id for everyone else.
    #[actix_rt::test]
    async fn triage_queue_names_each_waiting_patient() {
        let app_state = setup_registration_state().await;
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(register_patient)
                .service(crate::handlers::create_triage_assessment)
                .service(crate::handlers::get_triage_queue),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/register")
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .set_json(full_patient_payload())
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success(), "registration failed");
        let created: serde_json::Value = test::read_body_json(resp).await;
        let patient_id = created["patient_id"]
            .as_str()
            .expect("patient_id")
            .to_string();

        let req = test::TestRequest::post()
            .uri("/api/clinical/triage")
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .set_json(json!({
                "patient_id": patient_id,
                "esi_level": 3,
                "chief_complaint": "Synthetic abdominal pain",
                "vital_signs": {}
            }))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(
            resp.status().is_success(),
            "triage create failed: {}",
            resp.status()
        );

        let req = test::TestRequest::get()
            .uri("/api/clinical/triage/queue")
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
        let body: serde_json::Value = test::read_body_json(resp).await;
        let entry = body["queue"]
            .as_array()
            .expect("queue")
            .iter()
            .find(|entry| entry["patient_id"] == patient_id.as_str())
            .expect("the triaged patient is in the queue");
        assert_eq!(entry["patient_name"], "Thandiwe Mokoena", "{entry}");
        assert_eq!(entry["chief_complaint"], "Synthetic abdominal pain");
    }

    /// The paediatric caseload is every child the directory holds, not the
    /// children among its first page; adults are excluded and a purpose is
    /// required, as for any directory read.
    #[actix_rt::test]
    async fn paediatric_caseload_lists_children_with_server_computed_age() {
        let app_state = setup_registration_state().await;
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(register_patient)
                .service(crate::handlers::paediatric_caseload),
        )
        .await;
        let register = |payload: serde_json::Value| {
            test::TestRequest::post()
                .uri("/api/register")
                .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
                .set_json(payload)
                .to_request()
        };
        let mut child = full_patient_payload();
        child["full_name"] = json!("Lwazi Synthetic");
        child["date_of_birth"] = json!(chrono::Utc::now()
            .date_naive()
            .checked_sub_months(chrono::Months::new(30))
            .unwrap()
            .format("%Y-%m-%d")
            .to_string());
        child["national_id"] = json!("hash-paediatric-child");
        let child_id = test::read_body_json::<serde_json::Value, _>(
            test::call_service(&app, register(child)).await,
        )
        .await["patient_id"]
            .as_str()
            .expect("child patient_id")
            .to_string();
        let adult_id = test::read_body_json::<serde_json::Value, _>(
            test::call_service(&app, register(full_patient_payload())).await,
        )
        .await["patient_id"]
            .as_str()
            .expect("adult patient_id")
            .to_string();

        let req = test::TestRequest::get()
            .uri("/api/patients/paediatric-caseload")
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .insert_header((
                crate::middleware::phi_access_audit::ACCESS_REASON_HEADER,
                "treatment",
            ))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status().as_u16(), 200);
        let body: serde_json::Value = test::read_body_json(resp).await;
        let rows = body["data"].as_array().expect("data");
        let child_row = rows
            .iter()
            .find(|row| row["patient_id"] == child_id.as_str())
            .expect("the child is in the caseload");
        assert_eq!(child_row["age_months"], 30, "{child_row}");
        assert!(
            rows.iter()
                .all(|row| row["patient_id"] != adult_id.as_str()),
            "an adult was listed"
        );
        assert_eq!(body["truncated"], false);

        let req = test::TestRequest::get()
            .uri("/api/patients/paediatric-caseload")
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status().as_u16(), 400);
    }

    /// The discharge page's own payload is stored as the clinician wrote it: the
    /// principal diagnosis and condition reach their columns, an admission time
    /// nobody entered stays unknown, and the author is the signed-in clinician.
    #[actix_rt::test]
    async fn discharge_summary_stores_what_the_page_sent_and_invents_nothing() {
        let app_state = setup_registration_state().await;
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(register_patient)
                .service(crate::clinical_endpoints::create_discharge_summary)
                .service(crate::clinical_endpoints::get_discharge_summary),
        )
        .await;
        let req = test::TestRequest::post()
            .uri("/api/register")
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .set_json(full_patient_payload())
            .to_request();
        let created: serde_json::Value =
            test::read_body_json(test::call_service(&app, req).await).await;
        let patient_id = created["patient_id"]
            .as_str()
            .expect("patient_id")
            .to_string();

        let post = |body: serde_json::Value| {
            test::TestRequest::post()
                .uri("/api/clinical/discharge-summary")
                .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
                .set_json(body)
                .to_request()
        };
        let page_payload = json!({
            "patient_id": patient_id,
            "discharge_disposition": "rehab",
            "primary_diagnosis": "Synthetic community-acquired pneumonia",
            "discharge_condition": "improved",
            "attending_physician_id": "someone-else",
        });
        let resp = test::call_service(&app, post(page_payload.clone())).await;
        assert_eq!(resp.status().as_u16(), 201);
        let body: serde_json::Value = test::read_body_json(resp).await;
        let summary_id = body["summary_id"].as_str().expect("summary_id").to_string();

        let req = test::TestRequest::get()
            .uri(&format!("/api/clinical/discharge-summary/{summary_id}"))
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .to_request();
        let stored: serde_json::Value =
            test::read_body_json(test::call_service(&app, req).await).await;
        assert_eq!(
            stored["principal_diagnosis"],
            "Synthetic community-acquired pneumonia"
        );
        assert_eq!(
            stored["condition_at_discharge"], "improved",
            "condition was invented"
        );
        assert_eq!(stored["discharge_disposition"], "rehab");
        assert!(
            stored["admission_datetime"].is_null(),
            "admission was invented: {stored}"
        );
        assert_eq!(
            stored["attending_physician_id"], DOCTOR_ID,
            "author came from the request"
        );

        // A condition nobody chose, or an admission after discharge, is refused.
        let mut unchosen = page_payload.clone();
        unchosen
            .as_object_mut()
            .unwrap()
            .remove("discharge_condition");
        assert_eq!(
            test::call_service(&app, post(unchosen))
                .await
                .status()
                .as_u16(),
            400
        );
        let mut backwards = page_payload;
        backwards["admission_datetime"] = json!("2026-10-20T08:00:00Z");
        backwards["discharge_datetime"] = json!("2026-10-18T08:00:00Z");
        assert_eq!(
            test::call_service(&app, post(backwards))
                .await
                .status()
                .as_u16(),
            400
        );
    }

    #[actix_rt::test]
    async fn fhir_condition_and_medication_bundles_are_not_silently_empty() {
        let app_state = setup_registration_state().await;
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(register_patient)
                .service(crate::clinical_endpoints::fhir_get_conditions)
                .service(crate::clinical_endpoints::fhir_get_medications)
                .service(crate::clinical_endpoints::fhir_get_allergies),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/register")
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .set_json(full_patient_payload())
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success(), "registration failed");
        let created: serde_json::Value = test::read_body_json(resp).await;
        let patient_id = created["patient_id"]
            .as_str()
            .expect("patient_id")
            .to_string();

        let req = test::TestRequest::get()
            .uri(&format!("/api/fhir/r4/Condition?patient={patient_id}"))
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .to_request();
        let body: serde_json::Value = test::call_and_read_body_json(&app, req).await;
        assert_eq!(
            body["total"], 2,
            "Condition bundle reported no chronic conditions for a patient who has two"
        );
        let coded: Vec<String> = body["entry"]
            .as_array()
            .expect("entry array")
            .iter()
            .map(|e| {
                e["resource"]["code"]["text"]
                    .as_str()
                    .unwrap_or("")
                    .to_string()
            })
            .collect();
        assert!(coded.iter().any(|c| c == "Type 2 diabetes"));
        assert!(coded.iter().any(|c| c == "Hypertension"));

        let req = test::TestRequest::get()
            .uri(&format!(
                "/api/fhir/r4/MedicationStatement?patient={patient_id}"
            ))
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .to_request();
        let body: serde_json::Value = test::call_and_read_body_json(&app, req).await;
        assert_eq!(
            body["total"], 2,
            "MedicationStatement bundle reported no medication for a patient on two"
        );

        // Read an allergies table nothing writes, so it was `total: 0` for
        // every patient -- a positive "no known allergies" to the importer.
        let req = test::TestRequest::get()
            .uri(&format!(
                "/api/fhir/r4/AllergyIntolerance?patient={patient_id}"
            ))
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .to_request();
        let body: serde_json::Value = test::call_and_read_body_json(&app, req).await;
        assert_eq!(
            body["total"], 1,
            "AllergyIntolerance bundle lost the allergy: {body}"
        );
        assert_eq!(body["entry"][0]["resource"]["code"]["text"], "Penicillin");
        assert_eq!(
            body["entry"][0]["resource"]["criticality"], "unable-to-assess",
            "a registration allergy has no assessed severity"
        );
    }

    #[actix_rt::test]
    async fn medical_id_card_shows_conditions_medications_and_contacts() {
        let app_state = setup_registration_state().await;
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(register_patient)
                .service(crate::clinical_endpoints::get_medical_id),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/register")
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .set_json(full_patient_payload())
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success(), "registration failed");
        let created: serde_json::Value = test::read_body_json(resp).await;
        let patient_id = created["patient_id"]
            .as_str()
            .expect("patient_id")
            .to_string();

        let req = test::TestRequest::get()
            .uri(&format!("/api/medical-id/{patient_id}"))
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
        let body: serde_json::Value = test::read_body_json(resp).await;

        // All three were hardcoded empty. On this card that reads as
        // "no conditions, no medication, nobody to call".
        assert_eq!(
            body["chronic_conditions"].as_array().map(Vec::len),
            Some(2),
            "Medical ID reported no chronic conditions"
        );
        assert_eq!(
            body["medications"].as_array().map(Vec::len),
            Some(2),
            "Medical ID reported no current medications"
        );
        assert_eq!(
            body["emergency_contacts"][0]["name"], "Sipho Mokoena",
            "Medical ID reported no emergency contact"
        );
        // Was the literal "Patient" / "Redacted".
        assert_eq!(body["name"], "Thandiwe Mokoena");
        assert_eq!(body["date_of_birth"], "1984-03-19");
        // Present and false: the card can distinguish "nothing recorded" from
        // "we could not decrypt the record".
        assert_eq!(body["profile_unavailable"], false);
        assert_eq!(body["allergies"][0]["name"], "Penicillin", "{body}");
        assert_eq!(body["allergies"][0]["severity"], "unknown", "{body}");
    }
    /// A clinician cannot attribute a handoff to a different provider through the payload.
    #[actix_rt::test]
    async fn shift_handoff_rejects_forged_outgoing_provider() {
        let state = setup_app_state().await;
        let app = test::init_service(
            App::new()
                .app_data(state)
                .service(crate::clinical_endpoints::create_shift_handoff),
        )
        .await;
        for (outgoing, expected) in [("different-provider", 403), (DOCTOR_ID, 400), ("", 400)] {
            let request = test::TestRequest::post().uri("/api/emergency/handoff")
                .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
                .set_json(json!({"outgoing_nurse": outgoing, "incoming_nurse": DOCTOR_ID, "patients": []}))
                .to_request();
            let response = test::call_service(&app, request).await;
            assert_eq!(response.status().as_u16(), expected);
        }
    }

    /// A receiving clinician must resolve to an active clinical account before any record is written.
    #[actix_rt::test]
    async fn shift_handoff_requires_a_registered_active_clinical_recipient() {
        let state = setup_app_state().await;
        let template = state.users.read().unwrap()[DOCTOR_ID].clone();
        for (id, role, status) in [
            ("qa-patient", Role::Patient, "active"),
            ("qa-inactive", Role::Nurse, "inactive"),
        ] {
            let mut user = template.clone();
            user.id = id.into();
            user.role = role;
            user.status = status.into();
            state.users.write().unwrap().insert(id.into(), user);
        }
        let app = test::init_service(
            App::new()
                .app_data(state)
                .service(crate::clinical_endpoints::create_shift_handoff),
        )
        .await;
        for recipient in [
            "Nurse QA Free Text",
            "qa-unknown",
            "qa-patient",
            "qa-inactive",
        ] {
            let request = test::TestRequest::post().uri("/api/emergency/handoff")
                .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
                .set_json(json!({"outgoing_nurse": DOCTOR_ID, "incoming_nurse": recipient, "patients": []}))
                .to_request();
            let response = test::call_service(&app, request).await;
            assert_eq!(response.status().as_u16(), 400);
            let body: serde_json::Value = test::read_body_json(response).await;
            assert_eq!(
                body["error"]["code"], "INVALID_RECIPIENT",
                "{recipient}: {body}"
            );
        }
    }

    /// Optional contact values can be explicitly cleared without inventing replacements.
    #[actix_rt::test]
    async fn clinician_contact_clear_preserves_unknowns_and_rejects_invalid_email() {
        let state = setup_app_state().await;
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(crate::handlers::update_user_profile)
                .service(crate::handlers::get_user_with_profile),
        )
        .await;
        for (email, expected) in [("not-an-email", 400), ("   ", 200)] {
            let request = test::TestRequest::put()
                .uri(&format!("/api/users/{DOCTOR_ID}"))
                .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
                .set_json(json!({"email":email,"phone":""}))
                .to_request();
            assert_eq!(
                test::call_service(&app, request).await.status().as_u16(),
                expected
            );
        }
        let request = test::TestRequest::get()
            .uri(&format!("/api/users/{DOCTOR_ID}"))
            .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
            .to_request();
        let response = test::call_service(&app, request).await;
        assert_eq!(response.status(), 200);
        let saved: serde_json::Value = test::read_body_json(response).await;
        assert!(saved["email"].is_null());
        assert!(saved["phone"].is_null());
    }

    /// The outgoing nurse's Stable/Watch/Unstable call and to-dos are kept (mockup c2).
    #[actix_rt::test]
    async fn shift_handoff_keeps_the_stability_call_and_to_dos() {
        let state = setup_app_state().await;
        let mut night = state.users.read().unwrap()[DOCTOR_ID].clone();
        night.id = "QA-night".into();
        night.role = Role::Nurse;
        state.users.write().unwrap().insert(night.id.clone(), night);
        crate::test_fixtures::seed_patient(&state, "QA-c2-patient").await;
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(crate::clinical_endpoints::create_shift_handoff),
        )
        .await;
        let post = |patient: serde_json::Value| {
            test::TestRequest::post()
                .uri("/api/emergency/handoff")
                .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
                .set_json(json!({"outgoing_nurse": DOCTOR_ID, "incoming_nurse": "QA-night", "patients": [patient]}))
                .to_request()
        };

        let response = test::call_service(
            &app,
            post(json!({
                "patientId": "QA-c2-patient", "stability": "watch",
                "todos": ["Repeat BP at 20:00", "Call doctor if over 160/100"],
            })),
        )
        .await;
        assert_eq!(response.status().as_u16(), 201);
        let body: serde_json::Value = test::read_body_json(response).await;
        let saved = state
            .repositories
            .shift_handoffs
            .get_by_id(&format!("{}-QA-c2-patient", body["id"].as_str().unwrap()))
            .await
            .unwrap();
        assert_eq!(saved.data["patient"]["stability"], "watch");
        assert_eq!(
            saved.data["patient"]["todos"][1],
            "Call doctor if over 160/100"
        );

        // Nobody made the call: nothing is stored, not "stable".
        let response =
            test::call_service(&app, post(json!({ "patientId": "QA-c2-patient" }))).await;
        let body: serde_json::Value = test::read_body_json(response).await;
        let saved = state
            .repositories
            .shift_handoffs
            .get_by_id(&format!("{}-QA-c2-patient", body["id"].as_str().unwrap()))
            .await
            .unwrap();
        assert!(saved.data["patient"].get("stability").is_none());

        for bad in [json!({ "stability": "fine" }), json!({ "todos": ["  "] })] {
            let mut patient = bad.clone();
            patient["patientId"] = json!("QA-c2-patient");
            let response = test::call_service(&app, post(patient)).await;
            assert_eq!(response.status().as_u16(), 400, "{bad}");
        }
    }

    /// Receipt belongs only to its recipient and retries must retain the first timestamp.
    #[actix_rt::test]
    async fn shift_handoff_receipt_is_recipient_only_and_repeat_safe() {
        let state = setup_app_state().await;
        let record = crate::repositories::traits::ShiftHandoffEntity {
            id: "QA-receipt".into(),
            patient_id: "QA-patient".into(),
            incoming_provider_id: DOCTOR_ID.into(),
            outgoing_provider_id: "QA-sender".into(),
            situation: "Synthetic receipt test".into(),
            ..Default::default()
        };
        state
            .repositories
            .shift_handoffs
            .create(record)
            .await
            .unwrap();
        let mut other = state.users.read().unwrap()[DOCTOR_ID].clone();
        other.id = "QA-sender".into();
        state.users.write().unwrap().insert(other.id.clone(), other);
        let app = test::init_service(
            App::new()
                .app_data(state.clone())
                .service(crate::clinical_endpoints::acknowledge_shift_handoff),
        )
        .await;
        let forbidden = test::TestRequest::put()
            .uri("/api/emergency/handoff/QA-receipt/receipt")
            .insert_header(crate::test_fixtures::as_user("QA-sender"))
            .to_request();
        assert_eq!(test::call_service(&app, forbidden).await.status(), 403);
        assert!(
            !state
                .repositories
                .shift_handoffs
                .get_by_id("QA-receipt")
                .await
                .unwrap()
                .acknowledged_by_incoming
        );
        let mut first_time = None;
        let mut first_update = None;
        for _ in 0..2 {
            let request = test::TestRequest::put()
                .uri("/api/emergency/handoff/QA-receipt/receipt")
                .insert_header(crate::test_fixtures::as_user(DOCTOR_ID))
                .to_request();
            let response = test::call_service(&app, request).await;
            assert_eq!(response.status(), 200);
            let saved: crate::repositories::traits::ShiftHandoffEntity =
                test::read_body_json(response).await;
            assert!(saved.acknowledged_by_incoming);
            assert!(!saved.read_back_confirmed);
            assert_eq!(saved.situation, "Synthetic receipt test");
            assert!(saved.updated_at > chrono::DateTime::<Utc>::default());
            if let Some(updated_at) = first_update {
                assert_eq!(saved.updated_at, updated_at);
            }
            first_update = Some(saved.updated_at);
            if let Some(time) = first_time {
                assert_eq!(saved.acknowledged_at, Some(time));
            }
            first_time = saved.acknowledged_at;
            assert!(first_time.is_some());
        }
    }
}
