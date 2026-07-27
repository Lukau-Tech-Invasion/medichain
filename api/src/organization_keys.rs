//! Public organisation-key directory for Phase 2.
//!
//! It stores public material and lifecycle metadata only; private wrapping keys
//! must remain in a hospital-controlled KMS/HSM and never enter this process.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha3::{Digest, Sha3_256};
use std::collections::HashMap;
use std::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OrganizationKeyStatus {
    Pending,
    Active,
    Retiring,
    Retired,
    Revoked,
    Compromised,
    Destroyed,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OrganizationPublicKey {
    pub id: String,
    pub organization_id: String,
    pub facility_id: Option<String>,
    pub key_id: String,
    pub version: i32,
    pub purpose: String,
    pub algorithm: String,
    pub public_key: String,
    pub status: OrganizationKeyStatus,
    pub proof_of_possession: String,
    pub valid_from: Option<DateTime<Utc>>,
    pub valid_until: Option<DateTime<Utc>>,
    pub retired_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub replaced_by: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub struct OrganizationKeyRegistry {
    keys: RwLock<HashMap<String, OrganizationPublicKey>>,
}

impl OrganizationKeyRegistry {
    pub fn new() -> Self {
        Self {
            keys: RwLock::new(HashMap::new()),
        }
    }

    /// Register a pending public key after verifying challenge possession.
    pub fn register(
        &self,
        mut key: OrganizationPublicKey,
    ) -> Result<OrganizationPublicKey, &'static str> {
        if key.public_key.trim().is_empty() || key.key_id.trim().is_empty() {
            return Err("Public key and key id are required");
        }
        if key.proof_of_possession
            != Self::proof(&key.organization_id, &key.key_id, &key.public_key)
        {
            return Err("Invalid proof of possession");
        }
        key.id = Uuid::new_v4().to_string();
        key.status = OrganizationKeyStatus::Pending;
        key.created_at = Utc::now();
        self.keys
            .write()
            .map_err(|_| "Key registry is unavailable")?
            .insert(key.id.clone(), key.clone());
        Ok(key)
    }

    pub fn transition(
        &self,
        organization_id: &str,
        id: &str,
        next: OrganizationKeyStatus,
    ) -> Result<OrganizationPublicKey, &'static str> {
        let mut keys = self
            .keys
            .write()
            .map_err(|_| "Key registry is unavailable")?;
        let storage_id = keys
            .iter()
            .find(|(_, key)| key.id == id || key.key_id == id)
            .map(|(storage_id, _)| storage_id.clone())
            .ok_or("Key not found")?;
        let key = keys.get_mut(&storage_id).ok_or("Key not found")?;
        if key.organization_id != organization_id {
            return Err("Key does not belong to this organization");
        }
        let valid = matches!(
            (key.status, next),
            (
                OrganizationKeyStatus::Pending,
                OrganizationKeyStatus::Active
            ) | (
                OrganizationKeyStatus::Active,
                OrganizationKeyStatus::Retiring
                    | OrganizationKeyStatus::Revoked
                    | OrganizationKeyStatus::Compromised
            ) | (
                OrganizationKeyStatus::Retiring,
                OrganizationKeyStatus::Retired
                    | OrganizationKeyStatus::Revoked
                    | OrganizationKeyStatus::Compromised
            ) | (
                OrganizationKeyStatus::Retired,
                OrganizationKeyStatus::Destroyed
            )
        );
        if !valid {
            return Err("Invalid key status transition");
        }
        key.status = next;
        if next == OrganizationKeyStatus::Retired {
            key.retired_at = Some(Utc::now());
        }
        if matches!(
            next,
            OrganizationKeyStatus::Revoked | OrganizationKeyStatus::Compromised
        ) {
            key.revoked_at = Some(Utc::now());
        }
        Ok(key.clone())
    }

    pub fn active(&self, organization_id: &str, purpose: &str) -> Option<OrganizationPublicKey> {
        self.keys
            .read()
            .ok()?
            .values()
            .filter(|key| {
                key.organization_id == organization_id
                    && key.purpose == purpose
                    && key.status == OrganizationKeyStatus::Active
            })
            .max_by_key(|key| key.version)
            .cloned()
    }

    pub fn proof(organization_id: &str, key_id: &str, public_key: &str) -> String {
        let mut digest = Sha3_256::new();
        digest.update(organization_id.as_bytes());
        digest.update(b":");
        digest.update(key_id.as_bytes());
        digest.update(b":");
        digest.update(public_key.as_bytes());
        hex::encode(digest.finalize())
    }
}

impl Default for OrganizationKeyRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn revoked_key_cannot_be_active() {
        let registry = OrganizationKeyRegistry::new();
        let key_id = "hospital-a-wrap";
        let public_key = "public-material";
        let key = registry
            .register(OrganizationPublicKey {
                id: String::new(),
                organization_id: "hospital-a".into(),
                facility_id: None,
                key_id: key_id.into(),
                version: 1,
                purpose: "record_wrapping".into(),
                algorithm: "x25519".into(),
                public_key: public_key.into(),
                status: OrganizationKeyStatus::Pending,
                proof_of_possession: OrganizationKeyRegistry::proof(
                    "hospital-a",
                    key_id,
                    public_key,
                ),
                valid_from: None,
                valid_until: None,
                retired_at: None,
                revoked_at: None,
                replaced_by: None,
                created_at: Utc::now(),
            })
            .unwrap();
        registry
            .transition("hospital-a", &key.id, OrganizationKeyStatus::Active)
            .unwrap();
        assert!(registry.active("hospital-a", "record_wrapping").is_some());
        registry
            .transition("hospital-a", &key.id, OrganizationKeyStatus::Revoked)
            .unwrap();
        assert!(registry.active("hospital-a", "record_wrapping").is_none());
    }

    #[test]
    fn key_cannot_transition_through_another_organization() {
        let registry = OrganizationKeyRegistry::new();
        let key_id = "hospital-a-wrap";
        let public_key = "public-material";
        let key = registry
            .register(OrganizationPublicKey {
                id: String::new(),
                organization_id: "hospital-a".into(),
                facility_id: None,
                key_id: key_id.into(),
                version: 1,
                purpose: "record_wrapping".into(),
                algorithm: "x25519".into(),
                public_key: public_key.into(),
                status: OrganizationKeyStatus::Pending,
                proof_of_possession: OrganizationKeyRegistry::proof(
                    "hospital-a",
                    key_id,
                    public_key,
                ),
                valid_from: None,
                valid_until: None,
                retired_at: None,
                revoked_at: None,
                replaced_by: None,
                created_at: Utc::now(),
            })
            .unwrap();
        assert!(registry
            .transition("hospital-b", &key.id, OrganizationKeyStatus::Active)
            .is_err());
    }
}
