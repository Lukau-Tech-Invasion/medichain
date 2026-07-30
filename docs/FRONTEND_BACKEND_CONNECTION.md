# Front-end ↔ Back-end Connection

© 2025–2026 Lukau Invasion (Pty) Ltd.

**Last verified: 2026-07-30.** This document records how the React apps connect
to the Rust API, what is verified working end-to-end, and the precise remaining
route drift — so the frontend build-out is a checklist, not a hunt.

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
- `/api/access/patient/{id}/requests`, `/api/access/requests/{id}/deny`,
  `/api/access/requests/{id}/approve` — access-request workflow not built
  server-side.
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

## Status summary

- **Connection mechanism**: working (proxy fixed, env-configurable).
- **Core demo flow**: connected and verified end-to-end.
- **Emergency Protocols page**: connected (four new backend routes added).
- **Remaining specialty pages**: ~49 drifted calls catalogued above — the
  scope of the frontend build-out. ~25 are frontend renames to existing routes;
  ~24 need new backend endpoints.
