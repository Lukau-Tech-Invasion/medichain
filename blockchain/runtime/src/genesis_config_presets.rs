//! Genesis presets for MediChain development and local test chains.
//!
//! # These are development identities. Never use them for a real network.
//!
//! Every key below is a well-known Substrate development key (`//Alice`,
//! `//Bob`, ...). Their seeds are public and in every Substrate tutorial. They
//! are appropriate for `--dev` and for a local multi-node test network, and for
//! nothing else. A production chain spec must supply its own authority keys,
//! its own sudo key, and its own `initial_roles` set.

use crate::{AccountId, BalancesConfig, Role, RuntimeGenesisConfig, SudoConfig};
use alloc::{vec, vec::Vec};
use frame_support::build_struct_json_patch;
use serde_json::Value;
use sp_consensus_aura::sr25519::AuthorityId as AuraId;
use sp_consensus_grandpa::AuthorityId as GrandpaId;
use sp_genesis_builder::{self, PresetId};
use sp_keyring::{Ed25519Keyring, Sr25519Keyring};

/// Assemble a genesis patch from the given parameters.
fn testnet_genesis(
    initial_authorities: Vec<(AuraId, GrandpaId)>,
    endowed_accounts: Vec<AccountId>,
    root: AccountId,
    initial_roles: Vec<(AccountId, Role)>,
) -> Value {
    build_struct_json_patch!(RuntimeGenesisConfig {
        balances: BalancesConfig {
            balances: endowed_accounts
                .iter()
                .cloned()
                .map(|k| (k, 1u128 << 60))
                .collect::<Vec<_>>(),
        },
        aura: pallet_aura::GenesisConfig {
            authorities: initial_authorities
                .iter()
                .map(|x| x.0.clone())
                .collect::<Vec<_>>(),
        },
        grandpa: pallet_grandpa::GenesisConfig {
            authorities: initial_authorities
                .iter()
                .map(|x| (x.1.clone(), 1))
                .collect::<Vec<_>>(),
        },
        sudo: SudoConfig { key: Some(root) },
        access_control: pallet_access_control::GenesisConfig { initial_roles },
    })
}

/// Roles granted at genesis on the development chains.
///
/// This is what makes the chain usable at all. `pallet-access-control` can only
/// ever gain its first `Admin` here — `assign_role` requires an existing Admin
/// and refuses to create one — and without an Admin nothing downstream works:
/// `PatientIdentity::register_patient`,
/// `MedicalRecords::upsert_emergency_capsule_commitment` and
/// `AccessControl::log_delegated_access` all gate on
/// `is_healthcare_provider` / `can_edit_medical_records`.
///
/// Alice is granted `Admin` deliberately: the MediChain API's operator signer
/// falls back to `//Alice` when `SUBSTRATE_ALLOW_DEV_SIGNER=true`, and `Admin`
/// satisfies `is_healthcare_provider`. Bob gets `Doctor` so the non-Admin
/// provider path is exercisable too.
fn development_roles() -> Vec<(AccountId, Role)> {
    vec![
        (Sr25519Keyring::Alice.to_account_id(), Role::Admin),
        (Sr25519Keyring::Bob.to_account_id(), Role::Doctor),
        (Sr25519Keyring::Charlie.to_account_id(), Role::Nurse),
    ]
}

/// The `--dev` chain: a single Alice authority.
pub fn development_config_genesis() -> Value {
    testnet_genesis(
        vec![(
            Sr25519Keyring::Alice.public().into(),
            Ed25519Keyring::Alice.public().into(),
        )],
        vec![
            Sr25519Keyring::Alice.to_account_id(),
            Sr25519Keyring::Bob.to_account_id(),
            Sr25519Keyring::Charlie.to_account_id(),
            Sr25519Keyring::AliceStash.to_account_id(),
            Sr25519Keyring::BobStash.to_account_id(),
        ],
        Sr25519Keyring::Alice.to_account_id(),
        development_roles(),
    )
}

/// The `local` chain: two authorities, for multi-node testing on one machine.
pub fn local_config_genesis() -> Value {
    testnet_genesis(
        vec![
            (
                Sr25519Keyring::Alice.public().into(),
                Ed25519Keyring::Alice.public().into(),
            ),
            (
                Sr25519Keyring::Bob.public().into(),
                Ed25519Keyring::Bob.public().into(),
            ),
        ],
        Sr25519Keyring::iter()
            .filter(|v| v != &Sr25519Keyring::One && v != &Sr25519Keyring::Two)
            .map(|v| v.to_account_id())
            .collect::<Vec<_>>(),
        Sr25519Keyring::Alice.to_account_id(),
        development_roles(),
    )
}

/// JSON representation of the predefined genesis config for `id`.
pub fn get_preset(id: &PresetId) -> Option<Vec<u8>> {
    let patch = match id.as_ref() {
        sp_genesis_builder::DEV_RUNTIME_PRESET => development_config_genesis(),
        sp_genesis_builder::LOCAL_TESTNET_RUNTIME_PRESET => local_config_genesis(),
        _ => return None,
    };
    Some(
        serde_json::to_string(&patch)
            .expect("serialization to json is expected to work. qed.")
            .into_bytes(),
    )
}

/// Supported preset names.
pub fn preset_names() -> Vec<PresetId> {
    vec![
        PresetId::from(sp_genesis_builder::DEV_RUNTIME_PRESET),
        PresetId::from(sp_genesis_builder::LOCAL_TESTNET_RUNTIME_PRESET),
    ]
}
