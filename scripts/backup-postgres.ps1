# Backup the MediChain PostgreSQL database (Horizon HZ-WP8-RES-005).
#
# Produces a custom-format pg_dump (restorable with pg_restore) plus a SHA-256
# checksum and a per-table row-count manifest, so a later restore can verify
# the backup wasn't corrupted/truncated and that the restore is complete.
#
# Usage: .\scripts\backup-postgres.ps1 [-OutDir backups]

param(
    [string]$OutDir = "backups"
)

$ErrorActionPreference = "Stop"

$Container = if ($env:MEDICHAIN_PG_CONTAINER) { $env:MEDICHAIN_PG_CONTAINER } else { "medichain_postgres" }
$DbUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "medichain" }
$DbName = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "medichain" }

# Ephemeral schemas leaked by the live-DB integration tests
# (medichain_test_<pid>_<timestamp>). pg_dump LOCKs every table inside one
# transaction, and ~239 leaked schemas x ~120 tables exhausted
# max_locks_per_transaction with "out of shared memory" — so the documented
# backup simply did not run on any machine that had executed those tests. The
# glob is for pg_dump -N; the regex is the equivalent for the manifest, and the
# two must agree or the manifest would list tables the dump omits.
$ExcludeSchemaGlob = if ($env:MEDICHAIN_BACKUP_EXCLUDE_SCHEMA) { $env:MEDICHAIN_BACKUP_EXCLUDE_SCHEMA } else { "medichain_test_*" }
$ExcludeSchemaRegex = if ($env:MEDICHAIN_BACKUP_EXCLUDE_REGEX) { $env:MEDICHAIN_BACKUP_EXCLUDE_REGEX } else { "^medichain_test_" }

. (Join-Path $PSScriptRoot "lib\RowCountQuery.ps1")

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$DumpFile = Join-Path $OutDir "medichain-$Timestamp.dump"
$ChecksumFile = "$DumpFile.sha256"
$ManifestFile = "$DumpFile.manifest.txt"

Write-Output "Backing up '$DbName' from container '$Container' -> $DumpFile"

# Redirect at the OS level rather than through a PowerShell pipeline (HZ-028).
# `-Encoding Byte` is PowerShell 5.1-only — it was REMOVED in PowerShell 6, so
# on the pwsh 7 this repo actually uses, this line threw "'Byte' is not a
# supported encoding name" and the Windows backup path had never once run.
# Nor is `-AsByteStream` alone a fix: PowerShell decodes native-command output
# as TEXT before it reaches the pipeline, which silently corrupts a binary
# custom-format dump — a backup that appears to succeed and cannot be restored
# is worse than one that fails loudly.
$dumpCmd = "docker exec $Container pg_dump -U $DbUser -d $DbName -Fc -N `"$ExcludeSchemaGlob`" > `"$DumpFile`""
& cmd.exe /c $dumpCmd
if ($LASTEXITCODE -ne 0) { Write-Error "pg_dump failed (exit $LASTEXITCODE)"; exit 1 }

# EXACT counts, from the query shared with the restore script — see
# scripts/lib/RowCountQuery.ps1 for why an estimate here let a data-free restore
# pass verification (Horizon HZ-027).
& docker exec $Container psql -U $DbUser -d $DbName -t -A -c (Get-RowCountQuery -ExcludeRegex $ExcludeSchemaRegex) | Set-Content -Path $ManifestFile

# An all-zero manifest is the signature of the HZ-027 defect, and also what a
# genuinely empty database legitimately produces. Say so rather than guessing.
$manifestRows = Get-Content $ManifestFile | ForEach-Object { ($_ -split ' ')[-1] -as [int] } | Measure-Object -Sum
if ($manifestRows.Sum -eq 0) {
    Write-Warning "Every table in the manifest has 0 rows — expected only if '$DbName' is genuinely empty."
}

$hash = Get-FileHash -Path $DumpFile -Algorithm SHA256
"$($hash.Hash.ToLower())  $(Split-Path -Leaf $DumpFile)" | Set-Content -Path $ChecksumFile

Write-Output "Backup complete:"
Write-Output "  Dump:      $DumpFile"
Write-Output "  Checksum:  $ChecksumFile"
Write-Output "  Manifest:  $ManifestFile"
