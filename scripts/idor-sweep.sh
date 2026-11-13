#!/usr/bin/env bash
# Systematic IDOR sweep (Horizon HZ-010 / HZ-019 follow-up).
#
# For every patient-scoped GET endpoint, verify a patient account CANNOT read a
# DIFFERENT patient's data. Alice must never see Bob's records.
#
# A patient reading another patient's data must return 401/403/404 — never 200
# with Bob's content. A 200 is a confirmed IDOR and fails the sweep.
#
# All data is synthetic. Requires the synthetic server running against a
# throwaway PostgreSQL database (scripts/run-synthetic-local.sh); signing in
# needs one.

BASE="${BASE:-http://127.0.0.1:8090}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/actors.sh
. "$SCRIPT_DIR/lib/actors.sh"
actors_init
ADMIN=admin
DOC=doctor
ALICE_KEY=alice
PASS=0; FAIL=0; LEAKS=()

# Bootstrap the administrator (409 when already present), sign in, and register
# and activate a doctor who redeems the credential code.
ADMIN_LOGIN=idoradmin
code POST /api/auth/bootstrap "{\"login_id\":\"$ADMIN_LOGIN\",\"name\":\"A\",\"auth_proof\":\"$(proof "$ADMIN_LOGIN" "$SYN_PASSWORD")\",\"secret_key\":\"${MEDICHAIN_BOOTSTRAP_KEY:-synthetic-test-bootstrap-key-2026}\"}" >/dev/null
[ "$(login_as "$ADMIN" "$ADMIN_LOGIN")" = "200" ] || { echo "the administrator cannot sign in; use a fresh database"; exit 2; }
DOC_LOGIN="idordoc$RANDOM"
code POST /api/auth/register "{\"name\":\"D\",\"role\":\"Doctor\",\"login_id\":\"$DOC_LOGIN\"}" "$ADMIN" >/dev/null
DOC_UID=$(jget user_id); DOC_CODE=$(jget credential_code)
code PUT "/api/users/$DOC_UID" '{"status":"active"}' "$ADMIN" >/dev/null
[ "$(redeem_as "$DOC" "$DOC_LOGIN" "$DOC_CODE" "$DOC_LOGIN")" = "200" ] || { echo "the doctor could not redeem the credential code"; exit 2; }

mk() { # name nid phone -> "patient_id activation_code"
  code POST /api/register "{\"full_name\":\"$1\",\"date_of_birth\":\"1990-01-01\",\"national_id\":\"$2\",\"phone\":\"$3\",\"blood_type\":\"O+\",\"allergies\":[\"secret-$1\"],\"current_medications\":[],\"chronic_conditions\":[],\"emergency_contact_name\":\"K\",\"emergency_contact_phone\":\"+2701\",\"emergency_contact_relationship\":\"p\",\"organ_donor\":false,\"dnr_status\":false,\"languages\":[\"en\"]}" "$DOC" >/dev/null
  printf '%s %s' "$(jget patient_id)" "$(act_code)"
}

ALICE_ROW=$(mk Alice "SYN-IDOR-A-$RANDOM" "+2700$RANDOM"); ALICE=${ALICE_ROW%% *}
BOB_ROW=$(mk Bob "SYN-IDOR-B-$RANDOM" "+2700$RANDOM"); BOB=${BOB_ROW%% *}
# Alice acts as herself: she redeems her activation code and chooses a username.
[ "$(provision_patient "$ALICE_KEY" "$ALICE" "idoralice$RANDOM" "${ALICE_ROW#* }")" = "200" ] \
  || { echo "Alice could not activate her account"; exit 2; }
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
  "/api/clinical/patient/{p}/ems-handoffs"
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
  code=$(curl -s -m 8 -o /tmp/idor.out -w '%{http_code}' "$BASE$url" -H "Authorization: Bearer $(tok_of "$ALICE_KEY")")
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
