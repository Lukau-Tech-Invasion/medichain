# MediChain Demo Data Seeding Script
# ===================================
# This script has two modes:
# 1. DATABASE MODE: Runs migrations to seed data permanently
# 2. API MODE: Creates data through API calls (temporary until restart)
#
# For persistent data, use: .\seed-demo-data.ps1 -Mode database
# For API testing, use:     .\seed-demo-data.ps1 -Mode api

param(
    [ValidateSet("database", "api")]
    [string]$Mode = "api"
)

$API_BASE = "http://localhost:8080"
$DOCTOR_ID = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"  # Demo doctor wallet

Write-Host "MediChain Demo Data Seeding Script" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Mode: $Mode" -ForegroundColor Yellow
Write-Host ""

# ============================================
# DATABASE MODE - Run migrations
# ============================================
if ($Mode -eq "database") {
    Write-Host "DATABASE MODE: Running migrations for persistent demo data" -ForegroundColor Cyan
    Write-Host ""
    
    # Check for sqlx-cli
    $sqlxInstalled = Get-Command sqlx -ErrorAction SilentlyContinue
    if (-not $sqlxInstalled) {
        Write-Host "[WARN] sqlx-cli not installed. Install with: cargo install sqlx-cli" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Alternatively, run the SQL manually:" -ForegroundColor Yellow
        Write-Host "1. Connect to PostgreSQL: psql -U medichain -d medichain" -ForegroundColor White
        Write-Host "2. Run: \i api/migrations/20260126000001_demo_patients.sql" -ForegroundColor White
        exit 1
    }
    
    # Check DATABASE_URL
    if (-not $env:DATABASE_URL) {
        Write-Host "[ERROR] DATABASE_URL not set. Set it with:" -ForegroundColor Red
        Write-Host '  $env:DATABASE_URL = "postgresql://medichain:medichain_dev_2024@localhost:5432/medichain"' -ForegroundColor White
        exit 1
    }
    
    Write-Host "Running sqlx migrations..." -ForegroundColor Yellow
    Push-Location "c:\Users\Admin\OneDrive\Documents\New folder\MEDICHAIN DEVELOPMENT\medichain\api"
    try {
        sqlx migrate run
        Write-Host "[OK] Migrations completed successfully!" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Migration failed: $_" -ForegroundColor Red
    }
    Pop-Location
    
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "1. Restart the API server: .\run-api.bat" -ForegroundColor White
    Write-Host "2. The server will load demo patients at startup" -ForegroundColor White
    Write-Host "3. Open Doctor Portal: http://localhost:5173" -ForegroundColor White
    exit 0
}

# ============================================
# API MODE - Create data through API calls
# ============================================
Write-Host "API MODE: Creating demo data through API calls" -ForegroundColor Cyan
Write-Host "(Data persists until server restart)" -ForegroundColor Yellow
Write-Host ""

# Check if API is running
Write-Host "Checking API health..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$API_BASE/api/health" -Method Get -ErrorAction Stop
    Write-Host "[OK] API is running: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] API is not running. Start it with: .\run-api.bat" -ForegroundColor Red
    exit 1
}

# Common headers
$headers = @{
    "Content-Type" = "application/json"
    "X-User-Id" = $DOCTOR_ID
}

# Track created patient IDs
$patientIds = @()

# ============================================
# STEP 1: Register Demo Patients
# ============================================
Write-Host ""
Write-Host "Step 1: Registering Demo Patients" -ForegroundColor Cyan
Write-Host "---------------------------------" -ForegroundColor Cyan

$demoPatients = @(
    @{
        full_name = "John Smith"
        date_of_birth = "1985-03-15"
        national_id = "NID-1001"
        blood_type = "A+"
        allergies = @("Penicillin", "Peanuts")
        current_medications = @("Lisinopril 10mg daily")
        chronic_conditions = @("Hypertension")
        emergency_contact_name = "Jane Smith"
        emergency_contact_phone = "+1-555-0101"
        emergency_contact_relationship = "Spouse"
        organ_donor = $true
        dnr_status = $false
        languages = @("English")
    },
    @{
        full_name = "Maria Garcia"
        date_of_birth = "1990-07-22"
        national_id = "NID-1002"
        blood_type = "O-"
        allergies = @("Sulfa drugs")
        current_medications = @("Metformin 500mg twice daily", "Atorvastatin 20mg")
        chronic_conditions = @("Type 2 Diabetes", "High Cholesterol")
        emergency_contact_name = "Carlos Garcia"
        emergency_contact_phone = "+1-555-0102"
        emergency_contact_relationship = "Brother"
        organ_donor = $true
        dnr_status = $false
        languages = @("English", "Spanish")
    },
    @{
        full_name = "Robert Johnson"
        date_of_birth = "1978-11-08"
        national_id = "NID-1003"
        blood_type = "B+"
        allergies = @()
        current_medications = @("Albuterol inhaler PRN")
        chronic_conditions = @("Asthma")
        emergency_contact_name = "Linda Johnson"
        emergency_contact_phone = "+1-555-0103"
        emergency_contact_relationship = "Wife"
        organ_donor = $false
        dnr_status = $false
        languages = @("English")
    },
    @{
        full_name = "Emily Chen"
        date_of_birth = "1995-01-30"
        national_id = "NID-1004"
        blood_type = "AB+"
        allergies = @("Latex", "Ibuprofen")
        current_medications = @()
        chronic_conditions = @()
        emergency_contact_name = "Michael Chen"
        emergency_contact_phone = "+1-555-0104"
        emergency_contact_relationship = "Father"
        organ_donor = $true
        dnr_status = $false
        languages = @("English", "Mandarin")
    },
    @{
        full_name = "James Wilson"
        date_of_birth = "1962-05-18"
        national_id = "NID-1005"
        blood_type = "O+"
        allergies = @("Aspirin")
        current_medications = @("Warfarin 5mg daily", "Digoxin 0.125mg", "Furosemide 40mg")
        chronic_conditions = @("Atrial Fibrillation", "Heart Failure")
        emergency_contact_name = "Sarah Wilson"
        emergency_contact_phone = "+1-555-0105"
        emergency_contact_relationship = "Daughter"
        organ_donor = $false
        dnr_status = $true
        languages = @("English")
    }
)

foreach ($patient in $demoPatients) {
    try {
        $body = $patient | ConvertTo-Json -Depth 3
        $response = Invoke-RestMethod -Uri "$API_BASE/api/register" -Method Post -Headers $headers -Body $body -ErrorAction Stop
        if ($response.success) {
            $patientIds += $response.patient_id
            Write-Host "[OK] Registered: $($patient.full_name) -> $($response.patient_id)" -ForegroundColor Green
        } else {
            Write-Host "[WARN] Failed to register $($patient.full_name): $($response.message)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "[ERROR] Failed to register $($patient.full_name): $($_.Exception.Message)" -ForegroundColor Red
    }
}

# ============================================
# STEP 2: Create Triage Assessments
# ============================================
Write-Host ""
Write-Host "Step 2: Creating Triage Assessments" -ForegroundColor Cyan
Write-Host "-----------------------------------" -ForegroundColor Cyan

if ($patientIds.Count -ge 2) {
    # Triage for first patient - ESI Level 3
    $triage1 = @{
        patient_id = $patientIds[0]
        chief_complaint = "Chest pain, started 2 hours ago"
        esi_level = 3
        pain_scale = 6
        vital_signs = @{
            blood_pressure_systolic = 142
            blood_pressure_diastolic = 88
            heart_rate = 92
            respiratory_rate = 18
            temperature_celsius = 37.1
            oxygen_saturation = 97
            consciousness_level = "Alert"
        }
        arrival_mode = "Walk-in"
        notes = "Patient reports substernal chest pain, radiating to left arm. History of hypertension."
    }
    
    try {
        $body = $triage1 | ConvertTo-Json -Depth 5
        $response = Invoke-RestMethod -Uri "$API_BASE/api/clinical/triage" -Method Post -Headers $headers -Body $body -ErrorAction Stop
        Write-Host "[OK] Created triage for patient $($patientIds[0])" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Failed to create triage: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    # Triage for second patient - ESI Level 4
    $triage2 = @{
        patient_id = $patientIds[1]
        chief_complaint = "Blood sugar check, feeling dizzy"
        esi_level = 4
        pain_scale = 2
        vital_signs = @{
            blood_pressure_systolic = 128
            blood_pressure_diastolic = 78
            heart_rate = 76
            respiratory_rate = 16
            temperature_celsius = 36.8
            oxygen_saturation = 99
            consciousness_level = "Alert"
        }
        arrival_mode = "Walk-in"
        notes = "Diabetic patient, reports mild dizziness. Blood glucose 245 mg/dL on finger stick."
    }
    
    try {
        $body = $triage2 | ConvertTo-Json -Depth 5
        $response = Invoke-RestMethod -Uri "$API_BASE/api/clinical/triage" -Method Post -Headers $headers -Body $body -ErrorAction Stop
        Write-Host "[OK] Created triage for patient $($patientIds[1])" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Failed to create triage: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# ============================================
# STEP 3: Create SOAP Notes
# ============================================
Write-Host ""
Write-Host "Step 3: Creating SOAP Notes" -ForegroundColor Cyan
Write-Host "---------------------------" -ForegroundColor Cyan

if ($patientIds.Count -ge 1) {
    $soapNote = @{
        patient_id = $patientIds[0]
        subjective = "Patient is a 39-year-old male presenting with substernal chest pain for 2 hours. Pain is described as pressure-like, 6/10, radiating to left arm. Associated with mild shortness of breath. Denies nausea, vomiting, or diaphoresis. Patient has history of hypertension, on Lisinopril. Reports stress at work recently."
        objective = "Vitals: BP 142/88, HR 92, RR 18, Temp 37.1C, SpO2 97% RA. General: Alert, appears anxious. Cardiac: Regular rate and rhythm, no murmurs. Lungs: Clear bilaterally. Abdomen: Soft, non-tender. Extremities: No edema, pulses 2+ bilaterally."
        assessment = "1. Chest pain - likely musculoskeletal vs cardiac origin, requires further workup. 2. Hypertension - suboptimally controlled. 3. Anxiety - contributing to symptoms."
        plan = "1. ECG and troponin levels STAT. 2. Chest X-ray. 3. If cardiac workup negative, trial of NSAIDs and muscle relaxant. 4. Increase Lisinopril to 20mg daily. 5. Follow up in 1 week or return if symptoms worsen."
        encounter_type = "Emergency"
        diagnosis_codes = @("R07.9", "I10")
    }
    
    try {
        $body = $soapNote | ConvertTo-Json -Depth 3
        $response = Invoke-RestMethod -Uri "$API_BASE/api/clinical/soap" -Method Post -Headers $headers -Body $body -ErrorAction Stop
        Write-Host "[OK] Created SOAP note for patient $($patientIds[0])" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Failed to create SOAP note: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# ============================================
# STEP 4: Submit Lab Results
# ============================================
Write-Host ""
Write-Host "Step 4: Submitting Lab Results" -ForegroundColor Cyan
Write-Host "------------------------------" -ForegroundColor Cyan

# Use lab technician wallet for lab submissions
$LAB_TECH_ID = "5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL"
$labHeaders = @{
    "Content-Type" = "application/json"
    "X-User-Id" = $LAB_TECH_ID
}

if ($patientIds.Count -ge 1) {
    $labSubmission = @{
        patient_id = $patientIds[0]
        test_name = "Complete Blood Count"
        test_category = "Hematology"
        results = @(
            @{
                parameter = "Hemoglobin"
                value = "14.2"
                unit = "g/dL"
                reference_range = "12.0-17.5"
                flag = $null
            },
            @{
                parameter = "WBC Count"
                value = "8500"
                unit = "cells/mcL"
                reference_range = "4500-11000"
                flag = $null
            },
            @{
                parameter = "Platelet Count"
                value = "245000"
                unit = "cells/mcL"
                reference_range = "150000-400000"
                flag = $null
            }
        )
        notes = "Sample collected and processed per protocol. No issues noted."
    }
    
    try {
        $body = $labSubmission | ConvertTo-Json -Depth 4
        $response = Invoke-RestMethod -Uri "$API_BASE/api/lab/submit" -Method Post -Headers $labHeaders -Body $body -ErrorAction Stop
        Write-Host "[OK] Submitted lab results for patient $($patientIds[0])" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Failed to submit lab results: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    # Submit cardiac markers for chest pain patient
    $cardiacLabSubmission = @{
        patient_id = $patientIds[0]
        test_name = "Cardiac Markers"
        test_category = "Chemistry"
        results = @(
            @{
                parameter = "Troponin I"
                value = "0.02"
                unit = "ng/mL"
                reference_range = "0.00-0.04"
                flag = $null
            },
            @{
                parameter = "CK-MB"
                value = "2.1"
                unit = "ng/mL"
                reference_range = "0.0-6.6"
                flag = $null
            },
            @{
                parameter = "BNP"
                value = "45"
                unit = "pg/mL"
                reference_range = "0-100"
                flag = $null
            }
        )
        notes = "STAT cardiac workup - no acute ischemia indicated."
    }
    
    try {
        $body = $cardiacLabSubmission | ConvertTo-Json -Depth 4
        $response = Invoke-RestMethod -Uri "$API_BASE/api/lab/submit" -Method Post -Headers $labHeaders -Body $body -ErrorAction Stop
        Write-Host "[OK] Submitted cardiac markers for patient $($patientIds[0])" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Failed to submit cardiac markers: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# ============================================
# STEP 5: Create E-Prescriptions
# ============================================
Write-Host ""
Write-Host "Step 5: Creating E-Prescriptions" -ForegroundColor Cyan
Write-Host "---------------------------------" -ForegroundColor Cyan

if ($patientIds.Count -ge 2) {
    $rxId = "RX-" + (Get-Random -Minimum 100000 -Maximum 999999)
    $prescription = @{
        rx_id = $rxId
        patient_id = $patientIds[1]
        medication_name = "Metformin HCl"
        generic_name = "Metformin"
        ndc_code = "00591-2475-01"
        rxnorm_code = "860975"
        strength = "500mg"
        form = "Tablet"
        directions = "Take one tablet by mouth twice daily with meals"
        quantity = 60
        quantity_unit = "tablets"
        days_supply = 30
        refills = 3
        daw = $false
        prescriber = @{
            name = "Dr. Alice Cardio"
            npi = "1234567890"
            dea_number = "AC1234567"
            state_license = "MD12345"
            phone = "+1-555-0100"
            fax = "+1-555-0199"
        }
        pharmacy = @{
            name = "MediChain Pharmacy"
            ncpdp_id = "1234567"
            npi = "9876543210"
            address = "123 Health Street, Medical City, MC 12345"
            phone = "+1-555-0200"
            fax = "+1-555-0201"
        }
        written_date = (Get-Date).ToString("yyyy-MM-dd")
        effective_date = (Get-Date).ToString("yyyy-MM-dd")
        expiration_date = (Get-Date).AddYears(1).ToString("yyyy-MM-dd")
        diagnosis_codes = @("E11.9", "E78.5")
        prior_auth = $null
        schedule = $null
        status = "Active"
        transmitted_at = $null
        pharmacist_notes = "Patient has history of GI issues - advise taking with food"
    }
    
    try {
        $body = $prescription | ConvertTo-Json -Depth 4
        $response = Invoke-RestMethod -Uri "$API_BASE/api/clinical/e-prescription" -Method Post -Headers $headers -Body $body -ErrorAction Stop
        Write-Host "[OK] Created e-prescription $rxId for patient $($patientIds[1])" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Failed to create e-prescription: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# ============================================
# STEP 6: Send Messages
# ============================================
Write-Host ""
Write-Host "Step 6: Creating Messages" -ForegroundColor Cyan
Write-Host "-------------------------" -ForegroundColor Cyan

if ($patientIds.Count -ge 1) {
    $message = @{
        recipient_id = $patientIds[0]
        subject = "Lab Results Available"
        content = "Dear John Smith, your recent lab results are now available. Please log in to your patient portal to view them, or schedule a follow-up appointment to discuss with your doctor. If you have any urgent concerns, please call our office."
        priority = "Normal"
        message_type = "Clinical"
    }
    
    try {
        $body = $message | ConvertTo-Json -Depth 3
        $response = Invoke-RestMethod -Uri "$API_BASE/api/messages/send" -Method Post -Headers $headers -Body $body -ErrorAction Stop
        Write-Host "[OK] Sent message to patient $($patientIds[0])" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Failed to send message: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# ============================================
# STEP 7: Verify Dashboard Data
# ============================================
Write-Host ""
Write-Host "Step 7: Verifying Dashboard Data" -ForegroundColor Cyan
Write-Host "--------------------------------" -ForegroundColor Cyan

try {
    $dashboard = Invoke-RestMethod -Uri "$API_BASE/api/dashboard/doctor" -Method Get -Headers $headers -ErrorAction Stop
    Write-Host "[OK] Dashboard loaded successfully" -ForegroundColor Green
    Write-Host "    - Total Patients: $($dashboard.total_patients)" -ForegroundColor White
    Write-Host "    - Today's Appointments: $($dashboard.todays_appointments)" -ForegroundColor White
    Write-Host "    - Pending Labs: $($dashboard.pending_labs)" -ForegroundColor White
    Write-Host "    - Active Alerts: $($dashboard.active_alerts)" -ForegroundColor White
} catch {
    Write-Host "[ERROR] Failed to load dashboard: $($_.Exception.Message)" -ForegroundColor Red
}

# ============================================
# Summary
# ============================================
Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Demo Data Seeding Complete!" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Created $($patientIds.Count) patients:" -ForegroundColor White
foreach ($id in $patientIds) {
    Write-Host "  - $id" -ForegroundColor Gray
}
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Open Doctor Portal: http://localhost:5173" -ForegroundColor White
Write-Host "2. Login with wallet: $DOCTOR_ID" -ForegroundColor White
Write-Host "3. View dashboard to see patients and data" -ForegroundColor White
Write-Host ""
