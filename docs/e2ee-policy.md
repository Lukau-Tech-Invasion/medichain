# Telehealth E2EE & Recording/Transcription Policy

_MediChain — Telehealth Plan Phase 6. Last updated: 2026-06-04._

This document records the trade-off MediChain makes between **end-to-end
encryption (E2EE)** and **recording/transcription** for telehealth video
consultations, and the consent workflow that makes recording lawful.

## The trade-off

Jitsi's insertable-streams E2EE encrypts media between participants so that even
the bridge (and any recorder) cannot read it. That is the strongest privacy
posture — but it is **mutually exclusive with server-side recording and
transcription**, because the recorder/transcriber would need the plaintext media
it is specifically denied.

| Mode | Privacy | Recording | Transcription |
|------|---------|-----------|---------------|
| **E2EE enabled** | Highest (bridge can't read media) | ❌ not possible | ❌ not possible |
| **E2EE disabled** | Transport-encrypted (DTLS-SRTP) only | ✅ with consent | ✅ with consent |

## MediChain default

- **E2EE is disabled by default** so clinical recording/transcription is
  available when a provider needs it for the record.
- **Recording is OFF by default** (`RoomConfig.recording_enabled = false`).
  Nothing is captured unless a moderator explicitly starts it.
- **Transcription is OFF by default** (`RoomConfig.transcription_enabled =
  false`, `TRANSCRIPTION_PROVIDER=none`). No transcript is produced unless a STT
  provider is configured.
- Patients/providers who want maximum privacy for a given visit can request an
  **E2EE session**; recording is then unavailable for that session by design.

## Consent workflow (HIPAA / POPIA)

1. **Pre-session banner.** Before joining, the UI states the visit *may* be
   recorded.
2. **At recording start.** The provider (moderator) clicks *Record*. The browser
   shows a consent confirmation; the backend **rejects any start without
   `consent: true`** (`CONSENT_REQUIRED`).
3. **Participant notification.** Jitsi shows a recording indicator to everyone;
   the patient app surfaces a live "Recording" status via SSE.
4. **Immutable audit.** Recording start/stop is written to the access-log audit
   trail (actor, session, timestamp, reason="explicit consent") and broadcast on
   the SSE channel. This is the consent evidence.
5. **Transcript handling.** When a STT provider is configured, the transcript is
   folded into the session's visit notes for provider review before it becomes
   part of the permanent clinical record — it is never auto-published verbatim.

## Where this is enforced in code

- `api/src/telehealth.rs` — `RoomConfig` defaults (recording/transcription off).
- `api/src/clinical_endpoints/clinical_support.rs` — `telehealth_recording`
  (consent gate, moderator-only, audit + SSE broadcast) and
  `append_transcript_on_stop` (transcript → visit notes).
- `api/src/services/transcription.rs` — pluggable STT; `NoopTranscriber` default.

## Configuring a real STT provider

`TRANSCRIPTION_PROVIDER` selects the backend. `none` (default) needs no
credentials. Integrating `google` / `aws` / `azure` requires adding that
vendor's SDK + credentials and implementing the `Transcriber` trait; only do so
with a signed BAA/DPA and E2EE disabled + per-session consent as above.
