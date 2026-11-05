# Patient app — every page, fewer of them (plan, 2026-11-01)

Status: **approved 2026-11-04 (all three decisions) and built** — see *What was built* at the end. The interface-defect work is
finished (zero findings, `docs/ux-audit/RESULTS.md`); this is the second half
of the owner's request: look at each page and make the app easy for a patient.

Mockups it follows: `docs/ux-mockups/p1-home`, `p2-my-health`, `p3-me`,
`p4-records`, `p5-record-sheet`, `p6-desktop-records`. The five-tab bar
(Home · Health · Visits · Messages · Me) is already built.

## Today: 29 pages, 27 reachable from the menu

A patient looking for one thing scrolls a long menu. Several pages show the
same thing twice (Medical ID and Emergency card; Consent, Access history and
Emergency access history), and three show controls for features that do not
exist yet (Offline sync's switches).

## Proposal: 16 screens, each under one tab

| Tab | Screen | Built from (today's pages) | Change |
|---|---|---|---|
| Home (p1) | Home | Dashboard | keep; emergency card first (done) |
| Health (p2/p4) | My records | MyRecords | keep; grouped by month (done) |
| | Medicines | Medications **+ MedicationReminders** | merge: reminders live on the medicine |
| | Test results | LabResults **+ LabTrends** | merge: trend is a view of a result |
| | Vitals | Vitals **+ Wearables** | merge: device readings are vitals |
| | History | MedicalHistory | keep (immunizations, family history) |
| | Track and check | SymptomTracker **+ SymptomChecker** | merge (p2 "Track and check") |
| Visits | Appointments | Appointments **+ Telehealth** | merge: a video visit is an appointment with a Join button |
| | (after a visit) | SatisfactionSurvey | remove from the menu; offered after a completed visit |
| Messages | Messages | Messages **+ Notifications** | merge into one inbox (tab already groups them) |
| Me (p3) | My details | MyProfile | keep |
| | My emergency card | MedicalId **+ EmergencyCard** | merge: one card, one QR |
| | Who sees my records | ConsentManagement **+ AccessHistory + EmergencyAccessHistory** | merge (p3 heading of the same name) |
| | My cards and family | Insurance **+ FamilyGroup** | merge (p3 heading of the same name) |
| | App settings | Settings **+ LanguageSettings** | merge |
| | (none) | OfflineSync | remove from the menu; keep the offline queue working in the background, drop the display-only switches |

Sign-in and Activate stay as they are.

## How it would be done

* Old addresses keep working: each retired route redirects to the screen
  that absorbed it, so bookmarks, notifications and links in messages land
  in the right place.
* Every merged screen keeps all of its reads; nothing a patient can see today
  becomes unreachable (rule 10). The patient-surface list
  (`api/src/middleware/patient_surface.rs`) does not change — the same
  endpoints are called.
* Done tab by tab (Me, Health, Visits, Messages), each ending with the
  patient journey, the patient browser suite and screenshots at phone width.

## Decisions needed from you

1. **The merges** in the table — all, or which ones.
2. **Removing Offline sync from the menu** and deleting its display-only
   switches (rule 7: code is only deleted with your approval).
3. **Satisfaction survey** as an after-visit prompt instead of a menu item.

## What was built (2026-11-04)

* **Me** (`/me`, mockup p3) lists every screen below it; the tab bar's Me opens
  it. My details stays at `/profile`.
* **Merged screens** (`components/MergedScreen.tsx`): one `<h1>`, one tab per
  former page, the open tab in `?view=`. Each former page renders whole inside
  its section and keeps all of its reads. Inside a section a page's title is a
  screen-reader-only `<h2>` and its coloured banner shrinks to one line.

| Screen | Address | Sections | Retired addresses (redirect, query kept) |
|---|---|---|---|
| Who sees my records | `/privacy` | Has access · Viewed my records | `/consent`, `/access-history` |
| My emergency card | `/emergency-card` | Card · Lock screen and sharing | `/medical-id` |
| My cards and family | `/cards` | Insurance · Family | `/insurance`, `/family` |
| Settings | `/settings` | General · Language · Saved on this phone | `/language`, `/offline-sync` |
| Medicines | `/medications` | (one screen: reminders on each medicine) | `/reminders` |
| Test results | `/lab-results` | (one screen: a trend on each result) | `/lab-trends` |
| Vital signs | `/vitals` | Readings · My devices | `/wearables` |
| Track and check | `/symptoms` | Track symptoms · Check a symptom | `/symptom-checker` |
| Visits | `/appointments` | Appointments · Video visits | `/telehealth` |
| Messages | `/messages` | Conversations · Notifications | `/notifications` |

* **One card, one code.** The emergency card showed a code it drew itself
  (`{id, name, bt, url}`), which the paramedic scanner refuses as "not a
  MediChain code" (`parseEmergencyCode`). It now shows the server's Medical ID
  code — patient id, possession proof, offline summary — kept on the phone for
  use without signal, with its download. Medical ID no longer offers a second
  download. Share no longer sends `/emergency/<id>`, an address the patient app
  does not serve.
* **Offline sync** is the Settings section "Saved on this phone"; its five
  disabled switches for automatic sync that was never built are deleted
  (approved). The queue, conflicts and devices list are unchanged.
* **Survey** is out of the menu; the most recent completed visit (within 14
  days) offers "How was this visit? Rate your care", and the survey records
  that visit (`/survey?visit=<id>`).
* `/survey` stays a route (reached from the visit).

* **Reminders on each medicine** (`components/MedicineReminders.tsx`): every
  prescribed or profile medicine shows its reminders, marks today's doses taken,
  stops a reminder and adds one pre-filled with its name and dose. Reminders
  match a medicine by name (the reminder API stores no prescription id); those
  matching none are listed under "Other reminders". Fixed on the way: "Mark
  taken" sent `<reminder_id>:<time>` as the reminder id.
* **A trend on each result** (`components/LabTrend.tsx`): a result whose
  parameter has two or more readings offers "Show trend", opening the chart,
  the change from the first result to the latest, and recent values. Trends
  are keyed by the parameter name the result line carries (`lab_trends.rs`).
* `MedicationRemindersPage` and `LabTrendsPage` were deleted (owner approval,
  2026-11-04); their logic and its tests now live in the two components.

## Wireframe pass (2026-11-05)

A screen-by-screen comparison with p1–p6 found the merges built but the
screens themselves still in their old shape. Closed:

* **Navigation (p1, p6).** The same five tabs on every width; *My health*
  opens its own page (`/health`) with a heart icon; Messages carries the unread
  count. The top bar is the logo, the connection in words ("Up to date",
  "Offline", "N waiting to send"), a *Find a page* search (the former menu,
  now one button), and on a laptop an Emergency card button. The bell, the
  phone Menu button and the six-link laptop bar with "All pages" are gone.
* **My health (p2)** — `pages/MyHealthPage.tsx`: four tiles (Records, Lab
  results, Medications, Vital signs with the newest reading) and the *Track
  and check* list. Tile subtitles name the place, not a count, except vitals:
  no cheap read exists for the others' counts, and a guessed count is worse
  than none.
* **Home (p1)** — the emergency card carries blood group and allergies; *Today*
  (`components/HomeToday.tsx`) shows the next dose with **Taken**, the next
  visit and a result from the last 14 days; *Privacy* shows who looked, built
  on the access history's own sessions, repeats folded ("· 5 times"), the
  patient's own reads left out. Health ID moved to Me.
* **Me (p3)** — copy button for the Health ID; "N with access" on *Who can see
  my records*.
* **Records (p4–p6)** — one tap opens the document (no details step, never two
  dialogs); Download on every row and pinned in the reader; month headers with
  counts; sticky filter chips; 20 at a time with *Show more*. The reader
  (`components/RecordDocument.tsx`) puts findings/impression first, lays
  fields out as a list with readable dates and Yes/No, and folds the server's
  "Not recorded:" line into one expandable row. On a laptop the document opens
  beside the list, with the My health pages as a side list.

Not matched, and why: the Health ID stays the full identifier (the mockup's
short "MC 4821 7703 19" form does not exist in the system), and a lab result
is "latest", not "new" (nothing records whether the patient has seen it).
