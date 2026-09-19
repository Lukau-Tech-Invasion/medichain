# What is not fully implemented — a whole-codebase audit

**Date:** 2026-09-17
**Method:** static sweep of `api/src`, `client/*/src`, `blockchain/pallets`,
`api/migrations` and the CI gates, cross-checked against a live
PostgreSQL-backed server where a claim could be probed. Every count below was
produced by running something, not by reading a previous audit.

This is deliberately *not* a list of bugs. It is the list of things a reader
would reasonably assume work and which are absent, partial, or reachable only
under configuration nobody has set. Items already tracked elsewhere are
cross-referenced rather than restated.

## Continuation status — 2026-09-18

This document remains the point-in-time audit from 2026-09-17. The entries
below prevent it from being used as a current implementation register where
later source changes have closed or narrowed a finding:

| Original finding | Current status | Source of truth |
| --- | --- | --- |
| §1, six advertised locales | Resolved safely: `ACTIVE_LOCALES` exposes only `en-US` until qualified clinical translations are available. | `client/shared/src/i18n/react.tsx` |
| §2, no server-side patient search | Resolved: `GET /api/patients?q=` uses bounded keyset pagination and keyed name-token blind indexes; it does not decrypt an unbounded roster to search it. | `api/src/handlers/patient_admin.rs`, `api/src/repositories/postgres/patient.rs` |
| §3, FHIR is read-only | Partially resolved: `POST /api/fhir/r4/Bundle` accepts one validated Patient transaction entry. Multi-entry transactions and the other resource types remain intentionally rejected and are still open scope. | `api/src/clinical_endpoints/fhir/ingest.rs`, CapabilityStatement metadata |
| §6, national-ID verifier stubs | Resolved to the stated safe fallback: an unavailable authority returns `verified: false` with `manual_review_required`; it never produces synthetic verification data. Live-provider credentials and facility review operations remain deployment work. | `api/src/national_id.rs` |
| §9, unsupported transcription providers silently fall back | Partially resolved: `aws`, `azure`, invalid providers, and an unconfigured Google key all log an explicit warning before transcription is disabled. Recording upload, consent, and BAA-backed transcription remain open scope. | `api/src/services/transcription.rs` |

All other entries below remain open unless a newer evidence-backed register
states otherwise. `handoff.md` is the active implementation register for this
continuation.

Severity is about **clinical and regulatory consequence**, not effort:

| | |
| --- | --- |
| **S1** | A clinician or patient can be misled, or a legal obligation cannot be met |
| **S2** | A capability the product presents as existing does not function |
| **S3** | Works today, will not survive real scale or a second deployment |
| **S4** | Internal quality: duplication, dead surface, coverage |

---

## 1. Internationalisation — five of six languages are 1% translated  · S1

`client/shared/src/i18n/react.tsx` advertises six locales and the language
selector offers all six:

```ts
export const ACTIVE_LOCALES = ['en-US', 'fr-FR', 'sw-KE', 'am-ET', 'zu-ZA', 'ha-NG'];
```

Measured leaf strings per bundle:

```
en-US    7193
am-ET      71   (1.0%)
fr-FR      71   (1.0%)
ha-NG      71   (1.0%)
sw-KE      71   (1.0%)
zu-ZA      71   (1.0%)
```

Each non-English bundle is a "starter set" — `common.save`, `common.cancel`,
an emergency number — and `I18nProvider` deep-merges the rest from English. A
patient who selects Kiswahili gets a Kiswahili **Save** button on an otherwise
English medication list.

For this product specifically, that is an S1 and not a polish item. The system
exists to serve African healthcare; `/api/platform/translate` was built because
language is treated as a clinical-safety concern; and `LanguagePreference`
records `needs_interpreter` precisely because comprehension affects outcomes.
Offering a language the interface does not speak is worse than offering only
English, because the patient stops expecting to need help.

**Done means:** either the five bundles are translated (by qualified medical
translators — machine translation of dose instructions is explicitly refused
elsewhere in this codebase for good reason), or `ACTIVE_LOCALES` is cut to what
is genuinely translated and the rest are marked "in progress" where a user can
see it.

---

## 2. There is no search — anywhere in the API  · S1/S3

`grep '#\[get("/api/[^"]*search'` over `api/src` returns nothing. There is no
patient search, no record search, no full-text anything.

`GET /api/patients` is what the roster uses, and it:

```rust
.list(crate::repositories::Pagination::new(0, 1000))
```

fetches up to **1000 patients**, decrypts every profile blob, and returns them.
Every screen that "searches" does so client-side over that array — `Patients`,
`IntakeOutput`, `Pathology`, `ChainOfCustody` and others all filter a fetched
list in the browser.

Three consequences, in order of severity:

* **Patient 1001 is invisible.** Not slow to find — absent. In a national
  health-ID system the roster is the whole population of a facility.
* Every roster load decrypts up to 1000 profiles server-side.
* A paramedic cannot find a patient by name at all unless that patient happens
  to be in the first 1000 rows.

**Done means:** a server-side `GET /api/patients?q=` with indexed lookup.
Note the hard part is that names are encrypted at rest (`first_name_encrypted`,
`last_name_encrypted`), so this needs a searchable-encryption decision —
a blind index or deterministic HMAC over a normalised name, with the tradeoffs
written down. This is the one item on this list that needs a design document
before code.

---

## 3. FHIR is read-only — no ingest  · S2

Nine resources plus `metadata`, all `#[get]`:

```
Patient/{id}  AllergyIntolerance  MedicationStatement  Condition
Observation   Encounter           DiagnosticReport     Procedure
Immunization  metadata
```

There is no `POST`/`PUT` for any resource, no `Bundle` transaction endpoint, no
`$everything`, and no subscription. MediChain can publish to a FHIR consumer
and cannot accept a referral, a lab feed, or a record transfer from another
system.

For a product whose case is national interoperability, one-way export is half
the feature. It is also the half that does not let a hospital migrate *in*.

**Done means:** at minimum `POST /api/fhir/r4/Bundle` (transaction) for the
resources already modelled, with the same request-type discipline Rule 11
requires, plus documented conformance in the `metadata` statement.

---

## 4. Eleven of fifteen on-chain calls have no application caller  · S2

The three pallets expose 15 extrinsics. The API submits four:

```
PatientIdentity::register_patient
MedicalRecords::upsert_ipfs_hash
AccessControl::log_access
AccessControl::log_delegated_access
MedicalRecords::set_emergency_capsule_commitment
```

Nothing in the application ever calls:

| Pallet | Extrinsic | What is therefore not on-chain |
| --- | --- | --- |
| access-control | `assign_role`, `revoke_role` | Role changes. The chain's role table can only be seeded at genesis |
| access-control | `grant_emergency_access`, `revoke_access` | Break-glass grants — the whole consent model |
| access-control | `cleanup_expired_access` | Expired grants are never reaped on-chain |
| medical-records | `create_health_record`, `add_alert` | Record creation and clinical alerts |
| patient-identity | `verify_identity` | Identity verification status |
| patient-identity | `set_preferred_language`, `set_photo_id` | Patient identity attributes |

The pallets are real and tested (60 tests). The gap is that the product's
central claim — "patients control who accesses their records via
blockchain-verified consent" — is implemented in PostgreSQL, and the chain
carries an audit log and two commitments. That is a defensible architecture,
but it is not the architecture the pitch describes, and the unused extrinsics
are what makes the difference invisible.

**Done means:** either wire consent and role changes to the chain, or state
plainly in `CLAUDE.md` and the public material that the chain is an audit and
commitment anchor and that consent is enforced off-chain. The second is far
cheaper and probably right; what is not acceptable is leaving both readings
available.

See also `IMPLEMENTATION_PLAN.md` lines 130–138: no multi-validator testnet,
no chaos test, no runtime-upgrade rehearsal, no session-key procedure, no
validator monitoring, no backup/restore drill. All owner-gated.

---

## 5. Per-record crypto-shredding is not implemented  · S1 (regulatory)

`api/src/encryption_keyring.rs` is explicit:

> true per-record crypto-shredding needs envelope encryption (a per-record data
> key, wrapped for each recipient), which is **not implemented**

`retire(version)` destroys a key version, and a version is shared by every
record encrypted while it was current. So the only cryptographic erasure
available is all-or-nothing for a time window.

POPIA s24 and GDPR Art. 17 give a data subject a right to erasure of *their*
data. Today that can be honoured by deleting rows, but not by making the
ciphertext unrecoverable — and ADR-0005 defers irreversible deletion, so in
practice neither mechanism is available end to end.

**Done means:** envelope encryption — a per-record data key wrapped under the
organisation key (the `organization_keys` directory now persists, which is the
prerequisite that was missing until yesterday), so destroying one wrapped key
shreds one record.

---

## 6. National ID verification is a stub for three of five countries · S2

`api/src/national_id.rs` carries a `StubVerifier` that "deterministically
verifies" any non-empty ID with SHA3-256 and stamps
`VerificationMethod::Stub`. Real verifiers exist behind `FAYDA_API_KEY`
(Ethiopia) and `GHANA_CARD_API_KEY` (Ghana). Nigeria (NIN), South Africa
(SmartID) and the generic path have no real verifier configured.

The code is honest — it records which path produced a result, and
`NATIONAL_ID_VERIFICATION_MODE` plus a startup guard stop a production process
running on the stub silently. But a deployment in Nigeria or South Africa
cannot verify an identity today, which is the first step of registration.

**Done means:** verifiers for NIMC and DHA, or an explicit per-country
"unverified, manual review required" workflow instead of a stub result.

---

## 7. Two API client layers, and the pages use the wrong one  · S4 (with S2 consequences)

`client/shared/src/api/endpoints.ts` is a 408-function typed client.
**191 of those functions (47%) have no caller anywhere outside the file.**
Meanwhile **54 of 108 pages** call `getApiClient().get('/api/...')` with a raw
URL string and hand-rolled session headers.

Spot-checked: `ProgressNotePage` does not call `createProgressNote`; it builds
the request itself. `MyRecords`, `Notifications`, `Orders` likewise.

This is not cosmetic. It is the direct cause of two defect classes already in
the register:

* 83 wrappers typed `data: unknown` — so when nine clinical pages sent payloads
  no handler could deserialise, TypeScript could not see it
  (`check-payload-contracts.py` exists because of this).
* Route drift — ~45 endpoint paths once pointed at routes that did not exist,
  because the URL lived in a string in a page rather than in one typed place.

**Done means:** one way to reach the API. Either pages adopt the wrappers (and
the `unknown` ones get real request types), or the unused wrappers are removed
and the raw-client pattern is made the documented one with a typed URL table.
Half-and-half is the worst of the three.

---

## 8. Four patient screens invent data when the API returns nothing · S1

Gated on `IS_DEMO`, which is `true` in every current deployment profile:

| Screen | Fallback |
| --- | --- |
| `VitalsPage` | Two hardcoded readings — HR 72, BP 120/80, SpO₂ 98, temp 36.6 |
| `WearablesPage` | `WearablesPage.demoData.tsx` — devices, metrics, activity rings |
| `InsurancePage` | `InsurancePage.demoData` — cards and claims |
| `LabTrendsPage` | `LabTrendsPage.demoData` — trend series |

`VitalsPage` sets `apiConnected=false` when it does this, which is the right
instinct, but the reading still renders as the patient's vital signs. A patient
looking at their own record cannot tell a demo reading from a measurement, and
"SpO₂ 98%" is a clinical statement.

**Done means:** an empty state that says the record is empty. A demo deployment
that needs populated screens should seed the database, not the component — the
seeding script already exists (`scripts/seed-browser-test-fixtures.ts`).

---

## 9. Speech-to-text: `aws` and `azure` are named but not built · S3

`transcriber_from_env` documents it plainly: "Only `none` (default) and
`google` are wired in-tree; `aws`/`azure` still require their own SDK +
credentials." Setting `TRANSCRIPTION_PROVIDER=aws` silently falls back to the
no-op — the same shape that `TRANSLATION_PROVIDER` deliberately rejects (an
unrecognised value there disables translation and warns).

Also: the only caller passes `recording_ref: None`, because recordings are
captured client-side and never uploaded, so **even the Google path cannot
produce a transcript today**. The client is real and tested; the pipeline that
would feed it does not exist.

**Done means:** either a recording-upload path (with the E2EE and consent
decisions that implies), or `aws`/`azure` warn like the translation provider
does instead of falling back silently.

---

## 10. Telehealth retention is complete and uncalled · S4

`api/src/telehealth_retention.rs` — 221 lines, tested, with `register`,
`apply_legal_hold`, `due_for_deletion` and `mark_deleted`. Nothing in the
binary calls any of them. No artifact is ever registered, no legal hold can be
applied, no retention sweep runs.

Possibly superseded: a transcript produced by `append_transcript_on_stop` is
appended to the session's `visit_notes` and lives under that record's retention
regime. Recorded in `TECHNICAL_DEBT_REGISTER.md` (2026-09-17); removal needs
authorisation under Rule 7.

---

## 11. Twenty-three typed tables with a real schema and zero rows · S3

`20260912000001_mark_superseded_tables.sql` comments all 23. Each has a typed
repository and no caller; the handlers write to `JsonRecordRepository` instead.
The hazard is stated in the migration itself: anyone reading this database will
find `transfusion_records`, see a sensible schema, and be wrong.

The JSON stores enforce no CHECK constraint, which this codebase has repeatedly
shipped defects that PostgreSQL would have caught. Direction is an owner
decision — migrate the handlers onto the typed repositories, or delete the
typed side.

One more joined the list yesterday: `e_prescription_records` lost its last
caller when the surgical e-prescription pair was deleted in `c76ab1c`.

---

## 12. Notification preferences are not consulted everywhere · S2

Closed for **push** (`notify_patient` → `patient_wants`) and for **SMS** (the
global opt-out inside `send_sms_with_retry`, plus the medication reminder's own
opt-in).

Not closed for **research export and secondary use** — there is no path that
consults a patient's research-participation preference before including their
data in an export. `FEATURE_END_TO_END_AUDIT.md` P1.1.

---

## 13. Owner-gated, and honestly out of reach from here · —

Not defects; listed so the list is complete.

* **Multi-validator Substrate testnet** and everything downstream of it
  (`IMPLEMENTATION_PLAN.md` 130–138) — needs validator hosts and a consortium
  governance decision.
* **Live Africa's Talking credentials** — `AT_USERNAME` / `AT_API_KEY`. The
  request shape is covered by a wiremock test; only "does AT's production API
  accept it" is unverified.
* **Reviewed Terms, Privacy/PAIA information and the data-subject contact
  path** — legal content. The links exist in the UI.
* **A BAA with Google** before any real patient audio reaches Cloud Speech, and
  the equivalent before patient text reaches Cloud Translation.

---

## 14. Verification coverage that is missing, not failing · S4

* **The 60 pallet tests have not been re-run since 2026-09-15.**
  `blockchain/target` was deleted to recover disk and this host cannot build
  polkadot-sdk in the space available. `git diff` confirms that workspace is
  unchanged, so the result is *expected* to hold — but expected is not run.
* **The doctor-portal browser suite has not completed a clean pass.** The
  2026-09-17 run reached 56 of 78 before the host ran out of disk (173 MB free);
  three tests failed with 4-minute timeouts against a 90-second budget, which
  is the signature of a starved machine rather than a product defect. It needs
  re-running on a healthy machine before anything is concluded:
  `emergency-capsule.spec.ts:30`, `emergency-capsule.spec.ts:66`,
  `guardianship.spec.ts:42`.
* **One browser test is permanently skipped**: `journeys.spec.ts:167`
  (`'the scheduling form did not open on this build'`) — a skip that hides
  whatever it was meant to catch.
* **21 `#[allow(dead_code)]`** remain, each accounted for in the 2026-09-16
  sweep (test-used, external wire shapes, a documented provider seam, and the
  `error_codes` module whose constants are unused while their values appear as
  literals 100+ times).

---

## What this audit did not find

Worth saying, because the absence is evidence too:

* No `todo!()`, `unimplemented!()`, or `NOT_IMPLEMENTED` response anywhere in
  `api/src`.
* No unrouted page in either client.
* No handler returning a hardcoded clinical value — `get_quality_metrics` was
  the last one and now returns `null` with a stated basis rather than
  `compliance_score: 98.5`.
* No button or toggle without a handler — the last of those was the wearables
  settings tab, closed 2026-09-16.
* Analytics and dashboards compute from repositories, not from literals.

---

## Where the library covers these decisions, and where it does not

The owner's engineering library
(`C:\Users\Admin\Downloads\Books-master\Books-master`) is the standard for
design decisions in this repository — see the "second brain" section of
`CLAUDE.md`. Searched while writing this audit, so the next person does not
repeat the lookup:

| Finding | Library coverage |
| --- | --- |
| §2 search, indexing strategy | *Designing Data-Intensive Applications* (clustered vs non-clustered indexes); *Introduction to Information Retrieval* in `free-library/10-ai-ml-llm/` for the retrieval side |
| §3 FHIR ingest, integration contracts | *Patterns of Enterprise Application Architecture* (Fowler); *The Pragmatic Programmer* |
| §7 two API client layers | *Refactoring* — this is textbook duplication with a named cure |
| §11 typed tables vs JSON blobs | *Designing Data-Intensive Applications* on schema-on-read vs schema-on-write |

**Named gaps — the library does not cover these, so go to primary sources:**

* **Searchable encryption / blind indexes** (§2). Nothing in the corpus. The
  authoritative material is the CryptDB and Song–Wagner–Perrig literature plus
  current guidance on deterministic-encryption leakage; this needs a written
  design decision, not a recalled pattern.
* **Envelope encryption and key wrapping** (§5). Searching returns only
  incidental ML hits. Go to the AWS KMS and Google Cloud KMS envelope-encryption
  documentation, and to the NIST SP 800-57 key-management guidance.
* **FHIR R4 itself** (§3). Not in the library; HL7's specification is the source.
* **Substrate / polkadot-sdk validator operation** (§4). Not in the library;
  the Polkadot wiki and `docs/BLOCKCHAIN_NODE.md` are the sources.
