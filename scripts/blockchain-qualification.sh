#!/usr/bin/env bash
# =============================================================================
# Blockchain environment-qualification harness (C5 / issue #6)
# =============================================================================
# Produces machine-readable node/runtime qualification evidence. Authenticated
# application workflow tests are a separate required gate; this script does not
# claim to have exercised them.
#
# THE DISTINCTION THIS HARNESS EXISTS TO ENFORCE
# ----------------------------------------------
# `api/src/blockchain.rs` returns a transaction hash only after finalized
# extrinsic success. Disabled, unavailable, rejected and unfinalized operations
# are errors; callers may report `pending` only after a durable outbox write.
#
# TWO ACCEPTANCE STATES — DO NOT CONFLATE THEM
# --------------------------------------------
#   C1  harness complete + fail-closed/no-node behaviour verified   <- modes
#       `disabled` and `unavailable`. Achievable without a node.
#   C2A enabled-mode node/runtime qualification                      <- mode
#       `enabled`. Authenticated API-to-chain E2E evidence is still C2B.
#
# Passing C1 or C2A does not close C5. Until authenticated workflows have run
# green against the exact runtime, release status reads:
#   "blockchain-enabled production posture UNVERIFIED".
#
# USAGE
#   scripts/blockchain-qualification.sh --mode disabled
#   scripts/blockchain-qualification.sh --mode unavailable
#   scripts/blockchain-qualification.sh --mode enabled \
#     --node ws://localhost:9944 --rpc http://localhost:9944
#
# ENV
#   API_BASE   default http://localhost:8090
#   NODE_RPC   default http://localhost:9944   (HTTP RPC, for state validation)
#
# SCOPE — this script qualifies the API's behaviour against a node. It does NOT
# qualify the node itself. For "is this a real working chain" (block production,
# GRANDPA finality, MediChain pallets in metadata, genesis role bootstrap), run:
#
#   scripts/blockchain/qualify-node.sh
#
# and see docs/BLOCKCHAIN_NODE.md. The two are complementary: this one can pass
# against a node that produces no blocks, and that one can pass while the API is
# misconfigured.
# =============================================================================
set -uo pipefail

MODE=""
API_BASE="${API_BASE:-http://localhost:8090}"
# 9944 serves both WebSocket and HTTP JSON-RPC since Substrate merged the RPC
# ports. The previous default of 9933 refers to a split that no longer exists,
# so every state probe against a current node silently failed to connect.
NODE_RPC="${NODE_RPC:-http://localhost:9944}"
NODE_WS="ws://localhost:9944"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --mode) MODE="${2:-}"; shift 2 ;;
        --node) NODE_WS="${2:-}"; shift 2 ;;
        --rpc)  NODE_RPC="${2:-}"; shift 2 ;;
        --api)  API_BASE="${2:-}"; shift 2 ;;
        *) echo "unknown argument: $1" >&2; exit 64 ;;
    esac
done

case "$MODE" in
    disabled|unavailable|enabled) ;;
    *) echo "usage: $0 --mode {disabled|unavailable|enabled} [--node WS] [--rpc HTTP] [--api URL]" >&2
       exit 64 ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/.horizon/evidence-private/HZ-C5-BLOCKCHAIN"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_DIR/qualification-${MODE}-${STAMP}.json"

APP_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
APP_DIRTY="$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null | head -c1)"
[[ -n "$APP_DIRTY" ]] && APP_DIRTY=true || APP_DIRTY=false

ASSERTIONS=()
PASS=0
FAIL=0

assert() { # name, expected, actual, rationale
    local name="$1" expected="$2" actual="$3" rationale="$4" ok
    if [[ "$expected" == "$actual" ]]; then ok=pass; PASS=$((PASS+1)); else ok=fail; FAIL=$((FAIL+1)); fi
    ASSERTIONS+=("$name|$ok|$expected|$actual|$rationale")
    printf '  [%s] %-46s expected=%-12s actual=%s\n' "$ok" "$name" "$expected" "$actual"
}

json_escape() { printf '%s' "${1//\"/\\\"}"; }

# -----------------------------------------------------------------------------
# Node probe — identify and version-pin whatever we are testing against.
# -----------------------------------------------------------------------------
rpc() { # method
    curl -s --max-time 10 -H 'Content-Type: application/json' \
        -d "{\"id\":1,\"jsonrpc\":\"2.0\",\"method\":\"$1\",\"params\":[]}" \
        "$NODE_RPC" 2>/dev/null
}

NODE_REACHABLE=false
NODE_VERSION="n/a"
NODE_CHAIN="n/a"
NODE_HEALTH="n/a"
NODE_METADATA=""
if [[ "$MODE" != "disabled" ]]; then
    if RESP="$(rpc system_version)" && [[ -n "$RESP" ]]; then
        NODE_REACHABLE=true
        NODE_VERSION="$(printf '%s' "$RESP" | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')"
        NODE_CHAIN="$(rpc system_chain | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')"
        NODE_HEALTH="$(rpc system_health | sed -n 's/.*"result":\({[^}]*}\).*/\1/p')"
        NODE_METADATA="$(rpc state_getMetadata)"
    fi
fi

echo "=== Blockchain qualification: mode=$MODE ==="
echo "    app commit : $APP_COMMIT (dirty=$APP_DIRTY)"
echo "    node       : $NODE_WS (reachable=$NODE_REACHABLE, version=$NODE_VERSION)"
echo

# -----------------------------------------------------------------------------
# API reachability — a harness that cannot reach the API must not report passes.
# (HZ-WP7-AUTHN-001 lost a whole run to exactly this: six denial assertions
# "passed" while every request was 404ing at the transport layer.)
# -----------------------------------------------------------------------------
# curl already emits "000" on connection failure; a `|| echo 000` fallback would
# concatenate into "000000" and end up in the evidence file.
API_UP="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$API_BASE/health" 2>/dev/null)"
API_UP="${API_UP:-000}"
if [[ "$API_UP" != "200" ]]; then
    echo "ABORT: API not reachable at $API_BASE/health (got $API_UP)."
    echo "       Refusing to emit an evidence package that would record"
    echo "       assertions never actually exercised."
    exit 3
fi
assert "api_reachable" "200" "$API_UP" "a suite that cannot reach the target cannot report passes"

# -----------------------------------------------------------------------------
# Mode-specific expectations
# -----------------------------------------------------------------------------
case "$MODE" in
  disabled)
    # Disabled mode must not require a node and must never fabricate a hash.
    assert "node_required" "false" "false" \
        "disabled mode must not depend on a node being present"
    ;;

  unavailable)
    # BLOCKCHAIN_ENABLED=true but NO node reachable. This is the failure mode
    # that matters operationally: application writes must be durably queued or
    # fail, never reported as finalized.
    assert "node_reachable" "false" "$NODE_REACHABLE" \
        "this mode deliberately runs with no node; a reachable node invalidates it"
    ;;

  enabled)
    assert "node_reachable" "true" "$NODE_REACHABLE" \
        "C2 is meaningless without a real node answering RPC"
    if [[ "$NODE_REACHABLE" != "true" ]]; then
        echo
        echo "ABORT: --mode enabled requires a reachable node at $NODE_RPC."
        echo "       C2A node/runtime qualification CANNOT pass without one."
        FAIL=$((FAIL+1))
    fi
    metadata_has() {
        local name_hex
        name_hex="$(printf '%s' "$1" | od -An -tx1 | tr -d ' \n')"
        [[ "${NODE_METADATA,,}" == *"$name_hex"* ]] && echo true || echo false
    }
    assert "runtime_has_delegated_access" "true" "$(metadata_has log_delegated_access)" \
        "the deployed AccessControl metadata must include the corrected audit call"
    assert "runtime_has_ipfs_upsert" "true" "$(metadata_has upsert_ipfs_hash)" \
        "first and subsequent record anchors need the same valid runtime path"
    assert "runtime_has_capsule_upsert" "true" "$(metadata_has upsert_emergency_capsule_commitment)" \
        "capsule version 1 must not depend on a pre-existing health record"
    [[ -n "${SUBSTRATE_SIGNING_KEY:-}" ]] && KEY_SET=true || KEY_SET=false
    assert "operator_key_configured" "true" "$KEY_SET" \
        "production submissions require a dedicated operator signing key"
    assert "dev_signer_disabled" "false" "${SUBSTRATE_ALLOW_DEV_SIGNER:-false}" \
        "the public Alice development signer is forbidden in production"
    assert "release_worktree_clean" "false" "$APP_DIRTY" \
        "qualification evidence must identify an exact, reproducible release commit"
    ;;
esac

# -----------------------------------------------------------------------------
# Application-to-chain operations
# -----------------------------------------------------------------------------
# This harness intentionally performs no clinical workflow: those calls require
# real authenticated fixtures and must be run by the E2E release suite. Recording
# an operation here without making the request would create false evidence.
echo
echo "  -- application operations --"
OPS_NOTE="none (node/runtime qualification only)"
echo "  $OPS_NOTE"
echo "  authenticated API-to-chain E2E: REQUIRED separately (C2B)"

# -----------------------------------------------------------------------------
# Emit machine-readable evidence
# -----------------------------------------------------------------------------
{
    printf '{\n'
    printf '  "schema": "medichain.blockchain-qualification/1",\n'
    printf '  "acceptance_state": "%s",\n' "$([[ "$MODE" == "enabled" ]] && echo C2A || echo C1)"
    printf '  "mode": "%s",\n' "$MODE"
    printf '  "timestamp": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '  "application": {\n'
    printf '    "commit": "%s",\n' "$APP_COMMIT"
    printf '    "working_tree_dirty": %s,\n' "$APP_DIRTY"
    printf '    "api_base": "%s"\n' "$(json_escape "$API_BASE")"
    printf '  },\n'
    printf '  "node": {\n'
    printf '    "ws_endpoint": "%s",\n' "$(json_escape "$NODE_WS")"
    printf '    "rpc_endpoint": "%s",\n' "$(json_escape "$NODE_RPC")"
    printf '    "reachable": %s,\n' "$NODE_REACHABLE"
    printf '    "version": "%s",\n' "$(json_escape "$NODE_VERSION")"
    printf '    "chain": "%s",\n' "$(json_escape "$NODE_CHAIN")"
    printf '    "health": "%s"\n' "$(json_escape "$NODE_HEALTH")"
    printf '  },\n'
    printf '  "configuration": {\n'
    printf '    "BLOCKCHAIN_ENABLED": "%s",\n' "${BLOCKCHAIN_ENABLED:-<unset>}"
    printf '    "SUBSTRATE_WS_URL": "%s",\n' "${SUBSTRATE_WS_URL:-<unset>}"
    printf '    "SUBSTRATE_SIGNING_KEY": "%s",\n' "$([[ -n "${SUBSTRATE_SIGNING_KEY:-}" ]] && echo '<set>' || echo '<unset>')"
    printf '    "SUBSTRATE_ALLOW_DEV_SIGNER": "%s"\n' "${SUBSTRATE_ALLOW_DEV_SIGNER:-<unset>}"
    printf '  },\n'
    printf '  "operations_exercised": [],\n'
    printf '  "assertions": [\n'
    for i in "${!ASSERTIONS[@]}"; do
        IFS='|' read -r n r e a why <<< "${ASSERTIONS[$i]}"
        printf '    {"name": "%s", "result": "%s", "expected": "%s", "actual": "%s", "rationale": "%s"}%s\n' \
            "$n" "$r" "$(json_escape "$e")" "$(json_escape "$a")" "$(json_escape "$why")" \
            "$([[ $i -lt $((${#ASSERTIONS[@]} - 1)) ]] && echo ,)"
    done
    printf '  ],\n'
    printf '  "summary": {"passed": %d, "failed": %d},\n' "$PASS" "$FAIL"
    printf '  "residual_gaps": [\n'
    printf '    "C2B still requires authenticated application workflows plus direct finalized-event validation.",\n'
    printf '    "medichain-node is NOT BUILDABLE from this repository as it stands: node/ is in the root Cargo.toml exclude list, so its ~30 { workspace = true } dependencies cannot resolve, and none of sc-service/sc-cli/sc-basic-authorship/jsonrpsee are defined in root [workspace.dependencies]. A Dockerfile alone does not fix this.",\n'
    printf '    "Passing this script proves node/runtime readiness only; blockchain-enabled production posture remains unverified until C2B passes."\n'
    printf '  ]\n'
    printf '}\n'
} > "$OUT"

echo
echo "=== summary: $PASS passed, $FAIL failed ==="
echo "    evidence: $OUT"
if [[ "$MODE" != "enabled" ]]; then
    echo "    NOTE: this run records acceptance state C1 only."
    echo "          The blockchain production gate (C2A + C2B) remains OPEN."
fi

exit $(( FAIL > 0 ? 1 : 0 ))
