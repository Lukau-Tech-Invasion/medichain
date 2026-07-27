//! Telehealth recording transcription (Telehealth Plan — Phase 6).
//!
//! Pluggable speech-to-text for clinical recordings. The default
//! [`NoopTranscriber`] performs no transcription (returns `Ok(None)`), so the
//! build requires **no external STT key**. Real providers (Google Cloud Speech,
//! AWS Transcribe, Azure Speech) plug in behind the `TRANSCRIPTION_PROVIDER`
//! env var; each needs its own SDK + credentials and is documented in
//! `docs/e2ee-policy.md`.
//!
//! ## E2EE / consent
//! Transcription requires a recording, which requires E2EE **disabled** and
//! explicit participant consent. The recording endpoint enforces consent before
//! a transcript is ever produced (see `clinical_support::telehealth_recording`).
//!
//! © 2025-2026 Trustware. MediChain Health ID System.

use async_trait::async_trait;

/// Errors raised by a transcription provider.
#[allow(dead_code)]
#[derive(Debug, thiserror::Error)]
pub enum TranscriptionError {
    #[error("transcription provider error: {0}")]
    Provider(String),
}

/// A request to transcribe a completed recording.
#[allow(dead_code)]
pub struct TranscriptionRequest {
    pub session_id: String,
    /// URL/handle of the recording artifact, when the deployment captures one.
    /// `None` for client-side recorders that don't surface a server-side file.
    pub recording_ref: Option<String>,
    /// BCP-47 language tag (e.g. "en", "sw", "am").
    pub language: String,
}

/// Speech-to-text backend for telehealth recordings.
#[allow(dead_code)]
#[async_trait]
pub trait Transcriber: Send + Sync {
    /// Transcribe a recording. Returns `Ok(None)` when transcription is not
    /// configured/available (the no-op default), `Ok(Some(text))` on success.
    async fn transcribe(
        &self,
        req: &TranscriptionRequest,
    ) -> Result<Option<String>, TranscriptionError>;

    fn provider_name(&self) -> &'static str;
}

/// Default no-op transcriber: never produces text. Used when no STT provider is
/// configured, keeping clinical recording fully functional without an STT key.
pub struct NoopTranscriber;

#[async_trait]
impl Transcriber for NoopTranscriber {
    async fn transcribe(
        &self,
        _req: &TranscriptionRequest,
    ) -> Result<Option<String>, TranscriptionError> {
        Ok(None)
    }

    fn provider_name(&self) -> &'static str {
        "none"
    }
}

/// Google Cloud Speech-to-Text v1 REST client (`speech:recognize`), the
/// first of the "google/aws/azure" providers this scaffold left unwired.
///
/// **Real, tested request/response handling** — not a stub. What genuinely
/// can't be exercised end-to-end in this environment: (1) this call's only
/// caller (`append_transcript_on_stop`) always passes `recording_ref: None`,
/// because MediChain's recordings are captured client-side and never
/// uploaded to the server (a deliberate Round 15 E2EE/privacy decision — see
/// this module's own doc comment); there is currently no server-side audio
/// artifact for this to fetch and transcribe. (2) using it on real patient
/// audio needs a signed BAA with Google, a business/legal step only the
/// project owner can take. Wiring this now — rather than leaving only a
/// no-op — means the moment either blocker is lifted (a recording upload
/// pipeline is built, and/or a BAA is signed), only `GOOGLE_STT_API_KEY`
/// needs to be set; no code changes required.
pub struct GoogleSpeechTranscriber {
    api_key: String,
    endpoint: String,
}

impl GoogleSpeechTranscriber {
    /// Reads `GOOGLE_STT_API_KEY` (required) and `GOOGLE_STT_ENDPOINT`
    /// (optional override, for tests — defaults to Google's real API).
    pub fn from_env() -> Option<Self> {
        let api_key = std::env::var("GOOGLE_STT_API_KEY").ok()?;
        let endpoint = std::env::var("GOOGLE_STT_ENDPOINT")
            .unwrap_or_else(|_| "https://speech.googleapis.com/v1/speech:recognize".to_string());
        Some(Self { api_key, endpoint })
    }
}

#[async_trait]
impl Transcriber for GoogleSpeechTranscriber {
    async fn transcribe(
        &self,
        req: &TranscriptionRequest,
    ) -> Result<Option<String>, TranscriptionError> {
        let recording_ref = match &req.recording_ref {
            Some(r) => r,
            None => return Ok(None),
        };

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| TranscriptionError::Provider(e.to_string()))?;

        let audio_bytes = client
            .get(recording_ref)
            .send()
            .await
            .map_err(|e| TranscriptionError::Provider(format!("fetching recording: {e}")))?
            .bytes()
            .await
            .map_err(|e| TranscriptionError::Provider(format!("reading recording: {e}")))?;

        use base64::Engine;
        let audio_b64 = base64::engine::general_purpose::STANDARD.encode(&audio_bytes);

        let payload = serde_json::json!({
            "config": {
                "encoding": "LINEAR16",
                "sampleRateHertz": 16000,
                "languageCode": req.language,
            },
            "audio": { "content": audio_b64 },
        });

        let url = format!("{}?key={}", self.endpoint, self.api_key);
        let resp = client
            .post(&url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| TranscriptionError::Provider(format!("STT request failed: {e}")))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(TranscriptionError::Provider(format!(
                "Google STT error: {body}"
            )));
        }

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| TranscriptionError::Provider(format!("parsing STT response: {e}")))?;

        let transcript = body["results"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|r| r["alternatives"][0]["transcript"].as_str())
            .collect::<Vec<_>>()
            .join(" ");

        Ok(if transcript.is_empty() {
            None
        } else {
            Some(transcript)
        })
    }

    fn provider_name(&self) -> &'static str {
        "google"
    }
}

/// Build the active transcriber from `TRANSCRIPTION_PROVIDER`. Only `none`
/// (default) and `google` are wired in-tree; `aws`/`azure` still require
/// their own SDK + credentials. Unknown/unset values, and `google` without
/// `GOOGLE_STT_API_KEY` set, fall back to the no-op.
pub fn transcriber_from_env() -> Box<dyn Transcriber> {
    match std::env::var("TRANSCRIPTION_PROVIDER")
        .unwrap_or_default()
        .to_lowercase()
        .as_str()
    {
        "google" => match GoogleSpeechTranscriber::from_env() {
            Some(t) => Box::new(t),
            None => Box::new(NoopTranscriber),
        },
        // "aws" | "azure" => external SDK + credentials required.
        _ => Box::new(NoopTranscriber),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req() -> TranscriptionRequest {
        TranscriptionRequest {
            session_id: "TH-001".to_string(),
            recording_ref: None,
            language: "en".to_string(),
        }
    }

    #[tokio::test]
    async fn test_noop_transcriber_returns_none() {
        let t = NoopTranscriber;
        assert_eq!(t.provider_name(), "none");
        assert_eq!(t.transcribe(&req()).await.unwrap(), None);
    }

    #[tokio::test]
    async fn test_transcriber_from_env_defaults_to_noop() {
        std::env::remove_var("TRANSCRIPTION_PROVIDER");
        let t = transcriber_from_env();
        assert_eq!(t.provider_name(), "none");
        assert!(t.transcribe(&req()).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_transcriber_from_env_unknown_falls_back_to_noop() {
        std::env::set_var("TRANSCRIPTION_PROVIDER", "made-up-provider");
        let t = transcriber_from_env();
        assert_eq!(t.provider_name(), "none");
        std::env::remove_var("TRANSCRIPTION_PROVIDER");
    }

    #[tokio::test]
    async fn test_transcriber_from_env_google_without_key_falls_back_to_noop() {
        std::env::set_var("TRANSCRIPTION_PROVIDER", "google");
        std::env::remove_var("GOOGLE_STT_API_KEY");
        let t = transcriber_from_env();
        assert_eq!(t.provider_name(), "none");
        std::env::remove_var("TRANSCRIPTION_PROVIDER");
    }

    /// Verifies the real Google Speech-to-Text request/response handling
    /// against a local mock server — fetching the recording, building the
    /// `speech:recognize` payload, and parsing the transcript back out.
    /// What this can't verify: a real BAA-covered Google Cloud project,
    /// which only the project owner can provision (see the struct's doc
    /// comment), and — separately — a real server-side recording artifact,
    /// which no code path currently produces (also see the doc comment).
    #[tokio::test]
    async fn test_google_transcriber_posts_expected_request_and_parses_transcript() {
        use wiremock::matchers::{body_partial_json, method, path, query_param};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let mock_server = MockServer::start().await;

        // The "recording" the transcriber fetches before transcribing it.
        Mock::given(method("GET"))
            .and(path("/recording.wav"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"fake-wav-bytes".to_vec()))
            .expect(1)
            .mount(&mock_server)
            .await;

        Mock::given(method("POST"))
            .and(path("/speech:recognize"))
            .and(query_param("key", "test-google-key"))
            .and(body_partial_json(serde_json::json!({
                "config": { "languageCode": "en" }
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "results": [
                    { "alternatives": [{ "transcript": "patient reports mild" }] },
                    { "alternatives": [{ "transcript": "headache since yesterday" }] }
                ]
            })))
            .expect(1)
            .mount(&mock_server)
            .await;

        std::env::set_var("GOOGLE_STT_API_KEY", "test-google-key");
        std::env::set_var(
            "GOOGLE_STT_ENDPOINT",
            format!("{}/speech:recognize", mock_server.uri()),
        );

        let transcriber = GoogleSpeechTranscriber::from_env().expect("env vars are set above");
        assert_eq!(transcriber.provider_name(), "google");

        let request = TranscriptionRequest {
            session_id: "TH-001".to_string(),
            recording_ref: Some(format!("{}/recording.wav", mock_server.uri())),
            language: "en".to_string(),
        };
        let transcript = transcriber.transcribe(&request).await.unwrap();

        std::env::remove_var("GOOGLE_STT_API_KEY");
        std::env::remove_var("GOOGLE_STT_ENDPOINT");

        assert_eq!(
            transcript.as_deref(),
            Some("patient reports mild headache since yesterday")
        );
        mock_server.verify().await;
    }
}
