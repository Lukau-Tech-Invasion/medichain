# ADR-0003: Wallet signature authentication with JWT sessions

- **Status:** Accepted
- **Date:** 2026-02 (recorded retrospectively 2026-07-29)
- **Deciders:** Founder

## Context

Identity must work across independently-operated hospitals (see
[ADR-0006](0006-federated-deployment.md)), and must not require a central password
database that every facility has to trust. The system already has cryptographic
identity available: Substrate accounts.

## Options considered

**A. Username and password.** Familiar. Rejected: requires a credential store
someone must own, which is exactly the custody problem federation exists to avoid.

**B. Wallet signature on every request.** Strongest binding. Rejected alone: a
signature per request is costly and awkward for ordinary browser use.

**C. Wallet challenge-response to establish a session, then JWT.** *(chosen)*
Prove key possession once; carry a short-lived bearer token thereafter.

## Decision

Sr25519 challenge-response establishes identity. The server issues an HS256 JWT
(1 h access, 7 d refresh). TOTP (RFC-6238) provides step-up for ePHI access. A
legacy `X-User-Id` header path remains for demo mode.

## Consequences

**Gained.** No password database. Identity is portable across federated
instances. Signature verification is a middleware concern, centralised.

**Cost.** Key loss is account loss — no password reset exists, which for a health
system needs a recovery story that is not yet designed. JWT revocation before
expiry requires a denylist that does not exist yet.

**The dangerous part, called out explicitly.** In demo mode
(`IS_DEMO=true`, `REQUIRE_SIGNATURES=false`) `X-User-Id` is accepted **without
cryptographic verification** — anyone can claim any identity. The server logs a
warning on every request in that state. `validate_production_secrets()` fails the
boot in production mode with demo defaults. This path exists so the system can be
demonstrated without wallet tooling, and it must never be enabled anywhere real.

**Invariant that must hold regardless.** Roles are read from the server-side user
record, never from a client-supplied header. `X-User-Id` identifies; it does not
authorise.
