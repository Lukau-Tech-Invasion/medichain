#!/usr/bin/env bash
# =============================================================================
# MediChain node persistence qualification
# =============================================================================
# Proves that a node started with --base-path resumes its chain across a restart
# instead of quietly starting a new one. Starting over from genesis looks almost
# identical from the outside -- blocks are produced either way -- so this checks
# the two things that actually distinguish them:
#
#   * the genesis hash is unchanged  (same chain, not a fresh one)
#   * the finalized height does not go backwards to zero
#
# It manages its own node process and cleans it up on exit. It does not touch
# any other running service.
#
# USAGE
#   scripts/blockchain/qualify-persistence.sh
#   NODE_BIN=~/medichain-node scripts/blockchain/qualify-persistence.sh
#
# ENV
#   NODE_BIN    path to medichain-node (else looked up as in run-dev-node.sh)
#   BASE_PATH   chain data directory (default ./data/medichain-persist-check)
#   RPC_PORT    default 9944
#
# Exits non-zero on any failure.
# =============================================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_PATH="${BASE_PATH:-$REPO_ROOT/data/medichain-persist-check}"
RPC_PORT="${RPC_PORT:-9944}"
RPC_URL="http://127.0.0.1:${RPC_PORT}"
# 6s blocks; GRANDPA needs a few before it finalizes anything.
SETTLE_SECONDS="${SETTLE_SECONDS:-45}"

PY="$(command -v python3 || command -v python || true)"
[[ -z "$PY" ]] && { echo "error: python3 is required" >&2; exit 1; }

NODE_PID=""
cleanup() {
    if [[ -n "$NODE_PID" ]] && kill -0 "$NODE_PID" 2>/dev/null; then
        kill -TERM "$NODE_PID" 2>/dev/null || true
        wait "$NODE_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

resolve_node_bin() {
    # An explicit NODE_BIN is validated, not trusted: otherwise a typo'd path
    # surfaces later as "node exited early" with a confusing log tail, instead
    # of saying plainly that the file is not there.
    if [[ -n "${NODE_BIN:-}" ]]; then
        [[ -x "$NODE_BIN" ]] || {
            echo "error: NODE_BIN='$NODE_BIN' is not an executable file" >&2
            return 1
        }
        printf '%s' "$NODE_BIN"
        return 0
    fi
    for c in "$REPO_ROOT/.node-bin/medichain-node" \
             "$REPO_ROOT/blockchain/target/release/medichain-node" \
             "$REPO_ROOT/blockchain/target/debug/medichain-node"; do
        [[ -x "$c" ]] && { printf '%s' "$c"; return 0; }
    done
    return 1
}

NODE="$(resolve_node_bin)" || {
    echo "error: no medichain-node binary found. See docs/BLOCKCHAIN_NODE.md." >&2
    exit 1
}

rpc() {
    local method="$1" params="${2:-[]}" body resp
    body=$(printf '{"jsonrpc":"2.0","id":1,"method":"%s","params":%s}' "$method" "$params")
    resp=$(curl -s --max-time 10 -H 'Content-Type: application/json' -d "$body" "$RPC_URL" 2>/dev/null) || return 1
    [[ -z "$resp" ]] && return 1
    printf '%s' "$resp" | "$PY" -c '
import json,sys
d=json.load(sys.stdin)
r=d.get("result")
if r is None: sys.exit(1)
print(json.dumps(r) if isinstance(r,(dict,list)) else r)
' 2>/dev/null
}

start_node() {
    local label="$1"
    echo "--- starting node ($label) ---"
    "$NODE" --dev --base-path "$BASE_PATH" --rpc-port "$RPC_PORT" \
        > "$BASE_PATH.$label.log" 2>&1 &
    NODE_PID=$!
    # Wait for RPC rather than sleeping blindly.
    for _ in $(seq 1 60); do
        if rpc system_chain >/dev/null 2>&1; then
            echo "  up (pid $NODE_PID)"
            return 0
        fi
        if ! kill -0 "$NODE_PID" 2>/dev/null; then
            echo "  node exited early; last log lines:" >&2
            tail -20 "$BASE_PATH.$label.log" >&2
            return 1
        fi
        sleep 1
    done
    echo "  node did not answer RPC within 60s" >&2
    tail -20 "$BASE_PATH.$label.log" >&2
    return 1
}

stop_node() {
    echo "--- stopping node gracefully (SIGTERM) ---"
    kill -TERM "$NODE_PID" 2>/dev/null || true
    for _ in $(seq 1 30); do
        kill -0 "$NODE_PID" 2>/dev/null || { echo "  stopped cleanly"; NODE_PID=""; return 0; }
        sleep 1
    done
    echo "  did not stop within 30s; killing" >&2
    kill -KILL "$NODE_PID" 2>/dev/null || true
    NODE_PID=""
    return 1
}

hex2dec() { "$PY" -c "import sys; print(int(sys.argv[1],16))" "$1" 2>/dev/null; }

finalized_height() {
    local h j
    h=$(rpc chain_getFinalizedHead) || return 1
    j=$(rpc chain_getHeader "[\"$h\"]") || return 1
    hex2dec "$("$PY" -c 'import json,sys; print(json.loads(sys.argv[1])["number"])' "$j")"
}

echo "============================================================"
echo "MediChain persistence qualification"
echo "  binary    : $NODE"
echo "  base path : $BASE_PATH"
echo "============================================================"

mkdir -p "$(dirname "$BASE_PATH")"

# ---- first run --------------------------------------------------------------
start_node run1 || exit 1
GENESIS_1=$(rpc chain_getBlockHash '[0]') || { echo "could not read genesis hash" >&2; exit 1; }
echo "  genesis: $GENESIS_1"
echo "  letting the chain produce and finalize for ${SETTLE_SECONDS}s ..."
sleep "$SETTLE_SECONDS"
HEIGHT_1=$(finalized_height)
if [[ -z "${HEIGHT_1:-}" ]]; then echo "could not read finalized height" >&2; exit 1; fi
echo "  finalized height before restart: $HEIGHT_1"
if [[ "$HEIGHT_1" -lt 1 ]]; then
    echo
    echo "RESULT: FAIL - nothing finalized before the restart, so a surviving"
    echo "        height would prove nothing. Check GRANDPA."
    exit 1
fi

stop_node

# ---- second run, same base path --------------------------------------------
start_node run2 || exit 1
GENESIS_2=$(rpc chain_getBlockHash '[0]') || { echo "could not read genesis hash" >&2; exit 1; }
HEIGHT_2=$(finalized_height)
echo "  genesis after restart: $GENESIS_2"
echo "  finalized height after restart: ${HEIGHT_2:-<none>}"

FAILURES=0
if [[ "$GENESIS_1" == "$GENESIS_2" ]]; then
    echo "  [PASS] genesis hash unchanged - same chain resumed"
else
    echo "  [FAIL] genesis hash CHANGED ($GENESIS_1 -> $GENESIS_2): a new chain was created"
    FAILURES=$((FAILURES + 1))
fi

if [[ -n "${HEIGHT_2:-}" && "$HEIGHT_2" -ge "$HEIGHT_1" ]]; then
    echo "  [PASS] finalized height survived the restart ($HEIGHT_1 -> $HEIGHT_2)"
else
    echo "  [FAIL] finalized height regressed ($HEIGHT_1 -> ${HEIGHT_2:-<none>}): state was lost"
    FAILURES=$((FAILURES + 1))
fi

echo
if [[ "$FAILURES" -eq 0 ]]; then
    echo "RESULT: PASS - chain state persisted across a graceful restart."
    echo
    echo "The chain database is at $BASE_PATH and was NOT removed."
    echo "Delete it deliberately if you want a clean slate; see the reset"
    echo "procedure in docs/BLOCKCHAIN_NODE.md."
    exit 0
else
    echo "RESULT: FAIL ($FAILURES failed)"
    exit 1
fi
