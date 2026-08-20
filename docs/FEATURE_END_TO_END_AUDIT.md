# MediChain end-to-end feature audit

**Audited:** 2026-08-09 · **Last amended:** 2026-08-20  
**Verdict:** **NOT READY FOR PRODUCTION**

## 2026-08-20 — silent-write defects, and why the gates missed them

Six defect classes were found by driving the running application as a signed-in
clinician rather than by reading code. Every one of them passed every existing
gate, because each was a **successful write that no reader could see**:

1. **`update()` dropped the `data` column in 17 repositories** whose read path
   serves exactly that column. A consult could be answered — status, findings
   and recommendations written and returned as `success: true` — and still read
   back as unanswered to every clinician who opened it.
2. **`consultation_notes`' CHECK constraint rejected four of the six statuses
   the portal produces**, including `requested`, which every new consult is
   created with. Requesting a consult failed outright on PostgreSQL while
   succeeding in the in-memory backend.
3. **Credential sign-in could never obtain a JWT.** `from_hex` rejected the `0x`
   prefix `u8aToHex` emits, so a valid sr25519 signature failed at the hex
   decoder and was reported as `SIGNATURE_VERIFICATION_FAILED`.
4. **Five repository methods reachable from handlers were unimplemented on
   Postgres only**, returning `list_all not implemented` — lab QC, blood bank,
   specimen collection and specimen rejection registries.
5. **The doctor dashboard mis-read its own alerts**: a potassium of 6.9
   displayed as `6.9000 -` with no unit and "Invalid Date", every order as a
   bare `lab:`, and a lowercase `stat` priority never matched the `'STAT'`
   comparison, so the most urgent orders rendered in neutral grey.
6. **Conditional React hooks on all three admin pages**, and the psychiatric
   History tab threw on the first stored assessment, unmounting the tab so it
   read as "no assessments on file" for a patient who had one.

**The pattern worth keeping:** the in-memory backend enforces no constraints and
several read paths serve a JSON blob rather than the columns a write updates.
Together those hide an entire class of failure from unit tests, from `clippy`,
and from any check that does not read the value back through the endpoint a
clinician actually uses. Durability tests must assert on the **read path**, not
on the repository round-trip.

All six are fixed, with regression coverage. See
`docs/TECHNICAL_DEBT_REGISTER.md` for the per-item detail and the detectors.

## Fresh runtime E2E rerun — 2026-08-14

The rebuilt Docker runtime was exercised with synthetic records across
registration, consent, emergency access, retention, nursing, records/IPFS,
messaging, clinical registries, patient self-access, credential login,
appointments, telehealth, and identity-bound authorization.

**Result: 210 passed, 1 failed.**

The only failure was the test bootstrap setup: the synthetic bootstrap key was
rejected with `INVALID_BOOTSTRAP_KEY` (HTTP 403). This is test-environment
configuration drift, not a failed application workflow; the remaining account
fixtures already existed and all downstream flows completed successfully.

The rerun specifically confirmed that appointment lifecycle transitions,
strict appointment-type validation, telehealth session provisioning and join
gates, emergency-card disclosure, employee-ID credential login, and provider
impersonation protections now pass against the rebuilt API image.

This is the current source of truth for feature completeness. Older feature
inventories may prove that a page or route existed at a point in time; they do
not override this audit.

## What “end to end” means

A feature is complete only when all of the following are true:

1. A user can perform the action in the correct frontend.
2. The frontend calls a registered backend route with the correct HTTP method
   and a compatible request/response shape.
3. The backend authenticates the caller, authorizes the operation and derives
   identity from trusted credentials rather than caller-supplied identity.
4. Production data is durably stored and can be read back after a process
   restart.
5. The saved state is consumed by the feature it is intended to control.
6. Automated coverage exercises the successful path and important denial or
   failure paths.

A rendered page, a registered endpoint, an in-memory map, or a green static
route scan is not by itself end-to-end proof.

## Verified in this audit

| Area | Evidence | Result |
|---|---|---|
| Frontend/backend route contract | Static inventory compared 342 production frontend method/path calls (332 distinct paths) with 409 registered backend method/path routes (396 distinct paths). | No method/path drift detected. |
| Endpoint authentication baseline | 410 handlers inventoried; no tier-0 unauthenticated handlers and no tier-1 presence-only handlers. | Baseline passes; 41 unscoped bulk reads remain. |
| Patient satisfaction | Patient app submits through the typed client to `POST /api/clinical/satisfaction-survey`; the backend derives the linked patient, validates ranges, generates the identifier, persists through the repository layer and returns errors without a false success screen. | Connected and covered by five focused tests. |
| User settings | Patient and doctor settings load and save through `/api/settings`; Postgres stores preferences in `user_profiles.preferences`, while the explicit memory backend stores them only for demo/test use. | Preference round-trip connected. |
| Medical-ID lock-screen preference | The patient setting is saved through the Medical-ID preference endpoint, and the lock-screen endpoint denies access when `show_when_locked` is disabled. | Preference is enforced and has a negative-path API test. |
| Frontend trusted gate | Doctor: 25 files / 104 tests. Patient: 7 files / 23 tests. | 32 files / 127 tests passed. |
| Frontend types | Shared client, doctor portal and patient app typechecks. | Passed. |
| Rust formatting | `cargo fmt --all -- --check`. | Passed. |

## Feature status

| Feature group | Status | What is complete | What prevents an end-to-end production claim |
|---|---|---|---|
| Authentication, users and RBAC | **Partial — release verification required** | Wallet/JWT authentication, persistent user/profile/RBAC mutations and MFA step-up remediation exist with regression coverage. | Rust/Postgres tests were not freshly run on this workstation, and 41 bulk-read handlers still require a documented tenant-scope decision or enforcement. |
| Emergency protocols | **Implemented — dynamic proof pending** | Code Blue, trauma, stroke, cardiac and sepsis use repositories and have restart-oriented tests. | Fresh Rust/Postgres CI evidence is still required on the release commit. |
| Emergency and lock-screen Medical ID | **Partial — release blocking** | Capability checks, device binding, audit-before-disclosure and the lock-screen preference are implemented. | Core Medical-ID responses still omit emergency contacts, chronic conditions and current medicines in some paths; external emergency notification recipients are not implemented. |
| Consent and patient access | **Partial — release blocking** | Consent records use the repository abstraction and the hardcoded patient response was removed. | Patient access requests and grants in `patient_access.rs` are process-memory only and disappear on restart. |
| Clinical workflows | **Partial — release blocking** | Many workflows are connected to typed clients and repository-backed endpoints. | The legacy stores listed below remain process-memory only. A successful request can therefore lose regulated clinical data after restart. |
| Patient satisfaction | **Connected** | Correct patient-facing API, durable repository write, validation and truthful failure UI are implemented. | Fresh Rust/Postgres execution remains part of the release gate. |
| Settings | **Partial** | Patient and doctor preferences round-trip durably; Medical-ID lock-screen and language mappings are connected. | Notification/privacy preferences are stored but are not yet consumed by every downstream delivery and research workflow. Legal Terms and Privacy notices have not been published. |
| FHIR interoperability | **Partial — release blocking for claimed resources** | FHIR routes and several resource transformations exist. | Patient address/contact arrays and chronic medication/condition resources still contain explicit empty/TODO mappings. |
| Telehealth, mobile and federation | **Partial / external qualification required** | UI and API surfaces exist for the current demo flows. | Several compatibility/security registries remain memory-only, and real providers, secure key custody, mobile hardware and multi-validator/multi-hospital qualification require external environments. |
| Automated testing | **Partial — H3 remains open** | Typechecks and the reviewed 32-file / 127-test frontend gate pass. CI makes Rust formatting, Clippy and Postgres tests blocking. | The historical generated frontend suite still has large unresolved failures, and fresh local Rust compilation/tests were blocked by insufficient disk space. |

## Release-blocking implementation backlog

### P0 — durability, isolation and clinical safety

1. ~~**Eliminate clinical state that a restart destroys.**~~ — **CLOSED
   2026-08-11.** `scripts/check-state-durability.py` reports **0 references
   across 0 fields**; the ratchet is at zero and can only be broken by a
   regression.

   Two corrections to the 2026-08-09 measurement below, both found while
   closing it:

   * **The backlog was overstated 2.7×.** The gate counted `data.<field>`
     occurrences in *comments*, and a rewired handler keeps a note naming the
     map it replaced ("was: in-memory `data.soap_notes` HashMap"). 15 fields
     that were already fully migrated were still being counted. The gate now
     strips comments before matching, so the number means what it says. The
     real remaining work was 19 references across 11 fields, not 52 across 32.
   * **Two of the six "no repository yet" fields already had one** —
     `soap_notes` and `wearable_readings` were wired into the container and
     only the handler was outstanding.

   What was actually done: `operative_notes`, `post_op_notes` and
   `anesthesia_records` onto their existing typed repositories (migration
   `20260810000001` had already prepared the tables); radiology orders,
   radiology reports and pathology reports likewise via new migration
   `20260811000001`; and the remaining shape-mismatch domains — blood-type
   screens, transfusion records, e-prescriptions, death certificates, family
   histories, user settings and the spent-emergency-token set — onto
   JSON-record repositories via `20260811000002`.

   `used_emergency_tokens` is worth calling out separately: it is the
   spent-token set behind one-time emergency access, and holding it in process
   memory meant a restart, crash or rolling deploy silently made every already
   redeemed emergency token valid again against PHI. `consume_emergency_token`
   is now async, durable and fails closed, with a restart regression test.

   `20260811000001` also had to widen five CHECK constraints that were narrower
   than the Rust enums feeding them (`radiology_orders.status` was missing
   `preliminary`/`final`, `priority` was missing `scheduled`/`prn`, `modality`
   was missing `angiography`, `radiology_reports.status` was missing
   `addendum`, `pathology_reports.status` was missing `pending`) — every one of
   those values is reachable from an ordinary request, so the writes would have
   failed on a constraint violation even once wired.

   The original measurement, for reference:

   The raw field count badly overstates the problem. `AppState` declares **89**
   `RwLock<HashMap|Vec>` fields, but only **33 are referenced by production
   code at all**, across **55 call sites in ~20 files**. The other 55 fields are
   vestigial — their handlers already moved to repositories and the field was
   left behind. Those are cleanup (ADR: cleanup is the last step), not risk.

   Of the 33 live fields:

   | Group | Fields | Refs | Work |
   |---|---|---|---|
   | Repository already exists, handler never calls it | 27 | 46 | Rewire handler + map API type to entity + restart test |
   | No repository yet | 6 | 9 | Build trait + memory + Postgres + migration, then as above |

   The rewiring group is the bulk of it and is *not* a from-scratch build:
   `PreOpAssessmentRepository`, `OperativeNoteRepository`,
   `PostOpNoteRepository`, `AnesthesiaRecordRepository` and their peers already
   exist with memory and Postgres implementations, wired into
   `RepositoryContainer` (`repositories/mod.rs:134-137`). The remaining cost per
   field is the mapping layer between the API types in `clinical.rs`
   (`PreOperativeAssessment`, …) and the persistence entities
   (`PreOpAssessmentEntity`, …), whose field names and granularity differ.

   Highest concentration, and therefore the suggested order:
   `clinical_endpoints/surgical/perioperative.rs` (pre-op, operative, post-op),
   `clinical_endpoints/surgical/diagnostics.rs` (anaesthesia, radiology,
   pathology), `clinical_endpoints/surgical/public_health.rs` (immunisation,
   blood type, transfusion, e-prescriptions, autopsy requests, and the two
   fields below that have no repository).

   The six with no repository: `death_certificates`, `family_histories`,
   `soap_notes`, `user_settings`, `wearable_readings`, and
   `used_emergency_tokens`. The last is listed deliberately rather than excused:
   clearing that set on restart makes already-spent one-time emergency tokens
   replayable, so durability there is a security property, not just retention.

   `users` is explicitly *not* in the backlog — it is a read cache in front of
   the real `users` table with writes going through `AppState::persist_user()`.
   Losing it costs a query, not a record.
2. ~~Persist patient access requests and grants~~ — **implemented 2026-08-09,
   compile verification outstanding.** `PatientAccessRepository` with memory and
   Postgres implementations, migration `20260809000001_patient_access.sql`, the
   state machine extracted into `PatientAccessService`, and five Postgres
   restart tests covering grant, revoke, deny, replayed approval and expiry.
   Not yet type-checked — see “Proof still required”.
3. ~~**Unscoped bulk reads**~~ — **CLOSED 2026-08-20 by
   [ADR-0007](adr/0007-single-organisation-per-instance.md).**

   The framing below had the question backwards. Whether a deployment-wide read
   is a defect depends on how many organisations share one database, and
   [ADR-0006](adr/0006-federated-deployment.md) had already answered that: each
   hospital runs its own API, its own PostgreSQL and its own IPFS node. The
   federation boundary is the deployment, not a column — so these reads were
   never unscoped. Their scope is the instance, and a doctor is *supposed* to
   see every critical value in their own hospital.

   What was missing was enforcement of the boundary the reads depend on.
   `startup::validate_single_organisation` now refuses to boot against a
   database holding more than one active organisation, with a Postgres
   regression test, because a second organisation there would silently turn
   every one of these reads into a cross-organisation disclosure. The
   endpoint-auth gate reports the count as a recorded decision rather than an
   open risk — an "exposure risk" that is not one teaches reviewers to ignore
   the gate, and the next real finding goes with it.

   A hosted multi-tenant instance for small clinics would need the column-level
   work described below; that would supersede ADR-0007 rather than work around
   it. The original analysis is kept for that day:

   **Unscoped bulk reads (42 as of 2026-08-11) — cannot be closed as written.**
   Investigated 2026-08-11. The instruction "add organisation/tenant predicates"
   is not implementable against the current model, for two independent reasons:

   * **The authenticated caller carries no organisation.** `User`
     (`types/domain.rs:61`) has `role`, `department` and `specialty` but no
     organisation or facility. Neither does the `users` table. There is
     therefore no value to put on the right-hand side of a tenant predicate.
   * **The clinical tables carry no organisation column.** Checked against
     `pathology_reports`, `radiology_orders`, `progress_notes`,
     `incident_reports` and `critical_values`: zero organisation/tenant columns
     in any of them. There is nothing to filter on either.

   A federation identity model *does* exist —
   `20260727000001_federation_identity_foundation.sql` defines `organizations`,
   `facilities`, `professional_identities` and `organization_assignments` —
   but **no handler queries it**, and it is not joined to `users`. It is
   schema without a consumer.

   So closing this properly is an architectural change, not a per-handler fix:
   resolve the caller's organisation through `organization_assignments`, add an
   organisation column plus backfill to the ~40 clinical tables, then push the
   predicate into the repository queries.

   They are not one problem, and the per-user subset has now been fixed.

   * ~~**In-process filtered.**~~ — **4 CLOSED 2026-08-11.**
     `get_wearable_devices`, `get_wearable_readings`, `get_wearable_alerts` and
     `get_symptom_checker_history` called `list_all()` and then filtered on
     `current_user_id` in Rust. Each store keys `owner_id` on the patient and
     each read compared the same value, so `get_by_owner(caller)` is an exact
     equivalent with the boundary pushed into the query. **42 -> 38.**

     Two more look like this class but are **not** convertible, and converting
     them would be a regression: `get_my_family_groups` and the appointment
     guard filter on *membership*, while `owner_id` holds the group's
     `primary_account_id`. `get_by_owner` would silently drop every member who
     does not own their group. Closing those properly needs a membership query
     (Postgres JSONB containment) or a separate membership index.

   * **Deliberately deployment-wide (the remaining 38).** Concentrated in
     `/api/platform/list/*` (15) behind `require_registry_reader`, the role
     dashboards (5), and clinician worklists such as critical values, pending
     lab submissions and code blues. A doctor is *supposed* to see every
     critical value in the deployment. These are *correct* for a single-tenant
     deployment and wrong for a shared one. Which it is remains the decision
     that has to be made before any further code changes.

   Until that decision is recorded, treat MediChain as **single-tenant per
   deployment** — one organisation per API instance — because that is what the
   identity model actually enforces today. Running two hospitals against one
   instance would expose each one's registries to the other.
4. ~~Populate Medical-ID and emergency views from authoritative
   emergency-contact, condition and medication repositories.~~ — **CLOSED
   2026-08-11.** The Medical ID card read `chronic_conditions`, `medications`
   and `emergency_contacts` from hardcoded empty vectors, and printed the
   literals `"Patient"` and `"Redacted"` for name and date of birth. All five
   now come from the patient's encrypted profile — the same `emergency_info`
   the first-responder allergy merge already used. The response carries a new
   `profile_unavailable` flag so a client can distinguish "nothing recorded"
   from "the record could not be decrypted", which is exactly the distinction
   the old empty arrays destroyed. Covered by
   `medical_id_card_shows_conditions_medications_and_contacts`.
5. ~~Complete the corresponding FHIR Patient, Medication and Condition
   mappings.~~ — **CLOSED 2026-08-11.** `Patient` emitted a placeholder name, an
   invalid `birthDate` of `"Redacted"` (conformant clients reject the resource
   outright), empty `address`/`contact` arrays and a hardcoded `en` language;
   the `Condition` and `MedicationStatement` bundles were built from
   `Vec::new()` and so always reported `total: 0`. For an interoperability
   surface those empties are not gaps but assertions — that the patient has no
   next of kin, no chronic conditions and takes no medication. All now read the
   real record, absent elements are omitted rather than emptied per FHIR
   convention, and an undecryptable profile returns `OperationOutcome` instead
   of a confident empty bundle. Covered by
   `fhir_patient_carries_real_demographics_not_placeholders` and
   `fhir_condition_and_medication_bundles_are_not_silently_empty`.

   Cross-patient negative tests remain outstanding and move to the
   authorization backlog with the 41 unscoped bulk reads (item 3).

### P1 — policy consumption and external services

1. Make notification, privacy and research preferences authoritative in every
   email, SMS, push, research export and secondary-use path.
2. Replace or persist the process-memory federation/security compatibility
   stores: identity contexts, organisation keys, managed-device lifecycle,
   emergency grants, mobile-record sessions and telehealth-retention artifacts.
3. Qualify real SMTP/SMS/push, telehealth, speech-to-text and key-management/HSM
   integrations with safe failure behavior and auditable retry handling.
4. Deploy and qualify the required Substrate runtime calls on an independent
   multi-validator environment and prove finalized writes and outbox replay.
5. Publish reviewed Terms, Privacy/PAIA information and the data-subject contact
   path before enabling those links in production.

### P2 — completeness and experience

1. Replace the pathology slide-viewer placeholder with an approved DICOM/WSI
   integration and realistic access controls.
2. Reconcile every remaining generated frontend test with the real product
   contract, adding focused negative-path coverage where the generated fixture
   exposed a real defect.
3. Add direct component coverage for production pages that still rely only on
   route/type/static-contract validation, starting with the appointment
   scheduler.

## Proof still required

The workstation did not have sufficient free disk space for a fresh Rust build,
Clippy run or Postgres test run. This is not a formality: the patient-access
work landed on 2026-08-09 is `rustfmt`-clean (so it parses) but has **never been
type-checked** — `cargo check -p medichain-api --features postgres` exhausted the
disk partway through and its artifacts had to be deleted to recover space. Treat
that code as unverified until CI compiles it. No API, Postgres, Substrate node or browser dev
server was started during this audit. Consequently, the current code-level and
frontend-test evidence must be followed by the release gates in
[`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md) on the exact commit proposed
for launch.


## Frontend test reconciliation — method and findings (2026-08-11)

183 → 167 failures. The work is mechanical only where it can be proven safe,
and the boundary is the point of the exercise.

### Four systemic causes, found and fixed

1. **Mocks pointed at the wrong module.** Ten doctor-portal tests called
   `vi.mock('../store')` while their component imports `'../store/authStore'`.
   Vitest keys mocks by specifier, so the mock never applied — `user` was
   `undefined` and every page guarding `if (!user) return` never fetched.
2. **Mock responses had no `headers`.** The shared API client branches on
   `response.headers.get('content-type')`; 44 test files hand-rolled
   `{ ok, status, json }` with no headers, so that line threw inside an effect
   and the component fell into its error branch. Fixed by
   `scripts/fix-test-mock-headers.py` (70 additions).
3. **Fixture shapes no endpoint returns** — e.g. triage supplied
   `{ patientName, acuity, complaint }` where the page reads `assessment_id`,
   `esi_level`, `chief_complaint`, `performed_at`.
4. **Assertions that skip the interaction** — the triage patient list is a
   focus-gated dropdown and the queue tab lazy-loads, so asserting either
   without driving it can never pass.

### Copy drift, repaired under a deliberate constraint

`scripts/repair-test-copy-drift.py` substitutes a test's guessed wording for
the product's real string, but **only at >=60% word overlap with two or more
significant words on each side**. It refuses no-op replacements and candidates
holding i18n placeholders, and escapes regex metacharacters in the replacement.

The threshold is the safety property. A looser earlier rule matched
`'Capacity Assessment'` to the fragment `'Assessment *'` — a different string
sharing one word. Rewriting every failing assertion to whatever the component
currently renders would turn real defects into green checkmarks, which is worse
than a red suite. 18 repairs were accepted across both workspaces; 98 were
refused and left red.

### Two real defects the suite was correctly pointing at

* **Triage chief complaint had no accessible label.** A required `<textarea>`
  whose only name was an `<h2>` — a screen reader announced an unnamed text
  box, unlike every other field on that form. Fixed.
* **AMA discharge captures no capacity assessment.** `AMAPage.test.tsx`
  asserts a "Capacity Assessment" section and a "Patient has capacity to
  refuse" control. Neither exists: the string "capacity" appears **nowhere** in
  `AMAPage.tsx`, whose form collects patient identifiers, diagnosis,
  recommended treatment and a patient statement.

  This is not cosmetic. Decision-making capacity is the precondition that makes
  an against-medical-advice discharge lawful — a patient who lacks capacity
  cannot validly refuse treatment, and an AMA form signed without recording
  that assessment is the document a coroner or malpractice review asks for
  first. **Left red deliberately**: either the assessment is genuinely missing
  from the workflow, or it lives somewhere this page should link to. That is a
  clinical/legal decision for the owner, not a test fix.
* **Sepsis screening uses qSOFA, not SIRS.** `SepsisPage.test.tsx` asserted
  SIRS criteria; the page implements qSOFA. Sepsis-3 (2016) superseded SIRS
  with qSOFA for sepsis identification, so the *product* is on the current
  standard and the test reflected the older definition. Repaired toward the
  product.
* **IV site assessment uses the VIP phlebitis score, not infiltration
  staging.** `IVSitePage.test.tsx` asserts "Infiltration"; the page scores
  Visual Infusion Phlebitis. These are different complications with different
  scales — infiltration (fluid into surrounding tissue) is not phlebitis (vein
  inflammation), and a site can have either. **Left red deliberately**: either
  infiltration staging is genuinely missing, or the test should assert the VIP
  scale. That is a clinical call, not a wording fix.
* **Burn assessment uses Rule of 9s, not a Lund-Browder chart.**
  `BurnPage.tsx` implements Rule of 9s with paediatric percentages
  (`childPercentage`); `BurnPage.test.tsx` expects a Lund-Browder chart and
  explicit TBSA labelling, which exist nowhere in the product. These are not
  synonyms: Lund-Browder is the age-banded, more accurate instrument and is the
  standard for paediatric burns, and TBSA drives Parkland-formula fluid
  resuscitation. **This is a clinical scope decision for the owner** — either
  the instrument is adequate and the test should be rewritten, or the chart is
  required and the feature is missing. It was deliberately NOT auto-repaired.

### What remains

167 failures needing per-test judgement. The refusal list from
`repair-test-copy-drift.py` is the work queue: each entry is either a fixture
that must supply real data, an interaction the test never performs, or — as
with the burn chart — a feature that genuinely is not there.

## Live browser E2E follow-up (2026-08-14)

The local Docker deployment was exercised through the rendered doctor portal
with synthetic records. Patient registration, appointment lifecycle, SOAP,
triage, toxicology, imaging, e-prescribing, family history, and physician
orders were created and checked after reload.

Defects found and addressed included missing patient phone compatibility,
appointment provider derivation, numeric e-prescription fields, family-history
payload shape, physician-order request mapping, and all-patient order listing
and display normalization. Doctor access to administrator-only Analytics now
shows a clear permission message instead of a raw 403 error.

The final route sweep found only expected administrator restrictions for the
Doctor account on `/admin`, `/user-management`, and `/analytics`. Focused tests
for the affected pages passed after the fixes.

Administrator-role limitation: the live browser could not complete an Admin
session because the static/demo admin wallet is not enrolled in the current
credential-login flow. Injecting that wallet into the browser session was
correctly rejected by the API with `403` on `/api/dashboard/admin`; this was
not treated as a successful admin test. A supported admin credential or wallet
signature is required to verify Admin Dashboard, User Management, and the
administrator Analytics view end to end.

Telehealth creation returned success and the session reappeared when searched
by patient after reload. The API response does not currently include the
requested duration field, so the UI uses its documented 30-minute default when
the field is absent; custom-duration persistence remains a backend schema gap.

Messaging initially failed with `400 MISSING_FIELD` because the UI sent `body`
while the endpoint requires `content`. The field mapping was corrected; the
browser then received `201`, displayed “Message sent!”, and showed the message
again after reload (`MSG-b923f940`).

Psychiatric assessment testing found a larger contract mismatch. The page was
posting a UI-oriented assessment (`id`, `patientId`, flattened history and
risks), while the API requires `assessment_id`, `patient_id`, and nested
structured mental-status, risk, psychiatric-history, psychosocial, legal, and
safety fields. It previously swallowed the `400` and displayed a false success;
that behavior is fixed so failed saves now remain visible as failures. The
field-by-field mapping was completed; the browser then received `201` and a
new browser session retrieved the saved record with `200` from the read
endpoint (`PSYCH-1786721309919`). The page's History tab still does not fetch
saved assessments on reload, so that presentation/listing gap remains.
