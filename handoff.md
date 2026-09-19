# MediChain open-work register

**Updated:** 2026-09-19

This is the active register for the broad "implement every unfinished feature"
work.  It does not turn historical audit claims into present facts: each entry
below was re-checked against the current source before being recorded.

## Corrected on review, 2026-09-19

The 2026-09-18 worktree compiled and its focused tests passed, but five static
gates failed, three patient-app tests failed, and a review of the diff found
defects no gate measures. Each is fixed and covered by a test:

| Defect | Fix |
| --- | --- |
| `POST /api/national-id/verify` was unauthenticated (allowlisted as "stores nothing") yet now wrote to the admin identity-review queue | Requires registration staff (`require_clinical_staff`); removed from the public allowlist in `check-endpoint-auth.py`; anonymous-caller test |
| Consent page mapped access grants/requests as snake_case; the server sends camelCase (`rename_all = "camelCase"`), so every grant rendered blank | Shared types now camelCase and used directly; the page test fixture now carries the server's shape, including a pending request |
| Note templates defined twice; the render copy had drifted (`\\n`) and rendered literal backslash-n; renderer was recursive (NASA rule 1) | One `builtin_note_templates()` table; flat, single-pass placeholder substitution that never re-substitutes an entered value |
| H&P addendum allowed any role that can *read* records; read-append-write lost concurrent addenda; draft edit restamped the author and could turn a record signed in between back into a draft | `can_edit_medical_records` for addenda; author-only drafts that keep their author; `HistoryPhysicalRepository::update_if_unchanged` (compare-and-set on `updated_at`, both backends, PostgreSQL test); bounded retry for addenda |
| Progress notes filed "Full code", hospital day 1 and problem status "stable" on every note (pre-existing, newly visible to the gate) | `CreateProgressNoteRequest` (rule 11) with those fields optional; the page sends only what it collected |
| Progress-note *draft* schema refused any draft with an empty section (pre-existing: `partial()` still rejects `''`) | Draft schema asks only for the patient and bounds lengths |
| Patient search matched identifiers with `ILIKE '%q%'`, including the national-ID *digest* and wallet, so "Ed" or "Abebe" returned unrelated patients in the picker; memory and PostgreSQL matched differently (pre-existing, newly reachable from the picker) | `repositories::patient_search::PatientSearchCriteria`: exact identifier match (national ID via its keyed hash) or all name tokens, one definition for both backends |
| Patients registered before the blind index could not be found by name | `patient_name_index::backfill_missing_name_index`, run once at startup: bounded, idempotent, does not touch `updated_at`, logs counts only (ADR-0009 amended) |
| Name-search and national-ID hash tests mutated process-global key env vars — a race with every concurrent search/registration test | Pure `*_with_key` cores; no test writes those variables |
| Gates: `retract_symptom` missing from the audit vocabulary (PostgreSQL rejects the audit row after the retraction commits); 3 missing i18n keys; an over-length download handler; FHIR ingest role undecided | Migration `20260919000001`; keys added; structured-document dispatch extracted; FHIR ingest accepted with registration's roles (owner decision 2026-09-19) |

## Implemented or source-verified in the current worktree

| Area | Status | Evidence |
| --- | --- | --- |
| Patient name search | implemented, verified | Blind-index migration, exact-identifier/name-token matching shared by both backends, and a startup backfill for pre-index rows. Unit tests cover identifier fragments, whole identifiers, names, inactive rows, backfill, roster order and undecryptable rows. Not yet exercised against a live server's picker. |
| FHIR Patient transaction ingest | implemented, source-verified | `POST /api/fhir/r4/Bundle` accepts the declared bounded Patient transaction. |
| Clinical document access in My Records | implemented, source-verified | Structured-document downloads enforce patient-scoped authorization before rendering. |
| Incomplete language choices | implemented, source-verified | Only the fully translated locale is active; incomplete locales are not offered as complete interfaces. |
| Fabricated patient fallbacks | implemented, source-verified | The affected patient pages use empty/error states rather than clinical sample values. |
| Standalone GCS, lab result entry, consent withdrawal, MFA enrolment, guardianship and appointment check-in | implemented, source-verified | The corresponding pages import and call their shared-client APIs. |
| Laceration repair filing | implemented, source-verified | The doctor portal sends `POST /api/clinical/laceration`, refreshes through the list endpoint, and the server validates required measurements. |
| Insurance-card image persistence | implemented, source-verified | Front and back images now persist encrypted content plus metadata hashes separately and have an owner/provider-authorised decrypt/read path. |
| Offline-cache accuracy and category clearing | implemented, verified | IndexedDB failures now render an explicit unknown state rather than sample clinical records; category clearing deletes the persisted matching entries. Patient offline-sync UI test passes. |
| Telehealth recording control | implemented, verified | Only the assigned provider may start or stop their session recording; unsupported actions are rejected. Seven focused authorization/action tests pass. |
| Physician-order in-progress metric | implemented, verified | The UI now counts its normalized `active` state rather than the pre-normalized API value; the realistic shared-client fixture and focused page test pass. |
| Guardianship history | implemented, verified | The patient family page now separately shows caller-scoped current, expired, and revoked guardianships without presenting ended authority as usable record access. Focused page tests pass (6/6) and the patient typecheck passes. |
| Nursing care-plan templates and persisted-list contract | implemented, verified | Selecting a template now opens an editable draft with real goal/intervention entries; submitted plans persist those structured entries instead of empty arrays. The list now maps the server’s snake-case repository records and nested JSON items without fabricating demographics. Focused page tests pass (5/5). |
| History and physical templates | implemented, verified | Selecting a template opens the editable H&P form with the matching examination type selected and its patient-information section available. The focused page test passes (4/4). |
| History and physical amendment workflow | implemented, verified | The API supports author-only draft update and appends attributable amendments to signed H&Ps without rewriting their signed document body; both writes are compare-and-set. Handler tests cover author ownership, signed immutability, the read-only-role refusal and successive addenda; a PostgreSQL test covers the stale-copy refusal. |
| Intake/output trend actions | implemented, verified | The visible trend controls now export the displayed table as escaped CSV and invoke browser printing, with accessible labels. The focused page test passes (4/4). |
| Note templates | implemented, verified 2026-09-19 | Facility-wide clinician templates (owner decision): doctors and nurses create them, every clinician sees and uses them, the author or an administrator deactivates one (a conditional write; the row is kept, ADR-0005). Built-ins are read-only, served as an ordered table (the built-in SOAP had been served Assessment, Objective, Plan, Subjective). `rendered_sections` preserves order. The page saves on the server and reports success only after it confirms. Also fixed: the page was in the admin navigation only, which the router enforces, while the API served only doctors and nurses — nobody could use it; its buttons failed WCAG contrast (3.68:1) once it could render cards. Driven in the browser: create, reload, survive an API restart, use, deactivate. |
| Lab-result visible actions | implemented, verified | The selected result can now be printed or exported as escaped CSV containing the displayed tests and values. Focused page tests pass (3/3). |

## Still missing — implementation requires a product/security decision

| Area | Current evidence | What must be decided before implementation |
| --- | --- | --- |
| Per-record crypto-shredding | `encryption_keyring` remains deployment-key encryption; `key_envelopes`/`organization_keys` are metadata foundations only. There is no KMS/HSM or private-key unwrap boundary. | Select and provision the KMS/HSM/key-custody model, recipient-envelope algorithm, legacy-record migration, key-destruction authorization and audit/restore procedure. A server-held substitute would not provide the promised patient-level irrecoverability. |
| WebAuthn/passkey biometric login | The patient setting is visibly disabled and there is no WebAuthn credential-registration/assertion protocol or durable credential store. | Approve the credential model, relying-party ID/origins, attestation policy, recovery/step-up rules and storage schema. This needs a vetted WebAuthn dependency or a reviewed protocol implementation. |
| Research/secondary-use preference enforcement | The preference is persisted in `/api/settings`; no research-export path currently exists to consult it. | Define the permitted export/secondary-use workflow, legal basis, de-identification standard, reviewer authorization and audit retention. Do not add an unscoped export endpoint just to consume a toggle. |
| Blood-unit inventory | The clinical registry explicitly reports that inventory tracking is not implemented; existing blood-bank records are type/screen and transfusion documentation, not stock control. | Define inventory ownership, unit/barcode provenance, reservation, compatibility, expiry, recall and reconciliation workflow before adding a clinical inventory ledger. |
| Insurance-card versus payer-policy verification | Patient-entered cards use the JSON card store; provider verification reads the separate payer-policy repository. The patient UI no longer marks a card verified after a failed request. | Choose one authoritative insurance model or a controlled link between card and payer-policy records, then make verification update that model with payer evidence and audit history. |
| Telehealth recording retention | The retention component is implemented but no recording artifact pipeline registers a sensitive artifact. | Approve recording custody, participant consent, E2EE/provider configuration, BAA/DPA, upload/storage, legal-hold and deletion verification before wiring a recorder. |
| Order sets: create, duplicate, delete | `OrderSetsPage` has the defect note templates had: all three change only the browser's list and announce success; the API has only `GET /api/order-sets`. The page is also admin-navigation only. | An order set bundles medication and investigation orders, so a shared one with a wrong dose reaches every patient it is applied to. Decide who may author and who must approve a shared set (e.g. pharmacist sign-off), whether sets are versioned, and whether retiring one affects orders already placed from it. |
| MFA step-up retry UX | MFA enrolment is wired, but clients do not handle an `MFA_REQUIRED` response by collecting a challenge code and safely retrying the original privileged operation. | Define the shared retry/intent-binding UX and which privileged mutations use it; demo mode cannot qualify this flow. |

## Externally blocked or owner-operated work

| Area | Blocker | Required evidence to close |
| --- | --- | --- |
| South Africa/Nigeria live national-ID verification | DHA/NIMC provider contract and sandbox/production credentials are not present. | Authorised provider integration exercise: success, denial, timeout, malformed response and credential failure; production must remain fail-closed. |
| Real transcription/translation of patient material | No approved BAA/DPA and no server-side recording artifact suitable for a transcription provider. | Approved provider agreement, consent proof, secure artifact pipeline, and integration failure/reconciliation tests. |
| Blockchain operational claims | No multi-validator testnet, consortium governance, validator hosts, session-key procedure or recovery rehearsal. | Governed testnet, finality/partition/upgrade/recovery drills and operational ownership. |
| Legal Terms, Privacy/PAIA and data-subject contact path | Legal content is not supplied by engineering. | Reviewed, approved legal copy and a maintained support/contact process. |

## Verified against a live server, 2026-09-19

All against a locally built API (commit `588bc50`) on PostgreSQL, not the
Docker image:

| Suite | Result |
| --- | --- |
| Live probes of every changed endpoint, with the pages' payloads | 22/22 |
| Doctor-portal browser suite (`playwright.local-api.config.ts`) | 78/78 |
| Patient-app browser suite (`playwright.local-api.config.ts`) | 73/74 — see below |
| Role journeys (`scripts/role-journeys.ts`) | 266/266, 2 legitimate skips |
| Cross-role qualification | 117/117 |
| Synthetic e2e on a freshly created database | 261/0 |

The startup name-index backfill ran against the dev database: 152 patients
indexed, 69 undecryptable (rows sealed under a key this deployment no longer
holds — they are equally absent from the roster).

**Open: an intermittent WCAG 2.4.11 failure.** `accessibility.spec.ts` "a
focused control is never hidden behind the sticky header" (mobile) failed once
in the full run and once in twelve isolated repeats: the dashboard's
notification and sign-out buttons end up under the shared layout's sticky nav.
`index.css` already sets `scroll-margin-top: 4.5rem` on every focusable
element, so the likeliest cause is a layout shift after focus has scrolled
(content loading above the header). Predates the 2026-09-18/19 changes.

## Verification still required

- The browser suites above ran against the local debug build; rebuild the
  Docker images (`api` and `nginx`) before trusting the stack on :80.
- Re-run the Substrate pallet test suite on a host able to build the required
  Polkadot SDK workspace.
- Qualify all configured external adapters with real authorised credentials;
  disabled-by-default code is not production proof.
