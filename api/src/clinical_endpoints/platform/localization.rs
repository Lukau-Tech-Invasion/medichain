use super::*;

// ============================================================================
// LOCALIZATION & CONTENT
// ============================================================================

/// Set language preference request
#[derive(Debug, Deserialize)]
pub struct SetLanguagePreferenceRequest {
    /// `LanguageSettingsPage` sends `preferred_language`; `language_code` is
    /// the original spelling and is kept so an existing caller is not broken.
    /// Neither was optional before, and the page sends only the former, so
    /// every save answered `400 missing field language_code` -- silently, since
    /// the page catches the failure and leaves the choice applied locally.
    #[serde(alias = "preferred_language", alias = "preferredLanguage")]
    pub language_code: String,
    #[serde(default, alias = "secondary_language", alias = "secondaryLanguage")]
    pub region: Option<String>,
    /// Asked on the form and, until now, overwritten with `Fluent` and `false`
    /// for everyone. A patient who needs an interpreter is precisely the
    /// patient this record exists to identify.
    #[serde(default, alias = "readingProficiency")]
    pub reading_proficiency: Option<String>,
    #[serde(default, alias = "needsInterpreter")]
    pub needs_interpreter: Option<bool>,
    #[serde(default, alias = "interpreterLanguage")]
    pub interpreter_language: Option<String>,
}

/// Translate content request
#[derive(Debug, Deserialize)]
pub struct TranslateContentRequest {
    pub content: String,
    pub target_language: String,
    pub context: Option<String>,
}

/// The proficiency the form reported, defaulting to `Fluent` only when the
/// question was not answered at all.
fn parse_proficiency(value: Option<&str>) -> crate::clinical::LanguageProficiency {
    use crate::clinical::LanguageProficiency as P;
    match value
        .map(str::trim)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "native" => P::Native,
        "fluent" => P::Fluent,
        "intermediate" | "conversational" => P::Intermediate,
        "basic" => P::Basic,
        "none" => P::None,
        _ => P::Fluent,
    }
}

/// Set preferred language for a user
#[post("/api/platform/languages/preference")]
pub async fn set_language_preference(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<SetLanguagePreferenceRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let pref = crate::clinical::LanguagePreference {
        user_id: current_user_id.clone(),
        preferred_language: req.language_code.clone(),
        secondary_language: req.region.clone(),
        // What the patient answered, not what is convenient to assume.
        reading_proficiency: parse_proficiency(req.reading_proficiency.as_deref()),
        needs_interpreter: req.needs_interpreter.unwrap_or(false),
        interpreter_language: req.interpreter_language.clone(),
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
        // This repository is the record's persistence. Discarding the result
        // returned success for something that was never stored.
        if let Err(error) = data.repositories.language_preferences.create(entity).await {
            log::error!("language_preferences persistence failed: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The language preference could not be saved; please retry.".to_string(),
                code: "LANGUAGE_PREFERENCE_PERSISTENCE_FAILED".to_string(),
            });
        }
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
                    error: "Corrupt language preference".to_string(),
                    code: "INTERNAL_ERROR".to_string(),
                }),
            }
        }
        None => HttpResponse::NotFound().json(ErrorResponse {
            error: "Preference not found".to_string(),
            code: "NOT_FOUND".to_string(),
        }),
    }
}

/// What `POST /api/platform/translate` answers with.
///
/// `machine_translated` and `clinically_verified` are not decoration. A
/// mistranslated dose instruction is a dosing error with a language barrier in
/// front of it, and the patient cannot notice. A screen that renders this must
/// be able to say where the words came from, so the answer carries it.
#[derive(Debug, serde::Serialize)]
pub struct TranslateContentResponse {
    pub success: bool,
    pub original_content: String,
    pub translated_content: String,
    pub target_language: String,
    /// What the provider believed the source language was, when it says.
    pub detected_source_language: Option<String>,
    pub provider: String,
    pub machine_translated: bool,
    /// Always false. Nothing in this system reviews a machine translation, and
    /// a field that could read `true` would eventually be set by something
    /// that had not.
    pub clinically_verified: bool,
}

/// Translate clinical content.
///
/// This used to answer 200 with `[TRANSLATED to fr]: <the original English>` --
/// the submitted content unchanged, wearing a label saying it had been
/// translated -- and then, for the length of this campaign, 503, because
/// refusing beats inventing. It now calls whatever `TRANSLATION_PROVIDER`
/// names; see `services::translation`. Unconfigured is still the 503.
#[post("/api/platform/translate")]
pub async fn translate_content(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<TranslateContentRequest>,
) -> impl Responder {
    // HZ-019: require a known authenticated caller. This endpoint handles no
    // stored data, so authentication rather than per-resource authorization is
    // the appropriate control -- but it now spends money on a third-party API
    // per call, so leaving it open invites billed resource abuse by anyone.
    let caller = match require_x_user_id_header(&http_req) {
        Ok(id) => id,
        Err(resp) => return resp,
    };
    if let Err(resp) = require_known_user(&data, &caller) {
        return resp;
    }

    let translation = crate::services::translation::translate(
        &req.content,
        &req.target_language,
        req.context.as_deref(),
    )
    .await;

    match translation {
        Ok(result) => HttpResponse::Ok().json(TranslateContentResponse {
            success: true,
            original_content: req.content.clone(),
            translated_content: result.translated_text,
            target_language: req.target_language.clone(),
            detected_source_language: result.detected_source_language,
            provider: result.provider.to_string(),
            // Empty content is returned unchanged without reaching a provider,
            // so it is not a machine translation and is not claimed as one.
            machine_translated: result.provider != "none",
            clinically_verified: false,
        }),
        Err(crate::services::translation::TranslationError::NotConfigured) => {
            log::warn!(
                "translation to {} requested with no provider configured",
                req.target_language
            );
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "No translation provider is configured. The content was not translated."
                    .to_string(),
                code: "TRANSLATION_PROVIDER_UNAVAILABLE".to_string(),
            })
        }
        Err(error) => {
            // The provider failed. The submitted content is not logged: it is
            // the clinical text this endpoint exists to keep out of logs.
            log::warn!("translation provider failed: {error}");
            HttpResponse::BadGateway().json(ErrorResponse {
                error:
                    "The translation provider could not be reached. The content was not translated."
                        .to_string(),
                code: "TRANSLATION_PROVIDER_ERROR".to_string(),
            })
        }
    }
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

#[cfg(test)]
mod translation_endpoint_tests {
    use super::*;
    use actix_web::test;
    use chrono::Utc;

    /// `TRANSLATION_PROVIDER` and friends are process-global, and one of these
    /// tests needs them unset while another needs them set. Async, so it can be
    /// held across the awaits these tests are made of.
    static TRANSLATION_ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    fn caller_state(wallet: &str) -> crate::AppState {
        let state = crate::AppState::new();
        {
            let mut users = state.users.write().unwrap();
            users.insert(
                wallet.to_string(),
                crate::types::User {
                    wallet_address: wallet.to_string(),
                    username: None,
                    name: "Test User".to_string(),
                    role: crate::types::Role::Doctor,
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
                },
            );
        }
        state
    }

    fn clear_translation_env() {
        std::env::remove_var("TRANSLATION_PROVIDER");
        std::env::remove_var("GOOGLE_TRANSLATE_API_KEY");
        std::env::remove_var("GOOGLE_TRANSLATE_ENDPOINT");
    }

    fn translate_request(wallet: Option<&str>) -> test::TestRequest {
        let mut req = test::TestRequest::post()
            .uri("/api/platform/translate")
            .set_json(serde_json::json!({
                "content": "Take one tablet daily",
                "target_language": "fr"
            }));
        if let Some(wallet) = wallet {
            req = req.insert_header(("X-User-Id", wallet));
        }
        req
    }

    /// It bills a third-party API per call, so an anonymous caller must not
    /// reach it.
    #[actix_web::test]
    async fn an_unauthenticated_caller_cannot_spend_the_translation_budget() {
        let app = test::init_service(
            actix_web::App::new()
                .app_data(web::Data::new(crate::AppState::new()))
                .service(translate_content),
        )
        .await;

        let resp = test::call_service(&app, translate_request(None).to_request()).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    /// The defect this endpoint shipped with: 200, with the submitted English
    /// as `translated_content` and a label saying it was French. With no
    /// provider it must refuse, and the untranslated content must not come back
    /// anywhere in the answer.
    #[actix_web::test]
    async fn with_no_provider_the_content_does_not_come_back_labelled_as_translated() {
        let _environment_guard = TRANSLATION_ENV_LOCK.lock().await;
        clear_translation_env();

        let app = test::init_service(
            actix_web::App::new()
                .app_data(web::Data::new(caller_state("doctor_wallet")))
                .service(translate_content),
        )
        .await;

        let resp =
            test::call_service(&app, translate_request(Some("doctor_wallet")).to_request()).await;
        assert_eq!(
            resp.status(),
            actix_web::http::StatusCode::SERVICE_UNAVAILABLE
        );

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["error"]["code"], "TRANSLATION_PROVIDER_UNAVAILABLE");
        assert!(
            !body.to_string().contains("Take one tablet daily"),
            "the untranslated content was returned: {body}"
        );
    }

    /// The whole provider path, over a real socket: a stand-in for the Google
    /// v2 API bound on a loopback port, reached by the same `reqwest` call a
    /// deployment would make. Parsing a response in isolation proves the shape;
    /// this proves the request is actually sent and the answer reaches the
    /// caller.
    #[actix_web::test]
    async fn a_configured_provider_translates_and_says_it_was_a_machine() {
        let _environment_guard = TRANSLATION_ENV_LOCK.lock().await;
        clear_translation_env();

        async fn fake_google(body: web::Json<serde_json::Value>) -> HttpResponse {
            // Assert the shape the real API requires, so a change to the
            // request fails here rather than in production.
            assert_eq!(body["q"], "Take one tablet daily");
            assert_eq!(body["target"], "fr");
            HttpResponse::Ok().json(serde_json::json!({
                "data": { "translations": [{
                    "translatedText": "Prenez un comprimé par jour",
                    "detectedSourceLanguage": "en"
                }]}
            }))
        }

        let provider = actix_web::HttpServer::new(|| {
            actix_web::App::new().route("/v2", web::post().to(fake_google))
        })
        .bind(("127.0.0.1", 0))
        .expect("bind a loopback port");
        let port = provider.addrs()[0].port();
        let provider = provider.run();
        let provider_handle = provider.handle();
        tokio::spawn(provider);

        std::env::set_var("TRANSLATION_PROVIDER", "google");
        std::env::set_var("GOOGLE_TRANSLATE_API_KEY", "test-key");
        std::env::set_var(
            "GOOGLE_TRANSLATE_ENDPOINT",
            format!("http://127.0.0.1:{port}/v2"),
        );

        let app = test::init_service(
            actix_web::App::new()
                .app_data(web::Data::new(caller_state("doctor_wallet")))
                .service(translate_content),
        )
        .await;

        let resp =
            test::call_service(&app, translate_request(Some("doctor_wallet")).to_request()).await;
        let status = resp.status();
        let body: serde_json::Value = test::read_body_json(resp).await;

        clear_translation_env();
        provider_handle.stop(true).await;

        assert_eq!(status, actix_web::http::StatusCode::OK, "{body}");
        assert_eq!(body["translated_content"], "Prenez un comprimé par jour");
        assert_eq!(body["detected_source_language"], "en");
        assert_eq!(body["provider"], "google");
        // A screen rendering this has to be able to say where the words came
        // from. Neither flag is decoration.
        assert_eq!(body["machine_translated"], true);
        assert_eq!(body["clinically_verified"], false);
    }

    /// A provider that is configured but cannot be reached is a 502, not a 200
    /// carrying the original text.
    #[actix_web::test]
    async fn an_unreachable_provider_is_an_error_not_an_echo() {
        let _environment_guard = TRANSLATION_ENV_LOCK.lock().await;
        clear_translation_env();
        std::env::set_var("TRANSLATION_PROVIDER", "google");
        std::env::set_var("GOOGLE_TRANSLATE_API_KEY", "test-key");
        // Port 1 on loopback: nothing listens there.
        std::env::set_var("GOOGLE_TRANSLATE_ENDPOINT", "http://127.0.0.1:1/v2");

        let app = test::init_service(
            actix_web::App::new()
                .app_data(web::Data::new(caller_state("doctor_wallet")))
                .service(translate_content),
        )
        .await;

        let resp =
            test::call_service(&app, translate_request(Some("doctor_wallet")).to_request()).await;
        let status = resp.status();
        let body: serde_json::Value = test::read_body_json(resp).await;

        clear_translation_env();

        assert_eq!(status, actix_web::http::StatusCode::BAD_GATEWAY);
        assert_eq!(body["error"]["code"], "TRANSLATION_PROVIDER_ERROR");
        assert!(
            !body.to_string().contains("Take one tablet daily"),
            "the untranslated content was returned: {body}"
        );
    }
}
