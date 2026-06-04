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

    /// Return IFrame-API join credentials (domain, room, optional JWT) for a
    /// participant. Phase 1: only [`JitsiProvider`] implements this; other
    /// providers return `None` and the frontend falls back to plain URLs.
    fn join_credentials(
        &self,
        _session_id: &str,
        _user_id: &str,
        _display_name: &str,
        _moderator: bool,
    ) -> Option<JitsiCredentials> {
        None
    }

    /// Server-side room pre-configuration (Phase 3). Defaults are
    /// privacy-first: recording **off**, chat **on**, transcription **off**
    /// (HIPAA concern without E2EE consent), and a PHI-free subject. Providers
    /// may override; the frontend applies these once the room loads.
    fn configure_room(&self, _session_id: &str) -> RoomConfig {
        RoomConfig::default()
    }

    /// Validate a previously issued join token against a room (Phase 3).
    /// Providers that don't issue tokens accept all callers (returns `Ok`).
    /// [`JitsiProvider`] verifies the HS256 signature + room claim.
    fn validate_token(&self, _token: &str, _room: &str) -> Result<(), TelehealthError> {
        Ok(())
    }
}

/// Server-side room pre-configuration (Phase 3). Serialized into the join
/// response so the frontend can apply matching `configOverwrite` options.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RoomConfig {
    pub recording_enabled: bool,
    pub chat_enabled: bool,
    pub transcription_enabled: bool,
    /// PHI-free room subject (never contains a patient name).
    pub subject: String,
}

impl Default for RoomConfig {
    fn default() -> Self {
        RoomConfig {
            recording_enabled: false,
            chat_enabled: true,
            transcription_enabled: false,
            subject: "MediChain Telehealth Visit".to_string(),
        }
    }
}

// ============================================================================
// Jitsi JWT (Phase 1) — self-hosted Prosody token auth (HS256)
// ============================================================================

/// IFrame-API join credentials returned to the frontend.
#[derive(Debug, Clone, serde::Serialize)]
pub struct JitsiCredentials {
    /// Jitsi domain to pass to `JitsiMeetExternalAPI` (no scheme).
    pub domain: String,
    /// Room name.
    pub room: String,
    /// Signed JWT (`None` when `JITSI_APP_SECRET` is unset → unauthenticated room).
    pub jwt: Option<String>,
    /// Whether this participant is a Jitsi moderator.
    pub moderator: bool,
    /// Token lifetime in seconds.
    pub expires_in: i64,
}

/// Telehealth JWT lifetime: 30 minutes (plan §1).
pub const TELEHEALTH_JWT_TTL_SECS: i64 = 30 * 60;

/// Map a MediChain role string to a Jitsi moderator flag (Phase 1 §role-mapping).
/// Doctor/Nurse/LabTechnician/Admin moderate; Pharmacist/Patient observe.
pub fn role_is_moderator(role: &str) -> bool {
    matches!(
        role.to_ascii_lowercase().as_str(),
        "doctor" | "nurse" | "labtechnician" | "lab_technician" | "admin"
    )
}

#[derive(serde::Serialize)]
struct JitsiUser {
    id: String,
    name: String,
    email: String,
    moderator: bool,
}

#[derive(serde::Serialize)]
struct JitsiContext {
    user: JitsiUser,
}

#[derive(serde::Serialize)]
struct JitsiClaims {
    iss: String,
    aud: String,
    sub: String,
    room: String,
    iat: i64,
    nbf: i64,
    exp: i64,
    context: JitsiContext,
}

/// Sign a Jitsi JWT (HS256) for a self-hosted deployment configured with Prosody
/// token auth. Returns `None` if `JITSI_APP_SECRET` is unset/empty.
fn sign_jitsi_jwt(
    domain: &str,
    room: &str,
    user_id: &str,
    display_name: &str,
    moderator: bool,
) -> Option<String> {
    let secret = std::env::var("JITSI_APP_SECRET").ok().filter(|s| !s.is_empty())?;
    let app_id = std::env::var("JITSI_APP_ID").unwrap_or_else(|_| "medichain".to_string());
    let now = Utc::now().timestamp();
    let claims = JitsiClaims {
        iss: app_id,
        aud: "jitsi".to_string(),
        sub: domain.to_string(),
        room: room.to_string(),
        iat: now,
        nbf: now,
        exp: now + TELEHEALTH_JWT_TTL_SECS,
        context: JitsiContext {
            user: JitsiUser {
                id: user_id.to_string(),
                name: display_name.to_string(),
                email: String::new(),
                moderator,
            },
        },
    };
    jsonwebtoken::encode(
        &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256),
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(secret.as_bytes()),
    )
    .ok()
}

/// Verify a Jitsi HS256 JWT and confirm it grants access to `room` (Phase 3).
/// When `JITSI_APP_SECRET` is unset (open-room mode) any token is accepted.
fn verify_jitsi_jwt(token: &str, room: &str) -> Result<(), TelehealthError> {
    let secret = match std::env::var("JITSI_APP_SECRET").ok().filter(|s| !s.is_empty()) {
        Some(s) => s,
        None => return Ok(()), // open rooms: no token to verify
    };
    let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256);
    validation.set_audience(&["jitsi"]);
    let decoded = jsonwebtoken::decode::<serde_json::Value>(
        token,
        &jsonwebtoken::DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map_err(|e| TelehealthError::ProviderError(format!("invalid token: {}", e)))?;
    // A `room` claim of "*" (wildcard) or an exact match is accepted.
    let claim = decoded.claims.get("room").and_then(|v| v.as_str()).unwrap_or("");
    if claim == "*" || claim == room {
        Ok(())
    } else {
        Err(TelehealthError::ProviderError(
            "token room claim does not match requested room".to_string(),
        ))
    }
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
// JitsiProvider — Jitsi Meet (real WebRTC video, no API key required)
// ============================================================================

/// Generates working WebRTC video-call URLs backed by a Jitsi Meet server.
///
/// Defaults to the public `meet.jit.si` instance, which needs **no API key** and
/// creates rooms on first join — so the URLs open a real, functioning video call
/// out of the box. Point `JITSI_DOMAIN` at a self-hosted Jitsi deployment for
/// production (recommended for PHI), and optionally set `JITSI_ROOM_PREFIX`.
pub struct JitsiProvider {
    domain: String,
    room_prefix: String,
}

impl JitsiProvider {
    pub fn new() -> Self {
        let domain = std::env::var("JITSI_DOMAIN").unwrap_or_else(|_| "meet.jit.si".to_string());
        let room_prefix =
            std::env::var("JITSI_ROOM_PREFIX").unwrap_or_else(|_| "MediChain".to_string());
        JitsiProvider {
            domain,
            room_prefix,
        }
    }

    /// Build a Jitsi-safe room name (alphanumeric + hyphens only) from a session id.
    fn room_name(&self, session_id: &str) -> String {
        let cleaned: String = session_id
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { '-' })
            .collect();
        format!("{}-{}", self.room_prefix, cleaned)
    }

    fn build_url(&self, session_id: &str, role: &str) -> String {
        let room = self.room_name(session_id);
        // The `#userInfo.displayName` hash is consumed by the Jitsi web client to
        // pre-fill the participant's display name when the room loads.
        let display = match role {
            "provider" => "Care%20Provider",
            "patient" => "Patient",
            _ => "Participant",
        };
        format!(
            "https://{}/{}#userInfo.displayName=%22{}%22",
            self.domain, room, display
        )
    }
}

impl Default for JitsiProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl TelehealthProvider for JitsiProvider {
    async fn create_session(
        &self,
        params: CreateSessionParams,
    ) -> Result<SessionInfo, TelehealthError> {
        // No external API call needed — Jitsi rooms are created on first join.
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
        // Jitsi rooms are ephemeral and close automatically when the last
        // participant leaves — nothing to tear down server-side.
        Ok(())
    }

    fn provider_name(&self) -> &'static str {
        "jitsi"
    }

    fn join_credentials(
        &self,
        session_id: &str,
        user_id: &str,
        display_name: &str,
        moderator: bool,
    ) -> Option<JitsiCredentials> {
        let room = self.room_name(session_id);
        let jwt = sign_jitsi_jwt(&self.domain, &room, user_id, display_name, moderator);
        Some(JitsiCredentials {
            domain: self.domain.clone(),
            room,
            jwt,
            moderator,
            expires_in: TELEHEALTH_JWT_TTL_SECS,
        })
    }

    fn validate_token(&self, token: &str, room: &str) -> Result<(), TelehealthError> {
        verify_jitsi_jwt(token, room)
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
            std::env::var("TELEHEALTH_PROVIDER").unwrap_or_else(|_| "jitsi".to_string());

        let provider: Box<dyn TelehealthProvider> = match provider_name.to_lowercase().as_str() {
            "jitsi" => {
                log::info!("TelehealthService: using Jitsi Meet provider");
                Box::new(JitsiProvider::new())
            }
            "internal" => {
                log::info!("TelehealthService: using internal provider");
                Box::new(InternalProvider::new())
            }
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
            other => {
                log::warn!(
                    "Unknown TELEHEALTH_PROVIDER '{}'; defaulting to Jitsi Meet",
                    other
                );
                Box::new(JitsiProvider::new())
            }
        };

        TelehealthService {
            provider,
            sessions: RwLock::new(HashMap::new()),
        }
    }

    /// Construct the service around an explicit provider (dependency injection).
    /// Bypasses `TELEHEALTH_PROVIDER` env selection — used by tests and by
    /// callers that already hold a configured provider.
    #[allow(dead_code)] // test-only DI seam today; kept public for reuse
    pub fn with_provider(provider: Box<dyn TelehealthProvider>) -> Self {
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

    /// Build IFrame-API join credentials (domain, room, JWT) for a participant,
    /// mapping the MediChain `role` to a Jitsi moderator flag (Phase 1). Returns
    /// `None` for providers that don't support the IFrame API.
    pub fn join_credentials(
        &self,
        session_id: &str,
        user_id: &str,
        display_name: &str,
        role: &str,
    ) -> Option<JitsiCredentials> {
        let moderator = role_is_moderator(role);
        self.provider
            .join_credentials(session_id, user_id, display_name, moderator)
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

    /// Server-side room pre-configuration for a session (Phase 3).
    pub fn configure_room(&self, session_id: &str) -> RoomConfig {
        self.provider.configure_room(session_id)
    }

    /// Validate a join token against a room (Phase 3).
    pub fn validate_token(&self, token: &str, room: &str) -> Result<(), TelehealthError> {
        self.provider.validate_token(token, room)
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

    #[test]
    fn test_role_to_moderator_mapping() {
        assert!(role_is_moderator("Doctor"));
        assert!(role_is_moderator("nurse"));
        assert!(role_is_moderator("LabTechnician"));
        assert!(role_is_moderator("Admin"));
        assert!(!role_is_moderator("Patient"));
        assert!(!role_is_moderator("Pharmacist"));
    }

    // Single test (no parallel sibling) controls JITSI_APP_SECRET to avoid the
    // process-global env-var race inherent to Rust's parallel test runner.
    #[test]
    fn test_jitsi_jwt_credentials_lifecycle() {
        std::env::set_var("JITSI_APP_ID", "medichain");
        std::env::set_var("JITSI_APP_SECRET", "test-prosody-secret");
        let provider = JitsiProvider::new();

        let creds = provider
            .join_credentials("TH-jwt-001", "5Grw", "Dr. Test", true)
            .expect("jitsi provider returns credentials");
        assert!(!creds.domain.is_empty());
        assert!(creds.room.contains("TH-jwt-001"));
        assert!(creds.moderator);
        let token = creds.jwt.expect("JWT present when secret set");

        // Verify the signed JWT decodes with the same secret and carries the room.
        let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256);
        validation.set_audience(&["jitsi"]);
        let decoded = jsonwebtoken::decode::<serde_json::Value>(
            &token,
            &jsonwebtoken::DecodingKey::from_secret(b"test-prosody-secret"),
            &validation,
        )
        .expect("token verifies");
        assert_eq!(decoded.claims["room"], creds.room);
        assert_eq!(decoded.claims["context"]["user"]["moderator"], true);

        // validate_token (Phase 3): the issued token verifies against its room,
        // a different room is rejected, and garbage is rejected. Kept in this
        // single secret-controlling test to avoid the env-var race.
        assert!(provider.validate_token(&token, &creds.room).is_ok());
        assert!(provider.validate_token(&token, "SomeOtherRoom").is_err());
        assert!(provider.validate_token("not-a-jwt", &creds.room).is_err());

        // With the secret cleared, no JWT is issued (open-room fallback) and
        // validate_token accepts any token (nothing to verify).
        std::env::remove_var("JITSI_APP_SECRET");
        let open_provider = JitsiProvider::new();
        let open = open_provider
            .join_credentials("TH-open-001", "5Grw", "Patient", false)
            .unwrap();
        assert!(open.jwt.is_none());
        assert!(!open.moderator);
        assert!(open_provider.validate_token("anything", "any-room").is_ok());

        std::env::remove_var("JITSI_APP_ID");
    }

    #[test]
    fn test_jitsi_room_config_defaults_are_privacy_first() {
        let provider = JitsiProvider::new();
        let cfg = provider.configure_room("TH-cfg-001");
        // Recording + transcription off by default; chat on; PHI-free subject.
        assert!(!cfg.recording_enabled);
        assert!(!cfg.transcription_enabled);
        assert!(cfg.chat_enabled);
        assert_eq!(cfg.subject, "MediChain Telehealth Visit");
    }

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
    async fn test_jitsi_provider_create_session_real_url() {
        std::env::remove_var("JITSI_DOMAIN");
        std::env::remove_var("JITSI_ROOM_PREFIX");
        let provider = JitsiProvider::new();
        let info = provider
            .create_session(make_params("TH-jitsi-001"))
            .await
            .unwrap();
        assert_eq!(info.provider_name, "jitsi");
        // URLs point at a real, joinable room on the default public Jitsi server.
        assert!(info
            .provider_join_url
            .starts_with("https://meet.jit.si/MediChain-TH-jitsi-001"));
        assert!(info
            .patient_join_url
            .starts_with("https://meet.jit.si/MediChain-TH-jitsi-001"));
    }

    #[tokio::test]
    async fn test_jitsi_provider_sanitizes_room_name() {
        std::env::remove_var("JITSI_DOMAIN");
        std::env::remove_var("JITSI_ROOM_PREFIX");
        let provider = JitsiProvider::new();
        let url = provider
            .get_join_url("TH/weird id!", "alice", ParticipantRole::Patient)
            .await
            .unwrap();
        // Non-alphanumeric characters in the session id collapse to hyphens.
        assert!(url.contains("MediChain-TH-weird-id-"));
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

    /// Phase 8 (e2e): exercise the full session lifecycle at the service
    /// boundary — create → fetch → both parties get credentials → room
    /// pre-config → end (state cleared). Uses an injected provider so it is
    /// independent of the process-global `TELEHEALTH_PROVIDER`/secret env vars
    /// (token signing/validation is covered by the dedicated JWT test).
    #[tokio::test]
    async fn test_telehealth_e2e_session_flow() {
        let service = TelehealthService::with_provider(Box::new(JitsiProvider::new()));

        // Provider creates the session.
        let info = service.create_session(make_params("TH-e2e-001")).await.unwrap();
        assert_eq!(info.provider_name, "jitsi");
        assert!(service.get_session("TH-e2e-001").is_some());

        // Provider (moderator) and patient (participant) each get credentials.
        // Moderator flags derive from role, not the JWT secret, so this is
        // race-free regardless of whether a secret is set.
        let doc = service
            .join_credentials("TH-e2e-001", "5Doc", "Dr. E2E", "doctor")
            .expect("doctor creds");
        let pat = service
            .join_credentials("TH-e2e-001", "5Pat", "Patient", "patient")
            .expect("patient creds");
        assert!(doc.moderator);
        assert!(!pat.moderator);
        assert_eq!(doc.room, pat.room);

        // Pre-config is privacy-first.
        let cfg = service.configure_room("TH-e2e-001");
        assert!(!cfg.recording_enabled && cfg.chat_enabled);

        // Provider ends the session → server state cleared.
        service.end_session("TH-e2e-001").await.unwrap();
        assert!(service.get_session("TH-e2e-001").is_none());
    }

    /// Phase 8 (load): drive many concurrent create+join operations against one
    /// shared service to confirm the in-memory store stays consistent and never
    /// deadlocks under contention. Bounded (NASA Rule 2) — 200 sessions. Uses an
    /// injected provider so it is env-race-free.
    #[tokio::test]
    async fn test_telehealth_concurrent_session_load() {
        use std::sync::Arc;
        let service = Arc::new(TelehealthService::with_provider(Box::new(JitsiProvider::new())));

        const SESSIONS: usize = 200;
        let mut handles = Vec::with_capacity(SESSIONS);
        for i in 0..SESSIONS {
            let svc = Arc::clone(&service);
            handles.push(tokio::spawn(async move {
                let sid = format!("TH-load-{:04}", i);
                svc.create_session(make_params(&sid)).await.unwrap();
                // Both parties resolve credentials concurrently with creation.
                let creds = svc.join_credentials(&sid, "5Usr", "User", "doctor");
                assert!(creds.is_some());
                svc.get_session(&sid).is_some()
            }));
        }

        let mut ok = 0usize;
        for h in handles {
            if h.await.unwrap() {
                ok += 1;
            }
        }
        assert_eq!(ok, SESSIONS, "every concurrent session must persist");
    }
}
