# extract/03-dry-run-plan.ps1 — plan an extraction without writing anything
#
# --dry-run resolves and validates every entry (names, containment, filters,
# limits) and prints the plan — one `plan <name> <size>` line per entry in
# text mode, a status envelope with dryRun: true under --json. The output
# directory is never created. Agents use this to preview what an untrusted
# archive WOULD do before committing to disk.
#
# Usage:
#   pwsh -File samples/extract/03-dry-run-plan.ps1

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
$Dest = Join-Path $OutputDir '03-never-created'
if (-not (Test-Path $Zip)) {
    zn create (Join-Path $InputDir 'text') (Join-Path $InputDir 'unicode') --output $Zip --quiet
}
if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }

Write-Host '→ Text plan:'
zn extract --input $Zip --output-dir $Dest --dry-run

Write-Host ''
Write-Host '→ JSON envelope for a filtered plan:'
zn extract --input $Zip --output-dir $Dest --include '**/*.md' --dry-run --json

Write-Host ''
if (Test-Path $Dest) {
    Write-Error "  ✗ --dry-run created $Dest"
} else {
    Write-Host "  ✓ nothing was written ($Dest does not exist)"
}
