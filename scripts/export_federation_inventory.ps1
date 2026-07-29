<#
.SYNOPSIS
Exports a source-backed Phase 0 MediChain federation inventory.

.DESCRIPTION
Scans only tracked source locations and writes the handoff-required manifest.
It is deliberately descriptive: it does not connect to services, run migrations,
or modify application code.
#>

[CmdletBinding()]
param(
    [string]$OutputPath = "docs/MEDICHAIN_FEDERATION_MANIFEST.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RelativePath {
    param([string]$Path, [string]$Root)

    return [IO.Path]::GetRelativePath($Root, $Path).Replace('\', '/')
}

function Get-TrackedFiles {
    param(
        [string]$Root,
        [string[]]$Prefixes,
        [string[]]$Extensions
    )

    $trackedFiles = & git -C $Root ls-files
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to enumerate tracked repository files.'
    }

    return $trackedFiles | Where-Object {
        $relativePath = $_.Replace('\', '/')
        $matchesPrefix = $Prefixes.Count -eq 0 -or @(
            $Prefixes | Where-Object {
                $normalizedPrefix = $_.Trim('/').Replace('\', '/')
                $relativePath -eq $normalizedPrefix -or
                    $relativePath.StartsWith("$normalizedPrefix/", [StringComparison]::Ordinal)
            }
        ).Count -gt 0
        $matchesPrefix -and ($Extensions.Count -eq 0 -or $Extensions -contains [IO.Path]::GetExtension($relativePath))
    } | ForEach-Object {
        Join-Path $Root $_
    }
}

function Get-RustAttributeInventory {
    param([string]$Root)

    $items = [System.Collections.Generic.List[object]]::new()
    $routeRegistry = Get-Content (Join-Path $Root 'api/src/routes.rs') -Raw
    $registeredHandlers = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    [regex]::Matches($routeRegistry, '\.service\((?:clinical_endpoints::)?([a-zA-Z0-9_]+)\)') |
        ForEach-Object { [void]$registeredHandlers.Add($_.Groups[1].Value) }

    Get-TrackedFiles -Root $Root -Prefixes @('api/src') -Extensions @('.rs') |
        ForEach-Object {
            $filePath = $_
            $lines = Get-Content $filePath
            for ($index = 0; $index -lt $lines.Count; $index++) {
                $match = [regex]::Match($lines[$index], '^\s*#\[(get|post|put|patch|delete)\("([^\"]+)"\)\]')
                if (-not $match.Success) {
                    continue
                }

                $handler = $null
                for ($next = $index + 1; $next -lt [Math]::Min($index + 12, $lines.Count); $next++) {
                    $functionMatch = [regex]::Match($lines[$next], '\b(?:pub\s+)?async\s+fn\s+([a-zA-Z0-9_]+)')
                    if ($functionMatch.Success) {
                        $handler = $functionMatch.Groups[1].Value
                        break
                    }
                }

                $items.Add([ordered]@{
                    method = $match.Groups[1].Value.ToUpperInvariant()
                    path = $match.Groups[2].Value
                    handler = $handler
                    registered = $null -ne $handler -and $registeredHandlers.Contains($handler)
                    source = "$(Get-RelativePath $filePath $Root):$($index + 1)"
                })
            }
        }

    [regex]::Matches(
        $routeRegistry,
        '\.route\(\s*"([^"]+)"\s*,\s*web::(get|post|put|patch|delete)\(\)\.to\(([^)]+)\)',
        [Text.RegularExpressions.RegexOptions]::Singleline
    ) | ForEach-Object {
        $items.Add([ordered]@{
            method = $_.Groups[2].Value.ToUpperInvariant()
            path = $_.Groups[1].Value
            handler = $_.Groups[3].Value
            registered = $true
            source = 'api/src/routes.rs'
        })
    }

    return $items | Sort-Object method, path, source
}

function Get-TableInventory {
    param([string]$Root)

    $items = [System.Collections.Generic.List[object]]::new()
    Get-TrackedFiles -Root $Root -Prefixes @('api/migrations') -Extensions @('.sql') |
        Sort-Object |
        ForEach-Object {
            $filePath = $_
            $source = Get-RelativePath $filePath $Root
            $lineNumber = 0
            Get-Content $filePath | ForEach-Object {
                $lineNumber++
                $match = [regex]::Match($_, 'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)', 'IgnoreCase')
                if ($match.Success) {
                    $items.Add([ordered]@{ name = $match.Groups[1].Value; source = "${source}:$lineNumber" })
                }
            }
        }
    return $items | Sort-Object name, source
}

function Get-FileMatches {
    param([string]$Root, [string[]]$Roots, [string]$Pattern, [string[]]$Extensions)

    $items = [System.Collections.Generic.List[string]]::new()
    foreach ($relativeRoot in $Roots) {
        Get-TrackedFiles -Root $Root -Prefixes @($relativeRoot) -Extensions $Extensions |
            ForEach-Object {
            if (Select-String -Path $_ -Pattern $Pattern -Quiet) {
                $items.Add((Get-RelativePath $_ $Root))
            }
        }
    }
    return $items | Sort-Object -Unique
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$palletCalls = Get-FileMatches -Root $root -Roots @('pallets') -Pattern '#\[pallet::call\]|pub fn ' -Extensions @('.rs')
$manifest = [ordered]@{
    generated_at_utc = [DateTime]::UtcNow.ToString('o')
    scope = 'Phase 0 source inventory; no production-readiness claim'
    source_of_truth = 'current local checkout'
    api_routes = Get-RustAttributeInventory -Root $root
    database_tables = Get-TableInventory -Root $root
    repositories = Get-TrackedFiles -Root $root -Prefixes @('api/src/repositories') -Extensions @('.rs') |
        ForEach-Object { Get-RelativePath $_ $root } | Sort-Object
    encryption_call_sites = Get-FileMatches -Root $root -Roots @('api', 'crypto') -Pattern 'EncryptionKeyring|ENCRYPTION_KEYS|medichain_crypto::encrypt|medichain_crypto::decrypt|\bencrypt\(|\bdecrypt\(' -Extensions @('.rs')
    key_version_sources = Get-FileMatches -Root $root -Roots @('api') -Pattern 'key_version' -Extensions @('.rs', '.sql')
    mobile_storage_sources = Get-FileMatches -Root $root -Roots @('mobile-examples', 'client/patient-app') -Pattern 'SecureStore|FileSystem|documentDirectory|cacheDirectory|offlineStorage' -Extensions @('.ts', '.tsx')
    device_and_nfc_sources = Get-FileMatches -Root $root -Roots @('api', 'mobile-examples', 'client') -Pattern 'device|Nfc|NFC|QR|qr_' -Extensions @('.rs', '.ts', '.tsx', '.sql')
    identity_and_role_sources = Get-FileMatches -Root $root -Roots @('api', 'pallets') -Pattern 'Role|role|JWT|Jwt|session|wallet|MFA|mfa' -Extensions @('.rs')
    emergency_sources = Get-FileMatches -Root $root -Roots @('api', 'pallets') -Pattern 'emergency|Emergency|grant_emergency_access|expires_at' -Extensions @('.rs', '.sql')
    telehealth_transcription_sources = Get-FileMatches -Root $root -Roots @('api', 'mobile-examples') -Pattern 'Jitsi|jitsi|transcription|Transcription|caption|recording' -Extensions @('.rs', '.ts', '.tsx')
    blockchain_pallet_sources = $palletCalls
    audit_sources = Get-FileMatches -Root $root -Roots @('api', 'pallets') -Pattern 'audit|Audit|access_log|AccessLog' -Extensions @('.rs', '.sql')
    tests = Get-TrackedFiles -Root $root -Prefixes @() -Extensions @('.rs', '.ts', '.tsx') |
        Where-Object { [IO.Path]::GetFileName($_) -match '(test|tests)' } |
        ForEach-Object { Get-RelativePath $_ $root } | Sort-Object
}

$output = Join-Path $root $OutputPath
$json = $manifest | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($output, $json, [System.Text.UTF8Encoding]::new($false))
Write-Output "Wrote $OutputPath"
