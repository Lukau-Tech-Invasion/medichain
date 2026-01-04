//! IPFS Client Module for MediChain
//!
//! © 2025 Trustware. All rights reserved.
//!
//! Provides encrypted medical document storage on IPFS with:
//! - ChaCha20-Poly1305 encryption before upload
//! - Automatic decryption on download
//! - Content-addressed storage via IPFS hashes

use medichain_crypto::{decrypt, encrypt, CryptoError, EncryptionKey};
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Maximum file size for IPFS uploads (10 MB)
const MAX_FILE_SIZE: usize = 10 * 1024 * 1024;

/// IPFS client configuration
#[derive(Clone)]
pub struct IpfsClient {
    /// Base URL of the IPFS API (e.g., "http://localhost:5001")
    api_url: String,
    /// Gateway URL for retrieving files (e.g., "http://localhost:8080")
    gateway_url: String,
    /// HTTP client
    client: reqwest::Client,
}

/// Response from IPFS add operation
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct IpfsAddResponse {
    /// Content identifier (hash)
    pub hash: String,
    /// Original filename
    pub name: String,
    /// File size in bytes
    pub size: String,
}

/// Metadata stored alongside encrypted content
#[derive(Debug, Serialize, Deserialize)]
pub struct EncryptedMetadata {
    /// Original filename
    pub filename: String,
    /// Content type (MIME type)
    pub content_type: String,
    /// Upload timestamp (Unix epoch)
    pub uploaded_at: i64,
    /// Patient ID this record belongs to
    pub patient_id: String,
    /// Healthcare provider who uploaded
    pub uploaded_by: String,
    /// Record type (e.g., "lab_result", "imaging", "prescription")
    pub record_type: String,
}

/// Result of an IPFS upload operation
#[derive(Debug, Serialize, Deserialize)]
pub struct UploadResult {
    /// IPFS content hash (CID)
    pub ipfs_hash: String,
    /// Encrypted metadata hash
    pub metadata_hash: String,
    /// Original file size
    pub original_size: usize,
    /// Encrypted file size
    pub encrypted_size: usize,
}

/// Result of an IPFS download operation
#[derive(Debug)]
pub struct DownloadResult {
    /// Decrypted file content
    pub content: Vec<u8>,
    /// File metadata
    pub metadata: EncryptedMetadata,
}

/// Errors that can occur during IPFS operations
#[derive(Debug)]
pub enum IpfsError {
    /// File exceeds maximum size limit
    FileTooLarge { size: usize, max: usize },
    /// IPFS API request failed
    RequestFailed(String),
    /// Failed to parse IPFS response
    ParseError(String),
    /// Encryption/decryption failed
    CryptoError(CryptoError),
    /// File not found on IPFS
    NotFound(String),
    /// Invalid IPFS hash format
    InvalidHash(String),
    /// Network timeout
    Timeout,
    /// Generic I/O error
    IoError(String),
}

impl std::fmt::Display for IpfsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FileTooLarge { size, max } => {
                write!(f, "File size {} exceeds maximum {}", size, max)
            }
            Self::RequestFailed(msg) => write!(f, "IPFS request failed: {}", msg),
            Self::ParseError(msg) => write!(f, "Failed to parse response: {}", msg),
            Self::CryptoError(e) => write!(f, "Cryptographic error: {:?}", e),
            Self::NotFound(hash) => write!(f, "Content not found: {}", hash),
            Self::InvalidHash(hash) => write!(f, "Invalid IPFS hash: {}", hash),
            Self::Timeout => write!(f, "IPFS operation timed out"),
            Self::IoError(msg) => write!(f, "I/O error: {}", msg),
        }
    }
}

impl std::error::Error for IpfsError {}

impl From<CryptoError> for IpfsError {
    fn from(err: CryptoError) -> Self {
        Self::CryptoError(err)
    }
}

impl From<reqwest::Error> for IpfsError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            Self::Timeout
        } else {
            Self::RequestFailed(err.to_string())
        }
    }
}

impl IpfsClient {
    /// Create a new IPFS client with default local configuration
    pub fn new_local() -> Self {
        Self::new(
            "http://localhost:5001".to_string(),
            "http://localhost:8080".to_string(),
        )
    }

    /// Create a new IPFS client with custom endpoints
    pub fn new(api_url: String, gateway_url: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            api_url,
            gateway_url,
            client,
        }
    }

    /// Check if IPFS daemon is running and accessible
    pub async fn health_check(&self) -> Result<bool, IpfsError> {
        let url = format!("{}/api/v0/id", self.api_url);

        match self.client.post(&url).send().await {
            Ok(resp) => Ok(resp.status().is_success()),
            Err(_) => Ok(false),
        }
    }

    /// Upload encrypted medical document to IPFS
    ///
    /// # Arguments
    /// * `content` - Raw file content
    /// * `metadata` - Document metadata
    /// * `encryption_key` - Key for encrypting the content
    ///
    /// # Returns
    /// Upload result containing IPFS hashes
    pub async fn upload_encrypted(
        &self,
        content: &[u8],
        metadata: EncryptedMetadata,
        encryption_key: &EncryptionKey,
    ) -> Result<UploadResult, IpfsError> {
        // Validate file size
        if content.len() > MAX_FILE_SIZE {
            return Err(IpfsError::FileTooLarge {
                size: content.len(),
                max: MAX_FILE_SIZE,
            });
        }

        let original_size = content.len();

        // Encrypt the content
        let encrypted_content = encrypt(content, encryption_key)?;
        let encrypted_size = encrypted_content.ciphertext.len();

        // Serialize encrypted data for storage
        let encrypted_bytes = serde_json::to_vec(&encrypted_content)
            .map_err(|e| IpfsError::IoError(e.to_string()))?;

        // Upload encrypted content
        let content_hash = self
            .upload_raw(&encrypted_bytes, &metadata.filename)
            .await?;

        // Encrypt and upload metadata
        let metadata_json =
            serde_json::to_vec(&metadata).map_err(|e| IpfsError::IoError(e.to_string()))?;
        let encrypted_metadata = encrypt(&metadata_json, encryption_key)?;
        let metadata_bytes = serde_json::to_vec(&encrypted_metadata)
            .map_err(|e| IpfsError::IoError(e.to_string()))?;

        let metadata_hash = self.upload_raw(&metadata_bytes, "metadata.json").await?;

        Ok(UploadResult {
            ipfs_hash: content_hash,
            metadata_hash,
            original_size,
            encrypted_size,
        })
    }

    /// Download and decrypt medical document from IPFS
    ///
    /// # Arguments
    /// * `content_hash` - IPFS hash of the encrypted content
    /// * `metadata_hash` - IPFS hash of the encrypted metadata
    /// * `encryption_key` - Key for decrypting the content
    ///
    /// # Returns
    /// Decrypted content and metadata
    pub async fn download_decrypted(
        &self,
        content_hash: &str,
        metadata_hash: &str,
        encryption_key: &EncryptionKey,
    ) -> Result<DownloadResult, IpfsError> {
        // Validate hash format
        Self::validate_hash(content_hash)?;
        Self::validate_hash(metadata_hash)?;

        // Download and decrypt metadata
        let metadata_bytes = self.download_raw(metadata_hash).await?;
        let encrypted_metadata: medichain_crypto::EncryptedData =
            serde_json::from_slice(&metadata_bytes)
                .map_err(|e| IpfsError::ParseError(e.to_string()))?;
        let metadata_json = decrypt(&encrypted_metadata, encryption_key)?;
        let metadata: EncryptedMetadata = serde_json::from_slice(&metadata_json)
            .map_err(|e| IpfsError::ParseError(e.to_string()))?;

        // Download and decrypt content
        let content_bytes = self.download_raw(content_hash).await?;
        let encrypted_content: medichain_crypto::EncryptedData =
            serde_json::from_slice(&content_bytes)
                .map_err(|e| IpfsError::ParseError(e.to_string()))?;
        let content = decrypt(&encrypted_content, encryption_key)?;

        Ok(DownloadResult { content, metadata })
    }

    /// Upload raw bytes to IPFS (internal)
    async fn upload_raw(&self, data: &[u8], filename: &str) -> Result<String, IpfsError> {
        let url = format!("{}/api/v0/add", self.api_url);

        let part = Part::bytes(data.to_vec())
            .file_name(filename.to_string())
            .mime_str("application/octet-stream")
            .map_err(|e| IpfsError::IoError(e.to_string()))?;

        let form = Form::new().part("file", part);

        let response = self.client.post(&url).multipart(form).send().await?;

        if !response.status().is_success() {
            return Err(IpfsError::RequestFailed(format!(
                "HTTP {}",
                response.status()
            )));
        }

        let add_response: IpfsAddResponse = response
            .json()
            .await
            .map_err(|e| IpfsError::ParseError(e.to_string()))?;

        Ok(add_response.hash)
    }

    /// Download raw bytes from IPFS (internal)
    async fn download_raw(&self, hash: &str) -> Result<Vec<u8>, IpfsError> {
        let url = format!("{}/ipfs/{}", self.gateway_url, hash);

        let response = self.client.get(&url).send().await?;

        if response.status().as_u16() == 404 {
            return Err(IpfsError::NotFound(hash.to_string()));
        }

        if !response.status().is_success() {
            return Err(IpfsError::RequestFailed(format!(
                "HTTP {}",
                response.status()
            )));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| IpfsError::IoError(e.to_string()))?;

        Ok(bytes.to_vec())
    }

    /// Validate IPFS hash format (CIDv0 or CIDv1)
    fn validate_hash(hash: &str) -> Result<(), IpfsError> {
        // CIDv0: Starts with "Qm" and is 46 characters
        // CIDv1: Starts with "b" and is variable length
        if hash.starts_with("Qm") && hash.len() == 46 {
            return Ok(());
        }
        if hash.starts_with('b') && hash.len() >= 32 {
            return Ok(());
        }
        Err(IpfsError::InvalidHash(hash.to_string()))
    }

    /// Pin content to ensure it persists on IPFS
    pub async fn pin(&self, hash: &str) -> Result<(), IpfsError> {
        Self::validate_hash(hash)?;

        let url = format!("{}/api/v0/pin/add?arg={}", self.api_url, hash);

        let response = self.client.post(&url).send().await?;

        if !response.status().is_success() {
            return Err(IpfsError::RequestFailed(format!(
                "Failed to pin {}: HTTP {}",
                hash,
                response.status()
            )));
        }

        Ok(())
    }

    /// Unpin content from IPFS
    pub async fn unpin(&self, hash: &str) -> Result<(), IpfsError> {
        Self::validate_hash(hash)?;

        let url = format!("{}/api/v0/pin/rm?arg={}", self.api_url, hash);

        let response = self.client.post(&url).send().await?;

        if !response.status().is_success() {
            return Err(IpfsError::RequestFailed(format!(
                "Failed to unpin {}: HTTP {}",
                hash,
                response.status()
            )));
        }

        Ok(())
    }
}

/// Record reference stored on-chain (minimal data)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MedicalRecordReference {
    /// IPFS hash of encrypted content
    pub content_hash: String,
    /// IPFS hash of encrypted metadata
    pub metadata_hash: String,
    /// Record type
    pub record_type: String,
    /// Upload timestamp
    pub uploaded_at: i64,
    /// SHA-256 hash of original content (for integrity verification)
    pub content_checksum: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_hash_cidv0() {
        let valid_hash = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
        assert!(IpfsClient::validate_hash(valid_hash).is_ok());
    }

    #[test]
    fn test_validate_hash_cidv1() {
        let valid_hash = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
        assert!(IpfsClient::validate_hash(valid_hash).is_ok());
    }

    #[test]
    fn test_validate_hash_invalid() {
        let invalid_hash = "invalid-hash";
        assert!(IpfsClient::validate_hash(invalid_hash).is_err());
    }

    #[test]
    fn test_validate_hash_too_short() {
        let short_hash = "Qm123";
        assert!(IpfsClient::validate_hash(short_hash).is_err());
    }

    #[test]
    fn test_ipfs_error_display() {
        let err = IpfsError::FileTooLarge {
            size: 20_000_000,
            max: 10_000_000,
        };
        assert!(err.to_string().contains("exceeds maximum"));

        let err = IpfsError::NotFound("QmTest".to_string());
        assert!(err.to_string().contains("not found"));
    }

    #[test]
    fn test_encrypted_metadata_serialization() {
        let metadata = EncryptedMetadata {
            filename: "lab_results.pdf".to_string(),
            content_type: "application/pdf".to_string(),
            uploaded_at: 1704067200,
            patient_id: "MCHI-1234-5678".to_string(),
            uploaded_by: "dr-alice".to_string(),
            record_type: "lab_result".to_string(),
        };

        let json = serde_json::to_string(&metadata).unwrap();
        let parsed: EncryptedMetadata = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.filename, "lab_results.pdf");
        assert_eq!(parsed.patient_id, "MCHI-1234-5678");
    }

    #[test]
    fn test_upload_result_serialization() {
        let result = UploadResult {
            ipfs_hash: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG".to_string(),
            metadata_hash: "QmZK3LwJ2K4GpQk8Q9K7LjM8N9P2Q4R5S6T7U8V9W0X1Y2".to_string(),
            original_size: 1024,
            encrypted_size: 1040,
        };

        let json = serde_json::to_string(&result).unwrap();
        let parsed: UploadResult = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.original_size, 1024);
        assert_eq!(parsed.encrypted_size, 1040);
    }

    #[test]
    fn test_medical_record_reference() {
        let reference = MedicalRecordReference {
            content_hash: "QmContent123".to_string(),
            metadata_hash: "QmMeta456".to_string(),
            record_type: "imaging".to_string(),
            uploaded_at: 1704067200,
            content_checksum: "abc123def456".to_string(),
        };

        let json = serde_json::to_string(&reference).unwrap();
        assert!(json.contains("imaging"));
    }
}
