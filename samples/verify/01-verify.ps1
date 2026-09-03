# verify/01-verify.ps1 — deep integrity verification in one call
#
# `verify` decompresses every entry and checks CRC-32, declared sizes and
# local-header agreement, then reports per-entry verdicts plus diagnostics.
# Encrypted entries are honestly reported as skipped, never faked as
# verified. Exit 0 when ok, 1 / E_VERIFY_FAILED otherwise (see 02).
#
# Usage:
#   pwsh -File samples/verify/01-verify.ps1
#
# Output: samples/output/verify/stored.zip, 01-verify.json

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/verify'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Zip = Join-Path $OutputDir 'stored.zip'
if (-not (Test-Path $Zip)) {
    Write-Host '→ Building a STORED archive (payloads verbatim — see 02 for why):'
    zn create (Join-Path $InputDir 'text') --method store --output $Zip --quiet
}

Write-Host '→ Text verdict:'
zn verify --input $Zip

Write-Host ''
Write-Host '→ JSON report (saved to 01-verify.json):'
zn verify --input $Zip --format json | Tee-Object -FilePath (Join-Path $OutputDir '01-verify.json')

Write-Host ''
Write-Host '→ Agent one-liner (--json --summary):'
zn verify --input $Zip --json --summary
