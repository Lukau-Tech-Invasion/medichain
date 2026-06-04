//! API Integration Tests (In-memory/Mock backend)
//! These tests focus on endpoint logic, RBAC, and middleware without requiring a real database.

#[cfg(test)]
mod tests {
    use crate::{
        get_current_user_info, get_patient_by_id, health_check, register_patient, AppState, Role,
        User,
    };
    use actix_web::{test, web, App, HttpResponse};
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
}
