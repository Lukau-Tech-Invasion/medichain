# MediChain Incident Response Plan

> **Phase 11.4** — Security Hardening. Companion to `medichain-security-deep-dive.md`.
> **Scope:** Confidentiality, integrity, or availability incidents affecting ePHI,
> patient identity data, blockchain integrity, or platform availability.
> **Owner:** Security Officer (designate a named individual + deputy before go-live).

MediChain processes electronic protected health information (ePHI) for African
healthcare systems. Two regulatory clocks govern breach handling:

- **POPIA (South Africa)** — notify the Information Regulator and affected data
  subjects **as soon as reasonably possible** after discovery; MediChain treats
  this as a **72-hour** target.
- **HIPAA Breach Notification Rule** — notify affected individuals **without
  unreasonable delay and no later than 60 days**; notify HHS (and, for breaches
  ≥ 500 individuals, the media) accordingly.

The shorter clock (72h) is the operational default. The
`POST /api/admin/security/breach` endpoint stamps a `notify_deadline` 72 hours
from declaration on every breach alert.

---

## 1. Roles

| Role | Responsibility |
|------|----------------|
| **Incident Commander (IC)** | Owns the incident end-to-end; makes containment/disclosure calls. |
| **Security Officer** | Technical lead for detection, forensics, eradication. |
| **Privacy/Compliance Officer** | Owns regulator + data-subject notification, legal review. |
| **Comms Lead** | Internal/external messaging, media if ≥ 500 affected. |
| **On-call Engineer** | Executes containment actions (revoke keys, scale down, rotate secrets). |

Keep an up-to-date contact roster (name, phone, backup) in the secure ops vault —
**not** in this repository.

---

## 2. Lifecycle

### 2.1 Detection & Triage
Sources of signal:
- **Automated anomaly alerts** (built in, Phase 11.4):
  - `failed_auth_burst` — ≥ 5 failed signature/MFA verifications from one actor in 5 min.
  - `abnormal_access` — one provider reading ≥ 30 distinct patient records in 5 min (bulk-exfiltration signal).
  - These are logged at `WARN`/`ERROR`, broadcast over SSE as `security_alert` events, and retained in the in-memory alert ring buffer (`GET /api/admin/security/alerts`, Admin only).
- Manual reports (staff, patients, external researchers).
- Infrastructure alarms (DB connection loss, IPFS unavailability, blockchain RPC failure).

**Triage questions:** What data class is involved (ePHI / identity / credentials / availability only)? How many subjects? Is it ongoing? Is ePHI confirmed exposed or only at risk?

Assign a severity:
- **SEV-1 Critical** — confirmed ePHI exposure, active intrusion, or full outage. Page IC immediately.
- **SEV-2 High** — credential compromise, anomaly tripped, partial outage.
- **SEV-3 Low** — contained policy violation, no data exposure.

### 2.2 Containment
- **Revoke access:** disable the implicated wallet/user; for JWT sessions, rotate `JWT_SECRET` to invalidate all outstanding access tokens (they are stateless and signed with this key).
- **Force MFA / re-auth:** enrolled users must step up again after secret rotation.
- **Isolate:** if a node or service is compromised, remove it from the load balancer; preserve it for forensics (do not wipe).
- **Throttle:** tighten rate limits; enable `REQUIRE_SIGNATURES=true` if not already on.
- **Blockchain:** on-chain data is immutable — containment focuses on the off-chain ePHI (PostgreSQL/IPFS) and the keys that gate it. No PHI is ever on-chain (only hashes/pointers), which bounds blockchain-side exposure.

### 2.3 Eradication & Recovery
- Patch the root cause (code fix, dependency upgrade, config change).
- Rotate all potentially exposed secrets: `JWT_SECRET`, `SESSION_SECRET`, `AT_API_KEY`, `FCM_SERVER_KEY`, DB credentials, IPFS keys.
- Restore from known-good backups if integrity is in doubt; verify row counts and checksums.
- Re-enable services gradually; watch the anomaly alerts for recurrence.

### 2.4 Notification (start the clock at discovery)
1. **Declare** the breach: `POST /api/admin/security/breach` with a description and implicated actor. This records the critical alert and the 72-hour deadline.
2. **Assess scope** with the Privacy Officer: which subjects, which data classes.
3. **Notify the regulator** (POPIA Information Regulator / HHS) within the deadline.
4. **Notify affected data subjects** with: what happened, what data, what they should do, and MediChain's remediation.
5. **Media notice** if HIPAA's ≥ 500-individual threshold is met.

### 2.5 Post-Incident Review
- Within 5 business days, hold a blameless retrospective.
- Produce a timeline, root cause, and action items (each with an owner + due date).
- Feed detection gaps back into the anomaly thresholds and CI checks.

---

## 3. Built-in tooling reference

| Capability | Where |
|------------|-------|
| Anomaly detectors (failed-auth burst, abnormal access) | `api/src/security/breach.rs`, wired in `api/src/security/mod.rs` |
| Live alert feed | SSE `GET /api/events`, event type `security_alert` |
| Alert history (Admin) | `GET /api/admin/security/alerts` |
| Declare breach + start 72h clock (Admin) | `POST /api/admin/security/breach` |
| Invalidate all sessions | Rotate `JWT_SECRET`, restart API |
| Enforce step-up MFA on sensitive ops | `enforce_mfa_step_up` (e.g. breach declaration) |

---

## 4. Quick runbook (SEV-1)

```
1. IC paged → open incident channel, assign roles.
2. On-call: disable implicated wallet(s); rotate JWT_SECRET.
3. Security Officer: snapshot logs + DB + alert buffer for forensics.
4. Confirm scope (subjects, data classes) with Privacy Officer.
5. POST /api/admin/security/breach  → 72h clock starts.
6. Patch root cause; rotate all secrets; restore if integrity in doubt.
7. Notify regulator + subjects within deadline.
8. Blameless retro within 5 business days; file action items.
```

---

## 5. Follow-ups

**Done:**
- ~~Persist security alerts to PostgreSQL~~ — `security_alerts` table; alerts survive a restart.
- ~~Automated regulator/subject notification dispatch~~ — `POST /api/admin/security/breach` now
  dispatches on both channels: SMS to `SECURITY_OFFICER_PHONE` and email to
  `REGULATOR_NOTIFICATION_EMAIL` via `notifications::dispatch_breach_notification`
  (`api/src/notifications.rs`). Real SMTP transport is still a scaffold pending a mail crate
  (e.g. `lettre`) and production mail-server credentials — see `SMTP_ENABLED` in `.env.example`.

**Still open (tracked, not yet implemented):**
- SIEM/log shipping for long-term forensic retention.
- Real SMTP provider wiring for `send_email` (currently simulates the network call when
  `SMTP_ENABLED=true`; logs-only when unset).

---

## 6. Annual Penetration Testing Framework (HIPAA 2025)

The actual engagement — hiring a tester, running the test, remediating live
findings — needs a vendor relationship and a signed contract that only the
project owner can create. What this section provides is everything that
*doesn't* require that: scope, cadence, vendor criteria, rules of engagement,
and a severity/remediation SLA, so the first real engagement can be scheduled
and run without inventing this process under time pressure.

### 6.1 Cadence and trigger conditions
- **Baseline:** one external penetration test per 12 months (HIPAA Security
  Rule's 2025 NPRM expectations for a regulated ePHI system).
- **Additional out-of-cycle test required after:** a SEV-1 breach (§2.1), a
  major architecture change to an in-scope system (new auth mechanism, new
  public-facing service, blockchain integration going live in production), or
  12+ months since the last test regardless of the calendar trigger above.

### 6.2 Scope
In scope:
- The public API surface (`api/src/routes.rs` — all `/api/*` endpoints),
  wallet-based auth + JWT (`api/src/security/jwt.rs`) + MFA
  (`api/src/security/mfa.rs`), rate limiting and signature verification
  middleware.
- The doctor-portal and patient-app web clients as deployed (not local dev
  builds).
- Network perimeter: TLS termination (`docs/TLS.md`), exposed ports per
  `docker-compose.tls.yml`.

Out of scope (unless separately contracted):
- The Substrate blockchain node/pallets (`node/`, `runtime/`, `pallets/`) —
  immutable-ledger consensus security is a different specialty than a web API
  pentest; commission a blockchain-specific audit if/when the chain carries
  real value.
- Physical security, social engineering, and denial-of-service testing
  (explicitly excluded by default — DoS testing against a healthcare system's
  production environment risks a real availability incident; only include it
  against a dedicated non-production environment with explicit sign-off).

### 6.3 Vendor selection criteria
- Prior healthcare/HIPAA engagement experience (ask for 2 anonymized sample
  reports).
- Named methodology: OWASP ASVS/Testing Guide or PTES, not "we'll poke
  around."
- Carries professional liability insurance; will sign a Business Associate
  Agreement (this environment cannot verify a BAA exists — see 4.1's STT
  provider note for the same constraint) since the test necessarily touches
  systems that process ePHI.
- Fixed-price or time-boxed engagement with a written rules-of-engagement
  document delivered *before* testing starts (test window, IP allowlist for
  the tester's source addresses, an emergency stop contact on both sides).

### 6.4 Rules of engagement (non-negotiable)
- Testing happens against a **staging environment with synthetic data**
  wherever the finding class allows it (auth bypass, injection, XSS, IDOR).
  Only test against production for checks that are meaningless on synthetic
  data (TLS config, rate-limit behavior under real traffic shape), and only
  with the on-call engineer notified in advance.
- No test ever targets real patient ePHI. If a finding requires proving data
  exposure, prove it against a seeded synthetic patient record, not a live one.
- A kill switch: either party can halt testing immediately; the Security
  Officer has authority to invoke it without needing IC sign-off first (this
  mirrors §2.2's containment authority).

### 6.5 Severity and remediation SLA
Reuse the incident severity bands from §2.1 for consistency:

| Severity | Example | Remediation SLA |
|----------|---------|------------------|
| SEV-1 Critical | Auth bypass, ePHI exfiltration path, RCE | 72 hours (matches the breach-notification clock) |
| SEV-2 High | Privilege escalation, stored XSS on an authenticated page, IDOR on PHI | 30 days |
| SEV-3 Low | Missing security header, verbose error message, outdated dependency with no known exploit | Next release cycle |

Every finding gets an owner and a due date, tracked the same way as §2.5's
post-incident action items — a SEV-1 finding from a pentest triggers the same
retro-and-action-item discipline as a real incident, since an unremediated
critical finding *is* a live risk, not a hypothetical one.

### 6.6 Findings tracking template
Track findings in whatever issue tracker the team already uses (not this
file — findings often contain exploit details that shouldn't sit in a public
or semi-public git history). Each entry needs: finding ID, severity (6.5),
affected endpoint/component, reproduction steps, remediation owner, due date,
verification method (how the fix will be confirmed, e.g. "re-test the same
request against staging"), and status.
