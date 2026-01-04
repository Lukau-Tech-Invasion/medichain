//! MediChain WebAssembly Cryptographic Module
//!
//! This module provides browser-safe cryptographic operations for the MediChain
//! healthcare system. It uses Rust + WebAssembly to ensure memory safety and
//! zero-cost abstractions for sensitive medical data encryption.
//!
//! ## Features
//! - ChaCha20-Poly1305 authenticated encryption
//! - SHA-256 hashing for data integrity
//! - QR code generation for emergency access
//! - Secure random number generation
//!
//! ## Usage in JavaScript/TypeScript
//! ```javascript
//! import init, { encrypt_medical_data, decrypt_medical_data, generate_qr_code } from 'medichain-wasm-crypto';
//!
//! await init();
//!
//! const encrypted = encrypt_medical_data("sensitive data", "password123");
//! const decrypted = decrypt_medical_data(encrypted, "password123");
//! const qrCodeBase64 = generate_qr_code("MCHI-2026-1234-5678");
//! ```
//!
//! © 2025 Trustware. All rights reserved.

mod hex;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chacha20poly1305::{
    aead::{Aead, KeyInit, OsRng},
    ChaCha20Poly1305, Nonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;

// ============================================================================
// Initialization
// ============================================================================

/// Initialize panic hook for better error messages in browser console
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

// ============================================================================
// Data Structures
// ============================================================================

/// Encrypted data envelope containing ciphertext and metadata
#[derive(Serialize, Deserialize)]
pub struct EncryptedEnvelope {
    /// Base64-encoded ciphertext
    pub ciphertext: String,
    /// Base64-encoded nonce (12 bytes for ChaCha20)
    pub nonce: String,
    /// Base64-encoded salt for key derivation (32 bytes)
    pub salt: String,
    /// Algorithm identifier
    pub algorithm: String,
    /// Version for future compatibility
    pub version: u8,
}

/// Result of QR code generation
#[derive(Serialize, Deserialize)]
pub struct QRCodeResult {
    /// Base64-encoded PNG image
    pub image_base64: String,
    /// Data encoded in the QR code
    pub encoded_data: String,
    /// Image dimensions
    pub width: u32,
    pub height: u32,
}

/// Patient emergency data for QR encoding
#[derive(Serialize, Deserialize)]
pub struct EmergencyQRData {
    /// MediChain Health ID
    pub health_id: String,
    /// Card verification hash (first 16 chars)
    pub card_hash: String,
    /// Timestamp of generation
    pub generated_at: u64,
    /// Expiration timestamp (for temporary QR codes)
    pub expires_at: Option<u64>,
}

// ============================================================================
// Cryptographic Functions
// ============================================================================

/// Derive a 256-bit key from password using SHA-256 + salt
///
/// Note: In production, use Argon2id. SHA-256 is used here for WASM size optimization.
fn derive_key(password: &str, salt: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    hasher.update(salt);
    // Second round for basic strengthening
    let first_hash = hasher.finalize();

    let mut hasher2 = Sha256::new();
    hasher2.update(&first_hash);
    hasher2.update(salt);
    hasher2.update(password.as_bytes());

    let result = hasher2.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    key
}

/// Encrypt sensitive medical data using ChaCha20-Poly1305
///
/// # Arguments
/// * `plaintext` - The sensitive data to encrypt (e.g., medical records JSON)
/// * `password` - User-provided password for key derivation
///
/// # Returns
/// JSON string containing the encrypted envelope
///
/// # Example
/// ```javascript
/// const encrypted = encrypt_medical_data(JSON.stringify(patientData), "secure_password");
/// // Store `encrypted` in IPFS or database
/// ```
#[wasm_bindgen]
pub fn encrypt_medical_data(plaintext: &str, password: &str) -> Result<String, JsValue> {
    // Generate random salt
    let mut salt = [0u8; 32];
    OsRng.fill_bytes(&mut salt);

    // Derive key from password
    let key = derive_key(password, &salt);

    // Create cipher
    let cipher = ChaCha20Poly1305::new_from_slice(&key)
        .map_err(|e| JsValue::from_str(&format!("Key error: {}", e)))?;

    // Generate random nonce (12 bytes for ChaCha20)
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| JsValue::from_str(&format!("Encryption failed: {}", e)))?;

    // Create envelope
    let envelope = EncryptedEnvelope {
        ciphertext: BASE64.encode(&ciphertext),
        nonce: BASE64.encode(&nonce_bytes),
        salt: BASE64.encode(&salt),
        algorithm: "ChaCha20-Poly1305".to_string(),
        version: 1,
    };

    // Serialize to JSON
    serde_json::to_string(&envelope)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Decrypt medical data using ChaCha20-Poly1305
///
/// # Arguments
/// * `encrypted_json` - The encrypted envelope JSON from `encrypt_medical_data`
/// * `password` - The same password used for encryption
///
/// # Returns
/// The original plaintext data
///
/// # Example
/// ```javascript
/// const decrypted = decrypt_medical_data(encrypted, "secure_password");
/// const patientData = JSON.parse(decrypted);
/// ```
#[wasm_bindgen]
pub fn decrypt_medical_data(encrypted_json: &str, password: &str) -> Result<String, JsValue> {
    // Parse envelope
    let envelope: EncryptedEnvelope = serde_json::from_str(encrypted_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid envelope: {}", e)))?;

    // Decode base64 components
    let ciphertext = BASE64
        .decode(&envelope.ciphertext)
        .map_err(|e| JsValue::from_str(&format!("Invalid ciphertext: {}", e)))?;
    let nonce_bytes = BASE64
        .decode(&envelope.nonce)
        .map_err(|e| JsValue::from_str(&format!("Invalid nonce: {}", e)))?;
    let salt = BASE64
        .decode(&envelope.salt)
        .map_err(|e| JsValue::from_str(&format!("Invalid salt: {}", e)))?;

    // Derive key
    let key = derive_key(password, &salt);

    // Create cipher
    let cipher = ChaCha20Poly1305::new_from_slice(&key)
        .map_err(|e| JsValue::from_str(&format!("Key error: {}", e)))?;

    // Create nonce
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Decrypt
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| JsValue::from_str("Decryption failed: invalid password or corrupted data"))?;

    // Convert to string
    String::from_utf8(plaintext).map_err(|e| JsValue::from_str(&format!("Invalid UTF-8: {}", e)))
}

/// Compute SHA-256 hash of data
///
/// # Arguments
/// * `data` - Data to hash
///
/// # Returns
/// Hex-encoded hash string
#[wasm_bindgen]
pub fn sha256_hash(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    let result = hasher.finalize();
    hex::encode(result)
}

/// Compute SHA-256 hash for national ID (privacy-preserving)
/// Adds domain separation to prevent rainbow table attacks
#[wasm_bindgen]
pub fn hash_national_id(national_id: &str, id_type: &str) -> String {
    let mut hasher = Sha256::new();
    // Domain separation
    hasher.update(b"MEDICHAIN-NID-V1:");
    hasher.update(id_type.as_bytes());
    hasher.update(b":");
    hasher.update(national_id.as_bytes());
    let result = hasher.finalize();
    hex::encode(result)
}

// ============================================================================
// QR Code Generation
// ============================================================================

/// Generate a QR code for patient emergency access
///
/// # Arguments
/// * `health_id` - The patient's MediChain Health ID (e.g., "MCHI-2026-1234-5678")
/// * `card_hash` - First 16 characters of card verification hash
///
/// # Returns
/// JSON containing base64-encoded PNG and metadata
///
/// # Example
/// ```javascript
/// const qr = generate_emergency_qr("MCHI-2026-1234-5678", "abc123def456");
/// const result = JSON.parse(qr);
/// document.getElementById('qr-image').src = `data:image/png;base64,${result.image_base64}`;
/// ```
#[wasm_bindgen]
pub fn generate_emergency_qr(health_id: &str, card_hash: &str) -> Result<String, JsValue> {
    use image::Luma;
    use qrcode::QrCode;

    // Create QR data structure
    let qr_data = EmergencyQRData {
        health_id: health_id.to_string(),
        card_hash: card_hash.chars().take(16).collect(),
        generated_at: js_sys::Date::now() as u64,
        expires_at: None, // Permanent QR
    };

    // Serialize to JSON for encoding
    let qr_content = serde_json::to_string(&qr_data)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))?;

    // Generate QR code
    let code = QrCode::new(qr_content.as_bytes())
        .map_err(|e| JsValue::from_str(&format!("QR generation error: {}", e)))?;

    // Render to image
    let image = code
        .render::<Luma<u8>>()
        .min_dimensions(256, 256)
        .max_dimensions(512, 512)
        .build();

    let width = image.width();
    let height = image.height();

    // Encode to PNG
    let mut buffer = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buffer);

    image::DynamicImage::ImageLuma8(image)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| JsValue::from_str(&format!("PNG encoding error: {}", e)))?;

    // Create result
    let result = QRCodeResult {
        image_base64: BASE64.encode(&buffer),
        encoded_data: qr_content,
        width,
        height,
    };

    serde_json::to_string(&result)
        .map_err(|e| JsValue::from_str(&format!("Result serialization error: {}", e)))
}

/// Generate a simple QR code from any text
#[wasm_bindgen]
pub fn generate_qr_code(data: &str) -> Result<String, JsValue> {
    use image::Luma;
    use qrcode::QrCode;

    let code = QrCode::new(data.as_bytes())
        .map_err(|e| JsValue::from_str(&format!("QR generation error: {}", e)))?;

    let image = code
        .render::<Luma<u8>>()
        .min_dimensions(200, 200)
        .max_dimensions(400, 400)
        .build();

    let mut buffer = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buffer);

    image::DynamicImage::ImageLuma8(image)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| JsValue::from_str(&format!("PNG encoding error: {}", e)))?;

    Ok(BASE64.encode(&buffer))
}

// ============================================================================
// Utility Functions
// ============================================================================

/// Generate a cryptographically secure random hex string
#[wasm_bindgen]
pub fn generate_random_hex(byte_length: usize) -> String {
    let mut bytes = vec![0u8; byte_length];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Generate a MediChain Health ID
/// Format: MCHI-YYYY-XXXX-XXXX where X is random hex
#[wasm_bindgen]
pub fn generate_health_id() -> String {
    let year = js_sys::Date::new_0().get_full_year();
    let random1 = generate_random_hex(2).to_uppercase();
    let random2 = generate_random_hex(2).to_uppercase();
    format!("MCHI-{}-{}-{}", year, random1, random2)
}

/// Verify data integrity using SHA-256 checksum
#[wasm_bindgen]
pub fn verify_checksum(data: &str, expected_hash: &str) -> bool {
    let computed = sha256_hash(data);
    computed.eq_ignore_ascii_case(expected_hash)
}

/// Get library version
#[wasm_bindgen]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Get library info for debugging
#[wasm_bindgen]
pub fn get_info() -> String {
    serde_json::json!({
        "name": "medichain-wasm-crypto",
        "version": env!("CARGO_PKG_VERSION"),
        "algorithms": {
            "encryption": "ChaCha20-Poly1305",
            "hashing": "SHA-256",
            "key_derivation": "SHA-256 (2 rounds)"
        },
        "features": [
            "encrypt_medical_data",
            "decrypt_medical_data",
            "generate_emergency_qr",
            "hash_national_id"
        ]
    })
    .to_string()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let plaintext = r#"{"patient":"John Doe","blood_type":"O+"}"#;
        let password = "secure_password_123";

        let encrypted = encrypt_medical_data(plaintext, password).unwrap();
        let decrypted = decrypt_medical_data(&encrypted, password).unwrap();

        assert_eq!(plaintext, decrypted);
    }

    #[test]
    fn test_wrong_password_fails() {
        let plaintext = "sensitive data";
        let encrypted = encrypt_medical_data(plaintext, "correct_password").unwrap();
        let result = decrypt_medical_data(&encrypted, "wrong_password");

        assert!(result.is_err());
    }

    #[test]
    fn test_sha256_hash() {
        let hash = sha256_hash("hello world");
        assert_eq!(hash.len(), 64); // 32 bytes = 64 hex chars
    }

    #[test]
    fn test_national_id_hash() {
        let hash1 = hash_national_id("NIN-12345678901", "nigeria");
        let hash2 = hash_national_id("NIN-12345678901", "nigeria");
        let hash3 = hash_national_id("NIN-12345678901", "ghana");

        assert_eq!(hash1, hash2); // Same input = same output
        assert_ne!(hash1, hash3); // Different domain = different output
    }

    #[test]
    fn test_health_id_format() {
        let id = generate_health_id();
        assert!(id.starts_with("MCHI-"));
        assert_eq!(id.len(), 19); // MCHI-YYYY-XXXX-XXXX
    }

    #[test]
    fn test_verify_checksum() {
        let data = "test data";
        let hash = sha256_hash(data);
        assert!(verify_checksum(data, &hash));
        assert!(!verify_checksum("different data", &hash));
    }
}
