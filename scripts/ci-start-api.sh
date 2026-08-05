#!/usr/bin/env bash
# Start the API in the background and block until it is genuinely serving.
#
# Shared by both legs of the CI e2e matrix so the memory and PostgreSQL runs
# differ ONLY in their environment. If the startup logic differed between them,
# a difference in results would no longer isolate the backend, which is the
# entire point of running both.
#
# Writes the pid to /tmp/api.pid and the log to /tmp/api.log for the caller.
set -euo pipefail

BIN="${API_BIN:-./target/debug/medichain-api}"
HEALTH_URL="http://127.0.0.1:${PORT:-8090}/health"
TIMEOUT_SECS="${STARTUP_TIMEOUT_SECS:-60}"

# Refuse to start if something is ALREADY serving on the port. Without this the
# health probe below can succeed against a stale process and the whole suite
# then tests a binary nobody built — observed locally, where a leftover server
# made a deliberately broken API_BIN report "healthy after 1s".
if curl -sf -m 2 "$HEALTH_URL" > /dev/null 2>&1; then
    echo "::error::Something is already serving ${HEALTH_URL}; refusing to start."
    echo "          The suite would test that process instead of this build."
    exit 1
fi

"$BIN" > /tmp/api.log 2>&1 &
echo $! > /tmp/api.pid

for i in $(seq 1 "$TIMEOUT_SECS"); do
    # Liveness BEFORE readiness, deliberately. Probing health first means a
    # dead process plus an occupied port reads as success; checking that the
    # process we launched is still alive makes that impossible.
    if ! kill -0 "$(cat /tmp/api.pid)" 2>/dev/null; then
        echo "::error::API process exited during startup"
        cat /tmp/api.log
        exit 1
    fi
    if curl -sf -m 2 "$HEALTH_URL" > /dev/null 2>&1; then
        echo "API healthy after ${i}s"
        exit 0
    fi
    # Poll rather than sleeping a fixed interval: a fixed sleep is either slower
    # than needed or flaky on a loaded runner, and both failure modes get blamed
    # on the tests rather than on the wait.
    sleep 1
done

echo "::error::API did not become healthy within ${TIMEOUT_SECS}s"
cat /tmp/api.log
exit 1
