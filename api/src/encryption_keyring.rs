//! Versioned encryption keyring for at-rest PHI encryption (Phase 6.3 — key rotation).
//!
//! Loads from `ENCRYPTION_KEYS` (format: `"1:<base64 32 bytes>,2:<base64 32 bytes>,..."`)
//! so the same key(s) survive process restarts. Previously, `AppState.encryption_key`
//! was generated fresh and random on every process start (in both constructors), which
//! silently orphaned every previously-encrypted row on any restart — a real bug, not
//! just a missing rotation feature. Falls back to a single ephemeral key (logged loudly)
//! only when unset, matching this project's `IS_DEMO`-gated "insecure default" pattern
//! (see `startup::validate_production_secrets`, which also flags an unset keyring).
//!
//! New writes always encrypt with `current()` / stamp `current_version()`; reads decrypt
//! with whichever version the row was originally stamped with via `get(version)` — so
//! rotating in a new key version is additive and lazy: existing rows re-encrypt to the
//! new version the next time they're written, with no bulk migration required.
//!
//! **Design invariant confirmed for the pediatric/guardian identity architecture**
//! (see `guardian_relationships` / `handlers::identity_claim`): keys here are
//! indexed purely by an integer `version`, never by wallet address or
//! `patient_id`. A guardian relationship changing (divorce, adoption, foster
//! placement ending) or a patient claiming their own identity at adulthood
//! therefore never requires re-encrypting that patient's history — the
//! medical identity's encrypted data is already independent of who currently
//! holds an account or a guardian relationship over it.

use base64::Engine as _;
use medichain_crypto::EncryptionKey;
use std::collections::BTreeMap;

pub struct EncryptionKeyring {
    keys: BTreeMap<u32, EncryptionKey>,
    current_version: u32,
}

impl EncryptionKeyring {
    /// Load from the `ENCRYPTION_KEYS` env var, or fall back to a single ephemeral key.
    pub fn from_env() -> Self {
        match std::env::var("ENCRYPTION_KEYS") {
            Ok(raw) if !raw.trim().is_empty() => match Self::parse(&raw) {
                Ok(keyring) => {
                    log::info!(
                        "Loaded encryption keyring with {} version(s); current version {}",
                        keyring.keys.len(),
                        keyring.current_version
                    );
                    keyring
                }
                Err(e) => {
                    log::error!(
                        "ENCRYPTION_KEYS could not be parsed ({e}); falling back to an ephemeral key"
                    );
                    Self::ephemeral()
                }
            },
            _ => {
                log::warn!(
                    "ENCRYPTION_KEYS is not set — generating an ephemeral encryption key. Data \
                     encrypted this run will NOT be decryptable after a restart. Set ENCRYPTION_KEYS \
                     (see .env.example) for any deployment where data must survive a restart."
                );
                Self::ephemeral()
            }
        }
    }

    fn ephemeral() -> Self {
        let key = EncryptionKey::generate().expect("Failed to generate encryption key");
        let mut keys = BTreeMap::new();
        keys.insert(1, key);
        Self {
            keys,
            current_version: 1,
        }
    }

    fn parse(raw: &str) -> Result<Self, String> {
        let mut keys = BTreeMap::new();
        for entry in raw.split(',') {
            let entry = entry.trim();
            if entry.is_empty() {
                continue;
            }
            let (version_str, key_b64) = entry
                .split_once(':')
                .ok_or_else(|| format!("entry '{entry}' is not in version:base64key form"))?;
            let version: u32 = version_str
                .trim()
                .parse()
                .map_err(|_| format!("'{version_str}' is not a valid key version"))?;
            let key_bytes = base64::engine::general_purpose::STANDARD
                .decode(key_b64.trim())
                .map_err(|e| format!("key version {version} is not valid base64: {e}"))?;
            let key_arr: [u8; 32] = key_bytes
                .try_into()
                .map_err(|_| format!("key version {version} must decode to exactly 32 bytes"))?;
            keys.insert(version, EncryptionKey::from_bytes(key_arr));
        }
        if keys.is_empty() {
            return Err("ENCRYPTION_KEYS parsed to zero keys".to_string());
        }
        let current_version = *keys.keys().max().expect("checked non-empty above");
        Ok(Self {
            keys,
            current_version,
        })
    }

    /// The key new writes should encrypt with (the highest configured version).
    pub fn current(&self) -> &EncryptionKey {
        self.keys
            .get(&self.current_version)
            .expect("current_version always present in keys")
    }

    /// The version new writes should stamp alongside their ciphertext.
    pub fn current_version(&self) -> u32 {
        self.current_version
    }

    /// Look up the key for a specific stored version (for decrypting existing rows).
    pub fn get(&self, version: u32) -> Option<&EncryptionKey> {
        self.keys.get(&version)
    }

    /// All (version, key) pairs, current/highest version first — for callers that
    /// must recover which version encrypted a blob by trial decryption (e.g. IPFS
    /// metadata, which must be decrypted before its own declared `key_version`
    /// field can be read).
    pub fn versions_newest_first(&self) -> impl Iterator<Item = (u32, &EncryptionKey)> {
        self.keys.iter().rev().map(|(v, k)| (*v, k))
    }

    /// Durably destroy a key version (Horizon HZ-006 — interim mitigation).
    ///
    /// The removed `EncryptionKey` is dropped here, which zeroizes its bytes in
    /// memory (`#[zeroize(drop)]` on `EncryptionKey`, `crypto/src/lib.rs`). It is
    /// also gone from `self.keys`, so no later call to `get(version)` can recover
    /// it — decrypting any row still stamped with this version becomes
    /// permanently impossible from this point on.
    ///
    /// # This is not per-patient crypto-shredding
    ///
    /// A key version is shared by every record encrypted while it was current —
    /// retiring it destroys **every** such record's decryptability, not one
    /// patient's. There is currently no finer-grained mechanism: true per-record
    /// crypto-shredding needs the envelope-encryption feature
    /// (`key_management::KeyEnvelope`/`wrap_for_recipient`/`unwrap_envelope`) to
    /// actually be activated — today it exists only as a stubbed adapter
    /// (`LegacyDeploymentKeyringAdapter`) that refuses every envelope operation.
    /// Use this method only when destroying an entire version's worth of data is
    /// the intended outcome (e.g. a full-tenant erasure), not for a single
    /// data-subject's POPIA erasure request.
    ///
    /// Refuses to retire the current version — that would leave the keyring with
    /// no key for new writes. Retire the versions below `current_version` only,
    /// or rotate to a new version first.
    pub fn retire(&mut self, version: u32) -> Result<(), String> {
        if version == self.current_version {
            return Err(format!(
                "cannot retire version {version}: it is the current version new writes use; \
                 rotate to a newer version first"
            ));
        }
        if self.keys.remove(&version).is_none() {
            return Err(format!("no such key version: {version}"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b64_key(byte: u8) -> String {
        base64::engine::general_purpose::STANDARD.encode([byte; 32])
    }

    #[test]
    fn parses_single_version() {
        let raw = format!("1:{}", b64_key(1));
        let keyring = EncryptionKeyring::parse(&raw).expect("should parse");
        assert_eq!(keyring.current_version(), 1);
        assert!(keyring.get(1).is_some());
        assert!(keyring.get(2).is_none());
    }

    #[test]
    fn current_version_is_the_highest() {
        let raw = format!("1:{},3:{},2:{}", b64_key(1), b64_key(3), b64_key(2));
        let keyring = EncryptionKeyring::parse(&raw).expect("should parse");
        assert_eq!(keyring.current_version(), 3);
        assert!(keyring.get(1).is_some());
        assert!(keyring.get(2).is_some());
        assert!(keyring.get(3).is_some());
    }

    #[test]
    fn rejects_malformed_entries() {
        assert!(EncryptionKeyring::parse("not-a-valid-entry").is_err());
        assert!(EncryptionKeyring::parse("abc:not-base64!!!").is_err());
        assert!(EncryptionKeyring::parse(&format!(
            "1:{}",
            base64::engine::general_purpose::STANDARD.encode([1u8; 16])
        ))
        .is_err());
    }

    #[test]
    fn ephemeral_fallback_produces_a_usable_single_key_keyring() {
        let keyring = EncryptionKeyring::ephemeral();
        assert_eq!(keyring.current_version(), 1);
        assert!(keyring.get(1).is_some());

        let plaintext = b"hello patient";
        let encrypted = medichain_crypto::encrypt(keyring.current(), plaintext).unwrap();
        let decrypted =
            medichain_crypto::decrypt(keyring.get(keyring.current_version()).unwrap(), &encrypted)
                .unwrap();
        assert_eq!(decrypted, plaintext);
    }

    /// HZ-006 regression: retiring a non-current version removes only that
    /// version, leaves the current version and `current_version()` untouched.
    #[test]
    fn retire_removes_only_the_named_version() {
        let raw = format!("1:{},2:{}", b64_key(1), b64_key(2));
        let mut keyring = EncryptionKeyring::parse(&raw).expect("should parse");

        keyring
            .retire(1)
            .expect("retiring a non-current version should succeed");

        assert!(keyring.get(1).is_none(), "retired version must be gone");
        assert!(
            keyring.get(2).is_some(),
            "other versions must be unaffected"
        );
        assert_eq!(
            keyring.current_version(),
            2,
            "current_version must be unaffected"
        );
    }

    /// Retiring the current version is refused — it would leave the keyring
    /// with no key for new writes.
    #[test]
    fn retire_refuses_the_current_version() {
        let raw = format!("1:{},2:{}", b64_key(1), b64_key(2));
        let mut keyring = EncryptionKeyring::parse(&raw).expect("should parse");

        let result = keyring.retire(2);

        assert!(result.is_err());
        assert!(
            keyring.get(2).is_some(),
            "current version must survive a refused retire"
        );
    }

    /// Retiring an unknown version is an error, not a silent no-op.
    #[test]
    fn retire_unknown_version_is_an_error() {
        let raw = format!("1:{}", b64_key(1));
        let mut keyring = EncryptionKeyring::parse(&raw).expect("should parse");
        assert!(keyring.retire(99).is_err());
    }
}
