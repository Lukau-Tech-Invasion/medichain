# MediChain production-readiness remediation

**Last reconciled:** 2026-08-09
**Launch verdict:** **BLOCKED pending verification and H3 completion**

This document tracks GitHub issues #2–#10. “Implemented” means the unsafe code
path was replaced and regression coverage was added. It does not mean the issue
may be closed: closure also requires the relevant CI and production-like gates
below to pass on the exact release commit.

## Issue status

| Issue | Remediation in this checkout | Status before launch |
|---|---|---|
| #2 / C1 — emergency-protocol records were memory-only | Code Blue, trauma, stroke, cardiac and sepsis use the repository layer; Postgres restart tests cover all five protocols. | Implemented; Rust/Postgres CI proof pending. |
| #3 / C2 — emergency Medical ID leaked PHI for any non-empty token/hash | The PHI endpoint accepts only a short-lived, patient-bound, responder-bound, device-bound, scoped, one-time Bearer token. The NFC hash is exchanged at an authenticated endpoint and is no longer accepted as a PHI credential or query parameter. A durable access record is required before PHI is returned. | Implemented; Rust and production-like negative-path proof pending. |
| #4 / C3 — lockscreen Medical ID served PHI without identity enforcement | A linked patient issues a short-lived capability for one active owned device. The PHI endpoint verifies the Bearer capability and `X-Device-Id`, re-checks live device ownership/revocation, and records access before returning data. | Implemented; Rust and production-like negative-path proof pending. |
| #5 / C4 — patient consent endpoint returned hardcoded demo rows | The endpoint reads `ConsentRecordRepository` and fails closed on repository errors. Coverage includes zero, one and multiple stored consents. | Implemented; Rust/Postgres CI proof pending. |
| #6 / C5 — placeholder blockchain consent/audit, Alice key and wrong routing | Fabricated transaction hashes are removed. Production requires a configured operator key and finalized extrinsic success; Alice is demo-only. Failed writes are durably queued. Consent, registration, medical-record, capsule and access operations share the retry worker. Access audits use `log_delegated_access`, carry a keyed accessor commitment, and never masquerade as an emergency grant. Medical-record/capsule calls now upsert a safe on-chain record shell on first use. | Code implemented. **Still release-blocking** until the external Substrate runtime containing the new calls is deployed and the qualification script plus end-to-end finalized-write tests pass. |
| #7 / H1 — user/profile/RBAC mutations were memory-only | Users and professional profiles load from and write through to Postgres. Role assignment/revocation, status/profile changes, patient account creation and identity linking persist before the cache changes. Inactive users are excluded. Production rejects the memory backend. Restart tests cover role/status/profile durability. | Implemented; Rust/Postgres CI proof pending. |
| #8 / H2 — MFA step-up bypass through `X-User-Id` | Privileged operations use one assurance policy: production requires durable MFA enrollment and a fresh MFA JWT. A header-only identity, stale/expired/malformed token, unenrolled account and role mismatch are denied. The policy and HTTP bypass cases have regression coverage. | Implemented; Rust CI proof pending. |
| #9 / H3 — no real automated test gate | Clippy is blocking, the Rust job has Postgres 16, and `cargo test` is blocking. Frontend installs use the lockfile. | **Closed 2026-08-11.** Backend: 361 API + 79 pallet/crypto tests pass, clippy `-D warnings` clean, state-durability gate reads 0. Frontend: doctor-portal **256/256**, patient-app **78/78** — every suite green, so the whole frontend suite is now the gate rather than a 32-file subset. Typecheck, lint and build clean in both workspaces. See the H3 note below for what the failures were and the nine product defects they surfaced. |
| #10 / H4 — demo mode issued JWTs without wallet proof | `/api/auth/jwt` now always requires and verifies the sr25519 signature and timestamp, including demo mode. Demo identities without a private key do not request JWTs. JWTs use explicit HS256 validation with issuer, audience, not-before, token ID and authentication-time claims. | Implemented; Rust/frontend CI proof pending. |

## Required release evidence

The following gates must all be attached to the exact release commit:

1. `cargo fmt --all -- --check`.
2. `cargo clippy --all-targets --all-features -- -D warnings`.
3. `cargo test` against the CI Postgres service, including restart and negative-path tests.
4. Frontend typecheck, lint, production builds and the trusted regression gate.
5. A disposition for every remaining legacy frontend failure: repaired test, confirmed product defect with fix, or reviewed removal/replacement. No silent skips.
6. Production Compose configuration validation with real secret injection and no published database/admin ports.
7. An independently qualified Substrate node whose runtime metadata contains:
   - `AccessControl.log_delegated_access`
   - `MedicalRecords.upsert_ipfs_hash`
   - `MedicalRecords.upsert_emergency_capsule_commitment`
8. Finalized on-chain end-to-end proof for patient registration, consent audit, routine access, emergency access, first/subsequent medical-record anchors, capsule versioning and outbox replay after node unavailability.
9. Production-like API negative tests proving forged, expired, replayed, wrong-patient and revoked-device credentials never return PHI.

## Verification performed 2026-08-11 (this session)

Run locally against a live PostgreSQL 16 container (`medichain_postgres`, the
same image CI uses), with the GNU toolchain:

- `cargo build --release`: passed (11m29s).
- `cargo test --bin medichain-api`: **361 passed, 0 failed** — including 14
  PostgreSQL restart tests covering the five emergency protocols, patient
  access grant/revoke/deny, pre-op, operative and post-op notes, radiology
  orders and reports, and pathology reports.
- `cargo test` for all three pallets and the crypto crate: **79 passed, 0 failed**.
- `cargo clippy --all-targets --all-features -- -D warnings`: clean.
- `cargo fmt --all -- --check`: clean.
- `scripts/check-state-durability.py`: **0 references across 0 fields** (was 52
  across 32). The ratchet is at zero.
- `scripts/check-endpoint-auth.py`: passed; 42 unscoped bulk reads remain and
  are analysed in `FEATURE_END_TO_END_AUDIT.md` item 3.
- Typecheck in all three frontend workspaces: passed.
- Doctor and patient production builds: passed.

The disk-space limitation recorded in the previous session no longer applies,
and the note below that Postgres tests could not run locally was wrong — see
the durability closure in `FEATURE_END_TO_END_AUDIT.md`.

## Verification performed in this remediation session

- `cargo fmt --all -- --check`: passed.
- `cargo metadata --no-deps --format-version 1`: passed.
- Frontend typecheck: passed in all three workspaces after the final signed-JWT client adjustment.
- Frontend lint: passed with warnings and no errors after the final signed-JWT client adjustment.
- Doctor and patient production builds: passed after the final signed-JWT client adjustment.
- Trusted frontend regression gate: 32 files / 127 tests passed, including patient/doctor settings and the corrected patient-satisfaction flow.
- Endpoint method/path inventory: 342 production frontend calls (332 distinct paths) matched 409 registered backend routes (396 distinct paths), with no drift detected.
- Endpoint authorization inventory: 410 handlers scanned; zero unauthenticated and zero presence-only handlers. The existing 41 unscoped bulk-read findings remain a separate multi-tenant hardening backlog.
- Production Compose merge/config validation: passed with non-secret placeholder values used only to prove the required variables and YAML structure are wired correctly.
- CI workflow YAML, blockchain qualification shell syntax and `git diff --check`: passed.
- Full legacy frontend suite: 202 of 332 tests failed in the latest completed bounded run; a later JSON-reporter run hung and was terminated.
- Rust compile/test/clippy: not completed locally because the C: drive ran out of space while compiling dependencies. `cargo clean` removed 841.1 MiB of recoverable build cache; CI or a host with sufficient free space must supply the dynamic proof.
- Live Substrate/Postgres/production-stack end-to-end verification: not performed in this session.

Do not close #2–#10 solely from this document. Close each issue only after its
acceptance evidence is green and linked, and do not launch while #9 or the C5
runtime qualification remains unresolved.

The broader feature-by-feature durability and integration status is tracked in
[`FEATURE_END_TO_END_AUDIT.md`](FEATURE_END_TO_END_AUDIT.md).

## End-to-end harness reconciled (2026-08-12)

`scripts/synthetic-e2e-test.sh` now reports **170 passing** against a fresh
in-memory server, up from 59 pass / 102 fail. Almost none of that gap was a
product regression: the harness had drifted three security contracts behind
while the product tightened.

What it had not learned:

1. **Accounts start `pending`.** `support::get_user` resolves only `active`
   users, so an admin-created doctor is refused until activated via
   `PUT /api/users/{wallet}`. One missing call cascaded into ~100 failures that
   all read like authorization bugs.
2. **Callers are wallets, not patient ids.** Every "patient does X to their own
   record" assertion passed a `PAT-…` record id as `X-User-Id`. The harness now
   provisions a real wallet per synthetic patient (register → activate → claim
   identity), which is the flow the product expects.
3. **Break-glass needs a responder, an approved device and a reason**, and a
   freshly enrolled device is not approved until its first key rotation.
4. **Emergency tokens are one-time `Bearer` credentials**, not `?token=` query
   parameters — and the lock-screen read needs its own token because the card
   read spends the first. That reuse being refused is the replay protection
   working as designed.

**Three real product defects were found underneath**, all instances of the
wallet-vs-record-id namespace bug that `support::caller_owns_patient_record`
exists to prevent — three sites the original 26-handler sweep missed:

* `handlers/ipfs_records.rs` (two checks) — a patient could **never download
  their own medical record**.
* `engagement/symptoms.rs` — a patient could not read their own symptom session.
* `workflow/messaging.rs` — a patient's logged symptom was filed under their
  **wallet** while history reads by **record id**, so a patient logged a symptom
  and it silently vanished. This one returned 201 and lost the data.

All fixed. `docs/TECHNICAL_DEBT_REGISTER.md` lists the four remaining sites with
the same code shape that need reading before changing — some compare against
ids that genuinely are wallets, so a blanket replacement would break them.

**The harness is only meaningful against a fresh server.** It is not idempotent;
a second run against the same instance 409s on bootstrap and cascades into false
failures. That warning is now at the top of the script.

**Final: 175 passing, 0 failing.**

Two more product behaviours the harness had to learn, both correct as built:

* **The lock screen is not the break-glass path.** It is the patient's own
  handset showing their own medical ID, so it needs a device the patient
  registered (`POST /api/mobile/devices/register`) and a device-bound capability
  token presented with `X-Device-Id` — not the responder's one-time NFC token.
  Reusing the NFC token earns `DEVICE_BINDING_REQUIRED`, which is the binding
  working.
* **Lock-screen display is opt-in.** Showing a medical ID above the lock is the
  patient's decision, so it is off until `show_when_locked` is set. The harness
  now opts in explicitly rather than assuming.

A note on the diagnosis, because it cost the most time: on Windows a running
`.exe` cannot be replaced, so `cargo build` silently kept an old binary while the
API was up. Two apparent "the fix didn't work" results were stale binaries. Stop
the server before rebuilding.

## H3 — frontend test suite reconciled (closed 2026-08-11)

**Status: closed.** Both workspaces are green and the whole suite is now a
blocking gate rather than a 32-file subset.

| Workspace | Session start | Now |
|---|---|---|
| doctor-portal | 120 pass / 135 fail | **256 pass / 0 fail** (80 files) |
| patient-app | 30 pass / 48 fail | **78 pass / 0 fail** (26 files) |

Typecheck, `eslint --report-unused-disable-directives` and `vite build` are
clean in both.

### What the 183 failures actually were

Every failure traced to one of five causes. None was a broken feature, but
reading them individually surfaced **nine real defects** that were fixed in the
product rather than papered over in the test.

1. **Wrong mock module specifier.** Ten doctor-portal tests called
   `vi.mock('../store')` while the component imports `'../store/authStore'`.
   Vitest keys mocks by specifier, so `user` stayed `undefined` and every page
   guarding `if (!user) return` never fetched.
2. **Missing router-hook fallback in patient-app.** Ten files rendered a page
   with no `<MemoryRouter>`; `useNavigate()` throws outside a Router and a hook
   throw unmounts the whole tree, so those files rendered nothing.
3. **Fixture shapes no endpoint returns.** The largest group. `RadiologyPage`
   mocked `{ studies: [...] }` where `listRadiology()` wraps a bare array as
   `orders.items`; `AdminDashboardPage` mocked `stats` where the page reads
   `system_stats`; `VitalSignsPage` mocked `/api/vitals/{id}` where the page
   calls `/api/clinical/vitals/flowsheet/{id}`.
4. **Assertions that skip the interaction.** Forms live behind tabs and wizard
   steps: the AMA capacity assessment is on step 3 of 4, behind a tab, behind a
   load spinner. A test that renders and asserts sees the records list.
5. **Test hooks the product never had**, e.g. `[data-testid="pedigree-chart"]`.
   Resolved by asserting on visible text rather than adding test-only hooks.

### Product defects found by reading failures individually

Fixed in the product:

1. **AMA discharge had no capacity assessment.** Decision-making capacity is the
   legal precondition for a valid AMA discharge, and the word `capacity` did not
   appear in `AMAPage.tsx`. Added as a gated step-3 attestation plus a free-text
   basis; `Continue to Signatures` now requires it alongside the risk
   acknowledgements.
2. **Laceration suture material was fabricated.** `sutureType` was initialised to
   `'4-0 Nylon'` with no control, and the backend persists it
   (`suture_material`/`suture_size`) — so every repair was filed as 4-0 nylon.
3. **IV site assessment staged phlebitis but not infiltration.** The page scored
   VIP 0–5 and mapped `swelling` to phlebitis grade 2. Swelling with coolness and
   blanching is infiltration, whose nursing action is the opposite. Added the INS
   Infiltration Scale (0–4) with coolness/blanching/leakage signs, clinician-graded
   because the grade turns on measured oedema extent.
4. **Code Blue had no amiodarone.** ACLS gives it for shock-refractory VF/pVT
   alongside epinephrine; only epi was one tap away.
5. **PediatricsPage shipped hardcoded demo patients.** Two invented children with
   four hand-written growth points each — no real child could appear. Now loads
   the register, filters to under-18s by date of birth, and reads each child's
   growth series from a new patient-scoped endpoint.
6. **PediatricsPage crashed on a child with no assessments.** Unreachable while
   the roster was hardcoded (always four points); the normal state for a newly
   registered child. Every growth read is now guarded.
7. **ASA physical status was not a radio group.** Five `<button>`s implementing a
   single choice, with selection conveyed only by colour and a check glyph.
8. **Two hardcoded English placeholders on EPrescribePage** in an otherwise fully
   i18n'd page — they stayed English in every other locale.
9. **Ambiguous clinical field labels.** `Baseline (bpm)` in the fetal-heart-rate
   panel (maternal HR is also charted in bpm) → `Baseline FHR (bpm)`;
   IV `Location` beside `Site Condition` → `Insertion Site`; `VIP Score Reference`
   → `Visual Infusion Phlebitis (VIP) Score Reference`.

Plus two accessibility fixes made earlier in the session: the triage chief
complaint had no accessible label, and a patient-app family group used a
clickable `<div>` for an expander.

### Deliberately not fixed

**Burn TBSA uses Rule of 9s where paediatric burns want Lund-Browder.** Not a
label change — Lund-Browder is a different region set (13% anterior trunk vs
18%), so substituting its percentages into the current 13 Rule-of-9s regions
gives a chart that no longer totals 100%. TBSA drives the Parkland formula, so
this needs a deliberate decision, not a drive-by edit. Written up in
`docs/TECHNICAL_DEBT_REGISTER.md`.

**Unmapped enum → `undefined` component.** `icons[status]` returns `undefined`
for a status outside the union, and rendering `undefined` as JSX blanks the whole
page. The union is asserted from API data with `as`, never validated. The right
fix is one shared helper with a fallback, not a local patch. Also in the debt
register.

### Method note

`scripts/repair-ambiguous-matchers.py` was the only codemod applied in bulk, and
only because "found multiple elements" is positive proof the element renders —
relaxing to `getAllByText` cannot mask a missing feature. Everything else was
read individually. That is what surfaced the nine defects above; an automated
pass would have rewritten each assertion to match whatever the code renders and
buried the question.
