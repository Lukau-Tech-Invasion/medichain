//! MediChain chain specifications.
//!
//! Genesis content lives in the runtime, as `genesis_config_presets`, and is
//! selected here by preset name. (The previous version called
//! `ChainSpec::from_genesis`, which no longer exists, and built a genesis with
//! no Aura or GRANDPA authorities — a chain that could not have produced a
//! single block.)
//!
//! Both specs below are DEVELOPMENT chains using well-known public keys. See
//! `medichain_runtime::genesis_config_presets` for the specifics, and
//! `docs/BLOCKCHAIN_NODE.md` for what a production spec would have to supply.

use medichain_runtime::WASM_BINARY;
use sc_service::ChainType;

/// Specialized `ChainSpec` for MediChain.
pub type ChainSpec = sc_service::GenericChainSpec;

/// Single-authority development chain (`--dev`).
pub fn development_chain_spec() -> Result<ChainSpec, String> {
    Ok(ChainSpec::builder(
        WASM_BINARY.ok_or_else(|| "Development wasm not available".to_string())?,
        None,
    )
    .with_name("MediChain Development")
    .with_id("medichain_dev")
    .with_chain_type(ChainType::Development)
    .with_genesis_config_preset_name(sp_genesis_builder::DEV_RUNTIME_PRESET)
    .build())
}

/// Two-authority local test chain, for running more than one node on one host.
pub fn local_chain_spec() -> Result<ChainSpec, String> {
    Ok(ChainSpec::builder(
        WASM_BINARY.ok_or_else(|| "Development wasm not available".to_string())?,
        None,
    )
    .with_name("MediChain Local Testnet")
    .with_id("medichain_local")
    .with_chain_type(ChainType::Local)
    .with_genesis_config_preset_name(sp_genesis_builder::LOCAL_TESTNET_RUNTIME_PRESET)
    .build())
}
