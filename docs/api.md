# MediChain API

© 2025 Trustware. All rights reserved.

## Overview

MediChain REST API provides secure access to patient identity, medical records, and access control functionality. All endpoints implement role-based access control (RBAC).

**Base URL:** `http://localhost:8080`

---

## Authentication

### Header-Based Authentication

All protected endpoints require the `X-User-Id` header:

```http
X-User-Id: ADMIN-001
```

### Demo Users

| User ID | Username | Role | Description |
|---------|----------|------|-------------|
| `ADMIN-001` | admin | Admin | System administrator |
| `DOC-001` | dr.smith | Doctor | Licensed physician |
| `NURSE-001` | nurse.johnson | Nurse | Registered nurse |
| `LAB-001` | lab.tech | LabTechnician | Laboratory staff |
| `PAT-001-DEMO` | john.doe | Patient | Demo patient |

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
  "registered_by": "DOC-001"
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
  "last_modified_by": "DOC-001"
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
  "granted_to": "DOC-001"
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
      "accessed_by": "DOC-001",
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
      "user_id": "ADMIN-001",
      "username": "admin",
      "role": "Admin"
    },
    {
      "user_id": "DOC-001",
      "username": "dr.smith",
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
  "uploaded_by": "DOC-001",
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

## Versioning

The API uses URL versioning. Current version: **v1**

Future versions will be available at `/api/v2/...`
