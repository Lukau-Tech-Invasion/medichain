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
    let pagination_req = crate::repositories::traits::Pagination::new(
        query.limit as u32,
        ((query.page.saturating_sub(1)) * query.limit) as u32,
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
    let pagination_req = crate::repositories::traits::Pagination::new(
        query.limit as u32,
        ((query.page.saturating_sub(1)) * query.limit) as u32,
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
