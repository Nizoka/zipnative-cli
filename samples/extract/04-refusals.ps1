# extract/04-refusals.ps1 — the guards you hit on ordinary archives
#
# Extraction refuses rather than guesses. This script shows the two guards a
# normal archive trips: overwriting an existing file (E_IO, until you pass
# --overwrite) and the opt-in tolerance flags --skip-unsafe / --skip-symlinks
# (which skip hostile entries instead of aborting — nothing unsafe is ever
# written). The hostile shapes themselves — zip-slip names, absolute paths,
# symlink entries, overlapping local headers, duplicate paths, zip bombs —
# are exercised byte-for-byte in tests/integration/refusal-posture.test.ts;
# each is refused with E_SECURITY / E_LIMIT plus the engine's ZIP_* zipCode.
#
# Usage:
#   pwsh -File samples/extract/04-refusals.ps1
#
# Output: samples/output/extract/04-refusals/

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/extract'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Zip  = Join-Path $OutputDir 'archive.zip'
$Dest = Join-Path $OutputDir '04-refusals'
if (-not (Test-Path $Zip)) {
    zn create (Join-Path $InputDir 'text') (Join-Path $InputDir 'unicode') --output $Zip --quiet
}
if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }

Write-Host '→ [1/4] First extraction succeeds:'
zn extract --input $Zip --output-dir $Dest --json

# The next call is EXPECTED to fail — read $LASTEXITCODE instead of terminating.
$PSNativeCommandUseErrorActionPreference = $false
Write-Host ''
Write-Host '→ [2/4] Second extraction into the same directory is REFUSED (E_IO):'
zn extract --input $Zip --output-dir $Dest --json
Write-Host "  exit $LASTEXITCODE"
$PSNativeCommandUseErrorActionPreference = $true

Write-Host ''
Write-Host '→ [3/4] --overwrite makes it explicit:'
zn extract --input $Zip --output-dir $Dest --overwrite --json

Write-Host ''
Write-Host '→ [4/4] --skip-unsafe --skip-symlinks: tolerate hostile entries by skipping them'
Write-Host '        (this archive has none, so skipped stays empty):'
zn extract --input $Zip --output-dir $Dest --overwrite --skip-unsafe --skip-symlinks --json

Write-Host ''
Write-Host 'Refusal catalogue (E_SECURITY + zipCode): ZIP_PATH_TRAVERSAL, ZIP_SYMLINK_REJECTED,'
Write-Host 'ZIP_EXTRACT_DUPLICATE_PATH, ZIP_ENTRY_OVERLAP, ZIP_CD_LFH_MISMATCH; bounds (E_LIMIT):'
Write-Host '--max-entry-size, --max-total-size, --max-ratio … — see zipnative schema errors.'
