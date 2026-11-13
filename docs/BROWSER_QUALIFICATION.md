# Browser qualification on an isolated synthetic stack

This workflow runs the existing staff and patient browser suites against a separate
database and fixture cohort. It does not reset the working demonstration database.
The full route/control checklist remains authoritative in
`output/playwright/click-audit-20261008/REMAINING_BROWSER_TESTS_20261016.md`.

## Stack and credentials

Use `docker-compose.yml` with `docker-compose.browser-qualification.yml`, a unique
Compose project name, and a private environment file. The overlay requires generated
database, bootstrap, session, JWT, encryption, search and identity-hashing keys.
Reuse the saved keys when restarting an existing QA volume.

The current run's ignored environment file is
`.browser-test/browserqa-20261017/stack-private.env`. It selects loopback ports
55433 for PostgreSQL and 8889 for the web application. The merged model was checked
for distinct container names and a project-scoped database volume before startup.

```powershell
docker compose -p medichain_browserqa_20261017 `
  --env-file .browser-test/browserqa-20261017/stack-private.env `
  -f docker-compose.yml -f docker-compose.browser-qualification.yml `
  up -d --no-build postgres api nginx
```

The isolation and `!override` port replacement follow Docker's documentation:
[project names](https://docs.docker.com/compose/how-tos/project-name/) and
[Compose merge rules](https://docs.docker.com/reference/compose-file/merge/).

## Select exactly one fixture cohort

Set `MEDICHAIN_FIXTURE_MANIFEST` to an absolute path for the isolated cohort before
seeding or running tests. All staff and patient fixture readers use the same path
resolver. A missing or relative configured path fails instead of falling back to
the default `.browser-test/fixtures.json`.

The current private environment file contains `MEDICHAIN_API_URL`, the manifest
path, fixture password, bootstrap key and the administrator-password fallback.
Load it only into the test process; do not print its values or commit the file.

```powershell
# Run from client/, with the QA environment already loaded into this process.
./node_modules/.bin/vite-node.cmd ../scripts/seed-browser-test-fixtures.ts `
  --i-understand-this-writes-accounts
```

The seeder writes to the selected manifest path. Preserve the default working-stack
manifest. Keep credential-bearing seed output and browser traces under the ignored
QA directory. Browser tests use fresh contexts for the selected stack.

## Run each suite against the deployed portals

Set `E2E_DEPLOYED_URL=http://127.0.0.1:8889`. This disables Playwright's development
server startup. Run one portal suite at a time, with one worker and explicit counts
for failures, skipped tests and retries.

```powershell
# From client/doctor-portal, with the QA environment loaded:
$env:E2E_PORTAL_PREFIX = '/doctor'
$env:PATIENT_APP_URL = 'http://127.0.0.1:8889/patient'
npm exec -- playwright test --config playwright.config.ts --workers=1 --retries=0

# Then from client/patient-app:
$env:E2E_PORTAL_PREFIX = '/patient'
npm exec -- playwright test --config playwright.config.ts --workers=1 --retries=0
```

Store the list log, JSON results, HTML report and retained failure traces in the
ignored QA directory. Record the exact running image digests and fixture-cohort
metadata with each result. The current inventory is 149 staff tests in 30 files and
116 patient tests in 11 files; these counts alone are not execution evidence.

## Limits on a passing result

The overlay is a synthetic development posture: audit sealing is unsigned,
checkpoint export and external delivery are disabled, and telehealth is not
qualified by this stack. A passing browser run does not certify native devices,
real providers, PWA/offline behavior, clinical or legal approval, every control on
every account, or the intended HTTPS production configuration. Those remain
separate requirements in the route/control and deployment ledgers.
