# UX implementation plan — fewer clicks, every role

Status: **for owner approval before any code** (CLAUDE.md rule 6).
Branch: `feature/frontend-ux`. Supersedes the "order of work" sections of
`UX_SIMPLIFICATION_PLAN.md`, `UX_INVESTIGATION_2026-10-17.md` and
`UX_WORKFLOWS_BY_ROLE_2026-10-17.md`; their findings remain the evidence.

---

## 0. Owner decisions (2026-10-30) and how this plan applies them

| # | Decision | Design in this plan |
|---|---|---|
| D1 | Ward/unit assignment gives nurses access to their patients | New **wards**, **admissions** and **ward shift assignments**. A nurse may open a chart when the patient is admitted to a ward the nurse is rostered on *now*. Derived at check time, cited in the audit row (§5) |
| D2 | Ambulance handover (later vitals, medication rounds) may be saved on the device and sent later, marked "Not sent yet" | **Append-only creates only** — never edits. Encrypted on the device, bound to the signed-in account, sent with its original operation key so a resend cannot duplicate (§2.7) |
| D3 | Handover gets destination hospital, arrival time, pre-arrival alert, "Received" | New columns + a status machine *en route → arrived → received* (or *cancelled*), facility-filtered list, live event, acknowledgement (§2.2–2.6) |
| D4 | Mass-casualty casualties linked to patient records when their card is scanned | The API **already accepts** `patient_id` per casualty and the table **already has** the column; the screen never sends it (§2.3) |
| D5 | Order: shared kit + form engine → paramedic & ED → doctor "Today" → lab → nurse → pharmacist → admin → patient | Followed. One dependency surfaced: ED "Received" can only admit to an ED ward once wards exist (Phase 5); until then it creates the existing encounter relationship (§2.6) |

**Three details I have chosen and you can overrule** (each is the conservative option):
1. **Who rosters nurses onto wards:** Administrator, with the existing Class C confirmation —
   assigning a nurse to a ward grants chart access, which is an access decision (ADR-0008
   phase 1 already confirms access decisions). Nurses cannot self-assign.
2. **Who admits a patient to a ward:** Doctor or Nurse at that facility, ordinary RBAC + audit
   (admission is a clinical act; making it Class C would add a confirmation to every admission).
   The patient sees their admissions (rule 10).
3. **Offline limits:** queued items expire after **24 h** unsent (shown as "Not sent — expired,
   show to receiving staff and re-enter"), and **sign-out is refused while items are unsent**
   unless the user explicitly discards them.

---

## 1. Evidence baseline — re-verified against today's code (2026-10-30)

| Finding | 17 Oct | **30 Oct** | Proof |
|---|---|---|---|
| Doctor / nurse dashboard patient list = first N patients in DB | 20 / 15 | **20 / 15** | `dashboards.rs` `Pagination::new(0, 20)` / `(0, 15)` |
| Anything ties a nurse to a ward | no | **no** — no ward/bed/admission table; `care_relationships` allows `admission` and facility-wide rows but nothing writes a ward | baseline schema; `care_access.rs` |
| Handover has destination / ETA / receipt | no | **no** | `CreateEmsHandoffRequest`, `EmsHandoffPage.tsx` |
| Handover records the saver as "received_by" | — | **yes** — a paramedic saving it is recorded as the hospital receiver (attribution defect) | `emergency/mod.rs` ~l.630 |
| Crew's medicines given reach the hospital | no | **no** (column + API field exist, no UI) | page has 0 `medications_given` |
| Recent handovers filtered by facility | no | **no** | `list_recent_ems_handoffs` |
| MCI casualty linked to patient | no | **no** (API + column exist) | `MCIPage.tsx` |
| Paramedic lands on scanner | no | **no** → `/ems-handoff` | `App.tsx` |
| Doctor sees pending consults / today's appointments | no / no | **no / no** | `DashboardPage.tsx` |
| Fresh idempotency key per request (double-tap duplicates) | yes | **yes**; client never handles `409 IDEMPOTENCY_DUPLICATE` | `client.ts`, `idempotency.rs` |
| Writes that queue offline | 1 | **1** (patient dose-taken); queue **not encrypted** | `endpoints.ts`, `offlineQueue.ts` |
| Unsaved-change guards | 0 | **0** | grep |
| Pages asking for the patient again | 48 | **57 files / 63 pickers** | grep |
| Forms that jump to dashboard after save | 8 | **8** | grep |
| Disabled-until-valid submit buttons | 67 | **63 in 35 files** | grep |
| `<select>` with 2–6 fixed options | 145 | **143** | scan |
| Console-only (silent) failures | 73 | **58** | scan |
| Form pages linking errors to fields | 3 / 95 | **1 file uses `useFieldA11y`** | grep |
| Field pages without `<form>` (Enter does nothing) | 63 / 94 | **63 / 94** | scan |
| MAR "barcode scanned" is a tick-box | yes | **yes** | `MedicationAdminPage.tsx` |
| Clinical alerts vanish after | 5 s | **5 s** | `Toast.tsx` |
| Note templates usable in note forms | 0 / 4 | **2 / 4** (SOAP, Progress — fixed since); Consult, Discharge remain | grep |

---

## 2. Guardrails every work package obeys

- **Carry, never guess.** A value is pre-filled only from a recorded fact (scan, order,
  session, a tapped time), shown with its source, editable before save (rule 9).
- **No form loses a field; no record loses data.** Folding rare fields behind "More details"
  is display only.
- **Same endpoint, same access check, same audit row** for every write. New authority types
  (ward assignment) are cited in `access_logs.authority_type` like existing ones.
- **Unmeasured stays unmeasured** (rule 12): drafted summaries say "Not recorded".
- **New endpoints take request types** (rule 11), **derive the actor from the session**
  (rule 2), **parameterized SQL only** (rule 4), **patient-scoped read in the same change**
  (rule 10), **≤ 60 branch/bind lines per function** (rule 3).
- **Schema changes are forward-only migrations after the 2026-10-19 baseline**, each with a
  PostgreSQL test (the memory backend hides schema violations — memory note).
- **Every change is proved twice:** an automated test that fails before and passes after, and a
  before/after measurement (clicks, typing, screens) from the Phase 0 harness.

Library basis: shared components and minimal, non-contradictory state —
`frontend-component-architecture.md` §2, §4; tests that act like users —
`frontend-testing.md` §1; error text and multi-step forms — `frontend-forms-and-validation.md`
§5, §11; WCAG 2.2 redundant entry/target size/focus — `frontend-accessibility-wcag.md` §3;
reduced motion — `frontend-motion-and-animation.md` §3; loading/modality —
`frontend-platform-guidelines-apple-hig.md` §4, §7; ward-based access — Anderson,
*Security Engineering* 3e ch.10 p.16; offline clients that sync later — Kleppmann, *DDIA*
p.192; end-to-end operation identifiers make retries idempotent — *DDIA* p.566; status
machines — *The Pragmatic Programmer* 20th ed. p.240.

---

## Phase 0 — Measurement harness (S) — *proof before change*
| WP | Work | Proof of done |
|---|---|---|
| 0.1 | Move `docs/ux-audit/ux-sweep.mjs` into `scripts/` with a runner; record baseline JSON per role | Baseline file committed; re-run reproduces counts ±0 |
| 0.2 | Add **click/keystroke counters** to `role-journeys.ts` (count UI actions per journey step via Playwright) for the 10 key tasks: record vitals, give a dose, write SOAP, order lab, enter result, verify+dispense, scan+handover, book appointment, read a record, create an account | Baseline table in `docs/ux-audit/BASELINE.md` |
| 0.3 | **Add the paramedic journey** to `role-journeys.ts` (none exists): scan → card → handover → hospital reads it | Journey runs green against current code (documents today's path) |

## Phase 1 — Shared kit and form engine (L) — *fixes the most screens at once*
| WP | Work | Proof of done |
|---|---|---|
| 1.1 | `useClinicalForm` in `@medichain/shared`: one `status` (`idle·saving·saved·failed·duplicate`) instead of separate booleans; **one operation key per submission** kept across retries/double taps; `409 IDEMPOTENCY_DUPLICATE` → "Already saved" + refetch; error summary + focus first invalid field; unsaved-changes guard (router blocker + `beforeunload`); per-tab in-memory draft; patient context from `?patient=`; save → return to chart | Unit tests per behaviour; a double-click test proves **one** record server-side (API test against PostgreSQL) |
| 1.2 | Components: `PatientBanner` (name + DOB/age + sex + health ID + allergies + code status), `PatientPicker` (two identifiers, same-name warning, find-by-scan), `ChoiceChips`/`Segmented` (nothing pre-selected), `StaffSelect` + "Me", `NowButton`, `NumberField` (`inputMode`), `Field` (adopts `useFieldA11y`), `ErrorSummary`, `Sheet`, `WorkQueueItem`, `StatusBanner` (loading/empty/error/partial/denied/offline) | Component tests + axe; visual snapshots light/dark |
| 1.3 | **Gates** (fail CI on regression, ratchet from today's counts): no hand-rolled `fixed inset-0` overlay; no `<select>` with ≤ 6 literal options; no rendered raw `PAT-` id; inputs inside `<form>`; no console-only catch; no disabled submit without a visible reason; no runtime-built Tailwind colour class | Each gate fails on a seeded example, passes on the tree |
| 1.4 | Cross-cutting fixes: reduced-motion guard for all 170 animations; minimum 14 px clinical text; `scroll-margin-top` under sticky headers; staff sign-in username label; persistent tiered alerts (critical stays until acknowledged, links to patient, names patient by identifiers) | Sweep: 0 unlabeled controls, 0 tiny targets on migrated pages |
| 1.6 | **Patient workspace shell** (`FRONTEND_WORKFLOW_AND_MOTION_PLAN.md` §2, §4): `/patients/:id/:form`, sticky banner, actions rail (Common · Recent · All forms), "This visit" panel, Close patient, one patient at a time; motion tokens + `useMotionNavigate` with reduced-motion substitution | Journey: open patient → 3 forms → close, **0 patient pickers**; reduced-motion run green |
| 1.5 | Migrate pages in batches (into the workspace from 1.6) of ~10, highest-traffic first (vitals, MAR, SOAP, progress note, triage, I/O, orders, lab results, e-prescribe, discharge), then the rest | Per batch: gates ratchet down; journeys green; click counts recorded |

## Phase 2 — Paramedic and emergency department (L)
Built as a **run record** — a time-stamped event timeline appended as the crew works, handed
over with one button (`FRONTEND_WORKFLOW_AND_MOTION_PLAN.md` §3). The rows below apply to the
run (`ems_runs` + append-only `ems_run_events`); existing `ems_handoffs` stay readable.
| WP | Work | Data / API | Proof of done |
|---|---|---|---|
| 2.1 | **Attribution fix:** handover author = crew member from the session; `received_by` set only on acknowledgement | add `created_by`; stop writing `received_by` on create | API test: paramedic creates → `received_by` null |
| 2.2 | Status machine *en_route → arrived → received*, *cancelled* from en_route/arrived; transitions enforced server-side | migration: `destination_facility_id` (FK `facilities`), `eta`, `status`, `received_by`, `received_at`, `created_by` | Table-driven transition test (every illegal transition refused) |
| 2.3 | **Scan once:** paramedic lands on Scan; shift unit/crew set once; **Start incident**; each scan joins the casualty list with `patient_id` (MCI API already accepts it); one-tap START triage (server score); quick vitals; "On scene"/"Leaving" time buttons | none for MCI link; shift unit stored per session | Journey: 3 scans → 3 linked casualties, 0 typed names |
| 2.4 | **Transport:** destination once per vehicle; **Select all → Send handover** — one handover per casualty pre-filled from scan, triage, vitals, interventions, **medicines given** (new UI for existing field) | create accepts destination/eta | Journey: 3 handovers sent in ≤ N taps (N fixed from baseline) |
| 2.5 | **ED incoming board:** list filtered to the caller's facility; live SSE event `ems_incoming`; patient banner with ETA | list filter by `destination_facility_id`; SSE event | API test: another facility's crew handover not visible |
| 2.6 | **Received:** one tap → `received`; triage opens **pre-filled** from crew vitals/complaint; receiving clinician gets an encounter care relationship now (ED admission once Phase 5 lands) | acknowledgement endpoint; reuses `record_encounter` | Journey: received → triage saved → patient sees handover (rule 10 read exists) |
| 2.7 | **Offline handover (D2):** IndexedDB queue **encrypted** (WebCrypto AES-GCM, non-extractable key per account), bound to owner, 24 h expiry, "Not sent yet" badge + count in header, sign-out guard; replay with the original operation key | none (server dedupe already durable) | Test: offline create → reconnect → exactly one row; expired item never sent; other account cannot read it |

## Phase 3 — Doctor "Today" (M)
| WP | Work | Data / API | Proof |
|---|---|---|---|
| 3.1 | `GET /api/dashboard/doctor/today`: today's appointments (`/appointments/provider/{id}`), consults to answer (already returned, never shown), discharge summaries awaiting second-clinician approval, refill requests, results to review, critical values, unread messages; **patients = active care relationships**, not first 20 | new aggregate handler over existing repositories | API test: another doctor's patient never listed |
| 3.2 | "Today" list: each item opens its task with patient and record loaded | — | Journey: consult answered from Today in ≤ 2 taps to the form |

## Phase 4 — Lab work queue (M)
| WP | Work | Proof |
|---|---|---|
| 4.1 | Queue by stage (*to collect · received · in progress · to verify*); each item opens **from its order**: patient, test, specimen carried through collection → custody → result | Journey: no patient picker shown in the 4-step flow |
| 4.2 | A result flagged critical opens the critical-value notification **pre-filled** | API test: critical value cites order + result ids |
| 4.3 | Typed reasons (recollection, cancel, replacement) → chips + "Other" | Gate: no `promptDialog` for reasons with a fixed list |

## Phase 5 — Nurse (L) — *implements D1*
| WP | Work | Data / API | Proof |
|---|---|---|---|
| 5.1 | **Wards and roster:** `wards` (facility, name, kind incl. `emergency`); `ward_shift_assignments` (ward, clinician, starts_at, ends_at, assigned_by) — Admin, Class C | migrations + admin UI | Class C refused without confirmation |
| 5.2 | **Admissions:** `patient_admissions` (patient, ward, bed label, admitted_at/by, discharged_at/by); Doctor/Nurse at facility; patient-scoped read "My admissions" (rule 10); ED "Received" admits to the ED ward | migration + endpoints | Rule-10 test; discharge ends access |
| 5.3 | **Access:** `clinician_authority` gains *ward assignment* after patient grants and care relationships: patient admitted to W **and** caller rostered on W now → authority cited as `ward_assignment` with admission + assignment ids | `care_access.rs` | Table tests: off-shift → denied; other ward → denied; discharged → denied; audit row names the authority |
| 5.4 | **Ward list** replaces "My Patients" (first 15 DB patients) — patients on my wards now, with bed, due tasks | nurse dashboard query | Test: unassigned nurse sees an empty, explained list |
| 5.5 | **Due doses → real scan:** tap dose → scan wristband + medicine (existing `BarcodeDetector` scanner) → confirm; `barcode_scanned` set only by a real match | page + payload | Test: manual path records `barcode_scanned: false` |
| 5.6 | **Handoff drafted from the shift** (mockup `c2`): `GET /api/shift-handoff/draft?since=` — per patient, what the caller recorded in the window; SBAR shape unchanged; patients from roster + own writes; Select all | new read endpoint | Journey: 5-patient handoff, no blank SBAR fields where records exist; "Not recorded" where none |

## Phase 6 — Pharmacist (S)
Queue item opens the prescription with interactions inline; dispense quantity numeric;
reversal/refusal reasons as chips. Proof: verify+dispense journey click count below baseline.

## Phase 7 — Administrator (S)
User management: compact rows, search, role/status filters, 20 per page (51 screens → ≤ 2);
phone layout without sideways scroll. Ward roster screen lives in Phase 5.

## Phase 8 — Patient app (M) — mockups `p1`–`p6`
Five-tab navigation (Home · My health · Visits · Messages · Me), fix the invisible active
state, records grouped by month opening straight to a one-sheet document, backend document
text with empty fields collapsed into one line, readable health ID, "next available"
booking, emergency card first. Proof: patient sweep — 0 sideways scroll, records ≤ 3 screens,
document ≤ 1 screen.

## Phase 9 — Prove and close
Re-run Phase 0 sweep + click counts for every role; publish before/after in
`docs/ux-audit/RESULTS.md`; all 30+ gates, both vitest suites, typecheck, local-api Playwright
suites, role journeys (alone — rate limit), cross-role qualification, `cargo test --bin
medichain-api` on PostgreSQL, clippy, fmt. Register entry in
`docs/TECHNICAL_DEBT_REGISTER.md`; memory notes updated.

---

## Risks and how each is contained
| Risk | Containment |
|---|---|
| Ward access too broad | Requires *both* an active admission and an on-shift roster entry; Admin + Class C to roster; every read cites the authority; patient sees who opened their chart and why |
| Offline data on a lost tablet | Encrypted queue, account-bound, 24 h expiry, sign-out guard; only append-only creates queue |
| Duplicate records from retries | One operation key per submission + server's durable dedupe (*DDIA* p.566) |
| Pre-fill read as a finding | Every carried value labelled with its source and editable; nothing defaulted (rule 9 gate) |
| Big-bang regressions | Phase 1 migrates pages in batches behind ratcheting gates; each batch runs the journeys |
| Memory backend hides schema bugs | Every migration has a PostgreSQL test |

## Sizes and order
S ≈ a few days, M ≈ ~1 week, L ≈ ~2 weeks of focused work. Sequence: **0 → 1 → 2 → 3 → 4 → 5
→ 6 → 7 → 8 → 9**, each phase merged only when its proofs pass. Start: **Phase 0 + Phase 1.1**.
