#!/usr/bin/env bash
# End-to-end synthetic-data exercise of the POPIA gate features.
#
# ALL DATA HERE IS FABRICATED. Names, ID numbers, phone numbers and wallet
# addresses are invented for this run and correspond to no real person.
#
# Not `set -e`: a failing assertion is a RESULT to record, not a reason to
# abandon the run. The whole point is to find out what actually happens.

BASE=${BASE:-http://127.0.0.1:8080}
PASS=0; FAIL=0
RESULTS=()

# SS58-shaped synthetic wallets (48 chars, start with 5).
ADMIN=5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
DOCTOR=5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty
PARAMEDIC=5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy
PATIENT_ADULT_WALLET=5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw

say() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

# check <name> <expected> <actual> [detail]
check() {
  local name="$1" want="$2" got="$3" detail="${4:-}"
  if [ "$want" = "$got" ]; then
    PASS=$((PASS+1)); RESULTS+=("PASS | $name | got $got")
    printf '  \033[32mPASS\033[0m %-62s %s\n' "$name" "$got"
  else
    FAIL=$((FAIL+1)); RESULTS+=("FAIL | $name | want $want got $got | $detail")
    printf '  \033[31mFAIL\033[0m %-62s want %s got %s\n' "$name" "$want" "$got"
    [ -n "$detail" ] && printf '       %s\n' "$(echo "$detail" | head -c 400)"
  fi
}

# code METHOD PATH [BODY] [USER]
code() {
  local m="$1" p="$2" b="${3:-}" u="${4:-}"
  local args=(-s -m 20 -o /tmp/mc_body -w '%{http_code}' -X "$m" "$BASE$p")
  [ -n "$u" ] && args+=(-H "X-User-Id: $u")
  [ -n "$b" ] && args+=(-H 'Content-Type: application/json' -d "$b")
  curl "${args[@]}"
}
body() { cat /tmp/mc_body 2>/dev/null; }
# jget KEY [KEY...] — walk nested JSON keys. Passed as argv, never interpolated
# into the Python source, so quoting cannot break it.
jget() { body | python -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for k in sys.argv[1:]:
    if isinstance(d, dict) and k in d:
        d = d[k]
    else:
        sys.exit(0)
print("" if d is None else d)
' "$@" 2>/dev/null; }

# ---------------------------------------------------------------------------
say "0. Liveness"
check "health endpoint" 200 "$(code GET /health)"
check "metrics endpoint" 200 "$(code GET /api/metrics)"

# ---------------------------------------------------------------------------
say "1. Bootstrap + accounts (synthetic)"
c=$(code POST /api/auth/bootstrap "{\"wallet_address\":\"$ADMIN\",\"name\":\"Synthetic Admin\",\"username\":\"admin\",\"secret_key\":\"synthetic-test-bootstrap-key-2026\"}")
check "bootstrap first admin" 201 "$c" "$(body)"

c=$(code POST /api/auth/register "{\"wallet_address\":\"$DOCTOR\",\"name\":\"Dr Synthetic\",\"username\":\"drsyn\",\"role\":\"Doctor\"}" "$ADMIN")
check "admin registers doctor" 201 "$c" "$(body)"

c=$(code POST /api/auth/register "{\"wallet_address\":\"$PARAMEDIC\",\"name\":\"Para Synthetic\",\"username\":\"para\",\"role\":\"Nurse\"}" "$ADMIN")
check "admin registers paramedic" 201 "$c" "$(body)"

# Authorization negative: a non-admin must not be able to create users.
c=$(code POST /api/auth/register "{\"wallet_address\":\"5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL\",\"name\":\"Escalation Attempt\",\"role\":\"Admin\"}" "$DOCTOR")
check "doctor CANNOT register users (privilege escalation)" 403 "$c" "$(body)"

c=$(code POST /api/auth/register "{\"wallet_address\":\"5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL\",\"name\":\"Anon\",\"role\":\"Admin\"}")
check "anonymous CANNOT register users" 401 "$c" "$(body)"

# ---------------------------------------------------------------------------
say "2. Patient registration (synthetic patients of three ages)"
mkpatient() { # name dob nid phone blood
cat <<J
{"full_name":"$1","date_of_birth":"$2","national_id":"$3","phone":"$4","blood_type":"$5",
 "allergies":["penicillin"],"current_medications":[],"chronic_conditions":[],
 "emergency_contact_name":"Synthetic Kin","emergency_contact_phone":"+27000000000",
 "emergency_contact_relationship":"parent","organ_donor":true,"dnr_status":false,
 "languages":["en"]}
J
}

c=$(code POST /api/register "$(mkpatient 'Adult Synthetic' '1990-03-14' 'SYN-ADULT-0001' '+27000000001' 'O+')" "$DOCTOR")
check "register adult patient" 201 "$c" "$(body)"
PAT_ADULT=$(jget patient_id)
NFC_ADULT=$(jget nfc_tag_id)

c=$(code POST /api/register "$(mkpatient 'Child Eleven' '2015-01-10' 'SYN-CHILD11-01' '+27000000002' 'A+')" "$DOCTOR")
check "register child aged 11" 201 "$c" "$(body)"
PAT_C11=$(jget patient_id)

c=$(code POST /api/register "$(mkpatient 'Teen Fourteen' '2012-01-10' 'SYN-TEEN14-01' '+27000000003' 'B+')" "$DOCTOR")
check "register child aged 14" 201 "$c" "$(body)"
PAT_C14=$(jget patient_id)

echo "  adult=$PAT_ADULT  child11=$PAT_C11  teen14=$PAT_C14  nfc=$NFC_ADULT"

c=$(code POST /api/register "$(mkpatient 'Unauthorized Reg' '1990-01-01' 'SYN-X' '+27000000009' 'O+')")
check "anonymous CANNOT register a patient" 401 "$c" "$(body)"

# ---------------------------------------------------------------------------
say "3. Emergency capsule (HZ-003) — publish / revoke / access log"
c=$(code POST "/api/patients/$PAT_ADULT/emergency-capsule" '' "$DOCTOR")
check "doctor publishes capsule v2" 200 "$c" "$(body)"
CAP_V=$(jget version); CAP_COMMIT=$(jget commitment)
echo "  version=$CAP_V commitment=${CAP_COMMIT:0:16}..."

check "commitment is 64 hex chars" 64 "${#CAP_COMMIT}"
check "version incremented past registration's v1" "true" "$([ "${CAP_V:-0}" -ge 2 ] && echo true || echo false)"

c=$(code POST "/api/patients/$PAT_ADULT/emergency-capsule" '' "$PATIENT_ADULT_WALLET")
check "unknown caller CANNOT publish a capsule" 401 "$c" "$(body)"

c=$(code GET "/api/patients/$PAT_ADULT/emergency-capsule/access-log" '' "$DOCTOR")
check "provider reads access log" 200 "$c" "$(body)"

c=$(code GET "/api/patients/$PAT_ADULT/emergency-capsule/access-log" '')
check "anonymous CANNOT read access log" 401 "$c" "$(body)"

c=$(code POST "/api/patients/$PAT_ADULT/emergency-capsule/revoke" "{\"version\":$CAP_V,\"reason\":\"synthetic revocation test\"}" "$DOCTOR")
check "doctor revokes capsule version" 200 "$c" "$(body)"

c=$(code POST "/api/patients/$PAT_ADULT/emergency-capsule/revoke" "{\"version\":$CAP_V,\"reason\":\"replay\"}" "$DOCTOR")
check "revoking an already-revoked version is refused" 404 "$c" "$(body)"

c=$(code POST "/api/patients/$PAT_ADULT/emergency-capsule/revoke" '{"version":9999,"reason":"nonexistent"}' "$DOCTOR")
check "revoking a nonexistent version is refused" 404 "$c" "$(body)"

# ---------------------------------------------------------------------------
say "4. Children's Act s129 consent rules"
consent() { # patient capacity maturity
  local extra=""
  [ -n "$3" ] && extra=",\"child_maturity_assessment\":\"$3\""
  echo "{\"type_id\":\"treatment\",\"patient_id\":\"$1\",\"consent_given\":true,\"consent_giver_capacity\":\"$2\"$extra}"
}

c=$(code POST /api/consent/sign "$(consent "$PAT_C11" child_over_12_mature 'claims maturity')" "$PAT_C11")
check "child aged 11 CANNOT use mature-minor capacity" 400 "$c" "$(body)"
echo "       -> $(body | head -c 200)"

c=$(code POST /api/consent/sign "$(consent "$PAT_C14" child_over_12_mature '')" "$PAT_C14")
check "aged 14 without maturity assessment is refused" 400 "$c" "$(body)"
echo "       -> $(body | head -c 200)"

c=$(code POST /api/consent/sign "$(consent "$PAT_C14" child_over_12_mature 'understands procedure, risks and alternatives')" "$PAT_C14")
check "aged 14 WITH maturity assessment is accepted" 201 "$c" "$(body)"

c=$(code POST /api/consent/sign "$(consent "$PAT_C11" self '')" "$PAT_C11")
check "child aged 11 CANNOT self-consent" 400 "$c" "$(body)"
echo "       -> $(body | head -c 200)"

c=$(code POST /api/consent/sign "$(consent "$PAT_ADULT" self '')" "$PAT_ADULT")
check "adult self-consent is accepted" 201 "$c" "$(body)"

c=$(code POST /api/consent/sign "$(consent "$PAT_ADULT" self '')" "$DOCTOR")
check "provider CANNOT sign consent for a patient" 403 "$c" "$(body)"

# ---------------------------------------------------------------------------
say "5. Retention: approval-gated execution"
c=$(code GET /api/admin/retention/report '' "$ADMIN")
check "admin reads retention report" 200 "$c" "$(body)"
check "report states 0 deleted" 0 "$(jget assessment records_deleted)"

c=$(code GET /api/admin/retention/report '' "$DOCTOR")
check "doctor CANNOT read retention report" 403 "$c" "$(body)"

c=$(code POST /api/admin/retention/approvals '' "$ADMIN")
check "admin requests approval token" 201 "$c" "$(body)"
TOKEN=$(jget approval token)
DIGEST=$(jget approval assessment_digest)
echo "  token=$TOKEN digest=${DIGEST:0:16}..."

c=$(code POST "/api/admin/retention/approvals/$TOKEN/execute" '' "$ADMIN")
check "executing an UNAPPROVED token is refused" 400 "$c" "$(body)"

c=$(code POST "/api/admin/retention/approvals/$TOKEN/decide" '{"approved":true}' "$ADMIN")
check "admin approves the token" 200 "$c" "$(body)"

c=$(code POST "/api/admin/retention/approvals/$TOKEN/decide" '{"approved":false,"reason":"changed mind"}' "$ADMIN")
check "re-deciding a decided approval is refused" 400 "$c" "$(body)"

c=$(code POST "/api/admin/retention/approvals/$TOKEN/execute" '' "$ADMIN")
check "approved token executes" 200 "$c" "$(body)"
check "execution deleted nothing" 0 "$(jget outcome deleted)"

c=$(code POST "/api/admin/retention/approvals/$TOKEN/execute" '' "$ADMIN")
check "replaying an executed token is refused" 400 "$c" "$(body)"

c=$(code GET /api/admin/retention/register '' "$ADMIN")
check "deletion register readable" 200 "$c" "$(body)"

c=$(code GET /api/admin/retention/restrictions '' "$ADMIN")
check "restriction list readable" 200 "$c" "$(body)"

c=$(code POST /api/admin/retention/approvals '' "$DOCTOR")
check "doctor CANNOT request approval" 403 "$c" "$(body)"

c=$(code POST "/api/admin/retention/approvals/RA-does-not-exist/execute" '' "$ADMIN")
check "executing an unknown token 404s" 404 "$c" "$(body)"

# ---------------------------------------------------------------------------
say "RESULTS"
printf '  passed=%d failed=%d\n' "$PASS" "$FAIL"
printf '%s\n' "${RESULTS[@]}" > /tmp/synthetic-results.txt
[ "$FAIL" -gt 0 ] && { echo; echo "  Failures:"; printf '%s\n' "${RESULTS[@]}" | grep '^FAIL'; }
rm -f /tmp/mc_body
exit 0
