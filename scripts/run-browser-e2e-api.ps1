# The API, configured the way the browser suites need it -- Windows edition.
#
# Same contract as `run-browser-e2e-api.sh`; read that file for why each
# variable is required. This twin exists because on Windows `bash` is usually
# WSL, and variables exported inside WSL do NOT reach a Windows `.exe` unless
# listed in WSLENV. Run through WSL bash, the .sh starts the API with none of
# them: "Repository backend: Memory", no fixtures, a suite that fails at sign-in
# for a reason that looks nothing like the environment (2026-10-13).
#
# DATABASE_URL defaults to the password the running `medichain_postgres`
# container actually has. `.env`'s POSTGRES_PASSWORD is not authoritative: a
# volume keeps the password it was initialised with, and on 2026-10-13 `.env`
# had been rotated while the container still ran with the dev default, so the
# .env value failed with "password authentication failed". Fallback: .env.
#
#   powershell -ExecutionPolicy Bypass -File scripts/run-browser-e2e-api.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (Test-Path .env) {
  foreach ($line in Get-Content .env) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $value = $Matches[2].Trim().Trim('"').Trim("'")
      [Environment]::SetEnvironmentVariable($Matches[1], $value, 'Process')
    }
  }
}

if (-not $env:ENCRYPTION_KEYS) {
  Write-Error 'ENCRYPTION_KEYS is not set (looked in the environment and ./.env). Refusing to start: existing patient rows would decrypt to nothing.'
  exit 1
}

$bin = '.\target\debug\medichain-api.exe'
if (-not (Test-Path $bin)) {
  Write-Error 'No API binary at .\target\debug\. Build it first: cargo build --bin medichain-api'
  exit 1
}

if (-not $env:DATABASE_URL) {
  $user = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'medichain' }
  $password = $null
  try { $password = (docker exec medichain_postgres printenv POSTGRES_PASSWORD 2>$null) } catch { $password = $null }
  if (-not $password) { $password = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { 'medichain_dev_2024' } }
  $db = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { 'medichain' }
  $env:DATABASE_URL = "postgres://${user}:$([uri]::EscapeDataString($password))@localhost:5432/$db"
}

$env:MEDICHAIN_STORAGE = 'postgres'
$env:IS_DEMO = 'true'
$env:MEDICHAIN_DEV_MODE = '1'
if (-not $env:MEDICHAIN_RATE_LIMIT_ANONYMOUS) { $env:MEDICHAIN_RATE_LIMIT_ANONYMOUS = '6000' }
if (-not $env:MEDICHAIN_RATE_LIMIT_AUTHENTICATED) { $env:MEDICHAIN_RATE_LIMIT_AUTHENTICATED = '6000' }
$env:AUDIT_CHECKPOINT_SINK = 'none'
$env:DISPENSING_POLICY_PATH = (Resolve-Path 'api\data\dispensing_policy.example.json').Path

foreach ($name in 'AT_API_KEY', 'FAYDA_API_KEY', 'GHANA_CARD_API_KEY') {
  Remove-Item "Env:$name" -ErrorAction SilentlyContinue
}

if (-not $env:MEDICHAIN_BOOTSTRAP_KEY) { $env:MEDICHAIN_BOOTSTRAP_KEY = 'synthetic-test-bootstrap-key-2026' }
if (-not $env:CLINIC_UTC_OFFSET_MINUTES) { $env:CLINIC_UTC_OFFSET_MINUTES = '120' }
# 8090, not 8080: 8080 is the IPFS gateway's port.
$env:PORT = '8090'
if (-not $env:IPFS_API_URL) { $env:IPFS_API_URL = 'http://127.0.0.1:5001' }
if (-not $env:IPFS_GATEWAY_URL) { $env:IPFS_GATEWAY_URL = 'http://127.0.0.1:8080' }
if (-not $env:RUST_LOG) { $env:RUST_LOG = 'info' }

& $bin
exit $LASTEXITCODE
