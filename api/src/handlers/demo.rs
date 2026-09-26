use super::*;

/// Development-only demo login endpoint
/// Creates a temporary user with the specified role for testing purposes
/// SECURITY: Only available when MEDICHAIN_DEV_MODE environment variable is set
#[derive(Debug, Deserialize)]
pub struct DemoLoginRequest {
    pub wallet_address: String,
    pub role: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DemoLoginResponse {
    pub success: bool,
    pub wallet_address: String,
    pub role: String,
    pub name: String,
    pub message: String,
}

/// Seed the durable demo facility registry and active staff assignments.
///
/// This endpoint exists only to prepare a local demonstration. It requires the
/// same two explicit flags as demo login and refuses to claim success when the
/// database is unavailable.
#[post("/api/demo/seed-facilities")]
pub async fn seed_demo_facilities(data: web::Data<AppState>) -> impl Responder {
    let dev_mode = std::env::var("MEDICHAIN_DEV_MODE")
        .map(|value| value == "true" || value == "1")
        .unwrap_or(false);
    if !dev_mode || !crate::support::is_demo_mode() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Demo facility seeding is only available in development demo mode.".to_string(),
            code: "DEV_MODE_REQUIRED".to_string(),
        });
    }
    let Some(pool) = data.db_pool.as_ref() else {
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            error: "Demo facility seeding requires durable storage.".to_string(),
            code: "DEMO_STORAGE_REQUIRED".to_string(),
        });
    };
    let facilities = [
        (
            "demo-facility-jhb",
            "MediChain Johannesburg Demonstration Clinic",
            "clinic",
            "Gauteng",
        ),
        (
            "demo-facility-pta",
            "MediChain Pretoria Demonstration Clinic",
            "clinic",
            "Gauteng",
        ),
        (
            "demo-facility-cpt",
            "MediChain Cape Town Demonstration Clinic",
            "clinic",
            "Western Cape",
        ),
    ];
    let mut transaction = match pool.begin().await {
        Ok(transaction) => transaction,
        Err(error) => {
            log::error!("demo facility transaction: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "Demo facility seeding is temporarily unavailable.".to_string(),
                code: "DEMO_STORAGE_REQUIRED".to_string(),
            });
        }
    };
    if let Err(error) = sqlx::query("INSERT INTO organizations (id, name, organization_type, status) VALUES ($1, $2, $3, 'active') ON CONFLICT (id) DO NOTHING")
        .bind("demo-organization").bind("MediChain Demonstration Organisation").bind("healthcare_provider")
        .execute(&mut *transaction).await {
        log::error!("seed demo organization: {error}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse { error: "Demo facility seeding is temporarily unavailable.".to_string(), code: "DEMO_STORAGE_REQUIRED".to_string() });
    }
    for (id, name, facility_type, province) in facilities {
        let location =
            serde_json::json!({ "province": province, "district": "Demonstration district" });
        if let Err(error) = sqlx::query("INSERT INTO facilities (id, organization_id, name, facility_type, status, location) VALUES ($1, $2, $3, $4, 'active', $5) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, facility_type = EXCLUDED.facility_type, location = EXCLUDED.location")
            .bind(id).bind("demo-organization").bind(name).bind(facility_type).bind(location).execute(&mut *transaction).await {
            log::error!("seed demo facility: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse { error: "Demo facility seeding is temporarily unavailable.".to_string(), code: "DEMO_STORAGE_REQUIRED".to_string() });
        }
    }
    let staff: Vec<(String, String)> = data
        .users
        .read()
        .map(|users| {
            users
                .values()
                .filter(|user| user.role != crate::Role::Patient)
                .map(|user| (user.wallet_address.clone(), user.role.to_string()))
                .collect()
        })
        .unwrap_or_default();
    for (wallet, role) in staff {
        let person_id = match sqlx::query_scalar::<_, String>(
            "INSERT INTO persons (id, wallet_address, status) VALUES ($1, $2, 'active') \
             ON CONFLICT (wallet_address) DO UPDATE SET status = 'active' RETURNING id",
        )
        .bind(format!("demo-person-{wallet}"))
        .bind(&wallet)
        .fetch_one(&mut *transaction)
        .await
        {
            Ok(id) => id,
            Err(error) => {
                log::error!("seed demo person: {error}");
                return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                    error: "Demo facility seeding is temporarily unavailable.".to_string(),
                    code: "DEMO_STORAGE_REQUIRED".to_string(),
                });
            }
        };
        let professional_id = format!("demo-professional-{wallet}");
        let assignment_id = format!("demo-assignment-{wallet}");
        if let Err(error) = sqlx::query("INSERT INTO professional_identities (id, person_id, profession, status) VALUES ($1, $2, $3, 'active') ON CONFLICT (id) DO UPDATE SET profession = EXCLUDED.profession, status = 'active'")
            .bind(&professional_id).bind(&person_id).bind(&role).execute(&mut *transaction).await {
            log::error!("seed demo professional: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse { error: "Demo facility seeding is temporarily unavailable.".to_string(), code: "DEMO_STORAGE_REQUIRED".to_string() });
        }
        if let Err(error) = sqlx::query("INSERT INTO organization_assignments (id, professional_identity_id, organization_id, facility_id, role, status) VALUES ($1, $2, $3, $4, $5, 'active') ON CONFLICT (id) DO UPDATE SET facility_id = EXCLUDED.facility_id, role = EXCLUDED.role, status = 'active'")
            .bind(&assignment_id).bind(&professional_id).bind("demo-organization").bind("demo-facility-jhb").bind(&role).execute(&mut *transaction).await {
            log::error!("seed demo assignment: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse { error: "Demo facility seeding is temporarily unavailable.".to_string(), code: "DEMO_STORAGE_REQUIRED".to_string() });
        }
        data.identity_contexts.assign_professional_facility(
            &wallet,
            "demo-organization",
            "demo-facility-jhb",
            "MediChain Johannesburg Demonstration Clinic",
            &role,
        );
    }
    if let Err(error) = transaction.commit().await {
        log::error!("commit demo facilities: {error}");
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            error: "Demo facility seeding is temporarily unavailable.".to_string(),
            code: "DEMO_STORAGE_REQUIRED".to_string(),
        });
    }
    HttpResponse::Ok().json(serde_json::json!({ "success": true, "facilities": 3 }))
}

#[post("/api/auth/demo-login")]
pub async fn demo_login(
    data: web::Data<AppState>,
    body: web::Json<DemoLoginRequest>,
) -> impl Responder {
    // This endpoint AUTO-CREATES a user account for any wallet address presented,
    // with no credential. It defaulted to enabled (`unwrap_or(true)`), so a
    // deployment that never set MEDICHAIN_DEV_MODE shipped an open
    // account-creation endpoint — anyone could mint themselves an identity and
    // then satisfy every presence-only handler in the API. It now defaults to
    // DISABLED and additionally requires demo mode, so enabling it is a
    // deliberate act in two places rather than an omission in one.
    let dev_mode = std::env::var("MEDICHAIN_DEV_MODE")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);

    if !dev_mode || !crate::support::is_demo_mode() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Demo login is only available in development mode".to_string(),
            code: "DEV_MODE_REQUIRED".to_string(),
        });
    }

    // Validate wallet address format
    if !is_valid_wallet_address(&body.wallet_address) {
        return HttpResponse::BadRequest().json(ErrorResponse {
            error:
                "Invalid wallet address format. Must be SS58 encoded (starts with 5, 45-50 chars)"
                    .to_string(),
            code: "INVALID_WALLET_ADDRESS".to_string(),
        });
    }

    // Parse role (optional; default to Doctor in dev/demo mode)
    let role_str = body.role.clone().unwrap_or_else(|| "Doctor".to_string());
    let role = match parse_role(&role_str) {
        Ok(r) => r,
        Err(e) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: e,
                code: "INVALID_ROLE".to_string(),
            });
        }
    };

    let name = body
        .name
        .clone()
        .unwrap_or_else(|| format!("Demo {}", role));

    // Check if wallet already exists
    {
        let users = data.users.read().unwrap();
        if let Some(existing) = users.get(&body.wallet_address) {
            return HttpResponse::Ok().json(DemoLoginResponse {
                success: true,
                wallet_address: existing.wallet_address.clone(),
                role: existing.role.to_string(),
                name: existing.name.clone(),
                message: "User already exists - logged in".to_string(),
            });
        }
    }

    // Create demo user
    let user = User {
        wallet_address: body.wallet_address.clone(),
        username: Some(format!("demo_{}", role.to_string().to_lowercase())),
        name: name.clone(),
        role: role.clone(),
        created_at: Utc::now(),
        created_by: Some("DEMO_SYSTEM".to_string()),
        linked_patient_id: None,
        email: None,
        phone: None,
        department: None,
        specialty: None,
        license_number: None,
        status: "active".to_string(),
        last_login: None,
    };

    data.users
        .write()
        .unwrap()
        .insert(body.wallet_address.clone(), user);

    log::info!(
        "[DEMO] Auto-registered demo user: wallet={}, role={}, name={}",
        body.wallet_address,
        role,
        name
    );

    HttpResponse::Created().json(DemoLoginResponse {
        success: true,
        wallet_address: body.wallet_address.clone(),
        role: role.to_string(),
        name,
        message: "Demo user created and logged in".to_string(),
    })
}

/// Get demo info
#[get("/api/demo")]
pub async fn demo_info() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "project": "MediChain",
        "description": "Blockchain-based national health ID system with NFC emergency access",
        "auth_mode": "Wallet-based blockchain authentication (no seed data)",
        "dev_mode": std::env::var("MEDICHAIN_DEV_MODE").map(|v| v == "true" || v == "1").unwrap_or(true),
        "demo_login_endpoint": "POST /api/auth/demo-login (dev mode only - auto-creates users)",
        "demo_instructions": {
            "step_1": "First admin must bootstrap by using /api/auth/register with their wallet",
            "step_2": "Admin registers healthcare staff with wallet addresses",
            "step_3": "Healthcare staff can then register patients via /api/register",
            "step_4": "All users authenticate with X-User-Id header containing SS58 wallet address"
        },
        "wallet_auth": {
            "format": "SS58 encoded wallet address (starts with 5, 45-50 chars)",
            "example": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
            "header": "X-User-Id: <wallet_address>",
            "note": "Users must be registered by admin before accessing protected endpoints"
        },
        "features": [
            "Wallet-based blockchain authentication",
            "Role-Based Access Control (RBAC)",
            "Healthcare provider patient registration",
            "Read-only patient access",
            "NFC-based emergency medical records access",
            "Blockchain-verified patient identity",
            "Cryptographic consent management",
            "Complete audit trail",
            "HIPAA/GDPR compliance ready"
        ],
        "endpoints": {
            "auth": {
                "register": "POST /api/auth/register (Admin only - register new users)",
                "login": "POST /api/auth/login (Validate wallet and get user info)",
                "me": "GET /api/auth/me (Get current user info)"
            },
            "patients": {
                "register": "POST /api/register (Doctor, Nurse, Admin)",
                "update": "PUT /api/patients/{patient_id} (Doctor, Nurse, Admin)",
                "list": "GET /api/patients (Healthcare providers)",
                "get": "GET /api/patients/{patient_id} (Healthcare providers or own record)",
                "my_records": "GET /api/my-records (Patient: own records only)"
            },
            "emergency": {
                "access": "POST /api/emergency/grants (device-bound break-glass)",
                "simulate_nfc": "POST /api/simulate-nfc-tap",
                "access_logs": "GET /api/access-logs/{patient_id}"
            },
            "rbac": {
                "assign_role": "POST /api/roles/assign (Admin only)",
                "revoke_role": "DELETE /api/roles/revoke (Admin only)",
                "list_users": "GET /api/users (Admin only)"
            },
            "health": "GET /health"
        },
        "auth_header": "Use 'X-User-Id' header with wallet address (SS58 format) for authentication"
    }))
}

// ---------------------------------------------------------------------------
// Demo credential resolver
// ---------------------------------------------------------------------------

/// One seeded demo staff account, as offered to the demo sign-in shortcut.
#[derive(Debug, Serialize)]
pub struct DemoCredential {
    pub login_id: String,
    pub password: String,
    pub name: String,
    pub role: String,
}

#[derive(Debug, Serialize)]
pub struct DemoCredentialsResponse {
    pub success: bool,
    pub credentials: Vec<DemoCredential>,
}

/// The password the fixture seeder binds to every demo staff account.
///
/// It is a throwaway test key, and it lives here rather than in the frontend so
/// a production bundle cannot carry it: this endpoint refuses to answer outside
/// demo mode, so the shipped JavaScript has nothing to leak.
const DEMO_FIXTURE_PASSWORD: &str = "BrowserTest!2026";

/// Login identifiers provisioned by `scripts/seed-browser-test-fixtures.ts`.
///
/// Deliberately an explicit list rather than "every user with a keystore". The
/// shortcut must only ever offer accounts that were created as fixtures; reading
/// the credential table and handing back whatever it finds would turn a demo
/// convenience into a credential oracle the first time a real account was
/// enrolled on the same database.
const DEMO_FIXTURE_LOGIN_IDS: &[&str] = &[
    "bt.doctor",
    "bt.nurse",
    "bt.admin",
    "bt.pharm",
    "bt.pharm2",
    "bt.lab",
];

/// Return the seeded demo staff credentials, so the demo shortcut can drive the
/// ordinary employee-ID/password sign-in rather than a bypass of its own.
///
/// # Why this exists
///
/// The clinician portal's quick-login buttons used to call a wallet-lookup route
/// and then set an authenticated state with no bearer token behind it. There is
/// no honest way for a one-click button to mint a session: `POST /api/auth/jwt`
/// verifies a real sr25519 signature over a single-use challenge in every mode,
/// including demo. So the shortcut now fetches these credentials and runs the
/// real credential flow, which unlocks a keystore, derives a signer, signs the
/// challenge, and receives a genuine session. One authentication path, with a
/// convenience in front of it -- not a second protocol.
///
/// # Containment
///
/// Gated exactly like `demo_login`: `MEDICHAIN_DEV_MODE` **and** demo mode, both
/// defaulting to off, so enabling it is two deliberate acts rather than one
/// omission. Under production configuration it 403s, which means the shortcut
/// cannot work there even if the button were somehow rendered.
#[get("/api/auth/demo-credentials")]
pub async fn demo_credentials(data: web::Data<AppState>) -> impl Responder {
    let dev_mode = std::env::var("MEDICHAIN_DEV_MODE")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);

    if !dev_mode || !crate::support::is_demo_mode() {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Demo credentials are only available in development mode".to_string(),
            code: "DEV_MODE_REQUIRED".to_string(),
        });
    }

    let Some(pool) = data.db_pool.as_ref() else {
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            error: "Demo credentials are unavailable without durable storage".to_string(),
            code: "AUTH_STORAGE_REQUIRED".to_string(),
        });
    };

    // Only accounts that actually carry a keystore can complete the credential
    // flow, so an unseeded database yields an empty list rather than a set of
    // identifiers that would fail at sign-in.
    //
    // Matched by PREFIX, not equality. `seed-browser-test-fixtures.ts` supports
    // `MEDICHAIN_FIXTURE_SUFFIX`, so a seeded administrator is `bt.admin.k`
    // while this list holds `bt.admin` -- and an exact match therefore returned
    // every other role and never the administrator. The consequence was not
    // cosmetic: no browser test could sign in as an administrator at all, so
    // the fourteen screens in that role's navigation had no coverage.
    //
    // The `LIKE` pattern is built from the bound parameter inside the query, so
    // this is still fully parameterised -- no identifier or literal is
    // concatenated into the SQL.
    // ONE credential per login id, not one per matching row.
    //
    // A first attempt at the suffix problem matched `base || '.%'` and returned
    // every suffixed fixture -- `bt.doctor`, `bt.doctor.c`, `bt.doctor.d`,
    // `bt.doctor.j`, `bt.doctor.k` -- so the sign-in screen grew a dozen demo
    // buttons where it had five. That broke the browser suites outright: the
    // selectors match on the role a button advertises, and five buttons saying
    // "Doctor" are five matches.
    //
    // `DISTINCT ON (base)` keeps exactly one per fixture identity, preferring
    // the unsuffixed account when it exists so an existing database behaves as
    // it did before.
    let rows: Result<Vec<(String, Option<String>, String)>, _> = sqlx::query_as(
        "SELECT DISTINCT ON (matched.base) u.login_id, u.name, u.role
         FROM users u
         JOIN LATERAL (
                SELECT base
                FROM unnest($1::text[]) AS base
                WHERE u.login_id = base OR u.login_id LIKE base || '.%'
                LIMIT 1
              ) AS matched ON TRUE
         WHERE u.encrypted_keystore IS NOT NULL
           AND u.credential_verifier IS NOT NULL
           AND u.status = 'active'
         ORDER BY matched.base, (u.login_id = matched.base) DESC, u.login_id",
    )
    .bind(DEMO_FIXTURE_LOGIN_IDS)
    .fetch_all(pool)
    .await;

    match rows {
        Ok(rows) => HttpResponse::Ok().json(DemoCredentialsResponse {
            success: true,
            credentials: rows
                .into_iter()
                .map(|(login_id, name, role)| DemoCredential {
                    name: name.unwrap_or_else(|| login_id.clone()),
                    login_id,
                    password: DEMO_FIXTURE_PASSWORD.to_string(),
                    role,
                })
                .collect(),
        }),
        Err(error) => {
            log::error!("Demo credential lookup failed: {error}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "Demo credentials are temporarily unavailable".to_string(),
                code: "DEMO_CREDENTIALS_UNAVAILABLE".to_string(),
            })
        }
    }
}

/// The primary demonstration patient. The seed-status probe answers only about
/// this synthetic fixture, so it cannot be pointed at a real patient's record.
const DEMO_PRIMARY_PATIENT_ID: &str = "PAT-DEMO-001";
/// The primary fixture's imaging report, created by `scripts/seed-demo-data.py`.
const DEMO_PRIMARY_IMAGING_REPORT_ID: &str = "RAD-DEMO-001";
/// Prefix of the stated reasons on the seeded clinician session.
const DEMO_TREATMENT_REASON_PATTERN: &str = "Treatment:%";

/// Which of the primary fixture's seeded facts already exist.
///
/// Booleans only: no clinical content, names or identifiers leave this
/// endpoint.
#[derive(Debug, Serialize, PartialEq, Eq, sqlx::FromRow)]
pub struct DemoSeedStatus {
    pub imaging_report: bool,
    pub guardian: bool,
    pub emergency_capsule: bool,
    pub paramedic_emergency_access: bool,
    pub treatment_session: bool,
    /// An active care relationship on the primary patient (WP9), without
    /// which the demo clinician's chart reads are refused.
    pub care_relationship: bool,
}

/// Whether the demo fixture tools may run: developer mode AND demo mode.
///
/// Parameters: the raw `MEDICHAIN_DEV_MODE` value (if set) and whether the
/// API is in demo mode. Returns true only when both are explicitly on.
fn demo_fixture_tools_enabled(dev_mode: Option<&str>, is_demo: bool) -> bool {
    matches!(dev_mode, Some("true") | Some("1")) && is_demo
}

/// Report which of the primary demo fixture's steps are already seeded.
///
/// Why it exists: the seed script must be re-runnable with no change to the
/// database. Answering "is this fixture present?" through the ordinary chart
/// routes is itself an audited disclosure, so every re-run appended rows to
/// the demo patient's "Who viewed my records" history. This probe reads the
/// fixture's existence directly, reveals nothing but booleans, only ever about
/// `PAT-DEMO-001`, and is gated exactly like the other demo tools (developer
/// mode AND demo mode), so it does not exist in production.
///
/// Returns 200 with a `DemoSeedStatus`, 403 outside dev+demo mode, or 503 when
/// durable storage is unavailable.
#[get("/api/demo/seed-status")]
pub async fn demo_seed_status(data: web::Data<AppState>) -> impl Responder {
    let dev_mode = std::env::var("MEDICHAIN_DEV_MODE").ok();
    if !demo_fixture_tools_enabled(dev_mode.as_deref(), crate::support::is_demo_mode()) {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "Demo seed status is only available in development demo mode.".to_string(),
            code: "DEV_MODE_REQUIRED".to_string(),
        });
    }
    seed_status_response(data.db_pool.as_ref()).await
}

/// Build the seed-status response from storage.
///
/// Parameters: the PostgreSQL pool, if the API has one. Returns 200 with the
/// status, or 503 with a user-safe message when storage is absent or failing
/// (the error itself is logged, never returned).
async fn seed_status_response(pool: Option<&sqlx::PgPool>) -> HttpResponse {
    let unavailable = || {
        HttpResponse::ServiceUnavailable().json(ErrorResponse {
            error: "Demo seed status is temporarily unavailable.".to_string(),
            code: "DEMO_STORAGE_REQUIRED".to_string(),
        })
    };
    let Some(pool) = pool else {
        return unavailable();
    };
    match load_demo_seed_status(pool).await {
        Ok(status) => HttpResponse::Ok().json(status),
        Err(error) => {
            log::error!("demo seed status lookup failed: {error}");
            unavailable()
        }
    }
}

/// Query the existence of each primary-fixture fact in one statement.
///
/// Parameters: the pool. Returns the status, or the database error. Every
/// value is bound. The paramedic check resolves the grant holder's profession
/// through `persons` -> `professional_identities`: demo sign-ins live only in
/// the API's memory, not in `users`, and grants leave
/// `professional_identity_id` empty.
async fn load_demo_seed_status(pool: &sqlx::PgPool) -> Result<DemoSeedStatus, sqlx::Error> {
    sqlx::query_as::<_, DemoSeedStatus>(
        "SELECT
           EXISTS (SELECT 1 FROM radiology_reports WHERE id = $2) AS imaging_report,
           EXISTS (SELECT 1 FROM guardian_relationships
                   WHERE ward_patient_id = $1 AND active AND revoked_at IS NULL) AS guardian,
           EXISTS (SELECT 1 FROM emergency_capsules
                   WHERE patient_id = $1 AND revoked_at IS NULL) AS emergency_capsule,
           EXISTS (SELECT 1 FROM emergency_access_grants g
                   JOIN persons person ON person.wallet_address = g.requesting_person_id
                   JOIN professional_identities p
                        ON p.person_id = person.id AND p.status = 'active'
                   WHERE g.patient_id = $1 AND p.profession = 'Paramedic') AS paramedic_emergency_access,
           EXISTS (SELECT 1 FROM access_logs
                   WHERE patient_id = $1 AND access_reason LIKE $3) AS treatment_session,
           EXISTS (SELECT 1 FROM care_relationships
                   WHERE patient_id = $1 AND starts_at <= NOW()
                     AND (ends_at IS NULL OR ends_at > NOW())) AS care_relationship",
    )
    .bind(DEMO_PRIMARY_PATIENT_ID)
    .bind(DEMO_PRIMARY_IMAGING_REPORT_ID)
    .bind(DEMO_TREATMENT_REASON_PATTERN)
    .fetch_one(pool)
    .await
}

#[cfg(test)]
mod seed_status_tests {
    use super::*;

    #[test]
    fn fixture_tools_need_both_developer_and_demo_mode() {
        assert!(demo_fixture_tools_enabled(Some("1"), true));
        assert!(demo_fixture_tools_enabled(Some("true"), true));
        assert!(!demo_fixture_tools_enabled(Some("1"), false));
        assert!(!demo_fixture_tools_enabled(None, true));
        assert!(!demo_fixture_tools_enabled(Some("yes"), true));
        assert!(!demo_fixture_tools_enabled(Some(""), true));
    }

    #[actix_web::test]
    async fn seed_status_refuses_production_configuration() {
        // No MEDICHAIN_DEV_MODE in the test environment: the endpoint must 403.
        let app = actix_web::test::init_service(
            actix_web::App::new()
                .app_data(web::Data::new(crate::AppState::new()))
                .service(demo_seed_status),
        )
        .await;
        let request = actix_web::test::TestRequest::get()
            .uri("/api/demo/seed-status")
            .to_request();
        let response = actix_web::test::call_service(&app, request).await;
        assert_eq!(response.status(), actix_web::http::StatusCode::FORBIDDEN);
    }

    #[actix_web::test]
    async fn seed_status_is_unavailable_without_durable_storage() {
        let response = seed_status_response(None).await;
        assert_eq!(
            response.status(),
            actix_web::http::StatusCode::SERVICE_UNAVAILABLE
        );
    }

    /// Runs the real statement against a freshly migrated schema, so a renamed
    /// column or table fails here rather than at demo time. A fresh schema has
    /// no fixtures, so every step must read as not yet seeded.
    #[tokio::test]
    async fn seed_status_reads_nothing_seeded_on_an_empty_database() {
        let pool = crate::repositories::postgres::tests::get_test_pool().await;
        let status = load_demo_seed_status(&pool)
            .await
            .expect("seed status query");
        assert_eq!(
            status,
            DemoSeedStatus {
                imaging_report: false,
                guardian: false,
                emergency_capsule: false,
                paramedic_emergency_access: false,
                treatment_session: false,
                care_relationship: false,
            }
        );
        pool.close().await;
    }
}
