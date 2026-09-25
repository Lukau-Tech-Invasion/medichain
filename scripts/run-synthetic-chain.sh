#!/usr/bin/env bash
# Start the synthetic-only API with real MediChain chain writes enabled.
#
# This is deliberately separate from run-synthetic-local.sh: the ordinary
# harness remains chain-disabled, while this mode requires a reachable dev node
# and a signer explicitly permitted by that node's genesis configuration.
#
# Usage after starting scripts/blockchain/run-dev-node.sh --persist:
#   bash scripts/run-synthetic-chain.sh
#   CHAIN_STORAGE=postgres bash scripts/run-synthetic-chain.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export IS_DEMO=true
export MEDICHAIN_DEV_MODE=true
export REQUIRE_SIGNATURES=false
export BLOCKCHAIN_ENABLED=true
export SUBSTRATE_WS_URL=${SUBSTRATE_WS_URL:-ws://127.0.0.1:9944}
export SUBSTRATE_SIGNING_KEY=${SUBSTRATE_SIGNING_KEY:-//Alice}
export MEDICHAIN_BOOTSTRAP_KEY=${MEDICHAIN_BOOTSTRAP_KEY:-synthetic-test-bootstrap-key-2026}
export CLINIC_UTC_OFFSET_MINUTES=${CLINIC_UTC_OFFSET_MINUTES:-120}
export RUST_LOG=${RUST_LOG:-info}
export PORT=${PORT:-8092}
export IPFS_API_URL=${IPFS_API_URL:-http://127.0.0.1:5001}
export IPFS_GATEWAY_URL=${IPFS_GATEWAY_URL:-http://127.0.0.1:8080}

case "${CHAIN_STORAGE:-memory}" in
  memory)
    unset MEDICHAIN_STORAGE DATABASE_URL
    ;;
  postgres)
    export MEDICHAIN_STORAGE=postgres
    export DATABASE_URL=${DATABASE_URL:-postgres://medichain_horizon:horizon-isolated-synthetic-only@127.0.0.1:55432/medichain_horizon}
    ;;
  *)
    echo "error: CHAIN_STORAGE must be 'memory' or 'postgres'" >&2
    exit 64
    ;;
esac

RPC_URL=${SUBSTRATE_WS_URL/ws:\/\//http://}
RPC_URL=${RPC_URL/wss:\/\//https://}
if ! curl -fsS --max-time 5 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"system_health","params":[]}' \
  "$RPC_URL" >/dev/null; then
  echo "error: chain-enabled mode requires a reachable node at $SUBSTRATE_WS_URL" >&2
  exit 1
fi

exec ./target/debug/medichain-api.exe
