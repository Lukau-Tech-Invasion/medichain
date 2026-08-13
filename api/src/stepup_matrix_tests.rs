//! H2 — privileged-operation step-up: security regression matrix.
//!
//! Campaign HZ-2026-MC1, Lane A. These tests were written **before** the
//! production fix, to establish the bypass as a reproducible failure rather
//! than an assertion in a report. The `bypass_*` tests below FAIL against the
//! pre-fix code; that failure is the evidence.
//!
//! ## The property under test
//!
//! Owner decision, 2026-08-08 (see
//! `.horizon/evidence-private/HZ-H2-STATE-MODEL/state-model-discovery.md`):
//!
//! > No **production** privileged route may be executed without a caller who is
//! > MFA-enrolled **and** has verified step-up. Non-enrollment is a refusal, not
//! > an exemption.
//!
//! This is stricter than issue #8's original wording, which only constrained
//! already-enrolled accounts and so left a never-enrolled admin unconstrained.
//!
//! ## Why the matrix is shaped this way
//!
//! MFA is two separate facts with two different homes:
//!
//! - **enrollment** — durable and server-side (`user_mfa` → `security.mfa`),
//!   queryable for *any* caller regardless of how they authenticated;
//! - **assurance** — non-durable, and expressible only as the `mfa` claim
//!   inside a JWT.
//!
//! The bypass exists precisely because the pre-fix control keys off the second
//! and never consults the first: `enforce_mfa_step_up` opens with
//! `get_current_claims(req)?`, so a caller carrying no JWT at all produces
//! `None` and skips the check entirely.
//!
//! A signature-authenticated caller (one whose `X-User-Id` the signature
//! middleware has already verified) is exactly that caller. In these in-process
//! tests there is no signature middleware, so a bare `X-User-Id` header models
//! the post-middleware state faithfully: identity established, no JWT present.
//!
//! ## Control cases are not padding
//!
//! Every deny case is paired with an allow case. A suite that only asserts
//! denial cannot distinguish a correct control from one that rejects
//! everything — a failure mode this campaign has already hit twice (see the
//! HZ-WP7-AUTHN-001 session notes, where two separate transport faults produced
//! six "passing" denial assertions while nothing reached the server).

#[cfg(test)]
mod tests {
    use crate::security::jwt;
    use crate::security::mfa::MfaRecord;
    use crate::{AppState, Role, User};
    use actix_web::{http::StatusCode, test, web, App};
    use chrono::Utc;
    use serde_json::json;

    const ADMIN: &str = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
    const TARGET: &str = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";

    /// The dev-default signing secret from `security::jwt::jwt_secret()`. No
    /// test in this crate sets `JWT_SECRET`, so this is stable — and using it
    /// directly keeps these tests free of process-global env mutation.
    const DEV_SECRET: &str = "medichain-dev-secret-change-in-production";

    fn admin_user() -> User {
        User {
            wallet_address: ADMIN.to_string(),
            username: Some("admin".to_string()),
            name: "Admin".to_string(),
            role: Role::Admin,
            created_at: Utc::now(),
            created_by: None,
            linked_patient_id: None,
            email: Some("admin@example.test".to_string()),
            phone: None,
            department: None,
            specialty: None,
            license_number: None,
            status: "active".to_string(),
            last_login: None,
        }
    }

    /// Seed an admin, and optionally an *enabled* MFA enrollment for them.
    async fn state_with_admin(mfa_enrolled: bool) -> web::Data<AppState> {
        let state = AppState::new();
        state
            .users
            .write()
            .unwrap()
            .insert(ADMIN.to_string(), admin_user());

        if mfa_enrolled {
            state.security.mfa.write().unwrap().insert(
                ADMIN.to_string(),
                MfaRecord {
                    // Valid base32; never used to mint a code in these tests —
                    // only the `enabled` flag is read by the policy.
                    secret_base32: "JBSWY3DPEHPK3PXP".to_string(),
                    enabled: true,
                    created_at: Utc::now(),
                },
            );
        }
        web::Data::new(state)
    }

    fn assign_body() -> serde_json::Value {
        json!({
            "wallet_address": TARGET,
            "name": "Target User",
            "username": "target",
            "role": "Doctor"
        })
    }

    /// Mint a token with an explicit `exp`, bypassing the fixed-TTL helpers so
    /// the expired case can be constructed.
    fn token_with_exp(mfa: bool, exp_offset_secs: i64) -> String {
        token_with_times(mfa, exp_offset_secs, 0)
    }

    fn token_with_times(mfa: bool, exp_offset_secs: i64, auth_age_secs: i64) -> String {
        let now = Utc::now().timestamp();
        let claims = jwt::Claims {
            iss: jwt::JWT_ISSUER.to_string(),
            aud: jwt::JWT_AUDIENCE.to_string(),
            sub: ADMIN.to_string(),
            role: "Admin".to_string(),
            context: None,
            patient_profile_id: None,
            organization_id: None,
            facility_id: None,
            assignment_id: None,
            mfa,
            typ: jwt::TYP_ACCESS.to_string(),
            iat: now,
            nbf: now,
            exp: now + exp_offset_secs,
            jti: uuid::Uuid::new_v4().to_string(),
            auth_time: mfa.then_some(now - auth_age_secs),
        };
        jsonwebtoken::encode(
            &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256),
            &claims,
            &jsonwebtoken::EncodingKey::from_secret(DEV_SECRET.as_bytes()),
        )
        .expect("test token must encode")
    }

    /// Drive `POST /api/roles/assign` with the given headers and return the status.
    async fn assign_role_status(
        state: web::Data<AppState>,
        headers: &[(&str, String)],
    ) -> StatusCode {
        let app = test::init_service(
            App::new()
                .app_data(state)
                .service(crate::handlers::assign_role),
        )
        .await;

        let mut req = test::TestRequest::post()
            .uri("/api/roles/assign")
            .set_json(assign_body());
        for (k, v) in headers {
            req = req.insert_header((*k, v.clone()));
        }
        test::call_service(&app, req.to_request()).await.status()
    }

    // ---------------------------------------------------------------------
    // CONTROL CASES — these must pass both before and after the fix. If one of
    // these ever fails, the suite has stopped measuring the control and started
    // measuring a broken transport.
    // ---------------------------------------------------------------------

    /// Baseline allow: enrolled admin, JWT carrying verified step-up.
    #[actix_rt::test]
    async fn control_enrolled_admin_with_stepped_up_jwt_is_allowed() {
        let state = state_with_admin(true).await;
        let token = token_with_exp(true, 3600);
        let status =
            assign_role_status(state, &[("Authorization", format!("Bearer {}", token))]).await;
        assert!(
            status.is_success(),
            "enrolled admin WITH verified step-up must be allowed; got {status}. \
             If this fails the control is broken and every deny assertion below is worthless."
        );
    }

    /// Baseline deny that already worked pre-fix: JWT present, step-up absent.
    #[actix_rt::test]
    async fn control_enrolled_admin_without_step_up_is_denied() {
        let state = state_with_admin(true).await;
        let token = token_with_exp(false, 3600);
        let status =
            assign_role_status(state, &[("Authorization", format!("Bearer {}", token))]).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "enrolled admin without step-up must be refused"
        );
    }

    /// No credential at all.
    #[actix_rt::test]
    async fn control_no_credential_is_rejected() {
        let state = state_with_admin(true).await;
        let status = assign_role_status(state, &[]).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    /// An expired JWT, with no `X-User-Id` to fall back to, resolves to no
    /// caller at all. (`get_current_claims` returns `None` on expiry, and
    /// `get_current_user_id` then falls through to the header — see
    /// `support.rs:227-233`.)
    #[actix_rt::test]
    async fn control_expired_jwt_alone_is_rejected() {
        let state = state_with_admin(true).await;
        let token = token_with_exp(true, -3600);
        let status =
            assign_role_status(state, &[("Authorization", format!("Bearer {}", token))]).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    /// A malformed bearer likewise resolves to no caller.
    #[actix_rt::test]
    async fn control_malformed_jwt_alone_is_rejected() {
        let state = state_with_admin(true).await;
        let status = assign_role_status(
            state,
            &[("Authorization", "Bearer not.a.valid.token".to_string())],
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    // ---------------------------------------------------------------------
    // BYPASS CASES — these FAIL against pre-fix code. That failure is the H2
    // evidence. Each models a caller the signature middleware has already
    // authenticated, presenting no JWT.
    // ---------------------------------------------------------------------

    /// **The H2 bypass.** A signature-authenticated, MFA-*enrolled* admin
    /// performs a privileged operation having never stepped up. Pre-fix this
    /// returns 200: `enforce_mfa_step_up` finds no claims and exempts the
    /// caller outright.
    #[actix_rt::test]
    async fn bypass_signature_only_enrolled_admin_must_be_denied() {
        let state = state_with_admin(true).await;
        let status = assign_role_status(state, &[("X-User-Id", ADMIN.to_string())]).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "H2: an MFA-enrolled admin authenticated by wallet signature alone \
             must NOT reach a privileged route without verified step-up"
        );
    }

    /// The owner's stricter policy: a *never-enrolled* admin has no assurance
    /// to offer, so a privileged route must refuse rather than wave them
    /// through. Pre-fix this returns 200.
    #[actix_rt::test]
    async fn bypass_signature_only_unenrolled_admin_must_be_denied() {
        let state = state_with_admin(false).await;
        let status = assign_role_status(state, &[("X-User-Id", ADMIN.to_string())]).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "H2: a never-enrolled admin must be refused a privileged route — \
             non-enrollment is a refusal, not an exemption"
        );
    }

    /// Enrollment is re-read per request from durable state, so a token minted
    /// while enrolled stops satisfying the policy once enrollment is removed.
    /// Pre-fix this returns 200, because only the claim is consulted.
    #[actix_rt::test]
    async fn bypass_stepped_up_jwt_without_enrollment_must_be_denied() {
        let state = state_with_admin(false).await;
        let token = token_with_exp(true, 3600);
        let status =
            assign_role_status(state, &[("Authorization", format!("Bearer {}", token))]).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "H2: a stepped-up claim must not outlive the enrollment that justified it"
        );
    }

    // ---------------------------------------------------------------------
    // EXHAUSTIVE POLICY MATRIX — every combination of posture x enrollment x
    // assurance, asserted against the pure decision function.
    //
    // These need no HTTP stack and, crucially, no `IS_DEMO` mutation: posture
    // is a parameter. That makes them deterministic under parallel execution,
    // unlike anything that reads the process-global env (see `DEMO_ENV_GUARD`
    // in `support.rs` for the race this avoids).
    // ---------------------------------------------------------------------

    /// All 12 combinations, written out rather than generated, so the expected
    /// column is reviewable by eye.
    // NOTE: `#[::core::prelude::v1::test]` rather than a bare `#[test]` — the
    // `use actix_web::test` above shadows the standard attribute in this module.
    #[::core::prelude::v1::test]
    fn policy_matrix_is_exhaustive_and_explicit() {
        use crate::{
            privileged_assurance_decision as decide, AssuranceDenial as D, CallerAssurance as A,
        };

        // (is_demo, enrolled, assurance, expected)
        let cases: &[(bool, bool, A, Result<(), D>)] = &[
            // ---- PRODUCTION posture: the property under test ----
            (false, false, A::Anonymous, Err(D::NoCaller)),
            (false, true, A::Anonymous, Err(D::NoCaller)),
            // Never-enrolled callers are refused outright — the owner's
            // stricter policy. Non-enrollment is a refusal, not an exemption.
            (false, false, A::Identified, Err(D::EnrollmentRequired)),
            (false, false, A::SteppedUp, Err(D::EnrollmentRequired)),
            // Enrolled but not stepped up.
            (false, true, A::Identified, Err(D::StepUpRequired)),
            // The one production allow.
            (false, true, A::SteppedUp, Ok(())),
            // ---- DEMO posture: documented exemption, warned at startup ----
            // Anonymous is refused even here: demo must never make a
            // privileged route an open one.
            (true, false, A::Anonymous, Err(D::NoCaller)),
            (true, true, A::Anonymous, Err(D::NoCaller)),
            (true, false, A::Identified, Ok(())),
            (true, false, A::SteppedUp, Ok(())),
            (true, true, A::Identified, Ok(())),
            (true, true, A::SteppedUp, Ok(())),
        ];

        for (is_demo, enrolled, assurance, expected) in cases {
            assert_eq!(
                decide(*is_demo, *enrolled, *assurance),
                *expected,
                "policy(is_demo={is_demo}, enrolled={enrolled}, assurance={assurance:?})"
            );
        }
    }

    /// The security property, stated once as a single assertion over the whole
    /// production half of the matrix. If someone later adds a permissive branch,
    /// this fails even if they also update the table above.
    #[::core::prelude::v1::test]
    fn no_production_privileged_access_without_enrollment_and_step_up() {
        use crate::{privileged_assurance_decision as decide, CallerAssurance as A};

        for enrolled in [false, true] {
            for assurance in [A::Anonymous, A::Identified, A::SteppedUp] {
                let allowed = decide(false, enrolled, assurance).is_ok();
                let should_be_allowed = enrolled && assurance == A::SteppedUp;
                assert_eq!(
                    allowed, should_be_allowed,
                    "production: enrolled={enrolled}, assurance={assurance:?} \
                     must be allowed only when enrolled AND stepped up"
                );
            }
        }
    }

    /// An expired JWT must not be resurrected by an accompanying `X-User-Id`
    /// header into a privileged operation.
    #[actix_rt::test]
    async fn bypass_expired_jwt_with_user_header_must_be_denied() {
        let state = state_with_admin(true).await;
        let token = token_with_exp(true, -3600);
        let status = assign_role_status(
            state,
            &[
                ("Authorization", format!("Bearer {}", token)),
                ("X-User-Id", ADMIN.to_string()),
            ],
        )
        .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "H2: an expired step-up claim must not be revived by the fallback header"
        );
    }

    #[actix_rt::test]
    async fn stale_mfa_claim_must_be_denied() {
        let state = state_with_admin(true).await;
        let token = token_with_times(true, 3600, jwt::MFA_STEP_UP_TTL_SECS + 1);
        let status =
            assign_role_status(state, &[("Authorization", format!("Bearer {}", token))]).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
}
