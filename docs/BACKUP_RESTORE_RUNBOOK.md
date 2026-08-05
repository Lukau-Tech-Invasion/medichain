# Backup & Restore Runbook (Horizon HZ-WP8-RES-005)

> **Status: artifacts created, not yet live-rehearsed.** Docker Desktop's
> engine was unresponsive in the environment this was authored in (`docker
> version` timed out after 15s with no output, confirmed across both Bash and
> PowerShell invocations, with Docker Desktop's own processes visibly running
> but not answering any CLI command). The scripts below are written and
> reviewed but the actual rehearsal — run backup, corrupt/discard the
> original, restore, verify row counts — has **not** been executed. Do not
> treat this runbook as "restore verified" until that rehearsal has actually
> run once and its output is attached here or in
> `.horizon/evidence-private/HZ-WP8-RES-005/`.

## What this covers

A `pg_dump`/`pg_restore` based backup and restore procedure for the
PostgreSQL database backing MediChain (`postgres` service in
`docker-compose.yml`), with integrity verification so a restore is only
trusted when it demonstrably matches what was backed up — not just "the
command exited zero."

## Scripts

- `scripts/backup-postgres.sh` / `scripts/backup-postgres.ps1`
- `scripts/restore-postgres.sh` / `scripts/restore-postgres.ps1`

Both pairs do the same thing; use whichever matches your shell. A manifest
written by either can be verified by either — checked directly, not assumed:
run against the same database, the two produce byte-identical manifests.

> The `.ps1` pair could not run at all under PowerShell 7 until 2026-08-05
> (`-Encoding Byte` was removed in PowerShell 6), so the Windows half of this
> runbook had never been executed. Horizon HZ-028.

## Backup

```bash
./scripts/backup-postgres.sh [output-dir]   # defaults to ./backups (gitignored)
```

Produces three files per backup, all timestamped together:

1. `medichain-<timestamp>.dump` — custom-format `pg_dump` output (`-Fc`),
   restorable with `pg_restore`, supports selective/parallel restore.
2. `medichain-<timestamp>.dump.sha256` — a SHA-256 checksum, so a later
   restore can detect a corrupted or truncated file *before* touching any
   database.
3. `medichain-<timestamp>.dump.manifest.txt` — an **exact** per-table row count
   (`count(*)`) taken at backup time, the ground truth a restore is checked
   against.

   > This was previously `pg_stat_user_tables.n_live_tup`, a planner estimate
   > maintained by autovacuum. On a database whose statistics had not been
   > gathered it read `0` for every table, so the manifest was a list of zeros —
   > and a restore that recovered **no data at all** compared equal to it and
   > was reported as verified. Both scripts now use exact counts, from a single
   > shared query (`scripts/lib/row-count-query.sh`, `lib/RowCountQuery.ps1`) so
   > the two sides of the comparison cannot drift apart. Horizon HZ-027.
   >
   > Cost: exact counting scans every table. That is affordable on a path that
   > already dumps the whole database, but measure it before pointing this at
   > production-scale data.

## Restore

```bash
./scripts/restore-postgres.sh <dump-file> [target-db-name]
```

`target-db-name` **defaults to `medichain_restore_test`** — a throwaway
database, never the live one — specifically so a missing argument can never
clobber real data. The script:

1. Verifies the dump's SHA-256 checksum; refuses to proceed on a mismatch.
2. Drops and recreates the target database (fresh, not merged into anything
   existing).
3. Restores via `pg_restore --no-owner --no-privileges` (portable across
   environments with different role setups).
4. Counts every table exactly, using the *same shared query* the manifest was
   written with, and diffs the result against the manifest. Any mismatch —
   including a partially applied restore that "succeeded" but is missing rows —
   fails loudly rather than reporting success. No `ANALYZE` is involved:
   nothing here depends on planner statistics any more.

## Rehearsal procedure

This is what "verified" means for this control — not "the script exists,"
but this sequence having actually been run and its output recorded.

**Last run: 2026-08-05, passed.** Transcript:
`.horizon/evidence-private/HZ-WP8-RES-005/rehearsal-postgres-2026-08-05.txt`

```bash
# 1. Start the stack with synthetic-only demo data (see docker-compose.horizon-isolated.yml)
docker compose -p medichain_horizon -f docker-compose.yml -f docker-compose.horizon-isolated.yml up -d

# The scripts default to the DEV stack. Point them at the isolated one:
export MEDICHAIN_PG_CONTAINER=medichain_horizon_postgres
export POSTGRES_USER=medichain_horizon
export POSTGRES_DB=medichain_horizon

# 2. Take a backup
./scripts/backup-postgres.sh
# note the row counts in the resulting .manifest.txt — if every table reads 0
# on a database you know has rows, stop: that is the HZ-027 signature.

# 3. Prove the restore is real, not a no-op: deliberately perturb the source so
#    a restore that silently does nothing would be caught by the row-count diff.
#    Pick a leaf table; deleting a patient cascades through demographics, NFC
#    tags and records, which muddies what the diff is telling you.
docker exec medichain_horizon_postgres psql -U medichain_horizon -d medichain_horizon \
  -c "DELETE FROM nfc_tags WHERE id = (SELECT id FROM nfc_tags LIMIT 1);"

# 4. Restore into the default throwaway target and verify
./scripts/restore-postgres.sh backups/medichain-<timestamp>.dump
# expect: "PASS: restored row counts match the backup-time manifest exactly"

# 5. The decisive check — the restored database must hold the PRE-perturbation
#    count while the source holds one fewer. Equal counts would mean the
#    "restore" was reading the live database.
docker exec medichain_horizon_postgres psql -U medichain_horizon \
  -d medichain_restore_test -t -A -c "SELECT count(*) FROM nfc_tags;"   # expect 5
docker exec medichain_horizon_postgres psql -U medichain_horizon \
  -d medichain_horizon      -t -A -c "SELECT count(*) FROM nfc_tags;"   # expect 4

# 6. Record the terminal output as evidence under
#    .horizon/evidence-private/HZ-WP8-RES-005/ and update the ledger row.
```

The container name above is `medichain_horizon_postgres` — set explicitly by
`container_name:` in the override file. It is **not** the
`medichain_horizon-postgres-1` that Compose's default naming would suggest;
this document said the latter until 2026-08-05, and that command fails.

### Automated regression check

```bash
bash scripts/test-backup-manifest.sh
```

Asserts the manifest's counts equal direct `count(*)`, that a correct restore
verifies, and — the case that previously passed while being catastrophically
wrong — that a restore recovering **no data** is rejected. Exits non-zero on
failure; skips with exit 2 if the isolated stack is not running.

## Kill switch / rollback (for the isolated Horizon environment, not production)

- **Stop everything immediately**: `docker compose -p medichain_horizon down`
- **Full rollback to nothing** (wipe all state including volumes):
  `docker compose -p medichain_horizon down -v`
- **Rebuild from a clean slate**: `docker compose -p medichain_horizon -f docker-compose.yml -f docker-compose.horizon-isolated.yml up -d` again — migrations re-apply from `api/migrations/` against the fresh, empty volume.

These commands are believed correct (they're standard Compose behavior) but,
like the restore path above, have not been *executed and observed* in this
environment yet — flagged as the same open verification item.

## Monitoring

- `GET /api/metrics` — the existing Prometheus scrape endpoint
  (`api/src/middleware/metrics.rs`, registered in `routes.rs`).
- `docker compose -p medichain_horizon logs -f api` — live container logs.
- `docker compose -p medichain_horizon ps` — container health status (the
  `postgres`/`nginx` services already define healthchecks in
  `docker-compose.yml`).

## Related, out of scope here

- The `sessions`/`user_profiles` schema observations from
  `.horizon/evidence-private/HZ-WP8-PRIV-001/data-map.md` are unrelated to
  this control.
- Production backup cadence, off-site/encrypted backup storage, and
  retention duration are operational decisions for the project owner — this
  runbook covers the *mechanism*, not the policy.
