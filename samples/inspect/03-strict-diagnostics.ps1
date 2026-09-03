# inspect/03-strict-diagnostics.ps1 — engine diagnostics and --strict escalation
#
# zipnative reports odd-but-legal shapes as DIAGNOSTICS (info/warning) rather
# than errors: here a self-extractor-style stub is prepended to a valid
# archive, which yields ZIP_PREPENDED_DATA. Without --strict the report still
# succeeds and lists it; with --strict the FIRST diagnostic is escalated to
# E_CHECK_FAILED (zipCode ZIP_STRICT_DIAGNOSTIC) before any output byte, so a
# CI gate can refuse anything that is not a pristine archive. --strict is
# global — `verify --strict` and `list --strict` behave the same way.
#
# Usage:
#   pwsh -File samples/inspect/03-strict-diagnostics.ps1
#
# Output: samples/output/inspect/03-prepended.zip

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
$Pre = Join-Path $OutputDir '03-prepended.zip'
if (-not (Test-Path $Zip)) {
    zn create (Join-Path $InputDir 'text') (Join-Path $InputDir 'binary') --deterministic --output $Zip --quiet
}

Write-Host '→ Prepending a 17-byte shell stub to the archive:'
$PrependJs = @'
const fs = require("node:fs");
const [src, dst] = process.argv.slice(1);
fs.writeFileSync(dst, Buffer.concat([Buffer.from("#!/bin/sh\nexit 0\n"), fs.readFileSync(src)]));
'@
& node -e $PrependJs $Zip $Pre
Write-Host "  ✓ $Pre"

Write-Host ''
Write-Host '→ inspect (lenient): succeeds, reports prependedData + the diagnostic:'
zn inspect --input $Pre --format json --fields archive.prependedData,diagnostics

# Expected failures below — read $LASTEXITCODE instead of terminating.
$PSNativeCommandUseErrorActionPreference = $false

Write-Host ''
Write-Host '→ inspect --strict: the diagnostic is escalated to E_CHECK_FAILED:'
zn inspect --input $Pre --strict --json --summary
Write-Host "  exit $LASTEXITCODE"

Write-Host ''
Write-Host '→ verify --strict fails the same way (E_VERIFY_FAILED, 1 diagnostic):'
zn verify --input $Pre --strict
Write-Host "  exit $LASTEXITCODE"
