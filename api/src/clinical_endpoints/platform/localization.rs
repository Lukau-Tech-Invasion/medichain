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
#[get("/api/platform/languages/preference/{user_id}")]
pub async fn get_language_preference(
    data: web::Data<crate::AppState>,
    _http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let user_id = path.into_inner();

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
#[post("/api/platform/translate")]
pub async fn translate_content(
    _data: web::Data<crate::AppState>,
    _http_req: HttpRequest,
    req: web::Json<TranslateContentRequest>,
) -> impl Responder {
    // In production, this would call an LLM or translation API
    let translated = format!("[TRANSLATED to {}]: {}", req.target_language, req.content);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "original_content": req.content,
        "translated_content": translated,
        "target_language": req.target_language
    }))
}
