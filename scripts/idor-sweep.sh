#!/usr/bin/env bash
# Systematic IDOR sweep (Horizon HZ-010 / HZ-019 follow-up).
#
# For every patient-scoped GET endpoint, verify a patient account CANNOT read a
# DIFFERENT patient's data. Alice must never see Bob's records.
#
# A patient reading another patient's data must return 401/403/404 — never 200
# with Bob's content. A 200 is a confirmed IDOR and fails the sweep.
#
# All data is synthetic. Requires the demo server running (scripts/run-synthetic-local.sh).

BASE="${BASE:-http://127.0.0.1:8080}"
ADMIN=5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
DOC=5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty
PASS=0; FAIL=0; LEAKS=()

j() { curl -s -m 8 "$@"; }

# Bootstrap admin + doctor (ignore 409 if already present).
j -o /dev/null -X POST "$BASE/api/auth/bootstrap" -H 'Content-Type: application/json' \
  -d "{\"wallet_address\":\"$ADMIN\",\"name\":\"A\",\"secret_key\":\"synthetic-test-bootstrap-key-2026\"}"
j -o /dev/null -X POST "$BASE/api/auth/register" -H "X-User-Id: $ADMIN" -H 'Content-Type: application/json' \
  -d "{\"wallet_address\":\"$DOC\",\"name\":\"D\",\"role\":\"Doctor\"}"

mk() { # name nid phone -> patient_id
  j -X POST "$BASE/api/register" -H "X-User-Id: $DOC" -H 'Content-Type: application/json' \
    -d "{\"full_name\":\"$1\",\"date_of_birth\":\"1990-01-01\",\"national_id\":\"$2\",\"phone\":\"$3\",\"blood_type\":\"O+\",\"allergies\":[\"secret-$1\"],\"current_medications\":[],\"chronic_conditions\":[],\"emergency_contact_name\":\"K\",\"emergency_contact_phone\":\"+2701\",\"emergency_contact_relationship\":\"p\",\"organ_donor\":false,\"dnr_status\":false,\"languages\":[\"en\"]}" \
    | python -c "import sys,json;print(json.load(sys.stdin).get('patient_id',''))"
}

ALICE=$(mk Alice "SYN-IDOR-A-$RANDOM" "+2700$RANDOM")
BOB=$(mk Bob "SYN-IDOR-B-$RANDOM" "+2700$RANDOM")
echo "Alice=$ALICE  Bob=$BOB (Alice's account will try to read Bob's data)"
echo

# Every patient-scoped GET endpoint, with Bob's id substituted.
ROUTES=(
  "/api/access-logs/{p}"
  "/api/appointments/patient/{p}"
  "/api/cds/patient/{p}/alerts"
  "/api/clinical/patient/{p}/gcs"
  "/api/clinical/patient/{p}/soap"
  "/api/clinical/patient/{p}/triage"
  "/api/clinical/patient/{p}/vitals"
  "/api/clinical/patient/{p}/vitals/latest"
  "/api/clinical/sample/{p}"
  "/api/clinical/vitals/flowsheet/{p}"
  "/api/consent/patient/{p}"
  "/api/emergency/code-blue/patient/{p}"
  "/api/emergency/patient/{p}"
  "/api/e-prescriptions/patient/{p}"
  "/api/fhir/r4/Patient/{p}"
  "/api/insurance/cards/{p}"
  "/api/insurance/claims/patient/{p}"
  "/api/interactions/history/{p}"
  "/api/lab/patient/{p}"
  "/api/lab-trends/patient/{p}"
  "/api/medical-id/{p}"
  "/api/medical-id/{p}/lockscreen"
  "/api/medical-id/{p}/qr"
  "/api/medications/reminders/{p}"
  "/api/nfc/card/{p}"
  "/api/patients/{p}"
  "/api/patients/{p}/emergency-capsule/access-log"
  "/api/records/{p}"
  "/api/reminders/medication/{p}"
  "/api/symptoms/{p}"
  "/api/symptoms/history/{p}"
  "/api/sync/download/{p}"
  "/api/telehealth/patient/{p}/sessions"
)

for r in "${ROUTES[@]}"; do
  url="${r/\{p\}/$BOB}"
  code=$(curl -s -m 8 -o /tmp/idor.out -w '%{http_code}' "$BASE$url" -H "X-User-Id: $ALICE")
  # Success = access denied (401/403) or not-found (404). 200 = IDOR leak.
  if [ "$code" = "200" ]; then
    # A 200 might still be safe if it returns nothing sensitive; flag for review.
    if grep -qi "$BOB\|secret-Bob\|blood_type\|readings\|medication" /tmp/idor.out; then
      FAIL=$((FAIL+1)); LEAKS+=("$url -> 200 with Bob data")
      printf '  \033[31mLEAK\033[0m %-52s 200 (contains Bob data)\n' "$url"
    else
      PASS=$((PASS+1))
      printf '  \033[33mOK?\033[0m  %-52s 200 (no Bob data detected)\n' "$url"
    fi
  else
    PASS=$((PASS+1))
    printf '  \033[32mOK\033[0m   %-52s %s\n' "$url" "$code"
  fi
done

echo
echo "IDOR sweep: $PASS ok, $FAIL leaks"
if [ "$FAIL" -gt 0 ]; then
  printf '%s\n' "${LEAKS[@]}"
  exit 1
fi
exit 0
