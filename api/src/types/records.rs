use super::*;

// ============================================================================
// IPFS Request/Response Types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct UploadMedicalRecordRequest {
    /// Patient ID this record belongs to
    pub patient_id: String,
    /// Base64-encoded file content
    pub content_base64: String,
    /// Original filename
    pub filename: String,
    /// Content type (e.g., "application/pdf", "image/jpeg")
    pub content_type: String,
    /// Record type (e.g., "lab_result", "imaging", "prescription")
    pub record_type: String,
    /// Encryption override flag (always forced to true — plain uploads are rejected).
    ///
    /// If a client submits `"encrypted": false`, the server will return 400.
    /// All medical document uploads are encrypted with ChaCha20-Poly1305.
    #[serde(default = "default_encrypted")]
    pub encrypted: bool,
}

/// Default value for the `encrypted` field: always `true`.
pub fn default_encrypted() -> bool {
    true
}

#[derive(Debug, Serialize)]
pub struct UploadMedicalRecordResponse {
    pub success: bool,
    pub ipfs_hash: String,
    pub metadata_hash: String,
    pub record_reference: MedicalRecordReference,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct DownloadMedicalRecordRequest {
    /// IPFS hash of the encrypted content
    pub content_hash: String,
    /// IPFS hash of the encrypted metadata
    pub metadata_hash: String,
}

#[derive(Debug, Serialize)]
pub struct DownloadMedicalRecordResponse {
    pub success: bool,
    /// Base64-encoded decrypted content
    pub content_base64: String,
    pub filename: String,
    pub content_type: String,
    pub record_type: String,
    pub uploaded_by: String,
    pub uploaded_at: i64,
}

#[derive(Debug, Serialize)]
pub struct IpfsHealthResponse {
    pub ipfs_connected: bool,
    pub api_url: String,
    pub gateway_url: String,
}
