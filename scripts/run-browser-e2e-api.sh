#!/usr/bin/env bash
# The API, configured the way the browser suites need it.
#
# `playwright.local-api.config.ts` points its dev server at 127.0.0.1:8090 so a
# locally built change can actually be tested — the default config adopts a
# stray dev server proxying to the Docker image, which is how those suites came
# to be green about a week-old API.
#
# Assembling this environment by hand is what stopped anyone running them. Four
# things are required and none are defaults:
#
#   1. PostgreSQL. Credential sign-in reads `users.credential_verifier` and
#      `users.encrypted_keystore`; with no pool the endpoint answers
#      CREDENTIAL_LOGIN_UNAVAILABLE and every test fails at the login screen.
#   2. MEDICHAIN_DEV_MODE. Without it `GET /api/auth/demo-credentials` is a
#      deliberate 403 and no demo buttons render, so `signIn()` waits for a
#      button that will never exist.
#   3. DISPENSING_POLICY_PATH. Without it the fixture seeder's pharmacy journey
#      dies with DISPENSING_POLICY_UNAVAILABLE.
#   4. ENCRYPTION_KEYS matching whatever wrote the rows already in that
#      database. A different key does not error — it decrypts to nothing, and
#      the patient roster silently comes back short.
#
# Then, once this is up:
#
#   npx tsx scripts/seed-browser-test-fixtures.ts
#   cd client/doctor-portal && npx playwright test --config playwright.local-api.config.ts
#
# Not to be confused with its two siblings, which answer different questions:
#
#   run-synthetic-local.sh     in-memory, no database at all — the strongest
#                              isolation, and useless for credential sign-in.
#   run-synthetic-postgres.sh  the ISOLATED synthetic database on :55432, port
#                              8091. That one is for `synthetic-e2e-test.sh`,
#                              which creates everything it needs.
#
# This one deliberately uses the developer's own dev database on :5432, because
# that is where the browser fixtures live and where their encrypted records were
# written.
#
set -euo pipefail
cd "$(dirname "$0")/.."

# ENCRYPTION_KEYS lives in .env, never in this file: it is the key the patient
# capsules were sealed with, and a repository is not where a key belongs.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -z "${ENCRYPTION_KEYS:-}" ]; then
  echo "ENCRYPTION_KEYS is not set (looked in the environment and ./.env)." >&2
  echo "Without the key that sealed them, existing patient records decrypt to" >&2
  echo "nothing and the roster comes back short rather than failing — so this" >&2
  echo "refuses to start instead." >&2
  exit 1
fi

BIN=./target/debug/medichain-api.exe
[ -x "$BIN" ] || BIN=./target/debug/medichain-api
if [ ! -x "$BIN" ]; then
  echo "No API binary at ./target/debug/. Build it first:" >&2
  echo "  cargo build --bin medichain-api" >&2
  exit 1
fi

export DATABASE_URL="${DATABASE_URL:-postgres://medichain:medichain_dev_2024@localhost:5432/medichain}"
export MEDICHAIN_STORAGE=postgres
export IS_DEMO=true
export REQUIRE_SIGNATURES=false
export MEDICHAIN_DEV_MODE=1
# 5. Rate limits the browser suites can actually live inside.
#
# The API allows 60 requests/minute anonymous and 120 per authenticated user.
# A browser suite drives ONE signed-in account through a whole clinical
# workflow as fast as Playwright can click, and a 52-test serial run blows
# through the default per-minute budget for that user well before it finishes.
#
# The failure does not look like a rate limit. Sign-ins are starved mid-suite
# and the run reports product failures: a run on 2026-09-15 said "8 passed,
# 40 did not run" against 769 rate-limit rejections in the API log, for specs
# that were entirely green when run alone. Anyone reading that output would
# start debugging the wrong thing.
#
# Raised here only, for this harness. Production sets neither variable and gets
# the shipped defaults; a zero or unparseable value keeps them too, so a typo
# cannot switch the limiter off.
export MEDICHAIN_RATE_LIMIT_ANONYMOUS="${MEDICHAIN_RATE_LIMIT_ANONYMOUS:-6000}"
export MEDICHAIN_RATE_LIMIT_AUTHENTICATED="${MEDICHAIN_RATE_LIMIT_AUTHENTICATED:-6000}"
export BLOCKCHAIN_ENABLED=false
export DISPENSING_POLICY_PATH="$(pwd)/api/data/dispensing_policy.example.json"

# Third-party integrations stay off: a browser test must never reach a real SMS
# gateway or a national-ID registry.
unset AT_API_KEY FAYDA_API_KEY GHANA_CARD_API_KEY 2>/dev/null || true

export MEDICHAIN_BOOTSTRAP_KEY="${MEDICHAIN_BOOTSTRAP_KEY:-synthetic-test-bootstrap-key-2026}"
export CLINIC_UTC_OFFSET_MINUTES="${CLINIC_UTC_OFFSET_MINUTES:-120}"

# 8090, not 8080: 8080 is the IPFS gateway's port. An API bound there steals it
# and every record download 404s as a misleading RECORD_NOT_FOUND.
export PORT="${PORT:-8090}"
export IPFS_API_URL="${IPFS_API_URL:-http://127.0.0.1:5001}"
export IPFS_GATEWAY_URL="${IPFS_GATEWAY_URL:-http://127.0.0.1:8080}"

export RUST_LOG="${RUST_LOG:-info}"

exec "$BIN"
