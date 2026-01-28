# Client (medichain/client)

Purpose: React + Vite frontends for MediChain. Contains `doctor-portal`, `patient-app`, and shared libraries used by both apps.

Quick dev:

 - Install node deps: `npm install` (run from `client/doctor-portal` and `client/patient-app` as needed)
 - Start doctor portal: `cd client/doctor-portal && npm run dev` (port 5173)
 - Start patient app: `cd client/patient-app && npm run dev` (port 5174)

Shared API client:
- `client/shared/src/api/endpoints.ts` and `client/shared/src/api/client.ts` provide canonical API wrappers. Prefer these wrappers over ad-hoc `fetch` calls.

Notes:
- Many pages still include direct `/api/` callsites — see `docs/frontend-backend-mapping.csv` and `docs/frontend-backend-crossref.csv` for locations.
