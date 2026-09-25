//! Translation providers.
//!
//! `POST /api/platform/translate` used to answer 200 with
//! `[TRANSLATED to fr]: <the original English>` — the submitted content
//! unchanged, wearing a label saying it had been translated. It was made to
//! return `503 TRANSLATION_PROVIDER_UNAVAILABLE` earlier in this campaign,
//! which is honest but is not a feature. This makes the path able to succeed.
//!
//! Selected with `TRANSLATION_PROVIDER`, the same shape as
//! `TELEHEALTH_PROVIDER`: `none` (the default) keeps the 503, `google` calls
//! Google Cloud Translation v2 with `GOOGLE_TRANSLATE_API_KEY`.
//!
//! # Machine translation of clinical content is not a neutral act
//!
//! A mistranslated dose instruction is a dosing error with a language barrier
//! in front of it, and the patient has no way to notice. So every translation
//! this module returns is reported as machine-translated and not clinically
//! verified, and the endpoint passes that to the caller rather than leaving a
//! screen to present the output as if a person had written it. Whether to
//! *show* machine-translated medication instructions to a patient is a
//! clinical governance decision; this module makes the provenance impossible
//! to lose, not the decision.

use serde::{Deserialize, Serialize};

/// What a provider gives back.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Translation {
    pub translated_text: String,
    /// The language the provider believed the source was, when it says.
    pub detected_source_language: Option<String>,
    pub provider: &'static str,
}

#[derive(Debug, thiserror::Error)]
pub enum TranslationError {
    #[error("no translation provider is configured")]
    NotConfigured,
    #[error("translation provider error: {0}")]
    Provider(String),
}

/// Which provider this deployment uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranslationProvider {
    None,
    Google,
}

/// Read the configured provider.
///
/// Unknown values resolve to `None` rather than to a default provider: a typo
/// in `TRANSLATION_PROVIDER` must not silently start sending patient content to
/// a third party.
pub fn configured_provider() -> TranslationProvider {
    match std::env::var("TRANSLATION_PROVIDER")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "google" => TranslationProvider::Google,
        "" | "none" => TranslationProvider::None,
        other => {
            log::warn!(
                "TRANSLATION_PROVIDER is {other:?}, which this build does not support; \
                 translation is disabled"
            );
            TranslationProvider::None
        }
    }
}

/// Translate one string using whichever provider this deployment configured.
pub async fn translate(
    content: &str,
    target_language: &str,
    context: Option<&str>,
) -> Result<Translation, TranslationError> {
    translate_with(configured_provider(), content, target_language, context).await
}

/// Translate one string with a named provider.
///
/// The provider is a parameter rather than read from the environment here so
/// the behaviour can be tested without a process-global variable — the async
/// tests would otherwise have to hold a lock across an await.
///
/// `context` is passed to the provider where the provider can use it — a
/// translator needs to know whether a string is a medication instruction or a
/// button label — and is otherwise ignored rather than concatenated into the
/// content, which would translate the context along with the text.
pub async fn translate_with(
    provider: TranslationProvider,
    content: &str,
    target_language: &str,
    context: Option<&str>,
) -> Result<Translation, TranslationError> {
    if content.trim().is_empty() {
        // Nothing to translate is not an error, and round-tripping an empty
        // string through a paid API is pointless.
        return Ok(Translation {
            translated_text: String::new(),
            detected_source_language: None,
            provider: "none",
        });
    }

    match provider {
        TranslationProvider::None => Err(TranslationError::NotConfigured),
        TranslationProvider::Google => {
            translate_with_google(content, target_language, context).await
        }
    }
}

/// Google Cloud Translation v2.
///
/// v2 rather than v3 because v2 authenticates with a plain API key, and v3
/// requires a service-account OAuth flow plus a project and location in the
/// path. The v2 endpoint is the one a deployment can turn on with one secret.
async fn translate_with_google(
    content: &str,
    target_language: &str,
    _context: Option<&str>,
) -> Result<Translation, TranslationError> {
    let key = std::env::var("GOOGLE_TRANSLATE_API_KEY")
        .ok()
        .filter(|k| !k.trim().is_empty())
        .ok_or_else(|| {
            TranslationError::Provider(
                "TRANSLATION_PROVIDER=google but GOOGLE_TRANSLATE_API_KEY is not set".to_string(),
            )
        })?;

    let endpoint = std::env::var("GOOGLE_TRANSLATE_ENDPOINT")
        .unwrap_or_else(|_| "https://translation.googleapis.com/language/translate/v2".to_string());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| TranslationError::Provider(e.to_string()))?;

    // The key goes in the query string because that is what this API accepts;
    // the content goes in the body so it is not written into proxy and access
    // logs along the way. Patient content in a URL is its own disclosure.
    let response = client
        .post(&endpoint)
        .query(&[("key", key.as_str())])
        .json(&serde_json::json!({
            "q": content,
            "target": target_language,
            "format": "text",
        }))
        .send()
        .await
        .map_err(|e| TranslationError::Provider(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        // The provider's error body may echo the submitted content, so it is
        // neither logged nor returned; the status is enough to act on.
        return Err(TranslationError::Provider(format!(
            "translation provider answered {status}"
        )));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| TranslationError::Provider(e.to_string()))?;

    parse_google_response(&body)
}

/// Pull the translation out of a v2 response.
///
/// Split out so the shape can be tested without a network call or a key.
pub fn parse_google_response(body: &serde_json::Value) -> Result<Translation, TranslationError> {
    let first = body
        .get("data")
        .and_then(|d| d.get("translations"))
        .and_then(|t| t.as_array())
        .and_then(|t| t.first())
        .ok_or_else(|| {
            TranslationError::Provider("provider response had no translations".to_string())
        })?;

    let translated_text = first
        .get("translatedText")
        .and_then(|t| t.as_str())
        .ok_or_else(|| {
            TranslationError::Provider("provider response had no translatedText".to_string())
        })?
        .to_string();

    Ok(Translation {
        translated_text,
        detected_source_language: first
            .get("detectedSourceLanguage")
            .and_then(|l| l.as_str())
            .map(str::to_string),
        provider: "google",
    })
}

#[cfg(test)]
mod translation_tests {
    use super::*;

    /// Serialised: `configured_provider` reads a process-global variable and
    /// the whole suite shares one process.
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn with_provider<T>(value: Option<&str>, body: impl FnOnce() -> T) -> T {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let previous = std::env::var("TRANSLATION_PROVIDER").ok();
        match value {
            Some(v) => std::env::set_var("TRANSLATION_PROVIDER", v),
            None => std::env::remove_var("TRANSLATION_PROVIDER"),
        }
        let outcome = body();
        match previous {
            Some(v) => std::env::set_var("TRANSLATION_PROVIDER", v),
            None => std::env::remove_var("TRANSLATION_PROVIDER"),
        }
        outcome
    }

    #[test]
    fn unset_means_no_provider() {
        with_provider(None, || {
            assert_eq!(configured_provider(), TranslationProvider::None);
        });
    }

    #[test]
    fn a_typo_disables_translation_rather_than_picking_one() {
        // A misspelled provider must not silently start sending patient content
        // to a third party.
        with_provider(Some("gooogle"), || {
            assert_eq!(configured_provider(), TranslationProvider::None);
        });
    }

    #[test]
    fn google_is_selected_case_insensitively() {
        with_provider(Some("  Google "), || {
            assert_eq!(configured_provider(), TranslationProvider::Google);
        });
    }

    #[tokio::test]
    async fn an_unconfigured_provider_refuses_rather_than_echoing() {
        // The defect this endpoint shipped with: the submitted English came
        // back labelled as the target language.
        let outcome = translate_with(
            TranslationProvider::None,
            "Take one tablet daily",
            "fr",
            None,
        )
        .await;
        assert!(matches!(outcome, Err(TranslationError::NotConfigured)));
    }

    #[tokio::test]
    async fn empty_content_needs_no_provider() {
        let translation = translate_with(TranslationProvider::None, "   ", "fr", None)
            .await
            .expect("empty content needs no provider");
        assert_eq!(translation.translated_text, "");
    }

    #[test]
    fn a_google_response_is_parsed() {
        let body = serde_json::json!({
            "data": { "translations": [{
                "translatedText": "Prenez un comprimé par jour",
                "detectedSourceLanguage": "en"
            }]}
        });
        let translation = parse_google_response(&body).expect("parsed");
        assert_eq!(translation.translated_text, "Prenez un comprimé par jour");
        assert_eq!(translation.detected_source_language.as_deref(), Some("en"));
        assert_eq!(translation.provider, "google");
    }

    #[test]
    fn a_response_without_a_translation_is_an_error_not_an_empty_string() {
        // Returning "" here would hand the caller a blank medication
        // instruction wearing a "translated" label.
        let body = serde_json::json!({ "data": { "translations": [] } });
        assert!(parse_google_response(&body).is_err());
        assert!(parse_google_response(&serde_json::json!({})).is_err());
        assert!(parse_google_response(&serde_json::json!({
            "data": { "translations": [{ "detectedSourceLanguage": "en" }] }
        }))
        .is_err());
    }
}
