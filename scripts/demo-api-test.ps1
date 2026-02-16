# MediChain API Demo Test Script
# Tests ALL API endpoints with real data creation

param(
    [string]$BaseUrl = "http://localhost:8080",
    [switch]$Verbose
)

$ErrorActionPreference = "Continue"

# Test counters
$script:passed = 0
$script:failed = 0
$script:total = 0

function Write-TestResult {
    param([string]$Name, [bool]$Success, [string]$Details = "")
    $script:total++
    if ($Success) {
        $script:passed++
        Write-Host "[PASS] $Name" -ForegroundColor Green
    } else {
        $script:failed++
        Write-Host "[FAIL] $Name - $Details" -ForegroundColor Red
    }
}

function Invoke-ApiCall {
    param(
        [string]$Method,
        [string]$Endpoint,
        [object]$Body = $null,
        [string]$UserId = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
    )
    
    $headers = @{
        "Content-Type" = "application/json"
        "X-User-Id" = $UserId
    }
    
    $uri = "$BaseUrl$Endpoint"
    
    try {
        $params = @{
            Uri = $uri
            Method = $Method
            Headers = $headers
            ErrorAction = "Stop"
        }
        
        if ($Body) {
            $params["Body"] = ($Body | ConvertTo-Json -Depth 10)
        }
        
        $response = Invoke-RestMethod @params
        return @{ Success = $true; Data = $response; Error = $null }
    }
    catch {
        $errorMsg = $_.Exception.Message
        if ($_.Exception.Response) {
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $errorMsg = $reader.ReadToEnd()
            } catch {}
        }
        return @{ Success = $false; Data = $null; Error = $errorMsg }
    }
}

# Store created IDs for later tests
$script:createdPatientId = $null
$script:createdAllergyId = $null
$script:createdTriageId = $null
$script:createdLabOrderId = $null
$script:createdPrescriptionId = $null
$script:createdMessageId = $null

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   MediChain API Demo Test Suite" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Base URL: $BaseUrl"
Write-Host "Starting tests..."
Write-Host ""

# ============================================
# 1. Health Check
# ============================================
Write-Host "--- Health Check ---" -ForegroundColor Yellow

$health = Invoke-ApiCall -Method "GET" -Endpoint "/health"
Write-TestResult -Name "Health Check" -Success $health.Success -Details $health.Error

if (-not $health.Success) {
    Write-Host ""
    Write-Host "[ERROR] API server not responding. Please ensure it is running." -ForegroundColor Red
    Write-Host "Run: cd medichain/api; cargo run"
    exit 1
}

Write-Host "  Status: $($health.Data.status)"
Write-Host "  Version: $($health.Data.version)"
Write-Host ""

# ============================================
# 2. Patient Management
# ============================================
Write-Host "--- Patient Management ---" -ForegroundColor Yellow

# Create a test patient
$patientData = @{
    first_name = "John"
    last_name = "TestPatient"
    date_of_birth = "1985-06-15"
    gender = "male"
    blood_type = "O+"
    phone = "+1-555-0101"
    email = "john.test@example.com"
    address = "123 Test Street, Test City, TC 12345"
    emergency_contact_name = "Jane TestPatient"
    emergency_contact_phone = "+1-555-0102"
}

$createPatient = Invoke-ApiCall -Method "POST" -Endpoint "/api/patients" -Body $patientData
Write-TestResult -Name "Create Patient" -Success $createPatient.Success -Details $createPatient.Error

if ($createPatient.Success -and $createPatient.Data.patient_id) {
    $script:createdPatientId = $createPatient.Data.patient_id
    Write-Host "  Created Patient ID: $($script:createdPatientId)"
}

# Create second patient for messaging tests
$patient2Data = @{
    first_name = "Sarah"
    last_name = "DemoPatient"
    date_of_birth = "1990-03-22"
    gender = "female"
    blood_type = "A+"
    phone = "+1-555-0201"
    email = "sarah.demo@example.com"
    address = "456 Demo Avenue, Demo City, DC 67890"
    emergency_contact_name = "Michael DemoPatient"
    emergency_contact_phone = "+1-555-0202"
}

$createPatient2 = Invoke-ApiCall -Method "POST" -Endpoint "/api/patients" -Body $patient2Data
Write-TestResult -Name "Create Second Patient" -Success $createPatient2.Success -Details $createPatient2.Error

# List all patients
$listPatients = Invoke-ApiCall -Method "GET" -Endpoint "/api/patients/list"
Write-TestResult -Name "List Patients" -Success $listPatients.Success -Details $listPatients.Error

if ($listPatients.Success) {
    Write-Host "  Total Patients: $($listPatients.Data.Count)"
}

# Get patient by ID (if created)
if ($script:createdPatientId) {
    $getPatient = Invoke-ApiCall -Method "GET" -Endpoint "/api/patients/$($script:createdPatientId)"
    Write-TestResult -Name "Get Patient by ID" -Success $getPatient.Success -Details $getPatient.Error
}

Write-Host ""

# ============================================
# 3. Allergies Management
# ============================================
Write-Host "--- Allergies Management ---" -ForegroundColor Yellow

if ($script:createdPatientId) {
    $allergyData = @{
        patient_id = $script:createdPatientId
        allergen = "Penicillin"
        reaction = "Anaphylaxis - severe allergic reaction with difficulty breathing"
        severity = "severe"
        onset_date = "2020-01-15"
        notes = "Patient carries EpiPen at all times"
    }
    
    $createAllergy = Invoke-ApiCall -Method "POST" -Endpoint "/api/allergies" -Body $allergyData
    Write-TestResult -Name "Create Allergy Record" -Success $createAllergy.Success -Details $createAllergy.Error
    
    if ($createAllergy.Success -and $createAllergy.Data.allergy_id) {
        $script:createdAllergyId = $createAllergy.Data.allergy_id
        Write-Host "  Created Allergy ID: $($script:createdAllergyId)"
    }
    
    # Add another allergy
    $allergy2Data = @{
        patient_id = $script:createdPatientId
        allergen = "Shellfish"
        reaction = "Hives and swelling"
        severity = "moderate"
        onset_date = "2018-07-20"
        notes = "Avoid all shellfish including shrimp and crab"
    }
    
    $createAllergy2 = Invoke-ApiCall -Method "POST" -Endpoint "/api/allergies" -Body $allergy2Data
    Write-TestResult -Name "Create Second Allergy" -Success $createAllergy2.Success -Details $createAllergy2.Error
    
    # Get patient allergies
    $getPatientAllergies = Invoke-ApiCall -Method "GET" -Endpoint "/api/allergies/patient/$($script:createdPatientId)"
    Write-TestResult -Name "Get Patient Allergies" -Success $getPatientAllergies.Success -Details $getPatientAllergies.Error
    
    if ($getPatientAllergies.Success) {
        Write-Host "  Allergies Found: $($getPatientAllergies.Data.Count)"
    }
} else {
    Write-Host "[SKIP] Allergies tests - no patient ID available" -ForegroundColor Gray
}

Write-Host ""

# ============================================
# 4. Clinical Documentation
# ============================================
Write-Host "--- Clinical Documentation ---" -ForegroundColor Yellow

if ($script:createdPatientId) {
    # Triage Assessment
    $triageData = @{
        patient_id = $script:createdPatientId
        chief_complaint = "Severe chest pain radiating to left arm"
        esi_level = 2
        vital_signs = @{
            blood_pressure_systolic = 160
            blood_pressure_diastolic = 95
            heart_rate = 110
            respiratory_rate = 22
            temperature = 37.2
            oxygen_saturation = 94
            pain_level = 8
        }
        arrival_mode = "ambulance"
        notes = "Onset 30 minutes ago at rest. History of hypertension."
    }
    
    $createTriage = Invoke-ApiCall -Method "POST" -Endpoint "/api/clinical/triage" -Body $triageData
    Write-TestResult -Name "Create Triage Assessment" -Success $createTriage.Success -Details $createTriage.Error
    
    if ($createTriage.Success -and $createTriage.Data.assessment_id) {
        $script:createdTriageId = $createTriage.Data.assessment_id
        Write-Host "  Triage ID: $($script:createdTriageId)"
        Write-Host "  ESI Level: $($createTriage.Data.esi_level)"
    }
    
    # SOAP Note
    $soapData = @{
        patient_id = $script:createdPatientId
        subjective = "Patient reports severe chest pain 8/10, radiating to left arm. Onset 30 minutes ago while at rest. Associated with diaphoresis and shortness of breath. History of hypertension, on lisinopril 10mg daily."
        objective = "Alert and oriented. Diaphoretic. BP 160/95, HR 110, RR 22, O2 sat 94% on RA. Chest auscultation: clear bilaterally. Heart sounds: regular rhythm, no murmurs. ECG shows ST elevation in leads V1-V4."
        assessment = "Acute STEMI - ST elevation myocardial infarction, anterior wall. High risk for cardiac complications."
        plan = "1. Activate cardiac cath lab. 2. Aspirin 325mg PO stat. 3. Heparin 5000 units IV bolus. 4. Nitroglycerin 0.4mg SL. 5. Morphine 2mg IV for pain. 6. Cardiology consult STAT."
        encounter_type = "emergency"
    }
    
    $createSoap = Invoke-ApiCall -Method "POST" -Endpoint "/api/clinical/soap" -Body $soapData
    Write-TestResult -Name "Create SOAP Note" -Success $createSoap.Success -Details $createSoap.Error
    
    # Glasgow Coma Scale
    $gcsData = @{
        patient_id = $script:createdPatientId
        eye_response = 4
        verbal_response = 5
        motor_response = 6
        notes = "Patient fully alert and oriented. GCS 15/15."
    }
    
    $createGcs = Invoke-ApiCall -Method "POST" -Endpoint "/api/clinical/gcs" -Body $gcsData
    Write-TestResult -Name "Create GCS Assessment" -Success $createGcs.Success -Details $createGcs.Error
    
    if ($createGcs.Success) {
        Write-Host "  GCS Total: $($createGcs.Data.total_score)"
    }
    
    # Vital Signs Flowsheet
    $vitalsData = @{
        patient_id = $script:createdPatientId
        readings = @(
            @{
                timestamp = (Get-Date).AddHours(-2).ToString("o")
                blood_pressure_systolic = 160
                blood_pressure_diastolic = 95
                heart_rate = 110
                respiratory_rate = 22
                temperature = 37.2
                oxygen_saturation = 94
                pain_level = 8
            },
            @{
                timestamp = (Get-Date).AddHours(-1).ToString("o")
                blood_pressure_systolic = 145
                blood_pressure_diastolic = 88
                heart_rate = 95
                respiratory_rate = 18
                temperature = 37.0
                oxygen_saturation = 97
                pain_level = 5
            },
            @{
                timestamp = (Get-Date).ToString("o")
                blood_pressure_systolic = 130
                blood_pressure_diastolic = 82
                heart_rate = 78
                respiratory_rate = 16
                temperature = 36.8
                oxygen_saturation = 99
                pain_level = 2
            }
        )
    }
    
    $createVitals = Invoke-ApiCall -Method "POST" -Endpoint "/api/clinical/vitals" -Body $vitalsData
    Write-TestResult -Name "Create Vitals Flowsheet" -Success $createVitals.Success -Details $createVitals.Error
    
    # Progress Note
    $progressData = @{
        patient_id = $script:createdPatientId
        note_type = "physician_progress"
        content = "Patient status improved following intervention. Chest pain reduced from 8/10 to 2/10. Vital signs normalizing. Awaiting cardiac catheterization."
        author_role = "physician"
    }
    
    $createProgress = Invoke-ApiCall -Method "POST" -Endpoint "/api/clinical/progress-note" -Body $progressData
    Write-TestResult -Name "Create Progress Note" -Success $createProgress.Success -Details $createProgress.Error

} else {
    Write-Host "[SKIP] Clinical documentation tests - no patient ID" -ForegroundColor Gray
}

Write-Host ""

# ============================================
# 5. Laboratory
# ============================================
Write-Host "--- Laboratory ---" -ForegroundColor Yellow

if ($script:createdPatientId) {
    # Create Lab Order
    $labOrderData = @{
        patient_id = $script:createdPatientId
        tests = @("troponin", "cbc", "bmp", "lipid_panel", "bnp")
        priority = "stat"
        ordering_physician = "Dr. Sarah Chen"
        clinical_notes = "Rule out MI. Patient presenting with chest pain and ST elevation."
        fasting_required = $false
    }
    
    $createLabOrder = Invoke-ApiCall -Method "POST" -Endpoint "/api/lab/order" -Body $labOrderData
    Write-TestResult -Name "Create Lab Order" -Success $createLabOrder.Success -Details $createLabOrder.Error
    
    if ($createLabOrder.Success -and $createLabOrder.Data.order_id) {
        $script:createdLabOrderId = $createLabOrder.Data.order_id
        Write-Host "  Lab Order ID: $($script:createdLabOrderId)"
    }
    
    # Get Lab Panels
    $getLabPanels = Invoke-ApiCall -Method "GET" -Endpoint "/api/clinical/lab-panels"
    Write-TestResult -Name "Get Available Lab Panels" -Success $getLabPanels.Success -Details $getLabPanels.Error
    
    if ($getLabPanels.Success) {
        Write-Host "  Available Panels: $($getLabPanels.Data.Count)"
    }
    
    # Submit Lab Results (if order exists)
    if ($script:createdLabOrderId) {
        $labResultData = @{
            order_id = $script:createdLabOrderId
            results = @(
                @{
                    test_name = "Troponin I"
                    value = "0.85"
                    unit = "ng/mL"
                    reference_range = "0.00-0.04"
                    flag = "critical_high"
                }
                @{
                    test_name = "BNP"
                    value = "450"
                    unit = "pg/mL"
                    reference_range = "0-100"
                    flag = "high"
                }
            )
            performed_by = "Lab Tech Johnson"
            notes = "Critical value called to Dr. Chen at 14:32"
        }
        
        $submitLabResults = Invoke-ApiCall -Method "POST" -Endpoint "/api/lab/results" -Body $labResultData
        Write-TestResult -Name "Submit Lab Results" -Success $submitLabResults.Success -Details $submitLabResults.Error
    }

} else {
    Write-Host "[SKIP] Laboratory tests - no patient ID" -ForegroundColor Gray
}

Write-Host ""

# ============================================
# 6. Pharmacy / Prescriptions
# ============================================
Write-Host "--- Pharmacy / Prescriptions ---" -ForegroundColor Yellow

if ($script:createdPatientId) {
    # Create Prescription
    $prescriptionData = @{
        patient_id = $script:createdPatientId
        medication = "Aspirin"
        dosage = "81mg"
        frequency = "once daily"
        route = "oral"
        duration = "ongoing"
        refills = 12
        prescriber = "Dr. Sarah Chen"
        instructions = "Take with food. For cardiovascular protection."
        diagnosis = "Acute coronary syndrome, post-MI prophylaxis"
    }
    
    $createPrescription = Invoke-ApiCall -Method "POST" -Endpoint "/api/prescriptions" -Body $prescriptionData
    Write-TestResult -Name "Create Prescription" -Success $createPrescription.Success -Details $createPrescription.Error
    
    if ($createPrescription.Success -and $createPrescription.Data.prescription_id) {
        $script:createdPrescriptionId = $createPrescription.Data.prescription_id
        Write-Host "  Prescription ID: $($script:createdPrescriptionId)"
    }
    
    # Add another prescription
    $prescription2Data = @{
        patient_id = $script:createdPatientId
        medication = "Atorvastatin"
        dosage = "80mg"
        frequency = "once daily at bedtime"
        route = "oral"
        duration = "ongoing"
        refills = 6
        prescriber = "Dr. Sarah Chen"
        instructions = "Take at bedtime for best effect."
        diagnosis = "Hyperlipidemia, post-MI secondary prevention"
    }
    
    $createPrescription2 = Invoke-ApiCall -Method "POST" -Endpoint "/api/prescriptions" -Body $prescription2Data
    Write-TestResult -Name "Create Second Prescription" -Success $createPrescription2.Success -Details $createPrescription2.Error
    
    # Check Drug Interactions
    $interactionData = @{
        medications = @("Aspirin", "Atorvastatin", "Lisinopril", "Metoprolol")
    }
    
    $checkInteractions = Invoke-ApiCall -Method "POST" -Endpoint "/api/interactions/check" -Body $interactionData
    Write-TestResult -Name "Check Drug Interactions" -Success $checkInteractions.Success -Details $checkInteractions.Error
    
    if ($checkInteractions.Success) {
        Write-Host "  Interactions Found: $($checkInteractions.Data.interactions.Count)"
    }

} else {
    Write-Host "[SKIP] Pharmacy tests - no patient ID" -ForegroundColor Gray
}

Write-Host ""

# ============================================
# 7. Barcode Generation
# ============================================
Write-Host "--- Barcode Generation ---" -ForegroundColor Yellow

if ($script:createdPatientId) {
    # Generate patient barcode
    $barcodeData = @{
        type = "patient"
        id = $script:createdPatientId
        format = "qr"
    }
    
    $generateBarcode = Invoke-ApiCall -Method "POST" -Endpoint "/api/barcode/generate" -Body $barcodeData
    Write-TestResult -Name "Generate Patient QR Code" -Success $generateBarcode.Success -Details $generateBarcode.Error
    
    if ($generateBarcode.Success) {
        Write-Host "  Barcode Generated: $($generateBarcode.Data.barcode_id)"
    }
    
    # Generate prescription barcode
    if ($script:createdPrescriptionId) {
        $rxBarcodeData = @{
            type = "prescription"
            id = $script:createdPrescriptionId
            format = "code128"
        }
        
        $generateRxBarcode = Invoke-ApiCall -Method "POST" -Endpoint "/api/barcode/generate" -Body $rxBarcodeData
        Write-TestResult -Name "Generate Prescription Barcode" -Success $generateRxBarcode.Success -Details $generateRxBarcode.Error
    }
    
    # Scan barcode (simulate)
    $scanData = @{
        barcode_data = "PAT-$($script:createdPatientId)"
    }
    
    $scanBarcode = Invoke-ApiCall -Method "POST" -Endpoint "/api/barcode/scan" -Body $scanData
    Write-TestResult -Name "Scan Barcode" -Success $scanBarcode.Success -Details $scanBarcode.Error

} else {
    Write-Host "[SKIP] Barcode tests - no patient ID" -ForegroundColor Gray
}

Write-Host ""

# ============================================
# 8. Messaging System
# ============================================
Write-Host "--- Messaging System ---" -ForegroundColor Yellow

# Send message from doctor to patient
$messageData = @{
    recipient_id = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"
    subject = "Follow-up Appointment Reminder"
    content = "Dear John, This is a reminder about your follow-up appointment scheduled for next week. Please bring your medication list and any questions you may have. Best regards, Dr. Chen"
    priority = "normal"
    message_type = "clinical"
}

$sendMessage = Invoke-ApiCall -Method "POST" -Endpoint "/api/messages/send" -Body $messageData
Write-TestResult -Name "Send Message" -Success $sendMessage.Success -Details $sendMessage.Error

if ($sendMessage.Success -and $sendMessage.Data.message_id) {
    $script:createdMessageId = $sendMessage.Data.message_id
    Write-Host "  Message ID: $($script:createdMessageId)"
}

# Send urgent message
$urgentMessageData = @{
    recipient_id = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"
    subject = "URGENT: Lab Results Require Attention"
    content = "Critical lab values detected. Please contact the cardiology department immediately. Your troponin levels are elevated."
    priority = "urgent"
    message_type = "alert"
}

$sendUrgentMessage = Invoke-ApiCall -Method "POST" -Endpoint "/api/messages/send" -Body $urgentMessageData
Write-TestResult -Name "Send Urgent Message" -Success $sendUrgentMessage.Success -Details $sendUrgentMessage.Error

# Get messages (inbox)
$getMessages = Invoke-ApiCall -Method "GET" -Endpoint "/api/messages"
Write-TestResult -Name "Get Messages (Inbox)" -Success $getMessages.Success -Details $getMessages.Error

if ($getMessages.Success) {
    Write-Host "  Messages in Inbox: $($getMessages.Data.Count)"
}

Write-Host ""

# ============================================
# 9. NFC Simulation
# ============================================
Write-Host "--- NFC Simulation ---" -ForegroundColor Yellow

if ($script:createdPatientId) {
    # Generate NFC tag
    $nfcData = @{
        patient_id = $script:createdPatientId
        tag_type = "medical_id"
        data = @{
            name = "John TestPatient"
            blood_type = "O+"
            allergies = @("Penicillin", "Shellfish")
            emergency_contact = "+1-555-0102"
        }
    }
    
    $generateNfc = Invoke-ApiCall -Method "POST" -Endpoint "/api/nfc/generate" -Body $nfcData
    Write-TestResult -Name "Generate NFC Tag" -Success $generateNfc.Success -Details $generateNfc.Error
    
    if ($generateNfc.Success) {
        Write-Host "  NFC Tag ID: $($generateNfc.Data.tag_id)"
    }
    
    # Simulate NFC tap
    $tapData = @{
        tag_id = "NFC-$($script:createdPatientId)"
        reader_location = "Emergency Room - Bed 3"
    }
    
    $nfcTap = Invoke-ApiCall -Method "POST" -Endpoint "/api/nfc/tap" -Body $tapData
    Write-TestResult -Name "Simulate NFC Tap" -Success $nfcTap.Success -Details $nfcTap.Error

} else {
    Write-Host "[SKIP] NFC tests - no patient ID" -ForegroundColor Gray
}

Write-Host ""

# ============================================
# 10. Consent Management
# ============================================
Write-Host "--- Consent Management ---" -ForegroundColor Yellow

# Get consent types
$getConsentTypes = Invoke-ApiCall -Method "GET" -Endpoint "/api/consent/types"
Write-TestResult -Name "Get Consent Types" -Success $getConsentTypes.Success -Details $getConsentTypes.Error

if ($getConsentTypes.Success) {
    Write-Host "  Available Consent Types: $($getConsentTypes.Data.Count)"
}

if ($script:createdPatientId) {
    # Record consent
    $consentData = @{
        patient_id = $script:createdPatientId
        consent_type = "treatment"
        granted = $true
        witness = "Nurse Williams"
        notes = "Patient verbally consented to emergency cardiac catheterization."
        valid_until = (Get-Date).AddYears(1).ToString("yyyy-MM-dd")
    }
    
    $recordConsent = Invoke-ApiCall -Method "POST" -Endpoint "/api/consent/record" -Body $consentData
    Write-TestResult -Name "Record Patient Consent" -Success $recordConsent.Success -Details $recordConsent.Error
}

Write-Host ""

# ============================================
# 11. Dashboard Data
# ============================================
Write-Host "--- Dashboard Endpoints ---" -ForegroundColor Yellow

# Doctor Dashboard
$doctorDashboard = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/doctor"
Write-TestResult -Name "Doctor Dashboard" -Success $doctorDashboard.Success -Details $doctorDashboard.Error

if ($doctorDashboard.Success) {
    Write-Host "  Patients Today: $($doctorDashboard.Data.patients_today)"
    Write-Host "  Pending Tasks: $($doctorDashboard.Data.pending_tasks)"
}

# Nurse Dashboard
$nurseDashboard = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/nurse"
Write-TestResult -Name "Nurse Dashboard" -Success $nurseDashboard.Success -Details $nurseDashboard.Error

# Admin Dashboard
$adminDashboard = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/admin" -UserId "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
Write-TestResult -Name "Admin Dashboard" -Success $adminDashboard.Success -Details $adminDashboard.Error

# Lab Dashboard
$labDashboard = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/lab"
Write-TestResult -Name "Lab Dashboard" -Success $labDashboard.Success -Details $labDashboard.Error

# Pharmacy Dashboard
$pharmacyDashboard = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/pharmacy"
Write-TestResult -Name "Pharmacy Dashboard" -Success $pharmacyDashboard.Success -Details $pharmacyDashboard.Error

Write-Host ""

# ============================================
# 12. Symptom Analysis
# ============================================
Write-Host "--- Symptom Analysis ---" -ForegroundColor Yellow

$symptomData = @{
    symptoms = @("chest pain", "shortness of breath", "diaphoresis", "left arm pain", "nausea")
    duration = "30 minutes"
    severity = "severe"
    patient_age = 55
    patient_gender = "male"
    existing_conditions = @("hypertension", "diabetes type 2")
    current_medications = @("lisinopril", "metformin")
}

$analyzeSymptoms = Invoke-ApiCall -Method "POST" -Endpoint "/api/symptoms/analyze" -Body $symptomData
Write-TestResult -Name "Analyze Symptoms" -Success $analyzeSymptoms.Success -Details $analyzeSymptoms.Error

if ($analyzeSymptoms.Success) {
    Write-Host "  Urgency: $($analyzeSymptoms.Data.urgency)"
    Write-Host "  Top Differential: $($analyzeSymptoms.Data.differentials[0].condition)"
}

Write-Host ""

# ============================================
# 13. FHIR Endpoints
# ============================================
Write-Host "--- FHIR R4 Endpoints ---" -ForegroundColor Yellow

# FHIR Metadata
$fhirMetadata = Invoke-ApiCall -Method "GET" -Endpoint "/api/fhir/r4/metadata"
Write-TestResult -Name "FHIR CapabilityStatement" -Success $fhirMetadata.Success -Details $fhirMetadata.Error

if ($script:createdPatientId) {
    # FHIR Patient
    $fhirPatient = Invoke-ApiCall -Method "GET" -Endpoint "/api/fhir/r4/Patient/$($script:createdPatientId)"
    Write-TestResult -Name "FHIR Get Patient" -Success $fhirPatient.Success -Details $fhirPatient.Error
    
    # FHIR AllergyIntolerance
    $fhirAllergies = Invoke-ApiCall -Method "GET" -Endpoint "/api/fhir/r4/AllergyIntolerance?patient=$($script:createdPatientId)"
    Write-TestResult -Name "FHIR Get Allergies" -Success $fhirAllergies.Success -Details $fhirAllergies.Error
}

Write-Host ""

# ============================================
# 14. Emergency Access
# ============================================
Write-Host "--- Emergency Access ---" -ForegroundColor Yellow

if ($script:createdPatientId) {
    $emergencyData = @{
        patient_id = $script:createdPatientId
        reason = "Cardiac arrest - patient unresponsive. Immediate access required for treatment history."
        access_type = "emergency"
    }
    
    $requestEmergencyAccess = Invoke-ApiCall -Method "POST" -Endpoint "/api/emergency-access/request" -Body $emergencyData
    Write-TestResult -Name "Request Emergency Access" -Success $requestEmergencyAccess.Success -Details $requestEmergencyAccess.Error
}

Write-Host ""

# ============================================
# Summary
# ============================================
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   Test Summary" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Total Tests: $($script:total)"
Write-Host "Passed: $($script:passed)" -ForegroundColor Green
Write-Host "Failed: $($script:failed)" -ForegroundColor $(if ($script:failed -gt 0) { "Red" } else { "Green" })
Write-Host ""

if ($script:createdPatientId) {
    Write-Host "Created Test Data:" -ForegroundColor Cyan
    Write-Host "  Patient ID: $($script:createdPatientId)"
    if ($script:createdAllergyId) { Write-Host "  Allergy ID: $($script:createdAllergyId)" }
    if ($script:createdTriageId) { Write-Host "  Triage ID: $($script:createdTriageId)" }
    if ($script:createdLabOrderId) { Write-Host "  Lab Order ID: $($script:createdLabOrderId)" }
    if ($script:createdPrescriptionId) { Write-Host "  Prescription ID: $($script:createdPrescriptionId)" }
    if ($script:createdMessageId) { Write-Host "  Message ID: $($script:createdMessageId)" }
}

Write-Host ""
Write-Host "View dashboards at:" -ForegroundColor Cyan
Write-Host "  Doctor Portal: http://localhost:5173"
Write-Host "  Patient App: http://localhost:5174"
Write-Host ""

$successRate = [math]::Round(($script:passed / $script:total) * 100, 1)
if ($successRate -ge 80) {
    Write-Host "[SUCCESS] $successRate% of tests passed!" -ForegroundColor Green
} elseif ($successRate -ge 50) {
    Write-Host "[WARNING] $successRate% of tests passed. Some endpoints may need attention." -ForegroundColor Yellow
} else {
    Write-Host "[ERROR] Only $successRate% of tests passed. Please check API implementation." -ForegroundColor Red
}
