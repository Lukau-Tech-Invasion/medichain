//! Unit tests for access-control pallet
//!
//! NASA Power of 10: Rule 10 - Compile with all warnings enabled

#![cfg(test)]

use crate::{mock::*, AccessType, Error, Role, DEFAULT_ACCESS_DURATION};
use frame_support::{assert_noop, assert_ok};

// =============================================================================
// Role Management Tests
// =============================================================================

/// Test assigning a role by admin
#[test]
fn assign_role_works() {
    new_test_ext().execute_with(|| {
        let new_doctor = 10u64;

        assert_ok!(AccessControl::assign_role(
            RuntimeOrigin::signed(ADMIN),
            new_doctor,
            Role::Doctor,
        ));

        assert!(AccessControl::is_doctor(&new_doctor));
        assert!(AccessControl::is_healthcare_provider(&new_doctor));
    });
}

/// Test non-admin cannot assign roles
#[test]
fn assign_role_fails_if_not_admin() {
    new_test_ext_with_roles().execute_with(|| {
        let new_user = 50u64;

        assert_noop!(
            AccessControl::assign_role(RuntimeOrigin::signed(DOCTOR), new_user, Role::Nurse,),
            Error::<Test>::InsufficientRole
        );
    });
}

/// Test cannot assign Admin role
#[test]
fn assign_admin_role_fails() {
    new_test_ext().execute_with(|| {
        let new_user = 50u64;

        assert_noop!(
            AccessControl::assign_role(RuntimeOrigin::signed(ADMIN), new_user, Role::Admin,),
            Error::<Test>::CannotAssignAdmin
        );
    });
}

/// Test cannot assign role if already assigned
#[test]
fn assign_role_fails_if_already_assigned() {
    new_test_ext_with_roles().execute_with(|| {
        assert_noop!(
            AccessControl::assign_role(RuntimeOrigin::signed(ADMIN), DOCTOR, Role::Nurse,),
            Error::<Test>::RoleAlreadyAssigned
        );
    });
}

/// Test revoking a role by admin
#[test]
fn revoke_role_works() {
    new_test_ext_with_roles().execute_with(|| {
        assert!(AccessControl::is_doctor(&DOCTOR));

        assert_ok!(AccessControl::revoke_role(
            RuntimeOrigin::signed(ADMIN),
            DOCTOR,
        ));

        assert!(!AccessControl::is_doctor(&DOCTOR));
        assert!(AccessControl::get_role(&DOCTOR).is_none());
    });
}

/// Test non-admin cannot revoke roles
#[test]
fn revoke_role_fails_if_not_admin() {
    new_test_ext_with_roles().execute_with(|| {
        assert_noop!(
            AccessControl::revoke_role(RuntimeOrigin::signed(DOCTOR), NURSE,),
            Error::<Test>::InsufficientRole
        );
    });
}

/// Test cannot revoke own role
#[test]
fn revoke_own_role_fails() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            AccessControl::revoke_role(RuntimeOrigin::signed(ADMIN), ADMIN,),
            Error::<Test>::CannotRevokeOwnRole
        );
    });
}

/// Test helper functions for role checking
#[test]
fn role_helper_functions_work() {
    new_test_ext_with_roles().execute_with(|| {
        // Admin checks
        assert!(AccessControl::is_admin(&ADMIN));
        assert!(!AccessControl::is_admin(&DOCTOR));

        // Doctor checks
        assert!(AccessControl::is_doctor(&DOCTOR));
        assert!(!AccessControl::is_doctor(&NURSE));

        // Healthcare provider checks (Admin, Doctor, Nurse)
        assert!(AccessControl::is_healthcare_provider(&ADMIN));
        assert!(AccessControl::is_healthcare_provider(&DOCTOR));
        assert!(AccessControl::is_healthcare_provider(&NURSE));
        assert!(!AccessControl::is_healthcare_provider(&PATIENT));

        // Can register patients checks
        assert!(AccessControl::can_register_patients(&ADMIN));
        assert!(AccessControl::can_register_patients(&DOCTOR));
        assert!(AccessControl::can_register_patients(&NURSE));
        assert!(!AccessControl::can_register_patients(&PATIENT));

        // Can edit records checks
        assert!(AccessControl::can_edit_medical_records(&ADMIN));
        assert!(AccessControl::can_edit_medical_records(&DOCTOR));
        assert!(AccessControl::can_edit_medical_records(&NURSE));
        assert!(!AccessControl::can_edit_medical_records(&PATIENT));

        // Patient checks
        assert!(AccessControl::is_patient(&PATIENT));
        assert!(!AccessControl::is_patient(&DOCTOR));
    });
}

// =============================================================================
// Emergency Access Tests (updated for RBAC)
// =============================================================================

/// Test granting emergency access by healthcare provider
#[test]
fn grant_emergency_access_works() {
    new_test_ext_with_roles().execute_with(|| {
        let patient = PATIENT;
        let reason_hash = [1u8; 32];

        assert_ok!(AccessControl::grant_emergency_access(
            RuntimeOrigin::signed(DOCTOR),
            patient,
            reason_hash,
        ));

        // Verify access was granted
        let access = AccessControl::active_access(patient, DOCTOR).unwrap();
        assert_eq!(access.reason_hash, reason_hash);
        assert_eq!(access.revoked, false);
        assert!(matches!(access.access_type, AccessType::Emergency));
    });
}

/// Test patient cannot grant emergency access
#[test]
fn grant_emergency_access_fails_for_patient() {
    new_test_ext_with_roles().execute_with(|| {
        let other_patient = 200u64;
        let reason_hash = [1u8; 32];

        assert_noop!(
            AccessControl::grant_emergency_access(
                RuntimeOrigin::signed(PATIENT),
                other_patient,
                reason_hash,
            ),
            Error::<Test>::NotHealthcareProvider
        );
    });
}

/// Test duplicate access grant fails
#[test]
fn grant_emergency_access_fails_if_exists() {
    new_test_ext_with_roles().execute_with(|| {
        let patient = PATIENT;
        let reason_hash = [1u8; 32];

        assert_ok!(AccessControl::grant_emergency_access(
            RuntimeOrigin::signed(DOCTOR),
            patient,
            reason_hash,
        ));

        assert_noop!(
            AccessControl::grant_emergency_access(
                RuntimeOrigin::signed(DOCTOR),
                patient,
                [2u8; 32],
            ),
            Error::<Test>::AccessAlreadyGranted
        );
    });
}

/// Test access revocation by patient
#[test]
fn revoke_access_by_patient_works() {
    new_test_ext_with_roles().execute_with(|| {
        assert_ok!(AccessControl::grant_emergency_access(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            [1u8; 32],
        ));

        // Patient revokes access
        assert_ok!(AccessControl::revoke_access(
            RuntimeOrigin::signed(PATIENT),
            PATIENT,
            DOCTOR,
        ));

        let access = AccessControl::active_access(PATIENT, DOCTOR).unwrap();
        assert_eq!(access.revoked, true);
    });
}

/// Test access revocation by accessor
#[test]
fn revoke_access_by_accessor_works() {
    new_test_ext_with_roles().execute_with(|| {
        assert_ok!(AccessControl::grant_emergency_access(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            [1u8; 32],
        ));

        // Doctor revokes their own access
        assert_ok!(AccessControl::revoke_access(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            DOCTOR,
        ));

        let access = AccessControl::active_access(PATIENT, DOCTOR).unwrap();
        assert_eq!(access.revoked, true);
    });
}

/// Test unauthorized revocation fails
#[test]
fn revoke_access_fails_if_unauthorized() {
    new_test_ext_with_roles().execute_with(|| {
        assert_ok!(AccessControl::grant_emergency_access(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            [1u8; 32],
        ));

        // Nurse cannot revoke doctor's access
        assert_noop!(
            AccessControl::revoke_access(RuntimeOrigin::signed(NURSE), PATIENT, DOCTOR),
            Error::<Test>::NotAuthorized
        );
    });
}

/// Test has_valid_access helper
#[test]
fn has_valid_access_works() {
    new_test_ext_with_roles().execute_with(|| {
        // No access initially
        assert!(!AccessControl::has_valid_access(&PATIENT, &DOCTOR));

        assert_ok!(AccessControl::grant_emergency_access(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            [1u8; 32],
        ));

        // Access granted
        assert!(AccessControl::has_valid_access(&PATIENT, &DOCTOR));

        // Revoke access
        assert_ok!(AccessControl::revoke_access(
            RuntimeOrigin::signed(PATIENT),
            PATIENT,
            DOCTOR,
        ));

        // Access revoked
        assert!(!AccessControl::has_valid_access(&PATIENT, &DOCTOR));
    });
}

/// Test access count tracking
#[test]
fn access_count_tracks_correctly() {
    new_test_ext_with_roles().execute_with(|| {
        assert_eq!(AccessControl::access_count(PATIENT), 0);

        // Grant access from doctor and nurse
        assert_ok!(AccessControl::grant_emergency_access(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            [2u8; 32],
        ));
        assert_ok!(AccessControl::grant_emergency_access(
            RuntimeOrigin::signed(NURSE),
            PATIENT,
            [3u8; 32],
        ));

        assert_eq!(AccessControl::access_count(PATIENT), 2);

        // Revoke one
        assert_ok!(AccessControl::revoke_access(
            RuntimeOrigin::signed(PATIENT),
            PATIENT,
            DOCTOR,
        ));

        assert_eq!(AccessControl::access_count(PATIENT), 1);
    });
}

/// Test cleanup of expired access
#[test]
fn cleanup_expired_access_works() {
    new_test_ext_with_roles().execute_with(|| {
        assert_ok!(AccessControl::grant_emergency_access(
            RuntimeOrigin::signed(DOCTOR),
            PATIENT,
            [1u8; 32],
        ));

        // Fast forward past expiration
        System::set_block_number(DEFAULT_ACCESS_DURATION as u64 + 10);

        // Anyone can cleanup expired access
        assert_ok!(AccessControl::cleanup_expired_access(
            RuntimeOrigin::signed(UNAUTHORIZED),
            PATIENT,
            DOCTOR,
        ));

        // Access should be removed
        assert!(AccessControl::active_access(PATIENT, DOCTOR).is_none());
        assert_eq!(AccessControl::access_count(PATIENT), 0);
    });
}
