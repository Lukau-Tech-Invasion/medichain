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
| ~~`POST /api/clinical/gcs`~~ | `createGCS` | **BUILT 2026-09-15.** GCS is captured only as a *field* inside the Sepsis and Trauma scores (`glasgow_coma_scale`, `gcs_score`); nothing writes a standalone GCS assessment with its eye/verbal/motor components, though `/api/clinical/patient/{id}/gcs` exists to read them. |
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


### `POST /api/clinical/gcs` — a standalone GCS assessment (2026-09-15)

Verified before building: `createGCS`, `getGCS` and `getPatientGCS` all sat in
the shared client with **no caller at either end** — nothing wrote a Glasgow
Coma Scale assessment and nothing read one. GCS appeared in the UI only as a
free-typed `gcs_total` number on the vitals form, and as a field inside the
Sepsis and Trauma scores. A total with no eye, verbal or motor components behind
it cannot be checked, trended or defended.

`VitalSignsPage` now has a GCS card. Three things make it honest:

* **The scale is the server's.** `GET /api/clinical/scoring/catalog` now
  publishes `glasgow_coma_scale` alongside the Morse and burn tables, with each
  component's scores and the enum's own `description()`. The wording matters:
  "withdrawal from pain" (4) and "abnormal flexion to pain" (3) are adjacent
  scores meaning very different things, and a screen that paraphrases them
  records the wrong one.
* **The page adds nothing up.** Total, interpretation, `is_comatose` and
  `needs_airway` all come back from the server and are displayed as returned —
  rule 8. The browser test picks E3/V4/M5 and requires the screen to show
  **12** and "Moderate brain injury", neither of which it was told.
* **All three components or none.** A GCS missing a part is an incomplete
  assessment, not a lower score, and the total would silently be wrong.

`MyRecordsPage` now reads them too, so the assessment reaches the patient.

Verified live: the catalogue returns 4/5/6 options, E3+V4+M5 scores 12
"Moderate brain injury", an out-of-range eye score of 7 is refused with 400, and
the patient-scoped read returns the assessment.


### `POST /api/clinical/discharge-instructions` — the take-home document (2026-09-15)

Verified before building: `DischargePage` collected the diet, the activity
restrictions, the warning signs and the emergency instructions all along, and
posted them onto the discharge **summary** — the clinical record of the
admission. The separate discharge-instructions record, which is exactly what the
patient's own `GET /api/clinical/patient/{id}/discharges` returns under
`instructions`, was created by nothing in either client. A patient could open
their discharge and find the summary with no instructions attached: no diet, no
restrictions, nothing to come back for.

The page now files both, the instructions linked to the summary by
`discharge_summary_id` so the two cannot disagree about which admission they
describe. A failure of the second call says which half failed, because a
clinician told only "saved" will not go back for it.

**Fixed in passing:** a failed discharge save called `setSuccess()` with an
error message, so a discharge that was never filed appeared in the green banner.

### `POST /api/consent/{id}/revoke` — withdrawing consent (2026-09-15)

Verified before building: the consent screen could **sign** a consent and never
take it back. The page's existing "revoke" button revokes an *access grant*
(`/api/access/grants/{id}/revoke`) — one clinician's permission — which is a
different thing from the signed legal basis. Under POPIA withdrawal is a right
the data subject holds.

`revokeConsent` is new in the shared client and wired to a Withdraw control on
each standing consent. The reason is prompted for and optional: a patient does
not owe one.

`GET /api/consent/patient/{id}` filters withdrawn consents out server-side
(`.filter(|c| !c.revoked...)`), so a successful withdrawal **removes the row** —
the screen says so rather than appearing to lose it.

**Covered by the journey, not the browser suite.** The patient application's e2e
harness signs in by creating a fresh demo wallet, and the consent endpoints
answer 401 for it, so a browser test would assert nothing about authorisation.
The journey runs as the real fixture patient and asserts the withdrawn consent
is *absent* afterwards — the only way to tell a real withdrawal from a 200 that
changed nothing.


### `/api/auth/mfa/*` — two-factor that is actually enrolled (2026-09-15)

Verified before building: `mfaEnroll`, `mfaVerify`, `mfaStatus` and `mfaDisable`
all sat in the shared client with no caller. What Settings showed instead was a
**switch that wrote `twoFactorEnabled: true` into the user's settings blob** and
nothing else — no secret, no paired authenticator, the server's `user_mfa` state
untouched. The screen reported two-factor as on while `mfa_enabled()` returned
false for that wallet. A security control that claims to be enabled when it is
not is worse than one plainly absent.

**And it is a production blocker, not a nicety.**
`require_privileged_assurance` gates `POST /api/roles/assign`, role revocation
and all three guardianship endpoints. `privileged_assurance_decision` returns
`Ok(())` unconditionally in demo mode — which is why the admin journey passes —
but outside demo mode an unenrolled caller is refused with 403
`MFA_ENROLLMENT_REQUIRED`. With no way to enrol in either client, **user
management could not work in production at all**.

Settings now does real TOTP: status from the server, enrol (QR plus the secret
in text, so a desktop with no camera can still pair), confirm with a code from
the app, and turn off — which requires a current code, so a live session alone
cannot strip the second factor off an account. "Checking…" is a distinct state
from "Off": the screen does not claim either until the server has answered.

Verified live end to end, with a real RFC 6238 code computed from the issued
secret: off → enrol (32-character secret + QR) → wrong code refused with 401 →
real code accepted → on → disable → off. The browser test does the same through
the UI, including the refusal.

**Still open, recorded:** the step-up half. When a privileged operation returns
403 `MFA_REQUIRED`, nothing in the clients calls `/api/auth/mfa/challenge` to
re-elevate the session. Enrolment is the precondition and is done; the retry
path is not, and it cannot be exercised locally because demo mode never asks for
it.


### Guardianship — who may act for a patient (2026-09-15)

Verified before building: three endpoints existed — `POST /api/guardians/verify`,
`PUT /api/guardians/{id}/permissions`, `POST /api/guardians/revoke` — and **all
three write**. Nothing could read. There was no page, no shared client function,
and not one reference to guardianship anywhere in either client.

`GuardianRelationshipRepository::get_by_ward` is documented in the trait as
backing exactly this view — *"who may act for this patient (emergency contact
surfacing, admin review)"* — and `get_by_guardian` as driving the *"my children
/ profile-switcher list"*. Both had HTTP routes missing, so delegated authority
over a minor's records could be created and then shown to nobody.

Added `GET /api/guardians/ward/{ward_patient_id}` and
`GET /api/guardians/mine` (caller-scoped, so it takes no id and cannot be
pointed at somebody else's family), plus the five shared client functions and a
management panel on the patient's Access tab.

Two things the UI gets right because the domain demanded it:

* **Ended relationships stay listed and say so.** A revoked or expired
  guardianship is part of the answer to "who may act for this patient";
  dropping it would hide that somebody once could. Verified: after revoke the
  row is still returned with `active: false`.
* **Consent to treatment and consent to data processing are offered
  separately.** South African law treats them as distinct decisions
  (Children's Act §129 vs POPIA §35), the server keeps them apart, and the old
  combined `GiveConsent` permission is marked deprecated for that reason. The
  form does not collapse them.

Authority with no permissions is refused before sending: an empty permission set
would record a relationship that permits nothing while reading as though it
grants something.

Verified live: ward read 0 → verify 201 → ward read 1 containing the guardian →
revoke 200 → still listed, `active: false`. The browser test does the same
through the Access tab, including the refusal.

**Still open, recorded:** the patient-side "my children" view. `/api/guardians/mine`
exists and is tested, but `FamilyGroupPage` does not yet call it.
