# Front-end ↔ Back-end Connection

© 2025–2026 Lukau Invasion (Pty) Ltd.

**Last verified: 2026-07-30.** This is a historical connectivity snapshot. A
matching path does not prove authorization, durable persistence, downstream
policy enforcement or negative-path behavior. The current feature verdict and
remaining release blockers are in
[`FEATURE_END_TO_END_AUDIT.md`](FEATURE_END_TO_END_AUDIT.md).

## How the connection works

The apps never hardcode the API host. In development they call **relative
`/api/*` paths**, and the Vite dev server **proxies** them to the API:

```
browser → localhost:5173 (doctor) / :5174 (patient)  →  Vite proxy  →  API
```

The proxy target is configurable (`client/*/vite.config.ts`):

| Setup | Target | How |
|---|---|---|
| Standalone API (README quickstart, no Docker) | `http://127.0.0.1:8080` | default |
| Full Docker stack (API behind Nginx) | `http://127.0.0.1` (:80) | `VITE_API_PROXY_TARGET=http://127.0.0.1` |

In production the client uses same-origin, or an explicit `VITE_API_URL`.

> Until 2026-07-30 the doctor-portal proxy hardcoded `:80`, so the documented
> no-Docker quickstart could not reach the API at all — every call 503'd. That
> is fixed; both apps default to the standalone API.

### Run the connected stack (no Docker)

```bash
cargo build -p medichain-api --bin medichain-api
bash scripts/run-synthetic-local.sh          # API on :8080
cd client && npm run dev:doctor               # doctor portal on :5173, proxying to :8080
```

## Verified working end-to-end (through the proxy)

Exercised via `localhost:5173/api/*` — i.e. the exact path the browser takes:

| Flow | Endpoints | Result |
|---|---|---|
| Bootstrap + accounts | `POST /api/auth/bootstrap`, `/api/auth/register` | 201 |
| Register a patient | `POST /api/register` | 201 |
| Dashboard patient list | `GET /api/patients` | 200 |
| Read a patient record | `GET /api/patients/{id}` | 200 |
| Record + read vitals | `POST /api/clinical/vitals`, `GET /api/clinical/patient/{id}/vitals` | 201 / 200 |
| Emergency Protocols page | `GET /api/emergency/{code-blue,trauma,stroke,cardiac,sepsis}/patient/{id}` | 200 (all five) |

The shared typed client (`client/shared/src/api/`) and the auth flow
(`X-User-Id` in demo, wallet+JWT otherwise) are the connection path for
everything above.

## Remaining route drift

Some specialty pages — the ones the frontend build-out will finish — call
paths that don't line up with a registered backend route. Two kinds:

### A. Frontend calls the wrong prefix for a route the backend DOES serve

Fix = rename the frontend call. Backend is authoritative (it is tested).
**Verify the HTTP method and response shape per page before renaming** — some
of these are POST-create, not GET-list, and a blind rename yields a 200 that
still breaks the page.

| Frontend path | Correct backend route |
|---|---|
| `/api/clinical/immunizations` | `/api/platform/list/immunizations` (GET list) |
| `/api/clinical/intake-output` | `/api/platform/list/intake-output` |
| `/api/clinical/progress-notes` | `/api/platform/list/progress-notes` |
| `/api/clinical/family-history/{id}` | `/api/surgical/family-history/{id}` — but see the surgical note below |
| `/api/clinical/operative-note/{id}` | `/api/surgical/operative-note/{id}` — see below |
| `/api/clinical/pre-op/{id}` | `/api/surgical/pre-op/{id}` — see below |
| `/api/clinical/post-op/{id}` | `/api/surgical/post-op/{id}` — see below |
| `/api/clinical/wound/{id}` | `/api/emergency/wound/{id}` |
| `/api/access/patient/{id}/grants` | `/api/emergency/grants` family (shape differs — check) |
| `/api/clinical/radiology/orders` | `/api/clinical/orders` (confirm filter semantics) |

### B. No backend route exists — the endpoint must be built

These pages cannot be connected by a rename; the backend endpoint is missing.

- `/api/batch`, `/api/analytics/batch`, `/api/audit-logs/batch`,
  `/api/lab-results/batch`, `/api/medical-records/batch` — the client's batch
  abstraction (`client/shared/src/api/batch.ts`) has no server counterpart.
- `/api/clinical/incident-reports`, `/api/clinical/nursing-care-plans`,
  `/api/clinical/wound-assessments`, `/api/clinical/iv-sites/{id}` — no route.
- `/api/clinical/shift-handoff/{id}` — no route.
- ~~`/api/access/patient/{id}/requests`, `/api/access/requests/{id}/deny`,
  `/api/access/requests/{id}/approve` — access-request workflow not built
  server-side.~~ **Built 2026-07-30** (`crate::patient_access` +
  `handlers::access_control`); patient-owned via `resolve_patient_access`,
  verified by 14 synthetic e2e assertions. In-memory backend — see the
  technical-debt register for the deferred Postgres implementation.
- `/api/lab-results/{id}` — no route (lab results are under `/api/lab/...`).
- `/api/barcode/scan-history` — no route (only `/api/barcode/{id}/history`).

### Surgical pages need the storage migration first

The surgical handlers (`get_pre_op`, `get_post_op`, `get_operative_note`) read
from **legacy in-memory `HashMap`s on `AppState`** (`data.pre_op_assessments`
etc.), not from `data.repositories.*` — even though the repositories exist and
implement `get_by_patient`. The create handlers write to the HashMap. So:

- A rename alone still 404s: the frontend passes a *patient* id, the backend
  route takes an *assessment* id.
- Adding a repo-backed list-by-patient route (as was done cleanly for the
  emergency assessments, which are fully repository-backed) would return an
  empty list, because created records live in the HashMap, not the repository.

**Update 2026-07-30 — surgical pages now connected.** Rather than the full
repository migration (deferred), added list-by-patient routes that read the
*same* `AppState` HashMap the create handlers write
(`/api/surgical/{pre-op,post-op,operative-note}/patient/{patient_id}`, provider-
or-self), returning the flat domain type the pages expect. The three pages
(PreOp/PostOp/OperativeNote) were repointed to these routes; they already parsed
bare arrays tolerantly. Verified: build clean, routes registered + authz'd, list
returns a valid 200 array, and the list reads the create's store (inspection-
confirmed). The proper HashMap→repository migration remains tracked in
`TECHNICAL_DEBT_REGISTER.md`, but the connection now works against the live
store.

## How this list was produced

`scripts/` route-drift comparison: every `/api/*` literal in
`client/{shared,doctor-portal,patient-app}/src` normalised against every
`#[get/post/...("/api/...")]` in `api/src`. Path params are wildcarded so
`{id}` / `${var}` / `:param` compare equal. Re-run after any endpoint change.

## Remaining drift, file-attributed (2026-07-30)

A comment-excluded audit leaves 43 flagged `/api/*` literals. They break down:

**~12 are test fixtures** (`*.test.tsx`) — mock paths like
`/api/access/patient/HEALTH123/grants`, `/api/vitals/PAT-001`,
`/api/patients/p1`. Not application code; not real connections.

**~~~8 are the client batch abstraction~~ — RESOLVED 2026-07-31: retired.**
`client/shared/src/api/batch.ts` had zero consumers and targeted server endpoints
that never existed. It was also actively harmful — its module-scope
`auditLogBatcher`/`analyticsBatcher` singletons each started a 5s `setInterval`,
so importing the shared API package made both apps POST to 404s continuously.
Deleted with its `api/index.ts` re-export. Build batching server-side first if it
is ever wanted.

**Real page drift still open** (each needs bespoke work, not a rename):

| Page | Path | What it needs |
|---|---|---|
| ~~ConsentManagementPage (patient)~~ | `/api/access/patient/{id}/grants`, `/requests`, `/requests/{id}/approve\|deny` | **Connected 2026-07-30** — access-request/grant workflow built server-side |
| MedicalHistoryPage (patient) | `/api/clinical/immunizations`, `/api/clinical/family-history/{id}` | Per-patient routes (platform list is all-patients, provider-only) |
| ~~NursingPage / CarePlanPage~~ | `/api/nursing/mar`, `/api/nursing/intake-output`, `/api/nursing/care-plans` | **Connected 2026-07-30** — `/api/nursing/*` read-aliases (`handlers::nursing`) over the repository stores, provider-gated; write shortcuts mirror `/api/emergency/*` (see debt register) |
| IntakeOutputPage | `/api/clinical/io/{p}/{date}/{shift}` | Maps to `/api/emergency/io/{patient_id}/{type}/{timestamp}` — param semantics differ |
| IVSitePage | `/api/clinical/iv-sites/{id}` | `/api/emergency/iv-site/{id}` — patient-vs-assessment id mismatch |
| ShiftHandoffPage | `/api/clinical/shift-handoff/{wallet}` | `/api/emergency/handoff/{id}` — id semantics differ |
| CardiacPage | `/api/clinical/patient/{id}/emergency` | Use the aggregate `/api/emergency/patient/{id}` |
| OrdersPage | `/api/clinical/orders/{id}/status` | Confirm the status-update route |
| MyRecordsPage (patient) | `/api/records/{id}/download` | Confirm the download route |
| LabResultsPage | `/api/lab/submissions?{status}` | Base route exists; query-arg only |

## Remaining pages — code-verified classification (2026-07-30)

Verified against registered routes. Two connected this session
(ConsentManagement, Nursing/CarePlan). The rest split cleanly:

**Needs a small new backend endpoint (buildable + e2e-verifiable, same pattern
as the two just done):**
- ~~**IVSitePage**~~ — **Connected 2026-07-30**: `GET /api/clinical/iv-sites/{patient_id}`
  (`list_patient_iv_sites`) over `iv_assessments.get_by_patient`, provider-or-self.
- ~~**ShiftHandoffPage**~~ — **Connected 2026-07-30**: `GET /api/clinical/shift-handoff/{provider_id}`
  (`list_provider_handoffs`) over `shift_handoffs.get_by_provider`; today-scoped (debt register).
- ~~**OrdersPage**~~ — **Connected 2026-07-30**: `PUT /api/clinical/orders/{order_id}/status`
  (`update_order_status`) rewrites the status in the order's `data` blob and
  persists; edit-records role gated.

**Frontend renames (done 2026-07-30 — render still to be eyeballed in-browser):**
- ~~**CardiacPage**~~ — repointed `/api/clinical/patient/{id}/emergency` (404) to
  `/api/emergency/cardiac/patient/{id}`, which returns a **bare cardiac-events
  array** matching the page's `data.events || data || []` parse. (The multi-key
  aggregate would have broken `.map`; the per-type list is the right target.)
- ~~**MedicalHistoryPage** (family history)~~ — repointed
  `/api/clinical/family-history/{id}` (404) to the existing
  `/api/surgical/family-history/{id}`. Page parses tolerantly with an `.ok`
  guard, so this is a strict improvement.
- ~~**LabResultsPage**~~ — already on live routes (`/api/lab/submissions[?status=]`
  and `.../{id}/review`, both 401=registered). No change needed.

**Built patient-scoped instead of renaming (avoids an IDOR):**
- ~~**MedicalHistoryPage** (immunizations)~~ — **Connected 2026-07-30**: added
  `GET /api/clinical/immunizations` (`list_my_immunizations`) returning the
  **caller's own** records, resolved via their linked patient id. Deliberately
  not pointed at the all-patients `/api/platform/list/immunizations`, which
  would have leaked every patient's records.

**~~Still open~~ — CONNECTED 2026-07-30 (all three problems fixed, verified
against a live IPFS node):**
- ~~**MyRecordsPage** (document list + download)~~. What was wrong, and the fix:
  1. List mapping now reads the real `MedicalRecordReference` fields and keys
     each record by `content_hash`.
  2. Added `GET /api/records/{content_hash}/download` — resolves the record,
     enforces patient-owns-or-provider, streams the **decrypted bytes** with a
     `Content-Disposition` filename (the page saves it as a blob).
  3. Verified end-to-end with kubo running: upload → ChaCha20-Poly1305 encrypt →
     IPFS → download → decrypt returns the **byte-identical** original
     (e2e section 11: 8/8, incl. 403 cross-patient, 401 anonymous, 404 unknown).
  Along the way this exposed a real config bug — the API binding **8080** stole
  the IPFS gateway's port, so its own gateway fetches 404'd. The synthetic runner
  now uses `PORT=8090`; the underlying default is logged in the debt register.

  *(Original diagnosis, retained for context:)*
- Three coupled problems, none cleanly fixable/verifiable without IPFS:
  1. **List shape mismatch.** `GET /api/records/{patient_id}` returns bare
     `MedicalRecordReference` objects (`content_hash`, `metadata_hash`,
     `record_type`, `uploaded_at`, `content_checksum`) — no `record_id`, no
     nested `metadata`. The page maps `rec.record_id` and
     `rec.metadata.content_hash`, which are absent, so records render degraded.
  2. **Download key.** The page calls `GET /api/records/{record.id}/download`
     for a raw blob; there is no such route, and `record.id` maps from the
     absent `record_id`. The real route is `POST /api/records/download` with
     `{content_hash, metadata_hash}` returning base64 JSON.
  3. **IPFS dependency.** A real download needs kubo running and an actually
     uploaded+encrypted record; the synthetic local run starts neither, so the
     happy path cannot be e2e-verified here the way every other connection was.
  Correct fix (needs an IPFS-backed env to verify): align the list response to
  carry `record_id` + `content_hash`/`metadata_hash`, then either add
  `GET /api/records/{content_hash}/download` streaming decrypted bytes, or point
  the page at the existing `POST /api/records/download`. Deferred rather than
  shipped blind — see the technical-debt register.

## Five silently-broken pages found 2026-07-31 (direct `fetch` calls)

The earlier route-drift audit compared `client/shared/src/api/endpoints.ts`
against the backend. **It did not cover pages that call `fetch(apiUrl(...))`
directly**, bypassing the typed client — and that is where the remaining drift
was hiding. Diffing the 73 direct page paths against the 390 registered routes
found five real breakages, all confirmed against the running server:

| Page | Was calling | Result | Now calls |
|---|---|---|---|
| AnalyticsPage | `/api/analytics/dashboard` | **404** — dashboard never loaded | `/api/platform/analytics/dashboard` |
| BarcodePage | `/api/barcode/scan-history` | **404** — scan history always empty | `/api/barcode/scans/my` |
| IntakeOutputPage | `/api/clinical/io/{p}/{date}/{shift}` | **404** — no such route | `/api/emergency/io/{p}/{shift}/{date}` |
| CodeBluePage | `/api/clinical/patient/{id}/emergency` | **404** | `/api/emergency/code-blue/patient/{id}` |
| SepsisPage | `/api/clinical/patient/{id}/emergency` | **404** | `/api/emergency/sepsis/patient/{id}` |

Note the IntakeOutput **argument order**: the handler reads segments 1 and 3
(`IO-{patient_id}-{date}`) and ignores the middle, so the shift belongs in the
middle and the date last. Sending `(patient, date, shift)` would have put the
shift where the date goes even once the prefix was right.

Separately, **TriagePage read `data.assessments` from
`/api/clinical/triage/queue`, which returns `{ queue, total, success }`** — so
the triage queue rendered empty no matter how many patients were waiting. Its
unit test mocked a third shape (`triage_queue`), agreeing with neither, which is
why nothing caught it.

**Re-run this check after any endpoint change** — comparing only `endpoints.ts`
is not sufficient:

```bash
grep -rhoE "apiUrl\(\`?'?/api/[^\`'\")]*" client/*/src --include=*.tsx --include=*.ts \
  | sed -E "s/apiUrl\(\`?'?//; s/\\\$\{[^}]*\}/*/g; s/\?.*$//" | sort -u > /tmp/page_paths.txt
grep -rhoE '#\[(get|post|put|delete|patch)\("/api/[^"]*"\)\]' --include=*.rs api/src \
  | sed -E 's/#\[(get|post|put|delete|patch)\("//; s/"\)\]//; s/\{[^}]+\}/*/g' | sort -u > /tmp/backend_routes.txt
comm -23 /tmp/page_paths.txt /tmp/backend_routes.txt
```

(Mind two false positives: `#[actix_web::put(...)]` is missed by that route
regex, and a `?query` built from a template var can survive the normaliser.)

## Status summary (updated 2026-07-30)

- **Connection mechanism**: working (proxy fixed, env-configurable).
- **Core demo flow**: connected and verified end-to-end.
- **Emergency Protocols page**: connected (four new backend routes added).
- **Specialty pages connected this pass** (all verified — 75 synthetic e2e
  assertions, both apps typecheck clean):
  - Consent Management (patient) — `patient_access` store + `access_control`.
  - Nursing dashboard + Care Plans — `/api/nursing/*`.
  - IV Sites, Shift Handoffs — `/api/clinical/{iv-sites,shift-handoff}/{id}`.
  - Orders status update — `PUT /api/clinical/orders/{id}/status`.
  - Cardiac history, family history — repointed to existing routes.
  - Immunizations (patient's own) — `GET /api/clinical/immunizations`.
  - Lab Results — already on live routes; no change.
  - MyRecords documents — `GET /api/records/{content_hash}/download`, proven by a
    real IPFS encrypt→decrypt round-trip.
- **Remaining**: **none.** Every page in the drift catalogue is now connected and
  verified (83 synthetic e2e assertions, 11 sections, 0 failures).
- **Caveat**: backend + wiring are verified server-side; the two pure frontend
  renames (Cardiac, family history) still want an in-browser eyeball of the
  rendered list. The pages parse tolerantly, so worst case is an empty list,
  not a crash.
