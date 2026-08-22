//! Server-side emergency grants with fixed lifetime and exact binding checks.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;
use uuid::Uuid;

pub const EMERGENCY_GRANT_TTL_MINUTES: i64 = 15;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmergencyGrantScope {
    EmergencySummary,
    SelectedRecord,
    FullRecord,
    DocumentView,
    DownloadProhibited,
    OfflineProhibited,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmergencyGrantStatus {
    Active,
    Expired,
    Revoked,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EmergencyAccessGrant {
    pub id: String,
    pub patient_id: String,
    pub requesting_person_id: String,
    pub organization_id: String,
    pub facility_id: Option<String>,
    pub device_id: String,
    pub reason_code: String,
    pub reason_text: Option<String>,
    pub scopes: Vec<EmergencyGrantScope>,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub revoked_reason: Option<String>,
    pub status: EmergencyGrantStatus,
}

/// The five identities an emergency grant is bound to.
///
/// Grouped rather than passed positionally because `issue` and `validate` take
/// all five together and four of them are plain strings — transposing, say,
/// `person_id` and `organization_id` at a call site type-checks cleanly and
/// silently binds the grant to the wrong party. Naming each at construction
/// makes that mistake visible. (`EmergencyAccessGrant` keeps them flat because
/// it is a serialized wire/storage type.)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmergencyGrantBinding {
    pub patient_id: String,
    pub person_id: String,
    pub organization_id: String,
    pub facility_id: Option<String>,
    pub device_id: String,
}

pub struct EmergencyGrantStore {
    grants: RwLock<HashMap<String, EmergencyAccessGrant>>,
    pool: Option<sqlx::PgPool>,
}

impl EmergencyGrantStore {
    pub fn new() -> Self {
        Self {
            grants: RwLock::new(HashMap::new()),
            pool: None,
        }
    }

    /// Use PostgreSQL for authority state when the application's selected
    /// repository backend is PostgreSQL. Memory remains demo-only.
    pub fn with_pool(pool: sqlx::PgPool) -> Self {
        Self {
            grants: RwLock::new(HashMap::new()),
            pool: Some(pool),
        }
    }

    /// Issue a narrow emergency grant; callers must separately verify a live approved device.
    pub async fn issue(
        &self,
        binding: EmergencyGrantBinding,
        reason_code: String,
        reason_text: Option<String>,
        scopes: Vec<EmergencyGrantScope>,
        now: DateTime<Utc>,
    ) -> Result<EmergencyAccessGrant, &'static str> {
        let EmergencyGrantBinding {
            patient_id,
            person_id,
            organization_id,
            facility_id,
            device_id,
        } = binding;
        if patient_id.is_empty()
            || person_id.is_empty()
            || organization_id.is_empty()
            || device_id.is_empty()
            || reason_code.is_empty()
        {
            return Err("Patient, professional, organization, device, and reason are required");
        }
        if scopes.is_empty() {
            return Err("At least one emergency scope is required");
        }
        if scopes.contains(&EmergencyGrantScope::FullRecord) {
            return Err("Full-record emergency access requires stronger policy and is not available through this grant");
        }
        let grant = EmergencyAccessGrant {
            id: Uuid::new_v4().to_string(),
            patient_id,
            requesting_person_id: person_id,
            organization_id,
            facility_id,
            device_id,
            reason_code,
            reason_text,
            scopes,
            issued_at: now,
            expires_at: now + Duration::minutes(EMERGENCY_GRANT_TTL_MINUTES),
            revoked_at: None,
            revoked_reason: None,
            status: EmergencyGrantStatus::Active,
        };
        if let Some(pool) = &self.pool {
            sqlx::query(
                "INSERT INTO emergency_access_grants
                 (id, patient_id, requesting_person_id, organization_id, facility_id,
                  device_id, reason_code, reason_text, scopes, issued_at, expires_at,
                  revoked_at, revoked_reason, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
            )
            .bind(&grant.id)
            .bind(&grant.patient_id)
            .bind(&grant.requesting_person_id)
            .bind(&grant.organization_id)
            .bind(&grant.facility_id)
            .bind(&grant.device_id)
            .bind(&grant.reason_code)
            .bind(&grant.reason_text)
            .bind(
                serde_json::to_value(&grant.scopes)
                    .map_err(|_| "Emergency grant scopes are invalid")?,
            )
            .bind(grant.issued_at)
            .bind(grant.expires_at)
            .bind(grant.revoked_at)
            .bind(&grant.revoked_reason)
            .bind("active")
            .execute(pool)
            .await
            .map_err(|_| "Emergency grant store is unavailable")?;
            return Ok(grant);
        }
        self.grants
            .write()
            .map_err(|_| "Emergency grant store is unavailable")?
            .insert(grant.id.clone(), grant.clone());
        Ok(grant)
    }

    /// Validate every binding before returning protected emergency data.
    pub async fn validate(
        &self,
        grant_id: &str,
        binding: &EmergencyGrantBinding,
        required_scope: EmergencyGrantScope,
        now: DateTime<Utc>,
    ) -> Result<EmergencyAccessGrant, &'static str> {
        if let Some(pool) = &self.pool {
            let grant = self
                .get(grant_id)
                .await?
                .ok_or("Emergency grant not found")?;
            if grant.status == EmergencyGrantStatus::Active && now >= grant.expires_at {
                sqlx::query("UPDATE emergency_access_grants SET status = 'expired' WHERE id = $1 AND status = 'active'")
                    .bind(grant_id).execute(pool).await.map_err(|_| "Emergency grant store is unavailable")?;
                return Err("Emergency grant has expired");
            }
            return validate_grant(grant, binding, required_scope);
        }
        let mut grants = self
            .grants
            .write()
            .map_err(|_| "Emergency grant store is unavailable")?;
        let grant = grants
            .get_mut(grant_id)
            .ok_or("Emergency grant not found")?;
        if grant.status == EmergencyGrantStatus::Active && now >= grant.expires_at {
            grant.status = EmergencyGrantStatus::Expired;
        }
        validate_grant(grant.clone(), binding, required_scope)
    }

    pub async fn revoke(
        &self,
        grant_id: &str,
        reason: String,
        now: DateTime<Utc>,
    ) -> Result<EmergencyAccessGrant, &'static str> {
        if reason.trim().is_empty() {
            return Err("A revocation reason is required");
        }
        if let Some(pool) = &self.pool {
            let row = sqlx::query_as::<_, (String, String, String, String, Option<String>, String, String, Option<String>, serde_json::Value, DateTime<Utc>, DateTime<Utc>, Option<DateTime<Utc>>, Option<String>, String)>(
                "UPDATE emergency_access_grants SET status = 'revoked', revoked_at = $2, revoked_reason = $3
                 WHERE id = $1 AND status = 'active'
                 RETURNING id, patient_id, requesting_person_id, organization_id, facility_id, device_id,
                   reason_code, reason_text, scopes, issued_at, expires_at, revoked_at, revoked_reason, status"
            ).bind(grant_id).bind(now).bind(&reason).fetch_optional(pool).await
                .map_err(|_| "Emergency grant store is unavailable")?;
            return row
                .map(row_to_grant)
                .transpose()?
                .ok_or("Emergency grant not found");
        }
        let mut grants = self
            .grants
            .write()
            .map_err(|_| "Emergency grant store is unavailable")?;
        let grant = grants
            .get_mut(grant_id)
            .ok_or("Emergency grant not found")?;
        grant.status = EmergencyGrantStatus::Revoked;
        grant.revoked_at = Some(now);
        grant.revoked_reason = Some(reason);
        Ok(grant.clone())
    }

    pub async fn get(&self, grant_id: &str) -> Result<Option<EmergencyAccessGrant>, &'static str> {
        if let Some(pool) = &self.pool {
            let row = sqlx::query_as::<_, (String, String, String, String, Option<String>, String, String, Option<String>, serde_json::Value, DateTime<Utc>, DateTime<Utc>, Option<DateTime<Utc>>, Option<String>, String)>(
                "SELECT id, patient_id, requesting_person_id, organization_id, facility_id, device_id,
                   reason_code, reason_text, scopes, issued_at, expires_at, revoked_at, revoked_reason, status
                 FROM emergency_access_grants WHERE id = $1"
            ).bind(grant_id).fetch_optional(pool).await.map_err(|_| "Emergency grant store is unavailable")?;
            return row.map(row_to_grant).transpose();
        }
        Ok(self
            .grants
            .read()
            .ok()
            .and_then(|grants| grants.get(grant_id).cloned()))
    }
}

fn validate_grant(
    grant: EmergencyAccessGrant,
    binding: &EmergencyGrantBinding,
    required_scope: EmergencyGrantScope,
) -> Result<EmergencyAccessGrant, &'static str> {
    if grant.status == EmergencyGrantStatus::Expired {
        return Err("Emergency grant has expired");
    }
    if grant.status == EmergencyGrantStatus::Revoked {
        return Err("Emergency grant has been revoked");
    }
    if grant.patient_id != binding.patient_id
        || grant.requesting_person_id != binding.person_id
        || grant.organization_id != binding.organization_id
        || grant.device_id != binding.device_id
    {
        return Err("Emergency grant bindings do not match this request");
    }
    if grant.facility_id != binding.facility_id {
        return Err("Emergency grant facility does not match this request");
    }
    if !grant.scopes.contains(&required_scope) {
        return Err("Emergency grant does not include the requested scope");
    }
    Ok(grant)
}

fn row_to_grant(
    row: (
        String,
        String,
        String,
        String,
        Option<String>,
        String,
        String,
        Option<String>,
        serde_json::Value,
        DateTime<Utc>,
        DateTime<Utc>,
        Option<DateTime<Utc>>,
        Option<String>,
        String,
    ),
) -> Result<EmergencyAccessGrant, &'static str> {
    let (
        id,
        patient_id,
        requesting_person_id,
        organization_id,
        facility_id,
        device_id,
        reason_code,
        reason_text,
        scopes,
        issued_at,
        expires_at,
        revoked_at,
        revoked_reason,
        status,
    ) = row;
    let scopes =
        serde_json::from_value(scopes).map_err(|_| "Stored emergency grant scopes are invalid")?;
    let status = match status.as_str() {
        "active" => EmergencyGrantStatus::Active,
        "expired" => EmergencyGrantStatus::Expired,
        "revoked" => EmergencyGrantStatus::Revoked,
        _ => return Err("Stored emergency grant status is invalid"),
    };
    Ok(EmergencyAccessGrant {
        id,
        patient_id,
        requesting_person_id,
        organization_id,
        facility_id,
        device_id,
        reason_code,
        reason_text,
        scopes,
        issued_at,
        expires_at,
        revoked_at,
        revoked_reason,
        status,
    })
}

impl Default for EmergencyGrantStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bindings every test issues against; individual tests override just
    /// the field under test via struct-update syntax, so what differs is
    /// visible instead of being a position in an argument list.
    fn binding() -> EmergencyGrantBinding {
        EmergencyGrantBinding {
            patient_id: "patient-1".into(),
            person_id: "person-1".into(),
            organization_id: "org-1".into(),
            facility_id: Some("facility-1".into()),
            device_id: "device-1".into(),
        }
    }

    async fn issue(store: &EmergencyGrantStore, now: DateTime<Utc>) -> EmergencyAccessGrant {
        store
            .issue(
                binding(),
                "life_threatening".into(),
                None,
                vec![
                    EmergencyGrantScope::EmergencySummary,
                    EmergencyGrantScope::DownloadProhibited,
                ],
                now,
            )
            .await
            .unwrap()
    }
    #[tokio::test]
    async fn expired_grant_is_denied_even_when_the_view_is_still_open() {
        let store = EmergencyGrantStore::new();
        let now = Utc::now();
        let grant = issue(&store, now).await;
        assert_eq!(
            store
                .validate(
                    &grant.id,
                    &binding(),
                    EmergencyGrantScope::EmergencySummary,
                    now + Duration::minutes(16)
                )
                .await
                .unwrap_err(),
            "Emergency grant has expired"
        );
    }
    #[tokio::test]
    async fn grant_cannot_be_reused_from_a_different_device_or_patient() {
        let store = EmergencyGrantStore::new();
        let now = Utc::now();
        let grant = issue(&store, now).await;
        assert_eq!(
            store
                .validate(
                    &grant.id,
                    &EmergencyGrantBinding {
                        patient_id: "patient-2".into(),
                        device_id: "device-2".into(),
                        ..binding()
                    },
                    EmergencyGrantScope::EmergencySummary,
                    now
                )
                .await
                .unwrap_err(),
            "Emergency grant bindings do not match this request"
        );
    }
}
