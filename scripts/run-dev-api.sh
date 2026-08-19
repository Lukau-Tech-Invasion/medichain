#!/usr/bin/env bash
# Run the API against the developer's own PostgreSQL dev stack on :8090.
#
# This is the configuration both browser portals actually talk to
# (client/*/vite.config.ts proxies /api to 127.0.0.1:8090), and it is distinct
# from the two synthetic runners next to it:
#
#   run-synthetic-local.sh     in-memory repositories, nothing survives a restart
#   run-synthetic-postgres.sh  the ISOLATED horizon database on :55432, port 8091
#   run-dev-api.sh   (this)    the main dev database on :5432, port 8090
#
# Storage is PostgreSQL, not in-memory, so clinical data written through the
# portals survives restarting this process — which is the whole point.
set -euo pipefail
cd "$(dirname "$0")/.."

export IS_DEMO=true
export REQUIRE_SIGNATURES=false
export BLOCKCHAIN_ENABLED=false

export MEDICHAIN_STORAGE=postgres
export DATABASE_URL="${DATABASE_URL:-postgres://medichain:medichain_dev_2024@localhost:5432/medichain}"

# Third-party integrations explicitly disabled — a dev run must never reach a
# real SMS gateway or a national-ID registry.
unset AT_API_KEY FAYDA_API_KEY GHANA_CARD_API_KEY NIN_API_KEY SMARTID_API_KEY HUDUMA_API_KEY

# At-rest PHI key. MUST come from .env and MUST stay stable: an unset value makes
# the keyring generate a fresh ephemeral key per process, which silently orphans
# every previously-encrypted patient row on the next restart. That is what left
# 69 patient records undecryptable before the key was pinned on 2026-08-14.
if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi
if [ -z "${ENCRYPTION_KEYS:-}" ]; then
  echo "ENCRYPTION_KEYS is not set (expected in .env) — refusing to start, because" >&2
  echo "an ephemeral key would make everything written this run unreadable later." >&2
  exit 1
fi

# Appointment times are facility wall-clock; without this they are read as UTC
# and both the "past appointment" display and the telehealth join window are
# wrong by the real offset.
export CLINIC_UTC_OFFSET_MINUTES="${CLINIC_UTC_OFFSET_MINUTES:-120}"

export MEDICHAIN_BOOTSTRAP_KEY="${MEDICHAIN_BOOTSTRAP_KEY:-synthetic-test-bootstrap-key-2026}"
export RUST_LOG="${RUST_LOG:-info}"

# 8080 belongs to the IPFS (kubo) gateway. An API bound there steals it, and
# every record download then resolves IPFS_GATEWAY_URL back to the API itself
# and 404s as a misleading "Record content not found".
export PORT="${PORT:-8090}"
export IPFS_API_URL="${IPFS_API_URL:-http://127.0.0.1:5001}"
export IPFS_GATEWAY_URL="${IPFS_GATEWAY_URL:-http://127.0.0.1:8080}"

exec ./target/debug/medichain-api.exe
