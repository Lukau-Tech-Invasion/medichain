//! Prometheus metrics + request instrumentation (Phase 8.2).
//!
//! Exposes a global registry with two core series:
//! - `http_requests_total{method,path,status}` — request counter.
//! - `http_request_duration_seconds{method,path}` — latency histogram (feeds the
//!   p95 budgets in `docs/PERFORMANCE_BUDGETS.md`, e.g. the emergency-access SLA).
//!
//! [`MetricsMiddleware`] times every request and labels it by the **matched
//! route pattern** (not the raw path) to keep label cardinality bounded — NASA
//! Power-of-10 "no unbounded growth". The encoded text is served by
//! `metrics_endpoint` at `GET /api/metrics` (already in the signature-auth
//! bypass list; firewall it to your scraper in production).

use actix_web::{
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    Error, HttpResponse, Responder,
};
use futures::future::{ok, LocalBoxFuture, Ready};
use prometheus::{
    Encoder, HistogramOpts, HistogramVec, IntCounterVec, Opts, Registry, TextEncoder,
};
use std::rc::Rc;
use std::sync::OnceLock;
use std::time::Instant;

/// Process-wide metrics handle.
pub struct Metrics {
    pub registry: Registry,
    pub http_requests_total: IntCounterVec,
    pub http_request_duration_seconds: HistogramVec,
}

static METRICS: OnceLock<Metrics> = OnceLock::new();

/// Lazily-initialized global metrics. Safe to call from any thread.
pub fn metrics() -> &'static Metrics {
    METRICS.get_or_init(|| {
        let registry = Registry::new();

        let http_requests_total = IntCounterVec::new(
            Opts::new("http_requests_total", "Total HTTP requests processed"),
            &["method", "path", "status"],
        )
        .expect("valid counter opts");

        // Buckets tuned around the API's sub-second budgets up to a few seconds.
        let http_request_duration_seconds = HistogramVec::new(
            HistogramOpts::new(
                "http_request_duration_seconds",
                "HTTP request latency in seconds",
            )
            .buckets(vec![
                0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.4, 0.5, 1.0, 2.5, 5.0,
            ]),
            &["method", "path"],
        )
        .expect("valid histogram opts");

        registry
            .register(Box::new(http_requests_total.clone()))
            .expect("register counter");
        registry
            .register(Box::new(http_request_duration_seconds.clone()))
            .expect("register histogram");

        Metrics {
            registry,
            http_requests_total,
            http_request_duration_seconds,
        }
    })
}

static PROCESS_START: OnceLock<Instant> = OnceLock::new();

/// Marks the process start instant. Idempotent; the first call wins.
///
/// Called from `main` so uptime is measured from the point the server began
/// serving, not from whenever a dashboard first asked.
pub fn mark_process_start() {
    let _ = PROCESS_START.set(Instant::now());
}

/// Seconds this process has been running, or `None` before `mark_process_start`.
pub fn uptime_seconds() -> Option<u64> {
    PROCESS_START.get().map(|t| t.elapsed().as_secs())
}

/// Snapshot of the operational telemetry an admin dashboard needs.
///
/// Every field here was previously a literal on the dashboard endpoint —
/// `avg_latency_ms: 45` and `system_uptime: 99.98` were reported unchanged
/// while the service was degraded, which is worse than reporting nothing. They
/// are now read from the same counters the Prometheus scrape serves, so the
/// dashboard and the scrape cannot disagree.
#[derive(Debug, Clone, Copy, Default)]
pub struct TelemetrySnapshot {
    /// Mean request latency in milliseconds across all routes, or `None` before
    /// the first request has been observed.
    pub avg_latency_ms: Option<f64>,
    /// Share of responses that were not 5xx, as a percentage. `None` until at
    /// least one request has been served — 100% from a zero sample is a claim,
    /// not a measurement.
    pub availability_percent: Option<f64>,
    /// Requests observed since process start.
    pub total_requests: u64,
    /// Responses with a 5xx status since process start.
    pub server_errors: u64,
}

/// Reads the live counters into a [`TelemetrySnapshot`].
pub fn telemetry_snapshot() -> TelemetrySnapshot {
    let families = metrics().registry.gather();

    let mut latency_sum = 0.0_f64;
    let mut latency_count = 0_u64;
    let mut total_requests = 0_u64;
    let mut server_errors = 0_u64;

    for family in &families {
        match family.get_name() {
            "http_request_duration_seconds" => {
                for metric in family.get_metric() {
                    let h = metric.get_histogram();
                    latency_sum += h.get_sample_sum();
                    latency_count += h.get_sample_count();
                }
            }
            "http_requests_total" => {
                for metric in family.get_metric() {
                    let value = metric.get_counter().get_value() as u64;
                    total_requests += value;
                    let is_server_error = metric
                        .get_label()
                        .iter()
                        .any(|l| l.get_name() == "status" && l.get_value().starts_with('5'));
                    if is_server_error {
                        server_errors += value;
                    }
                }
            }
            _ => {}
        }
    }

    TelemetrySnapshot {
        avg_latency_ms: (latency_count > 0).then(|| (latency_sum / latency_count as f64) * 1000.0),
        availability_percent: (total_requests > 0)
            .then(|| ((total_requests - server_errors) as f64 / total_requests as f64) * 100.0),
        total_requests,
        server_errors,
    }
}

/// `GET /api/metrics` — Prometheus exposition format.
/// Compare two byte strings without short-circuiting on the first difference.
///
/// A plain `==` on a secret leaks its contents through timing: the comparison
/// returns sooner the earlier it finds a mismatch, so an attacker can recover
/// the token one byte at a time. Length is folded into the result rather than
/// checked first, for the same reason.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = (a.len() ^ b.len()) as u8;
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        diff |= x ^ y;
    }
    diff == 0
}

pub async fn metrics_endpoint(
    data: actix_web::web::Data<crate::AppState>,
    http_req: actix_web::HttpRequest,
) -> impl Responder {
    // Metrics describe internal operational behaviour — request volumes, error
    // rates, latency by route — which is reconnaissance for an attacker and was
    // previously readable by anyone. Require a known caller. `METRICS_TOKEN`
    // exists because Prometheus scrapes without a user identity; when it is set,
    // a matching `Authorization: Bearer` is accepted instead.
    let authorized = match std::env::var("METRICS_TOKEN") {
        Ok(token) if !token.is_empty() => http_req
            .headers()
            .get(actix_web::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(|presented| constant_time_eq(presented.as_bytes(), token.as_bytes()))
            .unwrap_or(false),
        // RESOLVE the caller, don't just observe a header. A first cut of this
        // used `get_current_user_id(...).is_some()`, which is satisfied by
        // `X-User-Id: anything` — the precise "authentication mistaken for
        // authorization" defect this whole pass exists to remove. The suite's
        // forged-identity assertion caught it.
        _ => crate::support::get_current_user_id(&http_req)
            .and_then(|id| crate::support::get_user(&data, &id))
            .is_some(),
    };
    if !authorized {
        return HttpResponse::Unauthorized().json(serde_json::json!({
            "error": {
                "code": "UNAUTHORIZED",
                "message": "Metrics require an authenticated caller or METRICS_TOKEN bearer token."
            }
        }));
    }

    let mut buffer = Vec::new();
    let encoder = TextEncoder::new();
    let families = metrics().registry.gather();
    if encoder.encode(&families, &mut buffer).is_err() {
        return HttpResponse::InternalServerError().body("failed to encode metrics");
    }
    HttpResponse::Ok()
        .content_type("text/plain; version=0.0.4")
        .body(buffer)
}

/// Actix middleware factory that records per-request metrics.
pub struct MetricsMiddleware;

impl<S, B> Transform<S, ServiceRequest> for MetricsMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Transform = MetricsMiddlewareService<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(MetricsMiddlewareService {
            service: Rc::new(service),
        })
    }
}

pub struct MetricsMiddlewareService<S> {
    service: Rc<S>,
}

impl<S, B> Service<ServiceRequest> for MetricsMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let service = self.service.clone();
        let method = req.method().as_str().to_owned();
        let start = Instant::now();

        Box::pin(async move {
            let res = service.call(req).await?;

            // Prefer the registered route pattern to bound label cardinality.
            //
            // Unmatched requests collapse to the single literal "<unmatched>"
            // rather than their raw path. Falling back to the raw path let any
            // caller mint unlimited distinct label values by requesting
            // /aaa, /aab, /aac… — unbounded Prometheus cardinality and memory
            // growth from outside the trust boundary — and raw 404 paths can
            // themselves carry identifiers (e.g. a mistyped /api/patients/<id>),
            // putting them in a scrape endpoint.
            let path = res
                .request()
                .match_pattern()
                .unwrap_or_else(|| "<unmatched>".to_owned());
            let status = res.status().as_u16().to_string();
            let elapsed = start.elapsed().as_secs_f64();

            let m = metrics();
            m.http_requests_total
                .with_label_values(&[&method, &path, &status])
                .inc();
            m.http_request_duration_seconds
                .with_label_values(&[&method, &path])
                .observe(elapsed);

            Ok(res)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metrics_registry_initializes_and_gathers() {
        let m = metrics();
        m.http_requests_total
            .with_label_values(&["GET", "/api/health", "200"])
            .inc();
        let families = m.registry.gather();
        assert!(!families.is_empty());
    }
}
