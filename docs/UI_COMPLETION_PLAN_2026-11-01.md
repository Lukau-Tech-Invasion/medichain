# Hospital portal — finish every screen (plan, 2026-11-01)

Status: **plan, awaiting owner approval.** Patient app follows, as agreed.

## What "finished" means for one screen

A screen is finished when all five hold, each checked by a tool rather than by eye:

1. **None of the seven known defect patterns** (`scripts/check-ux-patterns.py`)
   remains in its file, and the file's baseline entry is removed so it stays at
   zero.
2. **It matches its mockup** where one exists (`docs/ux-mockups/c1`–`c10`),
   compared side by side from screenshots at phone and desktop width.
3. **Patient forms open on the patient** (workspace, `/patients/:id/:form`).
   58 forms already do; the rest are listed and moved.
4. **Readable and usable**: colour sweep light and dark, the all-routes
   accessibility checks, keyboard focus never hidden.
5. **The project rules still hold**: a form sends only what it collected
   (rule 9), clinical values come from the server (rule 8), handlers take
   request types (rule 11). Existing gates enforce these.

## What is left, measured today

The hospital portal (`client/doctor-portal`, 90 pages, every staff role) has
**312 instances in 98 files** of the seven patterns:

| Pattern | Count | What the user meets | Fix |
|---|---|---|---|
| Short dropdown | 134 | Two taps and a scroll to pick from ≤6 options | `ChoiceChips` (one tap) |
| Inputs with no form | 56 | Enter does nothing; no error summary | `<form>` + `SubmitButton` |
| Raw patient id shown | 41 | `PAT-8f3a…` identifies nobody | Name + date of birth / health ID |
| Unexplained greyed button | 30 | Button says "no" without saying why | `SubmitButton` + `ErrorSummary` |
| Hand-made pop-up | 25 | No Escape, focus escapes, no phone sizing | `ModalPanel` / `Sheet` |
| Error only in the console | 21 | A failed save looks like a success | Visible error message |
| Colour built at runtime | 5 | Ships with no colour at all | Fixed class map |

Plus 16 shared components (`client/shared`) with 23 instances, which are
fixed first because every screen using them improves at once.

Worst files: Trauma, CDS Alerts, Pathology, Obstetrics, Pre-op,
History & Physical, Death Certificate (7–9 each). 60 files have three or
fewer.

## Order — role by role, so each batch is a usable whole

1. **Shared components** (16 files) — the kit every screen uses.
2. **Nurse** — dashboard, vitals, MAR, intake/output, IV sites, care plans,
   fall risk, handoff, wound care and the rest of the nurse's menu.
3. **Doctor** — Today, orders, notes (SOAP, progress, H&P), e-prescribe,
   discharge, consults and every specialist form (trauma, stroke, cardiac,
   obstetrics, pre-op, pathology…).
4. **Lab technician**, 5. **Pharmacist**, 6. **Paramedic / ED** (mockups
   c6–c9), 7. **Administrator** (user management, roster, death register).

Each batch ends with: gates, vitest + typecheck, the colour sweep and
all-routes check for that role, the role's journey against a live API, and
screenshots of the changed screens. I report after each batch rather than at
the end.

## Mockups

c2 handoff, c3 patient-first form, c4 workspace, c5 close patient, c6
ambulance run and c8 incoming board are built (2026-10-31). In each batch I
compare them with their screen. c1 break-glass, c7 choose hospital,
c9 received triage and c10 motion are checked against the screens that
exist and their gaps listed.

## Not changed

Workflows, permissions and data — this is interface work. A screen whose
problem turns out to be the API (a field it cannot save) is recorded and
raised, not patched in the page.

## Size

About 330 fixes across ~114 files; several working days. Every batch is
small enough to verify on its own. Nothing is committed without your
say-so.
