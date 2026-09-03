# inspect/01-report.ps1 — forensic archive report (text and JSON)
#
# `inspect` opens the archive EAGERLY: every local header is cross-checked
# against the central directory and an overlap table is built before anything
# is printed. The report covers archive facts, per-method statistics, a
# determinism verdict and every diagnostic the parse emitted. --entries adds
# the long-form entry rows, --extra dumps extra-field payloads as hex.
#
# Usage:
#   pwsh -File samples/inspect/01-report.ps1
#
# Output: samples/output/inspect/archive.zip, 01-report.json

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/inspect'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Zip = Join-Path $OutputDir 'archive.zip'
if (-not (Test-Path $Zip)) {
    Write-Host '→ Building a deterministic sample archive…'
    zn create (Join-Path $InputDir 'text') (Join-Path $InputDir 'binary') --deterministic --output $Zip --quiet
}

Write-Host '→ Text report:'
zn inspect --input $Zip

Write-Host ''
Write-Host '→ JSON report with entries (saved to 01-report.json):'
$Report = Join-Path $OutputDir '01-report.json'
zn inspect --input $Zip --format json --entries | Set-Content -Path $Report -Encoding utf8
$Head = (Get-Content -Raw $Report)
Write-Host ($Head.Substring(0, [Math]::Min(600, $Head.Length)) + ' …')

Write-Host ''
Write-Host '→ Just the determinism block:'
zn inspect --input $Zip --format json --fields determinism
