#!/bin/sh
# Scripted restore test (WP11): restore the latest backup into a throwaway
# copy and prove it holds the canary written before that backup. Run it after
# every nightly backup (or weekly at least) and keep its output as evidence.
#
#   scripts/backup/pgbackrest-restore-test.sh [repo]      # default repo 1
#
# In the compose deployment it runs the check inside a one-off container of
# the backup image, sharing the repository volume; nothing touches the live
# database. PGBR_RUN="" runs the inner script directly (host with pgBackRest).
set -eu

repo="${1:-1}"
canary_file="${PGBR_CANARY_FILE:-backups/last-canary}"
canary="$(cat "$canary_file" 2>/dev/null || true)"
if [ -z "$canary" ]; then
  echo "No canary recorded at $canary_file: run the nightly backup first." >&2
  exit 2
fi
run_prefix="${PGBR_RUN-docker compose -f docker-compose.yml -f docker-compose.backup.yml run --rm --no-deps --user postgres --entrypoint medichain-restore-test postgres}"
inner="${PGBR_INNER:-}"
# shellcheck disable=SC2086 # the prefix is a command line on purpose
$run_prefix $inner "$canary" "$repo"
