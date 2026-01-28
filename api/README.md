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
- Demo seeding and demo endpoints are present; consider gating in production.
