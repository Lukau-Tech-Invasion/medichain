//! # NFC Card Simulation Module
//!
//! Simulates NFC card functionality for MediChain emergency access.
//! In production, this would interface with actual NFC hardware.
//!
//! © 2025 Trustware. All rights reserved.

use serde::{Deserialize, Serialize};
use sha3::{Digest, Sha3_256};
use std::collections::HashMap;
use std::sync::RwLock;
use uuid::Uuid;

// ============================================================================
// CONSTANTS
// ============================================================================

/// Maximum number of cards that can be stored in the registry
pub const MAX_CARDS: usize = 10_000;

/// Card ID prefix for MediChain cards
pub const CARD_PREFIX: &str = "MC";

// ============================================================================
// CORE TYPES
// ============================================================================

/// Represents a simulated NFC card for a patient
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NFCCard {
    /// Unique card identifier (UUID v4)
    pub card_id: String,

    /// Patient's blockchain/system ID (e.g., "MCHI-1234-5678")
    pub patient_id: String,

    /// SHA3-256 hash of card_id + patient_id for verification
    pub card_hash: String,

    /// National ID type used for this patient
    pub national_id_type: NationalIdType,

    /// Card status
    pub status: CardStatus,

    /// Unix timestamp when card was created
    pub created_at: u64,

    /// Unix timestamp when card was last used
    pub last_used_at: Option<u64>,
}

/// National ID types supported by MediChain
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NationalIdType {
    /// Ethiopia Fayda ID
    FaydaId,
    /// Ghana Card
    GhanaCard,
    /// Nigeria National Identification Number
    NigeriaNIN,
    /// South Africa Smart ID
    SouthAfricaSmartId,
    /// Kenya Huduma Namba
    KenyaHuduma,
    /// Generic/Other
    Other,
}

impl NationalIdType {
    /// Returns the country code for this ID type
    pub fn country_code(&self) -> &'static str {
        match self {
            NationalIdType::FaydaId => "ETH",
            NationalIdType::GhanaCard => "GHA",
            NationalIdType::NigeriaNIN => "NGA",
            NationalIdType::SouthAfricaSmartId => "ZAF",
            NationalIdType::KenyaHuduma => "KEN",
            NationalIdType::Other => "XXX",
        }
    }

    /// Returns a display name for this ID type
    pub fn display_name(&self) -> &'static str {
        match self {
            NationalIdType::FaydaId => "Fayda ID (Ethiopia)",
            NationalIdType::GhanaCard => "Ghana Card",
            NationalIdType::NigeriaNIN => "NIN (Nigeria)",
            NationalIdType::SouthAfricaSmartId => "Smart ID (South Africa)",
            NationalIdType::KenyaHuduma => "Huduma Namba (Kenya)",
            NationalIdType::Other => "Other ID",
        }
    }
}

impl std::fmt::Display for NationalIdType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.display_name())
    }
}

/// Card status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CardStatus {
    /// Card is active and can be used
    Active,
    /// Card is suspended (e.g., reported stolen)
    Suspended,
    /// Card has been revoked
    Revoked,
    /// Card has expired
    Expired,
}

impl std::fmt::Display for CardStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CardStatus::Active => write!(f, "Active"),
            CardStatus::Suspended => write!(f, "Suspended"),
            CardStatus::Revoked => write!(f, "Revoked"),
            CardStatus::Expired => write!(f, "Expired"),
        }
    }
}

/// Result of an NFC card tap
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TapResult {
    /// Whether the tap was successful
    pub success: bool,

    /// Card hash for verification
    pub card_hash: String,

    /// Patient ID retrieved from card
    pub patient_id: String,

    /// Unix timestamp of the tap
    pub timestamp: u64,

    /// Error message if tap failed
    pub error: Option<String>,
}

/// Data encoded in a QR code for fallback access
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QRCodeData {
    /// Patient ID
    pub patient_id: String,

    /// Card hash for verification
    pub card_hash: String,

    /// Expiration timestamp (QR codes expire after 24 hours)
    pub expires_at: u64,

    /// Version of the QR code format
    pub version: u8,
}

// ============================================================================
// NFC CARD IMPLEMENTATION
// ============================================================================

impl NFCCard {
    /// Generate a new NFC card for a patient
    pub fn new(patient_id: String, national_id_type: NationalIdType) -> Self {
        let card_id = format!("{}-{}", CARD_PREFIX, Uuid::new_v4());
        let card_hash = Self::generate_hash(&card_id, &patient_id);
        let now = chrono::Utc::now().timestamp() as u64;

        NFCCard {
            card_id,
            patient_id,
            card_hash,
            national_id_type,
            status: CardStatus::Active,
            created_at: now,
            last_used_at: None,
        }
    }

    /// Generate a SHA3-256 hash from card ID and patient ID
    fn generate_hash(card_id: &str, patient_id: &str) -> String {
        let mut hasher = Sha3_256::new();
        hasher.update(card_id.as_bytes());
        hasher.update(b":");
        hasher.update(patient_id.as_bytes());
        hex::encode(hasher.finalize())
    }

    /// Verify the card hash is valid
    pub fn verify_hash(&self) -> bool {
        let expected = Self::generate_hash(&self.card_id, &self.patient_id);
        self.card_hash == expected
    }

    /// Simulate an NFC tap
    pub fn tap(&mut self) -> TapResult {
        let timestamp = chrono::Utc::now().timestamp() as u64;

        // Check card status
        if self.status != CardStatus::Active {
            return TapResult {
                success: false,
                card_hash: self.card_hash.clone(),
                patient_id: String::new(),
                timestamp,
                error: Some(format!("Card is {}", self.status)),
            };
        }

        // Verify hash integrity
        if !self.verify_hash() {
            return TapResult {
                success: false,
                card_hash: self.card_hash.clone(),
                patient_id: String::new(),
                timestamp,
                error: Some("Card hash verification failed".to_string()),
            };
        }

        // Update last used timestamp
        self.last_used_at = Some(timestamp);

        TapResult {
            success: true,
            card_hash: self.card_hash.clone(),
            patient_id: self.patient_id.clone(),
            timestamp,
            error: None,
        }
    }

    /// Generate QR code data for this card
    pub fn generate_qr_data(&self) -> QRCodeData {
        let now = chrono::Utc::now().timestamp() as u64;
        let expires_at = now + (24 * 60 * 60); // 24 hours

        QRCodeData {
            patient_id: self.patient_id.clone(),
            card_hash: self.card_hash.clone(),
            expires_at,
            version: 1,
        }
    }

    /// Suspend the card (e.g., if reported stolen)
    pub fn suspend(&mut self) {
        self.status = CardStatus::Suspended;
    }

    /// Reactivate a suspended card
    pub fn reactivate(&mut self) -> Result<(), &'static str> {
        match self.status {
            CardStatus::Suspended => {
                self.status = CardStatus::Active;
                Ok(())
            }
            CardStatus::Revoked => Err("Cannot reactivate a revoked card"),
            CardStatus::Expired => Err("Cannot reactivate an expired card"),
            CardStatus::Active => Err("Card is already active"),
        }
    }

    /// Permanently revoke the card
    pub fn revoke(&mut self) {
        self.status = CardStatus::Revoked;
    }
}

// ============================================================================
// QR CODE GENERATION
// ============================================================================

impl QRCodeData {
    /// Encode QR data to a JSON string
    pub fn encode(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    /// Decode QR data from a JSON string
    pub fn decode(data: &str) -> Result<Self, String> {
        serde_json::from_str(data).map_err(|e| format!("Invalid QR data: {}", e))
    }

    /// Check if the QR code has expired
    pub fn is_expired(&self) -> bool {
        let now = chrono::Utc::now().timestamp() as u64;
        now > self.expires_at
    }

    /// Verify QR code against a card hash
    pub fn verify(&self, card_hash: &str) -> bool {
        !self.is_expired() && self.card_hash == card_hash
    }
}

/// Generate a QR code image as base64-encoded PNG
pub fn generate_qr_image(data: &QRCodeData) -> Result<String, String> {
    use image::Luma;
    use qrcode::QrCode;

    let json_data = data.encode();

    let code = QrCode::new(json_data.as_bytes())
        .map_err(|e| format!("Failed to create QR code: {}", e))?;

    let image = code.render::<Luma<u8>>().build();

    let mut buffer = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buffer);

    image::DynamicImage::ImageLuma8(image)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode QR image: {}", e))?;

    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &buffer,
    ))
}

// ============================================================================
// CARD REGISTRY (In-Memory Storage for Demo)
// ============================================================================

/// In-memory registry of NFC cards for demo purposes
pub struct CardRegistry {
    cards: RwLock<HashMap<String, NFCCard>>,
    patient_to_card: RwLock<HashMap<String, String>>,
}

impl CardRegistry {
    /// Create a new empty registry
    pub fn new() -> Self {
        CardRegistry {
            cards: RwLock::new(HashMap::new()),
            patient_to_card: RwLock::new(HashMap::new()),
        }
    }

    /// Register a new card
    pub fn register_card(&self, card: NFCCard) -> Result<(), String> {
        let mut cards = self.cards.write().map_err(|_| "Lock poisoned")?;
        let mut patient_to_card = self.patient_to_card.write().map_err(|_| "Lock poisoned")?;

        if cards.len() >= MAX_CARDS {
            return Err("Card registry is full".to_string());
        }

        if patient_to_card.contains_key(&card.patient_id) {
            return Err("Patient already has a card".to_string());
        }

        patient_to_card.insert(card.patient_id.clone(), card.card_hash.clone());
        cards.insert(card.card_hash.clone(), card);

        Ok(())
    }

    /// Get a card by its hash
    pub fn get_card(&self, card_hash: &str) -> Option<NFCCard> {
        let cards = self.cards.read().ok()?;
        cards.get(card_hash).cloned()
    }

    /// Get a card by patient ID
    pub fn get_card_by_patient(&self, patient_id: &str) -> Option<NFCCard> {
        let patient_to_card = self.patient_to_card.read().ok()?;
        let card_hash = patient_to_card.get(patient_id)?;
        self.get_card(card_hash)
    }

    /// Simulate an NFC tap by card hash
    pub fn tap_card(&self, card_hash: &str) -> Result<TapResult, String> {
        let mut cards = self.cards.write().map_err(|_| "Lock poisoned")?;

        let card = cards
            .get_mut(card_hash)
            .ok_or_else(|| "Card not found".to_string())?;

        Ok(card.tap())
    }

    /// Suspend a card
    pub fn suspend_card(&self, card_hash: &str) -> Result<(), String> {
        let mut cards = self.cards.write().map_err(|_| "Lock poisoned")?;

        let card = cards
            .get_mut(card_hash)
            .ok_or_else(|| "Card not found".to_string())?;

        card.suspend();
        Ok(())
    }

    /// Get total number of cards
    pub fn card_count(&self) -> usize {
        self.cards.read().map(|c| c.len()).unwrap_or(0)
    }

    /// List all cards (for admin purposes)
    pub fn list_cards(&self) -> Vec<NFCCard> {
        self.cards
            .read()
            .map(|c| c.values().cloned().collect())
            .unwrap_or_default()
    }
}

impl Default for CardRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nfc_card_creation() {
        let patient_id = "MCHI-1234-5678".to_string();
        let card = NFCCard::new(patient_id.clone(), NationalIdType::FaydaId);

        assert_eq!(card.patient_id, patient_id);
        assert!(card.card_id.starts_with("MC-"));
        assert!(!card.card_hash.is_empty());
        assert_eq!(card.status, CardStatus::Active);
        assert!(card.verify_hash());
    }

    #[test]
    fn test_nfc_tap_success() {
        let mut card = NFCCard::new("test-patient".to_string(), NationalIdType::GhanaCard);
        let result = card.tap();

        assert!(result.success);
        assert_eq!(result.patient_id, "test-patient");
        assert!(result.error.is_none());
        assert!(card.last_used_at.is_some());
    }

    #[test]
    fn test_nfc_tap_suspended_card() {
        let mut card = NFCCard::new("test-patient".to_string(), NationalIdType::NigeriaNIN);
        card.suspend();

        let result = card.tap();

        assert!(!result.success);
        assert!(result.error.is_some());
        assert!(result.error.unwrap().contains("Suspended"));
    }

    #[test]
    fn test_card_hash_verification() {
        let card = NFCCard::new("patient-123".to_string(), NationalIdType::FaydaId);
        assert!(card.verify_hash());

        // Tampered card should fail verification
        let mut tampered = card.clone();
        tampered.patient_id = "different-patient".to_string();
        assert!(!tampered.verify_hash());
    }

    #[test]
    fn test_qr_code_data() {
        let card = NFCCard::new("patient-456".to_string(), NationalIdType::KenyaHuduma);
        let qr_data = card.generate_qr_data();

        assert_eq!(qr_data.patient_id, "patient-456");
        assert_eq!(qr_data.card_hash, card.card_hash);
        assert!(!qr_data.is_expired());
        assert!(qr_data.verify(&card.card_hash));
    }

    #[test]
    fn test_qr_code_encode_decode() {
        let qr_data = QRCodeData {
            patient_id: "test-patient".to_string(),
            card_hash: "abc123".to_string(),
            expires_at: chrono::Utc::now().timestamp() as u64 + 3600,
            version: 1,
        };

        let encoded = qr_data.encode();
        let decoded = QRCodeData::decode(&encoded).unwrap();

        assert_eq!(decoded.patient_id, qr_data.patient_id);
        assert_eq!(decoded.card_hash, qr_data.card_hash);
    }

    #[test]
    fn test_card_registry() {
        let registry = CardRegistry::new();
        let card = NFCCard::new(
            "patient-789".to_string(),
            NationalIdType::SouthAfricaSmartId,
        );
        let card_hash = card.card_hash.clone();

        registry.register_card(card).unwrap();

        assert_eq!(registry.card_count(), 1);

        let retrieved = registry.get_card(&card_hash);
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().patient_id, "patient-789");
    }

    #[test]
    fn test_registry_duplicate_patient() {
        let registry = CardRegistry::new();
        let card1 = NFCCard::new("same-patient".to_string(), NationalIdType::FaydaId);
        let card2 = NFCCard::new("same-patient".to_string(), NationalIdType::FaydaId);

        registry.register_card(card1).unwrap();
        let result = registry.register_card(card2);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already has a card"));
    }

    #[test]
    fn test_card_suspend_and_reactivate() {
        let mut card = NFCCard::new("patient-abc".to_string(), NationalIdType::GhanaCard);

        // Suspend
        card.suspend();
        assert_eq!(card.status, CardStatus::Suspended);

        // Tap should fail
        let result = card.tap();
        assert!(!result.success);

        // Reactivate
        card.reactivate().unwrap();
        assert_eq!(card.status, CardStatus::Active);

        // Tap should succeed
        let result = card.tap();
        assert!(result.success);
    }

    #[test]
    fn test_national_id_types() {
        assert_eq!(NationalIdType::FaydaId.country_code(), "ETH");
        assert_eq!(NationalIdType::GhanaCard.country_code(), "GHA");
        assert_eq!(NationalIdType::NigeriaNIN.country_code(), "NGA");

        assert!(NationalIdType::FaydaId.display_name().contains("Ethiopia"));
    }

    #[test]
    fn test_qr_image_generation() {
        let qr_data = QRCodeData {
            patient_id: "test".to_string(),
            card_hash: "hash123".to_string(),
            expires_at: chrono::Utc::now().timestamp() as u64 + 3600,
            version: 1,
        };

        let result = generate_qr_image(&qr_data);
        assert!(result.is_ok());

        let base64_image = result.unwrap();
        assert!(!base64_image.is_empty());
        // Should be valid base64
        assert!(
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &base64_image)
                .is_ok()
        );
    }
}
