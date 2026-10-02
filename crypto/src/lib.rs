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

pub mod seal;

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

/// Fill a fixed-size array from the OS random source.
///
/// For secrets a person will read or type (one-time codes) where a UUID's fixed
/// version and variant bits would waste entropy.
pub fn random_bytes<const N: usize>() -> Result<[u8; N], CryptoError> {
    let mut out = [0u8; N];
    getrandom(&mut out)?;
    Ok(out)
}

/// Compare two byte strings without stopping at the first difference.
///
/// Used for one-time-code digests, so a caller cannot learn how many leading
/// bytes of a guess were right from how long the answer took. Differing lengths
/// are unequal immediately; the lengths of the compared digests are public.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut difference = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        difference |= x ^ y;
    }
    difference == 0
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

/// Convert hex string to bytes.
///
/// An optional `0x`/`0X` prefix is accepted: many tools emit hex that way, and a
/// key or digest pasted from one should not fail at the decoder.
pub fn from_hex(hex: &str) -> Result<Vec<u8>, CryptoError> {
    let hex = hex
        .strip_prefix("0x")
        .or_else(|| hex.strip_prefix("0X"))
        .unwrap_or(hex);

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
    fn constant_time_eq_agrees_with_equality() {
        assert!(constant_time_eq(b"abcdef", b"abcdef"));
        assert!(!constant_time_eq(b"abcdef", b"abcdeg"));
        assert!(!constant_time_eq(b"abcdef", b"abcde"));
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn random_bytes_fills_the_whole_array_differently_each_time() {
        let a = random_bytes::<32>().unwrap();
        let b = random_bytes::<32>().unwrap();
        assert_ne!(a, b);
        assert_ne!(a, [0u8; 32]);
    }

    #[test]
    fn test_hex_conversion() {
        let original = vec![0xde, 0xad, 0xbe, 0xef];
        let hex = to_hex(&original);
        let restored = from_hex(&hex).unwrap();

        assert_eq!(hex, "deadbeef");
        assert_eq!(original, restored);
    }

    /// Hex copied from other tooling often carries a `0x` prefix; it is stripped
    /// rather than rejected.
    #[test]
    fn from_hex_accepts_the_0x_prefix() {
        let expected = vec![0xde, 0xad, 0xbe, 0xef];
        assert_eq!(from_hex("0xdeadbeef").unwrap(), expected);
        assert_eq!(from_hex("0Xdeadbeef").unwrap(), expected);
        assert_eq!(from_hex("deadbeef").unwrap(), expected);
    }

    #[test]
    fn from_hex_still_rejects_non_hex_content() {
        // The prefix is stripped, not treated as permission to accept garbage.
        assert!(from_hex("0xzz").is_err());
        assert!(from_hex("0xabc").is_err());
        assert!(from_hex("nothex").is_err());
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

/// Password verification for credential sign-in.
///
/// # What this is
///
/// This authenticates a *person* against a stored verifier. The client derives
/// an auth proof from the password with PBKDF2 and HKDF and sends only that; the
/// server stores Argon2id over the proof, so a stolen database yields a verifier
/// and never a password.
///
/// Uses Argon2id with the crate's existing cost parameters and the PHC string
/// format, so the parameters travel with each hash and can be raised later
/// without invalidating stored credentials.
pub mod password {
    use argon2::password_hash::{
        rand_core::OsRng as PwOsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
    };
    use argon2::{Algorithm, Argon2, Params, Version};

    use super::{CryptoError, ARGON2_M_COST, ARGON2_P_COST, ARGON2_T_COST};

    /// Reject implausibly short or unbounded secrets before hashing.
    ///
    /// The upper bound is not a policy choice but a denial-of-service guard:
    /// Argon2id over a multi-megabyte "password" is an easy way to burn server
    /// CPU. The lower bound is a floor, not a password policy — callers should
    /// enforce something stronger at the edge.
    const MIN_SECRET_LEN: usize = 12;
    const MAX_SECRET_LEN: usize = 1024;

    fn argon2() -> Result<Argon2<'static>, CryptoError> {
        let params = Params::new(ARGON2_M_COST, ARGON2_T_COST, ARGON2_P_COST, None)
            .map_err(|_| CryptoError::KeyDerivationFailed)?;
        Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
    }

    /// Hash a login secret, returning a PHC string safe to store.
    ///
    /// The salt is random per call, so two accounts sharing a password produce
    /// different verifiers.
    pub fn hash_secret(secret: &str) -> Result<String, CryptoError> {
        if secret.len() < MIN_SECRET_LEN || secret.len() > MAX_SECRET_LEN {
            return Err(CryptoError::KeyDerivationFailed);
        }
        let salt = SaltString::generate(&mut PwOsRng);
        argon2()?
            .hash_password(secret.as_bytes(), &salt)
            .map(|h| h.to_string())
            .map_err(|_| CryptoError::KeyDerivationFailed)
    }

    /// Check a secret against a stored PHC string.
    ///
    /// Returns `false` for a wrong secret *and* for a malformed or empty
    /// stored hash — an account with no usable verifier must never
    /// authenticate. Argon2's own comparison is constant-time; the length
    /// pre-check deliberately runs before it and leaks only length, which the
    /// caller already knows.
    pub fn verify_secret(secret: &str, stored_phc: &str) -> bool {
        if secret.is_empty() || secret.len() > MAX_SECRET_LEN || stored_phc.is_empty() {
            return false;
        }
        let Ok(parsed) = PasswordHash::new(stored_phc) else {
            return false;
        };
        let Ok(argon) = argon2() else {
            return false;
        };
        argon.verify_password(secret.as_bytes(), &parsed).is_ok()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn a_secret_verifies_against_its_own_hash() {
            let phc = hash_secret("correct horse battery").unwrap();
            assert!(verify_secret("correct horse battery", &phc));
        }

        #[test]
        fn a_wrong_secret_does_not_verify() {
            let phc = hash_secret("correct horse battery").unwrap();
            assert!(!verify_secret("correct horse batteries", &phc));
            assert!(!verify_secret("", &phc));
        }

        /// Two accounts with the same password must not share a verifier, or
        /// the store leaks which users picked the same password.
        #[test]
        fn the_same_secret_hashes_differently_each_time() {
            let a = hash_secret("correct horse battery").unwrap();
            let b = hash_secret("correct horse battery").unwrap();
            assert_ne!(a, b);
            assert!(verify_secret("correct horse battery", &a));
            assert!(verify_secret("correct horse battery", &b));
        }

        /// An account row with no credential set, or with a corrupted one,
        /// must fail closed rather than accept anything.
        #[test]
        fn an_absent_or_malformed_stored_hash_never_verifies() {
            assert!(!verify_secret("anything at all", ""));
            assert!(!verify_secret("anything at all", "not-a-phc-string"));
            assert!(!verify_secret("anything at all", "$argon2id$v=19$bogus"));
        }

        #[test]
        fn implausible_secret_lengths_are_refused_at_hash_time() {
            assert!(hash_secret("short").is_err());
            assert!(hash_secret(&"x".repeat(2048)).is_err());
        }

        /// The PHC string carries its parameters, so raising cost later does
        /// not invalidate credentials already stored.
        #[test]
        fn the_stored_hash_is_a_parameterised_argon2id_phc_string() {
            let phc = hash_secret("correct horse battery").unwrap();
            assert!(phc.starts_with("$argon2id$"), "got {phc}");
            assert!(phc.contains("m=") && phc.contains("t=") && phc.contains("p="));
        }
    }
}
