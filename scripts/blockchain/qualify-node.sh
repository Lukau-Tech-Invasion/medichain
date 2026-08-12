#!/usr/bin/env bash
# =============================================================================
# MediChain node qualification harness
# =============================================================================
# Verifies that a running MediChain node is a REAL working development chain,
# not merely a process that started. Every check below reads live state from the
# node over JSON-RPC and compares actual values. Nothing prints PASS unless the
# condition it names was measured.
#
# Exit status is non-zero if any gate fails.
#
# GATES
#   1  node responds and reports the expected chain
#   2  block height advances over time
#   3  finalized head advances (NOT the same as gate 2)
#   4  RPC surface: chain info, header, finalized head, runtime version, metadata
#   5  MediChain pallets are present in the runtime metadata
#   6  genesis role bootstrap is populated (AccessControl::UserRoles non-empty)
#
# Gates 7-9 (submit a synthetic extrinsic, prove inclusion, prove finalized
# read-back) require a signing client. They are exercised by the MediChain API
# via subxt and are NOT claimed here -- see docs/BLOCKCHAIN_NODE.md.
#
# USAGE
#   scripts/blockchain/qualify-node.sh
#   RPC_URL=http://127.0.0.1:9944 scripts/blockchain/qualify-node.sh
# =============================================================================
set -uo pipefail

RPC_URL="${RPC_URL:-http://127.0.0.1:9944}"
EXPECTED_SPEC_NAME="${EXPECTED_SPEC_NAME:-medichain}"
# Block time is 6s; 20s covers at least two slots with margin for a slow start.
OBSERVE_SECONDS="${OBSERVE_SECONDS:-20}"

PASSES=0
FAILURES=0

PY="$(command -v python3 || command -v python || true)"
if [[ -z "$PY" ]]; then
    echo "error: python3 (or python) is required to parse JSON-RPC responses" >&2
    exit 1
fi

pass() { printf '  [PASS] %s\n' "$*"; PASSES=$((PASSES + 1)); }
fail() { printf '  [FAIL] %s\n' "$*"; FAILURES=$((FAILURES + 1)); }

# rpc <method> [params-json] -> prints the `result` field, or returns non-zero.
rpc() {
    local method="$1" params="${2:-[]}" body response
    body=$(printf '{"jsonrpc":"2.0","id":1,"method":"%s","params":%s}' "$method" "$params")
    response=$(curl -s --max-time 10 -H 'Content-Type: application/json' -d "$body" "$RPC_URL" 2>/dev/null) || return 1
    [[ -z "$response" ]] && return 1
    printf '%s' "$response" | "$PY" -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
if "error" in d:
    sys.exit(1)
r = d.get("result")
if r is None:
    sys.exit(1)
print(json.dumps(r) if isinstance(r, (dict, list)) else r)
' 2>/dev/null
}

# hex_to_dec 0x1a -> 26
hex_to_dec() { "$PY" -c "import sys; print(int(sys.argv[1], 16))" "$1" 2>/dev/null; }

echo "============================================================"
echo "MediChain node qualification"
echo "  RPC: $RPC_URL"
echo "============================================================"

# --- Gate 1: node responds, correct chain -----------------------------------
echo
echo "Gate 1 - node responds and reports the expected chain"
if ! chain_name=$(rpc system_chain); then
    fail "no response from $RPC_URL (is the node running?)"
    echo
    echo "RESULT: FAIL ($FAILURES failed) - node unreachable, later gates not attempted."
    exit 1
fi
pass "system_chain = $chain_name"

if version_json=$(rpc state_getRuntimeVersion); then
    spec_name=$("$PY" -c 'import json,sys; print(json.loads(sys.argv[1]).get("specName",""))' "$version_json")
    spec_version=$("$PY" -c 'import json,sys; print(json.loads(sys.argv[1]).get("specVersion",""))' "$version_json")
    if [[ "$spec_name" == "$EXPECTED_SPEC_NAME" ]]; then
        pass "runtime specName = $spec_name (specVersion $spec_version)"
    else
        fail "runtime specName is '$spec_name', expected '$EXPECTED_SPEC_NAME'"
    fi
else
    fail "state_getRuntimeVersion did not respond"
fi

# --- Gate 2: block production ------------------------------------------------
echo
echo "Gate 2 - block height advances"
h0_json=$(rpc chain_getHeader)
h0=$("$PY" -c 'import json,sys; print(json.loads(sys.argv[1])["number"])' "$h0_json" 2>/dev/null)
if [[ -z "${h0:-}" ]]; then
    fail "could not read chain_getHeader"
else
    n0=$(hex_to_dec "$h0")
    echo "  observing for ${OBSERVE_SECONDS}s from block $n0 ..."
    sleep "$OBSERVE_SECONDS"
    h1_json=$(rpc chain_getHeader)
    h1=$("$PY" -c 'import json,sys; print(json.loads(sys.argv[1])["number"])' "$h1_json" 2>/dev/null)
    n1=$(hex_to_dec "${h1:-0x0}")
    if [[ "$n1" -gt "$n0" ]]; then
        pass "block height advanced $n0 -> $n1 (+$((n1 - n0)) in ${OBSERVE_SECONDS}s)"
    else
        fail "block height did NOT advance (stuck at $n0). Aura is not authoring."
    fi
fi

# --- Gate 3: finality --------------------------------------------------------
# Deliberately separate from gate 2: a chain can import blocks forever without
# GRANDPA ever finalizing one, and the MediChain API waits on finalization.
echo
echo "Gate 3 - finalized head advances (GRANDPA)"
f0_hash=$(rpc chain_getFinalizedHead)
if [[ -z "${f0_hash:-}" ]]; then
    fail "chain_getFinalizedHead did not respond"
else
    f0_json=$(rpc chain_getHeader "[\"$f0_hash\"]")
    f0=$("$PY" -c 'import json,sys; print(json.loads(sys.argv[1])["number"])' "$f0_json" 2>/dev/null)
    fn0=$(hex_to_dec "${f0:-0x0}")
    echo "  observing finalization for ${OBSERVE_SECONDS}s from block $fn0 ..."
    sleep "$OBSERVE_SECONDS"
    f1_hash=$(rpc chain_getFinalizedHead)
    f1_json=$(rpc chain_getHeader "[\"$f1_hash\"]")
    f1=$("$PY" -c 'import json,sys; print(json.loads(sys.argv[1])["number"])' "$f1_json" 2>/dev/null)
    fn1=$(hex_to_dec "${f1:-0x0}")
    if [[ "$fn1" -gt "$fn0" ]]; then
        pass "finalized head advanced $fn0 -> $fn1"
    else
        fail "finalized head did NOT advance (stuck at $fn0). GRANDPA is not finalizing."
    fi
fi

# --- Gate 4: RPC surface -----------------------------------------------------
echo
echo "Gate 4 - RPC surface"
for m in system_name system_version system_health chain_getBlockHash; do
    if rpc "$m" >/dev/null; then pass "$m responds"; else fail "$m did not respond"; fi
done

metadata=$(rpc state_getMetadata)
if [[ -n "${metadata:-}" && ${#metadata} -gt 1000 ]]; then
    pass "state_getMetadata returned ${#metadata} hex chars"
else
    fail "state_getMetadata returned nothing usable"
fi

# --- Gate 5: MediChain pallets present in metadata ---------------------------
# The metadata is SCALE-encoded, but pallet names appear as literal ASCII inside
# it. Decoding the full metadata would need a SCALE library; searching for the
# name bytes is sufficient to prove the pallet is in this runtime.
echo
echo "Gate 5 - MediChain pallets present in runtime metadata"
if [[ -n "${metadata:-}" ]]; then
    ascii=$("$PY" -c '
import sys, binascii
h = sys.argv[1]
h = h[2:] if h.startswith("0x") else h
raw = binascii.unhexlify(h)
sys.stdout.write("".join(chr(b) if 32 <= b < 127 else "." for b in raw))
' "$metadata" 2>/dev/null)
    for pallet in AccessControl PatientIdentity MedicalRecords Aura Grandpa Sudo; do
        if grep -q "$pallet" <<<"$ascii"; then
            pass "pallet '$pallet' present"
        else
            fail "pallet '$pallet' NOT found in metadata"
        fi
    done
    for call in upsert_emergency_capsule_commitment log_delegated_access; do
        if grep -q "$call" <<<"$ascii"; then
            pass "call '$call' exposed (the API submits this)"
        else
            fail "call '$call' NOT in metadata"
        fi
    done
else
    fail "no metadata to inspect"
fi

# --- Gate 6: genesis role bootstrap -----------------------------------------
# The single most load-bearing piece of chain state MediChain has. `UserRoles`
# can only ever be populated at genesis -- `assign_role` requires an existing
# Admin and refuses to create one -- and every MediChain write gates on a role.
# An empty map here means the chain is inert no matter how well it produces
# blocks, which is exactly the state every MediChain chain was in before the
# genesis config existed.
echo
echo "Gate 6 - AccessControl::UserRoles populated at genesis"
KEYLIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/substrate_keys.py"
if ! "$PY" "$KEYLIB" --self-test >/dev/null 2>&1; then
    fail "storage-key hasher self-test failed; not trusting its output"
else
    role_prefix=$("$PY" "$KEYLIB" AccessControl UserRoles)
    role_keys=$(rpc state_getKeysPaged "[\"$role_prefix\", 100, \"$role_prefix\"]")
    if [[ -n "${role_keys:-}" ]]; then
        role_count=$("$PY" -c 'import json,sys; print(len(json.loads(sys.argv[1])))' "$role_keys" 2>/dev/null)
        if [[ "${role_count:-0}" -gt 0 ]]; then
            pass "UserRoles has $role_count entries (genesis bootstrap worked)"
        else
            fail "UserRoles is EMPTY - no account can ever be granted a role; every MediChain write will fail with NotHealthcareProvider"
        fi
    else
        fail "state_getKeysPaged did not respond for the UserRoles prefix"
    fi
fi

# --- Summary -----------------------------------------------------------------
echo
echo "============================================================"
echo "passed: $PASSES    failed: $FAILURES"
if [[ "$FAILURES" -eq 0 ]]; then
    echo "RESULT: PASS (gates 1-6)"
    echo
    echo "NOT covered here: signed-extrinsic round trip (submit -> inclusion ->"
    echo "pallet execution -> finalized read-back). That runs through the"
    echo "MediChain API's subxt client; see docs/BLOCKCHAIN_NODE.md."
    exit 0
else
    echo "RESULT: FAIL"
    exit 1
fi
