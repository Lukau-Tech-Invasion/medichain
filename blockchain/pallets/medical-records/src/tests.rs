//! Unit tests for medical-records pallet
//!
//! NASA Power of 10: Rule 10 - Compile with all warnings enabled

#![cfg(test)]

use crate::{mock::*, AlertType, Error};
use frame_support::{assert_noop, assert_ok};

/// A stand-in commitment to an off-chain emergency capsule.
///
/// Deliberately opaque bytes: the point of the HZ-003 change is that the chain
/// holds a commitment it cannot interpret, so tests should not be able to read
/// a blood type out of it either.
const TEST_COMMITMENT: [u8; 32] = [7u8; 32];

/// Test successful health record creation by doctor
#[test]
fn create_health_record_works() {
    new_test_ext().execute_with(|| {
        let ipfs_hash = b"QmYwAPJzv5CZsnAzt8auVTLFa".to_vec();

        assert_ok!(MedicalRecords::create_health_record(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            TEST_COMMITMENT,
            ipfs_hash.clone(),
        ));

        let record = MedicalRecords::health_records(PATIENT).unwrap();
        assert_eq!(record.emergency_capsule_commitment, TEST_COMMITMENT);
        // A freshly created record has no capsule published yet.
        assert_eq!(record.emergency_capsule_version, 0);
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
            TEST_COMMITMENT,
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
                TEST_COMMITMENT,
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
                TEST_COMMITMENT,
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
            TEST_COMMITMENT,
            ipfs_hash.clone(),
        ));

        assert_noop!(
            MedicalRecords::create_health_record(
                RuntimeOrigin::signed(DOCTOR),
                PATIENT,
                TEST_COMMITMENT,
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
            TEST_COMMITMENT,
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
            TEST_COMMITMENT,
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
            TEST_COMMITMENT,
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
            TEST_COMMITMENT,
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
            TEST_COMMITMENT,
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
            TEST_COMMITMENT,
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
            TEST_COMMITMENT,
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

// ============================================================================
// Emergency capsule commitment (Horizon HZ-003)
//
// These replace what were previously plaintext blood-type assertions. The
// property under test is deliberately different now: not "the chain stores the
// right blood type" but "the chain stores an opaque commitment, and cannot be
// made to store a stale one".
// ============================================================================

/// A provider can publish a capsule commitment, and the version advances.
#[test]
fn set_emergency_capsule_commitment_works() {
    new_test_ext().execute_with(|| {
        assert_ok!(MedicalRecords::create_health_record(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            TEST_COMMITMENT,
            b"QmCapsuleBaseRecord123456".to_vec(),
        ));

        let updated: [u8; 32] = [9u8; 32];
        assert_ok!(MedicalRecords::set_emergency_capsule_commitment(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            updated,
            1,
        ));

        let record = MedicalRecords::health_records(PATIENT).unwrap();
        assert_eq!(record.emergency_capsule_commitment, updated);
        assert_eq!(record.emergency_capsule_version, 1);
    });
}

/// Replaying an old capsule version must fail: otherwise a superseded capsule
/// (e.g. one still asserting a since-revoked DNR) could be presented as current.
#[test]
fn set_emergency_capsule_commitment_rejects_stale_version() {
    new_test_ext().execute_with(|| {
        assert_ok!(MedicalRecords::create_health_record(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            TEST_COMMITMENT,
            b"QmCapsuleStaleCheck123456".to_vec(),
        ));

        assert_ok!(MedicalRecords::set_emergency_capsule_commitment(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            [9u8; 32],
            5,
        ));

        // Same version again.
        assert_noop!(
            MedicalRecords::set_emergency_capsule_commitment(
                RuntimeOrigin::signed(DOCTOR),
                PATIENT,
                [1u8; 32],
                5,
            ),
            Error::<Test>::StaleCapsuleVersion
        );

        // An older version.
        assert_noop!(
            MedicalRecords::set_emergency_capsule_commitment(
                RuntimeOrigin::signed(DOCTOR),
                PATIENT,
                [1u8; 32],
                4,
            ),
            Error::<Test>::StaleCapsuleVersion
        );

        // The stored commitment is unchanged by the rejected attempts.
        let record = MedicalRecords::health_records(PATIENT).unwrap();
        assert_eq!(record.emergency_capsule_commitment, [9u8; 32]);
        assert_eq!(record.emergency_capsule_version, 5);
    });
}

/// The extrinsics this replaced (`set_organ_donor_status`/`set_dnr_status`)
/// accepted any signed origin. Publishing a commitment must not: the commitment
/// has to correspond to a capsule the clinical system actually holds.
#[test]
fn patient_cannot_set_emergency_capsule_commitment() {
    new_test_ext().execute_with(|| {
        assert_ok!(MedicalRecords::create_health_record(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            TEST_COMMITMENT,
            b"QmCapsuleAuthCheck1234567".to_vec(),
        ));

        assert_noop!(
            MedicalRecords::set_emergency_capsule_commitment(
                RuntimeOrigin::signed(PATIENT),
                PATIENT,
                [3u8; 32],
                1,
            ),
            Error::<Test>::NotHealthcareProvider
        );
    });
}

#[test]
fn set_emergency_capsule_commitment_fails_without_a_record() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            MedicalRecords::set_emergency_capsule_commitment(
                RuntimeOrigin::signed(DOCTOR),
                PATIENT,
                [3u8; 32],
                1,
            ),
            Error::<Test>::RecordNotFound
        );
    });
}

#[test]
fn capsule_upsert_creates_first_record_and_rejects_replay() {
    new_test_ext().execute_with(|| {
        assert_ok!(MedicalRecords::upsert_emergency_capsule_commitment(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            TEST_COMMITMENT,
            1,
        ));

        let record = MedicalRecords::health_records(PATIENT).unwrap();
        assert_eq!(record.emergency_capsule_commitment, TEST_COMMITMENT);
        assert_eq!(record.emergency_capsule_version, 1);
        assert!(record.ipfs_hash.is_empty());

        assert_noop!(
            MedicalRecords::upsert_emergency_capsule_commitment(
                RuntimeOrigin::signed(DOCTOR),
                PATIENT,
                [8u8; 32],
                1,
            ),
            Error::<Test>::StaleCapsuleVersion
        );
    });
}

#[test]
fn ipfs_upsert_creates_shell_and_preserves_capsule_commitment() {
    new_test_ext().execute_with(|| {
        let first_hash = b"QmFirstEncryptedRecord123".to_vec();
        assert_ok!(MedicalRecords::upsert_ipfs_hash(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            first_hash.clone(),
        ));
        let shell = MedicalRecords::health_records(PATIENT).unwrap();
        assert_eq!(shell.ipfs_hash.to_vec(), first_hash);
        assert_eq!(shell.emergency_capsule_version, 0);

        assert_ok!(MedicalRecords::upsert_emergency_capsule_commitment(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            TEST_COMMITMENT,
            1,
        ));
        let second_hash = b"QmUpdatedEncryptedRecord456".to_vec();
        assert_ok!(MedicalRecords::upsert_ipfs_hash(
            RuntimeOrigin::signed(NURSE),
            PATIENT,
            second_hash.clone(),
        ));

        let updated = MedicalRecords::health_records(PATIENT).unwrap();
        assert_eq!(updated.ipfs_hash.to_vec(), second_hash);
        assert_eq!(updated.emergency_capsule_commitment, TEST_COMMITMENT);
        assert_eq!(updated.emergency_capsule_version, 1);
        assert_eq!(updated.last_modified_by, NURSE);
    });
}

#[test]
fn medical_record_upserts_require_a_healthcare_provider() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            MedicalRecords::upsert_ipfs_hash(
                RuntimeOrigin::signed(UNAUTHORIZED),
                PATIENT,
                b"QmBlocked".to_vec(),
            ),
            Error::<Test>::NotHealthcareProvider
        );
        assert_noop!(
            MedicalRecords::upsert_emergency_capsule_commitment(
                RuntimeOrigin::signed(UNAUTHORIZED),
                PATIENT,
                TEST_COMMITMENT,
                1,
            ),
            Error::<Test>::NotHealthcareProvider
        );
    });
}
