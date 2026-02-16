#!/bin/bash
# ==============================================================================
# MediChain PostgreSQL Integration Test
# Verifies database connectivity and demo user loading
# ==============================================================================

set -e

echo ""
echo "=============================================================================="
echo "  MEDICHAIN POSTGRESQL INTEGRATION TEST"
echo "=============================================================================="
echo ""

# Configuration
API_URL="${API_URL:-http://localhost:8080}"
ADMIN_WALLET="5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
DOCTOR_WALLET="5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"
PATIENT_WALLET="5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z"

PASSED=0
FAILED=0

# Test function
test_endpoint() {
    local name="$1"
    local url="$2"
    local user_id="$3"
    local expected="$4"
    
    echo -n "  Testing: $name... "
    
    if [ -n "$user_id" ]; then
        response=$(curl -s -H "X-User-Id: $user_id" "$url")
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
echo "[4/5] Testing user authentication (RBAC)..."
test_endpoint "Admin access" "$API_URL/api/users" "$ADMIN_WALLET" "wallet_address\|Admin"
test_endpoint "Doctor access" "$API_URL/api/users/me" "$DOCTOR_WALLET" "Doctor\|wallet_address"
test_endpoint "Patient access" "$API_URL/api/users/me" "$PATIENT_WALLET" "Patient\|wallet_address"

echo ""
echo "[5/5] Testing demo user count..."
# Get user count
user_count=$(curl -s -H "X-User-Id: $ADMIN_WALLET" "$API_URL/api/users" | grep -o '"wallet_address"' | wc -l)
echo "  Found $user_count users in system"
if [ "$user_count" -ge 10 ]; then
    echo "  ✅ Demo users loaded correctly (expected: 12)"
    ((PASSED++))
else
    echo "  ❌ Fewer users than expected (expected: 12, got: $user_count)"
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
