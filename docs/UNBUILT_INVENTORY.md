# What is not built

**Opened 2026-09-15.** Scope: every write endpoint (`POST`/`PUT`/`PATCH`/
`DELETE`) the API registers, and whether anything in either client calls it.

## How this was measured, and the three ways I got it wrong first

This matters more than the list, because each wrong method produced a confident
wrong answer:

1. **Searching page sources for the literal URL.** Pages call the **shared
   endpoint functions**, so the URL appears only in `endpoints.ts`. All six
   findings were false; one of them ("no page posts a laceration repair") was
   reported and acted on before it was caught.
2. **Matching shared functions at their call sites.** `import { analyzeSymptoms
   as analyzeSymptomAPI }` defeats that. The symptom checker read as unused
   while a passing journey step proved otherwise.
3. **Matching by URL *stem*** — the literal prefix before the first parameter.
   `/api/insurance/cards`, `/api/insurance/cards/{id}` and
   `/api/insurance/cards/{id}/image` collapse to one key, so a route the client
   does use vouched for two siblings it does not.

The method now matches on the **full URL shape**, every path parameter
normalised to `{}` on both sides, and treats a route as reachable if a shared
function of that shape is *imported* anywhere (aliased or not) or the raw URL
appears in client code. Script: `scripts/audit/unbuilt-audit.py`.

**A clean result from this script still is not a finding.** "No caller" is not
"not built" — a route may be superseded by a sibling the page uses instead, or
be machine-to-machine by design. Everything below that is marked *verified* was
opened and read; everything marked *untriaged* was not.

## Result

**206 write endpoints. 83 have no caller in either client.**

### A. Dead code — registered nowhere (1, verified)

| Endpoint | Evidence |
|---|---|
| `POST /api/auth/login` | Handler `wallet_login` carries `#[allow(dead_code)] // route is unregistered`, and is absent from `routes.rs`. Unreachable. |

### B. Superseded duplicates — the screen uses a different route (verified)

Not missing features. The page does the thing; it does it through another
endpoint, and the older one was never retired.

| Unused endpoint | What the screen actually calls |
|---|---|
| `POST /api/surgical/e-prescription` | `POST /api/e-prescriptions` (`EPrescribePage`) |
| `POST /api/surgical/autopsy` | `POST /api/surgical/autopsy/report` (`AutopsyPage`) |
| `POST /api/surgical/appointment` | `POST /api/appointments` (`AppointmentSchedulerPage`) |
| `POST /api/appointments/{id}/cancel` | `POST /api/appointments/{id}/status` — the Cancel button calls `setAppointmentStatus(id, 'cancelled')` |
| `POST /api/emergency/administer-med` | `POST /api/nursing/mar/administer` (the handlers share one writer) |
| `POST /api/emergency/record-fluid` | `POST /api/nursing/intake-output/record` (same) |
| `POST /api/insurance/cards/{id}/image` | **false positive** — `uploadInsuranceCardImage` *is* imported by `InsurancePage`; listed here only because method 3 conflated it with its siblings |

A further 14 look like the same pattern on the automated sibling check and are
**untriaged**: `/api/cds/alerts`, `/api/clinical/soap/{id}/addendum`,
`/api/clinical/specimen-recollection/{id}/cancel`,
`/api/clinical/specimen-rejection`,
`/api/e-prescriptions/{id}/verification/revoke`,
`/api/family/groups/{gid}/members/{pid}`, `/api/identity/context/patient`,
`/api/identity/context/switch`, `/api/insurance/cards`,
`/api/insurance/cards/{id}`, `/api/insurance/claims`,
`/api/insurance/claims/{id}/submit`, `/api/templates/notes/use`,
`/api/wearables/readings`.

### C. Machine-to-machine — no screen expected (untriaged, but named)

These are not UI gaps by their own documentation. Listed so nobody "fixes" them:

* `POST /api/notifications/sms/inbound` — carrier webhook, honours a real STOP.
* `POST /api/mobile/devices/register`, `/{id}/lockscreen-token`, `/{id}/revoke`,
  `POST /api/mobile/records/authorise` — patient-owned **native** device APIs;
  the key material stays on the device, so a web client is the wrong caller.
* `POST /api/organizations/{id}/keys`, `/keys/{key_id}/status` — federation
  key registry, proof-of-possession between servers.
* `POST /api/simulate-nfc-tap`, `POST /api/nfc/tap` — both documented as
  simulation/demo endpoints.

### D. Built on the server, no screen anywhere (verified samples)

The real answer to "what is not built". Each was opened and confirmed to have a
shared endpoint function with **no importer**:

| Endpoint | Shared function | Note |
|---|---|---|
| ~~`POST /api/lab/submit`~~ | `submitLabResults` | **BUILT 2026-09-15.** All four lab screens only read, QC or review, and the technician's quick action labelled "Enter Result" pointed at a review page. `LabResultsPage` now has an entry form. |
| ~~`POST /api/emergency-access`~~ | `requestEmergencyAccess` | **CORRECTION — not a gap.** `NFCTapSimulator` calls `grantBoundEmergencyAccess`, a newer device-bound flow. The feature is built; this route is superseded. I had verified only "no importer", which is not the same as "feature missing", and reported it as though it were. |
| ~~`POST /api/nfc/tap`~~ | `nfcTap` | Same correction, same flow. |
| `POST /api/clinical/gcs` | `createGCS` | **Still open, verified.** GCS is captured only as a *field* inside the Sepsis and Trauma scores (`glasgow_coma_scale`, `gcs_score`); nothing writes a standalone GCS assessment with its eye/verbal/motor components, though `/api/clinical/patient/{id}/gcs` exists to read them. |
| `POST /api/appointments/{id}/check-in` | `checkInAppointment` | The patient journey exercises it; no patient screen does. |

Untriaged but in the same category on the evidence so far — **admin and
security**: the whole retention workflow (`/api/admin/retention/*`, 6
endpoints), `POST /api/admin/security/breach`, `PUT /api/admin/cds/thresholds/{id}`;
**authentication**: all four `/api/auth/mfa/*`, both `/api/auth/step-up/*`,
`/api/auth/transaction/challenge`, `/api/auth/session`, `/api/auth/bootstrap`,
`/api/auth/credentials`; **emergency**: `/api/emergency/grants`,
`/grants/{id}/revoke`, `/api/emergency/nfc-token`, `/api/emergency/ems-handoff`,
`/api/patients/{id}/emergency-capsule` and its revoke,
`/api/medical-id/{id}/emergency-notify`, `/api/nfc/verify-mine`,
`/api/nfc/verify-qr`; **consent and guardianship**: `/api/consent/{id}/revoke`,
`/api/guardians/verify`, `/api/guardians/revoke`,
`PUT /api/guardians/{id}/permissions`, `/api/identity/claim`; **devices**:
`/api/devices/enroll`, `/{id}/revoke`, `/{id}/rotate`, `/api/sync/register`;
**clinical**: `/api/clinical/discharge-instructions`, `/api/clinical/sample`,
`/api/platform/vitals`, `/api/lab-trends/analyze`,
`/api/wearables/alerts/rules`, `/api/telehealth/device-check`,
`/api/barcode/generate`, `/api/platform/translate`, `/api/national-id/verify`,
`/api/insurance/eligibility`, `/api/insurance/verify`,
`/api/notifications/sms/opt-in`, `/opt-out`.

## The other list: repositories with no code path

Separately verified (both a single-line and a line-break-tolerant search; the
only two hits were comments): **all 22 typed repositories marked superseded in
migration `20260912000001` have zero callers.**

They split in two, and only one half can be "migrated onto":

**Superseded — a JSON store holds the live data.** transfusion, e-prescription,
telehealth session, death certificate, lab trend, the wearable device/reading/
alert stores, sync, crossmatch.

**Never built — nothing anywhere.** `billing_codes`, `compliance_reports`,
`external_id_mappings`, `genetic_test_results`, `immunization_schedules`,
`lab_panels`, `organ_donation_records`, `remote_patient_monitoring`,
`telehealth_notes`, `vaccine_inventory`, `wearable_integration_logs`. No
handler, no JSON counterpart, no rows. These are schemas for features that were
never written.


---

## Built since this was opened

### `POST /api/lab/submit` — a lab technician can enter a result (2026-09-15)

Verified before building: all four lab screens (`LabResultPage`,
`LabResultsPage`, `LabQCPage`, `LabReviewPage`) only read, run QC, or approve
and reject. None submitted, and there was no alternative route. The
technician's own navigation carries a quick action labelled **"Enter Result"**
pointing at `/lab-results` — a review screen.

`LabResultsPage` now has a Review Queue / Enter Result switch. The form reads
its panels, units and reference ranges from `GET /api/clinical/lab-panels`,
**the server's catalogue, which also had no client caller** — so the units,
reference ranges and critical thresholds it defines had never reached a screen.
Rule 8: a page never decides a clinical threshold, it asks for one.

Two deliberate restraints:

* **A blank analyte is omitted, not submitted.** Every `results` row carries a
  `value`, so submitting empty rows would report values nobody measured. A
  submission with no measured parameter is refused outright.
* **No `flag`.** Whether a value is abnormal is a derived clinical judgement,
  and nothing on the server computes it today. The form submits the measurement
  and leaves the finding unclaimed rather than inventing one — see the debt
  note below.

Verified live before and after: catalogue returns 6 panels, submit returns 201,
and the result appears in both the doctor's pending queue and the patient's lab
record. Browser test: a technician signs in, enters a value, and the submission
is found in the queue by its notes — including after leaving and re-entering
the page — and a blank submission is refused.

**Recorded, not fixed:** `LabTestResult.flag` has no server-side deriver. The
catalogue carries `critical_low`/`critical_high` per analyte, so the server
*could* classify a value; until it does, every submission stores `flag: null`
and the review screen's Flag column is always empty.
