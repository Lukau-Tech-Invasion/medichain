# MediChain CI Lint Script (PowerShell)
# Purpose: Prevent introduction of PostgreSQL positional placeholders ($1, $2, etc.)
#          in repository code. Use sqlx::QueryBuilder pattern instead.
#
# Usage: .\scripts\lint-no-dollar-placeholders.ps1
# Returns: Exit code 0 if clean, 1 if violations found

$ErrorActionPreference = "Stop"

Write-Host "Checking for prohibited PostgreSQL positional placeholders (`$1, `$2, etc.)..." -ForegroundColor Cyan
Write-Host "Location: api/src/repositories/postgres/" -ForegroundColor Gray
Write-Host ""

$repoPath = Join-Path $PSScriptRoot "..\api\src\repositories\postgres"
$files = Get-ChildItem -Path $repoPath -Filter "*.rs" -File

$violations = @()

foreach ($file in $files) {
    $lineNum = 0
    foreach ($line in Get-Content $file.FullName) {
        $lineNum++
        # Skip documentation comments (lines starting with //!)
        if ($line -match '^\s*//!' -or $line -match '^\s*//') {
            continue
        }
        # Check for $N patterns (N is a digit)
        if ($line -match '\$[0-9]+') {
            $violations += [PSCustomObject]@{
                File    = $file.Name
                Line    = $lineNum
                Content = $line.Trim()
            }
        }
    }
}

if ($violations.Count -gt 0) {
    Write-Host "❌ FAILED: Found prohibited positional placeholder patterns!" -ForegroundColor Red
    Write-Host ""
    Write-Host "The following lines contain `$1, `$2, etc. which should be replaced with QueryBuilder:" -ForegroundColor Yellow
    Write-Host ""
    
    $violations | ForEach-Object {
        Write-Host "$($_.File):$($_.Line): $($_.Content)" -ForegroundColor White
    }
    
    Write-Host ""
    Write-Host "Please use sqlx::QueryBuilder pattern instead. Example:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host '  // BEFORE (prohibited):' -ForegroundColor Gray
    Write-Host '  sqlx::query_as("SELECT * FROM table WHERE id = $1").bind(id)' -ForegroundColor Gray
    Write-Host ""
    Write-Host '  // AFTER (required):' -ForegroundColor Gray
    Write-Host '  let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("SELECT * FROM table WHERE id = ");' -ForegroundColor Gray
    Write-Host '  qb.push_bind(id);' -ForegroundColor Gray
    Write-Host '  qb.build_query_as::<Entity>().fetch_one(&pool).await?' -ForegroundColor Gray
    Write-Host ""
    
    exit 1
}
else {
    Write-Host "✅ PASSED: No prohibited positional placeholders found" -ForegroundColor Green
    exit 0
}
