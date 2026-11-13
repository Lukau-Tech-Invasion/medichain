#!/usr/bin/env bash
# Synthetic-data-only local run. No checkpoint export, no third-party keys.
#
# PostgreSQL is REQUIRED: signing in creates a session row, so an API without a
# database cannot authenticate anyone. Point DATABASE_URL at a THROWAWAY database
# (the harness bootstraps an administrator and registers accounts in it); for the
# isolated one use scripts/run-synthetic-postgres.sh instead.
#   DATABASE_URL=postgres://... bash scripts/run-synthetic-local.sh
cd "C:/Users/Admin/RustroverProjects/medichain"

export IS_DEMO=true                 # demo secrets permitted

# The demo-only routes need dev mode AND demo mode, both defaulting to off, so
# that enabling them is two deliberate acts rather than one omission. This
# runner set only the second, and its PostgreSQL sibling set both — which is why
# the same harness scored differently on the two backends for a reason that had
# nothing to do with storage.
#
export MEDICHAIN_DEV_MODE=1
export AUDIT_CHECKPOINT_SINK=none    # no checkpoint is exported
export DISPENSING_POLICY_PATH="C:/Users/Admin/RustroverProjects/medichain/api/data/dispensing_policy.example.json"
: "${DATABASE_URL:?set DATABASE_URL to a throwaway PostgreSQL database; signing in needs one}"
export MEDICHAIN_STORAGE=postgres

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

# Metrics are read with a bearer token, as production reads them. Set here
# explicitly: the API loads the repository's .env, and a METRICS_TOKEN there
# would otherwise decide what this run asserts.
export METRICS_TOKEN=${METRICS_TOKEN:-synthetic-metrics-token-2026}

# 8090 is the API's default (see api/src/main.rs): 8080 belongs to the IPFS
# (kubo) gateway, and an API bound there steals it — every record download then
# resolves IPFS_GATEWAY_URL back to the API itself and 404s as a misleading
# "Record content not found". Stated explicitly here so the port is obvious.
export PORT=${PORT:-8090}
export IPFS_API_URL=${IPFS_API_URL:-http://127.0.0.1:5001}
export IPFS_GATEWAY_URL=${IPFS_GATEWAY_URL:-http://127.0.0.1:8080}

exec ./target/debug/medichain-api.exe
