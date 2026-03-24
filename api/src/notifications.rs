//! Firebase Cloud Messaging (FCM) push notification integration.
#![allow(dead_code)]
//!
//! Implements the FCM HTTP v1 API for sending push notifications to mobile
//! devices. Uses `reqwest` (already in Cargo.toml) for HTTP calls.
//!
//! # Configuration
//!
//! Set `FCM_SERVER_KEY` to your Firebase server key (legacy HTTP API) or
//! configure `FCM_PROJECT_ID` + a service-account access token for the v1 API.
//!
//! # Device Token Storage
//!
//! Device tokens are currently held in-memory (HashMap). In production,
//! persist them to a `device_tokens` table keyed by user_id.
//!
//! # Enabling FCM
//!
//! Set `FCM_ENABLED=true` in the environment to send real push notifications.
//! When disabled (default), notifications are logged but not sent.

use log::{info, warn};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::RwLock;
use std::time::Duration;
use thiserror::Error;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Errors that can occur during FCM dispatch.
#[derive(Debug, Error)]
pub enum FcmError {
    #[error("FCM HTTP error: {0}")]
    Http(String),

    #[error("FCM API error: {0}")]
    Api(String),

    #[error("FCM disabled (set FCM_ENABLED=true to activate)")]
    Disabled,
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/// FCM legacy HTTP API response.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct FcmResponse {
    multicast_id: Option<i64>,
    success: Option<i32>,
    failure: Option<i32>,
    results: Option<Vec<FcmResult>>,
    // v1 API uses a single `name` field on success
    name: Option<String>,
    error: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct FcmResult {
    message_id: Option<String>,
    error: Option<String>,
}

// ---------------------------------------------------------------------------
// Notification payload
// ---------------------------------------------------------------------------

/// A push notification to be sent to one or more device tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushNotification {
    /// The user this notification belongs to (for routing / logging).
    pub user_id: String,
    /// Short title displayed in the notification tray.
    pub title: String,
    /// Body text of the notification.
    pub body: String,
    /// Optional key-value data payload delivered to the app.
    pub data: Option<HashMap<String, String>>,
}

// ---------------------------------------------------------------------------
// FCM client
// ---------------------------------------------------------------------------

const FCM_LEGACY_URL: &str = "https://fcm.googleapis.com/fcm/send";
const FCM_TIMEOUT: Duration = Duration::from_secs(10);

/// Returns `true` when `FCM_ENABLED=true` is set in the environment.
pub fn fcm_enabled() -> bool {
    std::env::var("FCM_ENABLED")
        .ok()
        .map(|v| v.trim().to_ascii_lowercase() == "true")
        .unwrap_or(false)
}

/// Returns the FCM server key from `FCM_SERVER_KEY`, or `None` if not set.
fn fcm_server_key() -> Option<String> {
    std::env::var("FCM_SERVER_KEY")
        .ok()
        .filter(|v| !v.trim().is_empty())
}

/// Send an FCM push notification to a single device token.
///
/// Uses the FCM legacy HTTP API (v1 migration can be done by swapping the URL
/// and adding OAuth2 bearer auth when `FCM_PROJECT_ID` is set).
///
/// # Arguments
/// * `token` – FCM registration token for the target device.
/// * `title` – Notification title.
/// * `body`  – Notification body text.
/// * `data`  – Optional key-value data payload.
pub async fn send_fcm_notification(
    token: &str,
    title: &str,
    body: &str,
    data: Option<&HashMap<String, String>>,
) -> Result<(), FcmError> {
    if !fcm_enabled() {
        info!(
            "[fcm] DEMO MODE — push notification logged but not sent. \
             token={} title='{}' body='{}'",
            &token[..token.len().min(20)],
            title,
            body
        );
        return Err(FcmError::Disabled);
    }

    let server_key = fcm_server_key().ok_or_else(|| {
        warn!("[fcm] FCM_SERVER_KEY not set — cannot send push notification");
        FcmError::Api("FCM_SERVER_KEY not configured".into())
    })?;

    let mut payload = json!({
        "to": token,
        "notification": {
            "title": title,
            "body": body,
        },
        "priority": "high",
    });

    if let Some(d) = data {
        payload["data"] = json!(d);
    }

    let client = Client::builder()
        .timeout(FCM_TIMEOUT)
        .build()
        .map_err(|e| FcmError::Http(e.to_string()))?;

    let response = client
        .post(FCM_LEGACY_URL)
        .header("Authorization", format!("key={}", server_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| FcmError::Http(e.to_string()))?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text = response.text().await.unwrap_or_default();
        warn!("[fcm] FCM returned HTTP {}: {}", status, body_text);
        return Err(FcmError::Api(format!("HTTP {}: {}", status, body_text)));
    }

    let fcm_resp: FcmResponse = response
        .json()
        .await
        .map_err(|e| FcmError::Api(format!("Failed to parse FCM response: {}", e)))?;

    if let Some(results) = &fcm_resp.results {
        for result in results {
            if let Some(err) = &result.error {
                warn!("[fcm] FCM delivery error for token {}: {}", token, err);
            }
        }
    }

    if fcm_resp.success.unwrap_or(0) > 0 || fcm_resp.name.is_some() {
        info!("[fcm] Notification sent successfully to token ...{}", &token[token.len().saturating_sub(8)..]);
    }

    Ok(())
}

/// Send a push notification to all registered device tokens for a user.
///
/// `device_tokens` is a slice of FCM registration tokens associated with
/// the user. In production these come from the `device_tokens` database table.
pub async fn send_notification_to_user(
    user_id: &str,
    device_tokens: &[String],
    title: &str,
    body: &str,
    data: Option<&HashMap<String, String>>,
) {
    if device_tokens.is_empty() {
        info!("[fcm] No device tokens registered for user {}", user_id);
        return;
    }

    for token in device_tokens {
        match send_fcm_notification(token, title, body, data).await {
            Ok(()) => {}
            Err(FcmError::Disabled) => {
                // Already logged inside send_fcm_notification; no need to repeat.
                break;
            }
            Err(e) => {
                warn!(
                    "[fcm] Failed to send notification to user {}: {}",
                    user_id, e
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// In-memory device token registry (replace with DB table in production)
// ---------------------------------------------------------------------------

/// In-memory store mapping user_id → list of FCM device tokens.
///
/// In production, replace with a database-backed implementation.
#[derive(Debug, Default)]
pub struct DeviceTokenRegistry {
    /// user_id → Vec<fcm_token>
    tokens: RwLock<HashMap<String, Vec<String>>>,
}

impl DeviceTokenRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a device token for a user.
    pub fn register(&self, user_id: &str, token: String) {
        let mut map = self.tokens.write().unwrap();
        let entry = map.entry(user_id.to_string()).or_default();
        if !entry.contains(&token) {
            entry.push(token);
        }
    }

    /// Remove a device token (on user logout / token refresh).
    pub fn unregister(&self, user_id: &str, token: &str) {
        let mut map = self.tokens.write().unwrap();
        if let Some(tokens) = map.get_mut(user_id) {
            tokens.retain(|t| t != token);
        }
    }

    /// Get all device tokens for a user.
    pub fn get_tokens(&self, user_id: &str) -> Vec<String> {
        let map = self.tokens.read().unwrap();
        map.get(user_id).cloned().unwrap_or_default()
    }

    /// Send a push notification to all devices registered for `user_id`.
    pub async fn notify_user(
        &self,
        user_id: &str,
        title: &str,
        body: &str,
        data: Option<&HashMap<String, String>>,
    ) {
        let tokens = self.get_tokens(user_id);
        send_notification_to_user(user_id, &tokens, title, body, data).await;
    }
}

// ---------------------------------------------------------------------------
// Convenience helpers for clinical event types
// ---------------------------------------------------------------------------

/// Send a push notification for a new appointment.
pub async fn notify_appointment(
    registry: &DeviceTokenRegistry,
    patient_user_id: &str,
    appointment_date: &str,
    provider_name: &str,
) {
    let title = "Appointment Reminder";
    let body = format!(
        "Your appointment with {} is scheduled for {}.",
        provider_name, appointment_date
    );

    let mut data = HashMap::new();
    data.insert("type".to_string(), "appointment".to_string());
    data.insert("appointment_date".to_string(), appointment_date.to_string());

    registry
        .notify_user(patient_user_id, title, &body, Some(&data))
        .await;
}

/// Send a push notification for a new prescription.
pub async fn notify_prescription(
    registry: &DeviceTokenRegistry,
    patient_user_id: &str,
    medication_name: &str,
) {
    let title = "New Prescription";
    let body = format!(
        "A new prescription for {} has been issued. Please check MediChain.",
        medication_name
    );

    let mut data = HashMap::new();
    data.insert("type".to_string(), "prescription".to_string());
    data.insert("medication".to_string(), medication_name.to_string());

    registry
        .notify_user(patient_user_id, title, &body, Some(&data))
        .await;
}

/// Send a push notification for a new lab result.
pub async fn notify_lab_result(
    registry: &DeviceTokenRegistry,
    patient_user_id: &str,
    test_name: &str,
) {
    let title = "Lab Results Available";
    let body = format!("Results for {} are now available in MediChain.", test_name);

    let mut data = HashMap::new();
    data.insert("type".to_string(), "lab_result".to_string());
    data.insert("test_name".to_string(), test_name.to_string());

    registry
        .notify_user(patient_user_id, title, &body, Some(&data))
        .await;
}

/// Send a push notification for a critical alert (high-severity CDS or lab).
pub async fn notify_critical_alert(
    registry: &DeviceTokenRegistry,
    provider_user_id: &str,
    patient_name: &str,
    alert_message: &str,
) {
    let title = "CRITICAL ALERT";
    let body = format!("Patient {}: {}", patient_name, alert_message);

    let mut data = HashMap::new();
    data.insert("type".to_string(), "critical_alert".to_string());
    data.insert("priority".to_string(), "high".to_string());

    registry
        .notify_user(provider_user_id, title, &body, Some(&data))
        .await;
}
