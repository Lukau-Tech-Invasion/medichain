# Restore a MediChain PostgreSQL backup with integrity verification
# (Horizon HZ-WP8-RES-005).
#
# Verifies the dump's checksum before touching any database, restores into a
# target database (defaults to a throwaway "medichain_restore_test" — never
# the live database unless explicitly named), then compares post-restore row
# counts against the backup-time manifest.
#
# Usage: .\scripts\restore-postgres.ps1 -DumpFile <path> [-TargetDb medichain_restore_test]

param(
    [Parameter(Mandatory = $true)]
    [string]$DumpFile,
    [string]$TargetDb = "medichain_restore_test"
)

$ErrorActionPreference = "Stop"

$Container = if ($env:MEDICHAIN_PG_CONTAINER) { $env:MEDICHAIN_PG_CONTAINER } else { "medichain_postgres" }
$DbUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "medichain" }

if (-not (Test-Path $DumpFile)) {
    Write-Error "Dump file not found: $DumpFile"
    exit 1
}

$ChecksumFile = "$DumpFile.sha256"
$ManifestFile = "$DumpFile.manifest.txt"

if (Test-Path $ChecksumFile) {
    Write-Output "Verifying checksum..."
    $expected = (Get-Content $ChecksumFile | Select-Object -First 1) -split '\s+' | Select-Object -First 1
    $actual = (Get-FileHash -Path $DumpFile -Algorithm SHA256).Hash.ToLower()
    if ($expected -ne $actual) {
        Write-Error "Checksum mismatch — dump may be corrupted or truncated. Refusing to restore."
        exit 1
    }
} else {
    Write-Warning "No checksum file found alongside $DumpFile — proceeding without integrity verification of the file itself."
}

Write-Output "Restoring into database '$TargetDb' (container '$Container')..."

& docker exec $Container psql -U $DbUser -d postgres -c "DROP DATABASE IF EXISTS $TargetDb;"
& docker exec $Container psql -U $DbUser -d postgres -c "CREATE DATABASE $TargetDb;"
# Feed the dump in at the OS level, for the same reason the backup redirects out
# at the OS level (HZ-028): `-Encoding Byte` does not exist in PowerShell 7, and
# piping through PowerShell would decode the binary dump as text and corrupt it.
$restoreCmd = "docker exec -i $Container pg_restore -U $DbUser -d $TargetDb --no-owner --no-privileges < `"$DumpFile`""
& cmd.exe /c $restoreCmd
if ($LASTEXITCODE -ne 0) { Write-Error "pg_restore failed (exit $LASTEXITCODE)"; exit 1 }

if (-not (Test-Path $ManifestFile)) {
    Write-Warning "No manifest found alongside $DumpFile — skipping row-count verification."
    Write-Output "Restore ran without error, but integrity was NOT verified against pre-backup counts."
    exit 0
}

Write-Output "Verifying row counts against backup-time manifest..."
# EXACT counts, from the same shared query the manifest was written with, so
# both sides of this comparison describe the database identically. This used to
# read n_live_tup after an ANALYZE while the backup read it WITHOUT one, so a
# data-free restore compared equal to a manifest of zeros and was reported as
# verified (Horizon HZ-027). No ANALYZE is needed now — nothing here depends on
# planner statistics.
$ExcludeSchemaRegex = if ($env:MEDICHAIN_BACKUP_EXCLUDE_REGEX) { $env:MEDICHAIN_BACKUP_EXCLUDE_REGEX } else { "^medichain_test_" }
. (Join-Path $PSScriptRoot "lib\RowCountQuery.ps1")
$actualCounts = & docker exec $Container psql -U $DbUser -d $TargetDb -t -A -c (Get-RowCountQuery -ExcludeRegex $ExcludeSchemaRegex)
$expectedCounts = Get-Content $ManifestFile

$diff = Compare-Object -ReferenceObject $expectedCounts -DifferenceObject $actualCounts
if ($null -eq $diff) {
    Write-Output "PASS: restored row counts match the backup-time manifest exactly, table for table."
} else {
    Write-Error "MISMATCH: restored row counts differ from the backup-time manifest:"
    $diff | Format-Table
    exit 1
}

Write-Output "Restore verified: '$TargetDb' matches the backup taken at $(Split-Path -Leaf $DumpFile)."
