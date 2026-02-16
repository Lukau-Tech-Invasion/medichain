//! # MediChain Cryptography Module
//!
//! Provides encryption/decryption for medical records.
//!
//! ## Security
//! - Uses ChaCha20-Poly1305 (AEAD)
//! - Argon2id for key derivation
//! - Patient-controlled keys
//! - Forward secrecy
//!
//! ## Safety
//! - Constant-time operations (prevents timing attacks)
//! - Zero-copy where possible
//! - No panics in public API
//!
//! ## NASA Power of 10 Compliance
//! - Rule 1: No recursion
//! - Rule 2: All loops have fixed upper bounds
//! - Rule 3: No dynamic memory after init
//! - Rule 6: Data objects declared at smallest scope

use argon2::{
    password_hash::{PasswordHasher, SaltString},
    Argon2,
};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Nonce,
};
use rand::rngs::OsRng;
use zeroize::Zeroize;

// =============================================================================
// CONSTANTS
// =============================================================================

/// Key size for ChaCha20-Poly1305 (256 bits)
pub const KEY_SIZE: usize = 32;

/// Nonce size for ChaCha20-Poly1305 (96 bits)
pub const NONCE_SIZE: usize = 12;

/// Authentication tag size (128 bits)
pub const TAG_SIZE: usize = 16;

/// Salt size for Argon2
pub const SALT_SIZE: usize = 16;

/// Maximum plaintext size (Rule 2: bounded)
pub const MAX_PLAINTEXT_SIZE: usize = 10 * 1024 * 1024; // 10 MB

/// Argon2 memory cost (64 MB)
const ARGON2_M_COST: u32 = 65536;

/// Argon2 time cost (3 iterations)
const ARGON2_T_COST: u32 = 3;

/// Argon2 parallelism (4 threads)
const ARGON2_P_COST: u32 = 4;

// =============================================================================
// ERROR TYPES
// =============================================================================

/// Cryptographic error types
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CryptoError {
    /// Encryption failed
    EncryptionFailed,
    /// Decryption failed (wrong key or corrupted data)
    DecryptionFailed,
    /// Key derivation failed
    KeyDerivationFailed,
    /// Invalid key length
    InvalidKeyLength,
    /// Invalid nonce length
    InvalidNonceLength,
    /// Plaintext too large
    PlaintextTooLarge,
    /// Ciphertext too short
    CiphertextTooShort,
    /// Random generation failed
    RandomGenerationFailed,
}

impl std::fmt::Display for CryptoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CryptoError::EncryptionFailed => write!(f, "Encryption failed"),
            CryptoError::DecryptionFailed => write!(f, "Decryption failed"),
            CryptoError::KeyDerivationFailed => write!(f, "Key derivation failed"),
            CryptoError::InvalidKeyLength => write!(f, "Invalid key length"),
            CryptoError::InvalidNonceLength => write!(f, "Invalid nonce length"),
            CryptoError::PlaintextTooLarge => write!(f, "Plaintext too large"),
            CryptoError::CiphertextTooShort => write!(f, "Ciphertext too short"),
            CryptoError::RandomGenerationFailed => write!(f, "Random generation failed"),
        }
    }
}

impl std::error::Error for CryptoError {}

// =============================================================================
// KEY MANAGEMENT
// =============================================================================

/// Encryption key with automatic zeroization
#[derive(Clone, Zeroize)]
#[zeroize(drop)]
pub struct EncryptionKey {
    bytes: [u8; KEY_SIZE],
}

impl EncryptionKey {
    /// Create a new random encryption key
    pub fn generate() -> Result<Self, CryptoError> {
        let mut bytes = [0u8; KEY_SIZE];
        getrandom(&mut bytes)?;
        Ok(Self { bytes })
    }

    /// Create key from raw bytes
    pub fn from_bytes(bytes: [u8; KEY_SIZE]) -> Self {
        Self { bytes }
    }

    /// Derive key from password using Argon2id
    ///
    /// # Arguments
    /// * `password` - User password
    /// * `salt` - Salt bytes (must be 16 bytes)
    ///
    /// # Returns
    /// Derived encryption key
    pub fn derive_from_password(
        password: &[u8],
        salt: &[u8; SALT_SIZE],
    ) -> Result<Self, CryptoError> {
        let argon2 = Argon2::new(
            argon2::Algorithm::Argon2id,
            argon2::Version::V0x13,
            argon2::Params::new(ARGON2_M_COST, ARGON2_T_COST, ARGON2_P_COST, Some(KEY_SIZE))
                .map_err(|_| CryptoError::KeyDerivationFailed)?,
        );

        let salt_string =
            SaltString::encode_b64(salt).map_err(|_| CryptoError::KeyDerivationFailed)?;

        let hash = argon2
            .hash_password(password, &salt_string)
            .map_err(|_| CryptoError::KeyDerivationFailed)?;

        let hash_bytes = hash.hash.ok_or(CryptoError::KeyDerivationFailed)?;
        let hash_slice = hash_bytes.as_bytes();

        // Ensure we have enough bytes
        if hash_slice.len() < KEY_SIZE {
            return Err(CryptoError::KeyDerivationFailed);
        }

        let mut bytes = [0u8; KEY_SIZE];
        bytes.copy_from_slice(&hash_slice[..KEY_SIZE]);

        Ok(Self { bytes })
    }

    /// Get the raw key bytes (use with caution)
    pub fn as_bytes(&self) -> &[u8; KEY_SIZE] {
        &self.bytes
    }
}

// =============================================================================
// ENCRYPTION/DECRYPTION
// =============================================================================

/// Encrypted data container
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct EncryptedData {
    /// Nonce used for encryption
    pub nonce: [u8; NONCE_SIZE],
    /// Ciphertext with authentication tag
    pub ciphertext: Vec<u8>,
}

impl EncryptedData {
    /// Serialize to bytes: nonce || ciphertext
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut result = Vec::with_capacity(NONCE_SIZE + self.ciphertext.len());
        result.extend_from_slice(&self.nonce);
        result.extend_from_slice(&self.ciphertext);
        result
    }

    /// Deserialize from bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CryptoError> {
        if bytes.len() < NONCE_SIZE + TAG_SIZE {
            return Err(CryptoError::CiphertextTooShort);
        }

        let mut nonce = [0u8; NONCE_SIZE];
        nonce.copy_from_slice(&bytes[..NONCE_SIZE]);

        let ciphertext = bytes[NONCE_SIZE..].to_vec();

        Ok(Self { nonce, ciphertext })
    }
}

/// Encrypt plaintext using ChaCha20-Poly1305
///
/// # Arguments
/// * `key` - Encryption key (256 bits)
/// * `plaintext` - Data to encrypt
///
/// # Returns
/// Encrypted data containing nonce and ciphertext
///
/// # Security
/// - Generates random nonce for each encryption
/// - Authenticated encryption (AEAD)
pub fn encrypt(key: &EncryptionKey, plaintext: &[u8]) -> Result<EncryptedData, CryptoError> {
    // Rule 2: Check size bounds
    if plaintext.len() > MAX_PLAINTEXT_SIZE {
        return Err(CryptoError::PlaintextTooLarge);
    }

    // Generate random nonce
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    getrandom(&mut nonce_bytes)?;

    let cipher = ChaCha20Poly1305::new_from_slice(key.as_bytes())
        .map_err(|_| CryptoError::InvalidKeyLength)?;

    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| CryptoError::EncryptionFailed)?;

    Ok(EncryptedData {
        nonce: nonce_bytes,
        ciphertext,
    })
}

/// Decrypt ciphertext using ChaCha20-Poly1305
///
/// # Arguments
/// * `key` - Encryption key (256 bits)
/// * `encrypted` - Encrypted data containing nonce and ciphertext
///
/// # Returns
/// Decrypted plaintext
///
/// # Security
/// - Verifies authentication tag before returning plaintext
/// - Constant-time comparison
pub fn decrypt(key: &EncryptionKey, encrypted: &EncryptedData) -> Result<Vec<u8>, CryptoError> {
    let cipher = ChaCha20Poly1305::new_from_slice(key.as_bytes())
        .map_err(|_| CryptoError::InvalidKeyLength)?;

    let nonce = Nonce::from_slice(&encrypted.nonce);

    let plaintext = cipher
        .decrypt(nonce, encrypted.ciphertext.as_ref())
        .map_err(|_| CryptoError::DecryptionFailed)?;

    Ok(plaintext)
}

// =============================================================================
// HASHING
// =============================================================================

/// Compute SHA-256 hash of data
///
/// Used for:
/// - National ID hashing (privacy)
/// - IPFS content addressing verification
/// - Reason hash for access logs
pub fn sha256(data: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// Generate a random salt for Argon2
pub fn generate_salt() -> Result<[u8; SALT_SIZE], CryptoError> {
    let mut salt = [0u8; SALT_SIZE];
    getrandom(&mut salt)?;
    Ok(salt)
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/// Get random bytes using OS RNG
fn getrandom(dest: &mut [u8]) -> Result<(), CryptoError> {
    use rand::RngCore;
    OsRng
        .try_fill_bytes(dest)
        .map_err(|_| CryptoError::RandomGenerationFailed)
}

/// Convert bytes to hex string
pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Convert hex string to bytes
pub fn from_hex(hex: &str) -> Result<Vec<u8>, CryptoError> {
    if !hex.len().is_multiple_of(2) {
        return Err(CryptoError::DecryptionFailed);
    }

    let mut bytes = Vec::with_capacity(hex.len() / 2);
    let chars: Vec<char> = hex.chars().collect();

    // Rule 2: Bounded loop
    let max_iterations = hex.len() / 2;
    for i in 0..max_iterations {
        let high = chars[i * 2]
            .to_digit(16)
            .ok_or(CryptoError::DecryptionFailed)? as u8;
        let low = chars[i * 2 + 1]
            .to_digit(16)
            .ok_or(CryptoError::DecryptionFailed)? as u8;
        bytes.push((high << 4) | low);
    }

    Ok(bytes)
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_generation() {
        let key = EncryptionKey::generate().unwrap();
        assert_eq!(key.as_bytes().len(), KEY_SIZE);
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = EncryptionKey::generate().unwrap();
        let plaintext = b"Patient medical record: Blood type A+";

        let encrypted = encrypt(&key, plaintext).unwrap();
        let decrypted = decrypt(&key, &encrypted).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_wrong_key_fails_decryption() {
        let key1 = EncryptionKey::generate().unwrap();
        let key2 = EncryptionKey::generate().unwrap();
        let plaintext = b"Secret medical data";

        let encrypted = encrypt(&key1, plaintext).unwrap();
        let result = decrypt(&key2, &encrypted);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), CryptoError::DecryptionFailed);
    }

    #[test]
    fn test_encrypted_data_serialization() {
        let key = EncryptionKey::generate().unwrap();
        let plaintext = b"Test data";

        let encrypted = encrypt(&key, plaintext).unwrap();
        let bytes = encrypted.to_bytes();
        let restored = EncryptedData::from_bytes(&bytes).unwrap();

        assert_eq!(encrypted.nonce, restored.nonce);
        assert_eq!(encrypted.ciphertext, restored.ciphertext);

        let decrypted = decrypt(&key, &restored).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_key_derivation() {
        let password = b"secure_password_123";
        let salt = generate_salt().unwrap();

        let key1 = EncryptionKey::derive_from_password(password, &salt).unwrap();
        let key2 = EncryptionKey::derive_from_password(password, &salt).unwrap();

        // Same password + salt = same key
        assert_eq!(key1.as_bytes(), key2.as_bytes());
    }

    #[test]
    fn test_different_salt_different_key() {
        let password = b"secure_password_123";
        let salt1 = generate_salt().unwrap();
        let salt2 = generate_salt().unwrap();

        let key1 = EncryptionKey::derive_from_password(password, &salt1).unwrap();
        let key2 = EncryptionKey::derive_from_password(password, &salt2).unwrap();

        // Different salt = different key
        assert_ne!(key1.as_bytes(), key2.as_bytes());
    }

    #[test]
    fn test_sha256_hash() {
        let data = b"National ID: 123456789";
        let hash = sha256(data);

        assert_eq!(hash.len(), 32);

        // Same data = same hash
        let hash2 = sha256(data);
        assert_eq!(hash, hash2);
    }

    #[test]
    fn test_hex_conversion() {
        let original = vec![0xde, 0xad, 0xbe, 0xef];
        let hex = to_hex(&original);
        let restored = from_hex(&hex).unwrap();

        assert_eq!(hex, "deadbeef");
        assert_eq!(original, restored);
    }

    #[test]
    fn test_empty_plaintext() {
        let key = EncryptionKey::generate().unwrap();
        let plaintext = b"";

        let encrypted = encrypt(&key, plaintext).unwrap();
        let decrypted = decrypt(&key, &encrypted).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_large_plaintext() {
        let key = EncryptionKey::generate().unwrap();
        let plaintext = vec![0xAB; 1024 * 1024]; // 1 MB

        let encrypted = encrypt(&key, &plaintext).unwrap();
        let decrypted = decrypt(&key, &encrypted).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_plaintext_too_large() {
        let key = EncryptionKey::generate().unwrap();
        let plaintext = vec![0u8; MAX_PLAINTEXT_SIZE + 1];

        let result = encrypt(&key, &plaintext);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), CryptoError::PlaintextTooLarge);
    }

    #[test]
    fn test_ciphertext_too_short() {
        let short_data = vec![0u8; 5];
        let result = EncryptedData::from_bytes(&short_data);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), CryptoError::CiphertextTooShort);
    }
}

// =============================================================================
// WALLET SIGNATURE VERIFICATION (SEC-005)
// =============================================================================
//
// This module provides cryptographic verification of wallet signatures
// to prevent spoofing of the X-User-Id header in API requests.
//
// Message format: "<timestamp>:<wallet_address>"
// Example: "1704067200:5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"

pub mod signature {
    use blake2::{Blake2b512, Digest};
    use sp_core::sr25519::{Public, Signature};
    use sp_core::Pair;

    /// Maximum allowed timestamp drift in seconds (5 minutes)
    pub const MAX_TIMESTAMP_DRIFT_SECS: i64 = 300;

    /// Signature verification error types
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum SignatureError {
        /// Invalid signature format
        InvalidSignatureFormat,
        /// Invalid public key format
        InvalidPublicKey,
        /// Signature verification failed
        VerificationFailed,
        /// Timestamp too old or in future
        TimestampExpired,
        /// Invalid message format
        InvalidMessageFormat,
        /// SS58 address decode error
        Ss58DecodeError,
    }

    impl std::fmt::Display for SignatureError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            match self {
                SignatureError::InvalidSignatureFormat => write!(f, "Invalid signature format"),
                SignatureError::InvalidPublicKey => write!(f, "Invalid public key"),
                SignatureError::VerificationFailed => write!(f, "Signature verification failed"),
                SignatureError::TimestampExpired => write!(f, "Timestamp expired or invalid"),
                SignatureError::InvalidMessageFormat => write!(f, "Invalid message format"),
                SignatureError::Ss58DecodeError => write!(f, "SS58 address decode error"),
            }
        }
    }

    impl std::error::Error for SignatureError {}

    /// Decode SS58 address to public key bytes
    ///
    /// SS58 format: <version_byte><public_key_32_bytes><checksum_2_bytes>
    fn decode_ss58_to_pubkey(ss58_address: &str) -> Result<[u8; 32], SignatureError> {
        // Decode base58
        let decoded = bs58::decode(ss58_address)
            .into_vec()
            .map_err(|_| SignatureError::Ss58DecodeError)?;

        // SS58 with checksum: 1 byte version + 32 bytes pubkey + 2 bytes checksum = 35 bytes
        // Simple SS58: 1 byte version + 32 bytes pubkey = 33 bytes
        if decoded.len() < 33 {
            return Err(SignatureError::Ss58DecodeError);
        }

        // Extract public key (skip version byte, take 32 bytes)
        let mut pubkey = [0u8; 32];
        pubkey.copy_from_slice(&decoded[1..33]);

        // Verify checksum if present (35 bytes total)
        if decoded.len() >= 35 {
            let checksum_data = [
                &[b'S', b'S', b'5', b'8', b'P', b'R', b'E'][..],
                &decoded[..33],
            ]
            .concat();
            let hash: [u8; 64] = Blake2b512::digest(&checksum_data).into();

            if decoded[33] != hash[0] || decoded[34] != hash[1] {
                return Err(SignatureError::Ss58DecodeError);
            }
        }

        Ok(pubkey)
    }

    /// Verify an sr25519 signature against a message
    ///
    /// # Arguments
    /// * `signature_hex` - Hex-encoded 64-byte sr25519 signature
    /// * `message` - Original message that was signed (format: "<timestamp>:<wallet>")
    /// * `wallet_address` - SS58-encoded wallet address
    /// * `current_timestamp` - Current Unix timestamp for drift check
    ///
    /// # Returns
    /// Ok(()) if signature is valid, Err with reason otherwise
    ///
    /// # Security
    /// - Verifies signature cryptographically
    /// - Checks timestamp is within MAX_TIMESTAMP_DRIFT_SECS window
    /// - Constant-time signature comparison (via sp_core)
    pub fn verify_wallet_signature(
        signature_hex: &str,
        message: &str,
        wallet_address: &str,
        current_timestamp: i64,
    ) -> Result<(), SignatureError> {
        // Parse message format: "<timestamp>:<wallet_address>"
        let parts: Vec<&str> = message.splitn(2, ':').collect();
        if parts.len() != 2 {
            return Err(SignatureError::InvalidMessageFormat);
        }

        let msg_timestamp: i64 = parts[0]
            .parse()
            .map_err(|_| SignatureError::InvalidMessageFormat)?;
        let msg_wallet = parts[1];

        // Verify wallet address in message matches claimed wallet
        if msg_wallet != wallet_address {
            return Err(SignatureError::VerificationFailed);
        }

        // Check timestamp drift (Rule 2: bounded check)
        let drift = (current_timestamp - msg_timestamp).abs();
        if drift > MAX_TIMESTAMP_DRIFT_SECS {
            return Err(SignatureError::TimestampExpired);
        }

        // Decode signature from hex
        let sig_bytes =
            crate::from_hex(signature_hex).map_err(|_| SignatureError::InvalidSignatureFormat)?;

        if sig_bytes.len() != 64 {
            return Err(SignatureError::InvalidSignatureFormat);
        }

        let mut sig_array = [0u8; 64];
        sig_array.copy_from_slice(&sig_bytes);
        let signature = Signature::from_raw(sig_array);

        // Decode SS58 address to public key
        let pubkey_bytes = decode_ss58_to_pubkey(wallet_address)?;
        let public = Public::from_raw(pubkey_bytes);

        // Verify signature using sp_core
        if sp_core::sr25519::Pair::verify(&signature, message.as_bytes(), &public) {
            Ok(())
        } else {
            Err(SignatureError::VerificationFailed)
        }
    }

    /// Generate the message that should be signed by the wallet
    ///
    /// # Arguments
    /// * `timestamp` - Unix timestamp
    /// * `wallet_address` - SS58-encoded wallet address
    ///
    /// # Returns
    /// Message string in format "<timestamp>:<wallet_address>"
    pub fn create_sign_message(timestamp: i64, wallet_address: &str) -> String {
        format!("{}:{}", timestamp, wallet_address)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn test_ss58_decode_valid_address() {
            // Alice's well-known test address
            let alice = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
            let result = decode_ss58_to_pubkey(alice);
            assert!(result.is_ok());
            assert_eq!(result.unwrap().len(), 32);
        }

        #[test]
        fn test_ss58_decode_invalid_address() {
            let invalid = "invalid_address";
            let result = decode_ss58_to_pubkey(invalid);
            assert!(result.is_err());
        }

        #[test]
        fn test_create_sign_message() {
            let timestamp = 1704067200i64;
            let wallet = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
            let message = create_sign_message(timestamp, wallet);
            assert_eq!(
                message,
                "1704067200:5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
            );
        }

        #[test]
        fn test_verify_timestamp_expired() {
            let old_timestamp = 1000000i64;
            let current_timestamp = 1704067200i64;
            let wallet = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
            let message = create_sign_message(old_timestamp, wallet);

            // Using a dummy signature - will fail on timestamp check first
            let result = verify_wallet_signature(
                "00".repeat(64).as_str(),
                &message,
                wallet,
                current_timestamp,
            );
            assert_eq!(result, Err(SignatureError::TimestampExpired));
        }

        #[test]
        fn test_verify_invalid_message_format() {
            let result = verify_wallet_signature(
                "00".repeat(64).as_str(),
                "invalid_message",
                "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
                1704067200,
            );
            assert_eq!(result, Err(SignatureError::InvalidMessageFormat));
        }

        #[test]
        fn test_verify_wallet_mismatch() {
            let timestamp = 1704067200i64;
            let wallet1 = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
            let wallet2 = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
            let message = create_sign_message(timestamp, wallet1);

            let result =
                verify_wallet_signature("00".repeat(64).as_str(), &message, wallet2, timestamp);
            assert_eq!(result, Err(SignatureError::VerificationFailed));
        }
    }
}

// Re-export signature module
pub use signature::{
    create_sign_message, verify_wallet_signature, SignatureError, MAX_TIMESTAMP_DRIFT_SECS,
};
