# extract/01-basic.ps1 — extract to a directory, secure by default
#
# --output-dir is REQUIRED (created if missing). Every entry name is passed
# through sanitizeEntryPath() and re-checked for containment under the root,
# so zip-slip, absolute paths, drive letters, device names and symlink
# entries are refused without any opt-in. --json returns the counts and the
# skipped list; UTF-8 names round-trip as-is.
#
# Usage:
#   pwsh -File samples/extract/01-basic.ps1
#
# Output: samples/output/extract/archive.zip, 01-basic/

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
$Dest = Join-Path $OutputDir '01-basic'
if (-not (Test-Path $Zip)) {
    Write-Host '→ Building the sample archive…'
    zn create (Join-Path $InputDir 'text') (Join-Path $InputDir 'unicode') --output $Zip --quiet
}
if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }

Write-Host "→ Extracting into $Dest`:"
zn extract --input $Zip --output-dir $Dest --json

Write-Host ''
Write-Host '→ Extracted tree:'
Get-ChildItem -Recurse -File -Name $Dest | Sort-Object | ForEach-Object { Write-Host "  $_" }

Write-Host ''
Write-Host '→ Byte check against the source:'
$Src = (Get-FileHash -Algorithm SHA256 (Join-Path $InputDir 'text/readme.txt')).Hash
$Out = (Get-FileHash -Algorithm SHA256 (Join-Path $Dest 'text/readme.txt')).Hash
if ($Src -eq $Out) { Write-Host '  ✓ text/readme.txt identical' } else { Write-Error '  ✗ mismatch' }
