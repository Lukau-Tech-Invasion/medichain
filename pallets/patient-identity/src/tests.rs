//! Unit tests for patient-identity pallet
//!
//! NASA Power of 10: Rule 10 - Compile with all warnings enabled

#![cfg(test)]

use crate::{mock::*, Error, NationalIdType};
use frame_support::{assert_noop, assert_ok};

/// Test successful patient registration by healthcare provider
#[test]
fn register_patient_works() {
    new_test_ext().execute_with(|| {
        let id_hash = [1u8; 32];

        // Doctor registers patient
        assert_ok!(PatientIdentity::register_patient(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            NationalIdType::FaydaID,
            id_hash,
        ));

        // Verify identity was stored
        let identity = PatientIdentity::identities(PATIENT).unwrap();
        assert_eq!(identity.id_hash, id_hash);
        assert_eq!(identity.verified, false);
        assert_eq!(identity.registered_by, DOCTOR);

        // Verify patient role was assigned
        assert!(pallet_access_control::Pallet::<Test>::is_patient(&PATIENT));
    });
}

/// Test nurse can also register patients
#[test]
fn nurse_can_register_patient() {
    new_test_ext().execute_with(|| {
        let id_hash = [2u8; 32];

        assert_ok!(PatientIdentity::register_patient(
            RuntimeOrigin::signed(NURSE),
            PATIENT,
            NationalIdType::GhanaCard,
            id_hash,
        ));

        let identity = PatientIdentity::identities(PATIENT).unwrap();
        assert_eq!(identity.registered_by, NURSE);
    });
}

/// Test patient cannot self-register
#[test]
fn patient_cannot_self_register() {
    new_test_ext().execute_with(|| {
        let id_hash = [3u8; 32];

        // Unauthorized user tries to register themselves
        assert_noop!(
            PatientIdentity::register_patient(
                RuntimeOrigin::signed(UNAUTHORIZED),
                UNAUTHORIZED,
                NationalIdType::NIN,
                id_hash,
            ),
            Error::<Test>::NotHealthcareProvider
        );
    });
}

/// Test duplicate registration fails
#[test]
fn register_patient_fails_if_already_registered() {
    new_test_ext().execute_with(|| {
        let id_hash = [1u8; 32];

        assert_ok!(PatientIdentity::register_patient(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            NationalIdType::FaydaID,
            id_hash,
        ));

        // Second registration should fail
        assert_noop!(
            PatientIdentity::register_patient(
                RuntimeOrigin::signed(DOCTOR),
                PATIENT,
                NationalIdType::GhanaCard,
                [2u8; 32],
            ),
            Error::<Test>::AlreadyRegistered
        );
    });
}

/// Test same ID hash cannot be used twice
#[test]
fn register_patient_fails_if_id_already_linked() {
    new_test_ext().execute_with(|| {
        let id_hash = [1u8; 32];
        let patient2 = 101u64;

        assert_ok!(PatientIdentity::register_patient(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            NationalIdType::FaydaID,
            id_hash,
        ));

        // Different account, same ID hash should fail
        assert_noop!(
            PatientIdentity::register_patient(
                RuntimeOrigin::signed(DOCTOR),
                patient2,
                NationalIdType::FaydaID,
                id_hash,
            ),
            Error::<Test>::IdAlreadyLinked
        );
    });
}

/// Test identity verification by healthcare provider
#[test]
fn verify_identity_works() {
    new_test_ext().execute_with(|| {
        let id_hash = [1u8; 32];

        // First register patient
        assert_ok!(PatientIdentity::register_patient(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            NationalIdType::NIN,
            id_hash,
        ));

        // Verify by another healthcare provider (nurse)
        assert_ok!(PatientIdentity::verify_identity(
            RuntimeOrigin::signed(NURSE),
            PATIENT,
        ));

        let identity = PatientIdentity::identities(PATIENT).unwrap();
        assert_eq!(identity.verified, true);
    });
}

/// Test patient cannot verify their own identity
#[test]
fn patient_cannot_verify_identity() {
    new_test_ext().execute_with(|| {
        let id_hash = [1u8; 32];

        assert_ok!(PatientIdentity::register_patient(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            NationalIdType::SmartID,
            id_hash,
        ));

        // Patient trying to verify another patient should fail
        assert_noop!(
            PatientIdentity::verify_identity(RuntimeOrigin::signed(PATIENT), PATIENT),
            Error::<Test>::NotAuthorizedToVerify
        );
    });
}

/// Test verify fails for non-existent identity
#[test]
fn verify_identity_fails_if_not_found() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            PatientIdentity::verify_identity(RuntimeOrigin::signed(DOCTOR), 99),
            Error::<Test>::IdentityNotFound
        );
    });
}

/// Test reverse lookup from ID hash to account
#[test]
fn id_to_account_lookup_works() {
    new_test_ext().execute_with(|| {
        let id_hash = [42u8; 32];

        assert_ok!(PatientIdentity::register_patient(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            NationalIdType::SmartID,
            id_hash,
        ));

        // Should be able to lookup account from ID hash
        let account = PatientIdentity::id_to_account(id_hash).unwrap();
        assert_eq!(account, PATIENT);
    });
}

/// Test all national ID types can be registered
#[test]
fn all_national_id_types_work() {
    new_test_ext().execute_with(|| {
        let patients = [101u64, 102, 103, 104];
        let id_types = [
            NationalIdType::FaydaID,
            NationalIdType::GhanaCard,
            NationalIdType::NIN,
            NationalIdType::SmartID,
        ];

        for (i, (patient, id_type)) in patients.iter().zip(id_types.iter()).enumerate() {
            let mut id_hash = [0u8; 32];
            id_hash[0] = i as u8;

            assert_ok!(PatientIdentity::register_patient(
                RuntimeOrigin::signed(DOCTOR),
                *patient,
                id_type.clone(),
                id_hash,
            ));

            let identity = PatientIdentity::identities(patient).unwrap();
            assert_eq!(identity.id_type, *id_type);
        }
    });
}
