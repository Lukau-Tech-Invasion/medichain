#!/bin/sh
# Scripted restore test (WP11), run as the postgres user where pgBackRest and
# the repository are reachable: inside the backup image
# (scripts/backup/pgbackrest-restore-test.sh starts it), or directly on a host
# with pgBackRest installed.
#
#   medichain-restore-test <expected canary id> [repo number]
#
# 1. `pgbackrest verify`: every file in the repository matches its checksum.
# 2. Restores the latest backup into a scratch directory, to the end of that
#    backup, with archiving OFF so the copy can never push WAL into the repo.
# 3. Starts it on a spare port and requires the canary the nightly backup
#    wrote just before it ran. An empty, stale or live database fails here.
# 4. Requires the migration history to be present, then stops and removes it.
#
# Environment: PGBACKREST_* (the same as the backup), RESTORE_TEST_PORT
# (default 55432), PGUSER/PGDATABASE for the restored cluster.
set -eu

canary="${1:?usage: medichain-restore-test <canary id> [repo]}"
repo="${2:-1}"
# The canary goes into a query: accept only the shape the nightly job mints.
if ! printf '%s' "$canary" | grep -Eq '^canary-[0-9A-Za-z-]{8,64}$'; then
  echo "FAIL: '$canary' is not a canary id" >&2
  exit 2
fi
stanza="${PGBACKREST_STANZA:?set PGBACKREST_STANZA}"
port="${RESTORE_TEST_PORT:-55432}"
user="${PGUSER:-medichain}"
database="${PGDATABASE:-medichain}"
bin="$(dirname "$(command -v pg_ctl 2>/dev/null || echo /usr/lib/postgresql/16/bin/pg_ctl)")"
scratch="$(mktemp -d /tmp/medichain-restore-XXXXXX)"
log="$scratch.log"

cleanup() {
  "$bin/pg_ctl" -D "$scratch" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$scratch" "$log"
}
trap cleanup EXIT

echo "1/4 verifying repository $repo"
pgbackrest --stanza="$stanza" --repo="$repo" verify

echo "2/4 restoring the latest backup into $scratch"
pgbackrest --stanza="$stanza" --repo="$repo" --pg1-path="$scratch" \
  --type=immediate --target-action=promote --archive-mode=off restore

echo "3/4 starting the restored copy on port $port"
"$bin/pg_ctl" -D "$scratch" -o "-p $port -k /tmp -c listen_addresses=''" -l "$log" -w start

query() {
  psql -h /tmp -p "$port" -U "$user" -d "$database" -v ON_ERROR_STOP=1 -At -c "$1"
}
found="$(query "SELECT count(*) FROM backup_canaries WHERE id = '$canary'")"
if [ "$found" != "1" ]; then
  echo "FAIL: canary $canary is not in the restored copy" >&2
  exit 1
fi

echo "4/4 checking the schema came back"
migrations="$(query "SELECT count(*) FROM _sqlx_migrations WHERE success")"
if [ "$migrations" -lt 1 ]; then
  echo "FAIL: the restored copy has no migration history" >&2
  exit 1
fi
echo "PASS: restored copy holds canary $canary and $migrations migrations"
