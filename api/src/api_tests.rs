//! API Integration Tests (In-memory/Mock backend)
//! These tests focus on endpoint logic, RBAC, and middleware without requiring a real database.

#[cfg(test)]
mod tests {
    use crate::{
        get_current_user_info, get_patient_by_id, get_settings, health_check, register_patient,
        save_settings, AppState, Role, User,
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
                .service(crate::clinical_endpoints::fhir_get_medications),
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
    }
}
