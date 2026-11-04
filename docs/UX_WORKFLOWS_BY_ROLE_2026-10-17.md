# Every role, every daily job — fewer clicks without breaking the record

Status: **findings and proposed design, awaiting owner approval** (CLAUDE.md rule 6).
Builds on `docs/UX_INVESTIGATION_2026-10-17.md` (whole-app findings A–G) and
`docs/UX_SIMPLIFICATION_PLAN.md` (patient navigation, pop-ups, break-glass, handoff).

**Ground rules every proposal below keeps**
- No form loses a field; no record loses information. Steps are removed by *carrying* what the
  system already knows (the scanned patient, the order, the signed-in clinician, the time a
  button was tapped) — never by guessing (rule 9) or hiding what was not measured (rule 12).
- A carried value is visible and editable before saving, labelled with where it came from.
- Every write still goes through the same endpoint, access check and audit row.

"Steps" below are counted from the code paths and, where marked **live**, by driving the app.
They are estimates of the *minimum* path today, not stopwatch timings.

---

## 1. Paramedic / first responder — *not covered by any role journey today*

`docs/ROLE_JOURNEYS.md` defines journeys for six roles; **the paramedic has none**, so this
workflow has never been tested end to end.

### What happens today
| Moment | Today | Evidence |
|---|---|---|
| Sign in | Lands on the **handover form**, not the card scanner | `App.tsx` `SmartDashboardRouter`: paramedic → `/ems-handoff` |
| At the scene | Scan card → emergency card. On a phone the scanner and a security notice come first; the blood-type card is below them | `EmergencyAccessPage.tsx` |
| Several casualties | Mass-casualty page records **anonymous tags** (age, sex, complaint). Scanning someone's card does not add them to the incident; no link to a patient record | `MCIPage.tsx` — no `patient_id` |
| Handing over | One patient per form. Only the **last** scanned patient carries over (`scannedHandoffSeed` reads `currentEmergency`), with allergies/medicines/history. Agency, unit, crew, three times, complaint, GCS, vitals, interventions typed every time | `EmsHandoffPage.tsx` |
| Medicines the crew gave | API accepts `medications_given`; **the form has no field**, so it never reaches the hospital | `CreateEmsHandoffRequest` vs page |
| Which hospital | **No destination field** in the form or the API | same |
| Hospital side | Every emergency-staff account sees **all** handovers from the last 24 h, nationwide; no facility filter, no pre-arrival alert, no "received" acknowledgement | `list_recent_ems_handoffs` |
| No signal | Handover cannot be saved offline (only one write in the app queues offline: a patient's dose-taken) | `endpoints.ts` `queueWhenOffline` |

Five casualties at a crash today ≈ 5 × (find patient + type ~12 fields) + separate mass-casualty
tags that never meet the handovers. A Scottish study found paramedics write handover data on
their **gloves** when the tablet is too slow in time-critical cases.

### Proposed — "scan once, carry everything"
1. **Sign-in lands on Scan.** Unit, agency and crew are set **once per shift** (from the
   paramedic's profile/vehicle) and carried into every record.
2. **Start incident** (one tap). Every card scanned while it is open **joins the incident's
   casualty list** with the scan time; unknown casualties get a tag and can be matched later.
3. Per casualty, on one screen: emergency card on top; **START triage** one tap (score from the
   server, as today); **vitals** with numeric keypad; **interventions and medicines given**
   as chips + dose; **time buttons** "On scene", "Leaving scene" record the tap time (a real
   event, not a default).
4. **Transport:** choose the destination hospital **once for the vehicle**, tick the casualties
   on board (**Select all**), **Send handover** → one handover per casualty, each pre-filled
   from its scan, triage, vitals, interventions and medicines. The paramedic reviews, adds the
   complaint, sends.
5. **Pre-arrival:** the destination emergency department sees "Incoming — 3 patients, ETA 12
   min" on its board (live update, filtered to *its* facility).
6. **On arrival:** the receiving nurse taps **Received** (acknowledgement, like shift handoff);
   triage opens **pre-filled** with the crew's vitals and complaint, editable.
7. **No signal:** the handover is kept on the device marked **"Not sent yet"**, sends itself
   when signal returns (duplicate-safe via the existing idempotency mechanism), and the crew
   can still show the screen to the receiving nurse.

| Change | Front | API/data |
|---|---|---|
| Destination facility + ETA on handover | picker | new fields on `ems_handoffs` |
| Facility-filtered list + pre-arrival event | board | filter + SSE event |
| Received by / at | button | new fields + endpoint |
| Casualty ↔ patient link in MCI | scan joins incident | `patient_id` on casualty |
| Medicines given | chips + dose | already in API |
| Shift unit/crew | once per shift | profile or shift record |
| Offline handover | queued, "Not sent yet" | **governance decision** (§9) |

---

## 2. Emergency department (receiving nurse/doctor)
| Today | Proposed |
|---|---|
| Handovers are a national 24 h list; triage is a separate blank form; patient re-picked | "Incoming" board for **this** facility → **Received** → triage pre-filled from the handover; patient carried |

---

## 3. Nurse
Blocked first by `UX_INVESTIGATION` **A1**: no ward/bed assignment gives a nurse access to her
patients; "My Patients" is the first 15 patients in the database.

| Job | Today (live) | Proposed |
|---|---|---|
| Record vitals | Dashboard → Record vitals → search patient (whole name) → pick between two same-name patients by code → reason → **access lock** | Ward list (assigned) → patient → **Vitals** → form with patient banner, last values, "Now" |
| Give a due medicine | Dashboard "Administer" → **full MAR** → find patient → find dose → tick "barcode scanned" (nothing scanned) | Due-dose list → tap dose → **scan wristband + medicine** → confirm |
| Handoff | One patient at a time, ~17 empty fields each | Mockup `c2`: patients from the shift's records, Select all, SBAR drafted from records |
| After saving any form | 8 forms jump to the dashboard | Back to the patient, "Saved", next likely task |

## 4. Doctor — the missing "today" view
The nurse has a task list; the doctor does not.
- The doctor dashboard's patient list is `patients.list(0, 20)` — **the first 20 patients in the
  database**, not the doctor's.
- The API already returns **pending consult requests**; the page **never renders them**
  (`DashboardPage.tsx` declares `pending_consults`, no UI).
- No **today's appointments**, no notes to sign or addenda due, no discharge summaries waiting
  for a second clinician, no refill requests (the queue component exists only inside
  e-Prescribe), no unread messages.

**Proposed "Today" for doctors** — one list, each item opens its task with patient and record
loaded: today's clinic list (from appointments, which already create the care relationship);
results to review; consults to answer; discharge summaries to approve; refill requests;
critical values; unread messages. Patient list = patients the doctor has a care relationship
with.

## 5. Lab technician
| Job | Today | Proposed |
|---|---|---|
| Collect → custody → result → critical value | **Four pages, each asks for the patient again**; result entered by choosing a patient and a panel, not from the order | Work queue by stage (*To collect · Received · In progress · To verify*). Each item opens **from its order**: patient, test and specimen carried through collection → custody → result. A result flagged critical opens the critical-value notification **pre-filled** |
| Dashboard | Counts + links to general pages | Items open the specific order/specimen |
| Typed reasons | Recollection, cancel recollection, replacement specimen — typed in pop-ups | Common reasons as chips + "Other" |

## 6. Pharmacist
| Job | Today | Proposed |
|---|---|---|
| Queue → verify → dispense | Dashboard links filter e-Prescribe by status/priority (good); dispensing and reversal ask for typed text in pop-ups | Queue item opens the prescription with interactions already checked; dispense quantity numeric keypad; reversal reasons as chips |
| Interactions | Separate page | Shown inline on the prescription being verified |

## 7. Administrator
| Job | Today (sweep) | Proposed |
|---|---|---|
| Find/manage an account | User management is **51 screens** long (79 accounts as tall cards, no paging); 347 px sideways scroll on a phone | Compact rows, search, filters (role, status), 20 per page |
| Role changes needing MFA | Works since 2026-09-15 | Keep |

## 8. Patient and guardian
Covered by `UX_SIMPLIFICATION_PLAN.md` and mockups `p1`–`p6`; plus "next available"
appointment slots (UX_INVESTIGATION P1). **To verify:** a guardian switching between family
members' records in as few taps as the patient app allows.

---

## 9. QA pass — "what could be missing?"

The questions a QA lead asks of every screen, and what this app answers today.

| # | Question | Answer today | Evidence | Fix |
|---|---|---|---|---|
| Q1 | Double-tap Save on a slow network — two records? | **Possible.** A fresh `Idempotency-Key` per request; **34 of 95** form pages don't lock Save while saving | `client.ts` ~l.570 | One key per form submission (kept across retries and double taps) + lock while saving |
| Q2 | Leave a half-filled form by a sidebar click or refresh? | **Silently lost** — 0 unsaved-changes guards; no drafts | grep: no `beforeunload`/`useBlocker` | "Leave without saving?" guard + per-tab draft |
| Q3 | Connection drops mid-shift? | Reads of the emergency card work; **only 1 write in the app queues offline** | `queueWhenOffline` used once | Governance decision on which clinical writes may queue (handover, vitals, MAR) and how "not yet sent" is shown |
| Q4 | Two clinicians edit the same record? | Only a handful of endpoints check for conflicts (family history, refills, symptoms, verification) | API grep | Version check on editable clinical records; "Changed by X at 14:05 — review" |
| Q5 | Session expires mid-form? | Token refresh on 401; if refresh fails the save errors | `client.ts` ~l.684 | Re-sign-in in place, then resend the same submission |
| Q6 | Wrong patient? | Two same-name patients told apart only by a 32-char code | live | Two identifiers everywhere (UX_INVESTIGATION B1) |
| Q7 | Patient search tolerance? | **Whole words only** (keyed tokens — a privacy design): "Than" or "Tandiwe" finds nothing | `patient_search.rs` | Keep the privacy design; add find-by-scan (card/wristband), recent and assigned lists; say "use the full first or last name" in the box |
| Q8 | Empty, loading, error, partial, permission-denied, offline states | No load/console errors on 149 routes (sweep); **73 silent failures** in code; dashboards for 2 roles list wrong patients | sweep + code | State inventory per screen (below) |
| Q9 | Alerts seen? | Toasts vanish after 5 s, same for every severity | `Toast.tsx` | Tiered, persistent, clickable (UX_INVESTIGATION D5) |
| Q10 | Long names / longer languages (sw, zu, ha, am, fr)? | Not measured; 29 pages already overflow at 390 px in English | sweep | Re-run the sweep in each locale |
| Q11 | Printing a discharge summary or prescription? | 2 pages call `window.print` | code | Print stylesheet for the documents clinicians hand over |
| Q12 | Keyboard-only and screen-reader users? | 62 unnamed controls, 92/95 forms with unlinked errors, 340 tiny targets | sweep + code | Shared field kit; axe in CI per route |
| Q13 | Screens that say "nothing to do" but are wrong? | Nurse/doctor dashboards show the first 15/20 database patients | source | Assigned/care-relationship lists |
| Q14 | Data captured but never sent? | EMS "medicines given" (API field, no UI); "barcode scanned" set by a tick | code | Field added; flag set only by a real scan |
| Q15 | Data sent but never shown? | Doctor's pending consults (API returns, page never renders) | code | Render in "Today" |

**State inventory to require of every screen** (QA checklist practice; Apple HIG "show something
as soon as possible"): loading (skeleton matching the layout), empty (why + next action), error
(what happened + Retry), partial (some sections failed — say which), permission denied (why +
how to get access), offline (what still works), stale (data older than N minutes).

---

## 10. How leading teams keep front ends from leaking defects — and what we adopt

**Why the same defect recurs here:** 26 pages exceed 1,000 lines, 19 hold ≥ 20 separate state
variables, and there are only 25 shared components. Each page rebuilds its picker, buttons,
errors and pop-ups — so one mistake becomes 30, 67 or 145 copies.

| Practice | Who does it | Evidence | Adopt here |
|---|---|---|---|
| **A design system of tested components** | Shopify Polaris, Atlassian, IBM Carbon, GOV.UK, NHS | Atlassian reports resolving 6,000+ accessibility issues in a year by fixing components, not pages | `@medichain/shared` kit: PatientBanner, PatientPicker (two identifiers), ChoiceChips/Segmented, StaffSelect+Me, NowButton, NumberField, Sheet, ErrorSummary, Field (linked errors), WorkQueueItem |
| **One form engine** | GOV.UK form patterns; NHS "check answers" | — | `useClinicalForm`: carries patient context, one idempotency key per submission, draft + unsaved guard, error summary + focus, save → return to chart |
| **Make impossible states impossible** | statecharts / XState practice | Library: `frontend-component-architecture.md` §2 & §4 — "avoid contradictions", minimal state | One `status` per form (`idle · saving · saved · failed`) instead of separate booleans; reducers or a state machine for multi-step flows (handover, break-glass) |
| **Test like a user** | Testing Library guidance | Library: `frontend-testing.md` §1 — tests "should resemble how users interact" | Role journeys extended to the paramedic; per-route axe in Playwright; visual snapshots of the shared kit |
| **Static gates** | already a strength here (30 scripts) | — | New gates: no hand-rolled overlays; no `<select>` with ≤ 6 literal options; no raw `PAT-` in rendered text; every `<input>` inside a `<form>`; no `console.error`-only catch; no disabled submit without a reason |
| **Measure the work, not the screen** | 4,000-clicks ED study; NIST IR 7804 | 44% of ED physician time on data entry; 6–227 clicks per task | Keep `docs/ux-audit/` sweep; add click/keystroke counts per role journey, before/after |
| **Test with real users** | GOV.UK Service Standard points 1, 4, 5; Health Literacy Online | "Make sure everyone can use the service" incl. limited digital skills | 5 users per role (incl. a rural clinic and a paramedic crew) before and after each phase |
| **Design for the setting** | sub-Saharan mHealth studies | connectivity, data cost, literacy, local language | Offline-first for the paramedic; large targets; plain language; all 6 locales in the sweep |

**Library gaps, named:** no usability-heuristics, Fitts's-law or human-factors book in the
corpus; no observability material for front-end error monitoring. Those were taken from the web
sources below, not from memory.

---

## 11. Decisions needed from the owner
1. **Ward/unit assignment** creating time-boxed nurse care relationships (blocks nursing flows).
2. **Offline clinical writes:** may the ambulance handover (and later vitals/MAR) be queued on
   the device and sent later, shown as "Not sent yet"?
3. **Handover addressed to a hospital:** destination facility, ETA, pre-arrival alert and
   "Received" acknowledgement (API + data change).
4. **Mass-casualty casualties linked to patient records** when a card is scanned.
5. **Order of work** — recommended: shared kit + form engine first (fixes the most screens at
   once), then paramedic → ED, doctor "Today", lab work queue, nurse (after decision 1),
   pharmacist, admin, patient.

## Sources
Library: `frontend-component-architecture.md` §2, §4 · `frontend-testing.md` §1 ·
`frontend-platform-guidelines-apple-hig.md` §4 · `SEv3-ch10.pdf` p.16.
Web:
- Electronic prehospital records (Denmark): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7967689/
- Paramedic handover workarounds (Scotland): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6019792/
- Handover information loss: https://sjtrem.biomedcentral.com/track/pdf/10.1186/1757-7241-21-13
- 4,000 clicks ED study: https://ajemjournal.com/article/S0735-67571300405-1/fulltext
- Multi-centre EHR usability (8–9× variation): https://pubmed.ncbi.nlm.nih.gov/29982549/
- UI state QA checklists: https://www.hypermatic.com/articles/pixelay-error-state-and-empty-state-qa-workflow-from-figma/
- Atlassian accessibility in the design system: https://www.atlassian.com/blog/design/behind-the-screens-accessible-design-is-good-design
- IBM Carbon: https://preview.carbondesignsystem.com/getting-started/about-carbon
- Shopify Polaris: https://blog.getmanifest.ai/shopify-design-system/
- State machines for UI: https://leapcell.io/blog/building-predictable-and-robust-ui-components-with-state-machines
- GOV.UK Service Standard: https://www.gov.uk/service-manual/service-standard/point-5-make-sure-everyone-can-use-the-service
- NIST IR 7804: https://nvlpubs.nist.gov/nistpubs/ir/2012/NIST.IR.7804.pdf
