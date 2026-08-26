use super::*;

/// Get all access logs (paginated)
/// Requires authentication: Only healthcare providers can view all logs
/// Query params: ?page=1&limit=20
#[get("/api/access/logs")]
pub async fn get_all_access_logs(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    query: web::Query<PaginationQuery>,
) -> impl Responder {
    // RBAC: Require authentication
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Authentication required to view access logs".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Only healthcare providers can view all access logs
    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can view all access logs".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // Fetch via repository (backend-agnostic)
    // `Pagination::new(page, per_page)`. This used to pass `limit` as the page
    // and an OFFSET as the page size, which made both access-log views return
    // nothing at all under their own defaults: page=1, limit=20 became
    // `Pagination::new(20, 0)`, and `limit()` of 0 means `.take(0)`.
    //
    // The response was the giveaway and nobody read it — `total_items: 54`
    // beside `access_logs: []`. A patient opening their own access log, which
    // is the POPIA transparency control, was told 54 people had touched their
    // record and shown an empty list.
    //
    // `page` is 1-indexed in the query string and 0-indexed in `Pagination`.
    let pagination_req = crate::repositories::traits::Pagination::new(
        query.page.saturating_sub(1) as u32,
        query.limit as u32,
    );
    let result = match data.repositories.access_logs.list(pagination_req).await {
        Ok(r) => r,
        Err(e) => {
            log::error!("Failed to read access logs: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Internal server error".to_string(),
                code: "REPO_ERROR".to_string(),
            });
        }
    };

    let paginated_logs: Vec<AccessLogEntry> = result.items.into_iter().map(Into::into).collect();

    HttpResponse::Ok().json(serde_json::json!({
        "access_logs": paginated_logs,
        "total_accesses": result.total,
        "pagination": {
            "page": result.page,
            "per_page": result.per_page,
            "total_pages": result.total_pages,
            "total_items": result.total,
        },
    }))
}

/// Get access logs for a patient (paginated)
/// Requires authentication: Only healthcare providers and the patient themselves can view logs
/// Query params: ?page=1&limit=20
#[get("/api/access-logs/{patient_id}")]
pub async fn get_access_logs(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<PaginationQuery>,
) -> impl Responder {
    let patient_id = path.into_inner();

    // RBAC: Require authentication
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Authentication required to view access logs".to_string(),
                code: "UNAUTHORIZED".to_string(),
            });
        }
    };

    let current_user = match get_user(&data, &current_user_id) {
        Some(u) => u,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "User not found".to_string(),
                code: "USER_NOT_FOUND".to_string(),
            });
        }
    };

    // Healthcare providers can view any patient's logs
    // Patients can only view their own logs
    let is_own_record = current_user.linked_patient_id.as_ref() == Some(&patient_id)
        || current_user.wallet_address == patient_id;

    if current_user.role == Role::Patient && !is_own_record {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Patients can only view their own access logs".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    // Fetch via repository scoped to this patient
    // `Pagination::new(page, per_page)`. This used to pass `limit` as the page
    // and an OFFSET as the page size, which made both access-log views return
    // nothing at all under their own defaults: page=1, limit=20 became
    // `Pagination::new(20, 0)`, and `limit()` of 0 means `.take(0)`.
    //
    // The response was the giveaway and nobody read it — `total_items: 54`
    // beside `access_logs: []`. A patient opening their own access log, which
    // is the POPIA transparency control, was told 54 people had touched their
    // record and shown an empty list.
    //
    // `page` is 1-indexed in the query string and 0-indexed in `Pagination`.
    let pagination_req = crate::repositories::traits::Pagination::new(
        query.page.saturating_sub(1) as u32,
        query.limit as u32,
    );
    let result = match data
        .repositories
        .access_logs
        .get_by_patient(&patient_id, pagination_req)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            log::error!("Failed to read patient access logs: {}", e);
            return HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Internal server error".to_string(),
                code: "REPO_ERROR".to_string(),
            });
        }
    };

    let paginated_logs: Vec<AccessLogEntry> = result.items.into_iter().map(Into::into).collect();

    HttpResponse::Ok().json(serde_json::json!({
        "patient_id": patient_id,
        "access_logs": paginated_logs,
        "total_accesses": result.total,
        "pagination": {
            "page": result.page,
            "per_page": result.per_page,
            "total_pages": result.total_pages,
            "total_items": result.total,
        },
    }))
}

#[cfg(test)]
mod pagination_tests {
    use super::*;
    use actix_web::{test, App};

    fn patient_user(wallet: &str, patient_id: &str) -> crate::User {
        crate::User {
            wallet_address: wallet.to_string(),
            username: None,
            name: "Log Patient".to_string(),
            role: Role::Patient,
            created_at: chrono::Utc::now(),
            created_by: None,
            linked_patient_id: Some(patient_id.to_string()),
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        }
    }

    async fn state_with_logs(patient_id: &str, count: usize) -> crate::AppState {
        let state = crate::AppState::new();
        state.users.write().unwrap().insert(
            "log_patient".to_string(),
            patient_user("log_patient", patient_id),
        );

        for i in 0..count {
            state
                .repositories
                .access_logs
                .create(
                    crate::AccessLogEntry {
                        access_id: format!("ACC-{i}"),
                        patient_id: patient_id.to_string(),
                        accessor_id: "doctor_x".to_string(),
                        accessor_role: "Doctor".to_string(),
                        access_type: "view".to_string(),
                        location: None,
                        timestamp: chrono::Utc::now(),
                        emergency: false,
                    }
                    .into(),
                )
                .await
                .expect("seed access log");
        }
        state
    }

    /// A patient opening their own access log must actually see it.
    ///
    /// The handler passed `Pagination::new(limit, offset)` to a constructor
    /// whose parameters are `(page, per_page)`. Under the endpoint's own
    /// defaults — page=1, limit=20 — that became `Pagination::new(20, 0)`, and
    /// a page size of 0 means `.take(0)`. The endpoint answered
    /// `total_items: 54` beside `access_logs: []` and had, as far as the
    /// response shows, never returned a row.
    ///
    /// This is the POPIA transparency control: it is how a patient finds out
    /// who has read their record.
    #[actix_web::test]
    async fn a_patient_sees_their_access_log_with_default_parameters() {
        let state = state_with_logs("PAT-LOGS", 5).await;
        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(get_access_logs),
        )
        .await;

        let resp = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/access-logs/PAT-LOGS")
                .insert_header(("x-user-id", "log_patient"))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), 200);

        let body: serde_json::Value = test::read_body_json(resp).await;
        let logs = body["access_logs"]
            .as_array()
            .expect("access_logs should be an array");

        assert_eq!(
            logs.len(),
            5,
            "all five entries fit on the first page; got {body}"
        );
        assert_eq!(body["total_accesses"], 5);

        // The reported page size must be the one that was actually applied. A
        // response claiming 54 items on pages of 1 while returning none is what
        // hid this for so long.
        assert_eq!(body["pagination"]["per_page"], 20);
        assert_eq!(body["pagination"]["page"], 0);
    }

    /// An explicit page still works, and page 2 is not page 20.
    #[actix_web::test]
    async fn explicit_paging_returns_the_requested_slice() {
        let state = state_with_logs("PAT-LOGS2", 7).await;
        let app_state = web::Data::new(state);
        let app = test::init_service(
            App::new()
                .app_data(app_state.clone())
                .service(get_access_logs),
        )
        .await;

        let resp = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/access-logs/PAT-LOGS2?page=2&limit=5")
                .insert_header(("x-user-id", "log_patient"))
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), 200);

        let body: serde_json::Value = test::read_body_json(resp).await;
        let logs = body["access_logs"].as_array().unwrap();
        assert_eq!(logs.len(), 2, "7 items, 5 per page, second page holds 2");
        assert_eq!(body["total_accesses"], 7);
    }
}
