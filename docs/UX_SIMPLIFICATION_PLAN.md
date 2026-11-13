# UX simplification plan — 2026-10-17

Status: **proposed, awaiting owner approval** (CLAUDE.md rule 6). Nothing is removed:
every existing page stays reachable; what changes is how you get there and how much
you have to type, click and scroll once you arrive.

## 1. What was measured

Live, against the Docker stack, as the fixture patient, at 375px (phone) and 1280px (laptop);
plus a static sweep of all 116 page files in both apps.

| # | Finding | Evidence |
|---|---|---|
| F1 | The patient top bar never shows which page you are on, and the logo tile has no colour. `bg-${brandColor}-50` is built at runtime, so Tailwind never generates it. | `Layout.tsx:279,301` — computed `background-color` of the active link and the logo is `rgba(0,0,0,0)` |
| F2 | The bell's dot is the live-connection status (blue = connected, red = disconnected), not unread notifications. A red dot reads as "you have something urgent". | `Layout.tsx:327-329` |
| F3 | Phone menu: 26 links in 5 sections, **2.6 screens** of scrolling. No bottom navigation. Desktop top bar: 6 links + "All pages" + bell, with Settings as a top-level item. | measured in the open drawer |
| F4 | Duplicate icons (Activity for Vital Signs *and* Symptom Tracker; Bell for Reminders *and* Notifications) and overlapping names: "Medical ID" vs "Emergency Card"; "Access Control" vs "Who Viewed My Records" vs emergency-access history. | `Layout.tsx:161-213` |
| F5 | Reading a document takes 3 clicks (row → details pop-up → View), and the details pop-up repeats what the row already shows. | live |
| F6 | The second pop-up opens **on top of** the first — two dialogs open at once. | both `dialog[open]` present |
| F7 | The document preview is **2972px of text in a 619px box (4.8 screens)**, mostly lines saying "Not recorded", in raw `key: value` form with ISO timestamps and `true/false`. | `api/src/handlers/ipfs_records.rs:1547` dumps every field alphabetically |
| F8 | My Records: 75 records = 12.3 screens, no date grouping. | live |
| F9 | Break-glass: choose a reason, get refused, then see the patient-request form and the break-glass form stacked, and **type at least 10 characters** before the button enables. | `ChartAccess.tsx`, `BreakGlass.tsx`; backend `MIN_REASON_CHARS = 10` |
| F10 | Shift handoff: patients added one at a time through a picker; each patient has ~17 empty free-text fields; nothing is drawn from what the nurse recorded during the shift. | `ShiftHandoffPage.tsx` (16 inputs, 5 textareas) |
| F11 | 48 clinical forms ask the clinician to pick the patient again; only 9 read the patient from the URL. No form keeps a draft if the clinician is interrupted. | static sweep |
| F12 | Doctor sidebar has 52 items (nurse 25, admin 22). Forms are reached as global pages, then a patient is chosen — the opposite of how a clinician works (patient first, then the task). | `config/navigation.ts` |
| F13 | 30 page files hand-roll their own overlay (`fixed inset-0`) instead of the shared `ModalPanel`; three dialog implementations exist. | static sweep |
| F14 | Dashboard shows the raw 32-character `PAT-…` id as the "Health ID", and five identical "viewed Mental health assessments" lines. | live |

## 2. What the evidence says

- **Navigation bar: 3–5 destinations of equal importance; more than five → rail/drawer.**
  Material 3 (library: `knowledge-base/sources/external/frontend-material-design-and-android.md`
  §components; web: Android/Fiori M3 usage pages).
- **NHS App 2025 redesign:** bottom bar with only **Home, Messages, Profile**; services grouped
  into clear categories on Home; tested with 1000+ users incl. accessibility research.
- **Modality** (library: `frontend-platform-guidelines-apple-hig.md` §7): present modally only with
  a clear benefit; keep it short; **never stack modals**; always an obvious way out.
- **Forms** (library: `frontend-forms-and-validation.md` §1, §11): mark optional fields when most are
  required; save what was entered when moving between steps. GOV.UK *Question protocol*: justify
  every question you ask.
- **Target size** (library: `frontend-layout-and-responsive.md` §4): WCAG 2.2 SC 2.5.8 24×24px
  minimum; 44–48px for primary touch targets.
- **Hospital access in practice** (library: Anderson, *Security Engineering* 3e, ch.10 p.16): the
  workable rule was "a senior doctor can see any record, but the responsible clinician is
  **notified**" — access then accountability, not prose before access. Ferreira et al. 2013
  (break-the-glass log analysis): clinicians routinely circumvent controls that block daily work.
- **Handoff automation:** an I-PASS tool combining auto-compiled EHR data with clinician input cut
  errors introduced into handoff documents by **46.6%**; I-PASS itself cut medical errors 23% and
  preventable adverse events 30%.
- **Documentation burden:** ED nurses spend 27% of a shift in the EHR vs 25% at the bedside; a
  workflow redesign removed 88–97% of the steps for reassessment documentation.

Not in the library: bottom-sheet specifics and clinical-documentation studies — the web sources
above were used for those.

## 3. The plan

### Phase 0 — per-page walk (first task, produces the ledger)
Walk every route for every role at 375px and 1280px; for each page record clicks, keystrokes and
screens-of-scroll for its main task. Output: `docs/UX_PAGE_LEDGER.md`. This is the baseline every
later phase is measured against, and the before/after numbers go in the register.

### Phase 1 — patient navigation (F1–F4, F14)
- **Phone: bottom bar, 5 tabs** — **Home · My health · Appointments · Messages · Me**.
  Labels always visible under icons, 48px targets, safe-area padding, current tab marked with
  `aria-current` and a visible indicator.
- **Desktop/tablet: the same five** in the top bar (or a rail ≥ 840px). No "All pages" drawer.
- Every one of today's 26 pages stays, reached from its hub:
  - *Home*: Emergency card (QR/NFC) first, then today's reminders, latest results, next appointment.
  - *My health*: Records, Lab results & trends, Medications & reminders, Vitals, Symptoms, Wearables, History.
  - *Appointments*: Appointments, Telehealth.
  - *Messages*: Messages, Notifications.
  - *Me*: Profile, Health ID card, Family, Insurance, **Privacy** (Who can see my records, Who viewed my records, Emergency access history), Language, Offline sync, Survey, Settings, Sign out.
- Plain names: Dashboard → **Home**; Access Control → **Who can see my records**; Medical ID →
  **Health ID card**; one distinct icon per destination.
- Fix F1 with literal classes; bell dot shows **unread count only**; connection state becomes a
  small text status, not a coloured dot.
- Show a short, readable Health ID (formatted, copy button) instead of the raw `PAT-` UUID;
  collapse repeated access-history lines ("viewed Mental health assessments ×5").

### Phase 2 — pop-ups and scrolling (F5–F8, F13)
- One shared `Sheet` primitive: bottom sheet on phone, centred `max-w-lg` on desktop,
  `max-h-[85dvh]`, sticky header and **sticky action bar** (Download/View reachable without
  scrolling), compact padding. Migrate the 30 hand-rolled overlays onto it.
- Tapping a record opens the document directly; Download sits on the row. The details step
  goes; its lab table moves into the document view. Never two dialogs at once.
- Document text (backend renderer): important fields first (findings, impression, result),
  empty fields collapsed into **one line** — "Not recorded: addendum, communicated at, …"
  (rule 12 preserved: still says what was not measured), readable dates, Yes/No.
- My Records: group by month, sticky filter chips, 20 at a time with "Show more".

### Phase 3 — break-glass in one tap (F9)
- On "Emergency", go straight to a single screen with **big one-tap reasons**:
  *Unconscious / cannot consent* · *Life-threatening emergency* · *Emergency, treating clinician
  unavailable* · *Mass-casualty incident*; an optional note field below.
- Each preset is ≥ 10 characters, so the API, DB CHECK, patient notification and audit row are
  unchanged. The patient is still told at once and the access is still time-limited.
- The "ask the patient for access" form moves below, collapsed — it is the non-emergency path.

### Phase 4 — shift handoff from the shift's own work (F10)
- **"Patients I cared for this shift"**: list built from the nurse's own access-log rows and
  writes since shift start; **Select all**, untick the exceptions. Multiple patients at once.
- **New read-only endpoint** `GET /api/shift-handoff/draft?since=` returning, per patient, what
  this clinician recorded in the window: latest vitals, medications given (MAR), I/O totals,
  notes written, pending orders/labs, code status from the chart.
- The page shows that as a **pre-drafted I-PASS summary** marked "From the record — <time>"; the
  nurse only reviews, edits and adds the action list. Anything not recorded shows as
  "Not recorded", never a guessed value (rules 9 and 12 hold: these are recorded facts, not
  defaults). Outgoing nurse = the signed-in user.

### Phase 5 — fewer clicks and less typing on every form (F11, F12)
- **Patient first:** a form opened from a chart carries the patient; the 48 pages read it from
  the URL and only show the picker when opened without one.
- **One tap instead of typing:** chips/segmented buttons for short enums; a **"Now"** button on
  time fields (not a pre-filled default); "me" as a one-tap choice in staff pickers.
- **Progressive disclosure:** the fields most visits need first; the rest behind "More details".
- **Drafts survive interruption** (decision needed, see §4).
- **Clinician sidebar:** Favourites + Recent at the top, task groups collapsed; from a patient's
  chart, an action bar for that role's common forms.

### Phase 6 — prove it
Re-run the Phase 0 walk; publish before/after clicks, keystrokes and scroll per task. Run all
static gates, both vitest suites, the local-api Playwright suites, axe on every route, and the
role journeys (alone — rate limit). Add a gate refusing new hand-rolled `fixed inset-0` overlays
and runtime-built Tailwind colour classes.

## 4. Decisions needed from the owner
1. Bottom-bar tabs: **Home · My health · Appointments · Messages · Me** (recommended), or the
   NHS-style three (Home · Messages · Me)?
2. Break-glass: one-tap preset reason (recommended, no backend change), or also allow
   **"explain later"** with a required justification within N hours — a policy and audit change.
3. Form drafts: keep in memory for the tab only (recommended; no PHI in browser storage), or
   save server-side drafts (survives a crashed tablet; new table and endpoints).

## Sources
- Material 3 navigation bar: https://www.sap.com/design-system/fiori-design-android/v26-4/components/m3-standard-components/navigation-bar/usage
- NHS App redesign: https://www.nhs.uk/nhs-app/about/what-is-new/ · https://www.lincslmc.co.uk/redesign-of-the-nhs-app
- GOV.UK form structure / question protocol: https://www.gov.uk/service-manual/design/form-structure · https://designnotes.blog.gov.uk/2015/07/03/one-thing-per-page/
- I-PASS automation (46.6%): https://www.aonl.org/news/study-automating-data-entry-improves-care-transitions
- I-PASS multi-site: https://www.psqh.com/news/i-pass-standardizing-patient-qhandoffsq-to-reduce-medical-errors/
- Break-the-glass logs (Ferreira 2013): https://www.scitepress.org/Papers/2013/44192/
- Nursing EHR time: https://www.thieme-connect.de/products/ejournals/html/10.1055/a-2581-6172 · https://pmc.ncbi.nlm.nih.gov/articles/PMC9300261
