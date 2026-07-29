#!/usr/bin/env bash
# Run the API against the ISOLATED synthetic Postgres (docker-compose.horizon-isolated.yml).
#
# Prerequisite:
#   docker compose -p medichain_horizon -f docker-compose.yml \
#     -f docker-compose.horizon-isolated.yml up -d postgres
#
# This is a different database from the developer's own dev stack: distinct
# compose project, distinct container name, distinct volume, distinct
# credentials, and published on 127.0.0.1:55432 rather than 5432 so the two can
# never be confused. Synthetic data only.
cd "$(dirname "$0")/.."

export IS_DEMO=true
export REQUIRE_SIGNATURES=false
export BLOCKCHAIN_ENABLED=false

export MEDICHAIN_STORAGE=postgres
export DATABASE_URL="postgres://medichain_horizon:horizon-isolated-synthetic-only@127.0.0.1:55432/medichain_horizon"

# Third-party integrations explicitly disabled — testing must never reach a
# real SMS gateway or a national-ID registry.
unset AT_API_KEY FAYDA_API_KEY GHANA_CARD_API_KEY NIN_API_KEY SMARTID_API_KEY HUDUMA_API_KEY

export MEDICHAIN_BOOTSTRAP_KEY=synthetic-test-bootstrap-key-2026
export RUST_LOG=info
# 8080 is taken by the IPFS gateway (see docker-compose.yml) — use a distinct port.
export PORT=8091

exec ./target/debug/medichain-api.exe
