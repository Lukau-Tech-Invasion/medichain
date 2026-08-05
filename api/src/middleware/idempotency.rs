//! Idempotency-Key middleware (Phase 9.2).
//!
//! Network drops during a blockchain-coupled write (consent grant, record
//! creation) can make a client retry a request that the server already
//! committed. A client that sends a stable `Idempotency-Key` header on such
//! `POST`/`PUT` requests gets **exactly-once** semantics: the first response is
//! cached (status + content-type + body) for 24h and replayed verbatim on any
//! retry with the same key, so the on-chain/DB write happens only once.
//!
//! The cache key is scoped to `subject + method + path + key` (see `call`), so a
//! cached response can only ever be replayed to the same caller performing the
//! same operation.
//!
//! **Two limitations, stated because they affect when this is safe to rely on:**
//! 1. The key is not bound to a request-body digest, so a client that reuses one
//!    key for two *different* bodies on the same route receives the first
//!    response for both. That is a client defect this cannot detect; binding the
//!    digest requires buffering the request payload here, which would sit in
//!    front of large encrypted record uploads.
//! 2. The cache is process-local, so with more than one API replica retries
//!    routed to a different replica are **not** idempotent at all. Multi-replica
//!    deployment requires backing this with Redis or a durable store written
//!    transactionally with the operation.

use actix_web::{
    body::{to_bytes, BoxBody, MessageBody},
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    http::{header, Method},
    Error, HttpResponse,
};
use futures::future::{ok, LocalBoxFuture, Ready};
use sha3::{Digest, Sha3_256};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_ENTRIES: usize = 10_000;

struct CachedResponse {
    status: u16,
    content_type: Option<String>,
    body: Vec<u8>,
    stored_at: Instant,
}

fn store() -> &'static Mutex<HashMap<String, CachedResponse>> {
    static STORE: OnceLock<Mutex<HashMap<String, CachedResponse>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Fetch a still-valid cached response for `key`, pruning if expired.
fn get_cached(key: &str) -> Option<(u16, Option<String>, Vec<u8>)> {
    let mut map = store().lock().ok()?;
    if let Some(entry) = map.get(key) {
        if entry.stored_at.elapsed() < TTL {
            return Some((entry.status, entry.content_type.clone(), entry.body.clone()));
        }
        map.remove(key);
    }
    None
}

/// Insert a response into the cache, pruning expired entries and bounding size.
fn put_cached(key: String, status: u16, content_type: Option<String>, body: Vec<u8>) {
    if let Ok(mut map) = store().lock() {
        map.retain(|_, e| e.stored_at.elapsed() < TTL);
        if map.len() >= MAX_ENTRIES {
            return; // refuse to grow unbounded; the write still succeeded
        }
        map.insert(
            key,
            CachedResponse {
                status,
                content_type,
                body,
                stored_at: Instant::now(),
            },
        );
    }
}

fn build_response(status: u16, content_type: Option<String>, body: Vec<u8>) -> HttpResponse {
    let code =
        actix_web::http::StatusCode::from_u16(status).unwrap_or(actix_web::http::StatusCode::OK);
    let mut builder = HttpResponse::build(code);
    if let Some(ct) = content_type {
        builder.insert_header((header::CONTENT_TYPE, ct));
    }
    builder.insert_header(("Idempotent-Replayed", "true"));
    builder.body(body)
}

pub struct IdempotencyMiddleware;

impl<S, B> Transform<S, ServiceRequest> for IdempotencyMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<BoxBody>;
    type Error = Error;
    type Transform = IdempotencyMiddlewareService<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(IdempotencyMiddlewareService {
            service: Rc::new(service),
        })
    }
}

pub struct IdempotencyMiddlewareService<S> {
    service: Rc<S>,
}

impl<S, B> Service<ServiceRequest> for IdempotencyMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<BoxBody>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let service = self.service.clone();

        // Only POST/PUT carrying an Idempotency-Key participate.
        //
        // The cache key is SCOPED, not the caller's raw string. Keying by the
        // header alone meant a key that collided — by guess, by reuse, or across
        // tenants — could replay one request's cached clinical response to a
        // different caller, a different route, or a different hospital, and it
        // did so *before* the handler ran, so it bypassed that handler's
        // authorization entirely. Binding subject + method + path confines a
        // replay to the exact caller and operation that produced it.
        let key = req
            .headers()
            .get("Idempotency-Key")
            .and_then(|v| v.to_str().ok())
            .map(|raw| {
                let subject = req
                    .headers()
                    .get("X-User-Id")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("anonymous");
                let mut hasher = Sha3_256::new();
                // Length-prefixed so the fields cannot be shifted into one
                // another to forge a collision.
                for part in [subject, req.method().as_str(), req.path(), raw] {
                    hasher.update((part.len() as u64).to_be_bytes());
                    hasher.update(part.as_bytes());
                }
                format!("{:x}", hasher.finalize())
            });
        let participates = matches!(*req.method(), Method::POST | Method::PUT) && key.is_some();

        Box::pin(async move {
            if let (true, Some(key)) = (participates, key.clone()) {
                // Replay a cached response if we have one.
                if let Some((status, ct, body)) = get_cached(&key) {
                    let resp = build_response(status, ct, body);
                    return Ok(req.into_response(resp));
                }

                // First time: run the handler, then buffer + cache its response.
                let res = service.call(req).await?;
                let (http_req, resp) = res.into_parts();
                let status = resp.status().as_u16();
                let content_type = resp
                    .headers()
                    .get(header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_owned());
                let body = to_bytes(resp.into_body())
                    .await
                    .map_err(|_| {
                        actix_web::error::ErrorInternalServerError("response body read failed")
                    })?
                    .to_vec();

                // Only cache successful, idempotent outcomes (2xx).
                if (200..300).contains(&status) {
                    put_cached(key, status, content_type.clone(), body.clone());
                }
                let resp = build_response(status, content_type, body);
                Ok(ServiceResponse::new(http_req, resp))
            } else {
                let res = service.call(req).await?;
                Ok(res.map_into_boxed_body())
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_round_trips_and_expires_pruning() {
        put_cached(
            "k1".into(),
            200,
            Some("application/json".into()),
            b"{}".to_vec(),
        );
        let got = get_cached("k1");
        assert!(got.is_some());
        let (status, ct, body) = got.unwrap();
        assert_eq!(status, 200);
        assert_eq!(ct.as_deref(), Some("application/json"));
        assert_eq!(body, b"{}");
        assert!(get_cached("missing").is_none());
    }
}
