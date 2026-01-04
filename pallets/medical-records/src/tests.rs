//! Unit tests for medical-records pallet
//!
//! NASA Power of 10: Rule 10 - Compile with all warnings enabled

#![cfg(test)]

use crate::{mock::*, AlertType, BloodType, Error};
use frame_support::{assert_noop, assert_ok};

/// Test successful health record creation by doctor
#[test]
fn create_health_record_works() {
    new_test_ext().execute_with(|| {
        let ipfs_hash = b"QmYwAPJzv5CZsnAzt8auVTLFa".to_vec();

        assert_ok!(MedicalRecords::create_health_record(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            BloodType::APositive,
            ipfs_hash.clone(),
        ));

        let record = MedicalRecords::health_records(PATIENT).unwrap();
        assert_eq!(record.blood_type, BloodType::APositive);
        assert_eq!(record.ipfs_hash.to_vec(), ipfs_hash);
        assert_eq!(record.alerts.len(), 0);
        assert_eq!(record.last_modified_by, DOCTOR);
    });
}

/// Test nurse can create health records
#[test]
fn nurse_can_create_health_record() {
    new_test_ext().execute_with(|| {
        let ipfs_hash = b"QmNurseCreatedRecord123456".to_vec();

        assert_ok!(MedicalRecords::create_health_record(
            RuntimeOrigin::signed(NURSE),
            PATIENT,
            BloodType::BNegative,
            ipfs_hash.clone(),
        ));

        let record = MedicalRecords::health_records(PATIENT).unwrap();
        assert_eq!(record.last_modified_by, NURSE);
    });
}

/// Test patient cannot create their own health record
#[test]
fn patient_cannot_create_health_record() {
    new_test_ext().execute_with(|| {
        let ipfs_hash = b"QmPatientTriesToCreate1234".to_vec();

        assert_noop!(
            MedicalRecords::create_health_record(
                RuntimeOrigin::signed(PATIENT),
                PATIENT,
                BloodType::OPositive,
                ipfs_hash,
            ),
            Error::<Test>::NotHealthcareProvider
        );
    });
}

/// Test unauthorized user cannot create health records
#[test]
fn unauthorized_cannot_create_health_record() {
    new_test_ext().execute_with(|| {
        let ipfs_hash = b"QmUnauthorizedAttempt12345".to_vec();

        assert_noop!(
            MedicalRecords::create_health_record(
                RuntimeOrigin::signed(UNAUTHORIZED),
                PATIENT,
                BloodType::ABPositive,
                ipfs_hash,
            ),
            Error::<Test>::NotHealthcareProvider
        );
    });
}

/// Test duplicate record creation fails
#[test]
fn create_health_record_fails_if_exists() {
    new_test_ext().execute_with(|| {
        let ipfs_hash = b"QmYwAPJzv5CZsnAzt8auVTLFa".to_vec();

        assert_ok!(MedicalRecords::create_health_record(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            BloodType::OPositive,
            ipfs_hash.clone(),
        ));

        assert_noop!(
            MedicalRecords::create_health_record(
                RuntimeOrigin::signed(DOCTOR),
                PATIENT,
                BloodType::BNegative,
                ipfs_hash,
            ),
            Error::<Test>::RecordAlreadyExists
        );
    });
}

/// Test adding medical alert by healthcare provider
#[test]
fn add_alert_works() {
    new_test_ext().execute_with(|| {
        let ipfs_hash = b"QmYwAPJzv5CZsnAzt8auVTLFa".to_vec();

        assert_ok!(MedicalRecords::create_health_record(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            BloodType::ABPositive,
            ipfs_hash,
        ));

        let description_hash = [1u8; 32];

        assert_ok!(MedicalRecords::add_alert(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            AlertType::Allergy,
            description_hash,
            5, // severity
        ));

        let record = MedicalRecords::health_records(PATIENT).unwrap();
        assert_eq!(record.alerts.len(), 1);
        assert_eq!(record.alerts[0].severity, 5);
        assert_eq!(record.last_modified_by, DOCTOR);
    });
}

/// Test patient cannot add alerts to their own record
#[test]
fn patient_cannot_add_alert() {
    new_test_ext().execute_with(|| {
        let ipfs_hash = b"QmYwAPJzv5CZsnAzt8auVTLFa".to_vec();

        assert_ok!(MedicalRecords::create_health_record(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            BloodType::APositive,
            ipfs_hash,
        ));

        assert_noop!(
            MedicalRecords::add_alert(
                RuntimeOrigin::signed(PATIENT),
                PATIENT,
                AlertType::ChronicCondition,
                [0u8; 32],
                3,
            ),
            Error::<Test>::NotHealthcareProvider
        );
    });
}

/// Test alert fails if no record exists
#[test]
fn add_alert_fails_if_no_record() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            MedicalRecords::add_alert(
                RuntimeOrigin::signed(DOCTOR),
                PATIENT,
                AlertType::ChronicCondition,
                [0u8; 32],
                3,
            ),
            Error::<Test>::RecordNotFound
        );
    });
}

/// Test invalid severity fails
#[test]
fn add_alert_fails_invalid_severity() {
    new_test_ext().execute_with(|| {
        let ipfs_hash = b"QmYwAPJzv5CZsnAzt8auVTLFa".to_vec();

        assert_ok!(MedicalRecords::create_health_record(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            BloodType::ONegative,
            ipfs_hash,
        ));

        // Severity 0 is invalid
        assert_noop!(
            MedicalRecords::add_alert(
                RuntimeOrigin::signed(DOCTOR),
                PATIENT,
                AlertType::Medication,
                [0u8; 32],
                0,
            ),
            Error::<Test>::InvalidSeverity
        );

        // Severity 6 is invalid
        assert_noop!(
            MedicalRecords::add_alert(
                RuntimeOrigin::signed(DOCTOR),
                PATIENT,
                AlertType::Medication,
                [0u8; 32],
                6,
            ),
            Error::<Test>::InvalidSeverity
        );
    });
}

/// Test IPFS hash update by healthcare provider
#[test]
fn update_ipfs_hash_works() {
    new_test_ext().execute_with(|| {
        let old_hash = b"QmOldHash1234567890123456".to_vec();
        let new_hash = b"QmNewHash0987654321098765".to_vec();

        assert_ok!(MedicalRecords::create_health_record(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            BloodType::BPositive,
            old_hash,
        ));

        // Nurse updates the hash
        assert_ok!(MedicalRecords::update_ipfs_hash(
            RuntimeOrigin::signed(NURSE),
            PATIENT,
            new_hash.clone(),
        ));

        let record = MedicalRecords::health_records(PATIENT).unwrap();
        assert_eq!(record.ipfs_hash.to_vec(), new_hash);
        assert_eq!(record.last_modified_by, NURSE);
    });
}

/// Test patient cannot update IPFS hash
#[test]
fn patient_cannot_update_ipfs_hash() {
    new_test_ext().execute_with(|| {
        let old_hash = b"QmOldHash1234567890123456".to_vec();
        let new_hash = b"QmPatientTriesToUpdate123".to_vec();

        assert_ok!(MedicalRecords::create_health_record(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            BloodType::APositive,
            old_hash,
        ));

        assert_noop!(
            MedicalRecords::update_ipfs_hash(RuntimeOrigin::signed(PATIENT), PATIENT, new_hash,),
            Error::<Test>::NotHealthcareProvider
        );
    });
}

/// Test maximum alerts limit (NASA Power of 10: Rule 2 - bounded loops)
#[test]
fn add_alert_respects_max_limit() {
    new_test_ext().execute_with(|| {
        let ipfs_hash = b"QmYwAPJzv5CZsnAzt8auVTLFa".to_vec();

        assert_ok!(MedicalRecords::create_health_record(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            BloodType::APositive,
            ipfs_hash,
        ));

        // Add maximum alerts (10)
        for i in 0..10 {
            let mut desc_hash = [0u8; 32];
            desc_hash[0] = i;
            assert_ok!(MedicalRecords::add_alert(
                RuntimeOrigin::signed(DOCTOR),
                PATIENT,
                AlertType::Allergy,
                desc_hash,
                3,
            ));
        }

        // 11th alert should fail
        assert_noop!(
            MedicalRecords::add_alert(
                RuntimeOrigin::signed(DOCTOR),
                PATIENT,
                AlertType::Other,
                [11u8; 32],
                1,
            ),
            Error::<Test>::TooManyAlerts
        );
    });
}

/// Test different healthcare providers can update same record
#[test]
fn multiple_providers_can_update_record() {
    new_test_ext().execute_with(|| {
        let ipfs_hash = b"QmInitialHash12345678901".to_vec();

        // Doctor creates record
        assert_ok!(MedicalRecords::create_health_record(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            BloodType::OPositive,
            ipfs_hash,
        ));

        // Nurse adds alert
        assert_ok!(MedicalRecords::add_alert(
            RuntimeOrigin::signed(NURSE),
            PATIENT,
            AlertType::Allergy,
            [1u8; 32],
            4,
        ));

        let record = MedicalRecords::health_records(PATIENT).unwrap();
        assert_eq!(record.alerts.len(), 1);
        assert_eq!(record.last_modified_by, NURSE);

        // Doctor updates IPFS hash
        assert_ok!(MedicalRecords::update_ipfs_hash(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            b"QmUpdatedByDoctor1234567".to_vec(),
        ));

        let record = MedicalRecords::health_records(PATIENT).unwrap();
        assert_eq!(record.last_modified_by, DOCTOR);
    });
}
