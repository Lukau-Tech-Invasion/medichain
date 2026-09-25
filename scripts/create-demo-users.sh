#!/bin/bash
# MediChain Demo Users Creation Script
# This creates demo users using the OLD demo user format (DOC-001, NURSE-001, etc.)

API_URL="${API_URL:-http://localhost:8090}"
# The identity these registrations are made as. It used to be hard-coded to
# DOC-001, which does not exist on every database -- and the script reported
# success anyway. Override for a deployment whose staff are wallet addresses.
STAFF_ID="${STAFF_ID:-DOC-001}"

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

# The current binary uses demo users: ADMIN-001, DOC-001, NURSE-001, LAB-001, PHARMA-001
echo "Using existing demo staff accounts:"
echo "  - ADMIN-001 (System Administrator)"
echo "  - DOC-001 (Dr. Oluwaseun Adebayo - Cardiologist)"
echo "  - NURSE-001 (Nurse Amina Yusuf - ICU)"
echo "  - LAB-001 (Kwame Asante - Lab Technician)"
echo "  - PHARMA-001 (Zainab Mohammed - Pharmacist)"
echo ""

# A fresh Idempotency-Key per registration.
#
# `api/src/middleware/idempotency.rs` refuses any authenticated mutation that
# arrives without one, and every call below carries `X-User-Id`, so all five
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
# unconditionally. With a stale STAFF_ID that meant five USER_NOT_FOUND
# responses scrolling past, followed by a success banner naming patients that
# do not exist. A setup script that cannot fail is not a setup script.
post_patient() {
  local code
  code=$(curl -s -o /tmp/mc_demo_body -w '%{http_code}' -X POST "$API_URL/api/register"     -H "Content-Type: application/json"     -H "X-User-Id: $STAFF_ID"     -H "Idempotency-Key: $(idem_key)"     -d @-)
  case "$code" in
    200|201) CREATED=$((CREATED + 1)); echo "  created ($code)" ;;
    *)       FAILED=$((FAILED + 1))
             echo "  FAILED ($code): $(head -c 200 /tmp/mc_demo_body)" >&2 ;;
  esac
}

# Fail loudly if the registering identity is not one this API will accept.
# Without this the five registrations below each fail on their own and the
# script still finishes with a success banner. The PowerShell twin has had
# this probe for a while; the bash one did not.
echo "Registering as: $STAFF_ID"
PROBE=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/api/patients" -H "X-User-Id: $STAFF_ID")
if [ "$PROBE" != "200" ]; then
  echo "ERROR: the API rejected X-User-Id '$STAFF_ID' ($PROBE)." >&2
  echo "       Set STAFF_ID to an active Doctor or Admin on this database." >&2
  exit 1
fi
echo "Identity accepted by the API"
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
echo "DEMO STAFF ACCOUNTS (use X-User-Id header):"
echo "  ADMIN-001   - System Administrator"
echo "  DOC-001     - Dr. Oluwaseun Adebayo (Cardiologist)"
echo "  NURSE-001   - Nurse Amina Yusuf (ICU)"  
echo "  LAB-001     - Kwame Asante (Lab Technician)"
echo "  PHARMA-001  - Zainab Mohammed (Pharmacist)"
echo ""
echo "DEMO PATIENTS REQUESTED:"
echo "  - Adaeze Nwosu (Diabetic with multiple conditions)"
echo "  - Emeka Okafor (Cardiac patient with DNR)"
echo "  - Aisha Bello (Pregnant, gestational diabetes)"
echo "  - Oluwaseyi Adeyemi (Pediatric, severe allergies)"
echo "  - Chidinma Eze (Mental health conditions)"
echo ""
echo "To list all patients: curl http://localhost:8090/api/patients -H 'X-User-Id: DOC-001'"
echo ""

# Non-zero when anything failed, so a caller can tell.
[ "$FAILED" -eq 0 ]
