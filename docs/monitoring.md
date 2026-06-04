# Telehealth Monitoring & Alerting

_MediChain — Telehealth Plan Phase 8. Last updated: 2026-06-04._

What to watch in production and how to wire it up. The API already exposes the
primary signal; the rest is ops configuration.

## Health signal

`GET /api/health/telehealth` (unauthenticated, under the `/api/health` bypass)
returns:

```json
{
  "status": "healthy",
  "domain": "meet.example.org",
  "provider": "jitsi",
  "jwt_configured": true,
  "response_time_ms": 87,
  "http_status": 200
}
```

- HTTP `200` when the Jitsi domain is reachable, `503` otherwise.
- Point the load balancer / uptime monitor at this path.

## Metrics to track

| Metric | Source | Why |
|--------|--------|-----|
| Jitsi reachability + latency | `/api/health/telehealth` `status` / `response_time_ms` | Detect Jitsi/network outages |
| Session success rate | ratio of `conference-joined` to `created` (SSE/audit) | Detect join failures |
| Error rate | count of `telehealth` SSE/audit events with `event = error` | Detect systemic call failures |
| Avg connection time | client timing from join → `videoConferenceJoined` | UX regression signal |
| Recording start/stop | audit rows `telehealth_recording` | Compliance + capacity |
| Concurrent sessions | count of `status = InProgress` sessions | Capacity planning / JVB load |

The lifecycle audit rows (`resource_type = "telehealth"` /
`"telehealth_recording"`) and the SSE `telehealth` channel are the data sources;
no extra instrumentation is required to start.

## Suggested alerts

- **Jitsi down:** `/api/health/telehealth` non-200 for > 2 min → page on-call.
- **High error rate:** telehealth `error` events > 10% of joins over 15 min.
- **Slow health probe:** `response_time_ms` > 1500 ms sustained → investigate
  network / JVB.
- **JWT misconfig:** `jwt_configured = false` in prod → critical (open rooms!).

## Tooling options

- **Prometheus + Grafana:** scrape a thin exporter that polls
  `/api/health/telehealth` and counts audit rows; dashboard the table above.
- **CloudWatch / managed APM:** a synthetic canary hitting the health endpoint
  plus log-metric filters on the audit log covers most of the alerts above
  without standing up Prometheus.

## Self-hosted Jitsi host metrics

When self-hosting (`docs/jitsi-deployment.md`), also watch the JVB host: CPU,
memory, and UDP 10000 throughput — the videobridge is the first thing to
saturate under participant load.
