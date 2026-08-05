# The row-count query shared by backup-postgres.ps1 and restore-postgres.ps1.
#
# This is the PowerShell twin of scripts/lib/row-count-query.sh and MUST produce
# byte-identical output, because a manifest written by either script has to be
# verifiable by either script. Change one, change both.
#
# WHY count(*) AND NOT pg_stat_user_tables.n_live_tup (Horizon HZ-027):
# n_live_tup is a planner estimate maintained by autovacuum. On a database whose
# statistics have not been gathered it reads 0 for every table — including
# tables full of rows — so the manifest became a list of zeros, and a restore
# that recovered NO DATA AT ALL compared equal to it and was reported as
# "PASS: restored row counts match the backup-time manifest exactly". The check
# whose whole purpose is catching a partial restore certified total data loss.
# ANALYZE-then-read is not a fix: ANALYZE samples, so the value stays an
# approximation that is merely usually right.

function Get-RowCountQuery {
    param(
        # POSIX regex of schema names to exclude — the ephemeral
        # medichain_test_<pid>_<ts> schemas the live-DB integration tests leak.
        # The dump excludes them, so the manifest must exclude them too, or every
        # restore reports thousands of missing tables and the check gets ignored.
        [string]$ExcludeRegex = '^medichain_test_'
    )

    # query_to_xml runs a scalar count per table from inside one statement, so
    # this stays a single round trip rather than one psql call per table.
    # format(%I) quotes identifiers, so an awkwardly-named table cannot break
    # out of the generated SQL.
    return @"
  SELECT ns.nspname || '.' || c.relname || ' ' ||
         ((xpath('/row/c/text()',
                 query_to_xml(format('SELECT count(*) AS c FROM %I.%I', ns.nspname, c.relname),
                              false, true, '')))[1]::text)::bigint
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
    AND ns.nspname !~ '^pg_'
    AND ns.nspname !~ '$ExcludeRegex'
  ORDER BY ns.nspname, c.relname;
"@
}
