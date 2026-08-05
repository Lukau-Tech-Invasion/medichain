#!/usr/bin/env bash
# Smoke-test the Docker demo entry point.
#
# The stack used to serve a bare nginx 404 at `/` — the API and infrastructure
# ran, but nothing served a UI, so a demo could only be started by hand with two
# Vite dev servers. This asserts the things a person actually does in the first
# thirty seconds of a demo, so that regression cannot happen silently again.
#
#   docker compose up -d --build
#   bash scripts/demo-smoke-test.sh
#
# Not `set -e`: a failing assertion is a result to record, not a reason to stop.

BASE=${BASE:-http://127.0.0.1}
PASS=0; FAIL=0

check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then
    PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %-52s %s\n' "$1" "$3"
  else
    FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %-52s want %s got %s\n' "$1" "$2" "$3"
  fi
}
code() { curl -s -o /dev/null -m 15 -w '%{http_code}' -L "$BASE$1"; }
has()  { curl -s -m 15 "$BASE$1" | grep -qF "$2" && echo yes || echo no; }

printf '\n\033[1m== Demo entry point ==\033[0m\n'
check "landing page is served at /"            200 "$(code /)"
check "landing page names the clinician portal" yes "$(has / 'Clinician portal')"
check "landing page names the patient app"      yes "$(has / 'Patient app')"
check "landing page carries a synthetic-data banner" yes "$(has / 'synthetic data only')"
check "landing page discloses the chain is off" yes "$(has / 'blockchain layer is not connected')"

printf '\n\033[1m== Portals ==\033[0m\n'
check "clinician portal loads"                 200 "$(code /doctor/)"
check "patient app loads"                      200 "$(code /patient/)"
check "/doctor redirects to /doctor/"          200 "$(code /doctor)"
check "/patient redirects to /patient/"        200 "$(code /patient)"

# SPA deep links are client-side routes, not files. Without an nginx fallback a
# refresh or a pasted link 404s — the single most common way a demo breaks.
check "clinician deep link survives a refresh" 200 "$(code /doctor/patients/PAT-1)"
check "patient deep link survives a refresh"   200 "$(code /patient/records)"

# Assets must resolve under the sub-path: if Vite's `base` and the nginx
# location disagree the page loads blank, which is worse than a clean failure.
DOC_ASSET=$(curl -s -m 15 "$BASE/doctor/" | grep -oE 'src="/doctor/assets/[^"]+"' | head -1 | sed 's/src="//;s/"//')
check "clinician bundle is reachable"          200 "$(code "${DOC_ASSET:-/doctor/assets/missing.js}")"
PAT_ASSET=$(curl -s -m 15 "$BASE/patient/" | grep -oE 'src="/patient/assets/[^"]+"' | head -1 | sed 's/src="//;s/"//')
check "patient bundle is reachable"            200 "$(code "${PAT_ASSET:-/patient/assets/missing.js}")"

printf '\n\033[1m== API through the proxy ==\033[0m\n'
check "proxied API health"                     200 "$(code /health)"
# Same origin as the portals, so apiUrl() -> window.location.origin works.
check "API refuses an unauthenticated read"    401 "$(code /api/patients)"
# Asserts REFUSED, not a specific code. A forged `0xPROV`-prefixed id used to
# return 200 with real PHI (HZ-024); it now fails the provider check and returns
# 403, while an unknown id on other routes returns 401. Both are correct
# refusals, and pinning one code would fail the suite for a handler that refuses
# in the other legitimate way.
FORGED=$(curl -s -o /dev/null -m 15 -w '%{http_code}' -H 'X-User-Id: 0xPROVforged' "$BASE/api/sync/download/PAT-1")
check "API refuses a forged identity (got $FORGED)" refused \
  "$([ "$FORGED" = "401" ] || [ "$FORGED" = "403" ] && echo refused || echo "ALLOWED:$FORGED")"

printf '\n\033[1m== Failure behaviour ==\033[0m\n'
# nginx liveness must not depend on the API: a backend outage should degrade
# /api only, not take the portals down with it.
check "nginx liveness is independent of the API" 200 "$(code /healthz)"
check "unknown top-level path 404s honestly"     404 "$(code /nope)"

printf '\n\033[1m== RESULTS ==\033[0m\n  passed=%d failed=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -gt 0 ] && exit 1
exit 0
