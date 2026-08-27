//! Approved hospital-device lifecycle and monthly credential rotation.
//!
//! The store is an additive in-memory compatibility layer. The matching
//! migration is the durable contract; a repository can replace this store
//! without widening device access rules or changing the HTTP API.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;
use uuid::Uuid;

#[cfg(feature = "postgres")]
use sqlx::Row;

pub const ROTATION_INTERVAL_DAYS: i64 = 30;
pub const ROTATION_WARNING_DAYS: i64 = 7;
pub const ROTATION_GRACE_DAYS: i64 = 7;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeviceStatus {
    Enrolled,
    Active,
    RotationDue,
    Grace,
    NonCompliant,
    Quarantined,
    Lost,
    Stolen,
    Revoked,
    Retired,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ManagedDevice {
    pub id: String,
    pub organization_id: String,
    pub facility_id: Option<String>,
    pub device_name: String,
    pub device_type: String,
    pub hardware_fingerprint: String,
    pub platform: Option<String>,
    pub status: DeviceStatus,
    pub current_key_id: Option<String>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub last_rotation_at: Option<DateTime<Utc>>,
    pub next_rotation_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub revocation_reason: Option<String>,
}

/// Manages device state independently from clinician authentication.
pub struct DeviceLifecycleStore {
    devices: RwLock<HashMap<String, ManagedDevice>>,
}

impl DeviceLifecycleStore {
    pub fn new() -> Self {
        Self {
            devices: RwLock::new(HashMap::new()),
        }
    }

    /// Enroll an attested device. It remains inactive until its first key is set.
    pub fn enroll(
        &self,
        organization_id: String,
        facility_id: Option<String>,
        device_name: String,
        device_type: String,
        hardware_fingerprint: String,
        platform: Option<String>,
    ) -> Result<ManagedDevice, &'static str> {
        if organization_id.is_empty() || device_name.is_empty() || hardware_fingerprint.is_empty() {
            return Err("Organization, device name, and hardware fingerprint are required");
        }
        let mut devices = self
            .devices
            .write()
            .map_err(|_| "Device store is unavailable")?;
        if devices
            .values()
            .any(|device| device.hardware_fingerprint == hardware_fingerprint)
        {
            return Err("A device with this hardware fingerprint is already enrolled");
        }
        let device = ManagedDevice {
            id: Uuid::new_v4().to_string(),
            organization_id,
            facility_id,
            device_name,
            device_type,
            hardware_fingerprint,
            platform,
            status: DeviceStatus::Enrolled,
            current_key_id: None,
            last_seen_at: None,
            last_rotation_at: None,
            next_rotation_at: Utc::now(),
            revoked_at: None,
            revocation_reason: None,
        };
        devices.insert(device.id.clone(), device.clone());
        Ok(device)
    }

    /// Records a new device key after secure provisioning; private key material is excluded.
    pub fn rotate(
        &self,
        id: &str,
        key_id: String,
        now: DateTime<Utc>,
    ) -> Result<ManagedDevice, &'static str> {
        if key_id.is_empty() {
            return Err("A device key identifier is required");
        }
        let mut devices = self
            .devices
            .write()
            .map_err(|_| "Device store is unavailable")?;
        let device = devices.get_mut(id).ok_or("Device not found")?;
        match device.status {
            DeviceStatus::Enrolled
            | DeviceStatus::Active
            | DeviceStatus::RotationDue
            | DeviceStatus::Grace => {}
            _ => return Err("This device is not eligible for key rotation"),
        }
        device.current_key_id = Some(key_id);
        device.last_rotation_at = Some(now);
        device.next_rotation_at = now + Duration::days(ROTATION_INTERVAL_DAYS);
        device.status = DeviceStatus::Active;
        Ok(device.clone())
    }

    /// Revoke a lost, stolen, compromised, or retired device immediately.
    pub fn revoke(
        &self,
        id: &str,
        reason: String,
        now: DateTime<Utc>,
    ) -> Result<ManagedDevice, &'static str> {
        if reason.trim().is_empty() {
            return Err("A revocation reason is required");
        }
        let mut devices = self
            .devices
            .write()
            .map_err(|_| "Device store is unavailable")?;
        let device = devices.get_mut(id).ok_or("Device not found")?;
        device.status = DeviceStatus::Revoked;
        device.revoked_at = Some(now);
        device.revocation_reason = Some(reason);
        device.current_key_id = None;
        Ok(device.clone())
    }

    /// Advance device compliance based on scheduled rotation.
    pub fn refresh_compliance(
        &self,
        now: DateTime<Utc>,
    ) -> Result<Vec<ManagedDevice>, &'static str> {
        let mut devices = self
            .devices
            .write()
            .map_err(|_| "Device store is unavailable")?;
        let mut changed = Vec::new();
        for device in devices.values_mut() {
            if !matches!(
                device.status,
                DeviceStatus::Active | DeviceStatus::RotationDue | DeviceStatus::Grace
            ) {
                continue;
            }
            let next_status =
                if now < device.next_rotation_at - Duration::days(ROTATION_WARNING_DAYS) {
                    DeviceStatus::Active
                } else if now <= device.next_rotation_at {
                    DeviceStatus::RotationDue
                } else if now <= device.next_rotation_at + Duration::days(ROTATION_GRACE_DAYS) {
                    DeviceStatus::Grace
                } else {
                    DeviceStatus::NonCompliant
                };
            if device.status != next_status {
                device.status = next_status;
                changed.push(device.clone());
            }
        }
        Ok(changed)
    }

    /// Access requires an active device with a current credential and a valid rotation window.
    pub fn can_access(&self, id: &str, now: DateTime<Utc>) -> bool {
        self.devices
            .read()
            .ok()
            .and_then(|devices| devices.get(id).cloned())
            .map(|device| {
                matches!(
                    device.status,
                    DeviceStatus::Active | DeviceStatus::RotationDue | DeviceStatus::Grace
                ) && device.current_key_id.is_some()
                    && now <= device.next_rotation_at + Duration::days(ROTATION_GRACE_DAYS)
                    && device.revoked_at.is_none()
            })
            .unwrap_or(false)
    }

    pub fn get(&self, id: &str) -> Option<ManagedDevice> {
        self.devices.read().ok()?.get(id).cloned()
    }

    #[cfg(feature = "postgres")]
    pub async fn load_from_pool(pool: &sqlx::PgPool) -> Result<Self, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, organization_id, facility_id, device_name, device_type, \
             hardware_fingerprint, platform, status, current_key_id, last_seen_at, \
             last_rotation_at, next_rotation_at, revoked_at, revocation_reason \
             FROM managed_devices",
        )
        .fetch_all(pool)
        .await?;
        let mut devices = HashMap::new();
        for row in rows {
            let status_text: String = row.try_get("status")?;
            let status = persisted_status(&status_text);
            let id: String = row.try_get("id")?;
            let next_rotation_at = row
                .try_get::<Option<DateTime<Utc>>, _>("next_rotation_at")?
                .unwrap_or_else(Utc::now);
            devices.insert(
                id.clone(),
                ManagedDevice {
                    id,
                    organization_id: row.try_get("organization_id")?,
                    facility_id: row.try_get("facility_id")?,
                    device_name: row.try_get("device_name")?,
                    device_type: row.try_get("device_type")?,
                    hardware_fingerprint: row.try_get("hardware_fingerprint")?,
                    platform: row.try_get("platform")?,
                    status,
                    current_key_id: row.try_get("current_key_id")?,
                    last_seen_at: row.try_get("last_seen_at")?,
                    last_rotation_at: row.try_get("last_rotation_at")?,
                    next_rotation_at,
                    revoked_at: row.try_get("revoked_at")?,
                    revocation_reason: row.try_get("revocation_reason")?,
                },
            );
        }
        Ok(Self {
            devices: RwLock::new(devices),
        })
    }

    /// Restore a device snapshot after a durable write fails.
    pub fn restore(&self, device: ManagedDevice) -> Result<(), &'static str> {
        self.devices
            .write()
            .map_err(|_| "Device store is unavailable")?
            .insert(device.id.clone(), device);
        Ok(())
    }

    /// Remove an enrollment that could not be persisted.
    pub fn remove(&self, id: &str) -> Result<(), &'static str> {
        self.devices
            .write()
            .map_err(|_| "Device store is unavailable")?
            .remove(id);
        Ok(())
    }

    pub fn non_compliant(&self) -> Vec<ManagedDevice> {
        self.devices
            .read()
            .map(|devices| {
                devices
                    .values()
                    .filter(|d| d.status == DeviceStatus::NonCompliant)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }
}

fn persisted_status(value: &str) -> DeviceStatus {
    match value {
        "active" => DeviceStatus::Active,
        "rotation_due" => DeviceStatus::RotationDue,
        "grace" => DeviceStatus::Grace,
        "non_compliant" => DeviceStatus::NonCompliant,
        "quarantined" => DeviceStatus::Quarantined,
        "lost" => DeviceStatus::Lost,
        "stolen" => DeviceStatus::Stolen,
        "revoked" => DeviceStatus::Revoked,
        "retired" => DeviceStatus::Retired,
        _ => DeviceStatus::Enrolled,
    }
}

impl Default for DeviceLifecycleStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn enrolled(store: &DeviceLifecycleStore) -> ManagedDevice {
        store
            .enroll(
                "org-1".into(),
                None,
                "ED tablet".into(),
                "tablet".into(),
                "fingerprint-1".into(),
                None,
            )
            .unwrap()
    }
    #[test]
    fn revoked_device_cannot_access_even_with_a_previous_key() {
        let store = DeviceLifecycleStore::new();
        let device = enrolled(&store);
        let now = Utc::now();
        store.rotate(&device.id, "key-1".into(), now).unwrap();
        assert!(store.can_access(&device.id, now));
        store
            .revoke(&device.id, "reported lost".into(), now)
            .unwrap();
        assert!(!store.can_access(&device.id, now));
    }
    #[test]
    fn missed_rotation_becomes_non_compliant_and_loses_access() {
        let store = DeviceLifecycleStore::new();
        let device = enrolled(&store);
        let now = Utc::now();
        store.rotate(&device.id, "key-1".into(), now).unwrap();
        store
            .refresh_compliance(
                now + Duration::days(ROTATION_INTERVAL_DAYS + ROTATION_GRACE_DAYS + 1),
            )
            .unwrap();
        assert_eq!(
            store.get(&device.id).unwrap().status,
            DeviceStatus::NonCompliant
        );
        assert!(!store.can_access(&device.id, now + Duration::days(ROTATION_INTERVAL_DAYS + 1)));
    }
}
