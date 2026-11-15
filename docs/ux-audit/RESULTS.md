# UX implementation — results (2026-10-31, second pass)

Plan: `docs/UX_IMPLEMENTATION_PLAN_2026-10-30.md`. Branch `feature/frontend-ux`.
Not committed.

## What was built, by phase

| Phase | Done | Proof |
|---|---|---|
| 0 Measurement | `scripts/ux-sweep.mjs`; baseline `ux-sweep-2026-10-17.json` | — |
| 1.1 Form engine | `useSubmission` (one key per submission, duplicate → "Already saved", offline → queued), unsaved-changes guard, memory drafts, sign-out guard | `test/forms/submission.test.tsx` |
| 1.2 Kit | `NumberField`, `NowButton`, `StatusBanner`, `WorkQueueItem`, `ChoiceChips`, `Sheet`, `ErrorSummary`, `SubmitButton`; "Me" on `StaffSelect`; two identifiers and a same-name warning in `PatientSelect` | `test/forms/clinicalKit.test.tsx` |
| 1.3 Gates | `scripts/check-ux-patterns.py`, seven rules ratcheted per file, in CI | Seeded file fails all seven; tree passes. Runtime colour classes already 10 → 5 |
| 1.4 Cross-cutting | Reduced motion for every animation; `text-xs` raised to 14 px; scroll margin under sticky headers; staff label no longer promises "work email" (the server only matches the login id); step-up label neutral for patients; error toasts stay until dismissed, all toasts hold on hover/focus | Toast tests |
| 1.5 Migration | 13 forms return to the patient's chart after save instead of the dashboard (`useReturnAfterSave`) | `workspace/useReturnAfterSave.test.tsx` |
| 1.6 Workspace | `/patients/:id/:form`, banner, rail, "This visit", Close patient; 58 forms adopt the open patient | `workspace/*.test.ts(x)` |
| 2 Ambulance run | Run record API (FSM, device-chosen ids, owner-only writes, facility-filtered board, receipt → encounter); run page; incoming board; encrypted offline queue with 24 h expiry; MCI scan link | 17 API tests; `offlineSeal.test.ts`; `runSummary.test.ts` |
| 3 Today | `GET /api/dashboard/doctor/today` — caller-scoped patients, appointments, consults, refills, results, critical values, with failed sources named; `/today` page first in the doctor's nav | API test: another doctor's patient never listed; page tests |
| 4 Lab | Queue rows open result entry for that patient, grouped by stage; reason prompts offer chips; a critical result opens the notification pre-filled | Lab page tests |
| 5 Nurse | `wards`, `ward_shift_assignments`, `patient_admissions`; `ward_assignment` chart authority; roster screen (Class C); admit/discharge from the workspace; "My patients" from the roster; patient-scoped admissions read; MAR scan must match the order's label; handoff drafted from the shift's audited writes | Memory + **PostgreSQL** tests: off shift, other ward, cancelled shift, discharged → denied |
| 6 Pharmacist | Reject / revoke / reversal reasons as chips plus free text | Pharmacist tests |
| 7 Admin | User list 20 per page | User management tests |
| 8 Patient | Five-tab bar on phones; the invisible active state fixed (it was a runtime-built class Tailwind never emitted); records grouped by month; readable health ID; "Next available day" booking | Patient tests |

## Second pass (owner approved 2026-10-31)

* **MCI vitals (rule 9):** a new casualty starts with no vitals; RR, pulse and
  capillary refill are `NumberField`s, mental status and sex are chips. It used
  to start at RR 16, pulse 80, cap refill 2, alert — which the server stored and
  scored as Delayed. Age, sex and complaint are absent unless entered.
* **`PatientChartRoute` deleted** (approved).
* **Ambulance strip** on the workspace chart and in triage; "Use crew vitals"
  fills only fields the nurse has not typed.
* **Paramedic journey** added to `scripts/role-journeys.ts`
  (`scripts/journeys/paramedic.ts`): start → vitals → leave (pre-alert) → board
  → handover → receipt → closed → read back by the nurse and the patient.
* **Pharmacist:** interactions for that patient and drug shown on the queue row.
* **Patient Home:** emergency card first.
* **Record documents:** empty fields collapse into one closing
  "Not recorded: …" line (`collapse_unrecorded` in `ipfs_records.rs`); five
  document tests updated to the new contract.
* **1.5 migration:** vitals, SOAP, progress note, intake/output and MAR now save
  through `useSubmission` (`submitOnce`): one key per submission, so a double
  tap or a retry writes once.

## Verification run 2026-10-31

* API: full `cargo test --bin medichain-api` **1068 passed, 0 failed** on
  PostgreSQL (before the document change; the document and collapse tests were
  re-run after it: 15/15). `clippy --all-targets -D warnings` clean, `cargo fmt`
  clean.
* doctor-portal vitest **909/909** (162 files), patient-app **284/284**
  (45 files), both typecheck clean.
* All `scripts/check-*.py` gates pass; the UX ratchet now stands at raw patient
  ids 53, short selects 143, runtime colour classes 5.

## Third pass (owner: "do make all", 2026-10-31)

* **1.5, value-returning forms:** triage, orders, lab results, e-prescribe and
  discharge save through `submitForReply` (`forms/submission.ts`): only a fresh
  save carries the server's reply; "already saved" and "queued" say so instead
  of showing an id the page does not have. E-prescribe's create, sign and
  transmit are one submission. Discharge files its summary once: when the
  take-home instructions fail after it, Save again sends only the
  instructions, against the summary already filed.
* **Triage thresholds (rule 8):** the "Critical values detected" badge reads
  the catalogue's vital bands. The page's own copy disagreed with the server
  on four of six limits (RR 35 vs 30, SBP 80/220 vs 90/180, temp 40 vs 39.5,
  SpO2 90 vs 92), so an SpO2 of 91 alerted on the server and not on screen.
* Orders no longer sends `cosign_required: false` (uncollected; the server
  defaults it).
* Two crash-on-malformed-reply defects from this campaign fixed:
  `AmbulanceRunStrip` and `AdmissionControl` threw unhandled rejections on a
  reply without their list; both now show "unknown".
* **Seeder never ran under vite-node:** `seed-browser-test-fixtures.ts`
  checked `argv[1]` to decide whether to run, and vite-node removes the
  script's path from argv, so the documented command exited 0 having written
  nothing (since `bfabd9e`). The showcase seeder now imports
  `scripts/lib/seed-as-library.ts` first instead.

## Live runs 2026-10-31

On a throwaway database, `medichain_ux_20261031`, API built from this tree on
:8090 (`run-browser-e2e-api.sh`). The demo database was not touched.

* Role journeys **282/282**, 3 skips (2 pharmacist, as before; 1 paramedic,
  below). With facilities assigned (`POST /api/demo/seed-facilities`) the
  paramedic journey runs end to end: **21/21**.
* Cross-role qualification **163/163**.

## Findings recorded, not acted on

* **No real deployment can receive an ambulance.** The incoming board and the
  pre-alert need the receiving nurse's facility
  (`identity_contexts.facility_id_for_user`). The only thing that assigns one
  is the dev-demo `POST /api/demo/seed-facilities`. Its in-memory assignment
  is lost on restart, and `organization_assignments` is written but never read
  back. An admin screen to assign staff to a facility, loaded at startup, is
  needed. That is a design decision for the owner.
* A pending access request from `bt.doctor` to `btpatient` was left open during
  browser testing.

## App separation, step 1: the patient surface (2026-11-01)

Plan and design: `docs/PATIENT_SURFACE_PLAN.md` (owner-approved). A patient
session is refused (`403 PATIENT_SURFACE_ONLY`) on every route not listed in
`api/src/middleware/patient_surface.rs` — 138 routes, built from what the patient
app and the Expo app call — before a handler runs. `api/build.rs` generates the
table of every registered route so the check matches the router exactly,
method included; actix's resource map, the first attempt, answers by path
alone and the API test caught it letting `GET /api/patients/list` through.

* API tests: 5/5 (a patient is refused on every unlisted route of ~560 and on
  no listed one; staff are refused nowhere; a `Patient` role claim is walled
  with no account record behind it).
* `scripts/check-patient-surface.py` (in CI): every patient-app call is on the
  surface; seeded with two removals, it fails naming both.
* Live, throwaway database `medichain_ux_20261031`, API built from this tree:
  role journeys 281/282 → one patient step refused, symptom-checker history
  (`GET /api/symptoms/history/{patient_id}`), a patient's own record with no
  screen yet; added → patient journey **107/107**. Cross-role **162/162**.
  The only refusal logged across every run is the journey's deliberate
  `POST /api/clinical/vitals` as a patient.
* Patient-app Playwright (local API): 113 passed, 6 failed, none from the
  wall. Fixed: the focus-under-bar check measured mid smooth-scroll (it now
  waits for the scroll to settle; a bottom scroll margin was added for the
  phone tab bar), and the activation check gave a 9-15 s debug-build Argon2id
  redemption the default 5 s. Both re-run green on mobile and desktop.
  Not fixed, recorded: the deployment-reload check needs a production build
  (under the Vite dev server no `/assets/*.js` chunk is ever requested, so
  nothing reloads; fails on desktop only); the notification-history check
  needs notifications the emergency specs create first.
* Found, not fixed: the Expo family screen calls `GET /api/family/groups`,
  which is not a registered route.

## Screen completion, batch 1: shared kit and nurse (2026-11-01)

Plan: `docs/UI_COMPLETION_PLAN_2026-11-01.md` (owner-approved, patient app included).

* **Checker made precise, not weaker** (`scripts/check-ux-patterns.py`): raw
  patient ids are looked for only in `.tsx`; an `overlayClassName` handed to
  `ModalPanel` is the sanctioned overlay; a deliberate case carries
  `ux-allow(rule): reason` on the line (a marker without a reason does not count).
* **Shared:** activation, break-glass and the prompt dialog no longer grey out
  a button to mean "not yet" — pressing it names what is missing. The step-up
  dialog moved onto `ModalPanel` (focus trap, Escape, scroll lock). New:
  `PatientName` (name + date of birth instead of `PAT-…`), `keepEnterInField`
  (Enter in a builder form's small fields does not file the record).
* **Nurse menu, 25 pages: 56 findings → 0.** Short dropdowns are one-tap chips;
  every editor is a real form; raw ids show name and date of birth.
* **Defects found and fixed on the way:**
  * Code Blue's save had no in-flight guard (only the greyed button stopped a
    second resuscitation record); it now goes through `useSubmission`.
  * Code Blue's history and IV Site's site list showed "none" when the read
    *failed* — now an error saying not to assume none (rule 12's reasoning).
  * Care Plan's recent-plans list failed silently.
* Totals across both apps: 312 → 288. doctor-portal vitest 912/912,
  patient-app 284/284, both typecheck clean, all gates pass. Nurse journey
  43/43 against the live API.

## Screen completion, batches 2–7: every hospital screen and the patient app (2026-11-01)

**All seven interface defect classes are at zero** in `client/doctor-portal`,
`client/patient-app` and `client/shared` — `scripts/ux-patterns-baseline.json`
is empty, so any new instance fails CI. 312 (hospital) + 43 (patient) + 23
(shared) instances fixed; the deliberate exceptions each carry a
`ux-allow(rule): reason` marker (full-screen video calls, native `<dialog>`s,
the mobile-drawer backdrop, live-filter search boxes, chat send buttons,
controls embedded in other pages' forms).

What changed for people using the screens:
* **One-tap choices**: ~150 short dropdowns are now chips (pain score 0–10,
  NPO, Killip class, triage priority, appointment type…). Nothing chosen still
  means "not recorded" — unchosen is never a default.
* **Every editor is a real form**: Enter submits where it should; in builder
  forms (care plan, handover, CDS rules, order sets, family history) Enter in
  a small "add" field does not file the record (`keepEnterInField`).
* **No greyed-out button that cannot say why**: pressing it names what is
  missing. Buttons are only marked busy while a request is in flight, and
  every handler refuses a second press itself.
* **Patients are shown by name and date of birth** (`PatientName`), not
  `PAT-…`.
* **Failures are said in words.** Several screens showed "none" when a read
  had *failed*: Code Blue, Trauma, Stroke, Cardiac and Sepsis history; IV
  sites; the lab and pharmacist dashboards showed **0 STAT / 0 pending**;
  analytics' outstanding events; patient insurance, lab trends, wearables,
  consent forms. Each now says the data is unknown, not empty (rule 12).
* **Hand-rolled pop-ups** moved onto `ModalPanel` (focus trap, Escape, scroll
  lock): step-up, command palette, chart-access prompt, print previews, H&P
  record, patient clinical details. Patient-app loading veils became inline.

Defects found and fixed on the way:
* **Duplicate clinical records on a double click**: Code Blue, Trauma and
  Stroke had no in-flight guard at all (only the greyed button prevented a
  second record); they now use `useSubmission`. Death-certificate drafts and
  blood-unit actions likewise.
* The shared `Button` had no default `type`, so inside any form it submitted;
  it now defaults to `type="button"`.
* Browser-test sign-in still used the pre-1.4 label ("Employee ID or work
  email") — every browser run failed at sign-in; fixed in `e2e/support.ts` and
  `all-routes.spec.ts`.

Verification: doctor-portal vitest **912/912**, patient-app **284/284**, both
typecheck clean; every `scripts/check-*.py` gate passes; role journeys
**282/282** (3 skips); cross-role **162/162** — all against the API built from
this tree on a throwaway database.

## Browser pass, 2026-11-03

The doctor-portal Playwright suite (local-api config, throwaway database
`medichain_ux_20261031`) was rerun against the finished screens. Its 29
failures split into tests still driving the old controls, and real defects.

Real defects found and fixed:
* **Choosing a patient threw the form away.** On a page that opens on a list
  (lab results, specimens, laceration, autopsy, …) the picker sits behind a
  tab. Picking a patient moved the page into the patient workspace, which
  remounted it on its first tab: the lab technician landed back on the review
  queue with the result they were entering gone. The picker now moves into the
  workspace only if it was on screen before the person did anything on the
  page (`PatientSelect`, `appearedAfterInteraction`). Specimen tabs are now
  real `role="tab"`s.
* **The nurse's ward panel always said it could not load.** The API client
  unwraps any reply carrying a `patients` array to that bare array; the ward
  reply carries `shifts`, `wards` and `patients`, so the panel saw an array
  and reported a failure on every load. **The shift-handoff draft had the same
  fault silently**: `.patients` of the unwrapped array was undefined, so the
  draft always showed nobody. Both now keep the envelope; a test through the
  real client (`src/api/envelopes.test.ts`) covers them, because the page
  tests mock these functions and could not see it.
* **An error toast covered the Save button.** Errors stay until dealt with,
  and they sit bottom-right, where most forms keep Save; fixing the field left
  the button unclickable. Changing any field now clears error toasts.
* **Radiology was unreadable in the light theme** (1.72:1): the reading room is
  dark in both themes but its chips took light-theme text. The page now scopes
  the dark tokens (`class="dark"`).
* **Admin user list pagination**: the disabled "Previous" measured 3.32:1;
  now muted tokens instead of opacity.
* **The admin dashboard had no heading** while loading or after a failed load;
  it now names itself in every state, and the failure is an `alert`.

Test updates (no product change): a `choose()` helper answers a chip group or
a dropdown by the same id; the paramedic home is `/ems-run`; the ledger lists
the six routes the redesign added; cards and tables are matched by patient
name (or `data-patient-name-of`) rather than `PAT-…`; Code Blue's refusal is
asserted in words, and it returns to the patient's chart when opened there.

Not a product defect, left as found: Doctor #2's patient-approved grants to the
fixture patient are all revoked in this cohort, so the splint and Code Blue
"colleague reads it" steps meet the chart-access prompt. Re-running
`scripts/seed-browser-test-fixtures.ts` renews them; it approves access as the
patient, so it is left for the owner to run.

Result of the pass:
* **Doctor portal**: after the fixes, the failing specs rerun green —
  all-routes, colour sweep and WCAG for Doctor, Admin and Paramedic, journeys,
  emergency read and both lab-result workflows (**28/28**), plus 31 of the 35
  workflow specs. Still failing: splint and Code Blue "colleague reads it"
  (Doctor #2's revoked grants, above).
* **Patient app**: **111 passed, 5 failed, 15 skipped** in the full run. Rerun
  alone, four of the five pass (profile phone + emergency contact readback,
  two-tab sign-out, colour sweep, mobile all-routes). The remaining one is
  all-routes on desktop: one deep link per run renders nothing (`/medications`
  in the first run, `/vitals` in the second). The trace shows the Vite dev
  server aborting the `shared/src/i18n` module requests on that load, so the
  app never mounted; both routes open in about a second when loaded directly.
  Dev-server flake, not a page defect, but it is recorded here rather than
  called green.
* Unit: doctor-portal **913/913** (new `src/api/envelopes.test.ts`),
  patient-app **284/284**; every `scripts/check-*.py` gate passes.
