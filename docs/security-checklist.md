# Telehealth Security Checklist

_MediChain — Telehealth Plan Phase 8. Last updated: 2026-06-04._

Pre-production verification for the telehealth subsystem. Each item lists what to
check and where it is enforced. ✅ = implemented in-tree; ☐ = deployment/ops
action required before go-live.

## Authentication & authorization

- ✅ **JWT signed with a strong secret.** HS256 over `JITSI_APP_SECRET`
  (`api/src/telehealth.rs::sign_jitsi_jwt`). ☐ Set a ≥32-byte random secret in
  prod; never use the example value.
- ✅ **Room access controlled by JWT role.** `role_is_moderator` maps
  doctor/nurse/lab/admin → moderator; pharmacist/patient → participant. Token
  carries `context.user.moderator`.
- ✅ **Token validation on the server.** `JitsiProvider::validate_token` verifies
  signature + `room` claim (`verify_jitsi_jwt`).
- ✅ **Token expiration enforced.** 30-minute TTL (`TELEHEALTH_JWT_TTL_SECS`);
  `exp`/`nbf`/`iat` set. No long-lived tokens.
- ✅ **Session membership checked.** `join_telehealth_session` returns 403 unless
  the caller is the session's patient or provider.
- ✅ **Recording is moderator-only.** `telehealth_recording` rejects
  non-providers (403) and starts only with `consent: true`.

## Data protection / PHI

- ✅ **No PHI in room names or subjects.** Room = `MediChain-{sessionId}`;
  subject = generic "MediChain Telehealth Visit" (`RoomConfig`). No patient name.
- ✅ **JWT delivered over POST, not in a URL.** `/join` is a POST; the token is
  in the JSON body and stored client-side, never in the address bar.
- ✅ **Audit trail for access + recording + lifecycle.** All join/leave/error and
  recording start/stop events are written to the access-log repository.
- ☐ **TLS everywhere.** Terminate HTTPS for the API and PWA, and use a
  TLS-fronted `JITSI_DOMAIN`. See `docs/TLS.md`.
- ☐ **Self-hosted Jitsi for PHI.** Public `meet.jit.si` is not HIPAA-compliant;
  deploy self-hosted (`docs/jitsi-deployment.md`) and set `JITSI_APP_SECRET`.

## Abuse / availability

- ☐ **Rate-limit session creation.** Confirm the global rate-limit middleware
  covers `POST /api/telehealth/sessions` to prevent room-flooding/DoS.
- ✅ **Health probe for Jitsi.** `GET /api/health/telehealth` reports reachability
  + latency for load-balancer checks.
- ✅ **Graceful failure.** The frontend shows a retry/close path on connection
  errors instead of a blank screen.

## Recording / transcription

- ✅ **Recording off by default; explicit consent required.** See
  `docs/e2ee-policy.md`.
- ✅ **Transcription off by default** (`TRANSCRIPTION_PROVIDER=none`). ☐ Sign a
  BAA/DPA with any STT vendor before enabling.

## Pre-launch sign-off

- [ ] `JITSI_APP_SECRET` set to a strong random value; `JITSI_DOMAIN` is
      self-hosted + TLS.
- [ ] `GET /api/health/telehealth` returns `healthy` from the prod LB.
- [ ] Penetration test: attempt to join a room with (a) no token, (b) an expired
      token, (c) a token for a different room — all must be denied.
- [ ] Confirm recording cannot be started by a patient/pharmacist account.
- [ ] Confirm audit rows appear for join, recording-start, recording-stop.
