<#
.SYNOPSIS
  Test the LIVE MediChain deployment end to end, as the reviewer accounts.

.DESCRIPTION
  Run on your own machine; nothing here stores or prints a password.

    1. The site itself: health, HTTPS certificate, security headers, and the
       production switches (no demo login, no public metrics, HTTP -> HTTPS).
    2. Every staff reviewer account in a real Chromium browser: signs in and
       opens every screen its role can reach, checking each renders, is
       labelled, survives refresh, back/forward and a phone-width screen, and
       breaks no Content-Security-Policy rule; screens of other roles must be
       refused; an ended session must return the person to their page.
    3. Every patient reviewer account in the patient app, the same way.

  It reads; it does not create clinical records. Opening a chart is recorded
  in that patient's access history ("opened for treatment"), as any real
  clinician's look would be.

  Takes about 1.5 hours (each staff role walks every screen, paced under the
  site's request limit). The report is written to -OutDir.

.EXAMPLE
  powershell -File scripts\live-check.ps1
  powershell -File scripts\live-check.ps1 -Quick     # site checks + one staff role + one patient
#>
param(
  [string]$BaseUrl = 'https://13-247-143-188.sslip.io',
  [string]$Credentials = 'C:\Users\Admin\medichain-showcase\judges.json',
  [string]$OutDir = 'C:\Users\Admin\medichain-showcase\live-check',
  [switch]$Quick
)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force $OutDir | Out-Null
$results = [System.Collections.Generic.List[object]]::new()
function Record([string]$Check, [bool]$Ok, [string]$Detail = '') {
  $results.Add([pscustomobject]@{ Check = $Check; Result = $(if ($Ok) { 'PASS' } else { 'FAIL' }); Detail = $Detail })
  $colour = if ($Ok) { 'Green' } else { 'Red' }
  Write-Host ("  {0,-4}  {1}  {2}" -f $(if ($Ok) { 'PASS' } else { 'FAIL' }), $Check, $Detail) -ForegroundColor $colour
}

Write-Host "`nMediChain live check against $BaseUrl`n"

# ---------------------------------------------------------------- 1. the site
Write-Host 'Site'
try {
  $health = Invoke-RestMethod "$BaseUrl/api/health" -TimeoutSec 20
  Record 'API health' ($health.status -eq 'healthy') "status=$($health.status)"
  Record 'Audit batches signed' ($health.audit_seal.signing -eq 'ed25519') "signing=$($health.audit_seal.signing) sink=$($health.audit_seal.sink)"
} catch { Record 'API health' $false $_.Exception.Message }

try {
  $uri = [Uri]$BaseUrl
  $tcp = [System.Net.Sockets.TcpClient]::new($uri.Host, 443)
  $ssl = [System.Net.Security.SslStream]::new($tcp.GetStream(), $false)
  $ssl.AuthenticateAsClient($uri.Host)
  $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($ssl.RemoteCertificate)
  $days = [int]($cert.NotAfter - (Get-Date)).TotalDays
  Record 'HTTPS certificate valid' ($days -gt 14) "expires $($cert.NotAfter.ToString('yyyy-MM-dd')) ($days days)"
  $ssl.Dispose(); $tcp.Dispose()
} catch { Record 'HTTPS certificate valid' $false $_.Exception.Message }

try {
  $page = Invoke-WebRequest "$BaseUrl/doctor/" -UseBasicParsing -TimeoutSec 20
  foreach ($h in 'Content-Security-Policy', 'Strict-Transport-Security', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy') {
    Record "Header $h" ([bool]$page.Headers[$h]) ''
  }
  $csp = [string]$page.Headers['Content-Security-Policy']
  $scriptSrc = ($csp -split ';' | Where-Object { $_.Trim().StartsWith('script-src') }) -join ''
  Record 'CSP forbids inline scripts' ($scriptSrc -and -not $scriptSrc.Contains("'unsafe-inline'")) ''
} catch { Record 'Security headers' $false $_.Exception.Message }

function StatusOf([string]$Method, [string]$Url) {
  try { (Invoke-WebRequest $Url -Method $Method -UseBasicParsing -TimeoutSec 20 -ContentType 'application/json' -Body '{}' -MaximumRedirection 0).StatusCode }
  catch { if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { -1 } }
}
Record 'Demo sign-in refused' ((StatusOf 'POST' "$BaseUrl/api/auth/demo-login") -eq 403) ''
Record 'Metrics not public' ((StatusOf 'GET' "$BaseUrl/metrics") -in 401, 403, 404) ''
$plain = StatusOf 'GET' ($BaseUrl -replace '^https:', 'http:')
Record 'HTTP redirects to HTTPS' ($plain -in 301, 302, 307, 308) "status=$plain"
Record 'Bad sign-in refused' ((StatusOf 'POST' "$BaseUrl/api/auth/login") -in 400, 401, 422) ''

# ------------------------------------------------- 2/3. the accounts, in a browser
if (-not (Test-Path $Credentials)) { throw "Credentials file not found: $Credentials" }
$accounts = (Get-Content $Credentials -Raw | ConvertFrom-Json).accounts
$staff = @($accounts | Where-Object { $_.role -ne 'Patient' })
$patients = @($accounts | Where-Object { $_.role -eq 'Patient' })
function PatientEntry($p) {
  [ordered]@{ role = 'Patient'; user_id = $p.user_id; login_id = $p.login_id; password = $p.password
    linked_patient_id = $p.linked_patient_id; medical_id = $p.medical_id; nfc_tag_id = '' }
}
# The browser suites read their accounts from a manifest; it lives in -OutDir,
# never in the repository, and is deleted at the end.
$manifestPath = Join-Path $OutDir 'manifest.json'
function WriteManifest($patient) {
  [ordered]@{
    generated_at = (Get-Date).ToString('o'); api = "$BaseUrl/api"; warning = 'live-check manifest; deleted after the run'
    staff = @($staff | ForEach-Object { [ordered]@{ role = $_.role; user_id = $_.user_id; login_id = $_.login_id; password = $_.password } })
    patient = PatientEntry $patient
    patient_b = PatientEntry ($patients | Where-Object { $_.login_id -ne $patient.login_id } | Select-Object -First 1)
  } | ConvertTo-Json -Depth 10 | ForEach-Object {
    # Windows PowerShell's `-Encoding utf8` writes a byte-order mark, which
    # JSON.parse in the test suites refuses.
    [IO.File]::WriteAllText($manifestPath, $_, [Text.UTF8Encoding]::new($false))
  }
}

$env:E2E_DEPLOYED_URL = $BaseUrl
$env:MEDICHAIN_API_URL = "$BaseUrl/api"
$env:PATIENT_APP_URL = "$BaseUrl/patient"
$env:MEDICHAIN_FIXTURE_MANIFEST = $manifestPath

# Node and npx write warnings to stderr; under 'Stop' Windows PowerShell turns
# any stderr line from a native command into a terminating error. Native tools
# are judged by their exit code from here on.
$ErrorActionPreference = 'Continue'
Remove-Item env:FORCE_COLOR -ErrorAction SilentlyContinue
Push-Location (Join-Path $Repo 'client')
if (-not (Test-Path 'node_modules')) { npm ci --no-audit --fund=false 2>&1 | Out-Null }
npx playwright install chromium 2>&1 | Out-Null
Pop-Location

function RunSuite([string]$Name, [string]$Workspace, [string]$Prefix, [string[]]$Extra) {
  $env:E2E_PORTAL_PREFIX = $Prefix
  Push-Location (Join-Path $Repo "client\$Workspace")
  $log = Join-Path $OutDir "$Name.log"
  $cmd = @('playwright', 'test', '--config', 'playwright.config.ts', '--workers=1', '--retries=0', '--reporter=list',
            '--output', (Join-Path $OutDir "$Name-artifacts"), 'e2e/all-routes.spec.ts') + $Extra
  & npx @cmd *> $log
  $code = $LASTEXITCODE
  Pop-Location
  $summary = (Get-Content $log | Select-String -Pattern '^\s+\d+ (passed|failed)' | ForEach-Object { $_.Line.Trim() }) -join ', '
  Record $Name ($code -eq 0) $summary
}

Write-Host "`nStaff accounts (every screen of each role)"
$roles = @($staff.role | Select-Object -Unique)
if ($Quick) { $roles = @($roles | Select-Object -First 1) }
WriteManifest $patients[0]
foreach ($role in $roles) {
  $ofRole = @($staff | Where-Object { $_.role -eq $role })
  for ($i = 0; $i -lt $ofRole.Count; $i++) {
    if ($Quick -and $i -gt 0) { break }
    $env:E2E_ROLES = $role
    $env:E2E_STAFF_INDEX = "$i"
    RunSuite "$role $($ofRole[$i].login_id)" 'doctor-portal' '/doctor' @('--grep', "$role account, every route")
    Start-Sleep 30
  }
}
Remove-Item env:E2E_ROLES, env:E2E_STAFF_INDEX -ErrorAction SilentlyContinue

Write-Host "`nPatient accounts (every screen of the patient app)"
$toWalk = if ($Quick) { @($patients | Select-Object -First 1) } else { $patients }
foreach ($p in $toWalk) {
  WriteManifest $p
  RunSuite "Patient $($p.login_id)" 'patient-app' '/patient' @('--project=desktop')
  Start-Sleep 30
}

Remove-Item $manifestPath -ErrorAction SilentlyContinue

# ----------------------------------------------------------------- report
$report = Join-Path $OutDir ("live-check-{0}.csv" -f (Get-Date -Format 'yyyyMMdd-HHmm'))
$results | Export-Csv $report -NoTypeInformation
$failed = @($results | Where-Object Result -eq 'FAIL').Count
Write-Host ("`n{0} checks, {1} failed. Report: {2}" -f $results.Count, $failed, $report) -ForegroundColor $(if ($failed) { 'Red' } else { 'Green' })
Write-Host "Failure details (screenshots, page state): $OutDir\*-artifacts"
exit $(if ($failed) { 1 } else { 0 })
