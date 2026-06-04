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

/// `GET /api/metrics` — Prometheus exposition format.
pub async fn metrics_endpoint() -> impl Responder {
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

            // Prefer the registered route pattern to bound label cardinality;
            // fall back to the raw path for unmatched routes (404s).
            let path = res
                .request()
                .match_pattern()
                .unwrap_or_else(|| res.request().path().to_owned());
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
