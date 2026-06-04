//! PostgreSQL repository integration tests.

#[cfg(test)]
mod tests {
    use crate::db;
    use crate::repositories::postgres::{
        PgAllergyRepository, PgMedicalRecordRepository, PgPatientRepository,
    };
    use crate::repositories::{
        AllergyEntity, AllergyRepository, MedicalRecordEntity, MedicalRecordRepository, Pagination,
        PatientEntity, PatientRepository,
    };
    use chrono::Utc;
    use sqlx::PgPool;
    use std::env;

    async fn get_test_pool() -> PgPool {
        dotenvy::dotenv().ok();
        let database_url = env::var("DATABASE_URL").unwrap_or_else(|_| {
            "postgres://medichain:medichain_dev_2024@localhost:5432/medichain".to_string()
        });

        db::create_pool(&database_url)
            .await
            .expect("Failed to create test database pool")
    }

    fn create_test_patient(id: &str) -> PatientEntity {
        PatientEntity {
            id: id.to_string(),
            health_id: format!("HID-{}", id),
            national_id_hash: format!("hash-{}", id),
            national_id_type: "FaydaID".to_string(),
            first_name_encrypted: None,
            last_name_encrypted: None,
            date_of_birth_encrypted: None,
            gender: Some("Male".to_string()),
            blood_type: Some("O+".to_string()),
            phone_encrypted: None,
            email_encrypted: None,
            address_encrypted: None,
            emergency_contact_name_encrypted: None,
            emergency_contact_phone_encrypted: None,
            emergency_contact_relationship: None,
            organ_donor: false,
            dnr_status: false,
            primary_provider_id: None,
            wallet_address: Some(format!("0x{}", id)),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            registered_by: None,
            is_verified: false,
            is_active: true,
            profile_extras_encrypted: None,
        }
    }

    #[tokio::test]
    async fn test_pg_patient_repository() {
        let pool = get_test_pool().await;
        let repo = PgPatientRepository::new(pool.clone());

        let patient_id = format!("TEST-PAT-{}", Utc::now().timestamp_millis());
        let patient = create_test_patient(&patient_id);

        // Test Create
        let created = repo
            .create(patient)
            .await
            .expect("Failed to create patient");
        assert_eq!(created.id, patient_id);

        // Test Get by ID
        let fetched = repo
            .get_by_id(&patient_id)
            .await
            .expect("Failed to get patient by ID");
        assert_eq!(fetched.health_id, format!("HID-{}", patient_id));

        // Test Get by Wallet
        let fetched_wallet = repo
            .get_by_wallet(&format!("0x{}", patient_id))
            .await
            .expect("Failed to get by wallet");
        assert_eq!(fetched_wallet.id, patient_id);

        // Test Update
        let mut updated_patient = fetched.clone();
        updated_patient.blood_type = Some("A-".to_string());
        let updated = repo
            .update(updated_patient)
            .await
            .expect("Failed to update patient");
        assert_eq!(updated.blood_type, Some("A-".to_string()));

        // Test List
        let list = repo
            .list(Pagination::new(0, 10))
            .await
            .expect("Failed to list patients");
        assert!(list.total >= 1);
        assert!(list.items.iter().any(|p| p.id == patient_id));

        // Test Search
        let search_results = repo
            .search(&patient_id, Pagination::new(0, 10))
            .await
            .expect("Failed to search");
        assert_eq!(search_results.total, 1);
        assert_eq!(search_results.items[0].id, patient_id);

        // Test Delete (Soft Delete)
        repo.delete(&patient_id)
            .await
            .expect("Failed to delete patient");

        // Should NOT be found by get_by_id (as it filters by is_active = true)
        let result = repo.get_by_id(&patient_id).await;
        assert!(result.is_err());

        // Cleanup (hard delete)
        sqlx::query("DELETE FROM patients WHERE id = $1")
            .bind(&patient_id)
            .execute(&pool)
            .await
            .expect("Failed to cleanup test patient");
    }

    #[tokio::test]
    async fn test_pg_allergy_repository() {
        let pool = get_test_pool().await;
        let patient_repo = PgPatientRepository::new(pool.clone());
        let allergy_repo = PgAllergyRepository::new(pool.clone());

        let patient_id = format!("TEST-PAT-ALLERGY-{}", Utc::now().timestamp_millis());
        let patient = create_test_patient(&patient_id);
        patient_repo
            .create(patient)
            .await
            .expect("Failed to create patient");

        let allergy = AllergyEntity {
            id: format!("ALL-{}", Utc::now().timestamp_millis()),
            patient_id: patient_id.clone(),
            allergen: "Peanuts".to_string(),
            allergen_type: "Food".to_string(),
            reaction: Some("Anaphylaxis".to_string()),
            severity: "Severe".to_string(),
            onset_date: None,
            last_occurrence: None,
            verified: true,
            verified_by: Some("Dr. Smith".to_string()),
            verified_at: Some(Utc::now()),
            source: Some("Patient reported".to_string()),
            created_by: "Dr. Smith".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            is_active: true,
        };

        // Test Create
        let created = allergy_repo
            .create(allergy.clone())
            .await
            .expect("Failed to create allergy");
        assert_eq!(created.allergen, "Peanuts");

        // Test Get by Patient
        let allergies = allergy_repo
            .get_by_patient(&patient_id)
            .await
            .expect("Failed to get allergies");
        assert_eq!(allergies.len(), 1);
        assert_eq!(allergies[0].allergen, "Peanuts");

        // Test Has Allergen
        let has = allergy_repo
            .has_allergen(&patient_id, "Peanuts")
            .await
            .expect("Failed has_allergen");
        assert!(has);

        // Test Update
        let mut updated_allergy = created.clone();
        updated_allergy.severity = "LifeThreatening".to_string();
        let updated = allergy_repo
            .update(updated_allergy)
            .await
            .expect("Failed to update");
        assert_eq!(updated.severity, "LifeThreatening");

        // Test Delete
        allergy_repo
            .delete(&created.id)
            .await
            .expect("Failed to delete");
        let active = allergy_repo
            .get_active_by_patient(&patient_id)
            .await
            .expect("Failed to get active");
        assert_eq!(active.len(), 0);

        // Cleanup
        sqlx::query("DELETE FROM allergies WHERE patient_id = $1")
            .bind(&patient_id)
            .execute(&pool)
            .await
            .ok();
        sqlx::query("DELETE FROM patients WHERE id = $1")
            .bind(&patient_id)
            .execute(&pool)
            .await
            .ok();
    }

    #[tokio::test]
    async fn test_pg_medical_record_repository() {
        let pool = get_test_pool().await;
        let patient_repo = PgPatientRepository::new(pool.clone());
        let record_repo = PgMedicalRecordRepository::new(pool.clone());

        let patient_id = format!("TEST-PAT-REC-{}", Utc::now().timestamp_millis());
        let patient = create_test_patient(&patient_id);
        patient_repo
            .create(patient)
            .await
            .expect("Failed to create patient");

        let record = MedicalRecordEntity {
            id: format!("REC-{}", Utc::now().timestamp_millis()),
            patient_id: patient_id.clone(),
            record_type: "LabResult".to_string(),
            category: Some("Lab".to_string()),
            ipfs_content_hash: Some("QmTest123".to_string()),
            ipfs_metadata_hash: None,
            content_checksum: Some("abc123def".to_string()),
            on_chain_hash: None,
            blockchain_tx_hash: None,
            summary_encrypted: None,
            record_date: Utc::now(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            created_by: "DOC-001".to_string(),
            last_modified_by: "DOC-001".to_string(),
            facility_id: Some("FAC-001".to_string()),
            is_active: true,
            is_locked: false,
        };

        // Test Create
        let created = record_repo
            .create(record.clone())
            .await
            .expect("Failed to create record");
        assert_eq!(created.ipfs_content_hash, Some("QmTest123".to_string()));

        // Test Get by Patient
        let records = record_repo
            .get_by_patient(&patient_id, Pagination::new(0, 10))
            .await
            .expect("Failed to get records");
        assert_eq!(records.items.len(), 1);

        // Test Get by IPFS Hash
        let fetched = record_repo
            .get_by_ipfs_hash("QmTest123")
            .await
            .expect("Failed to get by IPFS");
        assert_eq!(fetched.id, created.id);

        // Test Delete
        record_repo
            .delete(&created.id)
            .await
            .expect("Failed to delete");
        let records_after = record_repo
            .get_by_patient(&patient_id, Pagination::new(0, 10))
            .await
            .expect("Failed to get records");
        assert!(records_after.items.iter().all(|r| !r.is_active));

        // Cleanup
        sqlx::query("DELETE FROM medical_records WHERE patient_id = $1")
            .bind(&patient_id)
            .execute(&pool)
            .await
            .ok();
        sqlx::query("DELETE FROM patients WHERE id = $1")
            .bind(&patient_id)
            .execute(&pool)
            .await
            .ok();
    }
}
