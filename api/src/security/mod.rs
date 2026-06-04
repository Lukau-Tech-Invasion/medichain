//! Security subsystem: JWT auth (9.4), TOTP MFA (11.3), and breach detection
//! plus incident response (11.4).
//!
//! [`SecurityState`] is held as a single field on [`crate::state::AppState`] so
//! the rest of the app gains all three capabilities through one wiring point.

pub mod breach;
pub mod jwt;
pub mod mfa;

use crate::websocket::{PushEvent, WsSessionManager};
use breach::{ActorWindow, SecurityAlert, MAX_ALERTS};
use mfa::MfaRecord;
use std::collections::{HashMap, VecDeque};
use std::sync::RwLock;

/// Runtime security state: MFA enrollments, the recent-alert ring buffer, and
/// per-actor sliding windows feeding the anomaly detectors.
pub struct SecurityState {
    /// Wallet address → TOTP enrollment.
    pub mfa: RwLock<HashMap<String, MfaRecord>>,
    /// Bounded ring buffer of recent security alerts (newest at the back).
    alerts: RwLock<VecDeque<SecurityAlert>>,
    /// Wallet address → sliding-window counters for the detectors.
    windows: RwLock<HashMap<String, ActorWindow>>,
    /// PostgreSQL pool for durable alert persistence (None on the memory backend).
    pool: Option<sqlx::PgPool>,
}

impl SecurityState {
    pub fn new(pool: Option<sqlx::PgPool>) -> Self {
        Self {
            mfa: RwLock::new(HashMap::new()),
            alerts: RwLock::new(VecDeque::with_capacity(MAX_ALERTS)),
            windows: RwLock::new(HashMap::new()),
            pool,
        }
    }

    /// Persist an alert to PostgreSQL when a pool is configured. Best-effort:
    /// a DB failure is logged but never blocks the request path.
    async fn persist_alert(&self, alert: &SecurityAlert) {
        let Some(pool) = &self.pool else { return };
        let res = sqlx::query(
            "INSERT INTO security_alerts (id, kind, severity, actor, message, notify_deadline, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING",
        )
        .bind(&alert.id)
        .bind(&alert.kind)
        .bind(&alert.severity)
        .bind(&alert.actor)
        .bind(&alert.message)
        .bind(alert.notify_deadline)
        .bind(alert.created_at)
        .execute(pool)
        .await;
        if let Err(e) = res {
            log::error!("Failed to persist security alert {}: {}", alert.id, e);
        }
    }

    /// Load the most recent persisted alerts into the in-memory ring buffer at
    /// startup, so history survives a restart.
    pub async fn load_alerts_from_db(&self) {
        let Some(pool) = &self.pool else { return };
        let rows: Result<Vec<SecurityAlert>, _> = sqlx::query_as::<_, SecurityAlert>(
            "SELECT id, kind, severity, actor, message, notify_deadline, created_at \
             FROM security_alerts ORDER BY created_at DESC LIMIT $1",
        )
        .bind(MAX_ALERTS as i64)
        .fetch_all(pool)
        .await;
        match rows {
            Ok(mut alerts) => {
                alerts.reverse(); // oldest first into the ring buffer
                if let Ok(mut buf) = self.alerts.write() {
                    for a in alerts {
                        buf.push_back(a);
                    }
                }
            }
            Err(e) => log::warn!("Could not load security alerts: {}", e),
        }
    }

    // ---- MFA ---------------------------------------------------------------

    /// Whether the wallet has a fully enabled (verified) MFA enrollment.
    pub fn mfa_enabled(&self, wallet: &str) -> bool {
        self.mfa
            .read()
            .map(|m| m.get(wallet).map(|r| r.enabled).unwrap_or(false))
            .unwrap_or(false)
    }

    // ---- Alert storage -----------------------------------------------------

    /// Append an alert, evicting the oldest if the ring buffer is full.
    pub fn record_alert(&self, alert: SecurityAlert) {
        if let Ok(mut alerts) = self.alerts.write() {
            if alerts.len() >= MAX_ALERTS {
                alerts.pop_front();
            }
            alerts.push_back(alert);
        }
    }

    /// Return up to `limit` of the most recent alerts, newest first.
    pub fn recent_alerts(&self, limit: usize) -> Vec<SecurityAlert> {
        self.alerts
            .read()
            .map(|a| a.iter().rev().take(limit).cloned().collect())
            .unwrap_or_default()
    }

    // ---- Detectors (record → store → broadcast) ----------------------------

    /// Broadcast an alert over SSE so a connected security officer sees it live.
    fn broadcast(ws: &WsSessionManager, alert: &SecurityAlert) {
        ws.push_event(PushEvent {
            event_type: "security_alert".to_string(),
            patient_id: None,
            payload: serde_json::json!({
                "id": alert.id,
                "kind": alert.kind,
                "severity": alert.severity,
                "actor": alert.actor,
                "message": alert.message,
            }),
            timestamp: alert.created_at.timestamp(),
        });
    }

    /// Note a failed authentication for `actor`; fires an alert at the threshold.
    pub async fn observe_failed_auth(&self, ws: &WsSessionManager, actor: &str) {
        let now = chrono::Utc::now();
        let tripped = self
            .windows
            .write()
            .map(|mut w| {
                w.entry(actor.to_string())
                    .or_insert_with(|| ActorWindow::fresh(now))
                    .record_failed_auth(now)
            })
            .unwrap_or(false);

        if tripped {
            let alert = SecurityAlert::detected(
                breach::kind::FAILED_AUTH_BURST,
                breach::severity::HIGH,
                Some(actor.to_string()),
                format!(
                    "{}+ failed auth attempts from {} within {}s",
                    breach::FAILED_AUTH_THRESHOLD,
                    actor,
                    breach::WINDOW_SECS
                ),
            );
            log::warn!("SECURITY ALERT [{}]: {}", alert.kind, alert.message);
            Self::broadcast(ws, &alert);
            self.persist_alert(&alert).await;
            self.record_alert(alert);
        }
    }

    /// Note an access by `actor` to `patient_id`; fires an alert on bulk access.
    pub async fn observe_access(&self, ws: &WsSessionManager, actor: &str, patient_id: &str) {
        let now = chrono::Utc::now();
        let tripped = self
            .windows
            .write()
            .map(|mut w| {
                w.entry(actor.to_string())
                    .or_insert_with(|| ActorWindow::fresh(now))
                    .record_access(now, patient_id)
            })
            .unwrap_or(false);

        if tripped {
            let alert = SecurityAlert::detected(
                breach::kind::ABNORMAL_ACCESS,
                breach::severity::HIGH,
                Some(actor.to_string()),
                format!(
                    "{} accessed {}+ distinct patient records within {}s — possible bulk exfiltration",
                    actor,
                    breach::ABNORMAL_ACCESS_THRESHOLD,
                    breach::WINDOW_SECS
                ),
            );
            log::warn!("SECURITY ALERT [{}]: {}", alert.kind, alert.message);
            Self::broadcast(ws, &alert);
            self.persist_alert(&alert).await;
            self.record_alert(alert);
        }
    }

    /// Manually declare a breach (admin action). Records a critical alert with a
    /// 72-hour POPIA notification deadline, persists it, and broadcasts it.
    pub async fn declare_breach(
        &self,
        ws: &WsSessionManager,
        actor: Option<String>,
        message: String,
    ) -> SecurityAlert {
        let alert = SecurityAlert::declared(actor, message);
        log::error!(
            "BREACH DECLARED: {} — notify deadline {:?}",
            alert.message,
            alert.notify_deadline
        );
        Self::broadcast(ws, &alert);
        self.persist_alert(&alert).await;
        self.record_alert(alert.clone());
        alert
    }
}

impl Default for SecurityState {
    fn default() -> Self {
        Self::new(None)
    }
}
