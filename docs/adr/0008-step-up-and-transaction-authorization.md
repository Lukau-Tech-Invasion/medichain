# ADR-0008: Step-up and exact transaction authorization

- **Status:** Accepted
- **Date:** 2026-08-25 (revised 2026-10-18)
- **Deciders:** Founder

## Context

A valid Bearer token identifies a signed-in person through the verified `sub`
claim. That is enough for ordinary work and not enough for everything:

1. ordinary authenticated activity;
2. recent stronger authentication for privileged operating contexts (role
   management, guardianship, retention administration); and
3. explicit authorization of one exact consequential action (deciding who may
   read a record, changing consent, changing someone's role or account status,
   ending another person's emergency access, deciding or executing retention).

None of these may be downgradable to a weaker mechanism.

## Decision 1 — Session identity

Access tokens carry an opaque `sid` (one login session) beside `sub` (the
person) and `jti` (one token). The database is authoritative for revocation:
revoking a login session revokes every token and refresh generation beneath it,
and no confirmation can be completed under a revoked session.

## Decision 2 — Assurance classes

### Class A — Ordinary authenticated operations

A valid session. Includes a responder ending their own emergency grant.

### Class B — Session step-up

A fresh TOTP code elevates the session for a short window. Required for
privileged contexts. Demo mode exempts it; production never does.

### Class C — Exact transaction authorization

The server answers a gated mutation with `428 TRANSACTION_AUTHORIZATION_REQUIRED`
and names what must be confirmed. The client requests a challenge bound to:

* the session (`sid`);
* the action, HTTP method and path;
* the SHA-256 of the exact transmitted request bytes;
* the resource id and its expected state;
* the request's idempotency key.

The person completes it with a fresh TOTP code, or the current password proof
when no TOTP is enrolled. The verified authorization is single-use and expires;
the client resends the same bytes under the same idempotency key with
`X-Transaction-Authorization`. State checks run before the gate, so a request
that could not succeed is refused without asking for confirmation.

### Class E — Emergency / break-glass access

Initial emergency access to a patient's capsule is never gated by Class B or C:
a paramedic cannot wait for a code. It is bound to an approved managed device,
time-limited, reasoned, and reviewed afterwards by an administrator.

## Decision 3 — Verification order

Authenticate the session; check the caller's role and relationship to the
resource; check the resource's current state; then require the confirmation.
A failed confirmation is recorded as a security event.

## Consequences

**Gained.** A stolen session token alone cannot approve access, change consent
or change anyone's authority. A confirmation cannot be replayed onto a
different request, resource state or session.

**Cost.** Each gated action costs the person a confirmation, and every caller
(portals, test harnesses, scripts) must handle the `428` exchange. The
in-memory development backend has no store for authorizations and does not
enforce Class C; the API says so at startup.

## Implementation status (2026-10-18)

Phase 1 is in place: access decisions, consent sign and revoke, role assign and
revoke, account status changes, ending another person's emergency grant, and
retention decisions and execution. Phase 2 — confirmation bound to an enrolled
device — is not implemented.
