# Browser test coverage

Maps every route in each portal's router, and every cross-role workflow, to the Playwright spec(s) that cover it. Written 2026-09-30 during the identity removal of ADR-0010 (Phases B/C); the new specs are written and type-checked but **not yet run** (Phase D runs them, alone, against the rebuilt stack).

Sources: `client/doctor-portal/src/App.tsx` and `config/navigation.ts`; `client/patient-app/src/App.tsx`; the spec files in each `e2e/` directory. Specs are named without `.spec.ts`, except `identity-removal`, which stands for the identity-removal spec (its file keeps its original name from before ADR-0010).

## What "Render sweep" means

The four sweeps open every link in each role's own sidebar, so a screen added to the navigation is covered without editing them:

| Sweep | Proves |
| --- | --- |
| `colour-sweep` | text is readable in both themes |
| `roles` | contrast and target size again, and that a role cannot open another role's route |
| `route-api-refusals` | no 401/403/404/405/5xx from the API on any screen a role is offered |
| `no-retired-terms` (new) | no retired identity or ledger words on screen and no retired fields in any JSON answer |

"Render sweep" = covered by those only: the screen opens, is readable and is answered, but nothing on it is operated. "Workflow" = a spec operates it. "GAP" = neither.

The sweeps cover the five seeded roles (Doctor, Nurse, Pharmacist, LabTechnician, Admin). `Paramedic` has a navigation config and no fixture, so it is never signed in.

## Doctor portal: 90 routes

Workflow 36, Render sweep only 52, GAP 2. "Reached by" is the role navigation that links the route.

| Route | Reached by | Swept for | Workflow spec(s) | Status |
| --- | --- | --- | --- | --- |
| `/login` | - | - | staff-login, identity-removal, login, no-retired-terms | Workflow |
| `/activate` | - | - | admin-accounts, identity-removal, no-retired-terms | Workflow |
| `/dashboard` | Admin, Doctor, Nurse, LabTechnician, Pharmacist | Admin, Doctor, Nurse, LabTechnician, Pharmacist | journeys (all five roles), staff-login, seal-ui | Workflow |
| `/settings` | Admin, Doctor, Nurse, LabTechnician, Pharmacist, Paramedic | Admin, Doctor, Nurse, LabTechnician, Pharmacist | mfa, change-password | Workflow |
| `/notifications` | (all, via bell) | - | - | GAP |
| `/dashboard/doctor` | (own role only) | Admin, Doctor, Nurse, LabTechnician, Pharmacist | journeys (via /dashboard) | Workflow |
| `/dashboard/nurse` | (own role only) | Admin, Doctor, Nurse, LabTechnician, Pharmacist | journeys (via /dashboard) | Workflow |
| `/dashboard/lab` | (own role only) | Admin, Doctor, Nurse, LabTechnician, Pharmacist | journeys (via /dashboard), lab-entry | Workflow |
| `/dashboard/pharmacist` | (own role only) | Admin, Doctor, Nurse, LabTechnician, Pharmacist | journeys (via /dashboard), prescribe-dispense | Workflow |
| `/dashboard/admin` | (own role only) | Admin, Doctor, Nurse, LabTechnician, Pharmacist | journeys (via /dashboard) | Workflow |
| `/patients` | Admin, Doctor, Nurse, LabTechnician, Pharmacist | Admin, Doctor, Nurse, LabTechnician, Pharmacist | workflows (register then find), accessibility | Workflow |
| `/patients/:patientId` | - | Doctor, Nurse | emergency-capsule, guardianship, seal-ui (chart open), colour-sweep (Doctor, Nurse) | Workflow |
| `/register` | Doctor, Nurse | Doctor, Nurse | workflows, journeys, patient-activation | Workflow |
| `/access-logs` | Admin, Doctor | Admin, Doctor | seal-ui | Workflow |
| `/devices` | Admin | Admin | devices, emergency-read | Workflow |
| `/retention` | Admin | Admin | retention | Workflow |
| `/security-incidents` | Admin | Admin | - | Render sweep |
| `/national-id-reviews` | Admin | Admin | - | Render sweep |
| `/lab-review` | Doctor | Doctor | workflows (lab result approval) | Workflow |
| `/triage` | Doctor, Nurse | Doctor, Nurse | workflows | Workflow |
| `/soap` | Doctor, Paramedic | Doctor | workflows | Workflow |
| `/vitals` | Doctor, Nurse, Paramedic | Doctor, Nurse | workflows, gcs | Workflow |
| `/progress-note` | Doctor, Nurse | Doctor, Nurse | - | Render sweep |
| `/history-physical` | Doctor | Doctor | - | Render sweep |
| `/discharge` | Doctor | Doctor | discharge-instructions | Workflow |
| `/consult` | Doctor | Doctor | - | Render sweep |
| `/ama` | Doctor | Doctor | - | Render sweep |
| `/emergency` | Admin, Doctor, Nurse, Paramedic | Admin, Doctor, Nurse | devices, emergency-read | Workflow |
| `/emergency-protocols` | Doctor, Nurse | Doctor, Nurse | - | Render sweep |
| `/code-blue` | Doctor, Nurse | Doctor, Nurse | - | Render sweep |
| `/trauma` | Doctor | Doctor | - | Render sweep |
| `/ems-handoff` | Doctor, Nurse, Paramedic | Doctor, Nurse | workflows | Workflow |
| `/stroke` | Doctor | Doctor | - | Render sweep |
| `/cardiac` | Doctor | Doctor | - | Render sweep |
| `/sepsis` | Doctor | Doctor | workflows (SI units) | Workflow |
| `/mci` | Admin, Paramedic | Admin | - | Render sweep |
| `/nursing` | Nurse | Nurse | - | Render sweep |
| `/nursing-care-plan` | Nurse | Nurse | - | Render sweep |
| `/mar` | Nurse, Paramedic | Nurse | journeys | Workflow |
| `/care-plan` | Nurse | Nurse | - | Render sweep |
| `/intake-output` | Nurse | Nurse | - | Render sweep |
| `/wound-care` | Nurse | Nurse | - | Render sweep |
| `/iv-site` | Nurse | Nurse | - | Render sweep |
| `/shift-handoff` | Nurse | Nurse | - | Render sweep |
| `/fall-risk` | Nurse | Nurse | - | Render sweep |
| `/incident-report` | Nurse | Nurse | - | Render sweep |
| `/orders` | Doctor, Pharmacist, Paramedic | Doctor, Pharmacist | journeys | Workflow |
| `/e-prescribe` | Doctor, Pharmacist, Paramedic | Doctor, Pharmacist | workflows, prescribe-dispense | Workflow |
| `/medication-admin` | Pharmacist, Paramedic | Pharmacist | - | Render sweep |
| `/drug-interactions` | Doctor, Pharmacist | Doctor, Pharmacist | - | Render sweep |
| `/burn` | Doctor | Doctor | - | Render sweep |
| `/psych` | Doctor | Doctor | - | Render sweep |
| `/toxicology` | Doctor | Doctor | workflows (SI units) | Workflow |
| `/pediatrics` | Doctor | Doctor | pediatrics-unknown (2026-10-13: required fields named; unobserved findings stored as NULL, checked in PostgreSQL) | Workflow |
| `/obstetrics` | Doctor | Doctor | - | Render sweep |
| `/intubation` | Doctor | Doctor | procedure-readback | Workflow |
| `/laceration-repair` | Doctor | Doctor | laceration | Workflow |
| `/splint` | Doctor | Doctor | procedure-readback | Workflow |
| `/pre-op` | Doctor | Doctor | - | Render sweep |
| `/operative-note` | Doctor | Doctor | - | Render sweep |
| `/post-op` | Doctor | Doctor | - | Render sweep |
| `/anesthesia` | Doctor | Doctor | procedure-readback | Workflow |
| `/lab-results` | Doctor, LabTechnician, Paramedic | Doctor, LabTechnician | lab-entry, workflows | Workflow |
| `/lab-result/:resultId` | (link from lab results) | - | - | GAP |
| `/specimen` | LabTechnician | LabTechnician | - | Render sweep |
| `/chain-of-custody` | LabTechnician | LabTechnician | - | Render sweep |
| `/lab-qc` | LabTechnician | LabTechnician | - | Render sweep |
| `/critical-value` | Doctor, LabTechnician, Paramedic | Doctor, LabTechnician | - | Render sweep |
| `/blood-bank` | LabTechnician | LabTechnician | - | Render sweep |
| `/imaging` | Doctor | Doctor | - | Render sweep |
| `/radiology` | Doctor | Doctor | - | Render sweep |
| `/pathology` | Doctor, LabTechnician | Doctor, LabTechnician | - | Render sweep |
| `/immunization` | Nurse | Nurse | - | Render sweep |
| `/family-history` | Doctor | Doctor | - | Render sweep |
| `/death-certificate` | Admin, Doctor | Admin, Doctor | - | Render sweep |
| `/health-id-cards` | Admin, Doctor, Nurse | Admin, Doctor, Nurse | journeys | Workflow |
| `/autopsy` | Admin, Doctor | Admin, Doctor | - | Render sweep |
| `/admin` | Admin | Admin | journeys, seal-ui | Workflow |
| `/user-management` | Admin, Paramedic | Admin | admin-accounts, step-up | Workflow |
| `/claims-eob` | Admin | Admin | - | Render sweep |
| `/research-exports` | Admin | Admin | - | Render sweep |
| `/order-sets` | Admin, Doctor, Pharmacist | Admin, Doctor, Pharmacist | - | Render sweep |
| `/note-templates` | Admin, Doctor, Nurse | Admin, Doctor, Nurse | - | Render sweep |
| `/barcode` | Admin | Admin | - | Render sweep |
| `/analytics` | Admin, Paramedic | Admin | - | Render sweep |
| `/cds-alerts` | Admin | Admin | - | Render sweep |
| `/appointments` | Doctor | Doctor | - | Render sweep |
| `/working-hours` | Doctor | Doctor | - | Render sweep |
| `/telehealth` | Doctor | Doctor | workflows, journeys | Workflow |
| `/messages` | Doctor, Nurse, LabTechnician, Pharmacist | Doctor, Nurse, LabTechnician, Pharmacist | - | Render sweep |

### Doctor-portal gaps and thin spots

- `/notifications` is reached from the bell, not the sidebar, so no nav-driven sweep opens it.
- `/lab-result/:resultId` is reached from a link inside lab results; nothing opens it.
- `/dashboard/doctor|nurse|lab|pharmacist|admin` are covered only through `/dashboard` (`SmartDashboardRouter` renders the same components); the direct paths are not visited.
- Clinically important screens that are render-swept only: `/specimen`, `/lab-qc`, `/critical-value` (acknowledgement), `/chain-of-custody`, `/blood-bank`, `/medication-admin`, `/drug-interactions`, `/appointments`, `/imaging`, `/radiology`, `/pathology`, `/code-blue`, `/stroke`, `/cardiac`, `/trauma`, `/security-incidents` (its step-up dialog is not driven), `/national-id-reviews`, `/claims-eob`, `/research-exports` (two-administrator approval), `/order-sets`, `/note-templates`. The seeder creates a lab rejection/recollection journey, but no UI spec drives it.
- Class C (exact-transaction) authorisation has no caller in either portal, so it is covered over the API only (`step-up`).

## Patient app: 28 routes

| Route | Spec(s) | Status |
| --- | --- | --- |
| `/login` | patient-login, identity-removal, activation, colour-sweep | Workflow |
| `/activate` | activation, identity-removal | Workflow |
| `/dashboard` | sign-in landing for every spec; accessibility, contrast, colour-sweep | Workflow |
| `/profile` | colour-sweep, no-retired-terms | Render sweep |
| `/records` | workflows (doctor-written SOAP note and EMS handover read by the patient), patient-login (protected redirect), accessibility, contrast | Workflow |
| `/consent` | consent-withdraw, access-grants | Workflow |
| `/access-history` | seal-ui, no-retired-terms | Workflow |
| `/emergency-card` | seal-ui (verify control gap noted), emergency-read (API read of the access list), contrast | Workflow |
| `/medications` | workflows (doctor prescribes, patient sees), prescribe-dispense (API read of dispensed state) | Workflow |
| `/appointments` | accessibility, contrast, colour-sweep | Render sweep |
| `/messages` | messaging-roundtrip | Workflow |
| `/symptoms` | colour-sweep, no-retired-terms | Render sweep |
| `/medical-id` | contrast, accessibility, colour-sweep | Render sweep |
| `/settings` | accessibility, colour-sweep, patient-login (two-factor is API-only) | Render sweep |
| `/reminders` | colour-sweep, no-retired-terms | Render sweep |
| `/family` | colour-sweep, no-retired-terms | Render sweep |
| `/telehealth` | colour-sweep, no-retired-terms | Render sweep |
| `/wearables` | colour-sweep, no-retired-terms | Render sweep |
| `/lab-trends` | workflows (lab result reaches trends) | Workflow |
| `/insurance` | colour-sweep, no-retired-terms | Render sweep |
| `/survey` | colour-sweep, no-retired-terms | Render sweep |
| `/symptom-checker` | colour-sweep, no-retired-terms | Render sweep |
| `/language` | colour-sweep, no-retired-terms | Render sweep |
| `/offline-sync` | colour-sweep, no-retired-terms | Render sweep |
| `/vitals` | workflows (nurse records, patient sees) | Workflow |
| `/lab-results` | workflows (approved result reaches the patient) | Workflow |
| `/notifications` | colour-sweep, no-retired-terms | Render sweep |
| `/medical-history` | colour-sweep, no-retired-terms | Render sweep |

`colour-sweep` lists 25 routes and omits `/access-history`; `no-retired-terms` (new) lists all 26 signed-in routes.

### Patient-app gaps

- No patient "change password" screen exists (the Settings row is informational), so a patient's password change is proved over the API only (`patient-login`). An expired activation code cannot be produced in a browser (72 h server clock); it is proved in the API's own tests, and the message is the same one asserted for a spent code.
- `CapsuleVerify` (the "Verify" control that would show match/unsealed and the signature line) is not mounted by any page. `seal-ui` asserts the API contract and records the missing control as an annotation.
- Patient two-factor enrolment is not driven through the Settings UI (the doctor portal's is: `mfa`).
- Appointments, telehealth join, symptom tracker, wearables, insurance, family group, refill requests: render sweep only.

## Cross-role workflows

| Workflow | Spec(s) | Status |
| --- | --- | --- |
| Staff sign-in: Employee ID + password, TOTP when enrolled, generic error, lockout, logout then reload | `staff-login` (new) | Covered |
| Admin creates staff, code shown once, person activates and signs in | `admin-accounts` (new) | Covered |
| Admin credential reset ends sessions; old password stops; new code works | `admin-accounts` (new) | Covered |
| Admin resets a lost authenticator | `admin-accounts` (new) | Covered |
| Admin suspends a person | `admin-accounts` (new) | Covered |
| Step-up Class B (held action, wrong then right code) | `step-up` (new) | Covered where the API enforces it; under a demo-mode API it records the exempt path (`E2E_STEP_UP_ENFORCED=1` requires the dialog) |
| Step-up Class C (password or TOTP factor, single use) | `step-up` (new), API level | Covered over the API; **no UI path exists** |
| Change password (doctor Settings) | `change-password` (new) | Covered |
| Two-factor enrolment and disable (Settings) | `mfa` | Covered |
| Doctor registers patient, code shown once, patient activates | `patient-activation` (new), `activation` (new), `workflows` | Covered |
| Wrong activation codes kill the grant; re-issue | `patient-activation` (new), API level | Covered; re-issue has no UI |
| Patient sign-in, lockout, TOTP, reload, sign-out | `patient-login` (new) | Covered |
| Retired identity paths gone (UI, localStorage, `X-User-Id`, removed endpoints) | `identity-removal` in both portals (new) | Covered |
| No retired identity or ledger wording or fields anywhere | `no-retired-terms` in both portals (new) | Covered |
| Seal badges on access logs; audit-seal panel; patient access history | `seal-ui` in both portals (new) | Covered; capsule verification UI is a gap |
| Emergency read with checkpoint sink `none`; patient sees it; admin ends the grant | `emergency-read` (new), `devices`, `emergency-capsule` | Covered |
| Prescribe, pharmacy receives, partial and full dispense, patient reads | `prescribe-dispense` (new), `workflows` | Covered |
| Second-pharmacist verification (requester cannot approve) | `dual-pharmacist` (new) | Covered |
| Lab result entered, approved, reaches patient and trends | `lab-entry`, `workflows` | Covered |
| Patient access requests: approve, deny, withdraw, effect on the clinician | `access-grants` (new) | Covered |
| Signed consent and withdrawal | `consent-withdraw` | Covered |
| SOAP note, vitals, EMS handover visible to the patient | `workflows` | Covered |
| Doctor and patient messaging | `messaging-roundtrip` | Covered |
| Guardianship | `guardianship` | Covered |
| Data retention, legal hold | `retention` | Covered |
| Device enrolment and revocation | `devices` | Covered |
| Appointment booking (doctor to patient) | none | GAP |
| Telehealth: patient joins | none | GAP |
| Refill request (patient) to pharmacist or doctor decision | none | GAP |
| Specimen rejection and recollection | none | GAP |
| Critical-value notification and acknowledgement | none | GAP |
| Research export, two-administrator approval | none (needs a second administrator) | GAP |

## Running the new specs

Run each portal alone (60 requests a minute per IP), with the `local-api` config, after seeding fixtures:

```
cd client/doctor-portal && npx playwright test --config playwright.local-api.config.ts
cd client/patient-app   && npx playwright test --config playwright.local-api.config.ts
```

Notes for the runner:

- `AdminApi` (in `client/doctor-portal/e2e/identity.ts`) enrols the fixture administrator in TOTP only if the API demands it, and releases it in `afterAll`. If a run is killed mid-way, turn the administrator's authenticator off in Settings before anything else signs in as Admin.
- `IS_DEMO=true` exempts Class B, so the step-up dialog cannot appear there.
- `patient-activation` (last test) drives the patient app at `PATIENT_APP_URL` (default `http://127.0.0.1/patient`, as `workflows` does) and skips itself if unreachable.
- Account-creating patient specs run on the `desktop` project only; the form and identity-removal checks run on both.
