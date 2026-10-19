# list/05-range.ps1 — read an archive larger than memory, by byte ranges (--range)
#
# By default list / cat / verify load the whole archive, bounded by
# --max-input-size. --range reads a regular file by byte ranges through one
# descriptor (zipnative 1.1 openZipRange): list fetches only the central
# directory, cat only the entries it prints, verify one entry at a time. The
# demo shrinks --max-input-size to 1 KiB to show the difference on a small
# archive. A whole-entry fetch (cat --raw, verify) is bounded by
# --max-entry-compressed-size; stdin is refused (no random access).
#
# Usage:
#   pwsh -File samples/list/05-range.ps1
#
# Output: samples/output/list/05-range.zip

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/list'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Zip = Join-Path $OutputDir '05-range.zip'
zn create $InputDir --output $Zip --overwrite --quiet

# The first call is EXPECTED to fail.
$PSNativeCommandUseErrorActionPreference = $false
Write-Host '→ Buffered: the archive is above --max-input-size 1k (exit 1, E_LIMIT) — expected:'
zn list --input $Zip --max-input-size 1k --json --summary
Write-Host "  exit $LASTEXITCODE"
$PSNativeCommandUseErrorActionPreference = $true

Write-Host ''
Write-Host '→ --range: only the central directory is read:'
zn list --input $Zip --range --max-input-size 1k --json --summary

Write-Host ''
Write-Host '→ cat and verify by range too:'
zn cat --input $Zip --entry input/text/readme.txt --range --max-input-size 1k
zn verify --input $Zip --range --max-input-size 1k --json --summary
