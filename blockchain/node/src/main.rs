//! MediChain Node — Substrate node for the MediChain emergency medical records
//! blockchain.

#![warn(missing_docs)]

mod benchmarking;
mod chain_spec;
mod cli;
mod command;
mod rpc;
mod service;

fn main() -> sc_cli::Result<()> {
    command::run()
}
