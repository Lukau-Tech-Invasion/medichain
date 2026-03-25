//! # National ID Verification Module
//!
//! Provides trait-based national ID verification with per-country implementations.
//! Falls back to a stub verifier (SHA3-256 based) when no real API key is configured.
//!
//! ## Supported Countries
//! - Ethiopia — Fayda ID (`FAYDA_API_KEY` / `FAYDA_API_URL`)
//! - Ghana — Ghana Card (`GHANA_CARD_API_KEY` / `GHANA_CARD_API_URL`)
//! - Nigeria — NIN (`NIN_API_KEY` / `NIN_API_URL`)
//! - South Africa — Smart ID (`SMARTID_API_KEY` / `SMARTID_API_URL`)
//! - Kenya — Huduma Namba (`HUDUMA_API_KEY` / `HUDUMA_API_URL`)
//!
//! © 2025 Trustware. All rights reserved.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha3::{Digest, Sha3_256};
use thiserror::Error;

// ============================================================================
// Core Types
// ============================================================================

/// Country identifier for national ID routing
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Country {
    /// Ethiopia — Fayda ID
    Ethiopia,
    /// Ghana — Ghana Card
    Ghana,
    /// Nigeria — NIN
    Nigeria,
    /// South Africa — Smart ID
    SouthAfrica,
    /// Kenya — Huduma Namba
    Kenya,
    /// Unrecognised country
    Unknown,
}

impl Country {
    /// Parse from a string (case-insensitive)
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "ethiopia" | "eth" => Country::Ethiopia,
            "ghana" | "gha" => Country::Ghana,
            "nigeria" | "nga" | "nigeria_nin" | "nin" => Country::Nigeria,
            "southafrica" | "south_africa" | "zaf" | "south africa" => Country::SouthAfrica,
            "kenya" | "ken" => Country::Kenya,
            _ => Country::Unknown,
        }
    }

    /// Human-readable name for the ID type used in this country
    pub fn id_type_name(&self) -> &'static str {
        match self {
            Country::Ethiopia => "Fayda ID",
            Country::Ghana => "Ghana Card",
            Country::Nigeria => "NIN (National Identification Number)",
            Country::SouthAfrica => "Smart ID",
            Country::Kenya => "Huduma Namba",
            Country::Unknown => "National ID",
        }
    }
}

impl std::fmt::Display for Country {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Country::Ethiopia => write!(f, "Ethiopia"),
            Country::Ghana => write!(f, "Ghana"),
            Country::Nigeria => write!(f, "Nigeria"),
            Country::SouthAfrica => write!(f, "SouthAfrica"),
            Country::Kenya => write!(f, "Kenya"),
            Country::Unknown => write!(f, "Unknown"),
        }
    }
}

/// Result of a national ID verification attempt
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationResult {
    /// Whether the ID was successfully verified
    pub verified: bool,
    /// Country the ID belongs to
    pub country: Country,
    /// The ID number that was checked
    pub id_number: String,
    /// Full name of the ID holder (if returned by the authority)
    pub full_name: Option<String>,
    /// Date of birth in ISO-8601 format (if returned by the authority)
    pub date_of_birth: Option<String>,
    /// Error message if verification failed
    pub error: Option<String>,
}

/// Errors that can occur during national ID verification
#[derive(Debug, Error)]
pub enum NationalIdError {
    #[error("HTTP request failed: {0}")]
    HttpError(#[from] reqwest::Error),

    #[error("Invalid response from government API: {0}")]
    InvalidResponse(String),

    #[error("Country not supported: {0}")]
    UnsupportedCountry(String),

    #[error("Verification service unavailable")]
    ServiceUnavailable,
}

// ============================================================================
// Verifier Trait
// ============================================================================

/// Trait implemented by every per-country verifier
#[async_trait]
pub trait NationalIdVerifier: Send + Sync {
    /// Attempt to verify the supplied ID number.
    async fn verify(
        &self,
        id: &str,
        country: &Country,
    ) -> Result<VerificationResult, NationalIdError>;

    /// The country this verifier handles.
    fn supported_country(&self) -> Country;
}

// ============================================================================
// Stub Verifier (SHA3-256 based — used when no API key is configured)
// ============================================================================

/// Stub verifier that deterministically "verifies" IDs using SHA3-256.
/// The result is reproducible: the same ID always returns the same synthetic
/// full_name and date_of_birth, which is useful for integration tests.
pub struct StubVerifier {
    pub country: Country,
}

impl StubVerifier {
    pub fn new(country: Country) -> Self {
        StubVerifier { country }
    }

    /// Derive synthetic personal details from the ID's hash bytes so that
    /// the stub behaves deterministically without requiring a real API call.
    fn derive_details(id: &str) -> (String, String) {
        let hash = Sha3_256::digest(id.as_bytes());
        let bytes = hash.as_slice();

        // Use specific bytes to build a reproducible fake name
        let first_names = ["Amara", "Kofi", "Emeka", "Siya", "Wanjiru"];
        let last_names = ["Tesfaye", "Mensah", "Okafor", "Dlamini", "Kamau"];
        let first = first_names[(bytes[0] as usize) % first_names.len()];
        let last = last_names[(bytes[1] as usize) % last_names.len()];
        let full_name = format!("{} {}", first, last);

        // Build a deterministic date-of-birth between 1950 and 2005
        let year = 1950 + (bytes[2] as u16 % 55);
        let month = 1 + (bytes[3] % 12);
        let day = 1 + (bytes[4] % 28);
        let dob = format!("{:04}-{:02}-{:02}", year, month, day);

        (full_name, dob)
    }
}

#[async_trait]
impl NationalIdVerifier for StubVerifier {
    async fn verify(
        &self,
        id: &str,
        country: &Country,
    ) -> Result<VerificationResult, NationalIdError> {
        if id.trim().is_empty() {
            return Ok(VerificationResult {
                verified: false,
                country: country.clone(),
                id_number: id.to_string(),
                full_name: None,
                date_of_birth: None,
                error: Some("ID number cannot be empty".to_string()),
            });
        }

        // Stub: treat any non-empty ID as valid
        let (full_name, dob) = Self::derive_details(id);
        Ok(VerificationResult {
            verified: true,
            country: country.clone(),
            id_number: id.to_string(),
            full_name: Some(full_name),
            date_of_birth: Some(dob),
            error: None,
        })
    }

    fn supported_country(&self) -> Country {
        self.country.clone()
    }
}

// ============================================================================
// Per-Country Real Verifiers
// ============================================================================

/// Generic HTTP-based verifier for a specific country's government API.
/// If the configured API key env var is absent the verifier falls back to
/// `StubVerifier`.
struct HttpVerifier {
    country: Country,
    /// Env var name for the API key
    api_key_env: &'static str,
    /// Env var name for a configurable base URL (optional — has a default)
    api_url_env: &'static str,
    /// Default base URL if the env var is not set
    default_api_url: &'static str,
}

impl HttpVerifier {
    fn new(
        country: Country,
        api_key_env: &'static str,
        api_url_env: &'static str,
        default_api_url: &'static str,
    ) -> Self {
        HttpVerifier {
            country,
            api_key_env,
            api_url_env,
            default_api_url,
        }
    }

    fn api_key(&self) -> Option<String> {
        std::env::var(self.api_key_env).ok()
    }

    fn api_url(&self) -> String {
        std::env::var(self.api_url_env).unwrap_or_else(|_| self.default_api_url.to_string())
    }
}

#[async_trait]
impl NationalIdVerifier for HttpVerifier {
    async fn verify(
        &self,
        id: &str,
        country: &Country,
    ) -> Result<VerificationResult, NationalIdError> {
        let api_key = match self.api_key() {
            Some(k) => k,
            None => {
                // Fall back to stub when no API key is configured
                log::debug!(
                    "No API key for {} (env var {}); using stub verifier",
                    self.country,
                    self.api_key_env
                );
                let stub = StubVerifier::new(self.country.clone());
                return stub.verify(id, country).await;
            }
        };

        let url = self.api_url();
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(NationalIdError::HttpError)?;

        let body = serde_json::json!({
            "id_number": id,
            "country": country.to_string(),
        });

        let response = client
            .post(&url)
            .bearer_auth(&api_key)
            .json(&body)
            .send()
            .await
            .map_err(NationalIdError::HttpError)?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Ok(VerificationResult {
                verified: false,
                country: country.clone(),
                id_number: id.to_string(),
                full_name: None,
                date_of_birth: None,
                error: Some(format!("API returned status {}: {}", status, text)),
            });
        }

        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| NationalIdError::InvalidResponse(e.to_string()))?;

        let verified = json
            .get("verified")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let full_name = json
            .get("full_name")
            .or_else(|| json.get("name"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let date_of_birth = json
            .get("date_of_birth")
            .or_else(|| json.get("dob"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let error = if verified {
            None
        } else {
            json.get("error")
                .or_else(|| json.get("message"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| Some("Verification failed".to_string()))
        };

        Ok(VerificationResult {
            verified,
            country: country.clone(),
            id_number: id.to_string(),
            full_name,
            date_of_birth,
            error,
        })
    }

    fn supported_country(&self) -> Country {
        self.country.clone()
    }
}

// ============================================================================
// NationalIdService — routes to the right verifier by country
// ============================================================================

/// Routes verification requests to the appropriate per-country verifier.
/// Constructed once at startup and stored in `AppState`.
pub struct NationalIdService {
    verifiers: Vec<Box<dyn NationalIdVerifier>>,
}

impl NationalIdService {
    /// Build the service, wiring up all supported country verifiers.
    pub fn new() -> Self {
        let verifiers: Vec<Box<dyn NationalIdVerifier>> = vec![
            Box::new(HttpVerifier::new(
                Country::Ethiopia,
                "FAYDA_API_KEY",
                "FAYDA_API_URL",
                "https://api.fayda.et/v1/verify",
            )),
            Box::new(HttpVerifier::new(
                Country::Ghana,
                "GHANA_CARD_API_KEY",
                "GHANA_CARD_API_URL",
                "https://api.ghanacard.gov.gh/v1/verify",
            )),
            Box::new(HttpVerifier::new(
                Country::Nigeria,
                "NIN_API_KEY",
                "NIN_API_URL",
                "https://api.nimc.gov.ng/v1/nin/verify",
            )),
            Box::new(HttpVerifier::new(
                Country::SouthAfrica,
                "SMARTID_API_KEY",
                "SMARTID_API_URL",
                "https://api.dha.gov.za/v1/smartid/verify",
            )),
            Box::new(HttpVerifier::new(
                Country::Kenya,
                "HUDUMA_API_KEY",
                "HUDUMA_API_URL",
                "https://api.iprs.go.ke/v1/huduma/verify",
            )),
        ];

        NationalIdService { verifiers }
    }

    /// Verify a national ID number for the given country.
    pub async fn verify(
        &self,
        id: &str,
        country: &Country,
    ) -> Result<VerificationResult, NationalIdError> {
        if *country == Country::Unknown {
            return Err(NationalIdError::UnsupportedCountry(country.to_string()));
        }

        let verifier = self
            .verifiers
            .iter()
            .find(|v| v.supported_country() == *country);

        match verifier {
            Some(v) => v.verify(id, country).await,
            None => {
                // Fallback to stub for any country that has no registered verifier
                let stub = StubVerifier::new(country.clone());
                stub.verify(id, country).await
            }
        }
    }
}

impl Default for NationalIdService {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// HTTP Request / Response types (used by the endpoint handler in main.rs)
// ============================================================================

/// Request body for `POST /api/national-id/verify`
#[derive(Debug, Deserialize)]
pub struct VerifyIdRequest {
    pub id_number: String,
    pub country: String,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_stub_verifier_returns_verified() {
        let verifier = StubVerifier::new(Country::Ethiopia);
        let result = verifier
            .verify("FAN123456", &Country::Ethiopia)
            .await
            .unwrap();
        assert!(result.verified);
        assert!(result.full_name.is_some());
        assert!(result.date_of_birth.is_some());
        assert!(result.error.is_none());
    }

    #[tokio::test]
    async fn test_stub_verifier_rejects_empty_id() {
        let verifier = StubVerifier::new(Country::Ghana);
        let result = verifier.verify("", &Country::Ghana).await.unwrap();
        assert!(!result.verified);
        assert!(result.error.is_some());
    }

    #[tokio::test]
    async fn test_stub_verifier_deterministic() {
        let verifier = StubVerifier::new(Country::Nigeria);
        let r1 = verifier
            .verify("NIN9876543210", &Country::Nigeria)
            .await
            .unwrap();
        let r2 = verifier
            .verify("NIN9876543210", &Country::Nigeria)
            .await
            .unwrap();
        assert_eq!(r1.full_name, r2.full_name);
        assert_eq!(r1.date_of_birth, r2.date_of_birth);
    }

    #[test]
    fn test_country_from_str() {
        assert_eq!(Country::from_str("Ethiopia"), Country::Ethiopia);
        assert_eq!(Country::from_str("ghana"), Country::Ghana);
        assert_eq!(Country::from_str("NGA"), Country::Nigeria);
        assert_eq!(Country::from_str("SouthAfrica"), Country::SouthAfrica);
        assert_eq!(Country::from_str("Kenya"), Country::Kenya);
        assert_eq!(Country::from_str("mars"), Country::Unknown);
    }

    #[tokio::test]
    async fn test_service_unknown_country_error() {
        let service = NationalIdService::new();
        let result = service.verify("X123", &Country::Unknown).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_service_falls_back_to_stub_without_api_key() {
        // Ensure the env var is absent
        std::env::remove_var("FAYDA_API_KEY");
        let service = NationalIdService::new();
        let result = service
            .verify("FAN-TEST-001", &Country::Ethiopia)
            .await
            .unwrap();
        // Stub always verifies non-empty IDs
        assert!(result.verified);
    }
}
