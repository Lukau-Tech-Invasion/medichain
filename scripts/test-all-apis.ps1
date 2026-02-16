# MediChain Comprehensive API Test Script
# =========================================
# Tests ALL API endpoints with performance metrics
# Outputs results in JSON format for analysis
#
# Usage: .\test-all-apis.ps1 [-OutputFile results.json] [-Verbose]

param(
    [string]$OutputFile = "api-test-results.json",
    [switch]$Verbose,
    [string]$ApiBase = "http://localhost:8080"
)

# ============================================
# Configuration
# ============================================
$API_BASE = $ApiBase

# Demo User Wallet Addresses (from database)
$USERS = @{
    Admin      = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
    Doctor     = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"
    Nurse      = "5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL"
    LabTech    = "5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFc"
    Pharmacist = "5Ew3MyB15VprZrjQVkpQFj8okmc9xLDSEdNhqMMS5cXsqxoW"
    Patient    = "5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z"
}

# Test results storage
$TestResults = @{
    timestamp        = (Get-Date).ToString("o")
    api_base         = $API_BASE
    total_tests      = 0
    passed           = 0
    failed           = 0
    skipped          = 0
    total_time_ms    = 0
    categories       = @{}
    detailed_results = @()
}

# Global tracking for created resources
$CreatedResources = @{
    PatientId       = $null
    AppointmentId   = $null
    TriageId        = $null
    SoapNoteId      = $null
    LabSubmissionId = $null
    PrescriptionId  = $null
    MessageId       = $null
    SessionId       = $null
}

# ============================================
# Helper Functions
# ============================================
function Write-TestLog {
    param([string]$Message, [string]$Color = "White")
    if ($Verbose) {
        Write-Host $Message -ForegroundColor $Color
    }
}

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Category,
        [string]$Method,
        [string]$Endpoint,
        [string]$UserId = $USERS.Doctor,
        [object]$Body = $null,
        [int]$ExpectedStatus = 200,
        [string]$Description = ""
    )
    
    $TestResults.total_tests++
    
    $headers = @{
        "Content-Type" = "application/json"
        "X-User-Id"    = $UserId
        "Accept"       = "application/json"
    }
    
    $uri = "$API_BASE$Endpoint"
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    
    $result = @{
        name            = $Name
        category        = $Category
        method          = $Method
        endpoint        = $Endpoint
        expected_status = $ExpectedStatus
        description     = $Description
        user_role       = ($USERS.GetEnumerator() | Where-Object { $_.Value -eq $UserId } | Select-Object -First 1).Key
    }
    
    try {
        $params = @{
            Uri             = $uri
            Method          = $Method
            Headers         = $headers
            ErrorAction     = "Stop"
            UseBasicParsing = $true
        }
        
        if ($Body -and $Method -in @("POST", "PUT", "PATCH")) {
            $jsonBody = $Body | ConvertTo-Json -Depth 10 -Compress
            $params.Body = $jsonBody
        }
        
        $response = Invoke-WebRequest @params
        $stopwatch.Stop()
        
        $result.actual_status = $response.StatusCode
        $result.response_time_ms = $stopwatch.ElapsedMilliseconds
        $result.response_size_bytes = $response.RawContentLength
        
        # Try to parse response
        try {
            $result.response_preview = ($response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 2 -Compress).Substring(0, [Math]::Min(200, $response.Content.Length))
        }
        catch {
            $result.response_preview = $response.Content.Substring(0, [Math]::Min(200, $response.Content.Length))
        }
        
        if ($response.StatusCode -eq $ExpectedStatus -or ($ExpectedStatus -eq 200 -and $response.StatusCode -in @(200, 201))) {
            $result.status = "PASSED"
            $TestResults.passed++
            Write-TestLog "  [PASS] $Name ($($stopwatch.ElapsedMilliseconds)ms)" "Green"
        }
        else {
            $result.status = "FAILED"
            $result.error = "Expected status $ExpectedStatus, got $($response.StatusCode)"
            $TestResults.failed++
            Write-TestLog "  [FAIL] $Name - Expected $ExpectedStatus, got $($response.StatusCode)" "Red"
        }
        
        # Return response for chaining
        return @{
            Success = $true
            Content = $response.Content | ConvertFrom-Json -ErrorAction SilentlyContinue
            Result  = $result
        }
        
    }
    catch {
        $stopwatch.Stop()
        $result.response_time_ms = $stopwatch.ElapsedMilliseconds
        $result.status = "FAILED"
        $result.error = $_.Exception.Message
        
        # Try to get status code from error
        if ($_.Exception.Response) {
            $result.actual_status = [int]$_.Exception.Response.StatusCode
        }
        
        $TestResults.failed++
        Write-TestLog "  [FAIL] $Name - $($_.Exception.Message)" "Red"
        
        return @{
            Success = $false
            Content = $null
            Result  = $result
        }
    }
    finally {
        $TestResults.total_time_ms += $result.response_time_ms
        $TestResults.detailed_results += $result
        
        # Update category stats
        if (-not $TestResults.categories[$Category]) {
            $TestResults.categories[$Category] = @{
                total           = 0
                passed          = 0
                failed          = 0
                avg_response_ms = 0
                total_time_ms   = 0
            }
        }
        $TestResults.categories[$Category].total++
        if ($result.status -eq "PASSED") {
            $TestResults.categories[$Category].passed++
        }
        else {
            $TestResults.categories[$Category].failed++
        }
        $TestResults.categories[$Category].total_time_ms += $result.response_time_ms
        $TestResults.categories[$Category].avg_response_ms = [math]::Round($TestResults.categories[$Category].total_time_ms / $TestResults.categories[$Category].total)
    }
}

# ============================================
# Main Test Execution
# ============================================

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   MediChain Comprehensive API Test Suite" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   API Base: $API_BASE" -ForegroundColor Gray
Write-Host "   Started:  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# ============================================
# 1. HEALTH & SYSTEM ENDPOINTS
# ============================================
Write-Host "[1/20] Testing Health & System Endpoints..." -ForegroundColor Yellow

Test-Endpoint -Name "Health Check" -Category "Health" -Method "GET" -Endpoint "/health" -Description "Basic health check"
Test-Endpoint -Name "Health Detailed" -Category "Health" -Method "GET" -Endpoint "/api/health/detailed" -Description "Detailed health with dependencies"
Test-Endpoint -Name "IPFS Health" -Category "Health" -Method "GET" -Endpoint "/api/ipfs/health" -Description "IPFS storage health"
Test-Endpoint -Name "Demo Endpoint" -Category "Health" -Method "GET" -Endpoint "/api/demo" -Description "Demo data endpoint"

# ============================================
# 2. AUTHENTICATION ENDPOINTS
# ============================================
Write-Host "[2/20] Testing Authentication Endpoints..." -ForegroundColor Yellow

Test-Endpoint -Name "Auth Me" -Category "Auth" -Method "GET" -Endpoint "/api/auth/me" -Description "Get current user info"
Test-Endpoint -Name "Auth Wallet Lookup" -Category "Auth" -Method "GET" -Endpoint "/api/auth/wallet/$($USERS.Doctor)" -Description "Lookup user by wallet"
Test-Endpoint -Name "Auth Login GET" -Category "Auth" -Method "GET" -Endpoint "/api/auth/login/$($USERS.Doctor)" -Description "GET login endpoint"
Test-Endpoint -Name "Demo Login" -Category "Auth" -Method "POST" -Endpoint "/api/auth/demo-login" -Body @{ wallet_address = $USERS.Doctor } -Description "Demo login"
Test-Endpoint -Name "Staff List" -Category "Auth" -Method "GET" -Endpoint "/api/staff/all" -UserId $USERS.Admin -Description "List all staff members"

# ============================================
# 3. USER MANAGEMENT ENDPOINTS
# ============================================
Write-Host "[3/20] Testing User Management Endpoints..." -ForegroundColor Yellow

Test-Endpoint -Name "List Users" -Category "Users" -Method "GET" -Endpoint "/api/users" -UserId $USERS.Admin -Description "List all users"
Test-Endpoint -Name "Get User" -Category "Users" -Method "GET" -Endpoint "/api/users/$($USERS.Doctor)" -Description "Get specific user"

# ============================================
# 4. PATIENT REGISTRATION & MANAGEMENT
# ============================================
Write-Host "[4/20] Testing Patient Management Endpoints..." -ForegroundColor Yellow

# Register a new patient for testing
$newPatient = @{
    full_name                      = "Test Patient $(Get-Random -Maximum 9999)"
    date_of_birth                  = "1990-05-15"
    national_id                    = "TEST-NID-$(Get-Random -Maximum 99999)"
    blood_type                     = "A+"
    allergies                      = @("Penicillin")
    current_medications            = @("Aspirin 81mg")
    chronic_conditions             = @("Hypertension")
    emergency_contact_name         = "Emergency Contact"
    emergency_contact_phone        = "+1-555-1234"
    emergency_contact_relationship = "Spouse"
    organ_donor                    = $true
    dnr_status                     = $false
    languages                      = @("English")
}

$registerResult = Test-Endpoint -Name "Register Patient" -Category "Patients" -Method "POST" -Endpoint "/api/register" -Body $newPatient -ExpectedStatus 201 -Description "Register new patient"
if ($registerResult.Success -and $registerResult.Content.patient_id) {
    $CreatedResources.PatientId = $registerResult.Content.patient_id
    Write-TestLog "    Created patient: $($CreatedResources.PatientId)" "Cyan"
}

Test-Endpoint -Name "List Patients" -Category "Patients" -Method "GET" -Endpoint "/api/patients" -Description "List all patients"
# Note: /api/patients is the only list endpoint - there is no separate /api/patients/list
Test-Endpoint -Name "Patients List V2" -Category "Patients" -Method "GET" -Endpoint "/api/patients?page=1&limit=50" -Description "List patients with pagination"

if ($CreatedResources.PatientId) {
    Test-Endpoint -Name "Get Patient" -Category "Patients" -Method "GET" -Endpoint "/api/patients/$($CreatedResources.PatientId)" -Description "Get specific patient"
    Test-Endpoint -Name "Update Patient" -Category "Patients" -Method "PUT" -Endpoint "/api/patients/$($CreatedResources.PatientId)" -Body @{ full_name = "Updated Test Patient" } -Description "Update patient info"
}

# ============================================
# 5. APPOINTMENT ENDPOINTS
# ============================================
Write-Host "[5/20] Testing Appointment Endpoints..." -ForegroundColor Yellow

$patientId = if ($CreatedResources.PatientId) { $CreatedResources.PatientId } else { "PAT-001-DEMO" }

$newAppointment = @{
    patient_id       = $patientId
    provider_id      = $USERS.Doctor
    provider_name    = "Dr. Demo Doctor"
    appointment_type = "Follow-up"
    preferred_date   = (Get-Date).AddDays(1).ToString("yyyy-MM-dd")
    preferred_time   = "10:00"
    scheduled_at     = (Get-Date).AddDays(1).ToString("yyyy-MM-ddT10:00:00")
    duration_minutes = 30
    reason           = "Routine checkup"
    notes            = "Patient requested morning appointment"
    location_type    = "in-person"
    department       = "General Medicine"
}

$apptResult = Test-Endpoint -Name "Create Appointment" -Category "Appointments" -Method "POST" -Endpoint "/api/appointments" -Body $newAppointment -ExpectedStatus 201 -Description "Book new appointment"
if ($apptResult.Success -and $apptResult.Content.appointment_id) {
    $CreatedResources.AppointmentId = $apptResult.Content.appointment_id
    Write-TestLog "    Created appointment: $($CreatedResources.AppointmentId)" "Cyan"
}

Test-Endpoint -Name "Get Patient Appointments" -Category "Appointments" -Method "GET" -Endpoint "/api/appointments/patient/$patientId" -Description "Get patient's appointments"
Test-Endpoint -Name "Get Provider Appointments" -Category "Appointments" -Method "GET" -Endpoint "/api/appointments/provider/$($USERS.Doctor)" -Description "Get provider's appointments"
Test-Endpoint -Name "Get Available Slots" -Category "Appointments" -Method "GET" -Endpoint "/api/appointments/slots/$($USERS.Doctor)/$(Get-Date -Format 'yyyy-MM-dd')" -Description "Get available time slots"

if ($CreatedResources.AppointmentId) {
    Test-Endpoint -Name "Check-in Appointment" -Category "Appointments" -Method "POST" -Endpoint "/api/appointments/$($CreatedResources.AppointmentId)/check-in" -Body @{} -Description "Patient check-in"
}

# ============================================
# 6. CLINICAL TRIAGE & EMERGENCY
# ============================================
Write-Host "[6/20] Testing Clinical Triage Endpoints..." -ForegroundColor Yellow

$triageData = @{
    patient_id      = $patientId
    chief_complaint = "Chest pain and shortness of breath"
    esi_level       = 2
    pain_scale      = 7
    vital_signs     = @{
        blood_pressure_systolic  = 145
        blood_pressure_diastolic = 92
        heart_rate               = 98
        respiratory_rate         = 22
        temperature_celsius      = 37.2
        oxygen_saturation        = 94
        consciousness_level      = "Alert"
    }
    arrival_mode    = "Ambulance"
    notes           = "Patient arrived by EMS, history of cardiac issues"
}

$triageResult = Test-Endpoint -Name "Create Triage" -Category "Triage" -Method "POST" -Endpoint "/api/clinical/triage" -Body $triageData -ExpectedStatus 201 -Description "ESI triage assessment"
if ($triageResult.Success -and $triageResult.Content.assessment_id) {
    $CreatedResources.TriageId = $triageResult.Content.assessment_id
}

Test-Endpoint -Name "Get Triage Queue" -Category "Triage" -Method "GET" -Endpoint "/api/clinical/triage/queue" -Description "View triage queue"

if ($CreatedResources.TriageId) {
    Test-Endpoint -Name "Get Triage" -Category "Triage" -Method "GET" -Endpoint "/api/clinical/triage/$($CreatedResources.TriageId)" -Description "Get triage assessment"
}

Test-Endpoint -Name "Patient Triage History" -Category "Triage" -Method "GET" -Endpoint "/api/clinical/patient/$patientId/triage" -Description "Patient's triage history"

# ============================================
# 7. CLINICAL DOCUMENTATION (SOAP, GCS, etc.)
# ============================================
Write-Host "[7/20] Testing Clinical Documentation Endpoints..." -ForegroundColor Yellow

$soapNote = @{
    patient_id     = $patientId
    encounter_type = "Emergency"
    subjective     = @{
        chief_complaint            = "Acute chest pain"
        history_of_present_illness = "Patient presents with acute chest pain, 7/10 severity, radiating to left arm. Started 2 hours ago while at rest."
        symptoms                   = @("chest pain", "shortness of breath", "diaphoresis")
        symptom_duration           = "2 hours"
    }
    objective      = @{
        general_appearance = "Alert and oriented. Diaphoretic."
        physical_exam      = @(
            @{ system = "Cardiovascular"; findings = "Regular rhythm, no murmurs"; is_normal = $true }
            @{ system = "Respiratory"; findings = "Clear to auscultation bilaterally"; is_normal = $true }
        )
        lab_results        = @()
        imaging_results    = @()
        diagnostic_tests   = @()
    }
    assessment     = @{
        clinical_summary    = "Rule out acute coronary syndrome. Consider cardiac enzymes and EKG."
        primary_diagnosis   = @{ description = "Chest pain, unspecified"; icd10_code = "R07.9"; status = "provisional" }
        secondary_diagnoses = @(
            @{ description = "Chronic ischemic heart disease"; icd10_code = "I25.10"; status = "confirmed" }
        )
    }
    plan           = @{
        treatment_plan     = "1. STAT EKG 2. Troponin levels 3. Chest X-ray 4. ASA 325mg 5. IV access 6. Cardiology consult"
        medications        = @()
        procedures         = @("EKG", "IV access")
        lab_orders         = @("Troponin I", "CK-MB", "BNP")
        imaging_orders     = @("Chest X-ray")
        referrals          = @("Cardiology consult")
        patient_education  = @()
        return_precautions = @("Return if pain worsens", "Return if shortness of breath increases")
    }
}

$soapResult = Test-Endpoint -Name "Create SOAP Note" -Category "Documentation" -Method "POST" -Endpoint "/api/clinical/soap" -Body $soapNote -ExpectedStatus 201 -Description "Create SOAP note"
if ($soapResult.Success -and $soapResult.Content.note_id) {
    $CreatedResources.SoapNoteId = $soapResult.Content.note_id
}

Test-Endpoint -Name "Patient SOAP Notes" -Category "Documentation" -Method "GET" -Endpoint "/api/clinical/patient/$patientId/soap" -Description "Get patient's SOAP notes"

$gcsData = @{
    patient_id      = $patientId
    eye_response    = 4
    verbal_response = 5
    motor_response  = 6
    pupils          = "Equal and reactive"
    notes           = "Alert and oriented, following commands"
}

Test-Endpoint -Name "Create GCS" -Category "Documentation" -Method "POST" -Endpoint "/api/clinical/gcs" -Body $gcsData -ExpectedStatus 201 -Description "Glasgow Coma Scale"

$sampleHistory = @{
    patient_id           = $patientId
    signs_symptoms       = @("Chest pain", "Shortness of breath", "Diaphoresis")
    allergies            = @(
        @{
            allergen     = "Penicillin"
            allergy_type = "medication"
            reaction     = "Hives"
            severity     = "Moderate"
        }
    )
    medications          = @(
        @{
            name      = "Lisinopril"
            dosage    = "10mg"
            frequency = "daily"
            route     = "oral"
        }
        @{
            name      = "Aspirin"
            dosage    = "81mg"
            frequency = "daily"
            route     = "oral"
        }
    )
    past_medical_history = @("Hypertension", "Type 2 Diabetes", "Previous MI 2020")
    last_intake          = @{
        intake_type = "solid food"
        description = "Breakfast"
        time        = (Get-Date).AddHours(-6).ToUniversalTime().ToString("o")
    }
    events_leading       = "Was sitting at desk when sudden onset of crushing chest pain"
}

Test-Endpoint -Name "Create SAMPLE History" -Category "Documentation" -Method "POST" -Endpoint "/api/clinical/sample" -Body $sampleHistory -ExpectedStatus 201 -Description "SAMPLE history"

Test-Endpoint -Name "Create Progress Note" -Category "Documentation" -Method "POST" -Endpoint "/api/clinical/progress-note" -Body @{
    note_id          = "PN-$(Get-Random -Maximum 99999)"
    patient_id       = $patientId
    note_date        = (Get-Date).ToString("yyyy-MM-dd")
    hospital_day     = 1
    post_op_day      = $null
    subjective       = "Patient reports pain decreased to 4/10 after nitroglycerin."
    overnight_events = "Uneventful night. Slept well."
    vital_signs      = "BP 128/82, HR 78, RR 16, SpO2 98% RA, Temp 36.8C"
    io_summary       = "I: 1200 mL, O: 1000 mL, Net: +200 mL"
    exam             = "Alert and oriented. Cardiac: RRR, no murmurs. Lungs: CTAB"
    labs_studies     = "Troponin trending down 0.04 -> 0.02. EKG: NSR, no ST changes"
    assessment       = @(
        @{
            problem_number = 1
            problem        = "Chest pain - ACS ruled out"
            status         = "improving"
            plan           = "Continue monitoring, cardiology follow-up"
        }
        @{
            problem_number = 2
            problem        = "Hypertension"
            status         = "stable"
            plan           = "Continue home medications"
        }
    )
    plan             = @("Continue cardiac monitoring", "Discharge pending final troponin", "Outpatient stress test scheduled", "Follow up with cardiology in 1 week")
    disposition      = "Likely discharge today if afternoon troponin negative"
    code_status      = "Full Code"
    discussed_with   = "Dr. Smith (Attending)"
    author           = $USERS.Doctor
    note_time        = [int64](Get-Date -UFormat %s)
    cosigned_by      = $null
} -ExpectedStatus 201 -Description "Progress note"

# ============================================
# 8. VITAL SIGNS
# ============================================
Write-Host "[8/20] Testing Vital Signs Endpoints..." -ForegroundColor Yellow

$vitals = @{
    patient_id               = $patientId
    blood_pressure_systolic  = 138
    blood_pressure_diastolic = 86
    heart_rate               = 88
    respiratory_rate         = 18
    temperature_celsius      = 36.8
    oxygen_saturation        = 97
    pain_level               = 4
    position                 = "Supine"
    notes                    = "After nitroglycerin administration"
}

Test-Endpoint -Name "Record Vitals" -Category "Vitals" -Method "POST" -Endpoint "/api/clinical/vitals" -Body $vitals -ExpectedStatus 201 -Description "Record vital signs"
Test-Endpoint -Name "Get Patient Vitals" -Category "Vitals" -Method "GET" -Endpoint "/api/clinical/patient/$patientId/vitals" -Description "Get vitals history"
Test-Endpoint -Name "Latest Vitals" -Category "Vitals" -Method "GET" -Endpoint "/api/clinical/patient/$patientId/vitals/latest" -Description "Get latest vitals"
Test-Endpoint -Name "Vitals Flowsheet" -Category "Vitals" -Method "GET" -Endpoint "/api/clinical/vitals/flowsheet/$patientId" -Description "Vitals flowsheet"

# ============================================
# 9. LAB ENDPOINTS
# ============================================
Write-Host "[9/20] Testing Lab Endpoints..." -ForegroundColor Yellow

$labSubmission = @{
    patient_id    = $patientId
    test_name     = "Cardiac Panel"
    test_category = "Chemistry"
    results       = @(
        @{ parameter = "Troponin I"; value = "0.04"; unit = "ng/mL"; reference_range = "0.00-0.04"; flag = "High" }
        @{ parameter = "CK-MB"; value = "3.2"; unit = "ng/mL"; reference_range = "0.0-6.6" }
        @{ parameter = "BNP"; value = "89"; unit = "pg/mL"; reference_range = "0-100" }
    )
    notes         = "STAT cardiac workup for chest pain patient"
}

$labResult = Test-Endpoint -Name "Submit Lab Results" -Category "Labs" -Method "POST" -Endpoint "/api/lab/submit" -UserId $USERS.LabTech -Body $labSubmission -ExpectedStatus 201 -Description "Submit lab results"
if ($labResult.Success -and $labResult.Content.submission_id) {
    $CreatedResources.LabSubmissionId = $labResult.Content.submission_id
}

Test-Endpoint -Name "Get Pending Labs" -Category "Labs" -Method "GET" -Endpoint "/api/lab/pending" -Description "Pending lab results"
Test-Endpoint -Name "Get All Submissions" -Category "Labs" -Method "GET" -Endpoint "/api/lab/submissions" -Description "All lab submissions"
Test-Endpoint -Name "Patient Lab Results" -Category "Labs" -Method "GET" -Endpoint "/api/lab/patient/$patientId" -Description "Patient's lab results"
Test-Endpoint -Name "Lab Panels" -Category "Labs" -Method "GET" -Endpoint "/api/clinical/lab-panels" -Description "Available lab panels"

if ($CreatedResources.LabSubmissionId) {
    Test-Endpoint -Name "Get Lab Submission" -Category "Labs" -Method "GET" -Endpoint "/api/lab/submissions/$($CreatedResources.LabSubmissionId)" -Description "Specific lab submission"
    
    # Doctor reviews the lab
    Test-Endpoint -Name "Review Lab Results" -Category "Labs" -Method "POST" -Endpoint "/api/lab/submissions/$($CreatedResources.LabSubmissionId)/review" -Body @{ action = "approve" } -Description "Approve lab results"
}

# ============================================
# 10. PRESCRIPTIONS & MEDICATIONS
# ============================================
Write-Host "[10/20] Testing Prescription Endpoints..." -ForegroundColor Yellow

$prescription = @{
    rx_id           = "RX-$(Get-Random -Maximum 999999)"
    patient_id      = $patientId
    medication_name = "Atorvastatin"
    generic_name    = "Atorvastatin Calcium"
    strength        = "40mg"
    form            = "Tablet"
    directions      = "Take one tablet by mouth at bedtime"
    quantity        = 30
    quantity_unit   = "tablets"
    days_supply     = 30
    refills         = 3
    daw             = $false
    prescriber      = @{
        name          = "Dr. Test Prescriber"
        npi           = "1234567890"
        state_license = "MD-12345"
        phone         = "+1-555-0000"
    }
    pharmacy        = @{
        name     = "Test Pharmacy"
        ncpdp_id = "1234567"
        npi      = "0987654321"
        address  = "123 Pharmacy St"
        phone    = "+1-555-0001"
        fax      = "+1-555-0002"
    }
    written_date    = (Get-Date).ToString("yyyy-MM-dd")
    effective_date  = (Get-Date).ToString("yyyy-MM-dd")
    expiration_date = (Get-Date).AddMonths(6).ToString("yyyy-MM-dd")
    diagnosis_codes = @("E78.5")
    status          = "Pending"
}

$rxResult = Test-Endpoint -Name "Create E-Prescription" -Category "Prescriptions" -Method "POST" -Endpoint "/api/clinical/e-prescription" -Body $prescription -ExpectedStatus 201 -Description "Create e-prescription"
if ($rxResult.Success) {
    $CreatedResources.PrescriptionId = $prescription.rx_id
}

Test-Endpoint -Name "Create E-Prescription V2" -Category "Prescriptions" -Method "POST" -Endpoint "/api/e-prescriptions" -Body @{
    patient_id           = $patientId
    medication_name      = "Atorvastatin"
    generic_name         = "atorvastatin calcium"
    strength             = "20mg"
    form                 = "tablet"
    quantity             = [int]30
    days_supply          = [int]30
    directions           = "Take one tablet by mouth daily at bedtime"
    refills_allowed      = [int]3
    is_controlled        = $false
    dea_schedule         = $null
    pharmacy_ncpdp       = "1234567"
    pharmacy_name        = "Test Pharmacy"
    diagnosis_codes      = @("E78.5")
    patient_instructions = "Take with or without food. Avoid grapefruit."
    pharmacy_notes       = "Generic substitution permitted"
} -ExpectedStatus 201 -Description "Create e-prescription v2"

Test-Endpoint -Name "Drug Database Search" -Category "Prescriptions" -Method "GET" -Endpoint "/api/drugs?query=atorvastatin" -Description "Search drug database"
Test-Endpoint -Name "Check Drug Interactions" -Category "Prescriptions" -Method "POST" -Endpoint "/api/interactions/check" -Body @{
    patient_id         = $patientId
    medications        = @("Warfarin", "Aspirin", "Metoprolol")
    include_allergies  = $true
    include_conditions = $true
} -Description "Check drug interactions"

# ============================================
# 11. MESSAGING
# ============================================
Write-Host "[11/20] Testing Messaging Endpoints..." -ForegroundColor Yellow

$message = @{
    recipient_id = $patientId
    subject      = "Lab Results Ready"
    content      = "Your recent lab results are now available. Please review them in your patient portal."
    priority     = "Normal"
    message_type = "Clinical"
}

$msgResult = Test-Endpoint -Name "Send Message" -Category "Messages" -Method "POST" -Endpoint "/api/messages/send" -Body $message -ExpectedStatus 201 -Description "Send secure message"
if ($msgResult.Success -and $msgResult.Content.message_id) {
    $CreatedResources.MessageId = $msgResult.Content.message_id
}

Test-Endpoint -Name "Get Messages" -Category "Messages" -Method "GET" -Endpoint "/api/messages" -Description "Get user's messages"

# ============================================
# 12. DASHBOARDS
# ============================================
Write-Host "[12/20] Testing Dashboard Endpoints..." -ForegroundColor Yellow

Test-Endpoint -Name "Doctor Dashboard" -Category "Dashboards" -Method "GET" -Endpoint "/api/dashboard/doctor" -UserId $USERS.Doctor -Description "Doctor dashboard"
Test-Endpoint -Name "Nurse Dashboard" -Category "Dashboards" -Method "GET" -Endpoint "/api/dashboard/nurse" -UserId $USERS.Nurse -Description "Nurse dashboard"
Test-Endpoint -Name "Lab Dashboard" -Category "Dashboards" -Method "GET" -Endpoint "/api/dashboard/lab" -UserId $USERS.LabTech -Description "Lab technician dashboard"
Test-Endpoint -Name "Pharmacist Dashboard" -Category "Dashboards" -Method "GET" -Endpoint "/api/dashboard/pharmacist" -UserId $USERS.Pharmacist -Description "Pharmacist dashboard"
Test-Endpoint -Name "Admin Dashboard" -Category "Dashboards" -Method "GET" -Endpoint "/api/dashboard/admin" -UserId $USERS.Admin -Description "Admin dashboard"
Test-Endpoint -Name "Patient Dashboard" -Category "Dashboards" -Method "GET" -Endpoint "/api/dashboard/patient" -UserId $USERS.Patient -Description "Patient dashboard"

# ============================================
# 13. EMERGENCY PROTOCOLS
# ============================================
Write-Host "[13/20] Testing Emergency Protocol Endpoints..." -ForegroundColor Yellow

Test-Endpoint -Name "Create Code Blue" -Category "Emergency" -Method "POST" -Endpoint "/api/clinical/code-blue" -Body @{
    event_id        = "CB-$(Get-Random -Maximum 99999)"
    patient_id      = $patientId
    location        = "Room 205"
    code_called_at  = [int64](Get-Date -UFormat %s)
    team_arrived_at = [int64]((Get-Date).AddMinutes(2) | Get-Date -UFormat %s)
    initial_rhythm  = "VentricularFibrillation"
    witnessed       = $true
    cpr_started_at  = [int64](Get-Date -UFormat %s)
    defibrillations = @()
    medications     = @()
    vascular_access = @()
    outcome         = "ROSC"
    team_members    = @()
    code_leader     = $USERS.Doctor
    family_notified = $false
    documented_by   = $USERS.Doctor
    documented_at   = [int64](Get-Date -UFormat %s)
} -ExpectedStatus 201 -Description "Code Blue event"

Test-Endpoint -Name "Create Trauma Assessment" -Category "Emergency" -Method "POST" -Endpoint "/api/clinical/trauma" -Body @{
    assessment_id         = "TRAUMA-$(Get-Random -Maximum 99999)"
    patient_id            = $patientId
    mechanism             = "MVC"
    mechanism_details     = "Motor vehicle accident, driver, restrained"
    primary_survey        = @{
        airway      = @{
            patent             = $true
            obstruction        = $false
            intervention       = $null
            cspine_immobilized = $true
        }
        breathing   = @{
            respiratory_rate       = 18
            breath_sounds_equal    = $true
            chest_wall_intact      = $true
            trachea_midline        = $true
            spo2                   = 96
            oxygen_supplementation = $null
            interventions          = @()
        }
        circulation = @{
            heart_rate           = 90
            systolic_bp          = 120
            diastolic_bp         = 80
            skin_color           = "pink"
            skin_temperature     = "warm"
            capillary_refill_sec = 2
            active_bleeding      = $false
            bleeding_sites       = @()
            iv_access            = @("18G R forearm")
            fluid_resuscitation  = $null
        }
        disability  = @{
            gcs_total             = 15
            gcs_eye               = 4
            gcs_verbal            = 5
            gcs_motor             = 6
            pupils_equal_reactive = $true
            left_pupil_mm         = 3.0
            right_pupil_mm        = 3.0
            motor_function        = "Intact all extremities"
            sensory_function      = "Intact"
        }
        exposure    = @{
            fully_exposed       = $true
            temperature_celsius = 36.8
            warming_measures    = @("Warm blanket")
            posterior_injuries  = @()
        }
    }
    gcs                   = 15
    injuries              = @()
    photos_documented     = $false
    photo_references      = @()
    blood_products        = @()
    mtp_activated         = $false
    trauma_team_activated = $true
    disposition           = "TraumaICU"
    assessed_by           = $USERS.Doctor
    assessed_at           = [int64](Get-Date -UFormat %s)
} -ExpectedStatus 201 -Description "Trauma assessment"

Test-Endpoint -Name "Create Stroke Assessment" -Category "Emergency" -Method "POST" -Endpoint "/api/clinical/stroke" -Body @{
    assessment_id          = "STROKE-$(Get-Random -Maximum 99999)"
    patient_id             = $patientId
    last_known_well        = [int64]((Get-Date).AddHours(-1) | Get-Date -UFormat %s)
    door_time              = [int64](Get-Date -UFormat %s)
    nihss                  = @{
        loc             = 0
        loc_questions   = 0
        loc_commands    = 0
        best_gaze       = 0
        visual_fields   = 0
        facial_palsy    = 1
        motor_arm_left  = 0
        motor_arm_right = 2
        motor_leg_left  = 0
        motor_leg_right = 1
        limb_ataxia     = 0
        sensory         = 1
        best_language   = 1
        dysarthria      = 1
        extinction      = 1
    }
    nihss_total            = 8
    ct_findings            = "No acute hemorrhage"
    hemorrhage             = $false
    lvo_suspected          = $true
    tpa_eligible           = $true
    tpa_contraindications  = @()
    tpa_given              = $false
    thrombectomy_candidate = $true
    neuro_ir_activated     = $true
    bp_management          = "Target SBP < 180"
    stroke_type            = "Ischemic"
    assessed_by            = $USERS.Doctor
    assessed_at            = [int64](Get-Date -UFormat %s)
} -ExpectedStatus 201 -Description "Stroke assessment"

Test-Endpoint -Name "Create Sepsis Screening" -Category "Emergency" -Method "POST" -Endpoint "/api/clinical/sepsis" -Body @{
    assessment_id         = "SEPSIS-$(Get-Random -Maximum 99999)"
    patient_id            = $patientId
    suspected_source      = "Urinary"
    sepsis_identified_at  = [int64](Get-Date -UFormat %s)
    sirs_criteria         = @{
        temp_abnormal = $true
        hr_elevated   = $true
        rr_elevated   = $true
        wbc_abnormal  = $true
    }
    qsofa                 = @{
        rr_22_or_more         = $true
        altered_mental_status = $false
        sbp_100_or_less       = $false
    }
    severity              = "Sepsis"
    lactate_levels        = @()
    hour_1_bundle         = @{
        lactate_measured        = $true
        blood_cultures_obtained = $true
        antibiotics_given       = $true
        fluids_started          = $true
        vasopressors_if_needed  = $false
    }
    cultures_before_abx   = $true
    antibiotics           = @()
    fluid_resuscitation   = @{
        fluid_type       = "Normal Saline"
        total_volume_ml  = 2000
        target_ml_per_kg = 30.0
        weight_kg        = 70.0
        target_volume_ml = 2100
        start_time       = [int64]((Get-Date).AddMinutes(-30) | Get-Date -UFormat %s)
        completion_time  = [int64](Get-Date -UFormat %s)
        response         = "MAP improved to 65"
    }
    vasopressors_required = $false
    vasopressors          = @()
    icu_admission         = $false
    assessed_by           = $USERS.Doctor
    assessed_at           = [int64](Get-Date -UFormat %s)
} -ExpectedStatus 201 -Description "Sepsis screening"

Test-Endpoint -Name "Patient Emergency Summary" -Category "Emergency" -Method "GET" -Endpoint "/api/clinical/patient/$patientId/emergency" -Description "Emergency summary"

# ============================================
# 14. NURSING DOCUMENTATION
# ============================================
Write-Host "[14/20] Testing Nursing Documentation Endpoints..." -ForegroundColor Yellow

Test-Endpoint -Name "MAR Record" -Category "Nursing" -Method "POST" -Endpoint "/api/clinical/mar" -UserId $USERS.Nurse -Body @{
    patient_id            = $patientId
    date                  = (Get-Date).ToString("yyyy-MM-dd")
    scheduled_medications = @(
        @{
            medication_id      = "MED-001"
            name               = "Lisinopril"
            dose               = "10mg"
            route              = "Oral"
            frequency          = "Daily"
            scheduled_times    = @("08:00")
            administrations    = @(
                @{
                    scheduled_time = "08:00"
                    actual_time    = [int64](Get-Date -UFormat %s)
                    status         = "Given"
                    given_by       = $USERS.Nurse
                }
            )
            allergies_verified = $true
        }
    )
    prn_medications       = @()
    infusions             = @()
} -ExpectedStatus 201 -Description "Medication administration"

Test-Endpoint -Name "Intake/Output Record" -Category "Nursing" -Method "POST" -Endpoint "/api/clinical/io" -UserId $USERS.Nurse -Body @{
    patient_id    = $patientId
    date          = (Get-Date).ToString("yyyy-MM-dd")
    shift         = "Day"
    intake        = @(
        @{
            time        = [int64](Get-Date -UFormat %s)
            intake_type = "Oral"
            description = "Water"
            amount_ml   = 500
            is_infusion = $false
            recorded_by = $USERS.Nurse
        }
    )
    output        = @(
        @{
            time            = [int64](Get-Date -UFormat %s)
            output_type     = "Urine"
            description     = "Clear yellow"
            amount_ml       = 350
            characteristics = "Clear, yellow, no odor"
            recorded_by     = $USERS.Nurse
        }
    )
    totals        = @{
        total_intake_ml = 500
        oral_intake_ml  = 500
        iv_intake_ml    = 0
        total_output_ml = 350
        urine_output_ml = 350
        other_output_ml = 0
        net_balance_ml  = 150
    }
    documented_by = $USERS.Nurse
} -ExpectedStatus 201 -Description "Intake/Output record"

Test-Endpoint -Name "Care Plan" -Category "Nursing" -Method "POST" -Endpoint "/api/clinical/care-plan" -UserId $USERS.Nurse -Body @{
    care_plan_id       = "CP-$(Get-Random -Maximum 99999)"
    patient_id         = $patientId
    admission_date     = (Get-Date).ToString("yyyy-MM-dd")
    nursing_diagnoses  = @(
        @{
            id              = "ND-001"
            diagnosis       = "Acute pain"
            related_to      = "Chest discomfort"
            as_evidenced_by = @("Patient reports 7/10 pain", "Facial grimacing")
            priority        = 1
            status          = "Active"
            identified_date = (Get-Date).ToString("yyyy-MM-dd")
        }
    )
    goals              = @(
        @{
            id               = "G-001"
            diagnosis_id     = "ND-001"
            goal             = "Pain reduced to 3/10 within 1 hour"
            target_date      = (Get-Date).ToString("yyyy-MM-dd")
            outcome_criteria = @("Patient verbalizes pain relief", "Vital signs stable")
            status           = "Ongoing"
        }
    )
    interventions      = @(
        @{
            id              = "I-001"
            goal_id         = "G-001"
            intervention    = "Monitor vitals q2h"
            frequency       = "Every 2 hours"
            implementations = @()
        }
    )
    education_needs    = @()
    discharge_planning = @{
        anticipated_discharge  = (Get-Date).AddDays(3).ToString("yyyy-MM-dd")
        disposition            = "Home"
        living_situation       = "Lives with spouse"
        support_system         = "Spouse available, adult children nearby"
        equipment_needed       = @()
        home_health_needed     = $false
        dme_ordered            = @()
        follow_up_appointments = @("Cardiology in 1 week", "PCP in 2 weeks")
        barriers               = @()
    }
    created_by         = $USERS.Nurse
    created_at         = [int64](Get-Date -UFormat %s)
    updated_by         = $USERS.Nurse
    updated_at         = [int64](Get-Date -UFormat %s)
} -ExpectedStatus 201 -Description "Nursing care plan"

Test-Endpoint -Name "Get Nursing Tasks" -Category "Nursing" -Method "GET" -Endpoint "/api/tasks/nurse" -UserId $USERS.Nurse -Description "Nurse task list"
Test-Endpoint -Name "Get Care Plans" -Category "Nursing" -Method "GET" -Endpoint "/api/nursing/care-plans" -UserId $USERS.Nurse -Description "Care plans"

# ============================================
# 15. NFC & BARCODE
# ============================================
Write-Host "[15/20] Testing NFC & Barcode Endpoints..." -ForegroundColor Yellow

Test-Endpoint -Name "Generate NFC Card" -Category "NFC" -Method "POST" -Endpoint "/api/nfc/generate" -Body @{
    patient_id       = $patientId
    national_id_type = "Ethiopia"
} -ExpectedStatus 201 -Description "Generate NFC card"

Test-Endpoint -Name "Get NFC Card" -Category "NFC" -Method "GET" -Endpoint "/api/nfc/card/$patientId" -Description "Get patient NFC card"
Test-Endpoint -Name "List NFC Cards" -Category "NFC" -Method "GET" -Endpoint "/api/nfc/cards" -UserId $USERS.Admin -Description "List all NFC cards"

Test-Endpoint -Name "Generate Barcode" -Category "Barcode" -Method "POST" -Endpoint "/api/barcode/generate" -Body @{
    entity_type  = "patient"
    entity_id    = $patientId
    barcode_type = "QR"
    data         = @{ patient_id = $patientId; type = "identification" }
} -ExpectedStatus 201 -Description "Generate barcode"

Test-Endpoint -Name "Scan History" -Category "Barcode" -Method "GET" -Endpoint "/api/barcode/scan-history" -Description "Barcode scan history"

# ============================================
# 16. WEARABLES & IOT
# ============================================
Write-Host "[16/20] Testing Wearables Endpoints..." -ForegroundColor Yellow

# IMPORTANT: Device is registered to the calling user (current_user_id), not the patient_id in body
# So we register and submit readings as the Patient user
# The API generates its own device_id (format: WRB-{uuid}), so we must capture it from the response
$registerResult = Test-Endpoint -Name "Register Device" -Category "Wearables" -Method "POST" -Endpoint "/api/wearables/devices" -UserId $USERS.Patient -Body @{
    device_type  = "smartwatch"
    manufacturer = "Apple"
    model        = "Watch Series 9"
} -ExpectedStatus 201 -Description "Register wearable device"

# Capture the API-generated device_id for use in subsequent requests
$wearableDeviceId = if ($registerResult.Success -and $registerResult.Content.device_id) {
    $registerResult.Content.device_id
}
else {
    "DEVICE-FALLBACK"
}

Test-Endpoint -Name "Get Devices" -Category "Wearables" -Method "GET" -Endpoint "/api/wearables/devices" -UserId $USERS.Patient -Description "Get registered devices"

# Submit reading as Patient (device owner) using the API-generated device_id
if ($wearableDeviceId -ne "DEVICE-FALLBACK") {
    Test-Endpoint -Name "Submit Reading" -Category "Wearables" -Method "POST" -Endpoint "/api/wearables/readings" -UserId $USERS.Patient -Body @{
        device_id = $wearableDeviceId
        data_type = "heart_rate"
        value     = 72.0
        unit      = "bpm"
    } -ExpectedStatus 201 -Description "Submit wearable reading"
}
else {
    Write-Host "  [SKIP] Submit Reading - No device_id available from registration" -ForegroundColor Yellow
}

Test-Endpoint -Name "Get Readings" -Category "Wearables" -Method "GET" -Endpoint "/api/wearables/readings/$($USERS.Patient)" -Description "Get wearable readings"

# ============================================
# 17. TELEHEALTH
# ============================================
Write-Host "[17/20] Testing Telehealth Endpoints..." -ForegroundColor Yellow

$sessionResult = Test-Endpoint -Name "Create Telehealth Session" -Category "Telehealth" -Method "POST" -Endpoint "/api/telehealth/sessions" -Body @{
    patient_id        = $patientId
    appointment_id    = $null
    session_type      = "video"
    scheduled_start   = [int64](Get-Date).AddHours(1).ToUniversalTime().Subtract([datetime]"1970-01-01").TotalSeconds
    recording_enabled = $false
} -ExpectedStatus 201 -Description "Schedule telehealth session"

if ($sessionResult.Success -and $sessionResult.Content.session_id) {
    $CreatedResources.SessionId = $sessionResult.Content.session_id
    
    Test-Endpoint -Name "Get Session" -Category "Telehealth" -Method "GET" -Endpoint "/api/telehealth/sessions/$($CreatedResources.SessionId)" -Description "Get session details"
    Test-Endpoint -Name "Join Session" -Category "Telehealth" -Method "POST" -Endpoint "/api/telehealth/sessions/$($CreatedResources.SessionId)/join" -Body @{} -Description "Join telehealth session"
}

Test-Endpoint -Name "Patient Sessions" -Category "Telehealth" -Method "GET" -Endpoint "/api/telehealth/patient/$patientId/sessions" -Description "Patient's telehealth history"
Test-Endpoint -Name "Device Check" -Category "Telehealth" -Method "POST" -Endpoint "/api/telehealth/device-check" -Body @{
    camera_working     = $true
    microphone_working = $true
    speaker_working    = $true
    browser            = "Chrome"
    bandwidth_mbps     = 10.5
} -Description "Pre-call device check"

# ============================================
# 18. FHIR R4 ENDPOINTS
# ============================================
Write-Host "[18/20] Testing FHIR R4 Endpoints..." -ForegroundColor Yellow

Test-Endpoint -Name "FHIR Capability Statement" -Category "FHIR" -Method "GET" -Endpoint "/api/fhir/r4/metadata" -Description "FHIR capability statement"
Test-Endpoint -Name "FHIR Patient" -Category "FHIR" -Method "GET" -Endpoint "/api/fhir/r4/Patient/$patientId" -Description "FHIR Patient resource"
Test-Endpoint -Name "FHIR Allergies" -Category "FHIR" -Method "GET" -Endpoint "/api/fhir/r4/AllergyIntolerance?patient=$patientId" -Description "FHIR AllergyIntolerance"
Test-Endpoint -Name "FHIR Medications" -Category "FHIR" -Method "GET" -Endpoint "/api/fhir/r4/MedicationStatement?patient=$patientId" -Description "FHIR MedicationStatement"
Test-Endpoint -Name "FHIR Conditions" -Category "FHIR" -Method "GET" -Endpoint "/api/fhir/r4/Condition?patient=$patientId" -Description "FHIR Condition"
Test-Endpoint -Name "FHIR Observations" -Category "FHIR" -Method "GET" -Endpoint "/api/fhir/r4/Observation?patient=$patientId" -Description "FHIR Observation"
Test-Endpoint -Name "FHIR Encounters" -Category "FHIR" -Method "GET" -Endpoint "/api/fhir/r4/Encounter?patient=$patientId" -Description "FHIR Encounter"
Test-Endpoint -Name "FHIR Procedures" -Category "FHIR" -Method "GET" -Endpoint "/api/fhir/r4/Procedure?patient=$patientId" -Description "FHIR Procedure"
Test-Endpoint -Name "FHIR Immunizations" -Category "FHIR" -Method "GET" -Endpoint "/api/fhir/r4/Immunization?patient=$patientId" -Description "FHIR Immunization"

# ============================================
# 19. SYMPTOMS & CDS
# ============================================
Write-Host "[19/20] Testing Symptoms & CDS Endpoints..." -ForegroundColor Yellow

Test-Endpoint -Name "Start Symptom Check" -Category "Symptoms" -Method "POST" -Endpoint "/api/symptoms/start" -Body @{
    primary_symptom = "chest_pain"
    age             = 55
    gender          = "male"
    pregnant        = $false
} -ExpectedStatus 201 -Description "Start symptom checker"

Test-Endpoint -Name "Log Symptom" -Category "Symptoms" -Method "POST" -Endpoint "/api/symptoms/log" -Body @{
    patient_id = $patientId
    symptom    = "headache"
    severity   = 5
    onset      = "2 hours ago"
    notes      = "Mild tension headache"
} -ExpectedStatus 201 -Description "Log symptom"

Test-Endpoint -Name "Symptom History" -Category "Symptoms" -Method "GET" -Endpoint "/api/symptoms/$patientId" -Description "Symptom history"

Test-Endpoint -Name "Analyze Symptoms" -Category "Symptoms" -Method "POST" -Endpoint "/api/symptoms/analyze" -Body @{
    symptoms            = @("chest_pain", "shortness_of_breath", "diaphoresis")
    duration            = "2 hours"
    severity            = "severe"
    patient_age         = 55
    patient_gender      = "male"
    existing_conditions = @("hypertension", "diabetes")
    current_medications = @("lisinopril", "metformin")
} -ExpectedStatus 200 -Description "AI symptom analysis"

Test-Endpoint -Name "CDS Alerts" -Category "CDS" -Method "GET" -Endpoint "/api/cds/alerts" -Description "Clinical decision support alerts"
Test-Endpoint -Name "Patient CDS Alerts" -Category "CDS" -Method "GET" -Endpoint "/api/cds/patient/$patientId/alerts" -Description "Patient-specific CDS alerts"

# ============================================
# 20. INSURANCE & ADMIN
# ============================================
Write-Host "[20/20] Testing Insurance & Admin Endpoints..." -ForegroundColor Yellow

Test-Endpoint -Name "Verify Insurance" -Category "Insurance" -Method "POST" -Endpoint "/api/insurance/verify" -Body @{
    patient_id   = $patientId
    payer_id     = "BCBS-001"
    member_id    = "MEM123456"
    group_number = "GRP789"
} -ExpectedStatus 200 -Description "Insurance verification"

Test-Endpoint -Name "Check Eligibility" -Category "Insurance" -Method "POST" -Endpoint "/api/insurance/eligibility" -Body @{
    patient_id      = $patientId
    service_type    = "outpatient"
    date_of_service = (Get-Date).ToString("yyyy-MM-dd")
} -ExpectedStatus 200 -Description "Eligibility check"

Test-Endpoint -Name "Consent Types" -Category "Consent" -Method "GET" -Endpoint "/api/consent/types" -Description "Available consent types"
Test-Endpoint -Name "Access Logs" -Category "Admin" -Method "GET" -Endpoint "/api/access/logs" -UserId $USERS.Admin -Description "System access logs"
Test-Endpoint -Name "Order Sets" -Category "Admin" -Method "GET" -Endpoint "/api/order-sets" -Description "Order set templates"
Test-Endpoint -Name "Note Templates" -Category "Admin" -Method "GET" -Endpoint "/api/templates/notes" -Description "Note templates"
Test-Endpoint -Name "Notifications" -Category "Admin" -Method "GET" -Endpoint "/api/notifications" -Description "User notifications"

# ============================================
# RESULTS SUMMARY
# ============================================

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   TEST RESULTS SUMMARY" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Total Tests:    $($TestResults.total_tests)" -ForegroundColor White
Write-Host "  Passed:         $($TestResults.passed)" -ForegroundColor Green
Write-Host "  Failed:         $($TestResults.failed)" -ForegroundColor Red
Write-Host "  Pass Rate:      $([math]::Round($TestResults.passed / $TestResults.total_tests * 100, 1))%" -ForegroundColor $(if ($TestResults.failed -eq 0) { "Green" } else { "Yellow" })
Write-Host ""
Write-Host "  Total Time:     $($TestResults.total_time_ms)ms" -ForegroundColor Gray
Write-Host "  Avg Response:   $([math]::Round($TestResults.total_time_ms / $TestResults.total_tests))ms" -ForegroundColor Gray
Write-Host ""

Write-Host "  Results by Category:" -ForegroundColor White
$TestResults.categories.GetEnumerator() | Sort-Object { $_.Value.total } -Descending | ForEach-Object {
    $cat = $_.Key
    $stats = $_.Value
    $color = if ($stats.failed -eq 0) { "Green" } elseif ($stats.passed -eq 0) { "Red" } else { "Yellow" }
    Write-Host "    $cat" -NoNewline
    Write-Host (" " * (20 - $cat.Length)) -NoNewline
    Write-Host "$($stats.passed)/$($stats.total) passed" -ForegroundColor $color -NoNewline
    Write-Host "  (avg: $($stats.avg_response_ms)ms)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan

# Save results to file
$TestResults | ConvertTo-Json -Depth 10 | Out-File -FilePath $OutputFile -Encoding UTF8
Write-Host "  Full results saved to: $OutputFile" -ForegroundColor Gray
Write-Host ""

# Show failed tests
if ($TestResults.failed -gt 0) {
    Write-Host "  FAILED TESTS:" -ForegroundColor Red
    $TestResults.detailed_results | Where-Object { $_.status -eq "FAILED" } | ForEach-Object {
        Write-Host "    - $($_.name): $($_.error)" -ForegroundColor Red
    }
    Write-Host ""
}

# Exit with error code if tests failed
if ($TestResults.failed -gt 0) {
    exit 1
}
