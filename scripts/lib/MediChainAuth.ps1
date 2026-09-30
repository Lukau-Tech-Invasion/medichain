# Signing in from PowerShell harnesses. DOT-SOURCE this file:
#
#   . "$PSScriptRoot/lib/MediChainAuth.ps1"
#   $doctor = Connect-FixtureRole -ApiBase $API_BASE -Role Doctor
#   Invoke-RestMethod ... -Headers @{ Authorization = "Bearer $($doctor.Token)" }
#
# There is no identity header: a request carries a bearer token the API issued
# through POST /api/auth/login, or it is anonymous. The accounts are the
# fixtures `scripts/seed-browser-test-fixtures.ts` wrote to
# `.browser-test/fixtures.json`; their credentials live only in that file.
#
# The auth proof is derived by scripts/lib/auth_proof.py, the Python port of
# client/shared/src/auth/proof.ts, so the same password yields the same proof
# here as in a portal.

function Get-AuthProof {
    param([string]$LoginId, [string]$Password)
    $script = Join-Path $PSScriptRoot 'auth_proof.py'
    $proof = & python $script $LoginId $Password
    if ($LASTEXITCODE -ne 0 -or -not $proof) { throw "could not derive an auth proof for '$LoginId'" }
    return "$proof".Trim()
}

function Read-FixtureManifest {
    $path = Join-Path (Split-Path $PSScriptRoot -Parent | Split-Path -Parent) '.browser-test/fixtures.json'
    if (-not (Test-Path $path)) {
        throw "No fixtures at $path. Run scripts/seed-browser-test-fixtures.ts first."
    }
    return Get-Content $path -Raw | ConvertFrom-Json
}

# Sign in and return @{ LoginId; UserId; Token; Role; LinkedPatientId }.
function Connect-MediChain {
    param([string]$ApiBase, [string]$LoginId, [string]$Password)
    $body = @{ identifier = $LoginId; auth_proof = (Get-AuthProof -LoginId $LoginId -Password $Password) } |
        ConvertTo-Json -Compress
    $r = Invoke-RestMethod -Uri "$ApiBase/api/auth/login" -Method Post -Body $body `
        -ContentType 'application/json' -ErrorAction Stop
    if (-not $r.access_token) { throw "sign-in for '$LoginId' returned no access token" }
    return @{
        LoginId         = $LoginId
        UserId          = [string]$r.user.user_id
        Token           = [string]$r.access_token
        Role            = [string]$r.user.role
        LinkedPatientId = [string]$r.user.linked_patient_id
    }
}

# Sign in as the first fixture holding $Role (Doctor, Nurse, Pharmacist,
# LabTechnician, Admin or Patient).
function Connect-FixtureRole {
    param([string]$ApiBase, [string]$Role)
    $m = Read-FixtureManifest
    if ($Role -eq 'Patient') { $row = $m.patient }
    else { $row = $m.staff | Where-Object { $_.role -eq $Role } | Select-Object -First 1 }
    if (-not $row) { throw "no '$Role' fixture in .browser-test/fixtures.json" }
    $password = if ($row.password) { $row.password } else { $env:MEDICHAIN_ADMIN_PASSWORD }
    return Connect-MediChain -ApiBase $ApiBase -LoginId $row.login_id -Password $password
}
