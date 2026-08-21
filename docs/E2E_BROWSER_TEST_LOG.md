# End-to-end browser test log

Every item here was exercised by driving the real UI in a browser — selecting
patients, filling forms, clicking submit — against the live API on `:8090` with
the PostgreSQL backend, then verified in the database and read back through the
patient-facing download. Nothing in this file was established by a unit test.

Test patients (the three active records):

| Patient | ID | Wallet |
|---|---|---|
| Lerato Modise | `PAT-cc913e70` | `5FLSigC9…S64D` |
| Thandiwe Ncube | `PAT-3b765e2d` | `5FLSigC9…S62B` |
| Thandi Durable Workflow | `PAT-9bb16530` | `5Ri1JbtB…2Kcu` |

Providers: Dr. Thabo Mbeki (Doctor), Nurse Thembi Molefe / Nurse Zanele Dlamini
(Nurse), Lab Tech Mpho Mokoena (LabTechnician), Pharm. Lerato Sithole
(Pharmacist), System Administrator (Admin). The database's `users_role_check`
constraint admits no `Pediatrician` role — paediatrics is a Doctor working in the
paediatric workflows, so that is how it is covered.

## Defects found and fixed

### 1. Doctor dashboard showed zero patients
`/api/dashboard/doctor` returned `assigned_patients` carrying raw
`PatientEntity` rows; the portal reads `patients.list` with `full_name`. None of
the keys matched, so every stat card read 0 and the roster was empty even with
three patients present. The entity also carried `national_id_hash` and
`key_version` to the client while containing no readable name at all.

Fixed by projecting a minimised, decrypted `DashboardPatient` and returning the
shape the page actually consumes, including the alert counts.

### 2. Patient portal crashed on `/records`, blanking the whole app
`assessment.primary_diagnosis` is a structured object
(`{description, icd10_code, status}`), not a string. Using it as a record title
threw `record.title.toLowerCase is not a function`, and because the patient app
had **no error boundary at all**, the crash blanked every route — including the
emergency medical ID.

Fixed on three levels: read `.description`; coerce defensively in the search
filter; and move the doctor portal's `ErrorBoundary` into `@medichain/shared`,
wrapping the shared `Layout`'s `<Outlet/>` so a page crash leaves navigation
usable. The boundary is keyed on the path so navigating away resets it.

### 3. Triage assessments could be written but never read
`triage_assessments.temperature` / `weight` are `numeric` in the schema while
`TriageAssessmentEntity` declares `Option<f64>`. sqlx will not decode NUMERIC
into f64, so `SELECT *` failed to decode **every** row: the record sat in the
table but the patient-facing download returned `RECORD_NOT_FOUND`.

Fixed with an explicit projection casting `numeric::float8` at the read
boundary. The same latent bug was found and fixed in `vaccine_inventory`
(`storage_temperature_min` / `_max`). A cross-reference of every `numeric`
column in the schema against its Rust entity confirmed these were the only two;
all other numeric columns correctly use `rust_decimal::Decimal`.

### 4. Triage create reported success after the write failed
The handler logged the repository error and returned `201` anyway, so a
clinician saw "assessment created" for a record that was not saved. It now fails
closed with `REPO_ERROR`.

### 5. Triage silently discarded GCS, blood glucose and weight
The form collects them and the request model carries them, but the handler
hardcoded `gcs_score: None, blood_glucose: None, weight: None`. Entered clinical
values were accepted and dropped. Now persisted, and the patient-facing document
renders the complete vitals set.

### 6. SOAP note diagnosis rendered as a dash
Same structured-diagnosis cause as (2), on the server side: the download read
`primary_diagnosis` as a string. It now renders the description plus the ICD-10
code when present, and any secondary diagnoses.

### 7. Record timestamps rendered as a dash
Documents store times as unix seconds; the renderer only handled strings, so
every "Recorded" line was blank. A shared `timestamp_text` helper now handles
both.

### 8. Patients had no way to record their own details
The profile page was read-only apart from adding an emergency contact, and the
`PatientProfile` type it used omitted address, insurance, phone, gender and
languages entirely — even though all of them round-trip losslessly in the
encrypted profile blob.

Added `PUT /api/patients/{id}/demographics` and
`PUT /api/patients/{id}/emergency-contacts`, deliberately separate from the
provider-only clinical update: a patient is authoritative for where they live
and who insures them, but not for their own blood type. The profile page now has
editable Contact Details, Home Address and Medical Aid / Insurance sections, and
emergency contacts can be added, flagged as decision-makers, and removed.

### 9. History & Physical had never once saved

Three independent faults, each fatal on its own:

* The endpoint deserialised the form body straight into the clinical
  `HistoryAndPhysical` type, which disagrees on every field — `hpi` vs
  `history_of_present_illness`, `exam_time: i64` vs an ISO `dateOfExam`,
  `performed_by` vs `provider`, and six `Vec<String>` sections the form sends as
  free text. Every submission was rejected with 400.
* `history_physicals` had no `data` column (the entity carries one) and typed
  `performed_by` as a `uuid` FK to `users.id` while the API writes wallet
  addresses, so the insert failed twice over.
* `list_all` was never implemented for PostgreSQL — only the trait default that
  returns an error, which the endpoint swallowed into an empty list. The memory
  backend *did* implement it, so this was invisible until PostgreSQL was used.

Beyond that, **20 of the form's 24 inputs were unbound** — no `value`, no
`onChange` — so even a valid submission would have carried almost nothing, and
the vitals section asked for °F and pounds in an otherwise metric product.

Now: an anti-corruption DTO on the endpoint, a migration adding `data` and
converting `performed_by`, a PostgreSQL `list_all`, every input bound, metric
units, and an auto-calculated BMI. Verified end to end — history, social history,
vitals, review of systems, physical exam and assessment all persist and read back.

### 10. Wallet-vs-UUID actor columns broke 33 clinical tables

`wound_assessments.assessed_by` rejected a save with
`column "assessed_by" is of type uuid but expression is of type text`. Deriving
the pattern from the schema rather than fixing it case by case found **57 actor
columns across 33 clinical tables** with a UUID foreign key to `users.id`, while
the API's canonical caller identity is an SS58 wallet address.

Every one of those features could be exercised against the in-memory backend and
looked correct, then silently refused to save on PostgreSQL. Migration
`20260819000002` converts them all to `VARCHAR(66)`, and drops/recreates the 12
dependent views against `users.wallet_address` — as `v_pending_radiology`
already did. The views come back as LEFT JOINs, because an INNER JOIN silently
hides a clinical record whose author is not a registered user row.

`sessions.user_id` and `user_profiles.user_id` are deliberately excluded: those
are genuine account-linkage keys that correctly use UUIDs.

### 11. Wound care was a mockup

The assessment tab had no state, no handler, and a Save button with **no
`onClick` at all**; its patient picker was built from existing wound records, so
a patient without a wound could never be selected and a first assessment was
impossible. The list view then crashed on `w.measurements.map` because the page's
interface and the API's response share no field names — it looked fine only
while the table was empty.

The server-side mapper also hardcoded `length_cm`/`width_cm`/`depth_cm` to
`None`, discarding the measurements.

Now wired end to end against the real roster, with measurements persisted, a
proper API-to-view mapping, and clinician names resolved through a new shared
`useProviderDirectory` hook instead of printing a 48-character wallet address.

### 12. Vite dev server died whenever the API restarted

The proxy's error handler assumed an HTTP response, but `/api/events` is an SSE
stream whose `res` is a raw socket with no `writeHead`. An API restart therefore
took the whole dev server down rather than failing one request. Both portals now
destroy the socket instead.

## Open findings not yet fixed

### Correction to an earlier claim

An earlier pass reported these four pages as having "no POST anywhere in the
file". That was wrong for two of them: `IncidentReportPage` and
`IntakeOutputPage` both submit through shared client functions
(`createIncidentReport`, `createIntakeOutput`) rather than a literal `fetch`, so
a grep for `POST` missed them. They were still non-functional, for the different
reasons recorded below.

All four are now wired and verified end to end.

### Documents the patient portal never surfaces

`MyRecordsPage` lists IPFS records, lab submissions, SOAP notes, prescriptions
and triage assessments. It does **not** list History & Physical, progress notes,
wound assessments or vital-sign records, so a patient cannot see documents that
were created about them. The download dispatch would need matching branches.

### Smaller items

- **Uninterpolated i18n placeholder.** Patient pickers render `Health ID: {{id}}`
  — the call site passes no `id` variable.
- **Hardcoded placeholder content.** The nurse dashboard's "Tasks Due" list shows
  fixed times, "Room 403" and "ICU-2" regardless of the ward.
- **Login screen.** Three demo users render as "(Patient)" with no name.
- **Permission-denied pages render nearly empty.** As a Doctor, `/admin`,
  `/user-management` and `/analytics` correctly 403 but paint a blank page
  instead of saying the section is administrators-only. (`/e-prescribe` now does
  this properly and is the pattern to copy.)
- **PWA offline page latches.** A brief API outage makes the service worker serve
  "You're Offline" for the app shell until caches are cleared.
- **Pluralisation.** The dashboard renders "1 allergies".
- **Float widening.** A temperature of 36.8 stores as 36.79999923706055 because
  the clinical type is `f32` and the column is `double precision`; display
  formatting hides it.
- **Test-schema leak.** 28 `medichain_test_*` schemas are present again and the
  database has grown to 815 MB. Test teardown does not drop them.

## Verified working end to end

| Workflow | Portal | Evidence |
|---|---|---|
| Patient contact details / address / insurance | Patient | `PUT …/demographics` → 200, persisted across an API restart |
| Emergency contacts (7 added, 1 removed, priorities renumbered) | Patient | `PUT …/emergency-contacts` → 200, verified in Postgres |
| Cross-patient profile write denied | Patient | 403 |
| Triage assessment (ESI 3, Thandiwe Ncube) | Doctor | `TRIAGE-14c3b5e3` in Postgres |
| Triage assessment (ESI 2, Thandi Durable Workflow) | Doctor | `TRIAGE-6b5f8877`, full vitals, downloads as a readable document |
| SOAP note (Lerato Modise) | Doctor | `SOAP-33ef53c8`, diagnosis now renders |
| Doctor dashboard roster | Doctor | 3 patients with names, blood types, allergies |
| All 75 doctor routes render | Doctor | No error boundary, no blank page |
| All 25 patient routes render | Patient | No error boundary, no blank page |
| Triage with full vitals (GCS, glucose, weight) | Doctor | `TRIAGE-6b5f8877` reads back complete |
| Vital signs flowsheet | Doctor | `VS-09dbd997`, all 10 fields in Postgres |
| Progress note, signed | Doctor | `PN-1787097061453`, status `final` |
| History & Physical, signed | Doctor | `HP-fd40f4a9…`, every section persisted |
| Wound assessment x3 | Doctor | `WND-…`, measurements + tissue types persisted |
| Wound list renders with real names | Doctor | areas 5.0 cm² and 13.0 cm² computed correctly |


## Final verification (2026-08-19)

**Every document a patient can see opens.** Driving the same endpoints the
patient portal uses, for all three patients:

```
Lerato Modise (PAT-cc913e70)   26 documents
Thandiwe Ncube (PAT-3b765e2d)   2 documents
Thandi Durable Workflow          1 document
--------------------------------------------
documents listed: 29   opened: 29   failed: 0
```

Nine of Lerato's are 32-byte synthetic seed documents from an earlier harness
run; they return their real stored body. A first pass reported "10 of 13 failed"
— that was the probe issuing two requests per document and tripping the API's
rate limiter, not a broken download. Pacing the requests showed every one
returning 200 with content.

**Nothing is lost on restart.** Row counts before and after stopping and
restarting the API against PostgreSQL:

| Table | Before | After |
|---|---|---|
| patients (active) | 3 | 3 |
| triage_assessments | 2 | 2 |
| vital_signs | 12 | 12 |
| progress_notes | 2 | 2 |
| history_physicals | 1 | 1 |
| wound_assessments | 2 | 2 |
| specimen_collections | 2 | 2 |
| lab_submissions | 2 | 2 |
| e_prescription_v2_records | 12 | 12 |
| medical_records | 29 | 29 |

The roster reads `total: 3, unreadable: 0`, and Lerato's self-entered address,
insurance and six emergency contacts survive intact. The encryption keyring
loads from `.env` and is stable across restarts — the ephemeral-key problem that
orphaned 69 patient records was already fixed on 2026-08-14.

**Gates:** 397 Rust tests pass, `clippy -D warnings` clean, both portals
typecheck.

## A note on prescribing by nurses

Creating a prescription as a nurse was requested but is not possible, and should
not be: `create_e_prescription` enforces `Only physicians can create
prescriptions`, and nurses are not independent prescribers in this model. The
defect was the user experience, not the rule — a nurse could open the page, fill
in every field and only discover the restriction as a generic "Error creating
prescription" on submit. `/e-prescribe` now states the restriction up front and
disables the submit button for non-physicians.

The doctor-authored prescription was created, signed and transmitted, and is
visible to the patient. Before this, "Send Prescription" only created a Draft —
the `/sign` and `/transmit` endpoints existed but were never called, so every
prescription in the system sat unsigned and no pharmacy would ever have received
one.


## Round two - the four decorative forms and the remaining dashboards

### 13. Incident reporting could never pass its own validation

Seven of the wizard's inputs were unbound, including `description`, `location`
and `dateTime` - the three fields `handleSubmitReport` requires. The form could
therefore never be submitted at all. The department options also carried no
`value`, so the stored department would have been whichever translated label the
user's locale rendered.

Server-side the endpoint wanted the structured `clinical::IncidentReport`, and
its mapper hardcoded `severity: "reported"` - discarding the severity a reporter
had chosen, on a patient-safety record. Now a DTO matching the wizard, with
severity, department, patient link and reporter preserved. The list view was
also reading camelCase fields off snake_case rows, which threw as soon as one
report existed; it now maps properly.

Verified: a moderate-severity fall for Thandi Durable Workflow, filed against
Ward B room 412 at 02:15, visible in the list with correct counts.

### 14. Medication administration had no link from prescribing

The eMAR grid mapped each MAR *record* as though it were one drug, and those
records carried empty `scheduled_medications`, so every row rendered with a
blank medication name and nothing could be administered. There was no path at
all from a prescription to the nurse's MAR.

`/api/emergency/mar/list` now derives rows from **transmitted** prescriptions.
`scheduled_times` is deliberately left empty rather than invented - an
e-prescription carries free-text directions, not a dosing schedule - and an
"Administer" action was added so an unscheduled dose can still be recorded (as
PRN) instead of the row being a dead end.

The administration record itself was dropping status, actual time, site,
witnessing nurse, patient response, barcode scan and the five-rights
verification, keeping only drug/dose/route. A held dose was indistinguishable
from a given one. All of it is now persisted.

Verified: Amoxicillin 500mg administered against Thandiwe Ncube's transmitted
prescription, then a second dose recorded as **held** with the reason "patient
reported new rash", both stored in full.

### 15. Nursing care plans could not be created

No form state, no handler, a button with no `onClick`, and a patient picker
built from existing care plans - so a patient without one could never be
selected. Underneath, `nursing_care_plans` had no `data` column even though the
entity persists one, so the insert failed regardless.

A schema cross-reference found the same missing column on `consultation_notes`;
migration `20260819000003` adds both.

Verified: a high-priority plan for Lerato Modise, "Impaired skin integrity
related to immobility", stored with diagnosis, priority and author.

### 16. Intake/output could not record a fluid entry

The endpoint expected a whole shift's `IntakeOutputRecord` with running totals
while the form submits a single fluid event, and the ward list was built from
raw records that carry no patient name - every card showed the untranslated
`MRN: {{mrn}} - Room: {{room}}`.

The endpoint now takes the entry the form actually sends, normalises the amount
to millilitres (a US fluid ounce is 29.5735 ml - mixed units in one column would
make fluid balance meaningless), and routes it through the existing
`append_io_event` helper so running totals stay consistent. The list is built
from the roster.

Verified: 240 ml oral intake for Thandi Durable Workflow, stored with
`total_intake 240 / total_output 0 / net_balance 240`.

### 17. Every remaining role dashboard returned the wrong shape

Lab, pharmacy and administration each read keys the API never returned, so all
three landing pages reported zero. All now return what their pages consume:

* **Lab** - `test_queue.pending` enriched with the patient's name and the test
  ordered (raw entities rendered every row as "Unknown / Unknown Test"), plus QC
  records, specimen rejections and unacknowledged critical values.
* **Pharmacy** - a flattened prescription queue (the stored document nests the
  drug under `medication`, which threw on `rx.medication_name.toLowerCase()` and
  took the page down), counts that treat only **transmitted** prescriptions as
  pharmacy work, unacknowledged interactions, and allergy alerts drawn from
  patients' records.
* **Administration** - per-role staffing, the week's access log, an
  emergency-event summary, lab throughput and NFC card totals. Stroke, trauma,
  sepsis and NFC data are only queryable per patient, so they are counted in one
  pass over the roster rather than through a listing that does not exist.

Verified in the browser: 89 users (4 doctors, 2 nurses, 1 lab technician, 1
pharmacist, 79 patients), 20 access logs, 2 pending lab specimens showing
"Thandiwe Ncube / Full blood count", and 4 allergy alerts naming real patients.

The pharmacy allergy panel also rendered `Ordered medication: {{medication}}`:
the alert is a standing allergy on the patient's record, not a reaction to a
specific order, so there was never a medication to name. It now shows the
recorded reaction and severity.

### A note on this round

Rewriting five handlers in one file with regex-based edits corrupted it twice -
once deleting `nurse_dashboard` and `lab_dashboard` outright, once moving a
block into the wrong function. Both were caught by the compiler rather than by
review. The file was restored from git and every handler re-applied by locating
its `pub async fn` line and matching closing brace individually, which cannot
reach into a neighbouring function.

### Gates after round two

397 Rust tests pass, `clippy -D warnings` is clean, both portals typecheck, and
every one of the seven workflows survives an API restart:

| Table | Rows after restart |
|---|---|
| incident_reports | 1 |
| nursing_care_plans | 1 |
| io_records | 12 |
| medication_records with administrations | 9 |
| wound_assessments | 2 |
| specimen_collections | 2 |
| history_physicals | 1 |

Three superseded structured mappers (`io_record_entity`,
`nursing_care_plan_entity`, `incident_report_entity`) are now unused. They are
marked `#[allow(dead_code)]` rather than deleted, and recorded in
`docs/TECHNICAL_DEBT_REGISTER.md`.
