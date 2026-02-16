# MediChain Demo Users Setup Script for Windows PowerShell
# Run this after starting the API server with start-server.bat

$API_URL = "http://localhost:8080"

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "   MediChain Demo Users Setup" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Check if server is running
Write-Host "Checking API server..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$API_URL/health" -Method Get -ErrorAction Stop
    Write-Host "Server is running - Version: $($health.version)" -ForegroundColor Green
}
catch {
    Write-Host "ERROR: Server not running. Start it first with start-server.bat" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Using existing demo staff accounts:" -ForegroundColor Yellow
Write-Host "  ADMIN-001   - System Administrator" -ForegroundColor Gray
Write-Host "  DOC-001     - Dr. Oluwaseun Adebayo (Cardiologist)" -ForegroundColor Gray
Write-Host "  NURSE-001   - Nurse Amina Yusuf (ICU)" -ForegroundColor Gray
Write-Host "  LAB-001     - Kwame Asante (Lab Technician)" -ForegroundColor Gray
Write-Host "  PHARMA-001  - Zainab Mohammed (Pharmacist)" -ForegroundColor Gray
Write-Host ""

Write-Host "Step 1: Registering Demo Patients..." -ForegroundColor Yellow
Write-Host ""

$headers = @{
    "Content-Type" = "application/json"
    "X-User-Id" = "DOC-001"
}

# Patient 1 - Diabetic with multiple conditions
Write-Host "Creating Adaeze Nwosu (diabetic patient)..." -ForegroundColor White
$patient1 = @{
    full_name = "Adaeze Nwosu"
    date_of_birth = "1975-03-15"
    national_id = "NGA-12345678901"
    blood_type = "A+"
    allergies = @("Penicillin", "Sulfa drugs", "Latex")
    current_medications = @("Metformin 500mg", "Lisinopril 10mg", "Atorvastatin 20mg")
    chronic_conditions = @("Type 2 Diabetes", "Hypertension", "Hyperlipidemia")
    emergency_contact_name = "Chukwuemeka Nwosu"
    emergency_contact_phone = "+234-802-345-6789"
    emergency_contact_relationship = "Spouse"
    organ_donor = $true
    dnr_status = $false
    languages = @("en", "ig")
} | ConvertTo-Json

try {
    $result = Invoke-RestMethod -Uri "$API_URL/api/register" -Method Post -Body $patient1 -Headers $headers -ErrorAction Stop
    Write-Host "  Created: $($result.patient_id)" -ForegroundColor Green
}
catch {
    Write-Host "  Already exists or error" -ForegroundColor Gray
}

# Patient 2 - Cardiac patient with DNR
Write-Host "Creating Emeka Okafor (cardiac patient with DNR)..." -ForegroundColor White
$patient2 = @{
    full_name = "Emeka Okafor"
    date_of_birth = "1948-11-22"
    national_id = "NGA-98765432109"
    blood_type = "O-"
    allergies = @("Aspirin", "Codeine")
    current_medications = @("Warfarin 5mg", "Digoxin 0.125mg", "Furosemide 40mg", "Morphine PRN")
    chronic_conditions = @("Congestive Heart Failure", "Atrial Fibrillation", "Stage 4 CKD")
    emergency_contact_name = "Ngozi Okafor"
    emergency_contact_phone = "+234-803-456-7890"
    emergency_contact_relationship = "Daughter"
    organ_donor = $false
    dnr_status = $true
    languages = @("en", "yo")
} | ConvertTo-Json

try {
    $result = Invoke-RestMethod -Uri "$API_URL/api/register" -Method Post -Body $patient2 -Headers $headers -ErrorAction Stop
    Write-Host "  Created: $($result.patient_id)" -ForegroundColor Green
}
catch {
    Write-Host "  Already exists or error" -ForegroundColor Gray
}

# Patient 3 - Pregnant with gestational diabetes
Write-Host "Creating Aisha Bello (pregnant patient)..." -ForegroundColor White
$patient3 = @{
    full_name = "Aisha Bello"
    date_of_birth = "1992-07-08"
    national_id = "NGA-45678901234"
    blood_type = "B+"
    allergies = @("Shellfish")
    current_medications = @("Prenatal vitamins", "Insulin glargine 10 units")
    chronic_conditions = @("Gestational Diabetes", "Pregnancy - 32 weeks")
    emergency_contact_name = "Ibrahim Bello"
    emergency_contact_phone = "+234-805-678-9012"
    emergency_contact_relationship = "Husband"
    organ_donor = $false
    dnr_status = $false
    languages = @("en", "ha", "ar")
} | ConvertTo-Json

try {
    $result = Invoke-RestMethod -Uri "$API_URL/api/register" -Method Post -Body $patient3 -Headers $headers -ErrorAction Stop
    Write-Host "  Created: $($result.patient_id)" -ForegroundColor Green
}
catch {
    Write-Host "  Already exists or error" -ForegroundColor Gray
}

# Patient 4 - Pediatric with severe allergies
Write-Host "Creating Oluwaseyi Adeyemi (pediatric patient with allergies)..." -ForegroundColor White
$patient4 = @{
    full_name = "Oluwaseyi Adeyemi"
    date_of_birth = "2018-02-14"
    national_id = "NGA-11223344556"
    blood_type = "AB+"
    allergies = @("Peanuts", "Tree nuts", "Eggs", "Milk", "Bee stings")
    current_medications = @("EpiPen", "Cetirizine 5mg", "Albuterol inhaler")
    chronic_conditions = @("Severe Food Allergies", "Asthma", "Eczema")
    emergency_contact_name = "Folake Adeyemi"
    emergency_contact_phone = "+234-806-789-0123"
    emergency_contact_relationship = "Mother"
    organ_donor = $false
    dnr_status = $false
    languages = @("en", "yo")
} | ConvertTo-Json

try {
    $result = Invoke-RestMethod -Uri "$API_URL/api/register" -Method Post -Body $patient4 -Headers $headers -ErrorAction Stop
    Write-Host "  Created: $($result.patient_id)" -ForegroundColor Green
}
catch {
    Write-Host "  Already exists or error" -ForegroundColor Gray
}

# Patient 5 - Mental health conditions
Write-Host "Creating Chidinma Eze (mental health patient)..." -ForegroundColor White
$patient5 = @{
    full_name = "Chidinma Eze"
    date_of_birth = "1985-09-30"
    national_id = "NGA-99887766554"
    blood_type = "A-"
    allergies = @("Haloperidol")
    current_medications = @("Sertraline 100mg", "Olanzapine 10mg", "Lorazepam 1mg PRN")
    chronic_conditions = @("Bipolar Disorder Type I", "Generalized Anxiety Disorder", "Insomnia")
    emergency_contact_name = "Uchenna Eze"
    emergency_contact_phone = "+234-807-890-1234"
    emergency_contact_relationship = "Brother"
    organ_donor = $true
    dnr_status = $false
    languages = @("en", "ig")
} | ConvertTo-Json

try {
    $result = Invoke-RestMethod -Uri "$API_URL/api/register" -Method Post -Body $patient5 -Headers $headers -ErrorAction Stop
    Write-Host "  Created: $($result.patient_id)" -ForegroundColor Green
}
catch {
    Write-Host "  Already exists or error" -ForegroundColor Gray
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "   Demo Setup Complete" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "DEMO STAFF ACCOUNTS (use X-User-Id header):" -ForegroundColor Yellow
Write-Host "  ADMIN-001   - System Administrator" -ForegroundColor White
Write-Host "  DOC-001     - Dr. Oluwaseun Adebayo" -ForegroundColor White
Write-Host "  NURSE-001   - Nurse Amina Yusuf" -ForegroundColor White
Write-Host "  LAB-001     - Kwame Asante" -ForegroundColor White
Write-Host "  PHARMA-001  - Zainab Mohammed" -ForegroundColor White
Write-Host ""
Write-Host "DEMO PATIENTS:" -ForegroundColor Yellow
Write-Host "  - Adaeze Nwosu (Diabetic with multiple conditions)" -ForegroundColor White
Write-Host "  - Emeka Okafor (Cardiac patient with DNR)" -ForegroundColor White
Write-Host "  - Aisha Bello (Pregnant, gestational diabetes)" -ForegroundColor White
Write-Host "  - Oluwaseyi Adeyemi (Pediatric, severe allergies)" -ForegroundColor White
Write-Host "  - Chidinma Eze (Mental health conditions)" -ForegroundColor White
Write-Host ""
Write-Host "Plus 12 South African patients auto-created by server" -ForegroundColor Gray
Write-Host ""
Write-Host "To view all patients:" -ForegroundColor Green
Write-Host "  curl http://localhost:8080/api/patients -H 'X-User-Id: DOC-001'" -ForegroundColor Gray
Write-Host ""
