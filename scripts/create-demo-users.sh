#!/bin/bash
# MediChain Demo Users Creation Script
# This creates demo users using the OLD demo user format (DOC-001, NURSE-001, etc.)

API_URL="http://localhost:8080"

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

echo "Step 1: Registering Demo Patients..."
echo ""

# Patient 1 - Diabetic with multiple conditions
echo "Creating Adaeze Nwosu (diabetic patient)..."
curl -s -X POST "$API_URL/api/register" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: DOC-001" \
  -d '{
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
  }'
echo ""

# Patient 2 - Cardiac patient with DNR
echo "Creating Emeka Okafor (cardiac patient with DNR)..."
curl -s -X POST "$API_URL/api/register" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: DOC-001" \
  -d '{
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
  }'
echo ""

# Patient 3 - Pregnant with gestational diabetes
echo "Creating Aisha Bello (pregnant patient)..."
curl -s -X POST "$API_URL/api/register" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: DOC-001" \
  -d '{
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
  }'
echo ""

# Patient 4 - Pediatric with severe allergies
echo "Creating Oluwaseyi Adeyemi (pediatric patient with allergies)..."
curl -s -X POST "$API_URL/api/register" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: DOC-001" \
  -d '{
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
  }'
echo ""

# Patient 5 - Mental health conditions
echo "Creating Chidinma Eze (mental health patient)..."
curl -s -X POST "$API_URL/api/register" \
  -H "Content-Type: application/json" \
  -H "X-User-Id: DOC-001" \
  -d '{
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
  }'
echo ""

echo "============================================="
echo "   Demo Users Setup Complete!"
echo "============================================="
echo ""
echo "DEMO STAFF ACCOUNTS (use X-User-Id header):"
echo "  ADMIN-001   - System Administrator"
echo "  DOC-001     - Dr. Oluwaseun Adebayo (Cardiologist)"
echo "  NURSE-001   - Nurse Amina Yusuf (ICU)"  
echo "  LAB-001     - Kwame Asante (Lab Technician)"
echo "  PHARMA-001  - Zainab Mohammed (Pharmacist)"
echo ""
echo "DEMO PATIENTS CREATED:"
echo "  - Adaeze Nwosu (Diabetic with multiple conditions)"
echo "  - Emeka Okafor (Cardiac patient with DNR)"
echo "  - Aisha Bello (Pregnant, gestational diabetes)"
echo "  - Oluwaseyi Adeyemi (Pediatric, severe allergies)"
echo "  - Chidinma Eze (Mental health conditions)"
echo ""
echo "To list all patients: curl http://localhost:8080/api/patients -H 'X-User-Id: DOC-001'"
echo ""
