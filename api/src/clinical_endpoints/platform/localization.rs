use super::*;

// ============================================================================
// LOCALIZATION & CONTENT
// ============================================================================

/// Set language preference request
#[derive(Debug, Deserialize)]
pub struct SetLanguagePreferenceRequest {
    pub language_code: String,
    pub region: Option<String>,
}

/// Translate content request
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct TranslateContentRequest {
    pub content: String,
    pub target_language: String,
    pub context: Option<String>,
}

/// Get supported languages for the platform
#[get("/api/platform/languages")]
pub async fn get_supported_languages() -> impl Responder {
    let languages = vec![
        serde_json::json!({"code": "en", "name": "English", "native_name": "English"}),
        serde_json::json!({"code": "sw", "name": "Swahili", "native_name": "Kiswahili"}),
        serde_json::json!({"code": "fr", "name": "French", "native_name": "Français"}),
        serde_json::json!({"code": "am", "name": "Amharic", "native_name": "አማርኛ"}),
        serde_json::json!({"code": "zu", "name": "Zulu", "native_name": "isiZulu"}),
        serde_json::json!({"code": "xh", "name": "Xhosa", "native_name": "isiXhosa"}),
        serde_json::json!({"code": "pt", "name": "Portuguese", "native_name": "Português"}),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "languages": languages
    }))
}

/// Set preferred language for a user
#[post("/api/platform/languages/preference")]
pub async fn set_language_preference(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<SetLanguagePreferenceRequest>,
) -> impl Responder {
    let current_user_id = match get_current_user_id(&http_req) {
        Some(id) => id,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let pref = crate::clinical::LanguagePreference {
        user_id: current_user_id.clone(),
        preferred_language: req.language_code.clone(),
        secondary_language: req.region.clone(),
        reading_proficiency: crate::clinical::LanguageProficiency::Fluent,
        needs_interpreter: false,
        interpreter_language: None,
        updated_at: chrono::Utc::now().timestamp(),
    };

    {
        // Persist via repository
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: current_user_id.clone(),
            owner_id: current_user_id.clone(),
            data: serde_json::to_value(&pref).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        let _ = data.repositories.language_preferences.create(entity).await;
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Language preference updated"
    }))
}

/// Get language preference for a user
///
/// HZ-009: previously took an unused `_http_req` and read `user_id` straight
/// from the path with no authentication or ownership check at all — any
/// caller, authenticated or not, could read any other user's stored language
/// preference. Now requires an authenticated, known caller who is either the
/// subject or an Admin, matching `update_user_profile`'s existing pattern.
#[get("/api/platform/languages/preference/{user_id}")]
pub async fn get_language_preference(
    data: web::Data<crate::AppState>,
    caller: crate::middleware::AuthorizedUser,
    path: web::Path<String>,
) -> impl Responder {
    let user_id = path.into_inner();

    if caller.wallet_address != user_id && !caller.role().is_admin() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            success: false,
            error: "Cannot view another user's language preference".to_string(),
            code: "FORBIDDEN".to_string(),
        });
    }

    let stored = data
        .repositories
        .language_preferences
        .get_by_id(&user_id)
        .await
        .ok()
        .flatten();

    match stored {
        Some(rec) => {
            match serde_json::from_value::<crate::clinical::LanguagePreference>(rec.data) {
                Ok(pref) => HttpResponse::Ok().json(pref),
                Err(_) => HttpResponse::InternalServerError().json(ErrorResponse {
                    success: false,
                    error: "Corrupt language preference".to_string(),
                    code: "INTERNAL_ERROR".to_string(),
                }),
            }
        }
        None => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "Preference not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
    }
}

/// Mock AI: Translate clinical content
///
/// HZ-009 audit: `_http_req`/`_data` are genuinely unused, not an oversight —
/// this is a stateless mock that only echoes/reformats the caller's own
/// request body (no patient/user data read or written), so `not_applicable`.
#[post("/api/platform/translate")]
pub async fn translate_content(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<TranslateContentRequest>,
) -> impl Responder {
    // HZ-019: require a known authenticated caller. This is an unauthenticated
    // compute endpoint that echoes submitted content; in production it would
    // proxy an LLM/translation API, so leaving it open invites resource abuse
    // by anyone. It handles no stored data, so authentication (not per-resource
    // authorization) is the appropriate control.
    let caller = match require_x_user_id_header(&http_req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };
    if let Err(resp) = require_known_user(&data, &caller) {
        return resp;
    }

    // In production, this would call an LLM or translation API
    let translated = format!("[TRANSLATED to {}]: {}", req.target_language, req.content);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "original_content": req.content,
        "translated_content": translated,
        "target_language": req.target_language
    }))
}

#[cfg(test)]
mod hz_009_regression_tests {
    use super::*;
    use actix_web::test;
    use chrono::Utc;

    fn test_user(wallet: &str, role: crate::types::Role) -> crate::types::User {
        crate::types::User {
            wallet_address: wallet.to_string(),
            username: None,
            name: "Test User".to_string(),
            role,
            created_at: Utc::now(),
            created_by: None,
            linked_patient_id: None,
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        }
    }

    /// HZ-009 regression: an unauthenticated caller must no longer read
    /// another user's stored language preference by supplying their user_id
    /// in the path — the original finding was that this endpoint took no
    /// caller identity at all.
    #[actix_web::test]
    async fn unauthenticated_caller_cannot_read_language_preference() {
        let state = crate::AppState::new();
        let app_state = web::Data::new(state);
        let app = actix_web::App::new()
            .app_data(app_state.clone())
            .service(get_language_preference);
        let app = test::init_service(app).await;

        let req = test::TestRequest::get()
            .uri("/api/platform/languages/preference/some-other-user")
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    /// A real, known, but *mismatched* caller must still be refused — the fix
    /// is an ownership check (or admin), not merely "is anyone logged in".
    #[actix_web::test]
    async fn known_but_mismatched_caller_is_forbidden() {
        let state = crate::AppState::new();
        {
            let mut users = state.users.write().unwrap();
            users.insert(
                "requesting_wallet".to_string(),
                test_user("requesting_wallet", crate::types::Role::Patient),
            );
        }
        let app_state = web::Data::new(state);
        let app = actix_web::App::new()
            .app_data(app_state.clone())
            .service(get_language_preference);
        let app = test::init_service(app).await;

        let req = test::TestRequest::get()
            .uri("/api/platform/languages/preference/some-other-user")
            .insert_header(("X-User-Id", "requesting_wallet"))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::FORBIDDEN);
    }

    /// The caller reading their own preference must not be blocked by the fix
    /// (a 404 here, since none is stored, still proves the ownership check
    /// let the request through instead of stopping at 401/403).
    #[actix_web::test]
    async fn caller_reading_their_own_preference_is_not_blocked_by_authz() {
        let state = crate::AppState::new();
        {
            let mut users = state.users.write().unwrap();
            users.insert(
                "self_wallet".to_string(),
                test_user("self_wallet", crate::types::Role::Patient),
            );
        }
        let app_state = web::Data::new(state);
        let app = actix_web::App::new()
            .app_data(app_state.clone())
            .service(get_language_preference);
        let app = test::init_service(app).await;

        let req = test::TestRequest::get()
            .uri("/api/platform/languages/preference/self_wallet")
            .insert_header(("X-User-Id", "self_wallet"))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::NOT_FOUND);
    }
}
