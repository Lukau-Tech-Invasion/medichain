"""Build editable, evidence-led MediChain awards PDFs without accessing patient data."""
from pathlib import Path
import json
import re
import csv
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/pdf'
SRC = Path(__file__).parent
OUT.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('Arial', 'C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('ArialBold', 'C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='ArialBold', italic='Arial', boldItalic='ArialBold')
NAVY = HexColor('#163443')
TEAL = HexColor('#006E73')
INK = HexColor('#243C47')
MUTED = HexColor('#526772')
PALE = HexColor('#EAF3F2')
CORAL = HexColor('#B94F38')
W, H = 595.28, 841.89
sources = {
 'S1': ('Official awards FAQ', 'https://appoftheyear.co.za/faqs/'),
 'S2': ('2026 entry page', 'https://appoftheyear.co.za/enter-now/'),
 'S3': ('Live 2026 Cognito form', 'https://www.cognitoforms.com/f/GiAnl_2m80ysXyBsOhwnMg/121'),
 'S4': ('Official categories', 'https://appoftheyear.co.za/app-categories/'),
 'S5': ('2026 terms, especially clauses 3, 5, 13, 27-30', 'https://appoftheyear.co.za/terms-conditions/'),
 'S6': ('Organiser LinkedIn updates: October 2026 dates', 'https://za.linkedin.com/company/app-of-the-year'),
 'S7': ('Current hackathon themes', 'https://appoftheyear.co.za/hackathon/'),
 'S8': ('Organiser contact', 'https://appoftheyear.co.za/contact-us/'),
 'S9': ('Current published judge roster; year not labelled', 'https://appoftheyear.co.za/judges/'),
 'S10': ('Official past winners archive', 'https://appoftheyear.co.za/past-winners/'),
 'S11': ('Vula: its 2025 overall and health wins, 8 December 2025', 'https://www.vulamedical.com/stories/vula-wins-fnb-app-of-the-year-2025'),
 'S12': ('Organiser-attributed 2025 release with judge comments', 'https://pressportal.co.za/it-new-media-and-software/story/3bkh6dkmwiage1if78q9-20251205.html'),
 'S13': ('FNB sponsor article: Code to Conquer, 2025', 'https://www.fnb.co.za/blog/businessTalk/articles/IndustryAndEconomy-20251126/'),
 'S14': ('2025 hackathon programme, historical only', 'https://appoftheyear.co.za/wp-content/uploads/2025/10/2025-Hackathon-programme.pdf'),
 'S15': ('Previous entrant public pack, example only', 'https://leonardphokane.github.io/zulutech-send-money/'),
 'S16': ('Academy privacy/terms, distinct programme', 'https://academy.appoftheyear.co.za/privacy-policy/'),
}

# Each family connects an application area to its user value and a proof task.
families = [
 ('Patient identity and records', 'Less repeated explanation at every encounter. Registration, profiles, history and chart documents organise the context the care team needs.', ['RegisterPatientPage','PatientDetailPage','PatientSearchPage','MyProfilePage','MyRecordsPage','MedicalHistoryPage'], 'Open the same synthetic patient in both portals; retrieve one stored document.', '27 Sep: approved document opened; all registration variations remain to qualify.'),
 ('Consent and accountability', 'Patients can manage access and inspect recorded disclosures. Trust becomes a visible part of the experience.', ['ConsentManagementPage','AccessHistoryPage','AccessLogsPage'], 'Grant access, read as clinician, revoke, then prove denial and patient-visible history.', '27 Sep: document reasons and emergency disclosure visible; universal audit coverage not certified.'),
 ('Emergency identity and handover', 'Responders can locate essential patient context and carry the patient identity into a structured ambulance handover.', ['EmergencyAccessPage','EmsHandoffPage','MedicalIDPage','MedicalIdPage','EmergencyCardPage','HealthIdCardsPage','BarcodePage'], 'Use a synthetic tag/QR, scoped responder device and recorded emergency reason.', '27 Sep: browser scanner and handover association verified; physical NFC and field use unverified.'),
 ('Clinical assessment and notes', 'Structured triage, observations and clinical notes make an encounter easier to follow across staff changes.', ['TriagePage','SOAPNotePage','VitalSignsPage','ProgressNotePage','HistoryAndPhysicalPage','ConsultPage','DischargePage','AMAPage','VitalsPage'], 'Save observations and a note, then reload the same patient from another role.', '27 Sep: observations read back in patient and doctor views; 4 Oct nursing flowsheet check failed.'),
 ('Nursing continuity', 'Care plans, fluid balance, wounds and SBAR handover preserve the shift story for incoming staff.', ['NursingPage','NurseDashboardPage','NursingCarePlanPage','IntakeOutputPage','WoundCarePage','IVSitePage','ShiftHandoffPage','FallRiskPage','IncidentReportPage'], 'Complete one shift and retrieve its SBAR from the incoming nurse account.', '4 Oct: care plan, wound and handoff read-back passed; IV/VIP and Morse read-back unresolved.'),
 ('Medicines and pharmacy', 'Prescribing, dispensing, administration and patient medication views connect treatment decisions to follow-through.', ['EPrescribePage','PharmacistDashboardPage','MedicationAdminPage','DrugInteractionsPage','MedicationsPage','MedicationRemindersPage'], 'Open a stored prescription, inspect dispensing history and patient medication context.', '27 Sep: prescription filters/history and 12-unit synthetic dispensing visible. Reconciliation is separate.'),
 ('Laboratory workflow', 'Specimen tracking, reviewed results and critical-value workflows keep diagnostic evidence tied to the patient.', ['LabTechDashboardPage','LabResultsPage','LabResultPage','SpecimenPage','ChainOfCustodyPage','LabQCPage','CriticalValuePage','BloodBankPage','LabReviewPage'], 'Open one approved result in lab, clinician and patient views.', '27 Sep: approved full blood count with three parameters opened; QC/blood bank full journeys unverified.'),
 ('Imaging and pathology', 'Diagnostic documents and specialist reports can sit alongside the patient record instead of separate conversations.', ['ImagingPage','RadiologyPage','PathologyPage'], 'Persist a report, reload it, and prove authorised document access.', 'Source-present; current hosted end-to-end workflow not certified.'),
 ('Appointments and communication', 'Scheduling and patient-clinician messaging help care continue between visits.', ['AppointmentSchedulerPage','ProviderSchedulePage','AppointmentsPage','MessagesPage','NotificationsPage'], 'Book an appointment, inspect the staff schedule, exchange a message and reload.', '27 Sep: two-way messaging verified; hosted scheduling and external notification delivery need qualification.'),
 ('Virtual consultations', 'A telehealth entry point offers a route to remote consultation when a configured provider is available.', ['TelehealthPage'], 'Join as both parties on separate devices, test audio/video and session access.', 'Jitsi integration source exists; no real call certification in reviewed evidence.'),
 ('Patient self-management', 'Symptoms, lab trends, reminders and medical history help patients prepare for and follow up care.', ['SymptomTrackerPage','SymptomCheckerPage','LabTrendsPage','SatisfactionSurveyPage','MedicalHistoryPage'], 'Record a symptom and retrieve it; inspect a dated trend and its missing-data state.', 'Source-present; no demonstrated outcome improvement or autonomous diagnosis claim.'),
 ('Family and prevention', 'Family relationships, immunisations, family history and care plans organise longer-term health context.', ['FamilyGroupPage','FamilyHistoryPage','ImmunizationPage','CarePlanPage'], 'Prove family permission boundaries and one stored preventive record.', 'Source-present; all family delegation and prevention journeys need current qualification.'),
 ('Acute and specialist workflows', 'Dedicated emergency, paediatric, maternity, mental-health and toxicology forms preserve condition-specific context.', ['CodeBluePage','TraumaPage','StrokePage','CardiacPage','SepsisPage','MCIPage','BurnPage','PsychPage','ToxicologyPage','PediatricsPage','ObstetricsPage'], 'Choose one qualified pathway; prove inputs, derived values and durable read-back.', 'Source-present. Do not market every pathway as clinically validated or complete.'),
 ('Procedures and perioperative care', 'Procedure, anaesthesia and pre/post-operative documentation organise the full intervention story.', ['IntubationPage','LacerationRepairPage','SplintPage','PreOpPage','OperativeNotePage','PostOpPage','AnesthesiaPage'], 'Write one procedure record and inspect it after refresh under an authorised role.', 'Source-present; broad procedure and perioperative qualification remains open.'),
 ('Orders and decision support', 'Orders, templates, care plans and alerts help clinicians act on structured information consistently.', ['OrdersPage','OrderSetsPage','NoteTemplatesPage','CDSAlertsPage'], 'Demonstrate one explainable alert with known inputs and test missing data.', 'Source-present; rules and scores must be distinguished from trained predictive AI.'),
 ('Administration and governance', 'Role management, devices, incidents, retention and identity review give operators explicit control points.', ['AdminDashboardPage','UserManagementPage','ManagedDevicesPage','SecurityIncidentsPage','RetentionPage','NationalIdReviewsPage','SettingsPage'], 'Prove a denied unauthorised action and an auditable permitted action.', 'Source-present; full security/retention assurance and institutional rollout not established.'),
 ('Financial and research workflows', 'Insurance, claim views, analytics and exports provide routes to operational insight and reporting.', ['InsurancePage','ClaimsEobPage','AnalyticsPage','ResearchExportsPage'], 'Trace displayed values to stored data; inspect export scope and authorisation.', 'Source-present. No insurer settlement, accepted research export or commercial adoption verified.'),
 ('Accessibility and connectivity', 'Text-size preferences and language/offline entry points address practical access needs.', ['LanguageSettingsPage','OfflineSyncPage','SettingsPage','WearablesPage'], 'Prove keyboard access, narrow screens, reconnect behaviour and a real configured device.', '27 Sep: 16px to 18px persisted; incomplete language choices noted. Offline/wearables fully unverified.'),
 ('Sensitive administrative records', 'Death certification and autopsy documentation extend structured record keeping to sensitive institutional duties.', ['DeathCertificatePage','AutopsyPage'], 'Validate role restrictions and one synthetic durable record before demonstration.', 'Source-present; legal certification authority and complete workflow not asserted.'),
]

# Complete the value map for shared navigation and emergency audit components.
families[1][2].append('EmergencyAccessHistory')
families[12][2].append('EmergencyProtocolsPage')
families[15][2].extend(['ActivatePage', 'LoginPage', 'DashboardPage'])

def p(title, lead='', sections=None):
    """Return an editable page definition with its introduction and content blocks."""
    return {'title':title, 'lead':lead, 'sections':sections or []}

product = [
 p('Care that carries forward.', 'MediChain connects the patient experience with the daily work of the care team.', [
  ('Best Health Solution | FNB App of the Year 2026', 'Product submission draft | 7 October 2026'),
  ('The product promise', 'A patient should not have to restart their medical story at every handover. MediChain brings patient records, consent, clinical work, diagnostics, medicines and emergency information into connected patient and staff experiences.'),
  ('One record. Several roles. A visible trail.', 'The application includes distinct experiences for patients, doctors, nurses, laboratory staff, pharmacists, responders and administrators. Its strongest story is the movement of useful information between those roles.'),
  ('What this working draft explores', 'An implemented application and selected synthetic workflows, supported by source and dated local verification. This is a positioning workshop document, not the final submission. The hosted build and final proof assets will shape the next revision.'),
  ('The opportunity', 'Turn fragmented care tasks into a coherent journey that patients can understand and care teams can continue. The following pages show the product value at each step.'),
 ]),
 p('From one encounter to the next', 'Six connected moments make the application memorable.', [
  ('1 | Identify and understand', 'Find the patient and inspect the record, history and observations. The next professional starts with context rather than an empty form.'),
  ('2 | Assess and document', 'Capture triage, clinical notes and nursing assessments in structured workflows. Preserve the encounter story for colleagues.'),
  ('3 | Diagnose and treat', 'Bring reviewed lab evidence into the chart; connect prescribing and dispensing to the treatment journey.'),
  ('4 | Continue the shift', 'Use care plans, fluid balance, wounds and SBAR handover to communicate what happened and what needs attention.'),
  ('5 | Give the patient a role', 'Patients can view records, manage access, see recorded disclosures, message the care team and organise appointments and medicines.'),
  ('6 | Carry context into emergencies', 'Medical identity and scoped emergency access can surface essential information for responders, with a recorded disclosure visible to the patient.'),
 ]),
 p('A patient experience with agency', 'The patient portal makes information and access visible.', [
  ('Understand the record', 'Records, medical history, observations and laboratory views give the patient a place to inspect their own care context. The value is continuity between encounters.'),
  ('Decide who can access', 'Consent controls provide a direct way to manage permission. Access history makes recorded use and emergency disclosure inspectable. This is a tangible product benefit that judges can explore.'),
  ('Prepare and follow through', 'Appointments, messages, medication views, reminders and symptom tracking provide practical follow-up tools. Their intended benefit is better preparation and less fragmented communication; outcome improvements remain to be measured.'),
  ('Keep essential information available', 'Medical ID and emergency-card workflows organise essential context. A QR download and an explicitly labelled preview are present; the app does not automatically set a phone lock screen.'),
  ('Include the wider household', 'Family, immunisation and preventive-care capabilities offer longer-term context. Family authorisation needs dedicated qualification before live use.'),
  ('Proof anchor', 'The 27 September local synthetic run recorded patient/doctor observations read-back, access-history visibility, two-way messages and an authenticated QR download. These are dated demonstration results, not adoption metrics. [E1]'),
 ]),
 p('A workspace for the care team', 'A shared patient context supports different professional tasks.', [
  ('Clinicians', 'Patient search, chart documents, triage, SOAP/progress notes, history and physical, consultations, discharge, orders and care plans organise the encounter from assessment to follow-up.'),
  ('Nurses', 'Nursing care plans, fluid balance, wound assessments, medication administration and SBAR handover support the details that carry a shift. A 4 October local run proved several durable writes and the incoming nurse handover, while exposing unresolved flowsheet, IV and Morse read-back checks. [E2]'),
  ('Laboratory and pharmacy', 'Specimen, results, review and critical-value entry points connect diagnostic work to the chart. Prescription processing and dispensing history give pharmacy its own task-focused path.'),
  ('Emergency responders', 'Emergency identity, authorised device selection and ambulance handover carry the same patient association into urgent care. Browser demonstration is evidence of a workflow, not certification of physical NFC deployment.'),
  ('Specialists and operators', 'Imaging, pathology, specialist emergencies, procedures and perioperative documentation broaden the product. Administration, identity review, incidents and retention offer governance controls. The evidence appendix lists the qualification task for every family.'),
 ]),
 p('Trust is part of the experience', 'The value is visible control, supported by explicit boundaries.', [
  ('Patient-visible accountability', 'Recorded access reasons and emergency disclosures give the patient a way to understand how information was used. This can make trust discussable in the interface rather than buried in a policy.'),
  ('Restricted professional access', 'Credential sessions, roles, access grants and managed-device workflows provide controls around sensitive tasks. A source-level control is not a completed independent security assessment.'),
  ('Protected records and signed audit checkpoints', 'The backend includes encrypted document storage in PostgreSQL and a signed audit stream. External immutable checkpoint copies and deployment hardening still require hosting work. [E3]'),
  ('Explainable support', 'Scores, alerts and structured pathways should show their inputs and preserve missing observations as missing. We present these as decision-support capabilities; we do not claim autonomous diagnosis or predictive machine learning.'),
  ('Responsible demonstration', 'Judging uses synthetic people and records. Live patient operation requires separate clinical, privacy, security and operational readiness work. The product proposition is continuity with accountability, with progress supported by evidence.'),
 ]),
 p('A focused commercial proposition', 'Research how the connected care journey can become a sustainable offering.', [
  ('Customer hypothesis', 'A clinic or care organisation coordinating patient follow-up, diagnostic results and staff handovers is a plausible buyer segment to investigate. This is positioning research, not a statement about existing customers.'),
  ('Why a facility might pay', 'The commercial proposition combines a patient portal and role-specific workflows, reducing the need to assemble disconnected tools for the same encounter. Time saved and avoided duplication are testable value hypotheses.'),
  ('Revenue hypothesis', 'Evaluate a facility subscription with transparent onboarding and support. Price by measured operating cost, procurement requirements and willingness to pay. Keep any proposed price separate from an agreed commercial offer.'),
  ('Affordable evaluation', 'The hosting plan keeps both frontends, API and database on one AWS server for the synthetic awards workload, with separate backups. Capacity and service eligibility must be measured and checked; credits are temporary. See the existing AWS research brief. [E4]'),
  ('Packaging question', 'Should the initial offering focus on records/access, diagnostics-to-treatment and nurse handover? A smaller, clearly qualified bundle may be easier to explain and operate than selling every specialist workflow at once.'),
  ('Research gate', 'Compare buyer needs, support requirements and operating cost before choosing the commercial package. Durable workflow proof and clinical review should guide the offering.'),
 ]),
 p('Why MediChain deserves a closer look', 'Judge the connected experience, then examine the evidence.', [
  ('A coherent product', 'The differentiating proposition is the combination of patient agency, clinical work, supporting roles and emergency continuity around one patient context. Demonstrate the transitions rather than asking judges to count screens.'),
  ('Relevant to South African care', 'The product is designed around continuity, trust and practical access. Low-data performance, full language coverage, offline behaviour and rural field usability are validation priorities, not completed achievements.'),
  ('A credible comparison', 'Vula Medical reports winning both the overall and health awards in 2025 through its specialist-access/referral proposition. MediChain should show its broader patient-to-care-team continuity clearly, without claiming to outperform an established winner or to be first in the market. [S11]'),
  ('What to explore first', 'Patient record and access history; reviewed laboratory evidence in the chart; pharmacy history; nursing handover; scoped emergency context. The judge guide gives a short exploration route.'),
  ('Evidence and next step', 'Review the Capability Evidence appendix alongside this submission. Hosted access details and current demo evidence must be added before entry. The application is ready to tell a product story; the submitted build must substantiate it.'),
  ('References', 'E1: output/demo-workflow-verification-2026-09-27.md. E2: output/verification/nurse-20261004.txt. E3: CLAUDE.md; api/src/ipfs.rs; api/src/audit_batching.rs. E4: docs/AWS_HOSTING_AND_FNB_AWARDS_RESEARCH_2026-10-07.md. Source repository: github.com/mrlucas679/medichain. S11 is linked in the research brief.'),
 ]),
]

evidence = [p('Capability and evidence', 'A complete value map, with qualification separated from source presence.', [
 ('How to read this appendix', 'Each family states the user benefit, the source areas inspected and a concrete demonstration. Source-present means implementation files exist; it does not establish that every route, permission, integration or save/reload journey works.'),
 ('Dated proof', 'E1 is the 27 September local synthetic browser verification. E2 is the 4 October nurse journey output: 37 of 41 total steps passed, including 10 session checks and 27 nurse checks; four nurse steps failed. Neither result certifies the current hosted build.'),
 ('Whole-application inventory', 'The accompanying CSV enumerates every non-test page component under both portals, plus declared route entries with source lines. Pages without an App.tsx reference are flagged for follow-up rather than silently counted as connected capabilities.'),
 ('Claims policy', 'No clinical safety outcome, time saving, partnership, predictive AI accuracy or compliance certification is asserted without independent evidence. This workshop edition excludes user and pilot content at the developer request.'),
 ('Scope', 'Reviewed on 7 October 2026. No application code changed or services started for this document build. Current deployment and role workflow qualification remain release tasks.'),
 ])]
for i in range(0, len(families), 3):
    blocks = []
    for name, value, pages, demo, status in families[i:i+3]:
        blocks.append((name, value + '<br/><b>Demonstrate:</b> ' + demo + '<br/><b>Evidence:</b> ' + status + '<br/><b>Source pages:</b> ' + ', '.join(pages)))
    evidence.append(p('The value behind the capability', f'Families {i+1}-{min(i+3,len(families))} of {len(families)}', blocks))
evidence.append(p('Release qualification and claims', 'Make every major promise inspectable.', [
 ('Prioritise failed read-back checks', 'Re-run nursing flowsheet, IV/VIP and Morse checks against the chosen judge build. Determine whether each failure is product behaviour, fixture/permission setup or the journey assertion. Resolve or disclose it; do not advertise these as passed.'),
 ('Prove the five headline journeys', 'Use distinct patient and staff browser profiles. Record permission grants/denials, writes, role-to-role read-back, refresh and restart. Keep a build identifier and a dated result ledger. A healthy endpoint is insufficient.'),
 ('Qualify integrations individually', 'Jitsi: two-device real call. Email/SMS: authenticated delivery and opt-out behaviour. NFC: physical device. Wearables: real provider data. Translation/offline: actual supported coverage and reconnect. Insurance/research: real downstream acceptance if claimed.'),
 ('Validate clinical support', 'Review score formulas, missing-data handling and alert behaviour with qualified clinical reviewers. Report limitations and intended use. Clinical effectiveness has not been measured by these documents.'),
 ('Attach proof that a judge can follow', 'Use six current synthetic screenshots with captions: patient record, access history, lab chart evidence, pharmacy history, nurse handover and emergency disclosure. The dated September images are not substituted for a current-build capture.'),
 ('Evidence provenance', 'All capability families derive from current portal page inventory and App.tsx routes. E1/E2 are local records, not independent clinical trials. Backend boundaries derive from CLAUDE.md and relevant API modules. Editable CSVs retain exact relative files and line numbers.'),
 ]))

judge = [
 p('Explore the connected care journey', 'A short guide for hands-on judging | Access edition awaiting hosted details', [
 ('Start with the patient', 'See what information the patient can view and how access is explained. Then switch to a professional role to see how that context supports a task.'),
 ('Structure status', 'This is the proposed structure for a later judge guide. After AWS hosting, add the verified URL, privately issued synthetic accounts, support contact and exact build through the final submission workflow.'),
 ('Use separate browser profiles', 'Patient, clinician, nurse, pharmacy, lab and responder accounts should use separate profiles or devices to avoid overwriting a shared session. Start each account at its own assigned portal.'),
 ('Demo data only', 'Use the assigned synthetic patient. Older local reports use Naledi Mokoena (Demo), PAT-DEMO-090; the hosted fixture may differ. Do not enter real patient data or call real emergency services.'),
 ('What to look for', 'The same patient context should follow the record, diagnostic evidence, treatment, handover and disclosure history. Reload a view to confirm the information persists.'),
 ]),
 p('The ten-minute exploration', 'A suggested route, not an organiser-mandated presentation length.', [
 ('0:00-2:00 | Patient perspective', 'Sign in to the patient portal. Open Records and Access History. Inspect a document and its recorded access information. Demonstrate a consent change only with the assigned fixture and restoration instructions.'),
 ('2:00-4:00 | Clinician and diagnostic evidence', 'In the staff profile, find the same patient and open the chart. Inspect the reviewed lab document, observations and one stored clinical note. Ask whether the source information survives refresh.'),
 ('4:00-5:30 | Treatment continuation', 'In the pharmacist profile, inspect prescription processing and dispensing history. Distinguish prescribed, dispensed and reconciled medicines.'),
 ('5:30-7:30 | The incoming shift', 'Inspect a synthetic SBAR handover from the incoming nurse account. Follow the patient association and retained information. Unqualified flowsheet/IV/Morse pathways should not be presented as certified.'),
 ('7:30-9:00 | Emergency context', 'Use the assigned simulated tag and authorised responder device. Inspect essential context and the handover patient link. Review the patient-visible emergency disclosure afterwards.'),
 ('9:00-10:00 | Wider capability', 'Inspect role navigation and the capability appendix. Ask about adoption and operating cost hypotheses, integration readiness and the next validation milestone.'),
 ]),
 p('What the demonstration should prove', 'Evaluate the product through observable transitions.', [
 ('Product and usability', 'Can an unfamiliar user find the record, finish a task and understand the next step? Does information read back after refresh and under the correct role?'),
 ('Creativity and impact', 'Does combining patient agency with care-team continuity offer a useful approach? The intended impact is fewer information gaps; measured health outcomes are not claimed.'),
 ('Sustainability', 'Is there a credible buyer segment and support/cost model? The facility-subscription model is a positioning hypothesis to investigate.'),
 ('Presentation and intelligence', 'Does the story demonstrate the app itself? Are alerts and scores explainable from inputs? No autonomous diagnostic or trained predictive-model performance is claimed.'),
 ('If a step fails', 'Record the role, build, action and visible error. Distinguish a live product failure from a recorded walkthrough. A video may explain intended behaviour; it cannot replace required usable judge access.'),
 ('Reference', 'Official judging domains are published in the organiser FAQ [S1]. No numeric weight or pass threshold was found. The ten-minute route is an entrant recommendation.'),
 ]),
]

research = [
 p('Submission requirements and strategy', 'Internal preparation brief | Public sources checked 7 October 2026', [
 ('The deadline finding', 'The organiser LinkedIn listing announces entries closing Friday 23 October 2026 and the virtual hackathon running 23-25 October. The closing time and timezone, awards judging days and event date were not found. Submit before the final day and obtain the judging window separately. [S6]'),
 ('Three distinct programmes', 'The awards recognise an existing usable app; the hackathon has its own event conditions and themes; the Academy is the learning programme. Do not assume registration or eligibility in one grants entry to the others. [S1, S7, S16]'),
 ('Category recommendation', 'Enter Best Health Solution first. One category is free; an additional category costs R250 excluding VAT. Enterprise is a possible paid secondary entry only if the professional workflow is strongly qualified. Best Hackathon eligibility needs event-specific confirmation. [S4, S5]'),
 ('Supporting documents: what is actually known', 'The live form has a supporting-files upload without a visible mandatory marker or document checklist. No universal requirement for a deck, ID copy, tax certificate, company certificate, video or clinical licence was found. This pack is our recommended persuasive evidence, not an official template. [S2, S3]'),
 ('Readiness decision', 'Do not submit this access-incomplete draft as a finished entry. Resolve hosted access, current screenshots, factual identity and build proof. Keep all final materials consistent with the live demonstration.'),
 ]),
 p('Requirements ledger', 'Required fields, organiser guidance and our recommendations have different status.', [
 ('Form fields carrying required markers', 'Name; company; email; phone; category; app name; publication location; African development location/country; invoice name/address/billing email; terms/privacy acceptance. Billing fields appear even for a free first category. Verify the final live form for conditional changes. [S3]'),
 ('Other displayed fields', 'Telephone; app description; icon; APK/app links; price; supporting files; demo username/password/login process; VAT number; marketing consent. Absence of a visible required marker does not remove the practical need for a useful description and judge access. [S3]'),
 ('Official functional requirements', 'Judges must be able to use a complete solution. Store publication is not essential when remote access and login details are supplied. The FAQ permits screenshot/image upload. [S1]'),
 ('Upload limits remain unknown', 'The supporting-file input allows multiple selection, with no exposed accept filter or required attribute. Maximum size, number, server validation and preferred file formats were not displayed. Do not test by submitting or uploading private documents. [S3]'),
 ('PWA publication route', 'The publication field provides Other. Use the verified hosted browser URL and describe the patient/staff web experience accurately. Obtain explicit organiser confirmation of PWA/device expectations before relying on that route. [S3]'),
 ('Eligibility and conditional documents', 'Review promoter/sponsor affiliation exclusions and accurate-entry obligations. Travel documents concern a travel prize; they are not a universal entry upload. The promoter may request further information. Do not invent documents or entitlement to enter. [S5]'),
 ]),
 p('How judging should shape the pack', 'Published domains; no public numeric weighting located.', [
 ('Published process', 'The FAQ describes two rounds, hands-on app exploration in round one, and three finalists per category. It lists product, creativity, usability, sustainability, impact, presentation and intelligence. [S1]'),
 ('Our evidence response', 'Working role transitions answer product and usability. Patient-visible access and care continuity support creativity. A buyer proposition and operating model address sustainability. Impact requires measured results when available. A concise connected journey supports presentation. Explainable rules address current intelligence honestly.'),
 ('Intelligence needs discipline', 'The FAQ includes forecasting/pattern-based behaviour, but the current pack does not pretend rule-based scoring is trained predictive AI. Explain current capability and validation; show a future predictive feature only as a future proposal.'),
 ('Judge insight, used carefully', 'The organiser-attributed 2025 release highlights real-world constraints, offline support and accessibility in judge commentary. Treat these as historical qualitative guidance, not 2026 weights. Demonstrate accessible text size now; measure offline/low-data before making claims. [S12]'),
 ('Competitive context', 'Vula reports 2025 overall and health wins; health is a serious competitive category. Our response is a clear patient-to-care-team continuity proposition and proof, not unsupported market uniqueness. [S11]'),
 ('Roster and influence', 'The official roster lists judges but does not label its year. Do not imply personal endorsement or design an entry around guessed individual preferences. No judge was contacted. [S9]'),
 ]),
 p('A persuasive submission bundle', 'Recommended packaging, subject to the organiser upload rules.', [
 ('01 | Product submission', 'Seven pages selling the application through patient agency, care-team continuity, trust and a focused adoption hypothesis. Lead upload once factual identity and current proof are confirmed.'),
 ('02 | Capability evidence', 'Nine pages explaining every capability family, its benefit, source presence, demonstration and current qualification boundary. Use as supporting evidence rather than overwhelming the main story.'),
 ('03 | Judge guide', 'Three pages with a suggested ten-minute route. Replace access-status wording with verified URL/account/support instructions before uploading. Put passwords in private form fields, not public marketing PDFs.'),
 ('04 | Pitch and video script', 'Six concise pages for a recorded or live pitch. A three-minute video is recommended, not required by a published rule. Record real current app screens and label synthetic data.'),
 ('05 | Research and requirements', 'This internal brainstorming brief stays with the team. Its editable inventory, claims ledger and release checklist support later revisions. None of this pack is the final submission.'),
 ('Media and evidence assets', 'Capture six current synthetic screenshots and a current screen recording. Use a recognisable icon and consistent name. Keep this workshop edition focused on product structure; external user and pilot material is deferred. Do not attach identity/legal documents merely because the upload is vague.'),
 ]),
 p('Work backwards from 23 October', 'Internal targets; organiser closing time still needs confirmation.', [
 ('7-10 October | Facts and scope', 'Confirm submitter/company, publication status, category and rights to the app. Ask the organiser about PWA eligibility, mandatory files/limits and judging dates. Select the core demonstration and record known limitations.'),
 ('10-14 October | Hosting and durability', 'Create the new AWS account, confirm Free Plan service access, provision the authorised architecture separately, verify HTTPS and backups. Qualify separate-role sessions and all five headline journeys on the actual hosted build.'),
 ('14-18 October | Product proof', 'Capture clean synthetic screenshots and a full successful walkthrough. Record timings only if measured. Resolve or narrow failed paths and make the claims ledger match the build.'),
 ('18-21 October | Submission finish', 'Confirm final factual sign-off, add private login details, compress files within confirmed limits, review the mobile experience, test every link from a separate network and submit early. Save entry ID, uploaded versions and any fee receipt.'),
 ('22-23 October | Contingency', 'Keep time for portal failures or organiser clarification. Do not assume midnight or use the hackathon end date as the awards entry deadline.'),
 ('During judging', 'Keep URLs, credentials, fixture data and funding stable through the organiser-confirmed window. Preserve support availability, backups and the exact submitted release.'),
 ]),
 p('Questions that public research cannot settle', 'A ready-to-send organiser enquiry; not sent by this research.', [
 ('Contact', 'Official contact: admin@creativespacemedia.co.za; +27 11 467 3341. [S8]'),
 ('Draft enquiry', 'We plan to enter MediChain for Best Health Solution in 2026. It has patient and staff browser/PWA experiences. Please confirm PWA eligibility and device expectations; the 23 October closing time/timezone; awards judging and hosting dates; mandatory supporting documents; maximum file sizes/count and allowed formats; any required pitch/video; and whether demo accounts can be restricted to synthetic data. Please also confirm the final entry portal and how conditional billing fields work for one free category.'),
 ('Current hackathon themes', 'The page lists higher education; youth employment/work readiness; youth entrepreneurship/small-business growth; financial inclusion; safer communities/gender-based violence response; and climate resilience/essential services. Healthcare is not listed as a standalone theme. Do not force a fit without organiser guidance. [S7]'),
 ('If also entering the hackathon', 'Clarify pre-existing code, team rules, theme fit, intellectual property, delivery format and the rubric. The linked registration target returned 404 through the research fetch; this does not prove registration is unavailable in a normal browser. [S7]'),
 ('No private access workaround', 'LinkedIn public search provided the date announcement; direct access returned a rate-limit response. Social snippets were treated as dated organiser statements, not complete rules. No login, private profile scraping or contact attempt was made.'),
 ('Unresolved public gaps', 'No complete mandatory-upload checklist, award rubric weights, exact 2026 judging dates, current prize details or complete hackathon rules were verified. Those gaps remain explicit rather than filled with previous-year assumptions.'),
 ]),
]
research.append(p('Research record and source hierarchy', 'Public material reviewed; relevant guidance retained and historical rules separated.', [
 ('Authoritative first', 'Entry page and linked form, FAQ, categories, 2026 terms, contact page, current hackathon themes, organiser LinkedIn and sponsor FNB article. The form was inspected read-only with no personal entry or submission.'),
 ('Historical and comparative', 'Official winner archive; Vula primary winner story and public LinkedIn announcement; organiser-attributed 2025 judge commentary; 2025 programme; a public previous entrant pack; Academy terms. Historical examples inform packaging only.'),
 ('Conflicts surfaced', 'The FAQ still contains 2025 Academy copy while the form says 2026. The category page and form can differ. LinkedIn gives current October dates while the main terms do not specify a deadline. Recheck final form and organiser messages before submission.'),
 ('Excluded material', 'Older MTN-era rules, unrelated banking complaints, unrelated app awards and generic advice are not treated as 2026 rules. An entrant pack does not establish acceptance or judge preference. Academy completion is not assumed from repository history.'),
 ('Coverage boundary', 'The search covered organiser, sponsor, winner, judge commentary and public social/entrant material across targeted rounds. It cannot establish that every internet page or future update has been found. The practical remaining information is recorded as organiser questions.'),
 ('Evidence distinction', 'External sources establish competition facts. Repository files establish implementation presence. Dated local runs establish selected observed behaviour. Clinical or commercial impact needs separate real-world evidence.'),
 ]))
for offset in (0,8):
    research.append(p('Linked research sources', f'Retrieved 7 October 2026 | sources {offset+1}-{min(offset+8,len(sources))}', [(key+' | '+name, '<link href="'+url+'" color="#006E73">'+url+'</link>') for key,(name,url) in list(sources.items())[offset:offset+8]]))

pitch = [
 p('Care that carries forward.', 'MediChain | Best Health Solution | Proposed three-minute pitch', [
 ('Opening | 0:00-0:25', 'A patient arrives with a medical story. Every new clinician, shift or emergency responder needs the right part of that story. MediChain gives the patient and the care team connected ways to carry it forward.'),
 ('Show the application', 'Open the patient record, then the staff chart for the same synthetic patient. Show the actual interface immediately. Avoid a long problem-only introduction.'),
 ('The memorable promise', 'One patient context. Role-specific work. Patient-visible accountability.'),
 ]),
 p('The patient has a place in the journey', 'Scene 2 | 0:25-0:55', [
 ('Narration', 'The patient can inspect records and observations, organise appointments and medicines, and communicate with the care team. Consent controls and recorded access history make information use visible.'),
 ('Show', 'A stored record, one recorded access reason and the consent interface. Keep synthetic-data identification visible.'),
 ('Sell the value', 'This is agency and continuity a person can interact with. Do not claim measured engagement or adherence improvements without data.'),
 ]),
 p('The care team continues the same story', 'Scene 3 | 0:55-1:35', [
 ('Narration', 'The clinician sees the chart and reviewed diagnostic evidence. Pharmacy has prescription processing and history. Nursing care and SBAR handover keep the next shift informed. Each role has a task-focused view of the same patient context.'),
 ('Show', 'Reviewed lab result in the chart; prescription history; incoming nurse handover. Use currently passing journeys and refresh one view to demonstrate persistence.'),
 ('Sell the value', 'MediChain connects the work around the encounter. The broader application also includes specialist, procedure, imaging, preventive and administrative capabilities; the evidence appendix explains their readiness.'),
 ]),
 p('Urgent context, accountable access', 'Scene 4 | 1:35-2:05', [
 ('Narration', 'In the responder experience, medical identity and authorised emergency access can surface essential context and carry the patient into ambulance handover. Afterwards, the patient can inspect the recorded disclosure.'),
 ('Show', 'Synthetic browser tag scan, scoped demo responder device, patient association and disclosure history. Label the scan as simulated; physical NFC is a separate validation task.'),
 ('Sell the value', 'The product pairs useful information with a visible record of its use. Emergency convenience and patient trust belong in the same story.'),
 ]),
 p('A product with a focused next step', 'Scene 5 | 2:05-2:35', [
 ('Narration', 'The commercial proposition is a facility offering that connects records, diagnostics-to-treatment and handover. The next positioning decision is how to package these capabilities with transparent onboarding, support and operating cost.'),
 ('Show', 'Three connected product tasks: retrieve the record; follow diagnostic evidence into treatment; continue the incoming shift. Use actual app views once hosting is ready.'),
 ('Sell the value', 'A coherent facility offering and an operating-cost plan make the application discussable as a sustainable product.'),
 ]),
 p('Judge the journey. Inspect the evidence.', 'Closing | 2:35-3:00', [
 ('Narration', 'MediChain brings patient agency, care-team work and emergency continuity into connected experiences. Explore the patient journey and the transitions between roles. Then inspect the evidence, current limits and the next validation milestone.'),
 ('Final screen', 'App name, Best Health Solution category, verified hosted URL once issued, and the three words: Continuity. Agency. Accountability.'),
 ('Recording checklist', 'Use the exact submitted release and synthetic fixtures. Add captions; use readable zoom; keep passwords off-screen; ensure audio is clear. Export a small accessible video and test the viewing link privately before submitting.'),
 ('Pitch status', 'This is a proposed script and presentation aid. It does not assert that a video or a three-minute pitch is an official submission requirement.'),
 ]),
]

packs = [('01_MediChain_Product_Submission',product),('02_MediChain_Capability_Evidence',evidence),('03_MediChain_Judge_Guide',judge),('04_MediChain_Pitch_and_Video_Script',pitch),('05_FNB_Research_and_Requirements',research)]

def draw_para(c, text, y, size=10.5, color=INK, bold=False):
    """Draw one wrapping paragraph and reject text that would cross the footer."""
    style = ParagraphStyle('body', fontName='ArialBold' if bold else 'Arial', fontSize=size, leading=size*1.4, textColor=color, spaceAfter=0)
    para = Paragraph(text, style)
    _, height = para.wrap(W-96, H)
    if y-height < 68:
        raise ValueError(f'Page overflow: {text[:80]} ends at {y-height}')
    para.drawOn(c,48,y-height)
    return y-height

def build(name, pages):
    """Generate deliberately paginated PDFs and retain the editable source text."""
    target = OUT/(name+'.pdf')
    c = canvas.Canvas(str(target),pagesize=(W,H))
    c.setTitle(name.replace('_',' '))
    c.setAuthor('MediChain submission preparation')
    md = ['# '+name.replace('_',' '), '', 'Prepared 7 October 2026. Research and positioning workshop. Not a final submission.', '']
    for idx,page in enumerate(pages,1):
        c.setFillColor(NAVY); c.rect(0,H-34,W,34,fill=1,stroke=0)
        c.setFont('ArialBold',9); c.setFillColor(white); c.drawString(48,H-22,'MEDICHAIN / APP OF THE YEAR 2026')
        c.setFillColor(TEAL); c.rect(48,H-66,42,4,fill=1,stroke=0)
        y = draw_para(c,escape(page['title']),H-86,25,NAVY,True)-12
        if page['lead']:
            y = draw_para(c,escape(page['lead']),y,12.5,TEAL)-23
        md.extend(['## '+page['title'],page['lead'],''])
        for title,body in page['sections']:
            y = draw_para(c,escape(title),y,11.5,NAVY,True)-5
            y = draw_para(c,body,y,10.2)-15
            md.extend(['### '+title, re.sub('<[^>]+>','',body),''])
        c.setStrokeColor(PALE); c.line(48,48,W-48,48)
        c.setFillColor(MUTED); c.setFont('Arial',8)
        c.drawString(48,33,'7 OCT 2026 | RESEARCH / POSITIONING WORKSHOP')
        c.drawRightString(W-48,33,f'{idx} / {len(pages)}')
        c.showPage()
    c.save()
    (SRC/(name+'.md')).write_text('\n'.join(md),encoding='utf-8')
    return target

def inventories():
    """Create exact page and route inventories without interpreting presence as proof."""
    rows=[]; routes=[]; claims=[]
    for portal in ('doctor-portal','patient-app'):
        app=ROOT/f'client/{portal}/src/App.tsx'
        apptext=app.read_text(encoding='utf-8')
        for file in sorted((app.parent/'pages').glob('*.tsx')):
            if '.test.' in file.name: continue
            families_found=[f[0] for f in families if file.stem in f[2]]
            reference=next((i for i,line in enumerate(apptext.splitlines(),1) if f'/pages/{file.stem}' in line),None)
            rows.append({'portal':portal,'page':file.stem,'path':file.relative_to(ROOT).as_posix(),'App_reference_line':reference or '', 'family':'; '.join(families_found) or 'Navigation/auth/other - review route use','status':'Source-present; inspect route connection' if reference else 'No direct App import match; follow-up'})
        for i,line in enumerate(apptext.splitlines(),1):
            if '<Route' in line:
                routes.append({'portal':portal,'file':app.relative_to(ROOT).as_posix(),'line':i,'declaration':line.strip()})
    for name,value,pages,demo,status in families:
        actual=[r for r in rows if r['page'] in pages]
        claims.append({'family':name,'benefit_hypothesis':value,'source_files':'; '.join(r['path'] for r in actual),'proof_task':demo,'current_evidence':status,'allowed_claim':'Implemented/source-present capability; dated selected proof only','withheld_claim':'Complete current hosted workflow, clinical outcome, traction or certification unless separately evidenced'})
    for name, data in [('page_inventory',rows),('route_inventory',routes),('claims_ledger',claims)]:
        with (SRC/(name+'.csv')).open('w',newline='',encoding='utf-8-sig') as stream:
            writer=csv.DictWriter(stream,fieldnames=list(data[0])); writer.writeheader();writer.writerows(data)
    return {'page_components':len(rows),'route_declaration_lines':len(routes),'capability_families':len(claims)}

if __name__=='__main__':
    (SRC/'pack_content.json').write_text(json.dumps({'date':'2026-10-07','packs':packs,'sources':sources,'families':families},indent=2),encoding='utf-8')
    files=[build(name,pages) for name,pages in packs]
    result={'inventory':inventories(),'pdfs':[]}
    for file in files:
        reader=PdfReader(file)
        texts=[page.extract_text() or '' for page in reader.pages]
        if any(len(t)<100 for t in texts): raise ValueError('Unexpected empty page')
        result['pdfs'].append({'file':file.name,'pages':len(reader.pages),'bytes':file.stat().st_size,'characters':sum(map(len,texts))})
    (SRC/'validation.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,indent=2))
