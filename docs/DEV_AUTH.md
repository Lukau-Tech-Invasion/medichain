# Developer Auth & Demo Seed Guidance

This document explains how the API authenticates clients during development, how demo data is seeded, and safe steps to enable demo endpoints for local testing.

## Wallet-based auth (X-User-Id)

- MediChain authenticates with Substrate-style SS58 wallet addresses.
- The API expects callers to set `X-User-Id` header to a wallet address (48-char Substrate address starting with `5`).

Example request header:

```
X-User-Id: 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
```

Notes:
- Do not expose real production wallet keys during development; use demo or generated addresses.
- The API uses the header to look up the user and enforce RBAC. Many endpoints also honor `X-Provider-Role` and `X-Health-Id` when applicable.

## Demo endpoints & seeding

Files and locations:
- Demo users JSON: `api/data/demo_users.json`
- Seed logic: `api/src/services/user_service.rs` (function `seed_demo_users`)
- Demo endpoints: `/api/demo`, `/api/auth/demo-login` (used by client auth stores)

By default, demo endpoints are only intended for development. To enable and seed demo data locally:

1. Ensure you are on a development environment and not pointed at production databases.
2. Set a local Postgres `DATABASE_URL` pointing to a dev DB.
3. Start the API with demo seed enabled (example pattern used in repo):

PowerShell example:

```powershell
# From repo root
# Ensure you have a local Postgres and DATABASE_URL set
$env:DATABASE_URL = "postgres://medichain_dev:password@localhost:5432/medichain_dev"
# Run API which will seed demo users if configured
cd api
cargo run
```

If the project exposes an explicit feature or env var to gate demo endpoints (e.g., `ENABLE_DEMO_ENDPOINTS`), prefer toggling that rather than altering code.

## Safe workflow suggestions

- Create a disposable local DB (docker/postgres) before seeding demo data.
- Seed only in development branch or with an explicit branch/flag.
- If you need CI-level demo seeds, ensure the pipeline uses ephemeral DB instances and secrets are not stored in repo.

## Quick checks

- Confirm demo wallets exist in `api/data/demo_users.json` and match `seed_demo_users` in `api/src/services/user_service.rs`.
- Use `GET /api/demo` after starting the API to verify demo endpoints are available.

---

If you want, I can now draft the PR with these doc changes and include the `docs/frontend-backend-mapping.csv` as an artifact. Would you like me to open that PR?