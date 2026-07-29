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

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$DumpFile = Join-Path $OutDir "medichain-$Timestamp.dump"
$ChecksumFile = "$DumpFile.sha256"
$ManifestFile = "$DumpFile.manifest.txt"

Write-Output "Backing up '$DbName' from container '$Container' -> $DumpFile"

& docker exec $Container pg_dump -U $DbUser -d $DbName -Fc | Set-Content -Path $DumpFile -Encoding Byte -AsByteStream

& docker exec $Container psql -U $DbUser -d $DbName -t -A -c "
  SELECT schemaname || '.' || relname || ' ' || n_live_tup
  FROM pg_stat_user_tables
  ORDER BY schemaname, relname;
" | Set-Content -Path $ManifestFile

$hash = Get-FileHash -Path $DumpFile -Algorithm SHA256
"$($hash.Hash.ToLower())  $(Split-Path -Leaf $DumpFile)" | Set-Content -Path $ChecksumFile

Write-Output "Backup complete:"
Write-Output "  Dump:      $DumpFile"
Write-Output "  Checksum:  $ChecksumFile"
Write-Output "  Manifest:  $ManifestFile"
