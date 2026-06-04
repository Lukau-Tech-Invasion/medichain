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
// SMS templates, delivery tracking, and opt-out handling (Phase 5.3)
// ---------------------------------------------------------------------------

/// Standardized SMS templates for the notification types MediChain sends.
/// Centralizing copy here keeps tone/branding consistent and makes localization
/// and compliance review tractable.
#[derive(Debug, Clone)]
pub enum SmsTemplate {
    MedicationReminder { medication: String },
    AppointmentReminder { provider: String, when: String },
    LabResultReady { test_name: String },
    CriticalAlert { message: String },
    VerificationCode { code: String },
}

/// Footer appended to non-critical, non-OTP messages so recipients always have
/// a documented way to opt out (required for SMS compliance in many markets).
const SMS_OPT_OUT_FOOTER: &str = " Reply STOP to opt out.";

impl SmsTemplate {
    /// Render the SMS body, including the opt-out footer where appropriate.
    /// Verification codes and critical alerts intentionally omit the footer.
    pub fn render(&self) -> String {
        match self {
            SmsTemplate::MedicationReminder { medication } => format!(
                "MediChain: It's time to take your {}.{}",
                medication, SMS_OPT_OUT_FOOTER
            ),
            SmsTemplate::AppointmentReminder { provider, when } => format!(
                "MediChain: Reminder — your appointment with {} is on {}.{}",
                provider, when, SMS_OPT_OUT_FOOTER
            ),
            SmsTemplate::LabResultReady { test_name } => format!(
                "MediChain: Your {} results are ready. Open the app to view.{}",
                test_name, SMS_OPT_OUT_FOOTER
            ),
            SmsTemplate::CriticalAlert { message } => format!("MediChain ALERT: {}", message),
            SmsTemplate::VerificationCode { code } => {
                format!("MediChain verification code: {}. Do not share it.", code)
            }
        }
    }
}

/// Returns true if inbound text is a canonical SMS opt-out keyword. Inbound
/// STOP handling persists the preference; this recognizes the keywords for it.
pub fn is_sms_stop_keyword(text: &str) -> bool {
    matches!(
        text.trim().to_ascii_uppercase().as_str(),
        "STOP" | "STOPALL" | "UNSUBSCRIBE" | "CANCEL" | "END" | "QUIT"
    )
}

/// Global SMS kill-switch independent of per-recipient opt-in. When
/// `SMS_GLOBAL_DISABLE=true`, no SMS is dispatched regardless of preferences.
pub fn sms_globally_disabled() -> bool {
    std::env::var("SMS_GLOBAL_DISABLE")
        .ok()
        .map(|v| v.trim().to_ascii_lowercase() == "true")
        .unwrap_or(false)
}

/// Outcome of an SMS send attempt, for delivery tracking and retry decisions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SmsDeliveryStatus {
    /// Provider accepted the message (or it was logged in disabled mode).
    Sent,
    /// Suppressed locally (opt-out / global disable) — not an error.
    Suppressed,
    /// All retry attempts failed.
    Failed,
}

/// Maximum SMS send attempts (bounded per NASA Power-of-10 rule 2).
const SMS_MAX_ATTEMPTS: u8 = 3;

/// Send an SMS with bounded retries plus opt-out / kill-switch enforcement.
///
/// `opted_in` is the per-recipient opt-in flag (e.g. the reminder's SMS pref).
/// Returns a [`SmsDeliveryStatus`] describing the final outcome.
pub async fn send_sms_with_retry(msg: SmsMessage, opted_in: bool) -> SmsDeliveryStatus {
    if !opted_in || sms_globally_disabled() {
        info!(
            "[sms] Suppressed for {} (opted_in={}, global_disable={})",
            msg.to,
            opted_in,
            sms_globally_disabled()
        );
        return SmsDeliveryStatus::Suppressed;
    }

    let mut attempt: u8 = 0;
    while attempt < SMS_MAX_ATTEMPTS {
        attempt += 1;
        match send_sms(msg.clone()).await {
            Ok(()) => {
                info!("[sms] Delivered to {} on attempt {}", msg.to, attempt);
                return SmsDeliveryStatus::Sent;
            }
            Err(e) => warn!(
                "[sms] Attempt {}/{} to {} failed: {}",
                attempt, SMS_MAX_ATTEMPTS, msg.to, e
            ),
        }
    }
    warn!(
        "[sms] Giving up on {} after {} attempts",
        msg.to, SMS_MAX_ATTEMPTS
    );
    SmsDeliveryStatus::Failed
}

// ---------------------------------------------------------------------------
// Breach notification dispatch (Phase 11.4)
// ---------------------------------------------------------------------------

/// Dispatch a data-breach notification to the configured security officer(s).
///
/// Channel: SMS via Africa's Talking to `SECURITY_OFFICER_PHONE` (a comma-
/// separated list is supported). These are operational alerts, not marketing,
/// so they are always treated as opted-in. Returns the number of recipients the
/// dispatch was attempted for.
///
/// Regulator and affected-data-subject notification (email/postal) is a tracked
/// follow-up — no SMTP provider is wired yet; see `docs/INCIDENT_RESPONSE.md`.
pub async fn dispatch_breach_notification(
    summary: &str,
    notify_deadline: Option<chrono::DateTime<chrono::Utc>>,
) -> usize {
    let recipients = match std::env::var("SECURITY_OFFICER_PHONE") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => {
            warn!("[breach] SECURITY_OFFICER_PHONE not set; breach notification not dispatched");
            return 0;
        }
    };

    let deadline = notify_deadline
        .map(|d| d.format("%Y-%m-%d %H:%M UTC").to_string())
        .unwrap_or_else(|| "ASAP".to_string());
    let body = format!(
        "MediChain SECURITY BREACH: {}. Regulator/data-subject notification due by {} (POPIA 72h).",
        summary, deadline
    );

    let mut count = 0usize;
    for to in recipients
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        let msg = SmsMessage {
            to: to.to_string(),
            body: body.clone(),
        };
        let _ = send_sms_with_retry(msg, true).await;
        count += 1;
    }
    info!(
        "[breach] Dispatched breach notification to {} recipient(s)",
        count
    );
    count
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

// ---------------------------------------------------------------------------
// Tests (Phase 5.3)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_medication_reminder_template_has_opt_out_footer() {
        let body = SmsTemplate::MedicationReminder {
            medication: "Metformin".to_string(),
        }
        .render();
        assert!(body.contains("Metformin"));
        assert!(body.contains("Reply STOP to opt out"));
    }

    #[test]
    fn test_otp_and_critical_templates_omit_footer() {
        let otp = SmsTemplate::VerificationCode {
            code: "123456".to_string(),
        }
        .render();
        assert!(otp.contains("123456"));
        assert!(!otp.contains("opt out"));

        let alert = SmsTemplate::CriticalAlert {
            message: "Code Blue, Ward 3".to_string(),
        }
        .render();
        assert!(alert.starts_with("MediChain ALERT:"));
        assert!(!alert.contains("opt out"));
    }

    #[test]
    fn test_stop_keyword_detection() {
        assert!(is_sms_stop_keyword("STOP"));
        assert!(is_sms_stop_keyword("  stop  "));
        assert!(is_sms_stop_keyword("Unsubscribe"));
        assert!(!is_sms_stop_keyword("hello"));
    }

    #[tokio::test]
    async fn test_send_sms_with_retry_suppresses_when_opted_out() {
        let status = send_sms_with_retry(
            SmsMessage {
                to: "+254700000000".to_string(),
                body: "test".to_string(),
            },
            false, // opted out
        )
        .await;
        assert_eq!(status, SmsDeliveryStatus::Suppressed);
    }

    #[tokio::test]
    async fn test_send_sms_with_retry_logs_when_disabled() {
        // With SMS disabled (default), send_sms returns Ok after logging, so a
        // opted-in recipient yields Sent without hitting the network.
        std::env::remove_var("SMS_ENABLED");
        std::env::remove_var("SMS_GLOBAL_DISABLE");
        let status = send_sms_with_retry(
            SmsMessage {
                to: "+254700000000".to_string(),
                body: "test".to_string(),
            },
            true,
        )
        .await;
        assert_eq!(status, SmsDeliveryStatus::Sent);
    }
}
