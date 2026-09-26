//! API Integration Tests (In-memory/Mock backend)
//! These tests focus on endpoint logic, RBAC, and middleware without requiring a real database.

#[cfg(test)]
mod tests {
    use crate::{
        get_current_user_info, get_patient_by_id, get_settings, health_check, list_patients,
        register_patient, save_settings, AppState, Role, User,
    };
    use actix_web::{test, web, App};
    use chrono::Utc;
    use serde_json::json;

    async fn setup_app_state() -> web::Data<AppState> {
        let state = AppState::new();

        // Setup a mock doctor
        let doctor = User {
            wallet_address: "doctor_wallet".to_string(),
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
            users.insert("doctor_wallet".to_string(), doctor);
        }

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
            .insert_header(("x-user-id", "doctor_wallet"))
            .to_request();
        let resp = test::call_service(&app, req).await;

        assert!(resp.status().is_success());
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["wallet_address"], "doctor_wallet");
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
        let app_state = setup_app_state().await;
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
            .insert_header(("x-user-id", "doctor_wallet"))
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
            .insert_header(("x-user-id", "doctor_wallet"))
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
        let app_state = setup_app_state().await;
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
                .insert_header(("x-user-id", "doctor_wallet"))
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
                .insert_header(("x-user-id", "doctor_wallet"))
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
        let mut patient = app_state.users.read().unwrap()["doctor_wallet"].clone();
        patient.wallet_address = "patient_wallet".to_string();
        patient.role = Role::Patient;
        app_state
            .users
            .write()
            .unwrap()
            .insert("patient_wallet".to_string(), patient);
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
                .insert_header(("x-user-id", "patient_wallet"))
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
        let doctor = seeded.users.read().unwrap()["doctor_wallet"].clone();
        state
            .users
            .write()
            .unwrap()
            .insert("doctor_wallet".to_string(), doctor);
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
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .service(register_patient),
        )
        .await;
        let response = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/register")
                .insert_header(("x-user-id", "doctor_wallet"))
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
    }

    /// A lookup yields only directory fields and one organisation audit event.
    #[actix_web::test]
    async fn patient_directory_search_has_one_audit_and_no_patient_disclosures() {
        let state = setup_app_state().await;
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
                .insert_header(("x-user-id", "doctor_wallet"))
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
                .insert_header(("x-user-id", "doctor_wallet"))
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
            .pending()
            .into_iter()
            .filter(|event| event.event_type == "patient_directory_search")
            .collect();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].aggregate_type, "organisation");
        assert_eq!(events[0].payload["actor_id"], "doctor_wallet");
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
        let mut patient = state.users.read().unwrap()["doctor_wallet"].clone();
        patient.wallet_address = "patient_wallet".to_string();
        patient.role = Role::Patient;
        state
            .users
            .write()
            .unwrap()
            .insert("patient_wallet".to_string(), patient);
        let app =
            test::init_service(App::new().app_data(state.clone()).service(list_patients)).await;
        let response = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/patients")
                .insert_header(("x-user-id", "patient_wallet"))
                .insert_header(("x-access-reason", "Treatment"))
                .to_request(),
        )
        .await;
        assert_eq!(response.status(), actix_web::http::StatusCode::FORBIDDEN);
        assert!(state.audit_outbox.pending().is_empty());
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
                .insert_header(("x-user-id", "doctor_wallet"))
                .to_request(),
        )
        .await;
        assert_eq!(response.status(), actix_web::http::StatusCode::BAD_REQUEST);
        assert!(state.audit_outbox.pending().is_empty());

        let response = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/patients")
                .insert_header(("x-user-id", "doctor_wallet"))
                .insert_header(("x-access-reason", "Not stated"))
                .to_request(),
        )
        .await;
        assert_eq!(response.status(), actix_web::http::StatusCode::BAD_REQUEST);
        assert!(state.audit_outbox.pending().is_empty());
    }

    /// A failed durable audit blocks the directory response.
    #[actix_web::test]
    async fn directory_audit_storage_failure_returns_503() {
        let seeded = setup_app_state().await;
        let mut state = AppState::new();
        let doctor = seeded.users.read().unwrap()["doctor_wallet"].clone();
        state
            .users
            .write()
            .unwrap()
            .insert("doctor_wallet".to_string(), doctor);
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
                .insert_header(("x-user-id", "doctor_wallet"))
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

        let app_state = setup_app_state().await;
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
                    .insert_header(("x-user-id", "doctor_wallet"))
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

        let app_state = setup_app_state().await;
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
            .insert_header(("x-user-id", "doctor_wallet"))
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
                    .insert_header(("x-user-id", "doctor_wallet"))
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

    /// The wallet is a column on the patient row, not part of the encrypted
    /// profile, and the read served only the profile -- so a wallet bound at
    /// registration read back as absent. A patient without one must read back
    /// as `null`, not as a missing key a client mistakes for the same thing.
    #[actix_rt::test]
    async fn a_wallet_bound_at_registration_is_returned_by_the_patient_read() {
        const WALLET: &str = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
        let app_state = setup_app_state().await;
        let app = test::init_service(
            App::new()
                .app_data(app_state)
                .service(register_patient)
                .service(get_patient_by_id),
        )
        .await;

        let mut with_wallet = registration_payload(7001);
        with_wallet["wallet_address"] = json!(WALLET);
        let mut ids = Vec::new();
        for payload in [with_wallet, registration_payload(7002)] {
            let req = test::TestRequest::post()
                .uri("/api/register")
                .insert_header(("x-user-id", "doctor_wallet"))
                .set_json(payload)
                .to_request();
            let resp = test::call_service(&app, req).await;
            assert!(
                resp.status().is_success(),
                "registration failed: {}",
                resp.status()
            );
            let created: serde_json::Value = test::read_body_json(resp).await;
            ids.push(
                created["patient_id"]
                    .as_str()
                    .expect("patient_id")
                    .to_string(),
            );
        }

        let mut wallets = Vec::new();
        for id in &ids {
            let req = test::TestRequest::get()
                .uri(&format!("/api/patients/{id}"))
                .insert_header(("x-user-id", "doctor_wallet"))
                .to_request();
            let body: serde_json::Value = test::call_and_read_body_json(&app, req).await;
            assert!(
                body.as_object()
                    .is_some_and(|o| o.contains_key("wallet_address")),
                "the read must state the wallet, even when there is none: {body}"
            );
            wallets.push(body["wallet_address"].clone());
        }
        assert_eq!(wallets, vec![json!(WALLET), serde_json::Value::Null]);
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
            .insert_header(("x-user-id", "doctor_wallet"))
            .set_json(&expected)
            .to_request();
        let save_response = test::call_service(&app, save_request).await;
        assert!(save_response.status().is_success());

        let get_request = test::TestRequest::get()
            .uri("/api/settings")
            .insert_header(("x-user-id", "doctor_wallet"))
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
            .insert_header(("x-user-id", "doctor_wallet"))
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
        let app_state = setup_app_state().await;
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(register_patient)
                .service(crate::clinical_endpoints::fhir_get_patient),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/register")
            .insert_header(("x-user-id", "doctor_wallet"))
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
            .insert_header(("x-user-id", "doctor_wallet"))
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

    #[actix_rt::test]
    async fn fhir_condition_and_medication_bundles_are_not_silently_empty() {
        let app_state = setup_app_state().await;
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
            .insert_header(("x-user-id", "doctor_wallet"))
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
            .insert_header(("x-user-id", "doctor_wallet"))
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
            .insert_header(("x-user-id", "doctor_wallet"))
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
            .insert_header(("x-user-id", "doctor_wallet"))
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
        let app_state = setup_app_state().await;
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(register_patient)
                .service(crate::clinical_endpoints::get_medical_id),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/register")
            .insert_header(("x-user-id", "doctor_wallet"))
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
            .insert_header(("x-user-id", "doctor_wallet"))
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
}
