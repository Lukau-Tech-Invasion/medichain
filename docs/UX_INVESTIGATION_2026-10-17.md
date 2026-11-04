# Whole-application UX investigation — 2026-10-17

Status: **findings and proposed fixes, awaiting owner approval** (CLAUDE.md rule 6).
Companion to `docs/UX_SIMPLIFICATION_PLAN.md` (navigation, pop-ups, break-glass, handoff)
and the mockups in `docs/ux-mockups/`. **No form is removed or shortened** — every change
below removes clicks, typing, scrolling or confusion *around* the forms.

How each finding was established is stated beside it: **live** (driven in the browser as a
fixture account), **sweep** (automated visit of every route for every role), **code**
(static scan of all 156 `.tsx` files in both apps), or **source** (read in the API).

---

## A. The finding that decides whether "patient first" can work

### A1. A ward nurse cannot open her own patients — *live + source*
- The nurse dashboard's **"My Patients" (15)** is `patients.list(Pagination::new(0, 15))`
  — the first 15 patients in the database, not the nurse's patients
  (`api/src/clinical_endpoints/workflow/dashboards.rs`, nurse dashboard). "15" is the page size.
- Care relationships are only created by appointments, telehealth, referrals, break-glass and
  patient-approved grants (`api/src/care_access.rs` callers). **Nothing ties a nurse to a ward
  or a bed.** The fixture nurse has 0 active relationships and 0 active grants.
- So, live: tap a patient on *My Patients* → reason prompt → **dead end** (ask the patient, or
  break the glass with ≥10 typed characters). Same through *Record Vitals* → pick → reason →
  dead end.
- It also lists the names of patients the nurse has no relationship with — a privacy
  problem as well as a usability one.
- Evidence for the fix: Anderson, *Security Engineering* 3e ch.10 p.16 (library) — the rule that
  worked at hospital scale was "a ward nurse can see the records of all patients who have within
  the previous 90 days been on her ward".
- **Owner decision needed (policy):** a ward/unit assignment (or admission-to-ward) that creates a
  time-boxed care relationship for the nurses on that unit and shift. Until then, every routine
  nursing task starts with break-glass or a patient approval.

---

## B. Patient identification (safety) — *live + code*

| # | Finding | Fix |
|---|---|---|
| B1 | Patient picker shows two **"Thandiwe Ndlovu"** distinguishable only by a 32-char `PAT-…` code. The component already holds `date_of_birth` and `health_id` but does not show DOB. | Every patient row and banner shows **name + DOB/age + sex + health ID** (two identifiers, Joint Commission NPSG.01.01.01; NIST IR 7804 "reserved area… two patient identifiers"). Warn when a search returns same-name patients (ONC pick-list report). |
| B2 | Dashboards, toasts and lists show raw `PAT-` UUIDs (nurse dashboard, CDS toast, patient dashboard). | Show formatted health ID; never the internal key. |
| B3 | Forms opened for a patient have no persistent patient banner with allergies. | One banner on every patient-scoped screen: identifiers, allergies, code status (mockup `c3`). |

---

## C. Clicks and typing around every form — *code*

| # | Count | What | Fix | Saves |
|---|---|---|---|---|
| C1 | **48 forms** | re-ask for the patient (`<PatientSelect>`); 9 read it from the URL | Open from the chart; read `?patient=`; picker only when opened cold. WCAG 2.2 **3.3.7 Redundant Entry** (library: `frontend-accessibility-wcag.md` §3) | search + select + reason ≈ 4 actions per form |
| C2 | **8 forms** | after Save, `setTimeout(() => navigate('/dashboard'), 2000)` | Return to the patient's chart, with "Saved" and the next likely action | re-finding the patient ≈ 3–5 actions |
| C3 | **145 dropdowns** in 64 files | fixed 2–6 options in a `<select>` (open, scan, pick) | Segmented buttons / chips: options visible, one tap, nothing pre-selected (rule 9) | 1 tap each |
| C4 | **14 fields** | type a colleague's name — surgeon, scrub nurse, witness, *outgoing nurse (yourself)* | `StaffSelect` (exists, used on 3 pages) with "Me" as a one-tap choice; links the record to a real account | typing + misspellings |
| C5 | **9 prompts** | modal asks to *type* a reason (cancel appointment, recollection, reversal…) | Common reasons as one-tap chips + "Other" | typing |
| C6 | **71 date/time fields** | typed or picker-driven | "Now" button (not a default — rule 9) | picker navigation |
| C7 | **30 numeric fields** | no numeric keypad on phones/tablets | `inputMode="decimal"`/`numeric` | keyboard switch |
| C8 | — | Last recorded values not shown beside the form | "Last: 08:00 · BP 128/82" panel (mockup `c3`) | flipping to the chart |
| C9 | **63 of 94** pages with fields | no `<form>` element: Enter does not save or search; no form landmark for screen readers | Wrap in `<form onSubmit>`; Enter submits | a click per save/search |
| C11 | **0 of 4** note forms | Templates built on *Note Templates* (`getNoteTemplates`/`useNoteTemplate` exist) are offered by no note form — SOAP, Progress, Consult, Discharge | "Insert template" in each note; inserted text is shown as editable draft, never saved unseen (rule 9) | typing a whole note |
| C12 | MAR | "Barcode scanned" is a **self-ticked checkbox** (`MedicationAdminPage.tsx` ~l.766) and is stored as `barcode_scanned: true`; nothing is scanned. A real camera scanner exists on `BarcodePage.tsx` (`BarcodeDetector`/`getUserMedia`) | Scan wristband → patient opens; scan medicine → matching order selected; the flag is set only by a real scan. BCMA studies: 23–56% fewer administration errors | patient search + order pick → 2 scans |
| C10 | **19 forms** with ≥ 20 controls (Autopsy 36, Death certificate 33, SOAP 32, H&P 29, Handoff 26, Anaesthesia 26…) | one long scroll, no way to jump | Sticky section index ("Jump to: History · Exam · Plan") + "More details" folding for rarely used parts; nothing removed | scrolling |

---

## D. Feedback when something goes wrong — *code*

| # | Count | Finding | Fix |
|---|---|---|---|
| D1 | **67 buttons** in 39 files | Submit disabled until valid — user can't tell why | Keep enabled; on press, say what's missing (GOV.UK Design System: avoid disabled buttons; poor contrast, not focusable) |
| D2 | **0** | Failed submit never moves focus/scroll to the first error (`useValidatedForm` has no focus handling); on a 5-screen form Save "does nothing" | Error summary at top + focus first invalid field |
| D3 | **92 of 95** form pages | Field errors not linked to the field (`aria-invalid`/`aria-describedby`). The shared `useFieldA11y` helper exists and **no page uses it** | Adopt the helper in the shared field components |
| D4 | **73 handlers** in 57 files | Errors only `console.error` — e.g. patient list fails to load → empty picker, no message | Visible message + Retry |
| D5 | — | Clinical alerts (CDS, lab results) are **toasts that vanish after 5 s**, name the patient by UUID, same style for every severity, can't be opened | Tiered: critical stays until acknowledged and links to the patient; low-severity goes to a list. Alert-fatigue evidence: ~90% of interruptive alerts overridden; make only high-severity interruptive |

---

## E. Finding your way — *code + live*

| # | Finding | Fix |
|---|---|---|
| E1 | Doctor sidebar **52** items (nurse 25, admin 22) | Favourites + Recent patients on top; groups collapsed (mockup `c2`/`c3`) |
| E2 | Ctrl+K palette: **36 hand-written entries** vs ~100 routes, not role-filtered, no patient search | Generate from `navigation.ts` per role; search patients; actions like "Vitals for Thandiwe" |
| E3 | Staff sign-in username field has no label (screen reader reads "e.g. dr.mbeki") | Visible label |
| E4 | Paramedic phone: card-tap simulator and security notice come before the patient's blood type | Patient card first after a tap |

---

## F. Comfort and accessibility basics — *code*

| # | Count | Finding | Fix | Source |
|---|---|---|---|---|
| F1 | **170** animations, **0** reduced-motion guards | Pulsing banners, spinners, slide-ups ignore the OS "reduce motion" setting | `motion-safe:`/`motion-reduce:`; substitute, don't delete | library `frontend-motion-and-animation.md` §3 |
| F2 | **909** `text-xs` (12 px) | Clinical values and captions at 12 px | 14 px minimum for data, 16 px body | Health Literacy Online (≥16 px); library typography §1 |
| F3 | 17 sticky headers, 4 scroll-margin rules | Focused field can scroll under the sticky header | `scroll-margin-top` globally | WCAG 2.2 **2.4.11** (library §3) |
| F4 | 0 | No `forced-colors` handling | Check focus rings/borders in Windows high contrast | library colour §9–10 |

---

## G. Every route, every role — *sweep*

149 routes across 7 roles (every link in each role's navigation), visited as the fixture
account for that role at 1280×800, then re-measured at 390 px wide. Script and raw results:
`docs/ux-audit/ux-sweep.mjs`, `docs/ux-audit/ux-sweep-2026-10-17.json`.
**Limitation:** forms are measured as they first open — before a patient is chosen — so form
length is under-counted here; §C10 covers it from the code.

| # | Finding | Pages | Fix |
|---|---|---|---|
| G1 | **Sideways scrolling on a phone** (up to 347 px) | **29** — User management 347, Consult 216, Immunisation 186, Chain of custody 164, Specimen 160, Note templates 144, Doctor dashboard 98, Operative note 93, Burn 89… | Tables become stacked rows below 640 px; grids collapse to one column (WCAG 1.4.10 Reflow, library `frontend-layout-and-responsive.md` §5) |
| G2 | **Raw `PAT-…` codes on screen** | **35 pages, 506 occurrences** (Care plan 36, Burn 35, Cardiac 35, Patients 35, Pre-op 35, Fall risk 35, I/O 35, IV site 35…) | Name + DOB/age + health ID (B1) |
| G3 | **Targets smaller than 24 px** (WCAG 2.5.8) | **26 pages, 340 targets** — mostly native checkboxes/radios in scored tools: Fall risk 45, Toxicology 39, Pre-op 37, Psych 36, Obstetrics 34, Cardiac 28 | Whole row is the target (label wraps control, ≥ 44 px tall) |
| G4 | **Controls with no accessible name** | **35 pages, 62 controls** — search boxes named only by placeholder, filter `<select>`s with no label, Toxicology's 7 number inputs | Visible or `aria-label`led names |
| G5 | **Very long pages** | User management **51 screens** (70 on phone) — every one of 79 accounts drawn as a tall card, no paging; Patient access history 13.5; Patient records 12.4; I/O 10.6; Note templates 10 | Compact rows + search + paging (20 at a time); group history by day |
| G6 | Good news | 0 navigation links that redirect elsewhere; 0 load errors; 0 console errors; every page has an `<h1>`. Median page: 1.1 screens desktop, 1.8 phone | — |

---

## P. Patient app — beyond the navigation already planned
| # | Finding | Fix |
|---|---|---|
| P1 | Booking: provider → date → slots; a date with no free slot is a dead end | "Next available" slots across the coming days, one tap to book |
| P2 | Navigation, pop-ups, record scrolling, raw ID | see `UX_SIMPLIFICATION_PLAN.md` and mockups `p1`–`p6` |

---

## Proposed order of work (each step shippable and measured)
1. **Shared building blocks** (one change, felt everywhere): patient banner with two identifiers;
   `Sheet`; segmented/chip choice; `StaffSelect` with "Me"; "Now" button; numeric keypads;
   error summary + focus first error + linked field errors (adopt `useFieldA11y`); enabled
   submit buttons; `<form>` + Enter; reduced-motion and minimum text sizes; `scroll-margin-top`.
2. **Patient first** in the clinician portal: chart action bar; 48 forms read the patient from
   the chart; return to the chart after save (C1, C2); picker shows DOB/sex/health ID (B1).
3. **Silent failures and alerts**: 73 handlers show a message + Retry; tiered, persistent,
   clickable clinical alerts (D4, D5).
4. **Patient navigation and records** (mockups `p1`–`p6`).
5. **Break-glass one tap; handoff from the shift's records** (mockups `c1`, `c2`).
6. **Templates in notes; real barcode scanning in MAR; section index on long forms** (C10–C12).
7. **Sidebar favourites/recent; role-filtered palette with patient search** (E1, E2).
8. Re-run this sweep and the click counts; publish before/after.

**Blocked on the owner:** A1 (ward/unit assignment creating nurse care relationships) — without
it, step 2 helps doctors with appointments but every ward nurse still meets a lock.

## H. What is already good (keep it)
- Language switching sets `lang` and `dir` (6 locales).
- Pages are code-split; first load ≈ 200 KB gzip — acceptable on 3G.
- Break-glass, reason prompts and audit wording are honest and patient-visible.
- `confirmDialog`/`promptDialog` replaced native dialogs; contrast gates exist.

---

## Sources
Library (`C:\Users\Admin\Downloads\Books-master\Books-master`):
- `knowledge-base/sources/external/frontend-accessibility-wcag.md` §3 (WCAG 2.2 new criteria)
- `…/frontend-forms-and-validation.md` §5 (error messages), §11 (multi-page forms)
- `…/frontend-motion-and-animation.md` §3 (reduced motion)
- `…/frontend-typography-and-fonts.md` §1 (minimum sizes)
- `…/frontend-platform-guidelines-apple-hig.md` §4 (loading), §7 (modality), §12 (undo)
- `free-library/07-security/security-engineering-3e/SEv3-ch10.pdf` p.16 (hospital access rules)
- **Gap:** the library has no usability-heuristics or Fitts's-law material; not cited from memory.

Web:
- NIST IR 7804 (EHR usability; patient identification): https://nvlpubs.nist.gov/nistpubs/ir/2012/NIST.IR.7804.pdf
- Joint Commission NPSG.01.01.01: https://www.jointcommission.org/-/media/tjc/documents/standards/national-patient-safety-goals/2023/npsg_chapter_ahc_jul2023.pdf
- ONC pick-list safety report: https://www.healthit.gov/sites/default/files/report-on-the-safe-use-of-pick-lists-in-ambulatory-care-settings.pdf
- Health Literacy Online: https://odphp.health.gov/healthliteracyonline/health-literacy-online-glance
- Avoiding disabled buttons: https://tempertemper.net/blog/how-to-avoid-disabled-buttons · https://designsystem.gov.scot/components/button
- NHS design system patterns: https://service-manual.nhs.uk/design-system/patterns/check-answers · https://service-manual.nhs.uk/design-system/components/summary-list
- Alert fatigue: https://pmc.ncbi.nlm.nih.gov/articles/PMC9754301 · https://www.fiercehealthcare.com/ehr/study-many-ehr-drug-alerts-need-not-be-intrusive
- Barcode medication administration: https://psnet.ahrq.gov/issue/effect-bar-code-assisted-medication-administration-medication-administration-errors-and · https://pubmed.ncbi.nlm.nih.gov/24033623
- WCAG 2.2 What's New (3.3.7 Redundant Entry, 2.5.8, 2.4.11): via library note `frontend-accessibility-wcag.md` §3
- mHealth in sub-Saharan Africa: https://www.frontiersin.org/journals/public-health/articles/10.3389/fpubh.2024.1368631/pdf
