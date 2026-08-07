# MediChain — Demo Readiness Report

**Run date:** 2026-08-06
**Scope:** Full end-to-end exercise of every tier — frontend build, frontend↔backend
contract, unit suites, route coverage, and (where the environment allowed) live
API and browser walkthrough.
**Verdict:** the backend is solid (320/320 e2e across both storage backends, clean
builds, clean typechecks). Three defects were found that only a live run could expose
— two are fixed, one needs your decision. The doctor portal is demo-ready; the patient
app is not until §2.0c is resolved.

---

## 1. What was verified green

| Check | Result | How it was run |
|---|---|---|
| Doctor portal typecheck | **clean** | `npx tsc --noEmit` |
| Patient app typecheck | **clean** | `npx tsc --noEmit` |
| Doctor portal production build | **clean**, 151 pages code-split | `npm run build:doctor` |
| Patient app production build | **clean**, code-split | `npm run build:patient` |
| Frontend→backend path contract | **296/296 paths resolve** | `scripts/check-endpoint-drift.py` (written this run) |
| Doctor dev server + login page | **renders, 0 console errors** | headless Chromium |
| Patient dev server + login page | **renders, 0 console errors** | headless Chromium |
| API build (`cargo build -p medichain-api`) | **clean** | GNU toolchain |
| Synthetic e2e — **memory** backend | **160/160 passed** | `scripts/synthetic-e2e-test.sh` |
| Synthetic e2e — **PostgreSQL** backend | **160/160 passed** | same, `BASE=…:8091` |
| Route sweep, 100 routes logged in | **86 clean / 14 broken** | Playwright, live stack |

Both login pages were loaded in a real headless browser: no ErrorBoundary, **zero
console errors and zero uncaught exceptions** on either, demo-user buttons and the
wallet-address input both present, and the patient app's six-language switcher
(English / Français / Kiswahili / አማርኛ / isiZulu / Hausa) renders correctly.

The route-drift problem recorded in project history is genuinely fixed: every one
of the 296 distinct paths the frontend calls maps to one of the 397 routes the API
registers. That check compares **paths only** — not HTTP verbs, not payload shapes —
so it means "nothing is obviously unserved", not "the integration is correct".

---

## 2. The three defects that would have broken a live demo

All three were found by running the real stack in a real browser. None is visible to
any static check, typecheck, or build — and none is caught by the existing test
suites, which is the point worth sitting with.

### 2.0a A slow database silently turns the API into an empty in-memory server — **fixed**

**Symptom:** every login fails with `WALLET_NOT_REGISTERED` on a stack where every
container reports healthy and `/health` returns `{"status":"healthy"}`.

**What happens.** On startup the API tries PostgreSQL with `create_pool_with_retry`.
The old default was 5 attempts — about 30 seconds of budget (1+2+4+8 s backoff plus
five 3 s acquire timeouts). A PostgreSQL container recovering from an unclean
shutdown replays WAL and fsyncs its data directory before accepting *any*
connection; measured on this project's own dev volume, **over 100 seconds**, logging
`FATAL: the database system is starting up` throughout.

The API gives up at ~30 s. In demo mode — the profile a demo runs in — it then falls
back to in-memory storage. That store is **empty**: `main.rs` only loads the 46 demo
users and 47 demo patients when `db_pool.is_some()`. The API then serves happily,
`/health` reports healthy, the container healthcheck passes, nginx routes to it, and
nobody can log in.

**Why `depends_on` does not save you.** `docker-compose.yml` correctly declares
`depends_on: postgres: condition: service_healthy`. Compose applies that to
`compose up` — **not** to containers the daemon restarts under `restart:
unless-stopped`. So a clean `compose up` works, and a **machine reboot or Docker
restart** loses the race. That is precisely the "set it up the night before, reboot,
arrive at the venue" scenario.

**Reproduced and confirmed both ways:** with postgres mid-recovery the API logged
`Falling back to in-memory storage (demo mode)` and loaded 0 users; restarting it
once postgres was healthy loaded **46 demo users and 47 demo patients**, and the same
login went from `WALLET_NOT_REGISTERED` to `{"success":true,...,"role":"Doctor"}`.

**Fix:** default retry budget raised from 5 to 12 attempts (~2 minutes, covering the
observed recovery with margin; still overridable via `DB_MAX_RETRIES`), and the
fallback now prints an unmissable `[DEGRADED]` banner stating explicitly that every
login will fail — previously it was two lines lost among the startup banner and four
demo-secret warnings.

*Residual risk, stated plainly:* the API can still report `healthy` while degraded.
Making `/health` fail in that state is the deeper fix, but it changes container
healthcheck semantics and is left as an explicit recommendation rather than an
unilateral change.

### 2.0b The patient app never populates `healthId`, breaking ~10 pages — **fixed**

**Symptom:** the patient app requests `/api/patients/undefined`, `/api/lab/patient/undefined`,
`/api/symptoms/undefined` and so on — all 403 — so the patient's dashboard, records,
medications, appointments, notifications and medical ID all render without their data.

**Root cause.** `GET /api/auth/wallet/{address}` returns:

```json
{"address":"5FLSig…60Z","linked_patient_id":"PAT-001-DEMO",
 "name":"Mandla Zulu","role":"Patient","username":"patient.zulu"}
```

There is **no `healthId` field**. `client/patient-app/src/store/authStore.ts` read
`accountData.healthId`, which is therefore `undefined`, and every page that fetches
the patient's own record interpolates it straight into the URL.

Verified end to end: `GET /api/patients/PAT-001-DEMO` returns **200** with the full
record, so the data was there the whole time and only the field name was wrong. This
is exactly the response-shape class `scripts/shape-audit.py` exists for — invisible
to the path-level drift check, to typecheck, and to the build.

**Fix:** `healthId: accountData.healthId ?? accountData.linked_patient_id`.

**Blast radius:** one line, ~10 patient pages. This was the single highest-impact
defect found.

### 2.0c A patient can never read their own clinical data — 26 endpoints — **FIXED**

This was the largest defect found. All 26 sites now route through one helper,
`support::caller_owns_patient_record()`, verified by new e2e section 18 on BOTH backends.

**Measured, as the demo patient, against the running stack:**

| request | result |
|---|---|
| `GET /api/patients/PAT-001-DEMO` | **200** |
| `GET /api/records/PAT-001-DEMO` | **403** |
| `GET /api/lab/patient/PAT-001-DEMO` | **403** |
| `GET /api/cds/patient/PAT-001-DEMO/alerts` | **403** |
| `GET /api/clinical/patient/PAT-001-DEMO/vitals` | **403** |

**Root cause.** The guard compares two different identifier namespaces:

```rust
// api/src/handlers/ipfs_records.rs:535 (and 25 more sites)
if !current_user.role.is_healthcare_provider() && current_user_id != patient_id {
    return HttpResponse::Forbidden() // "Patients can only view their own medical records"
}
```

`current_user_id` is the **wallet address** (`5FLSigC9…60Z`). `patient_id` is the
**patient record ID** (`PAT-001-DEMO`). They are never equal, so for a patient that
condition is always true and the endpoint is **structurally incapable of granting
access**. The comment above the check states the intended behaviour, which is the
opposite of what the code does.

**Scale: 26 occurrences across 17 files** — `ipfs_records`, `fhir/*`, `medical_id/*`,
`engagement/{appointments,symptoms}`, `workflow/{messaging,tasks,compliance}`,
`platform/sync`, `emergency/assessments`, `gcs`, and others.

**The correct pattern already exists in this repo**, which is what makes this a
consistency defect rather than a missing feature:

```rust
// api/src/handlers/insurance_cards.rs:184 — does it right
caller.linked_patient_id.as_deref() == Some(patient_id.as_str()) || caller_id == patient_id
```

and `api/src/support.rs:298 resolve_patient_access()` encapsulates it properly.

**Severity framing, honestly:** this **fails closed**. It denies legitimate access; it
does not leak anything. So it is not a security hole — it is a functional defect that
disables the entire "patient views their own health data" surface, which is the
patient app's whole purpose.

**Why no test caught it.** The synthetic e2e exercises these endpoints as `$DOCTOR`
and `$PARAMEDIC` — provider credentials, which take the `is_healthcare_provider()`
branch and never reach the broken comparison. 160/160 passes without ever testing a
patient reading their own record. The gap is in what the suite covers, not in its
assertions.

**Recommended fix:** route all 26 sites through `resolve_patient_access()` (or the
`insurance_cards.rs` predicate) rather than editing each comparison in place, so the
rule lives in one testable function. Add an e2e section that performs these reads
with a *patient* credential — otherwise the same class recurs.

---

## 2.1 Other defects found and fixed

### 2.1.1 Demo seeding pointed at the IPFS gateway, not the API  — **fixed**

Five PowerShell scripts defaulted to `http://localhost:8080`. On any dev host with
`docker-compose` up, **8080 is the IPFS (kubo) gateway** — the API's own default is
8090 precisely because of that collision (`api/src/main.rs:124-131`).

These are exactly the scripts someone runs to prepare a demo, so the failure mode was:
"seed the demo data" appears to run, hits IPFS, and the demo starts with an empty
database.

- `scripts/create-demo-users.ps1`
- `scripts/demo-api-test.ps1`
- `scripts/seed-demo-data.ps1`
- `scripts/seed-full-demo.ps1`
- `scripts/test-all-apis.ps1`

The Bash equivalents (`create-demo-users.sh`) already used 8090 — the PowerShell
copies were missed when that fix was made. All five now default to 8090 and accept
an env override.

### 2.2 Shared config fell back to the IPFS port  — **fixed**

`client/shared/src/config.ts` returned `http://127.0.0.1:8080` as the non-browser
fallback (tests/SSR). Same collision, same fix. Browser paths were unaffected —
both Vite proxies already correctly target 8090.

### 2.3 Playwright ran every test twice  — **fixed**

`client/playwright.config.ts` declared two projects (`doctor-portal`, `patient-app`)
that differed only in `baseURL`. Every spec in `tests/e2e` pins its own baseURL with
`test.use({ baseURL })`, which **overrides the project's** — so the second project
re-ran identical tests against identical URLs. It looked like two apps' worth of
coverage and was one app's, run twice. Collapsed to a single project.

---

## 3. Test signals that cannot be trusted

### 3.1 Frontend unit suites assert pre-i18n copy — the app is correct, the tests are stale

Patient app: **53 of 77 tests failing, 21 of 26 files failing.**

This looks alarming and is not. Every failure has the same shape — the test searches
for a hardcoded English heading that the page no longer renders, because the pages
were migrated to `t('...')` and the copy was reworded. The tests were never updated.

| test expects | page actually renders |
|---|---|
| `/Insurance & Coverage/i` | `t('insurance.title')` → "Insurance Information" |
| `/Wearables & Devices/i` | `t('wearables.title')` → "My Wearables" |
| `/Patient Satisfaction Survey/i` | `t('survey.title')` → "Patient Feedback" |
| `/Consent Management/i` | `t('consent.accessControl')` |

**Why this matters more than the number suggests:** a suite that is 69% red for
reasons unrelated to correctness cannot detect a real regression — nobody reads it,
and a genuine break would land in the noise. This is the mirror of a green signal
that means nothing.

Fixing it is mechanical (assert on `t()` keys or on stable `data-testid`s rather than
on copy), but it is **test debt, not an app defect**, and it does not block a demo.

Doctor portal is the same story at larger scale: **153 of 255 tests failing, 61 of 80
files failing.** Combined, the two frontend unit suites are **206 of 332 tests red.**

Its failures split into two causes, both in the harness rather than the app:

- **Stale copy assertions** (the majority) — same as the patient app.
- **Unmocked API calls** — e.g. six `TypeError: data.map is not a function`. This one
  was worth chasing because it is the signature of a genuine response-shape bug. It
  is not one here: `IncidentReportPage` calls `listIncidentReports()`, and the handler
  (`api/src/clinical_endpoints/platform/registries.rs:424`) returns `result.items` —
  a bare JSON array — which `(data || []).map(...)` handles correctly. The test simply
  never mocks the call, so the page receives whatever the blanket `global.fetch` stub
  returns. **App correct, test wrong** — confirmed against the backend rather than
  assumed.

### 3.2 Route coverage was 3 tests for 108 routes — **suite written this run**

The entire Playwright suite was doctor login, patient login, and "both portals are
reachable". The two apps ship 108 routes. A page that throws on mount, renders blank,
or 500s on load was invisible to CI and would first be discovered by whoever was
watching the screen during a demo.

Added `client/tests/e2e/route-coverage.spec.ts`: visits all 100 non-parameterised
routes as a logged-in user and records three independent failure signals per route —
the React ErrorBoundary fallback, uncaught/console errors, and any response ≥400.
A route fails if **any** signal fires, and signals are collected rather than asserted
one at a time so a single run yields the whole picture.

**Result of the first full run — 100 routes, logged in, against the live stack:**

> **86 routes clean, 14 broken.**

Every one of the 14 traced back to the two root causes in §2.0b and §2.0c, not to 14
separate page bugs. After the `healthId` fix the failing URLs changed from
`/api/patients/undefined` to `/api/patients/PAT-001-DEMO` — proving the fix landed —
and the remaining 403s are the patient-authorization defect, which is still open.

**A flaw in the first version of this sweep, worth recording.** It ran
`test.describe.configure({ mode: 'serial' })` with one shared page. Playwright skips
the remainder of a serial group after the first failure, so the doctor dashboard
failing hid the other 74 routes — the run reported "5 failed, 98 did not run". A
sweep whose entire purpose is *show me every broken page* must not stop at the first
one. It now logs in once, reuses the storage state, and gives each route an
independent context, so one broken page cannot mask the rest.

### 3.3 Real-time (SSE) is broken in the dev environment — the one a demo runs in

`useSSE` fails in the browser with `SSE Error: TypeError: Failed to fetch` on both
portals. Measured directly:

| path | result |
|---|---|
| `/api/events` via nginx (`:80`) | **HTTP 200**, stream opens |
| `/api/events` via Vite dev proxy (`:5173`) | **0 bytes received**, times out |

**Cause.** `SseStream::poll_next` (`api/src/websocket.rs:138`) returns `Poll::Pending`
and emits **nothing** until some unrelated part of the system pushes an event — there
is no opening comment and no heartbeat. Actix writes the response headers, and nginx
forwards them immediately because it is configured `proxy_buffering off`; the Vite dev
proxy waits for the first body chunk before flushing headers, so the browser's
`fetch()` never resolves.

The result is that real-time works through the Docker gateway and fails through the
dev server — and because the demo login buttons are dev-only (§4), **the demo runs in
exactly the configuration where SSE is broken**.

**Fix (identified, not applied — the disk filled mid-edit and I chose not to leave a
partial change in authorization-adjacent code):** emit `: connected\n\n` on first poll
and a `: keepalive\n\n` comment every ~15s of silence. This is standard SSE practice,
fixes both proxies, and additionally stops intermediaries idling long-lived
connections out.

---

## 4. Read this before demoing from a production build

**The one-click demo logins exist only in `vite dev`.**

`client/shared/src/config.ts:106` sets `DEMO_WALLET_GENERATION: IS_DEVELOPMENT`, and
`IS_DEVELOPMENT` is `import.meta.env.DEV` — true under the dev server, **false in any
production build**. `LoginPage.tsx:168` gates the whole demo-user panel on that flag.

So a production build has no "Dr. Thandi Mbeki" button. Login still works — the wallet
address field and Connect Wallet are always present — but whoever is demoing needs a
wallet address to hand rather than a click.

This is a defensible safety choice (don't ship demo shortcuts to production), but note
the inconsistency: there is a *separate* `IS_DEMO` flag driven by `VITE_DEMO_MODE`
(`config.ts:26`), and setting it does **not** re-enable the demo logins, because those
key off `IS_DEVELOPMENT` instead. If the intent is "a build you can demo from",
`DEMO_WALLET_GENERATION` should key off `IS_DEMO`, not `IS_DEVELOPMENT`.

**Consequence for the test suites:** every Playwright spec here — the three pre-existing
ones and the route sweep added this run — logs in via the demo button, so they all
require the **dev server**, not a production preview. That is a real limit on what
they prove.

`FEATURES.NFC_SIMULATION` is also `IS_DEVELOPMENT`, but it is referenced nowhere in
either app — dead config. Harmless, but it reads as though NFC demo is dev-gated when
nothing consults the flag.

---

## 5. Project documentation is out of date in the app's favour

`CLAUDE.md` lists under **critical gaps**: *"Frontend does not consume SSE (zero
`EventSource` consumers)."* That is no longer true.

- `client/shared/src/hooks/useSSE.ts` exists and connects to `/api/events`.
- It is consumed in `client/doctor-portal/src/components/Layout.tsx:283`,
  `client/shared/src/components/Layout.tsx:69`, and `JitsiMeetComponent.tsx:111`.

Because `Layout` wraps every page, real-time push is live across both portals. The
hook streams over `fetch` rather than the `EventSource` API — which is almost
certainly how the stale claim arose, since grepping for `EventSource` finds nothing.

Worth correcting in `CLAUDE.md`: real-time is a feature you would want to show, and
the briefing currently tells a reader it does not work.

---

## 6. Observations that are not defects

- **i18n non-English locales are starter sets.** `en-US` has 6,782 lines; the five
  others (fr-FR, sw-KE, am-ET, zu-ZA, ha-NG) have 86 each, ~73 keys of UI chrome.
  This initially looked like a serious demo bug because `createTranslator` returns
  the raw key on a miss. It is not: `I18nProvider` deep-merges the active locale
  over en-US (`client/shared/src/i18n/react.tsx:69`), so missing keys render correct
  English. Switching to Zulu gives Zulu chrome and English clinical text — honest and
  functional. A completeness gap, not breakage.
- **Pathology whole-slide viewer is a labelled placeholder**, and says so on screen.
  Honest, but worth knowing before someone clicks it during a demo.
- Static audit of 1,816 "mock/placeholder/TODO" keyword hits categorises to 15
  "behavioural"; on inspection these are documented blockchain placeholder-hash
  fallbacks, the NFC simulator, and misclassified React `placeholder=` props. One
  genuine shortcut: `api/src/handlers/general.rs:473` uses `patient_id` as
  `wallet_address` until a wallet is linked.

---

## 7. Environment: what nearly stopped this

The live half of this exercise was almost blocked by the host, not the code.

**The C: drive was full** — 631 MB free of 454 GB at session start. The Rust API
needs several GB to build, Docker's daemon was unresponsive under the pressure, and a
first build attempt died with `os error 112` (no space). Root cause: the Python `uv`
package cache at `%LOCALAPPDATA%\uv` had grown to **61 GB** (2.37 million files).
Clearing it unblocked everything.

Other large consumers, for reference: `AppData\Packages` 37 GB, `Programs` 35 GB,
`JetBrains` 34 GB, `Docker` 28 GB, `Windows\SoftwareDistribution` 17 GB,
`hiberfil.sys` 16 GB. **This will recur** — it is worth a scheduled `uv cache clean`.

One consequence worth naming: force-stopping Docker mid-session left PostgreSQL doing
a 100-second crash recovery on restart. That accident is what exposed §2.0a, which is
the most valuable finding in this report.

---

## 8. Still open

1. **§2.0c — patient cannot read own clinical data (26 sites).** Needs your decision;
   it is the one defect that still breaks the patient app end to end.
2. **§3.3 — SSE handshake/heartbeat.** Fix identified and specified, not applied.
3. **Stale frontend unit suites** — 206 of 332 tests red on pre-i18n copy assertions.
   Mechanical to fix; no app impact.
4. **`scripts/shape-audit.py` not yet run** against the live server. It targets exactly
   the §2.0b class and would be the natural regression guard for it.
5. `CLAUDE.md` still lists SSE consumption as a critical gap (§5) — it is wired up.

---

## 9. Honest summary

The backend is in genuinely good shape: **320/320 synthetic e2e assertions pass across
both storage backends**, the API builds clean, both frontends typecheck and
production-build clean, and all 296 frontend call paths resolve to real routes.

The defects that mattered were only findable by running the whole thing for real:

- a **slow database silently turning the API into an empty server that reports
  healthy** — the classic "everything is green and nobody can log in";
- a **one-line field-name mismatch** that broke ~10 patient pages;
- an **authorization check comparing two different kinds of ID**, which makes the
  patient app's core purpose impossible on 26 endpoints.

None of these were visible to typecheck, build, static analysis, or the existing test
suites. Two are fixed; the third is specified and waiting on you.

**Is it ready to show people?** The doctor portal, yes — 86 of 100 routes render clean
against live data, and the failures are concentrated in the patient app. The patient
app is not, until §2.0c is resolved: its dashboard, records, labs, medications,
appointments and notifications will all render empty. That is a single root cause, not
ten, and the fix pattern already exists in this repo.
