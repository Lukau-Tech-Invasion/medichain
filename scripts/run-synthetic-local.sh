#!/usr/bin/env bash
# Synthetic-data-only local run. No PostgreSQL, no chain, no third-party keys.
#
# In-memory repositories are deliberate: the whole process state is ephemeral,
# so the kill switch is "kill the process" and rollback is "restart it". That is
# a stronger isolation property than the docker-compose variant, not a weaker one.
cd "C:/Users/Admin/RustroverProjects/medichain"

export IS_DEMO=true                 # demo secrets permitted; signature verification off
export REQUIRE_SIGNATURES=false

# The demo-only routes need dev mode AND demo mode, both defaulting to off, so
# that enabling them is two deliberate acts rather than one omission. This
# runner set only the second, and its PostgreSQL sibling set both — which is why
# the same harness scored differently on the two backends for a reason that had
# nothing to do with storage.
#
# `synthetic-e2e-test.sh` needs `POST /api/auth/demo-login` to stand up a SECOND
# administrator: retention approval is maker-checker controlled, so the admin
# who requests a token must not be the one who decides it. Without dev mode that
# call is a deliberate 403 and five assertions fail in a cascade whose first
# symptom -- "approval is not executable: status 'pending'" -- points at the
# approval workflow instead of at a missing environment variable.
export MEDICHAIN_DEV_MODE=1
export BLOCKCHAIN_ENABLED=false     # no training chain attached yet; placeholder hashes
export DISPENSING_POLICY_PATH="C:/Users/Admin/RustroverProjects/medichain/api/data/dispensing_policy.example.json"
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
