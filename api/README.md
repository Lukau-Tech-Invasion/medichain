# API (medichain/api)

Purpose: Actix-web REST API for MediChain. Hosts clinical endpoints, FHIR read endpoints, IPFS integration, auth/demo utilities and supporting services.

Quick run (development):

 - Ensure Rust toolchain from `rust-toolchain.toml` is installed
 - From repository root:
```
cd api
cargo run
```

Key files:
- `src/main.rs` — server bootstrap, route handlers for core API and demo endpoints
- `src/clinical_endpoints.rs` — large collection of clinical handlers and FHIR mappings
- `data/demo_users.json` — demo user seed data

Env / runtime notes:
- Uses `X-User-Id` header for wallet-based auth (SS58 addresses).
- **Secure by default:** wallet signature verification (SEC-005) is ENABLED unless
  you explicitly opt out. With it enabled, every mutating request carrying
  `X-User-Id` must also carry a valid `X-Signature` + `X-Timestamp` (sr25519 over
  `<timestamp>:<wallet_address>`); otherwise `X-User-Id` is treated as
  unauthenticated. Handlers may trust `X-User-Id` as the caller's identity ONLY
  because the middleware binds it to a verified signature.
- For local/demo runs set `IS_DEMO=true` (see root `.env.example`), which disables
  signature verification so requests work with just `X-User-Id`. Never set
  `IS_DEMO=true` in production. Precedence: `REQUIRE_SIGNATURES=true|false`
  overrides the `IS_DEMO`-derived default. When verification ends up disabled the
  server logs a loud startup warning.
- Demo seeding and demo endpoints are present; consider gating in production.
