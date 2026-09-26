//! Unit tests for medical-records pallet
//!
//! NASA Power of 10: Rule 10 - Compile with all warnings enabled

#![cfg(test)]

use crate::{mock::*, Error};
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

        // Nurse updates the IPFS hash
        assert_ok!(MedicalRecords::update_ipfs_hash(
            RuntimeOrigin::signed(NURSE),
            PATIENT,
            b"QmUpdatedByNurse12345678".to_vec(),
        ));

        let record = MedicalRecords::health_records(PATIENT).unwrap();
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

// ============================================================================
// Migration v0 → v1: plaintext alerts removed (WP8)
// ============================================================================

/// A v0 record carrying plaintext alerts comes out of the migration with every
/// other field intact, no alerts, and the storage version at 1. Running it
/// again changes nothing.
#[test]
fn migration_v1_drops_plaintext_alerts_and_keeps_everything_else() {
    use crate::migrations::v1::{MigrateV0ToV1, V0AlertType, V0HealthRecord, V0MedicalAlert};
    use frame_support::traits::{GetStorageVersion, OnRuntimeUpgrade, StorageVersion};
    use parity_scale_codec::Encode;

    new_test_ext().execute_with(|| {
        StorageVersion::new(0).put::<MedicalRecords>();
        let alert = V0MedicalAlert {
            alert_type: V0AlertType::Allergy,
            description_hash: [7u8; 32],
            severity: 5,
        };
        let old = V0HealthRecord::<Test> {
            patient: PATIENT,
            emergency_capsule_commitment: TEST_COMMITMENT,
            emergency_capsule_version: 3,
            ipfs_hash: b"QmOld".to_vec().try_into().unwrap(),
            alerts: vec![alert].try_into().unwrap(),
            created_at: 1,
            updated_at: 2,
            last_modified_by: NURSE,
        };
        let key = crate::HealthRecords::<Test>::hashed_key_for(PATIENT);
        frame_support::storage::unhashed::put_raw(&key, &old.encode());

        MigrateV0ToV1::<Test>::on_runtime_upgrade();

        let record = MedicalRecords::health_records(PATIENT).expect("record kept");
        assert_eq!(record.emergency_capsule_commitment, TEST_COMMITMENT);
        assert_eq!(record.emergency_capsule_version, 3);
        assert_eq!(record.ipfs_hash.to_vec(), b"QmOld".to_vec());
        assert_eq!((record.created_at, record.updated_at), (1, 2));
        assert_eq!(record.last_modified_by, NURSE);
        assert_eq!(MedicalRecords::on_chain_storage_version(), 1);

        // Idempotent: a second run is a no-op, not a second translation.
        MigrateV0ToV1::<Test>::on_runtime_upgrade();
        assert_eq!(MedicalRecords::health_records(PATIENT), Some(record));
    });
}
