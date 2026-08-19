#!/usr/bin/env bash
# Synthetic-data-only local run. No PostgreSQL, no chain, no third-party keys.
#
# In-memory repositories are deliberate: the whole process state is ephemeral,
# so the kill switch is "kill the process" and rollback is "restart it". That is
# a stronger isolation property than the docker-compose variant, not a weaker one.
cd "C:/Users/Admin/RustroverProjects/medichain"

export IS_DEMO=true                 # demo secrets permitted; signature verification off
export REQUIRE_SIGNATURES=false
export BLOCKCHAIN_ENABLED=false     # no training chain attached yet; placeholder hashes
unset MEDICHAIN_STORAGE             # in-memory repositories
unset DATABASE_URL

# Third-party integrations explicitly disabled — testing must never reach a
# real SMS gateway or a national-ID registry.
unset AT_API_KEY
unset FAYDA_API_KEY
unset GHANA_CARD_API_KEY

# Synthetic bootstrap key — this value exists only in this throwaway local run.
export MEDICHAIN_BOOTSTRAP_KEY=synthetic-test-bootstrap-key-2026

# Appointment times are facility wall-clock; without this they are read as
# UTC and the telehealth join window is wrong by the real offset.
export CLINIC_UTC_OFFSET_MINUTES=${CLINIC_UTC_OFFSET_MINUTES:-120}

export RUST_LOG=info

# 8090 is the API's default (see api/src/main.rs): 8080 belongs to the IPFS
# (kubo) gateway, and an API bound there steals it — every record download then
# resolves IPFS_GATEWAY_URL back to the API itself and 404s as a misleading
# "Record content not found". Stated explicitly here so the port is obvious.
export PORT=${PORT:-8090}
export IPFS_API_URL=${IPFS_API_URL:-http://127.0.0.1:5001}
export IPFS_GATEWAY_URL=${IPFS_GATEWAY_URL:-http://127.0.0.1:8080}

exec ./target/debug/medichain-api.exe
