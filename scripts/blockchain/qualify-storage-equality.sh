#!/usr/bin/env bash
# Prove BC-001 end to end: finalized submission, metadata-decoded storage
# equality, node restart, unchanged storage, and a deliberate mismatch that the
# verifier must reject.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_PATH=${BASE_PATH:-$REPO_ROOT/data/medichain-storage-equality}
RPC_PORT=${RPC_PORT:-9944}
RPC_URL="http://127.0.0.1:$RPC_PORT"
SUBSTRATE_WS_URL=${SUBSTRATE_WS_URL:-ws://127.0.0.1:$RPC_PORT}
SETTLE_SECONDS=${SETTLE_SECONDS:-12}
NODE_PID=""

resolve_node_bin() {
  if [ -n "${NODE_BIN:-}" ] && [ -x "$NODE_BIN" ]; then
    printf '%s' "$NODE_BIN"
    return 0
  fi
  for candidate in \
    "$REPO_ROOT/.node-bin/medichain-node" \
    "$REPO_ROOT/blockchain/target/release/medichain-node" \
    "$REPO_ROOT/blockchain/target/debug/medichain-node"; do
    [ -x "$candidate" ] && { printf '%s' "$candidate"; return 0; }
  done
  return 1
}

NODE=$(resolve_node_bin) || {
  echo "error: no executable medichain-node binary found" >&2
  exit 1
}

rpc_ready() {
  curl -fsS --max-time 5 -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"system_health","params":[]}' \
    "$RPC_URL" >/dev/null
}

start_node() {
  local label=$1
  mkdir -p "$BASE_PATH"
  "$NODE" --dev --base-path "$BASE_PATH" --rpc-port "$RPC_PORT" \
    >"$BASE_PATH.$label.log" 2>&1 &
  NODE_PID=$!
  for _ in $(seq 1 60); do
    rpc_ready && return 0
    kill -0 "$NODE_PID" 2>/dev/null || {
      tail -30 "$BASE_PATH.$label.log" >&2
      return 1
    }
    sleep 1
  done
  echo "error: node did not become ready" >&2
  return 1
}

stop_node() {
  [ -z "$NODE_PID" ] && return 0
  kill -TERM "$NODE_PID" 2>/dev/null || true
  for _ in $(seq 1 30); do
    if ! kill -0 "$NODE_PID" 2>/dev/null; then
      wait "$NODE_PID" 2>/dev/null || true
      NODE_PID=""
      return 0
    fi
    sleep 1
  done
  echo "error: node did not stop gracefully" >&2
  return 1
}

cleanup() {
  if [ -n "$NODE_PID" ] && kill -0 "$NODE_PID" 2>/dev/null; then
    kill -TERM "$NODE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

export SUBSTRATE_WS_URL BLOCKCHAIN_ENABLED=true SUBSTRATE_SIGNING_KEY=//Alice
export CHAIN_E2E_PATIENT=${CHAIN_E2E_PATIENT:-5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty}
export CHAIN_E2E_VERSION=${CHAIN_E2E_VERSION:-$(date +%s)}
export CHAIN_E2E_COMMITMENT=${CHAIN_E2E_COMMITMENT:-$(printf 'medichain-bc001-%s' "$CHAIN_E2E_VERSION" | sha256sum | awk '{print $1}')}

echo "BC-001 storage equality: initial finalized write and read"
start_node initial
sleep "$SETTLE_SECONDS"
(cd "$REPO_ROOT" && cargo test --bin medichain-api \
  chain_e2e_capsule_commitment_reaches_finalized_success -- --ignored --nocapture)
stop_node

echo "BC-001 storage equality: restart the same base path"
start_node restarted
sleep "$SETTLE_SECONDS"

echo "BC-001 verifier falsification: a wrong commitment must fail"
CORRECT_COMMITMENT=$CHAIN_E2E_COMMITMENT
export CHAIN_E2E_COMMITMENT=$(printf '00%.0s' $(seq 1 32))
if (cd "$REPO_ROOT" && cargo test --bin medichain-api \
  chain_storage_equality_survives_restart -- --ignored --nocapture); then
  echo "error: verifier accepted a deliberately wrong commitment" >&2
  exit 1
fi

echo "BC-001 storage equality: correct state must survive restart"
export CHAIN_E2E_COMMITMENT=$CORRECT_COMMITMENT
(cd "$REPO_ROOT" && cargo test --bin medichain-api \
  chain_storage_equality_survives_restart -- --ignored --nocapture)

echo "PASS: finalized on-chain storage equals application input and survives restart"
