# PostgreSQL setup for MediChain

This guide covers the current PostgreSQL-backed API. For the full environment
contract and quality commands, see [CLAUDE.md](CLAUDE.md). For account creation
and sign-in, see [docs/DEV_AUTH.md](docs/DEV_AUTH.md).

## Configure an isolated development database

Copy `.env.example` to `.env` and set the database connection, PostgreSQL
credentials, session secret, JWT secret, encryption keyring, patient-search
index key, and `MEDICHAIN_BOOTSTRAP_KEY` for your environment. Keep real values
out of source control. The bootstrap key must contain at least 32 bytes. The
example file documents the remaining production requirements.

`docker-compose.yml` defines PostgreSQL 16 and the API. It sets
`MEDICHAIN_STORAGE=postgres` for the containerized API and passes the bootstrap
key from the environment. The API listens on port 8080 inside its container;
the Compose reverse proxy exposes the API on port 80. A locally run API uses
its configured `PORT` (default 8090) and the local `DATABASE_URL`.

To start only PostgreSQL when you are ready to run services:

```powershell
docker compose up -d postgres
docker compose ps postgres
```

To inspect migrations and health after starting the API:

```powershell
docker compose exec postgres psql -U medichain -d medichain -c "SELECT version, success FROM _sqlx_migrations ORDER BY version;"
curl.exe http://localhost/health/db
```

Adjust the `psql` user and database if you changed `POSTGRES_USER` or
`POSTGRES_DB`. Do not use `docker compose down -v` on a database you intend to
keep: it removes the named PostgreSQL volume.

## Provision accounts

The first administrator is created through `POST /api/auth/bootstrap` with the
operator-supplied `MEDICHAIN_BOOTSTRAP_KEY`. Redeem the returned one-time code at
`POST /api/auth/credentials/redeem`, then sign in through the portal or
`POST /api/auth/login`. Protected API requests use
`Authorization: Bearer <access-token>`. Administrators create staff accounts;
clinical registration creates patient accounts and activation codes.

**Current first-run limitation (2026-10-05):** the historical migrations still
insert credentialless demo accounts and patients. Those rows cause first-admin
bootstrap to be refused on a fresh database. A provisional source repair exists,
but a rebuilt runtime and the requested cleanup of existing databases are not
yet verified. Do not treat this guide as proof that new account provisioning is
working. Current status is in `docs/TECHNICAL_DEBT_REGISTER.md`; the October
verification report is archived at
[docs/archive/FULL_APPLICATION_VERIFICATION_REPORT-2026-10.md](docs/archive/FULL_APPLICATION_VERIFICATION_REPORT-2026-10.md).

For synthetic browser testing, use an isolated development database and
`scripts/seed-browser-test-fixtures.ts`. The script requires a configured
bootstrap key for a fresh database or credentials for an existing administrator.
It writes test accounts and is not a production seeding step.

## Verify persistence

After a successful credentialed create/read flow, restart the API process and
repeat the authenticated read. Compare the returned record identifiers and
content. A healthy `/health/db` response confirms connectivity only; it does
not prove that records, encryption keys, sessions, or workflows survive a
restart. Run the appropriate role journeys and browser tests described in
`CLAUDE.md` before claiming end-to-end verification.
