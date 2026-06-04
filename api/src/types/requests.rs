use super::*;

// ============================================================================
// API Request/Response Types
// ============================================================================

/// Pagination query parameters for list endpoints
#[derive(Debug, Deserialize)]
pub struct PaginationQuery {
    /// Page number (1-indexed, default: 1)
    #[serde(default = "default_page")]
    pub page: usize,
    /// Items per page (default: 20, max: 100)
    #[serde(default = "default_limit")]
    pub limit: usize,
}

pub fn default_page() -> usize {
    1
}

pub fn default_limit() -> usize {
    20
}

/// Generic paginated response wrapper
#[derive(Debug, Serialize)]
pub struct PaginatedResponse<T: Serialize> {
    pub data: Vec<T>,
    pub pagination: PaginationMeta,
}

/// Pagination metadata
#[derive(Debug, Serialize)]
pub struct PaginationMeta {
    pub page: usize,
    pub limit: usize,
    pub total_items: usize,
    pub total_pages: usize,
    pub has_next: bool,
    pub has_prev: bool,
}

impl PaginationMeta {
    pub fn new(page: usize, limit: usize, total_items: usize) -> Self {
        let limit = limit.clamp(1, 100); // Clamp to 1-100
        let page = page.max(1);
        let total_pages = (total_items + limit - 1) / limit.max(1);
        Self {
            page,
            limit,
            total_items,
            total_pages,
            has_next: page < total_pages,
            has_prev: page > 1,
        }
    }
}

/// Helper function to paginate a vector
pub fn paginate<T: Clone>(items: &[T], page: usize, limit: usize) -> (Vec<T>, PaginationMeta) {
    let limit = limit.clamp(1, 100);
    let page = page.max(1);
    let total = items.len();
    let start = (page - 1) * limit;
    let end = (start + limit).min(total);

    let data = if start < total {
        items[start..end].to_vec()
    } else {
        Vec::new()
    };

    (data, PaginationMeta::new(page, limit, total))
}

#[derive(Debug, Deserialize)]
pub struct RegisterPatientRequest {
    pub full_name: String,
    pub date_of_birth: String,
    pub national_id: String,
    pub phone: String,
    pub blood_type: String,
    /// Allergies - can be simple strings (converted to Mild severity) for backward compatibility
    pub allergies: Vec<String>,
    pub current_medications: Vec<String>,
    pub chronic_conditions: Vec<String>,
    pub emergency_contact_name: String,
    pub emergency_contact_phone: String,
    pub emergency_contact_relationship: String,
    pub organ_donor: bool,
    pub dnr_status: bool,
    /// Preferred languages (ISO 639-1 codes), e.g., ["en", "yo", "ha"]
    #[serde(default)]
    pub languages: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct RegisterPatientResponse {
    pub success: bool,
    pub patient_id: String,
    pub nfc_tag_id: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct EmergencyAccessRequest {
    pub nfc_tag_id: String,
    pub accessor_id: String,
    pub accessor_role: String,
    pub location: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EmergencyAccessResponse {
    pub success: bool,
    pub access_id: String,
    pub emergency_info: Option<EmergencyInfo>,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct SimulateNfcTapRequest {
    pub patient_id: String,
}

#[derive(Debug, Serialize)]
pub struct SimulateNfcTapResponse {
    pub success: bool,
    pub nfc_tag_id: String,
    pub tag_data: NfcTagData,
    pub qr_code_base64: Option<String>,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct HealthCheckResponse {
    pub status: String,
    pub version: String,
    pub timestamp: DateTime<Utc>,
    pub blockchain_connected: bool,
}

#[derive(Debug, Serialize)]
pub struct AccessLogsResponse {
    pub patient_id: String,
    pub access_logs: Vec<AccessLogEntry>,
    pub total_accesses: usize,
}

