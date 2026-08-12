//! MediChain Node — Substrate node for the MediChain emergency medical records
//! blockchain.

#![warn(missing_docs)]
// `sc_cli::Error` and `sc_service::Error` are large enums owned by the Polkadot
// SDK, and every service and subcommand entry point returns one. Boxing them is
// not ours to do, and the alternative -- dropping `-D warnings` for this
// workspace -- would give up the gate on code we do control. Scoped to this
// crate; the pallets and runtime are held to the lint.
#![allow(clippy::result_large_err)]

mod benchmarking;
mod chain_spec;
mod cli;
mod command;
mod rpc;
mod service;

fn main() -> sc_cli::Result<()> {
    command::run()
}
