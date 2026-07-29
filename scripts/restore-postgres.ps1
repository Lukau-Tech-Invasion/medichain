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
Get-Content -Path $DumpFile -Encoding Byte -AsByteStream -Raw | & docker exec -i $Container pg_restore -U $DbUser -d $TargetDb --no-owner --no-privileges

if (-not (Test-Path $ManifestFile)) {
    Write-Warning "No manifest found alongside $DumpFile — skipping row-count verification."
    Write-Output "Restore ran without error, but integrity was NOT verified against pre-backup counts."
    exit 0
}

Write-Output "Verifying row counts against backup-time manifest..."
& docker exec $Container psql -U $DbUser -d $TargetDb -c "ANALYZE;" | Out-Null
$actualCounts = & docker exec $Container psql -U $DbUser -d $TargetDb -t -A -c "
  SELECT schemaname || '.' || relname || ' ' || n_live_tup
  FROM pg_stat_user_tables
  ORDER BY schemaname, relname;
"
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
