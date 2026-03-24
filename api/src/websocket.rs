//! WebSocket / Server-Sent Events (SSE) module for MediChain
//!
//! Provides real-time push notifications to connected clients using SSE,
//! which works with the existing actix-web + tokio + futures dependency set
//! without requiring any additional crates.

use std::collections::HashMap;
use std::pin::Pin;
use std::sync::{Arc, RwLock};
use std::task::{Context, Poll};

use actix_web::{get, web, HttpRequest, HttpResponse};
use futures::Stream;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

// ============================================================================
// Push event type
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushEvent {
    /// One of: "cds_alert", "reminder_due", "lab_result", "notification"
    pub event_type: String,
    /// Optional patient identifier the event relates to
    pub patient_id: Option<String>,
    /// Arbitrary JSON payload
    pub payload: serde_json::Value,
    /// Unix timestamp (seconds since epoch)
    pub timestamp: i64,
}

// ============================================================================
// Session manager
// ============================================================================

/// Manages SSE client subscriptions and broadcasts push events.
pub struct WsSessionManager {
    /// Broadcast channel used to fan-out events to all connected SSE clients.
    sender: broadcast::Sender<PushEvent>,
    /// Tracks how many active SSE streams exist per wallet address.
    subscribers: Arc<RwLock<HashMap<String, u32>>>,
}

impl WsSessionManager {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(1024);
        Self {
            sender,
            subscribers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Subscribe to the broadcast channel, recording the wallet address.
    /// Returns a `Receiver` that the SSE stream will poll.
    pub fn subscribe(&self, wallet_address: &str) -> broadcast::Receiver<PushEvent> {
        let mut subs = self.subscribers.write().unwrap();
        *subs.entry(wallet_address.to_string()).or_insert(0) += 1;
        self.sender.subscribe()
    }

    /// Decrement the subscriber count for a wallet address when a connection closes.
    pub fn unsubscribe(&self, wallet_address: &str) {
        let mut subs = self.subscribers.write().unwrap();
        if let Some(count) = subs.get_mut(wallet_address) {
            if *count > 0 {
                *count -= 1;
            }
        }
    }

    /// Broadcast an event to all connected SSE clients.
    /// Send errors (no active subscribers) are silently ignored.
    pub fn push_event(&self, event: PushEvent) {
        let _ = self.sender.send(event);
    }

    /// Returns the number of wallet addresses with at least one active SSE stream.
    pub fn subscriber_count(&self) -> usize {
        self.subscribers
            .read()
            .unwrap()
            .values()
            .filter(|&&c| c > 0)
            .count()
    }
}

// ============================================================================
// SSE stream adapter
// ============================================================================

/// Wraps a `broadcast::Receiver<PushEvent>` and implements `Stream` so it can
/// be passed to `HttpResponse::streaming()`.
///
/// Polling strategy: when the channel is temporarily empty we return
/// `Poll::Pending` and schedule an immediate wake-up via a short sleep spawned
/// on the tokio runtime.  This avoids busy-looping while still delivering
/// events with low latency.
struct SseStream {
    receiver: broadcast::Receiver<PushEvent>,
}

impl Stream for SseStream {
    type Item = Result<actix_web::web::Bytes, actix_web::Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match self.receiver.try_recv() {
            Ok(event) => {
                let json = serde_json::to_string(&event).unwrap_or_default();
                let frame = format!("data: {}\n\n", json);
                Poll::Ready(Some(Ok(actix_web::web::Bytes::from(frame))))
            }
            Err(broadcast::error::TryRecvError::Empty) => {
                // Schedule a wake-up after a short delay so we do not busy-spin.
                let waker = cx.waker().clone();
                tokio::spawn(async move {
                    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                    waker.wake();
                });
                Poll::Pending
            }
            // Channel was closed (sender dropped) — signal end of stream.
            Err(_) => Poll::Ready(None),
        }
    }
}

// ============================================================================
// SSE HTTP endpoint
// ============================================================================

/// GET /api/events
///
/// Streams Server-Sent Events to the caller.  The optional `X-User-Id` request
/// header is used as the wallet address for subscription accounting.
#[get("/api/events")]
pub async fn sse_events(
    data: web::Data<crate::AppState>,
    req: HttpRequest,
) -> HttpResponse {
    let wallet_address = req
        .headers()
        .get("X-User-Id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("anonymous")
        .to_string();

    let receiver = data.ws_manager.subscribe(&wallet_address);
    let stream = SseStream { receiver };

    HttpResponse::Ok()
        .insert_header(("Content-Type", "text/event-stream"))
        .insert_header(("Cache-Control", "no-cache"))
        .insert_header(("X-Accel-Buffering", "no"))
        .streaming(stream)
}

// ============================================================================
// Helper push functions
// ============================================================================

/// Push a Clinical Decision Support alert to all connected SSE clients.
pub fn push_cds_alert(
    manager: &WsSessionManager,
    patient_id: &str,
    alert_title: &str,
    severity: &str,
) {
    manager.push_event(PushEvent {
        event_type: "cds_alert".to_string(),
        patient_id: Some(patient_id.to_string()),
        payload: serde_json::json!({
            "title": alert_title,
            "severity": severity,
            "patient_id": patient_id,
        }),
        timestamp: chrono::Utc::now().timestamp(),
    });
}

/// Push a medication reminder to all connected SSE clients.
pub fn push_reminder(
    manager: &WsSessionManager,
    patient_id: &str,
    medication_name: &str,
) {
    manager.push_event(PushEvent {
        event_type: "reminder_due".to_string(),
        patient_id: Some(patient_id.to_string()),
        payload: serde_json::json!({
            "medication": medication_name,
            "patient_id": patient_id,
            "message": format!("Time to take: {}", medication_name),
        }),
        timestamp: chrono::Utc::now().timestamp(),
    });
}
