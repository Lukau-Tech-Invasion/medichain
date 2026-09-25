//! Shared test fixtures: a registered user and a patient on record.
//!
//! Handler tests keep needing the same two things -- somebody signed in with a
//! role, and a patient the record can be about -- and each module had grown
//! its own copy of the 30-field profile literal. New tests use these.

use crate::AppState;

/// A registered, active user with `role`, keyed by `wallet`.
pub fn staff(wallet: &str, role: crate::Role) -> crate::User {
    crate::User {
        wallet_address: wallet.to_string(),
        username: Some(wallet.to_string()),
        name: format!("Test {wallet}"),
        role,
        created_at: chrono::Utc::now(),
        created_by: None,
        linked_patient_id: None,
        email: None,
        phone: None,
        department: None,
        specialty: None,
        license_number: None,
        status: "active".to_string(),
        last_login: None,
    }
}

/// Put a user in the session cache the handlers resolve callers from.
pub fn register(state: &AppState, wallet: &str, role: crate::Role) {
    state
        .users
        .write()
        .unwrap()
        .insert(wallet.to_string(), staff(wallet, role));
}

/// A minimal, complete patient profile.
pub fn patient_profile(id: &str, name: &str) -> crate::PatientProfile {
    let now = chrono::Utc::now();
    crate::PatientProfile {
        patient_id: id.to_string(),
        full_name: name.to_string(),
        date_of_birth: "1980-01-01".to_string(),
        time_of_birth: None,
        national_id: format!("NID-{id}"),
        gender: None,
        phone: "+27000000000".to_string(),
        emergency_info: crate::EmergencyInfo {
            patient_id: id.to_string(),
            blood_type: crate::BloodType::OPositive,
            allergies: Vec::new(),
            current_medications: Vec::new(),
            chronic_conditions: Vec::new(),
            emergency_contacts: Vec::new(),
            organ_donor: false,
            dnr_status: false,
            dnr_verified_by: None,
            dnr_verified_at: None,
            dnr_document_ref: None,
            languages: vec!["en".to_string()],
            last_updated: now,
        },
        address: None,
        insurance: None,
        primary_doctor: None,
        community_health_worker: None,
        preferences: crate::PatientPreferences::default(),
        advanced_directives: Vec::new(),
        family_notifications: None,
        created_at: now,
        last_updated: now,
    }
}

/// Store a patient so records can refer to them.
pub async fn seed_patient(state: &AppState, id: &str) {
    state
        .repositories
        .patients
        .create(crate::patient_profile_to_entity(
            &patient_profile(id, "Test Patient"),
            &state.encryption_keyring,
        ))
        .await
        .expect("seed patient");
}
