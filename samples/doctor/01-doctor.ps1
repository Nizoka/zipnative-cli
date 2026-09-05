# doctor/01-doctor.ps1 — environment / capability preflight
#
# `doctor` checks the CLI and engine versions, Node >= 22, the active deflate
# tier (node-zlib expected; pure under --pure-codecs), the tier pinned by
# --deterministic, platform streaming codecs, worker-thread availability for
# `create --parallel`, registered codecs, the effective security limits and
# the command count. Exit 0 when every check passes. Always offline.
#
# Usage:
#   pwsh -File samples/doctor/01-doctor.ps1
#
# Output: samples/output/doctor/01-doctor.json

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$OutputDir = Join-Path $RootDir 'samples/output/doctor'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

Write-Host '→ Text report:'
zn doctor

Write-Host ''
Write-Host '→ JSON report (saved to 01-doctor.json):'
$Report = Join-Path $OutputDir '01-doctor.json'
zn doctor --format json | Set-Content -Path $Report -Encoding utf8
$Head = Get-Content -Raw $Report
Write-Host ($Head.Substring(0, [Math]::Min(400, $Head.Length)) + ' …')

Write-Host ''
Write-Host '→ With overridden limits and the pure-TS codec tier:'
zn doctor --pure-codecs --max-entries 500 --max-total-size 2g | Select-String 'deflate-tier|limits'

Write-Host ''
Write-Host '→ Version, machine-readable:'
zn --version --json
