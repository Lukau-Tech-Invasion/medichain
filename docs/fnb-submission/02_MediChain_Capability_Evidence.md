# 02 MediChain Capability Evidence

Prepared 7 October 2026. Research and positioning workshop. Not a final submission.

## Capability and evidence
A complete value map, with qualification separated from source presence.

### How to read this appendix
Each family states the user benefit, the source areas inspected and a concrete demonstration. Source-present means implementation files exist; it does not establish that every route, permission, integration or save/reload journey works.

### Dated proof
E1 is the 27 September local synthetic browser verification. E2 is the 4 October nurse journey output: 37 of 41 total steps passed, including 10 session checks and 27 nurse checks; four nurse steps failed. Neither result certifies the current hosted build.

### Whole-application inventory
The accompanying CSV enumerates every non-test page component under both portals, plus declared route entries with source lines. Pages without an App.tsx reference are flagged for follow-up rather than silently counted as connected capabilities.

### Claims policy
No clinical safety outcome, time saving, partnership, predictive AI accuracy or compliance certification is asserted without independent evidence. This workshop edition excludes user and pilot content at the developer request.

### Scope
Reviewed on 7 October 2026. No application code changed or services started for this document build. Current deployment and role workflow qualification remain release tasks.

## The value behind the capability
Families 1-3 of 19

### Patient identity and records
Less repeated explanation at every encounter. Registration, profiles, history and chart documents organise the context the care team needs.Demonstrate: Open the same synthetic patient in both portals; retrieve one stored document.Evidence: 27 Sep: approved document opened; all registration variations remain to qualify.Source pages: RegisterPatientPage, PatientDetailPage, PatientSearchPage, MyProfilePage, MyRecordsPage, MedicalHistoryPage

### Consent and accountability
Patients can manage access and inspect recorded disclosures. Trust becomes a visible part of the experience.Demonstrate: Grant access, read as clinician, revoke, then prove denial and patient-visible history.Evidence: 27 Sep: document reasons and emergency disclosure visible; universal audit coverage not certified.Source pages: ConsentManagementPage, AccessHistoryPage, AccessLogsPage, EmergencyAccessHistory

### Emergency identity and handover
Responders can locate essential patient context and carry the patient identity into a structured ambulance handover.Demonstrate: Use a synthetic tag/QR, scoped responder device and recorded emergency reason.Evidence: 27 Sep: browser scanner and handover association verified; physical NFC and field use unverified.Source pages: EmergencyAccessPage, EmsHandoffPage, MedicalIDPage, MedicalIdPage, EmergencyCardPage, HealthIdCardsPage, BarcodePage

## The value behind the capability
Families 4-6 of 19

### Clinical assessment and notes
Structured triage, observations and clinical notes make an encounter easier to follow across staff changes.Demonstrate: Save observations and a note, then reload the same patient from another role.Evidence: 27 Sep: observations read back in patient and doctor views; 4 Oct nursing flowsheet check failed.Source pages: TriagePage, SOAPNotePage, VitalSignsPage, ProgressNotePage, HistoryAndPhysicalPage, ConsultPage, DischargePage, AMAPage, VitalsPage

### Nursing continuity
Care plans, fluid balance, wounds and SBAR handover preserve the shift story for incoming staff.Demonstrate: Complete one shift and retrieve its SBAR from the incoming nurse account.Evidence: 4 Oct: care plan, wound and handoff read-back passed; IV/VIP and Morse read-back unresolved.Source pages: NursingPage, NurseDashboardPage, NursingCarePlanPage, IntakeOutputPage, WoundCarePage, IVSitePage, ShiftHandoffPage, FallRiskPage, IncidentReportPage

### Medicines and pharmacy
Prescribing, dispensing, administration and patient medication views connect treatment decisions to follow-through.Demonstrate: Open a stored prescription, inspect dispensing history and patient medication context.Evidence: 27 Sep: prescription filters/history and 12-unit synthetic dispensing visible. Reconciliation is separate.Source pages: EPrescribePage, PharmacistDashboardPage, MedicationAdminPage, DrugInteractionsPage, MedicationsPage, MedicationRemindersPage

## The value behind the capability
Families 7-9 of 19

### Laboratory workflow
Specimen tracking, reviewed results and critical-value workflows keep diagnostic evidence tied to the patient.Demonstrate: Open one approved result in lab, clinician and patient views.Evidence: 27 Sep: approved full blood count with three parameters opened; QC/blood bank full journeys unverified.Source pages: LabTechDashboardPage, LabResultsPage, LabResultPage, SpecimenPage, ChainOfCustodyPage, LabQCPage, CriticalValuePage, BloodBankPage, LabReviewPage

### Imaging and pathology
Diagnostic documents and specialist reports can sit alongside the patient record instead of separate conversations.Demonstrate: Persist a report, reload it, and prove authorised document access.Evidence: Source-present; current hosted end-to-end workflow not certified.Source pages: ImagingPage, RadiologyPage, PathologyPage

### Appointments and communication
Scheduling and patient-clinician messaging help care continue between visits.Demonstrate: Book an appointment, inspect the staff schedule, exchange a message and reload.Evidence: 27 Sep: two-way messaging verified; hosted scheduling and external notification delivery need qualification.Source pages: AppointmentSchedulerPage, ProviderSchedulePage, AppointmentsPage, MessagesPage, NotificationsPage

## The value behind the capability
Families 10-12 of 19

### Virtual consultations
A telehealth entry point offers a route to remote consultation when a configured provider is available.Demonstrate: Join as both parties on separate devices, test audio/video and session access.Evidence: Jitsi integration source exists; no real call certification in reviewed evidence.Source pages: TelehealthPage

### Patient self-management
Symptoms, lab trends, reminders and medical history help patients prepare for and follow up care.Demonstrate: Record a symptom and retrieve it; inspect a dated trend and its missing-data state.Evidence: Source-present; no demonstrated outcome improvement or autonomous diagnosis claim.Source pages: SymptomTrackerPage, SymptomCheckerPage, LabTrendsPage, SatisfactionSurveyPage, MedicalHistoryPage

### Family and prevention
Family relationships, immunisations, family history and care plans organise longer-term health context.Demonstrate: Prove family permission boundaries and one stored preventive record.Evidence: Source-present; all family delegation and prevention journeys need current qualification.Source pages: FamilyGroupPage, FamilyHistoryPage, ImmunizationPage, CarePlanPage

## The value behind the capability
Families 13-15 of 19

### Acute and specialist workflows
Dedicated emergency, paediatric, maternity, mental-health and toxicology forms preserve condition-specific context.Demonstrate: Choose one qualified pathway; prove inputs, derived values and durable read-back.Evidence: Source-present. Do not market every pathway as clinically validated or complete.Source pages: CodeBluePage, TraumaPage, StrokePage, CardiacPage, SepsisPage, MCIPage, BurnPage, PsychPage, ToxicologyPage, PediatricsPage, ObstetricsPage, EmergencyProtocolsPage

### Procedures and perioperative care
Procedure, anaesthesia and pre/post-operative documentation organise the full intervention story.Demonstrate: Write one procedure record and inspect it after refresh under an authorised role.Evidence: Source-present; broad procedure and perioperative qualification remains open.Source pages: IntubationPage, LacerationRepairPage, SplintPage, PreOpPage, OperativeNotePage, PostOpPage, AnesthesiaPage

### Orders and decision support
Orders, templates, care plans and alerts help clinicians act on structured information consistently.Demonstrate: Demonstrate one explainable alert with known inputs and test missing data.Evidence: Source-present; rules and scores must be distinguished from trained predictive AI.Source pages: OrdersPage, OrderSetsPage, NoteTemplatesPage, CDSAlertsPage

## The value behind the capability
Families 16-18 of 19

### Administration and governance
Role management, devices, incidents, retention and identity review give operators explicit control points.Demonstrate: Prove a denied unauthorised action and an auditable permitted action.Evidence: Source-present; full security/retention assurance and institutional rollout not established.Source pages: AdminDashboardPage, UserManagementPage, ManagedDevicesPage, SecurityIncidentsPage, RetentionPage, NationalIdReviewsPage, SettingsPage, ActivatePage, LoginPage, DashboardPage

### Financial and research workflows
Insurance, claim views, analytics and exports provide routes to operational insight and reporting.Demonstrate: Trace displayed values to stored data; inspect export scope and authorisation.Evidence: Source-present. No insurer settlement, accepted research export or commercial adoption verified.Source pages: InsurancePage, ClaimsEobPage, AnalyticsPage, ResearchExportsPage

### Accessibility and connectivity
Text-size preferences and language/offline entry points address practical access needs.Demonstrate: Prove keyboard access, narrow screens, reconnect behaviour and a real configured device.Evidence: 27 Sep: 16px to 18px persisted; incomplete language choices noted. Offline/wearables fully unverified.Source pages: LanguageSettingsPage, OfflineSyncPage, SettingsPage, WearablesPage

## The value behind the capability
Families 19-19 of 19

### Sensitive administrative records
Death certification and autopsy documentation extend structured record keeping to sensitive institutional duties.Demonstrate: Validate role restrictions and one synthetic durable record before demonstration.Evidence: Source-present; legal certification authority and complete workflow not asserted.Source pages: DeathCertificatePage, AutopsyPage

## Release qualification and claims
Make every major promise inspectable.

### Prioritise failed read-back checks
Re-run nursing flowsheet, IV/VIP and Morse checks against the chosen judge build. Determine whether each failure is product behaviour, fixture/permission setup or the journey assertion. Resolve or disclose it; do not advertise these as passed.

### Prove the five headline journeys
Use distinct patient and staff browser profiles. Record permission grants/denials, writes, role-to-role read-back, refresh and restart. Keep a build identifier and a dated result ledger. A healthy endpoint is insufficient.

### Qualify integrations individually
Jitsi: two-device real call. Email/SMS: authenticated delivery and opt-out behaviour. NFC: physical device. Wearables: real provider data. Translation/offline: actual supported coverage and reconnect. Insurance/research: real downstream acceptance if claimed.

### Validate clinical support
Review score formulas, missing-data handling and alert behaviour with qualified clinical reviewers. Report limitations and intended use. Clinical effectiveness has not been measured by these documents.

### Attach proof that a judge can follow
Use six current synthetic screenshots with captions: patient record, access history, lab chart evidence, pharmacy history, nurse handover and emergency disclosure. The dated September images are not substituted for a current-build capture.

### Evidence provenance
All capability families derive from current portal page inventory and App.tsx routes. E1/E2 are local records, not independent clinical trials. Backend boundaries derive from CLAUDE.md and relevant API modules. Editable CSVs retain exact relative files and line numbers.
