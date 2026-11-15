#!/bin/bash
# MediChain Demo Users Creation Script
# This registers demo patients through a signed-in doctor.

API_URL="${API_URL:-http://localhost:8090}"
BASE="$API_URL"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/actors.sh
. "$SCRIPT_DIR/lib/actors.sh"
actors_init
# The registering clinician signs in with a password like anybody else: the
# seeded doctor fixture by default (scripts/seed-browser-test-fixtures.ts), or
# STAFF_LOGIN_ID and STAFF_PASSWORD for another active Doctor or Admin. There is
# no identity header; every call below carries the bearer token that returns.
STAFF=doctor

echo "============================================="
echo "   MediChain Demo Users Setup"
echo "============================================="
echo ""

# Check if server is running
echo "Checking API server..."
if ! curl -s "$API_URL/health" > /dev/null; then
    echo "ERROR: Server not running. Start it first!"
    exit 1
fi
echo "Server is running!"
echo ""

# Sign in first: a script that cannot authenticate must stop here rather than
# print a success banner over five refusals.
if [ -n "${STAFF_LOGIN_ID:-}" ]; then
  LOGIN_ID="$STAFF_LOGIN_ID"; PASSWORD="${STAFF_PASSWORD:?set STAFF_PASSWORD with STAFF_LOGIN_ID}"
else
  read -r LOGIN_ID PASSWORD <<< "$(python - "$SCRIPT_DIR/../.browser-test/fixtures.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
d = next(s for s in m["staff"] if s["role"] == "Doctor")
print(d["login_id"], d["password"])
PY
)"
fi
echo "Signing in as: $LOGIN_ID"
SIGNIN=$(login_as "$STAFF" "$LOGIN_ID" "$PASSWORD")
if [ "$SIGNIN" != "200" ]; then
  echo "ERROR: the API rejected the sign-in for '$LOGIN_ID' ($SIGNIN)." >&2
  echo "       Seed the fixtures, or set STAFF_LOGIN_ID and STAFF_PASSWORD to an active Doctor or Admin." >&2
  exit 1
fi
echo "Signed in"
echo ""

# A fresh Idempotency-Key per registration.
#
# `api/src/middleware/idempotency.rs` refuses any authenticated mutation that
# arrives without one, and every call below is authenticated, so all five
# registrations were answered 409 IDEMPOTENCY_KEY_REQUIRED and this script --
# which DEMO_SETUP.md tells a human to run -- created nothing while still
# printing its success banner.
#
# Per call, not per run: the key is bound to a request digest, so one key
# shared across five different bodies would be rejected as reused.
idem_key() {
  python -c 'import uuid;print(uuid.uuid4())' 2>/dev/null ||
    powershell -NoProfile -Command '[guid]::NewGuid().ToString()'
}

CREATED=0
FAILED=0

# post_patient -- registers the patient whose JSON body arrives on stdin, and
# records whether it worked.
#
# The script used to pipe every response straight to stdout and then print
# "Demo Users Setup Complete!" and a list of five created patients
# unconditionally. With a stale sign-in that meant five 401
# responses scrolling past, followed by a success banner naming patients that
# do not exist. A setup script that cannot fail is not a setup script.
post_patient() {
  local code
  code=$(curl -s -o /tmp/mc_demo_body -w '%{http_code}' -X POST "$API_URL/api/register"     -H "Content-Type: application/json"     -H "Authorization: Bearer $(tok_of "$STAFF")"     -H "Idempotency-Key: $(idem_key)"     -d @-)
  case "$code" in
    200|201) CREATED=$((CREATED + 1)); echo "  created ($code)" ;;
    *)       FAILED=$((FAILED + 1))
             echo "  FAILED ($code): $(head -c 200 /tmp/mc_demo_body)" >&2 ;;
  esac
}

# Fail loudly if the session is not one this API will accept. Without this the
# five registrations below each fail on their own and the script still finishes
# with a success banner.
PROBE=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/api/patients" -H "Authorization: Bearer $(tok_of "$STAFF")")
if [ "$PROBE" != "200" ]; then
  echo "ERROR: the API rejected the session ($PROBE)." >&2
  exit 1
fi
echo "Session accepted by the API"
echo ""

echo "Step 1: Registering Demo Patients..."
echo ""

# Patient 1 - Diabetic with multiple conditions
echo "Creating Adaeze Nwosu (diabetic patient)..."
post_patient <<'JSON'
{
    "full_name": "Adaeze Nwosu",
    "date_of_birth": "1975-03-15",
    "national_id": "NGA-12345678901",
    "blood_type": "A+",
    "allergies": ["Penicillin", "Sulfa drugs", "Latex"],
    "current_medications": ["Metformin 500mg", "Lisinopril 10mg", "Atorvastatin 20mg"],
    "chronic_conditions": ["Type 2 Diabetes", "Hypertension", "Hyperlipidemia"],
    "emergency_contact_name": "Chukwuemeka Nwosu",
    "emergency_contact_phone": "+234-802-345-6789",
    "emergency_contact_relationship": "Spouse",
    "organ_donor": true,
    "dnr_status": false,
    "languages": ["en", "ig"]
}
JSON
echo ""

# Patient 2 - Cardiac patient with DNR
echo "Creating Emeka Okafor (cardiac patient with DNR)..."
post_patient <<'JSON'
{
    "full_name": "Emeka Okafor",
    "date_of_birth": "1948-11-22",
    "national_id": "NGA-98765432109",
    "blood_type": "O-",
    "allergies": ["Aspirin", "Codeine"],
    "current_medications": ["Warfarin 5mg", "Digoxin 0.125mg", "Furosemide 40mg", "Morphine PRN"],
    "chronic_conditions": ["Congestive Heart Failure", "Atrial Fibrillation", "Stage 4 CKD"],
    "emergency_contact_name": "Ngozi Okafor",
    "emergency_contact_phone": "+234-803-456-7890",
    "emergency_contact_relationship": "Daughter",
    "organ_donor": false,
    "dnr_status": true,
    "languages": ["en", "yo"]
}
JSON
echo ""

# Patient 3 - Pregnant with gestational diabetes
echo "Creating Aisha Bello (pregnant patient)..."
post_patient <<'JSON'
{
    "full_name": "Aisha Bello",
    "date_of_birth": "1992-07-08",
    "national_id": "NGA-45678901234",
    "blood_type": "B+",
    "allergies": ["Shellfish"],
    "current_medications": ["Prenatal vitamins", "Insulin glargine 10 units"],
    "chronic_conditions": ["Gestational Diabetes", "Pregnancy - 32 weeks"],
    "emergency_contact_name": "Ibrahim Bello",
    "emergency_contact_phone": "+234-805-678-9012",
    "emergency_contact_relationship": "Husband",
    "organ_donor": false,
    "dnr_status": false,
    "languages": ["en", "ha", "ar"]
}
JSON
echo ""

# Patient 4 - Pediatric with severe allergies
echo "Creating Oluwaseyi Adeyemi (pediatric patient with allergies)..."
post_patient <<'JSON'
{
    "full_name": "Oluwaseyi Adeyemi",
    "date_of_birth": "2018-02-14",
    "national_id": "NGA-11223344556",
    "blood_type": "AB+",
    "allergies": ["Peanuts", "Tree nuts", "Eggs", "Milk", "Bee stings"],
    "current_medications": ["EpiPen", "Cetirizine 5mg", "Albuterol inhaler"],
    "chronic_conditions": ["Severe Food Allergies", "Asthma", "Eczema"],
    "emergency_contact_name": "Folake Adeyemi",
    "emergency_contact_phone": "+234-806-789-0123",
    "emergency_contact_relationship": "Mother",
    "organ_donor": false,
    "dnr_status": false,
    "languages": ["en", "yo"]
}
JSON
echo ""

# Patient 5 - Mental health conditions
echo "Creating Chidinma Eze (mental health patient)..."
post_patient <<'JSON'
{
    "full_name": "Chidinma Eze",
    "date_of_birth": "1985-09-30",
    "national_id": "NGA-99887766554",
    "blood_type": "A-",
    "allergies": ["Haloperidol"],
    "current_medications": ["Sertraline 100mg", "Olanzapine 10mg", "Lorazepam 1mg PRN"],
    "chronic_conditions": ["Bipolar Disorder Type I", "Generalized Anxiety Disorder", "Insomnia"],
    "emergency_contact_name": "Uchenna Eze",
    "emergency_contact_phone": "+234-807-890-1234",
    "emergency_contact_relationship": "Brother",
    "organ_donor": true,
    "dnr_status": false,
    "languages": ["en", "ig"]
}
JSON
echo ""

echo "============================================="
if [ "$FAILED" -eq 0 ]; then
  echo "   Demo Users Setup Complete! ($CREATED created)"
else
  echo "   Demo Users Setup INCOMPLETE: $CREATED created, $FAILED failed"
fi
echo "============================================="
echo ""
echo "SIGN-IN: staff sign in with an employee id and password (POST /api/auth/login)."
echo "  Each patient registered above returned an activation code; the patient redeems"
echo "  it, choosing a username and password. There is no identity header."
echo ""
echo "DEMO PATIENTS REQUESTED:"
echo "  - Adaeze Nwosu (Diabetic with multiple conditions)"
echo "  - Emeka Okafor (Cardiac patient with DNR)"
echo "  - Aisha Bello (Pregnant, gestational diabetes)"
echo "  - Oluwaseyi Adeyemi (Pediatric, severe allergies)"
echo "  - Chidinma Eze (Mental health conditions)"
echo ""
echo "To list all patients: curl http://localhost:8090/api/patients -H 'Authorization: Bearer <token from POST /api/auth/login>'"
echo ""

# Non-zero when anything failed, so a caller can tell.
[ "$FAILED" -eq 0 ]
