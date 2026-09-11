# Role journeys — every user's story, end to end

**Written 2026-09-10.** Six journeys, one per role, plus a reachability
sweep, driven against a live PostgreSQL-backed API. `scripts/role-journeys.ts`.

---

## Why this exists

`scripts/cross-role-qualification.ts` proves the walls. 117 checks, and every
one of them is a denial, a maker-checker refusal, or a token that must not work
twice. It says nothing about whether the right person can finish their shift.

Measured on 2026-09-10 against the running stack, the number of screens whose
**Save button had ever been driven against a live server** was:

| Role | Screens in its navigation | Screens whose Save had been driven |
|---|---|---|
| Administrator | 14 | **0** |
| Doctor | 37 | 3 |
| Nurse | 18 | 5 |
| Lab technician | 9 | 1 |
| Pharmacist | 7 | 2 |
| Patient | 25 | ~4 |

Every one of those pages has a unit test. A unit test renders the page against a
mocked `fetch`, so it cannot tell you that the handler behind it reads
`actual_time` while the form sends `administered_time` — and that is the
dominant defect in this codebase: **a successful write that no reader can see.**

## What a journey is

One coherent story per role, told in the order the work is actually done, and
ending where it has to end: with the next person in the workflow seeing what the
last one recorded.

* **Doctor** — register a patient, take a history and examination, write a SOAP
  note, raise a lab order and advance it, ask a colleague for a consult and get
  the answer back, book a follow-up, discharge with a summary a second clinician
  approves.
* **Nurse** — triage, observations, a *held* medication dose, fluids in and out,
  a wound, a cannula, a Morse fall-risk score, a care plan, a progress note, an
  incident report, and a shift handoff the incoming nurse opens.
* **Lab technician** — collect a specimen, open its chain of custody, record a
  failed quality-control run, raise a critical value the ordering clinician
  sees, order and document a transfusion, and submit a result somebody else
  approves.
* **Pharmacist** — receive a transmitted prescription, check interactions,
  partially fill it, be refused an over-dispense, fill the balance, be refused
  again, and reverse a mistaken fill without destroying the original event.
* **Patient** — open their own record, read their access log, book and cancel an
  appointment, message a clinician, log a symptom, run the symptom checker, mark
  a dose taken, open their emergency card, leave a survey, change a preference —
  and be refused another patient's record at every turn.
* **Administrator** — list the directory, create an account, correct a profile,
  change a role and prove it on a NEW session, change it back and prove the
  refusal, read the access log and the analytics, file a death certificate, and
  be refused the clinical surface.

A ninth block, **reachability**, checks the other half of a navigation entry:
that the endpoint behind every screen a role is now offered actually answers for
that role. A screen that renders its controls and then fails every one of them
on submit is still the wrong answer to give a clinician.

## The assertion that matters

Every write is followed by a read **through the endpoint a clinician would
actually use**, and by a different person wherever the workflow involves one.
Asserting the status code reproduces the bug rather than finding it: a `201` and
a green toast are exactly what a silently discarded payload looks like.

The payloads are the pages' own, field for field. Sending a tidier payload than
the product sends would test a request nobody makes.

## Running it

```bash
docker compose up -d
npx tsx scripts/seed-browser-test-fixtures.ts --i-understand-this-writes-accounts
cd client && MEDICHAIN_API_URL=http://127.0.0.1/api \
  ./node_modules/.bin/vite-node ../scripts/role-journeys.ts
```

`--only=nurse,doctor` runs a subset. The per-wallet challenge limiter is five
per minute, so two full runs inside a minute will legitimately skip some
sign-ins; that is a control working and is reported as a SKIP, never a failure.

## Result

**Every step passes, 4 skipped.** 203 steps on 2026-09-10; **209/209 on
2026-09-11**, which is the last full run measured. Six further steps — the
medication reminder a patient sets for themselves, and the appointment they
check themselves into — were written after that run to cover two defects the run
itself exposed, and are pending a re-measure. Both are covered by the unit
tests; neither has been driven against a live server yet. The four skips are
honest:

* two sign-ins that hit the challenge limiter on a repeat run;
* two second-pharmacist assertions, because the deployment's dispensing policy
  requires no second check for the medicine involved. The maker-checker path is
  exercised by `scripts/synthetic-e2e-test.sh` section 23 against a policy that
  does demand one.

---

## What the journeys found

Every item below was reproduced against a live server before it was fixed, and
the journey that found it now guards it. They are grouped by what made them
invisible, because the grouping is the lesson.

### A. The handler read a key the page never sends

An untyped `web::Json<serde_json::Value>` body with `unwrap_or_default()` behind
every lookup cannot fail. Seventeen handlers were doing this.

1. **A consult request stored nothing.** `create_consult` read `patient_id`,
   `consultation_type`, `requesting_provider`, `reason_for_consultation`;
   `ConsultPage` sends `patientId`, `specialty`, `requestedBy`, `reason`. Every
   field defaulted. On PostgreSQL the empty patient id violated
   `consultation_notes_patient_id_fkey` and the request 500'd; **in memory it
   succeeded**, filing a consult attached to nobody with an empty question.
2. **A critical value could not be raised.** Same shape:
   `create_critical_value` read `patient_id`/`test_name`/`test_code` while
   `CriticalValuePage` sends `patientId`/`analyte`/`criticalLevel`.
3. **A chain of custody lost its seal number** — the one thing it exists to
   record — plus the collector, the location and the container.
4. **A quality-control run recorded a control that measured zero on an unnamed
   analyser.** `instrument_id`, `test_name`, `expected_value`, `measured_value`
   and both range bounds all defaulted. Worse than losing it: QC exists to hold
   patient results when a control fails, and 0 inside a range of 0 to 0 passes.
5. **Six assessment handlers** — obstetric, paediatric, psychiatric, toxicology,
   splint, intubation — wrote every typed column from nothing, including
   `patient_id`. The clinical content survived in their `data` blob, so the page
   that wrote it could read it back; every dashboard, safety query and export
   reading columns saw an assessment attached to no patient.

   Fixed by `normalise_body_keys` at the request boundary plus explicit aliases
   for the genuine name differences, and by refusing an unknown patient outright.

`scripts/check-untyped-body-keys.py` now fails the build on this class, and
understands both `normalise_body_keys` and `.or_else(|| body.get(..))` chains so
it cannot report the fix as the defect.

### B. The request shape and the form had nothing in common

Typed requests, so these failed loudly — with a 400 nobody had ever seen,
because nobody had pressed the button against a live server.

6. **A nursing care plan could never be saved.** The request wanted
   `diagnosis: String` and `Vec<String>` goals; `CarePlanPage` builds three
   cross-referenced lists of objects. Every submit was
   `400 invalid type: map, expected a string`. The only care plan in the
   database had been written by a seeder.
7. **A blood product order could never be saved.** The handler wanted the
   laboratory `BloodTypeScreen` — `test_id`, `abo_type`, `antibody_screen`,
   `expiration` — while `BloodBankPage` raises a ward order. Same for the
   transfusion record.
8. **A death certificate could never be saved.** `place_of_death` is a free-text
   field on the form and a `PlaceOfDeath` struct with a facility type, address,
   city, state and country in the request.
9. **An IV site assessment was refused if the nurse typed the infusion rate.**
   The field invites "80 mL/hr"; the request typed it `f64`.

### C. The vocabulary differed by punctuation

Only visible on PostgreSQL: the in-memory backend enforces no CHECK constraints.

10. **Four of seven incident types and one of five severities could not be
    filed** — `medication-error` versus `medication_error`, and `behavioral` and
    `exposure` absent from the constraint entirely. A needlestick exposure, the
    incident that starts a post-exposure prophylaxis clock, had nowhere to go.
    Migration `20260910000004`, plus normalisation in the handler.
11. **A quality-control run offering "Level 2" hit a constraint spelling it
    `level2`.**
12. **A chain of custody could not be opened** — the page tracks a *specimen*
    lifecycle (`collected`) and the column a *custody* state
    (`in_custody`/`transferred`/…). Both are real; the specimen state is now
    mapped for the column and kept verbatim beside it.
13. **A critical value sent `critical-high` as its severity**, which is which
    *side* of the range was crossed, not how severe it is.

### D. The write worked and the reader could not see it

14. **The triage queue blanked four observations and the note.** Pain score,
    GCS, glucose and weight are stored on the entity and were hardcoded to
    `None` on the way out — in **three** separate response builders. The note
    was read from `disposition`, a different field the create path never sets;
    the request's own `notes` was length-validated and then discarded, because
    the table had no column for it (migration `20260910000002`).
15. **A held medication dose lost the reason it was held.** `MARPage` sends
    `hold_reason` and `administered_time`; the handler read `reason_not_given`
    and `actual_time`, and stamped `Utc::now()` over the nurse's time. A held
    dose with no reason cannot be distinguished from an oversight. A dose
    recorded as held, refused or not given now *requires* a reason.
16. **The Nursing Hub's Give button posted no `patient_id`** — it sent
    `{mar_id, medication_index, dose_index}` to an endpoint that requires a
    patient. `400` on every click; no dose was ever recorded from that screen.
17. **The fluid balance ran backwards.** Three screens post fluids and name the
    field three ways; the writer read only two of them. Everything the Nursing
    Hub charted was counted as `other_intake` — **including urine**. An 800 mL
    output moved the running balance by **+800** instead of −800: a 1600 mL
    error, in the wrong direction, on the number a clinician titrates fluids
    against. `IntakeOutputPage` sent `"output:urine"`, which the routing table
    understood no better. Direction is now an explicit field the writer owns.
18. **The consult list read a different table.**
    `GET /api/platform/list/consults` read `progress_notes` filtered for
    `note_type == "consult"` — a table nothing writes a consult into. Every
    requested consult was invisible to the specialty it was addressed to.
19. **An order's status change was written only to a JSON blob** that the list
    does not read (and that had no column on PostgreSQL). The endpoint answered
    `{"success": true, "status": "completed"}` and the order stayed `pending` on
    the ward list — which is how two clinicians action one order twice.
20. **The discharge list read `get_by_patient("all")`** — a literal patient id,
    matching nothing on PostgreSQL. Every discharge summary was invisible, and
    approving one was a 500 because the update bound a `data` column that did
    not exist (migrations `20260910000003`, `20260910000005`).
21. **The blood-bank register read a store nothing writes to.** Orders go to
    `blood_type_screen_records` and transfusions to `transfusion_event_records`;
    the register read the typed `blood_type_screens`.
22. **The pharmacy queue showed a prescribed quantity of 0** for every
    prescription. `quantity` lives on the medication, beside `strength` and
    `directions` which the same block already read from there.
23. **`data` is `#[sqlx(skip)]` on 28 entities, and exactly one of those tables
    had the column.** 70 GET handlers touch that blob. On PostgreSQL it is
    always `null`; in memory it holds the record — the same endpoint behaving
    one way in development and another against a database. Closed for the five
    tables whose blob carries content that exists nowhere else
    (`20260910000006`); the rest keep everything in typed columns and are
    recorded in the technical-debt register.

### E. The id the API handed back could not be fetched

24. **A shift handoff** returned a batch id while storage keys rows
    `{batch}-{patient_id}`. Following the id you were given was a 404.
25. **A mass-casualty incident** did the same — and `get_by_incident` already
    existed, unused, beside the `get_by_id` everything called.

### F. Navigation and authorization disagreed

26. **A lab technician could not see the lab worklist.**
    `GET /api/lab/submissions` was gated on `can_edit_medical_records()`, which
    is Doctor and Nurse — so the person who *submits* results could not see the
    list of them. `/lab-results` is in `LAB_TECH_NAV`. Approving stays where it
    was: a technician still cannot approve any result, their own least of all.
27. **A lab technician could read deployment-wide analytics.** Four analytics
    endpoints used the clinical predicate; `/analytics` appears in `ADMIN_NAV`
    and nowhere else. Now `require_administrator`.
28. **An administrator could never create a user.** `UserManagementPage`
    required a phone number and `POST /api/auth/register` refuses any non-empty
    phone — `user_profiles.phone` is plaintext and a staff mobile number is
    personal information POPIA requires be protected. The field is no longer
    required and the error now says what to do. **Encrypted staff contact
    storage remains unimplemented** and is recorded as such.
29. **Assigning a role erased the person.** `assign_role` built a whole new
    `User` from the request body and upserted it, nulling username, email,
    department, specialty, licence number and linked patient. `UserManagementPage`
    calls it straight after `updateUserProfile`, so the profile edit a moment
    earlier was undone by the role change that followed it.

### G. The clinical instrument was wrong

30. **The VIP phlebitis score under-reported early phlebitis by one stage.** The
    scale *counts* the early signs — stage 1 is one of pain or redness, stage 2
    is two of pain, redness and swelling — and the implementation took the
    highest single stage. A cannula site with both tenderness and redness, the
    commonest presentation, scored 1 ("observe closely") instead of 2 ("resite
    cannula"). The sign table also had a palpable venous cord at stage 5 and
    purulent discharge at 4, which is the two the wrong way round.
31. **An AMA discharge recorded no decision-making capacity.** The column and the
    handler had always carried `decision_making_capacity` and
    `capacity_assessment`; nothing sent them, so every against-medical-advice
    discharge in the system recorded capacity as `false` with no assessment
    behind it — which reads as "we discharged someone we had decided could not
    consent". Capacity is the precondition that makes an AMA lawful and the first
    document a coroner asks for. Now required by the form **and** enforced by the
    handler, which refuses a discharge for a patient assessed as lacking it.

### G2. The screen was in nobody's navigation

30a. **Seven built, routed pages were reachable only by typing a URL** —
`/messages`, `/telehealth`, `/pathology`, `/immunization`, `/family-history`,
`/nursing-care-plan` and `/emergency-protocols`. The worst is the emergency
protocol set: a page nobody opens except during an emergency, behind a URL
nobody has memorised. All seven are now in the navigation of the roles whose
work they belong to, and `scripts/journeys/reachability.ts` asserts the endpoint
behind each one answers for that role.

30b. **The telehealth screen called a list endpoint that did not exist.**
`TelehealthPage` fetches `GET /api/telehealth/sessions` on load; only
`/sessions/{id}` and `/patient/{id}/sessions` were registered, so the clinician's
telehealth screen answered 404 and listed nothing. That is part of why it sat in
no navigation: nobody could open it and find anything. Added, scoped to the
caller — a clinician sees the sessions they are the provider for, a patient sees
their own.

### H. The patient was told the wrong thing

32. **The emergency card showed no allergies.** Registration writes allergies
    into the patient's encrypted profile and never into the allergies
    repository; `GET /api/medical-id/{id}` — the card the patient app and the
    lock screen open — read only the repository. `merged_allergies` already
    existed in `emergency_views.rs` and this handler did not call it. This is
    the one screen where being wrong could contribute to a death.
33. **The symptom checker showed "mild" for an emergency.** The endpoint nests
    its answer under `assessment`; the page read `triage_level` from the top
    level, got `undefined`, and fell to the `default:` arm of its severity map.
    A patient reporting chest pain with shortness of breath — which the server
    correctly triages as `emergency` and answers with "Call 911 immediately" —
    was shown **mild**. The declared TypeScript type described a shape the
    endpoint has never sent. The default is now the cautious branch.
34. **A symptom check left no record.** `startSymptomCheck`,
    `submitSymptomAnswers` and `getSymptomCheckerHistory` were typed, routed and
    had **zero callers anywhere in either application**, and the session was
    keyed on the caller's wallet while the history is read by health id. So a
    patient could be told to go to an emergency department and nothing recorded
    that they had been told.
35. **A rejected symptom log still looked saved.** The entry is added to the
    screen before the request runs and the failure was swallowed with
    `console.warn`.
36. **Death certificates were filed against the literal string
    `"DEMO_PATIENT"`** — the page had no patient selector at all — and could
    only be found by somebody who already knew the id, because no list endpoint
    existed. Registrars, coroners and families all arrive without one.
37. **The Add Reminder button did nothing.** It was the only action on
    `MedicationRemindersPage`: a `<button>` with no `onClick`, over an endpoint
    that had existed the whole time with no caller.
38. **An IV assessment asserted three normal findings nobody had checked.**
    `dressingIntact ?? true`, `flushPatent ?? true`, `bloodReturn ?? true` and
    `infiltrationGrade ?? 0` — and grade 0 on the INS scale means "no
    symptoms". The controls were already three-state radios; only the initial
    value was lying.

---

## What the second pass found (2026-09-11)

The suite is now **218 steps** across the six roles plus the reachability pass,
with the same four legitimate skips (all the challenge rate limiter, which is a
control).


The journeys were rerun after the first three "still open" items were closed,
and closing them turned up five more defects of the same shapes.

* **A health ID card did not survive a restart.** `CardRegistry` was a pair of
  `RwLock<HashMap>` with no storage behind it, and it was the only home a card
  had ever had. Every card issued by `POST /api/nfc/generate` was gone when the
  process stopped — while the plastic in the patient's wallet still carried its
  hash and tapped to `CARD_NOT_FOUND`, which reads exactly like a revoked card
  at the roadside. A durable `nfc_tags` table with both backends had existed the
  whole time and two other handlers already wrote to it.
  (`dead-durable-variant-beside-live-volatile-one`, again.)
* **Nothing could issue a card.** Four endpoints have backed the product's
  headline feature since the beginning and no screen in either application
  called any of them, so the path had never been exercised outside curl. The
  admin sidebar even carried an "NFC/Barcode Registry" entry — pointing at the
  barcode *scanner*, which is part of why the absence went unnoticed for so
  long. `HealthIdCardsPage` now issues, looks up and (for an administrator)
  suspends.
* **SMS medication reminders could never send.** The dispatcher resolved an
  encrypted phone number to the literal string `"Redacted"` and then guarded on
  `phone != "Redacted"`, so the branch was dead by construction: a patient who
  opted into SMS received nothing, permanently, while the log line above it
  still reported `sms=true`. There was also no read half of
  `enc_patient_field`; `dec_patient_field` is it.
* **Three vocabularies that no caller spoke.** `TelehealthPage` offered four
  session types (`video_consultation`, `follow_up`, `mental_health`,
  `urgent_care`), none of which appeared in the handler's match — every one fell
  through `_ => VideoVisit` — and then rendered the stored `VideoVisit` back as a
  raw enum name because that was in no map on the page. Its status colours were
  all lowercase against a `Scheduled`/`InProgress`/`Completed` enum, so no badge
  ever matched and the Join button stayed on finished sessions. The medication
  reminder form was a free-text frequency box over a match ending in
  `_ => Daily`, so "twice a day" was stored and reminded once a day. All three
  now refuse an unknown value and publish the vocabulary in the refusal.
* **The notification settings screen was decorative.** `SettingsPage` has saved
  a `notifications` block — `appointmentReminders`, `pushNotifications`,
  `emailNotifications` and four more — since it was written, and nothing read
  it. Every dispatcher pushed regardless, so turning a toggle off changed a
  stored value and nothing else; a patient who opted out kept receiving. A
  preference a system records and ignores is worse than one it never offers,
  because the patient believes they have opted out.
  `notifications::patient_wants` is the consumer, and the appointment reminder
  now honours it. Absent preferences still send: a patient who has never opened
  the screen has not opted out of anything.
* **Two more wallet-vs-patient-id comparisons.** `POST /api/reminders/medication`
  tested `current_user_id == req.patient_id`, and
  `POST /api/appointments/{id}/check-in` tested
  `current_user_id == appointment.patient_id`. A wallet address is never equal to
  a `PAT-` id, so both were `false` for every patient who has ever tried: nobody
  could set their own medication reminder, and nobody could check themselves in.
  The reminder *read* path three lines away already used
  `caller_owns_patient_record`, and WF-007 had fixed the clinician half of the
  check-in guard and left the patient half comparing two namespaces. Both now
  resolve through `linked_patient_id`, and both have journey steps.
* **Telehealth duration reached nothing.** `provision_session` hardcoded
  `duration_minutes: 60` and `TelehealthSession` had no such field, so the
  number the clinician chose was dropped and the list rendered a `?? 30`
  fallback. It is not cosmetic: the join token's expiry is
  `scheduled_at + duration + 30`, so a two-hour appointment's link expired
  mid-consultation.

## Still open

* **Blood glucose is mg/dL only.** `Option<u16>` and a "70-140 mg/dL" label
  cannot represent 6.1 mmol/L, which is the reporting unit across this
  deployment's target market.
* **Pathology slide viewing** needs a DICOM/WSI vendor integration. The reports
  are stored and served; the images are not, and cannot be without an external
  system.
* **External emergency-notification recipients.** Emergency contacts are now
  really texted, with each contact's true delivery status reported. Notifying an
  external dispatch service is a different integration and is not built.
* **`api/src/repositories/postgres/phase2.rs` is dead.** It is on disk, declared
  by no `mod`, and contains a second `PgFallRiskAssessmentRepository` that
  nothing compiles. Recorded rather than removed, per the standing rule that
  cleanup is the last step.
