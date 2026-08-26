#!/usr/bin/env bash
# Prove a clinical write survives an API restart.
#
# The interesting failure this catches is not "does the process come back" —
# it is a handler that returned 201 while holding the record in process memory.
# MediChain has had that defect class repeatedly (see
# `docs/memory` notes on silent writes and AppState maps), which is why the
# check is "write, kill, restart, read back" rather than "restart, then poke".
#
# It also proves the encryption keyring survives. An API that starts with a
# fresh ENCRYPTION_KEYS value comes up healthy and then cannot decrypt a single
# existing patient — the failure that once left 69 records unreadable — so the
# verify step reads an encrypted field back, not just a row count.
#
# Usage: bash scripts/reliability-restart.sh
# Exit 0 = the write survived and encrypted data still decrypts.
set -uo pipefail

cd "$(dirname "$0")/.."

API_HEALTH="http://127.0.0.1:8090/health"
RUNNER="client/node_modules/.bin/vite-node"

if [ ! -x "$RUNNER" ]; then
  echo "vite-node not found at $RUNNER — run npm install in client/ first" >&2
  exit 1
fi

wait_for_api() {
  local label="$1"
  for _ in $(seq 1 90); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$API_HEALTH" 2>/dev/null)" = "200" ]; then
      echo "  API is up ($label)"
      return 0
    fi
  done
  echo "  API did not come up ($label)" >&2
  return 1
}

echo
echo "Reliability: API restart durability"
echo "==================================="

wait_for_api "before" || exit 1

echo
echo "1. Writing a clinical record"
( cd client && MEDICHAIN_API_URL=http://127.0.0.1:8090/api ../"$RUNNER" \
    ../scripts/reliability-performance.ts --seed-only ) || {
  echo "  seeding failed" >&2
  exit 1
}

echo
echo "2. Killing the API"
# SIGKILL, not a graceful shutdown. A clean stop lets a handler flush; the
# question is whether the record was durable at the moment it was acknowledged.
taskkill //F //IM medichain-api.exe >/dev/null 2>&1 || true
KILLED_AT=$(date +%s)
sleep 2

if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$API_HEALTH" 2>/dev/null)" = "200" ]; then
  echo "  the API is still answering — it was not actually killed" >&2
  exit 1
fi
echo "  confirmed down"

echo
echo "3. Restarting"
nohup bash scripts/run-dev-api.sh > /tmp/api-restart.log 2>&1 &
wait_for_api "after" || exit 1
RECOVERED_AT=$(date +%s)
echo "  recovery took $((RECOVERED_AT - KILLED_AT))s (includes migration replay)"

echo
echo "4. Verifying the write survived"
( cd client && MEDICHAIN_API_URL=http://127.0.0.1:8090/api ../"$RUNNER" \
    ../scripts/reliability-performance.ts --verify-only )
RC=$?

echo
if [ $RC -eq 0 ]; then
  echo "RESULT: the write survived a hard kill, and encrypted data still decrypts."
else
  echo "RESULT: FAILED — see above." >&2
fi
exit $RC
