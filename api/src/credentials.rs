//! Credentials without keys (ADR-0010, phase C): one-time codes, sign-in
//! lookups, and the throttle that stops password guessing.
//!
//! # The two ways a person gets a password
//!
//! Nobody is handed a password, and a clinician never sees a patient's. Instead an
//! activation or reset **grant** is issued: a short one-time code (`XXXX-XXXX-XXXX`,
//! 60 bits of Crockford base32) that the person redeems by choosing their own
//! password. A patient's code is issued at registration, a staff member's by an
//! administrator; a forgotten password is an administrator reset, never a
//! self-service flow, because there is no second channel to a stranger to prove
//! who is asking.
//!
//! # Why the code is safe to hand over
//!
//! * Only a keyed digest is stored (`credential_grants.code_hash`), so a copy of
//!   the database cannot be searched offline for codes.
//! * It lives 72 hours and is spent by its first redemption.
//! * Five wrong attempts kill it; the account then needs a fresh code.
//! * One live grant per person: issuing a new one revokes the last, so a lost
//!   code is never a second way in.

use chrono::{DateTime, Duration, Utc};
use sha3::{Digest, Sha3_256};
use sqlx::{PgPool, Postgres, Transaction};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use uuid::Uuid;

/// How long a one-time code stays redeemable.
pub const CODE_TTL_HOURS: i64 = 72;
/// Wrong codes tolerated against one grant before it is dead.
pub const MAX_FAILED_REDEMPTIONS: i32 = 5;

const CODE_LEN: usize = 12;
/// Crockford base32: no I, L, O or U, so a code read aloud or off paper cannot
/// be mistaken for another.
const CODE_ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_DIGEST_DOMAIN: &str = "medichain.credential-grant.v1";

// ---------------------------------------------------------------------------
// Shapes the clients send
// ---------------------------------------------------------------------------

/// Whether `proof` has the shape of a client-derived auth proof: 64 hex digits.
///
/// A shape check, not a password check. It stops a client that sent the wrong
/// thing entirely (a raw password, a blank) before any Argon2id work is spent.
pub fn is_valid_auth_proof(proof: &str) -> bool {
    proof.len() == 64 && proof.bytes().all(|b| b.is_ascii_hexdigit())
}

/// A login id or username as stored, or `None` if it breaks the rules: 3 to 64
/// characters of letters, digits, `.`, `_` and `-`.
///
/// Staff employee IDs and patient usernames share one namespace, unique
/// case-insensitively (`users_login_id_lower_key`). A leading `pat-` is refused
/// for everyone: patient record ids start with it, and the redemption lookup
/// treats an identifier that looks like one as a record id.
pub fn validate_login_id(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let shaped = (3..=64).contains(&trimmed.len())
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    let looks_like_record_id = trimmed
        .get(..4)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("pat-"));
    (shaped && !looks_like_record_id).then(|| trimmed.to_string())
}

// ---------------------------------------------------------------------------
// One-time codes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrantPurpose {
    Activation,
    Reset,
}

impl GrantPurpose {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Activation => "activation",
            Self::Reset => "reset",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "activation" => Some(Self::Activation),
            "reset" => Some(Self::Reset),
            _ => None,
        }
    }
}

/// A code as issued: shown once to whoever will hand it over.
#[derive(Debug, Clone)]
pub struct IssuedGrant {
    pub code: String,
    pub expires_at: DateTime<Utc>,
}

/// A new code: 60 random bits as `XXXX-XXXX-XXXX`.
pub fn generate_code() -> Result<String, medichain_crypto::CryptoError> {
    let random = medichain_crypto::random_bytes::<8>()?;
    let mut bits = u64::from_be_bytes(random) >> 4;
    let mut symbols = [b'0'; CODE_LEN];
    for slot in symbols.iter_mut().rev() {
        *slot = CODE_ALPHABET[(bits & 31) as usize];
        bits >>= 5;
    }
    Ok(format_code(&symbols))
}

fn format_code(symbols: &[u8; CODE_LEN]) -> String {
    let text = String::from_utf8_lossy(symbols);
    format!("{}-{}-{}", &text[0..4], &text[4..8], &text[8..12])
}

/// The canonical spelling of a code a person typed, or `None` if it cannot be one.
///
/// Case, spaces and dashes are ignored and the Crockford look-alikes are folded
/// (`O` to `0`, `I` and `L` to `1`), matching the client, so a code read off paper
/// and keyed in by hand still redeems.
pub fn normalize_code(raw: &str) -> Option<String> {
    let mut symbols = [b'0'; CODE_LEN];
    let mut count = 0usize;
    for c in raw.chars().filter(|c| !c.is_whitespace() && *c != '-') {
        let folded = match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        };
        let byte = u8::try_from(folded).ok()?;
        if !CODE_ALPHABET.contains(&byte) || count == CODE_LEN {
            return None;
        }
        symbols[count] = byte;
        count += 1;
    }
    (count == CODE_LEN).then(|| format_code(&symbols))
}

/// The keyed digest stored in place of a code.
///
/// SHA3-256 over `key || user || purpose || code`. Keccak is not subject to
/// length extension, so the secret-prefix construction is a sound keyed hash
/// (the same reasoning as `support::hash_national_id`). The key is derived from
/// the signing secret, so the digests are useless without the running server's
/// configuration.
fn code_digest(user_id: Uuid, purpose: GrantPurpose, code: &str) -> String {
    let mut hasher = Sha3_256::new();
    hasher.update(crate::security::jwt::derived_key(CODE_DIGEST_DOMAIN));
    hasher.update([0]);
    hasher.update(user_id.as_bytes());
    hasher.update([0]);
    hasher.update(purpose.as_str().as_bytes());
    hasher.update([0]);
    hasher.update(code.as_bytes());
    hex::encode(hasher.finalize())
}

/// Issue a grant inside the caller's transaction.
///
/// Every live grant the user already holds, of any purpose, is revoked first:
/// one code at a time, so the last one handed out is the only one that works.
pub async fn issue_in(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    purpose: GrantPurpose,
    issued_by: Option<Uuid>,
) -> Result<IssuedGrant, IssueError> {
    let code = generate_code().map_err(|_| IssueError::Randomness)?;
    let expires_at = Utc::now() + Duration::hours(CODE_TTL_HOURS);
    sqlx::query(
        "UPDATE credential_grants SET revoked_at = NOW()
         WHERE user_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL",
    )
    .bind(user_id)
    .execute(&mut **transaction)
    .await
    .map_err(IssueError::Database)?;
    sqlx::query(
        "INSERT INTO credential_grants
             (id, user_id, purpose, code_hash, expires_at, issued_by)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(purpose.as_str())
    .bind(code_digest(user_id, purpose, &code))
    .bind(expires_at)
    .bind(issued_by)
    .execute(&mut **transaction)
    .await
    .map_err(IssueError::Database)?;
    Ok(IssuedGrant { code, expires_at })
}

/// Issue a grant in its own transaction.
pub async fn issue(
    pool: &PgPool,
    user_id: Uuid,
    purpose: GrantPurpose,
    issued_by: Option<Uuid>,
) -> Result<IssuedGrant, IssueError> {
    let mut transaction = pool.begin().await.map_err(IssueError::Database)?;
    let grant = issue_in(&mut transaction, user_id, purpose, issued_by).await?;
    transaction.commit().await.map_err(IssueError::Database)?;
    Ok(grant)
}

#[derive(Debug)]
pub enum IssueError {
    Randomness,
    Database(sqlx::Error),
}

/// Why a code was refused.
#[derive(Debug)]
pub enum RedeemError {
    /// Wrong, expired, spent, revoked, or never issued. Deliberately one answer:
    /// the caller must not learn which.
    Invalid,
    /// Five wrong codes have killed the grant; a fresh one is needed.
    Locked,
    Database(sqlx::Error),
}

/// A live grant that a presented code matched.
#[derive(Debug, Clone, Copy)]
pub struct MatchedGrant {
    pub id: Uuid,
    #[cfg_attr(not(test), allow(dead_code))] // grant-purpose isolation is tested
    pub purpose: GrantPurpose,
}

type GrantRow = (Uuid, String, String, DateTime<Utc>, i32);

/// Check `code` against the user's live grants.
///
/// A wrong code is counted against every usable grant and the count is
/// committed before this returns, so the refusal cannot be retried for free. The
/// fifth wrong code kills the grant (and is answered as [`RedeemError::Locked`]);
/// from then on even the right code is refused.
pub async fn match_code(
    pool: &PgPool,
    user_id: Uuid,
    code: &str,
) -> Result<MatchedGrant, RedeemError> {
    let mut transaction = pool.begin().await.map_err(RedeemError::Database)?;
    let rows: Vec<GrantRow> = sqlx::query_as(
        "SELECT id, purpose, code_hash, expires_at, failed_attempts
         FROM credential_grants
         WHERE user_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL
         ORDER BY created_at DESC
         FOR UPDATE",
    )
    .bind(user_id)
    .fetch_all(&mut *transaction)
    .await
    .map_err(RedeemError::Database)?;

    let now = Utc::now();
    let live: Vec<&GrantRow> = rows.iter().filter(|row| row.3 > now).collect();
    if live.is_empty() {
        return Err(RedeemError::Invalid);
    }
    let usable: Vec<&GrantRow> = live
        .into_iter()
        .filter(|row| row.4 < MAX_FAILED_REDEMPTIONS)
        .collect();
    if usable.is_empty() {
        return Err(RedeemError::Locked);
    }
    if let Some(found) = find_matching(&usable, user_id, code) {
        transaction.commit().await.map_err(RedeemError::Database)?;
        return Ok(found);
    }
    let ids: Vec<Uuid> = usable.iter().map(|row| row.0).collect();
    let counts: Vec<i32> = sqlx::query_scalar(
        "UPDATE credential_grants SET failed_attempts = failed_attempts + 1
         WHERE id = ANY($1) RETURNING failed_attempts",
    )
    .bind(&ids)
    .fetch_all(&mut *transaction)
    .await
    .map_err(RedeemError::Database)?;
    transaction.commit().await.map_err(RedeemError::Database)?;
    if counts.iter().any(|count| *count >= MAX_FAILED_REDEMPTIONS) {
        return Err(RedeemError::Locked);
    }
    Err(RedeemError::Invalid)
}

/// The grant whose stored digest equals the presented code's, comparing every
/// candidate so the time taken does not say which one matched.
fn find_matching(usable: &[&GrantRow], user_id: Uuid, code: &str) -> Option<MatchedGrant> {
    let mut found = None;
    for row in usable {
        let Some(purpose) = GrantPurpose::parse(&row.1) else {
            continue;
        };
        let expected = code_digest(user_id, purpose, code);
        if medichain_crypto::constant_time_eq(expected.as_bytes(), row.2.as_bytes()) {
            found = Some(MatchedGrant { id: row.0, purpose });
        }
    }
    found
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/// The columns sign-in and redemption need about an account. Deliberately its own
/// row type rather than fields on `User`: `User` is serialised by several
/// endpoints, and carrying a verifier on it would risk leaking it into an
/// unrelated response.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AccountRow {
    pub id: Uuid,
    pub role: String,
    pub status: String,
    pub login_id: Option<String>,
    pub credential_verifier: Option<String>,
    /// For the password rule that refuses a person's own name.
    pub name: Option<String>,
}

const ACCOUNT_COLUMNS: &str = "id, role, status, login_id, credential_verifier, name";

/// The account a person signs in as: `identifier` is an employee ID or username,
/// compared case-insensitively. E-mail is deliberately not an alias: the
/// client-derived proof is salted with the login ID, so an alias would derive
/// a different proof for the same password.
pub async fn find_for_sign_in(
    pool: &PgPool,
    identifier: &str,
) -> Result<Option<AccountRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {ACCOUNT_COLUMNS} FROM users
         WHERE lower(login_id) = $1
         LIMIT 1"
    ))
    .bind(identifier.to_lowercase())
    .fetch_optional(pool)
    .await
}

/// The account a one-time code was issued for. A patient is named by their
/// record id (`PAT-…`), which is all they hold before they have a username;
/// everyone else by login ID.
pub async fn find_for_grant(
    pool: &PgPool,
    identifier: &str,
) -> Result<Option<AccountRow>, sqlx::Error> {
    let by_record: Option<AccountRow> = sqlx::query_as(&format!(
        "SELECT {ACCOUNT_COLUMNS} FROM users
         WHERE role = 'Patient' AND linked_patient_id = $1
         LIMIT 1"
    ))
    .bind(identifier)
    .fetch_optional(pool)
    .await?;
    match by_record {
        Some(account) => Ok(Some(account)),
        None => find_for_sign_in(pool, identifier).await,
    }
}

/// Whether another account already holds `login_id` (case-insensitively).
#[cfg(test)]
pub async fn login_id_taken(
    pool: &PgPool,
    login_id: &str,
    except: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM users WHERE lower(login_id) = lower($1) AND id <> $2)",
    )
    .bind(login_id)
    .bind(except)
    .fetch_one(pool)
    .await
}

/// Whether `error` is the unique index on the login id refusing a duplicate.
pub fn is_login_id_conflict(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|db| db.constraint())
        .is_some_and(|name| name == "users_login_id_lower_key")
}

#[derive(Debug)]
pub enum ApplyError {
    /// The grant was spent, revoked, locked or expired between matching and now.
    GrantGone,
    LoginIdTaken,
    Database(sqlx::Error),
}

/// Spend a matched grant and install the credential it was issued for.
///
/// One transaction: the grant is consumed, the verifier (and the login id, if the
/// account had none yet) written, and every session the account had is ended, so
/// a redemption can never leave the old password or an old session alive beside
/// the new one.
pub async fn apply_redemption(
    pool: &PgPool,
    grant: MatchedGrant,
    account_id: Uuid,
    login_id: &str,
    verifier: &str,
) -> Result<(), ApplyError> {
    let mut transaction = pool.begin().await.map_err(ApplyError::Database)?;
    let spent = sqlx::query(
        "UPDATE credential_grants SET consumed_at = NOW()
         WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL
           AND failed_attempts < $2 AND expires_at > NOW() AND user_id = $3",
    )
    .bind(grant.id)
    .bind(MAX_FAILED_REDEMPTIONS)
    .bind(account_id)
    .execute(&mut *transaction)
    .await
    .map_err(ApplyError::Database)?;
    if spent.rows_affected() != 1 {
        return Err(ApplyError::GrantGone);
    }
    let written = sqlx::query(
        "UPDATE users
         SET login_id = COALESCE(login_id, $2),
             username = COALESCE(username, $2),
             credential_verifier = $3,
             credential_updated_at = NOW(),
             updated_at = NOW()
         WHERE id = $1",
    )
    .bind(account_id)
    .bind(login_id)
    .bind(verifier)
    .execute(&mut *transaction)
    .await;
    match written {
        Ok(result) if result.rows_affected() == 1 => {}
        Ok(_) => return Err(ApplyError::GrantGone),
        Err(error) if is_login_id_conflict(&error) => return Err(ApplyError::LoginIdTaken),
        Err(error) => return Err(ApplyError::Database(error)),
    }
    crate::auth_sessions::revoke_sessions_in(
        &mut transaction,
        account_id,
        None,
        "credential_redeemed",
    )
    .await
    .map_err(ApplyError::Database)?;
    transaction.commit().await.map_err(ApplyError::Database)?;
    Ok(())
}

/// Replace a password the person knows, and end every other session.
///
/// `Ok(false)` means the stored verifier was no longer the one the caller proved
/// (changed by a concurrent request), so nothing was written.
pub async fn replace_verifier(
    pool: &PgPool,
    account_id: Uuid,
    expected_verifier: &str,
    new_verifier: &str,
    keep_session: Option<Uuid>,
) -> Result<bool, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let written = sqlx::query(
        "UPDATE users SET credential_verifier = $3, credential_updated_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND credential_verifier = $2",
    )
    .bind(account_id)
    .bind(expected_verifier)
    .bind(new_verifier)
    .execute(&mut *transaction)
    .await?;
    if written.rows_affected() != 1 {
        return Ok(false);
    }
    crate::auth_sessions::revoke_sessions_in(
        &mut transaction,
        account_id,
        keep_session,
        "password_changed",
    )
    .await?;
    transaction.commit().await?;
    Ok(true)
}

/// An administrator's reset: the old password stops working at once, every
/// session ends, and a one-time code is issued to choose a new one.
///
/// `Ok(None)` when no such account exists.
pub async fn reset_credential(
    pool: &PgPool,
    account_id: Uuid,
    issued_by: Uuid,
) -> Result<Option<IssuedGrant>, IssueError> {
    let mut transaction = pool.begin().await.map_err(IssueError::Database)?;
    let cleared = sqlx::query(
        "UPDATE users SET credential_verifier = NULL, credential_updated_at = NOW(), updated_at = NOW()
         WHERE id = $1",
    )
    .bind(account_id)
    .execute(&mut *transaction)
    .await
    .map_err(IssueError::Database)?;
    if cleared.rows_affected() != 1 {
        return Ok(None);
    }
    crate::auth_sessions::revoke_sessions_in(
        &mut transaction,
        account_id,
        None,
        "credential_reset",
    )
    .await
    .map_err(IssueError::Database)?;
    let grant = issue_in(
        &mut transaction,
        account_id,
        GrantPurpose::Reset,
        Some(issued_by),
    )
    .await?;
    transaction.commit().await.map_err(IssueError::Database)?;
    Ok(Some(grant))
}

// ---------------------------------------------------------------------------
// Sign-in throttle
// ---------------------------------------------------------------------------

/// Failed attempts tolerated for one identifier before it is locked out.
pub const MAX_FAILED_SIGN_INS: u32 = 5;
/// How long a lockout lasts, and how long the failure counter is remembered.
const LOCKOUT: std::time::Duration = std::time::Duration::from_secs(15 * 60);
/// The most identifiers tracked at once. A bound, not a policy: an attacker who
/// invents identifiers cannot grow the table without limit, and past the bound
/// the oldest entry is forgotten first.
const MAX_TRACKED_IDENTIFIERS: usize = 10_000;

struct Failures {
    count: u32,
    first_seen: Instant,
}

/// Per-identifier failure tracking.
///
/// Process-local, like the request-rate limiter. Behind several API instances an
/// attacker can spread attempts across them; that limitation is recorded in
/// `docs/WORKFLOW_AUDIT.md` rather than papered over. It still defeats the
/// single-host credential stuffing the global limiter does not, because that one
/// is not keyed by account. Unknown identifiers are tracked too, so an attacker
/// cannot tell a real account from a missing one by whether it ever locks.
fn failure_table() -> &'static Mutex<HashMap<String, Failures>> {
    static TABLE: OnceLock<Mutex<HashMap<String, Failures>>> = OnceLock::new();
    TABLE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The table key for an identifier: trimmed and lower-cased, the way the lookup
/// compares it.
pub fn throttle_key(identifier: &str) -> String {
    identifier.trim().to_lowercase()
}

/// Whether this key is currently locked out, forgetting entries past their window.
pub fn is_locked_out(key: &str) -> bool {
    let Ok(mut table) = failure_table().lock() else {
        // A poisoned lock must not become a way to bypass lockout.
        return true;
    };
    match table.get(key) {
        Some(f) if f.first_seen.elapsed() >= LOCKOUT => {
            table.remove(key);
            false
        }
        Some(f) => f.count >= MAX_FAILED_SIGN_INS,
        None => false,
    }
}

pub fn record_failure(key: &str) {
    let Ok(mut table) = failure_table().lock() else {
        return;
    };
    if table.len() >= MAX_TRACKED_IDENTIFIERS && !table.contains_key(key) {
        make_room(&mut table);
    }
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

/// Free one slot: drop every expired entry, and if the table is still full, the
/// oldest one.
fn make_room(table: &mut HashMap<String, Failures>) {
    table.retain(|_, f| f.first_seen.elapsed() < LOCKOUT);
    if table.len() < MAX_TRACKED_IDENTIFIERS {
        return;
    }
    let oldest = table
        .iter()
        .min_by_key(|(_, f)| f.first_seen)
        .map(|(key, _)| key.clone());
    if let Some(key) = oldest {
        table.remove(&key);
    }
}

pub fn clear_failures(key: &str) {
    if let Ok(mut table) = failure_table().lock() {
        table.remove(key);
    }
}

/// An Argon2id verifier over a value that is never a real credential, used to
/// spend the same CPU on an unknown identifier as on a known one.
///
/// Without this, "no such user" returns in microseconds while a wrong password
/// takes the full Argon2id cost, and that timing difference enumerates accounts.
/// Built once; the plaintext is not a secret.
pub fn timing_equaliser() -> &'static str {
    static DUMMY: OnceLock<String> = OnceLock::new();
    DUMMY.get_or_init(|| {
        medichain_crypto::password::hash_secret("timing-equaliser-not-a-credential")
            .unwrap_or_default()
    })
}

/// Short non-reversible tag for logs, so a failed-sign-in line never records the
/// identifier someone typed (which may be a real person's work e-mail).
#[cfg(test)]
pub fn log_tag(identifier: &str) -> String {
    let digest = medichain_crypto::sha256(identifier.as_bytes());
    medichain_crypto::to_hex(&digest[..6])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_generated_code_has_the_documented_shape() {
        for _ in 0..50 {
            let code = generate_code().unwrap();
            assert_eq!(code.len(), 14, "{code}");
            assert_eq!(
                normalize_code(&code).as_deref(),
                Some(code.as_str()),
                "a code must survive its own normalisation"
            );
            assert!(code
                .chars()
                .filter(|c| *c != '-')
                .all(|c| CODE_ALPHABET.contains(&(c as u8))));
        }
    }

    #[test]
    fn codes_are_not_repeated() {
        let a = generate_code().unwrap();
        let b = generate_code().unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn a_typed_code_is_normalised_the_way_the_client_does() {
        assert_eq!(
            normalize_code("abcd efgh jklm").as_deref(),
            Some("ABCD-EFGH-JK1M")
        );
        // Look-alikes fold: O to 0, I and L to 1.
        assert_eq!(
            normalize_code("o0o0-iiii-llll").as_deref(),
            Some("0000-1111-1111")
        );
        assert_eq!(normalize_code("ABCD-EFGH").as_deref(), None, "too short");
        assert_eq!(
            normalize_code("ABCD-EFGH-JKLM-NPQR").as_deref(),
            None,
            "too long"
        );
        assert_eq!(
            normalize_code("ABCD-EFGH-JKLU").as_deref(),
            None,
            "U is not in the alphabet"
        );
        assert_eq!(normalize_code("").as_deref(), None);
    }

    #[test]
    fn the_digest_is_bound_to_user_purpose_and_code() {
        let user = Uuid::new_v4();
        let base = code_digest(user, GrantPurpose::Activation, "ABCD-EFGH-JKLM");
        assert_eq!(base.len(), 64);
        assert_ne!(
            base,
            code_digest(Uuid::new_v4(), GrantPurpose::Activation, "ABCD-EFGH-JKLM")
        );
        assert_ne!(
            base,
            code_digest(user, GrantPurpose::Reset, "ABCD-EFGH-JKLM")
        );
        assert_ne!(
            base,
            code_digest(user, GrantPurpose::Activation, "ABCD-EFGH-JKLN")
        );
        assert!(!base.contains("ABCD"), "the code is never in its digest");
    }

    #[test]
    fn login_ids_follow_the_namespace_rules() {
        assert_eq!(
            validate_login_id(" bt.doctor ").as_deref(),
            Some("bt.doctor")
        );
        assert_eq!(validate_login_id("EMP-001").as_deref(), Some("EMP-001"));
        assert_eq!(validate_login_id("ab"), None, "too short");
        assert_eq!(validate_login_id(&"a".repeat(65)), None, "too long");
        assert_eq!(validate_login_id("a b!"), None, "spaces and punctuation");
        assert_eq!(validate_login_id("名前名前"), None, "not ASCII");
        assert_eq!(
            validate_login_id("PAT-1a2b3c4d"),
            None,
            "looks like a record id"
        );
        assert_eq!(validate_login_id("pat-x"), None);
        assert_eq!(validate_login_id("pat").as_deref(), Some("pat"));
    }

    #[test]
    fn an_auth_proof_is_64_hex_digits() {
        assert!(is_valid_auth_proof(&"a".repeat(64)));
        assert!(is_valid_auth_proof(
            &"0123456789abcdefABCDEF".repeat(3)[..64]
        ));
        assert!(!is_valid_auth_proof(&"a".repeat(63)));
        assert!(!is_valid_auth_proof(&"g".repeat(64)));
        assert!(!is_valid_auth_proof("zz-not-a-proof"));
        assert!(!is_valid_auth_proof(""));
    }

    // The failure table is process-global and cargo runs tests in parallel in one
    // process, so each test uses a key no other test touches.

    #[test]
    fn lockout_engages_after_the_configured_number_of_failures() {
        let key = "lockout-test-user";
        for _ in 0..MAX_FAILED_SIGN_INS - 1 {
            record_failure(key);
            assert!(!is_locked_out(key), "should not lock before the limit");
        }
        record_failure(key);
        assert!(is_locked_out(key), "should lock on the fifth failure");
    }

    #[test]
    fn a_successful_sign_in_clears_the_failure_counter() {
        let key = "clears-test-user";
        for _ in 0..MAX_FAILED_SIGN_INS {
            record_failure(key);
        }
        assert!(is_locked_out(key));
        clear_failures(key);
        assert!(!is_locked_out(key));
    }

    #[test]
    fn lockout_is_scoped_to_one_identifier() {
        for _ in 0..MAX_FAILED_SIGN_INS {
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
        let tag = log_tag("doctor@hospital.example");
        assert!(!tag.contains("doctor"));
        assert!(!tag.contains('@'));
        assert_eq!(tag.len(), 12, "6 bytes hex-encoded");
    }

    #[test]
    fn the_failure_table_is_bounded() {
        let mut table: HashMap<String, Failures> = HashMap::new();
        for n in 0..MAX_TRACKED_IDENTIFIERS {
            table.insert(
                format!("k{n}"),
                Failures {
                    count: 1,
                    first_seen: Instant::now(),
                },
            );
        }
        make_room(&mut table);
        assert_eq!(
            table.len(),
            MAX_TRACKED_IDENTIFIERS - 1,
            "one slot is freed"
        );
    }
}

// ---------------------------------------------------------------------------
// Against a real database
// ---------------------------------------------------------------------------

#[cfg(test)]
mod grant_tests {
    use super::*;
    use crate::repositories::postgres::tests::get_test_pool;

    async fn person(pool: &PgPool, role: &str) -> Uuid {
        let id = crate::test_fixtures::insert_pg_user(pool, role).await;
        Uuid::parse_str(&id).unwrap()
    }

    async fn grant_row(pool: &PgPool, user: Uuid) -> (i32, bool, bool) {
        sqlx::query_as(
            "SELECT failed_attempts, consumed_at IS NOT NULL, revoked_at IS NOT NULL
             FROM credential_grants WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
        )
        .bind(user)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn the_code_redeems_once_and_only_its_digest_is_stored() {
        let pool = get_test_pool().await;
        let user = person(&pool, "Nurse").await;
        let grant = issue(&pool, user, GrantPurpose::Activation, None)
            .await
            .unwrap();
        let stored: String =
            sqlx::query_scalar("SELECT code_hash FROM credential_grants WHERE user_id = $1")
                .bind(user)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(!stored.contains(&grant.code), "the code is never stored");
        assert!(grant.expires_at > Utc::now() + Duration::hours(71));

        let matched = match_code(&pool, user, &grant.code).await.unwrap();
        assert_eq!(matched.purpose, GrantPurpose::Activation);
        apply_redemption(&pool, matched, user, "xr.nurse.one", &"a".repeat(64))
            .await
            .unwrap();

        // Spent: the same code is now just a wrong code.
        assert!(matches!(
            match_code(&pool, user, &grant.code).await,
            Err(RedeemError::Invalid)
        ));
        // And it cannot be applied twice even if somebody held the match.
        assert!(matches!(
            apply_redemption(&pool, matched, user, "xr.nurse.one", &"b".repeat(64)).await,
            Err(ApplyError::GrantGone)
        ));
    }

    #[tokio::test]
    async fn five_wrong_codes_kill_the_grant_and_the_right_code_no_longer_works() {
        let pool = get_test_pool().await;
        let user = person(&pool, "Nurse").await;
        let grant = issue(&pool, user, GrantPurpose::Activation, None)
            .await
            .unwrap();
        for attempt in 1..MAX_FAILED_REDEMPTIONS {
            assert!(
                matches!(
                    match_code(&pool, user, "ZZZZ-ZZZZ-ZZZZ").await,
                    Err(RedeemError::Invalid)
                ),
                "wrong code #{attempt} is an ordinary refusal"
            );
        }
        assert!(
            matches!(
                match_code(&pool, user, "ZZZZ-ZZZZ-ZZZZ").await,
                Err(RedeemError::Locked)
            ),
            "the fifth wrong code kills the grant"
        );
        assert!(
            matches!(
                match_code(&pool, user, &grant.code).await,
                Err(RedeemError::Locked)
            ),
            "a dead grant refuses even the right code"
        );
        assert_eq!(grant_row(&pool, user).await.0, MAX_FAILED_REDEMPTIONS);
    }

    #[tokio::test]
    async fn a_new_grant_revokes_the_last_so_only_one_code_works() {
        let pool = get_test_pool().await;
        let user = person(&pool, "Patient").await;
        let first = issue(&pool, user, GrantPurpose::Activation, None)
            .await
            .unwrap();
        let second = issue(&pool, user, GrantPurpose::Reset, None).await.unwrap();
        assert_ne!(first.code, second.code);
        assert!(
            matches!(
                match_code(&pool, user, &first.code).await,
                Err(RedeemError::Invalid)
            ),
            "the replaced code is dead"
        );
        let live: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM credential_grants
             WHERE user_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL",
        )
        .bind(user)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(live, 1, "one live grant per person");
        assert_eq!(
            match_code(&pool, user, &second.code).await.unwrap().purpose,
            GrantPurpose::Reset
        );
    }

    #[tokio::test]
    async fn an_expired_code_is_refused_as_invalid() {
        let pool = get_test_pool().await;
        let user = person(&pool, "Nurse").await;
        let grant = issue(&pool, user, GrantPurpose::Activation, None)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE credential_grants
             SET created_at = NOW() - INTERVAL '4 days', expires_at = NOW() - INTERVAL '1 day'
             WHERE user_id = $1",
        )
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
        assert!(matches!(
            match_code(&pool, user, &grant.code).await,
            Err(RedeemError::Invalid)
        ));
    }

    #[tokio::test]
    async fn a_code_belongs_to_one_account() {
        let pool = get_test_pool().await;
        let owner = person(&pool, "Nurse").await;
        let other = person(&pool, "Nurse").await;
        let grant = issue(&pool, owner, GrantPurpose::Activation, None)
            .await
            .unwrap();
        issue(&pool, other, GrantPurpose::Activation, None)
            .await
            .unwrap();
        assert!(
            matches!(
                match_code(&pool, other, &grant.code).await,
                Err(RedeemError::Invalid)
            ),
            "one account's code does not redeem another's"
        );
    }

    #[tokio::test]
    async fn a_login_id_is_unique_across_staff_and_patients_ignoring_case() {
        let pool = get_test_pool().await;
        let staff = person(&pool, "Nurse").await;
        let patient = person(&pool, "Patient").await;
        let name = format!("shared.{}", &Uuid::new_v4().to_string()[..8]);
        let grant = issue(&pool, patient, GrantPurpose::Activation, None)
            .await
            .unwrap();
        sqlx::query("UPDATE users SET login_id = $2 WHERE id = $1")
            .bind(staff)
            .bind(name.to_uppercase())
            .execute(&pool)
            .await
            .unwrap();

        assert!(login_id_taken(&pool, &name, patient).await.unwrap());
        let matched = match_code(&pool, patient, &grant.code).await.unwrap();
        assert!(matches!(
            apply_redemption(&pool, matched, patient, &name, &"a".repeat(64)).await,
            Err(ApplyError::LoginIdTaken)
        ));
        // The refusal rolled everything back: the code still works for another name.
        let matched = match_code(&pool, patient, &grant.code).await.unwrap();
        apply_redemption(
            &pool,
            matched,
            patient,
            &format!("{name}.two"),
            &"a".repeat(64),
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn a_reset_clears_the_password_ends_every_session_and_issues_a_code() {
        let pool = get_test_pool().await;
        let admin = person(&pool, "Admin").await;
        let user = person(&pool, "Nurse").await;
        sqlx::query("UPDATE users SET login_id = $2, credential_verifier = $3 WHERE id = $1")
            .bind(user)
            .bind(format!("reset.{}", &Uuid::new_v4().to_string()[..8]))
            .bind("$argon2id$placeholder")
            .execute(&pool)
            .await
            .unwrap();
        let sid = crate::auth_sessions::create(
            &pool,
            &user.to_string(),
            &format!("generation-{}", Uuid::new_v4()),
            &Uuid::new_v4().to_string(),
            Utc::now() + Duration::hours(1),
        )
        .await
        .unwrap();

        let grant = reset_credential(&pool, user, admin)
            .await
            .unwrap()
            .expect("the account exists");
        let verifier: Option<String> =
            sqlx::query_scalar("SELECT credential_verifier FROM users WHERE id = $1")
                .bind(user)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(verifier.is_none(), "the old password stops working at once");
        assert!(
            !crate::auth_sessions::is_session_active(&pool, sid)
                .await
                .unwrap(),
            "every session ends"
        );
        let matched = match_code(&pool, user, &grant.code).await.unwrap();
        assert_eq!(matched.purpose, GrantPurpose::Reset);

        assert!(
            reset_credential(&pool, Uuid::new_v4(), admin)
                .await
                .unwrap()
                .is_none(),
            "an account that does not exist has nothing to reset"
        );
    }

    #[tokio::test]
    async fn changing_a_password_keeps_one_session_and_ends_the_rest() {
        let pool = get_test_pool().await;
        let user = person(&pool, "Doctor").await;
        sqlx::query("UPDATE users SET login_id = $2, credential_verifier = $3 WHERE id = $1")
            .bind(user)
            .bind(format!("change.{}", &Uuid::new_v4().to_string()[..8]))
            .bind("old-verifier")
            .execute(&pool)
            .await
            .unwrap();
        let mut sessions = Vec::new();
        for _ in 0..3 {
            sessions.push(
                crate::auth_sessions::create(
                    &pool,
                    &user.to_string(),
                    &format!("generation-{}", Uuid::new_v4()),
                    &Uuid::new_v4().to_string(),
                    Utc::now() + Duration::hours(1),
                )
                .await
                .unwrap(),
            );
        }
        assert!(
            !replace_verifier(&pool, user, "not-the-stored-one", "new-verifier", None)
                .await
                .unwrap(),
            "a verifier that is no longer the stored one changes nothing"
        );
        assert!(replace_verifier(
            &pool,
            user,
            "old-verifier",
            "new-verifier",
            Some(sessions[0])
        )
        .await
        .unwrap());
        assert!(crate::auth_sessions::is_session_active(&pool, sessions[0])
            .await
            .unwrap());
        assert!(!crate::auth_sessions::is_session_active(&pool, sessions[1])
            .await
            .unwrap());
        assert!(!crate::auth_sessions::is_session_active(&pool, sessions[2])
            .await
            .unwrap());
    }
}
