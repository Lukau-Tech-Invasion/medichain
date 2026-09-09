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

Last updated: 2026-09-10.

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

## Burn TBSA uses Rule of 9s where paediatric burns need Lund-Browder (CLOSED 2026-09-09)

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

**The form-state half is a review aid, not a gate**, for two reasons. It cannot
see computed-key updates (`setMse({ ...mse, [field.key]: v })`), which is how
`PsychPage` writes its nine mental-status fields — nine false alarms until the
script learned to skip files that write state through a computed key. And
deciding whether a default is a lie needs judgement about the field:
`MCIPage`'s `category: 'immediate'` looks identical to the script but is
deliberate, because over-triage is the safe error in a mass-casualty incident
and `updatePatientCategory` lets responders correct it.

`CDSAlertsPage.evidenceLevel: 'B'` was recorded here as still open. **It has a
control now** — a bound field at `CDSAlertsPage.tsx:898` — so the value is
visible and editable, and the script correctly stopped reporting it. The
initial value is still `'B'`, which is a pre-filled evidence grade rather than
an asserted one; that is rule-authoring metadata and a materially lower-stakes
call than the clinical defaults above.

---

### The blind spot, and the gate that closes it (2026-09-09)

`useState` was the wrong place to look, or rather it was only half of it. **The
worse instances are literals in the object a page POSTs**, which are not state
at all, and this script scanned past all sixteen of them:

| Page | Asserted, with no control | What that means |
|---|---|---|
| `PediatricsPage` | `hr`/`rr`/`temp_interpretation: 'Normal'` | every child's vitals, including a tachycardic infant's |
| | `pain: { score: 0 }` | no pain, on a child nobody asked |
| | `immunizations: 'Up to date'` | a complete schedule for every child |
| | `abuse_screening: { concerns: false }` | **a child-protection screen recorded as finding no concerns, when none was performed** |
| | `guardian_present: true`, `weight_method: 'Measured'` | |
| `TraumaPage` | `vital_signs: {bp:"120/80", hr:80, rr:16, spo2:98}` | textbook-normal observations on a patient who may be shocked |
| `CodeBluePage` | `location: 'Emergency Department'` | every code, wherever it was actually called |
| `BloodBankPage` | `bloodType: 'Unknown'` | while the patient record held the type |

All sixteen were found by hand, page by page. That is not a repeatable method.

**The payload scan is now a gate** — exit 1 on anything new, against a baseline
of thirteen triaged entries, each carrying the reason it is true of every record
the page files. Most are lifecycle states (`status: 'requested'` on a new
consult), which is the one shape that is legitimately constant.

Three things made it work where a naive version would not:

* **It recurses.** Seven of the sixteen were nested one level down —
  `vital_signs.bp`, `abuse_screening.concerns`, `pain.score` — and the
  form-state scan only ever walked depth 0.
* **It scans payloads, not every object literal.** It follows the local that is
  actually passed to a `create*`/`update*` call, so an unrelated literal is not
  reported.
* **`false` and `0` count here.** In form state they are a blank to be filled
  in; in a payload they are a negative assertion, which is exactly what
  `abuse_screening: { concerns: false }` was. The whole tree yields three, all
  of them the AMA signature flags, all correct.

**Replayed against the pre-fix tree it reports all sixteen.** That replay is the
only reason to trust it — a detector for a class you have already cleaned up
reports nothing either way, and proves nothing. It was also self-falsified
forward: reintroducing `immunizations: 'Up to date'` failed the gate on that
exact line, and removing it passed again.

The gate found one defect on its first real run that the by-hand pass had
missed: `BloodBankPage` filed every blood-product order with
`bloodType: 'Unknown'` while `patient` sat in scope holding the real value.
Blood type is what the crossmatch is against. It reads
`patient.emergency_info.blood_type` now, falling back to `'Unknown'` only when
the profile genuinely has none — which is a real state, and the reason the order
needs a type-and-screen first.

One baseline entry is marked **worth a second look** rather than settled:
`ChainOfCustodyPage.integrityVerified: true` at collection. It is defensible —
the collector applies the seal on that same form — but a chain-of-custody record
is a legal document and the form never asks. The transfer path does it properly,
from `transfer.sealIntact`.

**Still not seen:** a payload assembled by spread or by a helper rather than
written as one literal, and a value read from state that is itself wrong. The
literal is the signal.

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

## Uninterpolated i18n placeholders (2026-08-19, CLOSED 2026-09-09)

Patient pickers rendered `Health ID: {{id}}` because the call site passed no
`id` variable to `t()`. The translator returns the key's raw text when a
variable is missing, so the braces reached the screen.

**The lint this entry asked for exists**: `scripts/check-uninterpolated-i18n.py`,
wired into CI. It reports zero across 125 components and 404 interpolating
strings — the original defects had been fixed, and nothing had stopped them
coming back.

It is namespace-scoped, which is the whole difficulty. A naive scan matching key
*names* across the bundle reports **72 false positives**, because `approved`,
`patientLabel` and `tabHistory` exist in a dozen namespaces and only some of
them interpolate. Scoping the lookup to the namespace the call names takes that
to zero.

Two cases it deliberately does not guess at, documented in the script:

* a call passing a variables object with the **wrong** key
  (`t('x.y', { name })` against `{{patientName}}`) — the object is present, so
  the shape looks right;
* a key built at runtime (``t(`docFoo.status_${s}`)``), which is how several
  enum labels render.

Self-falsified before being trusted: removing the variables from one live call
site made it fail with that exact line, and it passed again once restored.

## Test schemas are never dropped (2026-08-19, ALREADY FIXED - entry was stale)

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

## `Pagination::default()` means "return nothing" (2026-08-26, CLOSED 2026-09-09)

`Pagination` derives `Default`, which gives `page: 0, per_page: 0`. `limit()`
returns `per_page.min(MAX_PER_PAGE)` — so 0 — and every paginated repository
read then applies `.take(0)`. The call returns an empty `items` list with an
accurate non-zero `total`, which reads exactly like "this patient has no
records" rather than like a bug.

No production call site uses it: the only occurrence in the tree was a test
written on 2026-08-26, which failed for precisely this reason and cost time to
diagnose. It is recorded rather than fixed because the safe change is a
behavioural one to a shared type, and this register is where those wait.

**Resolved by dropping the derive**, which was the stricter of the two options
and, with one call site, the cheaper. `Pagination::first_page(size)` covers "the
first screenful" without inventing a silent constant — there is no page size
that is right by default, and `new(page, size)` makes every caller say which it
wants.

## `connectWallet()` hardcodes demo mode and has no callers (2026-08-26, CLOSED 2026-09-09)

`client/shared/src/wallet/service.ts` contains:

```ts
export async function connectWallet(address?: SubstrateAddress) {
  // Check if we are in demo mode
  const IS_DEMO = true; // Should come from config
  if (!IS_DEMO) {
    const accounts = await connectRealWallet();
    ...
```

`IS_DEMO` is a local constant set to `true`, so the real-extension branch is
unreachable and the function always falls through to the simulator lookup
(`getAccount(address)` against locally stored accounts), storing the result as
the current wallet with no extension involvement and no signature.

**It is not a live authentication bypass.** The function has zero callers: every
apparent hit across both portals is an i18n string (`auth.connectWallet`) or a
`title` attribute, not this import. Sign-in goes through `signMessage()` in the
same file, which does perform the correct ordering — `web3Enable('MediChain')`,
extension check, `web3Accounts()`, `web3FromSource(account.meta.source)`,
`signRaw` — and the server issues no JWT without a verified sr25519 challenge.

It is recorded rather than deleted because this register is where removals wait
until the app is finished, and because deleting code needs the owner's
confirmation. Two things made it worth doing early:

* a hardcoded `IS_DEMO = true` sitting in the same module as the real signing
  path is exactly the shape that gets copied into something live;
* `scripts/check-uncontrolled-defaults.py` does not currently flag it, so the
  gate that exists for this defect class has a blind spot worth closing at the
  same time.

**The first is fixed (2026-09-09).** `config.ts` already exported a real
`IS_DEMO`, reading `VITE_DEMO_MODE` and defaulting to **false**; the local
constant was shadowing it for no reason. `service.ts` imports the real one now,
so the extension branch is reachable and a production build takes it. The
function still has no callers and is still not deleted — that needs the owner's
confirmation, and it is now inert rather than quietly wrong.

**The second is still open.** `check-uncontrolled-defaults.py` scans
`useState({...})` initialisers and cannot see a bare `const X = true` inside a
function body, so this defect class has a blind spot the size of every module-
level and function-level constant in the codebase.

---

## The browser suites run, and the sign-in diagnosis was wrong (2026-09-09, round three)

The entry above ends with "compare the `identifier` the browser posts to
`/auth/staff/login` against the one `enrolCredentials` stored". Doing that found
nothing to compare, because the premise was wrong.

`STAFF_LOGIN_UNKNOWN identifier_hash=…`, the same hash every time, was the
suite's own negative test:

```ts
// login.spec.ts — "should show error for invalid credentials"
await page.locator('input#identifier').fill('no.such.person');
```

One identifier, posted once per run, hashing to one value. It was evidence that
the suite was working, read as evidence that it was broken. **A log line that
recurs identically is as likely to be one deliberate caller as one broken one**,
and the way to tell is to look for a caller that would produce it.

**What was actually wrong was the database, and it was upstream of the browser.**
`GET /api/auth/demo-credentials` answered:

```
503  {"code":"AUTH_STORAGE_REQUIRED"}
```

`data.db_pool` was `None`. The API had come up before PostgreSQL was accepting
connections, exhausted its twelve retries, printed its `[DEGRADED]` banner and
fallen back to **empty in-memory storage** — which is the documented demo-mode
behaviour and is loud in the log, but leaves a stack whose containers are all
`healthy` and whose every credential is gone. Restarting the API alone fixed it.

With a database behind it the suites pass: **50 of 51**, and the one failure is a
real contrast defect recorded below rather than anything to do with sign-in. The
`playwright.local-api.config.ts` from the entry above is what makes this
runnable; `scripts/run-browser-e2e-api.sh` is new and assembles the four
environment variables that were the actual barrier to anyone running it —
PostgreSQL, `MEDICHAIN_DEV_MODE`, `DISPENSING_POLICY_PATH`, and an
`ENCRYPTION_KEYS` matching whatever sealed the rows already in that database.

The rate limiter did not bite. A full serial run is 7.7 minutes for 51 tests, and
the 60/minute anonymous bucket was never the constraint it was recorded as; the
46 refusals in the earlier run were a re-run inside a window that had already
been spent.

---

## An idle connection held the migration lock, and the test suite stopped dead (2026-09-09)

The API test run hung at 387 of 591 tests. Not slow — stopped, with one backend
waiting:

```
 pid  | state  | wait_event_type | wait_event |              query
 1004 | active | Lock            | advisory   | SELECT pg_advisory_lock($1)
  822 | idle   |                 |            | SELECT * FROM appointments ORDER BY ...
```

PID 822 held the lock and was **idle**. It belonged to the API container, whose
image predated three migrations added that day, so its migration chain failed:

```
migration 20260909000001 was previously applied but is missing in the resolved migrations
```

`sqlx::migrate::Migrator::run_direct` takes a session-level advisory lock first
and releases it **last**:

```rust
if self.locking { conn.lock().await?; }
…
let version = conn.dirty_version().await?;
if let Some(version) = version { return Err(MigrateError::Dirty(version)); }
let applied = conn.list_applied_migrations().await?;
validate_applied_migrations(&applied, self)?;      // ← returned here
…
if self.locking { conn.unlock().await?; }          // ← never reached
```

Every early return skips the unlock. Handed a `&PgPool`, sqlx borrows a *pooled*
connection, so that connection went back into the pool still holding it — and a
session-level lock is held until the session ends, which for a pooled connection
means for the life of the process.

**Nothing about that process looks wrong.** It starts, serves traffic, and prints
its migration warning. What breaks is every *other* process that migrates the
same database: the next replica in a rolling deploy, or the test suite creating
its schema, blocks inside `pg_advisory_lock` with no error, no timeout and
nothing in its own logs to explain the wait. Two days of "the Postgres tests are
slow on this machine" would look exactly like this.

`run_migrations` now takes the connection out of the pool and closes it whatever
happens:

```rust
let mut conn = pool.acquire().await.map_err(MigrateError::Execute)?.detach();
let result = sqlx::migrate!("./migrations").run(&mut conn).await;
if let Err(e) = conn.close().await { log::warn!("…") }
result?
```

`detach()` means the connection can never be handed out again; closing it ends
the session, which releases any lock sqlx left behind. The migration outcome is
still returned unchanged — the point is that a failed migration now costs this
process a warning instead of costing every future one its startup.

The sibling in `repositories/postgres/tests.rs` was checked and is already safe:
its admin pool is `max_connections(1)`, so its lock and unlock are guaranteed to
be the same session.

---

## `/api/health` was never a route (2026-09-09)

`API_CONFIG.HEALTH_ENDPOINT` has always been `/api/health`. The API serves
`/health`. Nothing connected the two:

```
/health                 200
/api/health             404
```

Both portals poll it — `useApiStatus` every few seconds, and
`authStore.checkConnection` behind the "Retry" button — so the connection
indicator read **disconnected permanently**, on a stack answering every other
request normally, and the retry button could never clear it. A user watching that
indicator would conclude the system was down while their records saved fine.

Worse in development: the Vite dev server proxies `/api` and serves the SPA for
everything else, so `/api/health` returned `index.html` — a **200**, and
therefore "healthy" no matter what the API was doing. The check was wrong in both
directions depending on where it ran, which is why neither symptom ever got
attributed to it.

The fix is a second registration rather than a moved one. `/health` is what the
compose healthcheck and nginx's `location = /health` name, and orchestration
should not be re-pointed to suit a browser. `/api/health` exists now because
**the `/api` prefix is the only path a browser can reach the API through** in
every deployment shape — nginx proxies `location /api/`, the dev server proxies
`/api`, and anything outside it is not routed to the API at all.

Deliberately the liveness payload and not the readiness one: the indicator claims
"the browser can reach the API", which is what this answers. Storage degradation
belongs to `/health/ready` and `/health/db`, which report it rather than folding
it into one green dot.

---

## A green card that had no band to make the claim (2026-09-09)

The Nurse route sweep found `/intake-output` in dark mode failing WCAG AA on 200
of 1134 sampled elements — grey `text-content-muted` on a green `bg-ok-subtle`
card at **3.59:1**, where AA wants 4.5:1.

The colour was a symptom. `getBalanceStatus` derives the fluid-balance band from
the scoring catalog, and its no-catalog branch returns `text-content-muted` and
the label `—` precisely so the page makes no claim it cannot support. But the
card's *background* was picked separately, from literals:

```tsx
patient.netBalance > 500 ? 'bg-critical-subtle'
  : patient.netBalance < -500 ? 'bg-notice-subtle'
  : 'bg-ok-subtle'
```

A second copy of the ward policy the comment three lines above says must not live
in a component — and one that disagreed with the first whenever the catalog had
not loaded. The result was a green "this patient's fluid balance is fine" card
carrying placeholder text, which is a stronger claim than the one the code was
carefully avoiding making. The contrast failure is what made it visible.

`surface` now travels with `color` out of the same switch, so background and text
always name the same band, and the no-band case is a neutral
`bg-surface-sunken` (7.2:1 with muted text in dark mode). The same literals in
the patient-detail modal went with it.

Worth generalising: **a colour pair chosen in two places is a claim made twice**,
and the contrast gate is the only thing that notices when the two disagree.

---

## The audit column was narrower than its own vocabulary (2026-09-10)

The PostgreSQL leg of `synthetic-e2e-test.sh` failed six assertions the memory
leg passed. The first was the only real one; the other five were its wake:

```
FAIL | first pharmacist requests a second verifier | want 200 got 503
     | {"code":"PRESCRIPTION_PERSISTENCE_FAILED"}
```

In the API log:

```
Secondary verification transition failed: Database error:
value too long for type character varying(32)
```

`access_logs.action` has been `VARCHAR(32)` since the first clinical migration,
when the whole vocabulary was `View`, `Create`, `Update`, `Delete`, `Export`,
`Print`, `EmergencyAccess` — fifteen characters at the longest. Every migration
since has added names to the CHECK constraint without asking whether the column
could hold them. Five now cannot be stored at all:

| chars | value |
|---:|---|
| 35 | `prescription_verification_requested` |
| 34 | `prescription_verification_approved` |
| 34 | `prescription_verification_rejected` |
| 33 | `prescription_verification_expired` |
| 33 | `prescription_verification_revoked` |

**The schema contradicted itself**: the constraint declared these permitted and
the column refused them. And the audit row shares a transaction with the state
change it records — correctly, since an unrecorded controlled-substance decision
is worse than a refused one — so the whole transaction rolled back. **The
maker-checker second-pharmacist verification workflow was unusable on
PostgreSQL.** A pharmacist could never request a second verifier, so a
prescription whose policy required one could never be dispensed at all.

Three things had to be wrong at once for this to survive:

1. **The memory backend enforces no column widths**, so the memory leg of the
   same harness scored 247/0 against the PostgreSQL leg's 247/6.
2. **`check-audit-action-vocabulary.py` only checked membership.** It proves
   `written ⊆ constraint` from the Rust source and did so correctly — these five
   values *are* in the constraint. It never asked whether a permitted value fits
   the column.
3. **`test_pg_access_log_accepts_every_action_the_handlers_write` compared a
   hand-copy to the constraint** — the exact weakness the gate's own docstring
   describes for a different case. Its list was missing all five values, so
   there was nothing to reject; and its `action.len() <= 32` assertion passed
   for the same reason.

Fixed in three places, because any one of them alone leaves the trap set:

* **Migration 20260910000001** widens the column to `VARCHAR(64)` — the width
  `transaction_authorization.action` already uses. No table rewrite, and no
  existing row is affected: no row could be longer than 32, because the column
  refused them.
* **The gate now reads the declared width** from the migrations and fails when
  any *permitted* value exceeds it — across the whole vocabulary, not only what
  handlers write today, because a name the column cannot hold is a trap for the
  next handler either way. Verified by removing the migration and watching it
  name all five.
* **The test now derives its vocabulary from the live constraint** and its width
  from the live column, and inserts every permitted value. The hand-copied list
  is gone. The invariant it proves is `constraint ⊆ storable`, against the real
  schema rather than a copy of it; the gate proves `written ⊆ constraint` from
  source. Between them the loop closes.

After the migration the PostgreSQL leg is **253/0**.

Worth generalising, and it is the same lesson as the pharmacist and lab-technician
gates: **a mirror of the thing under test cannot detect an omission the two
share.** Both the test's list and the constraint had been updated by whoever
added the feature; what nobody updated was the column, and nothing was reading
the column.

---

## The two synthetic runners disagreed about dev mode (2026-09-10)

`scripts/run-synthetic-local.sh` set `IS_DEMO=true` and not
`MEDICHAIN_DEV_MODE`. Its PostgreSQL sibling set both. The demo-only routes are
gated on **both**, deliberately, so that enabling them is two acts rather than
one omission — which meant the memory leg of `synthetic-e2e-test.sh` failed five
assertions the PostgreSQL leg passed, for a reason that had nothing to do with
storage.

The harness needs `POST /api/auth/demo-login` to stand up a *second*
administrator: retention approval is maker-checker controlled, so the
administrator who requests a token must not be the one who decides it. Without
dev mode that call is a deliberate 403, and the cascade's loudest symptom was
four assertions later:

```
approval is not executable: status 'pending', executed_at None
```

— which points at the approval workflow rather than at a missing environment
variable. The runner sets it now, with the reason written down beside it.

Memory leg after the fix: **247/0**.

---

## A lab technician could not do laboratory work (2026-09-09)

Found by trying to run the browser suites against a locally built API — the
fixture seeder they depend on failed at its first laboratory step:

```
FAILED: collect Original specimen for recollection journey
  HTTP 403  {"code":"INSUFFICIENT_ROLE"}
```

The actor is the seeded **LabTechnician**. Five endpoints in
`clinical_endpoints/lab.rs` gated on `can_edit_medical_records()`, which is
`Doctor | Nurse`:

| Endpoint | Who actually does this |
|---|---|
| `create_specimen` | phlebotomy — ward *or* lab |
| `create_specimen_rejection` | the lab, and only the lab |
| `create_chain_of_custody` | the lab |
| `create_lab_qc` | the lab, and only the lab |
| `create_critical_value` | the lab, which then calls the clinician |

`create_lab_qc` is the starkest: laboratory quality control is not something a
doctor or nurse does, and the only role that does it was refused.

**This is the same defect as the pharmacist read gate closed earlier the same
day** — `handlers/lab.rs` gated a *read* on `can_edit_medical_records` under a
comment saying "healthcare provider", excluding the pharmacists who need to see
a result before dispensing against it. Same shape: a question about **who does a
job**, answered with a predicate about **who edits a clinical record**.

It is not a regression from removing `Admin` from `can_edit_medical_records`:
`LabTechnician` was never in that set. It has been this way for as long as the
predicate has.

**The fix** is a predicate that names its own question.
`Role::can_perform_laboratory_work()` is `Doctor | Nurse | LabTechnician`:

* the lab, obviously;
* doctors and nurses, because ward-side collection is routine — a nurse draws
  bloods;
* **not `Admin`**, for the separation-of-duties reason recorded on
  `can_edit_medical_records`: the account that grants and revokes roles does not
  also produce laboratory records;
* not `Pharmacist`, who reads results but does not produce them.

Two tests pin it, beside the existing `role_authority_tests`. The second exists
to stop the collapse happening again:

```rust
assert!(Role::LabTechnician.can_perform_laboratory_work());
assert!(!Role::LabTechnician.can_edit_medical_records());
```

One predicate cannot answer both questions, and the moment it is asked to, one
of the two answers is wrong.

**Worth generalising:** `can_edit_medical_records` is doing duty as a
catch-all "is this person clinical staff" gate across the codebase. Each such
site is a question worth asking out loud — *who does this job?* — and the two
found so far both had a different answer from "who edits a record".

---

## The browser suites only ever tested the stale image (2026-09-09)

> **Superseded in part — see "The browser suites run, and the sign-in
> diagnosis was wrong" above.** The config described here is right and is
> still the way to run these suites. The failure analysis at the end of this
> entry is not: the recurring `STAFF_LOGIN_UNKNOWN` was the suite's own
> `no.such.person` negative test, and the real blocker was an API that had
> degraded to empty in-memory storage. All 51 tests pass.

`playwright.config.ts` sets `reuseExistingServer: !CI` and points the dev-server
proxy at Nginx on `:80`. So a run adopts whatever dev server is already on 5173,
proxying to whatever API that server was configured against — in practice the
Docker image, which is days old. The suite goes green and green means "last
week's image still works". A locally built change cannot be tested at all.

`playwright.local-api.config.ts` binds its own port, sets its own proxy target
and refuses to adopt a stray server:

```bash
VITE_API_PROXY_TARGET=http://127.0.0.1:8090 \
  npx playwright test --config playwright.local-api.config.ts
```

**It is runnable now, and it does not pass here.** Reported honestly:

* **9 failed, 42 never ran.** Every failure is sign-in; the 42 that did not run
  are the route sweeps, so the suite gives **no signal about this campaign's
  changes either way**.
* The API is fine. The fixture seeder's own preflight signs in all seven
  accounts against the same server (`✓ bt.doctor signs in`), and the browser's
  request does reach the API — it is answered `STAFF_LOGIN_UNKNOWN`, the same
  identifier hash every time.
* So the browser posts an identifier the credential store does not hold, while
  an identical API-level sign-in with the same `login_id` succeeds. That
  discrepancy was not closed.

**What running them needs**, all of which the suite documents and none of which
the compose file supplies:

1. `MEDICHAIN_DEV_MODE=1` — without it `GET /api/auth/demo-credentials` is a
   deliberate 403 and no demo buttons render.
2. `DISPENSING_POLICY_PATH` — without it the seeder's pharmacy journey dies with
   `DISPENSING_POLICY_UNAVAILABLE`. `api/data/dispensing_policy.example.json`
   works.
3. Seeded fixtures — `scripts/seed-browser-test-fixtures.ts`.
4. Patience with the rate limiter: every request comes from `127.0.0.1`, so the
   whole suite shares one 60/minute bucket and a re-run inside the window fails
   as navigation timeouts that read like application faults. 46 refusals were
   logged across one run.

**Next step for whoever picks this up:** compare the `identifier` the browser
posts to `/auth/staff/login` against the one `enrolCredentials` stored. Both
derive from `login_id` through the same `deriveCredential`, so they should agree
and do not. Start by logging the identifier (not the proof) on both sides
against a freshly seeded account.

---

## The owner's decisions, taken and applied (2026-09-09, round two)

Everything the previous entries left "needs an owner decision" was authorised and
is now done. What follows is what was decided and why, because the reasoning is
the part worth keeping.

### Paediatric burn charting: Lund-Browder, banded by date of birth — CLOSED

Recorded above as *"Burn TBSA uses Rule of 9s where paediatric burns need
Lund-Browder"*, and deferred because "Lund-Browder is not a different set of
numbers for the same regions — it is a different region set."

That was right, and it is what was built. `clinical_scoring::LUND_BROWDER_REGIONS`
is nineteen regions against Rule of 9s' thirteen: each limb splits (upper arm /
forearm / hand, thigh / lower leg / foot), the neck and buttocks separate, and
the trunk charts 13% front and 13% back against 18% and 18%. Six age columns —
0, 1, 5, 10, 15, adult — replace an `isChild` boolean.

`lund_browder_columns_each_total_one_hundred` asserts every column sums to
exactly 100. That is the invariant the deferral was protecting: Rule of 9s
numbers dropped into this region set would fail it.

**The age comes from the patient's date of birth, and there is no default.**
`lund_browder_band` returns `Option`, and `create_burn` refuses a submission it
cannot band with `400 AGE_REQUIRED`. Taking the adult column for an unknown age
charts a burned infant's head at 7% when it is 19%, and TBSA is what the fluid
order is computed from. A refusal is recoverable; a wrong denominator on a child
is not.

**The input changed too, and this is the part that removes the arithmetic from
the clinician.** The form asked for each region's share of the *whole body* —
"the front of the head, so 4.5%" — which is a multiplication done in the
clinician's head against a denominator the page had already chosen wrongly. It
now asks how much of *that region* is burned, and the server multiplies by the
region's size at the patient's age. `the_same_burn_is_a_different_tbsa_at_a_different_age`
pins what this was worth: a whole head and neck is 21% TBSA on an infant and 9%
on an adult, which on realistic weights is a 840 mL against a 2520 mL first-day
fluid order.

`BurnPage.test.tsx` was rewritten with it, as this entry predicted it would need
to be. Six tests now, including one asserting that a patient with no date of
birth cannot be charted at all.

### Hereditary risk: degree-weighted and onset-aware — CLOSED

Recorded above as *"Family history banded hereditary risk on a raw count"*, with
the model left open as "a clinical decision, not an engineering one".

The decision taken: a **referral screen**, scored on the two things that actually
separate an inherited pattern from an incidental one, both of which were already
on file and neither of which the page was reading.

* Degree: first-degree 2 points, second-degree 1, third-degree 0.5.
* Age of onset under 50 doubles a relative's weight.
* Bands name what to do — `standard_care`, `enhanced_screening`,
  `genetics_referral` — rather than a probability the model cannot support.

On the two cases the count model got backwards: a mother and sister with breast
cancer at 40 now scores 8 and prompts a referral, where the count said MODERATE;
three second cousins with type 2 diabetes in their sixties scores 1.5 and
prompts nothing, where the count said HIGH and issued an automatic "consider
genetic counseling".

Three things it deliberately does not do:

* **It does not guess an unrecognised relationship.** Those are counted in
  `unscored_relatives` and surfaced, because guessing is wrong in both
  directions — too low misses a referral, too high makes the prompt noise.
* **It does not treat an unknown onset age as late onset.** The relative weighs
  as recorded, and `early_onset_affected` says how much of the history carried a
  multiplier.
* **It does not claim to replace disease-specific criteria.** NICE familial
  breast cancer and the Amsterdam/Bethesda criteria ask about bilateral disease,
  multiple primaries and tumour patterns this cannot see. `standard_care` is not
  a statement that a family is unaffected, and the code says so.

It is scored by `POST /api/clinical/family-history/assess` rather than in the
browser. Family history is the one scale with no stored value, so there is no
create response to carry the answer — a small stateless endpoint was the price
of keeping `clinical_scoring::family_history_assessment` the only
implementation. The TypeScript copy that existed briefly was deleted.

### SOFA: the dead binding was hiding a submitted zero — CLOSED

`_calculateSOFA` was recorded above as "worth a second look before removal:
SOFA is a real severity score and the setters beside it are its inputs, so this
is an unfinished feature rather than an abandoned one."

It was worse than unfinished. `SepsisPage` **submitted** `sofa_score`, and the
five inputs `_calculateSOFA` read were initialised to normal values with no
control — so every sepsis assessment on file records **SOFA 0**, which reads as
"no organ dysfunction" on a septic patient.

The in-browser version was also incomplete where it mattered most: its
cardiovascular component scored only `map < 70 -> 1`, under a comment reading
*"Add more for vasopressor use..."*. A patient on high-dose noradrenaline scored
the same 1 as a patient with a slightly soft pressure and no support — three
SOFA points apart, and the difference between sepsis and septic shock.

`clinical_scoring::sofa_score` implements all six systems including the
vasopressor tiers, takes the worse of creatinine and urine output for renal as
SOFA specifies, and requires respiratory support for the top two respiration
tiers. **An unmeasured system scores `None`, not 0**, and `systems_measured`
travels with the total — a total of 2 from six systems and 2 from one are
different clinical pictures.

`SepsisPage` has the seven inputs now, blank rather than pre-filled, and a blank
is sent as absent.

**And the sepsis save path was broken too**, which nothing had noticed: the page
posts `sepsis_id` and `classification` against a DTO wanting `assessment_id`,
a `severity` enum and a `qsofa` **struct**. That is an eighth page in the same
condition as the seven in the entry above. qSOFA moved to `clinical_scoring`
with it, under the same rule about unmeasured observations.

### Three more fabricated findings, found while removing dead bindings

The dead-binding sweep kept turning up submitted values rather than dead code:

* **`TraumaPage`** — A, B, C and D each had a `<select>`; **E (Exposure) did
  not**, so every primary-survey narrative recorded "E: none" regardless of what
  was found. It has a control now.
* **`PsychPage`** — a page of asserted negatives nobody entered:
  `history_of_violence: false`, `duty_to_warn: false`,
  `law_enforcement_notified: false`, `currently_intoxicated: false`,
  `in_withdrawal: false`, `self_harm_history: false`, `hospitalizations: 0`, and
  an empty diagnoses list from a `psychHistory` state that had no control.
  Worst of them: **`legal_status.admission_type: 'Voluntary'`** — whether a
  psychiatric admission is voluntary or under a hold is a legal status with
  due-process consequences, asserted for every patient by a form that never
  asks. All removed; absent now means not recorded. A psychiatric-history and
  legal-status sub-form is a feature to build.
* **`BloodBankPage`** — every blood-product order filed with
  `bloodType: 'Unknown'` while `patient` sat in scope holding the real value.
  Blood type is what the crossmatch is against.

### Dead bindings and dead controls — CLOSED

Sixteen underscore-marked bindings, deleted with the owner's authorisation. Three
were not simply dead:

* **`FallRiskPage._assessmentHistory`** was rendered by the History tab and never
  written, so the tab was permanently empty — indistinguishable from a patient
  who has never been assessed. The repository has had `get_by_patient` all
  along and no route reached it;
  `GET /api/emergency/fall-risk/patient/{id}` now does. The tab's local
  `FallRiskAssessment` interface was deleted with it: camelCase, deeply nested,
  and nothing has ever produced it — the same read-side drift as the H&P
  `VitalSigns` case above.
* **`RadiologyPage._patients`** fetched the patient roster, stored it and never
  read it. Not merely wasteful: `GET /api/patients` decrypts and returns PHI,
  and every such read is logged against the caller.
* **Four "Edit" and "Add Entry" buttons** set state nothing rendered. A control
  that does nothing when clicked is worse than no control — the clinician
  cannot tell it from a broken app — so the buttons went with the state.
  Building the four modals is a feature, not debt removal.

`connectWallet()` is deleted, and `cardiac_entity` / `sepsis_entity` with it.

### Handler length: measured, and the mechanical fix made it worse — STILL OPEN

**292 functions in `api/src` exceed the 60-line limit in CLAUDE.md rule 3.** That
is a codebase-wide condition, not something this campaign introduced: the worst
are `configure` (568), `main` (482), `sign_consent` (374) and
`evaluate_cds_rules` (351), none of them touched here.

The mechanical fix was tried on `create_burn` and measured. Extracting the entity
construction into `burn_entity` gave **two** functions over the limit instead of
one — a 128-line handler and a 74-line helper — plus an eight-argument signature
needing `#[allow(clippy::too_many_arguments)]`. It was reverted.

The reason is structural: the entity has forty fields, so the literal is
irreducibly forty lines, and moving it does not change that. Meeting the rule
here means changing the entity shape or the storage model, which is a design
decision about the whole repository layer rather than a tidy-up.

`create_burn` grew to 181 lines in this pass, and that growth is real work: the
patient lookup and Lund-Browder age-band derivation the paediatric fix required.

**What a real pass would need**, when someone takes it on: a decision on whether
the 60-line rule applies to declarative field mapping at all, or only to
branching logic. Most of these 292 are the former. A rule that 292 functions
break is not being enforced, and the honest options are to scope it or to fund
the campaign — not to keep recording it.

### Verification that was outstanding

* **`clippy -p medichain-api --all-targets -- -D warnings` is clean.** It was
  not re-run in round one; it caught one finding in the new sepsis handler
  (`needless_borrows_for_generic_args`), now fixed.
* **The browser suites are runnable against a local build and do not pass.**
  See "The browser suites only ever tested the stale image" above — 9 sign-in
  failures, 42 tests never reached, so no signal about this campaign either way.
  The attempt was still worth it: it is what found the laboratory authorization
  defect.

### Already fixed, recorded as open

**Test schemas are never dropped** (2026-08-19) is stale. `create_test_pool`
sweeps schemas older than two hours before creating a new one, and the comment
there records what the leak had cost: 239 schemas and ~28,000 tables, which
broke `pg_dump` with "out of shared memory / increase max_locks_per_transaction"
and made the documented rollback procedure unusable.

**`CDSAlertsPage.evidenceLevel`** was recorded as having no control. It has one
(`CDSAlertsPage.tsx:898`). The initial value is still `'B'`, which is a
pre-filled grade rather than an asserted one, and it is rule-authoring metadata
rather than patient data.

---

## Six clinical scales lived in the browser, and seven save paths were broken (2026-09-09)

The working rule from here on: **a page never decides a clinical value.** It
collects observations; the server scores them; the page displays what came back.

### How this was found

Not by reading. By posting each page's exact payload at the running API and
looking at what came back, and then at what the database held afterwards.

| Endpoint | Before | What was actually happening |
|---|---|---|
| `POST /api/emergency/fall-risk` | **500** | The repository INSERTed into `total_score` and `risk_level`, which are `GENERATED ALWAYS ... STORED` columns. PostgreSQL refuses any INSERT naming a generated column, so **no falls assessment had ever been saved**. The nurse saw "save failed" and nothing was stored. |
| `POST /api/emergency/cardiac` | **400** | `Json deserialize error: unknown variant "stemi"`. The form's `<select>` emits lowercase; the typed `CardiacEvent` spells them `STEMI`. It also required `door_time`, `ecg_findings`, `biomarkers`, `cath_lab_activated` and `pci_performed` — five fields the form has no control for. **The cardiac screen had never filed a record.** |
| `POST /api/surgical/pre-op` | **400** | `unknown variant "II"`. The form emits Roman numerals; the enum spells them `ASA1`..`ASA6`. The database column has accepted exactly `I`..`VI` and `I-E`..`V-E` all along, so the schema and the form agreed and only the enum did not. |
| `POST /api/clinical/burn` | **201**, and worse | The handler read `tbsa_percentage` and `parkland_formula_volume`; the page sent `total_bsa` and `parkland_fluid`. Neither matched, so **every burn assessment on file records a 0% burn with no fluid order** — and returned 201. |
| `POST /api/clinical/mci` | **201**, and worse | The handler read flat top-level keys off a body shaped `{mci_id, incident: {...}, patients: [...]}`. What got written was one row for a nameless incident of type `natural_disaster` with a single `red` casualty who did not exist. The casualty board — the entire point of an MCI record — was dropped. |
| `POST /api/emergency/iv-site` | **201**, and worse | `phlebitis_grade`, `site_appearance`, `infiltration_grade`, `pain_level`, `patency`, `dressing_intact` and `notes` were all hardcoded `None`. A cannula with a stage-4 site read back as never assessed. |

Two of those failed loudly and four succeeded while discarding the clinical
content. The four quiet ones are the dangerous shape, and they are the reason
this was found by probing rather than by reading: every one of them returns 201.

**Nineteen read endpoints returned a literal `null` with a 200.** `get_burn`,
`get_psych`, `get_tox` and sixteen others served `entity.data`, and `data` is
`#[sqlx(skip)]` on all 28 of those entities — always `Value::Null` for a row read
from PostgreSQL. They return the stored entity now. No frontend page called any
of them, which is its own finding: these clinical documentation screens were
write-only, and a form you cannot read back is not documentation.

### The single authority

`api/src/clinical_scoring.rs` holds the Morse Fall Scale, TBSA and the Parkland
formula, burn severity, TIMI, START triage, the VIP phlebitis score and catheter
dwell limits. Pure functions, 11 unit tests pinning the published reference
values, called from the create handlers so the stored score is always the
server's.

`GET /api/clinical/scoring/catalog` publishes the thresholds and constants so a
form can show a total moving as it is filled in without carrying a second copy
of the policy. `client/shared/src/clinical/scoring.ts` consumes it and returns
`null` for every helper when the catalog has not loaded — the page shows a dash,
which is honest, rather than a score computed from numbers it made up.

The unit suite caught a real defect in that module: the accessors read
`catalog.timi.threshold` rather than `catalog.timi?.threshold`, so a partial
catalog response threw inside render. On the burn page that is a blank screen
instead of a fluid order. Every accessor now treats a missing section the same
way it treats a missing catalog.

### Three of the six browser copies had drifted

Moving the arithmetic was not a refactor. Three were wrong:

* **TIMI.** `CardiacPage` scored "3 or more CAD risk factors" from a symptom
  list containing diabetes *or* hypertension — one factor, not three — and read
  "2 or more anginal episodes in 24 hours" off a chest-pain **character**
  dropdown, which describes quality, not frequency. Both errors score a
  criterion that is not met. TIMI decides who goes for early invasive
  management. The five criteria that are clinical judgements are checkboxes now;
  the server derives age from the patient's date of birth and the cardiac marker
  from the troponin against the published assay threshold.
* **START triage.** `MCIPage` skipped the algorithm's first and most decisive
  question — "can they walk" — behind a comment reading "we assume
  non-ambulatory if triaging". Every walking-wounded casualty was triaged as if
  they could not walk. It also treated a pulse over 120 as Immediate, which is
  not a START criterion; the perfusion check is capillary refill over two
  seconds **or** an absent radial pulse. Verified after the fix: an ambulatory
  casualty comes back `minor`/green where the old code would have said
  `delayed`.
* **Morse.** `FallRiskPage` posted its six items nested under `morse_scale` in
  camelCase while the handler read six flat snake_case keys, so it scored every
  assessment 0 — and 0 bands as low risk. A patient the nurse scored 70 was
  filed as low risk, and low risk is the band that gets no bed alarm, no hourly
  rounding and no signage.

Age was also computed as `thisYear - birthYear`, which is a year out for anyone
who has not had their birthday yet — and 64-turning-65 is exactly the boundary
the TIMI criterion is about.

### One default worth naming

`BurnPage` initialised `weight` to `70`. Parkland is 4 mL x kg x %TBSA, so a
burned child left at the default gets a fluid order roughly three times too
large. The field starts empty now, and `parkland_fluid()` returns `None` rather
than a number for a missing or impossible weight: no weight, no fluid order, on
the page and on the server.

### What the empirical pass caught in my own work

Three defects in the fixes themselves, all found by posting to the running API
rather than by re-reading the code:

* ASA was normalised to `ASA<n>`, which the column's CHECK constraint rejects.
  The schema's vocabulary is Roman numerals with `-E` — the same one the form
  already used. (There is no `VI-E`: ASA VI is a declared brain-dead organ
  donor, for whom "emergency" means nothing.)
* MCI wrote the START category name into `triage_category`, which is
  CHECK-constrained to a tag **colour**. The colour goes there and the category
  name beside it in `start_triage_category`, so the record holds both the tag
  that was hung on the casualty and the algorithm result behind it. The form's
  twelve human-readable incident types also needed mapping onto the column's
  eight.
* `patency` was written as `"not patent"` against a CHECK of
  `patent | sluggish | occluded`, and `site_appearance` was a joined list of
  findings against a `VARCHAR(32)`.

The VIP scale runs 0–5 and `iv_assessments.phlebitis_grade` was constrained to
0–4, excluding the one stage where the answer is not "resite the cannula" but
"resite it and treat the patient". Nothing had hit the constraint because the
column had never been written at all. Widened by migration
`20260909000003`.

### Schema changes

Three additive migrations, all `ADD COLUMN IF NOT EXISTS` or a widened CHECK:

* `20260909000001` — `fall_risk_assessments` gains `environmental_hazards`,
  `medications`, `recent_fall`, `mobility`. The form has always collected them;
  there was nowhere to put them. A Morse total answers "how likely is this
  patient to fall"; these answer "why, and what has to change".
* `20260909000002` — `burn_assessments` gains `weight_kg`, `severity`, the
  Parkland split, `associated_injuries`, `interventions`, `fluid_start_time` and
  `urine_output_ml_hr`. A stored fluid volume with no weight beside it cannot be
  rechecked against the formula.
* `20260909000003` — the VIP widening above.

### Typed request payloads

The endpoint functions took `data: unknown`. That is *how* four pages came to
post payloads no handler read, and why TypeScript saw none of it.
`client/shared/src/types/clinicalScoring.ts` types the six requests and their
responses, and it earned its keep immediately: adding it turned the Cardiac and
MCI mismatches into compile errors rather than runtime 400s.

Each request type deliberately **omits** the derived values — no `total_score`,
no `risk_level`, no `total_bsa`, no `parkland_fluid`, no `timi_score`. A field a
client cannot set should not be in the shape it fills in.

### A seventh page, and six findings nobody made

`PediatricsPage` was the same contract mismatch as the other four — it sent
`age: {years, months}`, `weight_method` and `immunizations` against a handler
reading `age_months`, `weight_estimated` and `immunizations_up_to_date`, so
every paediatric assessment stored age 0 months and no immunisation status,
returning 201.

What made it worse than the others is what the submit literal asserted. None of
these had a control on the form:

```
hr_interpretation: 'Normal', rr_interpretation: 'Normal', temp_interpretation: 'Normal'
pain: { score: 0, scale_used: 'FLACC' }
immunizations: 'Up to date'
abuse_screening: { concerns: false }
guardian_present: true
weight_method: 'Measured'
```

Every paediatric vital sign filed as normal, including a tachycardic infant's.
No pain, on a child nobody asked. A complete immunisation schedule for every
child. And a record stating a **child-protection screen found no concerns**,
when no screen was performed — which is not a data-quality problem, it is a
safeguarding record asserting something false.

A temperature nobody entered also became `37.0` and a weight nobody entered
became `0`.

The page now sends only what it collects, under the names the handler reads.
This is the same shape as the `AMAPage` `patientSigned: true` and
`LacerationRepairPage` `sutureType: '4-0 Nylon'` defects already recorded above,
and `scripts/check-uncontrolled-defaults.py` missed all of them for the same
reason: it scanned `useState({...})` initialisers, and these live in the object
literal built inside the submit handler. **That is fixed** — see "The blind
spot, and the gate that closes it" under *Form fields with a default and no
control* above. The payload scan is a gate, it replays all sixteen historical
defects, and it found a seventeenth on its first run.

### Two more, found by sweeping for the same shape

Having named the pattern, a scan for assertive literals in submit payloads with
no control behind them turned up two more:

* **`TraumaPage`** sent
  `vital_signs: { bp: "120/80", hr: 80, rr: 16, spo2: 98 }` under a comment
  reading *"Default vitals - updated from patient monitoring"* — an update that
  does not happen. **Every trauma assessment on file records textbook-normal
  observations for a trauma patient.** The page has no vital-signs inputs;
  observations are recorded on the Vitals page against the same patient, so it
  sends none now. An absent set reads as "not recorded here"; `120/80, SpO2 98`
  reads as a stable patient.
* **`CodeBluePage`** sent `location: 'Emergency Department'` and
  `primary_cause: 'Cardiac Arrest'` with no control for either. A code called on
  a ward, in theatre or in radiology was filed as having happened in the ED —
  and code-blue response times are reviewed by location. Both are inputs now.

That sweep is worth keeping as a habit: the pattern is a plausible constant in
the object a page posts, and it is invisible to every gate the project has.

### Two more ward thresholds moved with them

`MedicationAdminPage` decided a dose was overdue with `30 * 60000` inline, and
`IntakeOutputPage` banded fluid balance with `> 1000`, `> 500`, `< -500`. Both
are policy, not display preference: the first is what turns a dose red on the
MAR and puts it in front of the nurse, and the second is what calls out a
patient running a litre positive. Both are in the catalog now
(`medication.overdue_after_minutes`, `fluid_balance`), and both pages fall back
to the safe answer when it has not loaded — the dose stays *pending* rather
than being guessed overdue, and the balance shows a dash rather than a colour.

A dose shown as pending that is actually late is recoverable. One shown as
overdue because the page guessed teaches the nurse to ignore the colour, which
is not.

### Handler length

Measured properly in round two and left open with a number: **292 functions in
`api/src` exceed the limit**, and the mechanical fix was tried and reverted
because it made the code worse. See "Handler length: measured, and the
mechanical fix made it worse" above.

### Verified

571 API tests pass on PostgreSQL, 373 doctor-portal and 83 patient-app unit
tests pass, all 15 CI static gates pass, all three workspaces typecheck and lint
at zero warnings, and every one of the six endpoints was exercised end to end
against a live server with the payload the updated page sends — including
reading each record back.

`check-endpoint-auth.py` caught the scoring catalog at tier 0, "no auth decision
at all". The endpoint *was* authenticated; the decision sat one function call
away in a helper, and the gate reads the handler body. The gate was right —
an auth decision a reader cannot see at the endpoint is one nobody can audit —
so the helper was inlined.

---

## Family history banded hereditary risk on a raw count (2026-09-09, CLOSED 2026-09-09)

`FamilyHistoryPage.calculateRiskAssessment` counted affected relatives per
condition category and banded the count: 3 or more "HIGH", 2 "MODERATE". The
"HIGH" badge then rendered an automatic recommendation reading *"Consider
genetic counseling and enhanced screening protocols."*

Hereditary risk does not work that way. It turns on the **degree** of
relationship and the **age of onset**, and the count model gets the important
case backwards:

* a mother and a sister with breast cancer at 40 counts **2** — "MODERATE", the
  milder recommendation;
* three second cousins with type 2 diabetes counts **3** — "HIGH", and an
  automatic referral for genetic counselling.

**Half fixed.** The page no longer calls a count a risk level. It shows the
count and the conditions — genuinely useful family history — under one prompt to
assess against degree and onset, instead of a graded recommendation it has no
basis for. `noRiskIdentified` read *"No significant familial risk identified
based on available history"* off an empty list; nothing recorded is not the same
as nothing there, and it now says so.

**Still open: the real model.** Choosing one is a clinical decision, not an
engineering one, which is why nothing was substituted. Two things make it more
tractable than it looks when someone picks it up:

* the data model already carries age of onset — `onsetYearsSuffix` renders it —
  and the relationship, so both inputs a real model needs are on file;
* `_getRiskColor` is kept (underscored) for the band's return, and the scoring
  belongs in `api/src/clinical_scoring.rs` with the rest, not back in the page.

## Dashboard payload gaps (recorded 2026-09-09, CLOSED 2026-09-09)

Three dashboard response types in `client/shared/src/types/index.ts` had drifted
from what the handlers in
`api/src/clinical_endpoints/workflow/dashboards.rs` actually return. They were
corrected against the handlers, and the four items below are what the
correction exposed. **All four are now closed**, and one of them was recorded
on a mistaken reading.

### Nurse dashboard ward fields — CLOSED

`NurseDashboardPatient` declared `room`, `esi_level`, `fall_risk`, `iv_site` and
`wound_care_due` as optional because `/api/dashboard/nurse` did not return
them — the handler serialised `DashboardPatient`, which carries none of the
five, while `NurseDashboardPage` renders all of them. `room` had previously
shown "Pending" for every bed via a `|| t('pending')` fallback.

Every one of them had a real source; nothing needed inventing:

| Field | Source |
|---|---|
| `room` | `assigned_bed` on the patient's latest triage assessment |
| `esi_level` | `esi_level` on the same assessment |
| `fall_risk` | `risk_level` on the latest Morse Fall Scale assessment |
| `iv_site` | the most recent non-discontinued `iv_assessments` row |
| `wound_care_due` | a `wound_assessments` row older than the 24-hour review interval |

`ward_context()` gathers them, four reads per patient against a list capped at
fifteen. That is deliberate rather than incidental: none of these repositories
has a ward-wide listing, and the alternative was the empty columns this entry
describes. If the ward list grows past fifteen, they want a batched read first.

`fall_risk` is a **band**, not a boolean — `PatientListPanel` typed it
`fall_risk?: boolean`, and "at risk of falling" is not a yes/no question:
moderate adds a bed alarm and hourly rounding, high adds signage and supervised
toileting. `undefined` is a third state again and means no assessment has been
done, which is not the same as low risk.

`tasks.ivs_to_check` was hardcoded `0` and `tasks.wounds_to_assess` did not
exist. Both are counted from the same reads now, and the wounds badge was added
to the page — it had been read by `useSidebarData` and by nothing else.

**A latent bug surfaced while verifying this, and it was taking a whole screen
down.** `fall_risk_assessments.total_score` and `risk_level` are
`GENERATED ALWAYS ... STORED` from six nullable item columns, so a row written
before those items were populated has a NULL total. `FallRiskAssessmentEntity`
typed both non-optional, so `get_high_risk_patients` failed to decode — and that
read is on the nurse dashboard's critical path, so **the entire nurse dashboard
returned 503** as soon as any such row existed. Both fields are `Option` now,
and `None` means "never scored", which is deliberately not the same as `0`: zero
bands as low risk, unscored is a patient nobody has assessed.

Verified against PostgreSQL: `tasks` reads
`{"ivs_to_check": 1, "vitals_due": 0, "wounds_to_assess": 0}` and a patient row
reads `"fall_risk": "high", "iv_site": "right-hand (dorsum)"`. `room` and
`esi_level` come back null for synthetic patients who have no triage
assessment — which is the point: absent means not recorded.

### Nurse dashboard medication route and time — CLOSED

`medication_records` were `MedicationReminder` rows, which have
`medication_name`, `dosage` and `reminder_times` but no `route`, no
`scheduled_time` and no `patient_name`. `route` had a `|| 'PO'` fallback, so the
ward medication list stated that every drug was oral — including any given IV or
IM.

The fix was not to find the fields on the reminder. It was to notice that the
source was wrong: `medication_reminders` is the patient-adherence feature, and a
ward drug round is the **medication administration record**, which carries the
route, the scheduled time and the patient. `ward_medications_due()` reads today's
MAR for each patient on the ward list and flattens `scheduled_medications` into
the rows the round is worked from.

Where a MAR entry genuinely omits a route it still shows as unknown — a question
rather than a wrong answer — but it is now absent because nobody recorded it,
not because the endpoint could not carry it.

### Critical value alerts do not name the patient — CLOSED

`CriticalValueEntity` carries `patient_id` and no name; the name is encrypted at
rest and only the API holds the keyring. `LabTechDashboardPage`'s critical-alert
banner reads `patient_name`, so every unacknowledged critical result was
announced without saying whose it was — a potassium of 6.9 on the screen and no
way to tell who to call.

`lab_dashboard` already performed exactly this enrichment for `rejections`. The
duplicated loop became `resolve_patient_names()`, which de-duplicates ids so a
patient with six unacknowledged criticals costs one read rather than six, and it
now runs over `critical_notifications` too. Ids that cannot be resolved are
absent from the map and the field is left off: an unnamed alert is better than
one attributed to the wrong person.

The enrichment maps over the **serialised entity**, not `entity.data` — that
field is `#[sqlx(skip)]` and is always null for a PostgreSQL row, and putting a
null in the array the banner maps over takes the dashboard down. The same
mistake had already been made once here, on the rejections array.

Verified: the banner reads `"patient_name": "Thandiwe Ncube"`.

### Sidebar recent-patients list — CLOSED, and the premise was wrong

**What was written here first:**

> `useSidebarData` returns `recentPatients` and `isLoading`, which are the exact
> two props of `RecentPatientsList` — a finished component with loading and empty
> states and **no call site anywhere**. `Layout` used to destructure both and
> render neither, so the roster was polled every 30 seconds for nothing.

Three of those claims are false.

* **They are not the same two props.** `RecentPatientsList` takes
  `{patientId, fullName, healthId, lastAccessed}`; the hook returns
  `{id, name, healthId, lastSeen}`. Wiring it up as described would have
  rendered a column of blanks.
* **Nothing is polled for it.** `recentPatients` is derived from the dashboard
  response the badges already need. Removing it would save no request.
* **The list is not missing from the product.** `DashboardPage` renders a
  "Recent Patients" panel inline from the same response. The component is a
  superseded duplicate of a panel that already ships.

It is also not sidebar furniture: `p-8` padding and 48px icons are a dashboard
panel. The "product decision about sidebar real estate" this entry asked for was
an artefact of the misreading.

Left in place rather than deleted, per the project rule on removing code. The
comment in `Layout.tsx` that repeated the wrong claim now says what is actually
true.

## Underscore-marked dead bindings (recorded 2026-09-09, CLOSED 2026-09-09)

`@typescript-eslint/no-unused-vars` now honours a leading underscore, which this
codebase already used to mark a binding as deliberately unused. That makes the
convention mean something to the linter as well as to a reader — it is not an
amnesty. The bindings are dead code, and they cluster into two kinds:

* **Half-built modals.** `_showEditModal` / `_setShowEditModal` pairs on
  `CDSAlertsPage`, `NoteTemplatesPage`, `OrderSetsPage`, `IntakeOutputPage`, and
  `_selectedRule`, `_selectedPlan`, `_selectedSet`, `_selectedCertificate`,
  `_editingPatient`, `_selectedTemplate`. Each is state for an edit dialog that
  was never built; the button that would open it does not exist.
* **Orphaned helpers and data.** `_getCategoryIcon` (twice), `_formatDate`,
  `_filteredConsults`, `_calculateSOFA`, `_timeSlots`, `_commonMedications`,
  `_patients`, and the type aliases `_CarePlan`, `_BurnAssessment`,
  `_Medication`, `_PreOpAssessment`.

`_calculateSOFA` on `SepsisPage` is the one worth a second look before removal:
SOFA is a real severity score and the setters beside it (`_setBilirubin`,
`_setCreatinine`, `_setPlatelets`, `_setMap`, `_setPao2fio2`) are its inputs, so
this is an unfinished feature rather than an abandoned one.

**The owner authorised the deletion on 2026-09-09 and it is done.** See "The
owner's decisions, taken and applied" above: three of the sixteen were not
simply dead, and `_calculateSOFA` was hiding a submitted `sofa_score: 0` on
every sepsis assessment in the database.

## Validation message register: warning vs error (recorded 2026-09-09, CLOSED 2026-09-09)

Required-field validation surfaced as `showWarning` on some pages and
`showError` on others, and `HistoryAndPhysicalPage` called
`showError(t('docHistoryPhysical.warningRequiredFields'))` — an error toast
carrying a string named "warning".

**The rule the code now follows**, documented on `useToastActions` in
`client/shared/src/components/Toast.tsx`:

> Did the thing the user asked for happen? No — `showError`. Yes, with a
> caveat — `showWarning`.

That is not a style preference, and the codebase turned out to answer it
already. Of the 36 `showWarning` call sites, **35 were immediately followed by
`return`** — they had blocked the save, nothing was recorded, and the toast was
the only thing telling the clinician so. Exactly one had not: `LabQCPage`'s
"QC recorded locally", where the action did go through with a caveat. The
distribution was the rule; it just had not been written down.

So: 35 blocked guards became `showError`, one advisory stayed `showWarning`,
and 26 i18n keys were renamed from `warning*` / `warn*` to `error*` so a string
cannot claim a severity its call site contradicts. Six pages needed `showError`
added to their `useToastActions()` destructuring and sixteen had a now-unused
`showWarning` removed from theirs.

Only `en-US` defined any of the renamed keys — the other five locales are
partial overlays and carried none of them — so nothing fell back to English
that was not already falling back.

Why it mattered more than tidiness: a clinician who reads "warning" on a form
that silently discarded their entry has been told the wrong thing about their
own record. The severity is the only signal distinguishing "saved, with a note"
from "not saved at all".

---

## Per-account browser audit (recorded 2026-09-09, closed 2026-09-09)

`client/doctor-portal/e2e/roles.spec.ts` signs in as each of the five staff
accounts and sweeps every route that account's own sidebar offers, measuring
contrast in both themes and target size. Before it existed, the browser suites
signed in as a doctor and audited twelve routes.

Its findings were fixed in that pass. Two were recorded here instead. **Both are
now closed** — and the first was recorded on a false premise, which is the part
worth keeping.

### An administrator could open clinical screens — CLOSED

**What was written here first, and was wrong:**

> The endpoints behind those screens enforce their own RBAC, so this is not a
> data exposure: it is a screen that presents its controls and would refuse
> every one of them on submit.

`Role::can_edit_medical_records` is `Admin | Doctor | Nurse`. An administrator's
clinical writes **succeed**. The screen was not presenting controls that would be
refused; it was presenting controls that work.

That inverts the finding. It was never a cosmetic mismatch between a permissive
UI and a strict server — it was the navigation and the authorization holding two
different views of what an administrator does, with the permissive one winning
silently.

It was also recorded as needing a product decision it did not need. `ADMIN_NAV`
is a curated fourteen routes — user management, access logs, analytics, and the
medico-legal screens (emergency, MCI, death certificate, autopsy) — and pointedly
not the bedside clinical set. Somebody had already decided; the router just had
no notion of who a route was for.

**The fix.** `rolesOwningRoute()` in `src/config/navigation.ts` answers one
narrow question: has the product assigned this screen to a different role? The
`Layout` refuses those, keeping the shell rendered so a reader can see where they
are and navigate away. It refuses 27–57 routes per role. Routes in *no* role's
navigation — deep routes like `/patients/:id`, the dashboard aliases, a handful
reachable only by link — are deliberately left alone: the question being answered
is narrow on purpose.

The API is untouched, so anything that legitimately depends on that authority
still works. `roles.spec.ts` asserts it for all five accounts now, including the
Admin case it previously skipped.

**The policy question is now decided too.** `Admin` has been removed from
`Role::can_edit_medical_records` in `api/src/types/domain.rs`. Separation of
duties: the account that grants and revokes roles must not also write clinical
records, because it can grant itself anything and then act while the audit trail
shows a legitimate role at the moment of the act.

What that did *not* touch, and why:

* **`is_healthcare_provider` still includes `Admin`.** Patient registration is
  gated on it, so `POST /api/register` remains open to administrators — it is an
  administrative act, and CLAUDE.md documents it as such.
* **`can_view_medical_records` still includes `Admin`.** Reading is not writing,
  and an administrator investigating an access-log entry needs to see what was
  accessed.
* **`pallet_access_control::can_edit_medical_records` is unchanged.** It gates
  which *chain account* may submit a medical-record extrinsic, and the API's own
  service signer holds `Role::Admin` there — the dev genesis grants `//Alice`
  Admin precisely because it is the API's default signer. Removing it there would
  stop every on-chain write the API makes. That predicate is about a service
  identity; the API one is about a person. Same name, different question.

The blast radius was checked before the change: 59 call sites, all of which
compile; both scripts that act as the administrator (the synthetic e2e harness
and the fixture seeder) use it only for account management and already route
clinical writes through clinician wallets; and no test asserted that an
administrator could edit.

One pre-existing bug surfaced while checking it. `handlers/lab.rs` gated a
**read** on `can_edit_medical_records`, against a comment that said "healthcare
provider" — so it had always excluded pharmacists, who are providers and who need
to see a lab result before dispensing against it. It now uses
`can_view_medical_records`, which is both correct on its own terms and immune to
changes in the edit predicate.

The two frontend mirrors of the predicate — `canEditMedicalRecords` in
`client/shared/src/wallet/types.ts` and the `editor` list in
`useCurrentProvider.ts` — were updated with it. Leaving either behind would have
put the UI straight back into the state this entry exists to describe: offering
an affordance the server refuses.

The boundary is now asserted rather than described:
`api/src/types/domain.rs::role_authority_tests` pins what an administrator
cannot do, what it deliberately still can, and the read/write asymmetry that
`handlers/lab.rs` had wrong. A security boundary held up only by prose is one
careless `matches!` edit away from returning, and it returns silently — nothing
fails, an administrator can simply write clinical records again.

### H&P vital-sign types described something nothing produced — CLOSED

`HistoryAndPhysicalPage`'s local `VitalSigns` declared `heartRate`,
`respiratoryRate`, `temperature`, `oxygenSaturation` and `bmi` as numbers, and
named the last two fields `height`/`weight`. Nothing produced that shape: every
field comes from a text input, `handleSaveHp` submits `formData.vitalSigns`
verbatim, and `GET /api/clinical/hp` returns exactly that back —
all strings, `heightCm`/`weightKg`.

It survived because the interface was applied only to the *read* side
(`HistoryAndPhysical.vitalSigns`) while the form's own literal was inferred and
therefore never checked against it. The two halves of one record described
different things and neither could tell.

The interface now matches what is written and read, and the form's literal is
typed with it, so they cannot drift apart again. This sat directly behind two
crashes that were live — `patientName` and `vitalSigns`, both fixed in the same
pass — and is the same drift.
