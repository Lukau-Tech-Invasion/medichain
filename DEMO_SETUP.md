# MediChain synthetic demo setup

Use an isolated PostgreSQL database containing synthetic data. The current
account and sign-in contract is in [docs/DEV_AUTH.md](docs/DEV_AUTH.md), and
deployment configuration is in [CLAUDE.md](CLAUDE.md).

## Demo stack

When you are ready to start services, configure `.env` from `.env.example` and
run the demo override explicitly:

```powershell
docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --build
```

The override enables demo credential buttons and exports sealed, unsigned
audit checkpoints to a local volume. Its credentials endpoint still requires
both demo and development mode. It is suitable only for synthetic data.

## Create real demo accounts and patients

First provision an administrator through `POST /api/auth/bootstrap` using the
operator's `MEDICHAIN_BOOTSTRAP_KEY`. Redeem the returned one-time code to set a
password and sign in. For the deterministic demo-data script, provide the
administrator's login ID and password plus a password for new demo accounts:

```powershell
$env:DEMO_SEED_LOGIN_ID = '<admin-login-id>'
$env:DEMO_SEED_PASSWORD = '<admin-password>'
$env:DEMO_ACCOUNT_PASSWORD = '<synthetic-account-password>'
$env:API_BASE = 'http://localhost'
python scripts/seed-demo-data.py
```

The script creates staff through administrator registration and one-time code
redemption, then acts through authenticated bearer-token requests. It never
starts the API or writes directly to PostgreSQL. Use an isolated development
database and remove these environment values from the shell after the run.

**Provisioning status (2026-10-05):** historical migrations still insert
credentialless demo accounts, and the source repair for first-admin bootstrap
has not been verified in a rebuilt runtime. Existing-database cleanup is also
pending. See [FULL_APPLICATION_VERIFICATION_REPORT.md](FULL_APPLICATION_VERIFICATION_REPORT.md)
before relying on these steps for a demo.

## Browser verification

The browser fixture script creates synthetic accounts through the same
credential path. For a fresh database, set `MEDICHAIN_BOOTSTRAP_KEY`; for a
database with a working administrator, set `MEDICHAIN_ADMIN_LOGIN_ID` and
`MEDICHAIN_ADMIN_PASSWORD`. The script records fixture credentials in
`.browser-test/fixtures.json`. Run the role journeys and browser suites from
the commands in `CLAUDE.md` and `docs/ROLE_JOURNEYS.md`.

Use a bearer token for protected API checks:

```powershell
curl.exe -H "Authorization: Bearer $env:ACCESS_TOKEN" http://localhost/api/patients
```

A successful health request confirms connectivity; it does not prove a user
can complete a clinical workflow or that data survives an API restart.
