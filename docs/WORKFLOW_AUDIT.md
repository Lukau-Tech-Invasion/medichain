# MediChain — End-to-End Workflow Audit

**Started:** 2026-08-13
**Branch:** `development/medichain-federation-hardening`

**Status.** Phases 1–6 committed. Phase 6 delivers the token layer, the
contrast gate and the fix for the reported screen; migrating the remaining
pages off raw colour utilities is mechanical follow-up work — see §5.

| Phase | State | Commit |
| ----- | ----- | ------ |
| 1 · Audit inventory | done | `18630f4` |
| 2 · Shared identity/provider context | done | `f8c9ca8` |
| 3 · Credential authentication | done | `2df23a4` |
| 4 · Appointment lifecycle | done | `d76846b` `1c14767` `f889637` `3fd425f` + patient app |
| 5 · Telehealth workflow | done | `HEAD` |
| 6 · Design tokens and contrast | foundation done; page migration ongoing | `HEAD` |
| 7 · Tests and evidence | partial, per phase | — |

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
| `cargo test --bin medichain-api` | **363 passed, 0 failed, 1 ignored** (510s) | Against the live PostgreSQL 16 container. Two more than the 361 in `CLAUDE.md`. After phases 1–4: **392 passed, 0 failed** — +29 tests, no regressions. |
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
changing the foreground colours placed on them. The precise mechanism, found in phase 6: the
override layer targeted *bare elements* (`.dark p`, `.dark h1..h6`,
`.dark label`). A type selector plus a class is specificity (0,1,1), which
beats a utility class at (0,1,0) — so `.dark p` repainted a paragraph that had
deliberately chosen `text-green-700` inside a `bg-green-50` alert, producing
pale grey on pale green. It was not that anyone picked bad colours; a global
rule overruled good ones. The two apps also ship different `primary` scales
(#3b82f6 vs #007AFF). (WF-022.)

---

## 4. Audit table

Severity: **P0** unsafe / security / data integrity · **P1** core workflow
broken · **P2** substantial UX or functional deficiency · **P3** polish.

Columns: FE = frontend defect · BE = backend defect · Persist = data survives a
reload · Sec = security-relevant.

| ID | Area | User workflow | Problem | Sev | FE | BE | Persist | Sec | Status |
|----|------|---------------|---------|-----|----|----|---------|-----|--------|
| WF-001 | Auth | Log in to the doctor portal | `login(wallet)` marks the session authenticated on a 200 from `GET /api/auth/wallet/{address}` — an unauthenticated lookup requiring no proof of key ownership. Under the shipped `IS_DEMO=true` default this is a **full authentication bypass**: knowing any registered address logs you in with that user's role. With `REQUIRE_SIGNATURES=true` it is instead a login that appears to succeed and then 401s on every subsequent call, because no signer is attached. | P0 | ✗ | ✗ | — | ✗ | **Partly fixed** `2df23a4` — credential sign-in is now the primary path, but `login(wallet)` survives behind the demo quick-login buttons and is still an unauthenticated lookup. Remove it, or gate it on a build flag that is off in production. |
| WF-002 | Auth | Log in as a clinician | The only production-viable login is the Polkadot browser extension. The alternative is typing a 48-character SS58 address. `users.email`, `users.username` and an unused `password_hash` column all already exist in the schema. | P1 | ✗ | ✗ | — | — | **Fixed** `2df23a4` |
| WF-003 | Auth | — | Twelve real demo wallet addresses are hardcoded in `LoginPage.tsx` and ship in the client bundle, gated only by a build-time flag. | P2 | ✗ | — | — | ✗ | Open |
| WF-004 | Appointments | Book an appointment | `book_appointment` takes `provider_id` from the request body and never checks it against the authenticated caller. Any provider can book onto another provider's calendar; the created record names them as the clinician. | P0 | — | ✗ | — | ✗ | **Fixed** `d76846b` |
| WF-005 | Appointments | Book any appointment | Type map is PascalCase, client sends lowercase, catch-all arm is `_ => FollowUp`. **Every** appointment booked from the portal is stored as a follow-up and `is_telehealth` is always false — so a telehealth appointment cannot be created at all. | P1 | ✗ | ✗ | partial | — | **Fixed** `d76846b` |
| WF-006 | Appointments | Cancel an appointment | The button sends no request body; the handler requires `{reason}`. Every cancellation 400s. Dead button. | P1 | ✗ | — | — | — | **Fixed** `f889637` |
| WF-007 | Appointments | Check a patient in | `check_in_appointment` allows only the patient. The doctor portal calls it with the provider's identity, so it always 403s. Dead button. | P1 | ✗ | ✗ | — | — | **Fixed** `f889637` |
| WF-008 | Appointments | See my day | One flat list capped at 100, no date scoping. No Today / Upcoming / Previous / Cancelled views. | P1 | ✗ | ✗ | — | — | **Fixed** `3fd425f` |
| WF-009 | Appointments | Progress an appointment | No transition endpoints exist for confirm, start, complete or no-show. The lifecycle cannot advance past `CheckedIn`. | P1 | ✗ | ✗ | — | — | **Fixed** `f889637` |
| WF-010 | Appointments | — | Facility name and street address are hardcoded literals stamped onto every appointment. | P2 | — | ✗ | — | — | Open |
| WF-011 | Appointments | Pick a time | `get_available_slots` returns a hardcoded list of ten times; only booked-slot filtering is real. No provider schedule exists. | P2 | — | ✗ | — | — | Open |
| WF-012 | Appointments | Patient manages an appointment | Patient-app `AppointmentsPage`: Book, Confirm, Reschedule and Join-video buttons have no `onClick` at all. Only the tab switches work. | P1 | ✗ | — | — | — | **Fixed** `HEAD` |
| WF-013 | Appointments | Book an appointment | Provider ID is a required free-text box the logged-in doctor must fill with their own wallet address. | P2 | ✗ | — | — | — | **Fixed** `3fd425f` |
| WF-014 | Telehealth | Hold a video visit | Booking a telehealth appointment never creates a telehealth session, although `create_telehealth_session` already accepts `appointment_id`. The two subsystems are fully disconnected; `telehealth_link` is always `None`. | P1 | ✗ | ✗ | — | — | **Fixed** `HEAD` |
| WF-015 | Imaging | Order an imaging study | `handleSubmit` is not async, makes no request, generates `IMG-${Date.now()}`, pushes to local state and shows "Order placed". The order is gone on reload. The Results tab filters the same local array, so it can never populate. A real `radiology-orders` endpoint exists and is used for reads only. | P1 | ✗ | — | ✗ | — | Open |
| WF-016 | Imaging | Fix a rejected form | Validation reports a single generic "please fill required fields" with no indication of which field, no highlight and no scroll-to. | P2 | ✗ | — | — | — | Open |
| WF-017 | Critical values | Review thresholds | `CRITICAL_THRESHOLDS` is a hardcoded 13-entry const array, read-only, with no API and no persistence. It is not used to detect anything — purely decorative. No role gate on editing, because editing does not exist. | P2 | ✗ | ✗ | ✗ | — | Open |
| WF-018 | Critical values | Read an alert | Pale foreground on pale success/status backgrounds; contrast not verified anywhere. Clinically the most important text in the product to be able to read. **Cause:** bare-element dark overrides outranking utility classes, not poor colour choices. | P2 | ✗ | — | — | — | **Fixed** `HEAD` — bombs removed, page on tokens, 52 pairs gated by `scripts/check-contrast.py` |
| WF-019 | Cross-cutting | Create almost anything | **12 confirmed** handlers across 8 pages construct an entity, assign a client-side sequential id, write to React state and report success without any request: Order Sets (create, duplicate), Note Templates (create, duplicate), CDS Alert Rules (create), Chain of Custody (create, transfer), Consult (respond), Lab QC (calibration), Pathology (open, save report), Imaging (order). *18 candidates scanned, 6 confirmed false positives.* | P1 | ✗ | — | ✗ | — | Open |
| WF-020 | Prescriptions | Write an e-prescription | `create_e_prescription` persists the entire client-supplied `ElectronicPrescription` verbatim. `rx_id`, `prescriber` and `patient_id` are all attacker-chosen; there is **no patient-access check** (only `require_clinical_staff`), so any clinical role can write a prescription against any patient and attribute it to any prescriber. The audit entry hardcodes `accessor_role: "doctor"` regardless of the caller's real role, and records the true caller — so record and audit trail disagree. | P0 | — | ✗ | — | ✗ | **Fixed** `d76846b` |
| WF-021 | Cross-cutting | — | Four further handlers trust a body actor field with no cross-check: surgical `create_appointment` (`created_by`, `provider_id`), `create_blood_type_screen` (`performed_by`, `verified_by`), `create_pre_op` (`surgeon`), `create_radiology_order` (`ordering_provider`). All six such handlers in the API fail the check. | P0 | — | ✗ | — | ✗ | Open |
| WF-022 | Design system | Every screen | No semantic tokens; 7,886 raw colour utilities / 268 distinct classes in doctor pages; dark mode is a global `.dark .bg-white` surface override that does not adjust foregrounds; the two apps ship divergent `primary` palettes. | P2 | ✗ | — | — | — | Open |
| WF-023 | Patients | Find a patient | `PatientSearchPage.handleSearch` filters only the already-fetched page of patients client-side, so a patient outside the first fetch cannot be found. Presented as a search box over the whole register. | P2 | ✗ | — | — | — | Open |
| WF-024 | Registration | Register a patient | Staff are asked to type the patient's SS58 wallet address by hand. Needs reconciling against whether the platform provisions the wallet — the success panel reports an `nfcTagId`, so provisioning claims are made that must be verified end to end. | P2 | ✗ | ? | ? | — | Open |
| WF-025 | Audit trail | Any audited clinical write | At least nine handlers write a **hardcoded** `accessor_role` into the access log — `"doctor"`, `"nurse"`, `"radiologist"`, `"pathologist"`, `"anesthesiologist"` — regardless of who actually called. `accessor_id` is correct, so the log states a real person holding a role they may not have. For a POPIA-regulated audit trail that is a correctness defect, not cosmetics. Fixed in `create_e_prescription` and `create_radiology_order`; the rest remain. | P1 | — | ✗ | — | ✗ | Partly fixed |
| WF-026 | Auth | — | `client/shared/src/hooks/useAuth.tsx` is a third, entirely unused auth implementation (`AuthProvider`/`useAuth`), mounted by neither app, carrying its own duplicate copy of the role hierarchy in `HEALTHCARE_PROVIDER_ROLES`/`RECORD_EDITOR_ROLES`. Dead code that will drift. Not deleted — see CLAUDE.md rule 7. | P3 | ✗ | — | — | — | Open |
| WF-027 | Design system | Every screen | A shared component library exists (`Button`, `Card`, `Input`, `Badge`, `Alert`, `Modal`, `EmptyState`, …) and the doctor portal imports exactly **one** of them (`EmptyState`) across 76 pages. The inconsistency is not a missing design system but a bypassed one. | P2 | ✗ | — | — | — | Open |
| WF-028 | Auth | Sign a request | The API verifies signatures over the raw message bytes, while the Polkadot extension's `signRaw({type:'bytes'})` signs an `<Bytes>`-wrapped payload. Whether the extension login path actually verifies therefore depends on `sp_core`'s wrap tolerance and was not confirmed. The credential path signs raw bytes and matches exactly. Needs an explicit end-to-end check against a real extension. | P2 | — | — | — | ✗ | Unverified |
| WF-030 | Appointments | Book any appointment (PostgreSQL) | **Appointments have never once persisted on the production storage backend.** `appointments.provider_id` is `uuid` with `FOREIGN KEY → users(id)`, as are `created_by` and `cancelled_by`; the application keys providers by SS58 `wallet_address` throughout. Every booking dies with `operator does not exist: uuid = text`. Confirmed live: `SELECT count(*) FROM appointments` is **0**. Invisible until now because the in-memory repository enforces no types and there is no PostgreSQL test for appointment booking — the same class as the memory-backend blind spot already known in this codebase. Fixing it means migrating those three columns to `varchar` against `users(wallet_address)`, which is deliberate schema surgery on a clinical table and was **not** attempted as a side effect of this audit. | P0 | — | ✗ | ✗ | — | **Fixed** `1c14767` |
| WF-029 | Auth | Brute-force a sign-in | The new credential-login lockout is process-local, like the existing rate-limit middleware. Behind more than one API instance an attacker can spread attempts across them. Acceptable for the current single-instance deployment; needs shared state (Redis) before horizontal scaling. | P2 | — | ✗ | — | ✗ | Known limitation |

### Not yet audited

Recorded so they are not silently dropped: Dashboard actionability (§16), SOAP
notes, vitals, medication administration, orders, emergency workflows, specialty
and surgery modules, notifications, consent, access history, NFC provisioning,
admin/facility management, responsive behaviour (§22), accessibility (§23),
navigation hierarchy (§21). The agreed scope for the current pass is depth on
the auth → appointments → telehealth spine plus the token system; these areas
get audited in a later pass.

---

### Live end-to-end evidence

Run against the built binary on `:8090` with `MEDICHAIN_STORAGE=postgres`
pointing at the real PostgreSQL 16 container, using existing synthetic staff
accounts. Verbatim results:

| # | Check | Result |
|---|-------|--------|
| 1 | Enrol credentials for Dr Mbeki (wallet-authenticated) | `200` `{"login_id":"dr.mbeki","success":true}` |
| 2 | Sign in with `dr.mbeki` + correct proof | `200`, returns wallet + encrypted keystore. **No address typed.** |
| 3 | Same identifier, wrong proof | `401 INVALID_CREDENTIALS` |
| 4 | Identifier that does not exist | `401 INVALID_CREDENTIALS` — byte-identical to #3, so no account enumeration |
| 7a | **Dr A books naming Dr B as provider** | `403 PROVIDER_MISMATCH` — the impersonation the audit found is refused |
| 7d | Unrecognised appointment type | `400 UNKNOWN_APPOINTMENT_TYPE` — rejected, not silently defaulted to FollowUp |
| 7b/7c | Legitimate booking (self, and admin-for-colleague) | `500` — got past authorization and died in the repository on WF-030 below |

7b/7c are how WF-030 was found. Both cleared the new authorization logic and
failed underneath it, in a pre-existing schema defect unrelated to this work.

## 5. What is genuinely still open

Recorded plainly so nothing above reads as more finished than it is.

**Not started.** Imaging (WF-015, WF-016), critical-value thresholds (WF-017),
and the twelve fake-success handlers (WF-019). The shared component library is
still imported once across 76 pages (WF-027).

**Design tokens: foundation only.** The token layer, the contrast gate and the
removal of the bare-element overrides are done, and the reported critical-value
screen is migrated. The other ~75 doctor pages still use raw Tailwind colour
utilities. They are no longer *broken* — removing the specificity bombs fixed
the pale-on-pale class everywhere at once — but they do not yet share a
vocabulary, and pale status surfaces still look bright in dark mode. Migration
is mechanical and safe to do incrementally; nothing depends on finishing it.

**Telehealth caveats.** Booking now provisions a real session and both apps
gate Join on one existing and on the room being open, enforced server-side. Two
things are deliberately not done: an appointment moved to a new date does not
move its session's `scheduled_start`, because rescheduling produces a new
appointment rather than mutating one; and ending a telehealth session does not
transition the parent appointment to `completed` — the clinician still marks
that, since leaving a call is not the same as finishing a consultation.

**Partly done.** Rescheduling: the transition table treats `rescheduled` as
terminal because the API models a reschedule as booking a replacement, and no
screen does that yet. The patient app's Reschedule button was replaced with
Cancel rather than left dead. Patient self-service booking has no UI and is
marked unavailable.

**Done but not yet proven end to end.** Credential sign-in has unit coverage
and typechecks, and its server half was exercised against the live database,
but no browser has completed the full derive → login → open keystore → sign
challenge → JWT round trip. Until that runs, treat WF-002 as implemented and
unverified.

**Deliberately unfixed.** `useAuth.tsx` (WF-026) is dead code left in place
under CLAUDE.md rule 7. The seven remaining hardcoded `accessor_role` strings
(WF-025) were left rather than swept into an unrelated commit.

## 6. Scope of the current pass

Agreed with the repository owner on 2026-08-13: **depth over breadth.** Take
authentication, the shared identity context, the appointment lifecycle,
telehealth and the design-token system to genuine completion with persistence
and end-to-end proof, rather than partially touching every module. Everything
else is logged above and left for a later pass.

Commits are made per phase, with no AI attribution.
