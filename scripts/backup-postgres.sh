#!/usr/bin/env bash
# Backup the MediChain PostgreSQL database (Horizon HZ-WP8-RES-005).
#
# Produces a custom-format pg_dump (restorable with pg_restore, supports
# selective/parallel restore) plus a SHA-256 checksum file, so a restore can
# verify the backup wasn't corrupted or truncated before trusting it.
#
# Usage: ./scripts/backup-postgres.sh [output-dir]
# Defaults to ./backups (gitignored) relative to the repo root.

set -euo pipefail

CONTAINER="${MEDICHAIN_PG_CONTAINER:-medichain_postgres}"
DB_USER="${POSTGRES_USER:-medichain}"
DB_NAME="${POSTGRES_DB:-medichain}"
OUT_DIR="${1:-backups}"

mkdir -p "$OUT_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="$OUT_DIR/medichain-${TIMESTAMP}.dump"
CHECKSUM_FILE="${DUMP_FILE}.sha256"

echo "Backing up '$DB_NAME' from container '$CONTAINER' -> $DUMP_FILE"

docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$DUMP_FILE"

# Record the row count of every table alongside the dump, so a restore can
# compare "same table, same row count" rather than just "the file didn't
# fail" — a truncated or partially-applied restore can still exit 0.
MANIFEST_FILE="${DUMP_FILE}.manifest.txt"
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "
  SELECT schemaname || '.' || relname || ' ' || n_live_tup
  FROM pg_stat_user_tables
  ORDER BY schemaname, relname;
" > "$MANIFEST_FILE"

sha256sum "$DUMP_FILE" > "$CHECKSUM_FILE"

echo "Backup complete:"
echo "  Dump:      $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"
echo "  Checksum:  $CHECKSUM_FILE"
echo "  Manifest:  $MANIFEST_FILE ($(wc -l < "$MANIFEST_FILE") tables)"
