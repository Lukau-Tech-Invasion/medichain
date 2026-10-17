# Run one portal's local-api Playwright suite and keep the evidence.
#
# Writes, under output/browser-evidence/<date>/<stage>/<portal>/:
#   run.log       the list reporter's output
#   report/       the Playwright HTML report
#   results.json  the JSON reporter's output
#   test-results/ traces and screenshots of failing tests
#   summary.md    pass/fail/skip/flaky counts and every non-passing test with
#                 its first error line, for the tracker's run log
#
# One portal at a time: both suites share the API's per-IP rate-limit bucket.
# The API must already be up on :8090 (scripts/run-browser-e2e-api.ps1) and the
# fixtures seeded (.browser-test/fixtures.json).
#
#   powershell -ExecutionPolicy Bypass -File scripts/run-browser-suite.ps1 -Portal doctor
#   powershell -ExecutionPolicy Bypass -File scripts/run-browser-suite.ps1 -Portal patient -Stage baseline
#   ... -Portal doctor -Stage pediatrics pediatrics-unknown   (extra args go to playwright)
# Named-only parameters: a bare spec filter must reach playwright, not bind to -Date.
[CmdletBinding(PositionalBinding = $false)]
param(
  [Parameter(Mandatory = $true)][ValidateSet('doctor', 'patient')][string]$Portal,
  [string]$Stage = 'baseline',
  [ValidatePattern('^\d{4}-\d{2}-\d{2}$')][string]$Date = (Get-Date -Format 'yyyy-MM-dd'),
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$PlaywrightArgs
)
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$portalDir = Join-Path $root ($(if ($Portal -eq 'doctor') { 'client\doctor-portal' } else { 'client\patient-app' }))
$evidence = Join-Path $root "output\browser-evidence\$Date\$Stage\$Portal"
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $evidence 'screenshots') | Out-Null

$env:PLAYWRIGHT_HTML_REPORT = Join-Path $evidence 'report'
$env:PLAYWRIGHT_HTML_OPEN = 'never'
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path $evidence 'results.json'
$env:E2E_SCREENSHOT_DIR = Join-Path $evidence 'screenshots'

$started = Get-Date
Push-Location $portalDir
try {
  $cmd = @('playwright', 'test', '--config', 'playwright.local-api.config.ts', '--reporter=list,html,json',
    '--output', (Join-Path $evidence 'test-results'), '--trace', 'retain-on-failure') + $PlaywrightArgs
  & npx @cmd 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath (Join-Path $evidence 'run.log') | Out-Null
  $exit = $LASTEXITCODE
} finally {
  Pop-Location
}

$lines = @("# $Portal suite, stage '$Stage', $Date", '',
  "Started $($started.ToString('s')), took $([int]((Get-Date) - $started).TotalSeconds)s, playwright exit $exit.", '')
$jsonPath = $env:PLAYWRIGHT_JSON_OUTPUT_NAME
if (Test-Path $jsonPath) {
  $report = Get-Content $jsonPath -Raw | ConvertFrom-Json
  $s = $report.stats
  $lines += "expected (passed): $($s.expected); unexpected (failed): $($s.unexpected); skipped: $($s.skipped); flaky: $($s.flaky)"
  $lines += ''
  $lines += '| Status | Project | Spec | Test | First error line |'
  $lines += '| --- | --- | --- | --- | --- |'
  $walk = $null
  $walk = {
    param($suite, $file)
    $f = if ($suite.file) { $suite.file } else { $file }
    foreach ($spec in @($suite.specs)) {
      if (-not $spec) { continue }
      foreach ($t in @($spec.tests)) {
        if ($t.status -eq 'expected') { continue }
        $last = @($t.results)[-1]
        $msg = ''
        if ($last -and $last.error -and $last.error.message) {
          $msg = (($last.error.message -replace '\x1b\[[0-9;]*m', '') -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
        }
        $msg = ($msg -replace '\|', '/').Trim()
        if ($msg.Length -gt 160) { $msg = $msg.Substring(0, 160) + '...' }
        $lines += "| $($t.status) | $($t.projectName) | $f | $($spec.title -replace '\|', '/') | $msg |"
      }
    }
    foreach ($child in @($suite.suites)) { if ($child) { & $walk $child $f } }
  }
  foreach ($suite in @($report.suites)) { & $walk $suite $null }
} else {
  $lines += 'No results.json: the run did not reach the reporter (see run.log).'
}
$lines | Set-Content -Encoding UTF8 (Join-Path $evidence 'summary.md')
Get-Content (Join-Path $evidence 'summary.md')
exit $exit
