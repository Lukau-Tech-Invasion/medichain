# Telehealth on Mobile — In-App, No Downloads

_MediChain — Telehealth Plan Phase 4. Last updated: 2026-06-04._

**Design constraint:** the entire consultation runs **inside the MediChain web
app (PWA)**. Patients and paramedics never download a separate video app. There
are **no native-app deep links** (no `org.jitsi.meet://`, no Play Store intents).
Mobile uses the same `JitsiMeetExternalAPI` in the browser that desktop uses.

## How a phone joins

1. **Tap from the session list.** The patient app's *Join Video Call* button
   calls the JWT join endpoint and mounts the in-browser Jitsi component
   (`client/patient-app/src/components/JitsiMeetComponent.tsx`).
2. **Scan a QR code.** `GET /api/telehealth/sessions/{id}/qr` returns a PNG
   (base64) encoding `<MEDICHAIN_APP_URL>/telehealth?session={id}&join=1`.
   Scanning opens that URL in the phone's browser → the PWA auto-joins.
3. **Single-tap link.** `GET /api/telehealth/join/{id}` issues a `302` to the
   same in-app URL. Useful in SMS/email reminders.

In all three paths the destination is the **PWA route**, and the
`?session=...&join=1` query triggers the deep-link auto-join effect in both the
patient and doctor `TelehealthPage`s.

## Why in-browser (and not the native Jitsi app)

- **No friction:** a paramedic at a roadside or a patient on a feature-rich
  Android browser joins in one tap — nothing to install or sign into.
- **One auth model:** the PWA already holds the wallet/session; the native app
  would need a separate token hand-off.
- **Consistent UX & telemetry:** the same lifecycle events, SSE relay, and audit
  logging apply on every device.
- `disableDeepLinking: true` and `MOBILE_APP_PROMO: false` are set on the IFrame
  API so Jitsi never nudges users toward the native app.

## Progressive enhancement / poor connectivity

- The pre-join **device check** (`POST /api/telehealth/device-check`) reports
  camera/mic/bandwidth and recommends audio-only when bandwidth < 2 Mbps.
- The component surfaces connection errors with a clear retry/close path rather
  than failing silently.
- WebRTC is supported by all modern mobile browsers (Chrome, Firefox, Safari,
  Edge); the device check flags unsupported browsers.

## Configuration

| Env var | Purpose | Default |
|---------|---------|---------|
| `MEDICHAIN_APP_URL` | PWA base used to build QR / redirect join URLs | `https://app.medichain.health` |
| `JITSI_DOMAIN` | Jitsi server (self-host for PHI) | `meet.jit.si` |

## Self-hosting note

For HIPAA/POPIA, point `JITSI_DOMAIN` at a self-hosted Jitsi (see
`docs/jitsi-deployment.md`). The mobile in-browser flow is unchanged — only the
domain serving `external_api.js` differs.
