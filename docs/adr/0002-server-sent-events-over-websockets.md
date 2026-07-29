# ADR-0002: Server-Sent Events instead of WebSockets

- **Status:** Accepted
- **Date:** 2026-02 (recorded retrospectively 2026-07-29)
- **Deciders:** Founder

## Context

Clinicians need live updates: new lab results, triage queue changes, telehealth
status. The deployment target is African clinics — constrained bandwidth, captive
portals, corporate proxies, and 2G in places.

## Options considered

**A. WebSockets.** Bidirectional, low overhead once established. Rejected as the
default: upgrade handshakes are frequently broken by intermediary proxies, and the
application does not actually need a client-to-server stream — clients already
have HTTP for writes.

**B. Polling.** Trivially compatible, works everywhere. Rejected: wasteful on
metered connections, and latency is poor precisely when it matters.

**C. Server-Sent Events.** *(chosen)* Ordinary HTTP, so proxies and TLS
termination handle it as a normal long response. Automatic reconnection with
`Last-Event-ID` is part of the browser contract rather than something to build.

## Decision

`GET /api/events` streams SSE. Writes stay on ordinary REST endpoints.

## Consequences

**Gained.** Works through infrastructure that breaks WebSocket upgrades. Reconnect
and resume come free. Server-side implementation is a stream of formatted text —
substantially less machinery to get wrong.

**Cost.** One-directional only, so any future client-push feature needs a
different transport. Each stream holds a connection, which bounds concurrency per
worker.

**Outstanding — and worth stating plainly.** The backend is implemented and
working. **No frontend consumes it.** There is no `EventSource` anywhere in
`client/`. The transport decision is sound; the feature is unfinished, and calling
it "real-time enabled" would be false. Tracked as a known gap in the README.
