# MediChain Secrets Rotation & Key Management

This document provides guidance on managing and rotating secrets within the MediChain ecosystem to ensure long-term security and compliance (HIPAA 2025 / POPIA).

## Critical Secrets

| Secret Name | Purpose | Rotation Frequency | Impact of Compromise |
|-------------|---------|-------------------|----------------------|
| `JWT_SECRET` | HS256 key for signing access/refresh tokens | 90 days | Attacker can forge user sessions |
| `ENCRYPTION_KEY` | Master key for IPFS document encryption | 1 year (or on breach) | Access to all encrypted ePHI |
| `AUDIT_SEAL_SIGNING_KEY` | Ed25519 seed (64 hex characters) that signs sealed audit batches | On personnel change or suspected exposure | Attacker who also controls the checkpoint sink can forge a consistent audit history |
| `DATABASE_URL` | PostgreSQL credentials | 180 days | full database access |
| `FCM_SERVICE_ACCOUNT` | Firebase Push notifications | 1 year | Spoofing notifications to patients |
| `AT_API_KEY` | Africa's Talking SMS gateway | On personnel change | SMS spend exhaustion |

## Rotation Procedures

### 1. JWT Secret Rotation

MediChain supports a seamless transition during JWT secret rotation:

1. Generate a new random 32-byte string.
2. Update the `JWT_SECRET` environment variable.
3. Restart the API service.
4. **Impact:** Existing users will be logged out and must re-authenticate. For production, consider implementing a multi-key validation middleware to support a "grace period".

### 2. Encryption Key Rotation

IPFS document encryption uses ChaCha20-Poly1305. 

*   **Current State:** Single master key defined in `ENCRYPTION_KEY`.
*   **Rotation Strategy:** 
    1. New uploads use the new key.
    2. Metadata must track the `key_id` or `version`.
    3. Old documents remain decryptable using the archived key (if tracked).
    4. Re-encryption of legacy data should be done as a background batch job.

### 3. Audit seal signing key

*   **Generate:** `openssl rand -hex 32`. Required outside demo mode; there is no default. Store it in the secret manager, never in `.env` files that are committed.
*   **Rotation:** every sealed batch records the id of the key that signed it, so a new key signs new batches while old batches stay verifiable — **keep the public key of every retired key** for as long as its batches must be verifiable.
*   **What custody buys:** the signature proves a batch came from the key holder; the write-once checkpoint sink (`AUDIT_CHECKPOINT_SINK`) proves it was not later rewritten. Neither is worth much without the other. See [`AUDIT_LOG.md`](AUDIT_LOG.md).

## Key Management Guidance

1. **Environment Variables:** In development, use `.env`. In production, use a secure secret manager (AWS Secrets Manager, HashiCorp Vault, or Azure Key Vault).
2. **No Hardcoding:** Never commit secrets to the repository. The `lint-no-secrets.sh` script runs in CI to prevent this.
3. **Least Privilege:** API database users should only have permissions for the `medichain` schema and specific tables.
4. **Audit Logs:** All secret access and rotation events should be recorded as audit events, which the sealed audit stream then batches, signs and exports (see [`AUDIT_LOG.md`](AUDIT_LOG.md)).
