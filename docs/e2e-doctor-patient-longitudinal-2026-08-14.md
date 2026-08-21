# Doctor–Patient longitudinal browser E2E ledger

Date: 2026-08-14 (Africa/Johannesburg)  
Environment: running Docker application at `http://127.0.0.1`  
Doctor: `e2e.browser.1786712424145` / Dr Synthetic Browser  
Patient: Anele Longitudinal Test (`PAT-03808cb0`)  
Wallet: `5HNLbzkA3mMxiEShaS9mzaZt9r75mbXhpkZH56VMFS72XLAA`

This is browser evidence from the rendered application. API/database checks are supplementary only; they do not turn a UI failure into a pass.

## Record ledger

| Feature | Doctor-side result | Patient-side result | Status |
|---|---|---|---|
| Patient registration | Created and displayed in patient search/detail | Patient login resolves to Anele | PASS |
| Patient demographics | Doctor overview shows DOB, A+, Latex, Asthma, emergency contact | Patient dashboard/profile has blank or incomplete medical fields; dashboard shows Unknown blood type and zero allergies | FAIL cross-role |
| SOAP note | `Note Created` shown after submission | Patient Records shows `0 records found` | FAIL cross-role |
| Prescription | Salbutamol submitted; success toast and PDF action shown | Patient Medications says `No active medications`; Doctor overview says no current medications | FAIL persistence/cross-role |
| Imaging order | Chest X-Ray order success card shown | Order disappears after Doctor refresh; Patient Records empty | FAIL persistence/cross-role |
| Laboratory order | CBC order card survives refresh | No Patient lab result/history visible | FAIL cross-role |
| Triage | Triage ID `TRIAGE-67ccaaf5` and ESI success shown | No Patient history entry | FAIL cross-role |
| Family history | `FM-001` created for Anele | Patient Medical History shows no family history | FAIL cross-role |
| Toxicology | Synthetic case saved successfully | No Patient destination exposed | BLOCKED cross-role |
| Pulmonology consult | `CONS-001` created as REQUESTED/ROUTINE for Anele; Doctor page confirms success | No Patient Portal destination found in tested routes | BLOCKED cross-role |
| Psychiatric assessment | Patient/value entry accepted, but no success confirmation; History remains “No assessments yet” | Not available | FAIL Doctor persistence |
| Nursing care plan | Anele can be selected; plan opens with zero diagnoses/goals/interventions; Save Care Plan remains disabled until a diagnosis is added | Patient destination not exposed in tested portal | BLOCKED pending required content |
| Immunization | Submission rejected with HTTP 400: frontend sent `intramuscular`, API expects `Intramuscular` | No record | FAIL |
| Critical value | Potassium 7.2 correctly triggers PANIC threshold warning, but final creation ends with “An error occurred while creating the critical value notification” | No record | FAIL persistence |
| Vitals | Patient selector contains only “Select a patient”; cannot record Anele | No vitals | BLOCKED |
| Progress note | Patient selector cannot select Anele | No record | BLOCKED |
| History & Physical | No patient selector/attribution | No record | BLOCKED |
| Appointment booking | Appointment persisted; Doctor schedule shows one upcoming | Patient shows one upcoming visit | PASS with display defect |
| Appointment lifecycle | Doctor transitions Scheduled → Confirmed → Checked in → In progress → Completed; Doctor moves it from Upcoming (1) to Previous (3) | Patient displays `Completed` under Upcoming (1); clicking Past (0) shows “No past appointments” | FAIL Patient categorization |
| Telehealth scheduling | Anele ID, Follow-up, date, and time submitted; form cleared but no success toast/session appeared and Sessions remains empty | Patient Telehealth Visits shows Upcoming (0), Past (0), No upcoming telehealth sessions | FAIL cross-role |
| Appointment display | Doctor schedule count correct | Patient shows raw Unix timestamp `1787655600` and blank reason | FAIL presentation |
| Doctor → Patient message | `Message sent!` shown | One unread message appears in Patient Messages | PASS one-way |
| Patient → Doctor reply | Patient view has no reply composer; Doctor Inbox remains empty | Reply cannot be completed | FAIL two-way |
| Patient new conversation | Patient “Start New Conversation” button produces no form or state change | No patient-originated message can be sent | FAIL |
| Patient consent | Consent Forms lists available forms, but clicking Sign produces no signed form, count change, or confirmation | No active/pending/history consent | FAIL |
| Patient records | — | `0 records found` | FAIL |
| Patient medical history | — | No immunizations/family history | FAIL |
| Patient profile/medical ID | Doctor overview has correct values | Patient profile/dashboard fields blank or incorrect | FAIL |
| Medical ID | Patient Medical ID renders Anele, DOB, A+, organ donor, and emergency contact | Allergy shows “No known allergies”, conditions/medications “None listed” despite Doctor registration; Full ID/Emergency/Lock Screen controls show no observable change | FAIL data/control behavior |
| Emergency Card | — | `/patient/emergency-card` renders a blank main area | FAIL |
| Patient logout/re-entry | Disconnect Wallet returns to `/patient/login` | Login screen renders correctly | PASS |
| Doctor logout/protection | Clicking Doctor Logout navigates to dashboard, but session remains authenticated and direct `/doctor/appointments` remains accessible | Protected-route enforcement not proven; observed behavior is a security/session FAIL | FAIL |
| Doctor access audit | Access Logs page renders but reports Total Accesses 0, Unique Patients 0, and No access logs found after the Anele workflow | Audit trail cannot be verified | FAIL |
| NFC sign-in | Button is present, but clicking it produces no prompt, scan state, or navigation | Cannot authenticate through NFC | FAIL |
| QR sign-in | Button is present, but clicking it produces no scanner, prompt, or navigation | Cannot authenticate through QR | FAIL |
| Patient symptom tracker | Patient successfully saves a Wheezing entry (severity 2, 10 minutes, synthetic note) and sees it in Recent Entries | Doctor patient overview contains no symptom entry or symptom history | FAIL reverse cross-role |
| Patient family group | Patient form accepts `Longitudinal Synthetic Family`, but submission ends with “Failed to create group” | No group created or Doctor visibility | FAIL |

## Additional browser findings

- Doctor authenticated successfully, but browser traffic also showed repeated `/api/auth/jwt` 401 `SIGNATURE_VERIFICATION_FAILED` responses and `/api/events` network failures.
- The Doctor patient list contains duplicate synthetic Naledi records from an earlier run, demonstrating missing duplicate-identity protection.
- Family History has a form-order trap: selecting a patient before opening the add form resets the patient selection.
- The visible Patient Portal has no usable reply control for an incoming conversation.
- Several specialty modules render populated forms but do not expose a clear Patient Portal destination; these are tracked as blocked rather than inferred to pass.

## Patient feature sweep

The remaining Patient routes rendered, but populated Doctor-side clinical data did not appear in the relevant destinations: Vitals and Lab Results are empty, Lab Trends show zero values, Telehealth shows zero sessions, Notifications show zero alerts, and Wearables show zero connected devices. Symptoms, reminders, family groups, insurance, language, offline sync, survey, and symptom-checker surfaces are present but contain no longitudinal data for this patient.

## Current acceptance conclusion

The Doctor–Patient longitudinal workflow is not complete. Appointment creation and one-way messaging pass. Most clinical documents either do not persist, are not exposed to the Patient Portal, or cannot be created for a selected patient. No application code was changed during this test phase.

## Coverage boundary

The current Doctor router contains 80 route entries and the Patient router contains 28. The ledger covers the shared patient lifecycle and all Patient routes, plus the Doctor clinical/document routes that expose patient selection or were identified as cross-role destinations. The remaining Doctor-only emergency, nursing, surgical, administrative, and specialty route entries were rendered/inspected where relevant but were not all submitted as clinical records for Anele; they are not silently counted as passes.

## Source-level correlation (diagnostic, not a browser pass)

- Patient `MedicalHistoryPage` fetches `/api/clinical/immunizations` and `/api/records/{patientId}`.
- Doctor SOAP creation persists into `soap_note_records`, while e-prescribing persists into `e_prescriptions_v2`; these are specialized repositories, not the generic `medical_records` repository used by `/api/records/{patientId}`.
- The same split exists across multiple clinical domains. This explains why Doctor forms can report success while Patient “My Records” remains empty, but it does not explain every missing surface and must not be treated as a fix.
- The API contains patient-ID/wallet-ID resolution logic in some areas, while other access checks compare the authenticated user ID directly with the record patient ID. This is a second namespace mismatch risk consistent with the observed cross-role failures.
