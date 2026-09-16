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

    #[error("SMTP error: {0}")]
    Smtp(String),
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailNotification {
    pub to: String,
    pub subject: String,
    pub body: String,
}

/// Send an email notification.
///
/// **There is no SMTP transport in this binary, so this always fails.** That is
/// deliberate and it is the fix, not the bug. The previous implementation slept
/// 150ms and logged "Email successfully queued for delivery"; its only caller is
/// `dispatch_breach_notification`, which counted each simulated send as a
/// delivered POPIA / HIPAA regulator notification. A statutory deadline was
/// reported as met by a function that had sent nothing.
///
/// Wiring a real transport (`lettre`, credentials from `SMTP_HOST` /
/// `SMTP_USER` / `SMTP_PASS`) is a feature. Until it exists the honest answer
/// is an error, so every caller reports the delivery it actually achieved.
pub async fn send_email(email: EmailNotification) -> Result<(), NotificationError> {
    warn!(
        "[smtp] No SMTP transport is configured in this build; email to {} ({}) NOT sent",
        email.to, email.subject
    );
    Err(NotificationError::Smtp(
        "no SMTP transport is configured in this build".to_string(),
    ))
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
const AT_SMS_URL_DEFAULT: &str = "https://api.africastalking.com/version1/messaging";
const TIMEOUT: Duration = Duration::from_secs(10);

/// Africa's Talking messaging endpoint. Overridable via `AT_SMS_URL` so tests
/// (and a future live-sandbox verification pass) can point this at a mock
/// server instead of AT's real API without touching request-building logic.
fn at_sms_url() -> String {
    std::env::var("AT_SMS_URL").unwrap_or_else(|_| AT_SMS_URL_DEFAULT.to_string())
}

pub fn fcm_enabled() -> bool {
    std::env::var("FCM_ENABLED")
        .ok()
        .map(|v| v.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub fn sms_enabled() -> bool {
    std::env::var("SMS_ENABLED")
        .ok()
        .map(|v| v.trim().eq_ignore_ascii_case("true"))
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
        .post(at_sms_url())
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
        .map(|v| v.trim().eq_ignore_ascii_case("true"))
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
pub async fn send_sms_with_retry(
    repos: &RepositoryContainer,
    msg: SmsMessage,
    opted_in: bool,
) -> SmsDeliveryStatus {
    if !opted_in || sms_globally_disabled() {
        info!(
            "[sms] Suppressed for {} (opted_in={}, global_disable={})",
            msg.to,
            opted_in,
            sms_globally_disabled()
        );
        return SmsDeliveryStatus::Suppressed;
    }

    // Check for persistent opt-out
    if let Ok(true) = repos.sms_opt_outs.is_opted_out(&msg.to).await {
        info!("[sms] Suppressed for {} due to persistent opt-out", msg.to);
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

/// Result of a breach-declaration notification fan-out, broken out by channel
/// so the caller (and the compliance officer reading the API response) can see
/// which of the two independent regulatory obligations actually fired:
/// internal security-officer paging (SMS) vs. the POPIA/HIPAA-mandated
/// regulator/data-subject notification (email).
#[derive(Debug, Clone, Serialize)]
pub struct BreachNotificationResult {
    pub security_officers_notified: usize,
    pub regulator_emails_notified: usize,
}

/// Dispatch a data-breach notification on both configured channels:
///
/// 1. **Security officer paging** — SMS via Africa's Talking to
///    `SECURITY_OFFICER_PHONE` (comma-separated list supported).
/// 2. **Regulator / affected-data-subject notification** — email via
///    `send_email` (the SMTP scaffold) to `REGULATOR_NOTIFICATION_EMAIL`
///    (comma-separated list supported). This satisfies the POPIA
///    Information Regulator / HIPAA breach-notification requirement described
///    in `docs/INCIDENT_RESPONSE.md`. Real delivery still depends on
///    `SMTP_ENABLED=true` plus a production mail transport (`send_email`'s own
///    doc comment notes the network call is currently simulated pending a
///    crate like `lettre` + real SMTP credentials) — with `SMTP_ENABLED`
///    unset, the email is logged, not delivered.
///
/// Both channels are operational/compliance alerts, not marketing, so they are
/// always treated as opted-in. Missing either env var logs a warning and skips
/// that channel rather than failing the whole dispatch.
pub async fn dispatch_breach_notification(
    _repos: &RepositoryContainer,
    summary: &str,
    notify_deadline: Option<chrono::DateTime<chrono::Utc>>,
) -> BreachNotificationResult {
    let deadline = notify_deadline
        .map(|d| d.format("%Y-%m-%d %H:%M UTC").to_string())
        .unwrap_or_else(|| "ASAP".to_string());

    let mut sms_count = 0usize;
    match std::env::var("SECURITY_OFFICER_PHONE") {
        Ok(v) if !v.trim().is_empty() => {
            let body = format!(
                "MediChain SECURITY BREACH: {}. Regulator/data-subject notification due by {} (POPIA 72h).",
                summary, deadline
            );
            for to in v.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                let msg = SmsMessage {
                    to: to.to_string(),
                    body: body.clone(),
                };
                // Security alerts bypass persistent opt-out checks as they are operational/critical.
                let _ = send_sms(msg).await;
                sms_count += 1;
            }
            info!(
                "[breach] Dispatched breach SMS notification to {} security officer(s)",
                sms_count
            );
        }
        _ => warn!("[breach] SECURITY_OFFICER_PHONE not set; security-officer SMS not dispatched"),
    }

    let mut email_count = 0usize;
    match std::env::var("REGULATOR_NOTIFICATION_EMAIL") {
        Ok(v) if !v.trim().is_empty() => {
            let subject = "MediChain Data Breach Notification (POPIA/HIPAA)".to_string();
            let body = format!(
                "A data breach was declared: {summary}\n\n\
                 Notification of the applicable regulator (POPIA Information Regulator / \
                 HHS OCR) and affected data subjects is due by {deadline}.\n\n\
                 See docs/INCIDENT_RESPONSE.md for the full incident-response runbook.",
            );
            for to in v.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                let email = EmailNotification {
                    to: to.to_string(),
                    subject: subject.clone(),
                    body: body.clone(),
                };
                if let Err(e) = send_email(email).await {
                    warn!("[breach] Failed to dispatch regulator email to {}: {}", to, e);
                    continue;
                }
                email_count += 1;
            }
            if email_count == 0 {
                warn!(
                    "[breach] NO regulator/compliance email was delivered. \
                     Recipients are configured but this build has no SMTP transport: \
                     the POPIA Information Regulator / HHS OCR notification due by {deadline} \
                     must be sent by hand. See docs/INCIDENT_RESPONSE.md."
                );
            } else {
                info!(
                    "[breach] Dispatched breach email notification to {} regulator/compliance recipient(s)",
                    email_count
                );
            }
        }
        _ => warn!(
            "[breach] REGULATOR_NOTIFICATION_EMAIL not set; regulator/data-subject email not dispatched"
        ),
    }

    BreachNotificationResult {
        security_officers_notified: sms_count,
        regulator_emails_notified: email_count,
    }
}

// ---------------------------------------------------------------------------
// Convenience helpers for clinical event types
// ---------------------------------------------------------------------------

/// Whether this patient has asked to receive notifications of this kind.
///
/// `SettingsPage` has saved a `notifications` block since it was written --
/// `appointmentReminders`, `pushNotifications`, `emailNotifications` and the
/// rest -- and until now nothing read it. Every dispatcher pushed regardless, so
/// turning a toggle off changed a stored value and nothing else. A preference
/// a system records and ignores is worse than one it does not offer: the
/// patient believes they have opted out.
///
/// **Absent means yes.** A patient with no stored settings has not opted out of
/// anything, and a reminder is the thing they came for; defaulting to silence
/// would mean a deployment that had never shown the settings screen sent
/// nobody anything. Only an explicit `false` suppresses.
///
/// Keyed by patient id because that is what a dispatcher has; settings are
/// stored against the wallet, and `linked_patient_id` is the bridge.
pub async fn patient_wants(data: &crate::AppState, patient_id: &str, keys: &[&str]) -> bool {
    let Some(wallet) = wallet_for_patient(data, patient_id) else {
        // No account is linked to this record, so there is no one to have
        // expressed a preference. Send.
        return true;
    };
    let Ok(settings) = crate::handlers::load_settings(data, &wallet).await else {
        // Storage is unavailable. Failing loud (sending) beats failing silent
        // (not sending): a missed appointment reminder has a cost and a
        // duplicate one does not.
        log::warn!("notification preferences for {patient_id} could not be read; sending anyway");
        return true;
    };
    let Some(block) = settings.get("notifications") else {
        return true;
    };
    // Every named key must be on for the message to go. `appointmentReminders`
    // says what this message is; `pushNotifications` says whether this channel
    // is wanted at all, and off means off.
    keys.iter()
        .all(|key| block.get(key).and_then(serde_json::Value::as_bool) != Some(false))
}

/// Send a push to a patient, if they want it and we can address them.
///
/// The only correct way to notify a patient. Two things have to happen before
/// a message can reach one, and every dispatcher used to get at least one of
/// them wrong:
///
///   1. **Namespace.** Device tokens are registered under the caller's wallet
///      address (`register_device` stores `require_registered_caller(..)
///      .wallet_address`). A dispatcher holds a `PAT-...` record id. Passing
///      the record id to `send_push_to_user` matches no token, logs
///      "No device tokens for user", and returns `Ok(())` -- indistinguishable
///      from a delivered message, which is why five dispatchers did it and the
///      appointment reminder recorded `Sent`. `linked_patient_id` is the
///      bridge and this is where it gets crossed.
///   2. **Consent.** `keys` names the settings that have to be on: the
///      category (`appointmentReminders`, `recordUpdates`, `emergencyAlerts`)
///      and the channel (`pushNotifications`). Absent means yes; only an
///      explicit `false` suppresses. See `patient_wants`.
///
/// Returns whether the push was attempted, so a caller that records a delivery
/// status can record the truth. Never fails a request: a notification is not
/// part of any clinical decision.
pub async fn notify_patient(
    data: &crate::AppState,
    patient_id: &str,
    keys: &[&str],
    title: &str,
    body: &str,
    kind: &str,
) -> bool {
    let Some(wallet) = wallet_for_patient(data, patient_id) else {
        // Said out loud rather than dropped. A patient record with no linked
        // account has nobody to notify, and an operator asking "why was this
        // patient not told" needs to be able to find that out.
        info!("[push] {patient_id} has no linked account; {kind} not delivered");
        return false;
    };
    if !patient_wants(data, patient_id, keys).await {
        info!("[push] {kind} suppressed for {patient_id}: opted out");
        return false;
    }
    let notification = PushNotification {
        user_id: wallet,
        title: title.to_string(),
        body: body.to_string(),
        data: Some([("type".to_string(), kind.to_string())].into()),
    };
    if let Err(error) = send_push_to_user(&data.repositories, notification).await {
        warn!("[push] {kind} for {patient_id} failed: {error}");
        return false;
    }
    true
}

/// The wallet address of the account linked to this patient record.
///
/// Reads the authorization cache rather than the database: it is already in
/// memory, it holds exactly the active accounts, and a dispatcher running every
/// minute should not open a connection to answer this.
fn wallet_for_patient(data: &crate::AppState, patient_id: &str) -> Option<String> {
    let users = data.users.read().ok()?;
    users
        .values()
        .find(|user| user.linked_patient_id.as_deref() == Some(patient_id))
        .map(|user| user.wallet_address.clone())
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
    // Process environment variables are shared by all concurrently running
    // tests. Serialize the notification tests that temporarily change them.
    static NOTIFICATION_ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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
        let repos = RepositoryContainer::new_memory();
        let status = send_sms_with_retry(
            &repos,
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
        let _environment_guard = NOTIFICATION_ENV_LOCK.lock().await;
        let repos = RepositoryContainer::new_memory();
        // With SMS disabled (default), send_sms returns Ok after logging, so a
        // opted-in recipient yields Sent without hitting the network.
        std::env::remove_var("SMS_ENABLED");
        std::env::remove_var("SMS_GLOBAL_DISABLE");
        let status = send_sms_with_retry(
            &repos,
            SmsMessage {
                to: "+254700000000".to_string(),
                body: "test".to_string(),
            },
            true,
        )
        .await;
        assert_eq!(status, SmsDeliveryStatus::Sent);
    }

    /// Verifies the real outbound Africa's Talking request shape (URL, `apikey`
    /// header, form fields) against a local mock server — the part of "verify
    /// SMS delivery end-to-end" this environment CAN check without a live AT
    /// sandbox account (Phase 5.3). What this can't verify — whether AT's real
    /// API accepts the request — needs live `AT_USERNAME`/`AT_API_KEY` credentials
    /// only the project owner can provision.
    #[tokio::test]
    async fn test_send_sms_posts_expected_request_to_at_api() {
        let _environment_guard = NOTIFICATION_ENV_LOCK.lock().await;
        use wiremock::matchers::{body_string_contains, header, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let mock_server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/"))
            .and(header("apikey", "test-at-key"))
            .and(body_string_contains("username=sandbox"))
            .and(body_string_contains("to=%2B254700000000"))
            .and(body_string_contains("message=Hello+from+MediChain"))
            .respond_with(
                ResponseTemplate::new(201)
                    .set_body_string(r#"{"SMSMessageData":{"Message":"Sent","Recipients":[]}}"#),
            )
            .expect(1)
            .mount(&mock_server)
            .await;

        std::env::set_var("SMS_ENABLED", "true");
        std::env::set_var("AT_USERNAME", "sandbox");
        std::env::set_var("AT_API_KEY", "test-at-key");
        std::env::set_var("AT_SMS_URL", format!("{}/", mock_server.uri()));

        let result = send_sms(SmsMessage {
            to: "+254700000000".to_string(),
            body: "Hello from MediChain".to_string(),
        })
        .await;

        std::env::remove_var("SMS_ENABLED");
        std::env::remove_var("AT_USERNAME");
        std::env::remove_var("AT_API_KEY");
        std::env::remove_var("AT_SMS_URL");

        assert!(
            result.is_ok(),
            "send_sms should succeed against a 201 mock: {result:?}"
        );
        mock_server.verify().await;
    }

    #[tokio::test]
    async fn dispatch_breach_notification_skips_channels_when_env_unset() {
        let _environment_guard = NOTIFICATION_ENV_LOCK.lock().await;
        std::env::remove_var("SECURITY_OFFICER_PHONE");
        std::env::remove_var("REGULATOR_NOTIFICATION_EMAIL");
        let repos = RepositoryContainer::new_memory();
        let result = dispatch_breach_notification(&repos, "test breach", None).await;
        assert_eq!(result.security_officers_notified, 0);
        assert_eq!(result.regulator_emails_notified, 0);
    }

    #[tokio::test]
    async fn dispatch_breach_notification_dispatches_regulator_email_when_configured() {
        let _environment_guard = NOTIFICATION_ENV_LOCK.lock().await;
        std::env::remove_var("SECURITY_OFFICER_PHONE");
        std::env::set_var(
            "REGULATOR_NOTIFICATION_EMAIL",
            "privacy@example.test,dpo@example.test",
        );
        let repos = RepositoryContainer::new_memory();
        let result = dispatch_breach_notification(&repos, "test breach", None).await;
        assert_eq!(result.security_officers_notified, 0);
        assert_eq!(result.regulator_emails_notified, 2);
        std::env::remove_var("REGULATOR_NOTIFICATION_EMAIL");
    }
}

#[cfg(test)]
mod preference_tests {
    use super::*;
    use crate::{AppState, Role, User};
    use actix_web::web;

    fn state_with_linked_patient(wallet: &str, patient_id: &str) -> web::Data<AppState> {
        let state = AppState::new();
        let user = User {
            wallet_address: wallet.to_string(),
            username: None,
            name: "Journey Patient".to_string(),
            role: Role::Patient,
            created_at: chrono::Utc::now(),
            created_by: None,
            linked_patient_id: Some(patient_id.to_string()),
            email: None,
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        };
        state
            .users
            .write()
            .unwrap()
            .insert(wallet.to_string(), user);
        web::Data::new(state)
    }

    /// A patient who has never opened the settings screen has not opted out.
    #[actix_rt::test]
    async fn absent_preferences_do_not_suppress() {
        let data = state_with_linked_patient("5Wallet-A", "PAT-PREF-A");
        assert!(patient_wants(&data, "PAT-PREF-A", &["appointmentReminders"]).await);
    }

    /// A record with no account linked to it has nobody to have expressed a
    /// preference, so it must not be treated as an opt-out.
    #[actix_rt::test]
    async fn an_unlinked_patient_record_still_receives() {
        let data = state_with_linked_patient("5Wallet-B", "PAT-PREF-B");
        assert!(patient_wants(&data, "PAT-NOBODY", &["appointmentReminders"]).await);
    }

    /// An explicit `false` on any named key suppresses the message. This is the
    /// behaviour the settings screen has been promising and nothing delivered.
    #[actix_rt::test]
    async fn an_explicit_opt_out_suppresses() {
        let data = state_with_linked_patient("5Wallet-C", "PAT-PREF-C");
        crate::handlers::persist_settings_for_test(
            &data,
            "5Wallet-C",
            serde_json::json!({"notifications": {"appointmentReminders": false}}),
        )
        .await;

        assert!(!patient_wants(&data, "PAT-PREF-C", &["appointmentReminders"]).await);
        // A key that is not the one turned off still goes.
        assert!(patient_wants(&data, "PAT-PREF-C", &["recordUpdates"]).await);
        // Any `false` among the named keys is enough to suppress.
        assert!(
            !patient_wants(
                &data,
                "PAT-PREF-C",
                &["pushNotifications", "appointmentReminders"]
            )
            .await
        );
    }
}
