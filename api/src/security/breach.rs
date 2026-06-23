//! Breach / anomaly detection primitives (Phase 11.4 — Incident Response).
//!
//! Two lightweight, allocation-bounded detectors run inline on the request path:
//!
//! 1. **Failed-auth burst** — N failed signature/MFA verifications from one actor
//!    inside a short window suggests credential stuffing or a stolen device.
//! 2. **Abnormal access** — one provider touching an unusually large number of
//!    distinct patient records inside a short window suggests bulk exfiltration.
//!
//! Tripping a detector produces a [`SecurityAlert`], which the caller logs and
//! pushes over SSE so a security officer sees it live. Declared breaches (manual,
//! via the admin endpoint) are also recorded as alerts and start the POPIA
//! 72-hour notification clock documented in `docs/INCIDENT_RESPONSE.md`.
//!
//! NASA Power-of-10: all collections are explicitly bounded (alert ring buffer +
//! per-window counters that reset), so memory cannot grow without limit.

use chrono::{DateTime, Duration, Utc};
use std::collections::HashSet;

/// Sliding window length for both detectors.
pub const WINDOW_SECS: i64 = 300; // 5 minutes
/// Failed auth attempts within the window that trip an alert.
pub const FAILED_AUTH_THRESHOLD: u32 = 5;
/// Distinct patients accessed within the window that trips an alert.
pub const ABNORMAL_ACCESS_THRESHOLD: usize = 30;
/// Maximum alerts retained in memory (ring buffer).
pub const MAX_ALERTS: usize = 500;

/// Severity levels for security alerts.
pub mod severity {
    #[allow(dead_code)]
    pub const MEDIUM: &str = "medium";
    pub const HIGH: &str = "high";
    pub const CRITICAL: &str = "critical";
}

/// Alert categories.
pub mod kind {
    pub const FAILED_AUTH_BURST: &str = "failed_auth_burst";
    pub const ABNORMAL_ACCESS: &str = "abnormal_access";
    pub const BREACH_DECLARED: &str = "breach_declared";
}

/// A recorded security event surfaced to administrators.
#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct SecurityAlert {
    pub id: String,
    /// One of [`kind`].
    pub kind: String,
    /// One of [`severity`].
    pub severity: String,
    /// Wallet address / actor implicated, if known.
    pub actor: Option<String>,
    /// Human-readable description.
    pub message: String,
    /// For declared breaches: the POPIA 72-hour notification deadline.
    pub notify_deadline: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl SecurityAlert {
    /// Construct a detector-generated alert.
    pub fn detected(kind: &str, severity: &str, actor: Option<String>, message: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            kind: kind.to_string(),
            severity: severity.to_string(),
            actor,
            message,
            notify_deadline: None,
            created_at: Utc::now(),
        }
    }

    /// Construct a manually-declared breach alert with a 72-hour notify clock.
    pub fn declared(actor: Option<String>, message: String) -> Self {
        let now = Utc::now();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            kind: kind::BREACH_DECLARED.to_string(),
            severity: severity::CRITICAL.to_string(),
            actor,
            message,
            notify_deadline: Some(now + Duration::hours(72)),
            created_at: now,
        }
    }
}

/// Per-actor sliding-window counter shared by both detectors.
#[derive(Debug, Clone)]
pub struct ActorWindow {
    window_start: DateTime<Utc>,
    failed_auths: u32,
    distinct_patients: HashSet<String>,
}

impl ActorWindow {
    pub fn fresh(now: DateTime<Utc>) -> Self {
        Self {
            window_start: now,
            failed_auths: 0,
            distinct_patients: HashSet::new(),
        }
    }

    /// Reset the window if it has aged out.
    fn roll(&mut self, now: DateTime<Utc>) {
        if now - self.window_start > Duration::seconds(WINDOW_SECS) {
            *self = Self::fresh(now);
        }
    }

    /// Record a failed auth; returns `true` when the threshold is first crossed.
    pub fn record_failed_auth(&mut self, now: DateTime<Utc>) -> bool {
        self.roll(now);
        self.failed_auths += 1;
        self.failed_auths == FAILED_AUTH_THRESHOLD
    }

    /// Record an access to a patient; returns `true` when the distinct-patient
    /// threshold is first crossed.
    pub fn record_access(&mut self, now: DateTime<Utc>, patient_id: &str) -> bool {
        self.roll(now);
        let was_below = self.distinct_patients.len() < ABNORMAL_ACCESS_THRESHOLD;
        self.distinct_patients.insert(patient_id.to_string());
        was_below && self.distinct_patients.len() >= ABNORMAL_ACCESS_THRESHOLD
    }
}

impl Default for ActorWindow {
    fn default() -> Self {
        Self::fresh(Utc::now())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_auth_trips_at_threshold() {
        let now = Utc::now();
        let mut w = ActorWindow::fresh(now);
        for _ in 0..(FAILED_AUTH_THRESHOLD - 1) {
            assert!(!w.record_failed_auth(now));
        }
        assert!(w.record_failed_auth(now)); // Nth attempt trips
        assert!(!w.record_failed_auth(now)); // already tripped, no re-fire
    }

    #[test]
    fn abnormal_access_trips_on_distinct_patients() {
        let now = Utc::now();
        let mut w = ActorWindow::fresh(now);
        for i in 0..(ABNORMAL_ACCESS_THRESHOLD - 1) {
            assert!(!w.record_access(now, &format!("p{i}")));
        }
        assert!(w.record_access(now, "p-final"));
    }

    #[test]
    fn repeated_same_patient_does_not_trip() {
        let now = Utc::now();
        let mut w = ActorWindow::fresh(now);
        for _ in 0..(ABNORMAL_ACCESS_THRESHOLD + 5) {
            assert!(!w.record_access(now, "same-patient"));
        }
    }

    #[test]
    fn declared_breach_sets_notify_deadline() {
        let alert = SecurityAlert::declared(Some("5Grw".into()), "laptop stolen".into());
        assert_eq!(alert.kind, kind::BREACH_DECLARED);
        assert!(alert.notify_deadline.is_some());
    }
}
