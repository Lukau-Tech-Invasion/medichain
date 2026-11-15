cd api
cargo run --release
```
2. Start Doctor Portal (dev)
```bash
cd client/doctor-portal
npm install
npm run dev
```
3. Use demo flow (DEV mode):
- POST `/api/auth/demo-login` to create a demo user (set `MEDICHAIN_DEV_MODE=true` if needed)
- POST `/api/register` to register a patient
- POST `/api/simulate-nfc-tap` or `/api/emergency-access` to demonstrate emergency access

QA Status
- Formatting & linting: `cargo fmt`, `cargo clippy` applied across repo
- Tests: unit, integration, and E2E tests exist; run `./scripts/test-all.sh`

Notes for Presenters
- Demo endpoints exist and are gated by `MEDICHAIN_DEV_MODE`; remove or gate before production.
- For a quick slide, use this one-pager and refer to `docs/api.md` for endpoint reference.

Documentation
- `docs/api.md` — API endpoint reference
- `docs/architecture.md` — System architecture
- `docs/database-schema.md` — Database schema
- `docs/security.md` — Security documentation
- `docs/SETUP_AND_RUNNING.md` — Development setup guide

````
