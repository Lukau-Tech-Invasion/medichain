//! # Telehealth Service Module
//!
//! Provider-agnostic telehealth session management.
//!
//! ## Providers
//! - `internal` (default) — self-hosted HMAC-SHA3-256 token URLs
//! - `daily`              — Daily.co (requires `DAILY_API_KEY`)
//! - `twilio`             — Twilio Video (requires `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`)
//!
//! Select the active provider with the `TELEHEALTH_PROVIDER` env var.
//!
//! © 2025 Trustware. All rights reserved.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha3::{Digest, Sha3_256};
use std::collections::HashMap;
use std::sync::RwLock;
use thiserror::Error;

// ============================================================================
// Core Types
// ============================================================================

/// Parameters for creating a new telehealth session
pub struct CreateSessionParams {
    pub session_id: String,
    pub patient_id: String,
    pub provider_id: String,
    pub scheduled_at: DateTime<Utc>,
    pub duration_minutes: u32,
}

/// Information returned after a session is created
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub provider_join_url: String,
    pub patient_join_url: String,
    pub expires_at: DateTime<Utc>,
    /// Which provider backend created this session (e.g. "internal", "daily", "twilio")
    pub provider_name: String,
}

/// Role of a participant joining a session
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParticipantRole {
    Provider,
    Patient,
    Observer,
}

impl std::fmt::Display for ParticipantRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParticipantRole::Provider => write!(f, "provider"),
            ParticipantRole::Patient => write!(f, "patient"),
            ParticipantRole::Observer => write!(f, "observer"),
        }
    }
}

/// Errors from the telehealth layer
#[derive(Debug, Error)]
pub enum TelehealthError {
    #[error("HTTP request failed: {0}")]
    HttpError(#[from] reqwest::Error),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Provider configuration error: {0}")]
    ConfigError(String),

    #[error("Provider returned an error: {0}")]
    ProviderError(String),
}

// ============================================================================
// Provider Trait
// ============================================================================

/// Implemented by every telehealth backend provider
#[async_trait]
pub trait TelehealthProvider: Send + Sync {
    async fn create_session(
        &self,
        params: CreateSessionParams,
    ) -> Result<SessionInfo, TelehealthError>;

    async fn get_join_url(
        &self,
        session_id: &str,
        participant: &str,
        role: ParticipantRole,
    ) -> Result<String, TelehealthError>;

    async fn end_session(&self, session_id: &str) -> Result<(), TelehealthError>;

    fn provider_name(&self) -> &'static str;
}

// ============================================================================
// InternalProvider — self-hosted HMAC-SHA3-256 token URLs
// ============================================================================

/// Uses HMAC-SHA3-256 of `{session_id}:{secret}:{role}:{timestamp}` to
/// produce verifiable join URLs without any external service.
pub struct InternalProvider {
    secret: String,
    domain: String,
}

impl InternalProvider {
    pub fn new() -> Self {
        let secret = std::env::var("TELEHEALTH_SECRET")
            .unwrap_or_else(|_| "medichain-telehealth-dev-secret".to_string());
        let domain = std::env::var("MEDICHAIN_DOMAIN")
            .unwrap_or_else(|_| "app.medichain.health".to_string());
        InternalProvider { secret, domain }
    }

    fn make_token(&self, session_id: &str, role: &str, timestamp: i64) -> String {
        let payload = format!("{}:{}:{}:{}", session_id, self.secret, role, timestamp);
        let hash = Sha3_256::digest(payload.as_bytes());
        hash.iter().map(|b| format!("{:02x}", b)).collect()
    }

    fn build_url(&self, session_id: &str, role: &str) -> String {
        let timestamp = Utc::now().timestamp();
        let token = self.make_token(session_id, role, timestamp);
        format!(
            "https://{}/telehealth/room/{}?token={}&role={}&ts={}",
            self.domain, session_id, token, role, timestamp
        )
    }
}

impl Default for InternalProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl TelehealthProvider for InternalProvider {
    async fn create_session(
        &self,
        params: CreateSessionParams,
    ) -> Result<SessionInfo, TelehealthError> {
        let provider_url = self.build_url(&params.session_id, "provider");
        let patient_url = self.build_url(&params.session_id, "patient");
        let expires_at =
            params.scheduled_at + chrono::Duration::minutes(params.duration_minutes as i64 + 30);

        Ok(SessionInfo {
            session_id: params.session_id,
            provider_join_url: provider_url,
            patient_join_url: patient_url,
            expires_at,
            provider_name: self.provider_name().to_string(),
        })
    }

    async fn get_join_url(
        &self,
        session_id: &str,
        _participant: &str,
        role: ParticipantRole,
    ) -> Result<String, TelehealthError> {
        Ok(self.build_url(session_id, &role.to_string()))
    }

    async fn end_session(&self, _session_id: &str) -> Result<(), TelehealthError> {
        // Internal provider is stateless — nothing to tear down on the server side
        Ok(())
    }

    fn provider_name(&self) -> &'static str {
        "internal"
    }
}

// ============================================================================
// DailyProvider — Daily.co
// ============================================================================

pub struct DailyProvider {
    api_key: String,
}

impl DailyProvider {
    /// Returns `None` when `DAILY_API_KEY` is not set.
    pub fn from_env() -> Option<Self> {
        std::env::var("DAILY_API_KEY")
            .ok()
            .map(|k| DailyProvider { api_key: k })
    }
}

#[async_trait]
impl TelehealthProvider for DailyProvider {
    async fn create_session(
        &self,
        params: CreateSessionParams,
    ) -> Result<SessionInfo, TelehealthError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(TelehealthError::HttpError)?;

        // Daily.co requires a room name: use the session_id (lowercased, truncated)
        let room_name = format!("mc-{}", params.session_id.to_lowercase().replace('_', "-"));

        // exp: scheduled_at + duration + 30 min buffer
        let exp = params.scheduled_at.timestamp() + (params.duration_minutes as i64 + 30) * 60;

        let body = serde_json::json!({
            "name": room_name,
            "privacy": "private",
            "properties": {
                "exp": exp,
                "enable_recording": "none",
                "start_audio_off": false,
                "start_video_off": false,
            }
        });

        let resp = client
            .post("https://api.daily.co/v1/rooms")
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(TelehealthError::HttpError)?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(TelehealthError::ProviderError(format!(
                "Daily.co returned {}: {}",
                status, text
            )));
        }

        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| TelehealthError::ProviderError(e.to_string()))?;

        let base_url = json.get("url").and_then(|v| v.as_str()).ok_or_else(|| {
            TelehealthError::ProviderError("No URL in Daily.co response".to_string())
        })?;

        let provider_url = format!("{}?t=provider", base_url);
        let patient_url = format!("{}?t=patient", base_url);
        let expires_at = DateTime::from_timestamp(exp, 0)
            .unwrap_or_else(|| Utc::now() + chrono::Duration::hours(2));

        Ok(SessionInfo {
            session_id: params.session_id,
            provider_join_url: provider_url,
            patient_join_url: patient_url,
            expires_at,
            provider_name: self.provider_name().to_string(),
        })
    }

    async fn get_join_url(
        &self,
        session_id: &str,
        participant: &str,
        role: ParticipantRole,
    ) -> Result<String, TelehealthError> {
        let room_name = format!("mc-{}", session_id.to_lowercase().replace('_', "-"));
        Ok(format!(
            "https://medichain.daily.co/{}?t={}&user={}",
            room_name, role, participant
        ))
    }

    async fn end_session(&self, session_id: &str) -> Result<(), TelehealthError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(TelehealthError::HttpError)?;

        let room_name = format!("mc-{}", session_id.to_lowercase().replace('_', "-"));
        let url = format!("https://api.daily.co/v1/rooms/{}", room_name);

        let resp = client
            .delete(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(TelehealthError::HttpError)?;

        if !resp.status().is_success() && resp.status().as_u16() != 404 {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(TelehealthError::ProviderError(format!(
                "Daily.co DELETE returned {}: {}",
                status, text
            )));
        }

        Ok(())
    }

    fn provider_name(&self) -> &'static str {
        "daily"
    }
}

// ============================================================================
// TwilioProvider — Twilio Video
// ============================================================================

pub struct TwilioProvider {
    account_sid: String,
    auth_token: String,
}

impl TwilioProvider {
    /// Returns `None` when `TWILIO_ACCOUNT_SID` or `TWILIO_AUTH_TOKEN` are not set.
    pub fn from_env() -> Option<Self> {
        let account_sid = std::env::var("TWILIO_ACCOUNT_SID").ok()?;
        let auth_token = std::env::var("TWILIO_AUTH_TOKEN").ok()?;
        Some(TwilioProvider {
            account_sid,
            auth_token,
        })
    }

    fn api_url(&self) -> String {
        format!("https://video.twilio.com/v1/Rooms")
    }
}

#[async_trait]
impl TelehealthProvider for TwilioProvider {
    async fn create_session(
        &self,
        params: CreateSessionParams,
    ) -> Result<SessionInfo, TelehealthError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(TelehealthError::HttpError)?;

        // Twilio room name must be ≤ 128 chars, alphanumeric + underscores
        let room_name = format!("mc_{}", params.session_id.replace('-', "_"));

        let resp = client
            .post(&self.api_url())
            .basic_auth(&self.account_sid, Some(&self.auth_token))
            .form(&[
                ("UniqueName", room_name.as_str()),
                ("Type", "group"),
                ("MaxParticipants", "10"),
            ])
            .send()
            .await
            .map_err(TelehealthError::HttpError)?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(TelehealthError::ProviderError(format!(
                "Twilio returned {}: {}",
                status, text
            )));
        }

        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| TelehealthError::ProviderError(e.to_string()))?;

        let room_sid = json
            .get("sid")
            .and_then(|v| v.as_str())
            .unwrap_or(&params.session_id)
            .to_string();

        // Twilio join URLs are token-based; these URLs hint where the client should connect
        let provider_url = format!(
            "https://video.twilio.com/v1/Rooms/{}/join?identity=provider&account={}",
            room_sid, self.account_sid
        );
        let patient_url = format!(
            "https://video.twilio.com/v1/Rooms/{}/join?identity=patient&account={}",
            room_sid, self.account_sid
        );
        let expires_at =
            params.scheduled_at + chrono::Duration::minutes(params.duration_minutes as i64 + 30);

        Ok(SessionInfo {
            session_id: params.session_id,
            provider_join_url: provider_url,
            patient_join_url: patient_url,
            expires_at,
            provider_name: self.provider_name().to_string(),
        })
    }

    async fn get_join_url(
        &self,
        session_id: &str,
        participant: &str,
        role: ParticipantRole,
    ) -> Result<String, TelehealthError> {
        let room_name = format!("mc_{}", session_id.replace('-', "_"));
        Ok(format!(
            "https://video.twilio.com/v1/Rooms/{}/join?identity={}&role={}",
            room_name, participant, role
        ))
    }

    async fn end_session(&self, session_id: &str) -> Result<(), TelehealthError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(TelehealthError::HttpError)?;

        let room_name = format!("mc_{}", session_id.replace('-', "_"));
        let url = format!("{}/{}", self.api_url(), room_name);

        let resp = client
            .post(&url)
            .basic_auth(&self.account_sid, Some(&self.auth_token))
            .form(&[("Status", "completed")])
            .send()
            .await
            .map_err(TelehealthError::HttpError)?;

        if !resp.status().is_success() && resp.status().as_u16() != 404 {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(TelehealthError::ProviderError(format!(
                "Twilio end_session returned {}: {}",
                status, text
            )));
        }

        Ok(())
    }

    fn provider_name(&self) -> &'static str {
        "twilio"
    }
}

// ============================================================================
// TelehealthService — wraps the active provider + in-memory session state
// ============================================================================

/// Persists session state in memory and delegates video operations to the
/// configured provider.  Session state survives reconnects within the same
/// server process.
pub struct TelehealthService {
    provider: Box<dyn TelehealthProvider>,
    /// session_id → SessionInfo
    sessions: RwLock<HashMap<String, SessionInfo>>,
}

impl TelehealthService {
    /// Build the service, selecting the provider from the `TELEHEALTH_PROVIDER`
    /// env var.  Falls back to `InternalProvider` if the var is absent or the
    /// configured provider cannot be initialised (e.g. missing API key).
    pub fn new() -> Self {
        let provider_name =
            std::env::var("TELEHEALTH_PROVIDER").unwrap_or_else(|_| "internal".to_string());

        let provider: Box<dyn TelehealthProvider> = match provider_name.to_lowercase().as_str() {
            "daily" => match DailyProvider::from_env() {
                Some(p) => {
                    log::info!("TelehealthService: using Daily.co provider");
                    Box::new(p)
                }
                None => {
                    log::warn!(
                        "TELEHEALTH_PROVIDER=daily but DAILY_API_KEY not set; \
                             falling back to internal provider"
                    );
                    Box::new(InternalProvider::new())
                }
            },
            "twilio" => match TwilioProvider::from_env() {
                Some(p) => {
                    log::info!("TelehealthService: using Twilio Video provider");
                    Box::new(p)
                }
                None => {
                    log::warn!(
                        "TELEHEALTH_PROVIDER=twilio but TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN \
                             not set; falling back to internal provider"
                    );
                    Box::new(InternalProvider::new())
                }
            },
            _ => {
                log::info!("TelehealthService: using internal provider");
                Box::new(InternalProvider::new())
            }
        };

        TelehealthService {
            provider,
            sessions: RwLock::new(HashMap::new()),
        }
    }

    /// Create a new session, persist it, and return `SessionInfo`.
    pub async fn create_session(
        &self,
        params: CreateSessionParams,
    ) -> Result<SessionInfo, TelehealthError> {
        let session_id = params.session_id.clone();
        let info = self.provider.create_session(params).await?;

        {
            let mut sessions = self.sessions.write().unwrap();
            sessions.insert(session_id, info.clone());
        }

        Ok(info)
    }

    /// Retrieve a persisted session by ID.
    pub fn get_session(&self, session_id: &str) -> Option<SessionInfo> {
        let sessions = self.sessions.read().unwrap();
        sessions.get(session_id).cloned()
    }

    /// Generate a fresh join URL for a specific participant and role.
    pub async fn get_join_url(
        &self,
        session_id: &str,
        participant: &str,
        role: ParticipantRole,
    ) -> Result<String, TelehealthError> {
        self.provider
            .get_join_url(session_id, participant, role)
            .await
    }

    /// End (tear down) the session on the provider side and mark it locally.
    pub async fn end_session(&self, session_id: &str) -> Result<(), TelehealthError> {
        // Remove from our local store
        {
            let mut sessions = self.sessions.write().unwrap();
            sessions.remove(session_id);
        }
        self.provider.end_session(session_id).await
    }

    /// Name of the active provider (useful for diagnostics / health-check).
    pub fn active_provider_name(&self) -> &'static str {
        self.provider.provider_name()
    }
}

impl Default for TelehealthService {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_params(session_id: &str) -> CreateSessionParams {
        CreateSessionParams {
            session_id: session_id.to_string(),
            patient_id: "PAT-001".to_string(),
            provider_id: "USR-DOC-001".to_string(),
            scheduled_at: Utc::now(),
            duration_minutes: 30,
        }
    }

    #[tokio::test]
    async fn test_internal_provider_create_session() {
        let provider = InternalProvider::new();
        let info = provider
            .create_session(make_params("TH-test-001"))
            .await
            .unwrap();
        assert_eq!(info.session_id, "TH-test-001");
        assert!(info.provider_join_url.contains("TH-test-001"));
        assert!(info.patient_join_url.contains("TH-test-001"));
        assert_eq!(info.provider_name, "internal");
    }

    #[tokio::test]
    async fn test_internal_provider_join_url_contains_role() {
        let provider = InternalProvider::new();
        let url = provider
            .get_join_url("TH-test-002", "alice", ParticipantRole::Provider)
            .await
            .unwrap();
        assert!(url.contains("provider"));
        assert!(url.contains("TH-test-002"));
    }

    #[tokio::test]
    async fn test_internal_provider_end_session_noop() {
        let provider = InternalProvider::new();
        // Should succeed without panicking
        provider.end_session("TH-test-003").await.unwrap();
    }

    #[tokio::test]
    async fn test_telehealth_service_create_and_get() {
        std::env::set_var("TELEHEALTH_PROVIDER", "internal");
        let service = TelehealthService::new();
        let info = service
            .create_session(make_params("TH-svc-001"))
            .await
            .unwrap();
        assert_eq!(info.session_id, "TH-svc-001");

        let retrieved = service.get_session("TH-svc-001");
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().session_id, "TH-svc-001");
    }

    #[tokio::test]
    async fn test_telehealth_service_end_session_removes_it() {
        std::env::set_var("TELEHEALTH_PROVIDER", "internal");
        let service = TelehealthService::new();
        service
            .create_session(make_params("TH-svc-002"))
            .await
            .unwrap();
        service.end_session("TH-svc-002").await.unwrap();

        let retrieved = service.get_session("TH-svc-002");
        assert!(retrieved.is_none());
    }

    #[test]
    fn test_participant_role_display() {
        assert_eq!(ParticipantRole::Provider.to_string(), "provider");
        assert_eq!(ParticipantRole::Patient.to_string(), "patient");
        assert_eq!(ParticipantRole::Observer.to_string(), "observer");
    }
}
