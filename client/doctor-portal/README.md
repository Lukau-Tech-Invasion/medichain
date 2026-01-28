# Doctor Portal (client/doctor-portal)

Purpose: Healthcare provider Progressive Web App (PWA) with dashboards, triage, orders, lab, nursing workflows.

Run locally:

 - `cd client/doctor-portal`
 - `npm install`
 - `npm run dev` (default port 5173)

Key files:
- `src/pages/` — page components (Dashboard, PatientDetail, Triage, Nursing, etc.)
- `src/components/` — shared UI components

Auth & API:
- Uses shared API wrappers in `client/shared` which call `/api/*` endpoints. Developer auth uses `X-User-Id` for demo flows.
