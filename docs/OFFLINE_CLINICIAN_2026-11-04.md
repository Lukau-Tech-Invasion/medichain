# Clinicians working without signal (2026-11-04)

Owner request: a doctor or nurse with no Wi-Fi can open the portal, find the
patients on their day, read them, and fill in forms; what they save is sent
when signal returns, and the patient then sees it.

## Owner decisions

1. **Only the day's patients go on the device**: today's appointments, the
   ward the clinician is rostered on now, and their active care relationships.
   Never the roster.
2. **Documentation works offline**: vital signs, Glasgow Coma Scale, SOAP,
   progress note, history and physical, triage, fluid intake/output, wound,
   IV site, fall risk. **Prescribing, orders, dispensing and giving medicines
   need a connection**: each depends on a check only the server can make at
   that moment (allergies, interactions, the dose already given).
3. **Scores stay on the server** (rule 8). Offline, a form says the score is
   calculated when signal returns; it never shows a number of its own.
4. Done before the patient-app redesign.

## How it works

| Piece | Where |
|---|---|
| The day, downloaded per clinician; each patient gated by `resolve_chart_access` (no break-glass, no admin oversight) and logged as `Export` "Downloaded to a device for offline use" before release; minimised (no address, insurance, national ID) | `api/src/handlers/offline_bundle.rs`, `GET /api/clinician/offline-bundle` |
| Kept on the device sealed under the account's non-extractable AES-GCM key, expires after 12 hours, deleted at sign-out | `client/shared/src/utils/offlineRoster.ts` |
| Which writes may wait on the device | `client/shared/src/utils/offlinePolicy.ts` |
| A queued write is sent later under its own id as the idempotency key (applied at most once) and with `X-Offline-Recorded-At`; the listed handlers use `support::clinical_time`, honoured only within 72 hours and not in the future, so a reading keeps the time it was taken. Access-log rows keep server time | `client/shared/src/utils/syncQueue.ts`, `api/src/support.rs` |
| Reopening the app with no signal: the session is not treated as ended unless the server says so; it opens offline only while this account's day is on the device, and is confirmed with the server once signal returns | `client/shared/src/api/client.ts` (`restoreSessionOutcome`), `doctor-portal/src/store/authStore.ts` |
| Sending on reconnect, waiting count, and work the server refused (kept with its reason, never dropped) | `doctor-portal/src/offline/ClinicianOffline.tsx`, `OfflineStatusBar.tsx` |
| Patient search, chart opening and chart summary from the day when offline | `PatientSelect.tsx`, `AccessReasonGate.tsx`, `workspace/PatientWorkspace.tsx`, `offline/OfflineChartSummary.tsx` |
| The whole built app stored on the first online visit; the API is never answered by the worker and patient data never enters Cache Storage | `doctor-portal/public/sw.js` v6, `precache-manifest.json` from `vite.config.ts` |

## Defects found on the way

* A token refresh attempted with no signal latched the session as ended, so a
  clinician who lost signal was signed out the moment it came back.
* The service worker answered an unreachable API read with `503 OFFLINE`; the
  client took that as the server replying and never noticed it was offline.
* An item marked `in-progress` when the app closed mid-send was never sent.
* The old offline banner said "changes are saved locally" while no write was
  queued; the count it showed came from a queue with no writer.

## Limits

* Offline opening needs one online visit after a deploy, so the worker can
  store the build. The Vite dev server is not stored (no manifest).
* An unlocked device with the browser open can use the day for up to one
  shift; that is the device lock's job, which is why the day expires.
