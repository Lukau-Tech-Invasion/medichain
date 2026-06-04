use super::*;

// ----------------------------------------------------------------------------
// Lab Panel Template Endpoints
// ----------------------------------------------------------------------------

/// Get all available lab panel templates
#[get("/api/clinical/lab-panels")]
pub async fn get_lab_panels(data: web::Data<AppState>, http_req: HttpRequest) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
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

    // Healthcare providers can view lab panels
    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can view lab panels".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Standard lab panel templates are static reference data (regenerated each
    // startup from the canonical source; was: seeded data.lab_panels HashMap).
    let panel_list = crate::clinical::get_standard_lab_panels();

    HttpResponse::Ok().json(serde_json::json!({
        "total": panel_list.len(),
        "panels": panel_list
    }))
}

/// Get a specific lab panel template by name
#[get("/api/clinical/lab-panels/{panel_name}")]
pub async fn get_lab_panel(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let panel_name = path.into_inner();

    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
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

    if !current_user.role.is_healthcare_provider() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Only healthcare providers can view lab panels".to_string(),
            code: "INSUFFICIENT_ROLE".to_string(),
        });
    }

    // Standard lab panel templates are static reference data (was: data.lab_panels HashMap).
    match crate::clinical::get_standard_lab_panels()
        .into_iter()
        .find(|p| p.name == panel_name)
    {
        Some(panel) => HttpResponse::Ok().json(panel),
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: format!("Lab panel '{}' not found", panel_name),
            code: "PANEL_NOT_FOUND".to_string(),
        }),
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DeviceRegistrationRequest {
    pub token: String,
    pub device_type: Option<String>,
    pub device_name: Option<String>,
}
