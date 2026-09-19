//! Backfill of the patient-name blind index (ADR-0009).
//!
//! `patients.name_search_tokens` is written whenever a profile is saved, but
//! the column arrived empty for every patient registered before it, and SQL
//! cannot fill it: the name is sealed under the application keyring. Until
//! something re-derives those tokens, a patient registered last month is found
//! by health ID and not by name — and name search then answers "no such
//! patient", which reads as a fact.
//!
//! This pass runs once at startup. It pages through rows with an empty index in
//! id order, decrypts each profile with the keyring, and stores only the keyed
//! tokens. It is idempotent (indexed rows no longer match), bounded, and never
//! logs a name.

use crate::encryption_keyring::EncryptionKeyring;
use crate::repositories::traits::{PatientEntity, PatientRepository, RepositoryResult};

/// Rows fetched per page.
pub const BACKFILL_BATCH: u32 = 200;

/// Upper bound on pages in one run: two million patients. A register larger
/// than that is finished by the next start rather than by an unbounded loop.
pub const MAX_BACKFILL_BATCHES: usize = 10_000;

/// What one run did, as counts only.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct BackfillReport {
    pub indexed: u64,
    /// Rows whose profile this keyring cannot open. They are equally absent
    /// from the roster; listed so the gap is visible rather than silent.
    pub undecryptable: u64,
    /// Rows whose name has no alphanumeric word to index.
    pub nameless: u64,
}

/// Fill in name tokens for every patient that has none.
pub async fn backfill_missing_name_index(
    patients: &dyn PatientRepository,
    keyring: &EncryptionKeyring,
) -> RepositoryResult<BackfillReport> {
    let mut report = BackfillReport::default();
    let mut after_id: Option<String> = None;
    for _ in 0..MAX_BACKFILL_BATCHES {
        let batch = patients
            .list_unindexed_names(after_id.as_deref(), BACKFILL_BATCH)
            .await?;
        let Some(last) = batch.last() else {
            return Ok(report);
        };
        after_id = Some(last.id.clone());
        for patient in &batch {
            index_one(patients, keyring, patient, &mut report).await?;
        }
        if batch.len() < BACKFILL_BATCH as usize {
            return Ok(report);
        }
    }
    log::warn!(
        "patient name index backfill stopped at its bound of {} batches; the next start continues it",
        MAX_BACKFILL_BATCHES
    );
    Ok(report)
}

async fn index_one(
    patients: &dyn PatientRepository,
    keyring: &EncryptionKeyring,
    patient: &PatientEntity,
    report: &mut BackfillReport,
) -> RepositoryResult<()> {
    let Some(profile) = crate::patient_entity_to_profile(patient, keyring) else {
        report.undecryptable += 1;
        return Ok(());
    };
    let tokens = crate::support::patient_name_search_tokens(&profile.full_name);
    if tokens.is_empty() {
        report.nameless += 1;
        return Ok(());
    }
    patients
        .set_name_search_tokens(&patient.id, &tokens)
        .await?;
    report.indexed += 1;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::memory::MemoryPatientRepository;

    fn profile(id: &str, name: &str) -> crate::PatientProfile {
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

    /// A row as the migration left it: a sealed profile and no tokens.
    async fn legacy_row(
        repo: &MemoryPatientRepository,
        keyring: &EncryptionKeyring,
        id: &str,
        name: &str,
    ) {
        let mut entity = crate::patient_profile_to_entity(&profile(id, name), keyring);
        entity.name_search_tokens = Vec::new();
        repo.create(entity).await.unwrap();
    }

    #[tokio::test]
    async fn a_patient_registered_before_the_index_is_found_by_name_afterwards() {
        let keyring = EncryptionKeyring::ephemeral();
        let repo = MemoryPatientRepository::new();
        legacy_row(&repo, &keyring, "PAT-OLD-1", "Ama Mensah").await;
        assert_eq!(
            repo.search_keyset("Mensah", None, 10).await.unwrap().total,
            0
        );

        let report = backfill_missing_name_index(&repo, &keyring).await.unwrap();

        assert_eq!(report.indexed, 1);
        let found = repo.search_keyset("Ama Mensah", None, 10).await.unwrap();
        assert_eq!(found.items[0].id, "PAT-OLD-1");
    }

    #[tokio::test]
    async fn indexing_does_not_reorder_the_roster() {
        let keyring = EncryptionKeyring::ephemeral();
        let repo = MemoryPatientRepository::new();
        legacy_row(&repo, &keyring, "PAT-OLD-1", "Kofi Boateng").await;
        let before = repo.get_by_id("PAT-OLD-1").await.unwrap().updated_at;

        backfill_missing_name_index(&repo, &keyring).await.unwrap();

        assert_eq!(
            repo.get_by_id("PAT-OLD-1").await.unwrap().updated_at,
            before
        );
    }

    #[tokio::test]
    async fn a_second_run_finds_nothing_left_and_an_unreadable_row_is_counted() {
        let keyring = EncryptionKeyring::ephemeral();
        let repo = MemoryPatientRepository::new();
        legacy_row(&repo, &keyring, "PAT-OLD-1", "Ama Mensah").await;
        legacy_row(
            &repo,
            &EncryptionKeyring::ephemeral(),
            "PAT-OTHER",
            "Esi Owusu",
        )
        .await;

        let first = backfill_missing_name_index(&repo, &keyring).await.unwrap();
        let second = backfill_missing_name_index(&repo, &keyring).await.unwrap();

        assert_eq!((first.indexed, first.undecryptable), (1, 1));
        assert_eq!((second.indexed, second.undecryptable), (0, 1));
    }
}
