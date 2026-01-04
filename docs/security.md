# MediChain Security

© 2025 Trustware. All rights reserved.

## Overview

MediChain implements healthcare-grade security following NASA Power of 10 rules and Rust best practices for medical software. This document outlines the security architecture, access control mechanisms, and compliance considerations.

---

## Role-Based Access Control (RBAC)

### Implemented Roles

| Role | Code | Description |
|------|------|-------------|
| **Admin** | `Role::Admin` | System administrators with full access |
| **Doctor** | `Role::Doctor` | Licensed physicians |
| **Nurse** | `Role::Nurse` | Registered nurses |
| **LabTechnician** | `Role::LabTechnician` | Laboratory staff |
| **Pharmacist** | `Role::Pharmacist` | Licensed pharmacists |
| **Patient** | `Role::Patient` | End users (patients) |

### Permission Matrix

| Operation | Admin | Doctor | Nurse | LabTech | Pharmacist | Patient |
|-----------|-------|--------|-------|---------|------------|---------|
| Assign Roles | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Revoke Roles | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Register Patient | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Create Health Record | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Edit Health Record | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Add Medical Alert | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Read Any Record | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Read Own Record | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Grant Emergency Access | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |

### Role Helper Functions

```rust
// Check if user is a healthcare provider
pub fn is_healthcare_provider(account: &T::AccountId) -> bool {
    matches!(
        Self::user_roles(account),
        Some(Role::Admin) | Some(Role::Doctor) | Some(Role::Nurse) 
        | Some(Role::LabTechnician) | Some(Role::Pharmacist)
    )
}

// Check if user can edit medical records
pub fn can_edit_medical_records(account: &T::AccountId) -> bool {
    matches!(
        Self::user_roles(account),
        Some(Role::Admin) | Some(Role::Doctor) | Some(Role::Nurse)
    )
}

// Check if user is admin
pub fn is_admin(account: &T::AccountId) -> bool {
    matches!(Self::user_roles(account), Some(Role::Admin))
}
```

---

## Security Constraints

### Role Assignment
- Only Admin can assign roles
- Admin role cannot be assigned via extrinsic (must be set directly)
- Users cannot revoke their own role
- Role changes are logged on-chain

### Patient Registration
- Only healthcare providers can register patients
- Registration includes `registered_by` field for audit trail
- National ID hash is used to prevent duplicate registrations

### Medical Record Modifications
- Only Doctor, Nurse, or Admin can modify records
- All modifications include `last_modified_by` field
- Block number timestamps track when changes occurred

---

## Error Codes

| Error | Description |
|-------|-------------|
| `InsufficientRole` | Caller lacks required role for operation |
| `NotHealthcareProvider` | Operation requires healthcare provider status |
| `CannotAssignAdmin` | Admin role cannot be assigned via API |
| `RoleAlreadyAssigned` | User already has a role assigned |
| `NoRoleToRevoke` | User has no role to revoke |
| `CannotRevokeOwnRole` | Users cannot revoke their own role |

---

## API Security

### Authentication
- `X-User-Id` header required for protected endpoints
- User ID validated against stored users
- Role checked before operation execution

### Protected Endpoints

| Endpoint | Required Role |
|----------|---------------|
| `POST /api/register` | Healthcare Provider |
| `PUT /api/patients/{id}` | Doctor, Nurse, Admin |
| `POST /api/roles/assign` | Admin |
| `DELETE /api/roles/revoke` | Admin |
| `GET /api/users` | Admin |
| `GET /api/my-records` | Any (Patient: own only) |

---

## Audit Trail

Every sensitive operation is logged with:
- **Who**: Account that performed the action
- **What**: Type of operation
- **When**: Block number / timestamp
- **Target**: Affected patient or resource

### Tracked Fields
- `registered_by`: Healthcare provider who registered patient
- `last_modified_by`: Last person to modify record
- `created_at`: Block number of creation
- `updated_at`: Block number of last update

---

## Compliance Considerations

### HIPAA Alignment
- ✅ Access controls based on role
- ✅ Audit logs for all access
- ✅ Minimum necessary access principle
- ✅ Emergency access with time limits

### GDPR Alignment
- ✅ Data minimization (only essential fields on-chain)
- ✅ Right to access (patients can view own records)
- ✅ Accountability (audit trail)

---

## Emergency Access Protocol

1. Healthcare provider initiates emergency access
2. 15-minute time-limited access granted
3. Access logged immutably on blockchain
4. Patient notified of access (future: SMS/email)
5. Access automatically expires

---

## Future Security Enhancements

- [ ] Multi-signature for Admin operations
- [ ] Hardware security module (HSM) integration
- [ ] Biometric verification for high-risk operations
- [ ] Zero-knowledge proofs for privacy-preserving verification
- [ ] Decentralized identity (DID) integration
