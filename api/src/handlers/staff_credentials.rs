//! Staff credential login — signing in with an employee identifier instead of
//! a 48-character wallet address.
//!
//! # How this preserves the signature model
//!
//! MediChain's authority to act is an sr25519 key, and every mutating request
//! is signed by one. That does not change here. What changes is how a
//! clinician *reaches* their key.
//!
//! Enrolment (`POST /api/auth/credentials`) is authenticated the existing way —
//! a wallet-signed request — so only someone who already controls the key can
//! bind credentials to it. The client generates an encrypted copy of its own
//! keypair and uploads it along with an auth proof.
//!
//! Login (`POST /api/auth/staff/login`) verifies the proof and hands back that
//! encrypted keystore. The client opens it locally, and from that point holds a
//! real signing key: it signs the existing `/api/auth/challenge` and gets a JWT
//! exactly as the extension path does.
//!
//! # What the server cannot do
//!
//! The client derives two independent values from the password down
//! domain-separated paths: the *auth proof* it sends here, and the *keystore
//! secret* it never sends at all. So the verifier this module stores cannot
//! open the keystore this module stores. A compromised database yields an
//! Argon2id verifier and an opaque encrypted blob, not the ability to sign as
//! a clinician.
//!
//! The cost of that property is real and deliberate: **a forgotten password is
//! a lost key.** There is no reset, because a server able to reset it would be
//! a server able to forge signatures. Recovery is re-enrolment by an
//! administrator against a freshly provisioned keypair.

use actix_web::{post, web, HttpRequest, HttpResponse, Responder};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::{AppState, ErrorResponse};

/// Failed attempts tolerated for one identifier before it is locked out.
const MAX_FAILED_ATTEMPTS: u32 = 5;
/// How long a lockout lasts, and how long the failure counter is remembered.
const LOCKOUT: Duration = Duration::from_secs(15 * 60);

/// An Argon2id verifier over a value that is never a real credential, used to
/// spend the same CPU on an unknown identifier as on a known one.
///
/// Without this, "no such user" returns in microseconds while a wrong password
/// takes the full Argon2id cost, and that timing difference enumerates staff
/// accounts. Built once; the plaintext is not a secret.
fn timing_equaliser() -> &'static str {
    static DUMMY: OnceLock<String> = OnceLock::new();
    DUMMY.get_or_init(|| {
        medichain_crypto::password::hash_secret("timing-equaliser-not-a-credential")
            .unwrap_or_default()
    })
}

struct Failures {
    count: u32,
    first_seen: Instant,
}

/// Per-identifier failure tracking.
///
/// Process-local, like the existing rate-limit middleware. That is a real
/// limitation behind multiple API instances — an attacker can spread attempts
/// across them — and is recorded in `docs/WORKFLOW_AUDIT.md` rather than
/// papered over. It still defeats the single-host credential stuffing that the
/// global request-rate limiter does not, because that one is not keyed by
/// account.
fn failure_table() -> &'static Mutex<HashMap<String, Failures>> {
    static TABLE: OnceLock<Mutex<HashMap<String, Failures>>> = OnceLock::new();
    TABLE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Whether this identifier is currently locked out, expiring stale entries.
fn is_locked_out(key: &str) -> bool {
    let Ok(mut table) = failure_table().lock() else {
        // A poisoned lock must not become a way to bypass lockout.
        return true;
    };
    match table.get(key) {
        Some(f) if f.first_seen.elapsed() >= LOCKOUT => {
            table.remove(key);
            false
        }
        Some(f) => f.count >= MAX_FAILED_ATTEMPTS,
        None => false,
    }
}

fn record_failure(key: &str) {
    let Ok(mut table) = failure_table().lock() else {
        return;
    };
    let entry = table.entry(key.to_string()).or_insert(Failures {
        count: 0,
        first_seen: Instant::now(),
    });
    if entry.first_seen.elapsed() >= LOCKOUT {
        entry.count = 0;
        entry.first_seen = Instant::now();
    }
    entry.count += 1;
}

fn clear_failures(key: &str) {
    if let Ok(mut table) = failure_table().lock() {
        table.remove(key);
    }
}

// ============================================================================
// Login
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct StaffLoginRequest {
    /// Employee identifier or work email. Case-insensitive.
    pub identifier: String,
    /// Client-derived proof of the password. **Not** the password itself —
    /// see the module docs.
    pub auth_proof: String,
}

#[derive(Debug, Serialize)]
pub struct StaffLoginResponse {
    pub success: bool,
    pub wallet_address: String,
    /// Polkadot encrypted JSON. Only the client can open it.
    pub encrypted_keystore: String,
    pub name: String,
    pub role: String,
}

/// Row shape for the credential lookup. Deliberately its own query rather than
/// fields on `User`: `User` derives `Serialize` and is returned by several
/// endpoints, so carrying the verifier or keystore on it would risk leaking
/// them into an unrelated response.
struct CredentialRow {
    wallet_address: String,
    credential_verifier: String,
    encrypted_keystore: String,
    status: String,
}

/// Sign in with an employee identifier and password proof.
///
/// Returns the same opaque error for an unknown identifier, a wrong proof, and
/// an inactive account, so this endpoint cannot be used to enumerate staff.
#[post("/api/auth/staff/login")]
pub async fn staff_login(
    data: web::Data<AppState>,
    body: web::Json<StaffLoginRequest>,
) -> impl Responder {
    let identifier = body.identifier.trim().to_lowercase();
    if identifier.is_empty() || identifier.len() > 254 || body.auth_proof.is_empty() {
        return invalid_credentials();
    }

    let Some(pool) = &data.db_pool else {
        // No fake fallback: without a database there is nowhere credentials
        // could have been stored, so say so rather than silently failing auth.
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Credential sign-in requires the database-backed deployment".to_string(),
            code: "CREDENTIAL_LOGIN_UNAVAILABLE".to_string(),
        });
    };

    if is_locked_out(&identifier) {
        log::warn!(
            "STAFF_LOGIN_LOCKED_OUT identifier_hash={}",
            hash_id(&identifier)
        );
        return HttpResponse::TooManyRequests().json(ErrorResponse {
            success: false,
            error: "Too many failed sign-in attempts. Try again later.".to_string(),
            code: "ACCOUNT_LOCKED".to_string(),
        });
    }

    let row: Option<CredentialRow> =
        sqlx::query_as::<_, (String, Option<String>, Option<String>, String)>(
            r#"
        SELECT wallet_address, credential_verifier, encrypted_keystore, status
        FROM users
        WHERE (lower(login_id) = $1 OR lower(email) = $1)
        LIMIT 1
        "#,
        )
        .bind(&identifier)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|(wallet, verifier, keystore, status)| {
            Some(CredentialRow {
                wallet_address: wallet,
                credential_verifier: verifier?,
                encrypted_keystore: keystore?,
                status,
            })
        });

    // Always verify something, so an unknown identifier costs the same Argon2id
    // work as a known one. `verify_secret` is constant-time internally.
    let verifier = match &row {
        Some(r) => r.credential_verifier.as_str(),
        None => timing_equaliser(),
    };
    let proof_ok = medichain_crypto::password::verify_secret(&body.auth_proof, verifier);

    let Some(row) = row else {
        record_failure(&identifier);
        log::warn!(
            "STAFF_LOGIN_UNKNOWN identifier_hash={}",
            hash_id(&identifier)
        );
        return invalid_credentials();
    };

    if !proof_ok {
        record_failure(&identifier);
        log::warn!(
            "STAFF_LOGIN_FAILED identifier_hash={}",
            hash_id(&identifier)
        );
        return invalid_credentials();
    }

    // A suspended clinician must not be able to retrieve their keystore, and
    // must not be able to tell that their credentials were otherwise correct.
    if row.status != "active" {
        record_failure(&identifier);
        log::warn!("STAFF_LOGIN_INACTIVE status={}", row.status);
        return invalid_credentials();
    }

    let Some(user) = crate::get_user(&data, &row.wallet_address) else {
        return invalid_credentials();
    };

    clear_failures(&identifier);
    log::info!("STAFF_LOGIN_OK");

    // Note what this response is *not*: it is not a session. The client still
    // has to open the keystore and sign the auth challenge to obtain a JWT, so
    // possession of this response alone authorizes nothing.
    HttpResponse::Ok().json(StaffLoginResponse {
        success: true,
        wallet_address: user.wallet_address.clone(),
        encrypted_keystore: row.encrypted_keystore,
        name: user.name.clone(),
        role: user.role.to_string(),
    })
}

fn invalid_credentials() -> HttpResponse {
    HttpResponse::Unauthorized().json(ErrorResponse {
        success: false,
        error: "That identifier and password combination was not recognised".to_string(),
        code: "INVALID_CREDENTIALS".to_string(),
    })
}

/// Short non-reversible tag for logs, so a failed-login line never records the
/// identifier someone typed (which may be a real person's work email).
fn hash_id(identifier: &str) -> String {
    let digest = medichain_crypto::sha256(identifier.as_bytes());
    medichain_crypto::to_hex(&digest[..6])
}

// ============================================================================
// Enrolment
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct EnrolCredentialsRequest {
    /// The employee identifier the clinician will type to sign in.
    pub login_id: String,
    /// Argon2id is applied to this server-side; it is already a derived value.
    pub auth_proof: String,
    /// Polkadot encrypted JSON for the caller's own keypair.
    pub encrypted_keystore: String,
}

/// Bind an employee identifier and password to the caller's own wallet.
///
/// Authenticated by the existing wallet-signature path, so only someone who
/// already controls the key can enrol credentials for it. This is the
/// onboarding step that makes every later sign-in humane; it is not part of
/// ordinary login.
#[post("/api/auth/credentials")]
pub async fn enrol_credentials(
    data: web::Data<AppState>,
    http_req: HttpRequest,
    body: web::Json<EnrolCredentialsRequest>,
) -> impl Responder {
    let caller = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    let login_id = body.login_id.trim().to_string();
    if login_id.len() < 3 || login_id.len() > 64 {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Employee identifier must be between 3 and 64 characters".to_string(),
            code: "INVALID_LOGIN_ID".to_string(),
        });
    }
    // Keep it typeable and unambiguous: an identifier a clinician reads off a
    // badge should not contain whitespace or case-sensitive tricks.
    if !login_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Employee identifier may contain only letters, digits, dot, dash and underscore"
                .to_string(),
            code: "INVALID_LOGIN_ID".to_string(),
        });
    }
    if body.auth_proof.len() < 32 || body.auth_proof.len() > 512 {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Malformed authentication proof".to_string(),
            code: "INVALID_AUTH_PROOF".to_string(),
        });
    }
    // Enough of a shape check to catch a client sending the wrong thing
    // entirely (a raw password, a bare address) without parsing the keystore —
    // the server deliberately never interprets its contents.
    if body.encrypted_keystore.len() < 64
        || body.encrypted_keystore.len() > 16_384
        || !body.encrypted_keystore.trim_start().starts_with('{')
    {
        return HttpResponse::BadRequest().json(ErrorResponse {
            success: false,
            error: "Malformed keystore".to_string(),
            code: "INVALID_KEYSTORE".to_string(),
        });
    }

    let Some(pool) = &data.db_pool else {
        return HttpResponse::ServiceUnavailable().json(ErrorResponse {
            success: false,
            error: "Credential enrolment requires the database-backed deployment".to_string(),
            code: "CREDENTIAL_LOGIN_UNAVAILABLE".to_string(),
        });
    };

    let verifier = match medichain_crypto::password::hash_secret(&body.auth_proof) {
        Ok(v) => v,
        Err(_) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                success: false,
                error: "Malformed authentication proof".to_string(),
                code: "INVALID_AUTH_PROOF".to_string(),
            })
        }
    };

    let result = sqlx::query(
        r#"
        UPDATE users
        SET login_id = $1,
            credential_verifier = $2,
            encrypted_keystore = $3,
            credential_updated_at = NOW(),
            updated_at = NOW()
        WHERE wallet_address = $4
        "#,
    )
    .bind(&login_id)
    .bind(&verifier)
    .bind(&body.encrypted_keystore)
    .bind(&caller.wallet_address)
    .execute(pool)
    .await;

    match result {
        Ok(r) if r.rows_affected() == 1 => {
            clear_failures(&login_id.to_lowercase());
            log::info!(
                "CREDENTIALS_ENROLLED wallet={} login_id={}",
                caller.wallet_address,
                login_id
            );
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "login_id": login_id,
                "message": "You can now sign in with your employee identifier"
            }))
        }
        Ok(_) => HttpResponse::NotFound().json(ErrorResponse {
            success: false,
            error: "No such account".to_string(),
            code: "USER_NOT_FOUND".to_string(),
        }),
        Err(e) => {
            // The unique index is the authority on collisions, not a prior
            // SELECT, so two clinicians enrolling the same identifier at once
            // cannot both succeed.
            let msg = e.to_string();
            if msg.contains("users_login_id_lower_key") {
                return HttpResponse::Conflict().json(ErrorResponse {
                    success: false,
                    error: "That employee identifier is already in use".to_string(),
                    code: "LOGIN_ID_TAKEN".to_string(),
                });
            }
            log::error!("credential enrolment failed: {e}");
            HttpResponse::InternalServerError().json(ErrorResponse {
                success: false,
                error: "Credentials could not be saved".to_string(),
                code: "DATABASE_ERROR".to_string(),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The failure table is process-global, and cargo runs these in parallel in
    // one process. Each test therefore uses a key no other test touches —
    // clearing the whole table instead would let one test wipe another's
    // counters mid-run, which is exactly how this suite first went red.

    #[test]
    fn lockout_engages_after_the_configured_number_of_failures() {
        let id = "lockout-test-user";
        for _ in 0..MAX_FAILED_ATTEMPTS - 1 {
            record_failure(id);
            assert!(!is_locked_out(id), "should not lock before the limit");
        }
        record_failure(id);
        assert!(
            is_locked_out(id),
            "should lock on the {MAX_FAILED_ATTEMPTS}th failure"
        );
    }

    #[test]
    fn a_successful_sign_in_clears_the_failure_counter() {
        let id = "clears-test-user";
        for _ in 0..MAX_FAILED_ATTEMPTS {
            record_failure(id);
        }
        assert!(is_locked_out(id));
        clear_failures(id);
        assert!(!is_locked_out(id));
    }

    #[test]
    fn lockout_is_scoped_to_one_identifier() {
        for _ in 0..MAX_FAILED_ATTEMPTS {
            record_failure("scoping-victim");
        }
        assert!(is_locked_out("scoping-victim"));
        assert!(
            !is_locked_out("scoping-bystander"),
            "one account's failures must not lock another out"
        );
    }

    /// The equaliser must be a usable verifier, or the unknown-identifier path
    /// would return early and reintroduce the timing oracle it exists to close.
    #[test]
    fn the_timing_equaliser_is_a_real_verifier_that_nothing_matches() {
        let dummy = timing_equaliser();
        assert!(dummy.starts_with("$argon2id$"), "got {dummy}");
        assert!(!medichain_crypto::password::verify_secret(
            "any proof",
            dummy
        ));
    }

    #[test]
    fn log_tags_do_not_contain_the_identifier() {
        let tag = hash_id("doctor@hospital.example");
        assert!(!tag.contains("doctor"));
        assert!(!tag.contains('@'));
        assert_eq!(tag.len(), 12, "6 bytes hex-encoded");
    }
}
