use super::*;

// ============================================================================
// Lab Result Submission Types (Pending Approval Workflow)
// ============================================================================

/// Status of lab result submission
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum LabResultStatus {
    #[default]
    Pending,
    Approved,
    Rejected,
}

impl std::fmt::Display for LabResultStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LabResultStatus::Pending => write!(f, "pending"),
            LabResultStatus::Approved => write!(f, "approved"),
            LabResultStatus::Rejected => write!(f, "rejected"),
        }
    }
}

/// Individual test result within a lab submission
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabTestResult {
    /// Parameter name (e.g., "Hemoglobin", "WBC Count")
    pub parameter: String,
    /// Result value
    pub value: String,
    /// Unit of measurement (e.g., "g/dL", "cells/mcL")
    pub unit: String,
    /// Normal reference range (e.g., "12.0-17.5")
    pub reference_range: String,
    /// Optional flag for abnormal results
    pub flag: Option<String>,
}

/// Lab result submission awaiting doctor approval
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabResultSubmission {
    /// Unique submission ID
    pub id: String,
    /// Patient ID this result is for
    pub patient_id: String,
    /// Patient name (for display purposes)
    pub patient_name: String,
    /// Name of the test (e.g., "Complete Blood Count")
    pub test_name: String,
    /// Category of test (e.g., "Hematology", "Chemistry")
    pub test_category: String,
    /// Individual test results
    pub results: Vec<LabTestResult>,
    /// Additional notes from lab technician
    pub notes: Option<String>,
    /// Lab technician who submitted
    pub submitted_by: String,
    /// Submission timestamp
    pub submitted_at: DateTime<Utc>,
    /// Current status
    pub status: LabResultStatus,
    /// Doctor who reviewed (if reviewed)
    pub reviewed_by: Option<String>,
    /// Review timestamp
    pub reviewed_at: Option<DateTime<Utc>>,
    /// Rejection reason (if rejected)
    pub rejection_reason: Option<String>,
    /// IPFS content hash (set after approval and upload)
    pub content_hash: Option<String>,
    /// IPFS metadata hash (set after approval and upload)
    pub metadata_hash: Option<String>,
}

/// Request to submit lab results
#[derive(Debug, Deserialize)]
pub struct SubmitLabResultRequest {
    pub patient_id: String,
    pub test_name: String,
    pub test_category: String,
    pub results: Vec<LabTestResult>,
    pub notes: Option<String>,
}

/// Response for lab result submission
#[derive(Debug, Serialize)]
pub struct SubmitLabResultResponse {
    pub success: bool,
    pub submission_id: String,
    pub message: String,
}

/// Request to review (approve/reject) lab results
#[derive(Debug, Deserialize)]
pub struct ReviewLabResultRequest {
    pub submission_id: String,
    pub action: String, // "approve" or "reject"
    pub rejection_reason: Option<String>,
}

/// Response for lab result review
#[derive(Debug, Serialize)]
pub struct ReviewLabResultResponse {
    pub success: bool,
    pub submission_id: String,
    pub new_status: String,
    pub message: String,
}

/// Response for pending lab results list
#[derive(Debug, Serialize)]
pub struct PendingLabResultsResponse {
    pub submissions: Vec<LabResultSubmission>,
    pub total: usize,
}

