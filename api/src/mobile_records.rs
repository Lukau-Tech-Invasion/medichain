//! Patient-owned mobile-device registration and encrypted-record access contracts.
//!
//! The API only handles public keys and ciphertext references. Applications must
//! decrypt in private storage using Android Keystore or Apple Secure Enclave.

use chrono::{DateTime, Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;
use uuid::Uuid;

pub const MOBILE_RECORD_TTL_MINUTES: i64 = 15;
pub const LOCKSCREEN_TOKEN_TTL_SECS: i64 = 5 * 60;
const LOCKSCREEN_ISSUER: &str = "medichain-api";
const LOCKSCREEN_AUDIENCE: &str = "medichain-lockscreen";

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MobilePlatform {
    Android,
    Ios,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MobileDeviceStatus {
    Active,
    Revoked,
    Reinstalled,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProtectedRecordStatus {
    Active,
    Expired,
    Revoked,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PatientMobileDevice {
    pub id: String,
    pub patient_id: String,
    pub device_label: String,
    pub platform: MobilePlatform,
    pub public_key: String,
    pub status: MobileDeviceStatus,
    pub last_synchronised_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub revocation_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProtectedMobileRecordSession {
    pub id: String,
    pub patient_id: String,
    pub device_id: String,
    pub record_id: String,
    pub encrypted_content_reference: String,
    pub watermark_text: Option<String>,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub status: ProtectedRecordStatus,
    pub export_allowed: bool,
    pub offline_allowed: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LockscreenClaims {
    pub iss: String,
    pub aud: String,
    pub sub: String,
    pub device_id: String,
    pub scope: String,
    pub jti: String,
    pub iat: i64,
    pub nbf: i64,
    pub exp: i64,
}

fn capability_secret() -> String {
    std::env::var("JWT_SECRET")
        .or_else(|_| std::env::var("SESSION_SECRET"))
        .unwrap_or_else(|_| "medichain-dev-secret-change-in-production".to_string())
}

pub fn issue_lockscreen_token(
    patient_id: &str,
    device_id: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now().timestamp();
    let claims = LockscreenClaims {
        iss: LOCKSCREEN_ISSUER.into(),
        aud: LOCKSCREEN_AUDIENCE.into(),
        sub: patient_id.into(),
        device_id: device_id.into(),
        scope: "lockscreen_medical_id:read".into(),
        jti: Uuid::new_v4().to_string(),
        iat: now,
        nbf: now,
        exp: now + LOCKSCREEN_TOKEN_TTL_SECS,
    };
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(capability_secret().as_bytes()),
    )
}

pub fn verify_lockscreen_token(
    token: &str,
    patient_id: &str,
    device_id: &str,
) -> Result<LockscreenClaims, jsonwebtoken::errors::Error> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_issuer(&[LOCKSCREEN_ISSUER]);
    validation.set_audience(&[LOCKSCREEN_AUDIENCE]);
    validation.validate_nbf = true;
    validation.leeway = 0;
    let claims = decode::<LockscreenClaims>(
        token,
        &DecodingKey::from_secret(capability_secret().as_bytes()),
        &validation,
    )?
    .claims;
    if claims.sub != patient_id
        || claims.device_id != device_id
        || claims.scope != "lockscreen_medical_id:read"
    {
        return Err(jsonwebtoken::errors::Error::from(
            jsonwebtoken::errors::ErrorKind::InvalidToken,
        ));
    }
    Ok(claims)
}

pub struct MobileRecordStore {
    devices: RwLock<HashMap<String, PatientMobileDevice>>,
    sessions: RwLock<HashMap<String, ProtectedMobileRecordSession>>,
    pool: Option<sqlx::PgPool>,
}

impl MobileRecordStore {
    pub fn new() -> Self {
        Self {
            devices: RwLock::new(HashMap::new()),
            sessions: RwLock::new(HashMap::new()),
            pool: None,
        }
    }

    /// PostgreSQL is authoritative for registered-device state in production.
    pub fn with_pool(pool: sqlx::PgPool) -> Self {
        Self {
            devices: RwLock::new(HashMap::new()),
            sessions: RwLock::new(HashMap::new()),
            pool: Some(pool),
        }
    }

    pub async fn register_device_durable(
        &self,
        patient_id: String,
        device_label: String,
        platform: MobilePlatform,
        public_key: String,
    ) -> Result<PatientMobileDevice, &'static str> {
        if self.pool.is_none() {
            return self.register_device(patient_id, device_label, platform, public_key);
        }
        if patient_id.is_empty() || device_label.trim().is_empty() || public_key.trim().is_empty() {
            return Err("Patient, device label, and public key are required");
        }
        let device = PatientMobileDevice {
            id: Uuid::new_v4().to_string(),
            patient_id,
            device_label,
            platform,
            public_key,
            status: MobileDeviceStatus::Active,
            last_synchronised_at: None,
            revoked_at: None,
            revocation_reason: None,
        };
        sqlx::query("INSERT INTO patient_mobile_devices (id, patient_id, device_label, platform, public_key, status) VALUES ($1,$2,$3,$4,$5,'active')")
            .bind(&device.id).bind(&device.patient_id).bind(&device.device_label).bind(platform_name(device.platform)).bind(&device.public_key)
            .execute(self.pool.as_ref().expect("pool checked")).await.map_err(|_| "Mobile device store is unavailable")?;
        Ok(device)
    }

    pub async fn get_device_durable(
        &self,
        device_id: &str,
    ) -> Result<Option<PatientMobileDevice>, &'static str> {
        let Some(pool) = &self.pool else {
            return Ok(self.get_device(device_id));
        };
        let row: Option<(String,String,String,String,String,String,Option<DateTime<Utc>>,Option<DateTime<Utc>>,Option<String>)> = sqlx::query_as("SELECT id, patient_id, device_label, platform, public_key, status, last_synchronised_at, revoked_at, revocation_reason FROM patient_mobile_devices WHERE id = $1")
            .bind(device_id).fetch_optional(pool).await.map_err(|_| "Mobile device store is unavailable")?;
        row.map(row_to_device).transpose()
    }

    pub async fn authorise_record_durable(
        &self,
        patient_id: &str,
        device_id: &str,
        record_id: String,
        encrypted_content_reference: String,
        watermark_text: Option<String>,
        now: DateTime<Utc>,
    ) -> Result<ProtectedMobileRecordSession, &'static str> {
        if self.pool.is_none() {
            return self.authorise_record(
                patient_id,
                device_id,
                record_id,
                encrypted_content_reference,
                watermark_text,
                now,
            );
        }
        if record_id.is_empty() || encrypted_content_reference.is_empty() {
            return Err("Record and encrypted content reference are required");
        }
        let device = self
            .get_device_durable(device_id)
            .await?
            .ok_or("Mobile device not found")?;
        if device.patient_id != patient_id || device.status != MobileDeviceStatus::Active {
            return Err("Mobile device is not active for this patient");
        }
        let session = ProtectedMobileRecordSession {
            id: Uuid::new_v4().to_string(),
            patient_id: patient_id.into(),
            device_id: device_id.into(),
            record_id,
            encrypted_content_reference,
            watermark_text,
            issued_at: now,
            expires_at: now + Duration::minutes(MOBILE_RECORD_TTL_MINUTES),
            status: ProtectedRecordStatus::Active,
            export_allowed: false,
            offline_allowed: false,
        };
        sqlx::query("INSERT INTO protected_mobile_record_sessions (id, patient_id, device_id, record_id, encrypted_content_reference, watermark_text, issued_at, expires_at, status, export_allowed, offline_allowed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',FALSE,FALSE)")
            .bind(&session.id).bind(&session.patient_id).bind(&session.device_id).bind(&session.record_id).bind(&session.encrypted_content_reference).bind(&session.watermark_text).bind(session.issued_at).bind(session.expires_at)
            .execute(self.pool.as_ref().expect("pool checked")).await.map_err(|_| "Protected record store is unavailable")?;
        Ok(session)
    }

    pub async fn revoke_device_durable(
        &self,
        device_id: &str,
        reason: String,
        now: DateTime<Utc>,
    ) -> Result<PatientMobileDevice, &'static str> {
        if self.pool.is_none() {
            return self.revoke_device(device_id, reason, now);
        }
        if reason.trim().is_empty() {
            return Err("A revocation reason is required");
        }
        let mut transaction = self.pool.as_ref().expect("pool checked").begin().await.map_err(|_| "Mobile device store is unavailable")?;
        let row: Option<(String,String,String,String,String,String,Option<DateTime<Utc>>,Option<DateTime<Utc>>,Option<String>)> = sqlx::query_as("UPDATE patient_mobile_devices SET status = 'revoked', revoked_at = $2, revocation_reason = $3 WHERE id = $1 AND status = 'active' RETURNING id, patient_id, device_label, platform, public_key, status, last_synchronised_at, revoked_at, revocation_reason")
            .bind(device_id).bind(now).bind(&reason).fetch_optional(&mut *transaction).await.map_err(|_| "Mobile device store is unavailable")?;
        let device = row.map(row_to_device).transpose()?.ok_or("Mobile device not found")?;
        sqlx::query("UPDATE protected_mobile_record_sessions SET status = 'revoked', revoked_at = $2, revoke_reason = $3 WHERE device_id = $1 AND status = 'active'")
            .bind(device_id).bind(now).bind(&reason).execute(&mut *transaction).await.map_err(|_| "Mobile device store is unavailable")?;
        transaction.commit().await.map_err(|_| "Mobile device store is unavailable")?;
        Ok(device)
    }

    /// Register a device public key. A reinstall must create a new device record.
    pub fn register_device(
        &self,
        patient_id: String,
        device_label: String,
        platform: MobilePlatform,
        public_key: String,
    ) -> Result<PatientMobileDevice, &'static str> {
        if patient_id.is_empty() || device_label.trim().is_empty() || public_key.trim().is_empty() {
            return Err("Patient, device label, and public key are required");
        }
        let device = PatientMobileDevice {
            id: Uuid::new_v4().to_string(),
            patient_id,
            device_label,
            platform,
            public_key,
            status: MobileDeviceStatus::Active,
            last_synchronised_at: None,
            revoked_at: None,
            revocation_reason: None,
        };
        self.devices
            .write()
            .map_err(|_| "Mobile device store is unavailable")?
            .insert(device.id.clone(), device.clone());
        Ok(device)
    }

    /// Produce a capability for ciphertext only; no plaintext is returned or cached server-side.
    pub fn authorise_record(
        &self,
        patient_id: &str,
        device_id: &str,
        record_id: String,
        encrypted_content_reference: String,
        watermark_text: Option<String>,
        now: DateTime<Utc>,
    ) -> Result<ProtectedMobileRecordSession, &'static str> {
        if record_id.is_empty() || encrypted_content_reference.is_empty() {
            return Err("Record and encrypted content reference are required");
        }
        let device = self
            .devices
            .read()
            .map_err(|_| "Mobile device store is unavailable")?
            .get(device_id)
            .cloned()
            .ok_or("Mobile device not found")?;
        if device.patient_id != patient_id || device.status != MobileDeviceStatus::Active {
            return Err("Mobile device is not active for this patient");
        }
        let session = ProtectedMobileRecordSession {
            id: Uuid::new_v4().to_string(),
            patient_id: patient_id.into(),
            device_id: device_id.into(),
            record_id,
            encrypted_content_reference,
            watermark_text,
            issued_at: now,
            expires_at: now + Duration::minutes(MOBILE_RECORD_TTL_MINUTES),
            status: ProtectedRecordStatus::Active,
            export_allowed: false,
            offline_allowed: false,
        };
        self.sessions
            .write()
            .map_err(|_| "Protected record store is unavailable")?
            .insert(session.id.clone(), session.clone());
        Ok(session)
    }

    /// Reject use from another patient or device and expire based on server time.
    pub fn validate_session(
        &self,
        session_id: &str,
        patient_id: &str,
        device_id: &str,
        now: DateTime<Utc>,
    ) -> Result<ProtectedMobileRecordSession, &'static str> {
        let device = self
            .devices
            .read()
            .map_err(|_| "Mobile device store is unavailable")?
            .get(device_id)
            .cloned()
            .ok_or("Mobile device not found")?;
        if device.status != MobileDeviceStatus::Active {
            return Err("Mobile device has been revoked");
        }
        let mut sessions = self
            .sessions
            .write()
            .map_err(|_| "Protected record store is unavailable")?;
        let session = sessions
            .get_mut(session_id)
            .ok_or("Protected record session not found")?;
        if session.status == ProtectedRecordStatus::Active && now >= session.expires_at {
            session.status = ProtectedRecordStatus::Expired;
        }
        if session.status != ProtectedRecordStatus::Active {
            return Err("Protected record session is not active");
        }
        if session.patient_id != patient_id || session.device_id != device_id {
            return Err("Protected record session does not match this device or patient");
        }
        Ok(session.clone())
    }

    /// Revocation invalidates all current sessions for the device immediately.
    pub fn revoke_device(
        &self,
        device_id: &str,
        reason: String,
        now: DateTime<Utc>,
    ) -> Result<PatientMobileDevice, &'static str> {
        if reason.trim().is_empty() {
            return Err("A revocation reason is required");
        }
        let mut devices = self
            .devices
            .write()
            .map_err(|_| "Mobile device store is unavailable")?;
        let device = devices
            .get_mut(device_id)
            .ok_or("Mobile device not found")?;
        device.status = MobileDeviceStatus::Revoked;
        device.revoked_at = Some(now);
        device.revocation_reason = Some(reason);
        let mut sessions = self
            .sessions
            .write()
            .map_err(|_| "Protected record store is unavailable")?;
        for session in sessions.values_mut().filter(|session| {
            session.device_id == device_id && session.status == ProtectedRecordStatus::Active
        }) {
            session.status = ProtectedRecordStatus::Revoked;
        }
        Ok(device.clone())
    }

    pub fn get_device(&self, device_id: &str) -> Option<PatientMobileDevice> {
        self.devices.read().ok()?.get(device_id).cloned()
    }
}

impl Default for MobileRecordStore {
    fn default() -> Self {
        Self::new()
    }
}

fn platform_name(platform: MobilePlatform) -> &'static str {
    match platform {
        MobilePlatform::Android => "android",
        MobilePlatform::Ios => "ios",
    }
}
fn row_to_device(
    row: (
        String,
        String,
        String,
        String,
        String,
        String,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
        Option<String>,
    ),
) -> Result<PatientMobileDevice, &'static str> {
    let (
        id,
        patient_id,
        device_label,
        platform,
        public_key,
        status,
        last_synchronised_at,
        revoked_at,
        revocation_reason,
    ) = row;
    let platform = match platform.as_str() {
        "android" => MobilePlatform::Android,
        "ios" => MobilePlatform::Ios,
        _ => return Err("Stored mobile platform is invalid"),
    };
    let status = match status.as_str() {
        "active" => MobileDeviceStatus::Active,
        "revoked" => MobileDeviceStatus::Revoked,
        "reinstalled" => MobileDeviceStatus::Reinstalled,
        _ => return Err("Stored mobile device status is invalid"),
    };
    Ok(PatientMobileDevice {
        id,
        patient_id,
        device_label,
        platform,
        public_key,
        status,
        last_synchronised_at,
        revoked_at,
        revocation_reason,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn revoked_mobile_device_invalidates_its_record_capabilities() {
        let store = MobileRecordStore::new();
        let now = Utc::now();
        let device = store
            .register_device(
                "patient-1".into(),
                "My phone".into(),
                MobilePlatform::Android,
                "public-key".into(),
            )
            .unwrap();
        let session = store
            .authorise_record(
                "patient-1",
                &device.id,
                "record-1".into(),
                "ciphertext://record-1".into(),
                None,
                now,
            )
            .unwrap();
        store
            .revoke_device(&device.id, "phone lost".into(), now)
            .unwrap();
        assert_eq!(
            store
                .validate_session(&session.id, "patient-1", &device.id, now)
                .unwrap_err(),
            "Mobile device has been revoked"
        );
    }
    #[test]
    fn ciphertext_capability_cannot_move_to_another_device() {
        let store = MobileRecordStore::new();
        let now = Utc::now();
        let first = store
            .register_device(
                "patient-1".into(),
                "First phone".into(),
                MobilePlatform::Android,
                "key-1".into(),
            )
            .unwrap();
        let second = store
            .register_device(
                "patient-1".into(),
                "Second phone".into(),
                MobilePlatform::Ios,
                "key-2".into(),
            )
            .unwrap();
        let session = store
            .authorise_record(
                "patient-1",
                &first.id,
                "record-1".into(),
                "ciphertext://record-1".into(),
                None,
                now,
            )
            .unwrap();
        assert_eq!(
            store
                .validate_session(&session.id, "patient-1", &second.id, now)
                .unwrap_err(),
            "Protected record session does not match this device or patient"
        );
    }
}
