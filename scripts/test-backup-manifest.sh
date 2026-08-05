#!/usr/bin/env bash
# Regression test for Horizon HZ-027 — the backup manifest must record EXACT row
# counts, and the restore verification must REJECT a restore that recovered no
# data.
#
# The case that matters is the third one. Before the fix, a manifest built from
# planner estimates read zero for every table on a database whose statistics had
# not been gathered, and a restore that recovered the schema and no rows at all
# compared equal to it — reported as "PASS: restored row counts match the
# backup-time manifest exactly, table for table." A test that only checks the
# happy path would have passed against the broken code too, which is why the
# data-free restore is asserted explicitly here.
#
# Runs against the ISOLATED synthetic stack only. Never point this at a database
# holding real data: it creates and drops throwaway databases.
#
# Usage: bash scripts/test-backup-manifest.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CONTAINER="${MEDICHAIN_PG_CONTAINER:-medichain_horizon_postgres}"
DB_USER="${POSTGRES_USER:-medichain_horizon}"
DB_NAME="${POSTGRES_DB:-medichain_horizon}"
WORK_DIR="$(mktemp -d)"
EMPTY_DB="medichain_hz027_emptyrestore"
FULL_DB="medichain_hz027_fullrestore"

pass=0
fail=0
ok()   { printf '  PASS  %s\n' "$*"; pass=$((pass + 1)); }
bad()  { printf '  FAIL  %s\n' "$*"; fail=$((fail + 1)); }

psql_q() { docker exec "$CONTAINER" psql -U "$DB_USER" -d "$1" -t -A -c "$2" 2>/dev/null | tr -d '\r'; }

cleanup() {
    for db in "$EMPTY_DB" "$FULL_DB"; do
        docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres \
            -c "DROP DATABASE IF EXISTS ${db};" > /dev/null 2>&1
    done
    rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "HZ-027 regression — container=${CONTAINER} db=${DB_NAME}"

if ! docker exec "$CONTAINER" true > /dev/null 2>&1; then
    echo "SKIP: container '${CONTAINER}' is not running (Docker down or stack not up)."
    echo "This test needs the isolated stack:"
    echo "  docker compose -p medichain_horizon -f docker-compose.yml -f docker-compose.horizon-isolated.yml up -d postgres"
    exit 2
fi

# ---------------------------------------------------------------------------
echo
echo "1. Manifest counts equal direct count(*)"
MEDICHAIN_PG_CONTAINER="$CONTAINER" POSTGRES_USER="$DB_USER" POSTGRES_DB="$DB_NAME" \
    bash scripts/backup-postgres.sh "$WORK_DIR" > "$WORK_DIR/backup.log" 2>&1 \
    || { echo "backup failed:"; cat "$WORK_DIR/backup.log"; exit 1; }

DUMP="$(ls -t "$WORK_DIR"/*.dump | head -1)"
MANIFEST="${DUMP}.manifest.txt"

# Deliberately compare against a count obtained a completely different way, so
# a bug in the shared query cannot hide by being wrong on both sides.
mismatches=0
checked=0
while read -r qualified count; do
    schema="${qualified%%.*}"
    table="${qualified#*.}"
    [ "$schema" = "public" ] || continue
    actual="$(psql_q "$DB_NAME" "SELECT count(*) FROM \"${schema}\".\"${table}\";")"
    checked=$((checked + 1))
    if [ "$count" != "$actual" ]; then
        mismatches=$((mismatches + 1))
        [ "$mismatches" -le 5 ] && echo "        ${qualified}: manifest=${count} actual=${actual}"
    fi
done < "$MANIFEST"

[ "$checked" -gt 0 ] && ok "compared ${checked} tables against direct count(*)" \
                     || bad "manifest was empty — nothing compared"
[ "$mismatches" -eq 0 ] && ok "every manifest count matches count(*)" \
                        || bad "${mismatches} table(s) disagree with count(*)"

# The original defect's signature: a populated database yielding an all-zero
# manifest. Only meaningful if the database actually has rows.
total_rows="$(awk '{s += $NF} END {print s+0}' "$MANIFEST")"
live_rows="$(psql_q "$DB_NAME" "SELECT count(*) FROM patients;")"
if [ "${live_rows:-0}" -gt 0 ]; then
    [ "${total_rows:-0}" -gt 0 ] && ok "populated database yields a non-zero manifest (${total_rows} rows)" \
                                 || bad "populated database yielded an all-zero manifest — HZ-027 has regressed"
else
    echo "  SKIP  database has no patient rows; all-zero-manifest check not meaningful"
fi

# ---------------------------------------------------------------------------
echo
echo "2. A correct restore verifies as PASS"
if MEDICHAIN_PG_CONTAINER="$CONTAINER" POSTGRES_USER="$DB_USER" \
        bash scripts/restore-postgres.sh "$DUMP" "$FULL_DB" > "$WORK_DIR/restore-full.log" 2>&1; then
    ok "full restore verified successfully"
else
    bad "full restore was rejected (see $WORK_DIR/restore-full.log)"
    tail -15 "$WORK_DIR/restore-full.log"
fi
restored_patients="$(psql_q "$FULL_DB" "SELECT count(*) FROM patients;")"
[ "${restored_patients:-0}" = "${live_rows:-0}" ] \
    && ok "restored patient rows match the source (${restored_patients})" \
    || bad "restored ${restored_patients} patient rows, source had ${live_rows}"

# ---------------------------------------------------------------------------
echo
echo "3. A restore that recovered NO DATA is rejected  <-- the HZ-027 case"
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS ${EMPTY_DB};" > /dev/null 2>&1
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE ${EMPTY_DB};" > /dev/null 2>&1
# Schema only: structurally complete, zero rows — a catastrophic restore that
# nonetheless exits 0, which is exactly what the manifest exists to catch.
cat "$DUMP" | docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$EMPTY_DB" \
    --no-owner --no-privileges --schema-only > /dev/null 2>&1

empty_patients="$(psql_q "$EMPTY_DB" "SELECT count(*) FROM patients;")"
if [ "${empty_patients:-x}" != "0" ]; then
    bad "setup error: the data-free target reports ${empty_patients} patients, expected 0"
else
    # Apply the shipped verification query to the data-free database and compare
    # it against the manifest exactly as restore-postgres.sh does.
    . "$REPO_ROOT/scripts/lib/row-count-query.sh"
    ACTUAL="$WORK_DIR/empty-actual.txt"
    docker exec "$CONTAINER" psql -U "$DB_USER" -d "$EMPTY_DB" -t -A \
        -c "$(row_count_query "^medichain_test_")" > "$ACTUAL" 2>/dev/null

    if diff -q "$MANIFEST" "$ACTUAL" > /dev/null; then
        bad "a restore containing NO DATA was accepted as matching the manifest — HZ-027 has regressed"
    else
        ok "a restore containing no data is correctly rejected"
    fi
fi

# ---------------------------------------------------------------------------
echo
echo "passed=${pass} failed=${fail}"
[ "$fail" -eq 0 ] || exit 1
