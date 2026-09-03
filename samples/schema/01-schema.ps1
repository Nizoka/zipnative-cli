# schema/01-schema.ps1 — JSON Schemas and the capability manifest for agents
#
# `zipnative schema <subject>` prints a draft 2020-12 JSON Schema for every
# input (create-manifest, modify-manifest, batch-manifest) and output
# (entries, inspect, verify, stream, batch, doctor, govern-verify, crc32,
# the status/error envelopes), plus `errors` (E_* codes, the ZIP_* → E_*
# mapping and diagnostics) and `manifest` (the capability manifest: every
# command, flag and code). Agents fetch these once and validate against them.
#
# Usage:
#   pwsh -File samples/schema/01-schema.ps1
#
# Output: samples/output/schema/*.json

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$OutputDir = Join-Path $RootDir 'samples/output/schema'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

Write-Host '→ Subjects:'
zn schema list

Write-Host ''
Write-Host '→ Saving the manifests, the error catalogue and the capability manifest:'
foreach ($subject in 'create-manifest', 'modify-manifest', 'batch-manifest', 'errors', 'manifest', 'status', 'error') {
    $file = Join-Path $OutputDir "$subject.json"
    zn schema $subject | Set-Content -Path $file -Encoding utf8
    Write-Host ("  {0,-18} {1,6} bytes" -f $subject, (Get-Item $file).Length)
}

Write-Host ''
Write-Host '→ E_* codes and their exit codes (from schema errors):'
$Errors = (zn schema errors --json | ConvertFrom-Json)
foreach ($c in $Errors.cli) { Write-Host ("  {0,-16} exit {1}" -f $c.code, $c.exitCode) }
Write-Host ("  ZIP_* → E_* mappings: {0}" -f ($Errors.zipnativeToCli.PSObject.Properties | Measure-Object).Count)

# Expected failure — read $LASTEXITCODE instead of terminating.
$PSNativeCommandUseErrorActionPreference = $false
Write-Host ''
Write-Host '→ An unknown subject is a usage error (exit 2, E_USAGE):'
zn schema bogus --json
Write-Host "  exit $LASTEXITCODE"
