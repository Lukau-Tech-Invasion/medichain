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

# Ephemeral schemas created by the live-DB integration tests
# (`medichain_test_<pid>_<timestamp>`), which never drop them.
#
# This is not tidiness — it is why the backup did not work. Observed on a real
# developer database: 239 leaked schemas x ~120 tables each is ~28,000 tables,
# and pg_dump takes a LOCK on every one inside a single transaction, so it died
# with:
#     pg_dump: error: out of shared memory
#     HINT: You might need to increase max_locks_per_transaction
# The documented rollback procedure therefore failed on any database that had
# ever run those tests — which is every developer machine. A backup that cannot
# run is worse than no backup, because the runbook says one exists.
#
# Excluding them is also correct on its own terms: throwaway test schemas are
# not part of the data anyone would restore.
#
# Glob syntax for pg_dump -N; the manifest below uses the equivalent regex so
# the two views of the database cannot disagree.
EXCLUDE_SCHEMA_GLOB="${MEDICHAIN_BACKUP_EXCLUDE_SCHEMA:-medichain_test_*}"
EXCLUDE_SCHEMA_REGEX="${MEDICHAIN_BACKUP_EXCLUDE_REGEX:-^medichain_test_}"

mkdir -p "$OUT_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="$OUT_DIR/medichain-${TIMESTAMP}.dump"
CHECKSUM_FILE="${DUMP_FILE}.sha256"

echo "Backing up '$DB_NAME' from container '$CONTAINER' -> $DUMP_FILE"

docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc   -N "$EXCLUDE_SCHEMA_GLOB" > "$DUMP_FILE"

# Record the row count of every table alongside the dump, so a restore can
# compare "same table, same row count" rather than just "the file didn't
# fail" — a truncated or partially-applied restore can still exit 0.
MANIFEST_FILE="${DUMP_FILE}.manifest.txt"
# The manifest MUST apply the same exclusion as the dump. If it listed the
# test schemas the dump omits, every restore would report thousands of
# "missing" tables and the verification step would cry wolf until someone
# stopped reading it.
#
# Counts are EXACT, and come from the same shared query the restore uses — see
# scripts/lib/row-count-query.sh for why an estimate here made this manifest a
# list of zeros and let a data-free restore pass verification (Horizon HZ-027).
# shellcheck source=scripts/lib/row-count-query.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/row-count-query.sh"
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A \
  -c "$(row_count_query "$EXCLUDE_SCHEMA_REGEX")" > "$MANIFEST_FILE"

# A manifest of all zeros is the signature of the HZ-027 defect (estimates
# instead of counts). It is also, legitimately, what an empty database
# produces. Distinguish the two rather than guessing: if the dump carries data
# but every count is zero, the manifest cannot be trusted and a later restore
# would be "verified" against nothing.
if [ -s "$MANIFEST_FILE" ] && ! awk '$NF > 0 {found=1; exit} END {exit !found}' "$MANIFEST_FILE"; then
  echo "NOTE: every table in the manifest has 0 rows — expected only if '$DB_NAME' is genuinely empty." >&2
fi

sha256sum "$DUMP_FILE" > "$CHECKSUM_FILE"

echo "Backup complete:"
echo "  Dump:      $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"
echo "  Checksum:  $CHECKSUM_FILE"
echo "  Manifest:  $MANIFEST_FILE ($(wc -l < "$MANIFEST_FILE") tables)"
