#!/usr/bin/env bash
# =============================================================================
# Build the MediChain node.
# =============================================================================
# READ THIS BEFORE RUNNING: a release build of the Polkadot SDK dependency graph
# needs roughly 20 GB of free disk and can take well over an hour on a cold
# cache. If you do not have that, do NOT use this script -- download the CI-built
# binary instead:
#
#     GitHub Actions -> "Blockchain node release binary" -> artifact
#     medichain-node-linux-x86_64
#
# See docs/BLOCKCHAIN_NODE.md.
#
# Usage:
#   scripts/blockchain/build-node.sh              # release build
#   scripts/blockchain/build-node.sh --debug      # faster, much slower node
#   scripts/blockchain/build-node.sh --check      # type-check only, no binary
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="$REPO_ROOT/blockchain/Cargo.toml"
MODE="release"

for arg in "$@"; do
    case "$arg" in
        --debug) MODE="debug" ;;
        --check) MODE="check" ;;
        -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) echo "unknown argument: $arg" >&2; exit 64 ;;
    esac
done

# --- toolchain prerequisites ------------------------------------------------
# These are not optional and each fails in a way that is hard to read if missing:
#   rust-src            -> "no standard library sources found"
#   wasm target         -> "the wasm32... target is not installed"
#   libclang            -> librocksdb-sys build script dies with a DLL/link error
#   protoc              -> litep2p build script panics on `Could not find protoc`
require() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "error: required tool '$1' not found on PATH" >&2
        exit 1
    }
}
require cargo
require rustc

if ! rustc --print target-list >/dev/null 2>&1; then
    echo "error: rustc is not functional" >&2
    exit 1
fi

installed_targets="$(rustup target list --installed 2>/dev/null || true)"
if ! grep -qE 'wasm32v1-none|wasm32-unknown-unknown' <<<"$installed_targets"; then
    echo "error: no wasm target installed. Run:" >&2
    echo "    rustup target add wasm32v1-none" >&2
    exit 1
fi

if ! rustup component list --installed 2>/dev/null | grep -q 'rust-src'; then
    echo "error: rust-src component missing (the runtime wasm build needs it). Run:" >&2
    echo "    rustup component add rust-src" >&2
    exit 1
fi

if ! command -v protoc >/dev/null 2>&1 && [[ -z "${PROTOC:-}" ]]; then
    echo "error: protoc not found. Install protobuf-compiler, or set PROTOC to its path." >&2
    exit 1
fi

echo "repo     : $REPO_ROOT"
echo "manifest : $MANIFEST"
echo "mode     : $MODE"
echo

case "$MODE" in
    check)
        # SKIP_WASM_BUILD makes this a pure type-check: it does not produce a
        # usable runtime blob, so never use it to build something you intend to run.
        SKIP_WASM_BUILD=1 cargo check --manifest-path "$MANIFEST" --workspace --all-targets
        echo "type-check OK (no runtime wasm produced)"
        ;;
    debug)
        cargo build --manifest-path "$MANIFEST" -p medichain-node
        echo "built: $REPO_ROOT/blockchain/target/debug/medichain-node"
        ;;
    release)
        cargo build --release --manifest-path "$MANIFEST" -p medichain-node
        BIN="$REPO_ROOT/blockchain/target/release/medichain-node"
        echo "built: $BIN"
        "$BIN" --version
        ;;
esac
