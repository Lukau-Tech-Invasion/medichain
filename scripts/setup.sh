#!/bin/bash
# Setup script for MediChain
set -e

# Install Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
rustup component add clippy rustfmt

# Install cargo tools
cargo install cargo-audit
cargo install cargo-deny
cargo install cargo-tarpaulin

echo "Setup complete."
