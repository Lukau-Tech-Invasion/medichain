# Patient App (client/patient-app)

Purpose: Patient-facing PWA for viewing records, appointments, medical ID, and messaging.

Run locally:

 - `cd client/patient-app`
 - `npm install`
 - `npm run dev` (default port 5174)

Key files:
- `src/pages/` — patient pages (MyRecords, Appointments, MedicalId, Settings)
- `public/sw.js` — service worker for offline support

Auth & API:
- Uses `client/shared` API wrappers and expects `X-User-Id` header for authentication in dev/demo flows.
