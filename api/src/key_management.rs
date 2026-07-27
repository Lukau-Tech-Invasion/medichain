//! Phase 3 key-management boundary.
//!
//! Handlers must depend on this interface rather than directly manipulating
//! encryption keys. The legacy adapter preserves existing `ENCRYPTION_KEYS`
//! reads until envelope encryption is deployed.

use async_trait::async_trait;

#[derive(Debug, Clone)]
pub struct EncryptionContext {
    pub record_id: String,
    pub organization_id: String,
}
#[derive(Debug, Clone)]
pub struct RecipientPublicKey {
    pub key_id: String,
    pub algorithm: String,
    pub public_key: Vec<u8>,
}
#[derive(Debug, Clone)]
pub struct GeneratedDataKey {
    pub plaintext: Vec<u8>,
    pub algorithm: String,
}
#[derive(Debug, Clone)]
pub struct KeyEnvelope {
    pub recipient_key_id: String,
    pub wrapping_algorithm: String,
    pub wrapped_dek: Vec<u8>,
}

#[async_trait]
pub trait KeyManager: Send + Sync {
    async fn generate_data_key(
        &self,
        context: &EncryptionContext,
    ) -> Result<GeneratedDataKey, String>;
    async fn wrap_for_recipient(
        &self,
        plaintext_dek: &[u8],
        recipient: &RecipientPublicKey,
    ) -> Result<KeyEnvelope, String>;
    async fn unwrap_envelope(&self, envelope: &KeyEnvelope) -> Result<Vec<u8>, String>;
    async fn rewrap_envelope(
        &self,
        source: &KeyEnvelope,
        recipient: &RecipientPublicKey,
    ) -> Result<KeyEnvelope, String>;
}

/// Compatibility adapter deliberately refuses cross-organisation envelopes.
/// It exists only to preserve old record decryptability while a KMS/HSM-backed
/// adapter is introduced; callers cannot mistake it for federation support.
pub struct LegacyDeploymentKeyringAdapter;

#[async_trait]
impl KeyManager for LegacyDeploymentKeyringAdapter {
    async fn generate_data_key(
        &self,
        _context: &EncryptionContext,
    ) -> Result<GeneratedDataKey, String> {
        let key = medichain_crypto::EncryptionKey::generate().map_err(|error| error.to_string())?;
        Ok(GeneratedDataKey {
            plaintext: key.as_bytes().to_vec(),
            algorithm: "chacha20poly1305".into(),
        })
    }
    async fn wrap_for_recipient(
        &self,
        _plaintext_dek: &[u8],
        _recipient: &RecipientPublicKey,
    ) -> Result<KeyEnvelope, String> {
        Err("Legacy deployment keyring cannot create federation envelopes".into())
    }
    async fn unwrap_envelope(&self, _envelope: &KeyEnvelope) -> Result<Vec<u8>, String> {
        Err("Legacy deployment keyring cannot unwrap federation envelopes".into())
    }
    async fn rewrap_envelope(
        &self,
        _source: &KeyEnvelope,
        _recipient: &RecipientPublicKey,
    ) -> Result<KeyEnvelope, String> {
        Err("Legacy deployment keyring cannot rewrap federation envelopes".into())
    }
}
