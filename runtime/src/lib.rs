//! # MediChain Runtime
//!
//! The runtime for MediChain - a blockchain-based emergency medical records system.
//! Integrates patient identity, medical records, and emergency access control.
//!
//! ## NASA Power of 10 Compliance
//! - Rule 1: No recursion
//! - Rule 2: All loops have fixed upper bounds
//! - Rule 3: No dynamic memory after initialization

#![cfg_attr(not(feature = "std"), no_std)]

pub mod mock;
pub mod tests;

use frame_support::{
    construct_runtime, derive_impl, parameter_types,
    traits::ConstU32,
    weights::{constants::WEIGHT_REF_TIME_PER_SECOND, Weight},
};
use sp_runtime::{
    generic,
    traits::{BlakeTwo256, IdentityLookup},
    Perbill,
};

/// Block number type
pub type BlockNumber = u64;

/// Account ID type
pub type AccountId = u64;

/// Balance type
pub type Balance = u128;

/// Nonce type  
pub type Nonce = u64;

/// Hash type
pub type Hash = sp_core::H256;

/// Block header type
pub type Header = generic::Header<BlockNumber, BlakeTwo256>;

/// Block type
pub type Block = generic::Block<Header, UncheckedExtrinsic>;

/// Unchecked extrinsic type
pub type UncheckedExtrinsic = generic::UncheckedExtrinsic<AccountId, RuntimeCall, (), ()>;

/// Maximum block weight (75% of available time)
const MAXIMUM_BLOCK_WEIGHT: Weight =
    Weight::from_parts(WEIGHT_REF_TIME_PER_SECOND.saturating_mul(2), u64::MAX);

/// Maximum block length (5 MB)
const MAXIMUM_BLOCK_LENGTH: u32 = 5 * 1024 * 1024;

parameter_types! {
    pub const BlockHashCount: BlockNumber = 2400;
    pub BlockWeights: frame_system::limits::BlockWeights =
        frame_system::limits::BlockWeights::simple_max(MAXIMUM_BLOCK_WEIGHT);
    pub BlockLength: frame_system::limits::BlockLength =
        frame_system::limits::BlockLength::max_with_normal_ratio(
            MAXIMUM_BLOCK_LENGTH,
            Perbill::from_percent(75),
        );
}

/// Frame System configuration
#[derive_impl(frame_system::config_preludes::TestDefaultConfig)]
impl frame_system::Config for Runtime {
    type Block = Block;
    type AccountId = AccountId;
    type Lookup = IdentityLookup<AccountId>;
    type AccountData = pallet_balances::AccountData<Balance>;
}

parameter_types! {
    pub const MinimumPeriod: u64 = 3000; // 3 seconds (half block time)
}

/// Timestamp pallet configuration
impl pallet_timestamp::Config for Runtime {
    type Moment = u64;
    type OnTimestampSet = ();
    type MinimumPeriod = MinimumPeriod;
    type WeightInfo = ();
}

parameter_types! {
    pub const ExistentialDeposit: Balance = 1;
    pub const MaxLocks: u32 = 50;
    pub const MaxReserves: u32 = 50;
}

/// Balances pallet configuration
impl pallet_balances::Config for Runtime {
    type Balance = Balance;
    type DustRemoval = ();
    type RuntimeEvent = RuntimeEvent;
    type ExistentialDeposit = ExistentialDeposit;
    type AccountStore = System;
    type WeightInfo = ();
    type MaxLocks = MaxLocks;
    type MaxReserves = MaxReserves;
    type ReserveIdentifier = [u8; 8];
    type RuntimeHoldReason = RuntimeHoldReason;
    type RuntimeFreezeReason = RuntimeFreezeReason;
    type FreezeIdentifier = ();
    type MaxFreezes = ConstU32<0>;
}

parameter_types! {
    pub const TransactionByteFee: Balance = 1;
    pub const OperationalFeeMultiplier: u8 = 5;
}

/// Transaction payment pallet configuration
impl pallet_transaction_payment::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type OnChargeTransaction = pallet_transaction_payment::FungibleAdapter<Balances, ()>;
    type OperationalFeeMultiplier = OperationalFeeMultiplier;
    type WeightToFee = frame_support::weights::IdentityFee<Balance>;
    type LengthToFee = frame_support::weights::IdentityFee<Balance>;
    type FeeMultiplierUpdate = ();
}

/// Patient Identity pallet configuration
impl pallet_patient_identity::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
}

/// Medical Records pallet configuration
impl pallet_medical_records::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
}

/// Access Control pallet configuration
impl pallet_access_control::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
}

// Construct the runtime by composing all pallets
construct_runtime!(
    pub struct Runtime {
        // Core pallets
        System: frame_system,
        Timestamp: pallet_timestamp,
        Balances: pallet_balances,
        TransactionPayment: pallet_transaction_payment,

        // MediChain custom pallets
        PatientIdentity: pallet_patient_identity,
        MedicalRecords: pallet_medical_records,
        AccessControl: pallet_access_control,
    }
);
