//! Notification service for Push (FCM) and SMS (Africa's Talking).
#![allow(dead_code)]

use crate::repositories::RepositoryContainer;
use log::{info, warn};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use thiserror::Error;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum NotificationError {
    #[error("HTTP error: {0}")]
    Http(String),

    #[error("API error: {0}")]
    Api(String),

    #[error("Service disabled")]
    Disabled,

    #[error("Repository error: {0}")]
    Repository(String),
}

// ---------------------------------------------------------------------------
// Payload structures
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushNotification {
    pub user_id: String,
    pub title: String,
    pub body: String,
    pub data: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmsMessage {
    pub to: String,
    pub body: String,
}

// ---------------------------------------------------------------------------
// FCM v1 Structures
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
struct FcmV1Message {
    message: FcmMessagePayload,
}

#[derive(Debug, Serialize)]
struct FcmMessagePayload {
    token: String,
    notification: FcmNotificationPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
struct FcmNotificationPayload {
    title: String,
    body: String,
}

// ---------------------------------------------------------------------------
// Notification Service
// ---------------------------------------------------------------------------

const FCM_V1_URL_PREFIX: &str = "https://fcm.googleapis.com/v1/projects/";
const AT_SMS_URL: &str = "https://api.africastalking.com/version1/messaging";
const TIMEOUT: Duration = Duration::from_secs(10);

pub fn fcm_enabled() -> bool {
    std::env::var("FCM_ENABLED")
        .ok()
        .map(|v| v.trim().to_ascii_lowercase() == "true")
        .unwrap_or(false)
}

pub fn sms_enabled() -> bool {
    std::env::var("SMS_ENABLED")
        .ok()
        .map(|v| v.trim().to_ascii_lowercase() == "true")
        .unwrap_or(false)
}

/// Send a push notification to all registered devices of a user
pub async fn send_push_to_user(
    repos: &RepositoryContainer,
    notification: PushNotification,
) -> Result<(), NotificationError> {
    if !fcm_enabled() {
        info!(
            "[fcm] Notification logged for {}: {}",
            notification.user_id, notification.title
        );
        return Ok(());
    }

    let tokens = repos
        .device_tokens
        .get_by_user(&notification.user_id)
        .await
        .map_err(|e| NotificationError::Repository(e.to_string()))?;

    if tokens.is_empty() {
        info!(
            "[fcm] No device tokens for user {}, skipping push",
            notification.user_id
        );
        return Ok(());
    }

    let project_id = std::env::var("FCM_PROJECT_ID")
        .map_err(|_| NotificationError::Api("FCM_PROJECT_ID not set".into()))?;

    let access_token = std::env::var("FCM_ACCESS_TOKEN")
        .map_err(|_| NotificationError::Api("FCM_ACCESS_TOKEN not set".into()))?;

    let client = Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| NotificationError::Http(e.to_string()))?;
    let url = format!("{}{}/messages:send", FCM_V1_URL_PREFIX, project_id);

    for token_entity in tokens {
        let payload = FcmV1Message {
            message: FcmMessagePayload {
                token: token_entity.token.clone(),
                notification: FcmNotificationPayload {
                    title: notification.title.clone(),
                    body: notification.body.clone(),
                },
                data: notification.data.clone(),
            },
        };

        let resp = client
            .post(&url)
            .bearer_auth(&access_token)
            .json(&payload)
            .send()
            .await;

        match resp {
            Ok(r) if r.status().is_success() => {
                info!("[fcm] Push sent successfully to device {}", token_entity.id);
            }
            Ok(r) => {
                let err_text = r.text().await.unwrap_or_default();
                warn!("[fcm] Error for device {}: {}", token_entity.id, err_text);
            }
            Err(e) => warn!("[fcm] Network error sending push: {}", e),
        }
    }

    Ok(())
}

/// Send an SMS via Africa's Talking
pub async fn send_sms(msg: SmsMessage) -> Result<(), NotificationError> {
    if !sms_enabled() {
        info!("[sms] Logging message to {}: {}", msg.to, msg.body);
        return Ok(());
    }

    let username = std::env::var("AT_USERNAME")
        .map_err(|_| NotificationError::Api("AT_USERNAME not set".into()))?;
    let api_key = std::env::var("AT_API_KEY")
        .map_err(|_| NotificationError::Api("AT_API_KEY not set".into()))?;

    let client = Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| NotificationError::Http(e.to_string()))?;

    let mut params = HashMap::new();
    params.insert("username", username);
    params.insert("to", msg.to.clone());
    params.insert("message", msg.body.clone());

    let resp = client
        .post(AT_SMS_URL)
        .header("apikey", api_key)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => {
            info!("[sms] Sent successfully to {}", msg.to);
            Ok(())
        }
        Ok(r) => {
            let err_text = r.text().await.unwrap_or_default();
            warn!("[sms] Africa's Talking error: {}", err_text);
            Err(NotificationError::Api(err_text))
        }
        Err(e) => {
            warn!("[sms] Network error: {}", e);
            Err(NotificationError::Http(e.to_string()))
        }
    }
}

// ---------------------------------------------------------------------------
// Convenience helpers for clinical event types
// ---------------------------------------------------------------------------

pub async fn notify_appointment(
    repos: &RepositoryContainer,
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

    let _ = send_push_to_user(
        repos,
        PushNotification {
            user_id: patient_user_id.to_string(),
            title: title.to_string(),
            body: body.to_string(),
            data: Some(data),
        },
    )
    .await;
}

pub async fn notify_prescription(
    repos: &RepositoryContainer,
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

    let _ = send_push_to_user(
        repos,
        PushNotification {
            user_id: patient_user_id.to_string(),
            title: title.to_string(),
            body: body.to_string(),
            data: Some(data),
        },
    )
    .await;
}

pub async fn notify_lab_result(
    repos: &RepositoryContainer,
    patient_user_id: &str,
    test_name: &str,
) {
    let title = "Lab Results Available";
    let body = format!("Results for {} are now available in MediChain.", test_name);

    let mut data = HashMap::new();
    data.insert("type".to_string(), "lab_result".to_string());
    data.insert("test_name".to_string(), test_name.to_string());

    let _ = send_push_to_user(
        repos,
        PushNotification {
            user_id: patient_user_id.to_string(),
            title: title.to_string(),
            body: body.to_string(),
            data: Some(data),
        },
    )
    .await;
}

pub async fn notify_critical_alert(
    repos: &RepositoryContainer,
    provider_user_id: &str,
    patient_name: &str,
    alert_message: &str,
) {
    let title = "CRITICAL ALERT";
    let body = format!("Patient {}: {}", patient_name, alert_message);

    let mut data = HashMap::new();
    data.insert("type".to_string(), "critical_alert".to_string());
    data.insert("priority".to_string(), "high".to_string());

    let _ = send_push_to_user(
        repos,
        PushNotification {
            user_id: provider_user_id.to_string(),
            title: title.to_string(),
            body: body.to_string(),
            data: Some(data),
        },
    )
    .await;
}
