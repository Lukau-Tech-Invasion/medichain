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

/// Build the active transcriber from `TRANSCRIPTION_PROVIDER`. Only `none`
/// (default) is wired in-tree; external providers (`google`/`aws`/`azure`)
/// require their own SDK + credentials and are documented in
/// `docs/e2ee-policy.md`. Unknown/unset values fall back to the no-op.
pub fn transcriber_from_env() -> Box<dyn Transcriber> {
    match std::env::var("TRANSCRIPTION_PROVIDER")
        .unwrap_or_default()
        .to_lowercase()
        .as_str()
    {
        // "google" | "aws" | "azure" => external SDK + credentials required.
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
}
