#!/bin/bash
# ============================================================================
# MediChain Comprehensive API Test Suite
# ============================================================================

BASE_URL="http://localhost:8080"
ADMIN="5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
DOCTOR="5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"
NURSE="5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL"
LABTECH="5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFc"
PHARMACIST="5Ew3MyB15VprZrjQVkpQFj8okmc9xLDSEdNhqMMS5cXsqxoW"
PATIENT="5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z"

PASSED=0
FAILED=0
TOTAL=0

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

test_endpoint() {
    local method=$1
    local endpoint=$2
    local user=$3
    local expected=$4
    local data=$5
    local name=$6
    
    TOTAL=$((TOTAL + 1))
    
    if [ -n "$data" ]; then
        response=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" \
            -H "X-User-Id: $user" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "$BASE_URL$endpoint")
    elif [ -n "$user" ]; then
        response=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" \
            -H "X-User-Id: $user" \
            "$BASE_URL$endpoint")
    else
        response=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" \
            "$BASE_URL$endpoint")
    fi
    
    if [ "$response" == "$expected" ]; then
        echo -e "  ${GREEN}✅ PASS${NC} [$response] $method $endpoint"
        PASSED=$((PASSED + 1))
    else
        echo -e "  ${RED}❌ FAIL${NC} [$response expected $expected] $method $endpoint"
        FAILED=$((FAILED + 1))
    fi
}

echo -e "${CYAN}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         MEDICHAIN COMPREHENSIVE API TEST SUITE                   ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ============================================================================
echo -e "${YELLOW}═══ HEALTH ENDPOINTS ═══${NC}"
# ============================================================================
test_endpoint "GET" "/health" "" "200"
test_endpoint "GET" "/health/db" "" "200"

# ============================================================================
echo -e "\n${YELLOW}═══ AUTH ENDPOINTS ═══${NC}"
# ============================================================================
test_endpoint "GET" "/api/auth/me" "$ADMIN" "200"
test_endpoint "GET" "/api/auth/me" "$DOCTOR" "200"
test_endpoint "GET" "/api/auth/me" "$NURSE" "200"
test_endpoint "GET" "/api/auth/me" "$PATIENT" "200"
test_endpoint "GET" "/api/auth/me" "" "401"  # No auth should fail

# ============================================================================
echo -e "\n${YELLOW}═══ USER ENDPOINTS ═══${NC}"
# ============================================================================
test_endpoint "GET" "/api/users" "$ADMIN" "200"
test_endpoint "GET" "/api/users" "$DOCTOR" "403"  # Non-admin should fail
test_endpoint "GET" "/api/users" "$PATIENT" "403"  # Patient should fail

# ============================================================================
echo -e "\n${YELLOW}═══ DASHBOARD ENDPOINTS ═══${NC}"
# ============================================================================
test_endpoint "GET" "/api/dashboard/admin" "$ADMIN" "200"
test_endpoint "GET" "/api/dashboard/doctor" "$DOCTOR" "200"
test_endpoint "GET" "/api/dashboard/nurse" "$NURSE" "200"
test_endpoint "GET" "/api/dashboard/lab" "$LABTECH" "200"
test_endpoint "GET" "/api/dashboard/patient" "$PATIENT" "200"
# Cross-role access should work (admins can see all)
test_endpoint "GET" "/api/dashboard/admin" "$DOCTOR" "403"

# ============================================================================
echo -e "\n${YELLOW}═══ CLINICAL ENDPOINTS ═══${NC}"
# ============================================================================
test_endpoint "GET" "/api/clinical/lab-panels" "$LABTECH" "200"
test_endpoint "GET" "/api/clinical/lab-panels" "$DOCTOR" "200"
test_endpoint "GET" "/api/order-sets" "$DOCTOR" "200"
test_endpoint "GET" "/api/templates/notes" "$DOCTOR" "200"
test_endpoint "GET" "/api/consent/types" "$DOCTOR" "200"

# ============================================================================
echo -e "\n${YELLOW}═══ NFC ENDPOINTS ═══${NC}"
# ============================================================================
test_endpoint "GET" "/api/nfc/cards" "$ADMIN" "200"

# ============================================================================
echo -e "\n${YELLOW}═══ NOTIFICATION ENDPOINTS ═══${NC}"
# ============================================================================
test_endpoint "GET" "/api/notifications" "$PATIENT" "200"
test_endpoint "GET" "/api/notifications" "$DOCTOR" "200"
test_endpoint "GET" "/api/messages" "$PATIENT" "200"

# ============================================================================
echo -e "\n${YELLOW}═══ NURSE TASKS ═══${NC}"
# ============================================================================
test_endpoint "GET" "/api/tasks/nurse" "$NURSE" "200"

# ============================================================================
echo -e "\n${YELLOW}═══ BARCODE ENDPOINTS ═══${NC}"
# ============================================================================
test_endpoint "POST" "/api/barcode/generate" "$LABTECH" "201" '{"entity_type":"specimen","entity_id":"SPEC-001"}'

# ============================================================================
echo -e "\n${YELLOW}═══ IPFS ENDPOINTS ═══${NC}"
# ============================================================================
test_endpoint "GET" "/api/ipfs/health" "" "200"

# ============================================================================
# Summary
# ============================================================================
echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}                         TEST SUMMARY                             ${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════════${NC}"
echo -e "  Total Tests: $TOTAL"
echo -e "  ${GREEN}Passed: $PASSED${NC}"
echo -e "  ${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ ALL TESTS PASSED!${NC}"
    exit 0
else
    echo -e "${RED}❌ SOME TESTS FAILED${NC}"
    exit 1
fi
