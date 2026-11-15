# Security hardening pass — 2026-10-19

Owner's request: research how applications are attacked and make sure MediChain
is protected, and that if it is attacked nothing is lost and nobody can break in.
Nothing can be proven unbreakable; this pass checks every OWASP Top 10:2025
category against the code and the live deployment, fixes what it found, and
names what remains.

**Sources.** OWASP Top 10:2025, Injection/XSS/CSRF/CSP cheat sheets and the
Authentication Cheat Sheet as summarised in the owner's library
(`knowledge-base/sources/external/web-application-security-owasp.md`, §1–§9);
Anderson, *Security Engineering* 3e (threat model ch. 2, access control ch. 6),
routed by the library's `ROUTING.md`. Current healthcare attack reporting
(vendor sources, 2024–2026, treat as directional): credential stuffing that
rotates IPs and stays under per-IP limits, and ransomware entering through
stolen credentials without MFA ([accountablehq](https://www.accountablehq.com/post/healthcare-credential-stuffing-what-it-is-why-it-matters-and-how-to-prevent-it),
[F5](https://www.f5.com/company/blog/ransomware-in-healthcare-the-application-threat-vector),
[Acronis](https://www.acronis.com/en/blog/posts/health-care-cybersecurity-threats-msps-should-watch-in-2026/)).
Broken object-level authorization is #1 on the OWASP API Security list.

## Findings and fixes

| OWASP 2025 | Check | Result |
| --- | --- | --- |
| A01 Broken access control | Every clinical read goes through per-handler authority (grant, care relationship, break-glass); `cross-role-qualification.ts` probes wrong-patient and wrong-role access | Judge-account probe on QA: a patient reading another patient's record is refused (403); clinicians reach charts only under a patient grant. |
| A02 Misconfiguration | Headers and CORS on the live site | **Fixed.** The portals shipped with HSTS only. Now: CSP (below), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, a restrictive `Permissions-Policy`, no `Server` header. Production refuses demo login (403), and CORS requires explicit HTTPS origins. |
| A02 | Scheme behind the TLS proxy | **Fixed — sign-in was broken on AWS.** nginx replaced Caddy's `X-Forwarded-Proto` with `http`, so the API refused sign-in, activation and bootstrap with `ENCRYPTION_REQUIRED`. |
| A03 Supply chain | `npm audit`, `cargo audit` | **Fixed most.** npm: 7 high → 2 moderate (React Router 6.30.6; the unused `firebase` umbrella and its gRPC replaced by `@firebase/app` + `@firebase/messaging`). Rust: 8 → 3 (`rustls` 0.23.46; Prometheus 0.14 off vulnerable protobuf). ECR scans every image on push; tags are immutable. |
| A04 Cryptographic failures | Storage and transport | Argon2id verifiers over a PBKDF2/HKDF proof; ChaCha20-Poly1305 for documents; Ed25519-signed audit batches; Let's Encrypt TLS with HSTS. Secrets live in Secrets Manager and are now generated **on the instance** — none is read on a workstation. |
| A05 Injection | SQL, XSS | Every query binds parameters (the nine `format!` SQL strings interpolate compile-time column lists only). No `dangerouslySetInnerHTML`, `eval` or `new Function` in either portal. Per OWASP, characters are not stripped from input (a password may contain any printable character); parameterisation is the defence. |
| A05 / XSS second layer | Content-Security-Policy | **Added.** `script-src 'self'` plus SHA-256 hashes of the inline scripts computed from the built HTML at image build (`client/scripts/csp-header.mjs`), `object-src 'none'`, `frame-ancestors 'none'`, `base-uri`/`form-action 'self'`; only Google Fonts and the configured Jitsi origin are named. The all-routes browser specs fail on any CSP violation. |
| A06 Insecure design | Consent default | **Fixed.** Recording a consent without stating the decision stored it as **granted**. Now `400 CONSENT_DECISION_REQUIRED`. |
| A07 Authentication | Passwords, lockout, MFA | **Strengthened.** Server-side password rules (ADR-0011): 15–128 characters, no common/decorated passwords, no keyboard runs, not the person's name or login ID, Pwned Passwords k-anonymity check. Lockout is per account (5 failures / 15 min), keyed by login ID, so IP rotation does not get around it. Optional TOTP; consequential actions need a fresh confirmation (ADR-0008). |
| A07 | Password at rest in other places | **Fixed.** The idempotency layer stored an unsalted digest of request bodies — for a password change, a fast hash of the new password. That route's body is now left out. |
| A08 Integrity | Audit and images | Audit rows are Merkle-batched, hash-chained, Ed25519-signed and exported to an S3 Object Lock bucket (write-once). Images are immutable in ECR. |
| A09 Logging & alerting | Who notices an attack | **Added.** The API logs `auth.sign_in_failed` and `auth.account_locked` (no personal data); CloudWatch metric filters count them and API errors; three alarms e-mail the owner through an encrypted SNS topic. Before this, the only alarm was EC2 host recovery. |
| A10 Exceptional conditions | Fail-open scan | The consent default above was the one real fail-open. Deliberate, documented exception: if Pwned Passwords is unreachable a password is accepted on the local rules (ADR-0011). |

## If MediChain is attacked: what limits the damage

- **Nothing is lost:** PostgreSQL backups through pgBackRest to the instance volume and, encrypted before upload, to a versioned S3 bucket; the audit trail in an S3 Object Lock bucket cannot be rewritten even by the account owner (in COMPLIANCE mode).
- **Nobody gets in on one stolen secret:** sign-in proofs are never stored; verifiers are Argon2id; sessions are revocable server-side; privileged actions need step-up; there is no SSH port (SSM only) and no database port exposed.
- **It is noticed:** sign-in failure spikes, lockouts and API errors alarm by e-mail.

## Remaining, accepted, and why

| Item | Why it is acceptable now | Next step |
| --- | --- | --- |
| React Router 6.x: backslash open redirect, SSR hydration issue (moderate) | Only v7 fixes them. The app does not server-render, and its one redirect from user data (`returnPathFrom`) already rejects `//` and `\`. | Upgrade to React Router 7. |
| `lopdf` stack overflow (via `printpdf`) | The API **generates** PDFs; the flaw is in parsing hostile ones. | Upgrade `printpdf` when its API change is scheduled. |
| `rkyv`, `rsa` advisories | In `Cargo.lock` as optional dependencies; never compiled into this binary. | None. |
| Rehearsal stack | Audit bucket in GOVERNANCE mode for the judging period. | A COMPLIANCE-mode stack before real patients. |
| No WAF / bot management | Single instance, per-account lockout and alarms in place; cost. | AWS WAF managed rules if traffic grows. |
| Offline medical ID unencrypted while signed in | Cleared at sign-out; see the debt register. | Encrypt at rest on the device. |
