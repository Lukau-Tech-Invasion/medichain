#!/usr/bin/env bash
# Rehearse the two operational safety controls that the Horizon active-testing
# gate depends on: MONITORING and the KILL SWITCH.
#
# WHY THIS EXISTS AS A SCRIPT, not a one-off terminal session:
# a control that was verified once, by hand, months ago, is indistinguishable
# from one that has quietly rotted. The gate asks for "rehearsed, not merely
# configured", and a rehearsal you cannot repeat on demand decays into a claim.
#
# WHAT "VERIFIED" MEANS HERE — the distinction this script is built around:
#   - Monitoring is NOT verified by /api/metrics returning 200. It is verified
#     by driving a KNOWN number of requests and confirming the exported series
#     moved by exactly that number. An endpoint that answers 200 with stale,
#     empty, or unchanging series is the failure mode that matters, and a status
#     check cannot see it. (This campaign has already found five green signals
#     that meant nothing; this is the sixth candidate.)
#   - The kill switch is NOT verified by the kill command exiting 0. It is
#     verified by the port afterwards REFUSING CONNECTIONS. An earlier capture
#     in this campaign was misled by exactly this: it read a 404 as "stopped",
#     when the 404 came from a different service still listening on the port.
#     Connection-refused (curl code 000) and "something answered 404" are
#     opposite outcomes, and only one of them means the switch worked.
#
# Synthetic data only; in-memory storage; no third-party integrations.
# Usage: bash scripts/rehearse-safety-controls.sh [--keep-running]
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PORT="${PORT:-8090}"
BASE="http://127.0.0.1:${PORT}"
BIN="${API_BIN:-./target/debug/medichain-api.exe}"
METRICS_TOKEN="${METRICS_TOKEN:-synthetic-rehearsal-metrics-token-2026}"
LOG=/tmp/rehearse-api.log
PIDFILE=/tmp/rehearse-api.pid

pass_count=0
fail_count=0

say()  { printf '%s\n' "$*"; }
head1() { printf '\n=== %s ===\n' "$*"; }

check() { # check <description> <actual> <expected>
    local desc="$1" actual="$2" expected="$3"
    if [ "$actual" = "$expected" ]; then
        say "  PASS  ${desc} (${actual})"
        pass_count=$((pass_count + 1))
    else
        say "  FAIL  ${desc} — expected '${expected}', got '${actual}'"
        fail_count=$((fail_count + 1))
    fi
}

check_ge() { # check_ge <description> <actual> <minimum>
    local desc="$1" actual="$2" min="$3"
    if [ "${actual:-0}" -ge "$min" ] 2>/dev/null; then
        say "  PASS  ${desc} (${actual} >= ${min})"
        pass_count=$((pass_count + 1))
    else
        say "  FAIL  ${desc} — expected >= ${min}, got '${actual}'"
        fail_count=$((fail_count + 1))
    fi
}

# Status code, or 000 when the connection itself failed. The 000-vs-HTTP
# distinction is the whole point of the kill-switch section below.
#
# curl ALREADY prints 000 through -w when the connection fails, and it also
# exits non-zero. A `|| echo 000` fallback therefore emits '000000' — which
# equals neither '000' nor any status, so every comparison silently goes the
# wrong way. (First draft of this script did exactly that and refused to start,
# insisting a dead port was occupied.) The fallback here covers only curl
# producing no output at all, e.g. curl missing from the image.
probe() {
    local code
    code="$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$1" 2>/dev/null)"
    printf '%s' "${code:-000}"
}

scrape() { curl -s -m 5 -H "Authorization: Bearer ${METRICS_TOKEN}" "${BASE}/api/metrics" 2>/dev/null; }

# Sum a counter across all label sets whose line matches the given grep pattern.
# Summing rather than reading one line keeps the assertion honest if a label we
# do not control (e.g. status) splits the series.
counter_sum() { # counter_sum <metrics-text> <grep-pattern>
    printf '%s\n' "$1" | grep -E "$2" | grep -v '^#' | awk '{s += $NF} END {printf "%d", s+0}'
}

# Stop a process started by this script, and SAY which mechanism did it.
#
# `echo $!` under Git Bash yields an MSYS pid, not a Windows one, so taskkill
# //PID cannot see it and always fails here — an earlier version put taskkill
# first and passed only because the `kill -9` fallback ran afterwards. A kill
# switch whose working mechanism is an accident of ordering is not rehearsed,
# it is lucky. kill -9 is therefore primary; taskkill remains as the fallback
# for a native Windows shell, where the reverse is true.
stop_process() { # stop_process <pid>
    local pid="$1"
    if kill -9 "$pid" 2>/dev/null; then
        say "  stop mechanism: kill -9 ${pid}"
    elif taskkill //F //PID "$pid" > /dev/null 2>&1; then
        say "  stop mechanism: taskkill //F //PID ${pid}"
    else
        say "  stop mechanism: NEITHER kill -9 NOR taskkill accepted pid ${pid}"
        return 1
    fi
}

start_api() {
    if [ "$(probe "${BASE}/health")" != "000" ]; then
        say "REFUSING TO START: something already serves ${BASE}/health."
        say "The rehearsal would measure that process instead of this build."
        exit 1
    fi

    IS_DEMO=true \
    REQUIRE_SIGNATURES=false \
    BLOCKCHAIN_ENABLED=false \
    MEDICHAIN_BOOTSTRAP_KEY=synthetic-rehearsal-bootstrap-key-2026 \
    METRICS_TOKEN="$METRICS_TOKEN" \
    PORT="$PORT" \
    RUST_LOG=info \
    MEDICHAIN_STORAGE= DATABASE_URL= AT_API_KEY= FAYDA_API_KEY= GHANA_CARD_API_KEY= \
        "$BIN" > "$LOG" 2>&1 &
    echo $! > "$PIDFILE"

    for _ in $(seq 1 60); do
        if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
            say "API exited during startup:"; tail -20 "$LOG"; exit 1
        fi
        [ "$(probe "${BASE}/health")" = "200" ] && return 0
        sleep 1
    done
    say "API never became healthy:"; tail -20 "$LOG"; exit 1
}

say "REHEARSAL $(date -u +%Y-%m-%dT%H:%M:%SZ) — isolated memory-mode environment"
say "Binary: ${BIN}"
say "Port:   ${PORT}  (8080 is the IPFS gateway and must not be used here)"

head1 "0. START"
start_api
API_PID="$(cat "$PIDFILE")"
say "  API serving on ${BASE}, pid ${API_PID}"

# ---------------------------------------------------------------------------
head1 "1. MONITORING — access control on the metrics surface"
# Metrics describe request volumes, error rates and latency by route: useful to
# an operator and equally useful to an attacker mapping the system.
check "unauthenticated scrape is denied"        "$(probe "${BASE}/api/metrics")" "401"
check "scrape with a wrong token is denied"     "$(curl -s -o /dev/null -m 3 -w '%{http_code}' -H 'Authorization: Bearer wrong-token' "${BASE}/api/metrics")" "401"
check "scrape with the operator token succeeds" "$(curl -s -o /dev/null -m 3 -w '%{http_code}' -H "Authorization: Bearer ${METRICS_TOKEN}" "${BASE}/api/metrics")" "200"

# ---------------------------------------------------------------------------
head1 "2. MONITORING — series CONTENT reflects real traffic"
before="$(scrape)"
if [ -z "$before" ]; then
    say "  FAIL  metrics scrape returned nothing — cannot verify content"
    fail_count=$((fail_count + 1))
else
    # Assert against a CONSTANT. The first draft compared this count to itself,
    # which passes unconditionally — a green light wired to nothing, and the
    # same defect this script exists to catch in the system under test.
    check_ge "exposition carries request-counter series" \
        "$(printf '%s\n' "$before" | grep -c '^http_requests_total')" 1
    check_ge "exposition carries latency-histogram series" \
        "$(printf '%s\n' "$before" | grep -c '^http_request_duration_seconds_bucket')" 1
fi

health_before="$(counter_sum "$before" '^http_requests_total\{.*path="/health".*status="200"')"
say "  http_requests_total{path=/health,status=200} before: ${health_before}"

N=7
for _ in $(seq 1 $N); do curl -s -o /dev/null -m 3 "${BASE}/health"; done

after="$(scrape)"
health_after="$(counter_sum "$after" '^http_requests_total\{.*path="/health".*status="200"')"
say "  http_requests_total{path=/health,status=200} after ${N} requests: ${health_after}"
check "counter moved by exactly the traffic driven" "$((health_after - health_before))" "$N"

# A counter that increments but a histogram that never observes would leave the
# latency budgets in docs/PERFORMANCE_BUDGETS.md unmonitored.
hist_count="$(counter_sum "$after" '^http_request_duration_seconds_count\{.*path="/health"')"
check_ge "latency histogram observed the same requests" "$hist_count" "$N"

sum_line="$(printf '%s\n' "$after" | grep -E '^http_request_duration_seconds_sum\{.*path="/health"' | head -1)"
say "  histogram sum line: ${sum_line:-<missing>}"

# ---------------------------------------------------------------------------
head1 "3. MONITORING — security-relevant events are observable"
# An unauthorized attempt that leaves no trace in the monitoring surface cannot
# be alerted on. Denials must be counted, not silently dropped.
denied_before="$(counter_sum "$(scrape)" '^http_requests_total\{.*path="/api/metrics".*status="401"')"
for _ in 1 2 3; do curl -s -o /dev/null -m 3 "${BASE}/api/metrics"; done
denied_after="$(counter_sum "$(scrape)" '^http_requests_total\{.*path="/api/metrics".*status="401"')"
check "denied scrapes are recorded as 401s" "$((denied_after - denied_before))" "3"

# ---------------------------------------------------------------------------
head1 "4. MONITORING — label cardinality stays bounded"
# Unbounded label values are a memory-exhaustion path reachable from outside the
# trust boundary, and raw 404 paths can themselves carry identifiers.
for p in /zzz-rehearsal-aaa /zzz-rehearsal-bbb /zzz-rehearsal-ccc /zzz-rehearsal-ddd; do
    curl -s -o /dev/null -m 3 "${BASE}${p}"
done
final="$(scrape)"
leaked="$(printf '%s\n' "$final" | grep -c 'zzz-rehearsal' || true)"
check "unknown paths create no per-path series" "$leaked" "0"
unmatched="$(counter_sum "$final" '^http_requests_total\{.*path="<unmatched>"')"
check_ge "unknown paths collapse into <unmatched>" "$unmatched" "4"

# ---------------------------------------------------------------------------
head1 "5. KILL SWITCH — service actually stops"
check "serving immediately before the kill" "$(probe "${BASE}/health")" "200"

kill_start="$(date +%s)"
stop_process "$API_PID"

stopped_after=""
for i in $(seq 1 30); do
    if [ "$(probe "${BASE}/health")" = "000" ]; then stopped_after="$i"; break; fi
    sleep 1
done
kill_elapsed=$(( $(date +%s) - kill_start ))

# 000 means the connection was refused. Any HTTP status here — including 404 —
# would mean something is STILL listening on this port, which is not "stopped".
check "port refuses connections after the kill" "$(probe "${BASE}/health")" "000"
say "  time to stop serving: ${stopped_after:-never}s (elapsed ${kill_elapsed}s)"
check "process is gone from the process table" "$(kill -0 "$API_PID" 2>/dev/null && echo alive || echo gone)" "gone"

# ---------------------------------------------------------------------------
head1 "6. ROLLBACK — restart returns to a known-good state"
# In memory-mode the whole process state is ephemeral, so 'restart' IS the
# rollback: any state a test wrote cannot survive. Stronger than the compose
# variant, not weaker. (The PostgreSQL rollback path is a separate rehearsal:
# docs/BACKUP_RESTORE_RUNBOOK.md, ledger row HZ-WP8-RES-005.)
start_api
check "service restored after restart" "$(probe "${BASE}/health")" "200"
restored="$(scrape)"
restored_health="$(counter_sum "$restored" '^http_requests_total\{.*path="/health".*status="200"')"
say "  /health counter after restart: ${restored_health} (was ${health_after} before the kill)"
if [ "${restored_health:-0}" -lt "${health_after:-0}" ]; then
    say "  PASS  in-process state did not survive the restart"
    pass_count=$((pass_count + 1))
else
    say "  FAIL  counter did not reset — state survived a restart that should have discarded it"
    fail_count=$((fail_count + 1))
fi

# ---------------------------------------------------------------------------
if [ "${1:-}" != "--keep-running" ]; then
    head1 "7. TEARDOWN"
    stop_process "$(cat "$PIDFILE")"
    # ASSERT the teardown worked rather than assuming it. A leftover process
    # from a previous run is not harmless: it holds the port, so the NEXT
    # rehearsal refuses to start and the control silently stops being tested.
    # (Observed: an earlier ad-hoc run left a server behind exactly this way.)
    check "teardown left nothing serving the port" "$(probe "${BASE}/health")" "000"
fi

head1 "RESULT"
say "passed=${pass_count} failed=${fail_count}"
# Exit non-zero on any failure. A rehearsal script that always exits 0 is the
# same defect class this campaign found in synthetic-e2e-test.sh: wired into CI
# it would report success over a control that no longer works.
[ "$fail_count" -eq 0 ] || exit 1
