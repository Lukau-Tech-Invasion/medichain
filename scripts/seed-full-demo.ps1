# MediChain FULL Demo Data Seeding Script
# =========================================
# Creates comprehensive demo data for ALL workflows
# Uses South African names and realistic medical scenarios
#
# Usage: .\scripts\seed-full-demo.ps1

$API_BASE = "http://localhost:8080"

# Demo user wallet addresses (from demo_users.json)
$DOCTOR_ID = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"      # Dr. Thandi Mbeki
$NURSE_ID = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"       # Nurse Nomvula Nkosi
$LAB_TECH_ID = "5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL"    # Lab Tech Bongani Dlamini
$PHARMACIST_ID = "5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy"  # Pharmacist Zanele Khumalo
$ADMIN_ID = "5GNJqTPyNqANBkUVMN1LPPrxXnFouWXoe2wNSmmEoLctxiZY"       # Admin Sipho Mthembu

# Demo patient IDs (from database)
$PATIENTS = @{
    "Thabo"   = "PAT-001-DEMO"
    "Nomvula" = "PAT-002-DEMO"
    "Sipho"   = "PAT-003-DEMO"
    "Lerato"  = "PAT-004-DEMO"
    "Bongani" = "PAT-005-DEMO"
}

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "     MediChain FULL Demo Data Seeding Script                        " -ForegroundColor Cyan
Write-Host "     Creates comprehensive data for ALL workflows                   " -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# Check if API is running
Write-Host "Checking API health..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$API_BASE/api/demo" -Method Get -ErrorAction Stop
    Write-Host "[OK] API is running" -ForegroundColor Green
}
catch {
    Write-Host "[ERROR] API is not running. Start it with: .\run-api.bat" -ForegroundColor Red
    exit 1
}

$headers = @{
    "Content-Type" = "application/json"
    "X-User-Id"    = $DOCTOR_ID
}

$nurseHeaders = @{
    "Content-Type" = "application/json"
    "X-User-Id"    = $NURSE_ID
}

$labHeaders = @{
    "Content-Type" = "application/json"
    "X-User-Id"    = $LAB_TECH_ID
}

$pharmacistHeaders = @{
    "Content-Type" = "application/json"
    "X-User-Id"    = $PHARMACIST_ID
}

$successCount = 0
$errorCount = 0

function Invoke-ApiCall {
    param(
        [string]$Endpoint,
        [string]$Method = "Post",
        [hashtable]$Headers,
        [object]$Body,
        [string]$Description
    )
    
    try {
        $bodyJson = $Body | ConvertTo-Json -Depth 10
        $response = Invoke-RestMethod -Uri "$API_BASE$Endpoint" -Method $Method -Headers $Headers -Body $bodyJson -ErrorAction Stop
        Write-Host "  [OK] $Description" -ForegroundColor Green
        $script:successCount++
        return $response
    }
    catch {
        Write-Host "  [WARN] $Description - $($_.Exception.Message)" -ForegroundColor Yellow
        $script:errorCount++
        return $null
    }
}

# ============================================
# SECTION 1: VITAL SIGNS (Multiple readings per patient)
# ============================================
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  SECTION 1: Creating Vital Signs History" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

# Thabo Mokoena - Cardiac patient with elevated BP
$vitalSets = @(
    @{
        patient_id               = $PATIENTS["Thabo"]
        blood_pressure_systolic  = 158
        blood_pressure_diastolic = 94
        heart_rate               = 88
        respiratory_rate         = 18
        temperature_celsius      = 36.8
        oxygen_saturation        = 97
        pain_scale               = 3
        consciousness_level      = "Alert"
        recorded_at              = (Get-Date).AddHours(-4).ToString("o")
        notes                    = "Initial assessment. Patient reports chest discomfort."
    },
    @{
        patient_id               = $PATIENTS["Thabo"]
        blood_pressure_systolic  = 152
        blood_pressure_diastolic = 90
        heart_rate               = 82
        respiratory_rate         = 16
        temperature_celsius      = 36.7
        oxygen_saturation        = 98
        pain_scale               = 2
        consciousness_level      = "Alert"
        recorded_at              = (Get-Date).AddHours(-2).ToString("o")
        notes                    = "After medication. BP improving."
    },
    @{
        patient_id               = $PATIENTS["Thabo"]
        blood_pressure_systolic  = 145
        blood_pressure_diastolic = 88
        heart_rate               = 78
        respiratory_rate         = 16
        temperature_celsius      = 36.8
        oxygen_saturation        = 99
        pain_scale               = 1
        consciousness_level      = "Alert"
        recorded_at              = (Get-Date).AddHours(-1).ToString("o")
        notes                    = "Stable. Ready for discharge planning."
    }
)

# Nomvula Dlamini - Diabetic with elevated glucose
$vitalSets += @(
    @{
        patient_id               = $PATIENTS["Nomvula"]
        blood_pressure_systolic  = 128
        blood_pressure_diastolic = 82
        heart_rate               = 76
        respiratory_rate         = 16
        temperature_celsius      = 36.9
        oxygen_saturation        = 99
        pain_scale               = 0
        consciousness_level      = "Alert"
        blood_glucose            = 245
        recorded_at              = (Get-Date).AddHours(-3).ToString("o")
        notes                    = "Elevated blood glucose. Patient reports dizziness."
    },
    @{
        patient_id               = $PATIENTS["Nomvula"]
        blood_pressure_systolic  = 126
        blood_pressure_diastolic = 80
        heart_rate               = 74
        respiratory_rate         = 16
        temperature_celsius      = 36.8
        oxygen_saturation        = 99
        pain_scale               = 0
        consciousness_level      = "Alert"
        blood_glucose            = 185
        recorded_at              = (Get-Date).AddHours(-1).ToString("o")
        notes                    = "Post insulin. Glucose improving."
    }
)

# Sipho Nkosi - Asthma exacerbation
$vitalSets += @(
    @{
        patient_id               = $PATIENTS["Sipho"]
        blood_pressure_systolic  = 132
        blood_pressure_diastolic = 84
        heart_rate               = 96
        respiratory_rate         = 24
        temperature_celsius      = 37.2
        oxygen_saturation        = 92
        pain_scale               = 2
        consciousness_level      = "Alert"
        peak_flow                = 320
        recorded_at              = (Get-Date).AddHours(-2).ToString("o")
        notes                    = "Acute asthma exacerbation. Wheezing bilateral."
    },
    @{
        patient_id               = $PATIENTS["Sipho"]
        blood_pressure_systolic  = 128
        blood_pressure_diastolic = 80
        heart_rate               = 84
        respiratory_rate         = 18
        temperature_celsius      = 37.0
        oxygen_saturation        = 96
        pain_scale               = 0
        consciousness_level      = "Alert"
        peak_flow                = 420
        recorded_at              = (Get-Date).AddMinutes(-30).ToString("o")
        notes                    = "Post nebulizer treatment. Significant improvement."
    }
)

foreach ($vital in $vitalSets) {
    Invoke-ApiCall -Endpoint "/api/clinical/vitals" -Headers $nurseHeaders -Body $vital -Description "Vitals for $($vital.patient_id)"
}

# ============================================
# SECTION 2: TRIAGE ASSESSMENTS
# ============================================
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  SECTION 2: Creating Triage Assessments" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

$triageAssessments = @(
    @{
        patient_id      = $PATIENTS["Thabo"]
        chief_complaint = "Chest pain radiating to left arm, started 3 hours ago"
        esi_level       = 2
        pain_scale      = 6
        vital_signs     = @{
            blood_pressure_systolic  = 158
            blood_pressure_diastolic = 94
            heart_rate               = 92
            respiratory_rate         = 20
            temperature_celsius      = 37.0
            oxygen_saturation        = 96
            consciousness_level      = "Alert"
        }
        arrival_mode    = "Ambulance"
        notes           = "History of hypertension. ECG shows sinus tachycardia. Troponin pending."
        acuity_color    = "Orange"
    },
    @{
        patient_id      = $PATIENTS["Nomvula"]
        chief_complaint = "Dizziness and fatigue, blood sugar 245 at home"
        esi_level       = 3
        pain_scale      = 1
        vital_signs     = @{
            blood_pressure_systolic  = 128
            blood_pressure_diastolic = 82
            heart_rate               = 78
            respiratory_rate         = 16
            temperature_celsius      = 36.9
            oxygen_saturation        = 99
            consciousness_level      = "Alert"
        }
        arrival_mode    = "Walk-in"
        notes           = "Known Type 2 Diabetic. Non-compliant with medications. No ketones in urine."
        acuity_color    = "Yellow"
    },
    @{
        patient_id      = $PATIENTS["Sipho"]
        chief_complaint = "Difficulty breathing, wheezing for 6 hours"
        esi_level       = 2
        pain_scale      = 3
        vital_signs     = @{
            blood_pressure_systolic  = 134
            blood_pressure_diastolic = 86
            heart_rate               = 98
            respiratory_rate         = 26
            temperature_celsius      = 37.3
            oxygen_saturation        = 91
            consciousness_level      = "Alert"
        }
        arrival_mode    = "Private vehicle"
        notes           = "Known asthmatic. Using accessory muscles. Peak flow 280 (baseline 480)."
        acuity_color    = "Orange"
    },
    @{
        patient_id      = $PATIENTS["Lerato"]
        chief_complaint = "Allergic reaction after eating shellfish"
        esi_level       = 2
        pain_scale      = 2
        vital_signs     = @{
            blood_pressure_systolic  = 118
            blood_pressure_diastolic = 72
            heart_rate               = 102
            respiratory_rate         = 22
            temperature_celsius      = 37.0
            oxygen_saturation        = 97
            consciousness_level      = "Alert"
        }
        arrival_mode    = "Walk-in"
        notes           = "Facial swelling, hives on trunk. No stridor. Airway patent."
        acuity_color    = "Orange"
    },
    @{
        patient_id      = $PATIENTS["Bongani"]
        chief_complaint = "Shortness of breath and leg swelling worsening over 3 days"
        esi_level       = 2
        pain_scale      = 4
        vital_signs     = @{
            blood_pressure_systolic  = 142
            blood_pressure_diastolic = 88
            heart_rate               = 96
            respiratory_rate         = 24
            temperature_celsius      = 36.8
            oxygen_saturation        = 89
            consciousness_level      = "Alert"
        }
        arrival_mode    = "Ambulance"
        notes           = "Known CHF. DNR on file. 3+ pitting edema bilateral. Crackles bases."
        acuity_color    = "Orange"
    }
)

foreach ($triage in $triageAssessments) {
    Invoke-ApiCall -Endpoint "/api/clinical/triage" -Headers $nurseHeaders -Body $triage -Description "Triage ESI-$($triage.esi_level) for $($triage.patient_id)"
}

# ============================================
# SECTION 3: SOAP NOTES
# ============================================
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  SECTION 3: Creating SOAP Notes" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

$soapNotes = @(
    @{
        patient_id      = $PATIENTS["Thabo"]
        subjective      = "Mr. Thabo Mokoena is a 47-year-old male presenting with substernal chest pain for 3 hours. Pain is pressure-like, 6/10, radiating to left arm and jaw. Associated with mild diaphoresis and nausea. He took aspirin at home. History of hypertension on Atenolol 50mg daily. Non-smoker. Family history: father had MI at age 55."
        objective       = "Vitals: BP 158/94, HR 92, RR 20, Temp 37.0°C, SpO2 96% RA. General: Diaphoretic, anxious. CV: Regular rhythm, no murmurs, S1S2 normal. Lungs: Clear bilateral. Abdomen: Soft, non-tender. Extremities: No edema. ECG: Sinus tachycardia, ST depression V4-V6."
        assessment      = "1. Acute Coronary Syndrome - NSTEMI likely given ECG changes and clinical presentation\n2. Hypertension - uncontrolled\n3. Acute anxiety secondary to chest pain"
        plan            = "1. Admit to CCU for monitoring\n2. Serial troponins q6h\n3. Heparin drip per protocol\n4. Aspirin 325mg, Plavix 300mg load\n5. Cardiology consult for possible cath\n6. Continue Atenolol, add Lisinopril 10mg\n7. NPO for possible procedure"
        encounter_type  = "Emergency"
        diagnosis_codes = @("I21.4", "I10", "R07.9")
    },
    @{
        patient_id      = $PATIENTS["Nomvula"]
        subjective      = "Ms. Nomvula Dlamini is a 34-year-old female with Type 2 Diabetes presenting with dizziness and fatigue for 2 days. Blood glucose at home was 245 mg/dL. She admits to missing her Metformin doses for the past week due to GI upset. No polyuria, polydipsia, or weight loss. No blurred vision. No chest pain or shortness of breath."
        objective       = "Vitals: BP 128/82, HR 78, RR 16, Temp 36.9°C, SpO2 99% RA. General: Alert, no acute distress. HEENT: Dry mucous membranes. CV: Regular rhythm. Lungs: Clear. Abdomen: Soft, mild epigastric tenderness. Extremities: No edema, intact sensation. Labs: Glucose 245, HbA1c 8.9%, BMP normal, UA negative for ketones."
        assessment      = "1. Type 2 Diabetes Mellitus - uncontrolled due to medication non-compliance\n2. Hyperglycemia without ketoacidosis\n3. Medication intolerance - GI side effects from Metformin"
        plan            = "1. Switch to Metformin XR 500mg daily with food\n2. Start Glipizide 5mg daily\n3. Diabetes education referral\n4. Nutritional counseling\n5. Follow up in 1 week for glucose check\n6. HbA1c recheck in 3 months\n7. Ophthalmology referral for diabetic eye exam"
        encounter_type  = "Urgent Care"
        diagnosis_codes = @("E11.65", "R42")
    },
    @{
        patient_id      = $PATIENTS["Sipho"]
        subjective      = "Mr. Sipho Nkosi is a 46-year-old male with asthma presenting with acute shortness of breath for 6 hours. He reports increased cough productive of white sputum, chest tightness, and audible wheezing. Symptoms started after exposure to dust while cleaning his garage. Using rescue inhaler every 2 hours without relief. No fever, no sick contacts."
        objective       = "Vitals: BP 134/86, HR 98, RR 26, Temp 37.3°C, SpO2 91% RA (improved to 96% on 2L NC). General: Tripoding, using accessory muscles. HEENT: No nasal flaring. CV: Tachycardic, regular. Lungs: Diffuse expiratory wheezes, decreased air entry bases. Peak flow: 280 L/min (baseline 480). CXR: Hyperinflation, no infiltrates."
        assessment      = "1. Acute severe asthma exacerbation - triggered by allergen exposure\n2. Respiratory distress\n3. Hypoxemia"
        plan            = "1. Continuous albuterol nebs x 1 hour\n2. Ipratropium nebs q20min x3\n3. Methylprednisolone 125mg IV now\n4. Magnesium sulfate 2g IV if no improvement\n5. O2 to maintain SpO2 above 94 percent\n6. Peak flow q30min\n7. Admit if no improvement in 2 hours\n8. Update asthma action plan on discharge"
        encounter_type  = "Emergency"
        diagnosis_codes = @("J45.41", "R06.02", "J45.901")
    },
    @{
        patient_id      = $PATIENTS["Lerato"]
        subjective      = "Ms. Lerato Khumalo is a 28-year-old female presenting with allergic reaction 45 minutes after eating prawns at a restaurant. She developed facial swelling, hives on chest and back, and mild throat tightness. No prior history of seafood allergy. Known allergy to Penicillin and Ibuprofen. She took Benadryl 50mg before arrival. No difficulty breathing or swallowing currently."
        objective       = "Vitals: BP 118/72, HR 102, RR 22, Temp 37.0°C, SpO2 97% RA. General: Anxious but stable. HEENT: Mild periorbital edema, no lip swelling, uvula midline, no stridor. Neck: Supple, no lymphadenopathy. Skin: Urticarial rash on trunk and extremities. Lungs: Clear, no wheezing. CV: Tachycardic, regular."
        assessment      = "1. Acute allergic reaction to shellfish - moderate severity\n2. Angioedema - facial\n3. Acute urticaria\n4. Rule out anaphylaxis - currently no airway compromise"
        plan            = "1. Epinephrine 0.3mg IM if any progression\n2. Diphenhydramine 50mg IV\n3. Methylprednisolone 125mg IV\n4. Famotidine 20mg IV\n5. Observe 4-6 hours for biphasic reaction\n6. Prescribe EpiPen on discharge\n7. Allergy testing referral\n8. Strict shellfish avoidance education"
        encounter_type  = "Emergency"
        diagnosis_codes = @("T78.09XA", "L50.0", "T78.3XXA")
    },
    @{
        patient_id      = $PATIENTS["Bongani"]
        subjective      = 'Mr. Bongani Zulu is a 63-year-old male with known CHF (EF 25%) presenting with worsening shortness of breath and bilateral leg swelling for 3 days. He reports orthopnea (3 pillows) and PND. Weight increased 4kg in past week. He admits to dietary indiscretion - ate traditional salty foods at family gathering. DNR/DNI status confirmed with family present.'
        objective       = 'Vitals: BP 142/88, HR 96, RR 24, Temp 36.8C, SpO2 89% RA (94% on 4L NC). General: Respiratory distress, speaking in short sentences. JVP elevated 12cm. CV: S3 gallop, 2/6 holosystolic murmur at apex. Lungs: Crackles to mid-lung fields bilateral. Abdomen: Hepatomegaly, positive hepatojugular reflex. Extremities: 3+ pitting edema to thighs. BNP: 2450 pg/mL.'
        assessment      = '1. Acute on chronic systolic heart failure exacerbation - NYHA Class IV
2. Volume overload secondary to dietary non-compliance
3. Chronic atrial fibrillation with RVR
4. Moderate mitral regurgitation'
        plan            = '1. Furosemide 80mg IV now, then 40mg IV q8h
2. Strict I/O, daily weights
3. Fluid restriction 1.5L/day
4. Low sodium diet
5. Digoxin 0.125mg daily (check level)
6. Continue Warfarin (check INR)
7. Cardiology consult
8. Goals of care discussion - patient is DNR/DNI
9. Palliative care consult if not improving'
        encounter_type  = "Emergency"
        diagnosis_codes = @("I50.23", "I48.91", "I34.0", "Z66")
    }
)

foreach ($soap in $soapNotes) {
    Invoke-ApiCall -Endpoint "/api/clinical/soap" -Headers $headers -Body $soap -Description "SOAP Note for $($soap.patient_id)"
}

# ============================================
# SECTION 4: CODE BLUE (for demo of resuscitation)
# ============================================
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  SECTION 4: Creating Code Blue Record" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

$codeBlue = @{
    patient_id             = $PATIENTS["Thabo"]
    location               = "CCU Bed 4"
    initiated_at           = (Get-Date).AddHours(-2).ToString("o")
    initial_rhythm         = "Ventricular Fibrillation"
    team_members           = @(
        @{ role = "Team Leader"; name = "Dr. Thandi Mbeki"; arrived_at = (Get-Date).AddHours(-2).ToString("o") }
        @{ role = "Airway"; name = "Dr. Kagiso Molefe"; arrived_at = (Get-Date).AddHours(-2).AddMinutes(1).ToString("o") }
        @{ role = "Compressions"; name = "Nurse Nomvula Nkosi"; arrived_at = (Get-Date).AddHours(-2).ToString("o") }
        @{ role = "IV/Medications"; name = "Nurse Thando Cele"; arrived_at = (Get-Date).AddHours(-2).AddMinutes(1).ToString("o") }
        @{ role = "Recorder"; name = "Nurse Palesa Mokone"; arrived_at = (Get-Date).AddHours(-2).AddMinutes(2).ToString("o") }
        @{ role = "Defibrillator"; name = "Tech Bongani Dlamini"; arrived_at = (Get-Date).AddHours(-2).AddMinutes(1).ToString("o") }
    )
    interventions          = @(
        @{ time = (Get-Date).AddHours(-2).ToString("o"); action = "Code Blue called"; by = "Nurse Nomvula Nkosi" }
        @{ time = (Get-Date).AddHours(-2).AddMinutes(0).AddSeconds(30).ToString("o"); action = "CPR initiated"; by = "Nurse Nomvula Nkosi" }
        @{ time = (Get-Date).AddHours(-2).AddMinutes(1).ToString("o"); action = "Pads applied - VF confirmed"; by = "Tech Bongani Dlamini" }
        @{ time = (Get-Date).AddHours(-2).AddMinutes(1).AddSeconds(30).ToString("o"); action = "Shock 200J delivered"; by = "Dr. Thandi Mbeki" }
        @{ time = (Get-Date).AddHours(-2).AddMinutes(2).ToString("o"); action = "CPR resumed"; by = "Nurse Nomvula Nkosi" }
        @{ time = (Get-Date).AddHours(-2).AddMinutes(2).AddSeconds(30).ToString("o"); action = "IV access established"; by = "Nurse Thando Cele" }
        @{ time = (Get-Date).AddHours(-2).AddMinutes(3).ToString("o"); action = "Epinephrine 1mg IV push"; by = "Nurse Thando Cele" }
        @{ time = (Get-Date).AddHours(-2).AddMinutes(4).ToString("o"); action = "Rhythm check - still VF"; by = "Dr. Thandi Mbeki" }
        @{ time = (Get-Date).AddHours(-2).AddMinutes(4).AddSeconds(30).ToString("o"); action = "Shock 200J delivered"; by = "Dr. Thandi Mbeki" }
        @{ time = (Get-Date).AddHours(-2).AddMinutes(5).ToString("o"); action = "CPR resumed"; by = "Nurse rotation" }
        @{ time = (Get-Date).AddHours(-2).AddMinutes(6).ToString("o"); action = "Amiodarone 300mg IV push"; by = "Nurse Thando Cele" }
        @{ time = (Get-Date).AddHours(-2).AddMinutes(8).ToString("o"); action = "Rhythm check - organized rhythm"; by = "Dr. Thandi Mbeki" }
        @{ time = (Get-Date).AddHours(-2).AddMinutes(8).AddSeconds(30).ToString("o"); action = "Pulse check - ROSC confirmed"; by = "Dr. Thandi Mbeki" }
    )
    medications_given      = @(
        @{ medication = "Epinephrine 1mg"; route = "IV push"; time = (Get-Date).AddHours(-2).AddMinutes(3).ToString("o") }
        @{ medication = "Amiodarone 300mg"; route = "IV push"; time = (Get-Date).AddHours(-2).AddMinutes(6).ToString("o") }
    )
    defibrillations        = @(
        @{ energy = 200; rhythm_before = "Ventricular Fibrillation"; rhythm_after = "VF"; time = (Get-Date).AddHours(-2).AddMinutes(1).AddSeconds(30).ToString("o") }
        @{ energy = 200; rhythm_before = "Ventricular Fibrillation"; rhythm_after = "Sinus Tachycardia"; time = (Get-Date).AddHours(-2).AddMinutes(4).AddSeconds(30).ToString("o") }
    )
    outcome                = "ROSC"
    rosc_time              = (Get-Date).AddHours(-2).AddMinutes(8).AddSeconds(30).ToString("o")
    total_downtime_minutes = 8.5
    post_rosc_rhythm       = "Sinus Tachycardia"
    post_rosc_bp           = "98/62"
    post_rosc_actions      = @(
        "Amiodarone drip started 1mg/min"
        "12-lead ECG - STEMI anterior"
        "Cardiology notified for emergent cath"
        "Targeted temperature management initiated"
        "Arterial line placed"
        "Family notified"
    )
    notes                  = "Witnessed arrest in CCU. Patient was being monitored for NSTEMI when he went into VF. Rapid response with ROSC achieved in 8.5 minutes. Post-ROSC ECG shows STEMI. Emergent cath lab activation."
}

Invoke-ApiCall -Endpoint "/api/clinical/code-blue" -Headers $headers -Body $codeBlue -Description "Code Blue with ROSC for Thabo Mokoena"

# ============================================
# SECTION 5: LAB RESULTS
# ============================================
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  SECTION 5: Creating Lab Results" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

$labResults = @(
    # Cardiac panel for Thabo
    @{
        patient_id    = $PATIENTS["Thabo"]
        test_name     = "Cardiac Markers"
        test_category = "Chemistry"
        priority      = "STAT"
        results       = @(
            @{ parameter = "Troponin I (Initial)"; value = "0.82"; unit = "ng/mL"; reference_range = "0.00-0.04"; flag = "Critical High" }
            @{ parameter = "Troponin I (6hr)"; value = "4.25"; unit = "ng/mL"; reference_range = "0.00-0.04"; flag = "Critical High" }
            @{ parameter = "CK-MB"; value = "45.2"; unit = "ng/mL"; reference_range = "0.0-6.6"; flag = "High" }
            @{ parameter = "BNP"; value = "890"; unit = "pg/mL"; reference_range = "0-100"; flag = "High" }
            @{ parameter = "Myoglobin"; value = "312"; unit = "ng/mL"; reference_range = "0-85"; flag = "High" }
        )
        notes         = "CRITICAL: Elevated troponin consistent with acute MI. Cardiology notified."
        collected_at  = (Get-Date).AddHours(-3).ToString("o")
        resulted_at   = (Get-Date).AddHours(-2).ToString("o")
    },
    @{
        patient_id    = $PATIENTS["Thabo"]
        test_name     = "Complete Blood Count"
        test_category = "Hematology"
        priority      = "Routine"
        results       = @(
            @{ parameter = "WBC"; value = "11.2"; unit = "x10^9/L"; reference_range = "4.5-11.0"; flag = "High" }
            @{ parameter = "RBC"; value = "4.8"; unit = "x10^12/L"; reference_range = "4.5-5.5"; flag = $null }
            @{ parameter = "Hemoglobin"; value = "14.2"; unit = "g/dL"; reference_range = "13.5-17.5"; flag = $null }
            @{ parameter = "Hematocrit"; value = "42"; unit = "%"; reference_range = "38.8-50.0"; flag = $null }
            @{ parameter = "Platelets"; value = "285"; unit = "x10^9/L"; reference_range = "150-400"; flag = $null }
        )
        notes         = "Mild leukocytosis, likely stress response."
    },
    # Diabetic panel for Nomvula
    @{
        patient_id    = $PATIENTS["Nomvula"]
        test_name     = "Diabetic Panel"
        test_category = "Chemistry"
        priority      = "Routine"
        results       = @(
            @{ parameter = "Glucose (Fasting)"; value = "218"; unit = "mg/dL"; reference_range = "70-100"; flag = "High" }
            @{ parameter = "HbA1c"; value = "8.9"; unit = "%"; reference_range = "4.0-5.6"; flag = "High" }
            @{ parameter = "BUN"; value = "18"; unit = "mg/dL"; reference_range = "7-20"; flag = $null }
            @{ parameter = "Creatinine"; value = "0.9"; unit = "mg/dL"; reference_range = "0.6-1.2"; flag = $null }
            @{ parameter = "eGFR"; value = "92"; unit = "mL/min/1.73m2"; reference_range = "Over 60"; flag = $null }
        )
        notes         = "Poor glycemic control. Kidney function preserved. Recommend medication optimization."
    },
    @{
        patient_id    = $PATIENTS["Nomvula"]
        test_name     = "Lipid Panel"
        test_category = "Chemistry"
        priority      = "Routine"
        results       = @(
            @{ parameter = "Total Cholesterol"; value = "245"; unit = "mg/dL"; reference_range = "Under 200"; flag = "High" }
            @{ parameter = "LDL Cholesterol"; value = "162"; unit = "mg/dL"; reference_range = "Under 100"; flag = "High" }
            @{ parameter = "HDL Cholesterol"; value = "38"; unit = "mg/dL"; reference_range = "Over 40"; flag = "Low" }
            @{ parameter = "Triglycerides"; value = "225"; unit = "mg/dL"; reference_range = "Under 150"; flag = "High" }
        )
        notes         = "Dyslipidemia. Recommend statin therapy."
    },
    # CHF panel for Bongani
    @{
        patient_id    = $PATIENTS["Bongani"]
        test_name     = "Heart Failure Panel"
        test_category = "Chemistry"
        priority      = "STAT"
        results       = @(
            @{ parameter = "BNP"; value = "2450"; unit = "pg/mL"; reference_range = "0-100"; flag = "Critical High" }
            @{ parameter = "Sodium"; value = "132"; unit = "mEq/L"; reference_range = "136-145"; flag = "Low" }
            @{ parameter = "Potassium"; value = "5.2"; unit = "mEq/L"; reference_range = "3.5-5.0"; flag = "High" }
            @{ parameter = "Creatinine"; value = "1.8"; unit = "mg/dL"; reference_range = "0.7-1.3"; flag = "High" }
            @{ parameter = "BUN"; value = "42"; unit = "mg/dL"; reference_range = "7-20"; flag = "High" }
            @{ parameter = "INR"; value = "2.4"; unit = "ratio"; reference_range = "2.0-3.0"; flag = $null }
            @{ parameter = "Digoxin Level"; value = "1.2"; unit = "ng/mL"; reference_range = "0.8-2.0"; flag = $null }
        )
        notes         = "Severely elevated BNP consistent with acute decompensated HF. Cardiorenal syndrome. Monitor K+ closely with diuretics."
    }
)

foreach ($lab in $labResults) {
    Invoke-ApiCall -Endpoint "/api/lab/submit" -Headers $labHeaders -Body $lab -Description "Lab: $($lab.test_name) for $($lab.patient_id)"
}

# ============================================
# SECTION 6: E-PRESCRIPTIONS
# ============================================
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  SECTION 6: Creating E-Prescriptions" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

$prescriptions = @(
    @{
        rx_id           = "RX-" + (Get-Random -Minimum 100000 -Maximum 999999)
        patient_id      = $PATIENTS["Thabo"]
        medication_name = "Clopidogrel (Plavix)"
        generic_name    = "Clopidogrel"
        strength        = "75mg"
        form            = "Tablet"
        directions      = "Take one tablet by mouth once daily"
        quantity        = 30
        quantity_unit   = "tablets"
        days_supply     = 30
        refills         = 11
        prescriber      = @{ name = "Dr. Thandi Mbeki"; npi = "1234567890" }
        written_date    = (Get-Date).ToString("yyyy-MM-dd")
        diagnosis_codes = @("I21.4")
        status          = "Active"
    },
    @{
        rx_id           = "RX-" + (Get-Random -Minimum 100000 -Maximum 999999)
        patient_id      = $PATIENTS["Thabo"]
        medication_name = "Atorvastatin (Lipitor)"
        generic_name    = "Atorvastatin"
        strength        = "80mg"
        form            = "Tablet"
        directions      = "Take one tablet by mouth at bedtime"
        quantity        = 30
        quantity_unit   = "tablets"
        days_supply     = 30
        refills         = 11
        prescriber      = @{ name = "Dr. Thandi Mbeki"; npi = "1234567890" }
        written_date    = (Get-Date).ToString("yyyy-MM-dd")
        diagnosis_codes = @("I21.4", "E78.5")
        status          = "Active"
    },
    @{
        rx_id           = "RX-" + (Get-Random -Minimum 100000 -Maximum 999999)
        patient_id      = $PATIENTS["Nomvula"]
        medication_name = "Metformin XR"
        generic_name    = "Metformin Extended-Release"
        strength        = "500mg"
        form            = "Tablet"
        directions      = "Take one tablet by mouth with dinner"
        quantity        = 30
        quantity_unit   = "tablets"
        days_supply     = 30
        refills         = 5
        prescriber      = @{ name = "Dr. Thandi Mbeki"; npi = "1234567890" }
        written_date    = (Get-Date).ToString("yyyy-MM-dd")
        diagnosis_codes = @("E11.65")
        status          = "Active"
    },
    @{
        rx_id           = "RX-" + (Get-Random -Minimum 100000 -Maximum 999999)
        patient_id      = $PATIENTS["Sipho"]
        medication_name = "Prednisone"
        generic_name    = "Prednisone"
        strength        = "40mg"
        form            = "Tablet"
        directions      = "Take 40mg daily x3 days, then 20mg x3 days, then 10mg x3 days, then stop"
        quantity        = 21
        quantity_unit   = "tablets"
        days_supply     = 9
        refills         = 0
        prescriber      = @{ name = "Dr. Thandi Mbeki"; npi = "1234567890" }
        written_date    = (Get-Date).ToString("yyyy-MM-dd")
        diagnosis_codes = @("J45.41")
        status          = "Active"
    },
    @{
        rx_id           = "RX-" + (Get-Random -Minimum 100000 -Maximum 999999)
        patient_id      = $PATIENTS["Lerato"]
        medication_name = "EpiPen"
        generic_name    = "Epinephrine Auto-Injector"
        strength        = "0.3mg"
        form            = "Auto-Injector"
        directions      = "Inject into outer thigh immediately for severe allergic reaction. Call emergency services."
        quantity        = 2
        quantity_unit   = "auto-injectors"
        days_supply     = 365
        refills         = 1
        prescriber      = @{ name = "Dr. Thandi Mbeki"; npi = "1234567890" }
        written_date    = (Get-Date).ToString("yyyy-MM-dd")
        diagnosis_codes = @("T78.09XA")
        status          = "Active"
    },
    @{
        rx_id           = "RX-" + (Get-Random -Minimum 100000 -Maximum 999999)
        patient_id      = $PATIENTS["Bongani"]
        medication_name = "Furosemide (Lasix)"
        generic_name    = "Furosemide"
        strength        = "80mg"
        form            = "Tablet"
        directions      = "Take one tablet by mouth twice daily"
        quantity        = 60
        quantity_unit   = "tablets"
        days_supply     = 30
        refills         = 5
        prescriber      = @{ name = "Dr. Thandi Mbeki"; npi = "1234567890" }
        written_date    = (Get-Date).ToString("yyyy-MM-dd")
        diagnosis_codes = @("I50.23")
        status          = "Active"
    }
)

foreach ($rx in $prescriptions) {
    Invoke-ApiCall -Endpoint "/api/clinical/e-prescription" -Headers $headers -Body $rx -Description "Rx: $($rx.medication_name) for $($rx.patient_id)"
}

# ============================================
# SECTION 7: NURSING CARE PLANS
# ============================================
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  SECTION 7: Creating Nursing Care Plans" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

$carePlans = @(
    @{
        patient_id    = $PATIENTS["Thabo"]
        diagnosis     = "Acute Myocardial Infarction / Post-Cardiac Arrest"
        goals         = @(
            "Maintain stable cardiac rhythm"
            "Achieve pain control (pain scale less than 3)"
            "Prevent complications of bed rest"
            "Patient will verbalize understanding of cardiac rehabilitation"
        )
        interventions = @(
            @{ intervention = "Continuous cardiac monitoring"; frequency = "Continuous"; responsible = "RN" }
            @{ intervention = "Assess chest pain q1h and PRN"; frequency = "Hourly"; responsible = "RN" }
            @{ intervention = "12-lead ECG if chest pain recurs"; frequency = "PRN"; responsible = "RN" }
            @{ intervention = "DVT prophylaxis - SCDs and Lovenox"; frequency = "Daily"; responsible = "RN" }
            @{ intervention = "Cardiac rehabilitation education"; frequency = "Daily"; responsible = "RN/PT" }
            @{ intervention = "Low sodium, heart-healthy diet"; frequency = "Each meal"; responsible = "RN/Dietary" }
            @{ intervention = "Strict Intake and Output monitoring"; frequency = "Q shift"; responsible = "RN" }
        )
        status        = "Active"
        created_by    = "Nurse Nomvula Nkosi"
    },
    @{
        patient_id    = $PATIENTS["Bongani"]
        diagnosis     = "Acute Decompensated Heart Failure"
        goals         = @(
            "Achieve euvolemic state (weight loss 3-4kg)"
            "SpO2 above 94 percent on room air"
            "Patient will demonstrate sodium restriction understanding"
            "Family will verbalize DNR/comfort care understanding"
        )
        interventions = @(
            @{ intervention = "Daily weights - same time, same scale"; frequency = "Daily 0600"; responsible = "RN" }
            @{ intervention = "Strict fluid restriction 1.5L/day"; frequency = "Continuous"; responsible = "RN" }
            @{ intervention = "Intake and Output q4h"; frequency = "Q4H"; responsible = "RN" }
            @{ intervention = "Assess lung sounds and edema"; frequency = "Q4H"; responsible = "RN" }
            @{ intervention = "O2 therapy to maintain SpO2 above 94 percent"; frequency = "Continuous"; responsible = "RN/RT" }
            @{ intervention = "Low sodium diet education"; frequency = "Daily"; responsible = "RN/Dietary" }
            @{ intervention = "Palliative care support"; frequency = "Daily"; responsible = "SW/Chaplain" }
            @{ intervention = "Family meetings for goals of care"; frequency = "PRN"; responsible = "MD/SW" }
        )
        status        = "Active"
        created_by    = "Nurse Nomvula Nkosi"
    }
)

foreach ($plan in $carePlans) {
    Invoke-ApiCall -Endpoint "/api/clinical/nursing-care-plan" -Headers $nurseHeaders -Body $plan -Description "Care Plan for $($plan.patient_id)"
}

# ============================================
# SECTION 8: MESSAGES
# ============================================
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  SECTION 8: Creating Messages" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

$messages = @(
    @{
        recipient_id = $PATIENTS["Thabo"]
        subject      = "Your Lab Results Are Available"
        content      = "Dear Mr. Mokoena,`n`nYour recent cardiac markers and blood tests are now available in your patient portal. Your care team has reviewed the results and Dr. Mbeki will discuss them with you during rounds today.`n`nIf you have any questions, please press your call button.`n`nBest regards,`nMediChain Care Team"
        priority     = "Normal"
        message_type = "Clinical"
    },
    @{
        recipient_id = $PATIENTS["Nomvula"]
        subject      = "Diabetes Management Follow-Up"
        content      = "Dear Ms. Dlamini,`n`nThank you for your visit today. As discussed, we've adjusted your diabetes medications to help improve your blood sugar control.`n`nPlease remember to:`n- Take Metformin XR with dinner`n- Check your blood sugar before meals`n- Follow up in 1 week for glucose check`n`nThe diabetes educator will call you tomorrow to schedule your education session.`n`nTake care,`nDr. Thandi Mbeki"
        priority     = "Normal"
        message_type = "Clinical"
    },
    @{
        recipient_id = $PATIENTS["Lerato"]
        subject      = "IMPORTANT: Your EpiPen Prescription"
        content      = "Dear Ms. Khumalo,`n`nFollowing your allergic reaction today, we have prescribed you an EpiPen. It is CRITICAL that you:`n`n1. Fill this prescription TODAY`n2. Carry the EpiPen with you at ALL times`n3. STRICTLY avoid all shellfish and shellfish-derived products`n4. Inform restaurants about your allergy when dining out`n`nWe have also referred you to an allergist for comprehensive testing.`n`nIf you experience any swelling, difficulty breathing, or hives, use the EpiPen immediately and call emergency services.`n`nStay safe,`nDr. Thandi Mbeki"
        priority     = "High"
        message_type = "Clinical"
    }
)

foreach ($msg in $messages) {
    Invoke-ApiCall -Endpoint "/api/messages/send" -Headers $headers -Body $msg -Description "Message to $($msg.recipient_id)"
}

# ============================================
# SECTION 9: APPOINTMENTS
# ============================================
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  SECTION 9: Creating Appointments" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

$appointments = @(
    @{
        patient_id       = $PATIENTS["Nomvula"]
        provider_id      = $DOCTOR_ID
        provider_name    = "Dr. Thandi Mbeki"
        appointment_type = "Follow-up"
        scheduled_at     = (Get-Date).AddDays(7).AddHours(9).ToString("o")
        duration_minutes = 30
        reason           = "Diabetes follow-up - glucose check"
        status           = "Scheduled"
        notes            = "Check fasting glucose, review medication compliance"
    },
    @{
        patient_id       = $PATIENTS["Thabo"]
        provider_id      = $DOCTOR_ID
        provider_name    = "Dr. Thandi Mbeki"
        appointment_type = "Cardiology Follow-up"
        scheduled_at     = (Get-Date).AddDays(14).AddHours(10).ToString("o")
        duration_minutes = 45
        reason           = "Post-MI follow-up, stress test results review"
        status           = "Scheduled"
        notes            = "Review cardiac rehab progress, stress test at 6 weeks"
    },
    @{
        patient_id       = $PATIENTS["Lerato"]
        provider_id      = $DOCTOR_ID
        provider_name    = "Dr. Thandi Mbeki"
        appointment_type = "Allergy Consult"
        scheduled_at     = (Get-Date).AddDays(21).AddHours(14).ToString("o")
        duration_minutes = 60
        reason           = "Allergist referral for comprehensive allergy testing"
        status           = "Scheduled"
        notes            = "Skin prick testing, IgE panel, carry EpiPen"
    },
    @{
        patient_id       = $PATIENTS["Sipho"]
        provider_id      = $DOCTOR_ID
        provider_name    = "Dr. Thandi Mbeki"
        appointment_type = "Follow-up"
        scheduled_at     = (Get-Date).AddDays(3).AddHours(11).ToString("o")
        duration_minutes = 20
        reason           = "Asthma exacerbation follow-up"
        status           = "Scheduled"
        notes            = "Pulmonary function test, review asthma action plan"
    }
)

foreach ($appt in $appointments) {
    Invoke-ApiCall -Endpoint "/api/appointments" -Headers $headers -Body $appt -Description "Appointment for $($appt.patient_id)"
}

# ============================================
# SUMMARY
# ============================================
Write-Host ""
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "               DEMO DATA SEEDING COMPLETE!                          " -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Results: $successCount successful, $errorCount warnings" -ForegroundColor White
Write-Host ""
Write-Host "  Data Created:" -ForegroundColor Cyan
Write-Host "    ✓ Vital Signs history (multiple readings per patient)" -ForegroundColor White
Write-Host "    ✓ Triage Assessments (ESI levels 2-3)" -ForegroundColor White
Write-Host "    ✓ SOAP Notes (comprehensive documentation)" -ForegroundColor White
Write-Host "    ✓ Code Blue record with ROSC (Thabo Mokoena)" -ForegroundColor White
Write-Host "    ✓ Lab Results (Cardiac, CBC, Diabetic, Lipid, CHF panels)" -ForegroundColor White
Write-Host "    ✓ E-Prescriptions (multiple medications)" -ForegroundColor White
Write-Host "    ✓ Nursing Care Plans (goals & interventions)" -ForegroundColor White
Write-Host "    ✓ Patient Messages" -ForegroundColor White
Write-Host "    ✓ Appointments (follow-ups scheduled)" -ForegroundColor White
Write-Host ""
Write-Host "  Demo Patients with Data:" -ForegroundColor Yellow
Write-Host "    • Thabo Mokoena (PAT-001-DEMO) - Cardiac/MI/Code Blue/ROSC" -ForegroundColor White
Write-Host "    • Nomvula Dlamini (PAT-002-DEMO) - Diabetic" -ForegroundColor White
Write-Host "    • Sipho Nkosi (PAT-003-DEMO) - Asthma exacerbation" -ForegroundColor White
Write-Host "    • Lerato Khumalo (PAT-004-DEMO) - Allergic reaction" -ForegroundColor White
Write-Host "    • Bongani Zulu (PAT-005-DEMO) - CHF/DNR" -ForegroundColor White
Write-Host ""
Write-Host "  Ready for Demo!" -ForegroundColor Green
Write-Host "    Doctor Portal: http://localhost:5173" -ForegroundColor White
Write-Host "    Patient App:   http://localhost:5174" -ForegroundColor White
Write-Host ""
