#!/bin/sh
# Nightly backup (WP11): full on Sundays (or when none exists), differential
# on other nights, to every configured pgBackRest repository. WAL is archived
# continuously by PostgreSQL itself (archive_command), so a restore can reach
# any point between backups.
#
# Run from cron on the host, e.g.:
#   45 1 * * *  cd /srv/medichain && scripts/backup/pgbackrest-nightly.sh >> /var/log/medichain-backup.log 2>&1
#
# Before the backup it writes a canary row (backup_canaries) and prints its id
# on the last line; the restore test requires that row in the restored copy.
#
# Environment:
#   PGBR_EXEC     how to reach the database container. Default: the compose
#                 stack with docker-compose.backup.yml. Empty = run locally.
#   PGBR_REPOS    repositories to back up to, space-separated. Default "1";
#                 "1 2" once the off-site (Azure) repository is configured.
#   PGUSER, PGDATABASE (default medichain) for the canary.
#   PGBR_CANARY_FILE where to record the canary id (default backups/last-canary).
set -eu

exec_prefix="${PGBR_EXEC-docker compose -f docker-compose.yml -f docker-compose.backup.yml exec -T postgres}"
stanza="${PGBACKREST_STANZA:-medichain}"
repos="${PGBR_REPOS:-1}"
user="${PGUSER:-medichain}"
database="${PGDATABASE:-medichain}"
canary_file="${PGBR_CANARY_FILE:-backups/last-canary}"

run() {
  # shellcheck disable=SC2086 # the prefix is a command line on purpose
  $exec_prefix "$@"
}

run pgbackrest --stanza="$stanza" --log-level-console=warn stanza-create

canary="canary-$(date -u +%Y%m%dT%H%M%SZ)-$$"
run psql -U "$user" -d "$database" -v ON_ERROR_STOP=1 -q \
  -c "INSERT INTO backup_canaries (id) VALUES ('$canary')"

# `check` proves WAL archiving works end to end before trusting a backup.
run pgbackrest --stanza="$stanza" --log-level-console=warn check

for repo in $repos; do
  type=diff
  if [ "$(date -u +%u)" = "7" ] \
     || ! run pgbackrest --stanza="$stanza" --repo="$repo" --output=json info \
          | grep -q '"type":"full"'; then
    type=full
  fi
  echo "repo $repo: $type backup"
  run pgbackrest --stanza="$stanza" --repo="$repo" --type="$type" --log-level-console=warn backup
done

run pgbackrest --stanza="$stanza" info
mkdir -p "$(dirname "$canary_file")"
printf '%s\n' "$canary" > "$canary_file"
echo "$canary"
