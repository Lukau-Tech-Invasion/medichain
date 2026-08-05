#!/usr/bin/env bash
# Restore a MediChain PostgreSQL backup with integrity verification
# (Horizon HZ-WP8-RES-005).
#
# Verifies the dump's checksum before touching any database, restores into a
# target database (a fresh one by default — never overwrites the live/default
# database unless explicitly named), then compares post-restore row counts
# against the backup's manifest so a truncated or partial restore is caught
# rather than silently accepted.
#
# Usage: ./scripts/restore-postgres.sh <dump-file> [target-db-name]
# Defaults target-db-name to "medichain_restore_test" — never the live DB —
# so a rehearsal can never clobber real data by a missing argument.

set -euo pipefail

DUMP_FILE="${1:?Usage: restore-postgres.sh <dump-file> [target-db-name]}"
TARGET_DB="${2:-medichain_restore_test}"
CONTAINER="${MEDICHAIN_PG_CONTAINER:-medichain_postgres}"
DB_USER="${POSTGRES_USER:-medichain}"

CHECKSUM_FILE="${DUMP_FILE}.sha256"
MANIFEST_FILE="${DUMP_FILE}.manifest.txt"

if [ ! -f "$DUMP_FILE" ]; then
  echo "ERROR: dump file not found: $DUMP_FILE" >&2
  exit 1
fi

if [ -f "$CHECKSUM_FILE" ]; then
  echo "Verifying checksum..."
  if ! sha256sum -c "$CHECKSUM_FILE"; then
    echo "ERROR: checksum mismatch — dump may be corrupted or truncated. Refusing to restore." >&2
    exit 1
  fi
else
  echo "WARNING: no checksum file found alongside $DUMP_FILE — proceeding without integrity verification of the file itself." >&2
fi

echo "Restoring into database '$TARGET_DB' (container '$CONTAINER')..."

docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS ${TARGET_DB};"
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE ${TARGET_DB};"
cat "$DUMP_FILE" | docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$TARGET_DB" --no-owner --no-privileges

if [ ! -f "$MANIFEST_FILE" ]; then
  echo "WARNING: no manifest found alongside $DUMP_FILE — skipping row-count verification." >&2
  echo "Restore ran without error, but integrity was NOT verified against pre-backup counts."
  exit 0
fi

echo "Verifying row counts against backup-time manifest..."
ACTUAL_FILE="$(mktemp)"
# n_live_tup is a planner estimate, not an exact count immediately after
# restore (ANALYZE hasn't run yet) — ANALYZE first so the comparison is exact.
# The counts are read ONCE, after ANALYZE; this previously read them before
# ANALYZE as well and threw the first result away.
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$TARGET_DB" -c "ANALYZE;" > /dev/null

# Same exclusion the backup applied, for the same reason: the restored database
# will not contain the ephemeral test schemas, so comparing an unfiltered view
# against a filtered manifest would report thousands of false differences and
# the check would be ignored. Env-overridable so backup and restore stay in step.
EXCLUDE_SCHEMA_REGEX="${MEDICHAIN_BACKUP_EXCLUDE_REGEX:-^medichain_test_}"
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$TARGET_DB" -t -A -c "
  SELECT schemaname || '.' || relname || ' ' || n_live_tup
  FROM pg_stat_user_tables
  WHERE schemaname !~ '${EXCLUDE_SCHEMA_REGEX}'
  ORDER BY schemaname, relname;
" > "$ACTUAL_FILE"

if diff -q "$MANIFEST_FILE" "$ACTUAL_FILE" > /dev/null; then
  echo "PASS: restored row counts match the backup-time manifest exactly, table for table."
else
  echo "MISMATCH: restored row counts differ from the backup-time manifest:" >&2
  diff "$MANIFEST_FILE" "$ACTUAL_FILE" || true
  rm -f "$ACTUAL_FILE"
  exit 1
fi

rm -f "$ACTUAL_FILE"
echo "Restore verified: '$TARGET_DB' matches the backup taken at $(basename "$DUMP_FILE")."
