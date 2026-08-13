# MediChain — End-to-End Workflow Audit

**Started:** 2026-08-13
**Branch:** `development/medichain-federation-hardening`
**Status:** Phase 1 (inventory) complete. Phases 2–7 in progress.

This document is the living inventory for the workflow/UX/authentication audit.
New findings go here. It is deliberately separate from
`docs/FEATURE_END_TO_END_AUDIT.md` (the feature/durability ledger) — that one
asks "does this feature persist its data?", this one asks "can a real clinician
finish this task?".

---

## 1. Method, and what counts as evidence

The governing question for every finding:

> If a real doctor, nurse, receptionist, patient, pharmacist, lab or radiology
> worker, or administrator tried to accomplish this task, could they complete
> the *entire* workflow without re-entering information the system already
> knows, hitting dead ends, pressing buttons that do nothing, or being unable
> to tell what happened afterwards?

A page rendering, a component mounting, TypeScript compiling, or an endpoint
returning 200 is **not** evidence of completion. Nor is a green test suite: the
whole of §4's P0/P1 list below is present in a tree where
`cargo test --bin medichain-api` passes.

Findings are only recorded here after the specific code path was read. Where a
static scan produced a candidate list, the false-positive rate is stated and the
confirmed subset is what gets counted.

### Reproducing the scans

Two scanners back the counts below. Both are heuristic and deliberately err
toward over-reporting; both require human confirmation of each hit.

```bash
python scripts/audit-scan-workflows.py    # frontend defect classes
python scripts/audit-scan-actor-ids.py    # server-side actor-identity trust
```

---

## 2. Baseline

Established before any change, so that new failures can be told apart from
pre-existing ones (requirement §32).

| Suite | Baseline | Notes |
| ----- | -------- | ----- |
| `cargo test --bin medichain-api` | **363 passed, 0 failed, 1 ignored** (510s) | Against the live PostgreSQL 16 container. Two more tests than the 361 recorded in `CLAUDE.md`. |
| `cargo test -p medichain-crypto` | not yet run | |
| pallets (3 crates) | not yet run | |
| doctor-portal `vitest` | 127 failing (per `docs/PRODUCTION_READINESS.md` H3) | diagnosed as test drift, not product defects |
| patient-app `vitest` | 46 failing (same source) | same |

The working tree already carried 149 modified/untracked files when this audit
began. That state is the baseline; this audit does not revert it.

---

## 3. Root causes

Five causes account for nearly every finding in §4. Fixing the *causes* is the
work; the individual findings are symptoms.

**RC-1 — No shared authenticated identity context on the frontend.**
There is no single place that answers "who is the logged-in clinician, what is
their wallet, role, department?". Each page reaches into `useAuthStore` and
re-derives what it needs, so any field a page forgets to derive becomes a form
input for the user to type. This is the direct cause of the Provider ID box
(WF-013) and the whole "asks for what it already knows" class.

**RC-2 — Actor identity is taken from the request body, not the session.**
Six handlers accept *who performed this* as a client-supplied field. Every one
of them authenticates the caller and then never compares the two. The audit log
records the real caller while the clinical record records whoever the client
named — so the two disagree by construction. (WF-004, WF-020, WF-021.)

**RC-3 — Pages were built UI-first and never connected.**
Twelve confirmed handlers construct an entity, assign it a client-generated
sequential id (`OS-001`, `IMG-${Date.now()}`), push it into React state, and
show a success toast. No request is made. Refreshing loses the work, and the
user is told it succeeded. (WF-015, WF-019.)

**RC-4 — Client and server disagree about vocabulary, silently.**
The appointment-type map is the clearest case: the server matches PascalCase
(`"Telehealth"`), the client sends lowercase (`"telehealth"`), and the match arm
ends in `_ => FollowUp`. There is no error — the wrong value is simply stored.
A catch-all arm over a client-supplied enum turns a contract mismatch into
silent data corruption. (WF-005.)

**RC-5 — No semantic design tokens.**
7,886 raw Tailwind colour utilities across 268 distinct classes in doctor-portal
pages alone, chosen per page. Dark mode is retrofitted by globally overriding
`.dark .bg-white { @apply bg-slate-800 }`, which changes surfaces without
changing the foreground colours placed on them — the mechanism behind the pale
text on pale backgrounds. The two apps also ship different `primary` scales
(#3b82f6 vs #007AFF). (WF-022.)

---

## 4. Audit table

Severity: **P0** unsafe / security / data integrity · **P1** core workflow
broken · **P2** substantial UX or functional deficiency · **P3** polish.

Columns: FE = frontend defect · BE = backend defect · Persist = data survives a
reload · Sec = security-relevant.

| ID | Area | User workflow | Problem | Sev | FE | BE | Persist | Sec | Status |
|----|------|---------------|---------|-----|----|----|---------|-----|--------|
| WF-001 | Auth | Log in to the doctor portal | `login(wallet)` marks the session authenticated on a 200 from `GET /api/auth/wallet/{address}` — an unauthenticated lookup requiring no proof of key ownership. Under the shipped `IS_DEMO=true` default this is a **full authentication bypass**: knowing any registered address logs you in with that user's role. With `REQUIRE_SIGNATURES=true` it is instead a login that appears to succeed and then 401s on every subsequent call, because no signer is attached. | P0 | ✗ | ✗ | — | ✗ | Open |
| WF-002 | Auth | Log in as a clinician | The only production-viable login is the Polkadot browser extension. The alternative is typing a 48-character SS58 address. `users.email`, `users.username` and an unused `password_hash` column all already exist in the schema. | P1 | ✗ | ✗ | — | — | Open |
| WF-003 | Auth | — | Twelve real demo wallet addresses are hardcoded in `LoginPage.tsx` and ship in the client bundle, gated only by a build-time flag. | P2 | ✗ | — | — | ✗ | Open |
| WF-004 | Appointments | Book an appointment | `book_appointment` takes `provider_id` from the request body and never checks it against the authenticated caller. Any provider can book onto another provider's calendar; the created record names them as the clinician. | P0 | — | ✗ | — | ✗ | Open |
| WF-005 | Appointments | Book any appointment | Type map is PascalCase, client sends lowercase, catch-all arm is `_ => FollowUp`. **Every** appointment booked from the portal is stored as a follow-up and `is_telehealth` is always false — so a telehealth appointment cannot be created at all. | P1 | ✗ | ✗ | partial | — | Open |
| WF-006 | Appointments | Cancel an appointment | The button sends no request body; the handler requires `{reason}`. Every cancellation 400s. Dead button. | P1 | ✗ | — | — | — | Open |
| WF-007 | Appointments | Check a patient in | `check_in_appointment` allows only the patient. The doctor portal calls it with the provider's identity, so it always 403s. Dead button. | P1 | ✗ | ✗ | — | — | Open |
| WF-008 | Appointments | See my day | One flat list capped at 100, no date scoping. No Today / Upcoming / Previous / Cancelled views. | P1 | ✗ | ✗ | — | — | Open |
| WF-009 | Appointments | Progress an appointment | No transition endpoints exist for confirm, start, complete or no-show. The lifecycle cannot advance past `CheckedIn`. | P1 | ✗ | ✗ | — | — | Open |
| WF-010 | Appointments | — | Facility name and street address are hardcoded literals stamped onto every appointment. | P2 | — | ✗ | — | — | Open |
| WF-011 | Appointments | Pick a time | `get_available_slots` returns a hardcoded list of ten times; only booked-slot filtering is real. No provider schedule exists. | P2 | — | ✗ | — | — | Open |
| WF-012 | Appointments | Patient manages an appointment | Patient-app `AppointmentsPage`: Book, Confirm, Reschedule and Join-video buttons have no `onClick` at all. Only the tab switches work. | P1 | ✗ | — | — | — | Open |
| WF-013 | Appointments | Book an appointment | Provider ID is a required free-text box the logged-in doctor must fill with their own wallet address. | P2 | ✗ | — | — | — | Open |
| WF-014 | Telehealth | Hold a video visit | Booking a telehealth appointment never creates a telehealth session, although `create_telehealth_session` already accepts `appointment_id`. The two subsystems are fully disconnected; `telehealth_link` is always `None`. | P1 | ✗ | ✗ | — | — | Open |
| WF-015 | Imaging | Order an imaging study | `handleSubmit` is not async, makes no request, generates `IMG-${Date.now()}`, pushes to local state and shows "Order placed". The order is gone on reload. The Results tab filters the same local array, so it can never populate. A real `radiology-orders` endpoint exists and is used for reads only. | P1 | ✗ | — | ✗ | — | Open |
| WF-016 | Imaging | Fix a rejected form | Validation reports a single generic "please fill required fields" with no indication of which field, no highlight and no scroll-to. | P2 | ✗ | — | — | — | Open |
| WF-017 | Critical values | Review thresholds | `CRITICAL_THRESHOLDS` is a hardcoded 13-entry const array, read-only, with no API and no persistence. It is not used to detect anything — purely decorative. No role gate on editing, because editing does not exist. | P2 | ✗ | ✗ | ✗ | — | Open |
| WF-018 | Critical values | Read an alert | Pale foreground on pale success/status backgrounds; contrast not verified anywhere. Clinically the most important text in the product to be able to read. | P2 | ✗ | — | — | — | Open |
| WF-019 | Cross-cutting | Create almost anything | **12 confirmed** handlers across 8 pages construct an entity, assign a client-side sequential id, write to React state and report success without any request: Order Sets (create, duplicate), Note Templates (create, duplicate), CDS Alert Rules (create), Chain of Custody (create, transfer), Consult (respond), Lab QC (calibration), Pathology (open, save report), Imaging (order). *18 candidates scanned, 6 confirmed false positives.* | P1 | ✗ | — | ✗ | — | Open |
| WF-020 | Prescriptions | Write an e-prescription | `create_e_prescription` persists the entire client-supplied `ElectronicPrescription` verbatim. `rx_id`, `prescriber` and `patient_id` are all attacker-chosen; there is **no patient-access check** (only `require_clinical_staff`), so any clinical role can write a prescription against any patient and attribute it to any prescriber. The audit entry hardcodes `accessor_role: "doctor"` regardless of the caller's real role, and records the true caller — so record and audit trail disagree. | P0 | — | ✗ | — | ✗ | Open |
| WF-021 | Cross-cutting | — | Four further handlers trust a body actor field with no cross-check: surgical `create_appointment` (`created_by`, `provider_id`), `create_blood_type_screen` (`performed_by`, `verified_by`), `create_pre_op` (`surgeon`), `create_radiology_order` (`ordering_provider`). All six such handlers in the API fail the check. | P0 | — | ✗ | — | ✗ | Open |
| WF-022 | Design system | Every screen | No semantic tokens; 7,886 raw colour utilities / 268 distinct classes in doctor pages; dark mode is a global `.dark .bg-white` surface override that does not adjust foregrounds; the two apps ship divergent `primary` palettes. | P2 | ✗ | — | — | — | Open |
| WF-023 | Patients | Find a patient | `PatientSearchPage.handleSearch` filters only the already-fetched page of patients client-side, so a patient outside the first fetch cannot be found. Presented as a search box over the whole register. | P2 | ✗ | — | — | — | Open |
| WF-024 | Registration | Register a patient | Staff are asked to type the patient's SS58 wallet address by hand. Needs reconciling against whether the platform provisions the wallet — the success panel reports an `nfcTagId`, so provisioning claims are made that must be verified end to end. | P2 | ✗ | ? | ? | — | Open |

### Not yet audited

Recorded so they are not silently dropped: Dashboard actionability (§16), SOAP
notes, vitals, medication administration, orders, emergency workflows, specialty
and surgery modules, notifications, consent, access history, NFC provisioning,
admin/facility management, responsive behaviour (§22), accessibility (§23),
navigation hierarchy (§21). The agreed scope for the current pass is depth on
the auth → appointments → telehealth spine plus the token system; these areas
get audited in a later pass.

---

## 5. Scope of the current pass

Agreed with the repository owner on 2026-08-13: **depth over breadth.** Take
authentication, the shared identity context, the appointment lifecycle,
telehealth and the design-token system to genuine completion with persistence
and end-to-end proof, rather than partially touching every module. Everything
else is logged above and left for a later pass.

Commits are made per phase, with no AI attribution.
