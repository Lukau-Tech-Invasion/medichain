#!/usr/bin/env bash
# End-to-end synthetic-data exercise of the POPIA gate features.
#
# ALL DATA HERE IS FABRICATED. Names, ID numbers, phone numbers and wallet
# addresses are invented for this run and correspond to no real person.
#
# Not `set -e`: a failing assertion is a RESULT to record, not a reason to
# abandon the run. The whole point is to find out what actually happens.

# Default 8090, not 8080: 8080 is the IPFS gateway's port (docker-compose), and
# run-synthetic-local.sh moves the API off it so encrypted-record downloads work.
BASE=${BASE:-http://127.0.0.1:8090}
PASS=0; FAIL=0
RESULTS=()

# SS58-shaped synthetic wallets (48 chars, start with 5).
ADMIN=5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
DOCTOR=5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty
PARAMEDIC=5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy
PATIENT_ADULT_WALLET=5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw
# A wallet that is registered NOWHERE. PATIENT_ADULT_WALLET cannot serve this
# purpose: it is one of the seeded demo accounts on the PostgreSQL backend (a
# Doctor), so 'unknown caller' assertions using it passed on memory and failed
# on PostgreSQL for a correct reason — the caller was genuinely authorized
# there. The assertion was testing the fixture, not the control.
UNREGISTERED_WALLET=5Cq8Xz9mNbVvTkLrPqWjHdYuEoZaSxCfGiJkMnBpRtUvWxYz

say() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

# check_setup <name> <actual> [detail] — for idempotent setup steps.
#
# Accepts 201 (created) *or* 409 (already exists). The suite used to demand 201
# and so only passed against a freshly started server: re-running it against a
# server that was left up — which is the normal way to work through the app —
# reported three failures for accounts that were correctly already there. A
# suite that only passes on a cold start gets re-run less, which is backwards.
check_setup() {
  local name="$1" got="$2" detail="${3:-}"
  if [ "$got" = "201" ] || [ "$got" = "409" ]; then
    PASS=$((PASS+1)); RESULTS+=("PASS | $name | got $got")
    printf '  \033[32mPASS\033[0m %-62s %s\n' "$name" "$got"
  else
    FAIL=$((FAIL+1)); RESULTS+=("FAIL | $name | want 201/409 got $got | $detail")
    printf '  \033[31mFAIL\033[0m %-62s want 201/409 got %s\n' "$name" "$got"
    [ -n "$detail" ] && printf '       %s\n' "$(echo "$detail" | head -c 400)"
  fi
}

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
# Metrics were readable by anyone, exposing route-level traffic, error rates and
# latency to unauthenticated callers. This assertion used to expect 200 with no
# credential — it was asserting the weakness. It now asserts the control.
check "metrics REFUSE an unauthenticated caller" 401 "$(code GET /api/metrics)"
# Re-checked after accounts exist (section 1) — see "metrics readable by a known user".

# ---------------------------------------------------------------------------
say "1. Bootstrap + accounts (synthetic)"
c=$(code POST /api/auth/bootstrap "{\"wallet_address\":\"$ADMIN\",\"name\":\"Synthetic Admin\",\"username\":\"admin\",\"secret_key\":\"synthetic-test-bootstrap-key-2026\"}")
check_setup "bootstrap first admin" "$c" "$(body)"

c=$(code POST /api/auth/register "{\"wallet_address\":\"$DOCTOR\",\"name\":\"Dr Synthetic\",\"username\":\"drsyn\",\"role\":\"Doctor\"}" "$ADMIN")
check_setup "admin registers doctor" "$c" "$(body)"

c=$(code POST /api/auth/register "{\"wallet_address\":\"$PARAMEDIC\",\"name\":\"Para Synthetic\",\"username\":\"para\",\"role\":\"Nurse\"}" "$ADMIN")
check_setup "admin registers paramedic" "$c" "$(body)"

# Authorization negative: a non-admin must not be able to create users.
c=$(code POST /api/auth/register "{\"wallet_address\":\"5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL\",\"name\":\"Escalation Attempt\",\"role\":\"Admin\"}" "$DOCTOR")
check "doctor CANNOT register users (privilege escalation)" 403 "$c" "$(body)"

c=$(code POST /api/auth/register "{\"wallet_address\":\"5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL\",\"name\":\"Anon\",\"role\":\"Admin\"}")
check "anonymous CANNOT register users" 401 "$c" "$(body)"

# The positive half of the metrics control: a registered caller still gets them,
# so the endpoint is authenticated rather than simply broken.
check "metrics readable by a known user" 200 "$(code GET /api/metrics '' "$ADMIN")"
# A forged identity must NOT satisfy it — presence of a header is not identity.
check "metrics REFUSE a forged identity" 401 "$(code GET /api/metrics '' 0xPROVforged)"

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

c=$(code POST "/api/patients/$PAT_ADULT/emergency-capsule" '' "$UNREGISTERED_WALLET")
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
say "6. Patient-controlled access grants (Consent Management page)"

# Provider asks the patient for standing access.
c=$(code POST "/api/access/patient/$PAT_ADULT/requests" '{"reason":"Follow-up consultation"}' "$DOCTOR")
check "provider requests access" 201 "$c" "$(body)"
REQ=$(jget request id)

# The consent dashboard is the patient's alone.
c=$(code GET "/api/access/patient/$PAT_ADULT/grants" '')
check "anonymous CANNOT list access grants" 401 "$c" "$(body)"
c=$(code GET "/api/access/patient/$PAT_ADULT/grants" '' "$DOCTOR")
check "provider CANNOT list a patient's access grants" 403 "$c" "$(body)"

c=$(code GET "/api/access/patient/$PAT_ADULT/requests" '' "$PAT_ADULT")
check "patient lists own access requests" 200 "$c" "$(body)"

# Patient approves -> a new active grant is minted.
c=$(code POST "/api/access/requests/$REQ/approve" '' "$PAT_ADULT")
check "patient approves the request" 200 "$c" "$(body)"
GRANT=$(jget grant id)

c=$(code POST "/api/access/requests/$REQ/approve" '' "$PAT_ADULT")
check "re-approving a decided request is refused" 400 "$c" "$(body)"

c=$(code GET "/api/access/patient/$PAT_ADULT/grants" '' "$PAT_ADULT")
check "patient lists own grants" 200 "$c" "$(body)"

# A provider must not be able to decide a patient's request.
c=$(code POST "/api/access/patient/$PAT_ADULT/requests" '{"reason":"Second opinion"}' "$PARAMEDIC")
check "second provider requests access" 201 "$c" "$(body)"
REQ2=$(jget request id)
c=$(code POST "/api/access/requests/$REQ2/approve" '' "$DOCTOR")
check "a provider CANNOT approve a request for a patient" 403 "$c" "$(body)"

# Patient revokes the active grant; revocation is idempotent.
c=$(code POST "/api/access/grants/$GRANT/revoke" '' "$PAT_ADULT")
check "patient revokes the grant" 200 "$c" "$(body)"
c=$(code POST "/api/access/grants/$GRANT/revoke" '' "$PAT_ADULT")
check "revoking an already-revoked grant is refused" 400 "$c" "$(body)"
c=$(code POST "/api/access/grants/GRANT-does-not-exist/revoke" '' "$PAT_ADULT")
check "revoking a nonexistent grant 404s" 404 "$c" "$(body)"

# Only healthcare providers may request access.
c=$(code POST "/api/access/patient/$PAT_ADULT/requests" '{"reason":"x"}')
check "anonymous CANNOT request access" 401 "$c" "$(body)"
c=$(code POST "/api/access/patient/$PAT_ADULT/requests" '{"reason":"x"}' "$PAT_ADULT")
check "a patient CANNOT request provider access" 403 "$c" "$(body)"

# ---------------------------------------------------------------------------
say "7. Nursing dashboard + care plans (doctor-portal)"

check "nurse lists MAR" 200 "$(code GET /api/nursing/mar '' "$PARAMEDIC")"
check "nurse lists intake/output" 200 "$(code GET /api/nursing/intake-output '' "$PARAMEDIC")"
check "nurse lists care plans" 200 "$(code GET /api/nursing/care-plans '' "$PARAMEDIC")"
check "doctor lists MAR" 200 "$(code GET /api/nursing/mar '' "$DOCTOR")"

check "anonymous CANNOT list MAR" 401 "$(code GET /api/nursing/mar '')"
check "patient CANNOT read the nursing dashboard" 403 "$(code GET /api/nursing/mar '' "$PAT_ADULT")"

# Horizon HZ-023: these two used to discard the body and return success
# without persisting, so the old assertions passed against a stub — the dose
# request did not even carry a patient_id. They now write to the MAR / I/O
# repositories, so the tests assert the round-trip, not just the status code.
c=$(code POST /api/nursing/mar/administer "{\"patient_id\":\"$PAT_ADULT\",\"medication_name\":\"Paracetamol\",\"dose\":\"500mg\",\"route\":\"PO\"}" "$PARAMEDIC")
check "nurse administers a dose" 200 "$c" "$(body)"
check "administering without a patient_id is refused" 400 "$(code POST /api/nursing/mar/administer '{"dose":"500mg"}' "$PARAMEDIC")"

c=$(code GET /api/nursing/mar '' "$PARAMEDIC")
check "the administered dose is persisted and readable" 200 "$c" "$(body)"
check "administered dose appears in the MAR (real persistence)" yes \
  "$(body | grep -q 'Paracetamol' && echo yes || echo no)" "$(body)"

c=$(code POST /api/nursing/intake-output/record "{\"patient_id\":\"$PAT_ADULT\",\"category\":\"oral\",\"amount_ml\":200}" "$PARAMEDIC")
check "nurse records fluid" 200 "$c" "$(body)"
c=$(code GET /api/nursing/intake-output '' "$PARAMEDIC")
check "recorded fluid updates the I/O totals (real persistence)" yes \
  "$(body | grep -q '"total_intake":200' && echo yes || echo no)" "$(body)"

check "anonymous CANNOT administer a dose" 401 "$(code POST /api/nursing/mar/administer '{}' )"

# ---------------------------------------------------------------------------
say "8. IV sites + shift handoffs by patient/provider (doctor-portal)"

check "provider lists a patient's IV sites" 200 "$(code GET "/api/clinical/iv-sites/$PAT_ADULT" '' "$DOCTOR")"
check "patient lists own IV sites" 200 "$(code GET "/api/clinical/iv-sites/$PAT_ADULT" '' "$PAT_ADULT")"
check "anonymous CANNOT list IV sites" 401 "$(code GET "/api/clinical/iv-sites/$PAT_ADULT" '')"
check "another patient CANNOT list IV sites" 403 "$(code GET "/api/clinical/iv-sites/$PAT_ADULT" '' "$PAT_C14")"

check "provider lists own shift handoffs" 200 "$(code GET "/api/clinical/shift-handoff/$DOCTOR" '' "$DOCTOR")"
check "anonymous CANNOT list shift handoffs" 401 "$(code GET "/api/clinical/shift-handoff/$DOCTOR" '')"
check "a patient CANNOT list a provider's handoffs" 403 "$(code GET "/api/clinical/shift-handoff/$DOCTOR" '' "$PAT_ADULT")"

# ---------------------------------------------------------------------------
say "9. Physician order status update (doctor-portal OrdersPage)"

c=$(code PUT "/api/clinical/orders/ORD-does-not-exist/status" '{"status":"completed"}' "$DOCTOR")
check "updating a nonexistent order 404s (route wired, provider allowed)" 404 "$c" "$(body)"
check "anonymous CANNOT update order status" 401 "$(code PUT "/api/clinical/orders/ORD-x/status" '{"status":"completed"}')"
check "a patient CANNOT update order status" 403 "$(code PUT "/api/clinical/orders/ORD-x/status" '{"status":"completed"}' "$PAT_ADULT")"

# ---------------------------------------------------------------------------
say "10. Patient's own immunizations (patient-app Medical History)"

check "patient reads own immunizations" 200 "$(code GET /api/clinical/immunizations '' "$PAT_ADULT")"
check "anonymous CANNOT read immunizations" 401 "$(code GET /api/clinical/immunizations '')"

# ---------------------------------------------------------------------------
say "11. Encrypted record upload + download (IPFS, MyRecordsPage)"

# ALL SYNTHETIC. "SYNTHETIC TEST RECORD" base64-encoded.
DOC_B64="U1lOVEhFVElDIFRFU1QgUkVDT1JE"
code GET /api/ipfs/health '' >/dev/null
IPFS_OK=$(jget ipfs_connected)
if [ "$IPFS_OK" = "True" ] || [ "$IPFS_OK" = "true" ]; then
  c=$(code POST /api/records/upload "{\"patient_id\":\"$PAT_ADULT\",\"filename\":\"synthetic-lab.txt\",\"content_type\":\"text/plain\",\"record_type\":\"lab_result\",\"content_base64\":\"$DOC_B64\",\"encrypted\":true}" "$DOCTOR")
  check "provider uploads an encrypted record" 201 "$c" "$(body)"
  CHASH=$(jget ipfs_hash)
  echo "  content_hash=${CHASH:0:20}..."

  check "patient downloads own record" 200 "$(code GET "/api/records/$CHASH/download" '' "$PAT_ADULT")"
  check "downloaded bytes match the original (decrypt round-trip)" "SYNTHETIC TEST RECORD" "$(body)"
  check "provider downloads the record" 200 "$(code GET "/api/records/$CHASH/download" '' "$DOCTOR")"
  check "another patient CANNOT download it" 403 "$(code GET "/api/records/$CHASH/download" '' "$PAT_C14")"
  check "anonymous CANNOT download it" 401 "$(code GET "/api/records/$CHASH/download" '')"
  check "downloading an unknown hash 404s" 404 "$(code GET "/api/records/Qm-nope/download" '' "$DOCTOR")"
  check "unencrypted upload is refused" 400 "$(code POST /api/records/upload "{\"patient_id\":\"$PAT_ADULT\",\"filename\":\"x\",\"content_type\":\"text/plain\",\"record_type\":\"lab_result\",\"content_base64\":\"$DOC_B64\",\"encrypted\":false}" "$DOCTOR")"
else
  echo "  SKIPPED — IPFS (kubo) not reachable; MyRecords upload/download needs it on :5001"
fi

# ---------------------------------------------------------------------------
say "12. Formerly-fabricated features now backed by real stores (HZ-023)"

# Each endpoint below used to return hardcoded literals — an invented inbox,
# invented chronic conditions, an invented specimen chain of custody. The point
# of these assertions is the ROUND-TRIP: what comes back must be what went in,
# and an untouched entity must come back empty rather than populated.

check "patient's inbox starts empty (not a fabricated one)" 0 \
  "$(code GET /api/messages '' "$PAT_ADULT" >/dev/null; body | python -c "import sys,json;print(len(json.load(sys.stdin).get('messages',[])))" 2>/dev/null || echo ERR)"

c=$(code POST /api/messages/send "{\"recipient_id\":\"$PAT_ADULT\",\"subject\":\"Results ready\",\"content\":\"Your results are in.\"}" "$DOCTOR")
check "doctor sends a message" 201 "$c" "$(body)"
c=$(code GET /api/messages '' "$PAT_ADULT")
check "patient's inbox now returns the real message" 200 "$c" "$(body)"
check "the delivered message is the one that was sent" yes \
  "$(body | grep -q 'Your results are in.' && echo yes || echo no)" "$(body)"
check "inbox is grouped into conversations for the patient app" yes \
  "$(body | grep -q '"conversations"' && echo yes || echo no)" "$(body)"

c=$(code POST /api/symptoms/log "{\"patient_id\":\"$PAT_ADULT\",\"symptom\":\"Headache\",\"severity\":4,\"category\":\"pain\",\"notes\":\"synthetic\"}" "$PAT_ADULT")
check "patient logs a symptom" 201 "$c" "$(body)"
c=$(code GET "/api/symptoms/$PAT_ADULT" '' "$PAT_ADULT")
check "symptom history returns the logged entry" 200 "$c" "$(body)"
check "logged symptom round-trips" yes \
  "$(body | grep -q 'Headache' && echo yes || echo no)" "$(body)"
check "no fabricated chronic conditions are invented" yes \
  "$(body | grep -q 'Type 2 Diabetes' && echo no || echo yes)" "$(body)"

check "an unscanned barcode has an EMPTY chain of custody" yes \
  "$(code GET /api/barcode/SYN-NEVER-SCANNED/history '' "$DOCTOR" >/dev/null; body | grep -q '"count":0' && echo yes || echo no)" "$(body)"
c=$(code POST /api/barcode/scan '{"barcode_value":"SYN-SP-0001","location":"Synthetic Bench"}' "$DOCTOR")
check "provider scans a specimen barcode" 200 "$c" "$(body)"
check "the scan does NOT invent a patient name" yes \
  "$(body | grep -qE 'John Doe|Jane Smith' && echo no || echo yes)" "$(body)"
c=$(code GET /api/barcode/SYN-SP-0001/history '' "$DOCTOR")
check "chain of custody now contains the real scan" 200 "$c" "$(body)"
check "custody entry names the actual scanner, not 'Nurse Jones'" yes \
  "$(body | grep -q 'Synthetic Bench' && body | grep -qv 'Nurse Jones' && echo yes || echo no)" "$(body)"

# ---------------------------------------------------------------------------
say "13. Clinical registries reject forged identities (SEC-12)"

# These endpoints guarded on the PRESENCE of X-User-Id and then called
# list_all(), so any string read every pathology report, critical value,
# blood-bank record and specimen chain of custody in the deployment. The
# assertion that matters is the FORGED one: anonymous was already refused, a
# forged identity was not.
for ep in pathology critical-values blood-bank chain-of-custody radiology-orders; do
  check "registry $ep refuses a forged identity" 401 \
    "$(code GET "/api/platform/list/$ep" '' 0xPROVforged)"
  check "registry $ep refuses anonymous" 401 "$(code GET "/api/platform/list/$ep" '')"
  check "registry $ep still serves a clinician" 200 \
    "$(code GET "/api/platform/list/$ep" '' "$DOCTOR")"
done

# A patient account has no business reading a ward-wide registry.
check "registry refuses a patient account" 403 \
  "$(code GET /api/platform/list/pathology '' "$PAT_ADULT")"

# Blood-bank stock levels were hardcoded ("O-Pos: 12 units, adequate"). Unit
# counts drive transfusion decisions, so inventing them is a safety hazard.
c=$(code GET /api/platform/list/blood-bank '' "$DOCTOR")
check "blood bank does NOT invent stock levels" yes \
  "$(body | grep -qE '"units"|O-Pos|A-Neg' && echo no || echo yes)" "$(body)"
check "blood bank declares inventory unavailable rather than faking it" yes \
  "$(body | grep -q '"inventory_available":false' && echo yes || echo no)" "$(body)"

# ---------------------------------------------------------------------------
say "14. Clinical-staff gate on surgical/public-health endpoints (SEC-11)"

# 26 handlers across the surgical and emergency-assessment modules guarded with
# `get_current_user_id(...)` only — presence of a caller-supplied header. They
# now resolve the identity and require a clinical role.
check "surgical list refuses a forged identity" 401 \
  "$(code GET /api/surgical/anesthesia/list '' 0xPROVforged)"
check "surgical list refuses anonymous" 401 "$(code GET /api/surgical/anesthesia/list '')"
check "surgical list refuses a patient account" 403 \
  "$(code GET /api/surgical/anesthesia/list '' "$PAT_ADULT")"

# ---------------------------------------------------------------------------
say "15. Forged identities refused across the clinical surface (SEC-11)"

# 60 more handlers were resolved off presence-only checks. Two different gates
# were used on purpose: clinical endpoints require a clinical ROLE, while
# patient-facing ones only require the caller to RESOLVE — gating those on a
# clinical role would lock patients out of their own features.
for ep in /api/emergency/mar/list /api/emergency/io/list /api/emergency/care-plan/list \
          /api/emergency/wound/list /api/dashboard/doctor /api/dashboard/nurse \
          /api/dashboard/lab /api/dashboard/pharmacist; do
  check "clinical $ep refuses a forged identity" 401 "$(code GET "$ep" '' 0xPROVforged)"
  check "clinical $ep still serves a clinician"  200 "$(code GET "$ep" '' "$DOCTOR")"
done
check "clinical dashboard refuses a patient account" 403 \
  "$(code GET /api/dashboard/doctor '' "$PAT_ADULT")"

# Patient-facing: forged still refused, but the patient must NOT be locked out.
check "patient-facing sync refuses a forged identity" 401 \
  "$(code GET /api/sync/conflicts '' 0xPROVforged)"
check "patient-facing sync still serves the patient" 200 \
  "$(code GET /api/sync/conflicts '' "$PAT_ADULT")"

# ---------------------------------------------------------------------------
say "16. Presence-only handlers eliminated (SEC-11 closed)"

# The tiered gate now reports ZERO presence-only handlers: every endpoint either
# resolves the caller against the user store, is a justified public route, or is
# break-glass authorizing through the identity-context/grant model. These probe
# the last batch converted — a forged header must be refused everywhere.
for ep in /api/consent/types /api/messages /api/barcode/scans/my \
          /api/auth/mfa/status /api/surgical/anesthesia/list; do
  check "forged identity refused: $ep" 401 "$(code GET "$ep" '' 0xPROVforged)"
done
check "consent types still serve a real caller"    200 "$(code GET /api/consent/types '' "$DOCTOR")"
check "messages still serve a real caller"         200 "$(code GET /api/messages '' "$DOCTOR")"
check "MFA status still serves a real caller"      200 "$(code GET /api/auth/mfa/status '' "$DOCTOR")"

# ---------------------------------------------------------------------------
say "17. Emergency card shows REAL medications and conditions"

# The paramedic-facing emergency view returned hardcoded empty vectors for
# medications and conditions behind a "Phase 2 repository" TODO. An empty
# `conditions` array on an emergency card does not read as "not retrieved" —
# it reads as "no known conditions", which is the most dangerous thing this
# screen can say about an anticoagulated or diabetic patient.
c=$(code POST /api/register "{\"full_name\":\"Conditions Synthetic\",\"date_of_birth\":\"1980-05-05\",\"national_id\":\"SYN-COND-E2E\",\"phone\":\"+27000000077\",\"blood_type\":\"A+\",\"allergies\":[\"penicillin\"],\"current_medications\":[\"Warfarin 5mg\"],\"chronic_conditions\":[\"Atrial Fibrillation\"],\"emergency_contact_name\":\"Kin\",\"emergency_contact_phone\":\"+27000000000\",\"emergency_contact_relationship\":\"parent\",\"organ_donor\":true,\"dnr_status\":false,\"languages\":[\"en\"]}" "$DOCTOR")
check "register a patient WITH conditions and medications" 201 "$c" "$(body)"
PAT_COND=$(jget patient_id)

if [ -n "$PAT_COND" ]; then
  code POST /api/simulate-nfc-tap "{\"patient_id\":\"$PAT_COND\"}" >/dev/null
  COND_HASH=$(body | python -c 'import sys,json;print(json.load(sys.stdin)["tag_data"]["hash"])' 2>/dev/null)
  code POST /api/emergency/nfc-token "{\"patient_id\":\"$PAT_COND\",\"nfc_hash\":\"$COND_HASH\"}" >/dev/null
  COND_TOK=$(jget token)
  c=$(code GET "/api/medical-id/$PAT_COND/emergency?token=$COND_TOK" '')
  check "emergency card readable with a valid token" 200 "$c" "$(body)"
  check "emergency card lists the patient's real medication" yes \
    "$(body | grep -q 'Warfarin' && echo yes || echo no)" "$(body)"
  check "emergency card lists the patient's real condition" yes \
    "$(body | grep -q 'Atrial Fibrillation' && echo yes || echo no)" "$(body)"

  # Allergies were doubly hidden: registration writes them to the patient
  # profile but never to the allergies repository the card reads, AND the card
  # filtered out anything not Severe/Moderate — which is every allergy captured
  # at registration, since those carry no severity assessment. A patient
  # registered with a penicillin allergy showed an EMPTY allergy list.
  check "emergency card lists an allergy captured at registration" yes \
    "$(body | grep -qi 'penicillin' && echo yes || echo no)" "$(body)"
  check "unassessed allergy is marked as such, not silently dropped" yes \
    "$(body | grep -q '"severity_assessed":false' && echo yes || echo no)" "$(body)"

  # The lock screen printed the literal words "No Critical Allergies" for the
  # same patient — an affirmative false statement a responder reads in seconds.
  c=$(code GET "/api/medical-id/$PAT_COND/lockscreen?token=$COND_TOK" '')
  check "lockscreen readable with a valid token" 200 "$c" "$(body)"
  check "lockscreen does NOT claim 'No Critical Allergies' for an allergic patient" yes \
    "$(body | grep -q 'No Critical Allergies' && echo no || echo yes)" "$(body)"
  check "lockscreen shows the allergen" yes \
    "$(body | grep -qi 'PENICILLIN' && echo yes || echo no)" "$(body)"
fi

# ---------------------------------------------------------------------------
say "18. A patient can read their OWN clinical data (and only their own)"
# WHY THIS SECTION EXISTS
# -----------------------
# Every section above drives the clinical endpoints as $DOCTOR or $PARAMEDIC.
# Provider credentials take the `is_healthcare_provider()` branch of the access
# guard and never reach the self-access comparison beneath it. That comparison
# was broken in 26 handlers — it tested a wallet address against a patient
# record ID, two identifier namespaces that are never equal — so a patient was
# refused their own records everywhere, and this suite still reported 160/160.
#
# The gap was in what was covered, not in the assertions. These cases close it:
# they exercise the endpoints with a PATIENT credential, which is the only way
# to reach the branch that was wrong.

# Run-unique identifiers. A claim is ONE PER ACCOUNT FOR LIFE, so a fixed
# wallet here passed exactly once against a persistent backend and then failed
# on every later run with ALREADY_LINKED — a section that only works on a cold
# database, which is the failure mode `check_setup` above exists to prevent.
# Base58 alphabet (no 0/O/I/l) and 48 chars total, matching SS58 validation.
SELFREAD_WALLET="5$(head -c 400 /dev/urandom | tr -dc '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz' | head -c 47)"
SELFREAD_NID="SYN-SELFREAD-$(head -c 200 /dev/urandom | tr -dc 'A-Z1-9' | head -c 8)"
# Self-contained: this section registers its OWN patient rather than reusing
# $PAT_ADULT, whose identity an earlier section already claims (a second claim
# is correctly refused with IDENTITY_ALREADY_CLAIMED, which would make these
# assertions fail for a reason unrelated to what they test).
c=$(code POST /api/register "$(mkpatient 'Selfread Synthetic' '1988-06-02' "$SELFREAD_NID" '+27000000021' 'O-')" "$DOCTOR")
check_setup "register a patient for the self-access checks" "$c" "$(body)"
PAT_SELF=$(jget patient_id)

c=$(code POST /api/auth/register "{\"wallet_address\":\"$SELFREAD_WALLET\",\"name\":\"Selfread Synthetic\",\"username\":\"selfread\",\"role\":\"Patient\"}" "$ADMIN")
check_setup "admin registers a patient-role account" "$c" "$(body)"

c=$(code POST /api/identity/claim "{\"patient_id\":\"$PAT_SELF\",\"national_id\":\"$SELFREAD_NID\",\"date_of_birth\":\"1988-06-02\"}" "$SELFREAD_WALLET")
check "patient claims their own medical identity" 200 "$c" "$(body)"

# The positive half: the data subject reads their own record.
check "patient reads OWN demographic record"  200 "$(code GET "/api/patients/$PAT_SELF" '' "$SELFREAD_WALLET")"
check "patient reads OWN medical records"     200 "$(code GET "/api/records/$PAT_SELF" '' "$SELFREAD_WALLET")"
check "patient reads OWN vitals"              200 "$(code GET "/api/clinical/patient/$PAT_SELF/vitals" '' "$SELFREAD_WALLET")"
check "patient reads OWN medical ID"          200 "$(code GET "/api/medical-id/$PAT_SELF" '' "$SELFREAD_WALLET")"

# The negative half. Without it the four assertions above are satisfied by an
# endpoint that simply lets every patient read everything, which would be a far
# worse defect than the one this section was written for.
check "patient CANNOT read another patient's records" 403 "$(code GET "/api/records/$PAT_C11" '' "$SELFREAD_WALLET")"
check "patient CANNOT read another patient's vitals"  403 "$(code GET "/api/clinical/patient/$PAT_C11/vitals" '' "$SELFREAD_WALLET")"

# ---------------------------------------------------------------------------
say "RESULTS"
printf '  passed=%d failed=%d\n' "$PASS" "$FAIL"
printf '%s\n' "${RESULTS[@]}" > /tmp/synthetic-results.txt
[ "$FAIL" -gt 0 ] && { echo; echo "  Failures:"; printf '%s\n' "${RESULTS[@]}" | grep '^FAIL'; }
rm -f /tmp/mc_body

# Exit NON-ZERO when anything failed.
#
# This used to `exit 0` unconditionally, so the suite reported "passed=89
# failed=63" and still told its caller it had succeeded. That is fine while a
# human is reading the output and wrong the moment anything automated consumes
# it: wired into CI as-is, this job would have gone green over a completely
# broken storage backend.
#
# Distinct from the "not `set -e`" decision at the top of this file. That is
# about not ABANDONING the run on the first failure — the whole point is to find
# out what else breaks. It was never a reason to misreport the final result.
[ "$FAIL" -gt 0 ] && exit 1
exit 0
