#!/bin/bash
# Run all tests and checks for MediChain
set -e

cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
cargo audit
cargo deny check
cargo tarpaulin --workspace --ignore-tests

echo "All tests and checks passed."
