# Self-Hosted Jitsi Deployment (Telehealth Phase 5)

MediChain telehealth uses JWT-authenticated Jitsi rooms. **JWT auth only works on
a self-hosted Jitsi (or 8x8 JaaS) — never on public `meet.jit.si`.** This guide
stands up a self-hosted instance whose Prosody validates the exact HS256 tokens
the API mints in `api/src/telehealth.rs`.

## How the pieces fit

```
Doctor portal ──join──▶ API (POST /api/telehealth/sessions/{id}/join)
                         │  signs HS256 JWT (JITSI_APP_ID/JITSI_APP_SECRET)
                         ▼
                 { jitsi: { domain, room, jwt, moderator } }
                         │
JitsiMeetExternalAPI(domain, { jwt }) ──▶ self-hosted Jitsi
                                           Prosody validates JWT with the SAME secret
```

The single source of truth is the shared secret: the API's `JITSI_APP_SECRET`
**must equal** Prosody's `JWT_APP_SECRET`, and `JITSI_APP_ID` == `JWT_APP_ID`.

## 1. Prerequisites

- A host (AWS EC2 / GCP Compute, ≥ 2 vCPU / 4 GB for small clinics).
- A DNS A record → host IP for `JITSI_DOMAIN` (e.g. `meet.medichain.health`).
- Open firewall ports: **TCP 443** (web) and **UDP 10000** (JVB media). UDP 10000 is mandatory — without it, calls connect but carry no audio/video.

## 2. Configure

1. Copy Jitsi's `env.example` into `.env` and run their `gen-passwords.sh` to fill the internal component secrets.
2. Add MediChain's variables to the same `.env`:

   ```bash
   JITSI_DOMAIN=meet.medichain.health
   JITSI_APP_ID=medichain
   JITSI_APP_SECRET=<a long random secret>   # API + Prosody share this
   JVB_ADVERTISE_IPS=<host public IP>
   JITSI_CONFIG=./.jitsi-config
   ```

3. Point the **API** at the same values (its `.env`): identical `JITSI_DOMAIN`, `JITSI_APP_ID`, `JITSI_APP_SECRET`. The API signs `sub = JITSI_DOMAIN`, so they must match.

## 3. Run

```bash
docker compose -f docker-compose.yml -f docker-compose.jitsi.yml up -d
```

Services: `jitsi-web`, `jitsi-prosody` (JWT auth), `jitsi-jicofo`, `jitsi-jvb`.

## 4. TLS

Front Jitsi with the Caddy reverse proxy (see `TLS.md`) or terminate TLS in
`jitsi-web` directly (`ENABLE_LETSENCRYPT=1` + `LETSENCRYPT_DOMAIN`/`LETSENCRYPT_EMAIL`
in `.env`). Production must be HTTPS — browsers block camera/mic on plain HTTP.

## 5. TURN / NAT traversal

`jitsi-jvb` advertises `JVB_ADVERTISE_IPS` for direct UDP. For restrictive
networks (mobile/clinic NAT), deploy **coturn** and set the TURN server in the
web config (`TURNS` env). Without TURN, some mobile clients fail to connect.

## 6. Verify

- API health probe: `GET /api/health/telehealth` →
  `{ status: "healthy", domain, provider: "jitsi", jwt_configured: true, response_time_ms }`.
  Wire this into your load balancer's health checks.
- End-to-end: create a session, click **Join** in the doctor portal — the call
  should open with the provider as **moderator** (badge shown) and no prejoin auth
  prompt (the JWT authenticated them).

## 7. Monitoring

- Scrape the API `/api/metrics` (see `observability/`) for telehealth route latency.
- Watch JVB for participant count + bandwidth; alert on JVB restarts.
- Scaling beyond ~1 JVB requires JVB clustering (deferred — Phase 6+).

## Fallback

If `JITSI_APP_SECRET` is unset, the API issues **no** JWT and rooms are open
(unauthenticated) — fine for demos on `meet.jit.si`, **not** for PHI. Set the
secret + self-host before handling real patient data.
