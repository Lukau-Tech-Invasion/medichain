# MediChain Demo Setup Guide

This guide helps you set up demo users for recording the hackathon demo video.

## Quick Start

### 1. Start the API Server

**Windows (PowerShell):**
```powershell
cd scripts
.\start-server.bat
```

This opens a new window running the API server. Keep it running.

### 2. Create Demo Users

**Windows (PowerShell):**
```powershell
cd scripts
powershell -ExecutionPolicy Bypass -File .\create-demo-users.ps1
```

**WSL/Linux:**
```bash
cd scripts
bash create-demo-users.sh
```

## Demo Accounts

### Healthcare Staff (Pre-configured)

| User ID | Name | Role | Specialization |
|---------|------|------|----------------|
| `ADMIN-001` | System Administrator | Admin | System Management |
| `DOC-001` | Dr. Oluwaseun Adebayo | Doctor | Cardiologist |
| `NURSE-001` | Nurse Amina Yusuf | Nurse | ICU |
| `LAB-001` | Kwame Asante | Lab Technician | Clinical Lab |
| `PHARMA-001` | Zainab Mohammed | Pharmacist | Pharmacy |

### Demo Patients (Created by Script)

| Patient | Condition Profile | Key Features |
|---------|-------------------|--------------|
| **Adaeze Nwosu** | Diabetic (Type 2) | Multiple allergies (Penicillin, Sulfa, Latex), 3 chronic conditions |
| **Emeka Okafor** | Cardiac (CHF) | **DNR Order active**, elderly (76), on Warfarin |
| **Aisha Bello** | Pregnant (32 weeks) | Gestational diabetes, on insulin |
| **Oluwaseyi Adeyemi** | Pediatric (7 years) | **5 severe allergies** (Peanuts, nuts, eggs, milk, bee stings), carries EpiPen |
| **Chidinma Eze** | Mental Health | Bipolar, anxiety, on psychiatric medications |

Plus **12 South African patients** automatically created by the server with various conditions.

## How to Log In (Frontend)

### Doctor Portal (http://localhost:5173)
1. Enter any staff User ID: `DOC-001`, `NURSE-001`, `LAB-001`, etc.
2. Click "Login"
3. Access patient records, create clinical notes, etc.

### Patient App (http://localhost:5174)
1. Get a patient ID from the API: `curl http://localhost:8080/api/patients -H 'X-User-Id: DOC-001'`
2. Use a patient ID like `PAT-SA-001` or `PAT-9fea3920`
3. View own medical records (read-only)

## Demo Scenarios

### Scenario 1: Emergency Access (NFC Tap)
1. Login as `DOC-001`
2. Simulate NFC tap for patient `PAT-SA-001` (Thabo Nkosi - severe Penicillin allergy)
3. Show emergency info display with allergy warnings

### Scenario 2: DNR Patient Alert
1. Search for patient Emeka Okafor
2. Show DNR status prominently displayed
3. Demonstrate critical information visibility

### Scenario 3: Pediatric Allergy Alert
1. Open Oluwaseyi Adeyemi's record
2. Show 5 severe allergies with EpiPen requirement
3. Demonstrate parent contact information

### Scenario 4: Clinical Documentation
1. Login as `DOC-001`
2. Create a SOAP note for any patient
3. Add vital signs
4. Submit lab results (approval workflow)

### Scenario 5: Role-Based Access
1. Show what `DOC-001` can see (full access)
2. Compare with `LAB-001` (limited to lab functions)
3. Show patient read-only access

## API Quick Reference

```bash
# Health check
curl http://localhost:8080/health

# List all patients (as doctor)
curl http://localhost:8080/api/patients -H 'X-User-Id: DOC-001'

# Get specific patient
curl http://localhost:8080/api/patients/PAT-SA-001 -H 'X-User-Id: DOC-001'

# Emergency access (NFC simulation)
curl -X POST http://localhost:8080/api/emergency-access \
  -H 'Content-Type: application/json' \
  -H 'X-User-Id: DOC-001' \
  -d '{"patient_id": "PAT-SA-001", "reason": "Unconscious patient"}'

# View access logs
curl http://localhost:8080/api/access-logs/PAT-SA-001 -H 'X-User-Id: DOC-001'
```

## Server Ports

| Service | Port | URL |
|---------|------|-----|
| API Server | 8080 | http://localhost:8080 |
| Doctor Portal | 5173 | http://localhost:5173 |
| Patient App | 5174 | http://localhost:5174 |

## Troubleshooting

### "Server not running" error
Run `.\start-server.bat` first and wait for the startup banner.

### "User not found" error  
Make sure you're using valid User IDs: `ADMIN-001`, `DOC-001`, `NURSE-001`, `LAB-001`, `PHARMA-001`

### PowerShell execution policy error
Run: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

### WSL command not found
The API binary is compiled for Linux. Use WSL to run it:
```powershell
wsl bash -c "./target/release/medichain-api"
```
