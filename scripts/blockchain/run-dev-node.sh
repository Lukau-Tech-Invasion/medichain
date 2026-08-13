#!/usr/bin/env bash
# =============================================================================
# Run a MediChain development blockchain node.
# =============================================================================
# THIS IS A DEVELOPMENT CHAIN. It authors blocks with the well-known `//Alice`
# key, whose seed is public. Never point this at anything real.
#
# Usage:
#   scripts/blockchain/run-dev-node.sh                  # ephemeral, wiped on exit
#   scripts/blockchain/run-dev-node.sh --persist        # keeps state in ./data
#   NODE_BIN=/path/to/medichain-node scripts/blockchain/run-dev-node.sh
#
# The binary is looked up in this order:
#   1. $NODE_BIN
#   2. blockchain/target/release/medichain-node   (local release build)
#   3. blockchain/target/debug/medichain-node     (local debug build)
# A CI-built artifact can be used by setting NODE_BIN; see docs/BLOCKCHAIN_NODE.md.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_PATH="${BASE_PATH:-$REPO_ROOT/data/medichain-chain}"
RPC_PORT="${RPC_PORT:-9944}"
P2P_PORT="${P2P_PORT:-30333}"
PERSIST=0

for arg in "$@"; do
    case "$arg" in
        --persist) PERSIST=1 ;;
        -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) echo "unknown argument: $arg" >&2; exit 64 ;;
    esac
done

resolve_node_bin() {
    if [[ -n "${NODE_BIN:-}" ]]; then
        printf '%s' "$NODE_BIN"; return 0
    fi
    for candidate in \
        "$REPO_ROOT/blockchain/target/release/medichain-node" \
        "$REPO_ROOT/blockchain/target/debug/medichain-node"; do
        [[ -x "$candidate" ]] && { printf '%s' "$candidate"; return 0; }
    done
    return 1
}

if ! NODE="$(resolve_node_bin)"; then
    cat >&2 <<'EOF'
error: no medichain-node binary found.

Build it locally:
    scripts/blockchain/build-node.sh

...or download the CI-built artifact and point NODE_BIN at it:
    NODE_BIN=~/Downloads/medichain-node scripts/blockchain/run-dev-node.sh

Local release builds of the Polkadot SDK need roughly 20 GB of free disk.
EOF
    exit 1
fi

echo "node binary : $NODE"
"$NODE" --version

# RPC binds to localhost only. `--rpc-external` is deliberately NOT set: it
# would expose an unauthenticated RPC endpoint on all interfaces.
ARGS=(
    --dev
    --rpc-port "$RPC_PORT"
    --port "$P2P_PORT"
)

if [[ "$PERSIST" -eq 1 ]]; then
    mkdir -p "$BASE_PATH"
    ARGS+=(--base-path "$BASE_PATH")
    echo "state       : PERSISTENT at $BASE_PATH"
else
    # Without --base-path, --dev uses a temporary directory that is discarded.
    echo "state       : EPHEMERAL (discarded on exit; pass --persist to keep it)"
fi

echo "RPC/WS      : ws://127.0.0.1:$RPC_PORT   (set SUBSTRATE_WS_URL to this)"
echo

exec "$NODE" "${ARGS[@]}"
