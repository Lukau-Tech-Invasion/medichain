# TLS / HTTPS (Phase 6.2)

MediChain terminates TLS at a **Caddy reverse proxy** rather than in the Actix
process. This is the standard production pattern: automatic Let's Encrypt
certificates + renewal, HTTP→HTTPS redirect, and HTTP/2 — with zero certificate
code in the API.

## Run it

```bash
# Local (Caddy issues an internal self-signed cert for localhost)
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d

# Production
export DOMAIN=app.medichain.health
export API_DOMAIN=api.medichain.health
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d
```

Caddy listens on :80/:443, obtains/renews certificates automatically, and proxies
to the `api` service on :8080. See `Caddyfile`.

## How HTTPS is enforced

| Layer | Mechanism |
|-------|-----------|
| HTTP → HTTPS redirect | Caddy default behavior on :80 |
| Edge HSTS | `Strict-Transport-Security` set in the `Caddyfile` |
| App HSTS + hardening | `SecurityHeadersMiddleware` (`api/src/middleware/security_headers.rs`) emits HSTS (when `X-Forwarded-Proto: https`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` |
| Forwarded scheme | Caddy sets `X-Forwarded-Proto`; the API uses it to decide whether to emit HSTS (avoids pinning plain-HTTP dev origins) |

## Certificates

- **Automatic** via Caddy + Let's Encrypt (ACME HTTP-01). Just point DNS at the host.
- Certs/keys persist in the `caddy_data` Docker volume.
- For an internal CA / corporate PKI, mount your cert+key and use Caddy's `tls <cert> <key>` directive instead of automatic issuance.

## Alternative: native Actix TLS

Actix supports `bind_rustls_0_23` directly. It's intentionally **not** enabled
here to avoid coupling the build to a rustls version and to certificate-file
management; the reverse-proxy approach is preferred for production. If you need
in-process TLS, add the `rustls-0_23` feature to `actix-web` plus `rustls` /
`rustls-pemfile`, load a `ServerConfig` from `TLS_CERT_PATH`/`TLS_KEY_PATH`, and
swap `.bind()` for `.bind_rustls_0_23()` in `main.rs`.
```
