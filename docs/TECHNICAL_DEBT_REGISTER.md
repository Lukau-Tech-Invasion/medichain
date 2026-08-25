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

Last updated: 2026-08-25.

---

## 2026-08-25 — OPEN, TIME-BOUND: two accepted upstream advisories in the Subxt graph

`cargo deny check advisories` is green as of 2026-08-25, and two of the reasons
it is green are acceptances rather than fixes. An acceptance is not a closure,
so it is recorded here with the condition that removes it.

Three advisories were open on this workspace. One was **removed**, not accepted:
`RUSTSEC-2026-0258` (`h2 0.3.27`, unbounded empty HTTP/2 DATA frames) arrived
through `actix-http`'s `http2` feature, which is on by default. Nginx terminates
HTTP/2 at the edge and proxies to this service with `proxy_http_version 1.1`, so
that stack was compiled and never spoken. Disabling the feature deleted the
dependency and the advisory with it. See the dependency-minimisation entry below.

The remaining two are accepted:

| | `RUSTSEC-2026-0173` | `RUSTSEC-2026-0215` |
| --- | --- | --- |
| Crate | `proc-macro-error2 2.0.1` | `smallstr 0.3.1` |
| Class | INFO / unmaintained | INFO / unmaintained |
| Patched release | none | none; all versions affected |
| Path | `subxt 0.50.3` → `subxt-macro` | `subxt 0.50.3` → `frame-decode` → `scale-info-legacy` |
| Exposure | **build-time only** — a proc-macro crate. It executes on the build host during compilation and is present in no deployed artifact. | Compiled into the binary, but reached only through Subxt's own metadata decoding. |
| Owner | Subxt upstream | Subxt upstream |

**Why not remediate now.** Both are internal implementation details of `subxt`,
and `subxt`'s version is coupled to the chain runtime's metadata format — the
root `Cargo.toml` records that subxt 0.37 cannot encode a call against this
runtime at all, and that the coupling must be re-checked whenever the SDK moves.
An isolated `cargo update -p subxt` to clear an *informational* advisory is the
"green audit, broken blockchain" trade: it swaps a documented build-time
maintenance notice for an undetected wire-format incompatibility. Forking Subxt
to replace a transitive crate it owns is worse.

**Removal criterion.** Both exceptions are deleted when MediChain moves to a
Subxt release that is compatible with the deployed runtime's metadata contract
and no longer depends on the affected crates. That belongs to the coordinated
Subxt / runtime / node / finalized-chain-E2E upgrade, treated as one unit, not
to routine dependency housekeeping.

**Next review.** At the start of that upgrade campaign, or on any new advisory
against the Subxt graph — whichever is first.

**Note for the reviewer.** `deny.toml`'s `[advisories]` header still describes
four `rustls-webpki` advisories as reachable and unfixed. They no longer match
any crate in the graph, and `cargo deny` now reports four `advisory-not-detected`
warnings for stale `ignore` entries (`RUSTSEC-2022-0061`, `RUSTSEC-2024-0370`,
`RUSTSEC-2024-0384`, `RUSTSEC-2025-0134`). Those entries and that header text
are stale and should be reconciled — deliberately left alone here because the
file states that editing the advisory list is the owner's call.

---

## 2026-08-25 — CLOSED: unused capability was carrying most of the dependency risk

Two dependencies were configured to supply far more capability than MediChain
consumes, and in both cases the surplus was where the supply-chain findings
lived. Fixing the configuration removed the findings; no policy exception was
needed for either.

| Dependency | Capability consumed | Capability enabled | Result of narrowing |
| --- | --- | --- | --- |
| `image` (via default features, plus `qrcode`) | encode one 8-bit greyscale QR bitmap as PNG (`support.rs`, `nfc_simulator.rs`) | ~15 formats including AVIF, whose encoder is `rav1e`, a full AV1 implementation | 48 crates removed; the `(MIT OR Apache-2.0) AND NCSA` licence rejection (`libfuzzer-sys`) disappeared with them |
| `actix-web` (default features) | HTTP/1.1 behind Nginx, plus the `macros` attribute routing used by 424 handlers | `http2`, `cookies`, `compress-brotli`/`gzip`/`zstd`, `unicode` | 12 more crates removed, including `h2 0.3.27` and `RUSTSEC-2026-0258` |

Total: **60 crates removed from `Cargo.lock`, 0 added**, among them decoders for
AVIF, WebP, EXR, TIFF, GIF, JPEG, QOI and fax — every one a parser for a format
this service never reads — plus a brotli/zstd compression stack behind a
`Compress` middleware that is never installed, and a cookie stack for a service
that never reads a cookie.

The generalisable rule, and the reason this is filed as debt rather than as a
one-off fix: **no capability without a requirement.** For every substantial
dependency the question is what exact capability MediChain consumes from it,
versus what the current feature configuration enables. The gap is measurable
with `cargo tree -e features` and is where unowned risk accumulates. Apply this
before adding the blockchain, FHIR, IPFS and observability dependency sets,
where the same gap is likely to be larger.

Verified: `cargo check --bin medichain-api` passes; `cargo test --bin
medichain-api qr` passes including `test_qr_image_generation`, the PNG encode
path itself; `cargo deny check licenses` and `cargo deny check advisories` both
report `ok`.

---

## 2026-08-20 — three silent-write classes found and closed

All three shared a shape: the write returns success, the reader sees the old
value, and nothing anywhere reports an error. That is the most expensive kind of
bug this project has, because every surface says the feature works.

### 1. `update()` dropped the `data` column that the read path serves — 17 repositories

Many clinical handlers persist to typed columns but *read back* `entity.data`,
the JSON blob the record was filed with. 61 of 75 PostgreSQL `update()` bodies
never bound `data`; in **17** of them the read path serves it, so an update was
invisible to every reader:

`ama_discharges`, `burn_assessments`, `chain_of_custody`,
`discharge_instructions`, `discharge_summaries`, `intubation_records`,
`lab_qc_records`, `laceration_repairs`, `mci_records`, `obstetric_emergencies`,
`operative_notes`, `pediatric_assessments`, `physician_orders`,
`psychiatric_assessments`, `specimen_collections`, `splint_cast_records`,
`toxicology_assessments`, plus `consultation_notes` (found first, fixed
separately).

All now write `data`. The remaining 44 are records whose readers use the typed
columns, so the omission is not observable — left alone deliberately rather than
changed in bulk.

**Detector:** cross-reference each `impl <Trait> for Pg*`'s `update()` against
handlers that read `repositories.<field>.get_by_id(...).data`.

### 2b. Request types that model the finished artefact, not the form

`POST /api/surgical/pathology` took the typed `PathologyReport` — accession
number, special stains, IHC, molecular studies, synoptic cancer dataset. The
pathology screen accessions a *specimen*, which exists long before any of that:
who collected it, from where, in what fixative, and where it sits in the
grossing/processing/staining workflow. Every accession was rejected with a
deserialization error naming a status variant the page has never used, so a
specimen could not be booked into the lab at all.

Fixed with a `CreatePathologyRequest` DTO that accepts the accession and keeps
the report fields optional, plus
`20260820000002_pathology_specimen_workflow_status.sql` widening the status
CHECK to hold both lifecycles.

Same shape as the MAR and consult defects. **When a form cannot save, check
whether the request type models the end state rather than the step the user is
on** — the typed struct is usually right about the finished artefact and wrong
about the moment of capture.

### 2e. Fabricated KPIs the placeholder audit could not see

`AnalyticsPage.tsx` rendered three panels of hardcoded numbers — 94% patient
satisfaction, 89% discharge efficiency, a 32-minute ED wait, 45-minute lab
turnaround, 112% ED overcapacity, "2 ventilators left", "-5 staff" — plus a
table of five invented incidents with fixed times ("Mass casualty incident
alert", 14:32). None came from the API.

Two things made this the worst instance in the codebase:

1. It is the screen an executive reads **to decide where to send staff**.
2. The genuine counts beside it read `0`, so the fabricated half looked like the
   working half and the real half looked broken.

**`scripts/placeholder-audit.py` could not detect it.** The detector greps for
`TODO|FIXME|mock|placeholder|simulated|hardcoded|unimplemented`; a bare `94%` in
JSX matches none of them. Keyword scanning finds placeholders that *announce
themselves* and is blind to invented data that does not. The audit reporting
`BEHAVIOURAL 0` was true and insufficient — this was found by opening the page.

Replaced by `GET /api/platform/analytics/operations`, which counts what exists
(radiology queue, pending lab submissions, median lab turnaround, unacknowledged
critical values, mean patient-satisfaction rating with its response count) and
returns an `unmeasured` list naming what it deliberately does not estimate: bed
availability, ED wait and capacity, ventilators, staffing, medication stock.
There is no bed, roster or inventory model to derive those from. The activity
table now shows the real unacknowledged critical values.

**The lesson for the next sweep:** a clean keyword audit is not evidence that a
screen tells the truth. Numbers that look plausible are exactly the ones no
grep will find.

### 2d. The credential keystore could not carry a derivation-path account

`KEYSTORE_VERSION = 1` stored a 32-byte mini-secret and rebuilt the account with
`sr25519PairFromSeed`. That only reproduces accounts derived **straight from a
seed**. An account from a derivation path — `//Alice`, or the
`//hospital//dr-mbeki` shape a Polkadot extension produces — has no mini-secret
that yields it, so enrolment appeared to succeed and then unlocked a *different
account*. The address check in `loginWithCredentials` turned that into "your
stored key does not match this account", with nothing explaining why.

So credential sign-in silently supported only accounts the app itself had
generated. Any clinician arriving with an existing extension account was locked
out of the humane login path and pushed back to the wallet extension.

Fixed by `KEYSTORE_VERSION = 2`: the envelope carries a 32-byte mini-secret or a
64-byte secret key, tagged with `kind`; `signerFromSecret` takes the address to
recover the public half for the latter. v1 envelopes still open (absent `kind`
means `seed`). Covered by
`client/doctor-portal/src/store/credentialKeystore.test.ts`.

**Also added, not weakened:** `startup::validate_no_privileged_dev_accounts`
refuses to boot a non-demo instance where a well-known Substrate development
account holds a privileged role. `blockchain.rs` guarded the chain signer
against Alice; nothing guarded the `users` table, where `//Alice` was seeded as
an active `Admin` — a published key with full administrative authority.

### 2c. An identifier bound to the wrong foreign key

`pathology_reports.specimen_id` is a foreign key into `specimen_collections` —
the *physical sample* the lab logged in. The pathology screen's `specimenId` is
the *accession* the report is filed under. Binding one to the other violated the
key on every insert, so even after the DTO above accepted the request, the write
still failed.

Two lessons, both cheap to apply:

- **A column named for a concept is not always that concept.** `specimen_id`
  next to an accession called `specimenId` reads like a match and is not one.
  Check what a FK actually references before binding to it.
- **Nullable FKs want `None`, not `""`.** The neighbouring
  `specimen_rejections.specimen_id` is `NOT NULL REFERENCES specimen_collections`
  and was read with `unwrap_or_default()`, so a missing value became the empty
  string and surfaced as a bare 500 `DATABASE_ERROR`. It now validates the field
  and checks the specimen exists, returning `MISSING_FIELD` or
  `SPECIMEN_NOT_FOUND`. A required reference is worth enforcing; it is not worth
  reporting as an internal error.

Neither could fail against the in-memory backend, which enforces no foreign
keys — the same blind spot as the CHECK constraints below.

### 2. CHECK constraints narrower than the workflow — `consultation_notes`

The portal's consult lifecycle is
`requested → acknowledged → in-progress → completed | declined | cancelled`,
while the constraint allowed only `pending | in_progress | completed |
cancelled`. **Four of six statuses were rejected**, including `requested` —
which every new consult is created with. Requesting a consult therefore failed
outright on PostgreSQL while succeeding in the in-memory backend, which enforces
no constraints.

Fixed by `20260820000001_consult_status_vocabulary.sql`. This is the same class
as the five widened in `20260811000001`; it is worth sweeping the remaining
enum-backed columns for it.

### 3. Trait defaults that make a missing implementation compile — CLOSED

`traits.rs` gave methods a default body returning
`NotImplemented("<method> not implemented")`. A backend that did not override one
still satisfied the trait, so the gap was invisible to `cargo check`, to clippy,
and to any test run against the memory backend — and showed up only in
production. 63 methods carried such a default; 24 were not overridden by both
backends, and 5 were reachable from live handlers (lab QC, blood-bank, specimen
collection and specimen rejection registries all returned
`list_all not implemented` on Postgres).

**Closed by writing the 19 missing implementations and then deleting all 65
default bodies**, so every method is now *required*. `cargo check` refuses a
backend that omits one, which turns a class of production-only runtime failure
into a compile error.

Declare new repository methods with a `;` and no body. Do not reintroduce a
defaulted `NotImplemented` body "for now" — that is exactly the shape that hid
five production-only failures.

### Also fixed

- **`from_hex` rejected the `0x` prefix** that `u8aToHex` emits, so every
  browser-produced sr25519 signature failed at the hex decoder and was reported
  as `SIGNATURE_VERIFICATION_FAILED`. Credential sign-in could never obtain a
  JWT; demo mode hid it behind the `X-User-Id` fallback.
- **Conditional React hooks on the three admin pages.** The
  "restricted to administrators" gate was placed *above* the hooks, so a
  non-administrator render ran up to a dozen fewer hooks than an administrator
  render — React throws "Rendered fewer hooks than expected" the moment the role
  changes without a remount. All 33 `react-hooks/rules-of-hooks` errors are gone.
- **Unmapped enum → `undefined` component** (previously deferred, see below).
  `lookupOr` / `componentOr` in `client/shared/src/utils/enumLookup.ts` make the
  lookup total; `ConsultPage` uses them.

---

### 2f. The analytics dashboard read four API shapes that do not exist

`AnalyticsPage.tsx` mapped its four headline tiles from `data.patient_metrics`,
`data.appointment_metrics`, `data.cds_metrics` and `data.financial_metrics`,
plus `data.department_metrics[]` and `data.patient_flow[]` for the two charts
below them. `GET /api/platform/analytics/dashboard` has never returned any of
those keys — it returns a flat `metrics` object. Every lookup was `undefined`,
every `|| 0` fallback fired, and the page told an administrator the hospital had
**0 patients, 0 appointments, 0 alerts** against a database holding 7 active
patients and 63 appointments.

Two things kept it alive:

* **A wrong field name renders as a confident zero, not an error.** The tiles
  looked exactly like working tiles. This sat directly beneath the twelve
  fabricated KPIs of §2e, so the page had invented numbers on top and false
  zeros underneath.
* **The test asserted the same fabricated contract.** `AnalyticsPage.test.tsx`
  mocked `patient_metrics`/`appointment_metrics`/`cds_metrics` too, so the test
  and the bug agreed with each other and three assertions passed green.

Fixed by reading the real endpoints (`dashboard` for patients/records,
`appointments` for volume and telehealth share, `quality` for alert counts) and
rewriting the test's mocks from **real captured responses**. The new test names
each figure so a tile can only display it by reading the field the API sends.

Two related honesty fixes went in with it:

* `GET /api/platform/analytics/appointments` now **honours `start_date`/
  `end_date`**. The period selector ("Today / This Week / This Month / This
  Year") previously posted a range the handler bound to `_query` and ignored, so
  every period rendered identical figures. A control that visibly changes
  nothing is worse than no control.
* **Department Performance** and **Patient Flow (24h)** now state that they have
  no data source, instead of rendering an empty chart. Bed occupancy, wait
  times, staffing and hourly admissions need a bed, roster and encounter-flow
  model this deployment does not have. An empty chart reads as "no activity" —
  a far more reassuring claim than "not measured".

A third honesty fix landed with these: the period buttons meant **trailing
windows**, not calendar periods. `getDateRange` returned `[N days ago, today]`
for every option, so "This Year" meant the last 365 days, and -- far worse --
`endDate` was always *today*, which excluded **every appointment scheduled in
the future**. On a booking dashboard that is the wrong half of the data: "This
Year" reported 17 appointments against 44 in the calendar year, under a label
promising the year. Now calendar periods (week starts Monday; month and year run
to their real last day), built from local date parts rather than
`toISOString()`, which shifts the day backwards for any timezone east of UTC and
would hand a SAST clinic yesterday's figures for the first two hours of every
morning. Pinned by a test asserting the request URL carries
`start_date=YYYY-01-01` and `end_date=YYYY-12-31`.

**Lesson, and it is the same one as §2e:** a frontend test whose fixtures were
written from the frontend's own assumptions cannot detect a contract mismatch.
Mock bodies belong in the test *copied from a real response*, not invented
alongside the code that consumes them.

## 2026-08-20 — CLOSED: deactivating a user was a one-way door

`GET /api/users` — the administrator's User Management directory — was served
from `AppState.users`. That collection is the **authorization cache**, hydrated
by `load_demo_users_from_db` with `WHERE is_active = true AND status =
'active'`. Filtering to active accounts is exactly right for deciding *who may
act*; it is exactly wrong for deciding *who exists*. One collection was
answering two different questions.

The consequences, all in the admin workflow:

* A deactivated account vanished from the only list an administrator can see.
* The page's **"Inactive" status filter could never match a row**.
* The **Reactivate** control (`UserManagementPage.tsx:524`) was unreachable dead
  UI — no listed user could ever have `status === 'inactive'`.
* `PUT /api/users/{wallet}` also resolved the target from the cache, so even
  reaching it by hand answered **404 USER_NOT_FOUND** for an account plainly
  sitting in the `users` table. Managing an account is precisely what you need
  when it is *not* active.
* Net effect: **undoing a mistaken deactivation required hand-written SQL
  against production.**

Fixed by separating the two concerns. The directory query now reads the `users`
table directly (all statuses, ordered by creation), and the update handler falls
back to the database when the cache misses. The authorization cache is
unchanged and still active-only.

**Explicitly NOT a bug, checked while here:** authorization itself is sound.
`support::get_user` filters `status == "active"`, so a deactivated account stops
authorizing the moment its status changes — it does not linger until the next
restart. Only the *management* surface was broken, not the gate.

**It was also an N+1.** The old handler looped over the cached users and ran a
separate `SELECT ... FROM user_profiles WHERE u.wallet_address = $1` for *each*
one — 101 sequential round-trips to load one page of a directory that shows 20
rows. The replacement is a single `LEFT JOIN`, so the cost is now one query
regardless of directory size. Worth noting that the N+1 was invisible for the
same reason the one-way door was: nobody could see past page 1, so nobody
noticed the page doing a hundred queries to render twenty rows.

Pinned by `test_pg_user_directory_lists_deactivated_accounts`
(`api/src/repositories/postgres/tests.rs`), which runs the directory query
against a seeded inactive account and asserts it comes back carrying its status.

**The general shape, worth remembering:** a cache built for one purpose gets
reused as a data source for another, and the filter that made it correct for the
first purpose becomes an invisible bug in the second. Ask what a collection was
*hydrated for* before reading from it.

## 2026-08-20 — OPEN, NEEDS AN OWNER DECISION: the node binary links GPL-3.0-only code while declaring MIT

**This is the one item in this file with a legal rather than an engineering
consequence, and it is not something an implementer should decide alone.**

### The facts, measured not assumed

`blockchain/Cargo.toml` declares `license = "MIT"` at workspace level and both
`blockchain/node` and `blockchain/runtime` inherit it via `license.workspace =
true`. Resolving the lockfile against the local registry cache on 2026-08-20:

| graph | GPL **with** Classpath exception (linking permitted) | **strict** GPL-3.0-only, no exception, no permissive alternative |
|---|---|---|
| `medichain-runtime` (the WASM runtime with MediChain's 3 pallets) | 4 | **0** |
| `medichain-node` (the node binary) | 48 | **17** |

The runtime is clean — MIT is accurate there. The node is not. The 17 are
`polkadot-core-primitives`, `polkadot-node-metrics`,
`polkadot-node-network-protocol`, `polkadot-node-primitives`,
`polkadot-node-subsystem-types`, `polkadot-overseer`,
`polkadot-parachain-primitives`, `polkadot-primitives`,
`polkadot-runtime-metrics`, `polkadot-runtime-parachains`,
`polkadot-statement-table`, `staging-xcm`, `staging-xcm-builder`,
`staging-xcm-executor`, `tracing-gum`, `tracing-gum-proc-macro`,
`xcm-procedural`.

### All 17 arrive through exactly one dependency

Shortest paths from `medichain-node`, computed from `blockchain/Cargo.lock`:

```
polkadot-primitives          <- frame-benchmarking-cli
staging-xcm                  <- frame-benchmarking-cli -> cumulus-primitives-core
polkadot-runtime-parachains  <- frame-benchmarking-cli -> frame-storage-access-test-runtime
                                -> cumulus-pallet-parachain-system
tracing-gum                  <- frame-benchmarking-cli -> cumulus-client-parachain-inherent
                                -> cumulus-relay-chain-interface -> polkadot-overseer
```

Every one runs through **`frame-benchmarking-cli`**, which `blockchain/node/Cargo.toml`
lists as an unconditional dependency. It pulls the entire Cumulus / parachain /
XCM stack into a **solo chain that has no parachain and no XCM**, and it is the
reason a release build of this node needs roughly 20 GB (see the note in
`.github/workflows/blockchain-node-release.yml`).

### Why it has not bitten yet

GPL obligations attach on **distribution**, not on internal use, and this node
is not distributed today:

* `blockchain-node-release.yml` uploads the binary as a **workflow artifact**
  scoped to the run, and says in its own header that promoting a build to a real
  release is "a separate, deliberate" step that has not been taken.
* `CLAUDE.md` records that production points at an external node via
  `SUBSTRATE_WS_URL`, and that `blockchain/node/` is not in the production
  Compose profile.
* `publish = false`, so it never reaches crates.io.

So this is a latent problem, not a live breach. It becomes live the moment
anyone promotes that artifact to a release, ships the binary to a hospital
partner, or hands it to the cloud-infrastructure partner as a deliverable.

### The two ways out — owner's call

**Option A — remove the dependency (recommended).** Make
`frame-benchmarking-cli` `optional = true` and activate it only under the
existing `runtime-benchmarks` feature, gating `mod benchmarking`, the
`Subcommand::Benchmark` variant and its `command.rs` arm behind the same `cfg`.
All 17 strict-GPL crates leave the default graph, the binary becomes
MIT-consistent, and the build shrinks enormously.

*Cost, stated plainly:* `medichain-node benchmark …` disappears from a default
build. `benchmark pallet` and `benchmark storage` already refuse to run without
`--features runtime-benchmarks` (`command.rs:136`), so nothing is lost there —
but `benchmark block`, `overhead`, `extrinsic` and `machine` **do** work in a
default build today and would then require the feature flag. That is a removal
of working functionality, which under this project's rule 7 needs explicit
sign-off before it is done.

**Option B — keep the dependency and correct the label.** Set
`blockchain/node/Cargo.toml` to `license = "GPL-3.0-only"` (overriding the
workspace inherit; the runtime and pallets stay MIT, which the table above
shows is accurate). Nothing about the build changes; the metadata simply stops
being wrong, and any future distribution carries the obligations it actually
carries.

**Doing neither is the only option that is actually unsafe**, because the
current state is a binary whose declared licence does not match what it links.

### What was done in the meantime

Nothing that presumes the decision. A supply-chain gate was added so this can
never again go unobserved: see the next entry.

---

## 2026-08-20 — CLOSED: the blockchain workspace had no supply-chain scanning at all

`cargo-deny` ran only from the repository root, so it saw only the root
workspace. `blockchain/` is a **separate** cargo workspace with its own
`Cargo.lock`, which meant its **1171 locked dependencies — the whole Substrate
networking, consensus and crypto stack, including the code that signs blocks —
had no advisory, licence, or source scanning whatsoever**, while the API's much
smaller tree was fully covered. This is precisely the workspace-scoping trap
`.github/workflows/ci.yml` already documents for the test job; the supply-chain
job had the same hole and nobody had noticed because the job was green.

Closed by adding `blockchain/deny.toml` and two steps to the `supply-chain` job:

* **`sources` — enforced.** Verified clean at the time of writing: 1166 packages
  resolve from the crates.io registry, **zero** from any git source, and there is
  no reference anywhere to the pre-monorepo `paritytech/substrate` repository. A
  git or vendored source appearing in the tree that builds the block-signing node
  is exactly the supply-chain entry point worth blocking on.
* **`licenses` + `advisories` + `bans` — report-only.** The licence allow-list
  was derived offline from 1074 of the 1171 locked packages (97 were not in the
  local registry cache), so it is a discovery gate until a full CI run confirms
  it is complete. Advisories match the root workspace's report-only posture: the
  Substrate tree carries upstream advisories this project cannot patch.

Note also a stale justification found in the **root** `deny.toml`: the ignore for
`RUSTSEC-2022-0061` (parity-wasm) is reasoned as "MediChain's Substrate node
(`node/`) is a stub — no pallet WASM is actually compiled or executed by this
codebase today". That stopped being true on 2026-08-11, when the node began
building and producing a real dev chain. The ignore may still be defensible; the
stated reason for it is not.

## 2026-08-20 — the recurring "unreadable UI" reports were one setting, not many bugs

Dark mode has been reported as a scatter of unrelated readability complaints
across several sessions. It is one line.

`themeStore.ts` defaulted to `theme: 'system'`, and it correctly applies the
`dark` class to `<html>` when the operating system asks for it. What does not
exist is the dark theme:

| surface | pages with any `dark:` variant |
|---|---|
| doctor-portal pages | **4 of 152** |
| shared components | 3 of 13 |
| patient-app pages | **0 of 53** |

So every user whose OS is set to dark — a large share of them — was handed a
dark shell wrapped around light-only content on first load, without ever
opening Settings: pale grey labels on near-white cards floating in a dark page,
on clinical screens. Nobody chose it, which is exactly why it kept being
reported as random rather than as a setting.

Fixed by defaulting to the theme that actually exists (`'light'`) and labelling
the Settings control honestly, so choosing dark is an informed decision rather
than something that happens to a clinician. The toggle still works; real dark
mode is now a scheduled piece of work rather than an implied promise.

### The contrast defects underneath it were real in light mode too

Measured, not eyeballed. The analytics operational panel — added the *same day*,
in the change that replaced fabricated KPIs with honest ones — used
`text-gray-400` on `bg-gray-50` for the "No data source" label and for the em
dash standing in for an absent metric: **2.43:1**, against WCAG 2.2 AA's 4.5:1.
It does not clear even the 3:1 large-text bar, so no font-size argument rescues
it. Absent data should be *unemphasised*, not *illegible*; conflating the two is
how a reader mistakes "not measured" for "nothing is wrong here".

Urgency on "Unacknowledged critical values" — the most time-critical number on
that page — was carried by `text-red-700` alone. Hue as the only channel is
invisible to a reader with deuteranopia or protanopia. It now also carries an
icon and a left border.

**The gate that stops this recurring:** `client/shared/src/utils/contrast.ts`
(WCAG relative-luminance arithmetic) plus a test that asserts every pairing used
on a clinical surface clears AA — *and* pins the failing combinations as
failing, so a future "tidy the palette back to lighter greys" reintroduces the
defect loudly instead of silently.

Note what caught this: a screenshot, not a test suite. The placeholder audit
read `BEHAVIOURAL 0` throughout, and every automated gate was green.

### A layout defect on the same screens

`UserManagementPage` rendered its detail block as `grid-cols-4`, fixed at every
breakpoint, with no `min-w-0` on the cells. A CSS Grid track cannot shrink below
its content's intrinsic width without `min-w-0`, and an SS58 wallet address is
48 unbreakable characters — so the first column pushed past its share and all
four values rendered on top of each other. Now responsive, with `break-all` and
a monospaced face (a transposed character in a proportional-type address is
genuinely hard to spot).

### Related finding: `client/shared` has no test runner

It holds credential derivation, the keystore envelope and 130+ API functions,
and its `package.json` defines only `lint` and `typecheck`. Any test placed
there silently never runs — which is why the contrast test lives in
`doctor-portal` and imports the utility from `shared`. Adding a runner to
`shared` is worth doing on its own merits.

## 2026-08-20 — CLOSED: the audit outbox was entirely in-process

`AuditOutbox::record` writes to an in-process `RwLock<HashMap>` and nothing
else. `AuditOutbox::record_durable` writes the same event **and** persists it to
`audit_outbox_events`. It was written, correct, complete — and had **zero
callers**.

All 14 call sites used `record`, every one of them discarding the result with
`let _ =`:

| surface | sites |
|---|---|
| access-control changes | 4 |
| RBAC changes | 3 |
| emergency grants | 2 |
| emergency break-glass access | 1 |
| device lifecycle | 1 |
| identity claims | 1 |
| mobile record access | 1 |
| registries | 1 |

So every one of those audit events lived only in process memory: **gone on every
deploy or restart**, with a failed write reported to nobody. For break-glass
emergency access — the single most audit-sensitive operation in this product —
the outbox event did not survive the process that created it.

This is the project's signature defect class (a successful write no reader can
see) sitting in the audit path, and it hid the same way the others did: the
method name reads like it persists, the call compiles, nothing errors, and the
in-memory copy makes it look correct for the lifetime of the process you are
testing in.

Closed by rewiring all 14 sites to `record_durable(data.db_pool.as_ref(), …)`
and surfacing failures via `log::error!` instead of discarding them. Pinned by
`test_pg_audit_outbox_event_survives_a_restart`, which persists an event, builds
a **fresh** outbox to stand in for the process after a restart, asserts that
fresh instance is empty, and then reads the event back out of PostgreSQL — so
the test cannot pass on the in-memory copy. A second test asserts a malformed
event is refused rather than silently recorded.

**Note on a correction:** an earlier read of this session assumed `audit_outbox`
was an alternative to writing `access_logs`, and that the new telehealth-join
audit should have gone through it. That was wrong. `access_logs` is the
queryable access trail and is the correct home for the join row; the outbox is a
separate privacy-minimised event stream for chain anchoring and delivery. They
are complementary. The real defect was durability, not routing.

## 2026-08-20 — a gate that asks the narrower authorization question

`check-endpoint-auth.py` asks *"is there an authorization decision in this
handler"*. It cannot see a decision that is present and too permissive. It
counted the telehealth recording endpoint as properly authorized at tier 3 while
`is_healthcare_provider()` — true for Pharmacist and LabTechnician — was letting
a pharmacist start recording a patient's consultation.

`scripts/check-write-authorization.py` asks the question that would have caught
it: **does a state-changing handler rely only on the widest clinical
predicate?** A read gated on "any clinical staff" is usually fine. A write gated
on it is a claim that a pharmacist, a lab technician, a nurse and a doctor
should all be able to perform that action — sometimes true, but it needs to have
been *decided* rather than inherited.

Findings on first run: 49 reads on the broad predicate (fine), and **23 writes**.
Thirteen were reviewed and accepted with a written reason (drug-interaction
checks — where a pharmacist is the *most* appropriate caller, not the least;
insurance and scheduling actions that carry no clinical authority; sample
history, where a LabTechnician is the intended caller). Seven more were already
narrowing elsewhere in the handler.

**Three are escalated, not accepted.** They are printed on every run and moving
one out requires writing down an answer:

| endpoint | the question |
|---|---|
| `POST /api/emergency-access` | Break-glass bypasses consent to reveal the emergency capsule. Only the treating roles, or any clinical staff? Paramedics map to `Nurse` here. |
| `POST /api/emergency/nfc-token` | Mints the one-time break-glass token. Must be answered *together* with the above or the two will drift apart. |
| `POST /api/nfc/generate` | Issues a patient identity credential. Identity issuance is usually a registration authority, not a clinical role. |

These are clinical-policy calls, and narrowing authorization silently can break
a legitimate workflow just as surely as leaving it wide can permit a wrong one.
The escalation list exists so the risk is *known* rather than either quietly
accepted or quietly changed.

**Design note:** the script separates `REVIEWED` (decided, with the reason
recorded beside it) from `ESCALATED` (deliberately surfaced, awaiting a
decision). Only handlers in neither list fail the build. An allowlist without
reasons becomes a place to hide things, which is why every entry carries one.

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

179 tables exist in a freshly migrated database (47 migration files as of
2026-08-11). Whether all are reachable from live code is unknown. Worth a systematic pass at cleanup time: cross-reference
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
  `cargo clean`. (2026-08-11: not a constraint in this session — a full
  `cargo build --release` plus the whole test suite completed with ~22 GiB
  free. The claim in earlier notes that Postgres tests could not run locally
  was wrong for a different reason: a `medichain_postgres` container is
  published on :5432 and the tests connect to it by default.)
- ~~The API's default port (8080) collides with the documented IPFS gateway port~~
  — **RESOLVED 2026-07-31.** The API's default is now **8090**
  (`api/src/main.rs`); Docker pins `PORT: 8080` explicitly (its own container
  namespace, where nginx proxies to `api:8080`). Both Vite proxies, the dev/test
  scripts, and the docs were moved to 8090 in the same pass. This had already
  caused two misdiagnoses (a 404 read as "the API is still running", and an IPFS
  download failure that looked like a missing record).
- ~~**`patient_access` (Consent Management access grants/requests) is in-memory
  only.**~~ — **RESOLVED.** `PatientAccessRepository` with memory and PostgreSQL
  implementations, migration `20260809000001_patient_access.sql`, and the state
  machine extracted into `PatientAccessService`. Three restart tests
  (`test_pg_patient_access_grant_survives_restart`,
  `test_pg_revocation_survives_restart`, `test_pg_denial_survives_restart`)
  pass against a live PostgreSQL 16. The surgical document stores named
  alongside it were closed in the 2026-08-11 durability pass; `emergency_grants`
  and `mobile_records` remain in-process (P1 item 2 of the feature audit).

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

---

## Resolved in the 2026-08-11 pass

### 24 vestigial `AppState` maps removed

Every one had had its handler migrated to a repository, leaving the field
behind. Verified dead by a crate-wide search for `.<field>` — including test
code — before removal, and by `scripts/check-state-durability.py` reporting
zero live references.

Removed: `user_settings`, `sample_histories`, `code_blue_records`,
`trauma_assessments`, `stroke_assessments`, `cardiac_events`,
`sepsis_assessments`, `psych_assessments`, `tox_assessments`,
`laceration_records`, `consult_notes`, `immunization_schedules`,
`family_histories`, `crossmatch_records`, `transfusion_records`,
`e_prescriptions`, `death_certificates`, `family_link_requests`,
`provider_schedules`, `device_checks`, `waiting_room`, `supported_languages`,
`sync_statuses`, `sync_queue`.

`state.rs` fell from 1079 to 979 lines (24 declarations + 48 initialisers).

### `rate_limit.rs` — the question the register asked, answered

The register said the dead-code flags there were "a finding rather than a
cleanup" and asked whether rate limiting is enforced at all. **It is.**

`cargo clippy --bin medichain-api` reports **zero** dead code in that module;
only `--all-targets` reports five. The difference is that `cargo test` on a
binary crate substitutes its own harness `main`, so everything reachable only
from the real `main` — including `.wrap(rate_limit)` at `main.rs:533` — looks
unreachable under `cfg(test)`. The middleware is live in the shipped binary.

Recorded in the module as `#![cfg_attr(test, allow(dead_code))]`, scoped to
test builds so genuine dead code there is still reported for the real binary.

### `key_management.rs` — already gone

The register lists this module as entirely unused and asks whether it was a
planned envelope-encryption path. The file no longer exists; it was removed in
an earlier pass. `encryption_keyring.rs` is the live implementation. Entry kept
only so the next reader does not go looking for it.

### `get_default_supported_languages` — removed, and a real defect behind it

This helper fed only the (now removed) `supported_languages` map. Deleting it
exposed that the platform had **three disagreeing lists of supported
languages**:

| Source | Languages |
|---|---|
| `GET /api/platform/languages` | en, sw, fr, am, zu, **xh**, **pt** |
| the helper | en, zu, **xh** |
| `ACTIVE_LOCALES` + `i18n/locales/` (what actually ships) | en-US, fr-FR, sw-KE, am-ET, zu-ZA, **ha-NG** |

So the API advertised Xhosa and Portuguese, for which no translation bundle
exists — a patient selecting either got an untranslated interface — while
hiding Hausa, which is fully translated. The endpoint now returns exactly the
six locales that have bundles, using the full BCP 47 tags the client switches
on rather than bare subtags it would have had to guess at.

### Unmapped enum values render `undefined` as a component — CLOSED 2026-08-20

Closed with `lookupOr` / `componentOr` in
`client/shared/src/utils/enumLookup.ts`, used by `ConsultPage`'s status icon and
both badge maps. A repository-wide scan for the same shape — a map of components
indexed by a runtime value — found this to be the only live instance, so the
"appears on several pages" note below was an over-estimate.

The original write-up, for the reasoning:

Found 2026-08-11 while repairing `ConsultPage.test.tsx`. `ConsultPage.tsx`
looks an icon up by status:

```ts
const icons = { requested: Clock, acknowledged: AlertCircle, ... };
return icons[status];
```

A status not in that map returns `undefined`, and rendering `undefined` as a
JSX element throws *"Element type is invalid"* — which unmounts the whole page,
not just the badge. The test fixture used `status: 'pending'` and the page went
blank.

`ConsultStatus` is a TypeScript union, so this cannot happen from code that
type-checks. It **can** happen from data: the value arrives from the API, and
`as Consult[]` at `ConsultPage.tsx:121` asserts the shape without validating
it. Any status the backend adds — or any older record — blanks the page for
that clinician.

Not fixed here because the same `icons[x]` pattern appears on several pages and
the right fix is one shared helper with a fallback icon, not a local patch.
Worth doing before launch: a blank consult list is indistinguishable from
"no consults", which is the failure mode this codebase has repeatedly been
bitten by.

---

## Burn TBSA uses Rule of 9s where paediatric burns need Lund-Browder

**Where:** `client/doctor-portal/src/pages/BurnPage.tsx` — `bodyRegions` (line ~85)
and the `isChild` toggle (line ~113, applied at line ~588).

The chart is Rule of 9s throughout: anterior trunk is charted as chest 9% +
abdomen 9% = 18%, each whole limb as 9%, head as 4.5% front + 4.5% back. The
paediatric adjustment is a single boolean that swaps `adultPercentage` for
`childPercentage`.

Two problems:

1. **A boolean is not an age.** Body proportions change continuously through
   childhood — Lund-Browder bands at 0, 1, 5, 10 and 15 years. A newborn's head
   is ~19% TBSA, a five-year-old's ~13%, an adult's ~7%. One "is a child"
   checkbox cannot express that, so every child between the bands is charted
   with the wrong denominator.
2. **TBSA drives fluid resuscitation.** The page feeds the Parkland formula
   (4 mL × kg × %TBSA). A TBSA error is a fluid-volume error in a burned child,
   which is the population least able to tolerate either under- or
   over-resuscitation.

**Why it was not fixed in place:** Lund-Browder is not a different set of
numbers for the same regions — it is a different region set. It splits the limbs
(upper arm / forearm / hand, thigh / lower leg / foot) and charts the trunk as
13% anterior and 13% posterior, against Rule of 9s' 18% and 18%. Substituting
Lund-Browder percentages into the current 13 Rule-of-9s regions produces a chart
that no longer totals 100%, which is worse than either method used consistently.

**The fix:** replace `bodyRegions` with the Lund-Browder region set and replace
`isChild: boolean` with an age band (`0 | 1 | 5 | 10 | 15 | 'adult'`), derived
from the patient's date of birth where one is on file. This changes the clinical
model of the page, so it wants a deliberate decision rather than a drive-by edit.

`BurnPage.test.tsx` asserts against the Rule of 9s wording the page actually
shows, so the tests will need updating alongside.

---

## Laceration suture material was a hardcoded default

**Where:** `client/doctor-portal/src/pages/LacerationRepairPage.tsx`

**Fixed 2026-08-11**, recorded because the failure mode is worth recognising
elsewhere. `newRepair` initialised `sutureType: '4-0 Nylon'` and the form had no
control for it, so every laceration repair was filed as 4-0 nylon regardless of
what was used — and the backend does persist it (`suture_material` /
`suture_size` in `api/src/repositories/traits.rs`). Material and gauge set the
removal interval, so a wrong value misdirects the follow-up visit.

This is the same shape as the AMA `patientSigned: true` defect: a plausible
default in initial state, no UI to change it, and a backend that faithfully
stores the fiction. Worth grepping initial-state objects for other fields that
have a default but no control.

---

## `911` was hardcoded in a product that ships to five African countries

**Fixed 2026-08-11.** Found by `scripts/check-uncontrolled-defaults.py`.

`911` is the North American emergency number. It connects to nothing in any
country this product targets. It appeared in four places:

| Where | What it did |
|---|---|
| `patient-app/src/pages/SymptomCheckerPage.tsx` | `href="tel:911"` — a live dial link shown when triage returns **emergency** or **urgent** |
| `shared/.../en-US.ts` `symptomChecker.call911` | the button's label |
| `shared/.../en-US.ts` `symptomChecker.disclaimerBody` | "In case of emergency, call 911 immediately" |
| `doctor-portal/src/pages/DischargePage.tsx` | the default `emergency_instructions`, written into `emergency_contact_instructions` on **every** discharge summary |

The `tel:` link is the worst of the four: it is offered precisely when the
symptom checker has decided the patient may be having an emergency, so the
failure lands on the patient least able to absorb it.

**Fix:** `common.emergencyNumber` per locale, deep-merged over `en-US` by the
existing `I18nProvider`, and interpolated into the three strings:

| Locale | Number |
|---|---|
| `zu-ZA` South Africa | 10177 (ambulance; 112 from any mobile) |
| `sw-KE` Kenya | 999 (112 from any mobile) |
| `ha-NG` Nigeria | 112 |
| `am-ET` Ethiopia | 907 |
| `fr-FR` France | 15 (SAMU) |
| `en-US` | 911 |

112 is GSM-mandated and routes to local services from any mobile handset, which
is why it is the safe fallback where a national line is ambiguous.

**Watch for:** any new user-facing emergency guidance. The number belongs in the
locale bundle, never in a component or an English string.

---

## Form fields with a default and no control

`scripts/check-uncontrolled-defaults.py` (added 2026-08-11) reports fields
initialised in `useState({...})` with an assertive value — a non-empty string,
a non-zero number, or `true` — that no control ever writes to. Those values are
submitted verbatim on every save, so the record states something nobody entered.

Three real defects had this exact shape:

* `AMAPage` — `patientSigned: true` on a record simultaneously marked
  `pending-signatures` (fixed earlier).
* `LacerationRepairPage` — `sutureType: '4-0 Nylon'` (fixed; see above).
* `AppointmentSchedulerPage` — `appointment_type: 'consultation'` with no
  selector, so every appointment booked was filed as a consultation. **Fixed
  2026-08-11** by adding the type selector.

**The check is a review aid, not a gate**, for two reasons. It cannot see
computed-key updates (`setMse({ ...mse, [field.key]: v })`), which is how
`PsychPage` writes its nine mental-status fields — nine false alarms until the
script learned to skip files that write state through a computed key. And
deciding whether a default is a lie needs judgement about the field:
`MCIPage`'s `category: 'immediate'` looks identical to the script but is
deliberate, because over-triage is the safe error in a mass-casualty incident
and `updatePatientCategory` lets responders correct it.

Still open, judged low-risk: `CDSAlertsPage.evidenceLevel: 'B'` asserts a
literature-evidence grade for every authored rule. It is rule-authoring
metadata rather than patient data, but a rule claiming evidence level B it does
not have is still a claim.

---

## Wallet-vs-record-id namespace bug: three more sites

**Fixed 2026-08-12.** Found by repairing the synthetic e2e harness.

`support::caller_owns_patient_record` documents that 26 handlers once compared
`current_user_id` (an SS58 wallet) against `patient_id` (a `PAT-…` record id) —
two namespaces that are never equal for a real patient account, so every such
guard denied the patient their own data. That sweep missed three sites:

| Site | Effect |
|---|---|
| `handlers/ipfs_records.rs` (two checks) | A patient could **never download their own medical record** — 403 `ACCESS_DENIED` every time. |
| `clinical_endpoints/engagement/symptoms.rs` | A patient could not read their own symptom-checker session. |
| `clinical_endpoints/workflow/messaging.rs` | A patient's logged symptom was **filed under their wallet** while `GET /api/symptoms/{patient_id}` reads by record id — so a patient logged a symptom and it vanished from their own history. |

The first three fail closed (denial, not disclosure). The messaging one is a
silent data-loss bug: the write succeeded, returned 201, and the entry was
simply unreachable afterwards.

**Why the sweep missed them:** all three read naturally. `entity.patient_id !=
current_user_id` looks like an ownership check, and it *is* one — just between
the wrong pair of identifiers. Grep for the shape, not the intent:

```
grep -rn "patient_id != current_user_id\|patient_id == current_user_id" api/src/
```

That still returns matches in `billing/e_prescriptions.rs`,
`clinical_support/telehealth.rs`, `engagement/appointments.rs` and
`engagement/family.rs`. Each needs reading before changing — some compare
against ids that genuinely *are* wallets (family group members, telehealth
provider ids), so a blanket replacement would break them. They are not known to
be wrong; they are unexamined.

---

## The synthetic e2e harness had drifted three contracts behind

**Fixed 2026-08-12.** The harness reported 59 pass / 102 fail. None of it was a
product regression — the product had grown four security requirements the
harness never learned:

1. **Accounts start `pending`.** `support::get_user` resolves only `active`
   users, so an admin-created doctor is refused 401 `USER_NOT_FOUND` until
   activated via `PUT /api/users/{wallet}`. The harness never activated
   anything, so ~100 assertions failed looking like authorization bugs.
2. **Callers are wallets, not patient ids.** The harness passed `PAT-…` as
   `X-User-Id` for every "patient does X" assertion. It now provisions a real
   wallet per synthetic patient — register, activate, claim identity — which is
   what the product actually expects.
3. **Break-glass needs a responder, a device and a reason.**
   `POST /api/emergency/nfc-token` requires an authenticated healthcare
   responder plus `device_id` and `reason_code`, and the device must be enrolled
   **and rotated** (`can_access` demands `current_key_id.is_some()`, which a
   freshly enrolled device does not have).
4. **Emergency tokens are one-time Bearer credentials.** They go in the
   `Authorization` header, not `?token=`, and the lock-screen read needs its own
   token because the card read spends the first. That the reuse was refused is
   the replay protection working.

**Result: 59 → 170 passing.** The three product defects above were found only
because fixing the harness exposed them; while it was 102-failures-red, a real
regression would have been invisible in the noise.

**Keep it honest:** this harness is only meaningful against a **fresh** server.
It is not idempotent — a second run against the same instance sees 409s on
bootstrap, never captures the admin wallet, and cascades into false failures.
Restart the API between runs.

---

## Windows: a running `.exe` cannot be replaced, so `cargo build` keeps the old one

**Process note, 2026-08-12.** Twice during the e2e work a fix appeared not to
take effect. Both times the code was correct and the binary was stale: the API
was running, Windows held a lock on `target/debug/medichain-api.exe`, and
`cargo build` could not overwrite it. The build reported success — it had
compiled everything, it just could not link over the locked file — so there was
no error to notice.

The tell is a `Finished` line with a binary whose mtime predates the edit:

```bash
ls -la target/debug/medichain-api.exe   # compare mtime against your edit
```

Always stop the server before rebuilding:

```bash
taskkill //F //IM medichain-api.exe ; cargo build --bin medichain-api
```

This wastes a lot of time when the symptom is "my authorization fix did not
work", because that is indistinguishable from a wrong fix.

## Superseded wound-assessment mapper (2026-08-19)

`clinical_endpoints::emergency::mod::wound_assessment_entity` is now dead code,
marked `#[allow(dead_code)]` rather than deleted.

It mapped the deeply structured `clinical::WoundAssessment` (nested
`WoundLocation`/`WoundBed`/`WoundDrainage`/`WoundTreatment`) into the storage
entity, and hardcoded `length_cm`, `width_cm` and `depth_cm` to `None` — so
wound measurements were discarded even when supplied. The wound-care form could
never produce that structure in the first place, which is why its Save button
was never wired up at all.

`management::create_wound` now takes a flat `CreateWoundRequest` matching what
the form submits and persists the measurements. Remove the old mapper once
someone confirms nothing else intends to use the structured shape.

## Uninterpolated i18n placeholders (2026-08-19)

Patient pickers render `Health ID: {{id}}` because the call site passes no `id`
variable to `t()`. The translator returns the key's raw text when a variable is
missing, so the braces reach the screen. Worth a lint that fails when a rendered
string still contains `{{`.

## Test schemas are never dropped (2026-08-19)

28 `medichain_test_*` schemas were present again and the dev database had grown
to 815 MB. Test teardown creates them and does not drop them; a previous cleanup
took the database from 1.4 GB to 624 MB and the leak simply recurred.


## Superseded structured mappers (2026-08-19, round two)

`io_record_entity`, `nursing_care_plan_entity` and `incident_report_entity` in
`clinical_endpoints::emergency::mod` are dead code, marked `#[allow(dead_code)]`
rather than deleted, alongside `wound_assessment_entity` recorded above.

Each mapped a deeply structured `clinical::*` type that the corresponding form
could not produce, which is why those endpoints rejected or dropped real
submissions. `incident_report_entity` additionally hardcoded
`severity: "reported"`, discarding the reporter's chosen severity. The handlers
now take DTOs matching the actual form bodies.

Remove them once someone confirms nothing intends to use the structured shapes.

## `Pagination::default()` means "return nothing" (2026-08-26)

`Pagination` derives `Default`, which gives `page: 0, per_page: 0`. `limit()`
returns `per_page.min(MAX_PER_PAGE)` — so 0 — and every paginated repository
read then applies `.take(0)`. The call returns an empty `items` list with an
accurate non-zero `total`, which reads exactly like "this patient has no
records" rather than like a bug.

No production call site uses it: the only occurrence in the tree was a test
written on 2026-08-26, which failed for precisely this reason and cost time to
diagnose. It is recorded rather than fixed because the safe change is a
behavioural one to a shared type, and this register is where those wait.

The options, when someone picks it up: make `Default` return a usable first page
(`per_page: 50`), or drop the derive so callers must state a page size. Dropping
it is the stricter choice and, with one call site, the cheaper one.
