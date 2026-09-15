# Workflows — does what a clinician writes reach the patient?

**Opened 2026-09-12.**

## The question this asks, and why it is different

`scripts/role-journeys.ts` proves each role can finish their own shift, and it
reads every write back — but through a **colleague's** session. That answers
"is the record shared?" It does not answer the question that matters to the
person the record is about:

> A doctor fills in a document. Can the patient see it?

Those are different tests, and the second fails far more often, because the
clinician's screen is where the feature was built and the patient's screen is
where somebody had to remember to add it.

## How the gap was measured

For every artefact a clinician can create (`#[post]` routes), does a route exist
that fetches it **by patient**? A record served only as
`GET /api/.../{some_id}` is unreachable to the person it is about: they do not
know the UUID.

Measured 2026-09-12: **21 artefacts are written with no patient-scoped read.**

## The list, in priority order

Priority is "how badly does the patient need this", not how hard it is.

| # | Workflow | Producer | Patient sees it? | Status |
|---|---|---|---|---|
| 1 | **Discharge summary + instructions** | Doctor, `DischargePage` | Now yes | **DONE** |
| 2 | **Immunisation record** | Nurse, `ImmunizationPage` | Yes — it already worked | **DONE** |
| 3 | **Radiology / imaging report** | Doctor, `ImagingPage` | Now yes | **DONE** |
| 4 | **Pathology report** | Lab technician | Now yes | **DONE** |
| 5 | **Consult (specialist opinion)** | Doctor, `ConsultPage` | Now yes | **DONE** |
| 6 | **Care plan** | Nurse, `CarePlanPage` | Now yes | **DONE** |
| 7 | **Transfusion + blood type** | Lab, blood bank | Now yes | **DONE** |
| 8 | **Procedure records** — operative note, anaesthesia, intubation, laceration repair, splint/cast, burn | Doctor | Now yes | **DONE** |
| 9 | **AMA discharge** | Doctor, `AMAPage` | Now yes | **DONE** |
| 10 | **Intake/output** | Nurse | Now yes | **DONE** |

### Deliberately NOT patient-facing

Recorded so nobody "fixes" them later:

* **Shift handoff** — nurse-to-nurse, names staff and workload.
* **Incident report** — a safety report that may name staff and witnesses.
* **MCI record** — incident-level, covers many patients at once.
* **Death certificate** — not a document its subject reads.
* **Specimen chain of custody** — internal, and evidential.

## Already working end to end

Reachable from the patient application today: lab results, medical records,
SOAP notes, e-prescriptions, triage, history & physical, progress notes, wound
assessments, vitals, GCS, fall risk, MAR, IV sites, appointments, messages,
consents, telehealth, symptom checker, medication reminders, adherence,
emergency card.

## Method, per workflow

One at a time, each finished before the next begins:

1. **Read** the producer screen and the endpoint it calls.
2. **Add the patient-scoped read** if none exists, authorised so the patient
   reaches their own record and nobody else's.
3. **Wire the patient screen** so it is visible without knowing an id.
4. **A journey step** that creates it as the clinician and reads it back *as the
   patient* — not as a colleague.
5. **A unit test** for the authorisation boundary.

A workflow is not done until step 4 passes against a live server.

---

## 1. Discharge summary and instructions

**Status: DONE (2026-09-12).**

The producer works: `DischargePage` creates a summary, a second clinician
approves it, and `scripts/journeys/doctor.ts` proves both. What does not exist
is any way for the patient to reach the result.

The only reads are `GET /api/clinical/discharge-summary/{summary_id}` and
`GET /api/clinical/discharge-instructions/{instructions_id}` — both keyed by an
id the patient has never seen — plus `GET /api/clinical/discharges`, which is
the clinician's worklist.

This is the document a patient physically leaves hospital with: what happened,
what medicines to take, what warning signs to come back for. A patient who
cannot open it is the plainest possible version of the problem.

### What was added

`GET /api/clinical/patient/{patient_id}/discharges` returns both documents
together, because a discharge is one event with two halves and returning them
separately makes the screen do the joining — which is how one of the two gets
forgotten. Authorised for the patient themselves (resolved through
`linked_patient_id`, not by comparing a wallet address to a `PAT-` id) or any
clinician who may view medical records.

`MyRecordsPage` now loads it alongside the rest, so it needs no id.

**Evidence.** 4 unit tests in `patient_discharge_access_tests` cover the
boundary: own (200), another patient's (403), clinician (200), unknown caller
(401). `runDischargeVisibilitySteps` in `scripts/journeys/patient.ts` creates
the summary and instructions as the doctor and then opens them **in the
patient's own session**, checking the diagnosis, the take-home medicine and the
warning sign are all present, and that another patient's discharge is refused.
Passed live: 61/61 patient-journey steps, 2026-09-12.

---

## 2. Immunisation record

**Status: DONE (2026-09-12). No API change was needed — the round trip already
worked, and nothing had ever asserted it.**

The inventory scan marked this "not patient-scoped" because it searched for a
route with `{patient_id}` in the path. `GET /api/clinical/immunizations` has no
id in it at all: it is **caller-scoped**, resolving the caller's
`linked_patient_id` and returning that patient's records. That is the right
shape for this screen — the patient application's Medical History tab has no id
to send — and it is why the scan missed it.

So the finding here is about the measurement, not the product. Recorded because
the next person to run that scan will reach the same wrong conclusion: **a
patient-facing read does not have to name the patient in its URL, and the ones
that do not are the ones a naive inventory calls missing.**

### The boundary this route has instead of a 403

There is only one route and it serves whoever is calling, so a scoping mistake
here does not refuse anybody — it silently hands over somebody else's
vaccination history. The tests are written against that failure mode rather than
against a status code:

* `a_patient_sees_the_vaccination_a_nurse_gave_them` — the nurse's write and the
  patient's read in one process, because testing the read alone would pass
  against a store the producer never reaches.
* `a_patients_card_carries_nobody_elses_doses` — two patients, two doses, one
  card.
* `an_unlinked_staff_caller_gets_their_own_empty_card` — a staff account has no
  `linked_patient_id`, so the scope falls back to their wallet, which matches
  nothing rather than matching everything.
* `an_unknown_caller_is_refused` — a forged `X-User-Id` is resolved against the
  user store and rejected before any scoping decision.

`runImmunisationVisibilitySteps` does the same across the wire, including the
leak check. Passed live 2026-09-12.

---

## 3. Radiology / imaging report

**Status: DONE (2026-09-15).**

This one was shut twice over. `GET /api/surgical/radiology/report/{report_id}`
is keyed by an id the patient has never seen **and** gated on
`require_clinical_staff` — so even a patient holding the id was refused. The
only other read is `GET /api/platform/list/radiology-reports`, the
deployment-wide register, which is not a patient route by any reading.

So the scan a patient was sent for, waited for and worried about could be
performed, reported, flagged critical, and never opened by them.

### What was added

`GET /api/clinical/patient/{patient_id}/imaging` returns **orders and reports
together**. Two deliberate choices in that:

* **Orders are included**, not just reports. A patient asking "what about my
  scan?" before the radiologist has read it needs to see the order, or the
  honest answer is indistinguishable from no answer. `MyRecordsPage` lists an
  order only when no report references it, so a study that has been done but not
  yet read does not look identical to one that was never ordered — and it is
  marked unverified, because nothing has been reported yet.
* **Preliminary reports are not filtered out.** They carry their own `status`
  instead. Withholding a preliminary report is a policy decision, and a screen
  that silently omits it cannot tell the patient a report exists but is not yet
  signed. The record's `verified` flag is true only for a final report.

`'imaging'` was already in the patient application's record-type union and
already a filter chip on `MyRecordsPage` — nothing had ever produced one.

**Evidence.** 4 unit tests in `patient_imaging_access_tests`: own (200),
another patient's (403), clinician (200), unknown caller (401).
`runImagingVisibilitySteps` orders the study and files the report as the doctor,
then opens it **in the patient's own session**, checking the radiologist's
impression and the clinical indication are both present, and that another
patient's imaging is refused. Passed live: 66/66 patient-journey steps,
2026-09-15.

### Noted in passing, not fixed here

No screen posts a radiology report. `createRadiologyReport` exists in
`client/shared/src/api/endpoints.ts` with no caller, so reports today can only
arrive from an integration or a test. That is a producer gap, not a visibility
one, and it is recorded rather than fixed because this pass is about whether
what *is* written reaches the patient.

---

## 4. Pathology report

**Status: DONE (2026-09-15).**

Same shape as imaging: `GET /api/surgical/pathology/{id}` keyed by an accession
number the patient has never seen, plus the deployment-wide register, both gated
on clinical staff.

A pathology report is where a cancer diagnosis, a margin status and a staging
live. It is the result a patient chases hardest and the one they were least able
to reach.

`GET /api/clinical/patient/{patient_id}/pathology` closes it, and
`MyRecordsPage` lists the reports with the **diagnosis** as the description —
falling back to the specimen source rather than to a placeholder, because
"Pathology report" where a diagnosis should be reads as reassurance nobody wrote.

### On releasing it to the patient at all

Reports carry their own `status` rather than being filtered on it. Holding a
finished report back until a clinician has discussed it is a defensible policy,
but it is a *policy* — it has to be stated and configured, not enacted by a route
that quietly returns nothing. A screen that cannot distinguish "no specimen was
ever taken" from "the report exists and you may not see it yet" tells the patient
the first when the truth is the second. The same reasoning as the preliminary
radiology report in workflow 3.

**Evidence.** 4 unit tests in `patient_pathology_access_tests`: own (200),
another patient's (403), clinician (200), unknown caller (401).
`runPathologyVisibilitySteps` accessions the specimen as the clinician with
`PathologyPage`'s own payload, then opens it **in the patient's session** and
checks the specimen site comes back. Passed live: 70/70 patient-journey steps,
2026-09-15.

---

## 5. Consult — the specialist's opinion

**Status: DONE (2026-09-15).**

`GET /api/clinical/consult/{consult_id}` is keyed by an id the patient has never
seen *and* gated on `can_view_medical_records`, which excludes the patient. The
only other read is the deployment-wide register.

The consult is where the specialist's recommendation and follow-up plan live:
what the cardiologist actually said, and what they want done next. A patient told
"the specialist has seen your notes" and unable to read the answer is being asked
to take the recommendation on trust.

`GET /api/clinical/patient/{patient_id}/consults` closes it. On `MyRecordsPage`
the description is the **recommendation**, falling back to the reason while the
consult is still only a request, and `verified` is true only once `completed_at`
is set — a consult still awaiting a specialist is a request, and marking it a
document overstates it.

### What it cost to write the journey step wrong

The first run failed 500: `consultation_notes_status_check`. The journey had sent
`status: 'Requested'` where `ConsultPage` sends `'requested'`. That is the
harness's bug, not the product's — but it is worth recording, because it is the
same trap migration `20260820000001` was written for. **Capitalised spellings
pass in the memory backend, which enforces no constraints, and 500 on
PostgreSQL.** The rule the journeys exist to enforce is that every payload is the
page's own, character for character; approximating it tests a different system.

## Consolidation, done while workflow 5 was being added

Workflows 1, 3 and 4 each grew their own copy of the same twenty-line
authorise-then-page-the-repository block, in three different files. They now all
live in `api/src/handlers/patient_documents.rs`, which already existed for
exactly this — a module of patient-scoped listings over a shared `authorize()`
that resolves `linked_patient_id` and refuses a forged caller.

That module had **no tests at all**, so its three original routes
(history-physicals, progress-notes, wounds) had no authorisation coverage.
One table-driven `patient_document_access_tests` now covers all seven routes in
four cases — own (200), another patient's (403), clinician (200), unknown caller
(401) — which is 28 assertions in place of the 12 near-identical tests the
three scattered modules had, and it covers the three routes that had none.

---

## 6-10. The rest of what a ward writes

**Status: DONE (2026-09-15).** All five went in together, because by this point
the shape was settled: one listing in `patient_documents.rs` over the shared
`authorize()`, one row in the test table, one journey step that produces it as
the clinician and opens it in the patient's session.

| # | Route added | Was reachable only as |
|---|---|---|
| 6 | `GET /api/clinical/patient/{id}/care-plans` | `/api/emergency/care-plan/{id}`, plus two ward-wide provider lists |
| 7 | `GET /api/clinical/patient/{id}/blood` | `/api/surgical/blood-type/{id}`, `/api/surgical/transfusion/{id}`, plus the register |
| 8 | `GET /api/clinical/patient/{id}/procedures` | five separate `/{record_id}` routes |
| 9 | `GET /api/clinical/patient/{id}/ama-discharges` | `/api/clinical/ama/{ama_id}`, plus the register |
| 10 | `GET /api/clinical/patient/{id}/intake-output` | two ward-wide provider lists |

Why each one matters, in the order a patient would care:

* **Care plan** is the one clinical document written in the second person. It
  says what the goals of this admission are and what the patient is expected to
  do — and the patient could not read it.
* **Blood group** is the single most reusable fact in a record: asked in every
  emergency department, on every pre-operative form, at every donation. The
  transfusion history is the other half — what they were given and whether they
  reacted.
* **Procedures** were split across five endpoints. "What was done to me" is one
  question, and splitting it is how a screen comes to ask four of them. The
  route returns intubations, laceration repairs, splints and casts, burn
  assessments and anaesthesia records together. Pre-op, operative note and
  post-op already had `/patient/{patient_id}` siblings, which is why this
  workflow was logged PARTIAL rather than OPEN.
* **AMA discharge** is the document most likely to be cited *against* the
  patient later, which is exactly why they should be able to read it. On
  `MyRecordsPage` it is marked verified only when both signatures are actually
  captured — the record's evidentiary value is its signatures, and the form has
  no signature-capture step yet.
* **Intake/output** is the least urgent, and it is still the number a patient on
  dialysis, with heart failure, or on a fluid restriction is told to care about.
  Being told to care about a number you cannot see is not a plan.

### The producer gap found on workflow 8

**No page posts any of the five procedure records.**
`createIntubationRecord`, `createLacerationRepair`, `createSplintCast`,
`createBurnAssessment` and `createAnesthesiaRecord` all exist in
`client/shared/src/api/endpoints.ts` with **no caller anywhere in either
application**; `LacerationRepairPage` only reads
`/api/clinical/laceration-repairs`. So today these records can arrive only from
an integration or a test.

That is a producer gap, not a visibility one, and it is recorded rather than
fixed: this pass asks whether what *is* written reaches the patient. The journey
step posts the API shape an integration would send. The same is true of
`createRadiologyReport` (noted under workflow 3).

### Evidence

`patient_document_access_tests` now covers **twelve** routes in four cases —
own (200), another patient's (403), clinician (200), unknown caller (401) — 48
assertions over one shared `authorize()`. `runWardRecordVisibilitySteps` adds
fifteen live steps, three per artefact: it is written, the patient opens it, and
another patient is refused.

---

## Where this leaves the inventory

All ten workflows are closed. The measurement that opened this document said
**21 artefacts are written with no patient-scoped read**; the ones that remain
are the five recorded above as deliberately not patient-facing (shift handoff,
incident report, MCI, death certificate, specimen chain of custody) and the
producer-only gaps named under workflows 3 and 8.

Two findings are worth carrying forward, because both are about the *method*
rather than any one feature:

1. **A patient-facing read does not have to name the patient in its URL.**
   Workflow 2 was never broken; the scan that found it searched for
   `{patient_id}` in a path and missed a caller-scoped route. The routes a naive
   inventory calls missing are exactly the ones that need no id.
2. **Capitalised enum spellings pass in the memory backend and 500 on
   PostgreSQL.** The consult step failed its first live run on
   `consultation_notes_status_check` because the harness sent `'Requested'`
   where the page sends `'requested'`. Every payload must be the page's own,
   character for character.
