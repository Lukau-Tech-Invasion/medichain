# Technical Debt Register

> **STATUS — THE CLEANUP PASS HAS RUN (2026-07-31).**
>
> The original sequencing rule was: record debt as it is found, action **none**
> of it until the application is implemented and tested — because you cannot
> tell what is genuinely unused until the whole thing works. That precondition
> was met (every catalogued frontend page reaches a real endpoint; 311 API + 52
> pallet + 23 crypto tests and 83 live e2e assertions pass), and the owner
> authorised the paydown on 2026-07-31.
>
> **What was removed is listed under "Removed in the 2026-07-31 dead-code pass"**
> below, with the evidence for each. Everything under **"Explicitly NOT debt"**
> was examined and deliberately kept — removing any of it would be a correctness
> regression, not a tidy-up. Entries still marked open are *feature work*
> (persistence, scope) rather than dead code.
>
> This file remains the record: add new debt here as it is discovered.

Last updated: 2026-07-31.

---

## How this list was produced

Mostly by the compiler, which is the point. `cargo check`'s dead-code warnings
are the cheapest reliable detector of "written but never wired", and this
project has already been bitten by the difference between *the module exists*
and *the requirement is implemented* — see the HZ-003 emergency capsule, which
was 324 well-tested lines with zero callers while a status table called it
"Implemented".

Re-run before actioning anything, since the list will have moved:

```bash
cargo check -p medichain-api --message-format short 2>&1 | grep warning
cargo clippy -p medichain-api --all-targets
```

---

## 1. Tests that do not run — HIGHEST VALUE, fix before anything is deleted

`tests/integration_tests.rs` (902 lines, 28 tests) and `tests/e2e_tests.rs`
(672 lines, 21 tests) sit at the repository root. The root `Cargo.toml` is a
**virtual workspace** — its `members` are `pallets/*`, `crypto`, `api`, and it
is not itself a package. Rust only builds `tests/` for a package, so these
files belong to nothing and are **never compiled or executed**.

Confirmed 2026-07-29:

```
$ cargo test --test integration_tests
error: no test target named `integration_tests` in default-run packages
```

`CLAUDE.md` nonetheless documents both commands and claims "28+ tests" and
"18+ tests" as part of the suite. **49 tests across 1,574 lines have never
run.**

**Correction (2026-07-30): this is NOT coverage to recover.** On inspection the
files reference **zero project crates** — the only import in either is
`std::collections::HashMap`. They define their own `MockStorage`, `Role`,
`PatientIdentity` and `MedicalRecordRef` types inside the test file and then
assert against those. A representative test inserts into a `HashMap` and
asserts the value is present.

They therefore test *mock reimplementations*, not MediChain. Wiring them into
the workspace would produce 49 additional passing tests that verify nothing
about the real system, taking the suite from 351 to 400 while making the number
mean less. That is worse than leaving them unbuilt.

**Revised action:** do not resurrect them as-is. Either convert them to exercise
the real crates (`medichain_api`, `medichain_crypto`, the pallets), or retire
them in favour of the live-API harness at `scripts/synthetic-e2e-test.sh`, which
tests the running system rather than a copy of it. Retiring requires owner
approval per CLAUDE.md rule 7.

Either way, **correct `CLAUDE.md`'s testing section**, which cites these as
"28+ tests" and "18+ tests" of real coverage.

**Action when the time comes:** decide whether these move under `api/tests/`,
get their own workspace member, or are retired. Do not assume they still pass;
find out. Then correct CLAUDE.md's testing section either way.

---

## 2. Dead modules and unused items (compiler-identified)

Each entry is a *candidate*, not a verdict. Confirm no live caller, and confirm
no in-flight feature intends to call it, before proposing removal.

### `api/src/key_management.rs` — entire module appears unused

Pre-existing (commit `78d44e4`), untouched by the current work. Every public
item is flagged:

- `struct EncryptionContext` — never constructed
- `struct RecipientPublicKey` — never constructed
- `struct GeneratedDataKey` — never constructed
- `struct KeyEnvelope` — never constructed
- `trait KeyManager` — never used
- `struct LegacyDeploymentKeyringAdapter` — never constructed

Note it sits next to `encryption_keyring.rs`, which *is* live and is what the
codebase actually uses. This looks like a superseded design. **Check whether it
was intended as the envelope-encryption path for a planned feature before
retiring it** — an unused key-management abstraction is the kind of thing
someone builds deliberately ahead of need.

### `api/src/middleware/rate_limit.rs` — partially dead

- `struct RateLimitEntry` — never constructed
- `struct RateLimitMiddlewareService` — never constructed
- `fn get_client_identifier` — never used
- `fn get_rate_limit` — never used

Rate limiting is a security control. If this module is dead, the question is
not "can we delete it" but **"is rate limiting actually enforced anywhere?"**
Answer that first; the answer may be a finding rather than a cleanup.

### Smaller items

- `api/src/repositories/traits.rs` — two `parse` associated functions never
  used (~lines 6139, 6181). Likely the read-back half of an enum whose write
  half is used. Harmless, but check the pair is not half-wired.
- `api/src/retention/evaluator.rs:90` — `RetentionDecision::kind()` never used.
  Written for a reporting surface that was not built.

---

## 3. Clippy: functions with too many arguments

- `api/src/emergency_grants.rs:60` (10 args)
- `api/src/emergency_grants.rs:110` (9 args)
- `api/src/telehealth_retention.rs:45` (8 args)

All pre-existing. These are genuine readability debt — a 10-argument call site
is easy to transpose. Candidate fix is a parameter struct, not a suppression.

Note: `emergency_capsule::log_access` also takes 9 and carries an explicit
`#[allow(clippy::too_many_arguments)]`. If a parameter-struct convention is
adopted, apply it there too rather than leaving one allow-listed exception.

---

## 4. Schema debt

### The `sessions` table has zero live queries

Flagged during Horizon `HZ-WP8-PRIV-001`'s data-minimisation review:
authentication moved to stateless JWT and nothing reads or writes this table.
It holds PII-shaped columns, so keeping it is a data-minimisation problem, not
just clutter.

**Deliberately not dropped** — a schema change needs the owner's sign-off
separately from a code-deletion pass. Still open.

### Migration count vs. reality

179 tables exist in a freshly migrated database. Whether all are reachable from
live code is unknown. Worth a systematic pass at cleanup time: cross-reference
table names against `api/src/repositories/` to find orphans.

---

## 5. Documentation drift

- ~~`CLAUDE.md`'s testing section documents two test commands that cannot run
  and test counts that are not real.~~ — **RESOLVED 2026-07-31.** Rewritten with
  counts re-verified by running them (311 API / 21+19+12 pallet / 23 crypto / 83
  e2e), the `--bin` gotcha stated, the unrunnable `--test` commands removed with
  a note explaining why, and per-workspace frontend commands.
- ~~`CLAUDE.md`'s "Current State" section predates this campaign's work.~~ —
  **RESOLVED 2026-07-31.** Rewritten against verified state, including the
  completed frontend↔backend connection work.
- `deny.toml` retains the `RUSTSEC-2024-0363` (sqlx) entry, now resolved and
  kept only for legibility — fine, but re-check at cleanup time whether the
  4 rustls-webpki advisories have upstream fixes by then.
- `IMPLEMENTATION_PLAN.md` has a documented history of stale done/blocked
  claims in both directions. Treat every status marker as a hypothesis.

---

## 6. Environment / build debt

Not code, but it costs real time every session:

- Builds repeatedly fill the C: drive to 0 bytes, producing **misleading
  linker errors** that look like code faults. `target/debug/incremental` alone
  reached 3.3 GiB. Current mitigation: `CARGO_INCREMENTAL=0` and periodic
  `cargo clean`.
- ~~The API's default port (8080) collides with the documented IPFS gateway port~~
  — **RESOLVED 2026-07-31.** The API's default is now **8090**
  (`api/src/main.rs`); Docker pins `PORT: 8080` explicitly (its own container
  namespace, where nginx proxies to `api:8080`). Both Vite proxies, the dev/test
  scripts, and the docs were moved to 8090 in the same pass. This had already
  caused two misdiagnoses (a 404 read as "the API is still running", and an IPFS
  download failure that looked like a missing record).
- **`patient_access` (Consent Management access grants/requests) is in-memory
  only.** Like `emergency_grants`, `mobile_records`, and the surgical
  document stores, `crate::patient_access::PatientAccessStore` keeps state in
  the process — correct for the synthetic/demo backend, but a
  `MEDICHAIN_STORAGE=postgres` deployment does not persist these grants across
  restarts. Follow-up: a repository-trait + PostgreSQL implementation with a
  migration, matching the dual-storage pattern used for patients/allergies.

- ~~**Nursing MAR "administer" and I/O "record fluid" are acknowledgement-only.**~~
  — **RESOLVED 2026-08-04 (Horizon HZ-023).** All four endpoints
  (`/api/nursing/{mar/administer,intake-output/record}` and
  `/api/emergency/{administer-med,record-fluid}`) now persist through two shared
  writers, `append_mar_administration` and `append_io_event`, so the nursing and
  emergency routes cannot drift apart again. A dose is appended to the patient's
  MAR for the day (creating it if absent); a fluid event is routed to its
  intake/output column with the running totals and net balance recomputed. Both
  now require a `patient_id` — the old stubs accepted a dose with no patient at
  all, and the e2e suite was asserting that. Round-trip assertions added:
  administer → the dose appears in `GET /api/nursing/mar`; record fluid →
  `total_intake` reflects it.

- **`/api/clinical/shift-handoff/{provider_id}` is today-scoped.** It uses the
  repository's `get_by_provider(provider_id, today)`, so the ShiftHandoffPage
  history shows only the current day's handoffs (fine for a same-day synthetic
  demo). Follow-up: a date-range or "recent N" query for multi-day history.

- ~~**MyRecordsPage document list + download is unconnected**~~ — **RESOLVED
  2026-07-30.** Added `GET /api/records/{content_hash}/download` (streams
  decrypted bytes + `Content-Disposition`) and fixed the page's list mapping to
  the real `MedicalRecordReference` shape, keyed by `content_hash`. Verified by a
  live upload→encrypt→IPFS→download→decrypt round-trip asserting byte equality
  (e2e section 11, 8 assertions).
- **The API's default port (8080) collides with the IPFS gateway — this actively
  broke record downloads.** `docker-compose.yml:44` publishes kubo's gateway on
  host **8080**; the synthetic runner also bound the API to 8080, so the API won
  the port and its own `IPFS_GATEWAY_URL` (default `http://localhost:8080`)
  resolved back to *itself* — every `download_raw` got the API's 404 and surfaced
  as a misleading `RECORD_NOT_FOUND`. Mitigated 2026-07-30 by defaulting
  `scripts/run-synthetic-local.sh` to `PORT=8090` (and the e2e `BASE` to match).
  **The underlying default is still wrong**: `IpfsClient::from_env()` falls back
  to `localhost:8080` for the gateway, so any deployment that runs the API on
  8080 hits this. Real fix: move the API's default port off 8080, or require an
  explicit `IPFS_GATEWAY_URL`.

---

## Removed in the 2026-07-31 dead-code pass

Recorded so the deletions are auditable (all recoverable from git history):

- **`api/src/key_management.rs`** (86 lines) — a "Phase 3 key-management
  boundary" (`KeyManager` trait, `EncryptionContext`, `RecipientPublicKey`,
  `GeneratedDataKey`, `KeyEnvelope`, `LegacyDeploymentKeyringAdapter`). Never
  wired to a single caller; its adapter returned `Err(...)` for every envelope
  operation. It described a capability the system does not have, so keeping it
  was worse than deleting it. `encryption_keyring.rs`'s doc comment that
  referenced it was rewritten to state plainly that envelope encryption is not
  implemented.
- **`tests/integration_tests.rs` + `tests/e2e_tests.rs`** (49 KB, 49 `#[test]`
  functions) — the root `tests/` directory belonged to no workspace member, so
  they never compiled or ran. Worse, they imported **no project code at all**
  (only `std::collections::HashMap`): they defined a local `MockStorage`, a
  duplicate `Role` enum, and hand-copied "constants matching the pallets", then
  asserted that those mocks behaved as written. Running them would have proved
  nothing about MediChain while being counted as 49 tests of coverage. Real
  coverage of the same ground: 311 API tests, 52 pallet tests, 23 crypto tests,
  83 live-server e2e assertions.
- **`GuardianAuthorityEvidence::parse` / `ChildAssentStatus::parse`** — dead
  hand-written string parsers duplicating what `#[serde(rename_all)]` already
  does on both enums. Their `as_str()` counterparts are used and were kept.
- **`RetentionDecision::kind()`, `RetentionAssessment::is_complete()`** — unused
  helpers. `is_complete()` turned out to have two *test* callers (the dead-code
  lint doesn't see `#[cfg(test)]` use in a binary crate), so the HZ-017
  regression test now asserts on `incomplete_reason` directly — the field the
  test exists to protect. (The retention module's *absence of deletion code* is
  deliberate and was not touched — see below.)
- **`client/shared/src/api/batch.ts`** (9.9 KB) — a request-batching abstraction
  with **zero consumers** in either app, targeting server endpoints that do not
  exist (`/api/batch`, `/api/{analytics,audit-logs,lab-results,...}/batch`).
  Not merely dead: its `auditLogBatcher` and `analyticsBatcher` singletons were
  constructed at module scope and each started a **5-second `setInterval`**, and
  `api/index.ts` re-exported them — so importing anything from the shared API
  package made both PWAs POST to 404 endpoints every 5 seconds for the life of
  the session. Removed along with its re-export block. This also clears the
  "~8 batch calls" bucket previously catalogued in
  `docs/FRONTEND_BACKEND_CONNECTION.md`.
- **The nested `medichain/` directory** (13 MB) — a stale 2026-06-01 duplicate
  clone of the whole project sitting inside the repo (gitignored, so never
  pushed). Verified safe first: clean working tree, no stashes, and all four of
  its refs already present in the parent repo.

## Frontend test suite — hooks that threw instead of degrading (2026-07-31)

The doctor-portal suite was **224 failed / 28 passed (80 files, 78 failing)**.
Almost none of it was component bugs: three shared hooks threw when their
provider was absent, and a React hook that throws unmounts the whole tree, so
every test rendering a page without the full provider stack got a blank render.

- **`useTranslation` threw without `I18nProvider`** (226 errors). Now falls back
  to a real en-US translator (`createTranslator(enUS)`), so components render
  actual English copy with no provider. `I18nProvider` still drives locale
  switching/RTL.
- **`useToast` threw without `ToastProvider`** (~200 errors). Now falls back to a
  no-op sink: a dropped toast is recoverable, a blank page is not.
- **42 test files mocked `@medichain/shared` with a factory that omitted
  `useTranslation`**, so the mock shadowed it entirely. Converted every factory
  to spread the real module (`async (importOriginal) => ({ ...(await
  importOriginal()), ...overrides })`) — they now mock only what they intend to.

- **React Router hooks throw outside a `<Router>`** and ~47 files render pages
  bare. `src/test/setup.ts` now stubs the *hooks* (`useNavigate`, `useLocation`,
  `useParams`, `useSearchParams`) while leaving `MemoryRouter` and the
  components real, so the ~30 files that do wrap keep working and nothing nests.
  (An attempt to instead wrap every `render()` in a global `MemoryRouter` was
  reverted: React Router rejects a Router inside a Router, and it traded ~140
  context errors for 8 nesting errors with no net gain.)

Both hook changes are **production improvements, not test hacks**: in an
emergency clinical UI, degrading to English / silently dropping a toast beats
white-screening the page. Both apps still build (`npm run build`, exit 0) and
typecheck clean.

### What is still failing, and why it is not infrastructure

After the above, the infrastructure classes are gone and the remainder are
**per-test content problems** that each need individual attention:

- assertions on copy the component no longer renders
  (e.g. `Unable to find text: /John Doe/i`, `/Activate MCI Mode/i`);
- `TypeError: Failed to parse URL from /api/...` — tests calling `fetch` with a
  relative URL under jsdom, which has no base URL (needs an absolute base or a
  fetch mock);
- a handful of 10s timeouts and `undefined.length` reads from mocks that don't
  match what the component expects.

**Measured outcome of this pass: 28 → 65 passing (+132%), and router/i18n/toast
context errors from 400+ occurrences to exactly zero** (verified by grepping the
run log). 187 tests still fail, all on per-file mock/assertion drift. Every
remaining failure is per-test content, and it is **pre-existing**, not a
regression from this session (both apps build and typecheck clean). It should be
worked file by file — the global levers are exhausted. Components that render
`<Link>` still need a real Router in their own test file.

### Diagnosis of the remainder (done 2026-07-31 — read this before starting)

Every *systemic* lever has been pulled and measured; what is left was confirmed
by instrumenting individual files, not guessed:

- **The failures are per-file mock/assertion drift**, and the shapes differ from
  file to file. Example proven end to end: `VitalSignsPage.test.tsx` mocked
  `recentPatients: [{ id, name }]` while the store and component use
  `{ patientId, fullName }` — so the `<option>` rendered blank, React warned
  about a missing `key` (it was `undefined`), and the "John Doe" assertion
  failed. Correcting the fixture's field names fixed it. **Only 1–2 other files
  share that exact shape**, so there is no bulk sed for this; each file needs
  reading against its component.
- A blanket router stub is actively harmful and was reverted: `useParams: () =>
  ({})` starved the ~30 files that correctly set up
  `<MemoryRouter><Routes><Route path="/patients/:patientId">`, leaving pages on
  a spinner forever. The mock now calls the **real** hook and falls back only
  when it throws for want of a Router.

**Two production defects were found via these tests and fixed in the app:**
- `PatientDetailPage`'s loading state was a bare spinner with no text or
  `role="status"` — a screen-reader user got silence while a record loaded.
- `VitalSignsPage` read `flowsheet.readings.length` guarding only `flowsheet`,
  so a response missing that array crashed the page to a blank screen.

**Order to work the rest:** (1) the ~8 timeouts (`Toast`, `Autopsy`, `Burn`) —
likely awaited state that never settles; (2) `Cannot read properties of
undefined` — each is a missing guard like the VitalSignsPage one, i.e. a real
robustness fix; (3) the copy/placeholder assertions, which need a per-test
decision about whether the test or the component is stale. Treat a failing
assertion as a question about the product, not just about the test.

---

## Fixed while cleaning (found by running, not reading)

- **Flaky test: `sms_preferences::hz_webhook_regression_tests`.** The two
  webhook regression tests both `set_var`/`remove_var` the process-global
  `SMS_INBOUND_WEBHOOK_SECRET`, and cargo runs tests in parallel threads inside
  one process — so whichever finished first unset the secret while the other was
  still mid-request, failing it. It passed in isolation and failed only in the
  full run, which is the worst shape for trust in a green suite. Fixed with a
  module-level `Mutex` both tests hold across their env mutation. **Any future
  test that touches env vars must take the same lock**, or the race returns.
- **`scripts/test-all-apis.sh` was permanently red (8/28 failing) — fixture, not
  API.** It declared five role wallets but never registered them, so every
  role-scoped call returned 401 (unknown user) and `/api/auth/me` returned 404;
  it also called `/api/tasks/nurse`, while the registered route is
  `/api/nurse/tasks` (the word-order swap already known from the 2026-07-22
  route-drift audit). A suite everyone expects to be red is not a signal, so it
  now seeds its own accounts (idempotently) and uses the correct path:
  **28/28 pass**.
- **`/api/ipfs/health` reported hardcoded URLs** (`localhost:5001` /
  `localhost:8080`) instead of the configured `IPFS_API_URL` /
  `IPFS_GATEWAY_URL`. Since the endpoint exists to diagnose IPFS connectivity,
  echoing constants that may not match the real configuration actively misleads
  that diagnosis — especially given the port collision above. Now reports the
  live values via new `IpfsClient::api_url()` / `gateway_url()` accessors.

---

## Explicitly NOT debt

Recorded so a future cleanup pass does not "tidy" away something load-bearing:

- **`emergency_capsule.rs`'s unused-looking provenance fields** — `BloodTypeSource`,
  `blood_type_verified_at/by`, `dnr_document_ref`. They are part of the
  committed digest and the POPIA gate §1 spec, and are deliberately carried
  even when currently `None`.
- **The two `#[serde(rename = ...)]` attributes on `ConsentGiverCapacity`.**
  They look redundant beside `rename_all = "snake_case"`. They are not —
  removing either silently breaks the wire/storage contract and disables the
  Children's Act §129 checks. See finding HZ-015; there is a regression test.
- **Reserved pallet call indices 2 and 3** in `pallet-medical-records`. They are
  intentionally left unused so a stale client cannot bind to a different
  extrinsic. Reusing them is a correctness bug, not a tidy-up.
- **`retention::execution` stopping short of deletion.** The absence of
  destructive code is the design, not an unfinished feature.
