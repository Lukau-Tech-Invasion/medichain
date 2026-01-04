//! Mock runtime for patient-identity pallet testing
//!
//! NASA Power of 10: Rule 9 - Use verifiable loop invariants

#![cfg(test)]

use crate as pallet_patient_identity;
use frame_support::{
    derive_impl,
    traits::{ConstU16, ConstU64},
};
use sp_core::H256;
use sp_runtime::{
    traits::{BlakeTwo256, IdentityLookup},
    BuildStorage,
};

type Block = frame_system::mocking::MockBlock<Test>;

// Configure mock runtime - includes AccessControl for RBAC
frame_support::construct_runtime!(
    pub enum Test {
        System: frame_system,
        AccessControl: pallet_access_control,
        PatientIdentity: pallet_patient_identity,
    }
);

#[derive_impl(frame_system::config_preludes::TestDefaultConfig)]
impl frame_system::Config for Test {
    type BaseCallFilter = frame_support::traits::Everything;
    type BlockWeights = ();
    type BlockLength = ();
    type DbWeight = ();
    type RuntimeOrigin = RuntimeOrigin;
    type RuntimeCall = RuntimeCall;
    type Nonce = u64;
    type Hash = H256;
    type Hashing = BlakeTwo256;
    type AccountId = u64;
    type Lookup = IdentityLookup<Self::AccountId>;
    type Block = Block;
    type RuntimeEvent = RuntimeEvent;
    type BlockHashCount = ConstU64<250>;
    type Version = ();
    type PalletInfo = PalletInfo;
    type AccountData = ();
    type OnNewAccount = ();
    type OnKilledAccount = ();
    type SystemWeightInfo = ();
    type SS58Prefix = ConstU16<42>;
    type OnSetCode = ();
    type MaxConsumers = frame_support::traits::ConstU32<16>;
}

impl pallet_access_control::Config for Test {
    type RuntimeEvent = RuntimeEvent;
}

impl pallet_patient_identity::Config for Test {
    type RuntimeEvent = RuntimeEvent;
}

/// Test account constants for RBAC testing
pub const ADMIN: u64 = 1;
pub const DOCTOR: u64 = 2;
pub const NURSE: u64 = 3;
pub const PATIENT: u64 = 100;
pub const UNAUTHORIZED: u64 = 999;

/// Build genesis storage for testing with RBAC setup
pub fn new_test_ext() -> sp_io::TestExternalities {
    let t = frame_system::GenesisConfig::<Test>::default()
        .build_storage()
        .unwrap();
    let mut ext: sp_io::TestExternalities = t.into();
    ext.execute_with(|| {
        // Setup initial admin role for testing
        // In production, this would be set in genesis config
        pallet_access_control::UserRoles::<Test>::insert(ADMIN, pallet_access_control::Role::Admin);
        pallet_access_control::UserRoles::<Test>::insert(
            DOCTOR,
            pallet_access_control::Role::Doctor,
        );
        pallet_access_control::UserRoles::<Test>::insert(NURSE, pallet_access_control::Role::Nurse);
    });
    ext
}
