//! Public organisation-key directory for Phase 2.
//!
//! It stores public material and lifecycle metadata only; private wrapping keys
//! must remain in a hospital-controlled KMS/HSM and never enter this process.
//!
//! # This registry lost every key on restart
//!
//! `organization_keys` has had a table since `20260727000002` and nothing ever
//! wrote to it. `POST /api/organizations/{id}/keys` answered `201 Created`
//! with the key in the body, the row count stayed at zero, and the next
//! restart took the whole directory with it — the silent-write shape this
//! codebase keeps producing: a successful write no reader can see.
//!
//! What made it worse than an ordinary lost record is what a missing key
//! *means*. `active()` answering `None` is indistinguishable from "this
//! organisation has not published a wrapping key yet", so the failure reads as
//! a configuration gap rather than as data loss, and the fix somebody reaches
//! for is to register the key again.
//!
//! Persistence follows the managed-device pattern in `device_lifecycle`:
//! hydrate at startup with [`OrganizationKeyRegistry::load_from_pool`], write
//! through in the handler, and roll the in-memory copy back when the durable
//! write fails so memory never claims more than the database holds.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha3::{Digest, Sha3_256};
use sqlx::Row;
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

impl OrganizationKeyStatus {
    /// The spelling the `organization_keys.status` CHECK constraint accepts.
    ///
    /// Written out rather than derived from the serde rename so that adding a
    /// variant is a compile error here instead of a runtime constraint
    /// violation on a key nobody can then register.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Active => "active",
            Self::Retiring => "retiring",
            Self::Retired => "retired",
            Self::Revoked => "revoked",
            Self::Compromised => "compromised",
            Self::Destroyed => "destroyed",
        }
    }

    /// Read a status back from the database.
    ///
    /// An unrecognised value resolves to `Revoked`, not `Active`: the CHECK
    /// constraint means this should be unreachable, and if it is ever reached
    /// the safe reading of a key whose state cannot be determined is that it
    /// must not be used.
    pub fn from_db(text: &str) -> Self {
        match text {
            "pending" => Self::Pending,
            "active" => Self::Active,
            "retiring" => Self::Retiring,
            "retired" => Self::Retired,
            "compromised" => Self::Compromised,
            "destroyed" => Self::Destroyed,
            _ => Self::Revoked,
        }
    }
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

    /// Rebuild the directory from PostgreSQL at startup.
    ///
    /// Without this the registry began every process empty while the rows sat
    /// in the table, so `active()` answered `None` for organisations that had
    /// published a key months earlier.
    pub async fn load_from_pool(pool: &sqlx::PgPool) -> Result<Self, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, organization_id, facility_id, key_id, version, purpose, algorithm, \
             public_key, status, proof_of_possession, valid_from, valid_until, retired_at, \
             revoked_at, replaced_by, created_at FROM organization_keys",
        )
        .fetch_all(pool)
        .await?;

        let mut keys = HashMap::new();
        for row in rows {
            let id: String = row.try_get("id")?;
            let status_text: String = row.try_get("status")?;
            keys.insert(
                id.clone(),
                OrganizationPublicKey {
                    id,
                    organization_id: row.try_get("organization_id")?,
                    facility_id: row.try_get("facility_id")?,
                    key_id: row.try_get("key_id")?,
                    version: row.try_get("version")?,
                    purpose: row.try_get("purpose")?,
                    algorithm: row.try_get("algorithm")?,
                    public_key: row.try_get("public_key")?,
                    status: OrganizationKeyStatus::from_db(&status_text),
                    proof_of_possession: row.try_get("proof_of_possession")?,
                    valid_from: row.try_get("valid_from")?,
                    valid_until: row.try_get("valid_until")?,
                    retired_at: row.try_get("retired_at")?,
                    revoked_at: row.try_get("revoked_at")?,
                    replaced_by: row.try_get("replaced_by")?,
                    created_at: row.try_get("created_at")?,
                },
            );
        }
        Ok(Self {
            keys: RwLock::new(keys),
        })
    }

    /// Drop an in-memory key after its durable write failed.
    ///
    /// The alternative is a registry that reports a key the database does not
    /// have — which survives exactly until the next restart, and is worse than
    /// the registration having failed, because nobody re-registers a key the
    /// directory already lists.
    pub fn remove(&self, id: &str) -> Result<(), &'static str> {
        self.keys
            .write()
            .map_err(|_| "Key registry is unavailable")?
            .remove(id);
        Ok(())
    }

    /// Put a key back as it was, after a durable write failed mid-transition.
    pub fn restore(&self, key: OrganizationPublicKey) -> Result<(), &'static str> {
        self.keys
            .write()
            .map_err(|_| "Key registry is unavailable")?
            .insert(key.id.clone(), key);
        Ok(())
    }

    /// One key by its storage id, for rollback and for reading a prior state.
    pub fn get(&self, id: &str) -> Option<OrganizationPublicKey> {
        self.keys.read().ok()?.get(id).cloned()
    }

    /// The key a transition request names, by the same rule `transition` uses.
    ///
    /// The path segment is accepted as either the storage id or the
    /// organisation's own `key_id`, and a rollback that resolved it differently
    /// from the transition would restore the wrong key.
    pub fn find(&self, organization_id: &str, id: &str) -> Option<OrganizationPublicKey> {
        self.keys
            .read()
            .ok()?
            .values()
            .find(|key| {
                key.organization_id == organization_id && (key.id == id || key.key_id == id)
            })
            .cloned()
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

#[cfg(test)]
mod durability_tests {
    use super::*;

    fn registered(registry: &OrganizationKeyRegistry, key_id: &str) -> OrganizationPublicKey {
        let public_key = "public-material";
        registry
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
            .expect("registered")
    }

    /// Every status must survive a round trip through the column, because the
    /// CHECK constraint accepts only these spellings and a mismatch would make
    /// a key unregisterable rather than merely mislabelled.
    #[test]
    fn every_status_round_trips_through_the_database_spelling() {
        for status in [
            OrganizationKeyStatus::Pending,
            OrganizationKeyStatus::Active,
            OrganizationKeyStatus::Retiring,
            OrganizationKeyStatus::Retired,
            OrganizationKeyStatus::Revoked,
            OrganizationKeyStatus::Compromised,
            OrganizationKeyStatus::Destroyed,
        ] {
            assert_eq!(OrganizationKeyStatus::from_db(status.as_str()), status);
        }
    }

    /// A status the process cannot read must not become a usable key.
    #[test]
    fn an_unreadable_status_reads_as_revoked_not_active() {
        assert_eq!(
            OrganizationKeyStatus::from_db("something-new"),
            OrganizationKeyStatus::Revoked
        );
    }

    /// `transition` accepts either the storage id or the organisation's own
    /// `key_id`. A rollback that resolved the name differently would restore
    /// the wrong key, so `find` has to use the same rule.
    #[test]
    fn find_resolves_a_key_by_either_name_transition_accepts() {
        let registry = OrganizationKeyRegistry::new();
        let key = registered(&registry, "hospital-a-wrap");

        assert_eq!(
            registry.find("hospital-a", &key.id).map(|k| k.id.clone()),
            Some(key.id.clone())
        );
        assert_eq!(
            registry
                .find("hospital-a", "hospital-a-wrap")
                .map(|k| k.id.clone()),
            Some(key.id.clone())
        );
        // Another organisation must not resolve it, the same way `transition`
        // refuses a key that belongs elsewhere.
        assert!(registry.find("hospital-b", "hospital-a-wrap").is_none());
    }

    /// The rollback path: a key whose durable write failed must leave no trace
    /// in the registry. A directory listing a key the database does not hold
    /// lies until the next restart, and nobody re-registers a key that is
    /// already listed.
    #[test]
    fn removing_a_key_after_a_failed_write_leaves_nothing_behind() {
        let registry = OrganizationKeyRegistry::new();
        let key = registered(&registry, "hospital-a-wrap");
        assert!(registry.get(&key.id).is_some());

        registry.remove(&key.id).expect("removed");

        assert!(registry.get(&key.id).is_none());
        assert!(registry.active("hospital-a", "record_wrapping").is_none());
    }

    /// The dangerous direction: a revocation that only happened in memory
    /// reads as revoked until the process restarts, and then the key is active
    /// again. Restoring the previous state is what keeps memory from claiming
    /// more than the database holds.
    #[test]
    fn restoring_puts_back_the_state_the_key_was_in() {
        let registry = OrganizationKeyRegistry::new();
        let key = registered(&registry, "hospital-a-wrap");
        let before = registry
            .find("hospital-a", &key.id)
            .expect("the key is there");
        registry
            .transition("hospital-a", &key.id, OrganizationKeyStatus::Active)
            .expect("pending -> active");
        assert_eq!(
            registry.get(&key.id).map(|k| k.status),
            Some(OrganizationKeyStatus::Active)
        );

        registry.restore(before).expect("restored");

        assert_eq!(
            registry.get(&key.id).map(|k| k.status),
            Some(OrganizationKeyStatus::Pending)
        );
    }
}
