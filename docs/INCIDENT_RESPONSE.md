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

## 5. Follow-ups (tracked, not yet implemented)

- Persist security alerts to PostgreSQL (currently an in-memory ring buffer; lost on restart).
- Automated regulator/subject notification dispatch (email/SMS templates).
- Annual external penetration test (HIPAA 2025) — schedule and track findings here.
- SIEM/log shipping for long-term forensic retention.
