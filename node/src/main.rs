//! # MediChain Node

//! Entry point for the MediChain blockchain node.

mod chain_spec;
mod rpc;
mod service;

use sc_cli::{ChainSpec, RuntimeAdapter, SubstrateCli};

#[derive(clap::Parser)]
pub struct Cli {
    #[command(subcommand)]
    pub subcommand: Option<Subcommand>,

    #[clap(flatten)]
    pub run: sc_cli::RunCmd,
}

#[derive(clap::Subcommand)]
pub enum Subcommand {
    /// Build a chain specification.
    BuildSpec(sc_cli::BuildSpecCmd),

    /// Export the genesis state of the block.
    ExportGenesisState(sc_cli::ExportGenesisStateCmd),

    /// Export the genesis wasm of the block.
    ExportGenesisWasm(sc_cli::ExportGenesisWasmCmd),

    /// Validate blocks.
    CheckBlock(sc_cli::CheckBlockCmd),

    /// Export blocks.
    ExportBlocks(sc_cli::ExportBlocksCmd),

    /// Import blocks.
    ImportBlocks(sc_cli::ImportBlocksCmd),

    /// Revert the chain to a previous state.
    Revert(sc_cli::RevertCmd),

    /// Remove the whole chain.
    PurgeChain(sc_cli::PurgeChainCmd),
}

impl SubstrateCli for Cli {
    fn impl_name() -> String {
        "MediChain Node".into()
    }

    fn impl_version() -> String {
        env!("CARGO_PKG_VERSION").into()
    }

    fn description() -> String {
        "MediChain - Emergency Medical Records on Blockchain".into()
    }

    fn author() -> String {
        "Trustware".into()
    }

    fn support_url() -> String {
        "https://github.com/medichain".into()
    }

    fn copyright_start_year() -> i32 {
        2025
    }

    fn load_spec(&self, id: &str) -> Result<Box<dyn ChainSpec>, String> {
        Ok(match id {
            "dev" => Box::new(chain_spec::development_config()?),
            "" | "local" => Box::new(chain_spec::development_config()?),
            path => Box::new(chain_spec::ChainSpec::from_json_file(std::path::PathBuf::from(path))?),
        })
    }
}

fn main() -> sc_cli::Result<()> {
    let cli = Cli::from_iter(std::env::args());

    match &cli.subcommand {
        None => {
            let runner = cli.create_runner(&cli.run)?;
            runner.run_node_until_exit(|config| async move {
                service::new_full(config).map_err(sc_cli::Error::Service)
            })
        }
        Some(subcommand) => {
            let runner = cli.create_runner(&cli.run)?;
            match subcommand {
                Subcommand::BuildSpec(cmd) => runner.sync_run(|config| cmd.run(config.chain_spec, config.network)),
                Subcommand::PurgeChain(cmd) => runner.sync_run(|config| cmd.run(config.database)),
                _ => Ok(()), // Minimal implementation
            }
        }
    }
}
