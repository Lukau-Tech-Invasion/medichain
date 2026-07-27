//! Patient-owned mobile-device registration and encrypted-record access contracts.
//!
//! The API only handles public keys and ciphertext references. Applications must
//! decrypt in private storage using Android Keystore or Apple Secure Enclave.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;
use uuid::Uuid;

pub const MOBILE_RECORD_TTL_MINUTES: i64 = 15;

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

pub struct MobileRecordStore {
    devices: RwLock<HashMap<String, PatientMobileDevice>>,
    sessions: RwLock<HashMap<String, ProtectedMobileRecordSession>>,
}

impl MobileRecordStore {
    pub fn new() -> Self {
        Self {
            devices: RwLock::new(HashMap::new()),
            sessions: RwLock::new(HashMap::new()),
        }
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
