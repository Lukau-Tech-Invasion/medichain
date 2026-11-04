//! The patient surface: a patient session reaches only the routes the patient
//! apps use (docs/PATIENT_SURFACE_PLAN.md, step 1 of separating the two apps).
//!
//! Authorization here is otherwise decided inside each handler (HZ-010 in
//! `authorized_user.rs`), so one handler that forgets to refuse a patient
//! exposes hospital data to anyone who registers as one. This middleware
//! refuses a patient session on every route NOT listed below, before routing
//! reaches a handler. A route added tomorrow is closed to patients on the day
//! it is added; opening one is an explicit line in this file.
//!
//! It is a second wall, not a replacement: every listed route still scopes the
//! caller to their own records in its handler.
//!
//! Who counts as a patient is decided fail-closed: the server-side account
//! role, OR the signed token's role, OR a `patient` token context. A staff
//! member who is also a patient keeps the hospital portal through a staff login.

use actix_web::dev::ResourceDef;
use actix_web::{
    body::EitherBody,
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    http::Method,
    web, Error, HttpResponse,
};
use futures::future::{ok, LocalBoxFuture, Ready};
use std::collections::HashSet;
use std::rc::Rc;
use std::sync::OnceLock;

use crate::middleware::error_handling::error_envelope_json;
use crate::state::AppState;

/// Answered when a patient session asks for anything else.
pub const PATIENT_SURFACE_ONLY: &str = "PATIENT_SURFACE_ONLY";

/// `(method, registered route pattern)` pairs a patient session may call:
/// what `client/patient-app` and the Expo app in `mobile-examples/` call,
/// through `@medichain/shared` or directly, plus session plumbing.
/// `scripts/check-patient-surface.py` keeps this in step with both apps.
pub const PATIENT_SURFACE: &[(&str, &str)] = &[
    // access-logs
    ("GET", "/api/access-logs/{patient_id}"),
    // access
    ("GET", "/api/access/patient/{patient_id}/grants"),
    ("GET", "/api/access/patient/{patient_id}/requests"),
    // appointments
    ("GET", "/api/appointments/patient/{patient_id}"),
    ("GET", "/api/appointments/slots/{provider_id}/{date}"),
    // auth
    ("GET", "/api/auth/assurance"),
    ("GET", "/api/auth/me"),
    ("GET", "/api/auth/mfa/status"),
    // cds
    ("GET", "/api/cds/patient/{patient_id}/alerts"),
    // clinical
    ("GET", "/api/clinical/family-history"),
    ("GET", "/api/clinical/immunizations"),
    ("GET", "/api/clinical/patient/{patient_id}/admissions"),
    ("GET", "/api/clinical/patient/{patient_id}/ama-discharges"),
    ("GET", "/api/clinical/patient/{patient_id}/blood"),
    ("GET", "/api/clinical/patient/{patient_id}/care-plans"),
    ("GET", "/api/clinical/patient/{patient_id}/consults"),
    ("GET", "/api/clinical/patient/{patient_id}/discharges"),
    ("GET", "/api/clinical/patient/{patient_id}/emergency-care"),
    ("GET", "/api/clinical/patient/{patient_id}/ems-handoffs"),
    ("GET", "/api/clinical/patient/{patient_id}/ems-runs"),
    ("GET", "/api/clinical/patient/{patient_id}/gcs"),
    (
        "GET",
        "/api/clinical/patient/{patient_id}/history-physicals",
    ),
    ("GET", "/api/clinical/patient/{patient_id}/imaging"),
    ("GET", "/api/clinical/patient/{patient_id}/intake-output"),
    (
        "GET",
        "/api/clinical/patient/{patient_id}/medication-administrations",
    ),
    ("GET", "/api/clinical/patient/{patient_id}/pathology"),
    (
        "GET",
        "/api/clinical/patient/{patient_id}/pharmacy-decisions",
    ),
    ("GET", "/api/clinical/patient/{patient_id}/procedures"),
    ("GET", "/api/clinical/patient/{patient_id}/progress-notes"),
    ("GET", "/api/clinical/patient/{patient_id}/soap"),
    ("GET", "/api/clinical/patient/{patient_id}/triage"),
    ("GET", "/api/clinical/patient/{patient_id}/vitals"),
    ("GET", "/api/clinical/patient/{patient_id}/wounds"),
    // consent
    ("GET", "/api/consent/patient/{patient_id}"),
    ("GET", "/api/consent/types"),
    // e-prescriptions
    ("GET", "/api/e-prescriptions/patient/{patient_id}"),
    // events
    ("GET", "/api/events"),
    // family
    ("GET", "/api/family/my-groups"),
    // guardians
    ("GET", "/api/guardians/mine"),
    // health
    ("GET", "/api/health"),
    // identity
    ("GET", "/api/identity/my-medical-identities"),
    // insurance
    ("GET", "/api/insurance/cards/{id}/image/{side}"),
    ("GET", "/api/insurance/cards/{patient_id}"),
    ("GET", "/api/insurance/claims/patient/{patient_id}"),
    // lab-trends
    ("GET", "/api/lab-trends/patient/{patient_id}"),
    // lab
    ("GET", "/api/lab/patient/{patient_id}"),
    // medical-id
    ("GET", "/api/medical-id/{patient_id}"),
    ("GET", "/api/medical-id/{patient_id}/qr"),
    // messages
    ("GET", "/api/messages"),
    ("GET", "/api/messages/attachments/{attachment_id}"),
    // mobile
    ("GET", "/api/mobile/devices"),
    // my-records
    ("GET", "/api/my-records"),
    // nfc
    ("GET", "/api/nfc/card/{patient_id}"),
    // notifications
    ("GET", "/api/notifications"),
    // patients
    ("GET", "/api/patients/{patient_id}"),
    ("PUT", "/api/patients/{patient_id}/demographics"),
    (
        "GET",
        "/api/patients/{patient_id}/emergency-capsule/access-log",
    ),
    ("PUT", "/api/patients/{patient_id}/emergency-contacts"),
    ("GET", "/api/patients/{patient_id}/records-summary"),
    ("GET", "/api/patients/{patient_id}/refill-requests"),
    ("GET", "/api/patients/{patient_id}/verify"),
    // providers
    ("GET", "/api/providers"),
    // records
    ("GET", "/api/records/{content_hash}/download"),
    ("GET", "/api/records/{patient_id}"),
    // reminders
    ("GET", "/api/reminders/adherence/{patient_id}"),
    ("GET", "/api/reminders/medication/{patient_id}"),
    // settings
    ("GET", "/api/settings"),
    // symptoms
    ("GET", "/api/symptoms/{patient_id}"),
    ("GET", "/api/symptoms/{session_id}"),
    // The patient's own symptom-checker sessions (rule 10). No screen reads it
    // yet; the role journey does, and a patient must be able to.
    ("GET", "/api/symptoms/history/{patient_id}"),
    // sync
    ("GET", "/api/sync/conflicts"),
    ("GET", "/api/sync/devices"),
    ("GET", "/api/sync/download/{patient_id}"),
    // telehealth
    ("GET", "/api/telehealth/recordings/{recording_id}"),
    ("GET", "/api/telehealth/sessions"),
    ("GET", "/api/telehealth/sessions/{session_id}/recordings"),
    // wearables
    ("GET", "/api/wearables/alert-rules"),
    ("GET", "/api/wearables/alerts"),
    ("GET", "/api/wearables/devices"),
    ("GET", "/api/wearables/readings/{device_id}"),
    ("GET", "/api/wearables/supported"),
    // access
    ("POST", "/api/access/grants/{id}/revoke"),
    ("POST", "/api/access/requests/{id}/approve"),
    ("POST", "/api/access/requests/{id}/deny"),
    // appointments
    ("POST", "/api/appointments"),
    ("POST", "/api/appointments/{appointment_id}/check-in"),
    ("POST", "/api/appointments/{appointment_id}/status"),
    // auth
    ("POST", "/api/auth/credentials/change"),
    ("POST", "/api/auth/credentials/redeem"),
    ("POST", "/api/auth/jwt/refresh"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/logout"),
    ("POST", "/api/auth/logout-all"),
    ("POST", "/api/auth/mfa/challenge"),
    ("POST", "/api/auth/mfa/disable"),
    ("POST", "/api/auth/mfa/enroll"),
    ("POST", "/api/auth/mfa/verify"),
    ("POST", "/api/auth/transaction/challenge"),
    ("POST", "/api/auth/transaction/verify"),
    // clinical
    ("POST", "/api/clinical/satisfaction-survey"),
    // consent
    ("POST", "/api/consent/sign"),
    ("POST", "/api/consent/{id}/revoke"),
    // e-prescriptions
    (
        "POST",
        "/api/e-prescriptions/{prescription_id}/refill-requests",
    ),
    // family
    ("POST", "/api/family/groups"),
    ("POST", "/api/family/groups/{group_id}/members"),
    // insurance
    ("POST", "/api/insurance/cards"),
    ("POST", "/api/insurance/cards/{id}/image"),
    ("POST", "/api/insurance/verify"),
    // medical-id
    ("POST", "/api/medical-id/{patient_id}/preferences"),
    // messages
    ("POST", "/api/messages/send"),
    ("POST", "/api/messages/{message_id}/attachments"),
    ("POST", "/api/messages/{message_id}/read"),
    // mobile
    ("POST", "/api/mobile/devices/{id}/revoke"),
    // nfc
    ("POST", "/api/nfc/verify-mine"),
    // notifications
    ("POST", "/api/notifications/read"),
    ("POST", "/api/notifications/register-device"),
    ("POST", "/api/notifications/{key}/read"),
    ("POST", "/api/notifications/{key}/remove"),
    // platform
    ("POST", "/api/platform/languages/preference"),
    // refill-requests
    ("POST", "/api/refill-requests/{request_id}/cancel"),
    // reminders
    ("POST", "/api/reminders/adherence"),
    ("POST", "/api/reminders/medication"),
    // settings
    ("POST", "/api/settings"),
    // symptoms
    ("POST", "/api/symptoms/analyze"),
    ("POST", "/api/symptoms/log"),
    ("POST", "/api/symptoms/start"),
    ("POST", "/api/symptoms/{patient_id}/{entry_id}/retract"),
    ("POST", "/api/symptoms/{session_id}/answers"),
    // sync
    ("POST", "/api/sync/conflicts/{conflict_id}/resolve"),
    // telehealth
    ("POST", "/api/telehealth/sessions/{session_id}/event"),
    ("POST", "/api/telehealth/sessions/{session_id}/join"),
    ("POST", "/api/telehealth/sessions/{session_id}/recording"),
    (
        "POST",
        "/api/telehealth/sessions/{session_id}/recording-consent",
    ),
    // wearables
    ("POST", "/api/wearables/alerts/rules"),
    ("POST", "/api/wearables/devices"),
    ("POST", "/api/wearables/devices/{device_id}/disconnect"),
    // family
    (
        "DELETE",
        "/api/family/groups/{group_id}/members/{patient_id}",
    ),
    // insurance
    ("DELETE", "/api/insurance/cards/{id}"),
    // reminders
    ("DELETE", "/api/reminders/medication/{reminder_id}"),
];

// `REGISTERED_ROUTES`: every `(method, pattern)` the API registers, generated
// from the route attributes by `build.rs`.
include!(concat!(env!("OUT_DIR"), "/registered_routes.rs"));

/// A route pattern with its parameter names erased: `/a/{id}/b` -> `/a/{}/b`.
/// Two handlers may name the same segment differently (`{patient_id}` /
/// `{session_id}`); the router treats them alike.
fn shape(pattern: &str) -> String {
    let mut out = String::with_capacity(pattern.len());
    let mut in_param = false;
    for c in pattern.chars() {
        match c {
            '{' => {
                in_param = true;
                out.push_str("{}");
            }
            '}' => in_param = false,
            _ if !in_param => out.push(c),
            _ => {}
        }
    }
    out
}

fn surface() -> &'static HashSet<(&'static str, String)> {
    static SURFACE: OnceLock<HashSet<(&'static str, String)>> = OnceLock::new();
    SURFACE.get_or_init(|| {
        PATIENT_SURFACE
            .iter()
            .map(|(m, p)| (*m, shape(p)))
            .collect()
    })
}

/// Whether `(method, pattern)` is on the patient surface.
fn listed(method: &str, pattern: &str) -> bool {
    surface().contains(&(method, shape(pattern)))
}

/// Every registered route, compiled once, with whether it is listed.
fn route_table() -> &'static [(&'static str, ResourceDef, bool)] {
    static TABLE: OnceLock<Vec<(&'static str, ResourceDef, bool)>> = OnceLock::new();
    TABLE.get_or_init(|| {
        REGISTERED_ROUTES
            .iter()
            .map(|(m, p)| (*m, ResourceDef::new(*p), listed(m, p)))
            .collect()
    })
}

/// Whether a patient session may make this request.
///
/// The router sends a request to the first registered route that matches
/// both its path and its method, and registration order is not visible here.
/// So a request passes only when EVERY route that could take it is listed:
/// `GET /api/patients/list` also fits `GET /api/patients/{patient_id}`, and
/// the listed one must not open the unlisted one. A path no route takes is
/// refused too.
pub fn allows(method: &Method, path: &str) -> bool {
    let method = if method == Method::HEAD {
        "GET"
    } else {
        method.as_str()
    };
    let mut candidates = route_table()
        .iter()
        .filter(|(m, def, _)| *m == method && def.is_match(path))
        .peekable();
    candidates.peek().is_some() && candidates.all(|(_, _, ok)| *ok)
}

/// The caller's user id when the request carries a valid access token for a
/// patient; `None` for anonymous requests and staff sessions.
fn patient_caller(req: &ServiceRequest) -> Option<String> {
    let header = req.headers().get("Authorization")?.to_str().ok()?;
    let claims = crate::security::jwt::bearer_access_subject(header)?;
    let by_token =
        claims.role.eq_ignore_ascii_case("patient") || claims.context.as_deref() == Some("patient");
    let by_account = req
        .app_data::<web::Data<AppState>>()
        .and_then(|data| crate::support::get_user(data, &claims.sub))
        .is_some_and(|user| user.role == crate::types::Role::Patient);
    (by_token || by_account).then_some(claims.sub)
}

pub struct PatientSurfaceMiddleware;

impl<S, B> Transform<S, ServiceRequest> for PatientSurfaceMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Transform = PatientSurfaceMiddlewareService<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(PatientSurfaceMiddlewareService {
            service: Rc::new(service),
        })
    }
}

pub struct PatientSurfaceMiddlewareService<S> {
    service: Rc<S>,
}

impl<S, B> Service<ServiceRequest> for PatientSurfaceMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let service = Rc::clone(&self.service);
        Box::pin(async move {
            if let Some(user_id) = patient_caller(&req) {
                if !allows(req.method(), req.path()) {
                    log::warn!(
                        "patient surface: refused {} {} for user {}",
                        req.method(),
                        req.match_pattern().unwrap_or_default(),
                        user_id
                    );
                    let response = HttpResponse::Forbidden().json(error_envelope_json(
                        PATIENT_SURFACE_ONLY,
                        "This is not available to a patient account",
                        None,
                    ));
                    return Ok(req.into_response(response).map_into_right_body());
                }
            }
            let res = service.call(req).await?;
            Ok(res.map_into_left_body())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{test_fixtures, AppState, Role};
    use actix_web::{test as actix_test, App};

    /// A path the pattern matches, every parameter filled in.
    fn concrete(pattern: &str) -> String {
        shape(pattern).replace("{}", "zz9")
    }

    /// Status for every registered route as `user`, through the real route
    /// table, with every handler replaced by a 204 so only this middleware can
    /// refuse.
    async fn statuses(user: &str) -> Vec<u16> {
        let state = AppState::new();
        test_fixtures::register(&state, "surface-patient", Role::Patient);
        test_fixtures::register(&state, "surface-doctor", Role::Doctor);
        let app = actix_test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .wrap_fn(|req, _| {
                    std::future::ready(Ok(req.into_response(HttpResponse::NoContent().finish())))
                })
                .wrap(PatientSurfaceMiddleware)
                .configure(crate::routes::configure),
        )
        .await;
        let mut out = Vec::with_capacity(REGISTERED_ROUTES.len());
        for (method, pattern) in REGISTERED_ROUTES {
            let req = actix_test::TestRequest::default()
                .method(Method::from_bytes(method.as_bytes()).unwrap())
                .uri(&concrete(pattern))
                .insert_header(test_fixtures::as_user(user))
                .to_request();
            out.push(actix_test::call_service(&app, req).await.status().as_u16());
        }
        out
    }

    #[actix_web::test]
    async fn a_patient_reaches_exactly_the_listed_routes() {
        assert!(
            REGISTERED_ROUTES.len() > 400,
            "route table holds only {}",
            REGISTERED_ROUTES.len()
        );
        let got = statuses("surface-patient").await;
        let mut leaked = Vec::new();
        let mut blocked = Vec::new();
        for ((method, pattern), status) in REGISTERED_ROUTES.iter().zip(got) {
            match (listed(method, pattern), status == 403) {
                (false, false) => leaked.push(format!("{method} {pattern} -> {status}")),
                (true, true) => blocked.push(format!("{method} {pattern}")),
                _ => {}
            }
        }
        assert!(
            leaked.is_empty(),
            "patient NOT refused on unlisted routes:\n{}",
            leaked.join("\n")
        );
        assert!(
            blocked.is_empty(),
            "patient refused on listed routes:\n{}",
            blocked.join("\n")
        );
    }

    #[actix_web::test]
    async fn staff_sessions_are_untouched() {
        let got = statuses("surface-doctor").await;
        let refused: Vec<_> = REGISTERED_ROUTES
            .iter()
            .zip(got)
            .filter(|(_, status)| *status == 403)
            .map(|((m, p), _)| format!("{m} {p}"))
            .collect();
        assert!(refused.is_empty(), "staff refused:\n{}", refused.join("\n"));
    }

    #[test]
    fn every_listed_route_is_registered() {
        let registered: HashSet<(&str, String)> = REGISTERED_ROUTES
            .iter()
            .map(|(m, p)| (*m, shape(p)))
            .collect();
        let stale: Vec<_> = PATIENT_SURFACE
            .iter()
            .filter(|(m, p)| !registered.contains(&(*m, shape(p))))
            .collect();
        assert!(stale.is_empty(), "listed but not registered: {stale:?}");
    }

    #[actix_web::test]
    async fn a_patient_token_is_walled_even_without_an_account_record() {
        // Fail closed: the signed role claim alone is enough.
        let token =
            crate::security::jwt::issue_access_token("no-such-user", "Patient", false, None)
                .unwrap();
        let app = actix_test::init_service(
            App::new()
                .app_data(web::Data::new(AppState::new()))
                .wrap(PatientSurfaceMiddleware)
                .configure(crate::routes::configure),
        )
        .await;
        let req = actix_test::TestRequest::get()
            .uri("/api/patients/paediatric-caseload")
            .insert_header(("Authorization", format!("Bearer {token}")))
            .to_request();
        let resp = actix_test::call_service(&app, req).await;
        assert_eq!(resp.status(), 403);
        let body: serde_json::Value = actix_test::read_body_json(resp).await;
        assert_eq!(body["error"]["code"], PATIENT_SURFACE_ONLY, "{body}");
    }

    #[test]
    fn a_static_staff_route_is_not_opened_by_a_listed_parameter_route() {
        assert!(allows(&Method::GET, "/api/patients/PAT-001"));
        assert!(allows(&Method::HEAD, "/api/patients/PAT-001"));
        assert!(!allows(&Method::GET, "/api/patients/list"));
        assert!(!allows(&Method::DELETE, "/api/patients/PAT-001"));
        assert!(!allows(&Method::GET, "/api/no-such-route"));
    }
}
