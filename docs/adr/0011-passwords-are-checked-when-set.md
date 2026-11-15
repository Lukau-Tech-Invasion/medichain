# ADR-0011: Passwords are checked by the server when they are set

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Founder

## Context

Sign-in sends a proof of the password (PBKDF2-SHA512, then HKDF-SHA256,
`client/shared/src/auth/proof.ts`), never the password, and the server stores
Argon2id over that proof. Because the server never saw a password, it could not
judge one: the only strength rule was a 12-character check in the browser,
which any modified client could skip.

The owner's library summarises the OWASP Authentication Cheat Sheet
(`knowledge-base/sources/external/web-application-security-owasp.md`, lines
548-570): under 15 characters is weak without MFA, the maximum should be at
least 64, composition rules are rejected, and a breach check does the work that
composition rules only appeared to do. Two-factor is optional for most accounts
here, and judges and real users will choose their own passwords.

## Decision

1. **The password travels once, when it is set** — activation and recovery
   (`POST /api/auth/credentials/redeem`, field `password`) and change
   (`POST /api/auth/credentials/change`, field `new_password`; the current
   password is still proved, never sent). A request that sends only a proof is
   refused with `400 PASSWORD_REQUIRED`, so no client can skip the rules.
2. **The server checks it** (`api/src/password_policy.rs`): 15 to 128
   characters; not a common password or a decorated one (`Password2026!`,
   `P@ssw0rd`); not mostly a keyboard run or repetition; not built from the
   person's login ID or name; and not in Pwned Passwords, checked by
   k-anonymity (only five hex characters of a SHA-1 leave the host;
   `PASSWORD_BREACH_CHECK=pwned|off`, on by default outside demo mode). A
   refusal is `422` with a stable `PASSWORD_*` code and a sentence to show.
3. **The server derives the proof** exactly as the browser does
   (`medichain_crypto::auth_proof`, pinned to the browser's own test vectors),
   stores Argon2id over it, and zeroes the password. Sign-in is unchanged and
   still sends only the proof.
4. **The password is never stored or hashed fast anywhere else.** The
   idempotency middleware digests request bodies; for the change route it
   leaves the body out of the stored digest
   (`SECRET_BODY_ROUTES`), because an unsalted hash of a body holding a password
   is an offline-guessable hash of that password.

## Consequences

- Weak, common, breached and self-referential passwords are refused for every
  client, including the harnesses.
- The password crosses the network at set time, protected by TLS. That is the
  same exposure every password form on the web accepts; sign-in, which happens
  far more often, keeps the stronger property.
- If Pwned Passwords is unreachable the password is accepted on the local rules
  and the gap is logged: refusing every activation during an outage would lock
  out new staff.
- Existing passwords are not re-checked; the rules apply the next time one is
  set.
