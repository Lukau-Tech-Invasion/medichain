````markdown
# MediChain API Reference (generated summary)

Source: `api/src/main.rs` (routes scanned 2026-01-28)

Note: This is a concise reference. For full request/response shapes see `api/src/models` and `api/src/clinical.rs`.

## Health
- GET /health — Public health check
- GET /health/db — Database health (shows DB connection status)
- GET /api/health/detailed — Detailed system health (services, uptime)

## Authentication / Users
- POST /api/auth/challenge — Get authentication challenge (wallet)
- POST /api/auth/login — Login with signed challenge
- GET /api/auth/login/{address} — Login (GET) for frontend compatibility
- POST /api/auth/bootstrap — Bootstrap first admin (requires boot key)
- POST /api/auth/register — Register new user (Admin only)
- POST /api/auth/demo-login — Dev/demo login (dev mode only)
- GET /api/auth/me — Get current user info (requires auth)
- GET /api/auth/wallet/{address} — Lookup user by wallet (public-ish)

## RBAC / Staff
- POST /api/roles/assign — Assign role to wallet (Admin only)
- DELETE /api/roles/revoke — Revoke role (Admin only)
- GET /api/staff/all — List staff (Admin only)
- GET /api/providers — List healthcare providers (filterable)
- GET /api/users — List users
- GET /api/users/{wallet_address} — Get user by wallet
- PUT /api/users/{wallet_address} — Update user

## Patients & Records
- POST /api/register — Register a new patient (providers only)
- GET /api/patients — List patients (providers only)
- GET /api/patients/{patient_id} — Get patient (providers or self)
- PUT /api/patients/{patient_id} — Update patient (Doctor/Nurse/Admin)
- POST /api/patients/{patient_id}/emergency-contacts — Add emergency contact
- GET /api/my-records — Patient: get own records

## Emergency / NFC / QR
- POST /api/emergency-access — Emergency access request (providers, logged)
- POST /api/simulate-nfc-tap — Simulate NFC tap (dev/testing)
- POST /api/nfc/generate — Generate NFC card (production flow)
- POST /api/nfc/tap — NFC tap endpoint
- POST /api/nfc/verify-qr — Verify QR code for NFC tag
- GET /api/nfc/card/{patient_id} — Get NFC card info for patient
- POST /api/nfc/suspend — Suspend NFC card
- GET /api/nfc/cards — List NFC cards

## Access Logs / Audit
- GET /api/access/logs — List all access logs (providers only)
- GET /api/access-logs/{patient_id} — Patient-specific access logs (providers or patient)

## IPFS & File Storage
- GET /api/ipfs/health — IPFS health
- POST /api/records/upload — Upload encrypted medical record to IPFS (providers)
- POST /api/records/download — Download/decrypt record (patient or provider)
- GET /api/records/{patient_id} — List records for a patient

## Lab APIs
- POST /api/lab/submit — Submit lab request/sample
- GET /api/lab/pending — List pending labs
- GET /api/lab/submissions — List lab submissions
- GET /api/lab/submissions/{submission_id} — Lab submission detail
- POST /api/lab/submissions/{submission_id}/review — Review a submission
- POST /api/lab/review — Review records (bulk)
- GET /api/lab/patient/{patient_id} — Lab history for a patient

## Clinical Endpoints (examples)
The API exposes many clinical endpoints under `/api/clinical/*`. Examples:
- POST /api/clinical/triage — Submit triage assessment
- GET /api/clinical/triage/{assessment_id} — Get triage assessment
- GET /api/clinical/patient/{patient_id}/triage — Patient triage list
- POST /api/clinical/soap — Submit SOAP note
- GET /api/clinical/soap/{note_id} — Get SOAP note
- GET /api/clinical/patient/{patient_id}/soap — Patient SOAP notes
- POST /api/clinical/sample — Laboratory sample entry
- GET /api/clinical/sample/{patient_id} — Patient samples
- POST /api/clinical/gcs — Submit GCS
- GET /api/clinical/gcs/{assessment_id} — Get GCS
- POST /api/clinical/vitals — Submit vitals
- GET /api/clinical/patient/{patient_id}/vitals — Patient vitals
- GET /api/clinical/lab-panels — List lab panels
- GET /api/clinical/lab-panels/{panel_name} — Panel details

## Demo & Misc
- GET /api/demo — Demo project info
- POST /api/settings — Update settings (authenticated)

## Notes & Next Steps
- This file is a generated summary. For full request/response schemas, inspect `api/src/models`, `api/src/clinical.rs`, and `client/shared` type definitions.
- Recommended: run a small generator script to keep `docs/api.md` in sync with route macros.

````
# MediChain API

© 2025 Trustware. All rights reserved.

> Updated: 2026-01-28 — See `docs/PROJECT_STATUS_FOR_PRESENTATION.md` for current implementation notes and presentation summary.

## Overview

MediChain REST API provides secure access to patient identity, medical records, and access control functionality. All endpoints implement role-based access control (RBAC).

**Base URL:** `http://localhost:8080`

---

## Authentication

### Wallet-Based Blockchain Authentication

MediChain uses **wallet-based blockchain authentication** with SS58 addresses. Users authenticate via their blockchain wallets (Polkadot.js, Subwallet, etc.) rather than traditional username/password.

For API testing, the `X-User-Id` header accepts a user's wallet address (SS58 format):

```http
X-User-Id: 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
```

### User Registration

New users are registered on the blockchain with their wallet address and assigned a role:
- **Admin** - Full system access, user management
- **Doctor** - Patient registration, medical record access/edit
- **Nurse** - Patient registration, medical record access/edit
- **LabTechnician** - Lab results upload, limited record access
- **Pharmacist** - Prescription verification, medication records
- **Patient** - Read-only access to own records

> **Note:** Demo user IDs (e.g., `DOC-001`, `ADMIN-001`) are deprecated. Use wallet addresses for all authentication.

---

## Endpoints

### Health Check

#### `GET /api/health`

Returns API health status.

**Authentication:** None required

**Response:**
```json
{
  "status": "ok",
  "message": "MediChain API is running"
}
```

---

### Patient Registration

#### `POST /api/register`

Register a new patient with national ID.

**Authentication:** Healthcare Provider required

**Request Body:**
```json
{
  "full_name": "Jane Doe",
  "date_of_birth": "1990-01-15",
  "blood_type": "A+",
  "allergies": ["penicillin", "sulfa"],
  "chronic_conditions": ["asthma"],
  "id_type": "national_id",
  "id_hash": "SHA256_HASH_OF_ID_NUMBER"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Patient registered with blockchain verification",
  "patient_id": "PAT-001",
  "national_health_id": "MCHI-2026-XXXX-XXXX",
  "blockchain_tx": "0xabc123...",
  "registered_by": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
}
```

**Errors:**
- `403 Forbidden` - Caller is not a healthcare provider

---

### Patient Management

#### `PUT /api/patients/{id}`

Update patient information.

**Authentication:** Doctor, Nurse, or Admin required

**Path Parameters:**
- `id` - Patient ID (e.g., `PAT-001`)

**Request Body:**
```json
{
  "blood_type": "A+",
  "allergies": ["penicillin", "sulfa", "latex"],
  "chronic_conditions": ["asthma", "diabetes"]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Patient record updated",
  "patient_id": "PAT-001",
  "last_modified_by": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
}
```

**Errors:**
- `403 Forbidden` - Caller cannot edit medical records
- `404 Not Found` - Patient not found

---

### Patient Records

#### `GET /api/my-records`

Get records for the authenticated patient.

**Authentication:** Patient role required

**Response (200 OK):**
```json
{
  "patient_id": "PAT-001-DEMO",
  "records": [
    {
      "type": "visit",
      "date": "2026-01-04",
      "provider": "Dr. Smith",
      "notes": "Annual checkup"
    }
  ]
}
```

**Errors:**
- `403 Forbidden` - Caller is not a patient

---

### Emergency Access

#### `POST /api/emergency-access`

Request emergency access to patient records.

**Authentication:** Healthcare Provider required

**Request Body:**
```json
{
  "patient_id": "PAT-001",
  "reason": "Unconscious patient in ER"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Emergency access granted for 15 minutes",
  "patient_id": "PAT-001",
  "access_expires": "2026-01-04T14:15:00Z",
  "granted_by": "SYSTEM",
  "granted_to": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
}
```

---

### NFC Simulation

#### `POST /api/simulate-nfc-tap`

Simulate NFC card tap for patient identification.

**Authentication:** None required

**Request Body:**
```json
{
  "nfc_uid": "04:A1:B2:C3:D4:E5:F6"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "NFC card recognized",
  "patient_id": "PAT-001",
  "national_health_id": "MCHI-2026-XXXX-XXXX"
}
```

---

### Access Logs

#### `GET /api/access-logs/{patient_id}`

Get access logs for a patient.

**Authentication:** Healthcare Provider or Patient (own records only)

**Path Parameters:**
- `patient_id` - Patient ID (e.g., `PAT-001`)

**Response (200 OK):**
```json
{
  "patient_id": "PAT-001",
  "logs": [
    {
      "timestamp": "2026-01-04T13:00:00Z",
      "accessed_by": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
      "access_type": "view",
      "reason": "Scheduled appointment"
    }
  ]
}
```

---

### Patient Lookup

#### `GET /api/patients/{id}`

Get patient information by ID.

**Authentication:** Healthcare Provider required

**Path Parameters:**
- `id` - Patient ID (e.g., `PAT-001`)

**Response (200 OK):**
```json
{
  "patient_id": "PAT-001",
  "full_name": "Jane Doe",
  "date_of_birth": "1990-01-15",
  "blood_type": "A+",
  "allergies": ["penicillin"],
  "chronic_conditions": ["asthma"],
  "national_health_id": "MCHI-2026-XXXX-XXXX"
}
```

---

## Role Management

### Assign Role

#### `POST /api/roles/assign`

Assign a role to a user.

**Authentication:** Admin required

**Request Body:**
```json
{
  "user_id": "USER-002",
  "role": "Doctor"
}
```

**Valid Roles:** `Doctor`, `Nurse`, `LabTechnician`, `Pharmacist`, `Patient`

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Role assigned successfully",
  "user_id": "USER-002",
  "role": "Doctor"
}
```

**Errors:**
- `400 Bad Request` - Cannot assign Admin role via API
- `403 Forbidden` - Caller is not an admin

---

### Revoke Role

#### `DELETE /api/roles/revoke`

Revoke a user's role.

**Authentication:** Admin required

**Request Body:**
```json
{
  "user_id": "USER-002"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Role revoked successfully",
  "user_id": "USER-002"
}
```

**Errors:**
- `400 Bad Request` - Cannot revoke own role
- `403 Forbidden` - Caller is not an admin

---

### List Users

#### `GET /api/users`

List all users and their roles.

**Authentication:** Admin required

**Response (200 OK):**
```json
{
  "users": [
    {
      "user_id": "5GNJqTPyNqANBkUVMN1LPPrxXnFouWXoe2wNSmmEoLctxiZY",
      "username": "admin_wallet",
      "role": "Admin"
    },
    {
      "user_id": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
      "username": "dr_smith_wallet",
      "role": "Doctor"
    }
  ]
}
```

---

### Demo Endpoint

#### `GET /api/demo`

Get demo information and available endpoints.

**Authentication:** None required

**Response (200 OK):**
```json
{
  "message": "MediChain API Demo",
  "version": "0.1.0",
  "available_endpoints": [
    "/api/health",
    "/api/register",
    "/api/patients/{id}",
    "/api/my-records",
    "/api/emergency-access",
    "/api/simulate-nfc-tap",
    "/api/access-logs/{patient_id}",
    "/api/roles/assign",
    "/api/roles/revoke",
    "/api/users",
    "/api/demo",
    "/api/ipfs/health",
    "/api/records/upload",
    "/api/records/download",
    "/api/records/{patient_id}"
  ]
}
```

---

## Canonical API Notes (Implementation Truth)

This section documents implementation details discovered during a repo audit to keep `docs/api.md` aligned with the source.

- Base URL: `http://localhost:8080` (API server default in `api/`)
- The server expects wallet-based authentication via the `X-User-Id` header (SS58 address). See `docs/DEV_AUTH.md` for developer guidance.
- There are two health endpoints present in code: `/api/health` and `/api/health/detailed` (use `/api/health/detailed` for richer diagnostics).
- Some client call-sites use a legacy route `/api/access/logs` while canonical server handlers use `/api/access-logs/{patient_id}`; both are supported by the API to preserve backward compatibility.
- Demo and seeding endpoints exist (`/api/demo`, `/api/auth/demo-login`) and are used by client apps in development. These endpoints are gated to development in server configuration but may be enabled by environment or seed scripts.

### Important Headers

- `X-User-Id` (required for authenticated requests): SS58 wallet address of the caller.
- `X-Provider-Role` (recommended for provider-scoped requests): role name such as `Doctor`, `Nurse`, `LabTechnician`, `Pharmacist`.
- `X-Health-Id` (optional): patient health ID used by client apps when making patient-scoped requests.

### Demo & Seed Guidance (short)

- Demo users are provided in `api/data/demo_users.json` and seeded by `api` startup or seed scripts. Use `docs/DEV_AUTH.md` for step-by-step developer guidance to enable demo seeds safely.

---

*This file was augmented by the docs-sync audit on 2026-01-28.*

---

## IPFS Medical Records

Medical documents are stored on IPFS with end-to-end encryption using ChaCha20-Poly1305.

### IPFS Health Check

#### `GET /api/ipfs/health`

Check IPFS daemon connection status.

**Authentication:** None required

**Response (200 OK):**
```json
{
  "ipfs_connected": true,
  "api_url": "http://localhost:5001",
  "gateway_url": "http://localhost:8080"
}
```

---

### Upload Medical Record

#### `POST /api/records/upload`

Upload an encrypted medical document to IPFS.

**Authentication:** Doctor, Nurse, or Admin required

**Request Body:**
```json
{
  "patient_id": "PAT-001-DEMO",
  "content_base64": "JVBERi0xLjQKJeLj...",
  "filename": "lab_results_2026-01-04.pdf",
  "content_type": "application/pdf",
  "record_type": "lab_result"
}
```

**Record Types:** `lab_result`, `imaging`, `prescription`, `consultation`, `discharge_summary`, `vaccination`, `other`

**Response (201 Created):**
```json
{
  "success": true,
  "ipfs_hash": "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
  "metadata_hash": "QmZK3LwJ2K4GpQk8Q9K7LjM8N9P2Q4R5S6T7U8V9W0X1Y2",
  "record_reference": {
    "content_hash": "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
    "metadata_hash": "QmZK3LwJ2K4GpQk8Q9K7LjM8N9P2Q4R5S6T7U8V9W0X1Y2",
    "record_type": "lab_result",
    "uploaded_at": 1704380400,
    "content_checksum": "a1b2c3d4e5f6..."
  },
  "message": "Medical record uploaded and encrypted successfully"
}
```

**Errors:**
- `400 Bad Request` - Invalid base64 content
- `403 Forbidden` - Caller cannot upload medical records
- `404 Not Found` - Patient not found
- `500 Internal Server Error` - IPFS upload failed

---

### Download Medical Record

#### `POST /api/records/download`

Download and decrypt a medical document from IPFS.

**Authentication:** Healthcare Provider, or Patient (own records only)

**Request Body:**
```json
{
  "content_hash": "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
  "metadata_hash": "QmZK3LwJ2K4GpQk8Q9K7LjM8N9P2Q4R5S6T7U8V9W0X1Y2"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "content_base64": "JVBERi0xLjQKJeLj...",
  "filename": "lab_results_2026-01-04.pdf",
  "content_type": "application/pdf",
  "record_type": "lab_result",
  "uploaded_by": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
  "uploaded_at": 1704380400
}
```

**Errors:**
- `403 Forbidden` - Patient can only download own records
- `404 Not Found` - Record not found on IPFS
- `500 Internal Server Error` - IPFS download or decryption failed

---

### List Patient Records

#### `GET /api/records/{patient_id}`

List all medical record references for a patient.

**Authentication:** Healthcare Provider, or Patient (own records only)

**Path Parameters:**
- `patient_id` - Patient ID (e.g., `PAT-001-DEMO`)

**Response (200 OK):**
```json
{
  "patient_id": "PAT-001-DEMO",
  "records": [
    {
      "content_hash": "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
      "metadata_hash": "QmZK3LwJ2K4GpQk8Q9K7LjM8N9P2Q4R5S6T7U8V9W0X1Y2",
      "record_type": "lab_result",
      "uploaded_at": 1704380400,
      "content_checksum": "a1b2c3d4e5f6..."
    }
  ],
  "total": 1
}
```

**Errors:**
- `403 Forbidden` - Patient can only view own records

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Error message description",
  "code": "ERROR_CODE"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 500 | Internal Server Error |

### Common Error Codes

| Code | Description |
|------|-------------|
| `INSUFFICIENT_ROLE` | User lacks required role |
| `NOT_HEALTHCARE_PROVIDER` | Healthcare provider role required |
| `PATIENT_NOT_FOUND` | Requested patient does not exist |
| `CANNOT_ASSIGN_ADMIN` | Admin role cannot be assigned via API |
| `CANNOT_REVOKE_OWN_ROLE` | Users cannot revoke their own role |
| `IPFS_ERROR` | IPFS upload or download failed |
| `RECORD_NOT_FOUND` | Medical record not found on IPFS |
| `ACCESS_DENIED` | Patient attempting to access another's records |
| `INVALID_CONTENT` | Invalid base64 content in upload |

---

## Rate Limiting

- **Default:** 100 requests per minute per IP
- **Authenticated:** 500 requests per minute per user
- **Emergency Access:** No rate limiting

---

## Clinical Documentation Endpoints (150+)

MediChain includes comprehensive clinical documentation endpoints organized into 33 implementation phases. All endpoints are located in `clinical_endpoints.rs`.

### Endpoint Categories

| Category | Endpoints | Description |
|----------|-----------|-------------|
| **ESI Triage** | 6 | Emergency Severity Index assessments |
| **SOAP Notes** | 6 | Subjective/Objective/Assessment/Plan notes |
| **GCS & Neuro** | 6 | Glasgow Coma Scale, neurological assessments |
| **Vital Signs** | 6 | Vital signs flowsheets, readings |
| **Code Blue** | 6 | Cardiac arrest documentation |
| **Trauma** | 6 | Trauma assessments and protocols |
| **Stroke** | 6 | Stroke assessments (NIHSS, RACE) |
| **Cardiac** | 6 | Cardiac emergency documentation |
| **Burns** | 6 | Burn assessments and treatment |
| **Pediatric** | 6 | Pediatric-specific assessments |
| **Obstetric** | 6 | OB emergency documentation |
| **Psychiatric** | 6 | Psychiatric assessments |
| **Toxicology** | 6 | Poisoning and overdose |
| **MCI** | 6 | Mass casualty incident (START triage) |
| **Nursing** | 12 | MAR, I/O records, care plans |
| **Lab** | 12 | Specimens, QC, chain of custody |
| **Procedures** | 12 | Intubation, laceration repair, splints |
| **Discharge** | 6 | Discharge planning and orders |

### Example Clinical Endpoint

#### `POST /api/clinical/esi-triage`

Create ESI triage assessment.

**Authentication:** Healthcare Provider required

**Request Body:**
```json
{
  "patient_id": "PAT-001",
  "esi_level": 2,
  "chief_complaint": "Chest pain",
  "vital_signs": {
    "heart_rate": 110,
    "blood_pressure_systolic": 90,
    "blood_pressure_diastolic": 60,
    "respiratory_rate": 22,
    "temperature": 37.2,
    "oxygen_saturation": 94
  }
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "assessment_id": "ESI-001-20260113",
  "esi_level": 2,
  "color_code": "orange"
}
```

---

## HL7 FHIR R4 API

MediChain implements 10 HL7 FHIR R4 resources for healthcare interoperability.

### FHIR Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/fhir/r4/Patient/{id}` | Patient demographics |
| GET | `/api/fhir/r4/AllergyIntolerance?patient={id}` | Patient allergies |
| GET | `/api/fhir/r4/MedicationStatement?patient={id}` | Current medications |
| GET | `/api/fhir/r4/Condition?patient={id}` | Active conditions |
| GET | `/api/fhir/r4/Observation?patient={id}` | Vital signs, lab results |
| GET | `/api/fhir/r4/Encounter?patient={id}` | Visit encounters |
| GET | `/api/fhir/r4/DiagnosticReport?patient={id}` | Lab/imaging reports |
| GET | `/api/fhir/r4/Procedure?patient={id}` | Clinical procedures |
| GET | `/api/fhir/r4/Immunization?patient={id}` | Vaccination records |
| GET | `/api/fhir/r4/metadata` | CapabilityStatement |

### FHIR Response Format

All FHIR endpoints return standard FHIR R4 JSON with `application/fhir+json` content type.

**Example Response:**
```json
{
  "resourceType": "Patient",
  "id": "PAT-001",
  "meta": {
    "versionId": "1",
    "lastUpdated": "2026-01-13T10:00:00Z"
  },
  "identifier": [
    {
      "system": "urn:medichain:national-health-id",
      "value": "MCHI-2026-XXXX-XXXX"
    }
  ],
  "name": [
    {
      "family": "Okonkwo",
      "given": ["Chidi"]
    }
  ]
}
```

---

## Insurance Verification API

### Verify Insurance

#### `POST /api/insurance/verify`

Verify patient insurance coverage.

**Authentication:** Healthcare Provider required

**Request Body:**
```json
{
  "patient_id": "PAT-001",
  "policy_number": "INS-123456",
  "provider_code": "NHIS"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "verified": true,
  "coverage_status": "active",
  "coverage_type": "comprehensive",
  "valid_until": "2026-12-31"
}
```

### Check Eligibility

#### `POST /api/insurance/eligibility`

Check service eligibility for a patient.

**Authentication:** Healthcare Provider required

**Request Body:**
```json
{
  "patient_id": "PAT-001",
  "service_code": "SURGERY-001"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "eligible": true,
  "pre_authorization_required": true,
  "copay_amount": 500
}
```

---

## Versioning

The API uses URL versioning. Current version: **v1**

Future versions will be available at `/api/v2/...`
