
# API Design for MediChain

---

## Resource Model

Think in **resources**, not actions. URLs are nouns; HTTP verbs are verbs.

```
GET    /api/v1/patients/me                   ← my profile
PATCH  /api/v1/patients/me                   ← update mutable fields
GET    /api/v1/patients/me/consents          ← my granted consents
POST   /api/v1/patients/me/consents          ← grant a new consent
DELETE /api/v1/patients/me/consents/{id}     ← revoke
GET    /api/v1/patients/me/access-log        ← who read my record
GET    /api/v1/doctors/{id}                  ← doctor public profile
POST   /api/v1/emergency/fetch               ← paramedic redeems token
POST   /api/v1/cards/issue                   ← issue new NFC card (auth: patient)
```

**Always version in the URL path** (`/v1/`). Header versioning is clever and breaks
caches, debugging, and tooling. Path versioning is boring and works.

---

## Authentication Layers

| Caller          | Mechanism                                             |
|-----------------|-------------------------------------------------------|
| Doctor portal   | JWT + verified credential (issued by admin flow)      |
| Paramedic PWA   | JWT + verified employer relationship                  |
| Emergency redeem| Capability token (signed by patient) + paramedic JWT  |
| Backend → chain | Server keypair (limited to non-PHI, audit-log writes) |

---

## Idempotency for Consequential Writes

```
POST /api/v1/patients/me/consents
Headers:
  Idempotency-Key: 7c8d3e2a-b4f1-49a6-...
Body:
  { grantee_id: "3f2a...", scope: "records", duration_days: 90 }
```

Backend behaviour:
1. Check `Idempotency-Key` against a Redis cache (24h TTL)
2. If found: return the stored response (whatever it was — success or specific error)
3. If not found: process the request, store the response under the key, return it

Now the client can safely retry on network failure without granting consent twice.

---

## Error Envelope (one shape for all errors)

```json
{
  "error": {
    "code": "consent_already_exists",
    "message": "A consent with this scope already exists for this doctor.",
    "details": {
      "existing_consent_id": "cons_abc123",
      "expires_at": "2026-12-01T00:00:00Z"
    }
  }
}
```

- `code` is a stable machine-readable string. Don't change codes once shipped.
- `message` is a human-friendly default — UI can display it directly or override.
- `details` is optional, structured, situation-specific.

HTTP status codes: use them honestly. 400 = client sent bad input. 401 = no auth. 403 =
authed but not allowed. 404 = resource doesn't exist (or you don't have visibility).
409 = conflict. 422 = validation failed. 429 = rate limited. 5xx = our fault, never
client's fault.

---

## Pagination

**Cursor-based**, not offset-based. Offset breaks under inserts and is slow at scale.

```
GET /api/v1/patients/me/access-log?limit=50&cursor=eyJ0aW1lIjoiMjAyNi0w...
→ {
    "items": [...],
    "next_cursor": "eyJ0aW1lI..."     // null if no more
  }
```

Cursor is an opaque base64-encoded JSON of `{ created_at, id }` (don't expose the shape).

---

## WebSocket Contract

For the patient app's "live" view of access events.

```
Client → Server:
  { "type": "subscribe", "channel": "access-log" }

Server → Client:
  { "type": "access-log:event", "event": { ...AccessLogEntry } }
  { "type": "ping" }       ← every 30s

Client → Server:
  { "type": "pong" }
```

Always have a discriminator field (`type`). Always have heartbeats. Always reconnect
with exponential backoff on the client.

---

## Schema Discipline

Use a typed schema definition for ALL request/response bodies. In Rust:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct GrantConsentRequest {
    pub grantee: String,           // base58 pubkey
    pub scope: u32,                // bitmap
    #[serde(default = "default_duration")]
    pub duration_days: u32,
}

#[derive(Debug, Serialize)]
pub struct ConsentResponse {
    pub id: String,
    pub grantee: String,
    pub scope: u32,
    pub granted_at: i64,
    pub expires_at: i64,
    pub on_chain_signature: String,
}

fn default_duration() -> u32 { 90 }
```

Generate an OpenAPI doc from these (e.g. `utoipa` for axum). The frontend then generates
its TS client from the OpenAPI doc → end-to-end type safety, no drift.

---

## Rate Limiting

| Endpoint                       | Limit                          |
|--------------------------------|--------------------------------|
| `/auth/challenge`              | 10/min per IP                  |
| `/auth/verify`                 | 5/min per IP                   |
| `/emergency/fetch`             | 30/min per paramedic JWT       |
| `/patients/me/*` writes        | 60/min per patient JWT         |
| Anything chain-mutating        | Backend SOL fee budget cap/day |

Return `429` with `Retry-After: <seconds>` and `X-RateLimit-Remaining: 0`.

---

## Anti-patterns

- ❌ Verbs in URLs (`/api/getPatient`) — use `GET /patients/{id}`
- ❌ Returning HTML errors from a JSON API
- ❌ Different error shapes for different endpoints
- ❌ Putting auth tokens in URL query strings (logged in proxies)
- ❌ Returning sensitive data on 404 ("user X has 5 records but you can't see them")
- ❌ "Magic" v0 routes that bypass auth for "convenience"
- ❌ POST that returns 200 + error in body — use proper status codes
