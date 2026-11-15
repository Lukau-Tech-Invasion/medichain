#!/bin/bash
# ==============================================================================
# MediChain PostgreSQL Integration Test
# Verifies database connectivity and that the seeded fixture accounts can sign in
# (seed them first: scripts/seed-browser-test-fixtures.ts).
# ==============================================================================

set -e

echo ""
echo "=============================================================================="
echo "  MEDICHAIN POSTGRESQL INTEGRATION TEST"
echo "=============================================================================="
echo ""

# Configuration
API_URL="${API_URL:-http://localhost:8090}"
BASE="$API_URL"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/actors.sh
. "$SCRIPT_DIR/lib/actors.sh"
actors_init

# fixture ROLE — "login_id password" of the first fixture with that role, read
# from the manifest the seeder wrote. Credentials live only in that file.
fixture() {
    python - "$SCRIPT_DIR/../.browser-test/fixtures.json" "$1" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
role = sys.argv[2]
rows = [m["patient"]] if role == "Patient" else [s for s in m["staff"] if s["role"] == role]
r = rows[0]
print(r["login_id"], r.get("password", ""))
PY
}

PASSED=0
FAILED=0

# Test function
test_endpoint() {
    local name="$1"
    local url="$2"
    local actor="$3"
    local expected="$4"
    
    echo -n "  Testing: $name... "
    
    if [ -n "$actor" ]; then
        response=$(curl -s -H "Authorization: Bearer $(tok_of "$actor")" "$url")
    else
        response=$(curl -s "$url")
    fi
    
    if echo "$response" | grep -q "$expected"; then
        echo "✅ PASSED"
        ((PASSED++))
    else
        echo "❌ FAILED"
        echo "    Expected: $expected"
        echo "    Got: $response"
        ((FAILED++))
    fi
}

# Wait for API to be ready
echo "[1/5] Checking API availability..."
for i in {1..10}; do
    if curl -s "$API_URL/health" | grep -q "ok"; then
        echo "  ✅ API is running at $API_URL"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "  ❌ API not available at $API_URL"
        echo "     Please start the API first: cargo run -p medichain-api"
        exit 1
    fi
    echo "  Waiting for API... (attempt $i/10)"
    sleep 2
done

echo ""
echo "[2/5] Testing health endpoints..."
test_endpoint "Basic health" "$API_URL/health" "" "ok"
test_endpoint "Database health" "$API_URL/health/db" "" "connected\|healthy"

echo ""
echo "[3/5] Testing demo endpoints..."
test_endpoint "Demo info" "$API_URL/api/demo/info" "" "demo_users"

echo ""
echo "[4/5] Testing credential sign-in and RBAC..."
for pair in "admin Admin" "doctor Doctor" "patient Patient"; do
    set -- $pair
    read -r login password <<< "$(fixture "$2")"
    echo "  Signing in as the $1 fixture: $(login_as "$1" "$login" "${password:-${MEDICHAIN_ADMIN_PASSWORD:-}}")"
done
test_endpoint "Admin access" "$API_URL/api/users" "admin" "user_id\|Admin"
test_endpoint "Doctor access" "$API_URL/api/users/me" "doctor" "Doctor\|user_id"
test_endpoint "Patient access" "$API_URL/api/users/me" "patient" "Patient\|user_id"
test_endpoint "An unknown bearer token is refused" "$API_URL/api/users/me" "never-signed-in" "INVALID\|UNAUTHORIZED\|error"

echo ""
echo "[5/5] Testing demo user count..."
# Get user count
user_count=$(curl -s -H "Authorization: Bearer $(tok_of admin)" "$API_URL/api/users" | grep -o '"user_id"' | wc -l)
echo "  Found $user_count users in system"
if [ "$user_count" -ge 10 ]; then
    echo "  ✅ Fixture users loaded correctly (expected at least 10)"
    ((PASSED++))
else
    echo "  ❌ Fewer users than expected (expected at least 10, got: $user_count)"
    ((FAILED++))
fi

echo ""
echo "=============================================================================="
echo "  TEST RESULTS"
echo "=============================================================================="
echo ""
echo "  Passed: $PASSED"
echo "  Failed: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
    echo "  🎉 All tests passed! PostgreSQL integration is working correctly."
    exit 0
else
    echo "  ⚠️  Some tests failed. Check the output above for details."
    exit 1
fi
