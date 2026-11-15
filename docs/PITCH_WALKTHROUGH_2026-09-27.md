# Naledi pitch walkthrough — 27 September 2026

Patient: Naledi Mokoena (Demo), PAT-DEMO-090. All records are fictional.

## Recommended live sequence
1. Doctor portal: select Naledi; show the original respiratory SOAP consultation.
2. Patient Records: open Full Blood Count (three numeric results, Doctor Approved).
3. Open Imaging report: no focal consolidation.
4. Patient Medications: Paracetamol, Dr Sipho as prescriber. The pharmacy workflow reached Dispensed (12 tablets).
5. Appointments: confirmed 2 October 2026, 09:30 follow-up.
6. Records: nursing plan, progress note, history and physical, reviewed consult, approved discharge summary and instructions, transport handover.
7. Consent/access management: five named care-team grants, expiring 28 September 2026 at 20:00 UTC. Access history contains actual audited reads.
8. Medical ID: existing active Smart ID card. Vaccination history: influenza, 15 April 2026.

## Staff identifiers
- Doctor: pitch.doctor.20260926 — Dr Sipho Maseko
- Nurse: pitch.nurse.20260926 — Thandi Dlamini
- Lab: pitch.lab.20260926 — Bongani Ndlovu
- Pharmacy: pitch.pharmacy.20260926 — Zanele Jacobs
- Reviewing doctor: pitch.reviewer.20260926 — Dr Lerato Molefe
- Paramedic: pitch.paramedic.20260926 — Sibusiso Khumalo

Use the existing demo password. Recovery secrets stay in ignored pitch-fixtures.json.

## Evidence and limits
- Authenticated product APIs saved the records. Patient-scoped readbacks are in ignored pitch-workflow-verification.json.
- Chrome confirmed the lab values, medication and confirmed appointment. Records list showed 14 cards; these include an underlying lab document and its detailed lab-result card, not 14 independent encounters.
- Five care-team members successfully opened Naledi with an access reason. Paramedic routine standing access is refused by role policy; its supported transport handover is saved and patient-readable. Emergency break-glass was not bypassed or demonstrated in this run.
- Historical vaccine date was silently replaced by today's date by the API. Corrected only synthetic row IMM-9059f0ecccafdb7f69a2374f in PostgreSQL to 2026-04-15; API bug remains for later repair.
- Fixed discharge list diagnosis/provider/date formatting in MyRecordsPage.tsx. Patient production build and six existing MyRecordsPage tests passed. Built assets copied into running nginx container; source retained for next image rebuild.
- Vaccinations have their own history screen; My Records vaccination filter is not wired to that collection.
- Unrelated critical procedures, transfusions, death certificates, AMA discharge and incident reports were not invented for a stable respiratory follow-up patient. Histopathology was not appropriate to this episode.
- Download/view behavior for every document is not fully verified. Use the detailed Full Blood Count card for the lab demonstration.

## Separate Chrome sessions
Use output/demo-sessions.html. Patient stays on 127.0.0.2; paramedic stays on 127.0.0.1. Doctor: 127.0.0.3; nurse: .4; laboratory: .5; pharmacy: .6; reviewing doctor: .7. All staff routes use /doctor/dashboard. The existing Chrome role tabs have been moved and signed in. Reload verified for all six staff roles. These origins isolate both localStorage and the HttpOnly refresh cookie. Multiple accounts on exactly the same origin remain unsupported; this is a local demo workaround. Browser process restart was not tested. No authentication protection was removed.
