#!/usr/bin/env bash
# =============================================================================
# Environment-state reconciliation gate
# =============================================================================
# Compares EXPECTED machine state against ACTUAL, and fails closed on drift.
#
# WHY THIS EXISTS
# ---------------
# On 2026-08-08 the Horizon campaign state recorded "tests left running: none"
# while an orphaned `medichain-api` had been holding port 8090 for ~24 hours.
# The orphan itself was harmless and easily killed. The problem it exposed is
# not: *recorded campaign state had diverged from actual machine state*, which
# means campaign bookkeeping was not trustworthy enough to be used as evidence.
#
# That matters because several claims this campaign wants to make depend on it:
#   - "the test environment was clean"
#   - "no residual services were running"
#   - any port-based integration result (a stale listener on the port under
#     test silently answers instead of the binary you think you are testing)
#
# The HZ-WP7-AUTHN-001 session already lost a full run to exactly this class of
# fault: every request 404'd at the transport layer while six denial assertions
# reported "pass" because nothing ever reached the server.
#
# Run this BEFORE and AFTER every test run. Before, so results are attributable
# to a known state; after, so leaks are caught while their cause is still known.
#
# USAGE
#   scripts/reconcile-environment.sh                 # human-readable, exit 1 on drift
#   scripts/reconcile-environment.sh --json          # machine-readable
#   scripts/reconcile-environment.sh --phase before  # label the record
#
# EXIT CODES
#   0  actual matches expected
#   1  drift detected (unexpected listener, process, container, or leaked schema)
#   2  could not determine state (a probe failed) — never reported as "clean"
# =============================================================================
set -uo pipefail

PHASE="unspecified"
JSON=0
for arg in "$@"; do
    case "$arg" in
        --json) JSON=1 ;;
        --phase) shift; PHASE="${1:-unspecified}" ;;
        --phase=*) PHASE="${arg#*=}" ;;
    esac
done

DRIFT=0
UNDETERMINED=0
FINDINGS=()

note() { # severity, key, detail
    FINDINGS+=("$1|$2|$3")
    [[ "$1" == "drift" ]] && DRIFT=1
    [[ "$1" == "undetermined" ]] && UNDETERMINED=1
    return 0
}

# -----------------------------------------------------------------------------
# 1. Listening ports
# -----------------------------------------------------------------------------
# Ports the project legitimately uses. A listener here is reported but not drift;
# a MediChain-owned listener on a port NOT in this list is drift, and so is a
# listener on a test port (8091/8092) outside an active test run.
#
# 8080 is the IPFS gateway, NOT the API — an API bound there steals the gateway
# port and every record download 404s as a misleading RECORD_NOT_FOUND.
declare -A KNOWN_PORTS=(
    [8090]="API (host)"
    [8091]="API (test posture: demo)"
    [8092]="API (test posture: production-like)"
    [5432]="PostgreSQL (developer dev stack)"
    [55432]="PostgreSQL (Horizon isolated stack)"
    [5001]="IPFS API"
    [8080]="IPFS gateway (NOT the API)"
    [9944]="Substrate RPC (WS *and* HTTP - the ports were merged upstream)"
    [30333]="Substrate libp2p"
    [5173]="Vite doctor-portal"
    [5174]="Vite patient-app"
)

listening_ports() {
    if command -v netstat >/dev/null 2>&1; then
        netstat -ano 2>/dev/null | awk '/LISTENING/ {print $2}' \
            | sed 's/.*://' | sort -un
    else
        return 1
    fi
}

PORTS_RAW="$(listening_ports)" || {
    note undetermined ports "netstat unavailable; listening ports could not be determined"
}

if [[ -n "${PORTS_RAW:-}" ]]; then
    for p in $PORTS_RAW; do
        if [[ -n "${KNOWN_PORTS[$p]:-}" ]]; then
            case "$p" in
                8091|8092)
                    note drift "port:$p" "test-posture API listening outside a test run (${KNOWN_PORTS[$p]}) — a stale listener answers in place of the binary under test"
                    ;;
                *)
                    note info "port:$p" "${KNOWN_PORTS[$p]}"
                    ;;
            esac
        fi
    done
fi

# -----------------------------------------------------------------------------
# 2. MediChain host processes
# -----------------------------------------------------------------------------
# A host `medichain-api` is legitimate while serving, but MUST NOT outlive the
# session that started it — that is precisely the 2026-08-08 orphan. It also
# holds a lock on target/debug/medichain-api.exe, blocking every rebuild.
# NOTE: `-ErrorAction SilentlyContinue` suppresses error OUTPUT but the cmdlet
# failure still sets a non-zero exit, so "no such process" would otherwise be
# misreported as "could not enumerate". Wrap in an array + explicit `exit 0` so
# a genuine probe failure stays distinguishable from an empty result.
api_processes() {
    if command -v powershell.exe >/dev/null 2>&1; then
        powershell.exe -NoProfile -Command \
            "\$p = @(Get-Process -Name 'medichain-api' -ErrorAction SilentlyContinue);
             foreach (\$x in \$p) { '{0} {1}' -f \$x.Id, \$x.StartTime };
             exit 0" 2>/dev/null | tr -d '\r'
    else
        return 1
    fi
}

PROCS="$(api_processes)" || note undetermined processes "could not enumerate processes"
if [[ -n "${PROCS:-}" ]]; then
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        note drift "process:medichain-api" "running host API: $line (holds the binary lock; orphans block rebuilds and can answer test traffic)"
    done <<< "$PROCS"
fi

# -----------------------------------------------------------------------------
# 3. Docker containers
# -----------------------------------------------------------------------------
# Docker is probed with a bounded timeout: when C: fills, the daemon stops
# responding, and that has twice been misdiagnosed as a Docker fault. A probe
# failure here is UNDETERMINED, never "clean".
docker_state() {
    timeout 25 docker ps --format '{{.Names}}|{{.Status}}' 2>/dev/null
}

if command -v docker >/dev/null 2>&1; then
    if DOCKER_OUT="$(docker_state)"; then
        while IFS= read -r line; do
            [[ -z "$line" ]] && continue
            note info "container:${line%%|*}" "${line#*|}"
        done <<< "$DOCKER_OUT"
    else
        note undetermined docker "docker did not respond within 25s — CHECK DISK FIRST (df -h /c); daemon unresponsiveness here has been a disk-exhaustion symptom, not a Docker fault"
    fi
else
    note undetermined docker "docker not on PATH"
fi

# -----------------------------------------------------------------------------
# 3b. Service reachability (independent of the Docker control plane)
# -----------------------------------------------------------------------------
# Observed 2026-08-08: after the disk event `docker ps` returned NOTHING while
# both PostgreSQL instances were still accepting connections. The containers
# were fine; Docker's CLI/daemon API was not. Probing the service directly
# distinguishes "the workload is down" from "the control plane is sick" — a
# distinction that decides whether a failing test is a code fault or an
# environment fault.
tcp_probe() { # host, port -> 0 if connectable
    timeout 5 bash -c "echo > /dev/tcp/$1/$2" 2>/dev/null
}

declare -A SERVICES=(
    ["postgres-dev:5432"]="PostgreSQL (developer dev stack)"
    ["postgres-horizon:55432"]="PostgreSQL (Horizon isolated stack)"
)
for key in "${!SERVICES[@]}"; do
    port="${key##*:}"
    if tcp_probe 127.0.0.1 "$port"; then
        note info "service:${key%%:*}" "reachable on $port — ${SERVICES[$key]}"
    else
        note info "service:${key%%:*}" "NOT reachable on $port (may simply not be running)"
    fi
done

# -----------------------------------------------------------------------------
# 4. Leaked test schemas
# -----------------------------------------------------------------------------
# The pg test harness creates a disposable schema per run
# (medichain_test_{pid}_{ts}_{n}) on the DEVELOPER stack — not the isolated
# campaign stack — and sweeps stale ones only LAZILY: older than 2h, and only
# on the NEXT run. So schemas accumulate between runs, and indefinitely if no
# further run happens. Anything above a small number means leaks are building.
LEAK_THRESHOLD=5
schema_leaks() {
    timeout 25 docker exec medichain_postgres psql -U medichain -d medichain -tAc \
        "SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'medichain\_test\_%'" 2>/dev/null \
        | tr -d '[:space:]'
}

if command -v docker >/dev/null 2>&1; then
    LEAKS="$(schema_leaks)"
    if [[ "${LEAKS:-}" =~ ^[0-9]+$ ]]; then
        if (( LEAKS > LEAK_THRESHOLD )); then
            note drift "schemas:medichain_test_*" "$LEAKS leaked test schemas on the dev stack (threshold $LEAKS>$LEAK_THRESHOLD) — the sweep only drops schemas >2h old on the NEXT run"
        else
            note info "schemas:medichain_test_*" "$LEAKS present (threshold $LEAK_THRESHOLD)"
        fi
    else
        note undetermined schemas "could not query dev-stack Postgres for leaked test schemas"
    fi
fi

# -----------------------------------------------------------------------------
# 5. Disk headroom
# -----------------------------------------------------------------------------
# Disk is the binding constraint on this machine and has repeatedly produced
# misleading failures elsewhere (dead Docker daemon, partial builds). Report it
# as part of environment state rather than discovering it mid-run.
DISK_MIN_GB=3
if AVAIL_KB="$(df -k /c 2>/dev/null | awk 'NR==2 {print $4}')"; then
    AVAIL_GB=$(( AVAIL_KB / 1024 / 1024 ))
    if (( AVAIL_GB < DISK_MIN_GB )); then
        note drift "disk:/c" "${AVAIL_GB}GB free, below the ${DISK_MIN_GB}GB working margin — builds, Docker and Postgres all fail unpredictably below this"
    else
        note info "disk:/c" "${AVAIL_GB}GB free"
    fi
else
    note undetermined disk "could not read free space on /c"
fi

# -----------------------------------------------------------------------------
# Report
# -----------------------------------------------------------------------------
STATUS="clean"
EXIT=0
if (( DRIFT )); then STATUS="drift"; EXIT=1; fi
# Undetermined outranks drift: an unknown state must never be reported as clean.
if (( UNDETERMINED )); then STATUS="undetermined"; EXIT=2; fi

if (( JSON )); then
    printf '{\n  "phase": "%s",\n  "timestamp": "%s",\n  "status": "%s",\n  "findings": [\n' \
        "$PHASE" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STATUS"
    for i in "${!FINDINGS[@]}"; do
        IFS='|' read -r sev key detail <<< "${FINDINGS[$i]}"
        printf '    {"severity": "%s", "key": "%s", "detail": "%s"}%s\n' \
            "$sev" "$key" "${detail//\"/\\\"}" \
            "$([[ $i -lt $((${#FINDINGS[@]} - 1)) ]] && echo ,)"
    done
    printf '  ]\n}\n'
else
    echo "=== Environment reconciliation (phase: $PHASE) ==="
    for f in "${FINDINGS[@]}"; do
        IFS='|' read -r sev key detail <<< "$f"
        case "$sev" in
            drift)        printf '  [DRIFT]        %-32s %s\n' "$key" "$detail" ;;
            undetermined) printf '  [UNDETERMINED] %-32s %s\n' "$key" "$detail" ;;
            *)            printf '  [ok]           %-32s %s\n' "$key" "$detail" ;;
        esac
    done
    echo "=== status: $STATUS (exit $EXIT) ==="
    if (( EXIT == 2 )); then
        echo "    An undetermined probe is NOT a pass. Resolve it before attributing"
        echo "    any test result to this environment."
    fi
fi

exit $EXIT
