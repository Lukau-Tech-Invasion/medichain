# 01 MediChain Product Submission

Prepared 7 October 2026. Research and positioning workshop. Not a final submission.

## Care that carries forward.
MediChain connects the patient experience with the daily work of the care team.

### Best Health Solution | FNB App of the Year 2026
Product submission draft | 7 October 2026

### The product promise
A patient should not have to restart their medical story at every handover. MediChain brings patient records, consent, clinical work, diagnostics, medicines and emergency information into connected patient and staff experiences.

### One record. Several roles. A visible trail.
The application includes distinct experiences for patients, doctors, nurses, laboratory staff, pharmacists, responders and administrators. Its strongest story is the movement of useful information between those roles.

### What this working draft explores
An implemented application and selected synthetic workflows, supported by source and dated local verification. This is a positioning workshop document, not the final submission. The hosted build and final proof assets will shape the next revision.

### The opportunity
Turn fragmented care tasks into a coherent journey that patients can understand and care teams can continue. The following pages show the product value at each step.

## From one encounter to the next
Six connected moments make the application memorable.

### 1 | Identify and understand
Find the patient and inspect the record, history and observations. The next professional starts with context rather than an empty form.

### 2 | Assess and document
Capture triage, clinical notes and nursing assessments in structured workflows. Preserve the encounter story for colleagues.

### 3 | Diagnose and treat
Bring reviewed lab evidence into the chart; connect prescribing and dispensing to the treatment journey.

### 4 | Continue the shift
Use care plans, fluid balance, wounds and SBAR handover to communicate what happened and what needs attention.

### 5 | Give the patient a role
Patients can view records, manage access, see recorded disclosures, message the care team and organise appointments and medicines.

### 6 | Carry context into emergencies
Medical identity and scoped emergency access can surface essential information for responders, with a recorded disclosure visible to the patient.

## A patient experience with agency
The patient portal makes information and access visible.

### Understand the record
Records, medical history, observations and laboratory views give the patient a place to inspect their own care context. The value is continuity between encounters.

### Decide who can access
Consent controls provide a direct way to manage permission. Access history makes recorded use and emergency disclosure inspectable. This is a tangible product benefit that judges can explore.

### Prepare and follow through
Appointments, messages, medication views, reminders and symptom tracking provide practical follow-up tools. Their intended benefit is better preparation and less fragmented communication; outcome improvements remain to be measured.

### Keep essential information available
Medical ID and emergency-card workflows organise essential context. A QR download and an explicitly labelled preview are present; the app does not automatically set a phone lock screen.

### Include the wider household
Family, immunisation and preventive-care capabilities offer longer-term context. Family authorisation needs dedicated qualification before live use.

### Proof anchor
The 27 September local synthetic run recorded patient/doctor observations read-back, access-history visibility, two-way messages and an authenticated QR download. These are dated demonstration results, not adoption metrics. [E1]

## A workspace for the care team
A shared patient context supports different professional tasks.

### Clinicians
Patient search, chart documents, triage, SOAP/progress notes, history and physical, consultations, discharge, orders and care plans organise the encounter from assessment to follow-up.

### Nurses
Nursing care plans, fluid balance, wound assessments, medication administration and SBAR handover support the details that carry a shift. A 4 October local run proved several durable writes and the incoming nurse handover, while exposing unresolved flowsheet, IV and Morse read-back checks. [E2]

### Laboratory and pharmacy
Specimen, results, review and critical-value entry points connect diagnostic work to the chart. Prescription processing and dispensing history give pharmacy its own task-focused path.

### Emergency responders
Emergency identity, authorised device selection and ambulance handover carry the same patient association into urgent care. Browser demonstration is evidence of a workflow, not certification of physical NFC deployment.

### Specialists and operators
Imaging, pathology, specialist emergencies, procedures and perioperative documentation broaden the product. Administration, identity review, incidents and retention offer governance controls. The evidence appendix lists the qualification task for every family.

## Trust is part of the experience
The value is visible control, supported by explicit boundaries.

### Patient-visible accountability
Recorded access reasons and emergency disclosures give the patient a way to understand how information was used. This can make trust discussable in the interface rather than buried in a policy.

### Restricted professional access
Credential sessions, roles, access grants and managed-device workflows provide controls around sensitive tasks. A source-level control is not a completed independent security assessment.

### Protected records and signed audit checkpoints
The backend includes encrypted document storage in PostgreSQL and a signed audit stream. External immutable checkpoint copies and deployment hardening still require hosting work. [E3]

### Explainable support
Scores, alerts and structured pathways should show their inputs and preserve missing observations as missing. We present these as decision-support capabilities; we do not claim autonomous diagnosis or predictive machine learning.

### Responsible demonstration
Judging uses synthetic people and records. Live patient operation requires separate clinical, privacy, security and operational readiness work. The product proposition is continuity with accountability, with progress supported by evidence.

## A focused commercial proposition
Research how the connected care journey can become a sustainable offering.

### Customer hypothesis
A clinic or care organisation coordinating patient follow-up, diagnostic results and staff handovers is a plausible buyer segment to investigate. This is positioning research, not a statement about existing customers.

### Why a facility might pay
The commercial proposition combines a patient portal and role-specific workflows, reducing the need to assemble disconnected tools for the same encounter. Time saved and avoided duplication are testable value hypotheses.

### Revenue hypothesis
Evaluate a facility subscription with transparent onboarding and support. Price by measured operating cost, procurement requirements and willingness to pay. Keep any proposed price separate from an agreed commercial offer.

### Affordable evaluation
The hosting plan keeps both frontends, API and database on one AWS server for the synthetic awards workload, with separate backups. Capacity and service eligibility must be measured and checked; credits are temporary. See the existing AWS research brief. [E4]

### Packaging question
Should the initial offering focus on records/access, diagnostics-to-treatment and nurse handover? A smaller, clearly qualified bundle may be easier to explain and operate than selling every specialist workflow at once.

### Research gate
Compare buyer needs, support requirements and operating cost before choosing the commercial package. Durable workflow proof and clinical review should guide the offering.

## Why MediChain deserves a closer look
Judge the connected experience, then examine the evidence.

### A coherent product
The differentiating proposition is the combination of patient agency, clinical work, supporting roles and emergency continuity around one patient context. Demonstrate the transitions rather than asking judges to count screens.

### Relevant to South African care
The product is designed around continuity, trust and practical access. Low-data performance, full language coverage, offline behaviour and rural field usability are validation priorities, not completed achievements.

### A credible comparison
Vula Medical reports winning both the overall and health awards in 2025 through its specialist-access/referral proposition. MediChain should show its broader patient-to-care-team continuity clearly, without claiming to outperform an established winner or to be first in the market. [S11]

### What to explore first
Patient record and access history; reviewed laboratory evidence in the chart; pharmacy history; nursing handover; scoped emergency context. The judge guide gives a short exploration route.

### Evidence and next step
Review the Capability Evidence appendix alongside this submission. Hosted access details and current demo evidence must be added before entry. The application is ready to tell a product story; the submitted build must substantiate it.

### References
E1: output/demo-workflow-verification-2026-09-27.md. E2: output/verification/nurse-20261004.txt. E3: CLAUDE.md; api/src/ipfs.rs; api/src/audit_batching.rs. E4: docs/AWS_HOSTING_AND_FNB_AWARDS_RESEARCH_2026-10-07.md. Source repository: github.com/mrlucas679/medichain. S11 is linked in the research brief.
