# Front-end plan — the new way of working, the ambulance run record, and motion

Status: **for owner approval** (rule 6). Companion to `UX_IMPLEMENTATION_PLAN_2026-10-30.md`
(phases, data changes, proofs); this document is the design those phases build.

---

## 1. The new way of working, per role

**Old way (kept working, see §6):** open a form (Vitals, SOAP, Orders…) → pick the patient →
give a reason → fill → save → back to the dashboard → open the next form → pick the *same*
patient again. 58 forms ask for the patient; a doctor's day repeats it per form.

**New way — patient first:**

```
Find or scan the patient ─► Open patient (reason asked once) ─► Patient workspace
      ▲                                                          │  every form already knows
      │                                                          │  the patient; save keeps you
      │                                                          ▼  in the workspace
      └────────── Close patient ◄── "This visit" summary of everything saved
```

| Role | Day in the new way |
|---|---|
| Doctor | Today list → tap patient → workspace: SOAP, orders, prescription, lab review, discharge — no re-picking → Close patient → next from Today |
| Nurse | Ward list → tap patient (or scan wristband) → vitals, doses, I/O, wound, care plan → Close → next bed |
| Lab / Pharmacist | Queue item opens the *order* inside that patient's workspace → work through the steps → back to queue |
| Paramedic | Scan card → run record builds as they work → choose hospital when leaving → **one button: Hand over** |
| ED nurse/doctor | Incoming board → **Received** → workspace opens with the ambulance timeline on top and triage pre-filled |
| Patient | Unchanged principle: five tabs, nothing re-asked (mockups `p1`–`p6`) |

---

## 2. Patient workspace — specification

### 2.1 Structure
- **Route:** `/patients/:patientId/:form?` — e.g. `/patients/PAT-…/vitals`. The existing chart
  (`/patients/:patientId`, tabs Overview · Records · Access) becomes the workspace home.
  Every one of the 58 patient-scoped pages is mounted inside it and reads the patient from the
  route; their `PatientSelect` renders **only** when the page is opened without a patient.
- **One patient open at a time.** Opening another patient asks "Close Thandiwe Ndlovu first?"
  when there are unsaved changes, otherwise switches with the banner animating to the new
  name (§5). Evidence: ONC and the Joint Commission recommend one open record; the JAMA 2019
  trial (Adelman et al.) found forcing one record did not by itself lower wrong-patient orders,
  but errors rose when orders were placed with several open — so the workspace pairs
  one-at-a-time with strong identity cues rather than relying on the limit alone.
- **Reason asked once per patient per visit** (existing `AccessReasonGate`, unchanged rules).

### 2.2 Layout
| Area | Desktop ≥ 1024 px | Tablet | Phone |
|---|---|---|---|
| **Patient banner** (sticky) | name · DOB/age · sex · health ID · allergies · code status · reason given · **Close patient** | same, one line | two lines; allergies always visible |
| **Actions** | left rail | collapsible rail | bottom sheet "Actions" |
| **Form** | centre | centre | full width |
| **This visit** | right panel: everything saved since opening, newest first, each opens the record | drawer | sheet from banner |

### 2.3 Actions rail — 40 forms for a doctor must not become a 40-item list
1. **Common** (per role, fixed, ≤ 6): Doctor — SOAP, Orders, Prescribe, Lab results,
   Progress note, Discharge. Nurse — Vitals, Medicines (MAR), Fluids, Wound, Care plan,
   Progress note.
2. **Recent** — the user's last 4 forms (per device, in memory + per-user preference).
3. **All forms** — searchable, grouped (Emergency · Surgical · Specialties · Documentation ·
   Administrative), from the role's existing navigation config so authorisation never drifts.
Each item shows a dot when this patient has a draft or a record saved this visit.

### 2.4 Close patient
Shows the "This visit" summary (what was saved, by form, with times), any **unsaved drafts**
("Save / Discard / Back"), any **unsent** offline items, then clears the access context and
returns to where the user came from (Today, ward list, queue). Auto-close after the session's
inactivity timeout, with the same draft protection.

### 2.5 Forms inside the workspace (built on Phase 1's `useClinicalForm`)
- Save → stays in the workspace; the record appears in "This visit"; the form resets for the
  next entry or offers the next likely action ("Record another set of vitals", "Back to chart").
- Last recorded values beside the fields; "Now" for times; one-tap choices; nothing pre-selected.
- The 8 forms that jump to the dashboard after saving stop doing so.

---

## 3. Ambulance run record — "one button and everything moves"

### 3.1 What the hospital must receive (structure from ATMIST / IMIST-AMBO)
Identity and age · **T**ime of call/onset · **M**echanism or medical complaint ·
**I**njuries/findings · **S**igns — every set of vitals **with its time**, so the trend is
visible · **T**reatment — every intervention and medicine with dose, route and **time given** ·
ETA and what is needed on arrival. Structured handovers reduce questions from receiving staff
and shorten the handover. Per-reading and per-dose timestamps are what EMS data standards
(NEMSIS) record, so the hospital sees *when*, not just *what*.

### 3.2 How it is captured without extra work
The run record is a **timeline of events**, appended as the crew works — never a form filled in
afterwards:

| Event | How it is recorded |
|---|---|
| Dispatched / on scene / patient contact | tap a time button (the tap time is the record) |
| Patient identified | scan card or QR → emergency card shown, identity attached |
| Vitals | quick entry (numeric keypad), each set time-stamped |
| Treatment | chips (airway, IV access, splint, CPR, defib…) + medicine with dose/route |
| Leaving scene | **choose destination hospital** (nearest first) → **pre-alert sent automatically** with the timeline so far and ETA |
| En route | further vitals/treatment stream to the hospital as they are recorded |
| Arrival | **one button: "Hand over to <hospital>"** — status *arrived*, receiving board notified |

The handover button sends nothing new to type: everything already in the timeline is the
handover. A free-text note remains optional.

### 3.3 Hospital side
- **Incoming board** (facility-filtered): patient (or "Unknown, male ~40"), ETA, ATMIST
  summary, latest vitals; live updates.
- **Received** (one tap) → workspace opens with the **ambulance timeline pinned on top**, triage
  pre-filled from the last vitals and complaint (editable, source-labelled), patient admitted
  to the ED ward (Phase 5; encounter relationship until then).
- The patient can read their ambulance record (rule 10 — the read exists today).

### 3.4 Why a timeline of events (not one big form)
- **Works offline:** each event is an append-only write with its own operation key, queued
  encrypted on the device and sent later; appends never conflict and a resend cannot duplicate
  (*DDIA* p.192 offline clients; p.566 operation identifiers).
- **Status is a small state machine** — *in progress → en route → arrived → received*,
  *cancelled / no transport* — enforced on the server (*The Pragmatic Programmer* p.240).

### 3.5 Edge cases the design covers
Unknown patient (tag now, link when identified — same mechanism as MCI); several casualties
(mass-casualty incident: each scan joins the incident, **Select all → Hand over** per
vehicle); patient refuses transport / dies on scene (closing statuses, no handover);
destination changes en route (new pre-alert, old hospital notified of cancellation); no signal
(timeline shows "Not sent yet"; the crew can show the screen at handover); crew change between
vehicles (run transferred, both crews in the record); wrong card scanned (unlink with reason,
audited).

### 3.6 Data changes (summarised; detail in the implementation plan Phase 2)
`ems_runs` (identity link, crew, unit, status, destination, ETA, created_by, received_by/at)
and append-only `ems_run_events` (run, kind, at, payload, operation key). Existing
`ems_handoffs` rows stay readable; new handovers are written as runs.

---

## 4. Motion — purposeful, brief, optional

### 4.1 Rules (library: `frontend-motion-and-animation.md` §§1–6, 9; Apple HIG *Motion*)
1. **Only for meaning:** continuity (where did that come from?), feedback (did it work?),
   state change (what changed?). "Don't add motion for the sake of adding motion."
2. **Animate `transform` and `opacity` only** — anything else reflows the page; budget
   16.7 ms/frame, measure dropped frames.
3. **Frequency sets duration:** actions done hundreds of times a shift get ≤ 150 ms or none.
4. **Reduced motion substitutes, never deletes:** slides become short cross-fades (fades are
   not "motion" under WCAG 2.3.3). The View Transitions API does **not** honour
   `prefers-reduced-motion` by itself — our helper checks it.
5. **Nothing flashes** more than 3 times a second (WCAG 2.3.1); critical alerts never flash red.
6. **Nothing auto-moves for more than 5 s** without a way to stop it (WCAG 2.2.2) — no
   shimmering skeletons; static placeholders.

### 4.2 Tokens (Material 3 "standard" scheme — the utilitarian one; library
`frontend-material-design-and-android.md` §7)
| Token | Value | Use |
|---|---|---|
| `--motion-short` | 150 ms | presses, chips, toggles |
| `--motion-medium` | 250 ms | sheets, panels, banner change |
| `--motion-long` | 350 ms | workspace open/close (rare) |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | moving between positions |
| `--ease-enter` | `cubic-bezier(0, 0, 0, 1)` | things arriving |
| `--ease-exit` | `cubic-bezier(0.3, 0, 1, 1)` | things leaving (shorter: 200 ms) |

### 4.3 Catalogue — every motion in the product
| Moment | Motion | Duration · easing | Reduced motion | Purpose |
|---|---|---|---|---|
| Open patient from a list | row's name/avatar morphs into the workspace banner (shared-element view transition) | 350 · standard | 150 ms cross-fade | continuity: *this* patient |
| Switch patient | banner content slides out/in, name highlighted once | 250 · standard | cross-fade | identity change is noticed |
| Form saved | button → tick; record slides into "This visit" | 150 + 250 · enter | tick + fade-in | feedback: saved, and where |
| Save failed | error summary fades in, focus moves to it (no shake) | 150 · enter | same | feedback without alarm |
| Sheet / drawer | rises from edge | 250 enter / 200 exit | fade | continuity |
| Action rail open (tablet) | slides from left | 250 · standard | fade | continuity |
| Tabs / sections | content cross-fade | 150 · linear | instant | state change |
| Chips / toggles | background + check fade | 100 · standard | same (colour change isn't motion) | feedback |
| Press feedback | scale 0.98 | 100 | none | feedback; very frequent |
| Incoming ambulance (ED board) | new row slides in once | 250 · enter | fade | attention, once |
| Critical alert | appears with one 200 ms rise, then static until acknowledged | 200 · enter | fade | attention, no flashing |
| Handover sent | progress bar → tick → "Received by …" when acknowledged | 250 | fade | feedback across two people |
| Offline item sent | "Not sent yet" badge counts down, item fades to sent | 150 | same | trust in the queue |
| Close patient | workspace collapses to the list row | 350 · standard | cross-fade | continuity back |

### 4.4 Implementation
- Tokens in `client/shared` (CSS custom properties + Tailwind theme), one `motion.css`.
- `useMotionNavigate()`: wraps navigation in `document.startViewTransition` + `flushSync` when
  supported **and** reduced motion is off; otherwise navigates instantly. Both apps use
  `<BrowserRouter>`, where React Router 6.30's `viewTransition` option is unavailable, so the
  helper calls the browser API directly — no animation library added.
- Gate: no `transition`/`animation` on layout properties; every animation class has a
  `motion-reduce:` variant; the existing 170 `animate-*` uses migrate to tokens.
- Tests: Playwright runs each journey with `reducedMotion: 'reduce'` and without; a frame-drop
  probe on the three heaviest transitions (open patient, sheet, ED board).

---

## 5. Identity cues (wrong-patient protection without extra clicks)
Banner always shows two identifiers (name + DOB/age) and the health ID; same-name patients get
a visible "Similar name on this ward" badge; the banner animates on every patient change; the
"This visit" panel names the patient on every saved item; Close patient lists what was written
to whom.

---

## 6. Adoption — easy to switch to, nothing lost
- **The old way still works.** Every existing URL (`/vitals`, `/soap`…) stays; opened without a
  patient it shows the picker as today, then **continues inside the workspace**. No retraining
  needed to keep working.
- **Teach in context, not with a tour** (HIG onboarding: contextual tips beat front-loaded
  tutorials): first time each role opens the workspace, three one-line tips anchored to the
  banner, the actions rail and Close patient; dismissible, never shown again.
- **Per-role rollout:** a setting turns the workspace on per role (doctor first), so feedback
  from five users per role is gathered before the next role (GOV.UK Service Standard: test with
  users; Health Literacy Online: plain language, ≥ 16 px).
- **Measured:** clicks, typing and time for the ten key tasks before and after (Phase 0
  harness), published per role.

---

## 7. QA checklist for these designs
Wrong patient after switching quickly · unsaved draft on Close/switch/sign-out/timeout · two
browser tabs with different patients (second tab warns: "Another patient is open") · deep link
to a form for a patient the user can't access (reason gate, not a blank page) · back button
inside the workspace (returns to the previous form, not out of the patient) · offline during
save · duplicate save · run record with no identity · destination changed en route · ED receives
two ambulances for the same patient · reduced motion on · screen reader announces patient
change (`aria-live` on the banner) · keyboard-only through the whole workspace · phone in
portrait/landscape · all six languages (longest labels) · slow 3G.

---

## 8. Where this sits in the implementation plan
- **Phase 1** gains **1.6 Patient workspace shell** (routes, banner, actions rail, This visit,
  Close patient, motion tokens + `useMotionNavigate`) — built before page migration so pages
  move straight into it.
- **Phase 2** builds the **run record** (§3) instead of extending the one-shot handover form.
- Everything else unchanged.

## Sources
Library: `frontend-motion-and-animation.md` §§1–6, 9, 12 · `frontend-material-design-and-android.md`
§7 · `frontend-platform-guidelines-apple-hig.md` §§3, 6, 7 · Kleppmann, *DDIA* p.192, p.566 ·
Hunt & Thomas, *The Pragmatic Programmer* 20th ed. p.240.
Web:
- Adelman et al., JAMA 2019 (one vs several open records): https://psnet.ahrq.gov/issue/effect-restriction-number-concurrently-open-records-electronic-health-record-wrong-patient · https://www.the-hospitalist.org/hospitalist/article/226567/mixed-topics/order-errors-not-reduced-limiting-number-open-records
- ATMIST / IMIST-AMBO handover: https://www.rcemlearning.co.uk/modules/pre-hospital-communication/lessons/conveying-useful-information/topic/atmister/ · https://psnet.ahrq.gov/issue/design-and-trial-new-ambulance-emergency-department-handover-protocol-imist-ambo · https://sjtrem.biomedcentral.com/track/pdf/10.1186/s13049-015-0113-3
- NEMSIS v3.5 elements (time-stamped vitals and medications): https://nemsis.org/wp-content/uploads/2025/01/NEMSIS-v3.5-Requisite-National-Elements-EMS-DataSet.pdf
