#!/usr/bin/env bash
# The row-count query shared by backup-postgres.sh and restore-postgres.sh.
#
# WHY THIS IS ONE SHARED FUNCTION AND NOT TWO SIMILAR QUERIES (Horizon HZ-027):
# the backup writes a manifest, the restore compares against it, and the whole
# value of that comparison is that both sides describe the database the same
# way. When the two queries lived separately they drifted: the restore ran
# ANALYZE first and the backup did not, so the same database produced different
# numbers depending on which script looked at it. Two copies of a query that
# MUST agree is a defect waiting to happen; there is now one copy.
#
# WHY count(*) AND NOT pg_stat_user_tables.n_live_tup:
# n_live_tup is a planner estimate maintained by autovacuum. On a database whose
# statistics have not been gathered it reads 0 for every table — including
# tables full of rows. That made the manifest a list of zeros, and a restore
# that recovered NO DATA AT ALL then compared equal to it and was reported as
# "PASS: restored row counts match the backup-time manifest exactly". The check
# whose entire job is catching a partial restore certified total data loss.
# Running ANALYZE first is not a fix either: ANALYZE samples, so the value stays
# an approximation that is merely usually right, and a check that must detect a
# small discrepancy cannot be built on a number allowed to be approximately
# correct.
#
# COST: this is an exact count, so it scans every table — O(rows), not a stats
# lookup. That is the deliberate trade: the backup path already reads the whole
# database to dump it, and a verification you can trust is worth a scan. Measure
# it before pointing this at a production-scale database.

# Emit the SQL that lists "<schema>.<table> <exact row count>" for every ordinary
# table, one per line, ordered so two runs are directly diffable.
#
# $1 — POSIX regex of schema names to exclude (the ephemeral test schemas; see
#      the callers for why they must be excluded from both sides identically).
row_count_query() {
    local exclude_regex="$1"
    # query_to_xml runs a scalar subquery per table from within a single
    # statement, so this stays one round trip instead of one psql invocation per
    # table. format(%I) quotes identifiers, so a table named e.g. "order" or one
    # containing a quote cannot break out of the generated SQL.
    cat <<SQL
  SELECT ns.nspname || '.' || c.relname || ' ' ||
         ((xpath('/row/c/text()',
                 query_to_xml(format('SELECT count(*) AS c FROM %I.%I', ns.nspname, c.relname),
                              false, true, '')))[1]::text)::bigint
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
    AND ns.nspname !~ '^pg_'
    AND ns.nspname !~ '${exclude_regex}'
  ORDER BY ns.nspname, c.relname;
SQL
}
