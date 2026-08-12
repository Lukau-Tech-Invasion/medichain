//! # MediChain Runtime
//!
//! The runtime for MediChain — a blockchain-backed national health ID and
//! emergency medical records system. It composes the three MediChain pallets
//! (`AccessControl`, `PatientIdentity`, `MedicalRecords`) with the FRAME system,
//! consensus and fee pallets needed to run as a solochain.
//!
//! ## No PHI on chain
//!
//! Nothing here stores plaintext clinical data. The MediChain pallets hold
//! commitments, hashes and IPFS pointers only; the encrypted emergency capsule
//! and the queryable clinical record live off-chain.
//!
//! ## Consensus
//!
//! Aura for block authoring, GRANDPA for finality. Both authority sets are
//! seeded from the chain spec's genesis preset.
//!
//! ## NASA Power of 10
//! - Rule 1: No recursion
//! - Rule 2: All loops have fixed upper bounds
//! - Rule 3: No dynamic memory after initialization

#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(feature = "std")]
include!(concat!(env!("OUT_DIR"), "/wasm_binary.rs"));

pub mod apis;
#[cfg(feature = "runtime-benchmarks")]
mod benchmarks;
pub mod configs;
pub mod genesis_config_presets;

extern crate alloc;
use alloc::vec::Vec;
use sp_runtime::{
    generic, impl_opaque_keys,
    traits::{BlakeTwo256, IdentifyAccount, Verify},
    MultiAddress, MultiSignature,
};
#[cfg(feature = "std")]
use sp_version::NativeVersion;
use sp_version::RuntimeVersion;

pub use frame_system::Call as SystemCall;
pub use pallet_balances::Call as BalancesCall;
pub use pallet_timestamp::Call as TimestampCall;
#[cfg(any(feature = "std", test))]
pub use sp_runtime::BuildStorage;

// Re-exported so chain specs and tooling can name MediChain's domain types
// without depending on each pallet crate directly.
pub use pallet_access_control::Role;

/// Opaque types. Used by the CLI to instantiate machinery that doesn't need to
/// know the specifics of the runtime.
pub mod opaque {
    use super::*;
    use sp_runtime::{
        generic,
        traits::{BlakeTwo256, Hash as HashT},
    };

    pub use sp_runtime::OpaqueExtrinsic as UncheckedExtrinsic;

    /// Opaque block header type.
    pub type Header = generic::Header<BlockNumber, BlakeTwo256>;
    /// Opaque block type.
    pub type Block = generic::Block<Header, UncheckedExtrinsic>;
    /// Opaque block identifier type.
    pub type BlockId = generic::BlockId<Block>;
    /// Opaque block hash type.
    pub type Hash = <BlakeTwo256 as HashT>::Output;
}

impl_opaque_keys! {
    pub struct SessionKeys {
        pub aura: Aura,
        pub grandpa: Grandpa,
    }
}

#[sp_version::runtime_version]
pub const VERSION: RuntimeVersion = RuntimeVersion {
    spec_name: alloc::borrow::Cow::Borrowed("medichain"),
    impl_name: alloc::borrow::Cow::Borrowed("medichain"),
    authoring_version: 1,
    spec_version: 100,
    impl_version: 1,
    apis: apis::RUNTIME_API_VERSIONS,
    transaction_version: 1,
    system_version: 1,
};

mod block_times {
    /// Target block time. `SLOT_DURATION` is read by `pallet_timestamp`, which
    /// `pallet_aura` in turn uses for `slot_duration()`.
    ///
    /// 6s is load-bearing beyond throughput: `pallet-access-control`'s
    /// `DEFAULT_ACCESS_DURATION` of 150 blocks is documented as "~15 minutes at
    /// 6s/block". Changing this silently changes how long emergency access
    /// grants last.
    pub const MILLI_SECS_PER_BLOCK: u64 = 6000;

    // NOTE: slot duration cannot be changed after the chain has started without
    // bricking block production.
    pub const SLOT_DURATION: u64 = MILLI_SECS_PER_BLOCK;
}
pub use block_times::*;

// Time measured in blocks.
pub const MINUTES: BlockNumber = 60_000 / (MILLI_SECS_PER_BLOCK as BlockNumber);
pub const HOURS: BlockNumber = MINUTES * 60;
pub const DAYS: BlockNumber = HOURS * 24;

pub const BLOCK_HASH_COUNT: BlockNumber = 2400;

// Unit = the base number of indivisible units for balances.
pub const UNIT: Balance = 1_000_000_000_000;
pub const MILLI_UNIT: Balance = 1_000_000_000;
pub const MICRO_UNIT: Balance = 1_000_000;

/// Existential deposit.
pub const EXISTENTIAL_DEPOSIT: Balance = MILLI_UNIT;

/// Version information used to identify this runtime when compiled natively.
#[cfg(feature = "std")]
pub fn native_version() -> NativeVersion {
    NativeVersion {
        runtime_version: VERSION,
        can_author_with: Default::default(),
    }
}

/// Alias to 512-bit hash when used in the context of a transaction signature.
pub type Signature = MultiSignature;

/// Identifies an account on the chain; equivalent to the public key of the
/// transaction signing scheme.
pub type AccountId = <<Signature as Verify>::Signer as IdentifyAccount>::AccountId;

/// Balance of an account.
pub type Balance = u128;

/// Index of a transaction in the chain.
pub type Nonce = u32;

/// A hash of some data used by the chain.
pub type Hash = sp_core::H256;

/// An index to a block.
pub type BlockNumber = u32;

/// The address format for describing accounts.
///
/// `MultiAddress`, not a bare `AccountId`. The MediChain API signs with
/// `subxt`, whose `PolkadotConfig` encodes the sender as
/// `MultiAddress::Id(account)` — a `0x00` variant byte followed by 32 bytes. A
/// bare `AccountId` address type would decode that leading variant byte as the
/// first byte of the account and fail every signature check.
pub type Address = MultiAddress<AccountId, ()>;

/// Block header type as expected by this runtime.
pub type Header = generic::Header<BlockNumber, BlakeTwo256>;

/// Block type as expected by this runtime.
pub type Block = generic::Block<Header, UncheckedExtrinsic>;

/// A block signed with a justification.
pub type SignedBlock = generic::SignedBlock<Block>;

/// BlockId type as expected by this runtime.
pub type BlockId = generic::BlockId<Block>;

/// The `TransactionExtension` applied to the basic transaction logic.
pub type TxExtension = (
    frame_system::AuthorizeCall<Runtime>,
    frame_system::CheckNonZeroSender<Runtime>,
    frame_system::CheckSpecVersion<Runtime>,
    frame_system::CheckTxVersion<Runtime>,
    frame_system::CheckGenesis<Runtime>,
    frame_system::CheckEra<Runtime>,
    frame_system::CheckNonce<Runtime>,
    frame_system::CheckWeight<Runtime>,
    pallet_transaction_payment::ChargeTransactionPayment<Runtime>,
    frame_metadata_hash_extension::CheckMetadataHash<Runtime>,
    frame_system::WeightReclaim<Runtime>,
);

/// Unchecked extrinsic type as expected by this runtime.
pub type UncheckedExtrinsic =
    generic::UncheckedExtrinsic<Address, RuntimeCall, Signature, TxExtension>;

/// The payload being signed in transactions.
pub type SignedPayload = generic::SignedPayload<RuntimeCall, TxExtension>;

/// Executive: handles dispatch to the various modules.
pub type Executive = frame_executive::Executive<
    Runtime,
    Block,
    frame_system::ChainContext<Runtime>,
    Runtime,
    AllPalletsWithSystem,
>;

// Compose the runtime from the configured FRAME pallets.
#[frame_support::runtime]
mod runtime {
    #[runtime::runtime]
    #[runtime::derive(
        RuntimeCall,
        RuntimeEvent,
        RuntimeError,
        RuntimeOrigin,
        RuntimeFreezeReason,
        RuntimeHoldReason,
        RuntimeSlashReason,
        RuntimeLockId,
        RuntimeTask,
        RuntimeViewFunction
    )]
    pub struct Runtime;

    #[runtime::pallet_index(0)]
    pub type System = frame_system;

    #[runtime::pallet_index(1)]
    pub type Timestamp = pallet_timestamp;

    #[runtime::pallet_index(2)]
    pub type Aura = pallet_aura;

    #[runtime::pallet_index(3)]
    pub type Grandpa = pallet_grandpa;

    #[runtime::pallet_index(4)]
    pub type Balances = pallet_balances;

    #[runtime::pallet_index(5)]
    pub type TransactionPayment = pallet_transaction_payment;

    #[runtime::pallet_index(6)]
    pub type Sudo = pallet_sudo;

    // --- MediChain -------------------------------------------------------
    // AccessControl is first: the other two gate their calls on the roles it
    // owns, and its genesis config seeds those roles.
    #[runtime::pallet_index(7)]
    pub type AccessControl = pallet_access_control;

    #[runtime::pallet_index(8)]
    pub type PatientIdentity = pallet_patient_identity;

    #[runtime::pallet_index(9)]
    pub type MedicalRecords = pallet_medical_records;
}
