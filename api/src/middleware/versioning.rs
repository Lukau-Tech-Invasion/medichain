//! API version routing (Phase 9.1).
//!
//! The api-design skill mandates `/api/v1/` path versioning, but the ~130 route
//! handlers register absolute `/api/...` paths via attribute macros. Rather than
//! churn every handler, this middleware rewrites an inbound `/api/v1/...` path to
//! `/api/...` *before routing*, so both the versioned and legacy prefixes resolve
//! to the same handlers. New versions can later diverge by branching here.

use actix_web::{
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    http::Uri,
    Error,
};
use futures::future::{ok, LocalBoxFuture, Ready};
use std::rc::Rc;

pub struct ApiVersionMiddleware;

impl<S, B> Transform<S, ServiceRequest> for ApiVersionMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Transform = ApiVersionMiddlewareService<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(ApiVersionMiddlewareService {
            service: Rc::new(service),
        })
    }
}

pub struct ApiVersionMiddlewareService<S> {
    service: Rc<S>,
}

/// Rewrite `/api/v1` and `/api/v1/...` to `/api` / `/api/...`, preserving query.
/// Returns `None` if no rewrite applies.
fn rewrite_v1(uri: &Uri) -> Option<Uri> {
    let rest = uri.path().strip_prefix("/api/v1")?;
    if !(rest.is_empty() || rest.starts_with('/')) {
        return None; // e.g. "/api/v1foo" must not match
    }
    let query = uri.query().map(|q| format!("?{q}")).unwrap_or_default();
    format!("/api{}{}", rest, query).parse::<Uri>().ok()
}

impl<S, B> Service<ServiceRequest> for ApiVersionMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, mut req: ServiceRequest) -> Self::Future {
        if let Some(new_uri) = rewrite_v1(req.uri()) {
            req.head_mut().uri = new_uri;
        }
        let fut = self.service.call(req);
        Box::pin(async move { fut.await })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_versioned_paths() {
        let u: Uri = "/api/v1/patients?page=2".parse().unwrap();
        assert_eq!(rewrite_v1(&u).unwrap().to_string(), "/api/patients?page=2");

        let bare: Uri = "/api/v1".parse().unwrap();
        assert_eq!(rewrite_v1(&bare).unwrap().path(), "/api");
    }

    #[test]
    fn leaves_other_paths_untouched() {
        assert!(rewrite_v1(&"/api/patients".parse::<Uri>().unwrap()).is_none());
        assert!(rewrite_v1(&"/api/v1foo".parse::<Uri>().unwrap()).is_none());
        assert!(rewrite_v1(&"/health".parse::<Uri>().unwrap()).is_none());
    }
}
